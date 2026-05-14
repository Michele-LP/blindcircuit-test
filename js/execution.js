// ═══════════════════════════════════════════════════════════════════════════
//  EXECUTION.JS — v6.5
//
//  NOVITÀ rispetto a v6.4:
//
//  ── Sistema danno riscritto ────────────────────────────────────────────────
//  Prima: laser → spam direttamente nel discard personale.
//  Ora:   laser → drawDamage() → pesca dal mazzo danno CONDIVISO (damageDeck):
//    · carta 'spam'   → va nel discard personale del giocatore (come prima)
//    · carta 'worm_x' → va in wormSlots[currentReg] del giocatore
//                        → nel PROSSIMO round, quel registro è bloccato
//
//  ── execWorm(simShared, sim, id, reg, wormId) ──────────────────────────────
//  Esegue la sequenza caotica del WORM (definita in RULES.worms) al posto della
//  carta programmazione. Dopo l'esecuzione, lo slot viene liberato e il WORM
//  va nel damageDiscard condiviso (per essere rimescolato in futuro).
//
//  ── Loop compute() ────────────────────────────────────────────────────────
//  Per ogni registro, per ogni giocatore: se registers[reg] è un WORM ID
//  (inizia con 'worm_') esegue execWorm, altrimenti esegue la carta normale.
//
//  ── Fix execCard('spam') ───────────────────────────────────────────────────
//  La carta pescata dal deck durante l'esecuzione SPAM viene aggiunta al discard
//  del giocatore (prima andava persa), garantendo che nessuna carta sparisca.
//
//  ── deck_sync aggiornato ──────────────────────────────────────────────────
//  Ora sincronizza anche il discard (non solo il deck), e include un'azione
//  'damage_deck_sync' che allinea damageDeck/damageDiscard su tutti i client.
//
//  ── Forza laser configurabile ─────────────────────────────────────────────
//  fireLasers e fireRobotWeapons leggono la forza da RULES (boardLaserStrength,
//  robotLaserStrength) con fallback a CONFIG. Per i laser di bordo, se il JSON
//  della mappa specifica 'strength', usa quello (più specifico vince).
//
//  ── wormSlots in ROUND_START ──────────────────────────────────────────────
//  onExecutionEnd invia i wormSlots aggiornati di ogni giocatore insieme al
//  ROUND_START, così tutti i client mostrano correttamente i registri bloccati.
// ═══════════════════════════════════════════════════════════════════════════

