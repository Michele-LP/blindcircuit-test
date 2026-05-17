// ═══════════════════════════════════════════════════════════════════════════
//  CONFIG.JS — v6.7
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  version: '6.8', gameName: 'BlindCircuit',
  peerPrefix: 'bc-v1-', peerDebug: 0,
  minPlayers: 2, maxPlayers: 6,
  cardsDealt: 9, registersCount: 5, programmingTimerSec: 0,
  startingEnergy: 3, maxEnergy: 10, rechargeAmount: 1,
  spamCardsOnFall: 2, spamOnDamage: 1, boardLaserStrength: 1, robotLaserStrength: 1,
  deckComposition: { move1:4, move2:3, move3:1, backUp:1, rotateRight:4, rotateLeft:4, uTurn:1, again:1, recharge:1 },
  characters: [
    { id:'jax',   name:'Jax',   color:'#3b82f6', emoji:'🤖', sprite:'assets/robots/BlueBot.png' },
    { id:'gerry', name:'Gerry', color:'#ef4444', emoji:'🦾', sprite:'assets/robots/RedBot.png' },
    { id:'bolt',   name:'Bolt',   color:'#f59e0b', emoji:'⚡', sprite:'assets/robots/YellowBot.png' },
    { id:'fritz', name:'Fritz',     color:'#10b981', emoji:'👾', sprite:'assets/robots/GreenBot.png' },
    { id:'pixie',   name:'Pixie',   color:'#8b5cf6', emoji:'💪', sprite:'assets/robots/PurpleBot.png' },
    { id:'rusty',name:'Rusty',color:'#996600', emoji:'🎯', sprite:'assets/robots/BrownBot.png' },
  ],
  defaultMap: 'factory_floor', cellSize: 40,
  availableMaps: [
    { id: 'exchange',      name: 'Exchange',      file: 'assets/maps/exchange.json' },
    { id: 'factory_floor', name: 'Factory Floor',  file: 'assets/maps/factory_floor.json' },
    // Aggiungi nuove mappe qui dopo averle create col Map Builder:
  ],
  tileImages: {
    floor_a:'assets/tiles/pavement_A.png', floor_b:'assets/tiles/pavement_B.png',
    pit:'assets/tiles/hole.png', conveyor:'assets/tiles/beltForward1.png', express:'assets/tiles/beltForward2.png',
    conveyor_turn_left:'assets/tiles/beltTurnLeft1.png', conveyor_turn_right:'assets/tiles/beltTurnRight1.png',
    express_turn_left:'assets/tiles/beltTurnLeft2.png', express_turn_right:'assets/tiles/beltTurnRight2.png',
    gear_cw:'assets/tiles/rotationClockwise.png', gear_ccw:'assets/tiles/rotationCounterClockwise.png',
    recharge:'assets/tiles/recharge.png', push_panel:'assets/tiles/spring_on.png', laser_src:'assets/tiles/Laser_A.png',
    checkpoints:['assets/tiles/Finish1.png','assets/tiles/Finish2.png','assets/tiles/Finish3.png'],
  },
  boardBackground: 'assets/img/Plancia.jpg',
  cardFrame: null, cardBack: null,
  cards: [
    { id:'move1',      name:'Avanza 1',     image:'assets/cards/Forward1.png',  desc:'Avanza di 1 cella' },
    { id:'move2',      name:'Avanza 2',     image:'assets/cards/Forward2.png',  desc:'Avanza di 2 celle' },
    { id:'move3',      name:'Avanza 3',     image:'assets/cards/Forward3.png',  desc:'Avanza di 3 celle' },
    { id:'backUp',     name:'Indietro',     image:'assets/cards/Backward1.png', desc:'Arretra di 1 cella' },
    { id:'rotateRight',name:'Gira Destra',  image:'assets/cards/TurnRight.png', desc:'Ruota 90° a destra' },
    { id:'rotateLeft', name:'Gira Sinistra',image:'assets/cards/TurnLeft.png',  desc:'Ruota 90° a sinistra' },
    { id:'uTurn',      name:'U-Turn',       image:'assets/cards/TurnU.png',     desc:'Inversione 180°' },
    { id:'again',      name:'Ripeti',       image:'assets/cards/Repeat.png',    desc:'Ripete il registro precedente' },
    { id:'recharge',   name:'Power Up',     image:'assets/cards/Recharge.png',  desc:'+1 energia' },
    { id:'spam',       name:'SPAM',         image:null, desc:'Esegue la prima carta non-SPAM dal mazzo' },
    { id:'worm',       name:'WORM',         image:null, desc:'Sequenza caotica nel registro' },
  ],

  // ── Audio v6.8.2 ───────────────────────────────────────────────────────
  audio: {
    masterVolume: 0.6,
    sfxVolume: 0.7,
    bgVolume: 0.25,
    bgMuted: false,
    // true = attivo, false = disabilitato per singolo suono
    sounds: {
      robot_move:true, robot_rotate:true, robot_uturn:true,
      push:true, piston:true, fall:true, land:true,
      robot_laser:true, cell_laser:true,
      gear:true, recharge:true, conveyor1:true, conveyor2:true,
      damage:true, damage_fall:true, damage_laser:true,
      round_start:true, wall_hit:true, checkpoint:true, victory:true,
      card_play:true, confirm:true, energy:true, ui_click:true,
    },
  },
};

let RULES = {
  game:       { ...CONFIG },
  energy:     { startingEnergy:CONFIG.startingEnergy, maxEnergy:CONFIG.maxEnergy, rechargeAmount:CONFIG.rechargeAmount },
  lasers:     { boardLaserStrength:1, robotLaserStrength:1 },
  damage:     { spamCardsOnFall:2, damageDeck:{ spam:30,worm_blitz:3,worm_spin:3,worm_chaos:3,worm_reverse:2,worm_drunk:2 } },
  playerDeck: { ...CONFIG.deckComposition },
  worms:      [],
};

const Config = {
  async loadRules() {
    for (const path of ['assets/data/rules.json','data/rules.json','rules.json']) {
      try { const r=await fetch(path); if(!r.ok)continue; const d=await r.json(); this._apply(d); console.log(`[Config] rules da ${path}`); return true; } catch(_){}
    }
    console.warn('[Config] rules.json non trovato — default'); return false;
  },
  _apply(d) {
    RULES = this._merge(RULES, d);
    if(d.game){
      ['minPlayers','maxPlayers','cardsDealt','registersCount','programmingTimerSec'].forEach(k=>{if(d.game[k]!=null)CONFIG[k]=d.game[k];});
    }
    if(d.energy){['startingEnergy','maxEnergy','rechargeAmount'].forEach(k=>{if(d.energy[k]!=null)CONFIG[k]=d.energy[k];});}
    if(d.lasers){if(d.lasers.boardLaserStrength!=null)CONFIG.boardLaserStrength=d.lasers.boardLaserStrength;if(d.lasers.robotLaserStrength!=null)CONFIG.robotLaserStrength=d.lasers.robotLaserStrength;}
    if(d.damage?.spamCardsOnFall!=null)CONFIG.spamCardsOnFall=d.damage.spamCardsOnFall;
    if(d.playerDeck)CONFIG.deckComposition={...CONFIG.deckComposition,...d.playerDeck};
  },
  _merge(t,s){if(!s||typeof s!=='object')return t;const o={...t};for(const[k,v]of Object.entries(s)){if(k==='_comment')continue;if(v&&typeof v==='object'&&!Array.isArray(v)&&typeof o[k]==='object'&&!Array.isArray(o[k]))o[k]=this._merge(o[k],v);else o[k]=v;}return o;},
};
