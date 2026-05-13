// ═══════════════════════════════════════════════════════════════════════════
//  NET.JS
//  Layer di rete: PeerJS + WebRTC + architettura host-relay.
//
//  ARCHITETTURA HOST-RELAY:
//  Ogni guest si connette solo all'host.
//  L'host riceve i messaggi e li "relay-a" a tutti gli altri guest.
//  Questo risolve il bug "giocatore 3 sovrascrive giocatore 2":
//  ogni giocatore ha un ID univoco (il suo peerId) e i messaggi
//  viaggiano con il campo `from` che identifica il mittente originale.
//
//  FORMATO MESSAGGI:
//  {
//    type:  string       — tipo messaggio (es. 'PLAYER_UPDATE')
//    relay: boolean      — se true, l'host lo ritrasmette a tutti gli altri
//    from:  string       — aggiunto dall'host durante il relay (peerId mittente)
//    ...payload specifico del tipo
//  }
//
//  FIX v6.3.1:
//  ─ joinOrder: rimosso calcolo tramite Object.keys(State.conns).length
//    che in caso di connessioni quasi-simultanee poteva assegnare lo stesso
//    joinOrder a due guest diversi. Sostituito con un contatore atomico
//    _nextJoinOrder che viene incrementato ad ogni nuova connessione.
//  ─ _dispatch: aggiunto log di warning per i messaggi ignorati in fase 'menu'
//    (era silenzioso, rendeva il debug molto difficile).
// ═══════════════════════════════════════════════════════════════════════════

const Net = {

  // Contatore usato dall'host per assegnare joinOrder univoci.
  // Host = 0 (hardcoded in createRoom), guest = 1, 2, 3, ...
  // Separato da State per non doverlo resettare manualmente (State.reset lo ignora).
  _nextJoinOrder: 1,

  // ── Genera codice stanza 6 caratteri (no caratteri ambigui 0/O, 1/I) ─────
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

    // Reset contatore joinOrder per questa partita
    this._nextJoinOrder = 1;

    State.isHost   = true;
    State.roomCode = code;
    State.peer     = new Peer(peerId, { debug: CONFIG.peerDebug });

    State.peer.on('open', () => {
      State.myId = peerId;

      // Registra il mio entry come host
      State.players[State.myId] = {
        id:        State.myId,
        nickname:  '',
        character: null,
        ready:     false,
        isHost:    true,
        joinOrder: 0,
      };

      onReady();
    });

    // Nuova connessione in entrata da un guest
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

      // Registra il mio entry come guest (joinOrder verrà assegnato dall'host)
      State.players[State.myId] = {
        id:        State.myId,
        nickname:  '',
        character: null,
        ready:     false,
        isHost:    false,
        joinOrder: 99,
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
      // FIX: joinOrder ora usa un contatore atomico invece di
      // Object.keys(State.conns).length, che poteva assegnare lo stesso
      // valore a due guest che si connettevano quasi-simultaneamente
      // (entrambe le connessioni venivano aggiunte a State.conns prima
      // che il loro evento 'open' scattasse).
      const joinOrder = this._nextJoinOrder++;

      const newPlayer = {
        id:        guestId,
        nickname:  '',
        character: null,
        ready:     false,
        isHost:    false,
        joinOrder: joinOrder,
      };
      State.players[guestId] = newPlayer;

      // 2. Invia al nuovo guest lo stato completo della lobby
      this.sendTo(guestId, {
        type:              'LOBBY_STATE',
        players:           State.players,
        assignedJoinOrder: joinOrder,
      });

      // 3. Notifica tutti gli altri guest del nuovo arrivo
      this._relayExcept(guestId, {
        type:   'PLAYER_JOINED',
        player: newPlayer,
      });

      // 4. Aggiorna la UI dell'host
      this._dispatch('system', { type: 'PLAYER_JOINED', player: newPlayer });
    });

    conn.on('data', (msg) => {
      // Processa il messaggio sull'host
      this._dispatch(guestId, msg);

      // Se richiede relay, ritrasmetti a tutti gli altri guest
      if (msg.relay) {
        this._relayExcept(guestId, { ...msg, from: guestId });
      }
    });

    conn.on('close', () => {
      delete State.conns[guestId];
      // Notifica tutti
      this._relayExcept(guestId, { type: 'PLAYER_LEFT', id: guestId });
      this._dispatch('system',   { type: 'PLAYER_LEFT', id: guestId });
    });

    conn.on('error', (e) => console.warn('[Net] guest conn error', guestId, e));
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  SETUP CONNESSIONE CON L'HOST — lato GUEST
  // ═══════════════════════════════════════════════════════════════════════════
  _setupHostConn(conn) {
    conn.on('data', (msg) => {
      // I messaggi dall'host possono avere msg.from se sono relay di altri guest
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

  // Invia a un peer specifico (solo host)
  sendTo(peerId, msg) {
    const c = State.conns[peerId];
    if (c && c.open) c.send(msg);
  },

  // Broadcast a tutti i guest connessi (solo host)
  broadcast(msg) {
    for (const c of Object.values(State.conns)) {
      if (c.open) c.send(msg);
    }
  },

  // Relay a tutti i guest TRANNE uno (solo host, interno)
  _relayExcept(exceptId, msg) {
    for (const [id, c] of Object.entries(State.conns)) {
      if (id !== exceptId && c.open) c.send(msg);
    }
  },

  // Invia all'host (solo guest)
  send(msg) {
    if (State.conn && State.conn.open) State.conn.send(msg);
  },

  // Manda a tutti (host + guest).
  // Host: processa localmente + broadcast.
  // Guest: manda all'host con relay:true, lui ridistribuisce.
  sendToAll(msg) {
    if (State.isHost) {
      this._dispatch(State.myId, msg);                    // processa localmente
      this.broadcast({ ...msg, from: State.myId });        // manda ai guest
    } else {
      this.send({ ...msg, relay: true });                  // chiede relay all'host
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  DISPATCHER → Lobby o Game in base alla fase corrente
  // ═══════════════════════════════════════════════════════════════════════════
  _dispatch(fromId, msg) {
    if (State.phase === 'lobby') {
      if (typeof Lobby !== 'undefined') Lobby.handleMessage(fromId, msg);
    } else if (State.phase === 'game') {
      if (typeof Game !== 'undefined') Game.handleMessage(fromId, msg);
    } else {
      // FIX: log di warning per messaggi ignorati durante la fase 'menu'
      // (es. transizioni di fase, messaggi in volo durante goToMenu).
      // Prima erano silenziosamente ingoiati, rendendo il debug molto difficile.
      if (msg.type !== 'HOST_DISCONNECTED' && msg.type !== 'PLAYER_LEFT') {
        console.warn(`[Net] Messaggio ignorato (fase='${State.phase}'):`, msg.type, 'da', fromId);
      }
    }
  },
};
