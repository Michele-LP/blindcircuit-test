// ═══════════════════════════════════════════════════════════════════════════
//  GAME.JS — v6.2
//
//  NOVITÀ:
//  ─ _computeCellSize(): dimensione cella calcolata dallo spazio disponibile
//    → mappa grande quanto possibile, si adatta automaticamente a schermi diversi
//    → funziona con qualsiasi dimensione di mappa futura
//  ─ SZ = CELL * 0.85 → robot più grandi e visibili
//  ─ HUD con immagine robot reale + energia + ★ checkpoint, aggiornati ogni frame
//  ─ Pulsante "Salta round" rinominato con tooltip esplicativo
// ═══════════════════════════════════════════════════════════════════════════

const Game = (() => {

  // Mutabili: ricalcolati in init() per ogni mappa
  let CELL = CONFIG.cellSize;
  let SZ   = Math.round(CELL * 0.85);

  const LERP_BY_SPEED = [0.07, 0.12, 0.18, 0.30];

  // I PNG dei robot sono orientati verso Sud (giù) per default.
  // Il sistema di rotazione usa Est (destra) = 0°.
  // Offset -π/2 compensa: ruota lo sprite di -90° prima di applicare
  // la direzione del robot → Sud + (-90°) = Est = orientamento base corretto.
  const SPRITE_ROT_OFFSET = -Math.PI / 2;

  const canvas = document.getElementById('canvas');
  const ctx    = canvas.getContext('2d');
  const anim   = {};
  const _robotImgs = {};
  const DIR_ANGLE = { N: -Math.PI/2, E: 0, S: Math.PI/2, W: Math.PI };

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpAngle(a, b, t) {
    while (b - a >  Math.PI) a += Math.PI * 2;
    while (a - b >  Math.PI) b += Math.PI * 2;
    return a + (b - a) * t;
  }

  function initAnim(p) {
    if (!anim[p.id]) {
      anim[p.id] = {
        renderX:     p.cx * CELL,
        renderY:     p.cy * CELL,
        renderAngle: DIR_ANGLE[p.dir] ?? 0,
      };
    }
  }

  // ── Calcola la dimensione ottimale della cella ────────────────────────────
  //
  // Obiettivo: la mappa deve occupare tutto lo spazio disponibile, senza
  // essere più grande della viewport. Si adatta sia al numero di celle
  // (mapW × mapH) sia alla risoluzione dello schermo.
  //
  // Layout: [canvas] [sidebar 260px] con gap 16px e padding corpo 32px.
  // L'altezza tiene conto della top bar (~56px) e dei controlli (~40px).
  //
  function _computeCellSize(mapW, mapH) {
    const SIDEBAR   = 260 + 16;  // pannello laterale + gap
    const PAD_H     = 32;        // padding orizzontale body (2×16)
    const OVERHEAD_V = 56 + 40 + 32; // top-bar + controlli + padding verticale

    // Larghezza disponibile per il canvas (limitata al container max 1200px)
    const maxContainerW = 1200 - PAD_H;
    const screenW       = window.innerWidth - PAD_H;
    const availW = Math.max(300, Math.min(screenW, maxContainerW) - SIDEBAR);

    // Altezza disponibile per il canvas
    const availH = Math.max(300, window.innerHeight - OVERHEAD_V);

    const byW = Math.floor(availW / mapW);
    const byH = Math.floor(availH / mapH);

    // Prende il minore per garantire che la mappa stia in entrambe le dimensioni
    // Min 36px (leggibile), max 80px (non esagerato)
    return Math.max(36, Math.min(byW, byH, 80));
  }

  function preloadRobotSprites() {
    for (const char of CONFIG.characters) {
      if (!char.sprite || _robotImgs[char.id]) continue;
      const img = new Image();
      img.src = char.sprite;
      _robotImgs[char.id] = img;
    }
  }

  function setPanels(showProg, showExec) {
    const pp = document.getElementById('prog-panel');
    const ep = document.getElementById('exec-panel');
    if (pp) pp.style.display = showProg ? 'flex' : 'none';
    if (ep) ep.style.display = showExec ? 'flex' : 'none';
  }

  // ── Costruisce un elemento immagine robot con fallback emoji ──────────────
  function _makeRobotImg(char, cssClass) {
    if (char?.sprite) {
      const img = document.createElement('img');
      img.className = cssClass;
      img.src = char.sprite;
      img.alt = char.name;
      img.onerror = function() {
        this.style.display = 'none';
        const fb = document.createElement('span');
        fb.className = cssClass.replace('-img', '-emoji');
        fb.textContent = char.emoji;
        this.parentElement?.appendChild(fb);
      };
      return img;
    }
    const em = document.createElement('span');
    em.className = cssClass.replace('-img', '-emoji');
    em.textContent = char?.emoji ?? '🤖';
    return em;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  return {

    init(mapData, settings = {}) {
      if (settings.execMode  !== undefined) State.execMode  = settings.execMode;
      if (settings.execSpeed !== undefined) State.execSpeed = settings.execSpeed;

      // 1. Dimensioni mappa
      const mapW = mapData?.width  ?? 12;
      const mapH = mapData?.height ?? 12;

      // 2. Calcolo dimensione ottimale della cella
      CELL = _computeCellSize(mapW, mapH);
      SZ   = Math.round(CELL * 0.85);

      // 3. Board: imposta CELL PRIMA di load() (che usa CELL per calcolare W/H)
      Board.CELL = CELL;
      Board.load(mapData);
      Board.preloadImages();
      preloadRobotSprites();

      State.phase = 'game';
      State.round = 0;

      canvas.width  = Board.W;
      canvas.height = Board.H;

      // 4. Adatta il pannello laterale all'altezza del canvas
      const gameSide = document.getElementById('game-side');
      if (gameSide) gameSide.style.maxHeight = `${Board.H}px`;

      State.getPlayerList().forEach((p, i) => {
        const sp = Board.startPos(i);
        p.cx  = sp.x; p.cy  = sp.y; p.dir = sp.dir ?? 'N';
        p.energy         = p.energy ?? CONFIG.startingEnergy;
        p.lastCheckpoint = 0;
        p.checkpoints    = [];
        initAnim(p);
      });

      State.energyToken = State.getPlayerList()[0]?.id ?? null;

      this._buildHud();
      document.getElementById('game-code').textContent = State.roomCode;

      // Pulsante "Avanti →" (modalità manuale)
      const advBtn = document.getElementById('btn-advance');
      if (advBtn) {
        advBtn.style.display = 'none';
        advBtn.onclick = () => Execution.advance();
      }

      // Pulsante "Salta round" — solo host, scopo: testing
      const skipBtn = document.getElementById('btn-skip-round');
      if (skipBtn) {
        skipBtn.style.display = State.isHost ? 'inline-flex' : 'none';
        skipBtn.textContent   = '⏭ Salta round';
        skipBtn.title         = 'Salta l\'esecuzione corrente e avvia il round successivo — utile durante lo sviluppo per testare rapidamente senza aspettare l\'animazione';
        skipBtn.onclick       = () => Execution.skipToNextRound();
      }

      setPanels(false, false);
      Cards.preload();
      UI.show('game');

      requestAnimationFrame(() => this._loop());

      if (State.isHost) {
        setTimeout(() => {
          State.round = 1;
          Net.sendToAll({ type: 'ROUND_START', round: State.round, timerSec: 0 });
        }, 1000);
      }
    },

    // ── Game loop ──────────────────────────────────────────────────────────
    _loop() {
      this._updateAnim();
      this._render();
      requestAnimationFrame(() => this._loop());
    },

    _updateAnim() {
      const speed = Math.max(1, Math.min(4, State.execSpeed ?? 2));
      const L = LERP_BY_SPEED[speed - 1];
      for (const p of Object.values(State.players)) {
        if (p.cx === undefined) continue;
        initAnim(p);
        const a = anim[p.id];
        a.renderX     = lerp(a.renderX,     p.cx * CELL,           L);
        a.renderY     = lerp(a.renderY,     p.cy * CELL,           L);
        a.renderAngle = lerpAngle(a.renderAngle, DIR_ANGLE[p.dir] ?? 0, L);
      }
    },

    _render() {
      Board.render(ctx);
      for (const p of Object.values(State.players)) {
        if (p.cx === undefined) continue;
        const a = anim[p.id];
        if (a) this._drawRobot(p, a.renderX, a.renderY, a.renderAngle);
      }
      // Aggiorna energia e checkpoint nelle card HUD ogni frame (operazione leggera)
      this._updateHudSubs();
    },

    _drawRobot(p, rx, ry, angle) {
      const isMe = p.id === State.myId;
      const char = CONFIG.characters.find(c => c.id === p.character);
      const col  = char?.color ?? '#6b7280';
      const cx   = rx + CELL / 2;
      const cy   = ry + CELL / 2;
      const half = SZ / 2;

      // Ombra
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + half + 3, half - 2, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Sprite PNG (se disponibile e caricata)
      const spriteImg = char ? _robotImgs[char.id] : null;
      if (spriteImg && spriteImg.complete && spriteImg.naturalWidth > 0) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle + SPRITE_ROT_OFFSET);
        ctx.drawImage(spriteImg, -half, -half, SZ, SZ);
        ctx.restore();
        if (isMe) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle + SPRITE_ROT_OFFSET);
          this._rrect(ctx, -half, -half, SZ, SZ, 6);
          ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2; ctx.stroke();
          ctx.restore();
        }
      } else {
        // Fallback: robot disegnato con canvas
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        this._rrect(ctx, -half, -half, SZ, SZ, 6);
        ctx.fillStyle = col; ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.moveTo(0, -half+4); ctx.lineTo(-6, -half+14); ctx.lineTo(6, -half+14);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(-half+6, 2, 7, 6); ctx.fillRect(half-13, 2, 7, 6);
        if (isMe) {
          this._rrect(ctx, -half, -half, SZ, SZ, 6);
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.stroke();
        }
        ctx.restore();
      }

      // Etichetta (fuori dalla rotazione)
      ctx.fillStyle    = isMe ? '#e6edf3' : '#9ca3af';
      ctx.font         = `bold ${Math.max(9, Math.round(CELL * 0.2))}px system-ui`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(
        (p.nickname || '?').substring(0, 8) + (p.energy != null ? ` ⚡${p.energy}` : ''),
        cx, ry - 2
      );
      const cps = p.checkpoints ?? [];
      if (cps.length) {
        ctx.textBaseline = 'top';
        ctx.font = `${Math.round(CELL * 0.2)}px system-ui`;
        ctx.fillText('★'.repeat(cps.length), cx, ry + SZ + 3);
      }
    },

    _rrect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x+r, y);
      ctx.lineTo(x+w-r, y);   ctx.quadraticCurveTo(x+w, y,   x+w, y+r);
      ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
      ctx.lineTo(x+r, y+h);   ctx.quadraticCurveTo(x,   y+h, x, y+h-r);
      ctx.lineTo(x, y+r);     ctx.quadraticCurveTo(x,   y,   x+r, y);
      ctx.closePath();
    },

    // ── HUD: card per ogni giocatore con sprite robot ─────────────────────
    _buildHud() {
      const hud = document.getElementById('game-hud');
      if (!hud) return;
      hud.innerHTML = '';

      for (const p of State.getPlayerList()) {
        const char  = CONFIG.characters.find(c => c.id === p.character);
        const color = char?.color ?? '#6b7280';
        const isMe  = p.id === State.myId;

        const card = document.createElement('div');
        card.className = 'hud-card' + (isMe ? ' is-me' : '');
        card.dataset.pid = p.id;

        // Contenitore immagine robot
        const wrap = document.createElement('div');
        wrap.className = 'hud-robot-wrap';
        wrap.style.cssText = `background:${color}22;border:1px solid ${color}55;`;
        wrap.appendChild(_makeRobotImg(char, 'hud-robot-img'));
        card.appendChild(wrap);

        // Testo
        const info = document.createElement('div');
        info.className = 'hud-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'hud-name';
        nameEl.textContent = (p.nickname || '?').substring(0, 10) + (isMe ? ' (tu)' : '');

        const subEl = document.createElement('div');
        subEl.className = 'hud-sub';
        subEl.id = `hud-sub-${p.id}`;
        subEl.textContent = `⚡${p.energy ?? CONFIG.startingEnergy}`;

        info.appendChild(nameEl);
        info.appendChild(subEl);
        card.appendChild(info);
        hud.appendChild(card);
      }
    },

    // Aggiorna solo la riga energia/checkpoint (chiamata ogni frame, leggera)
    _updateHudSubs() {
      for (const p of State.getPlayerList()) {
        const el = document.getElementById(`hud-sub-${p.id}`);
        if (!el) continue;
        const cp = (p.checkpoints ?? []).length;
        el.textContent = `⚡${p.energy ?? CONFIG.startingEnergy}${cp > 0 ? ' ' + '★'.repeat(cp) : ''}`;
      }
    },

    // ── Pannello laterale ──────────────────────────────────────────────────
    enterProgramming() {
      setPanels(true, false);
      this.showAdvanceButton(false);
    },

    showExecPanel(registers) {
      setPanels(false, true);
      const ep = document.getElementById('exec-panel');
      if (!ep) return;
      ep.innerHTML = '';

      const title = document.createElement('div');
      title.id = 'exec-panel-title';
      title.textContent = '— In esecuzione —';
      ep.appendChild(title);

      for (const p of State.getPlayerList()) {
        const regs  = registers?.[p.id] ?? [];
        const char  = CONFIG.characters.find(c => c.id === p.character);
        const color = char?.color ?? '#6b7280';
        const isMe  = p.id === State.myId;

        const row = document.createElement('div');
        row.className = 'exec-player-row' + (isMe ? ' is-me' : '');

        const nameEl = document.createElement('div');
        nameEl.className = 'exec-player-name';
        nameEl.style.color = color;
        nameEl.textContent = (p.nickname || '?').substring(0, 9) + (isMe ? ' ◀' : '');
        row.appendChild(nameEl);

        const regsEl = document.createElement('div');
        regsEl.className = 'exec-registers';
        for (let i = 0; i < CONFIG.registersCount; i++) {
          const cardId = regs[i] ?? null;
          const def    = CONFIG.cards.find(c => c.id === cardId);
          const slot   = document.createElement('div');
          slot.className = 'exec-card-slot';
          slot.id    = `exec-slot-${p.id}-${i}`;
          slot.title = def?.name ?? '—';
          if (def?.image) {
            slot.style.backgroundImage = `url('${def.image}')`;
            slot.style.backgroundSize  = 'contain';
            slot.style.backgroundRepeat = 'no-repeat';
            slot.style.backgroundPosition = 'center';
          }
          const abbr = document.createElement('span');
          abbr.className = 'card-abbr';
          abbr.textContent = (def?.name ?? (cardId ? '?' : '—')).substring(0, 6).toUpperCase();
          slot.appendChild(abbr);
          regsEl.appendChild(slot);
        }
        row.appendChild(regsEl);
        ep.appendChild(row);
      }
    },

    highlightRegister(stepIndex) {
      document.querySelectorAll('.exec-card-slot').forEach(el => el.classList.remove('exec-active'));
      for (const p of State.getPlayerList()) {
        const slot = document.getElementById(`exec-slot-${p.id}-${stepIndex}`);
        if (slot) slot.classList.add('exec-active');
      }
      const title = document.getElementById('exec-panel-title');
      if (title) title.textContent = `Registro P${stepIndex + 1} di ${CONFIG.registersCount}`;
    },

    hideExecPanel() {
      setPanels(false, false);
      this.showAdvanceButton(false);
    },

    showAdvanceButton(show) {
      const btn = document.getElementById('btn-advance');
      if (btn) btn.style.display = show ? 'inline-flex' : 'none';
    },

    handleMessage(fromId, msg) {
      if (msg.type === 'MOVE') {
        const p = State.players[msg.from ?? fromId];
        if (p) { p.cx = msg.cx; p.cy = msg.cy; p.dir = msg.dir ?? p.dir; }
        return;
      }
      Cards.handleGameMessage(fromId, msg);
    },
  };
})();
