// ═══════════════════════════════════════════════════════════════════════════
//  GAME.JS — Game loop, rendering robot, input.
//
//  FASE 2:
//  - Robot posizionati sulla griglia (cx, cy in celle + dir N/E/S/O)
//  - Animazione fluida: renderX/Y lerp verso la posizione target ogni frame
//  - Rotazione dello sprite lerp verso la direzione target
//  - Frecce: spostamento di 1 cella per pressione (cooldown 150ms)
//  - La board (tabellone) è renderizzata da Board.render()
//
//  FASE 3 (prossima): sostituire il movimento libero con la fase di
//  programmazione (carte nei registri + esecuzione automatica).
// ═══════════════════════════════════════════════════════════════════════════

const Game = (() => {

  const CELL = 48;   // pixel per cella — deve essere uguale a Board.CELL
  const SZ   = 36;   // dimensione sprite robot in pixel

  const canvas = document.getElementById('canvas');
  const ctx    = canvas.getContext('2d');

  // ── Stato animazione (privato, solo per il rendering) ─────────────────────
  // Non va in State.players perché è pura visualizzazione locale.
  // { [playerId]: { renderX, renderY, renderAngle } }
  const anim = {};

  let active        = false;
  let lastMoveTime  = 0;
  const MOVE_CD     = 150; // ms di cooldown tra uno spostamento e il successivo

  // Mappa direzione → angolo radianti (N=su = -90°)
  const DIR_ANGLE = { N: -Math.PI/2, E: 0, S: Math.PI/2, W: Math.PI };

  // ── Input — DENTRO l'IIFE (qui `lastMoveTime` è nella closure) ───────────
  document.addEventListener('keydown', e => {
    if (!active) return;

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

    // Verifica bordi mappa
    if (!Board.inBounds(newCx, newCy)) return;

    // Aggiorno lo stato locale immediatamente (UX responsiva)
    me.cx  = newCx;
    me.cy  = newCy;
    me.dir = mv.dir;
    lastMoveTime = now;

    // Invio la nuova posizione agli altri
    Net.sendToAll({ type: 'MOVE', cx: me.cx, cy: me.cy, dir: me.dir });
  });

  // ── Funzioni helper ───────────────────────────────────────────────────────

  /** Interpolazione lineare */
  function lerp(a, b, t) { return a + (b - a) * t; }

  /**
   * Interpolazione angolare — prende il percorso più breve
   * (es. da 350° a 10° ruota 20° non 340°).
   */
  function lerpAngle(a, b, t) {
    while (b - a >  Math.PI) a += Math.PI * 2;
    while (a - b >  Math.PI) b += Math.PI * 2;
    return a + (b - a) * t;
  }

  /** Inizializza o aggiorna lo stato di animazione per un giocatore */
  function initAnim(p) {
    if (!anim[p.id]) {
      anim[p.id] = {
        renderX:     p.cx * CELL,
        renderY:     p.cy * CELL,
        renderAngle: DIR_ANGLE[p.dir] ?? 0,
      };
    }
  }

  // ── API pubblica ───────────────────────────────────────────────────────────
  return {

    // ── Avvio (chiamato da Lobby quando la partita inizia) ─────────────────
    init(mapData) {
      Board.load(mapData);
      State.phase = 'game';

      // Imposta il canvas alla dimensione della mappa
      canvas.width  = Board.W;
      canvas.height = Board.H;

      // Posiziona i giocatori alle posizioni di partenza del JSON
      State.getPlayerList().forEach((p, i) => {
        const sp = Board.startPos(i);
        p.cx  = sp.x;
        p.cy  = sp.y;
        p.dir = sp.dir ?? 'N';
        initAnim(p); // inizializza subito senza animazione
      });

      // Aggiorna HUD partita e codice stanza
      this._buildHud();
      document.getElementById('game-code').textContent = State.roomCode;

      UI.show('game');

      if (!active) {
        active = true;
        requestAnimationFrame(() => this.loop());
      }
    },

    // ── Game loop ──────────────────────────────────────────────────────────
    loop() {
      if (!active) return;
      this._updateAnim();
      this._render();
      requestAnimationFrame(() => this.loop());
    },

    // ── Aggiorna le posizioni di rendering (lerp verso target) ─────────────
    _updateAnim() {
      const LERP = 0.18; // velocità animazione: 0 = fermo, 1 = snap immediato

      for (const p of Object.values(State.players)) {
        if (p.cx === undefined) continue;
        initAnim(p);

        const a = anim[p.id];
        a.renderX     = lerp(a.renderX,     p.cx * CELL,           LERP);
        a.renderY     = lerp(a.renderY,     p.cy * CELL,           LERP);
        a.renderAngle = lerpAngle(a.renderAngle, DIR_ANGLE[p.dir] ?? 0, LERP);
      }
    },

    // ── Rendering ─────────────────────────────────────────────────────────
    _render() {
      // 1. Tabellone (da cache offscreen)
      Board.render(ctx);

      // 2. Robot sopra il tabellone
      for (const p of Object.values(State.players)) {
        if (p.cx === undefined) continue;
        const a = anim[p.id];
        if (!a) continue;
        this._drawRobot(p, a.renderX, a.renderY, a.renderAngle);
      }
    },

    // ── Disegna un singolo robot ──────────────────────────────────────────
    _drawRobot(p, rx, ry, angle) {
      const isMe = p.id === State.myId;
      const char = CONFIG.characters.find(c => c.id === p.character);
      const col  = char?.color ?? '#6b7280';

      // Centro sprite in pixel (ry = top-left, +CELL/2 per centrare nella cella)
      const cx = rx + CELL / 2;
      const cy = ry + CELL / 2;
      const half = SZ / 2;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle); // rotazione attorno al centro

      // Ombra
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(0, half + 4, half - 2, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Corpo
      this._rrect(ctx, -half, -half, SZ, SZ, 7);
      ctx.fillStyle = col;
      ctx.fill();

      // Highlight superiore
      this._rrect(ctx, -half + 3, -half + 3, SZ - 6, 12, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fill();

      // Triangolo direzione (punta "verso l'alto" prima della rotazione = direzione N)
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(0,       -half + 5);
      ctx.lineTo(-6,      -half + 14);
      ctx.lineTo(6,       -half + 14);
      ctx.closePath();
      ctx.fill();

      // Occhi
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(-half + 6,  2, 7, 6);
      ctx.fillRect(half  - 13, 2, 7, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(-half + 7,  3, 3, 3);
      ctx.fillRect(half  - 11, 3, 3, 3);

      // Bordo bianco se sono io
      if (isMe) {
        this._rrect(ctx, -half, -half, SZ, SZ, 7);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth   = 2;
        ctx.stroke();
      }

      ctx.restore();

      // Nickname sopra (fuori dalla rotazione, sempre leggibile)
      ctx.fillStyle    = isMe ? '#e6edf3' : '#9ca3af';
      ctx.font         = 'bold 10px system-ui';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText((p.nickname || '?').substring(0, 12), cx, ry - 3);
    },

    // ── Helper: rettangolo arrotondato ────────────────────────────────────
    _rrect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);     ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);     ctx.quadraticCurveTo(x, y + h,     x, y + h - r);
      ctx.lineTo(x, y + r);         ctx.quadraticCurveTo(x, y,          x + r, y);
      ctx.closePath();
    },

    // ── Gestisce messaggi di rete in fase game ────────────────────────────
    handleMessage(fromId, msg) {
      switch (msg.type) {
        case 'MOVE': {
          const id = msg.from ?? fromId;
          const p  = State.players[id];
          if (p) {
            p.cx  = msg.cx;
            p.cy  = msg.cy;
            p.dir = msg.dir ?? p.dir;
          }
          break;
        }
        // Fase 3+: REGISTER_SUBMIT, EXECUTE_STEP, ROUND_START, ecc.
      }
    },

    // ── Costruisce l'HUD con i nomi dei giocatori ─────────────────────────
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
