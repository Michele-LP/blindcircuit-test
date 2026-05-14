// ═══════════════════════════════════════════════════════════════════════════
//  CONFIG.JS — v6.5
//
//  STRUTTURA:
//  ─ CONFIG  contiene i valori statici (percorsi asset, sprite, versione)
//             + i valori di gioco come FALLBACK (usati se rules.json non carica).
//             Non è più frozen perché Config.loadRules() li aggiorna a runtime.
//  ─ RULES   è il global che contiene i parametri di gioco dopo il caricamento
//             di rules.json. Include le definizioni WORM, composizione mazzi, ecc.
//             Tutto il nuovo codice usa RULES; il vecchio usa CONFIG (compatibile).
//  ─ Config.loadRules() carica assets/data/rules.json in modo asincrono e
//             aggiorna sia RULES che i campi di CONFIG corrispondenti.
//             Se il file non esiste o il fetch fallisce, il gioco usa i default.
//
//  UTILIZZO:
//    await Config.loadRules();   // in DOMContentLoaded, prima di abilitare i bottoni
//    RULES.worms                 // definizioni WORM
//    CONFIG.cardsDealt           // backward-compatible con tutto il codice esistente
// ═══════════════════════════════════════════════════════════════════════════

// ── Valori di default (fallback se rules.json non carica) ─────────────────
const CONFIG = {

  version:  '6.5',
  gameName: 'BlindCircuit',

  // Rete
  peerPrefix: 'bc-v1-',
  peerDebug:  0,

  // Partita
  minPlayers: 2,
  maxPlayers: 6,

  // Programmazione
  cardsDealt:          9,
  registersCount:      5,
  programmingTimerSec: 0,

  // Energia
  startingEnergy:  3,
  maxEnergy:       10,
  rechargeAmount:  1,

  // Danni
  spamCardsOnFall:    2,
  spamOnDamage:       1,
  boardLaserStrength: 1,
  robotLaserStrength: 1,

  // Composizione mazzo giocatore
  deckComposition: {
    move1:       4,
    move2:       3,
    move3:       1,
    backUp:      1,
    rotateRight: 4,
    rotateLeft:  4,
    uTurn:       1,
    again:       1,
    recharge:    1,
  },

  // Personaggi
  characters: [
    { id: 'spin',    name: 'Spin Bot',    color: '#3b82f6', emoji: '🤖', sprite: 'assets/robots/BlueBot.png'   },
    { id: 'hammer',  name: 'Hammer Bot',  color: '#ef4444', emoji: '🦾', sprite: 'assets/robots/RedBot.png'    },
    { id: 'zoom',    name: 'Zoom Bot',    color: '#f59e0b', emoji: '⚡', sprite: 'assets/robots/YellowBot.png' },
    { id: 'twonky',  name: 'Twonky',      color: '#10b981', emoji: '👾', sprite: 'assets/robots/GreenBot.png'  },
    { id: 'hulk',    name: 'Hulk X90',    color: '#8b5cf6', emoji: '💪', sprite: 'assets/robots/PurpleBot.png' },
    { id: 'trundle', name: 'Trundle Bot', color: '#ec4899', emoji: '🎯', sprite: 'assets/robots/BrownBot.png'  },
  ],

  // Tabellone
  defaultMap: 'exchange',
  cellSize:   40,

  // Immagini tile
  tileImages: {
    floor_a:    'assets/tiles/pavement_A.png',
    floor_b:    'assets/tiles/pavement_B.png',
    pit:        'assets/tiles/hole.png',
    conveyor:   'assets/tiles/beltForward1.png',
    express:    'assets/tiles/beltForward2.png',
    gear_cw:    'assets/tiles/rotationClockwise.png',
    gear_ccw:   'assets/tiles/rotationCounterClockwise.png',
    recharge:   'assets/tiles/recharge.png',
    push_panel: 'assets/tiles/spring_on.png',
    laser_src:  'assets/tiles/Laser_A.png',
    checkpoints: [
      'assets/tiles/Finish1.png',
      'assets/tiles/Finish2.png',
      'assets/tiles/Finish3.png',
    ],
  },

  boardBackground: 'assets/img/Plancia.jpg',

  cardFrame: null,
  cardBack:  null,

  cards: [
    { id: 'move1',       name: 'Avanza 1',      image: 'assets/cards/Forward1.png',  desc: 'Avanza di 1 cella' },
    { id: 'move2',       name: 'Avanza 2',      image: 'assets/cards/Forward2.png',  desc: 'Avanza di 2 celle' },
    { id: 'move3',       name: 'Avanza 3',      image: 'assets/cards/Forward3.png',  desc: 'Avanza di 3 celle' },
    { id: 'backUp',      name: 'Indietro',      image: 'assets/cards/Backward1.png', desc: 'Arretra di 1 cella' },
    { id: 'rotateRight', name: 'Gira Destra',   image: 'assets/cards/TurnRight.png', desc: 'Ruota 90° a destra' },
    { id: 'rotateLeft',  name: 'Gira Sinistra', image: 'assets/cards/TurnLeft.png',  desc: 'Ruota 90° a sinistra' },
    { id: 'uTurn',       name: 'U-Turn',        image: 'assets/cards/TurnU.png',     desc: 'Inversione 180°' },
    { id: 'again',       name: 'Ripeti',        image: 'assets/cards/Repeat.png',    desc: 'Ripete il registro precedente' },
    { id: 'recharge',    name: 'Power Up',      image: 'assets/cards/Recharge.png',  desc: '+1 energia' },
    { id: 'spam',        name: 'SPAM',          image: null, desc: 'Esegue la prima carta non-SPAM dal tuo mazzo' },
    { id: 'worm',        name: 'WORM',          image: null, desc: 'Sequenza caotica prestabilita nel registro' },
  ],
};

