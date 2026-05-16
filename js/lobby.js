// ═══════════════════════════════════════════════════════════════════════════
//  LOBBY.JS — v6.7
//
//  NOVITÀ v6.7:
//  ─ SPECTATOR_INIT: se ci si connette a partita avviata, l'host invia
//    lo stato del gioco. Il client entra in modalità spettatore (sola lettura).
//  ─ REJECTED: se la lobby è piena, l'host rifiuta la connessione.
// ═══════════════════════════════════════════════════════════════════════════

const Lobby = {

  _gridBuilt: false,

  init() {
    State.phase='lobby';
    document.getElementById('lobby-code').textContent=State.roomCode;
    document.getElementById('game-code').textContent=State.roomCode;
    document.getElementById('nickname-input').value='';
    document.getElementById('ready-text').textContent='Non pronto';
    document.getElementById('btn-ready').classList.remove('is-ready');
    const bs=document.getElementById('btn-start');
    bs.style.display=State.isHost?'inline-flex':'none';bs.disabled=true;
    this._gridBuilt=false;
    this._renderCharacterGrid();this.renderPlayerList();this._initGameSettings();
    UI.show('lobby');
  },

  _initGameSettings() {
    const el=document.getElementById('game-settings');if(!el)return;
    el.style.display=State.isHost?'flex':'none'; if(!State.isHost)return;

    // Selettore mappa
    const mapSel=document.getElementById('map-select');
    if(mapSel && CONFIG.availableMaps){
      mapSel.innerHTML='';
      for(const m of CONFIG.availableMaps){
        const o=document.createElement('option');o.value=m.id;o.textContent=m.name;
        if(m.id===CONFIG.defaultMap)o.selected=true;
        mapSel.appendChild(o);
      }
      mapSel.addEventListener('change',()=>{ State.selectedMap=mapSel.value; });
      State.selectedMap=CONFIG.defaultMap;
    }

    el.querySelectorAll('[data-exec-mode]').forEach(b=>{
      b.classList.toggle('active',b.dataset.execMode===(State.execMode??'auto'));
      b.addEventListener('click',()=>{State.execMode=b.dataset.execMode;el.querySelectorAll('[data-exec-mode]').forEach(x=>x.classList.remove('active'));b.classList.add('active');});
    });
    el.querySelectorAll('[data-exec-speed]').forEach(b=>{
      b.classList.toggle('active',Number(b.dataset.execSpeed)===(State.execSpeed??2));
      b.addEventListener('click',()=>{State.execSpeed=Number(b.dataset.execSpeed);el.querySelectorAll('[data-exec-speed]').forEach(x=>x.classList.remove('active'));b.classList.add('active');});
    });
  },

  _buildDamageDeck() {
    const comp=(typeof RULES!=='undefined')?(RULES?.damage?.damageDeck??{}):{};
    const d=[];for(const[t,q]of Object.entries(comp))for(let i=0;i<q;i++)d.push(t);
    return this._shuffle(d);
  },

  _shuffle(a){const r=[...a];for(let i=r.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[r[i],r[j]]=[r[j],r[i]];}return r;},

  handleMessage(fromId, msg) {
    switch (msg.type) {

      // ── Connessione rifiutata (lobby piena) ─────────────────────────────
      case 'REJECTED':
        alert(msg.reason || 'Connessione rifiutata.');
        UI.goToMenu();
        break;

      // ── Spettatore: partita già avviata ─────────────────────────────────
      case 'SPECTATOR_INIT': {
        State.isSpectator = true;
        State.players     = msg.players ?? {};
        // Applica posizioni correnti
        for (const [id, pos] of Object.entries(msg.positions ?? {})) {
          const p = State.players[id];
          if (!p) continue;
          Object.assign(p, pos);
        }
        if (msg.round) State.round = msg.round;
        if (msg.damageDeck) { State.damageDeck = msg.damageDeck; State.damageDiscard = []; }
        if (typeof Toast !== 'undefined')
          Toast.show('👁 Sei in modalità spettatore', { duration: 4000 });
        Game.init(msg.mapData, {
          execMode:   msg.execMode,
          execSpeed:  msg.execSpeed,
          damageDeck: msg.damageDeck,
        });
        break;
      }

      case 'LOBBY_STATE': {
        State.players=msg.players;
        if(!State.players[State.myId]){
          State.players[State.myId]={id:State.myId,nickname:'',character:null,ready:false,isHost:false,joinOrder:msg.assignedJoinOrder};
        } else { State.players[State.myId].joinOrder=msg.assignedJoinOrder; }
        this.renderPlayerList();this._updateCharacterGrid();this._broadcastMyUpdate();
        break;
      }

      case 'PLAYER_JOINED':
        State.players[msg.player.id]=msg.player;
        this.renderPlayerList();this._updateCharacterGrid();this._updateLobbyStatus();
        break;

      case 'PLAYER_UPDATE': {
        const id=msg.from??fromId;
        if(!State.players[id])State.players[id]={id,joinOrder:99,isHost:false};
        Object.assign(State.players[id],{nickname:msg.nickname,character:msg.character,ready:msg.ready});
        this.renderPlayerList();this._updateCharacterGrid();
        this._updateStartButton();this._updateLobbyStatus();
        break;
      }

      case 'PLAYER_LEFT':
        delete State.players[msg.id];
        this.renderPlayerList();this._updateCharacterGrid();
        this._updateStartButton();this._updateLobbyStatus();
        break;

      case 'GAME_START':
        if(msg.execMode!==undefined)State.execMode=msg.execMode;
        if(msg.execSpeed!==undefined)State.execSpeed=msg.execSpeed;
        if(msg.damageDeck){State.damageDeck=msg.damageDeck;State.damageDiscard=[];}
        if(typeof Log!=='undefined')Log.add('Partita iniziata',{type:'event'});
        Game.init(msg.mapData,{execMode:msg.execMode,execSpeed:msg.execSpeed,damageDeck:msg.damageDeck});
        break;

      case 'HOST_DISCONNECTED':
        alert('L\'host si è disconnesso.');UI.goToMenu();break;
    }
  },

  renderPlayerList() {
    const list=document.getElementById('player-list');list.innerHTML='';
    const pls=State.getPlayerList();
    for(const p of pls){
      const isMe=p.id===State.myId,char=CONFIG.characters.find(c=>c.id===p.character),color=char?.color??'#4b5563';
      const row=document.createElement('div');row.className=['player-row',p.ready?'ready':'',isMe?'is-me':''].join(' ').trim();
      const av=document.createElement('div');av.className='player-avatar';av.style.background=color;
      if(char?.sprite){const i=document.createElement('img');i.className='avatar-bot-img';i.src=char.sprite;i.alt=char.name;i.onerror=function(){this.style.display='none';av.textContent=char.emoji;};av.appendChild(i);}
      else av.textContent=char?.emoji??'🤖';
      row.appendChild(av);
      const info=document.createElement('div');info.className='player-info';
      info.innerHTML=`<span class="player-name">${this._esc(p.nickname||'(senza nome)')} ${p.isHost?'<span class="host-badge">HOST</span>':''}</span><span class="player-char">${char?.name??'Nessun personaggio'}</span>`;
      row.appendChild(info);
      const ri=document.createElement('div');ri.className='ready-indicator';ri.textContent=p.ready?'✅ Pronto':'⏳ Attesa';
      row.appendChild(ri);list.appendChild(row);
    }
    const free=CONFIG.maxPlayers-pls.length;
    for(let i=0;i<Math.min(free,2);i++){const r=document.createElement('div');r.className='player-row empty';r.innerHTML='<div class="empty-slot">In attesa di giocatori…</div>';list.appendChild(r);}
  },

  _renderCharacterGrid() {
    const grid=document.getElementById('character-grid');grid.innerHTML='';
    for(const char of CONFIG.characters){
      const btn=document.createElement('button');btn.className='char-btn';btn.dataset.charId=char.id;
      btn.style.setProperty('--char-color',char.color);
      const sw=document.createElement('div');sw.className='char-sprite-wrap';
      if(char.sprite){const i=document.createElement('img');i.className='char-sprite-img';i.src=char.sprite;i.alt=char.name;i.draggable=false;
        i.onerror=function(){this.style.display='none';const e=document.createElement('span');e.className='char-emoji';e.textContent=char.emoji;sw.appendChild(e);};sw.appendChild(i);
      } else {const e=document.createElement('span');e.className='char-emoji';e.textContent=char.emoji;sw.appendChild(e);}
      const ns=document.createElement('span');ns.className='char-name';ns.textContent=char.name;
      btn.appendChild(sw);btn.appendChild(ns);
      btn.addEventListener('click',()=>{if(!btn.disabled)this._selectCharacter(char.id);});
      grid.appendChild(btn);
    }
    this._gridBuilt=true; this._updateCharacterGrid();
  },

  _updateCharacterGrid() {
    if(!this._gridBuilt)return this._renderCharacterGrid();
    const myC=State.myPlayer()?.character;
    document.querySelectorAll('.char-btn').forEach(btn=>{
      const cid=btn.dataset.charId,ch=CONFIG.characters.find(c=>c.id===cid);
      const tk=Object.values(State.players).find(p=>p.character===cid&&p.id!==State.myId);
      btn.classList.toggle('taken',!!tk);btn.classList.toggle('selected',myC===cid);
      btn.disabled=!!tk;
      btn.dataset.tooltip=tk?`${ch?.name}\nScelto da: ${tk.nickname||'(senza nome)'}`:ch?.name??'';
      btn.dataset.tooltipColor=ch?.color??'#1f6feb';
    });
  },

  _selectCharacter(cid){const me=State.myPlayer();if(!me)return;me.character=cid;this._updateCharacterGrid();this._broadcastMyUpdate();},

  onNicknameChange(v){const me=State.myPlayer();if(me)me.nickname=v.trim();},
  onNicknameBlur(){this._broadcastMyUpdate();this.renderPlayerList();},

  toggleReady(){
    const me=State.myPlayer();if(!me)return;
    if(!me.character){alert('Seleziona prima un personaggio!');return;}
    if(!me.nickname.trim()){alert('Inserisci prima il tuo nickname!');return;}
    me.ready=!me.ready;
    document.getElementById('btn-ready').classList.toggle('is-ready',me.ready);
    document.getElementById('ready-text').textContent=me.ready?'✅ Pronto':'Non pronto';
    this._broadcastMyUpdate();this._updateStartButton();this.renderPlayerList();
  },

  _broadcastMyUpdate(){const me=State.myPlayer();if(!me)return;Net.sendToAll({type:'PLAYER_UPDATE',nickname:me.nickname,character:me.character,ready:me.ready});},
  _updateStartButton(){const b=document.getElementById('btn-start');if(!b||!State.isHost)return;b.disabled=!State.allReady();},
  _updateLobbyStatus(){const c=Object.keys(State.players).length,r=Object.values(State.players).filter(p=>p.ready).length;const s=document.getElementById('lobby-status');if(s)s.textContent=`${r}/${c} pronti`;},

  startGame(){
    if(!State.isHost||!State.allReady())return;
    const settings={execMode:State.execMode,execSpeed:State.execSpeed};
    const dd=this._buildDamageDeck();State.damageDeck=dd;State.damageDiscard=[];
    // Cerca il file della mappa selezionata
    const mapId=State.selectedMap||CONFIG.defaultMap;
    const mapDef=CONFIG.availableMaps?.find(m=>m.id===mapId);
    const paths=mapDef
      ? [mapDef.file, `assets/maps/${mapId}.json`, `${mapId}.json`]
      : [`assets/maps/${mapId}.json`, `${mapId}.json`];
    const tryFetch=(ps)=>{
      if(!ps.length){Net.broadcast({type:'GAME_START',mapData:null,damageDeck:dd,...settings});Game.init(null,{...settings,damageDeck:dd});return;}
      fetch(ps[0]).then(r=>{if(!r.ok)throw 0;return r.json();})
        .then(md=>{Net.broadcast({type:'GAME_START',mapData:md,damageDeck:dd,...settings});Game.init(md,{...settings,damageDeck:dd});})
        .catch(()=>tryFetch(ps.slice(1)));
    };
    tryFetch(paths);
  },

  _esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');},
};

document.addEventListener('DOMContentLoaded',()=>{
  const ni=document.getElementById('nickname-input');if(ni)ni.addEventListener('blur',()=>Lobby.onNicknameBlur());
});
