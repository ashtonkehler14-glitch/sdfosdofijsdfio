/* Render this app's own UI to a video canvas. No display/tab capture, remote DOM or browser permission is used. */
const GameViewCapture = {
  load() {
    if (window.modernScreenshot) return Promise.resolve(window.modernScreenshot);
    if (!this.loading) this.loading = new Promise((resolve, reject) => {
      const script = document.createElement('script'), src = Host.asset('vendor/modern-screenshot.js');
      // A cached pre-budget renderer has no yield checkpoints. Saved HTML files already contain the matching asset.
      script.src = /^(blob:|data:)/.test(src) ? src : src + (src.includes('?') ? '&' : '?') + 'v=' + APP_BUILD;
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
    const budget = new GameViewBudget(), waiting = new Set();
    const s = { canvas, budget, paused: false, epoch: 0, frame: null, dirty: true, stopped: false, cursor: null,
      paintedFrames: 0, snapshots: 0, yielded: 0, skipped: 0 };
    const alive = () => !s.stopped && valid();
    const aborted = () => Object.assign(new Error('Game-view work deferred.'), { name: 'AbortError' });
    const cancelWork = () => {
      for (const task of waiting) { if (task.idle) cancelIdleCallback(task.id); else clearTimeout(task.id); task.reject(aborted()); }
      waiting.clear(); s.sliceEnd = 0;
    };
    // No timeout forces capture into a busy game frame. At minimum quality, the stream waits when there is no slack.
    const idle = (cost = .2, check = alive) => new Promise((resolve, reject) => {
      const task = { reject, id: 0, idle: typeof requestIdleCallback === 'function' }; waiting.add(task);
      const attempt = deadline => {
        if (!check()) { waiting.delete(task); reject(aborted()); return; }
        const now = performance.now();
        if (budget.canSpend(now, cost) && (!deadline || deadline.timeRemaining() > cost + .3)) {
          waiting.delete(task); resolve();
        } else { s.skipped++; schedule(); }
      };
      const schedule = () => { task.id = task.idle ? requestIdleCallback(attempt) : setTimeout(() => attempt(null), Math.max(4, Math.ceil(budget.displayMs / 2))); };
      schedule();
    });
    const running = () => Screens.currentName === 'gameplay' && GameplayScreen.s?.running;
    const inGame = () => Screens.currentName === 'gameplay' && !!GameplayScreen.s;
    const mode = () => `${Screens.currentName}/${!!running()}/${Overlays.stack.length}/${GameplayScreen.s?.startedReal || 0}`;
    const emit = () => { if (s.manual) s.track.requestFrame(); };
    const mask = (send = true) => { ctx.fillStyle = s.paused || isPrivate() ? '#000' : '#18171c'; ctx.fillRect(0, 0, canvas.width, canvas.height); if (send && s.track) emit(); };
    const dimensions = () => {
      s.scale = Math.min(devicePixelRatio || 1, budget.quality.width / innerWidth, 1440 / innerHeight);
      s.width = innerWidth; s.height = innerHeight;
      const w = Math.max(1, Math.round(innerWidth * s.scale)), h = Math.max(1, Math.round(innerHeight * s.scale));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    };
    dimensions(); mask();
    let stream = canvas.captureStream(0);
    if (typeof stream.getVideoTracks()[0]?.requestFrame !== 'function') { stream.getTracks().forEach(t => t.stop()); stream = canvas.captureStream(budget.quality.fps); }
    s.stream = stream; s.track = stream.getVideoTracks()[0]; s.manual = typeof s.track.requestFrame === 'function';
    const tune = () => {
      const q = budget.quality;
      if (s.sender) {
        // Serialize setParameters: overlapping encoder changes can silently undo each other.
        s.senderUpdates = (s.senderUpdates || Promise.resolve()).catch(() => {}).then(async () => {
          if (!alive()) return;
          const p = s.sender.getParameters();
          if (p.encodings?.length) { p.encodings[0].maxBitrate = q.bitrate; p.encodings[0].maxFramerate = q.fps; p.degradationPreference = 'maintain-framerate'; await s.sender.setParameters(p); }
        }).catch(() => {});
      }
      if (!s.manual) s.track.applyConstraints?.({ frameRate: { max: q.fps } }).catch(() => {});
    };
    s.setSender = sender => { s.sender = sender; tune(); };
    const paint = () => {
      if (!alive() || s.paused || isPrivate() || !s.frame && !running()) return;
      const start = performance.now();
      if (!budget.due(start)) return;
      if (s.level !== budget.level) { dimensions(); s.level = budget.level; s.dirty = true; tune(); }
      const game = GameplayScreen.s, currentView = mode();
      const base = running() && s.activeGame === game ? s.activeFrame : s.frameMode === currentView ? s.frame : null;
      if (base) ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
      else {
        mask(false);
        // A cheap live playfield is available immediately, even while a detailed UI snapshot waits for idle time.
        if (running()) {
          if (s.backgroundGame !== game) {
            s.backgroundGame = game; s.background = null; s.hud = null;
            const url = /^url\(["']?(.*?)["']?\)$/.exec(GameplayScreen.bgEl?.style.backgroundImage || '')?.[1];
            if (url) { const image = new Image(); image.onload = () => { if (alive() && s.backgroundGame === game) s.background = image; }; image.src = url; }
          }
          if (s.background) {
            const k = Math.max(canvas.width / s.background.width, canvas.height / s.background.height);
            ctx.drawImage(s.background, (canvas.width - s.background.width * k) / 2, (canvas.height - s.background.height * k) / 2, s.background.width * k, s.background.height * k);
            ctx.fillStyle = `rgba(0,0,0,${GameplayScreen.baseDim ?? .7})`; ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
        }
      }
      const source = running() && !Overlays.top() && GameplayScreen.renderer?.canvas;
      if (source) {
        const r = source.getBoundingClientRect();
        if (r.width && r.height) try { ctx.drawImage(source, r.left * s.scale, r.top * s.scale, r.width * s.scale, r.height * s.scale); s.liveFrameMode = currentView; } catch { /* detached renderer */ }
        if (!base) {
          if (!s.hud) s.hud = [GameplayScreen.scoreEl, GameplayScreen.accEl, GameplayScreen.ppEl].map((el, kind) => {
            if (!el) return null;
            const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
            return { el, kind, rect, font: style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, color: style.color };
          }).filter(h => h && h.rect.width && h.rect.height);
          ctx.save(); ctx.scale(s.scale, s.scale); ctx.textBaseline = 'top';
          for (let i = 0; i < s.hud.length; i++) {
            const h = s.hud[i]; ctx.font = h.font; ctx.fillStyle = h.color;
            const text = h.kind === 0 ? fmtScore(game.engine.score.scoreStd) : h.kind === 1 ? fmtAcc(game.engine.score.accuracy) : h.el.textContent;
            ctx.fillText(text, h.rect.right - ctx.measureText(text).width, h.rect.top);
          }
          ctx.restore();
        }
      }
      if (s.cursor) {
        const { x, y } = s.cursor; ctx.save(); ctx.translate(x * s.scale, y * s.scale); ctx.scale(s.scale, s.scale);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 20); ctx.lineTo(6, 14); ctx.lineTo(12, 23); ctx.lineTo(16, 20); ctx.lineTo(10, 12); ctx.lineTo(19, 12); ctx.closePath();
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#18171c'; ctx.lineWidth = 2; ctx.fill(); ctx.stroke(); ctx.restore();
      }
      emit(); s.paintedFrames++; s.paintDirty = false;
      budget.painted(start, performance.now() - start);
    };
    const queuePaint = () => {
      if (s.paintPending || !alive() || s.paused || !s.frame && !running() || !budget.due(performance.now()) || !running() && !s.paintDirty) return;
      s.paintPending = true;
      idle(budget.paintCost).then(paint).catch(() => {}).finally(() => { s.paintPending = false; });
    };
    const menuFrame = ts => {
      s.animation = 0;
      if (!alive()) return;
      if (inGame()) return; // Gameplay drives capture after its own frame has finished.
      const work = s.lastMenu ? Math.max(0, performance.now() - ts) : 0; s.lastMenu = ts;
      budget.begin(ts); budget.sample(ts, work); queuePaint();
      s.animation = requestAnimationFrame(menuFrame);
    };
    const wakeMenus = () => { if (alive() && !s.animation && !inGame()) s.animation = requestAnimationFrame(menuFrame); };
    s.gameFrameBegin = ts => { budget.begin(ts); const view = mode(); if (s.lastGameMode !== view) { s.lastGameMode = view; cancelWork(); s.attempted = -Infinity; s.dirty = true; } };
    s.gameFrameEnd = (ts, work, limit, drawn) => { if (alive()) { budget.sample(ts, work, limit, drawn); if (drawn) queuePaint(); } };
    const refresh = async () => {
      if (!alive()) return;
      const start = performance.now(), epoch = s.epoch, view = mode(), active = !!running();
      // A rate-limited encoder may drop a single transition frame. Keep a black heartbeat until sharing resumes.
      if (s.paused || isPrivate()) mask();
      const check = () => alive() && !s.paused && !isPrivate() && s.epoch === epoch && mode() === view;
      const gate = async (heavy = false) => {
        if (!check()) throw aborted();
        const now = performance.now();
        if (!heavy && now < s.sliceEnd && budget.canSpend(now)) return;
        s.yielded++; await idle(heavy ? Math.max(.4, budget.paintCost) : .2, check);
        s.sliceEnd = performance.now() + (inGame() ? budget.slice(performance.now()) : Math.min(4, budget.slack(performance.now()) * .5));
      };
      try {
        const interval = active ? Math.max(2000, budget.quality.snapshot) : Math.max(250, budget.quality.snapshot / 4);
        if (check() && (s.dirty || !s.frame || start - (s.captured || 0) > interval) && start - (s.attempted || -Infinity) >= interval) {
          s.attempted = start; s.dirty = false;
          await gate(true);
          const options = { width: s.width, height: s.height, scale: s.scale, backgroundColor: '#18171c', timeout: 3000,
            onBeforeWork: gate, onCloneNode: () => gate(true), onEmbedNode: () => gate(true),
            filter: node => !(node.nodeType === 1 && (node.hidden || node.style?.display === 'none' || node.matches('#loading-screen.done, #drop-overlay:not(.show)') || ['SCRIPT', 'IFRAME', 'AUDIO'].includes(node.tagName) || node.tagName === 'VIDEO' && node.readyState < 2 ||
              node.matches('.admin-view-sharing, .admin-view-wrap, .lz-cursor, [data-admin-view-ignore]') ||
              node.closest('.login-panel, .setup-step-account, input[type=password], [data-private]') ||
              active && node.tagName === 'CANVAS' && node === GameplayScreen.renderer?.canvas)) };
          if (!s.context) s.context = await renderer.createContext(document.body, options);
          else Object.assign(s.context, options, { dpi: s.scale === 1 ? null : s.scale * 96 });
          const image = await renderer.domToCanvas(s.context);
          if (check() && s.width === innerWidth && s.height === innerHeight) {
            s.frame = image; s.frameMode = view; s.captured = performance.now(); s.paintDirty = true; s.snapshots++;
            if (s.context.requests.size > 128) { renderer.destroyContext(s.context); s.context = null; }
            if (active) { s.activeFrame = image; s.activeGame = GameplayScreen.s; } queuePaint();
          }
        }
      } catch (e) {
        if (s.context) { renderer.destroyContext(s.context); s.context = null; }
        if (e.name !== 'AbortError' && alive()) {
          owner.captureError = e.message || 'The game view could not render.';
          if (!s.frame && (s.failures = (s.failures || 0) + 1) >= 3) AdminGameView.stop('The game view could not render. Please try again.');
        }
      } finally { if (alive()) { wakeMenus(); s.timer = setTimeout(refresh, 250); } }
    };
    const stats = async () => {
      if (!alive()) return;
      try {
        if (s.sender && !s.paused) for (const r of (await s.sender.getStats()).values()) if (r.type === 'outbound-rtp' && r.kind === 'video') {
          const prev = s.encoderSample, frames = prev ? r.framesEncoded - prev.frames : 0;
          budget.encoder(performance.now(), r.qualityLimitationReason === 'cpu', frames > 0 ? (r.totalEncodeTime - prev.time) * 1000 / frames : 0);
          s.encoderSample = { frames: r.framesEncoded, time: r.totalEncodeTime };
        }
      } catch { /* optional encoder telemetry */ }
      finally { if (alive()) s.statsTimer = setTimeout(stats, 2000); }
    };
    const pointer = e => { s.cursor = { x: e.clientX, y: e.clientY }; s.paintDirty = true; };
    const resize = () => { s.epoch++; cancelWork(); dimensions(); s.frame = s.activeFrame = null; s.hud = null; s.dirty = true; s.attempted = -Infinity; mask(); };
    const offScreen = Bus.on('screen:changed', () => { cancelWork(); s.dirty = true; s.attempted = -Infinity; wakeMenus(); });
    const observer = new MutationObserver(records => { if (records.some(r => !r.target.closest?.('.admin-view-sharing, .admin-view-wrap'))) s.dirty = true; });
    observer.observe(document.getElementById('app'), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'value', 'src'] });
    document.addEventListener('pointermove', pointer, { passive: true }); window.addEventListener('resize', resize);
    s.setPaused = paused => { if (paused !== s.paused) { s.paused = paused; s.epoch++; cancelWork(); s.frame = s.activeFrame = null; s.hud = null; s.dirty = true; s.attempted = -Infinity; mask(); } };
    s.stop = () => {
      s.stopped = true; cancelWork(); clearTimeout(s.timer); clearTimeout(s.statsTimer); cancelAnimationFrame(s.animation); observer.disconnect(); offScreen();
      document.removeEventListener('pointermove', pointer); window.removeEventListener('resize', resize);
      if (s.context) renderer.destroyContext(s.context);
      stream.getTracks().forEach(t => t.stop()); canvas.width = canvas.height = 0; s.frame = s.activeFrame = s.context = s.background = s.hud = null;
    };
    wakeMenus(); refresh(); stats();
    return s;
  },
};
