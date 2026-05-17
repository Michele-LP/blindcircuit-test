// ═══════════════════════════════════════════════════════════════════════════
//  UI.JS
//  Helpers DOM: cambio schermata, status, clipboard, flash bottoni.
// ═══════════════════════════════════════════════════════════════════════════

const UI = {

  // Mostra una schermata, nasconde le altre
  show(id) {
    document.querySelectorAll('.screen')
      .forEach(s => s.classList.remove('active'));
    const el = document.getElementById('scr-' + id);
    if (el) el.classList.add('active');

    // Swap video background: menu usa bg_loop_start, il resto bg_loop
    const bgMain = document.getElementById('bg-video');
    const bgMenu = document.getElementById('bg-video-menu');
    if (bgMain && bgMenu) {
      if (id === 'menu') {
        bgMenu.style.display = 'block';
        bgMain.style.display = 'none';
      } else {
        bgMenu.style.display = 'none';
        bgMain.style.display = 'block';
      }
    }
},

  // Imposta il testo e la classe di un elemento status
  setStatus(elId, msg, type = '') {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg;
    el.className   = 'status ' + type;
  },

  // Copia testo negli appunti (con fallback per browser vecchi)
  async copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      Object.assign(ta.style, { position: 'fixed', opacity: '0' });
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  },

  // Mostra un testo temporaneo su un bottone, poi ripristina
  flashButton(btn, text, ms = 1200) {
    const original = btn.textContent;
    btn.textContent = text;
    btn.disabled    = true;
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled    = false;
    }, ms);
  },

  // Torna al menu principale e resetta tutto lo stato
  goToMenu() {
    State.reset();
    this.show('menu');
    this.setStatus('menu-status', '');
  },
};
