// ═══════════════════════════════════════════════════════════════════════════
//  CARDS.JS — Gestione mazzo, fase di programmazione, UI carte.
//
//  Responsabilità:
//  - Inizializza e mescola il mazzo personale di ogni giocatore
//  - Gestisce la mano (9 carte pescate) e i 5 registri
//  - Renderizza la schermata di programmazione con le immagini PNG
//  - Gestisce il timer (countdown host-side, display client-side)
//  - Invia PROGRAM_REGISTERS all'host quando il giocatore conferma
//  - L'host raccoglie tutte le conferme e invia ALL_PROGRAMMED
//
//  Note per Fase 4:
//  - ALL_PROGRAMMED porta tutti i registri di tutti → si eseguono in ordine
//  - Per ora ALL_PROGRAMMED mostra un placeholder e riparte un nuovo round
// ═══════════════════════════════════════════════════════════════════════════

const Cards = {

  // ── Immagini precaricate { src: HTMLImageElement } ─────────────────────
  _imgs: {},

  // ── Timer ─────────────────────────────────────────────────────────────
  _timerInterval: null,
  _timerLeft:     0,

  // ── Stato raccolta conferme (solo HOST) ───────────────────────────────
  // { [playerId]: [c0, c1, c2, c3, c4] }
  _confirmed: {},


  // ══════════════════════════════════════════════════════════════════════
  //  PRECARIAMENTO IMMAGINI
  // ══════════════════════════════════════════════════════════════════════

  preload() {
    const srcs = [
      CONFIG.cardFrame,
      CONFIG.cardBack,
      ...CONFIG.cards.filter(c => c.image).map(c => c.image),
    ];
    for (const src of srcs) {
      if (!this._imgs[src]) {
        const img = new Image();
        img.onload = () => this._safeRender();
        img.src = src;
        this._imgs[src] = img;
      }
    }
  },

  _safeRender() {
    // Ri-renderizza solo se la schermata di programmazione è attiva
    if (document.getElementById('scr-programming').classList.contains('active')) {
      this.render();
    }
  },

  _img(src) {
    return src ? this._imgs[src] : null;
  },


  // ══════════════════════════════════════════════════════════════════════
  //  INIZIALIZZAZIONE MAZZO
  // ══════════════════════════════════════════════════════════════════════

  /** Crea un mazzo mescolato da CONFIG.deckComposition */
  _buildDeck() {
    const deck = [];
    for (const [type, qty] of Object.entries(CONFIG.deckComposition)) {
      for (let i = 0; i < qty; i++) deck.push(type);
    }
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

  /** Inizializza deck/discard/hand/registers su un player object */
  _initPlayerCards(player) {
    if (!player.deck) {
      player.deck    = this._buildDeck();
      player.discard = [];
    }
    player.hand      = [];
    player.registers = new Array(CONFIG.registersCount).fill(null);
    player.confirmed = false;
  },

  /** Pesca n carte dal mazzo al hand (rimescola scarti se necessario) */
  _draw(player, n) {
    for (let i = 0; i < n; i++) {
      if (player.deck.length === 0) {
        if (player.discard.length === 0) break; // nessuna carta disponibile
        player.deck    = this._shuffle([...player.discard]);
        player.discard = [];
      }
      player.hand.push(player.deck.pop());
    }
  },


  // ══════════════════════════════════════════════════════════════════════
  //  INIZIO ROUND (chiamato da Game.handleMessage su ROUND_START)
  // ══════════════════════════════════════════════════════════════════════

  startRound(msg) {
    const me = State.myPlayer();
    if (!me) return;

    // Prima volta: inizializza mazzo
    if (!me.deck) this._initPlayerCards(me);

    // Mette la mano vecchia negli scarti (eccetto le carte già nei registri
    // che vengono rimesse nel mazzo nella fase di esecuzione — Fase 4)
    me.discard.push(...me.hand);
    me.hand      = [];
    me.registers = new Array(CONFIG.registersCount).fill(null);
    me.confirmed = false;

    // Pesca le carte per questo round
    // TODO Fase 5: sottrarre i registri bloccati da WORM
    this._draw(me, CONFIG.cardsDealt);

    // Host resetta la raccolta conferme
    if (State.isHost) {
      this._confirmed = {};
    }

    // Aggiorna titolo round
    const titleEl = document.getElementById('prog-title');
    if (titleEl) titleEl.textContent = `Round ${msg.round ?? 1} — Programmazione`;

    // Avvia timer
    this._startTimer(msg.timerSec ?? CONFIG.programmingTimerSec);

    UI.show('programming');
    this.render();
  },


  // ══════════════════════════════════════════════════════════════════════
  //  TIMER
  // ══════════════════════════════════════════════════════════════════════

  _startTimer(seconds) {
    this._stopTimer();
    this._timerLeft = seconds;
    this._updateTimerDisplay();

    if (seconds <= 0) return; // timer disabilitato

    this._timerInterval = setInterval(() => {
      this._timerLeft--;
      this._updateTimerDisplay();

      if (this._timerLeft <= 0) {
        this._stopTimer();
        this._autoConfirm(); // riempie i registri vuoti e conferma
      }
    }, 1000);
  },

  _stopTimer() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  },

  _updateTimerDisplay() {
    const el = document.getElementById('prog-timer');
    if (!el) return;
    const s = this._timerLeft;
    el.textContent = s > 0 ? s : '–';
    el.className = 'prog-timer' + (s <= 10 && s > 0 ? ' urgent' : '');
  },

  /** Auto-conferma al termine del timer: riempie i registri vuoti con carte casuali */
  _autoConfirm() {
    const me = State.myPlayer();
    if (!me || me.confirmed) return;

    // Prende le carte rimaste in mano (quelle non ancora in un registro)
    const inRegs = new Set(me.registers.filter(Boolean));
    const spare  = me.hand.filter(c => !inRegs.has(c));
    const spareShuffled = this._shuffle(spare);

    me.registers = me.registers.map(r => {
      if (r) return r;
      return spareShuffled.length ? spareShuffled.shift() : null;
    });

    this.render();
    this.confirm();
  },


  // ══════════════════════════════════════════════════════════════════════
  //  INTERAZIONE: click carta / click registro
  // ══════════════════════════════════════════════════════════════════════

  onCardClick(handIndex) {
    const me = State.myPlayer();
    if (!me || me.confirmed) return;
    const cardId = me.hand[handIndex];
    if (!cardId) return;

    // Verifica se la carta è già in un registro
    const regIdx = me.registers.indexOf(cardId);
    if (regIdx !== -1) {
      // La carta è già nei registri: nessuna azione da qui
      return;
    }

    // Trova il primo slot libero
    const slot = me.registers.indexOf(null);
    if (slot === -1) return; // tutti i registri pieni

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


  // ══════════════════════════════════════════════════════════════════════
  //  CONFERMA PROGRAMMAZIONE
  // ══════════════════════════════════════════════════════════════════════

  confirm() {
    const me = State.myPlayer();
    if (!me || me.confirmed) return;

    // Verifica che tutti i registri siano pieni
    if (me.registers.some(r => r === null)) {
      document.getElementById('prog-status').textContent =
        'Riempì tutti e 5 i registri prima di confermare.';
      return;
    }

    me.confirmed = true;
    this._stopTimer();

    // Invia i propri registri (host li raccoglie, gli altri aspettano)
    Net.sendToAll({
      type:      'PROGRAM_REGISTERS',
      registers: me.registers,
    });

    document.getElementById('prog-status').textContent = 'Confermato! In attesa degli altri…';
    document.getElementById('btn-confirm').disabled = true;
    this.render();
  },

  // HOST: riceve i registri di un guest
  onGuestConfirmed(fromId, msg) {
    this._confirmed[fromId] = msg.registers;

    // Aggiungi anche i miei se non ancora presenti
    const me = State.myPlayer();
    if (me?.confirmed && !this._confirmed[State.myId]) {
      this._confirmed[State.myId] = me.registers;
    }

    // Controlla se tutti hanno confermato
    const allIds = State.getPlayerList().map(p => p.id);
    if (allIds.every(id => this._confirmed[id])) {
      Net.broadcast({
        type:       'ALL_PROGRAMMED',
        allRegisters: this._confirmed,
      });
      this._onAllProgrammed({ allRegisters: this._confirmed });
    }
  },

  // Tutti hanno confermato (ricevuto da host)
  _onAllProgrammed(msg) {
    this._stopTimer();

    // Salva i registri di tutti (serviranno in Fase 4 per l'esecuzione)
    for (const [id, regs] of Object.entries(msg.allRegisters ?? {})) {
      if (State.players[id]) State.players[id].registers = regs;
    }

    // Fase 3: placeholder esecuzione → torna al tabellone
    document.getElementById('prog-status').textContent = '▶ Esecuzione turni... (Fase 4)';
    setTimeout(() => {
      UI.show('game');
      // Host avvia il round successivo dopo 2s
      if (State.isHost) {
        State.round = (State.round || 1) + 1;
        setTimeout(() => {
          Net.sendToAll({
            type:     'ROUND_START',
            round:    State.round,
            timerSec: CONFIG.programmingTimerSec,
          });
        }, 2000);
      }
    }, 1500);
  },

  // Esposto per Game.handleMessage
  handleGameMessage(fromId, msg) {
    switch (msg.type) {
      case 'ROUND_START':
        this.startRound(msg);
        break;
      case 'PROGRAM_REGISTERS':
        if (State.isHost) this.onGuestConfirmed(fromId, msg);
        break;
      case 'ALL_PROGRAMMED':
        if (!State.isHost) this._onAllProgrammed(msg);
        break;
    }
  },


  // ══════════════════════════════════════════════════════════════════════
  //  RENDERING UI (DOM)
  // ══════════════════════════════════════════════════════════════════════

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
      if (cardId) {
        slot.appendChild(this._makeCardEl(cardId, true, i, true));
      }
    }
  },

  _renderHand(me) {
    const row = document.getElementById('hand-row');
    if (!row) return;
    row.innerHTML = '';

    // Quante carte sono già nei registri
    const inRegs = new Set(me.registers.filter(Boolean));

    for (let i = 0; i < me.hand.length; i++) {
      const cardId = me.hand[i];
      const used = inRegs.has(cardId);
      row.appendChild(this._makeCardEl(cardId, false, i, used));
    }
  },

  /**
   * Crea un elemento DIV carta.
   * @param cardId  - id della carta
   * @param isReg   - true se è in un registro (click rimuove)
   * @param index   - indice (nella mano o nel registro)
   * @param dimmed  - true se già usata (in mano ma già in un registro)
   */
  _makeCardEl(cardId, isReg, index, dimmed) {
    const def = CONFIG.cards.find(c => c.id === cardId);
    const el  = document.createElement('div');

    el.className = 'game-card' + (dimmed && !isReg ? ' used' : '');
    el.title     = def?.desc ?? cardId;

    // Frame (background CSS)
    if (CONFIG.cardFrame) {
      el.style.backgroundImage = `url('${CONFIG.cardFrame}')`;
    } else {
      el.style.background = '#2a2010';
      el.style.border     = '2px solid #555';
    }

    // Icona nell'area immagine
    if (def?.image) {
      const iconDiv = document.createElement('div');
      iconDiv.className = 'card-icon-area';
      iconDiv.style.backgroundImage = `url('${def.image}')`;
      el.appendChild(iconDiv);
    }

    // Nome nell'area descrizione
    const nameDiv = document.createElement('div');
    nameDiv.className   = 'card-name-area';
    nameDiv.textContent = (def?.name ?? cardId).toUpperCase();
    el.appendChild(nameDiv);

    // Click handler
    if (!dimmed || isReg) {
      el.addEventListener('click', () => {
        const me = State.myPlayer();
        if (!me || me.confirmed) return;
        if (isReg) {
          this.onRegisterClick(index);
        } else {
          this.onCardClick(index);
        }
      });
    }

    return el;
  },

  _updateConfirmBtn(me) {
    me = me ?? State.myPlayer();
    const btn = document.getElementById('btn-confirm');
    if (!btn || !me) return;
    const allFilled = me.registers.every(r => r !== null);
    btn.disabled = !allFilled || me.confirmed;
    if (!me.confirmed) {
      const filled = me.registers.filter(Boolean).length;
      document.getElementById('prog-status').textContent =
        filled < CONFIG.registersCount
          ? `Registri: ${filled}/${CONFIG.registersCount}`
          : 'Tutti i registri pronti. Conferma!';
    }
  },
};
