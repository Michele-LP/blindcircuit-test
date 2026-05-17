// ═══════════════════════════════════════════════════════════════════════════
//  AUDIO.JS — v6.8.2
//  Sistema audio completo con sintesi Web Audio API.
//  Nessun file audio esterno: tutti i suoni sono generati proceduralmente.
//
//  Uso:
//    Audio.init()                      — inizializza (chiamato su primo click)
//    Audio.play('robot_move', { robotId: 'jax' })  — suono evento
//    Audio.setBgVolume(0.5)            — volume musica background
//    Audio.setSfxVolume(0.7)           — volume effetti
//    Audio.toggleBg()                  — mute/unmute musica
//    Audio.toggleSound('robot_move', false) — disabilita suono specifico
// ═══════════════════════════════════════════════════════════════════════════

const Audio = (() => {

  let _ctx = null;          // AudioContext
  let _master = null;       // GainNode: master
  let _sfxGain = null;      // GainNode: effetti
  let _bgGain = null;       // GainNode: musica background
  let _bgNodes = [];        // nodi musica attivi
  let _bgPlaying = false;
  let _initialized = false;

  // ── Volumi e abilitazioni (da CONFIG.audio) ──────────────────────────
  let _masterVol = 0.6;
  let _sfxVol = 0.7;
  let _bgVol = 0.25;
  let _bgMuted = false;

  // Abilitazione per singolo suono (true = attivo)
  const _enabled = {};

  // ── Parametri per robot (frequenza base, waveform) ───────────────────
  const ROBOT_PARAMS = {
    jax:    { freq: 220, wave: 'sawtooth', laserFreq: 1200 },
    gerry:  { freq: 180, wave: 'square',   laserFreq: 900  },
    bolt:   { freq: 260, wave: 'triangle', laserFreq: 1500 },
    fritz:  { freq: 150, wave: 'sawtooth', laserFreq: 800  },
    pixel:  { freq: 300, wave: 'square',   laserFreq: 1800 },
    rusty:  { freq: 130, wave: 'triangle', laserFreq: 700  },
    _default: { freq: 200, wave: 'sawtooth', laserFreq: 1000 },
  };

  function _robotP(robotId) {
    return ROBOT_PARAMS[robotId] || ROBOT_PARAMS._default;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  SYNTH PRIMITIVES
  // ═══════════════════════════════════════════════════════════════════════

  // Oscillatore con sweep e envelope ADSR
  function _osc(dest, freq, freqEnd, wave, dur, vol, attack, decay) {
    const t = _ctx.currentTime;
    const o = _ctx.createOscillator();
    const g = _ctx.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd !== freq) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + (attack || 0.005));
    g.gain.linearRampToValueAtTime(vol * 0.6, t + dur - (decay || dur * 0.3));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.01);
  }

  // Noise burst (rumore bianco filtrato)
  function _noise(dest, dur, vol, freqLow, freqHigh) {
    const t = _ctx.currentTime;
    const bufSz = Math.max(1, Math.floor(_ctx.sampleRate * dur));
    const buf = _ctx.createBuffer(1, bufSz, _ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufSz; i++) d[i] = Math.random() * 2 - 1;
    const src = _ctx.createBufferSource();
    src.buffer = buf;
    const g = _ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(g);
    if (freqLow || freqHigh) {
      const f = _ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = ((freqLow || 100) + (freqHigh || 4000)) / 2;
      f.Q.value = 1;
      g.disconnect(); src.connect(f); f.connect(g); g.connect(dest);
    } else {
      g.connect(dest);
    }
    src.start(t); src.stop(t + dur + 0.01);
  }

  // Beep rapido
  function _beep(dest, freq, dur, vol, wave) {
    _osc(dest, freq, freq, wave || 'sine', dur, vol || 0.3, 0.003, dur * 0.4);
  }

  // Sequenza di toni
  function _seq(dest, notes, dur, vol, wave) {
    notes.forEach((freq, i) => {
      const t = _ctx.currentTime + i * dur;
      const o = _ctx.createOscillator();
      const g = _ctx.createGain();
      o.type = wave || 'sine';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol || 0.2, t + 0.005);
      g.gain.linearRampToValueAtTime(0, t + dur - 0.01);
      o.connect(g); g.connect(dest);
      o.start(t); o.stop(t + dur);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  SOUND DEFINITIONS — ogni funzione produce un suono
  // ═══════════════════════════════════════════════════════════════════════

  const SOUNDS = {

    // ── Movimento robot (personalizzato) ─────────────────────────────
    robot_move(opts) {
      const rp = _robotP(opts?.robotId);
      _osc(_sfxGain, rp.freq, rp.freq * 1.3, rp.wave, 0.15, 0.12, 0.005, 0.08);
      _osc(_sfxGain, rp.freq * 0.5, rp.freq * 0.7, 'sine', 0.12, 0.06, 0.01, 0.06);
    },

    // ── Rotazione robot (personalizzata) ─────────────────────────────
    robot_rotate(opts) {
      const rp = _robotP(opts?.robotId);
      _osc(_sfxGain, rp.freq * 0.8, rp.freq * 1.5, rp.wave, 0.2, 0.1, 0.01, 0.1);
      _noise(_sfxGain, 0.12, 0.04, 300, 1200);
    },

    robot_uturn(opts) {
      const rp = _robotP(opts?.robotId);
      _osc(_sfxGain, rp.freq * 0.6, rp.freq * 1.8, rp.wave, 0.3, 0.12, 0.01, 0.15);
      _noise(_sfxGain, 0.2, 0.05, 200, 1000);
    },

    // ── Spinta (robot push / pistone) ────────────────────────────────
    push() {
      _noise(_sfxGain, 0.15, 0.25, 80, 400);
      _osc(_sfxGain, 120, 60, 'sine', 0.18, 0.2, 0.003, 0.12);
    },

    piston() {
      _noise(_sfxGain, 0.1, 0.2, 100, 600);
      _osc(_sfxGain, 200, 80, 'square', 0.15, 0.15, 0.003, 0.1);
      _osc(_sfxGain, 100, 40, 'sine', 0.2, 0.2, 0.005, 0.12);
    },

    // ── Caduta nel buco ──────────────────────────────────────────────
    fall() {
      _osc(_sfxGain, 400, 40, 'sine', 0.6, 0.25, 0.01, 0.4);
      _osc(_sfxGain, 600, 50, 'sawtooth', 0.5, 0.08, 0.02, 0.3);
      _noise(_sfxGain, 0.4, 0.1, 50, 300);
    },

    // ── Atterraggio dopo caduta ──────────────────────────────────────
    land() {
      _noise(_sfxGain, 0.12, 0.3, 40, 200);
      _osc(_sfxGain, 80, 40, 'sine', 0.2, 0.3, 0.003, 0.15);
    },

    // ── Laser robot (personalizzato) ─────────────────────────────────
    robot_laser(opts) {
      const rp = _robotP(opts?.robotId);
      _osc(_sfxGain, rp.laserFreq, rp.laserFreq * 0.3, 'sawtooth', 0.25, 0.12, 0.003, 0.15);
      _osc(_sfxGain, rp.laserFreq * 1.5, rp.laserFreq * 0.5, 'sine', 0.2, 0.06, 0.005, 0.1);
    },

    // ── Laser cella (sparalaser fissa) ───────────────────────────────
    cell_laser() {
      _osc(_sfxGain, 1600, 200, 'square', 0.35, 0.1, 0.005, 0.2);
      _osc(_sfxGain, 800, 150, 'sawtooth', 0.3, 0.08, 0.01, 0.15);
      _noise(_sfxGain, 0.15, 0.05, 1000, 4000);
    },

    // ── Rotazione piattaforme (ingranaggi) ───────────────────────────
    gear() {
      _noise(_sfxGain, 0.3, 0.12, 200, 800);
      _osc(_sfxGain, 150, 180, 'triangle', 0.25, 0.08, 0.01, 0.15);
      // Click meccanico
      _osc(_sfxGain, 2000, 1500, 'square', 0.03, 0.1, 0.001, 0.02);
    },

    // ── Ricarica piattaforma ─────────────────────────────────────────
    recharge() {
      _seq(_sfxGain, [400, 500, 600, 800], 0.1, 0.12, 'sine');
      _osc(_sfxGain, 200, 800, 'triangle', 0.4, 0.06, 0.01, 0.25);
    },

    // ── Nastro trasportatore velocità 1 ──────────────────────────────
    conveyor1() {
      _noise(_sfxGain, 0.25, 0.06, 80, 300);
      _osc(_sfxGain, 80, 90, 'triangle', 0.2, 0.04, 0.02, 0.1);
    },

    // ── Nastro trasportatore velocità 2 (express) ────────────────────
    conveyor2() {
      _noise(_sfxGain, 0.2, 0.08, 100, 500);
      _osc(_sfxGain, 120, 140, 'triangle', 0.18, 0.05, 0.01, 0.08);
    },

    // ── Danno ricevuto (generico) ────────────────────────────────────
    damage() {
      _noise(_sfxGain, 0.15, 0.25, 200, 2000);
      _osc(_sfxGain, 300, 100, 'square', 0.2, 0.15, 0.003, 0.12);
    },

    // ── Danno da caduta ──────────────────────────────────────────────
    damage_fall() {
      _noise(_sfxGain, 0.2, 0.3, 100, 800);
      _osc(_sfxGain, 200, 50, 'sawtooth', 0.3, 0.2, 0.005, 0.2);
    },

    // ── Danno da laser ───────────────────────────────────────────────
    damage_laser() {
      _osc(_sfxGain, 800, 200, 'square', 0.15, 0.15, 0.003, 0.1);
      _noise(_sfxGain, 0.1, 0.12, 500, 3000);
    },

    // ── Inizio round ─────────────────────────────────────────────────
    round_start() {
      _seq(_sfxGain, [330, 440, 550, 660], 0.12, 0.15, 'triangle');
    },

    // ── Muro (movimento bloccato) ────────────────────────────────────
    wall_hit() {
      _noise(_sfxGain, 0.08, 0.2, 100, 600);
      _osc(_sfxGain, 100, 70, 'sine', 0.1, 0.15, 0.002, 0.06);
    },

    // ── Checkpoint raggiunto ─────────────────────────────────────────
    checkpoint() {
      _seq(_sfxGain, [523, 659, 784, 1047], 0.15, 0.2, 'sine');
      _osc(_sfxGain, 1047, 1047, 'triangle', 0.3, 0.1, 0.1, 0.2);
    },

    // ── Vittoria ─────────────────────────────────────────────────────
    victory() {
      _seq(_sfxGain, [523, 659, 784, 1047, 784, 1047, 1319], 0.18, 0.2, 'sine');
    },

    // ── Carta giocata ────────────────────────────────────────────────
    card_play() {
      _noise(_sfxGain, 0.04, 0.08, 2000, 6000);
      _beep(_sfxGain, 800, 0.06, 0.08, 'sine');
    },

    // ── Conferma programmazione ──────────────────────────────────────
    confirm() {
      _seq(_sfxGain, [600, 900], 0.08, 0.12, 'sine');
    },

    // ── Energia guadagnata ───────────────────────────────────────────
    energy() {
      _beep(_sfxGain, 660, 0.1, 0.1, 'sine');
      _beep(_sfxGain, 880, 0.1, 0.08, 'sine');
    },

    // ── Click UI generico ────────────────────────────────────────────
    ui_click() {
      _beep(_sfxGain, 1200, 0.03, 0.06, 'sine');
    },
  };

  // ═══════════════════════════════════════════════════════════════════════
  //  BACKGROUND MUSIC — drone ambientale procedurale
  // ═══════════════════════════════════════════════════════════════════════

  function _startBg() {
    if (_bgPlaying || !_ctx) return;
    _bgPlaying = true;
    // Drone base: 2 oscillatori detuned + LFO tremolo
    const t = _ctx.currentTime;

    const o1 = _ctx.createOscillator();
    o1.type = 'sine'; o1.frequency.value = 55;
    const o2 = _ctx.createOscillator();
    o2.type = 'triangle'; o2.frequency.value = 55.3; // leggero detune
    const o3 = _ctx.createOscillator();
    o3.type = 'sine'; o3.frequency.value = 82.5; // quinta

    // LFO per tremolo leggero
    const lfo = _ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 0.15;
    const lfoGain = _ctx.createGain();
    lfoGain.gain.value = 0.15;
    lfo.connect(lfoGain);

    const mix = _ctx.createGain();
    mix.gain.value = 0.12;
    lfoGain.connect(mix.gain);

    // Filtro low-pass per ammorbidire
    const lp = _ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 200; lp.Q.value = 1;

    o1.connect(lp); o2.connect(lp); o3.connect(lp);
    lp.connect(mix); mix.connect(_bgGain);

    [o1, o2, o3, lfo].forEach(o => o.start(t));
    _bgNodes = [o1, o2, o3, lfo, lfoGain, mix, lp];
  }

  function _stopBg() {
    _bgNodes.forEach(n => { try { if (n.stop) n.stop(); n.disconnect(); } catch (_) {} });
    _bgNodes = [];
    _bgPlaying = false;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════

  return {

    /** Inizializza AudioContext (chiamare su interazione utente) */
    init() {
      if (_initialized) return;
      try {
        _ctx = new (window.AudioContext || window.webkitAudioContext)();
        _master = _ctx.createGain();
        _master.gain.value = _masterVol;
        _master.connect(_ctx.destination);

        _sfxGain = _ctx.createGain();
        _sfxGain.gain.value = _sfxVol;
        _sfxGain.connect(_master);

        _bgGain = _ctx.createGain();
        _bgGain.gain.value = _bgMuted ? 0 : _bgVol;
        _bgGain.connect(_master);

        // Carica abilitazioni da CONFIG
        if (typeof CONFIG !== 'undefined' && CONFIG.audio?.sounds) {
          for (const [k, v] of Object.entries(CONFIG.audio.sounds)) {
            _enabled[k] = v !== false;
          }
        }

        _initialized = true;
      } catch (e) {
        console.warn('Audio: Web Audio API non disponibile', e);
      }
    },

    /** Suona un evento. Fallback silenzioso se suono non trovato o disabilitato. */
    play(event, opts) {
      if (!_initialized || !_ctx) return;
      if (_ctx.state === 'suspended') _ctx.resume();
      // Check se abilitato
      if (_enabled[event] === false) return;
      // Cerca la funzione di sintesi
      const fn = SOUNDS[event];
      if (!fn) return; // fallback silenzioso
      try { fn(opts); } catch (_) { /* silenzioso */ }
    },

    /** Volume master (0–1) */
    setMasterVolume(v) {
      _masterVol = Math.max(0, Math.min(1, v));
      if (_master) _master.gain.value = _masterVol;
    },
    getMasterVolume() { return _masterVol; },

    /** Volume effetti (0–1) */
    setSfxVolume(v) {
      _sfxVol = Math.max(0, Math.min(1, v));
      if (_sfxGain) _sfxGain.gain.value = _sfxVol;
    },
    getSfxVolume() { return _sfxVol; },

    /** Volume musica (0–1) */
    setBgVolume(v) {
      _bgVol = Math.max(0, Math.min(1, v));
      if (_bgGain && !_bgMuted) _bgGain.gain.value = _bgVol;
    },
    getBgVolume() { return _bgVol; },

    /** Toggle mute musica */
    toggleBg() {
      _bgMuted = !_bgMuted;
      if (_bgGain) _bgGain.gain.value = _bgMuted ? 0 : _bgVol;
      return !_bgMuted;
    },
    isBgMuted() { return _bgMuted; },

    /** Avvia musica background */
    startBg() { if (!_initialized) this.init(); _startBg(); },
    /** Ferma musica background */
    stopBg() { _stopBg(); },

    /** Abilita/disabilita suono specifico */
    toggleSound(event, on) {
      _enabled[event] = on !== undefined ? !!on : !_enabled[event];
    },
    isSoundEnabled(event) { return _enabled[event] !== false; },

    /** Lista tutti i suoni disponibili */
    getSoundList() { return Object.keys(SOUNDS); },

    /** Stato (per UI settings) */
    getSettings() {
      return {
        masterVol: _masterVol, sfxVol: _sfxVol, bgVol: _bgVol,
        bgMuted: _bgMuted, enabled: { ..._enabled },
      };
    },
  };
})();
