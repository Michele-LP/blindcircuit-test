// ═══════════════════════════════════════════════════════════════════════════
//  NET.JS — v6.7
//
//  NOVITÀ v6.7:
//  ─ Connessione a partita avviata → SPETTATORE.
//    L'host NON aggiunge il nuovo arrivato a State.players.
//    Lo aggiunge a State.spectators e gli invia SPECTATOR_INIT con lo
//    stato corrente del gioco. Lo spettatore riceve i broadcast
//    (EXECUTE_PLAN, ROUND_START, SYNC_STATE) e può guardare la partita
//    in sola lettura. I suoi messaggi vengono ignorati (tranne REQUEST_SYNC).
//  ─ Conteggio spettatori broadcast via SPECTATOR_COUNT a tutti i client.
// ═══════════════════════════════════════════════════════════════════════════

const Net = {

  _nextJoinOrder: 1,   // contatore atomico (host=0, guest1=1, …)

  _genCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  CREA STANZA — HOST
  // ═══════════════════════════════════════════════════════════════════════════
  createRoom(onReady, onError) {
    const code   = this._genCode();
    const peerId = CONFIG.peerPrefix + code.toLowerCase();

    State.isHost   = true;
    State.roomCode = code;
    State.peer     = new Peer(peerId, { debug: CONFIG.peerDebug });
    this._nextJoinOrder = 1;

    State.peer.on('open', () => {
      State.myId = peerId;
      State.players[State.myId] = {
        id: State.myId, nickname: '', character: null,
        ready: false, isHost: true, joinOrder: 0,
      };
      onReady();
    });

    State.peer.on('connection', (conn) => {
      const guestId = conn.peer;
      State.conns[guestId] = conn;
      this._setupGuestConn(conn);
    });

    State.peer.on('error', (e) => onError(e.type));
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  ENTRA IN STANZA — GUEST
  // ═══════════════════════════════════════════════════════════════════════════
  joinRoom(code, onReady, onError) {
    State.isHost   = false;
    State.roomCode = code.toUpperCase();
    State.peer     = new Peer({ debug: CONFIG.peerDebug });

    State.peer.on('open', (id) => {
      State.myId = id;
      State.players[State.myId] = {
        id: State.myId, nickname: '', character: null,
        ready: false, isHost: false, joinOrder: 99,
      };
      const hostPeerId = CONFIG.peerPrefix + code.toLowerCase();
      State.conn = State.peer.connect(hostPeerId, { reliable: true });
      State.conn.on('open', () => {
        this._setupHostConn(State.conn);
        onReady();
      });
      State.conn.on('error', (e) => onError('connessione: ' + e));
    });

    State.peer.on('error', (e) => onError(e.type));
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  SETUP CONNESSIONE ENTRANTE — lato HOST
  // ═══════════════════════════════════════════════════════════════════════════
  _setupGuestConn(conn) {
    const guestId = conn.peer;

    conn.on('open', () => {

      // ── Partita già avviata → spettatore ────────────────────────────────
      if (State.phase === 'game') {
        State.spectators[guestId] = true;

        // Invia lo stato del gioco corrente (mappa, giocatori, posizioni)
        const positions = {};
        for (const [id, p] of Object.entries(State.players)) {
          if (p.cx === undefined) continue;
          positions[id] = {
            cx: p.cx, cy: p.cy, dir: p.dir,
            energy: p.energy, checkpoints: p.checkpoints ?? [],
            lastCheckpoint: p.lastCheckpoint ?? 0,
            nickname: p.nickname, character: p.character,
            wormSlots: p.wormSlots ?? {},
          };
        }
        this.sendTo(guestId, {
          type:      'SPECTATOR_INIT',
          mapData:   Board.data,
          players:   State.players,
          positions,
          round:     State.round,
          execMode:  State.execMode,
          execSpeed: State.execSpeed,
          damageDeck: State.damageDeck,
        });

        // Broadcast conteggio spettatori aggiornato
        this._broadcastSpectatorCount();

        if (typeof Log !== 'undefined')
          Log.add(`Nuovo spettatore connesso (${Object.keys(State.spectators).length})`, { type: 'info' });

        return;   // NON aggiunge a State.players → nessun blocco conferma
      }

      // ── Lobby: slot pieni? ──────────────────────────────────────────────
      if (Object.keys(State.players).length >= CONFIG.maxPlayers) {
        this.sendTo(guestId, { type: 'REJECTED', reason: 'Partita piena (max ' + CONFIG.maxPlayers + ')' });
        setTimeout(() => { conn.close(); delete State.conns[guestId]; }, 200);
        return;
      }

      // ── Lobby: accettato come giocatore ─────────────────────────────────
      const joinOrder = this._nextJoinOrder++;
      const newPlayer = {
        id: guestId, nickname: '', character: null,
        ready: false, isHost: false, joinOrder,
      };
      State.players[guestId] = newPlayer;

      this.sendTo(guestId, {
        type: 'LOBBY_STATE',
        players: State.players,
        assignedJoinOrder: joinOrder,
      });

      this._relayExcept(guestId, { type: 'PLAYER_JOINED', player: newPlayer });
      this._dispatch('system', { type: 'PLAYER_JOINED', player: newPlayer });
    });

    conn.on('data', (msg) => {
      // Spettatori: accetta solo REQUEST_SYNC, ignora tutto il resto
      if (State.spectators[guestId]) {
        if (msg.type === 'REQUEST_SYNC') this._dispatch(guestId, msg);
        return;
      }
      this._dispatch(guestId, msg);
      if (msg.relay) this._relayExcept(guestId, { ...msg, from: guestId });
    });

    conn.on('close', () => {
      delete State.conns[guestId];
      if (State.spectators[guestId]) {
        delete State.spectators[guestId];
        this._broadcastSpectatorCount();
        if (typeof Log !== 'undefined')
          Log.add(`Spettatore disconnesso (${Object.keys(State.spectators).length})`, { type: 'info' });
        return;
      }
      this._relayExcept(guestId, { type: 'PLAYER_LEFT', id: guestId });
      this._dispatch('system',   { type: 'PLAYER_LEFT', id: guestId });
    });

    conn.on('error', (e) => console.warn('[Net] guest conn error', guestId, e));
  },

  _broadcastSpectatorCount() {
    const count = Object.keys(State.spectators).length;
    State.spectatorCount = count;
    this.broadcast({ type: 'SPECTATOR_COUNT', count });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  SETUP CONNESSIONE CON L'HOST — lato GUEST
  // ═══════════════════════════════════════════════════════════════════════════
  _setupHostConn(conn) {
    conn.on('data', (msg) => {
      this._dispatch(msg.from ?? 'host', msg);
    });
    conn.on('close', () => {
      this._dispatch('system', { type: 'HOST_DISCONNECTED' });
    });
    conn.on('error', (e) => console.warn('[Net] host conn error', e));
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  INVIO MESSAGGI
  // ═══════════════════════════════════════════════════════════════════════════
  sendTo(peerId, msg) {
    const c = State.conns[peerId];
    if (c && c.open) c.send(msg);
  },

  broadcast(msg) {
    for (const c of Object.values(State.conns)) {
      if (c.open) c.send(msg);
    }
  },

  _relayExcept(exceptId, msg) {
    for (const [id, c] of Object.entries(State.conns)) {
      if (id !== exceptId && c.open) c.send(msg);
    }
  },

  send(msg) {
    if (State.conn && State.conn.open) State.conn.send(msg);
  },

  sendToAll(msg) {
    if (State.isHost) {
      this._dispatch(State.myId, msg);
      this.broadcast({ ...msg, from: State.myId });
    } else {
      this.send({ ...msg, relay: true });
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  _dispatch(fromId, msg) {
    // Messaggi che vanno gestiti in qualunque fase
    if (msg.type === 'SPECTATOR_INIT' || msg.type === 'REJECTED') {
      if (typeof Lobby !== 'undefined') Lobby.handleMessage(fromId, msg);
      return;
    }
    if (msg.type === 'SPECTATOR_COUNT') {
      State.spectatorCount = msg.count;
      return;
    }
    if (State.phase === 'lobby') {
      if (typeof Lobby !== 'undefined') Lobby.handleMessage(fromId, msg);
    } else if (State.phase === 'game') {
      if (typeof Game !== 'undefined') Game.handleMessage(fromId, msg);
    }
  },
};
