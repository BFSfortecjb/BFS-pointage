// =========================================================================
// Pointage BFS — PT_debug.js
// =========================================================================
// Diagnostic : capture les erreurs JS et les affiche à l'écran (utile pour
// Jeremy, qui n'a pas la console développeur ouverte en permanence).
// =========================================================================

const PT_DEBUG = {
  panel: null,

  init() {
    this.panel = document.createElement('div');
    this.panel.id = 'pt-debug-panel';
    this.panel.style.cssText = [
      'position:fixed', 'bottom:0', 'left:0', 'right:0', 'max-height:35vh',
      'overflow-y:auto', 'background:#080808', 'color:#f3ab12',
      'font:12px/1.4 monospace', 'padding:8px', 'z-index:99999',
      'display:none', 'white-space:pre-wrap',
    ].join(';');
    document.body.appendChild(this.panel);

    window.addEventListener('error', (e) => {
      this.log(`Erreur JS : ${e.message} (${e.filename}:${e.lineno})`, true);
    });
    window.addEventListener('unhandledrejection', (e) => {
      this.log(`Erreur async : ${e.reason?.message || e.reason}`, true);
    });
  },

  log(message, isError = false) {
    console.log(isError ? `[PT-ERREUR] ${message}` : `[PT] ${message}`);
    if (!this.panel) return;
    if (isError) this.panel.style.display = 'block';
    const line = document.createElement('div');
    line.textContent = `${new Date().toLocaleTimeString('fr-FR')} — ${message}`;
    if (isError) line.style.color = '#b2181a';
    this.panel.appendChild(line);
  },
};

document.addEventListener('DOMContentLoaded', () => PT_DEBUG.init());
