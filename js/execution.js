// ═══════════════════════════════════════════════════════════════════════════
//  EXECUTION.JS — v6.4
//
//  NOVITÀ v6.4 rispetto a v6.3:
//
//  ── Fix regola SPAM ────────────────────────────────────────────────────────
//  La SPAM ora pesca la prima carta non-SPAM dalla cima del proprio
//  programming deck (non dal discard, come prima). La SPAM stessa esce
//  dal mazzo (nel gioco fisico va nel damage discard pile condiviso).
//  Se eseguendo SPAM si pesca un'altra SPAM, anche quella viene eliminata
//  e si pesca ancora: "se è SPAM, torna al passo 1" (regolamento pag. 17).
//
//  ── Fix regola Again al Registro 1 ────────────────────────────────────────
//  "An Again card in Register 1 acts like SPAM" (regolamento pag. 11).
//  Prima restituiva [] (nessuna azione). Ora delega a execCard('spam').
//
//  ── Fix batterie (Power Up tile) ──────────────────────────────────────────
//  L'energia da batteria si guadagna alla FINE DI OGNI REGISTRO (step C)
//  in cui il robot si trova sulla cella, non solo alla fine di tutti i
//  5 registri come prima (regolamento pag. 8: "End of Register Activation").
//
//  ── Collisioni robot (push a catena) ──────────────────────────────────────
//  Il robot che si muove verso una cella occupata spinge il robot presente.
//  Se il robot spinto ha un altro robot davanti, lo spinge a sua volta
//  (catena). Se il robot finale non può avanzare (muro), tutta la catena
//  si ferma. Un robot può essere spinto in un pit o fuori dalla mappa.
//
//  ── Nastri trasportatori ──────────────────────────────────────────────────
//  Ordine: express_conveyor (2 passaggi) → conveyor (1 passaggio).
//  I nastri NON spingono robot; se la destinazione è occupata, il robot
//  si ferma. Se due robot puntano alla stessa cella, nessuno si muove.
//
//  ── Ingranaggi (gears) ────────────────────────────────────────────────────
//  gear_cw: ruota 90° a destra. gear_ccw: 90° a sinistra.
//
//  ── Push panel ────────────────────────────────────────────────────────────
//  Si attiva solo nei registri corrispondenti agli activeRegisters nel JSON
//  (1-based). Spinge con la stessa logica delle collisioni (push a catena).
//
//  ── Laser dei robot ───────────────────────────────────────────────────────
//  Dopo i laser di bordo, ogni robot spara il proprio laser nella direzione
//  in cui è orientato. Colpisce il primo robot nel raggio visivo (bloccato
//  dai muri, non dalla distanza). Danno: 1 SPAM. Si risolve in ordine di
//  priorità (turnOrder).
//
//  ── Sincronizzazione deck ─────────────────────────────────────────────────
//  La SPAM modifica il deck del simulatore durante compute(). Al termine
//  dell'esecuzione, viene aggiunto uno step invisibile 'deck_sync' che
//  allinea il deck reale dei giocatori con quello simulato, garantendo
//  coerenza al round successivo.
//
//  ── Ordine di attivazione (regolamento pag. 7-8) ──────────────────────────
//  Per ogni registro:
//    A. Carte programmazione (in ordine di priorità)
//    B1. Nastri express (2 passaggi)
//    B2. Nastri normali (1 passaggio)
//    B3. Push panel (solo nei registri attivi)
//    B4. Ingranaggi
//    B5. Laser di bordo
//    B6. Laser dei robot
//    C1. Batterie (End of Register)
//    C2. Checkpoint (End of Register)
//
//  ── Semplificazioni intenzionali rispetto al regolamento ufficiale ─────────
//  - Reboot: respawn immediato all'ultimo checkpoint invece di aspettare
//    il round successivo e riapparire al Reboot Token. Cambiare questo
//    comportamento richiederebbe una gestione separata dei "robot fuori
//    dal tabellone" e modifiche al flusso UI.
//  - Nessun mazzo danno condiviso: SPAM va nel discard personale invece
//    di essere estratta dal deck condiviso di 40 carte danno.
//  - Haywire: non implementato (richiederebbe carte speciali separate).
//  - Shutdown: non implementato.
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

  // Shuffle locale — indipendente da Cards.js (necessario per rimescolare
  // il deck del simulatore durante execCard 'spam').
  function _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ── Utility ──────────────────────────────────────────────────────────────

  // Verifica se un muro blocca il movimento da (cx,cy) in direzione dir.
  // Controlla sia il lato della cella corrente sia il lato opposto
  // della cella di destinazione (entrambi possono ospitare il muro).
  function wallBlocks(cx, cy, dir) {
    if (Board.wallsAt(cx, cy).includes(dir)) return true;
    const v = VECS[dir];
    if (Board.wallsAt(cx + v[0], cy + v[1]).includes(OPP[dir])) return true;
    return false;
  }

  // Posizione di respawn: ultimo checkpoint raggiunto, altrimenti partenza.
  function respawnPos(s) {
    if (s.lastCheckpoint > 0) {
      const cp = (Board.data?.checkpoints ?? []).find(c => c.order === s.lastCheckpoint);
      if (cp) return { cx: cp.x, cy: cp.y };
    }
    return { cx: s.startCx, cy: s.startCy };
  }

  // ── Spinta a catena (push chain) ─────────────────────────────────────────
  //
  // Tenta di spingere il robot `pushedId` di 1 cella nella direzione `dir`.
  // Se nella cella di destinazione c'è un altro robot, lo spinge ricorsivamente
  // nella stessa direzione (catena). Se la catena è bloccata da un muro,
  // tutto il movimento fallisce e la funzione ritorna false.
  //
  // Un robot può essere spinto fuori dal tabellone o in un pit: in quel caso
  // va in respawn e la spinta è considerata riuscita (ritorna true).
  function tryPush(sim, pushedId, dir, actions) {
    const s = sim[pushedId];
    // Muro sul lato che stiamo attraversando → spinta bloccata
    if (wallBlocks(s.cx, s.cy, dir)) return false;

    const vec = VECS[dir];
    const nx = s.cx + vec[0];
    const ny = s.cy + vec[1];

    // Fuori dalla mappa → respawn (la caduta è considerata riuscita)
    if (!Board.inBounds(nx, ny)) {
      const rp = respawnPos(s);
      s.cx = rp.cx; s.cy = rp.cy;
      for (let j = 0; j < CONFIG.spamCardsOnFall; j++) {
        s.discard = s.discard ?? [];
        s.discard.unshift('spam');
      }
      actions.push({ type:'fall', id: pushedId, cx: nx, cy: ny,
                     respawnCx: rp.cx, respawnCy: rp.cy });
      return true;
    }

    // Pit → respawn
    if (Board.cellType(nx, ny) === 'pit') {
      const rp = respawnPos(s);
      s.cx = rp.cx; s.cy = rp.cy;
      for (let j = 0; j < CONFIG.spamCardsOnFall; j++) {
        s.discard = s.discard ?? [];
        s.discard.unshift('spam');
      }
      actions.push({ type:'fall', id: pushedId, cx: nx, cy: ny,
                     respawnCx: rp.cx, respawnCy: rp.cy });
      return true;
    }

    // Altro robot in (nx, ny) → spinta a catena (ricorsione)
    const blocker = Object.values(sim).find(o => o.id !== pushedId && o.cx === nx && o.cy === ny);
    if (blocker && !tryPush(sim, blocker.id, dir, actions)) return false;

    // Tutto ok: sposta il robot
    s.cx = nx; s.cy = ny;
    actions.push({ type:'move', id: pushedId, cx: nx, cy: ny });
    return true;
  }

  // ── Esecuzione carte ─────────────────────────────────────────────────────

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

      case 'again': {
        // Ripete il registro precedente.
        // Registro 1 (prevCard = null): "acts like SPAM" — regolamento pag. 11.
        if (prevCard) return execCard(sim, id, prevCard, null);
        return execCard(sim, id, 'spam', null);
      }

      case 'recharge': {
        s.energy = Math.min((s.energy ?? 0) + CONFIG.rechargeAmount, CONFIG.maxEnergy);
        return [{ type:'energy', id, energy: s.energy }];
      }

      case 'spam': {
        // Regola ufficiale (regolamento pag. 17):
        // 1. Scarta la SPAM nel damage discard pile (esce dal mazzo).
        // 2. Pesca la prima carta dal programming DECK (non dal discard!).
        // 3. Esegui la carta pescata.
        // 4. Se è SPAM: torna al punto 1 (anche quella SPAM viene eliminata,
        //    il giocatore si libera di 2+ SPAM per il prezzo di 1).
        //
        // Nella nostra versione semplificata:
        // - La SPAM scartata "sparisce" (non abbiamo un deck danno condiviso).
        // - Si pesca dal deck del simulatore (s.deck).
        // - Se il deck è vuoto: rimescola il discard in un nuovo deck.
        if (!s.deck?.length) {
          if (!s.discard?.length) return [];
          s.deck    = _shuffle([...s.discard]);
          s.discard = [];
        }
        // Pesca finché trova una carta non-SPAM
        while (s.deck.length) {
          const drawn = s.deck.pop();
          if (drawn !== 'spam') return execCard(sim, id, drawn, null);
          // Altra SPAM: viene eliminata (libera 2 SPAM per il prezzo di 1)
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
        // Caduta: respawn immediato (semplificazione vs regolamento)
        const rp = respawnPos(s);
        s.cx = rp.cx; s.cy = rp.cy;
        for (let j = 0; j < CONFIG.spamCardsOnFall; j++) {
          s.discard = s.discard ?? [];
          s.discard.unshift('spam');
        }
        actions.push({ type:'fall', id, cx: nx, cy: ny,
                       respawnCx: rp.cx, respawnCy: rp.cy });
        break;
      }

      // Robot in (nx, ny)? Tentativo di spinta
      const blocker = Object.values(sim).find(o => o.id !== id && o.cx === nx && o.cy === ny);
      if (blocker) {
        const pushActions = [];
        if (!tryPush(sim, blocker.id, dir, pushActions)) break; // spinta bloccata
        actions.push(...pushActions);
      }

      s.cx = nx; s.cy = ny;
      actions.push({ type:'move', id, cx: nx, cy: ny });
    }
    return actions;
  }

  // ── Nastri trasportatori ──────────────────────────────────────────────────
  //
  // Chiamata una volta per 'conveyor' (green) e DUE volte per
  // 'express_conveyor' (blue) — la seconda passata sposta solo i robot
  // che sono rimasti su un nastro express dopo la prima.
  //
  // Regole (regolamento pag. 12-14):
  // ● Tutti i robot sul nastro si muovono SIMULTANEAMENTE.
  // ● Se due robot puntano alla stessa cella: nessuno si muove.
  // ● I nastri NON spingono altri robot: se la destinazione è occupata
  //   da un robot che non si muove (o da un robot di un nastro diverso),
  //   il robot sul nastro si ferma.
  function applyConveyors(sim, beltType) {
    const actions = [];

    // Raccoglie i robot attualmente su questo tipo di nastro
    const onBelt = Object.values(sim).filter(s => Board._cellAt(s.cx, s.cy)?.type === beltType);
    if (!onBelt.length) return actions;

    // Calcola le destinazioni tentative per ogni robot sul nastro
    const intended = new Map(); // id → {nx, ny} | null
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

    // Regola: due robot puntano alla stessa cella → nessuno si muove
    const destCount = new Map();
    for (const [, move] of intended) {
      if (!move) continue;
      const key = `${move.nx},${move.ny}`;
      destCount.set(key, (destCount.get(key) || 0) + 1);
    }
    for (const [id, move] of intended) {
      if (!move) continue;
      if ((destCount.get(`${move.nx},${move.ny}`) || 0) > 1) intended.set(id, null);
    }

    // Regola: destinazione occupata da un robot che NON si muove → stop.
    // "Non si muove" = non è nel set di questo nastro, OPPURE è nel set
    // ma la sua intended è null (bloccato da un'altra regola).
    // Un robot nello stesso set con una destinazione valida "lascia" la
    // sua cella, quindi non è considerato bloccante.
    for (const [id, move] of intended) {
      if (!move) continue;
      const isBlocked = Object.values(sim).some(other => {
        if (other.id === id) return false;
        if (other.cx !== move.nx || other.cy !== move.ny) return false;
        const theirMove = intended.get(other.id);
        // Blocca se: non è su questo nastro (non in intended), o è bloccato (null)
        return theirMove === undefined || theirMove === null;
      });
      if (isBlocked) intended.set(id, null);
    }

    // Applica i movimenti validi
    for (const [id, move] of intended) {
      if (!move) continue;
      const s        = sim[id];
      const cellType = Board.cellType(move.nx, move.ny);
      if (cellType === 'pit') {
        const rp = respawnPos(s);
        s.cx = rp.cx; s.cy = rp.cy;
        for (let j = 0; j < CONFIG.spamCardsOnFall; j++) s.discard.unshift('spam');
        actions.push({ type:'fall', id, cx: move.nx, cy: move.ny,
                       respawnCx: rp.cx, respawnCy: rp.cy });
      } else {
        s.cx = move.nx; s.cy = move.ny;
        actions.push({ type:'move', id, cx: move.nx, cy: move.ny });
      }
    }

    return actions;
  }

  // ── Push panel ────────────────────────────────────────────────────────────
  //
  // Si attiva solo nei registri il cui numero (1-based) è elencato nel
  // campo activeRegisters della cella JSON.
  // Spinge nella direzione del pannello; usa tryPush → può innescare catene.
  function applyPushPanels(sim, regIndex) {
    const actions = [];
    for (const s of Object.values(sim)) {
      const cell = Board._cellAt(s.cx, s.cy);
      if (!cell || cell.type !== 'push_panel') continue;
      // regIndex è 0-based; activeRegisters nel JSON è 1-based
      if (!(cell.activeRegisters ?? []).includes(regIndex + 1)) continue;
      const pushActions = [];
      tryPush(sim, s.id, cell.dir, pushActions);
      actions.push(...pushActions);
    }
    return actions;
  }

  // ── Ingranaggi ────────────────────────────────────────────────────────────
  //
  // gear_cw → rotazione 90° in senso orario (rotRight).
  // gear_ccw → rotazione 90° in senso antiorario (rotLeft).
  // Attivati DOPO push panel e PRIMA dei laser.
  function applyGears(sim) {
    const actions = [];
    for (const s of Object.values(sim)) {
      const cell = Board._cellAt(s.cx, s.cy);
      if (!cell) continue;
      if (cell.type === 'gear_cw') {
        s.dir = rotRight(s.dir);
        actions.push({ type:'rotate', id: s.id, dir: s.dir });
      } else if (cell.type === 'gear_ccw') {
        s.dir = rotLeft(s.dir);
        actions.push({ type:'rotate', id: s.id, dir: s.dir });
      }
    }
    return actions;
  }

  // ── Laser di bordo ────────────────────────────────────────────────────────
  //
  // I laser fissi sul tabellone sparano lungo il raggio finché colpiscono
  // il primo robot in linea di tiro (bloccati dai muri, non da distanza).
  // Danno: strength SPAM per ogni laser che colpisce.
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

  // ── Laser dei robot ───────────────────────────────────────────────────────
  //
  // Dopo i laser di bordo, ogni robot spara il proprio laser built-in nella
  // direzione in cui è orientato (regolamento pag. 8, step 6).
  // Il laser colpisce il primo robot nell'allineamento (bloccato dai muri).
  // Danno: 1 SPAM. Si risolve in ordine di priorità (turnOrder).
  function fireRobotWeapons(sim) {
    const actions = [];
    for (const id of turnOrder()) {
      const shooter = sim[id];
      if (!shooter) continue;
      // Muro immediatamente davanti al robot → il laser non può uscire
      if (wallBlocks(shooter.cx, shooter.cy, shooter.dir)) continue;
      const vec = VECS[shooter.dir];
      let lx = shooter.cx + vec[0];
      let ly = shooter.cy + vec[1];
      while (Board.inBounds(lx, ly)) {
        const hit = Object.values(sim).find(s => s.id !== id && s.cx === lx && s.cy === ly);
        if (hit) {
          hit.discard = hit.discard ?? [];
          hit.discard.unshift('spam');
          actions.push({ type:'spam', id: hit.id });
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
    const all = State.getPlayerList();
    const idx = all.findIndex(p => p.id === State.energyToken);
    const from = idx >= 0 ? idx : 0;
    return [...all.slice(from), ...all.slice(0, from)].map(p => p.id);
  }

  // ── Applicazione azioni sullo stato reale (durante l'animazione) ──────────

  function applyAction(a) {
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
      case 'spam':
        // Danno ricevuto da laser (bordo o robot): aggiunge SPAM al discard.
        // Nota: non tocca p.deck (coerente con fireLasers/fireRobotWeapons).
        if (!p.discard) p.discard = [];
        p.discard.unshift('spam');
        break;
      case 'deck_sync':
        // Sincronizza il deck reale con quello calcolato dalla simulazione.
        // Necessario perché execCard('spam') pesca e rimuove carte da s.deck
        // durante compute(), ma queste modifiche non si propagano automaticamente
        // a p.deck. Viene aggiunto come ultimo step invisibile del plan.
        if (a.deck !== undefined) p.deck = a.deck;
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

  // ══════════════════════════════════════════════════════════════════════════
  return {

    // ── Calcolo del piano di esecuzione (solo host) ───────────────────────
    compute(allRegisters) {
      if (!State.isHost) return;

      // Costruisce il simulatore: una copia dello stato di ogni giocatore
      // su cui vengono applicati tutti i calcoli, senza toccare State.players.
      const sim = {};
      State.getPlayerList().forEach((p, i) => {
        const sp = Board.startPos(i);
        sim[p.id] = {
          id:             p.id,
          cx:             p.cx,
          cy:             p.cy,
          dir:            p.dir,
          startCx:        sp.x,
          startCy:        sp.y,
          lastCheckpoint: p.lastCheckpoint ?? 0,
          energy:         p.energy ?? CONFIG.startingEnergy,
          discard:        [...(p.discard ?? [])],
          deck:           [...(p.deck    ?? [])],  // necessario per execCard('spam')
          registers:      allRegisters[p.id] ?? [],
        };
      });

      const plan     = [];
      const prevCard = {};   // { playerId: lastNonAgainCard }
      const order    = turnOrder();
      let winner     = null;

      for (let reg = 0; reg < CONFIG.registersCount; reg++) {
        const regActions = [];

        // ── A. Attivazione carte programmazione ─────────────────────────────
        for (const id of order) {
          const card = sim[id]?.registers[reg];
          if (!card) continue;
          regActions.push(...execCard(sim, id, card, prevCard[id]));
          // 'again' non aggiorna prevCard: al prossimo registro
          // "Ripeti" ripete la stessa carta, non l'Again stesso.
          if (card !== 'again') prevCard[id] = card;
        }

        // ── B. Attivazione elementi del tabellone ────────────────────────────
        // Ordine fisso da regolamento ufficiale:

        // B1. Nastri express (blue) — prima passata
        regActions.push(...applyConveyors(sim, 'express_conveyor'));
        // B1. Nastri express — seconda passata (solo i robot ancora sul nastro)
        regActions.push(...applyConveyors(sim, 'express_conveyor'));
        // B2. Nastri normali (green)
        regActions.push(...applyConveyors(sim, 'conveyor'));
        // B3. Push panel (solo nei registri attivi)
        regActions.push(...applyPushPanels(sim, reg));
        // B4. Ingranaggi
        regActions.push(...applyGears(sim));
        // B5. Laser di bordo
        regActions.push(...fireLasers(sim));
        // B6. Laser dei robot
        regActions.push(...fireRobotWeapons(sim));

        // ── C. Fine registro (End of Register Activation) ───────────────────
        // C1. Batterie: +1 energia se il robot è su una cella recharge
        //     (regolamento pag. 8: avviene alla fine di OGNI registro,
        //      non solo alla fine di tutti e 5 come nella versione precedente)
        for (const id of order) {
          const s = sim[id];
          if (Board.cellType(s.cx, s.cy) === 'recharge') {
            s.energy = Math.min((s.energy ?? 0) + CONFIG.rechargeAmount, CONFIG.maxEnergy);
            regActions.push({ type:'energy', id, energy: s.energy });
          }
        }
        // C2. Checkpoint
        for (const id of order) {
          const cp = checkCheckpoint(sim[id]);
          if (!cp) continue;
          regActions.push(cp);
          if (cp.won) winner = id;
        }

        plan.push(regActions);
        if (winner) break;
      }

      // ── Step finale: sincronizzazione deck ──────────────────────────────
      // execCard('spam') ha potuto pescare/rimuovere carte da s.deck durante
      // la simulazione. Questo step invisibile allinea p.deck con s.deck
      // così al round successivo il giocatore parte con il deck corretto.
      plan.push(
        Object.values(sim).map(s => ({
          type: 'deck_sync',
          id:   s.id,
          deck: [...s.deck],
        }))
      );

      Net.broadcast({ type:'EXECUTE_PLAN', plan, winner, registers: allRegisters });
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
      const wait        = ms => new Promise(res => setTimeout(res, ms));

      // L'ultimo step nel plan è sempre deck_sync (invisibile, non animato).
      // animSteps = numero di registri effettivamente giocati.
      const animSteps = plan.length - 1;

      // ── Attesa avanzamento manuale ────────────────────────────────────────
      //
      // HOST: mostra "Avanti →", al click broadcast EXEC_ADVANCE e risolve.
      // NON-HOST: non mostra il bottone. State.execAdvance viene impostato
      //   come callback; quando arriva EXEC_ADVANCE → Execution.advance()
      //   → callback → animazione avanza in sincronia con l'host.
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

        // Highlight solo per i registri di gioco, non per deck_sync
        if (reg < animSteps) Game.highlightRegister(reg);

        for (const action of plan[reg]) {
          if (token.value) return;
          applyAction(action);
          // deck_sync è invisibile: nessuna pausa
          if (action.type === 'deck_sync') continue;
          const visual = action.type === 'move' || action.type === 'rotate' || action.type === 'fall';
          await wait(visual ? actionDelay : Math.max(60, actionDelay * 0.15));
        }

        if (token.value) return;

        // Pausa tra registri di gioco (non prima del deck_sync finale)
        if (reg < animSteps - 1) {
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
