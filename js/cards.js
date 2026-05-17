// ═══════════════════════════════════════════════════════════════════════════
//  CARDS.JS — v6.6
// ═══════════════════════════════════════════════════════════════════════════
const Cards = {
  _imgs:{}, _confirmed:{},

  preload(){
    const srcs=[CONFIG.cardFrame,CONFIG.cardBack,...CONFIG.cards.filter(c=>c.image).map(c=>c.image)];
    for(const src of srcs){if(!src||this._imgs[src])continue;const i=new Image();i.onload=()=>this._safeRender();i.src=src;this._imgs[src]=i;}
  },
  _safeRender(){const pp=document.getElementById('prog-panel');if(pp&&pp.style.display!=='none')this.render();},

  _buildDeck(){const d=[];for(const[t,q]of Object.entries(CONFIG.deckComposition))for(let i=0;i<q;i++)d.push(t);return this._shuffle(d);},
  _shuffle(a){const r=[...a];for(let i=r.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[r[i],r[j]]=[r[j],r[i]];}return r;},

  _initPlayerCards(p){
    if(!p.deck){p.deck=this._buildDeck();p.discard=[];p.wormSlots={};}
    p.hand=[];p.registers=new Array(CONFIG.registersCount).fill(null);p.confirmed=false;p.energy=p.energy??CONFIG.startingEnergy;
  },

  _draw(p,n){for(let i=0;i<n;i++){if(!p.deck.length){if(!p.discard.length)break;p.deck=this._shuffle([...p.discard]);p.discard=[];}p.hand.push(p.deck.pop());}},

  startRound(msg){
    const me=State.myPlayer();if(!me)return;

    // v6.9 B1: cancella animazione in corso (potrebbe non aver finito il deck_sync)
    if(State.execAnimating){
      State.execAnimating=false; State.execAdvance=null;
      if(typeof Game!=='undefined'){Game.showAdvanceButton(false,false);Game.hideExecPanel();}
    }

    // v6.9 B1: applica deck/discard autorevoli dall'host per ogni giocatore
    if(msg.decks){
      for(const[id,d]of Object.entries(msg.decks)){
        const p=State.players[id]; if(!p)continue;
        p.deck=d.deck; p.discard=d.discard;
      }
    }
    // v6.9 B1: sync mazzo danno condiviso
    if(msg.damageDeck!==undefined) State.damageDeck=msg.damageDeck;
    if(msg.damageDiscard!==undefined) State.damageDiscard=msg.damageDiscard;
    // v6.9: sync energy token
    if(msg.energyToken!==undefined) State.energyToken=msg.energyToken;

    if(!me.deck)this._initPlayerCards(me);
    if(msg.wormSlots){for(const[id,sl]of Object.entries(msg.wormSlots))if(State.players[id])State.players[id].wormSlots=sl;}
    if(!me.wormSlots)me.wormSlots={};
    // v6.9 B5: resetta rebooting per tutti i giocatori a inizio round
    for(const p of Object.values(State.players)){p.confirmed=false;p.rebooting=false;}
    me.discard.push(...me.hand);me.hand=[];me.confirmed=false;
    if(State.isHost)this._confirmed={};
    me.registers=Array.from({length:CONFIG.registersCount},(_,i)=>me.wormSlots[i]??null);
    const title=document.getElementById('prog-title');if(title)title.textContent=`Round ${msg.round??1}`;
    this._draw(me,CONFIG.cardsDealt);this._updateDeckInfo(me);
    if(typeof Log!=='undefined')Log.add(`Round ${msg.round??1} — programmazione`,{type:'event'});
    Game.enterProgramming();this.render();this.updateOthersStatus();
  },

  _updateDeckInfo(me){
    const all=[...(me.deck??[]),...(me.discard??[]),...(me.hand??[])];
    const spam=all.filter(c=>c==='spam').length,dk=(me.deck??[]).length,dc=(me.discard??[]).length;
    const se=document.getElementById('spam-count');
    if(se){se.textContent=spam>0?`⚠ ${spam} SPAM`:'';se.dataset.tooltip=spam>0?`${spam} carte SPAM nel ciclo`:'Nessuna SPAM';}
    const de=document.getElementById('deck-info');
    if(de){de.textContent=`🃏 ${dk}  ♻ ${dc}`;de.dataset.tooltip=`Mazzo: ${dk}\nScarti: ${dc}\nTotale: ${dk+dc+(me.hand?.length??0)}`;}
    const dm=document.getElementById('dmg-deck-info');
    if(dm){
      const inPlay=State.getPlayerList().flatMap(p=>Object.values(p.wormSlots??{})).filter(Boolean).length;
      const dn=State.damageDeck?.length??0,dd=State.damageDiscard?.length??0,tot=dn+dd+inPlay;
      dm.textContent=`🦠 ${dn} (${dd}♻ ${inPlay}⏳)`;
      dm.dataset.tooltip=`Mazzo danno:\n${dn} da pescare\n${dd} scartate\n${inPlay} in slot WORM\nTotale: ${tot}`;
    }
  },

  onCardClick(hi){
    const me=State.myPlayer();if(!me||me.confirmed)return;
    const cid=me.hand[hi];if(!cid)return;
    const inR=me.registers.filter(r=>r===cid).length,inH=me.hand.filter(c=>c===cid).length;
    if(inR>=inH)return;
    const s=me.registers.indexOf(null);if(s===-1)return;
    me.registers[s]=cid;this.render();this._updateConfirmBtn();
  },

  onRegisterClick(ri){
    const me=State.myPlayer();if(!me||me.confirmed)return;
    const c=me.registers[ri];if(!c)return;
    if(typeof c==='string'&&c.startsWith('worm_'))return;
    me.registers[ri]=null;this.render();this._updateConfirmBtn();
  },

  confirm(){
    const me=State.myPlayer();if(!me||me.confirmed)return;
    if(me.registers.some(r=>r===null)){document.getElementById('prog-status').textContent='Riempi tutti i registri liberi.';return;}
    me.confirmed=true;
    Net.sendToAll({type:'PROGRAM_REGISTERS',registers:me.registers});
    document.getElementById('prog-status').textContent='✅ Confermato! In attesa…';
    document.getElementById('btn-confirm').disabled=true;
    // v6.9 G1: mostra pulsante annulla
    const ua=document.getElementById('btn-unconfirm');
    if(ua)ua.style.display='inline-flex';
    if(typeof Audio!=='undefined') Audio.play('confirm');
    this.render();this.updateOthersStatus();
  },

  // v6.9 G1: annulla conferma programmazione (finché non tutti hanno confermato)
  unconfirm(){
    const me=State.myPlayer();if(!me||!me.confirmed)return;
    // Controlla che non tutti abbiano già confermato (esecuzione già partita)
    if(State.execAnimating)return;
    me.confirmed=false;
    Net.sendToAll({type:'UNCONFIRM'});
    document.getElementById('prog-status').textContent='Conferma annullata — modifica i registri';
    document.getElementById('btn-confirm').disabled=false;
    const ua=document.getElementById('btn-unconfirm');
    if(ua)ua.style.display='none';
    this.render();this.updateOthersStatus();
  },

  onGuestConfirmed(fromId,msg){
    this._confirmed[fromId]=msg.registers;
    const me=State.myPlayer();if(me?.confirmed)this._confirmed[State.myId]=me.registers;
    if(State.getPlayerList().map(p=>p.id).every(id=>this._confirmed[id])){
      if(typeof Log!=='undefined')Log.add('Tutti pronti — esecuzione',{type:'event'});
      Execution.compute(this._confirmed);
    }
  },

  // v6.9 G1: gestisce annullamento conferma da parte di un guest
  onGuestUnconfirmed(fromId){
    delete this._confirmed[fromId];
  },

  updateOthersStatus(){
    // v6.8.1: aggiorna le icone conferma dentro l'HUD (non più sezione separata)
    for(const p of State.getPlayerList()){
      const el=document.getElementById(`hud-conf-${p.id}`);
      if(el) el.textContent=p.confirmed?'✅':'⏳';
    }
  },

  _autoConfirm(){
    const me=State.myPlayer();if(!me||me.confirmed)return;
    const av=[...me.hand];for(const r of me.registers){if(!r||r.startsWith?.('worm_'))continue;const i=av.indexOf(r);if(i!==-1)av.splice(i,1);}
    const pool=this._shuffle(av);me.registers=me.registers.map(r=>r!==null?r:(pool.shift()??null));
    this.render();this.confirm();
  },

  render(){const me=State.myPlayer();if(!me)return;this._renderRegisters(me);this._renderHand(me);this._updateConfirmBtn(me);},

  _renderRegisters(me){
    for(let i=0;i<CONFIG.registersCount;i++){
      const s=document.getElementById('reg-'+i);if(!s)continue;s.innerHTML='';
      const c=me.registers[i];if(!c)continue;
      if(typeof c==='string'&&c.startsWith('worm_'))s.appendChild(this._wormCardEl(c));
      else {
        const el=this._cardEl(c,true,i);
        // v6.9 U7: drag from register (back to hand)
        if(!me.confirmed){
          el.draggable=true;
          el.addEventListener('dragstart',(e)=>{e.dataTransfer.setData('text/plain',JSON.stringify({from:'reg',regIndex:i}));el.classList.add('dragging');});
          el.addEventListener('dragend',()=>el.classList.remove('dragging'));
        }
        s.appendChild(el);
      }
    }
    // v6.9 U7: drop targets on register slots
    if(!me.confirmed){
      for(let i=0;i<CONFIG.registersCount;i++){
        const s=document.getElementById('reg-'+i);if(!s)continue;
        s.addEventListener('dragover',(e)=>{e.preventDefault();s.classList.add('drag-over');});
        s.addEventListener('dragleave',()=>s.classList.remove('drag-over'));
        s.addEventListener('drop',(e)=>{
          e.preventDefault();s.classList.remove('drag-over');
          try{
            const data=JSON.parse(e.dataTransfer.getData('text/plain'));
            if(data.from==='hand') this._dropHandToReg(data.handIndex,i);
            else if(data.from==='reg'&&data.regIndex!==i) this._swapRegisters(data.regIndex,i);
          }catch(_){}
        });
      }
    }
  },

  // v6.9 U7: piazza carta dalla mano in un registro specifico
  _dropHandToReg(handIndex,regIndex){
    const me=State.myPlayer();if(!me||me.confirmed)return;
    const cid=me.hand[handIndex];if(!cid)return;
    if(me.registers[regIndex]!==null)return; // slot già occupato
    const inR=me.registers.filter(r=>r===cid).length,inH=me.hand.filter(c=>c===cid).length;
    if(inR>=inH)return;
    me.registers[regIndex]=cid;this.render();this._updateConfirmBtn();
  },

  // v6.9 U7: scambia due registri
  _swapRegisters(fromReg,toReg){
    const me=State.myPlayer();if(!me||me.confirmed)return;
    const a=me.registers[fromReg],b=me.registers[toReg];
    // Non scambiare worm
    if(typeof a==='string'&&a.startsWith('worm_'))return;
    if(typeof b==='string'&&b.startsWith('worm_'))return;
    me.registers[fromReg]=b;me.registers[toReg]=a;
    this.render();this._updateConfirmBtn();
  },

  _wormCardEl(wormId){
    const wd=(typeof RULES!=='undefined'?RULES?.worms:null);
    const def=wd?.find(w=>w.id===wormId);
    const col=def?.color??'#ef4444',sym=def?.symbol??'🦠',nm=def?.name??'WORM';
    // v6.9 U4: ogni istruzione a capo nel tooltip
    const seqArr=(def?.sequence??[]).map(s=>{switch(s.type){case'move':return`▶ Avanza ${s.steps??1}`;case'backUp':return`◀ Indietro ${s.steps??1}`;case'rotateLeft':return'↺ Ruota ←';case'rotateRight':return'↻ Ruota →';case'uTurn':return'⟳ U-Turn';default:return s.type;}});
    const seqTooltip=seqArr.join('\n');
    const el=document.createElement('div');el.className='game-card worm-card';
    el.dataset.tooltip=`WORM: ${nm}\n${seqTooltip||'(nessuna sequenza)'}`;el.dataset.tooltipColor=col;
    el.style.cssText=`background:${col}22;border:2px solid ${col};border-radius:5px;cursor:not-allowed;width:100%;aspect-ratio:2/3;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;overflow:hidden;`;
    const ic=document.createElement('div');ic.style.cssText='font-size:1.1rem;line-height:1;';ic.textContent=sym;
    const ne=document.createElement('div');ne.className='card-name-area';ne.style.cssText=`color:${col};font-size:0.42rem;font-weight:800;position:relative;`;ne.textContent=nm.toUpperCase();
    el.appendChild(ic);el.appendChild(ne);
    // v6.9 U5: sequenza sempre visibile sotto il simbolo
    if(seqArr.length){
      const sq=document.createElement('div');sq.className='worm-seq-visible';
      sq.style.cssText=`font-size:0.33rem;color:${col};line-height:1.35;text-align:center;padding:0 2px;opacity:0.9;max-height:40%;overflow:hidden;`;
      sq.textContent=seqArr.map(s=>s.replace(/^[▶◀↺↻⟳]\s*/,'')).join(' → ');
      el.appendChild(sq);
    }
    return el;
  },

  _renderHand(me){
    const row=document.getElementById('hand-row');if(!row)return;row.innerHTML='';
    const rc={};for(const r of me.registers)if(r&&!r.startsWith?.('worm_'))rc[r]=(rc[r]||0)+1;
    const sc={};for(let i=0;i<me.hand.length;i++){const id=me.hand[i];sc[id]=(sc[id]||0)+1;row.appendChild(this._cardEl(id,false,i,(rc[id]||0)>=sc[id]));}
  },

  _cardEl(cardId,isReg,index,dimmed=false){
    const def=CONFIG.cards.find(c=>c.id===cardId);
    const el=document.createElement('div');el.className='game-card'+(dimmed&&!isReg?' used':'');
    el.dataset.tooltip=def?`${def.name}: ${def.desc}`:cardId;
    if(CONFIG.cardFrame)el.style.backgroundImage=`url('${CONFIG.cardFrame}')`;
    else el.style.cssText='background:#2a2010;border:2px solid #6b5e3a;border-radius:6px;';
    if(cardId==='spam')el.style.outline='2px solid #f85149';
    if(def?.image){const ic=document.createElement('div');ic.className='card-icon-area';ic.style.backgroundImage=`url('${def.image}')`;el.appendChild(ic);}
    const nd=document.createElement('div');nd.className='card-name-area';nd.textContent=(def?.name??cardId).toUpperCase();
    if(cardId==='spam')nd.style.color='#f85149';el.appendChild(nd);
    if(!dimmed||isReg)el.addEventListener('click',()=>{if(State.myPlayer()?.confirmed)return;isReg?this.onRegisterClick(index):this.onCardClick(index);});
    // v6.9 U7: drag dalla mano
    if(!isReg&&!dimmed){
      el.draggable=true;
      el.addEventListener('dragstart',(e)=>{e.dataTransfer.setData('text/plain',JSON.stringify({from:'hand',handIndex:index}));el.classList.add('dragging');});
      el.addEventListener('dragend',()=>el.classList.remove('dragging'));
    }
    return el;
  },

  _updateConfirmBtn(me){
    me=me??State.myPlayer();const btn=document.getElementById('btn-confirm');if(!btn||!me)return;
    const filled=me.registers.filter(Boolean).length;btn.disabled=filled<CONFIG.registersCount||me.confirmed;
    // v6.9 G1: gestisci visibilità pulsante annulla
    const ua=document.getElementById('btn-unconfirm');
    if(ua) ua.style.display=me.confirmed?'inline-flex':'none';
    const st=document.getElementById('prog-status');if(st&&!me.confirmed){
      const wc=Object.values(me.wormSlots??{}).filter(Boolean).length,free=CONFIG.registersCount-wc,done=me.registers.filter(r=>r&&!r.startsWith?.('worm_')).length;
      st.textContent=done<free?`Registri: ${done}/${free}${wc>0?' ('+wc+' WORM)':''}` :'Pronti! Conferma per continuare.';
    }
  },

  handleGameMessage(fromId,msg){
    switch(msg.type){
      case'ROUND_START':this.startRound(msg);break;
      case'PROGRAM_REGISTERS':if(State.isHost)this.onGuestConfirmed(fromId,msg);if(State.players[fromId])State.players[fromId].confirmed=true;this.updateOthersStatus();break;
      case'UNCONFIRM':if(State.isHost)this.onGuestUnconfirmed(fromId);if(State.players[fromId])State.players[fromId].confirmed=false;this.updateOthersStatus();break;
      case'EXECUTE_PLAN':if(!State.isHost)Execution.receive(msg);break;
    }
  },
};
