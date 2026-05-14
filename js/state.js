// ═══════════════════════════════════════════════════════════════════════════
//  STATE.JS — v6.5
//
//  NOVITÀ:
//  ─ damageDeck / damageDiscard: mazzo danno condiviso tra tutti i giocatori.
//    Contiene carte 'spam' e ID di WORM (es. 'worm_blitz').
//    Inizializzato dall'host in Lobby.startGame() e inviato via GAME_START.
//  ─ Per ogni player in State.players viene aggiunto:
//    player.wormSlots = { 0: null, 1: null, 2: 'worm_blitz', ... }
//    Chiave = indice registro (0-4), valore = ID worm o null.
//    Persistono tra round: il WORM eseguito in round N libera lo slot in round N+1.
// ═══════════════════════════════════════════════════════════════════════════

const State = {

  peer: null, conns: {}, conn: null,
  myId: null, isHost: false, roomCode: null,
  players: {},
  phase: 'menu',
  board: null, round: 0, energyToken: null,

  execMode:      'auto',
  execSpeed:     2,
  execAdvance:   null,
  execAnimating: false,

  // ── Mazzo danno condiviso ─────────────────────────────────────────────────
  // Costruito dall'host in Lobby.startGame() a partire da RULES.damage.damageDeck.
  // Ogni elemento è 'spam' oppure un ID worm (es. 'worm_blitz').
  // Distribuito a tutti i client via GAME_START.
  damageDeck:    [],
  damageDiscard: [],

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
    this.damageDeck    = [];
    this.damageDiscard = [];
  },
};
