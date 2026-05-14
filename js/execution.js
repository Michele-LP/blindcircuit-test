// ═══════════════════════════════════════════════════════════════════════════
//  EXECUTION.JS — v6.6
//
//  NOVITÀ v6.6:
//  ─ Eventi loggati e notificati: damage, fall, checkpoint, vittoria producono
//    voci nel Log (e Toast per i danni). I colori sono quelli del personaggio
//    colpito → si vede a colpo d'occhio chi ha subito cosa.
//  ─ Bottone Avanti: rimane visibile per tutta l'esecuzione in modalità manuale,
//    si attiva/disattiva invece di scomparire (fix UX).
//  ─ Notifica vittoria via toast + log.
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

  // ── Helpers per Log/Toast ─────────────────────────────────────────────────
  // Estrae nome e colore del giocatore per messaggi user-friendly.
  function _playerInfo(id) {
    const p    = State.players[id];
    const char = p ? CONFIG.characters.find(c => c.id === p.character) : null;
    return {
      name:  p?.nickname || '?',
      color: char?.color || '#6b7280',
    };
  }

  // ── Pesca dal mazzo danno condiviso ───────────────────────────────────────
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
      simPlayer.wormSlots = simPlayer.wormSlots ?? {};
      simPlayer.wormSlots[regIndex] = card;
    }
    return { type: 'damage', id: simPlayer.id, card, regIndex };
  }

  // ── Esecuzione sequenza WORM ──────────────────────────────────────────────
  function execWorm(simShared, sim, id, reg, wormId) {
    const s       = sim[id];
    const wormDef = (typeof RULES !== 'undefined' ? RULES?.worms : null)?.find(w => w.id === wormId);
    const actions = [];

    if (wormDef) {
      for (const step of wormDef.sequence) {
        switch (step.type) {
          case 'move':        actions.push(...moveSteps(sim, id, step.steps ?? 1));    break;
          case 'backUp':      actions.push(...moveSteps(sim, id, -(step.steps ?? 1))); break;
          case 'rotateLeft':  s.dir = rotLeft(s.dir);  actions.push({ type:'rotate', id, dir: s.dir }); break;
          case 'rotateRight': s.dir = rotRight(s.dir); actions.push({ type:'rotate', id, dir: s.dir }); break;
          case 'uTurn':       s.dir = rotU(s.dir);     actions.push({ type:'rotate', id, dir: s.dir }); break;
        }
      }
    }
    if (s.wormSlots) s.wormSlots[reg] = null;
    simShared.damageDiscard.push(wormId);
    actions.push({ type: 'worm_clear', id, reg, wormId });
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
      for (let j = 0; j < CONFIG.spamCardsOnFall; j++) (s.discard = s.discard ?? []).unshift('spam');
      actions.push({ type:'fall', id: pushedId, cx: nx, cy: ny, respawnCx: rp.cx, respawnCy: rp.cy });
      return true;
    }
    if (Board.cellType(nx, ny) === 'pit') {
      const rp = respawnPos(s);
      s.cx = rp.cx; s.cy = rp.cy;
      for (let j = 0; j < CONFIG.spamCardsOnFall; j++) (s.discard = s.discard ?? []).unshift('spam');
      actions.push({ type:'fall', id: pushedId, cx: nx, cy: ny, respawnCx: rp.cx, respawnCy: rp.cy });
      return true;
    }
    const blocker = Object.values(sim).find(o => o.id !== pushedId && o.cx === nx && o.cy === ny);
    if (blocker && !tryPush(sim, blocker.id, dir, actions)) return false;
    s.cx = nx; s.cy = ny;
    actions.push({ type:'move', id: pushedId, cx: nx, cy: ny });
    return true;
  }

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
        return execCard(sim, id, 'spam', null);
      case 'recharge': {
        s.energy = Math.min((s.energy ?? 0) + CONFIG.rechargeAmount, CONFIG.maxEnergy);
        return [{ type:'energy', id, energy: s.energy }];
      }
      case 'spam': {
        if (!s.deck?.length) {
          if (!s.discard?.length) return [];
          s.deck    = _shuffle([...s.discard]);
          s.discard = [];
        }
        while (s.deck.length) {
          const drawn = s.deck.pop();
          if (drawn !== 'spam') {
            s.discard.push(drawn);
            return execCard(sim, id, drawn, null);
          }
        }
        return [];
      }
      default: return [];
    }
  }

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
        for (let j = 0; j < CONFIG.spamCardsOnFall; j++) (s.discard = s.discard ?? []).unshift('spam');
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
      const nx  = s.cx + vec[0], ny = s.cy + vec[1];
      if (!Board.inBounds(nx, ny)) { intended.set(s.id, null); continue; }
      intended.set(s.id, { nx, ny });
    }
    const destCount = new Map();
    for (const [, m] of intended) {
      if (!m) continue;
      const k = `${m.nx},${m.ny}`;
      destCount.set(k, (destCount.get(k) || 0) + 1);
    }
    for (const [id, m] of intended) {
      if (m && (destCount.get(`${m.nx},${m.ny}`) || 0) > 1) intended.set(id, null);
    }
    for (const [id, m] of intended) {
      if (!m) continue;
      const blocked = Object.values(sim).some(o => {
        if (o.id === id || o.cx !== m.nx || o.cy !== m.ny) return false;
        const tm = intended.get(o.id);
        return tm === undefined || tm === null;
      });
      if (blocked) intended.set(id, null);
    }
    for (const [id, m] of intended) {
      if (!m) continue;
      const s = sim[id];
      if (Board.cellType(m.nx, m.ny) === 'pit') {
        const rp = respawnPos(s);
        s.cx = rp.cx; s.cy = rp.cy;
        for (let j = 0; j < CONFIG.spamCardsOnFall; j++) s.discard.unshift('spam');
        actions.push({ type:'fall', id, cx: m.nx, cy: m.ny, respawnCx: rp.cx, respawnCy: rp.cy });
      } else {
        s.cx = m.nx; s.cy = m.ny;
        actions.push({ type:'move', id, cx: m.nx, cy: m.ny });
      }
    }
    return actions;
  }

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

  function fireLasers(simShared, sim, currentReg) {
    const actions = [];
    const defaultStrength = (typeof RULES !== 'undefined' ? RULES?.lasers?.boardLaserStrength : null) ?? CONFIG.boardLaserStrength ?? 1;
    for (const laser of Board.data?.lasers ?? []) {
      const strength = laser.strength ?? defaultStrength;
      const vec = VECS[laser.dir];
      let lx = laser.x + vec[0], ly = laser.y + vec[1];
      while (Board.inBounds(lx, ly)) {
        const hit = Object.values(sim).find(s => s.cx === lx && s.cy === ly);
        if (hit) {
          for (let i = 0; i < strength; i++) {
            const dmg = drawDamage(simShared, hit, currentReg);
            if (dmg) { dmg.source = 'board_laser'; actions.push(dmg); }
          }
          break;
        }
        if (wallBlocks(lx, ly, laser.dir)) break;
        lx += vec[0]; ly += vec[1];
      }
    }
    return actions;
  }

  function fireRobotWeapons(simShared, sim, currentReg) {
    const actions  = [];
    const strength = (typeof RULES !== 'undefined' ? RULES?.lasers?.robotLaserStrength : null) ?? CONFIG.robotLaserStrength ?? 1;
    for (const id of turnOrder()) {
      const shooter = sim[id];
      if (!shooter) continue;
      if (wallBlocks(shooter.cx, shooter.cy, shooter.dir)) continue;
      const vec = VECS[shooter.dir];
      let lx = shooter.cx + vec[0], ly = shooter.cy + vec[1];
      while (Board.inBounds(lx, ly)) {
        const hit = Object.values(sim).find(s => s.id !== id && s.cx === lx && s.cy === ly);
        if (hit) {
          for (let i = 0; i < strength; i++) {
            const dmg = drawDamage(simShared, hit, currentReg);
            if (dmg) { dmg.source = 'robot_laser'; dmg.shooterId = id; actions.push(dmg); }
          }
          break;
        }
        if (wallBlocks(lx, ly, shooter.dir)) break;
        lx += vec[0]; ly += vec[1];
      }
    }
    return actions;
  }

  function checkCheckpoint(s) {
    const cps  = Board.data?.checkpoints ?? [];
    const next = (s.lastCheckpoint ?? 0) + 1;
    const cp   = cps.find(c => c.order === next && c.x === s.cx && c.y === s.cy);
    if (!cp) return null;
    s.lastCheckpoint = next;
    return { type:'checkpoint', id: s.id, order: next, won: next >= cps.length };
  }

  function turnOrder() {
    const all  = State.getPlayerList();
    const idx  = all.findIndex(p => p.id === State.energyToken);
    const from = idx >= 0 ? idx : 0;
    return [...all.slice(from), ...all.slice(0, from)].map(p => p.id);
  }

  // ── Applicazione azioni (durante l'animazione) ────────────────────────────
  // I log/toast vengono emessi qui perché applyAction è chiamata su TUTTI i
  // client (host + guest), così tutti vedono le stesse notifiche.
  function applyAction(a) {
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

      case 'fall': {
        p.cx = a.respawnCx; p.cy = a.respawnCy;
        const info = _playerInfo(a.id);
        if (typeof Log   !== 'undefined') Log.add(`${info.name} è caduto`, { color: info.color, type: 'damage' });
        if (typeof Toast !== 'undefined') Toast.show(`💥 ${info.name} è caduto`, { color: info.color });
        break;
      }

      case 'checkpoint': {
        p.lastCheckpoint = a.order;
        if (!p.checkpoints) p.checkpoints = [];
        if (!p.checkpoints.includes(a.order)) p.checkpoints.push(a.order);
        const info = _playerInfo(a.id);
        if (typeof Log   !== 'undefined') Log.add(`${info.name} ha raggiunto il checkpoint ${a.order}`, { color: info.color, type: 'event' });
        if (typeof Toast !== 'undefined') Toast.show(`⭐ ${info.name} → checkpoint ${a.order}`, { color: info.color });
        break;
      }

      case 'energy': p.energy = a.energy; break;

      case 'damage': {
        // Aggiorna lo stato locale del giocatore
        if (a.card === 'spam') {
          if (!p.discard) p.discard = [];
          p.discard.unshift('spam');
        } else {
          if (!p.wormSlots) p.wormSlots = {};
          p.wormSlots[a.regIndex] = a.card;
        }
        // Notifiche
        const info = _playerInfo(a.id);
        const src  = a.source === 'robot_laser' ? 'laser robot' : 'laser bordo';
        if (a.card === 'spam') {
          const msg = `${info.name} colpito (${src}) — SPAM`;
          if (typeof Log   !== 'undefined') Log.add(msg, { color: info.color, type: 'damage' });
          if (typeof Toast !== 'undefined') Toast.show(`🎯 ${msg}`, { color: info.color });
        } else {
          // WORM
          const wormDef = (typeof RULES !== 'undefined' ? RULES?.worms : null)?.find(w => w.id === a.card);
          const wormName = wormDef?.name ?? a.card;
          const msg = `${info.name} colpito (${src}) — WORM ${wormName} → P${a.regIndex + 1}`;
          if (typeof Log   !== 'undefined') Log.add(msg, { color: info.color, type: 'damage' });
          if (typeof Toast !== 'undefined') Toast.show(`🦠 ${msg}`, { color: info.color, duration: 4000 });
        }
        break;
      }

      case 'worm_clear': {
        if (p.wormSlots) p.wormSlots[a.reg] = null;
        if (a.wormId && typeof Log !== 'undefined') {
          const info = _playerInfo(a.id);
          const wormDef = (typeof RULES !== 'undefined' ? RULES?.worms : null)?.find(w => w.id === a.wormId);
          Log.add(`${info.name}: WORM ${wormDef?.name ?? a.wormId} eseguito (P${a.reg + 1} liberato)`,
                  { color: info.color, type: 'event' });
        }
        break;
      }

      case 'deck_sync':
        if (a.deck    !== undefined) p.deck    = a.deck;
        if (a.discard !== undefined) p.discard = a.discard;
        break;
    }
  }

  function onExecutionEnd(winner) {
    if (winner) {
      const info = _playerInfo(winner);
      if (typeof Log   !== 'undefined') Log.add(`🏆 VITTORIA di ${info.name}!`, { color: info.color, type: 'event' });
      if (typeof Toast !== 'undefined') Toast.show(`🏆 ${info.name} ha vinto!`, { color: info.color, duration: 8000 });
      if (typeof Game?.stopTimer === 'function') Game.stopTimer();
      document.getElementById('win-player').textContent = info.name;
      UI.show('win');
      return;
    }
    if (State.isHost) {
      const players = State.getPlayerList();
      const idx     = players.findIndex(p => p.id === State.energyToken);
      State.energyToken = players[(idx + 1) % players.length]?.id ?? State.energyToken;
      State.round++;
      const wormSlots = {};
      for (const p of players) wormSlots[p.id] = p.wormSlots ?? {};
      setTimeout(() => {
        Net.sendToAll({ type: 'ROUND_START', round: State.round, timerSec: 0, wormSlots });
      }, 800);
    }
  }

  return {

    compute(allRegisters) {
      if (!State.isHost) return;
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
        for (const id of order) {
          const card = sim[id]?.registers[reg];
          if (!card) continue;
          if (typeof card === 'string' && card.startsWith('worm_')) {
            regActions.push(...execWorm(simShared, sim, id, reg, card));
          } else {
            regActions.push(...execCard(sim, id, card, prevCard[id]));
            if (card !== 'again') prevCard[id] = card;
          }
        }
        regActions.push(...applyConveyors(sim, 'express_conveyor'));
        regActions.push(...applyConveyors(sim, 'express_conveyor'));
        regActions.push(...applyConveyors(sim, 'conveyor'));
        regActions.push(...applyPushPanels(sim, reg));
        regActions.push(...applyGears(sim));
        regActions.push(...fireLasers(simShared, sim, reg));
        regActions.push(...fireRobotWeapons(simShared, sim, reg));
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

      const syncActions = [
        ...Object.values(sim).map(s => ({
          type: 'deck_sync', id: s.id, deck: [...s.deck], discard: [...s.discard],
        })),
        { type: 'damage_deck_sync', damageDeck: [...simShared.damageDeck], damageDiscard: [...simShared.damageDiscard] },
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
      const animSteps   = plan.length - 1;

      // ── FIX v6.6: bottone Avanti sempre visibile in modalità manuale ──────
      // Si attiva/disattiva, non scompare → niente click accidentali su altri pulsanti.
      const isManual    = State.execMode === 'manual' && State.isHost;
      if (isManual) Game.showAdvanceButton(true, false);   // visibile, disabilitato

      const waitForAdvance = () => new Promise(res => {
        State.execAdvance = () => {
          State.execAdvance = null;
          if (State.isHost) {
            Game.showAdvanceButton(true, false);            // disabilita durante l'animazione del prossimo registro
            Net.broadcast({ type:'EXEC_ADVANCE' });
          }
          res();
        };
        if (State.isHost) Game.showAdvanceButton(true, true);  // abilita per il click
      });

      State.execAnimating = true;
      Game.showExecPanel(registers);

      if (typeof Log !== 'undefined') Log.add(`— Esecuzione round ${State.round} —`, { type: 'event' });

      await wait(500);

      for (let reg = 0; reg < plan.length; reg++) {
        if (token.value) return;
        if (reg < animSteps) Game.highlightRegister(reg);

        for (const action of plan[reg]) {
          if (token.value) return;
          applyAction(action);
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
      Game.showAdvanceButton(false, false);
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
      Game.showAdvanceButton(false, false);
      Game.hideExecPanel();
      const pp = document.getElementById('prog-panel');
      if (pp) pp.style.display = 'none';
      onExecutionEnd(null);
    },
  };

})();
