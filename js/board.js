// ═══════════════════════════════════════════════════════════════════════════
//  BOARD.JS — Tabellone: dati mappa + rendering canvas.
//
//  Responsabilità:
//  - Carica i dati da un JSON di mappa
//  - Disegna tutte le celle, i muri, i checkpoint, i laser
//  - Fornisce helper per la logica di gioco (celle, muri, posizioni)
//
//  La board viene renderizzata su un canvas offscreen (cache) e poi
//  blittata ogni frame → il canvas principale ridisegna solo i robot.
// ═══════════════════════════════════════════════════════════════════════════

const Board = {

  CELL: 48,    // pixel per cella — deve coincidere con Game.CELL
  data: null,  // dati JSON della mappa
  W:    0,     // larghezza totale in pixel
  H:    0,     // altezza totale in pixel
  _cache: null, // canvas offscreen per evitare di ridisegnare ogni frame

  // ── Carica dati mappa ─────────────────────────────────────────────────────
  load(mapData) {
    if (!mapData) {
      // Fallback: griglia vuota 12×12 se il file mappa non esiste ancora
      mapData = {
        width: 12, height: 12,
        cells: [], walls: [], checkpoints: [], lasers: [],
        startPositions: [
          {x:1,y:11,dir:'N'},{x:3,y:11,dir:'N'},{x:5,y:11,dir:'N'},
          {x:6,y:11,dir:'N'},{x:8,y:11,dir:'N'},{x:10,y:11,dir:'N'},
        ],
      };
    }
    this.data   = mapData;
    this.W      = mapData.width  * this.CELL;
    this.H      = mapData.height * this.CELL;
    this._cache = null; // invalida il cache se si ricarica la mappa
  },

  // ── Rendering (usa cache offscreen) ───────────────────────────────────────
  render(ctx) {
    if (!this.data) return;

    if (!this._cache) {
      this._cache = document.createElement('canvas');
      this._cache.width  = this.W;
      this._cache.height = this.H;
      this._buildCache(this._cache.getContext('2d'));
    }

    ctx.drawImage(this._cache, 0, 0);
  },

  // ── Disegna la board completa sul canvas offscreen ────────────────────────
  _buildCache(ctx) {
    const { width, height } = this.data;

    // Sfondo base
    ctx.fillStyle = '#161b22';
    ctx.fillRect(0, 0, this.W, this.H);

    // Celle
    for (let cy = 0; cy < height; cy++) {
      for (let cx = 0; cx < width; cx++) {
        this._drawCell(ctx, cx, cy);
      }
    }

    // Posizioni di partenza (marcatori sottili)
    for (let i = 0; i < (this.data.startPositions || []).length; i++) {
      const sp = this.data.startPositions[i];
      this._drawStartMarker(ctx, sp.x, sp.y, i + 1);
    }

    // Checkpoint (sopra le celle)
    for (const cp of this.data.checkpoints || []) {
      this._drawCheckpoint(ctx, cp);
    }

    // Muri (sopra tutto il resto)
    for (const wall of this.data.walls || []) {
      this._drawWall(ctx, wall.x, wall.y, wall.side);
    }

    // Sorgenti laser
    for (const laser of this.data.lasers || []) {
      this._drawLaserSource(ctx, laser);
    }
  },

  // ── Singola cella ─────────────────────────────────────────────────────────
  _drawCell(ctx, cx, cy) {
    const S  = this.CELL;
    const px = cx * S;
    const py = cy * S;

    // Sfondo floor di default
    ctx.fillStyle = '#1c2128';
    ctx.fillRect(px, py, S, S);

    // Linea griglia sottile
    ctx.strokeStyle = '#21262d';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, S - 1, S - 1);

    // Tipo specifico
    const cell = this._cellAt(cx, cy);
    if (!cell) return;

    switch (cell.type) {
      case 'pit':              this._drawPit(ctx, px, py, S);                       break;
      case 'conveyor':         this._drawConveyor(ctx, px, py, S, cell.dir, false); break;
      case 'express_conveyor': this._drawConveyor(ctx, px, py, S, cell.dir, true);  break;
      case 'gear_cw':          this._drawGear(ctx, px, py, S, true);                break;
      case 'gear_ccw':         this._drawGear(ctx, px, py, S, false);               break;
      case 'recharge':         this._drawRecharge(ctx, px, py, S);                  break;
      case 'push_panel':       this._drawPushPanel(ctx, px, py, S, cell.dir);       break;
    }
  },

  _drawPit(ctx, px, py, S) {
    // Cella nera con bordo rosso scuro
    ctx.fillStyle = '#080c10';
    ctx.fillRect(px + 1, py + 1, S - 2, S - 2);
    const grad = ctx.createRadialGradient(px+S/2, py+S/2, 2, px+S/2, py+S/2, S/2-3);
    grad.addColorStop(0, '#000000');
    grad.addColorStop(1, '#080c10');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px + S/2, py + S/2, S/2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3d1010';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, S - 2, S - 2);
  },

  _drawConveyor(ctx, px, py, S, dir, isExpress) {
    ctx.fillStyle = isExpress ? '#191200' : '#181e28';
    ctx.fillRect(px, py, S, S);

    const color = isExpress ? '#e3b341' : '#4b5563';
    ctx.fillStyle = color;

    // Freccia principale
    this._arrow(ctx, px + S/2, py + S/2, S * 0.28, dir);
    ctx.fill();

    // Express: seconda freccia più piccola "a seguire"
    if (isExpress) {
      const off = this._dirVec(dir);
      this._arrow(ctx, px + S/2 - off.x * S * 0.28, py + S/2 - off.y * S * 0.28, S * 0.17, dir);
      ctx.fill();
    }
  },

  _drawGear(ctx, px, py, S, clockwise) {
    ctx.fillStyle = '#1a1f2e';
    ctx.fillRect(px, py, S, S);

    const cx = px + S/2, cy = py + S/2;
    const r  = S * 0.27;

    // Cerchio esterno
    ctx.strokeStyle = '#5b6794';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Simbolo rotazione
    ctx.fillStyle = '#8892b0';
    ctx.font = `bold ${S * 0.38}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(clockwise ? '↻' : '↺', cx, cy + 1);
  },

  _drawRecharge(ctx, px, py, S) {
    ctx.fillStyle = '#0b1a10';
    ctx.fillRect(px, py, S, S);

    const cx = px + S/2, cy = py + S/2;

    // Cerchio verde
    ctx.strokeStyle = '#3fb950';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.3, 0, Math.PI * 2);
    ctx.stroke();

    // Fulmine (semplificato con path)
    ctx.fillStyle = '#3fb950';
    ctx.beginPath();
    ctx.moveTo(cx + 3, cy - S*0.2);
    ctx.lineTo(cx - 4, cy + 1);
    ctx.lineTo(cx,     cy + 1);
    ctx.lineTo(cx - 3, cy + S*0.2);
    ctx.lineTo(cx + 4, cy - 1);
    ctx.lineTo(cx,     cy - 1);
    ctx.closePath();
    ctx.fill();
  },

  _drawPushPanel(ctx, px, py, S, dir) {
    ctx.fillStyle = '#0d1a2a';
    ctx.fillRect(px, py, S, S);
    ctx.fillStyle = '#3b82f6';
    this._arrow(ctx, px + S/2, py + S/2, S * 0.22, dir);
    ctx.fill();
  },

  _drawCheckpoint(ctx, cp) {
    const S  = this.CELL;
    const px = cp.x * S;
    const py = cp.y * S;
    const cx = px + S/2;
    const cy = py + S/2;

    // Sfondo cella evidenziato
    ctx.fillStyle = '#0d1a2e';
    ctx.fillRect(px, py, S, S);

    // Cerchio colorato (ordine determina il colore)
    const colors = ['#1f6feb','#3fb950','#e3b341','#f85149','#a855f7','#f97316'];
    const color  = colors[(cp.order - 1) % colors.length];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.3, 0, Math.PI * 2);
    ctx.fill();

    // Numero
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${S * 0.32}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cp.order, cx, cy + 1);
  },

  _drawStartMarker(ctx, cx, cy, index) {
    const S  = this.CELL;
    const px = cx * S;
    const py = cy * S;

    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(px + 3, py + 3, S - 6, S - 6);
    ctx.setLineDash([]);

    ctx.fillStyle = '#30363d';
    ctx.font = `bold ${S * 0.24}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(index, px + S * 0.82, py + S * 0.18);
  },

  _drawWall(ctx, cx, cy, side) {
    const S  = this.CELL;
    const px = cx * S;
    const py = cy * S;
    const M  = 2; // margine interno

    ctx.strokeStyle = '#f85149';
    ctx.lineWidth = 4;
    ctx.lineCap = 'square';
    ctx.beginPath();
    switch (side) {
      case 'N': ctx.moveTo(px + M, py + M);     ctx.lineTo(px + S - M, py + M);     break;
      case 'S': ctx.moveTo(px + M, py + S - M); ctx.lineTo(px + S - M, py + S - M); break;
      case 'E': ctx.moveTo(px + S - M, py + M); ctx.lineTo(px + S - M, py + S - M); break;
      case 'W': ctx.moveTo(px + M, py + M);     ctx.lineTo(px + M, py + S - M);     break;
    }
    ctx.stroke();
  },

  _drawLaserSource(ctx, laser) {
    const S  = this.CELL;
    const px = laser.x * S;
    const py = laser.y * S;

    ctx.fillStyle = '#f85149';
    ctx.beginPath();
    ctx.arc(px + S/2, py + S/2, 5, 0, Math.PI * 2);
    ctx.fill();

    // Linea della direzione del laser
    const v = this._dirVec(laser.dir);
    ctx.strokeStyle = 'rgba(248, 81, 73, 0.3)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(px + S/2, py + S/2);
    ctx.lineTo(px + S/2 + v.x * S * 1.5, py + S/2 + v.y * S * 1.5);
    ctx.stroke();
    ctx.setLineDash([]);
  },

  // ── Helper: freccia triangolare puntante verso `dir` ─────────────────────
  _arrow(ctx, cx, cy, r, dir) {
    const a = { N: -Math.PI/2, E: 0, S: Math.PI/2, W: Math.PI }[dir] ?? 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(r,     0);
    ctx.lineTo(-r*0.65, -r*0.65);
    ctx.lineTo(-r*0.3,  0);
    ctx.lineTo(-r*0.65,  r*0.65);
    ctx.closePath();
    ctx.restore();
  },

  // ── Helper: vettore direzione ─────────────────────────────────────────────
  _dirVec(dir) {
    return { N:{x:0,y:-1}, E:{x:1,y:0}, S:{x:0,y:1}, W:{x:-1,y:0} }[dir] ?? {x:0,y:0};
  },

  // ── Helper: cella al (cx, cy) dal JSON ────────────────────────────────────
  _cellAt(cx, cy) {
    return (this.data?.cells || []).find(c => c.x === cx && c.y === cy) ?? null;
  },

  // ── API per game.js ───────────────────────────────────────────────────────

  /** Tipo della cella (stringa o 'floor') */
  cellType(cx, cy) {
    return this._cellAt(cx, cy)?.type ?? 'floor';
  },

  /** Array dei lati con muro alla posizione data */
  wallsAt(cx, cy) {
    return (this.data?.walls || [])
      .filter(w => w.x === cx && w.y === cy)
      .map(w => w.side);
  },

  /** Posizione di partenza per l'indice dato (0-based) */
  startPos(index) {
    return (this.data?.startPositions || [])[index] ?? { x: index, y: 11, dir: 'N' };
  },

  /** Controlla se (cx, cy) è dentro la mappa */
  inBounds(cx, cy) {
    if (!this.data) return false;
    return cx >= 0 && cy >= 0 && cx < this.data.width && cy < this.data.height;
  },
};
