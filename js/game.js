// ═══════════════════════════════════════════════════════════════════════════
//  GAME.JS — Game loop, rendering tabellone + robot, input Fase 2.
//
//  FASE 3 aggiunge:
//  - Routing ROUND_START / PROGRAM_REGISTERS / ALL_PROGRAMMED → Cards
//  - Dopo Game.init() l'host avvia il primo round dopo 1s
//  - Le frecce restano solo come test: in Fase 4 il movimento
//    sarà pilotato dall'esecuzione automatica delle carte
// ═══════════════════════════════════════════════════════════════════════════

const Game = (() => {

  const CELL = 48;
  const SZ   = 36;

  const canvas = document.getElementById('canvas');
  const ctx    = canvas.getContext('2d');

  const anim = {};
  let active       = false;
  let lastMoveTime = 0;
  const MOVE_CD    = 150;

  const DIR_ANGLE = { N: -Math.PI/2, E: 0, S: Math.PI/2, W: Math.PI };

  // ── Input frecce (test Fase 2 — verrà rimosso in Fase 4) ──────────────
  document.addEventListener('keydown', e => {
    if (!active) return;
    // Non intercettare input durante la programmazione
    if (document.getElementById('scr-programming').classList.contains('active')) return;

    const now = performance.now();
    if (now - lastMoveTime < MOVE_CD) return;

    const me = State.myPlayer();
    if (!me || me.cx === undefined) return;

    const moves = {
      ArrowUp:    { dx:  0, dy: -1, dir: 'N' },
      ArrowDown:  { dx:  0, dy:  1, dir: 'S' },
      ArrowLeft:  { dx: -1, dy:  0, dir: 'W' },
      ArrowRight: { dx:  1, dy:  0, dir: 'E' },
    };
    const mv = moves[e.key];
    if (!mv) return;
    e.preventDefault();

    const newCx = me.cx + mv.dx;
    const newCy = me.cy + mv.dy;
    if (!Board.inBounds(newCx, newCy)) return;

    me.cx  = newCx;
    me.cy  = newCy;
    me.dir = mv.dir;
    lastMoveTime = now;
    Net.sendToAll({ type: 'MOVE', cx: me.cx, cy: me.cy, dir: me.dir });
  });

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

  return {

    init(mapData) {
      Board.load(mapData);
      State.phase = 'game';
      State.round = 0;

      canvas.width  = Board.W;
      canvas.height = Board.H;

      State.getPlayerList().forEach((p, i) => {
        const sp = Board.startPos(i);
        p.cx  = sp.x;
        p.cy  = sp.y;
        p.dir = sp.dir ?? 'N';
        initAnim(p);
      });

      this._buildHud();
      document.getElementById('game-code').textContent = State.roomCode;
      Cards.preload();
      UI.show('game');

      if (!active) {
        active = true;
        requestAnimationFrame(() => this.loop());
      }

      // Host avvia il primo round di programmazione dopo 1s
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

    loop() {
      if (!active) return;
      this._updateAnim();
      this._render();
      requestAnimationFrame(() => this.loop());
    },

    _updateAnim() {
      const LERP = 0.18;
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

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);

      // Ombra
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(0, half + 4, half - 2, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Corpo
      this._rrect(ctx, -half, -half, SZ, SZ, 7);
      ctx.fillStyle = col;
      ctx.fill();

      // Highlight
      this._rrect(ctx, -half + 3, -half + 3, SZ - 6, 12, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fill();

      // Triangolo direzione (punta verso N prima della rotazione)
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(0, -half + 5);
      ctx.lineTo(-6, -half + 14);
      ctx.lineTo(6,  -half + 14);
      ctx.closePath();
      ctx.fill();

      // Occhi
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(-half + 6,  2, 7, 6);
      ctx.fillRect(half - 13,  2, 7, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(-half + 7,  3, 3, 3);
      ctx.fillRect(half - 11,  3, 3, 3);

      if (isMe) {
        this._rrect(ctx, -half, -half, SZ, SZ, 7);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth   = 2;
        ctx.stroke();
      }

      ctx.restore();

      // Nickname (fuori dalla rotazione)
      ctx.fillStyle    = isMe ? '#e6edf3' : '#9ca3af';
      ctx.font         = 'bold 10px system-ui';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText((p.nickname || '?').substring(0, 12), cx, ry - 3);
    },

    _rrect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);     ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);     ctx.quadraticCurveTo(x, y + h,     x, y + h - r);
      ctx.lineTo(x, y + r);         ctx.quadraticCurveTo(x, y,          x + r, y);
      ctx.closePath();
    },

    // Routing messaggi: MOVE va al rendering, tutto il resto a Cards
    handleMessage(fromId, msg) {
      if (msg.type === 'MOVE') {
        const id = msg.from ?? fromId;
        const p  = State.players[id];
        if (p) { p.cx = msg.cx; p.cy = msg.cy; p.dir = msg.dir ?? p.dir; }
        return;
      }
      // ROUND_START, PROGRAM_REGISTERS, ALL_PROGRAMMED → Cards
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
          <span>${(p.nickname || '?').substring(0, 12)}${isMe ? ' (tu)' : ''}</span>`;
        hud.appendChild(tag);
      }
    },
  };
})();
