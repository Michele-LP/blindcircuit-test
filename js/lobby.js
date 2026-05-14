// ═══════════════════════════════════════════════════════════════════════════
//  LOBBY.JS — v6.6
//
//  NOVITÀ:
//  ─ Selezione personaggi in-place: i bottoni vengono creati UNA SOLA VOLTA
//    e successivamente solo le classi CSS vengono aggiornate. Niente più
//    distruzione/ricostruzione del DOM ad ogni evento → click sempre reattivi.
//  ─ Re-render della grid quando arriva LOBBY_STATE (nuovo guest deve vedere
//    quali personaggi sono già stati presi).
//  ─ Tooltips custom su bottoni personaggi.
// ═══════════════════════════════════════════════════════════════════════════

const Lobby = {

  _gridBuilt: false,

  init() {
    State.phase = 'lobby';
    document.getElementById('lobby-code').textContent = State.roomCode;
    document.getElementById('game-code').textContent  = State.roomCode;
    document.getElementById('nickname-input').value = '';
    document.getElementById('ready-text').textContent = 'Non pronto';
    document.getElementById('btn-ready').classList.remove('is-ready');

    const btnStart = document.getElementById('btn-start');
    btnStart.style.display = State.isHost ? 'inline-flex' : 'none';
    btnStart.disabled = true;

    this._gridBuilt = false;
    this._renderCharacterGrid();
    this.renderPlayerList();
    this._initGameSettings();
    UI.show('lobby');
  },

  _initGameSettings() {
    const el = document.getElementById('game-settings');
    if (!el) return;
    el.style.display = State.isHost ? 'flex' : 'none';
    if (!State.isHost) return;

    el.querySelectorAll('[data-exec-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.execMode === (State.execMode ?? 'auto'));
      btn.addEventListener('click', () => {
        State.execMode = btn.dataset.execMode;
        el.querySelectorAll('[data-exec-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
    el.querySelectorAll('[data-exec-speed]').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.execSpeed) === (State.execSpeed ?? 2));
      btn.addEventListener('click', () => {
        State.execSpeed = Number(btn.dataset.execSpeed);
        el.querySelectorAll('[data-exec-speed]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  },

  _buildDamageDeck() {
    const comp = (typeof RULES !== 'undefined') ? (RULES?.damage?.damageDeck ?? {}) : {};
    const deck = [];
    for (const [type, qty] of Object.entries(comp)) {
      for (let i = 0; i < qty; i++) deck.push(type);
    }
    return this._shuffle(deck);
  },

  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },

  handleMessage(fromId, msg) {
    switch (msg.type) {

      case 'LOBBY_STATE': {
        State.players = msg.players;
        if (!State.players[State.myId]) {
          State.players[State.myId] = {
            id: State.myId, nickname: '', character: null,
            ready: false, isHost: false, joinOrder: msg.assignedJoinOrder,
          };
        } else {
          State.players[State.myId].joinOrder = msg.assignedJoinOrder;
        }
        this.renderPlayerList();
        // Aggiorna la grid: il nuovo guest deve vedere quali robot sono già presi
        this._updateCharacterGrid();
        this._broadcastMyUpdate();
        break;
      }

      case 'PLAYER_JOINED': {
        State.players[msg.player.id] = msg.player;
        this.renderPlayerList();
        this._updateCharacterGrid();
        this._updateLobbyStatus();
        break;
      }

      case 'PLAYER_UPDATE': {
        const id = msg.from ?? fromId;
        if (!State.players[id]) State.players[id] = { id, joinOrder: 99, isHost: false };
        Object.assign(State.players[id], {
          nickname: msg.nickname, character: msg.character, ready: msg.ready,
        });
        this.renderPlayerList();
        // Aggiornamento in-place: nessuna distruzione di bottoni → niente click persi
        this._updateCharacterGrid();
        this._updateStartButton();
        this._updateLobbyStatus();
        break;
      }

      case 'PLAYER_LEFT': {
        delete State.players[msg.id];
        this.renderPlayerList();
        this._updateCharacterGrid();
        this._updateStartButton();
        this._updateLobbyStatus();
        break;
      }

      case 'GAME_START': {
        if (msg.execMode  !== undefined) State.execMode  = msg.execMode;
        if (msg.execSpeed !== undefined) State.execSpeed = msg.execSpeed;
        if (msg.damageDeck) {
          State.damageDeck    = msg.damageDeck;
          State.damageDiscard = [];
        }
        if (typeof Log !== 'undefined') Log.add('Partita iniziata', { type: 'event' });
        Game.init(msg.mapData, {
          execMode:   msg.execMode,
          execSpeed:  msg.execSpeed,
          damageDeck: msg.damageDeck,
        });
        break;
      }

      case 'HOST_DISCONNECTED': {
        alert('L\'host si è disconnesso. La partita è stata annullata.');
        UI.goToMenu();
        break;
      }
    }
  },

  renderPlayerList() {
    const list = document.getElementById('player-list');
    list.innerHTML = '';
    const players = State.getPlayerList();

    for (const p of players) {
      const isMe  = p.id === State.myId;
      const char  = CONFIG.characters.find(c => c.id === p.character);
      const color = char?.color ?? '#4b5563';
      const row = document.createElement('div');
      row.className = ['player-row', p.ready ? 'ready' : '', isMe ? 'is-me' : ''].join(' ').trim();
      const avatar = document.createElement('div');
      avatar.className = 'player-avatar';
      avatar.style.background = color;
      if (char?.sprite) {
        const img = document.createElement('img');
        img.className = 'avatar-bot-img';
        img.src = char.sprite;
        img.alt = char.name;
        img.onerror = function() { this.style.display = 'none'; avatar.textContent = char.emoji; };
        avatar.appendChild(img);
      } else {
        avatar.textContent = char?.emoji ?? '🤖';
      }
      row.appendChild(avatar);
      const info = document.createElement('div');
      info.className = 'player-info';
      info.innerHTML = `
        <span class="player-name">
          ${this._esc(p.nickname || '(senza nome)')}
          ${p.isHost ? '<span class="host-badge">HOST</span>' : ''}
        </span>
        <span class="player-char">${char?.name ?? 'Nessun personaggio'}</span>
      `;
      row.appendChild(info);
      const readyInd = document.createElement('div');
      readyInd.className = 'ready-indicator';
      readyInd.textContent = p.ready ? '✅ Pronto' : '⏳ Attesa';
      row.appendChild(readyInd);
      list.appendChild(row);
    }

    const free = CONFIG.maxPlayers - players.length;
    for (let i = 0; i < Math.min(free, 2); i++) {
      const row = document.createElement('div');
      row.className = 'player-row empty';
      row.innerHTML = '<div class="empty-slot">In attesa di giocatori…</div>';
      list.appendChild(row);
    }
  },

  // Crea i bottoni una volta sola; per gli aggiornamenti usa _updateCharacterGrid.
  _renderCharacterGrid() {
    const grid = document.getElementById('character-grid');
    grid.innerHTML = '';
    for (const char of CONFIG.characters) {
      const btn = document.createElement('button');
      btn.className          = 'char-btn';
      btn.dataset.charId     = char.id;
      btn.style.setProperty('--char-color', char.color);

      const spriteWrap = document.createElement('div');
      spriteWrap.className = 'char-sprite-wrap';
      if (char.sprite) {
        const img = document.createElement('img');
        img.className = 'char-sprite-img';
        img.src = char.sprite; img.alt = char.name; img.draggable = false;
        img.onerror = function() {
          this.style.display = 'none';
          const em = document.createElement('span');
          em.className = 'char-emoji'; em.textContent = char.emoji;
          spriteWrap.appendChild(em);
        };
        spriteWrap.appendChild(img);
      } else {
        const em = document.createElement('span');
        em.className = 'char-emoji'; em.textContent = char.emoji;
        spriteWrap.appendChild(em);
      }
      const nameSpan = document.createElement('span');
      nameSpan.className = 'char-name';
      nameSpan.textContent = char.name;
      btn.appendChild(spriteWrap);
      btn.appendChild(nameSpan);

      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        this._selectCharacter(char.id);
      });
      grid.appendChild(btn);
    }
    this._gridBuilt = true;
    this._updateCharacterGrid();
  },

  // Aggiornamento in-place: modifica solo le classi/tooltip dei bottoni esistenti.
  // Mai distruttivo, quindi un click in corso non viene mai perso.
  _updateCharacterGrid() {
    if (!this._gridBuilt) return this._renderCharacterGrid();
    const myChar = State.myPlayer()?.character;
    document.querySelectorAll('.char-btn').forEach(btn => {
      const charId  = btn.dataset.charId;
      const char    = CONFIG.characters.find(c => c.id === charId);
      const takenBy = Object.values(State.players)
        .find(p => p.character === charId && p.id !== State.myId);
      btn.classList.toggle('taken',    !!takenBy);
      btn.classList.toggle('selected', myChar === charId);
      btn.disabled = !!takenBy;
      btn.dataset.tooltip = takenBy
        ? `${char?.name}\nScelto da: ${takenBy.nickname || '(senza nome)'}`
        : (char?.name ?? '');
      btn.dataset.tooltipColor = char?.color ?? '#1f6feb';
    });
  },

  _selectCharacter(charId) {
    const me = State.myPlayer();
    if (!me) return;
    me.character = charId;
    this._updateCharacterGrid();   // in-place, niente rebuild
    this._broadcastMyUpdate();
  },

  onNicknameChange(value) {
    const me = State.myPlayer();
    if (me) me.nickname = value.trim();
  },

  onNicknameBlur() {
    this._broadcastMyUpdate();
    this.renderPlayerList();
  },

  toggleReady() {
    const me = State.myPlayer();
    if (!me) return;
    if (!me.character)       { alert('Seleziona prima un personaggio!'); return; }
    if (!me.nickname.trim()) { alert('Inserisci prima il tuo nickname!'); return; }
    me.ready = !me.ready;
    const btn  = document.getElementById('btn-ready');
    const text = document.getElementById('ready-text');
    btn.classList.toggle('is-ready', me.ready);
    text.textContent = me.ready ? '✅ Pronto' : 'Non pronto';
    this._broadcastMyUpdate();
    this._updateStartButton();
    this.renderPlayerList();
  },

  _broadcastMyUpdate() {
    const me = State.myPlayer();
    if (!me) return;
    Net.sendToAll({ type: 'PLAYER_UPDATE', nickname: me.nickname, character: me.character, ready: me.ready });
  },

  _updateStartButton() {
    const btn = document.getElementById('btn-start');
    if (!btn || !State.isHost) return;
    btn.disabled = !State.allReady();
  },

  _updateLobbyStatus() {
    const count  = Object.keys(State.players).length;
    const readyN = Object.values(State.players).filter(p => p.ready).length;
    const status = document.getElementById('lobby-status');
    if (status) status.textContent = `${readyN}/${count} pronti`;
  },

  startGame() {
    if (!State.isHost || !State.allReady()) return;
    const settings   = { execMode: State.execMode, execSpeed: State.execSpeed };
    const damageDeck = this._buildDamageDeck();
    State.damageDeck    = damageDeck;
    State.damageDiscard = [];

    if (typeof Log !== 'undefined') Log.add('Partita iniziata (host)', { type: 'event' });

    const tryFetch = (paths) => {
      if (!paths.length) {
        Net.broadcast({ type: 'GAME_START', mapData: null, damageDeck, ...settings });
        Game.init(null, { ...settings, damageDeck });
        return;
      }
      fetch(paths[0])
        .then(r => { if (!r.ok) throw new Error(); return r.json(); })
        .then(mapData => {
          Net.broadcast({ type: 'GAME_START', mapData, damageDeck, ...settings });
          Game.init(mapData, { ...settings, damageDeck });
        })
        .catch(() => tryFetch(paths.slice(1)));
    };
    tryFetch([`assets/maps/${CONFIG.defaultMap}.json`, `${CONFIG.defaultMap}.json`]);
  },

  _esc(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },
};

document.addEventListener('DOMContentLoaded', () => {
  const ni = document.getElementById('nickname-input');
  if (ni) ni.addEventListener('blur', () => Lobby.onNicknameBlur());
});
