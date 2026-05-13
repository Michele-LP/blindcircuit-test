// ═══════════════════════════════════════════════════════════════════════════
//  STATE.JS — v6.3
// ═══════════════════════════════════════════════════════════════════════════

const State = {

  peer: null, conns: {}, conn: null,
  myId: null, isHost: false, roomCode: null,
  players: {},
  phase: 'menu',
  board: null, round: 0, energyToken: null,

  execMode:      'auto',   // 'auto' | 'manual'
  execSpeed:     2,        // 1–4
  execAdvance:   null,     // callback per avanzare manualmente
  execAnimating: false,    // true durante Execution.animate() → blocca il sync

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
    this.peer          = null;
    this.conns         = {};
    this.conn          = null;
    this.myId          = null;
    this.isHost        = false;
    this.roomCode      = null;
    this.players       = {};
    this.phase         = 'menu';
    this.board         = null;
    this.round         = 0;
    this.energyToken   = null;
    this.execMode      = 'auto';
    this.execSpeed     = 2;
    this.execAdvance   = null;
    this.execAnimating = false;
  },
};
