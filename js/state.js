// ═══════════════════════════════════════════════════════════════════════════
//  STATE.JS
//  Stato globale dell'applicazione.
//  Contiene SOLO dati — la logica sta negli altri moduli.
//
//  Struttura players:
//  {
//    "<peerId>": {
//      id:        string,
//      nickname:  string,
//      character: string | null,   // id personaggio da CONFIG.characters
//      ready:     boolean,
//      isHost:    boolean,
//      joinOrder: number           // 0 = host, 1 = primo guest, ecc.
//    }
//  }
// ═══════════════════════════════════════════════════════════════════════════

const State = {

  // ── Rete ──────────────────────────────────────────────────────────────────
  peer:     null,    // istanza PeerJS locale
  conns:    {},      // { peerId: DataConnection } — popolato solo dall'host
  conn:     null,    // DataConnection verso l'host — usato solo dai guest
  myId:     null,    // peer ID locale (stringa)
  isHost:   false,
  roomCode: null,    // 6 caratteri visibili agli utenti

  // ── Giocatori ────────────────────────────────────────────────────────────
  players: {},

  // ── Fase ─────────────────────────────────────────────────────────────────
  // 'menu' | 'lobby' | 'game'
  phase: 'menu',

  // ── Partita (riempito quando phase === 'game') ────────────────────────────
  board:        null,  // dati mappa (dal JSON)
  round:        0,     // numero round corrente
  energyToken:  null,  // peerId del possessore del token energia

  // ── Helper: il mio player object ─────────────────────────────────────────
  myPlayer() {
    return this.players[this.myId] ?? null;
  },

  // ── Helper: tutti i giocatori ordinati per joinOrder ─────────────────────
  getPlayerList() {
    return Object.values(this.players)
      .sort((a, b) => a.joinOrder - b.joinOrder);
  },

  // ── Helper: tutti pronti E minimo raggiunto? ──────────────────────────────
  allReady() {
    const ps = Object.values(this.players);
    return ps.length >= CONFIG.minPlayers &&
           ps.every(p => p.ready);
  },

  // ── Pulisce tutto per tornare al menu ────────────────────────────────────
  reset() {
    if (this.peer) { try { this.peer.destroy(); } catch (_) {} }
    this.peer        = null;
    this.conns       = {};
    this.conn        = null;
    this.myId        = null;
    this.isHost      = false;
    this.roomCode    = null;
    this.players     = {};
    this.phase       = 'menu';
    this.board       = null;
    this.round       = 0;
    this.energyToken = null;
  },
};
