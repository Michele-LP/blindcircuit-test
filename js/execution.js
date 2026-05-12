// ═══════════════════════════════════════════════════════════════════════════
//  EXECUTION.JS — Motore di esecuzione turni.
//
//  MODIFICHE v6:
//  - execStepMs e execStartDelayMs ora letti da CONFIG (erano hardcoded 550ms)
//  - allRegisters incluso nel messaggio EXECUTE_PLAN (per il pannello UI)
//  - animate() chiama Game.showExecPanel / highlightRegister / hideExecPanel
// ═══════════════════════════════════════════════════════════════════════════

const Execution = (() => {

  // ── Costanti direzione ───────────────────────────────────────────────────
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

  // ── Esecuzione singola carta ─────────────────────────────────────────────
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
        return prevCard ? execCard(sim, id, prevCard, null) : [];
      case 'recharge': {
        s.energy = Math.min((s.energy ?? 0) + CONFIG.rechargeAmount, CONFIG.maxEnergy);
        return [{ type:'energy', id, energy: s.energy }];
      }
      case 'spam': {
        if (s.discard?.length) {
          const drawn = s.discard.pop();
          return execCard(sim, id, drawn, null);
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

      const nx = s.cx + vec[0];
      const ny = s.cy + vec[1];
      const outOfBounds = !Board.inBounds(nx, ny);
      const isPit       = !outOfBounds && Board.cellType(nx, ny) === 'pit';

      if (outOfBounds || isPit) {
        const rp = respawnPos(s);
        s.cx = rp.cx; s.cy = rp.cy;
        for (let j = 0; j < CONFIG.spamCardsOnFall; j++) {
          s.discard = s.discard ?? [];
          s.discard.unshift('spam');
        }
        actions.push({ type:'fall', id, cx: nx, cy: ny, respawnCx: rp.cx, respawnCy: rp.cy });
        break;
      }

      // TODO Fase 6: push a catena quando due robot si incontrano
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
    const won = next >= cps.length;
    return { type:'checkpoint', id: s.id, order: next, won };
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

  // ═══════════════════════════════════════════════════════════════════════════
  //  API PUBBLICA
  // ═══════════════════════════════════════════════════════════════════════════
  return {

    /**
     * HOST: calcola il piano di esecuzione e lo trasmette.
     * @param {Object} allRegisters  { playerId: [c0,c1,c2,c3,c4] }
     */
    compute(allRegisters) {
      if (!State.isHost) return;

      const sim = {};
      State.getPlayerList().forEach((p, i) => {
        const sp = Board.startPos(i);
        sim[p.id] = {
          id:  p.id,
          cx:  p.cx, cy: p.cy, dir: p.dir,
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
          const acts = execCard(sim, id, card, prevCard[id]);
          regActions.push(...acts);
          if (card !== 'again') prevCard[id] = card;
        }

        // TODO Fase 6: nastri express, nastri normali, push panel, ingranaggi

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

      // Ricarica su celle recharge a fine turno
      const rechargeActions = [];
      for (const [id, s] of Object.entries(sim)) {
        if (Board.cellType(s.cx, s.cy) === 'recharge') {
          s.energy = Math.min((s.energy ?? 0) + CONFIG.rechargeAmount, CONFIG.maxEnergy);
          rechargeActions.push({ type:'energy', id, energy: s.energy });
        }
      }
      if (rechargeActions.length) plan.push(rechargeActions);

      // ← IMPORTANTE: include allRegisters nel payload per il pannello UI
      const payload = { type: 'EXECUTE_PLAN', plan, winner, registers: allRegisters };
      Net.broadcast(payload);
      this.animate(plan, winner, allRegisters);
    },

    /** Ricevuto dai client (broadcast da host) */
    receive(msg) {
      this.animate(msg.plan, msg.winner, msg.registers ?? null);
    },

    /**
     * Anima il piano step-by-step.
     * @param {Array}  plan       - array di array di azioni (una per registro)
     * @param {string} winner     - peerId del vincitore, null se nessuno
     * @param {Object} registers  - { playerId: [c0..c4] } per il pannello UI
     */
    animate(plan, winner, registers) {
      UI.show('game');

      // Mostra il pannello con le carte programmate di tutti
      if (registers && typeof Game.showExecPanel === 'function') {
        Game.showExecPanel(registers);
      }

      let step = 0;

      const tick = () => {
        if (step >= plan.length) {
          if (typeof Game.hideExecPanel === 'function') Game.hideExecPanel();
          this._onExecutionEnd(winner);
          return;
        }
        // Evidenzia il registro corrente nel pannello
        if (typeof Game.highlightRegister === 'function') {
          Game.highlightRegister(step);
        }
        const actions = plan[step++];
        this._applyActions(actions);
        setTimeout(tick, CONFIG.execStepMs);
      };

      setTimeout(tick, CONFIG.execStartDelayMs);
    },

    _applyActions(actions) {
      for (const a of actions) {
        const p = State.players[a.id];
        if (!p) continue;
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
    },

    _onExecutionEnd(winner) {
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
          Net.sendToAll({
            type:     'ROUND_START',
            round:    State.round,
            timerSec: CONFIG.programmingTimerSec,
          });
        }, 800);
      }
    },
  };
})();
