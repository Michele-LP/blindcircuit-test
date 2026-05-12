// ═══════════════════════════════════════════════════════════════════════════
//  LOBBY.JS — Schermata lobby pre-partita.
//
//  FIX v6: startGame() ora costruisce il percorso mappa in modo flessibile.
//          La mappa viene cercata prima in assets/maps/, poi nella root.
// ═══════════════════════════════════════════════════════════════════════════

const Lobby = {

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

    this._renderCharacterGrid();
    this.renderPlayerList();
    UI.show('lobby');
  },

  // ── Handler messaggi ───────────────────────────────────────────────────────
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
        this._broadcastMyUpdate();
        break;
      }

      case 'PLAYER_JOINED': {
        State.players[msg.player.id] = msg.player;
        this.renderPlayerList();
        this._updateLobbyStatus();
        break;
      }

      case 'PLAYER_UPDATE': {
        const id = msg.from ?? fromId;
        if (!State.players[id]) State.players[id] = { id, joinOrder: 99, isHost: false };
        Object.assign(State.players[id], {
          nickname:  msg.nickname,
          character: msg.character,
          ready:     msg.ready,
        });
        this.renderPlayerList();
        this._renderCharacterGrid();
        this._updateStartButton();
        this._updateLobbyStatus();
        break;
      }

      case 'PLAYER_LEFT': {
        delete State.players[msg.id];
        this.renderPlayerList();
        this._renderCharacterGrid();
        this._updateStartButton();
        this._updateLobbyStatus();
        break;
      }

      case 'GAME_START': {
        Game.init(msg.mapData);
        break;
      }

      case 'HOST_DISCONNECTED': {
        alert('L\'host si è disconnesso. La partita è stata annullata.');
        UI.goToMenu();
        break;
      }
    }
  },

  // ── Render lista giocatori ─────────────────────────────────────────────────
  renderPlayerList() {
    const list = document.getElementById('player-list');
    list.innerHTML = '';
    const players = State.getPlayerList();

    for (const p of players) {
      const isMe  = p.id === State.myId;
      const char  = CONFIG.characters.find(c => c.id === p.character);
      const color = char?.color ?? '#4b5563';
      const emoji = char?.emoji ?? '🤖';

      const row = document.createElement('div');
      row.className = ['player-row', p.ready ? 'ready' : '', isMe ? 'is-me' : ''].join(' ').trim();
      row.innerHTML = `
        <div class="player-avatar" style="background:${color}">${emoji}</div>
        <div class="player-info">
          <span class="player-name">
            ${this._esc(p.nickname || '(senza nome)')}
            ${p.isHost ? '<span class="host-badge">HOST</span>' : ''}
          </span>
          <span class="player-char">${char?.name ?? 'Nessun personaggio'}</span>
        </div>
        <div class="ready-indicator">${p.ready ? '✅ Pronto' : '⏳ Attesa'}</div>
      `;
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

  // ── Griglia personaggi ─────────────────────────────────────────────────────
  _renderCharacterGrid() {
    const grid  = document.getElementById('character-grid');
    grid.innerHTML = '';
    const myChar = State.myPlayer()?.character;

    for (const char of CONFIG.characters) {
      const takenBy = Object.values(State.players)
        .find(p => p.character === char.id && p.id !== State.myId);

      const btn = document.createElement('button');
      btn.className = ['char-btn', takenBy ? 'taken' : '', myChar === char.id ? 'selected' : ''].join(' ').trim();
      btn.disabled       = !!takenBy;
      btn.dataset.charId = char.id;
      btn.title          = takenBy ? `Usato da ${takenBy.nickname || 'un altro'}` : char.name;
      btn.style.setProperty('--char-color', char.color);
      btn.innerHTML = `
        <span class="char-emoji">${char.emoji}</span>
        <span class="char-name">${char.name}</span>
      `;
      btn.addEventListener('click', () => { if (!takenBy) this._selectCharacter(char.id); });
      grid.appendChild(btn);
    }
  },

  _selectCharacter(charId) {
    const me = State.myPlayer();
    if (!me) return;
    me.character = charId;
    this._renderCharacterGrid();
    this._broadcastMyUpdate();
  },

  // ── Nickname ───────────────────────────────────────────────────────────────
  onNicknameChange(value) {
    const me = State.myPlayer();
    if (me) me.nickname = value.trim();
  },

  onNicknameBlur() {
    this._broadcastMyUpdate();
    this.renderPlayerList();
  },

  // ── Toggle pronto ─────────────────────────────────────────────────────────
  toggleReady() {
    const me = State.myPlayer();
    if (!me) return;
    if (!me.character) { alert('Seleziona prima un personaggio!'); return; }
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

  // ── Broadcast stato ───────────────────────────────────────────────────────
  _broadcastMyUpdate() {
    const me = State.myPlayer();
    if (!me) return;
    Net.sendToAll({ type: 'PLAYER_UPDATE', nickname: me.nickname, character: me.character, ready: me.ready });
  },

  // ── Pulsante avvio ─────────────────────────────────────────────────────────
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

  // ── Avvio partita (host only) ──────────────────────────────────────────────
  // Cerca la mappa prima in assets/maps/, poi nella root (fallback).
  startGame() {
    if (!State.isHost || !State.allReady()) return;

    const mapName = CONFIG.defaultMap;
    const paths   = [`assets/maps/${mapName}.json`, `${mapName}.json`];

    const tryFetch = (remaining) => {
      if (!remaining.length) {
        // Nessun file trovato — usa mappa vuota di emergenza
        console.warn('[Lobby] Mappa non trovata, uso fallback vuoto');
        Net.broadcast({ type: 'GAME_START', mapData: null });
        Game.init(null);
        return;
      }
      const path = remaining[0];
      fetch(path)
        .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
        .then(mapData => {
          Net.broadcast({ type: 'GAME_START', mapData });
          Game.init(mapData);
        })
        .catch(() => tryFetch(remaining.slice(1)));
    };

    tryFetch(paths);
  },

  _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
};

document.addEventListener('DOMContentLoaded', () => {
  const ni = document.getElementById('nickname-input');
  if (ni) ni.addEventListener('blur', () => Lobby.onNicknameBlur());
});
