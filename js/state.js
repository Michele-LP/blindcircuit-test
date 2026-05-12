// ═══════════════════════════════════════════════════════════════════════════
//  STATE.JS — Stato globale dell'applicazione.
//  v6: aggiunti execMode, execSpeed, execAdvance per la fase di esecuzione.
// ═══════════════════════════════════════════════════════════════════════════

const State = {

  // ── Rete ──────────────────────────────────────────────────────────────────
  peer:     null,
  conns:    {},
  conn:     null,
  myId:     null,
  isHost:   false,
  roomCode: null,

  // ── Giocatori ────────────────────────────────────────────────────────────
  players: {},

  // ── Fase ─────────────────────────────────────────────────────────────────
  phase: 'menu',

  // ── Partita ───────────────────────────────────────────────────────────────
  board:        null,
  round:        0,
  energyToken:  null,

  // ── Impostazioni esecuzione (configurabili in lobby dall'host) ────────────
  execMode:    'auto',  // 'auto' = avanza da solo | 'manual' = click "Avanti"
  execSpeed:   2,       // 1=lenta, 2=normale, 3=veloce, 4=test
  execAdvance: null,    // callback impostata da Execution.animate() per avanzare

  // ── Helper ─────────────────────────────────────────────────────────────────
  myPlayer()    { return this.players[this.myId] ?? null; },

  getPlayerList() {
    return Object.values(this.players).sort((a, b) => a.joinOrder - b.joinOrder);
  },

  allReady() {
    const ps = Object.values(this.players);
    return ps.length >= CONFIG.minPlayers && ps.every(p => p.ready);
  },

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
    this.execMode    = 'auto';
    this.execSpeed   = 2;
    this.execAdvance = null;
  },
};
