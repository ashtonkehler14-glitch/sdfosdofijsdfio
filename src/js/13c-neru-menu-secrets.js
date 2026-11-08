/* Small menu easter eggs shared by every screen, without interrupting play or text entry. */
const NeruMenuSecrets = {
  visited: new Set(), typed: '', at: 0,
  init() {
    Bus.on('screen:changed', name => {
      if (['gameplay', 'home', 'loading', 'results', 'spectator'].includes(name)) return;
      this.visited.add(name);
      if (this.visited.size === 5 && !this.toured) {
        this.toured = true;
        setTimeout(() => { if (Screens.currentName === name) this.show('secret'); }, 800);
      }
    });
    document.addEventListener('keydown', e => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || e.key.length !== 1 || Screens.currentName === 'gameplay' ||
        e.target.closest?.('input, textarea, select, [contenteditable], [role=combobox]')) { this.typed = ''; return; }
      const now = performance.now();
      this.typed = ((now - this.at < 1200 ? this.typed : '') + e.key.toLowerCase()).slice(-4); this.at = now;
      if (this.typed === 'neru') { this.typed = ''; this.show('secret'); }
    });
  },
  show(mood) {
    if (!NeruMascot.on() || !neruAnim() || Screens.currentName === 'gameplay' || document.querySelector('.login-panel, .setup') || Overlays.top()) return;
    if (Screens.currentName === 'home' && NeruMascot.el && !NeruMascot.el.hidden) {
      NeruMascot.hop(); return;
    }
    const cameo = [...(Screens.current?.el?.querySelectorAll('.neru-cameo:not(.nc-peek)') || [])].find(n => {
      const r = n.getBoundingClientRect(); return r.width && r.bottom > 0 && r.top < innerHeight;
    });
    if (cameo) { cameo.click(); NeruCameo.burst(cameo); }
    else NeruEggs.peek(mood, { found: false, side: 'right', alongside: true });
  },
};
