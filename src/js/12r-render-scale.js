/* One resolution surface for menus, overlays and gameplay; input/layout coordinates stay unchanged. */
const RenderScale = {
  value() { return clamp(Number(Settings.get('graphics.renderScale')) || 1, .5, 1); },
  init() {
    if (this.root) return;
    const root = this.root = h('div#render-surface');
    const move = node => { if (node.nodeType === 1 && node !== root && !['SCRIPT', 'STYLE', 'LINK', 'META'].includes(node.tagName)) root.append(node); };
    for (const node of [...document.body.childNodes]) move(node);
    document.body.append(root);
    // Commit menu raster density after releasing its slider, so dragging never changes the control's geometry.
    document.addEventListener('pointerdown', e => { if (e.target.matches?.('input[type="range"][aria-label="Render scale"]')) this.adjusting = true; }, true);
    const release = () => { if (this.adjusting) { this.adjusting = false; this.apply(); } };
    window.addEventListener('pointerup', release, true); window.addEventListener('pointercancel', release, true); window.addEventListener('blur', release);
    this.observer = new MutationObserver(records => { for (const r of records) for (const node of r.addedNodes) if (node.parentNode === document.body) move(node); });
    this.observer.observe(document.body, { childList: true });
    window.addEventListener('resize', () => this.apply());
    Bus.on('settings:changed', k => { if (k === 'graphics.renderScale' || k === '*') this.apply(); });
    this.apply();
  },
  apply() {
    if (!this.root) return;
    const scale = this.value(), style = this.root.style;
    style.width = innerWidth + 'px'; style.height = innerHeight + 'px';
    style.transformOrigin = '0 0';
    if (this.adjusting) return;
    if (scale !== this.scale) {
      this.scale = scale; cancelAnimationFrame(this.prepare); cancelAnimationFrame(this.finish);
      // Establish the layer at its chosen pixel density before enlarging it. Applying both in one paint makes
      // Chromium cancel the transforms and rasterize menus at full resolution despite a lower render scale.
      style.zoom = scale === 1 ? '' : String(scale); style.transform = '';
      const settle = () => { style.transform = scale === 1 ? '' : `scale(${1 / scale})`; Bus.emit('ui:scaled', 1 / Zoom.z); };
      if (scale === 1) settle();
      else this.prepare = requestAnimationFrame(() => { this.finish = requestAnimationFrame(settle); });
    }
    this.root.dataset.resolutionScale = String(scale);
  },
};
