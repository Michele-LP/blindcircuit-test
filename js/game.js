// ═══════════════════════════════════════════════════════════════════════════
//  GAME.JS — Canvas, robot, animazione lerp, pannello esecuzione.
//
//  MODIFICHE v6:
//  - lerp rallentato: 0.18 → 0.09 (robot si muovono più lentamente)
//  - Sprite PNG robot (fallback ai robot disegnati se PNG non carica)
//  - showExecPanel / highlightRegister / hideExecPanel per il pannello UI
// ═══════════════════════════════════════════════════════════════════════════

const Game = (() => {

  const CELL = 48;
  const SZ   = 36;
  const LERP = 0.09;   // era 0.18 — movimenti più leggibili

  const canvas = document.getElementById('canvas');
  const ctx    = canvas.getContext('2d');

  const anim        = {};
  const _robotImgs  = {};   // { charId: HTMLImageElement }
  const DIR_ANGLE   = { N: -Math.PI/2, E: 0, S: Math.PI/2, W: Math.PI };

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

  // ── Precaricamento sprite robot ───────────────────────────────────────────
  function preloadRobotSprites() {
    for (const char of CONFIG.characters) {
      if (!char.sprite) continue;
      const img = new Image();
      img.src = char.sprite;
      _robotImgs[char.id] = img;
    }
  }

  return {

    init(mapData) {
      Board.load(mapData);
      Board.preloadImages();      // ← carica PNG tile in parallelo
      preloadRobotSprites();      // ← carica PNG robot in parallelo

      State.phase = 'game';
      State.round = 0;

      canvas.width  = Board.W;
      canvas.height = Board.H;

      State.getPlayerList().forEach((p, i) => {
        const sp = Board.startPos(i);
        p.cx  = sp.x; p.cy = sp.y; p.dir = sp.dir ?? 'N';
        p.energy = p.energy ?? CONFIG.startingEnergy;
        p.lastCheckpoint = 0;
        p.checkpoints    = [];
        initAnim(p);
      });

      State.energyToken = State.getPlayerList()[0]?.id ?? null;

      this._buildHud();
      document.getElementById('game-code').textContent = State.roomCode;
      this.hideExecPanel();
      Cards.preload();
      UI.show('game');

      requestAnimationFrame(() => this._loop());

      if (State.isHost) {
        setTimeout(() => {
          State.round = 1;
          Net.sendToAll({
            type:     'ROUND_START',
            round:    State.round,
            timerSec: CONFIG.programmingTimerSec,
          });
        }, 1000);
      }
    },

    _loop() {
      this._updateAnim();
      this._render();
      requestAnimationFrame(() => this._loop());
    },

    _updateAnim() {
      for (const p of Object.values(State.players)) {
        if (p.cx === undefined) continue;
        initAnim(p);
        const a = anim[p.id];
        a.renderX     = lerp(a.renderX,     p.cx * CELL,           LERP);
        a.renderY     = lerp(a.renderY,     p.cy * CELL,           LERP);
        a.renderAngle = lerpAngle(a.renderAngle, DIR_ANGLE[p.dir] ?? 0, LERP);
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
      const isMe = p.id === State.myId;
      const char = CONFIG.characters.find(c => c.id === p.character);
      const col  = char?.color ?? '#6b7280';
      const cx   = rx + CELL / 2;
      const cy   = ry + CELL / 2;
      const half = SZ / 2;

      // ── Ombra ─────────────────────────────────────────────────────────────
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + half + 4, half - 2, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // ── Sprite PNG se disponibile ──────────────────────────────────────────
      const spriteImg = char ? _robotImgs[char.id] : null;
      if (spriteImg && spriteImg.complete && spriteImg.naturalWidth > 0) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.drawImage(spriteImg, -half, -half, SZ, SZ);
        ctx.restore();

        // Bordo se sono io
        if (isMe) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          this._rrect(ctx, -half, -half, SZ, SZ, 7);
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
      } else {
        // ── Fallback: robot disegnato ──────────────────────────────────────
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);

        this._rrect(ctx, -half, -half, SZ, SZ, 7);
        ctx.fillStyle = col; ctx.fill();

        this._rrect(ctx, -half + 3, -half + 3, SZ - 6, 12, 4);
        ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.moveTo(0, -half + 5); ctx.lineTo(-6, -half + 14); ctx.lineTo(6, -half + 14);
        ctx.closePath(); ctx.fill();

        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(-half+6, 2, 7, 6); ctx.fillRect(half-13, 2, 7, 6);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(-half+7, 3, 3, 3); ctx.fillRect(half-11, 3, 3, 3);

        if (isMe) {
          this._rrect(ctx, -half, -half, SZ, SZ, 7);
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.stroke();
        }

        ctx.restore();
      }

      // ── Etichetta (fuori dalla rotazione) ──────────────────────────────────
      ctx.fillStyle    = isMe ? '#e6edf3' : '#9ca3af';
      ctx.font         = 'bold 10px system-ui';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      const label = (p.nickname || '?').substring(0, 10)
        + (p.energy != null ? ` ⚡${p.energy}` : '');
      ctx.fillText(label, cx, ry - 3);

      const cps = p.checkpoints ?? [];
      if (cps.length) {
        ctx.textBaseline = 'top';
        ctx.font = '10px system-ui';
        ctx.fillText('★'.repeat(cps.length), cx, ry + SZ + 5);
      }
    },

    _rrect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x+r, y);
      ctx.lineTo(x+w-r, y);     ctx.quadraticCurveTo(x+w, y,   x+w, y+r);
      ctx.lineTo(x+w, y+h-r);   ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
      ctx.lineTo(x+r, y+h);     ctx.quadraticCurveTo(x,   y+h, x, y+h-r);
      ctx.lineTo(x, y+r);       ctx.quadraticCurveTo(x,   y,   x+r, y);
      ctx.closePath();
    },

    // ── Pannello esecuzione ───────────────────────────────────────────────────
    showExecPanel(registers) {
      // registers = { playerId: ['move1', 'rotateLeft', ...] }
      const panel = document.getElementById('exec-panel');
      if (!panel) return;

      panel.innerHTML = '';

      // Titolo
      const title = document.createElement('div');
      title.id = 'exec-panel-title';
      title.textContent = '— Programma in esecuzione —';
      panel.appendChild(title);

      for (const p of State.getPlayerList()) {
        const regs = registers[p.id] ?? [];
        const char  = CONFIG.characters.find(c => c.id === p.character);
        const color = char?.color ?? '#6b7280';
        const isMe  = p.id === State.myId;

        const row = document.createElement('div');
        row.className = 'exec-player-row' + (isMe ? ' is-me' : '');

        const nameEl = document.createElement('div');
        nameEl.className = 'exec-player-name';
        nameEl.style.color = color;
        nameEl.textContent = (p.nickname || '?').substring(0, 10) + (isMe ? ' (tu)' : '');
        row.appendChild(nameEl);

        const regsEl = document.createElement('div');
        regsEl.className = 'exec-registers';

        for (let i = 0; i < CONFIG.registersCount; i++) {
          const cardId = regs[i] ?? null;
          const def    = CONFIG.cards.find(c => c.id === cardId);
          const slot   = document.createElement('div');
          slot.className = 'exec-card-slot';
          slot.id = `exec-slot-${p.id}-${i}`;
          slot.title = def?.name ?? '—';

          if (def?.image) {
            slot.style.backgroundImage = `url('${def.image}')`;
          }

          // Abbreviazione in basso per leggibilità
          const abbr = document.createElement('span');
          abbr.className = 'card-abbr';
          abbr.textContent = (def?.name ?? '?').substring(0, 5).toUpperCase();
          slot.appendChild(abbr);

          regsEl.appendChild(slot);
        }
        row.appendChild(regsEl);
        panel.appendChild(row);
      }

      panel.style.display = 'flex';
    },

    highlightRegister(stepIndex) {
      // Rimuovi highlight precedenti
      document.querySelectorAll('.exec-card-slot').forEach(el => {
        el.classList.remove('exec-active');
      });
      // Evidenzia colonna corrente per tutti i giocatori
      for (const p of State.getPlayerList()) {
        const slot = document.getElementById(`exec-slot-${p.id}-${stepIndex}`);
        if (slot) slot.classList.add('exec-active');
      }
      // Aggiorna titolo
      const title = document.getElementById('exec-panel-title');
      if (title) title.textContent = `Registro P${stepIndex + 1} di ${CONFIG.registersCount}`;
    },

    hideExecPanel() {
      const panel = document.getElementById('exec-panel');
      if (panel) {
        panel.style.display = 'none';
        panel.innerHTML = '';
      }
    },

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
          <span>${(p.nickname||'?').substring(0,12)}${isMe?' (tu)':''}</span>`;
        hud.appendChild(tag);
      }
    },
  };
})();
