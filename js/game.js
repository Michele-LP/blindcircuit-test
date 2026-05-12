// ═══════════════════════════════════════════════════════════════════════════
//  GAME.JS — v6.1
//
//  NOVITÀ:
//  ─ CELL letto da CONFIG.cellSize (40px anziché 48px)
//  ─ lerp dinamico in base a State.execSpeed (più veloce = lerp più alto)
//  ─ enterProgramming() / enterExecution() gestiscono il pannello laterale
//  ─ showExecPanel / highlightRegister / hideExecPanel: pannello esecuzione
//  ─ showAdvanceButton / init btn-skip-round
//  ─ Sprite PNG per i robot (fallback disegnato se PNG non disponibile)
// ═══════════════════════════════════════════════════════════════════════════

const Game = (() => {

  let CELL = CONFIG.cellSize;   // 40px
  const SZ = Math.round(CELL * 0.75); // ~30px sprite robot

  // Lerp in base alla velocità: lento → robot si muove piano; test → si teletrasporta
  const LERP_BY_SPEED = [0.07, 0.12, 0.18, 0.30];

  const canvas = document.getElementById('canvas');
  const ctx    = canvas.getContext('2d');

  const anim       = {};
  const _robotImgs = {};
  const DIR_ANGLE  = { N: -Math.PI/2, E: 0, S: Math.PI/2, W: Math.PI };

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

  function preloadRobotSprites() {
    for (const char of CONFIG.characters) {
      if (!char.sprite) continue;
      const img = new Image();
      img.src = char.sprite;
      _robotImgs[char.id] = img;
    }
  }

  // ─── Pannello laterale: helpers ─────────────────────────────────────────

  function setPanels(showProg, showExec) {
    const pp = document.getElementById('prog-panel');
    const ep = document.getElementById('exec-panel');
    if (pp) pp.style.display = showProg ? 'flex' : 'none';
    if (ep) ep.style.display = showExec ? 'flex' : 'none';
  }

  // ───────────────────────────────────────────────────────────────────────

  return {

    // ── Inizializzazione (chiamato da Lobby quando GAME_START arriva) ───────
    init(mapData, settings = {}) {
      // Applica impostazioni host (già in State per i guest, qui per l'host stesso)
      if (settings.execMode  !== undefined) State.execMode  = settings.execMode;
      if (settings.execSpeed !== undefined) State.execSpeed = settings.execSpeed;

      CELL = CONFIG.cellSize;

      Board.load(mapData);
      Board.preloadImages();
      preloadRobotSprites();

      State.phase = 'game';
      State.round = 0;

      canvas.width  = Board.W;
      canvas.height = Board.H;

      State.getPlayerList().forEach((p, i) => {
        const sp = Board.startPos(i);
        p.cx  = sp.x; p.cy  = sp.y; p.dir = sp.dir ?? 'N';
        p.energy = p.energy ?? CONFIG.startingEnergy;
        p.lastCheckpoint = 0;
        p.checkpoints    = [];
        initAnim(p);
      });

      State.energyToken = State.getPlayerList()[0]?.id ?? null;

      this._buildHud();
      document.getElementById('game-code').textContent = State.roomCode;

      // Pulsante "Round Successivo" — solo host, sempre visibile in game
      const skipBtn = document.getElementById('btn-skip-round');
      if (skipBtn) {
        skipBtn.style.display = State.isHost ? 'inline-flex' : 'none';
        skipBtn.onclick = () => Execution.skipToNextRound();
      }

      const advBtn = document.getElementById('btn-advance');
      if (advBtn) {
        advBtn.style.display = 'none';
        advBtn.onclick = () => Execution.advance();
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

    // ── Game loop ─────────────────────────────────────────────────────────
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
    },

    _drawRobot(p, rx, ry, angle) {
      const isMe  = p.id === State.myId;
      const char  = CONFIG.characters.find(c => c.id === p.character);
      const col   = char?.color ?? '#6b7280';
      const cx    = rx + CELL / 2;
      const cy    = ry + CELL / 2;
      const half  = SZ / 2;

      // Ombra
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + half + 4, half - 2, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Sprite PNG se disponibile e caricata
      const spriteImg = char ? _robotImgs[char.id] : null;
      if (spriteImg && spriteImg.complete && spriteImg.naturalWidth > 0) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.drawImage(spriteImg, -half, -half, SZ, SZ);
        ctx.restore();
        if (isMe) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          this._rrect(ctx, -half, -half, SZ, SZ, 6);
          ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; ctx.stroke();
          ctx.restore();
        }
      } else {
        // Fallback disegnato
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        this._rrect(ctx, -half, -half, SZ, SZ, 6);
        ctx.fillStyle = col; ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.moveTo(0, -half + 4); ctx.lineTo(-5, -half + 12); ctx.lineTo(5, -half + 12);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(-half+5, 2, 6, 5); ctx.fillRect(half-11, 2, 6, 5);
        if (isMe) {
          this._rrect(ctx, -half, -half, SZ, SZ, 6);
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.stroke();
        }
        ctx.restore();
      }

      // Etichetta fuori dalla rotazione
      ctx.fillStyle    = isMe ? '#e6edf3' : '#9ca3af';
      ctx.font         = `bold ${Math.max(8, CELL * 0.22)}px system-ui`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(
        (p.nickname || '?').substring(0, 8) + (p.energy != null ? ` ⚡${p.energy}` : ''),
        cx, ry - 2
      );

      const cps = p.checkpoints ?? [];
      if (cps.length) {
        ctx.textBaseline = 'top';
        ctx.font = `${CELL * 0.22}px system-ui`;
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

    // ── Mostra pannello programmazione ────────────────────────────────────
    enterProgramming() {
      setPanels(true, false);
      this.showAdvanceButton(false);
    },

    // ── Pannello esecuzione ───────────────────────────────────────────────
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

    // ── Message routing ────────────────────────────────────────────────────
    handleMessage(fromId, msg) {
      if (msg.type === 'MOVE') {
        const p = State.players[msg.from ?? fromId];
        if (p) { p.cx = msg.cx; p.cy = msg.cy; p.dir = msg.dir ?? p.dir; }
        return;
      }
      Cards.handleGameMessage(fromId, msg);
    },

    _buildHud() {
      const hud = document.getElementById('game-hud');
      hud.innerHTML = '';
      for (const p of State.getPlayerList()) {
        const char  = CONFIG.characters.find(c => c.id === p.character);
        const color = char?.color ?? '#6b7280';
        const isMe  = p.id === State.myId;
        const tag   = document.createElement('div');
        tag.className = 'player-tag' + (isMe ? ' is-me' : '');
        tag.innerHTML = `<div class="swatch" style="background:${color}"></div>
          <span>${(p.nickname||'?').substring(0,10)}${isMe?' (tu)':''}</span>`;
        hud.appendChild(tag);
      }
    },
  };
})();
