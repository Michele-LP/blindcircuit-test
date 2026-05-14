// ═══════════════════════════════════════════════════════════════════════════
//  CONFIG.JS — v6.4
//
//  FIX v6.4:
//  ─ Composizione mazzo corretta secondo regolamento ufficiale (20 carte).
//    Fonte: RoboRally Rulebook 2023, pag. 11 "Card Index".
//    Modifiche rispetto alla v6.1:
//      move1:       3 → 4
//      move3:       2 → 1
//      rotateRight: 3 → 4
//      rotateLeft:  3 → 4
//      again:       2 → 1
//      recharge:    2 → 1  (= Power Up nel regolamento)
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = Object.freeze({

  version:  '6.4',
  gameName: 'BlindCircuit',

  // ── Rete ──────────────────────────────────────────────────────────────────
  peerPrefix: 'bc-v1-',
  peerDebug:  0,

  // ── Partita ───────────────────────────────────────────────────────────────
  minPlayers: 2,
  maxPlayers: 6,

  // ── Programmazione ────────────────────────────────────────────────────────
  cardsDealt:          9,
  registersCount:      5,
  programmingTimerSec: 0,   // 0 = nessun timer — solo il pulsante Conferma

  // ── Energia ──────────────────────────────────────────────────────────────
  startingEnergy:  3,
  maxEnergy:       10,
  rechargeAmount:  1,

  // ── Danni ─────────────────────────────────────────────────────────────────
  spamCardsOnFall: 2,
  spamOnDamage:    1,
  maxDamage:       5,

  // ── Composizione mazzo (20 carte per giocatore) ───────────────────────────
  //
  //  Carta          Copie   Note
  //  ───────────    ──────  ─────────────────────────────────────────────────
  //  Move 1           4     le più comuni
  //  Move 2           3     mediamente rare
  //  Move 3           1     rara e potente
  //  Move Back        1     retrocede senza cambiare facing
  //  Rotate Right     4     simmetrica con Rotate Left
  //  Rotate Left      4
  //  U-Turn           1     inversione 180°
  //  Again            1     ripete il registro precedente
  //  Power Up         1     +1 energia (nel codice: 'recharge')
  //  ───────────    ──────
  //  Totale          20
  //
  deckComposition: {
    move1:        4,   // FIX v6.4: era 3
    move2:        3,
    move3:        1,   // FIX v6.4: era 2
    backUp:       1,
    rotateRight:  4,   // FIX v6.4: era 3
    rotateLeft:   4,   // FIX v6.4: era 3
    uTurn:        1,
    again:        1,   // FIX v6.4: era 2
    recharge:     1,   // FIX v6.4: era 2 (= Power Up nel regolamento ufficiale)
  },

  // ── Personaggi ────────────────────────────────────────────────────────────
  characters: [
    { id: 'spin',    name: 'Spin Bot',    color: '#3b82f6', emoji: '🤖', sprite: 'assets/robots/BlueBot.png'   },
    { id: 'hammer',  name: 'Hammer Bot',  color: '#ef4444', emoji: '🦾', sprite: 'assets/robots/RedBot.png'    },
    { id: 'zoom',    name: 'Zoom Bot',    color: '#f59e0b', emoji: '⚡', sprite: 'assets/robots/YellowBot.png' },
    { id: 'twonky',  name: 'Twonky',      color: '#10b981', emoji: '👾', sprite: 'assets/robots/GreenBot.png'  },
    { id: 'hulk',    name: 'Hulk X90',    color: '#8b5cf6', emoji: '💪', sprite: 'assets/robots/PurpleBot.png' },
    { id: 'trundle', name: 'Trundle Bot', color: '#ec4899', emoji: '🎯', sprite: 'assets/robots/BrownBot.png'  },
  ],

  // ── Tabellone ─────────────────────────────────────────────────────────────
  defaultMap: 'exchange',
  cellSize:   40,

  // ── Immagini tile ─────────────────────────────────────────────────────────
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

  // ── Carte ─────────────────────────────────────────────────────────────────
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
    { id: 'spam',        name: 'SPAM',          image: null,                          desc: 'Esegue la prima carta non-SPAM dal tuo mazzo' },
    { id: 'worm',        name: 'WORM',          image: null,                          desc: 'Blocca un registro al prossimo turno' },
  ],
});
