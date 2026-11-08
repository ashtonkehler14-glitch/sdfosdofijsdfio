/* Render this app's own UI to a video canvas. No display/tab capture, remote DOM or browser permission is used. */
const GameViewCapture = {
  load() {
    if (window.modernScreenshot) return Promise.resolve(window.modernScreenshot);
    if (!this.loading) this.loading = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = Host.asset('vendor/modern-screenshot.js');
      const timer = setTimeout(() => { script.remove(); this.loading = null; reject(new Error('The game view renderer timed out. Please try again.')); }, 12000);
      script.onload = () => { clearTimeout(timer); resolve(window.modernScreenshot); };
      script.onerror = () => { clearTimeout(timer); script.remove(); this.loading = null; reject(new Error('The game view renderer could not load.')); };
      document.head.append(script);
    });
    return this.loading;
  },
  async create(owner, valid, isPrivate) {
    const renderer = await this.load();
    if (!valid()) return null;
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { alpha: false });
    if (!canvas.captureStream || !ctx) throw new Error('This browser cannot stream the game view.');
    const s = { canvas, paused: false, epoch: 0, frame: null, dirty: true, stopped: false, cursor: null };
    const size = () => {
      const scale = Math.min(devicePixelRatio || 1, 1920 / innerWidth, 1440 / innerHeight);
      canvas.width = Math.round(innerWidth * scale); canvas.height = Math.round(innerHeight * scale);
      s.scale = scale; s.width = innerWidth; s.height = innerHeight; s.frame = null; s.dirty = true;
    };
    size();
    const mask = () => { ctx.fillStyle = '#18171c'; ctx.fillRect(0, 0, canvas.width, canvas.height); };
    mask();
    const stream = s.stream = canvas.captureStream(30), track = s.track = stream.getVideoTracks()[0];
    const running = () => Screens.currentName === 'gameplay' && GameplayScreen.s?.running;
    const mode = () => `${Screens.currentName}/${!!running()}/${Overlays.stack.length}`;
    const paint = () => {
      if (s.stopped || !valid()) return;
      s.animation = requestAnimationFrame(paint);
      if (performance.now() - (s.painted || 0) < 30) return;
      s.painted = performance.now();
      if (s.paused || isPrivate()) { mask(); return; }
      if (s.frame) ctx.drawImage(s.frame, 0, 0, canvas.width, canvas.height);
      else mask();
      // Gameplay's own canvas stays fluid; UI snapshots supply the menus and HUD around it.
      const live = running() && !Overlays.top() && !GameplayScreen.pauseEl?.classList.contains('on') && GameplayScreen.renderer?.canvas;
      const source = live || (running() && !Overlays.top() && GameplayScreen.s?.renderer?.canvas);
      if (source && s.frame && s.frameMode === mode()) {
        const r = source.getBoundingClientRect();
        if (r.width && r.height) try { ctx.drawImage(source, r.left * s.scale, r.top * s.scale, r.width * s.scale, r.height * s.scale); } catch { /* detached renderer */ }
      }
      if (s.cursor) {
        const { x, y } = s.cursor; ctx.save(); ctx.translate(x * s.scale, y * s.scale); ctx.scale(s.scale, s.scale);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 20); ctx.lineTo(6, 14); ctx.lineTo(12, 23); ctx.lineTo(16, 20); ctx.lineTo(10, 12); ctx.lineTo(19, 12); ctx.closePath();
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#18171c'; ctx.lineWidth = 2; ctx.fill(); ctx.stroke(); ctx.restore();
      }
    };
    const refresh = async () => {
      if (s.stopped || !valid()) return;
      const start = performance.now(), epoch = s.epoch, view = mode(), active = !!running();
      try {
        if (!s.paused && !isPrivate() && (s.dirty || !s.frame || start - (s.captured || 0) > 1000)) {
          s.dirty = false;
          const image = await renderer.domToCanvas(document.body, {
            width: s.width, height: s.height, scale: s.scale, backgroundColor: '#18171c', timeout: 3000,
            filter: node => !(node.nodeType === 1 && (['SCRIPT', 'IFRAME', 'AUDIO'].includes(node.tagName) || node.tagName === 'VIDEO' && node.readyState < 2 ||
              node.matches('.admin-view-sharing, .admin-view-wrap, .lz-cursor, [data-admin-view-ignore]') ||
              node.closest('.login-panel, .setup-step-account, input[type=password], [data-private]') ||
              active && node.tagName === 'CANVAS' && (node === GameplayScreen.renderer?.canvas || node === GameplayScreen.s?.renderer?.canvas))),
          });
          if (!s.stopped && valid() && !s.paused && !isPrivate() && s.epoch === epoch && mode() === view && s.width === innerWidth && s.height === innerHeight) {
            s.frame = image; s.frameMode = view; s.captured = performance.now();
          }
        }
      } catch (e) {
        if (valid()) owner.captureError = e.message || 'The game view could not render.';
        if (!s.stopped && !s.frame && valid()) { owner.captureError = e.message || 'The game view could not render.'; if ((s.failures = (s.failures || 0) + 1) >= 3) AdminGameView.stop('The game view could not render. Please try again.'); }
      } finally {
        if (!s.stopped && valid()) s.timer = setTimeout(refresh, Math.max(active ? 850 : 170, 250 - (performance.now() - start)));
      }
    };
    const pointer = e => { s.cursor = { x: e.clientX, y: e.clientY }; };
    const resize = () => { s.epoch++; size(); mask(); };
    const observer = new MutationObserver(records => { if (records.some(r => !r.target.closest?.('.admin-view-sharing, .admin-view-wrap'))) s.dirty = true; });
    observer.observe(document.getElementById('app'), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'value', 'src'] });
    document.addEventListener('pointermove', pointer, { passive: true }); window.addEventListener('resize', resize);
    s.setPaused = paused => { if (paused !== s.paused) { s.paused = paused; s.epoch++; s.frame = null; s.dirty = true; mask(); } };
    s.stop = () => {
      s.stopped = true; clearTimeout(s.timer); cancelAnimationFrame(s.animation); observer.disconnect();
      document.removeEventListener('pointermove', pointer); window.removeEventListener('resize', resize);
      stream.getTracks().forEach(t => t.stop()); canvas.width = canvas.height = 0; s.frame = null;
    };
    paint(); refresh();
    return s;
  },
};