const Execution = (() => {

  const ACTION_DELAYS = [650, 380, 200, 80];
  const REG_DELAYS    = [1400, 800, 400, 120];

  let _cancelled = { value: false };

  const VECS  = { N:[0,-1], E:[1,0], S:[0,1], W:[-1,0] };
  const ROT_R = { N:'E', E:'S', S:'W', W:'N' };
  const ROT_L = { N:'W', W:'S', S:'E', E:'N' };
  const OPP   = { N:'S', S:'N', E:'W', W:'E' };

  function rotRight(d) { return ROT_R[d] ?? d; }
  function rotLeft(d)  { return ROT_L[d] ?? d; }
  function rotU(d)     { return rotRight(rotRight(d)); }

  function _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ── Utility ──────────────────────────────────────────────────────────────

  function wallBlocks(cx, cy, dir) {
    if (Board.wallsAt(cx, cy).includes(dir)) return true;
    const v = VECS[dir];
    if (Board.wallsAt(cx + v[0], cy + v[1]).includes(OPP[dir])) return true;
    return false;
  }

  function respawnPos(s) {
    if (s.lastCheckpoint > 0) {
      const cp = (Board.data?.checkpoints ?? []).find(c => c.order === s.lastCheckpoint);
      if (cp) return { cx: cp.x, cy: cp.y };
    }
    return { cx: s.startCx, cy: s.startCy };
  }

  // ── Pesca dal mazzo danno condiviso ───────────────────────────────────────
  //
  // Viene chiamata ogni volta che un laser (di bordo o di robot) colpisce.
  // 'regIndex' indica il registro in esecuzione al momento del colpo:
  //   - carta 'spam'   → discard personale (pescata nei round futuri)
  //   - carta 'worm_x' → wormSlots[regIndex] (blocca il registro nel prossimo round)
  //
  // Restituisce un'azione { type:'damage', id, card, regIndex } da inserire nel piano.
  // Restituisce null se il mazzo e lo scarto sono entrambi vuoti (non dovrebbe succedere).
  function drawDamage(simShared, simPlayer, regIndex) {
    if (!simShared.damageDeck.length) {
      if (!simShared.damageDiscard.length) return null;
      simShared.damageDeck    = _shuffle([...simShared.damageDiscard]);
      simShared.damageDiscard = [];
    }
    const card = simShared.damageDeck.pop();

    if (card === 'spam') {
      simPlayer.discard = simPlayer.discard ?? [];
      simPlayer.discard.unshift('spam');
    } else {
      // WORM: blocca il registro corrente per il prossimo round
      simPlayer.wormSlots = simPlayer.wormSlots ?? {};
      simPlayer.wormSlots[regIndex] = card;
    }

    return { type: 'damage', id: simPlayer.id, card, regIndex };
  }

  // ── Esecuzione sequenza WORM ──────────────────────────────────────────────
  //
  // Esegue la sequenza caotica definita in RULES.worms[wormId].sequence.
  // Ogni passo riusa le funzioni esistenti (moveSteps, rotLeft/Right/U).
  // Al termine: libera lo slot e manda il WORM nel damageDiscard condiviso.
  function execWorm(simShared, sim, id, reg, wormId) {
    const s       = sim[id];
    const wormDef = (RULES?.worms ?? []).find(w => w.id === wormId);
    const actions = [];

    if (wormDef) {
      for (const step of wormDef.sequence) {
        switch (step.type) {
          case 'move':        actions.push(...moveSteps(sim, id, step.steps ?? 1));  break;
          case 'backUp':      actions.push(...moveSteps(sim, id, -(step.steps ?? 1))); break;
          case 'rotateLeft':  s.dir = rotLeft(s.dir);  actions.push({ type:'rotate', id, dir: s.dir }); break;
          case 'rotateRight': s.dir = rotRight(s.dir); actions.push({ type:'rotate', id, dir: s.dir }); break;
          case 'uTurn':       s.dir = rotU(s.dir);     actions.push({ type:'rotate', id, dir: s.dir }); break;
        }
      }
    }

    // Libera lo slot e restituisce il WORM al mazzo danno (scarto)
    if (s.wormSlots) s.wormSlots[reg] = null;
    simShared.damageDiscard.push(wormId);
    actions.push({ type: 'worm_clear', id, reg });

    return actions;
  }

  // ── Push a catena ─────────────────────────────────────────────────────────

  function tryPush(sim, pushedId, dir, actions) {
    const s = sim[pushedId];
    if (wallBlocks(s.cx, s.cy, dir)) return false;
    const vec = VECS[dir];
    const nx  = s.cx + vec[0];
    const ny  = s.cy + vec[1];

    if (!Board.inBounds(nx, ny)) {
      const rp = respawnPos(s);
      s.cx = rp.cx; s.cy = rp.cy;
      for (let j = 0; j < CONFIG.spamCardsOnFall; j++) s.discard.unshift('spam');
      actions.push({ type:'fall', id: pushedId, cx: nx, cy: ny, respawnCx: rp.cx, respawnCy: rp.cy });
      return true;
    }
    if (Board.cellType(nx, ny) === 'pit') {
      const rp = respawnPos(s);
      s.cx = rp.cx; s.cy = rp.cy;
      for (let j = 0; j < CONFIG.spamCardsOnFall; j++) s.discard.unshift('spam');
      actions.push({ type:'fall', id: pushedId, cx: nx, cy: ny, respawnCx: rp.cx, respawnCy: rp.cy });
      return true;
    }
    const blocker = Object.values(sim).find(o => o.id !== pushedId && o.cx === nx && o.cy === ny);
    if (blocker && !tryPush(sim, blocker.id, dir, actions)) return false;
    s.cx = nx; s.cy = ny;
    actions.push({ type:'move', id: pushedId, cx: nx, cy: ny });
    return true;
  }

  // ── Carte programmazione ──────────────────────────────────────────────────

  function execCard(sim, id, card, prevCard) {
    const s = sim[id];
    switch (card) {
      case 'move1':       return moveSteps(sim, id,  1);
      case 'move2':       return moveSteps(sim, id,  2);
      case 'move3':       return moveSteps(sim, id,  3);
      case 'backUp':      return moveSteps(sim, id, -1);
      case 'rotateRight': { s.dir = rotRight(s.dir); return [{ type:'rotate', id, dir:s.dir }]; }
      case 'rotateLeft':  { s.dir = rotLeft(s.dir);  return [{ type:'rotate', id, dir:s.dir }]; }
      case 'uTurn':       { s.dir = rotU(s.dir);     return [{ type:'rotate', id, dir:s.dir }]; }
      case 'again':
        if (prevCard) return execCard(sim, id, prevCard, null);
        return execCard(sim, id, 'spam', null);   // registro 1: agisce come SPAM
      case 'recharge': {
        s.energy = Math.min((s.energy ?? 0) + CONFIG.rechargeAmount, CONFIG.maxEnergy);
        return [{ type:'energy', id, energy: s.energy }];
      }
      case 'spam': {
        // Pesca dal deck del giocatore (non dal discard).
        // FIX: la carta pescata viene aggiunta al discard PRIMA di essere eseguita,
        // così non scompare dal mazzo del giocatore tra un round e l'altro.
        if (!s.deck?.length) {
          if (!s.discard?.length) return [];
          s.deck    = _shuffle([...s.discard]);
          s.discard = [];
        }
        while (s.deck.length) {
          const drawn = s.deck.pop();
          if (drawn !== 'spam') {
            s.discard.push(drawn);          // carta "usata": torna nel ciclo
            return execCard(sim, id, drawn, null);
          }
          // Altra SPAM pescata: viene eliminata dal ciclo (chain)
        }
        return [];
      }
      default: return [];
    }
  }

  // ── Movimento con spinta ──────────────────────────────────────────────────

  function moveSteps(sim, id, steps) {
    const s   = sim[id];
    const dir = steps > 0 ? s.dir : OPP[s.dir];
    const vec = VECS[dir];
    const actions = [];

    for (let i = 0; i < Math.abs(steps); i++) {
      if (wallBlocks(s.cx, s.cy, dir)) break;
      const nx  = s.cx + vec[0];
      const ny  = s.cy + vec[1];
      const oob = !Board.inBounds(nx, ny);
      const pit = !oob && Board.cellType(nx, ny) === 'pit';

      if (oob || pit) {
        const rp = respawnPos(s);
        s.cx = rp.cx; s.cy = rp.cy;
        for (let j = 0; j < CONFIG.spamCardsOnFall; j++) {
          s.discard = s.discard ?? [];
          s.discard.unshift('spam');
        }
        actions.push({ type:'fall', id, cx: nx, cy: ny, respawnCx: rp.cx, respawnCy: rp.cy });
        break;
      }
      const blocker = Object.values(sim).find(o => o.id !== id && o.cx === nx && o.cy === ny);
      if (blocker) {
        const pushActions = [];
        if (!tryPush(sim, blocker.id, dir, pushActions)) break;
        actions.push(...pushActions);
      }
      s.cx = nx; s.cy = ny;
      actions.push({ type:'move', id, cx: nx, cy: ny });
    }
    return actions;
  }

  // ── Nastri trasportatori ──────────────────────────────────────────────────

  function applyConveyors(sim, beltType) {
    const actions = [];
    const onBelt  = Object.values(sim).filter(s => Board._cellAt(s.cx, s.cy)?.type === beltType);
    if (!onBelt.length) return actions;

    const intended = new Map();
    for (const s of onBelt) {
      const cell = Board._cellAt(s.cx, s.cy);
      const dir  = cell.dir;
      if (wallBlocks(s.cx, s.cy, dir)) { intended.set(s.id, null); continue; }
      const vec = VECS[dir];
      const nx  = s.cx + vec[0];
      const ny  = s.cy + vec[1];
      if (!Board.inBounds(nx, ny)) { intended.set(s.id, null); continue; }
      intended.set(s.id, { nx, ny });
    }
    const destCount = new Map();
    for (const [, move] of intended) {
      if (!move) continue;
      const k = `${move.nx},${move.ny}`;
      destCount.set(k, (destCount.get(k) || 0) + 1);
    }
    for (const [id, move] of intended) {
      if (!move) continue;
      if ((destCount.get(`${move.nx},${move.ny}`) || 0) > 1) intended.set(id, null);
    }
    for (const [id, move] of intended) {
      if (!move) continue;
      const isBlocked = Object.values(sim).some(o => {
        if (o.id === id || o.cx !== move.nx || o.cy !== move.ny) return false;
        const tm = intended.get(o.id);
        return tm === undefined || tm === null;
      });
      if (isBlocked) intended.set(id, null);
    }
    for (const [id, move] of intended) {
      if (!move) continue;
      const s = sim[id];
      if (Board.cellType(move.nx, move.ny) === 'pit') {
        const rp = respawnPos(s);
        s.cx = rp.cx; s.cy = rp.cy;
        for (let j = 0; j < CONFIG.spamCardsOnFall; j++) s.discard.unshift('spam');
        actions.push({ type:'fall', id, cx: move.nx, cy: move.ny, respawnCx: rp.cx, respawnCy: rp.cy });
      } else {
        s.cx = move.nx; s.cy = move.ny;
        actions.push({ type:'move', id, cx: move.nx, cy: move.ny });
      }
    }
    return actions;
  }

  // ── Push panel ────────────────────────────────────────────────────────────

  function applyPushPanels(sim, regIndex) {
    const actions = [];
    for (const s of Object.values(sim)) {
      const cell = Board._cellAt(s.cx, s.cy);
      if (!cell || cell.type !== 'push_panel') continue;
      if (!(cell.activeRegisters ?? []).includes(regIndex + 1)) continue;
      const pa = [];
      tryPush(sim, s.id, cell.dir, pa);
      actions.push(...pa);
    }
    return actions;
  }

  // ── Ingranaggi ────────────────────────────────────────────────────────────

  function applyGears(sim) {
    const actions = [];
    for (const s of Object.values(sim)) {
      const cell = Board._cellAt(s.cx, s.cy);
      if (!cell) continue;
      if (cell.type === 'gear_cw')  { s.dir = rotRight(s.dir); actions.push({ type:'rotate', id: s.id, dir: s.dir }); }
      if (cell.type === 'gear_ccw') { s.dir = rotLeft(s.dir);  actions.push({ type:'rotate', id: s.id, dir: s.dir }); }
    }
    return actions;
  }

  // ── Laser di bordo ────────────────────────────────────────────────────────
  // Ora chiama drawDamage() invece di aggiungere spam direttamente.
  // 'strength' viene letto prima dal JSON della mappa (laser-specifico),
  // poi da RULES.lasers.boardLaserStrength, infine da CONFIG come fallback.
  function fireLasers(simShared, sim, currentReg) {
    const actions = [];
    const defaultStrength = RULES?.lasers?.boardLaserStrength ?? CONFIG.boardLaserStrength ?? 1;
    for (const laser of Board.data?.lasers ?? []) {
      const strength = laser.strength ?? defaultStrength;
      const vec = VECS[laser.dir];
      let lx = laser.x + vec[0], ly = laser.y + vec[1];
      while (Board.inBounds(lx, ly)) {
        const hit = Object.values(sim).find(s => s.cx === lx && s.cy === ly);
        if (hit) {
          for (let i = 0; i < strength; i++) {
            const dmg = drawDamage(simShared, hit, currentReg);
            if (dmg) actions.push(dmg);
          }
          break;
        }
        if (wallBlocks(lx, ly, laser.dir)) break;
        lx += vec[0]; ly += vec[1];
      }
    }
    return actions;
  }

  // ── Laser dei robot ───────────────────────────────────────────────────────
  // Stesso meccanismo: drawDamage invece di spam diretto.
  // Forza configurabile via RULES.lasers.robotLaserStrength.
  function fireRobotWeapons(simShared, sim, currentReg) {
    const actions  = [];
    const strength = RULES?.lasers?.robotLaserStrength ?? CONFIG.robotLaserStrength ?? 1;
    for (const id of turnOrder()) {
      const shooter = sim[id];
      if (!shooter) continue;
      if (wallBlocks(shooter.cx, shooter.cy, shooter.dir)) continue;
      const vec = VECS[shooter.dir];
      let lx = shooter.cx + vec[0];
      let ly = shooter.cy + vec[1];
      while (Board.inBounds(lx, ly)) {
        const hit = Object.values(sim).find(s => s.id !== id && s.cx === lx && s.cy === ly);
        if (hit) {
          for (let i = 0; i < strength; i++) {
            const dmg = drawDamage(simShared, hit, currentReg);
            if (dmg) actions.push(dmg);
          }
          break;
        }
        if (wallBlocks(lx, ly, shooter.dir)) break;
        lx += vec[0]; ly += vec[1];
      }
    }
    return actions;
  }

  // ── Checkpoint ────────────────────────────────────────────────────────────

  function checkCheckpoint(s) {
    const cps  = Board.data?.checkpoints ?? [];
    const next = (s.lastCheckpoint ?? 0) + 1;
    const cp   = cps.find(c => c.order === next && c.x === s.cx && c.y === s.cy);
    if (!cp) return null;
    s.lastCheckpoint = next;
    return { type:'checkpoint', id: s.id, order: next, won: next >= cps.length };
  }

  // ── Ordine di turno ───────────────────────────────────────────────────────

  function turnOrder() {
    const all  = State.getPlayerList();
    const idx  = all.findIndex(p => p.id === State.energyToken);
    const from = idx >= 0 ? idx : 0;
    return [...all.slice(from), ...all.slice(0, from)].map(p => p.id);
  }

  // ── Applicazione azioni (durante l'animazione) ────────────────────────────

  function applyAction(a) {
    // damage_deck_sync non ha un id giocatore: gestito come caso speciale
    if (a.type === 'damage_deck_sync') {
      State.damageDeck    = a.damageDeck;
      State.damageDiscard = a.damageDiscard;
      return;
    }

    const p = State.players[a.id];
    if (!p) return;

    switch (a.type) {
      case 'move':   p.cx = a.cx; p.cy = a.cy; break;
      case 'rotate': p.dir = a.dir; break;
      case 'fall':   p.cx = a.respawnCx; p.cy = a.respawnCy; break;
      case 'checkpoint':
        p.lastCheckpoint = a.order;
        if (!p.checkpoints) p.checkpoints = [];
        if (!p.checkpoints.includes(a.order)) p.checkpoints.push(a.order);
        break;
      case 'energy': p.energy = a.energy; break;

      case 'damage':
        // Danno ricevuto da un laser (bordo o robot).
        // 'spam' → discard personale. 'worm_x' → blocca registro.
        if (a.card === 'spam') {
          if (!p.discard) p.discard = [];
          p.discard.unshift('spam');
        } else {
          if (!p.wormSlots) p.wormSlots = {};
          p.wormSlots[a.regIndex] = a.card;
        }
        break;

      case 'worm_clear':
        // Il WORM ha eseguito: libera lo slot (il damage_deck_sync sincronizza il mazzo).
        if (p.wormSlots) p.wormSlots[a.reg] = null;
        break;

      case 'deck_sync':
        if (a.deck    !== undefined) p.deck    = a.deck;
        if (a.discard !== undefined) p.discard = a.discard;
        break;
    }
  }

  // ── Fine esecuzione ───────────────────────────────────────────────────────

  function onExecutionEnd(winner) {
    if (winner) {
      const name = State.players[winner]?.nickname ?? 'Qualcuno';
      document.getElementById('win-player').textContent = name;
      UI.show('win');
      return;
    }
    if (State.isHost) {
      const players = State.getPlayerList();
      const idx     = players.findIndex(p => p.id === State.energyToken);
      State.energyToken = players[(idx + 1) % players.length]?.id ?? State.energyToken;
      State.round++;

      // Raccoglie i wormSlots aggiornati di ogni giocatore da inviare con ROUND_START.
      // I client li applicano in Cards.startRound() per bloccare i registri corretti.
      const wormSlots = {};
      for (const p of players) wormSlots[p.id] = p.wormSlots ?? {};

      setTimeout(() => {
        Net.sendToAll({ type: 'ROUND_START', round: State.round, timerSec: 0, wormSlots });
      }, 800);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  return {

    compute(allRegisters) {
      if (!State.isHost) return;

      // Stato condiviso del mazzo danno (copia locale per la simulazione)
      const simShared = {
        damageDeck:    [...State.damageDeck],
        damageDiscard: [...State.damageDiscard],
      };

      const sim = {};
      State.getPlayerList().forEach((p, i) => {
        const sp = Board.startPos(i);
        sim[p.id] = {
          id:             p.id,
          cx:             p.cx,  cy: p.cy,  dir: p.dir,
          startCx:        sp.x,  startCy:   sp.y,
          lastCheckpoint: p.lastCheckpoint ?? 0,
          energy:         p.energy ?? CONFIG.startingEnergy,
          discard:        [...(p.discard    ?? [])],
          deck:           [...(p.deck       ?? [])],
          wormSlots:      { ...(p.wormSlots ?? {}) },
          registers:      allRegisters[p.id] ?? [],
        };
      });

      const plan     = [];
      const prevCard = {};
      const order    = turnOrder();
      let winner     = null;

      for (let reg = 0; reg < CONFIG.registersCount; reg++) {
        const regActions = [];

        // ── A. Attivazione carte / WORM ──────────────────────────────────────
        for (const id of order) {
          const card = sim[id]?.registers[reg];
          if (!card) continue;

          if (typeof card === 'string' && card.startsWith('worm_')) {
            // Registro bloccato da WORM: esegue la sequenza caotica
            regActions.push(...execWorm(simShared, sim, id, reg, card));
          } else {
            regActions.push(...execCard(sim, id, card, prevCard[id]));
            if (card !== 'again') prevCard[id] = card;
          }
        }

        // ── B. Elementi del tabellone (ordine fisso da regolamento) ──────────
        regActions.push(...applyConveyors(sim, 'express_conveyor'));
        regActions.push(...applyConveyors(sim, 'express_conveyor')); // 2° passata
        regActions.push(...applyConveyors(sim, 'conveyor'));
        regActions.push(...applyPushPanels(sim, reg));
        regActions.push(...applyGears(sim));
        regActions.push(...fireLasers(simShared, sim, reg));
        regActions.push(...fireRobotWeapons(simShared, sim, reg));

        // ── C. Fine registro ─────────────────────────────────────────────────
        for (const id of order) {
          const s = sim[id];
          if (Board.cellType(s.cx, s.cy) === 'recharge') {
            s.energy = Math.min((s.energy ?? 0) + CONFIG.rechargeAmount, CONFIG.maxEnergy);
            regActions.push({ type:'energy', id, energy: s.energy });
          }
        }
        for (const id of order) {
          const cp = checkCheckpoint(sim[id]);
          if (!cp) continue;
          regActions.push(cp);
          if (cp.won) winner = id;
        }

        plan.push(regActions);
        if (winner) break;
      }

      // ── Step finale: sincronizzazione deck + mazzo danno ──────────────────
      const syncActions = [
        // Deck personali (deck + discard aggiornati dalla simulazione)
        ...Object.values(sim).map(s => ({
          type:    'deck_sync',
          id:      s.id,
          deck:    [...s.deck],
          discard: [...s.discard],
        })),
        // Mazzo danno condiviso
        {
          type:          'damage_deck_sync',
          damageDeck:    [...simShared.damageDeck],
          damageDiscard: [...simShared.damageDiscard],
        },
      ];
      plan.push(syncActions);

      Net.broadcast({ type:'EXECUTE_PLAN', plan, winner, registers: allRegisters });
      this.animate(plan, winner, allRegisters);
    },

    receive(msg) {
      this.animate(msg.plan, msg.winner, msg.registers ?? null);
    },

    async animate(plan, winner, registers) {
      _cancelled.value = true;
      const token = { value: false };
      _cancelled = token;

      const speed       = Math.max(1, Math.min(4, State.execSpeed ?? 2));
      const actionDelay = ACTION_DELAYS[speed - 1];
      const regDelay    = REG_DELAYS[speed - 1];
      const wait        = ms => new Promise(res => setTimeout(res, ms));

      // L'ultimo step è sempre il deck/damage sync (invisibile).
      const animSteps = plan.length - 1;

      const waitForAdvance = () => new Promise(res => {
        State.execAdvance = () => {
          State.execAdvance = null;
          if (State.isHost) {
            Game.showAdvanceButton(false);
            Net.broadcast({ type:'EXEC_ADVANCE' });
          }
          res();
        };
        if (State.isHost) Game.showAdvanceButton(true);
      });

      State.execAnimating = true;
      Game.showExecPanel(registers);
      await wait(500);

      for (let reg = 0; reg < plan.length; reg++) {
        if (token.value) return;
        if (reg < animSteps) Game.highlightRegister(reg);

        for (const action of plan[reg]) {
          if (token.value) return;
          applyAction(action);
          // Azioni di sync: invisibili, nessuna pausa
          if (action.type === 'deck_sync' || action.type === 'damage_deck_sync') continue;
          const visual = action.type === 'move' || action.type === 'rotate' || action.type === 'fall';
          await wait(visual ? actionDelay : Math.max(60, actionDelay * 0.15));
        }

        if (token.value) return;
        if (reg < animSteps - 1) {
          if (State.execMode === 'manual') await waitForAdvance();
          else await wait(regDelay);
        }
      }

      if (token.value) return;
      State.execAnimating = false;
      State.execAdvance   = null;
      Game.showAdvanceButton(false);
      Game.hideExecPanel();
      onExecutionEnd(winner);
    },

    advance() {
      if (typeof State.execAdvance === 'function') State.execAdvance();
    },

    skipToNextRound() {
      if (!State.isHost) return;
      _cancelled.value    = true;
      State.execAnimating = false;
      State.execAdvance   = null;
      Game.showAdvanceButton(false);
      Game.hideExecPanel();
      const pp = document.getElementById('prog-panel');
      if (pp) pp.style.display = 'none';
      onExecutionEnd(null);
    },
  };

})();