// ── RULES: parametri di gioco, sovrascrivibili via rules.json ─────────────
// Inizializzato con gli stessi valori di CONFIG come default.
let RULES = {
  game: {
    minPlayers:          CONFIG.minPlayers,
    maxPlayers:          CONFIG.maxPlayers,
    cardsDealt:          CONFIG.cardsDealt,
    registersCount:      CONFIG.registersCount,
    programmingTimerSec: CONFIG.programmingTimerSec,
  },
  energy: {
    startingEnergy: CONFIG.startingEnergy,
    maxEnergy:      CONFIG.maxEnergy,
    rechargeAmount: CONFIG.rechargeAmount,
  },
  lasers: {
    boardLaserStrength: CONFIG.boardLaserStrength,
    robotLaserStrength: CONFIG.robotLaserStrength,
  },
  damage: {
    spamCardsOnFall: CONFIG.spamCardsOnFall,
    damageDeck: {
      spam:         30,
      worm_blitz:    3,
      worm_spin:     3,
      worm_chaos:    3,
      worm_reverse:  2,
      worm_drunk:    2,
    },
  },
  playerDeck: { ...CONFIG.deckComposition },
  worms: [],   // popolato da rules.json
};

// ── Config: loader asincrono ───────────────────────────────────────────────
const Config = {

  async loadRules() {
    const paths = ['assets/data/rules.json', 'data/rules.json', 'rules.json'];
    for (const path of paths) {
      try {
        const r = await fetch(path);
        if (!r.ok) continue;
        const data = await r.json();
        this._apply(data);
        console.log(`[Config] rules.json caricato da ${path}`);
        return true;
      } catch (_) {}
    }
    console.warn('[Config] rules.json non trovato — uso valori di default');
    return false;
  },

  // Applica le regole caricate su RULES e sincronizza CONFIG per compatibilità
  _apply(data) {
    // Deep merge in RULES
    RULES = this._merge(RULES, data);

    // Sincronizza i campi di CONFIG usati dal codice esistente
    if (data.game) {
      if (data.game.minPlayers          != null) CONFIG.minPlayers          = data.game.minPlayers;
      if (data.game.maxPlayers          != null) CONFIG.maxPlayers          = data.game.maxPlayers;
      if (data.game.cardsDealt          != null) CONFIG.cardsDealt          = data.game.cardsDealt;
      if (data.game.registersCount      != null) CONFIG.registersCount      = data.game.registersCount;
      if (data.game.programmingTimerSec != null) CONFIG.programmingTimerSec = data.game.programmingTimerSec;
    }
    if (data.energy) {
      if (data.energy.startingEnergy != null) CONFIG.startingEnergy = data.energy.startingEnergy;
      if (data.energy.maxEnergy      != null) CONFIG.maxEnergy      = data.energy.maxEnergy;
      if (data.energy.rechargeAmount != null) CONFIG.rechargeAmount = data.energy.rechargeAmount;
    }
    if (data.lasers) {
      if (data.lasers.boardLaserStrength != null) CONFIG.boardLaserStrength = data.lasers.boardLaserStrength;
      if (data.lasers.robotLaserStrength != null) CONFIG.robotLaserStrength = data.lasers.robotLaserStrength;
    }
    if (data.damage) {
      if (data.damage.spamCardsOnFall != null) CONFIG.spamCardsOnFall = data.damage.spamCardsOnFall;
    }
    if (data.playerDeck) {
      CONFIG.deckComposition = { ...CONFIG.deckComposition, ...data.playerDeck };
    }
  },

  _merge(target, source) {
    if (!source || typeof source !== 'object') return target;
    const out = { ...target };
    for (const [k, v] of Object.entries(source)) {
      if (k === '_comment') continue;
      if (v !== null && typeof v === 'object' && !Array.isArray(v) &&
          typeof out[k] === 'object' && !Array.isArray(out[k])) {
        out[k] = this._merge(out[k], v);
      } else {
        out[k] = v;
      }
    }
    return out;
  },
};
