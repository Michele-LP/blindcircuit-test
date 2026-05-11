// ═══════════════════════════════════════════════════════════════════════════
//  GAME.JS — Canvas, robot, animazione lerp.
//
//  Fase 4: le frecce (test Fase 2) sono rimosse.
//          Il movimento avviene solo durante l'esecuzione delle carte.
//          Routing messaggi: MOVE → qui; tutto il resto → Cards / Execution.
// ═══════════════════════════════════════════════════════════════════════════

const Game = (() => {

  const CELL = 48;
  const SZ   = 36;

  const canvas = document.getElementById('canvas');
  const ctx    = canvas.getContext('2d');

  const anim = {};

  const DIR_ANGLE = { N: -Math.PI/2, E: 0, S: Math.PI/2, W: Math.PI };

  function lerp(a, b, t)       { return a + (b - a) * t; }
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

      // Posizione di partenza e init energia
      State.getPlayerList().forEach((p, i) => {
        const sp = Board.startPos(i);
        p.cx  = sp.x; p.cy = sp.y; p.dir = sp.dir ?? 'N';
        p.energy = p.energy ?? CONFIG.startingEnergy;
        p.lastCheckpoint = 0;
        p.checkpoints    = [];
        initAnim(p);
      });

      // Token energia al primo giocatore (host)
      State.energyToken = State.getPlayerList()[0]?.id ?? null;

      this._buildHud();
      document.getElementById('game-code').textContent = State.roomCode;
      Cards.preload();
      UI.show('game');

      // Avvia loop rendering
      requestAnimationFrame(() => this._loop());

      // Host: avvia il primo round dopo 1s
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

      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(0, half + 4, half - 2, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      this._rrect(ctx, -half, -half, SZ, SZ, 7);
      ctx.fillStyle = col; ctx.fill();

      this._rrect(ctx, -half + 3, -half + 3, SZ - 6, 12, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill();

      // Indicatore direzione (triangolo in cima)
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(0, -half + 5); ctx.lineTo(-6, -half + 14); ctx.lineTo(6, -half + 14);
      ctx.closePath(); ctx.fill();

      // Occhi
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(-half+6, 2, 7, 6); ctx.fillRect(half-13, 2, 7, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(-half+7, 3, 3, 3); ctx.fillRect(half-11, 3, 3, 3);

      if (isMe) {
        this._rrect(ctx, -half, -half, SZ, SZ, 7);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.stroke();
      }

      ctx.restore();

      // Nickname + energia (fuori dalla rotazione)
      ctx.fillStyle    = isMe ? '#e6edf3' : '#9ca3af';
      ctx.font         = 'bold 10px system-ui';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      const label = (p.nickname || '?').substring(0, 10)
        + (p.energy != null ? ` ⚡${p.energy}` : '');
      ctx.fillText(label, cx, ry - 3);

      // Checkpoint conquistati (piccoli punti sotto lo sprite)
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
      ctx.lineTo(x+w-r, y);     ctx.quadraticCurveTo(x+w, y,     x+w, y+r);
      ctx.lineTo(x+w, y+h-r);   ctx.quadraticCurveTo(x+w, y+h,   x+w-r, y+h);
      ctx.lineTo(x+r, y+h);     ctx.quadraticCurveTo(x,   y+h,   x, y+h-r);
      ctx.lineTo(x, y+r);       ctx.quadraticCurveTo(x,   y,     x+r, y);
      ctx.closePath();
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
