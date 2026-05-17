// ═══════════════════════════════════════════════════════════════════════════
//  BOARD.JS — v6.8 — Tabellone: dati mappa + rendering canvas.
//
//  MODIFICHE v6.8:
//  - Supporto rendering conveyor_turn e express_conveyor_turn
//  - 4 nuove tile PNG: beltTurnLeft1/2, beltTurnRight1/2
//  - Helper _conveyorTurnInfo(from, to) per determinare direzione e rotazione
// ═══════════════════════════════════════════════════════════════════════════

const Board = {

  CELL: CONFIG.cellSize,
  data: null,
  W:    0,
  H:    0,
  _cache: null,
  _imgs:  {},    // { key: HTMLImageElement }

  // ── Angolo di rotazione per ogni direzione cardinale
  // Tutte le tile sono orientate verso E (destra) di default.
  _DIR_ROT: { E: 0, N: -Math.PI/2, S: Math.PI/2, W: Math.PI },
  _OPP: { N:'S', S:'N', E:'W', W:'E' },
  _ROT_R: { N:'E', E:'S', S:'W', W:'N' },

  // NEW v6.8: dato from/to di una curva nastro, ritorna { isRight, rotRad }
  // CONVENZIONE MAPPA:
  //   from = direzione di viaggio del robot IN ENTRATA (es. "E" = il robot si muoveva verso Est)
  //   to   = direzione di viaggio DOPO la curva (es. "S" = ora va verso Sud)
  // isRight: true se la curva è a destra (CW), false se a sinistra
  // rotRad: angolo di rotazione per il PNG (default: entrata da Est = 0°)
  _conveyorTurnInfo(from, to) {
    const isRight = this._ROT_R[from] === to;
    const rotRad = this._DIR_ROT[from] ?? 0;
    return { isRight, rotRad };
  },

  // ── Carica dati mappa ─────────────────────────────────────────────────────
  load(mapData) {
    if (!mapData) {
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
    this._cache = null;
  },

  // ── Precaricamento PNG tile ────────────────────────────────────────────────
  // Chiamato da Game.init(). Le immagini si caricano in parallelo (async).
  // Quando una immagine termina il caricamento, invalida la cache del board
  // così al frame successivo viene ricostruita con i PNG corretti.
  preloadImages() {
    const ti = CONFIG.tileImages ?? {};
    const toLoad = [];

    // Tile semplici
    const simpleKeys = ['floor_a','floor_b','pit','conveyor','express',
                        'conveyor_turn_left','conveyor_turn_right',
                        'express_turn_left','express_turn_right',
                        'gear_cw','gear_ccw','recharge','push_panel','laser_src'];

    if (CONFIG.boardBackground) {
      const bg = new Image();
      bg.onload = () => { this._cache = null; };
      bg.src = CONFIG.boardBackground;
      this._imgs['board_bg'] = bg;
    }
    for (const k of simpleKeys) {
      if (ti[k]) toLoad.push([k, ti[k]]);
    }
    // Checkpoint per ordine (array)
    if (Array.isArray(ti.checkpoints)) {
      ti.checkpoints.forEach((src, i) => toLoad.push([`checkpoint_${i+1}`, src]));
    }

    for (const [key, src] of toLoad) {
      if (!src || this._imgs[key]) continue;
      const img = new Image();
      img.onload = () => { this._cache = null; };  // forza rebuild con PNG
      img.onerror = () => { /* PNG mancante, usa fallback canvas */ };
      img.src = src;
      this._imgs[key] = img;
    }
  },

  // ── Helper: disegna una tile PNG centrata nella cella, ruotata ─────────────
  _drawTilePNG(ctx, key, px, py, S, rotRad = 0) {
    const img = this._imgs[key];
    if (!img || !img.complete || img.naturalWidth === 0) return false;
    ctx.save();
    ctx.translate(px + S/2, py + S/2);
    if (rotRad) ctx.rotate(rotRad);
    ctx.drawImage(img, -S/2, -S/2, S, S);
    ctx.restore();
    return true;
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

  _buildCache(ctx) {
    const { width, height } = this.data;

    //ctx.fillStyle = '#161b22';
    const bgImg = this._imgs['board_bg'];
    if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
      ctx.drawImage(bgImg, 0, 0, this.W, this.H);
    } else {
      ctx.fillStyle = '#161b22';
      ctx.fillRect(0, 0, this.W, this.H);
    }
    // FIX v6.4: rimossa la ctx.fillRect(0,0,W,H) incondizionata che era qui.
    // Era un residuo della versione precedente: senza fillStyle esplicito il
    // canvas usa nero di default, coprendo la background image appena disegnata.

    for (let cy = 0; cy < height; cy++)
      for (let cx = 0; cx < width; cx++)
        this._drawCell(ctx, cx, cy);

    for (let i = 0; i < (this.data.startPositions || []).length; i++)
      this._drawStartMarker(ctx, this.data.startPositions[i].x, this.data.startPositions[i].y, i + 1);

    for (const cp of this.data.checkpoints || [])
      this._drawCheckpoint(ctx, cp);

    for (const wall of this.data.walls || [])
      this._drawWall(ctx, wall.x, wall.y, wall.side);

    for (const laser of this.data.lasers || [])
      this._drawLaserSource(ctx, laser);
  },

  // ── Singola cella ─────────────────────────────────────────────────────────
  _drawCell(ctx, cx, cy) {
    const S  = this.CELL;
    const px = cx * S;
    const py = cy * S;

    // Pavimento base — a scacchi con PNG
    const floorKey = (cx + cy) % 2 === 0 ? 'floor_a' : 'floor_b';
    if (!this._drawTilePNG(ctx, floorKey, px, py, S)) {
      ctx.fillStyle = '#1c2128';
      ctx.fillRect(px, py, S, S);
      ctx.strokeStyle = '#21262d';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, S - 1, S - 1);
    }

    const cell = this._cellAt(cx, cy);
    if (!cell) return;

    const rot = this._DIR_ROT[cell.dir ?? 'E'] ?? 0;

    switch (cell.type) {
      case 'pit':
        if (!this._drawTilePNG(ctx, 'pit', px, py, S))
          this._drawPit(ctx, px, py, S);
        break;

      case 'conveyor':
        if (!this._drawTilePNG(ctx, 'conveyor', px, py, S, rot))
          this._drawConveyor(ctx, px, py, S, cell.dir, false);
        break;

      case 'express_conveyor':
        if (!this._drawTilePNG(ctx, 'express', px, py, S, rot))
          this._drawConveyor(ctx, px, py, S, cell.dir, true);
        break;

      case 'gear_cw':
        if (!this._drawTilePNG(ctx, 'gear_cw', px, py, S))
          this._drawGear(ctx, px, py, S, true);
        break;

      case 'gear_ccw':
        if (!this._drawTilePNG(ctx, 'gear_ccw', px, py, S))
          this._drawGear(ctx, px, py, S, false);
        break;

      case 'recharge':
        if (!this._drawTilePNG(ctx, 'recharge', px, py, S))
          this._drawRecharge(ctx, px, py, S);
        break;

      case 'push_panel': {
        // v6.9 B4: il PNG spring_on punta verso W (←), aggiungi +π per allinearlo al sistema _DIR_ROT (che assume Est)
        const pushRot = (this._DIR_ROT[cell.dir ?? 'E'] ?? 0) + Math.PI;
        if (!this._drawTilePNG(ctx, 'push_panel', px, py, S, pushRot))
          this._drawPushPanel(ctx, px, py, S, cell.dir);
        // v6.9 G4: overlay registri attivi del push panel
        if (cell.activeRegisters && cell.activeRegisters.length) {
          ctx.fillStyle = 'rgba(59,130,246,0.75)';
          ctx.font = `bold ${Math.max(8,Math.round(S*0.2))}px system-ui`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText(cell.activeRegisters.map(r=>'P'+r).join(','), px+S/2, py+S-2);
        }
        break;
      }

      // NEW v6.8: nastri trasportatori curvi
      case 'conveyor_turn': {
        const ti = this._conveyorTurnInfo(cell.from, cell.to);
        const key = ti.isRight ? 'conveyor_turn_right' : 'conveyor_turn_left';
        if (!this._drawTilePNG(ctx, key, px, py, S, ti.rotRad))
          this._drawConveyorTurn(ctx, px, py, S, cell.from, cell.to, false);
        break;
      }
      case 'express_conveyor_turn': {
        const ti = this._conveyorTurnInfo(cell.from, cell.to);
        const key = ti.isRight ? 'express_turn_right' : 'express_turn_left';
        if (!this._drawTilePNG(ctx, key, px, py, S, ti.rotRad))
          this._drawConveyorTurn(ctx, px, py, S, cell.from, cell.to, true);
        break;
      }
    }
  },

  // ── Checkpoint ─────────────────────────────────────────────────────────────
  _drawCheckpoint(ctx, cp) {
    const S  = this.CELL;
    const px = cp.x * S;
    const py = cp.y * S;
    const cx = px + S/2;
    const cy = py + S/2;

    const pngKey = `checkpoint_${cp.order}`;
    if (this._drawTilePNG(ctx, pngKey, px, py, S)) return;

    // Fallback canvas
    ctx.fillStyle = '#0d1a2e';
    ctx.fillRect(px, py, S, S);
    const colors = ['#1f6feb','#3fb950','#e3b341','#f85149','#a855f7','#f97316'];
    const color  = colors[(cp.order - 1) % colors.length];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${S * 0.32}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cp.order, cx, cy + 1);
  },

  // ── Sorgente laser ─────────────────────────────────────────────────────────
  _drawLaserSource(ctx, laser) {
    const S  = this.CELL;
    const px = laser.x * S;
    const py = laser.y * S;
    const rot = this._DIR_ROT[laser.dir ?? 'E'] ?? 0;

    if (this._drawTilePNG(ctx, 'laser_src', px, py, S, rot)) return;

    // Fallback canvas
    ctx.fillStyle = '#f85149';
    ctx.beginPath();
    ctx.arc(px + S/2, py + S/2, 5, 0, Math.PI * 2);
    ctx.fill();
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

  // ── Marcatori partenza ────────────────────────────────────────────────────
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

  // ── Muri ──────────────────────────────────────────────────────────────────
  _drawWall(ctx, cx, cy, side) {
    const S  = this.CELL;
    const px = cx * S;
    const py = cy * S;
    const M  = 2;
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

  // ── Fallback canvas: disegni originali ───────────────────────────────────
  _drawPit(ctx, px, py, S) {
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
    this._arrow(ctx, px + S/2, py + S/2, S * 0.28, dir);
    ctx.fill();
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
    ctx.strokeStyle = '#5b6794';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.27, 0, Math.PI * 2);
    ctx.stroke();
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
    ctx.strokeStyle = '#3fb950';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.3, 0, Math.PI * 2);
    ctx.stroke();
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

  // NEW v6.8: fallback canvas per nastri curvi
  _drawConveyorTurn(ctx, px, py, S, from, to, isExpress) {
    ctx.fillStyle = isExpress ? '#191200' : '#181e28';
    ctx.fillRect(px, py, S, S);
    const color = isExpress ? '#e3b341' : '#4b5563';
    // Disegna una freccia curva: entrata dal lato OPP[from], uscita dal lato to
    const mid = S / 2;
    const cx = px + mid, cy = py + mid;
    const entrySide = this._OPP[from]; // il robot entra dal lato opposto a from
    const fromPt = this._sidePoint(px, py, S, entrySide);
    const toPt   = this._sidePoint(px, py, S, to);
    ctx.strokeStyle = color;
    ctx.lineWidth = S * 0.15;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fromPt.x, fromPt.y);
    ctx.quadraticCurveTo(cx, cy, toPt.x, toPt.y);
    ctx.stroke();
    // Freccia alla fine
    ctx.fillStyle = color;
    this._arrow(ctx, toPt.x, toPt.y, S * 0.15, to);
    ctx.fill();
  },

  _sidePoint(px, py, S, side) {
    switch(side) {
      case 'N': return { x: px + S/2, y: py + S*0.15 };
      case 'S': return { x: px + S/2, y: py + S*0.85 };
      case 'E': return { x: px + S*0.85, y: py + S/2 };
      case 'W': return { x: px + S*0.15, y: py + S/2 };
      default:  return { x: px + S/2, y: py + S/2 };
    }
  },

  _arrow(ctx, cx, cy, r, dir) {
    const a = { N: -Math.PI/2, E: 0, S: Math.PI/2, W: Math.PI }[dir] ?? 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r*0.65, -r*0.65);
    ctx.lineTo(-r*0.3,  0);
    ctx.lineTo(-r*0.65,  r*0.65);
    ctx.closePath();
    ctx.restore();
  },

  _dirVec(dir) {
    return { N:{x:0,y:-1}, E:{x:1,y:0}, S:{x:0,y:1}, W:{x:-1,y:0} }[dir] ?? {x:0,y:0};
  },

  _cellAt(cx, cy) {
    return (this.data?.cells || []).find(c => c.x === cx && c.y === cy) ?? null;
  },

  // ── API per game.js / execution.js ───────────────────────────────────────
  cellType(cx, cy) { return this._cellAt(cx, cy)?.type ?? 'floor'; },

  wallsAt(cx, cy) {
    return (this.data?.walls || [])
      .filter(w => w.x === cx && w.y === cy)
      .map(w => w.side);
  },

  startPos(index) {
    return (this.data?.startPositions || [])[index] ?? { x: index, y: 11, dir: 'N' };
  },

  inBounds(cx, cy) {
    if (!this.data) return false;
    return cx >= 0 && cy >= 0 && cx < this.data.width && cy < this.data.height;
  },
};
