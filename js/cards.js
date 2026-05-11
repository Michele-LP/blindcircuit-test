// ═══════════════════════════════════════════════════════════════════════════
//  CARDS.JS — Gestione mazzo, fase di programmazione, UI carte.
//
//  FASE 3: Mazzo, mano, registri, timer, conferma.
//  FASE 5: SPAM/WORM nel mazzo, power down.
//
//  BUG FIX (rispetto alla versione precedente):
//  Selezione di carte duplicate corretta — usa conteggio per tipo,
//  non indexOf, così "Gira Sx" ×2 in mano funziona correttamente.
// ═══════════════════════════════════════════════════════════════════════════

const Cards = {

  _imgs: {},
  _timerInterval: null,
  _timerLeft: 0,
  _confirmed: {}, // HOST: raccolta conferme { playerId: registers[] }

  // ── Precariamento immagini ────────────────────────────────────────────
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
    if (document.getElementById('scr-programming')?.classList.contains('active'))
      this.render();
  },

  // ── Inizializzazione mazzo ────────────────────────────────────────────
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
      player.deck    = this._buildDeck();
      player.discard = [];
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
        player.deck = this._shuffle([...player.discard]);
        player.discard = [];
      }
      player.hand.push(player.deck.pop());
    }
  },

  // ── Inizio round ──────────────────────────────────────────────────────
  startRound(msg) {
    const me = State.myPlayer();
    if (!me) return;

    if (!me.deck) this._initPlayerCards(me);

    // Carte vecchie mano → scarti (i registri già eseguiti vengono gestiti da execution.js)
    me.discard.push(...me.hand);
    me.hand      = [];
    me.registers = new Array(CONFIG.registersCount).fill(null);
    me.confirmed = false;

    // TODO Fase 5: sottrarre registri bloccati da WORM
    // Conta le SPAM nel mazzo (informazione per l'utente)
    const spamInDeck = me.deck.filter(c => c === 'spam').length;

    if (State.isHost) this._confirmed = {};

    const title = document.getElementById('prog-title');
    if (title) title.textContent = `Round ${msg.round ?? 1} — Programmazione`;

    const spamInfo = document.getElementById('spam-count');
    if (spamInfo) spamInfo.textContent = spamInDeck > 0 ? `⚠ ${spamInDeck} SPAM nel mazzo` : '';

    this._draw(me, CONFIG.cardsDealt);
    this._startTimer(msg.timerSec ?? CONFIG.programmingTimerSec);
    UI.show('programming');
    this.render();
  },

  // ── Timer ──────────────────────────────────────────────────────────────
  _startTimer(seconds) {
    this._stopTimer();
    this._timerLeft = seconds;
    this._updateTimerDisplay();
    if (seconds <= 0) return;
    this._timerInterval = setInterval(() => {
      this._timerLeft--;
      this._updateTimerDisplay();
      if (this._timerLeft <= 0) { this._stopTimer(); this._autoConfirm(); }
    }, 1000);
  },

  _stopTimer() {
    clearInterval(this._timerInterval);
    this._timerInterval = null;
  },

  _updateTimerDisplay() {
    const el = document.getElementById('prog-timer');
    if (!el) return;
    const s = this._timerLeft;
    el.textContent = s > 0 ? s : '–';
    el.className = 'prog-timer' + (s <= 10 && s > 0 ? ' urgent' : '');
  },

  _autoConfirm() {
    const me = State.myPlayer();
    if (!me || me.confirmed) return;
    const inRegs  = new Set(me.registers.filter(Boolean));
    const spare   = this._shuffle(me.hand.filter(c => !inRegs.has(c)));
    me.registers  = me.registers.map(r => r ?? (spare.shift() ?? null));
    this.render();
    this.confirm();
  },

  // ── Interazione carte / registri ──────────────────────────────────────

  onCardClick(handIndex) {
    const me = State.myPlayer();
    if (!me || me.confirmed) return;
    const cardId = me.hand[handIndex];
    if (!cardId) return;

    // BUG FIX: conta quante copie di questo tipo sono già nei registri
    const inRegsCount = me.registers.filter(r => r === cardId).length;
    const inHandCount = me.hand.filter(c => c === cardId).length;

    // Se tutte le copie in mano sono già piazzate, ignora il click
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
    if (!me.registers[regIndex]) return;
    me.registers[regIndex] = null;
    this.render();
    this._updateConfirmBtn();
  },

  // ── Conferma ──────────────────────────────────────────────────────────
  confirm() {
    const me = State.myPlayer();
    if (!me || me.confirmed) return;
    if (me.registers.some(r => r === null)) {
      document.getElementById('prog-status').textContent =
        'Riempi tutti e 5 i registri prima di confermare.';
      return;
    }
    me.confirmed = true;
    this._stopTimer();
    Net.sendToAll({ type: 'PROGRAM_REGISTERS', registers: me.registers });
    document.getElementById('prog-status').textContent = 'Confermato! In attesa degli altri…';
    document.getElementById('btn-confirm').disabled = true;
    this.render();
  },

  onGuestConfirmed(fromId, msg) {
    this._confirmed[fromId] = msg.registers;
    const me = State.myPlayer();
    if (me?.confirmed) this._confirmed[State.myId] = me.registers;
    const allIds = State.getPlayerList().map(p => p.id);
    if (allIds.every(id => this._confirmed[id])) {
      Execution.compute(this._confirmed);
    }
  },

  // ── Rendering UI ──────────────────────────────────────────────────────
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
      if (me.registers[i]) slot.appendChild(this._cardEl(me.registers[i], true, i));
    }
  },

  _renderHand(me) {
    const row = document.getElementById('hand-row');
    if (!row) return;
    row.innerHTML = '';

    // BUG FIX: contatore per tipo — dim solo le copie già piazzate
    const regCount  = {};
    for (const r of me.registers) if (r) regCount[r] = (regCount[r] || 0) + 1;
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
    el.title     = def?.desc ?? cardId;
    if (CONFIG.cardFrame) el.style.backgroundImage = `url('${CONFIG.cardFrame}')`;
    else el.style.cssText = 'background:#2a2010;border:2px solid #555;border-radius:6px;';

    if (def?.image) {
      const icon = document.createElement('div');
      icon.className = 'card-icon-area';
      icon.style.backgroundImage = `url('${def.image}')`;
      el.appendChild(icon);
    }

    const nameDiv = document.createElement('div');
    nameDiv.className = 'card-name-area';
    nameDiv.textContent = (def?.name ?? cardId).toUpperCase();
    el.appendChild(nameDiv);

    // SPAM: indicatore visivo speciale
    if (cardId === 'spam') {
      el.style.outline = '2px solid #f85149';
      nameDiv.style.color = '#f85149';
    }

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
      status.textContent = filled < CONFIG.registersCount
        ? `Registri: ${filled}/${CONFIG.registersCount}`
        : 'Pronti! Conferma per continuare.';
    }
  },

  // ── Dispatcher (chiamato da Game.handleMessage) ──────────────────────
  handleGameMessage(fromId, msg) {
    switch (msg.type) {
      case 'ROUND_START':        this.startRound(msg); break;
      case 'PROGRAM_REGISTERS':  if (State.isHost) this.onGuestConfirmed(fromId, msg); break;
      case 'EXECUTE_PLAN':       if (!State.isHost) Execution.receive(msg); break;
    }
  },
};
