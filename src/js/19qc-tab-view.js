/* Optional, player-initiated native capture of this game tab. The browser handles compositing and capture. */
const TabViewCapture = {
  async preferEfficientCodec(pc) {
    if (typeof navigator === 'undefined' || !navigator.mediaCapabilities?.encodingInfo || typeof RTCRtpSender === 'undefined') return;
    try {
      const codecs = RTCRtpSender.getCapabilities?.('video')?.codecs || [], choices = [...new Set(codecs.map(c => c.mimeType).filter(m => /^video\/(VP8|VP9|H264|AV1)$/i.test(m)))];
      const results = await Promise.all(choices.map(async mime => {
        try { const r = await navigator.mediaCapabilities.encodingInfo({ type: 'webrtc', video: { contentType: mime, width: 1280, height: 720, bitrate: 2500000, framerate: 30 } }); return r.supported && r.smooth && r.powerEfficient ? mime : null; } catch { return null; }
      }));
      const best = results.find(Boolean); if (!best) return;
      const ordered = [...codecs.filter(c => c.mimeType === best), ...codecs.filter(c => c.mimeType !== best)];
      for (const t of pc.getTransceivers()) if (t.sender.track?.kind === 'video') t.setCodecPreferences?.(ordered);
    } catch { /* Keep the browser's codec order when capability information is unavailable. */ }
  },
  canCrop() { return typeof CropTarget !== 'undefined' && typeof CropTarget.fromElement === 'function' && typeof BrowserCaptureMediaStreamTrack !== 'undefined' && typeof BrowserCaptureMediaStreamTrack.prototype.cropTo === 'function'; },
  canVerifyHandle() { return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.setCaptureHandleConfig === 'function' && typeof MediaStreamTrack !== 'undefined' && typeof MediaStreamTrack.prototype.getCaptureHandle === 'function'; },
  supported() {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && (this.canVerifyHandle() || this.canCrop());
  },
  async create(valid, privateOpen, onended = () => {}) {
    if (!this.supported()) throw new Error('Exact tab sharing needs a browser with current-tab capture support. The lightweight view is still available.');
    // Verify this tab using its per-request browser capture handle. This keeps the direct compositor path;
    // cropping the entire document is a compatibility fallback, since region capture can add GPU readbacks.
    let handle = '', stream, track, verification;
    const clearHandle = () => { if (handle) try { navigator.mediaDevices.setCaptureHandleConfig({ handle: '', exposeOrigin: false, permittedOrigins: [] }); } catch {} };
    if (this.canVerifyHandle()) try {
      handle = crypto.randomUUID(); navigator.mediaDevices.setCaptureHandleConfig({ handle, exposeOrigin: true, permittedOrigins: [location.origin] });
    } catch { handle = ''; }
    try {
      // This call must stay in the player's click handler, before any asynchronous work consumes activation.
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser', width: { ideal: Math.round(720 * Math.max(1, innerWidth / innerHeight)), max: Math.round(720 * Math.max(1, innerWidth / innerHeight)) }, height: { ideal: Math.round(720 * Math.max(1, innerHeight / innerWidth)), max: Math.round(720 * Math.max(1, innerHeight / innerWidth)) }, frameRate: { ideal: 30, max: 30 } },
        audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', monitorTypeSurfaces: 'exclude', surfaceSwitching: 'exclude', systemAudio: 'exclude',
      });
      track = stream.getVideoTracks()[0];
      if (track) { track.enabled = false; track.onended = () => { if (valid()) onended(); }; }
      if (track?.readyState === 'ended') { if (valid()) onended(); stream.getTracks().forEach(t => t.stop()); clearHandle(); return null; }
      if (!valid()) { stream.getTracks().forEach(t => t.stop()); clearHandle(); return null; }
      if (!track || track.getSettings().displaySurface !== 'browser') throw new Error('Choose this game’s tab to share.');
      const identity = handle && track.getCaptureHandle?.();
      if (identity?.handle === handle && identity.origin === location.origin) verification = 'handle';
      else {
        if (identity?.handle || !this.canCrop() || typeof track.cropTo !== 'function') throw new Error('The selected tab is not this game.');
        await track.cropTo(await CropTarget.fromElement(document.documentElement)); verification = 'crop';
      }
      if (!valid()) { stream.getTracks().forEach(t => t.stop()); clearHandle(); return null; }
    } catch (e) {
      stream?.getTracks().forEach(t => t.stop()); clearHandle();
      if (e.name === 'NotAllowedError' || e.name === 'AbortError') throw e;
      throw new Error('Exact sharing could not capture this game tab. Choose the current game tab, or keep using the lightweight view.');
    }
    const budget = new GameViewBudget(), s = { native: true, manual: false, stream, track, budget, verification, ready: false, paused: false, stopped: false, metrics: {} };
    budget.level = 0;
    const alive = () => !s.stopped && valid();
    track.contentHint = 'detail';
    const tune = () => {
      const q = budget.quality, ratio = innerWidth / innerHeight, shortSide = [720, 720, 900, 900, 1080, 1080][budget.level];
      const height = Math.round(shortSide / Math.min(1, ratio)), width = Math.round(height * ratio);
      s.tuning = (s.tuning || Promise.resolve()).catch(() => {}).then(async () => {
        if (!alive()) return;
        // Keep 30fps and readable text as targets; browser congestion control still manages the real network rate.
        await track.applyConstraints({ width: { ideal: width, max: width }, height: { ideal: height, max: height }, frameRate: { ideal: 30, max: 30 } }).catch(() => {});
        if (!alive() || !s.sender) return;
        const p = s.sender.getParameters();
        if (p.encodings?.length) { p.encodings[0].maxBitrate = q.bitrate; p.encodings[0].maxFramerate = 30; p.degradationPreference = 'maintain-resolution'; await s.sender.setParameters(p); }
      }).catch(() => {});
      s.level = budget.level;
    };
    const stats = async () => {
      if (!alive()) return;
      try {
        if (s.sender) for (const r of (await s.sender.getStats()).values()) if (r.type === 'outbound-rtp' && r.kind === 'video') {
          if (!alive()) return;
          const previous = s.metrics, frames = r.framesEncoded - (previous.framesEncoded || 0);
          if (previous.framesEncoded !== undefined && frames > 0) s.ready = true;
          const encodeMs = frames > 0 && previous.totalEncodeTime !== undefined ? (r.totalEncodeTime - previous.totalEncodeTime) * 1000 / frames : 0;
          budget.encoder(performance.now(), r.qualityLimitationReason === 'cpu', encodeMs);
          s.metrics = { framesEncoded: r.framesEncoded, framesPerSecond: r.framesPerSecond, width: r.frameWidth, height: r.frameHeight, totalEncodeTime: r.totalEncodeTime, encodeMs, qualityLimitationReason: r.qualityLimitationReason };
        }
        if (s.level !== budget.level) tune();
      } catch { /* Browser telemetry is optional. */ }
      finally { if (alive()) s.statsTimer = setTimeout(stats, s.ready ? 2000 : 100); }
    };
    s.setSender = sender => {
      if (s.sender === sender) return;
      s.sender = sender; tune(); stats();
      // A static tab may emit just one frame, and some browsers omit encoding counters. Do not make optional
      // telemetry a prerequisite for viewing; the receiver still waits for its video clock to advance.
      s.readyTimer = setTimeout(() => { if (alive()) s.ready = true; }, 750);
    };
    s.gameFrameBegin = ts => budget.begin(ts);
    s.gameFrameEnd = (ts, work, limit, drawn) => budget.sample(ts, work, limit, drawn);
    s.setSuspended = () => {}; // Native capture already includes menus and gameplay, with no duplicate JS renderer.
    s.setPaused = paused => { s.paused = !!paused; track.enabled = alive() && !s.paused && !privateOpen(); };
    track.onended = () => { if (alive()) (s.onended || onended)(); };
    s.stop = () => { s.stopped = true; clearTimeout(s.statsTimer); clearTimeout(s.readyTimer); window.removeEventListener('resize', tune); track.onended = null; stream.getTracks().forEach(t => t.stop()); clearHandle(); };
    window.addEventListener('resize', tune); tune();
    return s;
  },
};
