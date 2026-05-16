// ═══════════════════════════════════════════════════════════════════════════
//  GAME.JS — v6.7
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

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpAngle(a, b, t) {
    while (b - a > Math.PI) a += Math.PI * 2;
    while (a - b > Math.PI) b += Math.PI * 2;
    return a + (b - a) * t;
  }

  function initAnim(p) {
    if (!anim[p.id]) anim[p.id] = { renderX: p.cx*CELL, renderY: p.cy*CELL, renderAngle: DIR_ANGLE[p.dir]??0 };
  }

  function _computeCellSize(mapW, mapH) {
    const LW=180+12, RW=260+16, HP=80, VP=40;
    const sW=window.innerWidth-HP, sH=window.innerHeight-VP, mCW=1400-HP;
    const aW=Math.max(300,Math.min(sW,mCW)-LW-RW), aH=Math.max(300,sH);
    return Math.max(36, Math.min(Math.floor(aW/mapW), Math.floor(aH/mapH), 80));
  }

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
      const gl=document.getElementById('game-left'); if(gl)gl.insertBefore(el,gl.firstChild); }
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

      const mapW=mapData?.width??12, mapH=mapData?.height??12;
      CELL=_computeCellSize(mapW,mapH); SZ=Math.round(CELL*1);
      Board.CELL=CELL; Board.load(mapData); Board.preloadImages(); preloadRobotSprites();

      State.phase='game'; State.round=0; State.execAnimating=false;
      canvas.width=Board.W; canvas.height=Board.H;

      const gl=document.getElementById('game-left'); if(gl)gl.style.maxHeight=`${Board.H}px`;
      const gs=document.getElementById('game-side'); if(gs)gs.style.maxHeight=`${Board.H}px`;

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

      setPanels(false,false); Cards.preload(); UI.show('game');
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
      ctx.save();ctx.fillStyle='rgba(0,0,0,0.4)';ctx.beginPath();ctx.ellipse(cx,cy+half+3,half-2,4,0,0,Math.PI*2);ctx.fill();ctx.restore();
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
      ctx.fillStyle=isMe?'#e6edf3':'#9ca3af';
      ctx.font=`bold ${Math.max(9,Math.round(CELL*0.2))}px system-ui`;ctx.textAlign='center';ctx.textBaseline='bottom';
      ctx.fillText((p.nickname||'?').substring(0,8)+(p.energy!=null?` ⚡${p.energy}`:''),cx,ry-2);
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
        const nm=document.createElement('div');nm.className='hud-name';nm.textContent=(p.nickname||'?').substring(0,10)+(isMe?' (tu)':'');
        const sub=document.createElement('div');sub.className='hud-sub';sub.id=`hud-sub-${p.id}`;sub.textContent=`⚡${p.energy??CONFIG.startingEnergy}`;
        info.appendChild(nm);info.appendChild(sub);card.appendChild(wrap);card.appendChild(info);hud.appendChild(card);
      }
    },

    _updateHudSubs() {
      for(const p of State.getPlayerList()){
        const el=document.getElementById(`hud-sub-${p.id}`);if(!el)continue;
        const cp=(p.checkpoints??[]).length,ws=Object.values(p.wormSlots??{}).filter(Boolean).length;
        el.textContent=`⚡${p.energy??CONFIG.startingEnergy}${cp>0?' '+'★'.repeat(cp):''}${ws>0?' 🦠'+ws:''}`;
      }
    },

    enterProgramming(){setPanels(true,false);this.showAdvanceButton(false,false);},
    showExecPanel(registers){
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
