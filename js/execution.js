// ═══════════════════════════════════════════════════════════════════════════
//  EXECUTION.JS — Motore di esecuzione turni.
//
//  Fase 4: esecuzione carte (movimento, rotazione, ricarica).
//  Fase 5: laser → SPAM, power down, nastri/ingranaggi (TODO).
//
//  ARCHITETTURA:
//  Solo l'host calcola il piano di esecuzione (simulazione deterministica).
//  Il piano viene trasmesso a tutti come EXECUTE_PLAN.
//  Ogni client anima il piano ricevuto step by step.
//
//  FORMATO PIANO:
//  plan = [
//    // Un elemento per ogni registro P1-P5
//    [ ...actions ],   // P1: azioni di tutti i robot
//    [ ...actions ],   // P2
//    ...
//  ]
//
//  ACTION TYPES:
//  { type:'move',   id, cx, cy }
//  { type:'rotate', id, dir }
//  { type:'fall',   id, cx, cy, respawnCx, respawnCy }
//  { type:'checkpoint', id, order, won }
//  { type:'energy', id, energy }
//  { type:'spam',   id }          → aggiunge 1 carta SPAM al mazzo
// ═══════════════════════════════════════════════════════════════════════════

const Execution = (() => {

  // ── Costanti direzione ───────────────────────────────────────────────────
  const VECS = { N:[0,-1], E:[1,0], S:[0,1], W:[-1,0] };
  const ROT_R = { N:'E', E:'S', S:'W', W:'N' };
  const ROT_L = { N:'W', W:'S', S:'E', E:'N' };
  const OPP   = { N:'S', S:'N', E:'W', W:'E' };

  // ── Helpers geometria ───────────────────────────────────────────────────
  function rotRight(d) { return ROT_R[d] ?? d; }
  function rotLeft(d)  { return ROT_L[d] ?? d; }
  function rotU(d)     { return rotRight(rotRight(d)); }

  /** Controlla se il movimento da (x,y) verso dir è bloccato da muri */
  function wallBlocks(cx, cy, dir) {
    if (Board.wallsAt(cx, cy).includes(dir)) return true;
    const v = VECS[dir];
    if (Board.wallsAt(cx + v[0], cy + v[1]).includes(OPP[dir])) return true;
    return false;
  }

  /** Posizione di respawn per un giocatore (ultimo checkpoint o start) */
  function respawnPos(s) {
    if (s.lastCheckpoint > 0) {
      const cp = (Board.data?.checkpoints ?? [])
        .find(c => c.order === s.lastCheckpoint);
      if (cp) return { cx: cp.x, cy: cp.y };
    }
    return { cx: s.startCx, cy: s.startCy };
  }

  // ── Esecuzione carta in simulazione ─────────────────────────────────────
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
        // Esegue la prima carta dalla pila scarti (Fase 5)
        if (s.discard?.length) {
          const drawn = s.discard.pop();
          return execCard(sim, id, drawn, null);
        }
        return [];
      }
      default: return [];
    }
  }

  /** Muove il robot N passi avanti (negativo = indietro) con check muri e buche */
  function moveSteps(sim, id, steps) {
    const s   = sim[id];
    const dir = steps > 0 ? s.dir : OPP[s.dir];
    const vec = VECS[dir];
    const actions = [];

    for (let i = 0; i < Math.abs(steps); i++) {
      if (wallBlocks(s.cx, s.cy, dir)) break; // muro blocca

      const nx = s.cx + vec[0];
      const ny = s.cy + vec[1];

      const outOfBounds = !Board.inBounds(nx, ny);
      const isPit       = !outOfBounds && Board.cellType(nx, ny) === 'pit';

      if (outOfBounds || isPit) {
        // Caduta: respawn all'ultimo checkpoint
        const rp = respawnPos(s);
        s.cx = rp.cx; s.cy = rp.cy;
        // +2 SPAM per caduta
        for (let j = 0; j < CONFIG.spamCardsOnFall; j++) {
          s.discard = s.discard ?? [];
          s.discard.unshift('spam');
        }
        actions.push({ type:'fall', id, cx: nx, cy: ny, respawnCx: rp.cx, respawnCy: rp.cy });
        break;
      }

      // TODO Fase 5: gestione robot che si scontrano (push a catena)
      s.cx = nx; s.cy = ny;
      actions.push({ type:'move', id, cx: nx, cy: ny });
    }
    return actions;
  }

  /** Verifica se il robot ha raggiunto il prossimo checkpoint */
  function checkCheckpoint(s) {
    const cps  = Board.data?.checkpoints ?? [];
    const next = (s.lastCheckpoint ?? 0) + 1;
    const cp   = cps.find(c => c.order === next && c.x === s.cx && c.y === s.cy);
    if (!cp) return null;

    s.lastCheckpoint = next;
    const won = next >= cps.length; // ha toccato tutti i checkpoint
    return { type:'checkpoint', id: s.id, order: next, won };
  }

  /** Tiro laser: ogni robot su una linea laser riceve 1 SPAM (Fase 5 semplificata) */
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
          break; // il laser si ferma al primo robot
        }
        // Fermati se c'è un muro in questa direzione
        if (wallBlocks(lx, ly, laser.dir)) break;
        lx += vec[0]; ly += vec[1];
      }
    }
    return actions;
  }

  /** Ordine di esecuzione: clockwise dal possessore del token energia */
  function turnOrder() {
    const all  = State.getPlayerList();
    const idx  = all.findIndex(p => p.id === State.energyToken);
    const from = idx >= 0 ? idx : 0;
    return [...all.slice(from), ...all.slice(0, from)].map(p => p.id);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  API PUBBLICA
  // ═══════════════════════════════════════════════════════════════════════
  return {

    /**
     * HOST: calcola il piano di esecuzione da allRegisters e lo trasmette.
     * @param {Object} allRegisters  { playerId: [c0,c1,c2,c3,c4] }
     */
    compute(allRegisters) {
      if (!State.isHost) return;

      // Snapshot di simulazione (separato da State per non modificare direttamente)
      const sim = {};
      State.getPlayerList().forEach((p, i) => {
        const sp = Board.startPos(i);
        sim[p.id] = {
          id:  p.id,
          cx:  p.cx, cy:  p.cy, dir: p.dir,
          startCx:   sp.x, startCy: sp.y,
          lastCheckpoint: p.lastCheckpoint ?? 0,
          energy:    p.energy ?? CONFIG.startingEnergy,
          discard:   [...(p.discard ?? [])],
          registers: allRegisters[p.id] ?? [],
        };
      });

      const plan     = [];
      const prevCard = {};
      const order    = turnOrder();
      let   winner   = null;

      for (let reg = 0; reg < CONFIG.registersCount; reg++) {
        const regActions = [];

        // 1. Ogni robot esegue la sua carta
        for (const id of order) {
          const card = sim[id]?.registers[reg];
          if (!card) continue;
          const acts = execCard(sim, id, card, prevCard[id]);
          regActions.push(...acts);
          if (card !== 'again') prevCard[id] = card;
        }

        // 2. TODO Fase 5: nastri express, nastri normali, push panel, ingranaggi

        // 3. Laser del tabellone → SPAM
        regActions.push(...fireLasers(sim));

        // 4. Controllo checkpoint
        for (const id of order) {
          const cp = checkCheckpoint(sim[id]);
          if (!cp) continue;
          regActions.push(cp);
          if (cp.won) { winner = id; }
        }

        plan.push(regActions);
        if (winner) break;
      }

      // Aggiorna cella ricarica: +energia se robot sopra a fine turno
      const rechargeActions = [];
      for (const [id, s] of Object.entries(sim)) {
        if (Board.cellType(s.cx, s.cy) === 'recharge') {
          s.energy = Math.min((s.energy ?? 0) + CONFIG.rechargeAmount, CONFIG.maxEnergy);
          rechargeActions.push({ type:'energy', id, energy: s.energy });
        }
      }
      if (rechargeActions.length) plan.push(rechargeActions);

      const payload = { type: 'EXECUTE_PLAN', plan, winner };
      Net.broadcast(payload);
      this.animate(plan, winner); // l'host anima localmente
    },

    /** Ricevuto da tutti i client (broadcast da host) */
    receive(msg) {
      this.animate(msg.plan, msg.winner);
    },

    /**
     * Anima il piano step-by-step:
     * applica le azioni ad State.players → il lerp di game.js anima i robot.
     */
    animate(plan, winner) {
      UI.show('game');
      let step = 0;

      const tick = () => {
        if (step >= plan.length) {
          this._onExecutionEnd(winner);
          return;
        }
        const actions = plan[step++];
        this._applyActions(actions);
        setTimeout(tick, 550); // 550ms tra un registro e il prossimo
      };

      setTimeout(tick, 200);
    },

    /** Applica le azioni allo State.players (il lerp animerà automaticamente) */
    _applyActions(actions) {
      for (const a of actions) {
        const p = State.players[a.id];
        if (!p) continue;
        switch (a.type) {
          case 'move':
            p.cx = a.cx; p.cy = a.cy; break;
          case 'rotate':
            p.dir = a.dir; break;
          case 'fall':
            p.cx = a.respawnCx; p.cy = a.respawnCy; break;
          case 'checkpoint':
            p.lastCheckpoint = a.order;
            if (!p.checkpoints) p.checkpoints = [];
            if (!p.checkpoints.includes(a.order)) p.checkpoints.push(a.order);
            break;
          case 'energy':
            p.energy = a.energy; break;
          case 'spam':
            if (!p.discard) p.discard = [];
            p.discard.unshift('spam');
            // Aggiunge SPAM al mazzo (se il mazzo esiste già — cioè dopo il primo round)
            if (p.deck) p.deck.unshift('spam');
            break;
        }
      }
    },

    /** Chiamato al termine dell'animazione di tutti i registri */
    _onExecutionEnd(winner) {
      if (winner) {
        const name = State.players[winner]?.nickname ?? 'Qualcuno';
        document.getElementById('win-player').textContent = name;
        UI.show('win');
        return;
      }

      // Nessun vincitore: passa il token e avvia il prossimo round
      if (State.isHost) {
        // Token energia: passa al giocatore successivo (senso orario → indice +1)
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
