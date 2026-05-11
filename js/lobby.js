// ═══════════════════════════════════════════════════════════════════════════
//  LOBBY.JS
//  Logica della schermata lobby pre-partita.
//
//  Responsabilità:
//  - Render lista giocatori in tempo reale
//  - Gestione nickname e scelta personaggio
//  - Toggle "Pronto"
//  - Avvio partita (host only, quando tutti pronti)
//  - Gestione messaggi di rete in fase lobby
// ═══════════════════════════════════════════════════════════════════════════

const Lobby = {

  // ── Inizializza la lobby (chiamato sia da host che da guest) ──────────────
  init() {
    State.phase = 'lobby';

    // Popola il codice stanza nell'header
    document.getElementById('lobby-code').textContent = State.roomCode;
    document.getElementById('game-code').textContent  = State.roomCode;

    // Reset form personale
    document.getElementById('nickname-input').value = '';
    document.getElementById('ready-text').textContent = 'Non pronto';
    document.getElementById('btn-ready').classList.remove('is-ready');

    // Pulsante "Inizia" visibile solo all'host
    const btnStart = document.getElementById('btn-start');
    btnStart.style.display = State.isHost ? 'inline-flex' : 'none';
    btnStart.disabled = true;

    // Popola griglia personaggi
    this._renderCharacterGrid();

    // Aggiorna lista giocatori
    this.renderPlayerList();

    UI.show('lobby');
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  GESTORE MESSAGGI IN ARRIVO (chiamato da Net._dispatch)
  // ═══════════════════════════════════════════════════════════════════════════
  handleMessage(fromId, msg) {
    switch (msg.type) {

      // Host invia lo stato completo della lobby al nuovo guest
      case 'LOBBY_STATE': {
        State.players = msg.players;

        // Assicura che il mio entry esista con il joinOrder corretto
        if (!State.players[State.myId]) {
          State.players[State.myId] = {
            id: State.myId, nickname: '', character: null,
            ready: false, isHost: false, joinOrder: msg.assignedJoinOrder,
          };
        } else {
          State.players[State.myId].joinOrder = msg.assignedJoinOrder;
        }

        this.renderPlayerList();

        // Mando subito il mio stato attuale a tutti (così appaio nella lista)
        this._broadcastMyUpdate();
        break;
      }

      // Un nuovo giocatore è entrato
      case 'PLAYER_JOINED': {
        State.players[msg.player.id] = msg.player;
        this.renderPlayerList();
        this._updateLobbyStatus();
        break;
      }

      // Un giocatore ha aggiornato nickname / personaggio / ready
      case 'PLAYER_UPDATE': {
        const id = msg.from ?? fromId;
        if (!State.players[id]) {
          State.players[id] = { id, joinOrder: 99, isHost: false };
        }
        Object.assign(State.players[id], {
          nickname:  msg.nickname,
          character: msg.character,
          ready:     msg.ready,
        });
        this.renderPlayerList();
        this._renderCharacterGrid(); // aggiorna personaggi occupati
        this._updateStartButton();
        this._updateLobbyStatus();
        break;
      }

      // Un giocatore ha lasciato la partita
      case 'PLAYER_LEFT': {
        delete State.players[msg.id];
        this.renderPlayerList();
        this._renderCharacterGrid();
        this._updateStartButton();
        this._updateLobbyStatus();
        break;
      }

      // L'host ha avviato la partita
      case 'GAME_START': {
        Game.init(msg.mapData);
        break;
      }

      // L'host si è disconnesso (solo guest)
      case 'HOST_DISCONNECTED': {
        alert('L\'host si è disconnesso. La partita è stata annullata.');
        UI.goToMenu();
        break;
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  RENDER LISTA GIOCATORI
  // ═══════════════════════════════════════════════════════════════════════════
  renderPlayerList() {
    const list    = document.getElementById('player-list');
    list.innerHTML = '';
    const players = State.getPlayerList();

    for (const p of players) {
      const isMe   = p.id === State.myId;
      const char   = CONFIG.characters.find(c => c.id === p.character);
      const color  = char?.color ?? '#4b5563';
      const emoji  = char?.emoji ?? '🤖';

      const row = document.createElement('div');
      row.className = [
        'player-row',
        p.ready ? 'ready' : 'not-ready',
        isMe    ? 'is-me' : '',
      ].join(' ').trim();

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

    // Slot vuoti (mostra fino a 2 posti liberi)
    const free = CONFIG.maxPlayers - players.length;
    for (let i = 0; i < Math.min(free, 2); i++) {
      const row = document.createElement('div');
      row.className = 'player-row empty';
      row.innerHTML = '<div class="empty-slot">In attesa di giocatori…</div>';
      list.appendChild(row);
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  RENDER GRIGLIA PERSONAGGI
  // ═══════════════════════════════════════════════════════════════════════════
  _renderCharacterGrid() {
    const grid = document.getElementById('character-grid');
    grid.innerHTML = '';
    const myChar = State.myPlayer()?.character;

    for (const char of CONFIG.characters) {
      // Il personaggio è occupato se lo ha qualcun altro
      const takenBy = Object.values(State.players)
        .find(p => p.character === char.id && p.id !== State.myId);

      const btn = document.createElement('button');
      btn.className = [
        'char-btn',
        takenBy   ? 'taken'    : '',
        myChar === char.id ? 'selected' : '',
      ].join(' ').trim();
      btn.disabled       = !!takenBy;
      btn.dataset.charId = char.id;
      btn.title          = takenBy ? `Usato da ${takenBy.nickname || 'un altro'}` : char.name;
      btn.style.setProperty('--char-color', char.color);
      btn.innerHTML = `
        <span class="char-emoji">${char.emoji}</span>
        <span class="char-name">${char.name}</span>
      `;

      btn.addEventListener('click', () => {
        if (!takenBy) this._selectCharacter(char.id);
      });

      grid.appendChild(btn);
    }
  },

  _selectCharacter(charId) {
    const me = State.myPlayer();
    if (!me) return;
    me.character = charId;
    this._renderCharacterGrid(); // aggiorna selezione visiva immediatamente
    this._broadcastMyUpdate();
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  NICKNAME
  // ═══════════════════════════════════════════════════════════════════════════
  onNicknameChange(value) {
    const me = State.myPlayer();
    if (!me) return;
    me.nickname = value.trim();
    // Non facciamo broadcast ad ogni tasto — solo quando si esce dal campo.
    // Se vuoi aggiornamento live, decommentare la riga sotto:
    // this._broadcastMyUpdate();
  },

  // Chiamato quando il nickname input perde il focus (blur)
  // Wiring in index.html con l'evento 'change' o 'blur' se si vuole.
  onNicknameBlur() {
    this._broadcastMyUpdate();
    this.renderPlayerList();
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  TOGGLE PRONTO
  // ═══════════════════════════════════════════════════════════════════════════
  toggleReady() {
    const me = State.myPlayer();
    if (!me) return;

    if (!me.character) {
      alert('Seleziona prima un personaggio!');
      return;
    }
    if (!me.nickname.trim()) {
      alert('Inserisci prima il tuo nickname!');
      return;
    }

    me.ready = !me.ready;

    const btn  = document.getElementById('btn-ready');
    const text = document.getElementById('ready-text');
    btn.classList.toggle('is-ready', me.ready);
    text.textContent = me.ready ? '✅ Pronto' : 'Non pronto';

    this._broadcastMyUpdate();
    this._updateStartButton();
    this.renderPlayerList();
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  BROADCAST MIO STATO
  // ═══════════════════════════════════════════════════════════════════════════
  _broadcastMyUpdate() {
    const me = State.myPlayer();
    if (!me) return;
    Net.sendToAll({
      type:      'PLAYER_UPDATE',
      nickname:  me.nickname,
      character: me.character,
      ready:     me.ready,
    });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  PULSANTE "INIZIA PARTITA" (HOST ONLY)
  // ═══════════════════════════════════════════════════════════════════════════
  _updateStartButton() {
    const btn = document.getElementById('btn-start');
    if (!btn || !State.isHost) return;
    btn.disabled = !State.allReady();
  },

  _updateLobbyStatus() {
    const count    = Object.keys(State.players).length;
    const readyN   = Object.values(State.players).filter(p => p.ready).length;
    const status   = document.getElementById('lobby-status');
    if (status) {
      status.textContent = `${readyN}/${count} pronti`;
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  AVVIO PARTITA (HOST ONLY)
  // ═══════════════════════════════════════════════════════════════════════════
  startGame() {
    if (!State.isHost || !State.allReady()) return;

    // Carica la mappa dal JSON
    fetch(`assets/maps/${CONFIG.defaultMap}.json`)
      .then(r => r.json())
      .then(mapData => {
        Net.broadcast({ type: 'GAME_START', mapData });
        Game.init(mapData);
      })
      .catch(() => {
        // Fallback se il file mappa non esiste ancora (fase 2)
        Net.broadcast({ type: 'GAME_START', mapData: null });
        Game.init(null);
      });
  },

  // Helper: escape HTML per evitare XSS sui nickname
  _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
};

// ── Aggiunge blur sul nickname per inviare aggiornamento quando si finisce ──
document.addEventListener('DOMContentLoaded', () => {
  const ni = document.getElementById('nickname-input');
  if (ni) ni.addEventListener('blur', () => Lobby.onNicknameBlur());
});
