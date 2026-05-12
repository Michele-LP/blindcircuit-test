// ═══════════════════════════════════════════════════════════════════════════
//  EXECUTION.JS — v6.1
//
//  NOVITÀ:
//  ─ animate() usa async/await: applica un'azione alla volta → cella per cella
//  ─ Modalità AUTO: pausa configurable tra azioni (State.execSpeed 1-4)
//  ─ Modalità MANUAL: si ferma dopo ogni registro e aspetta il click "Avanti"
//  ─ skipToNextRound(): salta l'esecuzione corrente → round successivo (host)
//  ─ advance(): chiamato dal pulsante "Avanti →"
// ═══════════════════════════════════════════════════════════════════════════

const Execution = (() => {

  // ── Delay in ms per velocità 1-4 ─────────────────────────────────────────
  // actionDelay: tra un'azione e la successiva (ogni singola cella)
  // regDelay:    pausa extra dopo ogni registro completo (solo auto mode)
  const ACTION_DELAYS = [650, 380, 200, 80];
  const REG_DELAYS    = [1400, 800, 400, 120];

  // ── Flag per cancellare l'esecuzione in corso (es. skip) ─────────────────
  let _cancelled = { value: false };

  // ── Direzioni ─────────────────────────────────────────────────────────────
  const VECS  = { N:[0,-1], E:[1,0], S:[0,1], W:[-1,0] };
  const ROT_R = { N:'E', E:'S', S:'W', W:'N' };
  const ROT_L = { N:'W', W:'S', S:'E', E:'N' };
  const OPP   = { N:'S', S:'N', E:'W', W:'E' };

  function rotRight(d) { return ROT_R[d] ?? d; }
  function rotLeft(d)  { return ROT_L[d] ?? d; }
  function rotU(d)     { return rotRight(rotRight(d)); }

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

  // ── Calcolo piano di esecuzione ───────────────────────────────────────────
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
      case 'again':       return prevCard ? execCard(sim, id, prevCard, null) : [];
      case 'recharge': {
        s.energy = Math.min((s.energy ?? 0) + CONFIG.rechargeAmount, CONFIG.maxEnergy);
        return [{ type:'energy', id, energy: s.energy }];
      }
      case 'spam': {
        if (s.discard?.length) return execCard(sim, id, s.discard.pop(), null);
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
      const nx = s.cx + vec[0];
      const ny = s.cy + vec[1];
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
      // TODO Fase 6: push a catena
      s.cx = nx; s.cy = ny;
      actions.push({ type:'move', id, cx: nx, cy: ny });
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

  function fireLasers(sim) {
    const actions = [];
    for (const laser of Board.data?.lasers ?? []) {
      const vec = VECS[laser.dir];
      let lx = laser.x + vec[0];
      let ly = laser.y + vec[1];
      while (Board.inBounds(lx, ly)) {
        const hit = Object.values(sim).find(s => s.cx === lx && s.cy === ly);
        if (hit) {
          for (let i = 0; i < (laser.strength ?? 1); i++) {
            hit.discard = hit.discard ?? [];
            hit.discard.unshift('spam');
            actions.push({ type:'spam', id: hit.id });
          }
          break;
        }
        if (wallBlocks(lx, ly, laser.dir)) break;
        lx += vec[0]; ly += vec[1];
      }
    }
    return actions;
  }

  function turnOrder() {
    const all = State.getPlayerList();
    const idx = all.findIndex(p => p.id === State.energyToken);
    const from = idx >= 0 ? idx : 0;
    return [...all.slice(from), ...all.slice(0, from)].map(p => p.id);
  }

  // ── Applica una singola azione allo State ─────────────────────────────────
  function applyAction(a) {
    const p = State.players[a.id];
    if (!p) return;
    switch (a.type) {
      case 'move':       p.cx = a.cx; p.cy = a.cy; break;
      case 'rotate':     p.dir = a.dir; break;
      case 'fall':       p.cx = a.respawnCx; p.cy = a.respawnCy; break;
      case 'checkpoint':
        p.lastCheckpoint = a.order;
        if (!p.checkpoints) p.checkpoints = [];
        if (!p.checkpoints.includes(a.order)) p.checkpoints.push(a.order);
        break;
      case 'energy': p.energy = a.energy; break;
      case 'spam':
        if (!p.discard) p.discard = [];
        p.discard.unshift('spam');
        if (p.deck) p.deck.unshift('spam');
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
      const idx = players.findIndex(p => p.id === State.energyToken);
      State.energyToken = players[(idx + 1) % players.length]?.id ?? State.energyToken;
      State.round++;
      setTimeout(() => {
        Net.sendToAll({ type: 'ROUND_START', round: State.round, timerSec: 0 });
      }, 800);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  API PUBBLICA
  // ═════════════════════════════════════════════════════════════════════════
  return {

    // HOST: calcola piano e trasmette
    compute(allRegisters) {
      if (!State.isHost) return;

      const sim = {};
      State.getPlayerList().forEach((p, i) => {
        const sp = Board.startPos(i);
        sim[p.id] = {
          id: p.id, cx: p.cx, cy: p.cy, dir: p.dir,
          startCx: sp.x, startCy: sp.y,
          lastCheckpoint: p.lastCheckpoint ?? 0,
          energy:  p.energy ?? CONFIG.startingEnergy,
          discard: [...(p.discard ?? [])],
          registers: allRegisters[p.id] ?? [],
        };
      });

      const plan     = [];
      const prevCard = {};
      const order    = turnOrder();
      let   winner   = null;

      for (let reg = 0; reg < CONFIG.registersCount; reg++) {
        const regActions = [];
        for (const id of order) {
          const card = sim[id]?.registers[reg];
          if (!card) continue;
          regActions.push(...execCard(sim, id, card, prevCard[id]));
          if (card !== 'again') prevCard[id] = card;
        }
        // TODO Fase 6: nastri, ingranaggi, push panel
        regActions.push(...fireLasers(sim));
        for (const id of order) {
          const cp = checkCheckpoint(sim[id]);
          if (!cp) continue;
          regActions.push(cp);
          if (cp.won) winner = id;
        }
        plan.push(regActions);
        if (winner) break;
      }

      // Celle ricarica a fine turno
      const rechActions = [];
      for (const [id, s] of Object.entries(sim)) {
        if (Board.cellType(s.cx, s.cy) === 'recharge') {
          s.energy = Math.min((s.energy ?? 0) + CONFIG.rechargeAmount, CONFIG.maxEnergy);
          rechActions.push({ type:'energy', id, energy: s.energy });
        }
      }
      if (rechActions.length) plan.push(rechActions);

      const payload = { type: 'EXECUTE_PLAN', plan, winner, registers: allRegisters };
      Net.broadcast(payload);
      this.animate(plan, winner, allRegisters);
    },

    // Client: riceve il piano dall'host
    receive(msg) {
      this.animate(msg.plan, msg.winner, msg.registers ?? null);
    },

    // ── Animazione async cella per cella ──────────────────────────────────
    // Ogni movimento (anche un singolo passo di move3) è separato da actionDelay.
    // In modalità MANUALE, dopo ogni registro si aspetta il click su "Avanti →".
    async animate(plan, winner, registers) {
      // Cancella eventuale esecuzione precedente
      _cancelled.value = true;
      const token = { value: false };
      _cancelled = token;

      const speed = Math.max(1, Math.min(4, State.execSpeed ?? 2));
      const actionDelay = ACTION_DELAYS[speed - 1];
      const regDelay    = REG_DELAYS[speed - 1];

      // Helper: aspetta N ms se non cancellato
      const wait = (ms) => new Promise(res => setTimeout(res, ms));

      // Helper: aspetta click su "Avanti →" (modal mode)
      const waitForAdvance = () => new Promise(res => {
        State.execAdvance = () => {
          State.execAdvance = null;
          Game.showAdvanceButton(false);
          res();
        };
        Game.showAdvanceButton(true);
      });

      Game.showExecPanel(registers);
      await wait(500);

      for (let reg = 0; reg < plan.length; reg++) {
        if (token.value) return;

        Game.highlightRegister(reg);

        const regActions = plan[reg];
        for (const action of regActions) {
          if (token.value) return;

          applyAction(action);

          // Delay più lungo per azioni visive (movimento/rotazione), breve per le altre
          const isVisual = (action.type === 'move' || action.type === 'rotate' || action.type === 'fall');
          await wait(isVisual ? actionDelay : Math.max(60, actionDelay * 0.15));
        }

        if (token.value) return;

        // Pausa tra registri
        const isLastReg = (reg === plan.length - 1);
        if (!isLastReg) {
          if (State.execMode === 'manual') {
            await waitForAdvance();
          } else {
            await wait(regDelay);
          }
        }
      }

      if (token.value) return;

      // Fine esecuzione
      State.execAdvance = null;
      Game.showAdvanceButton(false);
      Game.hideExecPanel();
      onExecutionEnd(winner);
    },

    // Chiamato dal pulsante "Avanti →"
    advance() {
      if (typeof State.execAdvance === 'function') State.execAdvance();
    },

    // HOST ONLY: salta il round corrente e passa al successivo
    // Utile per testing
    skipToNextRound() {
      if (!State.isHost) return;
      _cancelled.value = true;
      State.execAdvance = null;
      Game.showAdvanceButton(false);
      Game.hideExecPanel();
      // Nascondi prog panel se aperto
      const pp = document.getElementById('prog-panel');
      if (pp) pp.style.display = 'none';
      onExecutionEnd(null);
    },
  };
})();
