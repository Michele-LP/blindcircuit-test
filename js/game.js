// ═══════════════════════════════════════════════════════════════════════════
//  GAME.JS — v6.8
//  MODIFICHE v6.8:
//  - Layout 2 colonne: rimosso #game-left, tutto in #game-side
//  - Cell size dinamico: calcolato in base allo spazio e alle celle della mappa
//  - Resize handler: ricalcola CELL e ridisegna al resize della finestra
// ═══════════════════════════════════════════════════════════════════════════

const Game = (() => {

  let CELL = CONFIG.cellSize;
  let SZ   = Math.round(CELL * 0.85);

  const LERP_BY_SPEED     = [0.07, 0.12, 0.18, 0.30];
  const SPRITE_ROT_OFFSET = -Math.PI / 2;

  const canvas = document.getElementById('canvas');
  const ctx    = canvas.getContext('2d');
  const anim   = {};
  const _robotImgs = {};
  const DIR_ANGLE  = { N: -Math.PI/2, E: 0, S: Math.PI/2, W: Math.PI };
  let _gameStartTime = null, _timerInterval = null;
  let _mapW = 12, _mapH = 12;  // NEW v6.8: dimensioni mappa correnti

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpAngle(a, b, t) {
    while (b - a > Math.PI) a += Math.PI * 2;
    while (a - b > Math.PI) b += Math.PI * 2;
    return a + (b - a) * t;
  }

  function initAnim(p) {
    if (!anim[p.id]) anim[p.id] = { renderX: p.cx*CELL, renderY: p.cy*CELL, renderAngle: DIR_ANGLE[p.dir]??0 };
  }

  // NEW v6.8: cell size dinamico — solo 2 colonne (canvas + pannello destro)
  function _computeCellSize(mapW, mapH) {
    const RW = 330;                              // larghezza pannello destro (max-width 310 + gap)
    const PAD = 36;                              // padding complessivo orizzontale
    const VP = 36;                               // padding verticale
    const availW = Math.max(300, window.innerWidth - RW - PAD);
    const availH = Math.max(300, window.innerHeight - VP);
    return Math.max(24, Math.min(Math.floor(availW / mapW), Math.floor(availH / mapH), 80));
  }

  // NEW v6.8: resize handler — ricalcola cell size e ridimensiona canvas
  let _resizeTimer = null;
  function _onResize() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      if (State.phase !== 'game') return;
      const newCELL = _computeCellSize(_mapW, _mapH);
      if (newCELL === CELL) return;
      CELL = newCELL;
      SZ = Math.round(CELL * 1);
      Board.CELL = CELL;
      Board.W = _mapW * CELL;
      Board.H = _mapH * CELL;
      Board._cache = null;  // forza rebuild
      canvas.width = Board.W;
      canvas.height = Board.H;
      // ricalcola posizioni anim
      for (const p of Object.values(State.players)) {
        if (p.cx === undefined) continue;
        const a = anim[p.id];
        if (a) { a.renderX = p.cx * CELL; a.renderY = p.cy * CELL; }
      }
    }, 150);
  }
  window.addEventListener('resize', _onResize);


  function preloadRobotSprites() {
    for (const c of CONFIG.characters) { if (!c.sprite||_robotImgs[c.id])continue; const i=new Image();i.src=c.sprite;_robotImgs[c.id]=i; }
  }

  function setPanels(showProg, showExec) {
    const pp=document.getElementById('prog-panel'), ep=document.getElementById('exec-panel');
    if(pp) pp.style.display=showProg?'flex':'none';
    if(ep) ep.style.display=showExec?'flex':'none';
  }

  function _makeRobotImg(char, cls) {
    if (char?.sprite) {
      const i=document.createElement('img'); i.className=cls; i.src=char.sprite; i.alt=char?.name??'';
      i.onerror=function(){this.style.display='none';const f=document.createElement('span');f.className=cls.replace('-img','-emoji');f.textContent=char.emoji;this.parentElement?.appendChild(f);};
      return i;
    }
    const e=document.createElement('span');e.className=cls.replace('-img','-emoji');e.textContent=char?.emoji??'🤖';return e;
  }

  function _startTimer() {
    _gameStartTime=Date.now(); if(_timerInterval)clearInterval(_timerInterval);
    const el=document.getElementById('game-timer');
    const tick=()=>{if(!el)return;const s=Math.floor((Date.now()-_gameStartTime)/1000);const h=Math.floor(s/3600),m=String(Math.floor((s%3600)/60)).padStart(2,'0'),ss=String(s%60).padStart(2,'0');el.textContent=h>0?`⏱ ${h}:${m}:${ss}`:`⏱ ${m}:${ss}`;};
    tick(); _timerInterval=setInterval(tick,1000);
  }
  function _stopTimer(){if(_timerInterval){clearInterval(_timerInterval);_timerInterval=null;}}

  function _updateSpectatorBadge() {
    let el=document.getElementById('spectator-badge');
    if (!el) { el=document.createElement('div');el.id='spectator-badge';el.className='spectator-badge';
      const gs=document.getElementById('game-side'); if(gs)gs.insertBefore(el,gs.firstChild); }
    const n=State.spectatorCount||0;
    if (State.isSpectator) { el.textContent='👁 Modalità spettatore'; el.style.display='block'; }
    else if (n>0) { el.textContent=`👁 ${n} spettator${n===1?'e':'i'}`; el.style.display='block'; }
    else { el.style.display='none'; }
  }

  return {

    init(mapData, settings = {}) {
      if(settings.execMode!==undefined)State.execMode=settings.execMode;
      if(settings.execSpeed!==undefined)State.execSpeed=settings.execSpeed;
      if(settings.damageDeck){State.damageDeck=settings.damageDeck;State.damageDiscard=[];}

      // NEW v6.8: salva dimensioni mappa per resize handler
      _mapW=mapData?.width??12; _mapH=mapData?.height??12;
      CELL=_computeCellSize(_mapW,_mapH); SZ=Math.round(CELL*1);
      Board.CELL=CELL; Board.load(mapData); Board.preloadImages(); preloadRobotSprites();

      State.phase='game'; State.round=0; State.execAnimating=false;
      canvas.width=Board.W; canvas.height=Board.H;

      // v6.8: no maxHeight constraints — pannello destro usa calc(100vh) via CSS

      State.getPlayerList().forEach((p,i)=>{
        const sp=Board.startPos(i);
        p.cx=sp.x;p.cy=sp.y;p.dir=sp.dir??'N';
        p.energy=p.energy??CONFIG.startingEnergy;
        p.lastCheckpoint=0;p.checkpoints=[];p.wormSlots=p.wormSlots??{};
        initAnim(p);
      });

      State.energyToken=State.getPlayerList()[0]?.id??null;

      this._buildHud(); _updateSpectatorBadge();
      document.getElementById('game-code').textContent=State.roomCode;

      const advBtn=document.getElementById('btn-advance');
      if(advBtn){advBtn.style.display='none';advBtn.disabled=true;advBtn.onclick=()=>Execution.advance();}
      const skipBtn=document.getElementById('btn-skip-round');
      if(skipBtn)skipBtn.style.display='none';

      if(typeof Log!=='undefined'){Log.clear();Log.add('Partita iniziata',{type:'event'});}
      _startTimer();
      // v6.8.2: avvia sistema audio e musica background
      if(typeof Audio!=='undefined'){ Audio.init(); Audio.startBg(); }


      setPanels(false,false); Cards.preload(); UI.show('game');
      // v6.9 U1: tooltip cella al passaggio mouse
      this._initCanvasTooltip();
      // v6.9 U2: zoom mappa con scroll
      this._initZoom();
      requestAnimationFrame(()=>this._loop());

      // Solo l'host inizia il primo round (lo spettatore non fa nulla)
      if(State.isHost){
        setTimeout(()=>{
          State.round=1;
          const ws={};for(const p of State.getPlayerList())ws[p.id]={};
          Net.sendToAll({type:'ROUND_START',round:State.round,timerSec:0,wormSlots:ws});
        },1000);
      } else if (!State.isSpectator) {
        setInterval(()=>{if(State.phase==='game')Net.send({type:'REQUEST_SYNC'});},2500);
      } else {
        // Spettatore: polling meno frequente
        setInterval(()=>{if(State.phase==='game')Net.send({type:'REQUEST_SYNC'});},3000);
      }
    },

    _loop() {
      this._updateAnim(); this._render();
      requestAnimationFrame(()=>this._loop());
    },

    _updateAnim() {
      const sp=Math.max(1,Math.min(4,State.execSpeed??2)), L=LERP_BY_SPEED[sp-1];
      for (const p of Object.values(State.players)) {
        if(p.cx===undefined)continue; initAnim(p);
        const a=anim[p.id];
        // ── Snap anim: teletrasporto istantaneo (dopo caduta nel buco) ─────
        if (p._snapAnim) {
          a.renderX=p.cx*CELL; a.renderY=p.cy*CELL;
          a.renderAngle=DIR_ANGLE[p.dir]??0;
          p._snapAnim=false;
        } else {
          a.renderX=lerp(a.renderX,p.cx*CELL,L);
          a.renderY=lerp(a.renderY,p.cy*CELL,L);
          a.renderAngle=lerpAngle(a.renderAngle,DIR_ANGLE[p.dir]??0,L);
        }
      }
    },

    _render() {
      Board.render(ctx);
      for (const p of Object.values(State.players)) {
        if(p.cx===undefined)continue;
        if(p.rebooting) continue;   // v6.9 B5: robot in reboot non visibile sulla mappa
        const a=anim[p.id]; if(a)this._drawRobot(p,a.renderX,a.renderY,a.renderAngle);
      }
      this._drawBeams();
      this._updateHudSubs();
    },

    // ── Raggi laser visivi (v6.7.1) ─────────────────────────────────────
    // Disegna i raggi laser attivi come linee sfumanti con glow.
    // I raggi vengono aggiunti da execution.js → applyAction('laser_beam')
    // e si dissolvono automaticamente dopo BEAM_DURATION_MS.
    _drawBeams() {
      const beams = State._activeBeams;
      if (!beams || !beams.length) return;
      const BEAM_DURATION_MS = 600;
      const now = performance.now();
      // Filtra raggi scaduti
      State._activeBeams = beams.filter(b => now - b.t < BEAM_DURATION_MS);
      for (const b of State._activeBeams) {
        const progress = (now - b.t) / BEAM_DURATION_MS;
        const alpha = Math.max(0, 1 - progress);
        const halfCell = CELL / 2;
        const x1 = b.fromCx * CELL + halfCell;
        const y1 = b.fromCy * CELL + halfCell;
        const x2 = b.toCx   * CELL + halfCell;
        const y2 = b.toCy   * CELL + halfCell;
        // Glow
        ctx.save();
        ctx.globalAlpha = alpha * 0.3;
        ctx.strokeStyle = b.color;
        ctx.lineWidth   = CELL * 0.25;
        ctx.lineCap     = 'round';
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
        // Raggio principale
        ctx.globalAlpha = alpha * 0.85;
        ctx.strokeStyle = b.color;
        ctx.lineWidth   = CELL * 0.08;
        ctx.shadowColor = b.color;
        ctx.shadowBlur  = 8;
        ctx.setLineDash([CELL * 0.15, CELL * 0.08]);
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
        ctx.restore();
      }
    },

    _drawRobot(p,rx,ry,angle) {
      const isMe=p.id===State.myId;
      const char=CONFIG.characters.find(c=>c.id===p.character);
      const col=char?.color??'#6b7280';
      const cx=rx+CELL/2,cy=ry+CELL/2,half=SZ/2;
      const spr=char?_robotImgs[char.id]:null;
      if(spr&&spr.complete&&spr.naturalWidth>0){
        ctx.save();ctx.translate(cx,cy);ctx.rotate(angle+SPRITE_ROT_OFFSET);ctx.drawImage(spr,-half,-half,SZ,SZ);ctx.restore();
        if(isMe){ctx.save();ctx.translate(cx,cy);ctx.rotate(angle+SPRITE_ROT_OFFSET);this._rrect(ctx,-half,-half,SZ,SZ,6);ctx.strokeStyle='rgba(255,255,255,0.85)';ctx.lineWidth=2;ctx.stroke();ctx.restore();}
      } else {
        ctx.save();ctx.translate(cx,cy);ctx.rotate(angle);this._rrect(ctx,-half,-half,SZ,SZ,6);ctx.fillStyle=col;ctx.fill();
        ctx.fillStyle='rgba(255,255,255,0.9)';ctx.beginPath();ctx.moveTo(0,-half+4);ctx.lineTo(-6,-half+14);ctx.lineTo(6,-half+14);ctx.closePath();ctx.fill();
        if(isMe){this._rrect(ctx,-half,-half,SZ,SZ,6);ctx.strokeStyle='rgba(255,255,255,0.7)';ctx.lineWidth=2;ctx.stroke();}
        ctx.restore();
      }
      // v6.9 U3: freccia direzione — triangolino davanti al robot
      {
        const arrSz=Math.max(4,CELL*0.16);
        ctx.save(); ctx.translate(cx,cy); ctx.rotate(angle);
        ctx.beginPath(); ctx.moveTo(half+arrSz*0.4,0); ctx.lineTo(half-arrSz*0.5,-arrSz*0.55); ctx.lineTo(half-arrSz*0.5,arrSz*0.55); ctx.closePath();
        ctx.fillStyle=col; ctx.globalAlpha=0.85; ctx.fill();
        ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=0.8; ctx.stroke();
        ctx.restore();
      }
      // v6.8.1: solo nickname sopra il robot, energie spostate nell'HUD laterale
      ctx.fillStyle=isMe?'#e6edf3':'#9ca3af';
      ctx.font=`bold ${Math.max(9,Math.round(CELL*0.2))}px system-ui`;ctx.textAlign='center';ctx.textBaseline='bottom';
      ctx.fillText((p.nickname||'?').substring(0,8),cx,ry-2);
      const cps=p.checkpoints??[];
      if(cps.length){ctx.textBaseline='top';ctx.font=`${Math.round(CELL*0.2)}px system-ui`;ctx.fillText('★'.repeat(cps.length),cx,ry+SZ+3);}
    },

    _rrect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();},

    _buildHud() {
      const hud=document.getElementById('game-hud');if(!hud)return;hud.innerHTML='';
      for(const p of State.getPlayerList()){
        const char=CONFIG.characters.find(c=>c.id===p.character),color=char?.color??'#6b7280',isMe=p.id===State.myId;
        const card=document.createElement('div');card.className='hud-card'+(isMe?' is-me':'');card.dataset.pid=p.id;
        card.dataset.tooltip=`${p.nickname||'?'}${isMe?' (tu)':''}\n${char?.name??''}`;card.dataset.tooltipColor=color;
        const wrap=document.createElement('div');wrap.className='hud-robot-wrap';wrap.style.cssText=`background:${color}22;border:1px solid ${color}55;`;
        wrap.appendChild(_makeRobotImg(char,'hud-robot-img'));
        const info=document.createElement('div');info.className='hud-info';
        const nm=document.createElement('div');nm.className='hud-name';nm.id=`hud-name-${p.id}`;
        nm.textContent=(p.nickname||'?').substring(0,8)+(isMe?' (tu)':'');
        const sub=document.createElement('div');sub.className='hud-sub';sub.id=`hud-sub-${p.id}`;
        sub.textContent=`⚡${p.energy??CONFIG.startingEnergy}`;
        info.appendChild(nm);info.appendChild(sub);
        // v6.8.1: icona conferma programmazione (⏳/✅), aggiornata da Cards.updateOthersStatus()
        const conf=document.createElement('span');conf.className='hud-conf';conf.id=`hud-conf-${p.id}`;
        card.appendChild(wrap);card.appendChild(info);card.appendChild(conf);hud.appendChild(card);
      }
    },

    _updateHudSubs() {
      for(const p of State.getPlayerList()){
        const el=document.getElementById(`hud-sub-${p.id}`);if(!el)continue;
        const cp=(p.checkpoints??[]).length,ws=Object.values(p.wormSlots??{}).filter(Boolean).length;
        el.textContent=`⚡${p.energy??CONFIG.startingEnergy}${cp>0?' '+'★'.repeat(cp):''}${ws>0?' 🦠'+ws:''}`;
      }
    },

    enterProgramming(){
      setPanels(true,false);this.showAdvanceButton(false,false);
      if(typeof Audio!=='undefined') Audio.play('round_start');
    },
    showExecPanel(registers){
      // v6.8.1: pulisci icone conferma dall'HUD
      document.querySelectorAll('.hud-conf').forEach(e=>e.textContent='');
      setPanels(false,true);
      const ep=document.getElementById('exec-panel');if(!ep)return;ep.innerHTML='';
      const title=document.createElement('div');title.id='exec-panel-title';title.textContent='— In esecuzione —';ep.appendChild(title);
      for(const p of State.getPlayerList()){
        const regs=registers?.[p.id]??[],char=CONFIG.characters.find(c=>c.id===p.character),color=char?.color??'#6b7280',isMe=p.id===State.myId;
        const row=document.createElement('div');row.className='exec-player-row'+(isMe?' is-me':'');
        const ne=document.createElement('div');ne.className='exec-player-name';ne.style.color=color;ne.textContent=(p.nickname||'?').substring(0,9)+(isMe?' ◀':'');row.appendChild(ne);
        const re=document.createElement('div');re.className='exec-registers';
        for(let i=0;i<CONFIG.registersCount;i++){
          const cid=regs[i]??null,isW=typeof cid==='string'&&cid.startsWith('worm_');
          const def=CONFIG.cards.find(c=>c.id===cid);
          const wd=isW&&typeof RULES!=='undefined'?(RULES?.worms??[]).find(w=>w.id===cid):null;
          const sl=document.createElement('div');sl.className='exec-card-slot';sl.id=`exec-slot-${p.id}-${i}`;
          sl.dataset.tooltip=isW?`WORM: ${wd?.name??cid}`:(def?`${def.name}: ${def.desc}`:'(vuoto)');
          if(isW){sl.style.background=`${wd?.color??'#ef4444'}22`;sl.style.borderColor=wd?.color??'#ef4444';
            const sy=document.createElement('span');sy.style.cssText='font-size:0.9rem;position:absolute;top:50%;left:50%;transform:translate(-50%,-60%)';sy.textContent=wd?.symbol??'🦠';sl.appendChild(sy);
          } else if(def?.image){sl.style.backgroundImage=`url('${def.image}')`;sl.style.backgroundSize='contain';sl.style.backgroundRepeat='no-repeat';sl.style.backgroundPosition='center';}
          const ab=document.createElement('span');ab.className='card-abbr';ab.textContent=isW?(wd?.name??'WORM').substring(0,6).toUpperCase():(def?.name??(cid?'?':'—')).substring(0,6).toUpperCase();
          sl.appendChild(ab);re.appendChild(sl);
        }
        row.appendChild(re);ep.appendChild(row);
      }
    },
    highlightRegister(si){
      document.querySelectorAll('.exec-card-slot').forEach(e=>e.classList.remove('exec-active'));
      for(const p of State.getPlayerList()){const s=document.getElementById(`exec-slot-${p.id}-${si}`);if(s)s.classList.add('exec-active');}
      const t=document.getElementById('exec-panel-title');if(t)t.textContent=`Registro P${si+1} di ${CONFIG.registersCount}`;
    },
    hideExecPanel(){setPanels(false,false);this.showAdvanceButton(false,false);},
    showAdvanceButton(v,en=true){const b=document.getElementById('btn-advance');if(b){b.style.display=v?'inline-flex':'none';b.disabled=!en;}},

    // v6.9 U1: tooltip cella al passaggio mouse sul canvas
    _initCanvasTooltip(){
      let _tipEl=document.getElementById('canvas-cell-tooltip');
      if(!_tipEl){_tipEl=document.createElement('div');_tipEl.id='canvas-cell-tooltip';_tipEl.className='canvas-tooltip';document.body.appendChild(_tipEl);}
      let _lastKey='';
      canvas.addEventListener('mousemove',(e)=>{
        const rect=canvas.getBoundingClientRect();
        const scaleX=canvas.width/rect.width, scaleY=canvas.height/rect.height;
        const mx=(e.clientX-rect.left)*scaleX, my=(e.clientY-rect.top)*scaleY;
        const cellX=Math.floor(mx/CELL), cellY=Math.floor(my/CELL);
        const key=`${cellX},${cellY}`;
        if(key===_lastKey&&_tipEl.style.display==='block'){{_tipEl.style.left=(e.clientX+14)+'px';_tipEl.style.top=(e.clientY+14)+'px';}return;}
        _lastKey=key;
        if(!Board.inBounds(cellX,cellY)){_tipEl.style.display='none';return;}
        const desc=Board.cellDescription(cellX,cellY);
        if(!desc){_tipEl.style.display='none';return;}
        _tipEl.textContent=desc;_tipEl.style.display='block';
        _tipEl.style.left=(e.clientX+14)+'px';_tipEl.style.top=(e.clientY+14)+'px';
      });
      canvas.addEventListener('mouseleave',()=>{_tipEl.style.display='none';_lastKey='';});
    },

    // v6.9 U2: zoom mappa con scroll/pinch
    _initZoom(){
      const wrapper=canvas.parentElement; if(!wrapper)return;
      let _scale=1, _panX=0, _panY=0, _dragging=false, _dragStart={x:0,y:0};
      const MIN_ZOOM=0.5, MAX_ZOOM=3;
      const _apply=()=>{canvas.style.transform=`scale(${_scale}) translate(${_panX}px, ${_panY}px)`;canvas.style.transformOrigin='0 0';};
      // Scroll zoom
      wrapper.addEventListener('wheel',(e)=>{
        e.preventDefault();
        const delta=e.deltaY>0?-0.1:0.1;
        _scale=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,_scale+delta));
        if(Math.abs(_scale-1)<0.05){_scale=1;_panX=0;_panY=0;}
        _apply();
      },{passive:false});
      // Pan con drag (solo quando zoomato)
      wrapper.addEventListener('mousedown',(e)=>{if(_scale<=1)return;_dragging=true;_dragStart={x:e.clientX-_panX,y:e.clientY-_panY};wrapper.style.cursor='grabbing';});
      window.addEventListener('mousemove',(e)=>{if(!_dragging)return;_panX=e.clientX-_dragStart.x;_panY=e.clientY-_dragStart.y;_apply();});
      window.addEventListener('mouseup',()=>{_dragging=false;wrapper.style.cursor='';});
      // Doppio click: reset zoom
      wrapper.addEventListener('dblclick',()=>{_scale=1;_panX=0;_panY=0;_apply();});
      // Touch: pinch zoom
      let _lastTouchDist=0;
      wrapper.addEventListener('touchstart',(e)=>{
        if(e.touches.length===2){
          const dx=e.touches[0].clientX-e.touches[1].clientX;
          const dy=e.touches[0].clientY-e.touches[1].clientY;
          _lastTouchDist=Math.sqrt(dx*dx+dy*dy);
        }
      },{passive:true});
      wrapper.addEventListener('touchmove',(e)=>{
        if(e.touches.length===2){
          e.preventDefault();
          const dx=e.touches[0].clientX-e.touches[1].clientX;
          const dy=e.touches[0].clientY-e.touches[1].clientY;
          const dist=Math.sqrt(dx*dx+dy*dy);
          if(_lastTouchDist>0){const d=(dist-_lastTouchDist)*0.005;_scale=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,_scale+d));}
          _lastTouchDist=dist;_apply();
        }
      },{passive:false});
      wrapper.addEventListener('touchend',()=>{_lastTouchDist=0;},{passive:true});
    },

    handleMessage(fromId,msg){
      if(msg.type==='REQUEST_SYNC'&&State.isHost){
        const pos={};
        for(const[id,p]of Object.entries(State.players)){if(p.cx===undefined)continue;
          pos[id]={cx:p.cx,cy:p.cy,dir:p.dir,energy:p.energy,checkpoints:p.checkpoints??[],lastCheckpoint:p.lastCheckpoint??0,wormSlots:p.wormSlots??{}};}
        Net.sendTo(fromId,{type:'SYNC_STATE',positions:pos,spectatorCount:State.spectatorCount});return;
      }
      if(msg.type==='SYNC_STATE'){
        if(State.execAnimating)return;
        for(const[id,pos]of Object.entries(msg.positions??{})){
          const p=State.players[id];if(!p)continue;
          p.cx=pos.cx;p.cy=pos.cy;p.dir=pos.dir;
          if(pos.energy!==undefined)p.energy=pos.energy;
          if(pos.checkpoints!==undefined)p.checkpoints=pos.checkpoints;
          if(pos.lastCheckpoint!==undefined)p.lastCheckpoint=pos.lastCheckpoint;
          if(pos.wormSlots!==undefined)p.wormSlots=pos.wormSlots;
        }
        if(msg.spectatorCount!==undefined){State.spectatorCount=msg.spectatorCount;_updateSpectatorBadge();}
        return;
      }
      if(msg.type==='SPECTATOR_COUNT'){State.spectatorCount=msg.count;_updateSpectatorBadge();return;}
      if(msg.type==='EXEC_ADVANCE'){if(!State.isHost)Execution.advance();return;}
      if(msg.type==='MOVE'){const p=State.players[msg.from??fromId];if(p){p.cx=msg.cx;p.cy=msg.cy;p.dir=msg.dir??p.dir;}return;}
      Cards.handleGameMessage(fromId,msg);
    },

    stopTimer(){_stopTimer();},
  };
})();
