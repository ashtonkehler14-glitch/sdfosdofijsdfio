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
    let renderer = owner.menuMirror ? null : await this.load();
    if (!valid()) return null;
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { alpha: false });
    if (!canvas.captureStream || !ctx) throw new Error('This browser cannot stream the game view.');
    const budget = new GameViewBudget(), waiting = new Set();
    const s = { canvas, budget, paused: false, suspended: !!owner.menuMirror && (Screens.currentName !== 'gameplay' || !GameplayScreen.s?.running), epoch: 0, frame: null, dirty: true, stopped: false, cursor: null,
      paintedFrames: 0, snapshots: 0, hudSnapshots: 0, fullSnapshots: 0, yielded: 0, skipped: 0 };
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
      s.scale = Math.max(720 / Math.min(innerWidth, innerHeight), Math.min(devicePixelRatio || 1, budget.quality.width / innerWidth, 1440 / innerHeight));
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
          if (p.encodings?.length) { p.encodings[0].maxBitrate = q.bitrate; p.encodings[0].maxFramerate = q.fps; p.degradationPreference = 'maintain-resolution'; await s.sender.setParameters(p); }
        }).catch(() => {});
      }
      if (!s.manual) s.track.applyConstraints?.({ frameRate: { max: q.fps } }).catch(() => {});
    };
    s.setSender = sender => { s.sender = sender; tune(); if (s.suspended) mask(); };
    const paint = () => {
      if (!alive() || s.suspended || s.paused || isPrivate() || !s.frame && !running()) return;
      const start = performance.now();
      if (!budget.due(start)) return;
      if (s.level !== budget.level) { dimensions(); s.level = budget.level; if (!running() || !s.activeFrame) s.dirty = true; tune(); }
      const game = GameplayScreen.s, currentView = mode();
      const active = running() && !Overlays.top();
      const base = active && s.activeGame === game ? s.activeFrame : s.frameMode === currentView && s.frameKind === 'ui' ? s.frame : null;
      if (!active && base) ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
      else {
        mask(false);
        if (active) {
          if (s.hudOpacity == null) s.hudOpacity = +getComputedStyle(GameplayScreen.hud).opacity;
          if (s.backgroundGame !== game) {
            s.backgroundGame = game; s.background = null; s.hud = null; s.layers = null; s.liveHud = null;
            s.backgroundURL = null;
          }
          const backgroundURL = /^url\(["']?(.*?)["']?\)$/.exec(GameplayScreen.bgEl?.style.backgroundImage || '')?.[1] || '';
          if (backgroundURL !== s.backgroundURL) {
            s.backgroundURL = backgroundURL; s.background = null;
            if (backgroundURL) { const image = new Image(); image.onload = () => { if (alive() && s.backgroundGame === game && s.backgroundURL === backgroundURL) s.background = image; }; image.src = backgroundURL; }
          }
          if (s.background && !(typeof HudLayout !== 'undefined' && HudLayout.part('background')?.off)) {
            const k = Math.max(canvas.width / s.background.width, canvas.height / s.background.height);
            ctx.drawImage(s.background, (canvas.width - s.background.width * k) / 2, (canvas.height - s.background.height * k) / 2, s.background.width * k, s.background.height * k);
          }
          const video = GameplayScreen.videoEl;
          if (video?.readyState >= 2 && video.classList.contains('on') && !(typeof HudLayout !== 'undefined' && HudLayout.part('background')?.off)) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          ctx.fillStyle = `rgba(0,0,0,${GameplayScreen.baseDim ?? .7})`; ctx.fillRect(0, 0, canvas.width, canvas.height);
          // Read geometry once per layout, not once per transmitted frame.
          if (!s.layers) s.layers = [GameplayScreen.sbCanvas, GameplayScreen.renderer?.canvas, ...GameplayScreen.hud.querySelectorAll('canvas')].filter(el => el && getComputedStyle(el).visibility !== 'hidden').map(el => ({ el, hud: GameplayScreen.hud.contains(el), rect: el.getBoundingClientRect() }));
          for (const layer of s.layers) {
            if (layer.hud || !layer.rect.width || !layer.rect.height || !layer.el.width || !layer.el.height) continue;
            const r = layer.rect;
            try { ctx.drawImage(layer.el, r.left * s.scale, r.top * s.scale, r.width * s.scale, r.height * s.scale); } catch { /* detached canvas */ }
          }
          if (base) ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
          for (const layer of s.layers) if (layer.hud && layer.rect.width && layer.rect.height && layer.el.width && layer.el.height) {
            const r = layer.rect, digits = layer.el.classList.contains('skin-digits'), width = digits ? parseFloat(layer.el.style.width) || r.width : r.width, height = digits ? parseFloat(layer.el.style.height) || r.height : r.height;
            ctx.globalAlpha = s.hudOpacity;
            try { ctx.drawImage(layer.el, (digits ? r.right - width : r.left) * s.scale, r.top * s.scale, width * s.scale, height * s.scale); } catch { /* detached HUD */ }
            ctx.globalAlpha = 1;
          }
          s.liveFrameMode = currentView;
          if (!s.hud) s.hud = [GameplayScreen.scoreEl, GameplayScreen.accEl, GameplayScreen.ppEl, ...(GameplayScreen.jc?.items || []).map(i => i.n), ...GameplayScreen.hud.querySelectorAll('.sp-times span')].map(el => {
            if (!el) return null;
            const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
            if (style.visibility === 'hidden') return null;
            return { el, rect, font: style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, color: style.color, opacity: +style.opacity * s.hudOpacity, align: style.textAlign };
          }).filter(h => h && h.rect.width && h.rect.height);
          ctx.save(); ctx.scale(s.scale, s.scale); ctx.textBaseline = 'top';
          for (const h of s.hud) {
            ctx.font = h.font; ctx.fillStyle = h.color; ctx.globalAlpha = h.opacity;
            const text = h.el.textContent;
            const w = ctx.measureText(text).width, x = h.align === 'center' ? h.rect.left + (h.rect.width - w) / 2 : h.align === 'right' || h.align === 'end' ? h.rect.right - w : h.rect.left;
            ctx.fillText(text, x, h.rect.top);
          }
          ctx.restore();
          if (!s.liveHud) {
            const bar = (el, fill, kind) => {
              if (!el) return null;
              const rect = el.getBoundingClientRect(), style = getComputedStyle(el), ink = fill && getComputedStyle(fill);
              if (style.visibility === 'hidden') return null;
              return rect.width && rect.height ? { rect, kind, background: style.backgroundColor, colors: (ink?.backgroundImage.match(/rgba?\([^)]+\)/g) || [ink?.backgroundColor || '#fff']), opacity: s.hudOpacity } : null;
            };
            s.liveHud = [bar(GameplayScreen.hpEl?.querySelector('.hp-track'), GameplayScreen.hpFill, 'health'), bar(GameplayScreen.progEl?.parentElement, GameplayScreen.progEl, 'progress')].filter(Boolean);
          }
          ctx.save(); ctx.scale(s.scale, s.scale); ctx.globalAlpha = s.hudOpacity;
          for (const b of s.liveHud) {
            const r = b.rect, value = b.kind === 'health' ? Math.max(0, Math.min(1, GameplayScreen._hpQ / 400)) : Math.max(0, Math.min(1, GameplayScreen._pq / 400));
            ctx.globalAlpha = b.opacity; ctx.fillStyle = b.background; ctx.fillRect(r.left, r.top, r.width, r.height);
            const gradient = ctx.createLinearGradient(r.left, 0, r.right, 0), colors = b.kind === 'health' && GameplayScreen._hpLow ? ['#ff3355', '#ff9f8f'] : b.colors;
            colors.forEach((c, i) => gradient.addColorStop(colors.length === 1 ? 0 : i / (colors.length - 1), c));
            ctx.fillStyle = gradient; ctx.fillRect(r.left, r.top, r.width * value, r.height);
          }
          const pie = GameplayScreen.pieEl;
          if (pie?.isConnected) {
            if (!s.pieRect) s.pieRect = getComputedStyle(pie).visibility === 'hidden' ? { width: 0, height: 0 } : pie.getBoundingClientRect();
            const r = s.pieRect, radius = r.width / 2, x = r.left + radius, y = r.top + r.height / 2, lead = GameplayScreen._lead;
            if (r.width && r.height) {
              ctx.fillStyle = lead ? 'rgba(126,224,122,.18)' : 'rgba(255,255,255,.14)'; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = lead ? '#7ee07a' : 'rgba(255,255,255,.92)'; ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (GameplayScreen._pieQ || 0) / 200); ctx.closePath(); ctx.fill();
              ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
            }
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
      if (s.paintPending || !alive() || s.suspended || s.paused || !s.frame && !running() || !budget.due(performance.now()) || !running() && !s.paintDirty) return;
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
      if (s.suspended) { if (s.paused || isPrivate()) mask(); s.timer = setTimeout(refresh, 250); return; }
      const start = performance.now(), epoch = s.epoch, view = mode(), active = !!running() && !Overlays.top();
      // A rate-limited encoder may drop a single transition frame. Keep a black heartbeat until sharing resumes.
      if (s.paused || isPrivate()) mask();
      const check = () => alive() && !s.suspended && !s.paused && !isPrivate() && s.epoch === epoch && mode() === view;
      const gate = async (heavy = false) => {
        if (!check()) throw aborted();
        const now = performance.now();
        if (!heavy && now < s.sliceEnd && budget.canSpend(now)) return;
        s.yielded++; await idle(heavy ? Math.max(.4, budget.paintCost) : .2, check);
        s.sliceEnd = performance.now() + (inGame() ? budget.slice(performance.now()) : Math.min(4, budget.slack(performance.now()) * .5));
      };
      try {
        const interval = active ? Math.max(750, budget.quality.snapshot / 2) : Math.max(250, budget.quality.snapshot / 4);
        if (check() && (s.dirty || !s.frame || s.frameMode !== view || !active && start - (s.captured || 0) > 5000) && start - (s.attempted || -Infinity) >= interval) {
          s.attempted = start; s.dirty = false;
          await gate(true);
          if (!renderer) renderer = await this.load();
          if (!check()) throw aborted();
          const root = active ? GameplayScreen.hud : document.body;
          const liveText = active ? [GameplayScreen.scoreEl, GameplayScreen.accEl, GameplayScreen.ppEl, ...(GameplayScreen.jc?.items || []).map(i => i.n), ...GameplayScreen.hud.querySelectorAll('.sp-times span'), GameplayScreen.hpEl, GameplayScreen.progEl?.parentElement, GameplayScreen.pieEl] : [];
          const options = { width: s.width, height: s.height, scale: s.scale, backgroundColor: active ? 'rgba(0,0,0,0)' : '#18171c', timeout: 3000,
            onBeforeWork: gate, onCloneNode: () => gate(true), onEmbedNode: () => gate(true),
            filter: node => !(node.nodeType === 1 && (node.hidden || node.style?.display === 'none' || node.matches('#loading-screen.done, #drop-overlay:not(.show)') || ['SCRIPT', 'IFRAME', 'AUDIO'].includes(node.tagName) || node.tagName === 'VIDEO' && node.readyState < 2 ||
              node.matches('.admin-view-sharing, .admin-view-wrap, .lz-cursor, [data-admin-view-ignore]') ||
              node.closest('.login-panel, .setup-step-account, input[type=password], [data-private]') ||
              active && (node.tagName === 'CANVAS' || liveText.includes(node) || node.matches('.hud-lb') && !Settings.get('gameplay.leaderboard') && !GameplayScreen._hudAll))) };
          if (s.root !== root && s.context) { renderer.destroyContext(s.context); s.context = null; }
          s.root = root;
          if (!s.context) s.context = await renderer.createContext(root, options);
          else Object.assign(s.context, options, { dpi: s.scale === 1 ? null : s.scale * 96 });
          const image = await renderer.domToCanvas(s.context);
          if (check() && s.width === innerWidth && s.height === innerHeight) {
            s.frame = image; s.frameMode = view; s.frameKind = active ? 'hud' : 'ui'; s.captured = performance.now(); s.paintDirty = true; s.snapshots++;
            if (s.context.requests.size > 128) { renderer.destroyContext(s.context); s.context = null; }
            if (active) { s.activeFrame = image; s.activeGame = GameplayScreen.s; s.hudSnapshots++; s.hud = s.layers = s.liveHud = s.pieRect = s.hudOpacity = null; } else s.fullSnapshots++; queuePaint();
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
        if (s.sender && !s.paused && !s.suspended) for (const r of (await s.sender.getStats()).values()) if (r.type === 'outbound-rtp' && r.kind === 'video') {
          const prev = s.encoderSample, frames = prev ? r.framesEncoded - prev.frames : 0;
          budget.encoder(performance.now(), r.qualityLimitationReason === 'cpu', frames > 0 ? (r.totalEncodeTime - prev.time) * 1000 / frames : 0);
          s.encoderSample = { frames: r.framesEncoded, time: r.totalEncodeTime };
        }
      } catch { /* optional encoder telemetry */ }
      finally { if (alive()) s.statsTimer = setTimeout(stats, 2000); }
    };
    const pointer = e => { s.cursor = { x: e.clientX, y: e.clientY }; s.paintDirty = true; };
    const resize = () => { s.epoch++; cancelWork(); dimensions(); s.frame = s.activeFrame = null; s.hud = s.layers = s.liveHud = s.pieRect = s.hudOpacity = null; s.dirty = true; s.attempted = -Infinity; mask(); };
    const offScreen = Bus.on('screen:changed', () => { s.epoch++; s.hud = s.layers = s.liveHud = s.pieRect = s.hudOpacity = null; cancelWork(); s.dirty = true; s.attempted = -Infinity; wakeMenus(); });
    const observer = new MutationObserver(records => {
      const active = running() && !Overlays.top(), hud = GameplayScreen.hud;
      const fast = '.sc, .acc, .hud-pp, .hud-progress, .hud-pie, .hud-hp, .jc-n, .sp-times';
      if (records.some(r => {
        const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        if (!el || el.closest('.admin-view-sharing, .admin-view-wrap')) return false;
        if (active) {
          if (!hud?.contains(el)) return false;
          if (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 && (n.tagName === 'CANVAS' || n.querySelector('canvas')))) s.layers = null;
          if (el.closest(fast)) return false;
          if (el === GameplayScreen.skipBtn && r.attributeName === 'style') {
            if (s.skipVisible === GameplayScreen._canSkip) return false;
            s.skipVisible = GameplayScreen._canSkip;
          }
        }
        return true;
      })) { s.dirty = true; s.hudOpacity = null; }
    });
    observer.observe(document.getElementById('app'), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'value', 'src'] });
    const changed = () => { s.dirty = true; s.hud = s.layers = s.liveHud = s.pieRect = s.hudOpacity = null; };
    document.addEventListener('scroll', changed, true); document.addEventListener('input', changed, true);
    document.addEventListener('pointermove', pointer, { passive: true }); window.addEventListener('resize', resize);
    s.setSuspended = suspended => { if (suspended !== s.suspended) { s.suspended = suspended; s.epoch++; cancelWork(); if (!suspended) { s.hud = s.layers = s.liveHud = s.pieRect = s.hudOpacity = null; s.dirty = true; s.attempted = -Infinity; wakeMenus(); } } };
    s.setPaused = paused => { if (paused !== s.paused) { s.paused = paused; s.epoch++; cancelWork(); s.frame = s.activeFrame = null; s.hud = s.layers = s.liveHud = s.pieRect = s.hudOpacity = null; s.dirty = true; s.attempted = -Infinity; mask(); } };
    s.stop = () => {
      s.stopped = true; cancelWork(); clearTimeout(s.timer); clearTimeout(s.statsTimer); cancelAnimationFrame(s.animation); observer.disconnect(); offScreen();
      document.removeEventListener('scroll', changed, true); document.removeEventListener('input', changed, true);
      document.removeEventListener('pointermove', pointer); window.removeEventListener('resize', resize);
      if (s.context) renderer.destroyContext(s.context);
      stream.getTracks().forEach(t => t.stop()); canvas.width = canvas.height = 0; s.frame = s.activeFrame = s.context = s.background = s.hud = null;
    };
    wakeMenus(); refresh(); stats();
    return s;
  },
};
