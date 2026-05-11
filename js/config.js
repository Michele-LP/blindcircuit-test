// ═══════════════════════════════════════════════════════════════════════════
//  CONFIG.JS
//  Tutte le costanti configurabili del gioco.
//  Modifica questo file per cambiare regole senza toccare la logica.
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = Object.freeze({

  // ── Rete ──────────────────────────────────────────────────────────────────
  peerPrefix:  'rr-v1-',   // prefisso peer ID — cambia se vuoi isolare l'ambiente
  peerDebug:   0,           // 0 = silenzioso | 2 = verbose (per debug di rete)

  // ── Partita ───────────────────────────────────────────────────────────────
  minPlayers:  2,           // minimo per avviare la partita
  maxPlayers:  6,           // massimo consentito in lobby

  // ── Programmazione ────────────────────────────────────────────────────────
  cardsDealt:          9,   // carte pescate a inizio turno (si riducono con danni)
  registersCount:      5,   // registri da programmare (P1..P5)
  programmingTimerSec: 30,  // secondi per programmare (0 = timer disabilitato)

  // ── Energia ──────────────────────────────────────────────────────────────
  startingEnergy:  3,       // energia iniziale per ogni robot
  rechargeAmount:  1,       // energia guadagnata su cella-ricarica a fine turno

  // ── Danni ─────────────────────────────────────────────────────────────────
  spamOnDamage:  1,         // carte SPAM ricevute per punto danno
  maxDamage:     5,         // danni oltre cui si entra in power-down forzato

  // ── Composizione mazzo personale (20 carte totali) ────────────────────────
  // Modifica le quantità per cambiare l'equilibrio del gioco.
  deckComposition: {
    move1:        3,
    move2:        3,
    move3:        2,
    backUp:       1,   // indietro di 1
    rotateRight:  3,
    rotateLeft:   3,
    uTurn:        1,   // inversione 180°
    again:        2,   // ripeti l'azione del registro precedente
    recharge:     2,   // ricarica energia, nessun movimento
  },

  // ── Personaggi giocabili ──────────────────────────────────────────────────
  // id:    chiave interna (non cambiare dopo aver iniziato)
  // name:  nome visualizzato
  // color: colore hex per UI e canvas
  // emoji: icona di fallback se lo sprite PNG non è disponibile
  characters: [
    { id: 'spin',    name: 'Spin Bot',    color: '#3b82f6', emoji: '🤖' },
    { id: 'hammer',  name: 'Hammer Bot',  color: '#ef4444', emoji: '🦾' },
    { id: 'zoom',    name: 'Zoom Bot',    color: '#f59e0b', emoji: '⚡' },
    { id: 'twonky',  name: 'Twonky',      color: '#10b981', emoji: '👾' },
    { id: 'hulk',    name: 'Hulk X90',    color: '#8b5cf6', emoji: '💪' },
    { id: 'trundle', name: 'Trundle Bot', color: '#ec4899', emoji: '🎯' },
  ],

  // ── Tabellone ─────────────────────────────────────────────────────────────
  defaultMap: 'exchange',   // file in assets/maps/<name>.json
  cellSize:   48,           // pixel per cella (fase 2)

  // ── Animazioni (fase 2) ───────────────────────────────────────────────────
  moveAnimMs:   200,        // durata animazione spostamento (ms)
  rotateAnimMs: 150,        // durata animazione rotazione (ms)

  // ── Carte azione (Fase 3) ─────────────────────────────────────────────────
  // image: percorso al PNG dell'icona da sovrapporre al frame CardFront_01.png
  // Immagini mancanti (da creare): spam, worm
  cardFrame: 'assets/cards/CardFront_01.png',
  cardBack:  'assets/cards/CardBack.png',

  cards: [
    { id: 'move1',       name: 'Avanza 1',       image: 'assets/cards/Forward1.png',  desc: 'Avanza di 1 cella' },
    { id: 'move2',       name: 'Avanza 2',       image: 'assets/cards/Forward2.png',  desc: 'Avanza di 2 celle' },
    { id: 'move3',       name: 'Avanza 3',       image: 'assets/cards/Forward3.png',  desc: 'Avanza di 3 celle' },
    { id: 'backUp',      name: 'Indietro',       image: 'assets/cards/Backward1.png', desc: 'Arretra di 1 cella' },
    { id: 'rotateRight', name: 'Gira Destra',    image: 'assets/cards/TurnRight.png', desc: 'Ruota 90° a destra' },
    { id: 'rotateLeft',  name: 'Gira Sinistra',  image: 'assets/cards/TurnLeft.png',  desc: 'Ruota 90° a sinistra' },
    { id: 'uTurn',       name: 'Inversione U',   image: 'assets/cards/TurnU.png',     desc: 'Inversione 180°' },
    { id: 'again',       name: 'Ripeti',         image: 'assets/cards/Repeat.png',    desc: 'Ripete il registro precedente' },
    { id: 'recharge',    name: 'Ricarica',       image: 'assets/cards/Recharge.png',  desc: 'Nessun movimento; +1 energia' },
    // Carte danno (immagini ancora mancanti)
    { id: 'spam',        name: 'SPAM',           image: null, desc: 'Azione casuale dagli scarti' },
    { id: 'worm',        name: 'WORM',           image: null, desc: 'Blocca un registro al prossimo turno' },
  ],


});
