// ═══════════════════════════════════════════════════════════════════════════
//  EXECUTION.JS — v6.3
//
//  FIX SINCRONIA:
//  ─ State.execAnimating = true durante animate() → i client ignorano
//    SYNC_STATE mentre l'animazione è in corso (niente salti di posizione)
//
//  FIX PULSANTE AVANTI:
//  ─ In modalità MANUAL, solo l'host vede e clicca "Avanti →"
//  ─ Al click, host trasmette EXEC_ADVANCE a tutti i client
//  ─ I client ricevono EXEC_ADVANCE → Execution.advance() → la loro
//    animazione locale avanza in sincronia con l'host
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
      let lx = laser.x + vec[0], ly = laser.y + vec[1];
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

  return {

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

      const plan = [], prevCard = {};
      const order = turnOrder();
      let winner = null;

      for (let reg = 0; reg < CONFIG.registersCount; reg++) {
        const regActions = [];
        for (const id of order) {
          const card = sim[id]?.registers[reg];
          if (!card) continue;
          regActions.push(...execCard(sim, id, card, prevCard[id]));
          if (card !== 'again') prevCard[id] = card;
        }
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

      const rechActions = [];
      for (const [id, s] of Object.entries(sim)) {
        if (Board.cellType(s.cx, s.cy) === 'recharge') {
          s.energy = Math.min((s.energy ?? 0) + CONFIG.rechargeAmount, CONFIG.maxEnergy);
          rechActions.push({ type:'energy', id, energy: s.energy });
        }
      }
      if (rechActions.length) plan.push(rechActions);

      Net.broadcast({ type: 'EXECUTE_PLAN', plan, winner, registers: allRegisters });
      this.animate(plan, winner, allRegisters);
    },

    receive(msg) {
      this.animate(msg.plan, msg.winner, msg.registers ?? null);
    },

    // ── Animazione asincrona cella per cella ───────────────────────────────
    async animate(plan, winner, registers) {
      _cancelled.value = true;
      const token = { value: false };
      _cancelled = token;

      const speed       = Math.max(1, Math.min(4, State.execSpeed ?? 2));
      const actionDelay = ACTION_DELAYS[speed - 1];
      const regDelay    = REG_DELAYS[speed - 1];
      const wait        = (ms) => new Promise(res => setTimeout(res, ms));

      // ── Attesa avanzamento manuale ──────────────────────────────────────
      //
      // HOST: mostra il pulsante "Avanti →", al click trasmette EXEC_ADVANCE
      //       a tutti i client e risolve la promise.
      //
      // NON-HOST: NON mostra il pulsante. Imposta State.execAdvance come callback.
      //           Quando riceve EXEC_ADVANCE dall'host (→ Game.handleMessage →
      //           Execution.advance()), la callback viene chiamata e l'animazione
      //           locale avanza in sincronia con l'host.
      //
      const waitForAdvance = () => new Promise(res => {
        State.execAdvance = () => {
          State.execAdvance = null;
          if (State.isHost) {
            Game.showAdvanceButton(false);
            Net.broadcast({ type: 'EXEC_ADVANCE' });  // sincronizza i client
          }
          res();
        };
        // Solo l'host vede il bottone
        if (State.isHost) Game.showAdvanceButton(true);
      });

      // Segnala a tutti i sistemi che l'animazione è in corso.
      // Usato da Game.handleMessage per ignorare SYNC_STATE durante l'animazione
      // (altrimenti il sync farebbe saltare le posizioni dei robot).
      State.execAnimating = true;

      Game.showExecPanel(registers);
      await wait(500);

      for (let reg = 0; reg < plan.length; reg++) {
        if (token.value) return;

        Game.highlightRegister(reg);

        for (const action of plan[reg]) {
          if (token.value) return;
          applyAction(action);
          const visual = action.type === 'move' || action.type === 'rotate' || action.type === 'fall';
          await wait(visual ? actionDelay : Math.max(60, actionDelay * 0.15));
        }

        if (token.value) return;

        if (reg < plan.length - 1) {
          if (State.execMode === 'manual') {
            await waitForAdvance();
          } else {
            await wait(regDelay);
          }
        }
      }

      if (token.value) return;

      State.execAnimating = false;
      State.execAdvance   = null;
      Game.showAdvanceButton(false);
      Game.hideExecPanel();
      onExecutionEnd(winner);
    },

    // Chiamato dal click su "Avanti →" (host) o da EXEC_ADVANCE ricevuto (client)
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
