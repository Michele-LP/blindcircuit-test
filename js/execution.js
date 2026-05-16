// ═══════════════════════════════════════════════════════════════════════════
//  EXECUTION.JS — v6.8
//
//  NOVITÀ v6.8:
//  ─ Nastri curvi: conveyor_turn e express_conveyor_turn con rotazione 90°
//  ─ applyConveyors esteso per gestire _isBeltOfType()
//  ─ Rotazione robot dopo movimento su curva
// ═══════════════════════════════════════════════════════════════════════════

const Execution = (() => {

  const ACTION_DELAYS = [650, 380, 200, 80];
  const REG_DELAYS    = [1400, 800, 400, 120];
  let _cancelled = { value: false };

  const VECS  = { N:[0,-1], E:[1,0], S:[0,1], W:[-1,0] };
  const ROT_R = { N:'E', E:'S', S:'W', W:'N' };
  const ROT_L = { N:'W', W:'S', S:'E', E:'N' };
  const OPP   = { N:'S', S:'N', E:'W', W:'E' };

  function rotRight(d) { return ROT_R[d] ?? d; }
  function rotLeft(d)  { return ROT_L[d] ?? d; }
  function rotU(d)     { return rotRight(rotRight(d)); }

  function _shuffle(a) {
    a = [...a]; for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]];
    } return a;
  }

  function wallBlocks(cx, cy, dir) {
    if (Board.wallsAt(cx, cy).includes(dir)) return true;
    const v = VECS[dir];
    return Board.wallsAt(cx + v[0], cy + v[1]).includes(OPP[dir]);
  }

  function respawnPos(s) {
    if (s.lastCheckpoint > 0) {
      const cp = (Board.data?.checkpoints ?? []).find(c => c.order === s.lastCheckpoint);
      if (cp) return { cx: cp.x, cy: cp.y };
    }
    return { cx: s.startCx, cy: s.startCy };
  }

  function _playerInfo(id) {
    const p = State.players[id];
    const ch = p ? CONFIG.characters.find(c => c.id === p.character) : null;
    return { name: p?.nickname || '?', color: ch?.color || '#6b7280' };
  }

  // ── Danno condiviso ──────────────────────────────────────────────────────
  function drawDamage(simShared, simPlayer, regIndex) {
    if (!simShared.damageDeck.length) {
      if (!simShared.damageDiscard.length) return null;
      simShared.damageDeck = _shuffle([...simShared.damageDiscard]);
      simShared.damageDiscard = [];
    }
    const card = simShared.damageDeck.pop();
    if (card === 'spam') { (simPlayer.discard = simPlayer.discard ?? []).unshift('spam'); }
    else { simPlayer.wormSlots = simPlayer.wormSlots ?? {}; simPlayer.wormSlots[regIndex] = card; }
    return { type:'damage', id: simPlayer.id, card, regIndex };
  }

  function execWorm(simShared, sim, id, reg, wormId) {
    const s = sim[id], actions = [];
    const def = (typeof RULES !== 'undefined' ? RULES?.worms : null)?.find(w => w.id === wormId);
    if (def) for (const step of def.sequence) {
      switch (step.type) {
        case 'move':        actions.push(...moveSteps(sim, id, step.steps ?? 1));    break;
        case 'backUp':      actions.push(...moveSteps(sim, id, -(step.steps ?? 1))); break;
        case 'rotateLeft':  s.dir = rotLeft(s.dir);  actions.push({type:'rotate',id,dir:s.dir}); break;
        case 'rotateRight': s.dir = rotRight(s.dir); actions.push({type:'rotate',id,dir:s.dir}); break;
        case 'uTurn':       s.dir = rotU(s.dir);     actions.push({type:'rotate',id,dir:s.dir}); break;
      }
    }
    if (s.wormSlots) s.wormSlots[reg] = null;
    simShared.damageDiscard.push(wormId);
    actions.push({ type:'worm_clear', id, reg, wormId });
    return actions;
  }

  // ── Push a catena ────────────────────────────────────────────────────────
  function tryPush(sim, pushedId, dir, actions) {
    const s = sim[pushedId];
    if (wallBlocks(s.cx, s.cy, dir)) return false;
    const v = VECS[dir], nx = s.cx+v[0], ny = s.cy+v[1];
    // Fuori bordo
    if (!Board.inBounds(nx, ny)) {
      const rp = respawnPos(s); s.cx = rp.cx; s.cy = rp.cy;
      for (let j = 0; j < CONFIG.spamCardsOnFall; j++) (s.discard=s.discard??[]).unshift('spam');
      actions.push({ type:'fall', id:pushedId, cx:s.cx, cy:s.cy, respawnCx:rp.cx, respawnCy:rp.cy });
      s.rebooting = true;
      return true;
    }
    // Buco: il robot si muove SULLA cella buco, poi cade
    if (Board.cellType(nx, ny) === 'pit') {
      s.cx = nx; s.cy = ny;
      actions.push({ type:'move', id:pushedId, cx:nx, cy:ny });
      const rp = respawnPos(s); s.cx = rp.cx; s.cy = rp.cy;
      for (let j = 0; j < CONFIG.spamCardsOnFall; j++) (s.discard=s.discard??[]).unshift('spam');
      actions.push({ type:'fall', id:pushedId, cx:nx, cy:ny, respawnCx:rp.cx, respawnCy:rp.cy });
      s.rebooting = true;
      return true;
    }
    const blocker = Object.values(sim).find(o => o.id !== pushedId && o.cx === nx && o.cy === ny);
    if (blocker && !tryPush(sim, blocker.id, dir, actions)) return false;
    s.cx = nx; s.cy = ny;
    actions.push({ type:'move', id:pushedId, cx:nx, cy:ny });
    return true;
  }

  // ── Carte ────────────────────────────────────────────────────────────────
  function execCard(sim, id, card, prevCard) {
    const s = sim[id];
    switch (card) {
      case 'move1':       return moveSteps(sim, id,  1);
      case 'move2':       return moveSteps(sim, id,  2);
      case 'move3':       return moveSteps(sim, id,  3);
      case 'backUp':      return moveSteps(sim, id, -1);
      case 'rotateRight': s.dir=rotRight(s.dir); return [{type:'rotate',id,dir:s.dir}];
      case 'rotateLeft':  s.dir=rotLeft(s.dir);  return [{type:'rotate',id,dir:s.dir}];
      case 'uTurn':       s.dir=rotU(s.dir);     return [{type:'rotate',id,dir:s.dir}];
      case 'again':       return prevCard ? execCard(sim,id,prevCard,null) : execCard(sim,id,'spam',null);
      case 'recharge':
        s.energy = Math.min((s.energy??0)+CONFIG.rechargeAmount, CONFIG.maxEnergy);
        return [{type:'energy',id,energy:s.energy}];
      case 'spam': {
        if (!s.deck?.length) { if (!s.discard?.length) return []; s.deck=_shuffle([...s.discard]); s.discard=[]; }
        while (s.deck.length) { const d=s.deck.pop(); if (d!=='spam') { s.discard.push(d); return execCard(sim,id,d,null); } }
        return [];
      }
      default: return [];
    }
  }

  // ── Movimento con spinta ─────────────────────────────────────────────────
  // Caduta nei buchi: prima 'move' sulla cella buco, poi 'fall' con snap al respawn.
  function moveSteps(sim, id, steps) {
    const s = sim[id], dir = steps > 0 ? s.dir : OPP[s.dir], v = VECS[dir], actions = [];
    for (let i = 0; i < Math.abs(steps); i++) {
      if (wallBlocks(s.cx, s.cy, dir)) break;
      const nx = s.cx+v[0], ny = s.cy+v[1];
      // Fuori bordo
      if (!Board.inBounds(nx, ny)) {
        const rp = respawnPos(s); s.cx=rp.cx; s.cy=rp.cy;
        for (let j=0;j<CONFIG.spamCardsOnFall;j++) (s.discard=s.discard??[]).unshift('spam');
        actions.push({type:'fall',id,cx:nx,cy:ny,respawnCx:rp.cx,respawnCy:rp.cy});
        s.rebooting = true; break;
      }
      // Buco: muovi SULLA cella, poi caduta
      if (Board.cellType(nx, ny) === 'pit') {
        s.cx=nx; s.cy=ny;
        actions.push({type:'move',id,cx:nx,cy:ny});
        const rp = respawnPos(s); s.cx=rp.cx; s.cy=rp.cy;
        for (let j=0;j<CONFIG.spamCardsOnFall;j++) (s.discard=s.discard??[]).unshift('spam');
        actions.push({type:'fall',id,cx:nx,cy:ny,respawnCx:rp.cx,respawnCy:rp.cy});
        s.rebooting = true; break;
      }
      // Collisione push
      const blocker = Object.values(sim).find(o => o.id !== id && o.cx === nx && o.cy === ny);
      if (blocker) { const pa=[]; if (!tryPush(sim,blocker.id,dir,pa)) break; actions.push(...pa); }
      s.cx=nx; s.cy=ny;
      actions.push({type:'move',id,cx:nx,cy:ny});
    }
    return actions;
  }

  // ── Nastri, push panel, ingranaggi ────────────────────────────────────────

  // NEW v6.8: applyConveyors gestisce anche conveyor_turn / express_conveyor_turn.
  // Le curve spostano il robot nella direzione 'to' e lo ruotano di 90°.
  function _isBeltOfType(cellType, beltType) {
    if (cellType === beltType) return true;
    if (beltType === 'conveyor'         && cellType === 'conveyor_turn')         return true;
    if (beltType === 'express_conveyor' && cellType === 'express_conveyor_turn') return true;
    return false;
  }

  function applyConveyors(sim, beltType) {
    const actions=[];
    const onBelt = Object.values(sim).filter(s => {
      const ct = Board._cellAt(s.cx, s.cy)?.type;
      return ct && _isBeltOfType(ct, beltType);
    });
    if (!onBelt.length) return actions;

    const intended = new Map();   // id → { nx, ny } | null
    const turnInfo = new Map();   // id → { from, to } per le curve (per la rotazione)

    for (const s of onBelt) {
      const cell = Board._cellAt(s.cx, s.cy);
      const isTurn = cell.type.includes('_turn');
      // Direzione di uscita: per le curve è 'to', per i nastri dritti è 'dir'
      const dir = isTurn ? cell.to : cell.dir;
      if (!dir || wallBlocks(s.cx, s.cy, dir)) { intended.set(s.id, null); continue; }
      const v = VECS[dir], nx = s.cx + v[0], ny = s.cy + v[1];
      if (!Board.inBounds(nx, ny)) { intended.set(s.id, null); continue; }
      intended.set(s.id, { nx, ny });
      if (isTurn) turnInfo.set(s.id, { from: cell.from, to: cell.to });
    }

    // Risoluzione conflitti: due robot stessa destinazione → nessuno si muove
    const dc = new Map();
    for (const [, m] of intended) if (m) { const k = `${m.nx},${m.ny}`; dc.set(k, (dc.get(k) || 0) + 1); }
    for (const [id, m] of intended) if (m && (dc.get(`${m.nx},${m.ny}`) || 0) > 1) intended.set(id, null);
    // Blocco: robot fermo nella destinazione (non su nastro o non si muove)
    for (const [id, m] of intended) {
      if (!m) continue;
      if (Object.values(sim).some(o => o.id !== id && o.cx === m.nx && o.cy === m.ny &&
          (intended.get(o.id) === undefined || intended.get(o.id) === null)))
        intended.set(id, null);
    }

    // Applica movimenti
    for (const [id, m] of intended) {
      if (!m) continue;
      const s = sim[id];
      if (Board.cellType(m.nx, m.ny) === 'pit') {
        s.cx = m.nx; s.cy = m.ny; actions.push({ type: 'move', id, cx: m.nx, cy: m.ny });
        const rp = respawnPos(s); s.cx = rp.cx; s.cy = rp.cy;
        for (let j = 0; j < CONFIG.spamCardsOnFall; j++) s.discard.unshift('spam');
        actions.push({ type: 'fall', id, cx: m.nx, cy: m.ny, respawnCx: rp.cx, respawnCy: rp.cy });
        s.rebooting = true;
      } else {
        s.cx = m.nx; s.cy = m.ny;
        actions.push({ type: 'move', id, cx: m.nx, cy: m.ny });
      }
    }

    // NEW v6.8: rotazione per i robot che erano su curve e si sono effettivamente mossi
    // from = direzione di viaggio in entrata, to = direzione dopo la curva
    for (const [id, ti] of turnInfo) {
      if (!intended.get(id)) continue; // non si è mosso → niente rotazione
      const s = sim[id];
      if (s.rebooting) continue;       // caduto → niente rotazione
      const isRight = ROT_R[ti.from] === ti.to;
      s.dir = isRight ? rotRight(s.dir) : rotLeft(s.dir);
      actions.push({ type: 'rotate', id, dir: s.dir });
    }

    return actions;
  }
  function applyPushPanels(sim,regIndex){
    const a=[];
    for (const s of Object.values(sim)){
      const c=Board._cellAt(s.cx,s.cy);
      if (!c||c.type!=='push_panel') continue;
      if (!(c.activeRegisters??[]).includes(regIndex+1)) continue;
      const pa=[]; tryPush(sim,s.id,c.dir,pa); a.push(...pa);
    } return a;
  }
  function applyGears(sim){
    const a=[];
    for (const s of Object.values(sim)){
      const c=Board._cellAt(s.cx,s.cy); if (!c) continue;
      if (c.type==='gear_cw') {s.dir=rotRight(s.dir);a.push({type:'rotate',id:s.id,dir:s.dir});}
      if (c.type==='gear_ccw'){s.dir=rotLeft(s.dir); a.push({type:'rotate',id:s.id,dir:s.dir});}
    } return a;
  }

  // ── Laser ────────────────────────────────────────────────────────────────
  //
  // FIX v6.7.1: aggiunto wallCheck tra sorgente laser e prima cella.
  // NEW v6.7.1: azione `laser_beam` con coordinate da/a per il raggio visivo.
  //    game.js legge State._activeBeams e li disegna come linee sfumanti.
  //
  function fireLasers(simShared,sim,reg){
    const a=[];
    const defaultStr=(typeof RULES!=='undefined'?RULES?.lasers?.boardLaserStrength:null)??CONFIG.boardLaserStrength??1;
    for (const L of Board.data?.lasers??[]){
      const st=L.strength??defaultStr;
      const v=VECS[L.dir];

      // FIX: controlla se un muro blocca il raggio GIÀ alla sorgente
      // (muro sul lato di uscita della cella sorgente, o muro sul lato
      //  di ingresso della prima cella da scansionare)
      if (Board.wallsAt(L.x,L.y).includes(L.dir)) continue;
      const firstX=L.x+v[0], firstY=L.y+v[1];
      if (!Board.inBounds(firstX,firstY)) continue;
      if (Board.wallsAt(firstX,firstY).includes(OPP[L.dir])) continue;

      // Scansiona il raggio cella per cella
      let lx=firstX, ly=firstY;
      let endX=lx, endY=ly;
      let hitPlayer=null;

      while (Board.inBounds(lx,ly)){
        endX=lx; endY=ly;
        const hit=Object.values(sim).find(s=>s.cx===lx&&s.cy===ly);
        if (hit){ hitPlayer=hit; break; }
        if (wallBlocks(lx,ly,L.dir)) break;
        lx+=v[0]; ly+=v[1];
      }

      // Raggio visivo: dalla sorgente al punto di impatto (o fine mappa)
      a.push({
        type:'laser_beam',
        fromCx:L.x, fromCy:L.y,
        toCx:endX, toCy:endY,
        color:'#f85149',
        source:'board',
      });

      // Danno al robot colpito
      if (hitPlayer){
        for(let i=0;i<st;i++){
          const d=drawDamage(simShared,hitPlayer,reg);
          if(d){d.source='board_laser';a.push(d);}
        }
      }
    }
    return a;
  }

  function fireRobotWeapons(simShared,sim,reg){
    const a=[];
    const str=(typeof RULES!=='undefined'?RULES?.lasers?.robotLaserStrength:null)??CONFIG.robotLaserStrength??1;
    for (const id of turnOrder()){
      const sh=sim[id]; if(!sh)continue;

      // Muro blocca il laser del robot in partenza
      if(wallBlocks(sh.cx,sh.cy,sh.dir))continue;

      const v=VECS[sh.dir];
      let lx=sh.cx+v[0],ly=sh.cy+v[1];
      let endX=sh.cx, endY=sh.cy;   // fallback: zero-length beam
      let hitPlayer=null;

      while(Board.inBounds(lx,ly)){
        endX=lx; endY=ly;    // il raggio arriva almeno qui
        const hit=Object.values(sim).find(s=>s.id!==id&&s.cx===lx&&s.cy===ly);
        if(hit){ hitPlayer=hit; break; }
        if(wallBlocks(lx,ly,sh.dir)) break;   // muro blocca uscita → raggio si ferma qui
        lx+=v[0]; ly+=v[1];
      }

      // Raggio visivo dal robot — colore del personaggio
      const pInfo=_playerInfo(id);
      a.push({
        type:'laser_beam',
        fromCx:sh.cx, fromCy:sh.cy,
        toCx:endX, toCy:endY,
        color:pInfo.color,
        source:'robot',
        shooterId:id,
      });

      if(hitPlayer){
        for(let i=0;i<str;i++){
          const d=drawDamage(simShared,hitPlayer,reg);
          if(d){d.source='robot_laser';d.shooterId=id;a.push(d);}
        }
      }
    }
    return a;
  }

  function checkCheckpoint(s){
    const cps=Board.data?.checkpoints??[],next=(s.lastCheckpoint??0)+1;
    const cp=cps.find(c=>c.order===next&&c.x===s.cx&&c.y===s.cy);
    if(!cp)return null; s.lastCheckpoint=next;
    return {type:'checkpoint',id:s.id,order:next,won:next>=cps.length};
  }

  function turnOrder(){
    const all=State.getPlayerList(),idx=all.findIndex(p=>p.id===State.energyToken),from=idx>=0?idx:0;
    return [...all.slice(from),...all.slice(0,from)].map(p=>p.id);
  }

  // ── applyAction — aggiorna stato + scrive nel Log ────────────────────────
  function applyAction(a) {
    if (a.type==='damage_deck_sync'){State.damageDeck=a.damageDeck;State.damageDiscard=a.damageDiscard;return;}
    if (a.type==='phase_marker'){
      if(typeof Log!=='undefined')Log.add(`— ${a.name} —`,{type:'info'});
      return;
    }
    if (a.type==='card_played'){
      const i=_playerInfo(a.id);
      const prefix=a.isWorm?'🦠 ':'';
      if(typeof Log!=='undefined')Log.add(`${i.name}: ${prefix}${a.cardName}`,{color:i.color});
      return;
    }
    // NEW v6.7.1: raggio laser visivo → aggiunto a State._activeBeams
    // game.js lo legge nel render loop e lo disegna come linea sfumante.
    if (a.type==='laser_beam'){
      if(!State._activeBeams) State._activeBeams=[];
      State._activeBeams.push({
        fromCx:a.fromCx, fromCy:a.fromCy,
        toCx:a.toCx, toCy:a.toCy,
        color:a.color,
        t:performance.now(),
      });
      return;
    }

    const p=State.players[a.id]; if(!p)return;
    switch(a.type){

    case 'move':
      p.cx=a.cx;p.cy=a.cy;
      break;

    case 'rotate': {
      p.dir=a.dir;
      const dirs={N:'↑N',E:'→E',S:'↓S',W:'←O'};
      if(typeof Log!=='undefined'){const i=_playerInfo(a.id);Log.add(`${i.name}: ruota ${dirs[a.dir]??a.dir}`,{color:i.color});}
      break;
    }

    case 'fall':
      p.cx=a.respawnCx;p.cy=a.respawnCy;
      p._snapAnim=true;   // game.js: teletrasporto istantaneo, no lerp
      {const i=_playerInfo(a.id);
       if(typeof Log!=='undefined')Log.add(`${i.name}: caduto nel buco — respawn`,{color:i.color,type:'damage'});
       if(typeof Toast!=='undefined')Toast.show(`💥 ${i.name} cade nel buco!`,{color:i.color});}
      break;

    case 'checkpoint':
      p.lastCheckpoint=a.order;
      if(!p.checkpoints)p.checkpoints=[];
      if(!p.checkpoints.includes(a.order))p.checkpoints.push(a.order);
      {const i=_playerInfo(a.id);
       if(typeof Log!=='undefined')Log.add(`${i.name}: checkpoint ${a.order}!`,{color:i.color,type:'event'});
       if(typeof Toast!=='undefined')Toast.show(`⭐ ${i.name} → checkpoint ${a.order}`,{color:i.color});}
      break;

    case 'energy':
      p.energy=a.energy;
      {const i=_playerInfo(a.id);
       if(typeof Log!=='undefined')Log.add(`${i.name}: ⚡${a.energy}`,{color:i.color});}
      break;

    case 'damage': {
      if(a.card==='spam'){if(!p.discard)p.discard=[];p.discard.unshift('spam');}
      else {if(!p.wormSlots)p.wormSlots={};p.wormSlots[a.regIndex]=a.card;}
      const i=_playerInfo(a.id);
      const src=a.source==='robot_laser'?'laser robot':'laser bordo';
      if(a.card==='spam'){
        const m=`${i.name}: colpito (${src}) → SPAM`;
        if(typeof Log!=='undefined')Log.add(m,{color:i.color,type:'damage'});
        if(typeof Toast!=='undefined')Toast.show(`🎯 ${m}`,{color:i.color});
      } else {
        const wd=(typeof RULES!=='undefined'?RULES?.worms:null)?.find(w=>w.id===a.card);
        const m=`${i.name}: colpito (${src}) → WORM ${wd?.name??a.card} in P${a.regIndex+1}`;
        if(typeof Log!=='undefined')Log.add(m,{color:i.color,type:'damage'});
        if(typeof Toast!=='undefined')Toast.show(`🦠 ${m}`,{color:i.color,duration:4000});
      }
      break;
    }

    case 'worm_clear':
      if(p.wormSlots)p.wormSlots[a.reg]=null;
      if(a.wormId&&typeof Log!=='undefined'){
        const i=_playerInfo(a.id);
        const wd=(typeof RULES!=='undefined'?RULES?.worms:null)?.find(w=>w.id===a.wormId);
        Log.add(`${i.name}: WORM ${wd?.name??a.wormId} eseguito (P${a.reg+1} libero)`,{color:i.color,type:'event'});
      }
      break;

    case 'deck_sync':
      if(a.deck!==undefined)p.deck=a.deck;
      if(a.discard!==undefined)p.discard=a.discard;
      break;
    }
  }

  function onExecutionEnd(winner){
    if(winner){
      const i=_playerInfo(winner);
      if(typeof Log!=='undefined')Log.add(`🏆 VITTORIA di ${i.name}!`,{color:i.color,type:'event'});
      if(typeof Toast!=='undefined')Toast.show(`🏆 ${i.name} ha vinto!`,{color:i.color,duration:8000});
      if(typeof Game?.stopTimer==='function')Game.stopTimer();
      document.getElementById('win-player').textContent=i.name;
      UI.show('win'); return;
    }
    if(State.isHost){
      const pls=State.getPlayerList(),idx=pls.findIndex(p=>p.id===State.energyToken);
      State.energyToken=pls[(idx+1)%pls.length]?.id??State.energyToken;
      State.round++;
      const ws={}; for(const p of pls) ws[p.id]=p.wormSlots??{};
      setTimeout(()=>{Net.sendToAll({type:'ROUND_START',round:State.round,timerSec:0,wormSlots:ws});},800);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  return {

    compute(allRegisters) {
      if (!State.isHost) return;
      const simShared = { damageDeck:[...State.damageDeck], damageDiscard:[...State.damageDiscard] };
      const sim = {};
      State.getPlayerList().forEach((p,i)=>{
        const sp=Board.startPos(i);
        sim[p.id]={
          id:p.id, cx:p.cx, cy:p.cy, dir:p.dir,
          startCx:sp.x, startCy:sp.y,
          lastCheckpoint:p.lastCheckpoint??0,
          energy:p.energy??CONFIG.startingEnergy,
          discard:[...(p.discard??[])], deck:[...(p.deck??[])],
          wormSlots:{...(p.wormSlots??{})},
          registers:allRegisters[p.id]??[],
          rebooting: false,
        };
      });

      const plan=[],prevCard={},order=turnOrder();
      let winner=null;

      for (let reg=0;reg<CONFIG.registersCount;reg++){
        const ra=[];

        // ── Carte ──────────────────────────────────────────────────────────
        for (const id of order){
          if (sim[id].rebooting) continue;   // REBOOT: salta tutti i registri rimanenti
          const card=sim[id]?.registers[reg];
          if (!card) continue;
          // Log: quale carta viene giocata
          if (typeof card==='string' && card.startsWith('worm_')){
            const wd=(typeof RULES!=='undefined'?RULES?.worms:null)?.find(w=>w.id===card);
            ra.push({type:'card_played',id,cardName:wd?.name??card,isWorm:true});
            ra.push(...execWorm(simShared,sim,id,reg,card));
          } else {
            const def=CONFIG.cards.find(c=>c.id===card);
            ra.push({type:'card_played',id,cardName:def?.name??card});
            ra.push(...execCard(sim,id,card,prevCard[id]));
            if(card!=='again')prevCard[id]=card;
          }
        }

        // ── Elementi del tabellone (con markers per il log) ──────────────
        const conv1=applyConveyors(sim,'express_conveyor');
        const conv2=applyConveyors(sim,'express_conveyor');
        if(conv1.length||conv2.length) ra.push({type:'phase_marker',name:'Nastri express'});
        ra.push(...conv1,...conv2);

        const conv3=applyConveyors(sim,'conveyor');
        if(conv3.length) ra.push({type:'phase_marker',name:'Nastri normali'});
        ra.push(...conv3);

        const pp=applyPushPanels(sim,reg);
        if(pp.length) ra.push({type:'phase_marker',name:'Push panel'});
        ra.push(...pp);

        const gears=applyGears(sim);
        if(gears.length) ra.push({type:'phase_marker',name:'Ingranaggi'});
        ra.push(...gears);

        const bl=fireLasers(simShared,sim,reg);
        if(bl.length) ra.push({type:'phase_marker',name:'Laser bordo'});
        ra.push(...bl);

        const rl=fireRobotWeapons(simShared,sim,reg);
        if(rl.length) ra.push({type:'phase_marker',name:'Laser robot'});
        ra.push(...rl);

        // ── Batterie + Checkpoint ────────────────────────────────────────
        for (const id of order){
          const s=sim[id];
          if(Board.cellType(s.cx,s.cy)==='recharge'){
            s.energy=Math.min((s.energy??0)+CONFIG.rechargeAmount,CONFIG.maxEnergy);
            ra.push({type:'energy',id,energy:s.energy});
          }
        }
        for (const id of order){
          const cp=checkCheckpoint(sim[id]);
          if(!cp) continue; ra.push(cp);
          if(cp.won) winner=id;
        }

        plan.push(ra);
        if(winner) break;
      }

      // Sync finale
      plan.push([
        ...Object.values(sim).map(s=>({type:'deck_sync',id:s.id,deck:[...s.deck],discard:[...s.discard]})),
        {type:'damage_deck_sync',damageDeck:[...simShared.damageDeck],damageDiscard:[...simShared.damageDiscard]},
      ]);

      Net.broadcast({type:'EXECUTE_PLAN',plan,winner,registers:allRegisters});
      this.animate(plan,winner,allRegisters);
    },

    receive(msg){this.animate(msg.plan,msg.winner,msg.registers??null);},

    async animate(plan,winner,registers){
      _cancelled.value=true;
      const token={value:false}; _cancelled=token;
      const speed=Math.max(1,Math.min(4,State.execSpeed??2));
      const aDelay=ACTION_DELAYS[speed-1], rDelay=REG_DELAYS[speed-1];
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const animSteps=plan.length-1;

      const isManual=State.execMode==='manual'&&State.isHost;
      if(isManual)Game.showAdvanceButton(true,false);

      const waitAdv=()=>new Promise(r=>{
        State.execAdvance=()=>{State.execAdvance=null;if(State.isHost){Game.showAdvanceButton(true,false);Net.broadcast({type:'EXEC_ADVANCE'});}r();};
        if(State.isHost)Game.showAdvanceButton(true,true);
      });

      State.execAnimating=true;
      Game.showExecPanel(registers);
      if(typeof Log!=='undefined')Log.add(`— Esecuzione round ${State.round} —`,{type:'event'});
      await wait(500);

      for(let reg=0;reg<plan.length;reg++){
        if(token.value) return;
        if(reg<animSteps){
          Game.highlightRegister(reg);
          if(typeof Log!=='undefined')Log.add(`── Registro P${reg+1} ──`,{type:'info'});
        }
        for(const action of plan[reg]){
          if(token.value) return;
          applyAction(action);
          // Azioni invisibili: nessun delay
          if(['deck_sync','damage_deck_sync','phase_marker','card_played'].includes(action.type)) continue;
          const vis=action.type==='move'||action.type==='rotate'||action.type==='fall'||action.type==='laser_beam';
          await wait(vis?aDelay:Math.max(60,aDelay*0.15));
        }
        if(token.value)return;
        if(reg<animSteps-1){
          if(State.execMode==='manual')await waitAdv();
          else await wait(rDelay);
        }
      }
      if(token.value)return;
      State.execAnimating=false; State.execAdvance=null;
      Game.showAdvanceButton(false,false);
      Game.hideExecPanel();
      onExecutionEnd(winner);
    },

    advance(){if(typeof State.execAdvance==='function')State.execAdvance();},

    skipToNextRound(){
      if(!State.isHost)return;
      _cancelled.value=true;State.execAnimating=false;State.execAdvance=null;
      Game.showAdvanceButton(false,false);Game.hideExecPanel();
      const pp=document.getElementById('prog-panel');if(pp)pp.style.display='none';
      onExecutionEnd(null);
    },
  };
})();
