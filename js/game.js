// ═══════════════════════════════════════════════════════════════════════════
//  GAME.JS
//  Game loop e rendering canvas.
//
//  FASE 1 (attuale): movimento libero con frecce, sprite colorati.
//  FASE 2: griglia discreta, carte, turni, nastri, laser, checkpoint.
//
//  FIX applicato: i listener keydown/keyup sono stati spostati DENTRO
//  l'IIFE, dove la variabile `keys` è accessibile tramite closure.
//  Prima erano fuori → ReferenceError al primo tasto premuto.
// ═══════════════════════════════════════════════════════════════════════════

const Game = (() => {

  // ── Costanti canvas ────────────────────────────────────────────────────────
  const CW   = 600;
  const CH   = 400;
  const SZ   = 36;
  const CELL = 40;
  const SPD  = 3;

  const canvas = document.getElementById('canvas');
  const ctx    = canvas.getContext('2d');

  const keys = {};
  let active = false;

  // ── Input — DENTRO l'IIFE (qui `keys` è nella closure) ────────────────────
  document.addEventListener('keydown', e => {
    keys[e.key] = true;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
      e.preventDefault();
    }
  });
  document.addEventListener('keyup', e => { keys[e.key] = false; });

  // ── API pubblica ───────────────────────────────────────────────────────────
  return {

    init(mapData) {
      State.phase = 'game';

      const positions = [
        [60,      CH/2 - SZ/2],
        [CW-96,   CH/2 - SZ/2],
        [CW/2-18, 40          ],
        [60,      CH-60       ],
        [CW-96,   CH-60       ],
        [CW/2-18, CH-60       ],
      ];

      State.getPlayerList().forEach((p, i) => {
        const pos = positions[i % positions.length];
        p.x = pos[0];
        p.y = pos[1];
      });

      this._buildHud();
      document.getElementById('game-code').textContent = State.roomCode;
      UI.show('game');

      if (!active) {
        active = true;
        requestAnimationFrame(() => this.loop());
      }
    },

    loop() {
      if (!active) return;
      this.update();
      this.render();
      requestAnimationFrame(() => this.loop());
    },

    update() {
      const me = State.myPlayer();
      if (!me || me.x === undefined) return;

      const ox = me.x, oy = me.y;

      if (keys['ArrowLeft'])  me.x = Math.max(0,       me.x - SPD);
      if (keys['ArrowRight']) me.x = Math.min(CW - SZ, me.x + SPD);
      if (keys['ArrowUp'])    me.y = Math.max(0,       me.y - SPD);
      if (keys['ArrowDown'])  me.y = Math.min(CH - SZ, me.y + SPD);

      if (me.x !== ox || me.y !== oy) {
        Net.sendToAll({ type: 'MOVE', x: me.x, y: me.y });
      }
    },

    handleMessage(fromId, msg) {
      switch (msg.type) {
        case 'MOVE': {
          const id = msg.from ?? fromId;
          const p  = State.players[id];
          if (p) { p.x = msg.x; p.y = msg.y; }
          break;
        }
      }
    },

    render() {
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, CW, CH);

      ctx.strokeStyle = '#161b22';
      ctx.lineWidth   = 1;
      for (let x = 0; x <= CW; x += CELL) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CH); ctx.stroke();
      }
      for (let y = 0; y <= CH; y += CELL) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke();
      }

      for (const p of Object.values(State.players)) {
        if (p.x !== undefined) this._drawSprite(p);
      }
    },

    _drawSprite(p) {
      const isMe = p.id === State.myId;
      const char = CONFIG.characters.find(c => c.id === p.character);
      const col  = char?.color ?? '#6b7280';
      const emo  = char?.emoji ?? '🤖';

      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.beginPath();
      ctx.ellipse(p.x + SZ/2, p.y + SZ + 4, SZ/2 - 3, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = col;
      this._rrect(p.x, p.y, SZ, SZ, 7);
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      this._rrect(p.x + 3, p.y + 3, SZ - 6, 12, 4);
      ctx.fill();

      ctx.font = '18px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emo, p.x + SZ/2, p.y + SZ/2 + 1);

      if (isMe) {
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth   = 2;
        this._rrect(p.x, p.y, SZ, SZ, 7);
        ctx.stroke();
      }

      ctx.fillStyle    = isMe ? '#e6edf3' : '#9ca3af';
      ctx.font         = 'bold 10px system-ui';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText((p.nickname || '?').substring(0, 12), p.x + SZ/2, p.y - 4);
    },

    _rrect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h,     x, y + h - r);
      ctx.lineTo(x, y + r);    ctx.quadraticCurveTo(x, y,          x + r, y);
      ctx.closePath();
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
        tag.innerHTML = `
          <div class="swatch" style="background:${color}"></div>
          <span>${(p.nickname || '?').substring(0, 12)}${isMe ? ' (tu)' : ''}</span>
        `;
        hud.appendChild(tag);
      }
    },
  };

})();
