// ═══════════════════════════════════════════════════════════════════════════
//  CARDS.JS — v6.6
//
//  FIX v6.6:
//  ─ Conteggio mazzo guasti corretto: ora include anche le WORM in volo
//    (in wormSlots dei giocatori). Prima sembrava che le carte sparissero
//    quando una WORM veniva assegnata ad uno slot.
//  ─ Tooltip custom su carte WORM e SPAM (via data-tooltip).
//
//  Dipendenze:
//  ─ Log.add(), Toast.show() (notifications.js) — opzionali, fallback se assenti.
//  ─ RULES (config.js) per le definizioni WORM.
// ═══════════════════════════════════════════════════════════════════════════

const Cards = {

  _imgs:      {},
  _confirmed: {},

  preload() {
    const srcs = [CONFIG.cardFrame, CONFIG.cardBack,
      ...CONFIG.cards.filter(c => c.image).map(c => c.image)];
    for (const src of srcs) {
      if (!src || this._imgs[src]) continue;
      const img = new Image();
      img.onload = () => this._safeRender();
      img.src = src;
      this._imgs[src] = img;
    }
  },

  _safeRender() {
    const pp = document.getElementById('prog-panel');
    if (pp && pp.style.display !== 'none') this.render();
  },

  _buildDeck() {
    const deck = [];
    for (const [type, qty] of Object.entries(CONFIG.deckComposition))
      for (let i = 0; i < qty; i++) deck.push(type);
    return this._shuffle(deck);
  },

  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },

  _initPlayerCards(player) {
    if (!player.deck) {
      player.deck      = this._buildDeck();
      player.discard   = [];
      player.wormSlots = {};
    }
    player.hand      = [];
    player.registers = new Array(CONFIG.registersCount).fill(null);
    player.confirmed = false;
    player.energy    = player.energy ?? CONFIG.startingEnergy;
  },

  _draw(player, n) {
    for (let i = 0; i < n; i++) {
      if (player.deck.length === 0) {
        if (!player.discard.length) break;
        player.deck    = this._shuffle([...player.discard]);
        player.discard = [];
      }
      player.hand.push(player.deck.pop());
    }
  },

  startRound(msg) {
    const me = State.myPlayer();
    if (!me) return;

    if (!me.deck) this._initPlayerCards(me);

    if (msg.wormSlots) {
      for (const [id, slots] of Object.entries(msg.wormSlots)) {
        if (State.players[id]) State.players[id].wormSlots = slots;
      }
    }
    if (!me.wormSlots) me.wormSlots = {};

    for (const p of Object.values(State.players)) p.confirmed = false;

    me.discard.push(...me.hand);
    me.hand      = [];
    me.confirmed = false;

    if (State.isHost) this._confirmed = {};

    me.registers = Array.from({ length: CONFIG.registersCount },
      (_, i) => me.wormSlots[i] ?? null
    );

    const title = document.getElementById('prog-title');
    if (title) title.textContent = `Round ${msg.round ?? 1}`;

    this._draw(me, CONFIG.cardsDealt);
    this._updateDeckInfo(me);

    // Log inizio round (solo nel log, non come toast)
    if (typeof Log !== 'undefined') Log.add(`Round ${msg.round ?? 1} — programmazione`, { type: 'event' });

    Game.enterProgramming();
    this.render();
    this.updateOthersStatus();
  },

  // ── Indicatori mazzo ──────────────────────────────────────────────────────
  // FIX v6.6: il totale del mazzo danno include anche le WORM in volo
  // (negli wormSlots dei giocatori), altrimenti il totale sembra calare
  // quando una WORM viene assegnata ad uno slot.
  _updateDeckInfo(me) {
    const allCards  = [...(me.deck ?? []), ...(me.discard ?? []), ...(me.hand ?? [])];
    const spamCount = allCards.filter(c => c === 'spam').length;
    const deckCount = (me.deck ?? []).length;
    const discCount = (me.discard ?? []).length;

    const spamEl = document.getElementById('spam-count');
    if (spamEl) {
      spamEl.textContent = spamCount > 0 ? `⚠ ${spamCount} SPAM` : '';
      spamEl.dataset.tooltip = spamCount > 0
        ? `Hai ${spamCount} carte SPAM nel ciclo. Quando vengono giocate, eseguono la prima carta dal tuo mazzo (e si auto-eliminano).`
        : 'Nessuna SPAM nel ciclo';
    }

    const deckEl = document.getElementById('deck-info');
    if (deckEl) {
      deckEl.textContent = `🃏 ${deckCount}  ♻ ${discCount}`;
      deckEl.dataset.tooltip = `Il tuo mazzo:\n🃏 ${deckCount} carte da pescare\n♻ ${discCount} carte negli scarti\nIn totale ${deckCount + discCount + (me.hand?.length ?? 0)} carte in circolazione.`;
    }

    const dmgEl = document.getElementById('dmg-deck-info');
    if (dmgEl) {
      // FIX: somma le WORM tenute nei wormSlots di TUTTI i giocatori
      const inPlay = State.getPlayerList()
        .flatMap(p => Object.values(p.wormSlots ?? {}))
        .filter(Boolean).length;
      const deckN  = State.damageDeck?.length    ?? 0;
      const discN  = State.damageDiscard?.length ?? 0;
      const total  = deckN + discN + inPlay;
      dmgEl.textContent = `🦠 Guasti: ${deckN} (${discN}♻ ${inPlay}⏳)`;
      dmgEl.dataset.tooltip = `Mazzo danno condiviso:\n🦠 ${deckN} da pescare\n♻ ${discN} scartate\n⏳ ${inPlay} in slot WORM dei giocatori\nTotale: ${total}`;
    }
  },

  onCardClick(handIndex) {
    const me = State.myPlayer();
    if (!me || me.confirmed) return;
    const cardId = me.hand[handIndex];
    if (!cardId) return;
    const inRegsCount = me.registers.filter(r => r === cardId).length;
    const inHandCount = me.hand.filter(c => c === cardId).length;
    if (inRegsCount >= inHandCount) return;
    const slot = me.registers.indexOf(null);
    if (slot === -1) return;
    me.registers[slot] = cardId;
    this.render();
    this._updateConfirmBtn();
  },

  onRegisterClick(regIndex) {
    const me = State.myPlayer();
    if (!me || me.confirmed) return;
    const card = me.registers[regIndex];
    if (!card) return;
    if (typeof card === 'string' && card.startsWith('worm_')) return;
    me.registers[regIndex] = null;
    this.render();
    this._updateConfirmBtn();
  },

  confirm() {
    const me = State.myPlayer();
    if (!me || me.confirmed) return;
    if (me.registers.some(r => r === null)) {
      document.getElementById('prog-status').textContent =
        'Riempi tutti i registri liberi prima di confermare.';
      return;
    }
    me.confirmed = true;
    Net.sendToAll({ type: 'PROGRAM_REGISTERS', registers: me.registers });
    document.getElementById('prog-status').textContent = '✅ Confermato! In attesa degli altri…';
    document.getElementById('btn-confirm').disabled = true;
    this.render();
    this.updateOthersStatus();
  },

  onGuestConfirmed(fromId, msg) {
    this._confirmed[fromId] = msg.registers;
    const me = State.myPlayer();
    if (me?.confirmed) this._confirmed[State.myId] = me.registers;
    const allIds = State.getPlayerList().map(p => p.id);
    if (allIds.every(id => this._confirmed[id])) {
      if (typeof Log !== 'undefined') Log.add('Tutti pronti — esecuzione', { type: 'event' });
      Execution.compute(this._confirmed);
    }
  },

  updateOthersStatus() {
    const el = document.getElementById('others-status');
    if (!el) return;
    el.innerHTML = '';
    for (const p of State.getPlayerList()) {
      const char  = CONFIG.characters.find(c => c.id === p.character);
      const color = char?.color ?? '#6b7280';
      const isMe  = p.id === State.myId;
      const row   = document.createElement('div');
      row.className = 'other-status-row' + (isMe ? ' is-me' : '');
      row.innerHTML = `
        <span class="other-dot" style="background:${color}"></span>
        <span class="other-name">${(p.nickname || '?').substring(0, 10)}${isMe ? ' (tu)' : ''}</span>
        <span class="other-conf">${p.confirmed ? '✅' : '⏳'}</span>
      `;
      el.appendChild(row);
    }
  },

  _autoConfirm() {
    const me = State.myPlayer();
    if (!me || me.confirmed) return;
    const available = [...me.hand];
    for (const r of me.registers) {
      if (!r || r.startsWith?.('worm_')) continue;
      const idx = available.indexOf(r);
      if (idx !== -1) available.splice(idx, 1);
    }
    const pool = this._shuffle(available);
    me.registers = me.registers.map(r => r !== null ? r : (pool.shift() ?? null));
    this.render();
    this.confirm();
  },

  render() {
    const me = State.myPlayer();
    if (!me) return;
    this._renderRegisters(me);
    this._renderHand(me);
    this._updateConfirmBtn(me);
  },

  _renderRegisters(me) {
    for (let i = 0; i < CONFIG.registersCount; i++) {
      const slot = document.getElementById('reg-' + i);
      if (!slot) continue;
      slot.innerHTML = '';
      const cardId = me.registers[i];
      if (!cardId) continue;
      if (typeof cardId === 'string' && cardId.startsWith('worm_')) {
        slot.appendChild(this._wormCardEl(cardId));
      } else {
        slot.appendChild(this._cardEl(cardId, true, i));
      }
    }
  },

  _wormCardEl(wormId) {
    const wormDef = (typeof RULES !== 'undefined' ? RULES?.worms : null);
    const def     = wormDef?.find(w => w.id === wormId);
    const color   = def?.color  ?? '#ef4444';
    const symbol  = def?.symbol ?? '🦠';
    const name    = def?.name   ?? 'WORM';

    // Costruisci descrizione della sequenza per il tooltip
    const seqDesc = (def?.sequence ?? []).map(step => {
      switch (step.type) {
        case 'move':        return `Avanza ${step.steps ?? 1}`;
        case 'backUp':      return `Indietro ${step.steps ?? 1}`;
        case 'rotateLeft':  return 'Ruota ←';
        case 'rotateRight': return 'Ruota →';
        case 'uTurn':       return 'U-Turn';
        default:            return step.type;
      }
    }).join(' → ');

    const el = document.createElement('div');
    el.className = 'game-card worm-card';
    el.dataset.tooltip      = `WORM: ${name}\nSequenza: ${seqDesc || '(nessuna)'}`;
    el.dataset.tooltipColor = color;
    el.style.cssText = [
      `background: ${color}22`,
      `border: 2px solid ${color}`,
      'border-radius: 5px',
      'cursor: not-allowed',
      'width: 100%',
      'aspect-ratio: 2/3',
      'position: relative',
      'display: flex',
      'flex-direction: column',
      'align-items: center',
      'justify-content: center',
      'gap: 2px',
      'overflow: hidden',
    ].join(';');

    const iconEl = document.createElement('div');
    iconEl.style.cssText = 'font-size: 1.4rem; line-height: 1;';
    iconEl.textContent = symbol;
    const nameEl = document.createElement('div');
    nameEl.className = 'card-name-area';
    nameEl.style.cssText = `color: ${color}; font-size: 0.42rem; font-weight: 800;`;
    nameEl.textContent = name.toUpperCase();
    el.appendChild(iconEl);
    el.appendChild(nameEl);
    return el;
  },

  _renderHand(me) {
    const row = document.getElementById('hand-row');
    if (!row) return;
    row.innerHTML = '';
    const regCount  = {};
    for (const r of me.registers) {
      if (r && !r.startsWith?.('worm_')) regCount[r] = (regCount[r] || 0) + 1;
    }
    const seenCount = {};
    for (let i = 0; i < me.hand.length; i++) {
      const id = me.hand[i];
      seenCount[id] = (seenCount[id] || 0) + 1;
      const dimmed = (regCount[id] || 0) >= seenCount[id];
      row.appendChild(this._cardEl(id, false, i, dimmed));
    }
  },

  _cardEl(cardId, isReg, index, dimmed = false) {
    const def = CONFIG.cards.find(c => c.id === cardId);
    const el  = document.createElement('div');
    el.className = 'game-card' + (dimmed && !isReg ? ' used' : '');
    el.dataset.tooltip = def ? `${def.name}: ${def.desc}` : cardId;

    if (CONFIG.cardFrame) {
      el.style.backgroundImage = `url('${CONFIG.cardFrame}')`;
    } else {
      el.style.cssText = 'background:#2a2010;border:2px solid #6b5e3a;border-radius:6px;';
    }
    if (cardId === 'spam') el.style.outline = '2px solid #f85149';

    if (def?.image) {
      const icon = document.createElement('div');
      icon.className = 'card-icon-area';
      icon.style.backgroundImage = `url('${def.image}')`;
      el.appendChild(icon);
    }
    const nameDiv = document.createElement('div');
    nameDiv.className = 'card-name-area';
    nameDiv.textContent = (def?.name ?? cardId).toUpperCase();
    if (cardId === 'spam') nameDiv.style.color = '#f85149';
    el.appendChild(nameDiv);

    if (!dimmed || isReg) {
      el.addEventListener('click', () => {
        if (State.myPlayer()?.confirmed) return;
        isReg ? this.onRegisterClick(index) : this.onCardClick(index);
      });
    }
    return el;
  },

  _updateConfirmBtn(me) {
    me = me ?? State.myPlayer();
    const btn = document.getElementById('btn-confirm');
    if (!btn || !me) return;
    const filled = me.registers.filter(Boolean).length;
    btn.disabled = filled < CONFIG.registersCount || me.confirmed;
    const status = document.getElementById('prog-status');
    if (status && !me.confirmed) {
      const wormCount = Object.values(me.wormSlots ?? {}).filter(Boolean).length;
      const free = CONFIG.registersCount - wormCount;
      const done = me.registers.filter(r => r && !r.startsWith?.('worm_')).length;
      status.textContent = done < free
        ? `Registri: ${done}/${free} (${wormCount} WORM)`
        : 'Pronti! Conferma per continuare.';
    }
  },

  handleGameMessage(fromId, msg) {
    switch (msg.type) {
      case 'ROUND_START':
        this.startRound(msg);
        break;
      case 'PROGRAM_REGISTERS':
        if (State.isHost) this.onGuestConfirmed(fromId, msg);
        if (State.players[fromId]) State.players[fromId].confirmed = true;
        this.updateOthersStatus();
        break;
      case 'EXECUTE_PLAN':
        if (!State.isHost) Execution.receive(msg);
        break;
    }
  },
};
