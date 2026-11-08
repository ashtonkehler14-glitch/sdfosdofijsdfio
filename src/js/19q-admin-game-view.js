/* Admin game view: a player-approved game-tab video, separate from replay-based gameplay spectating.
 * Only video is shared. No keyboard events, DOM, account codes or remote-control channel are transmitted. */
const AdminGameView = {
  current: null,
  init() {
    this.handle = 'ashtonkmania-' + clientId();
    try { navigator.mediaDevices?.setCaptureHandleConfig?.({ exposeOrigin: true, handle: this.handle, permittedOrigins: [location.origin] }); } catch { /* not supported */ }
    Bus.on('presence:changed', () => { if (this.current && !Presence.ws) this.stop('The online connection closed.'); });
    Bus.on('presence:admin', () => { if (this.current && !this.current.host && !Presence.isAdmin) this.stop('Admin access ended.'); });
    window.addEventListener('pagehide', () => this.stop());
  },
  send(t, extra = {}) { const s = this.current; if (s?.session) Presence.send({ t, session: s.session, ...extra }); },
  request(u) {
    if (!Staff.on() || !Presence.ws || !u?.id || u.id === Presence.me) return;
    if (this.current) { Toast.err('Game view already open', 'Finish the current request or share first.'); return; }
    if (typeof RTCPeerConnection === 'undefined') { Toast.err('Game view unavailable', 'This browser does not support live game views.'); return; }
    const s = this.current = { host: false, name: u.name || 'Player', session: null };
    this.viewer(s);
    s.timer = setTimeout(() => { if (this.current === s) this.stop('The request timed out.'); }, 95000);
    Presence.send({ t: 'adminViewRequest', to: u.id });
  },
  viewer(s) {
    s.video = h('video.admin-view-video', { autoplay: true, muted: true, playsinline: true, 'aria-label': 'Live player game view' });
    s.status = h('span', { role: 'status', 'aria-live': 'polite' }, 'Waiting for the player to share their game tab…');
    const panel = h('div.admin-view-panel.ov', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Admin game view' },
      overlayHeader('admin game view', { icon: 'film', actions: [h('button.icon-btn', { 'aria-label': 'Close admin game view', onclick: () => this.stop() }, icon('x'))] }),
      h('div.admin-view-heading', h('b', s.name), h('span', 'Live game tab · View only')),
      h('div.admin-view-stage', s.video), h('div.admin-view-footer', s.status, h('button.btn', { onclick: () => this.stop() }, 'Stop watching')));
    s.overlay = makeOverlay(panel, { cls: 'admin-view-wrap', onClose: () => { if (this.current === s) this.stop(); } });
  },
  on(m) {
    if (m.t === 'adminViewRequest') { this.invited(m); return; }
    const s = this.current;
    if (!s && m.t === 'adminViewPending') { Presence.send({ t: 'adminViewStop', session: m.session }); return; }
    if (!s) return;
    if (m.t === 'adminViewError') { this.stop(m.msg); return; }
    if (m.t === 'adminViewPending' && !s.host && !s.session) { s.session = m.session; return; }
    if (m.session !== s.session) return;
    if (m.t === 'adminViewEnd') { this.stop(m.reason, false); return; }
    if (m.t === 'adminViewReady') {
      clearTimeout(s.timer); s.timer = setTimeout(() => { if (this.current === s) this.stop('The 30-minute game view ended.'); }, 30 * 60000);
      this.ready(s, m.iceServers).catch(() => { if (this.current === s) this.stop('The game view could not connect.'); }); return;
    }
    if (m.t === 'adminViewState' && !s.host) { s.remotePaused = m.paused; this.status(s); return; }
    if (m.t === 'adminViewSignal') {
      s.signals = (s.signals || Promise.resolve()).then(() => this.signal(s, m.signal)).catch(() => { if (this.current === s) this.stop('The game view could not connect.'); });
    }
  },
  invited(m) {
    if (this.current || !navigator.mediaDevices?.getDisplayMedia || typeof RTCPeerConnection === 'undefined') {
      Presence.send({ t: 'adminViewStop', session: m.session });
      if (!this.current) Toast.show('Game-view request', 'An admin requested a game-tab share. This browser does not support it.');
      return;
    }
    const s = this.current = { host: true, name: m.name, session: m.session };
    s.timer = setTimeout(() => { if (this.current === s) this.stop('The request timed out.'); }, 90000);
    const { o } = Dialog.popup('Admin game-view request',
      h('div', h('p', `${m.name} (${m.role}) would like to see your game tab, including menus and gameplay.`),
        h('p', 'Choose this game tab in the browser’s sharing picker. You can pause or stop sharing at any time.')),
      [{ label: 'Share game tab', cls: 'ok', onClick: () => this.share(s) }, { label: 'Decline', cls: 'cancel', cancel: true }],
      { icon: 'film', onClose: () => { if (this.current === s && !s.accepting) this.stop(); } });
    s.dialog = o;
  },
  async share(s) {
    if (this.current !== s || s.accepting) return;
    s.accepting = true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser', cursor: 'always', frameRate: { ideal: 15, max: 20 }, width: { max: 1280 }, height: { max: 720 } },
        audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude',
      });
      if (this.current !== s) { stream.getTracks().forEach(t => t.stop()); return; }
      const track = stream.getVideoTracks()[0], capture = track?.getCaptureHandle?.();
      // Never accept an entire display, another tab, or a window. The game identifies its own captured tab.
      if (!track || track.getSettings().displaySurface !== 'browser' || capture?.handle !== this.handle || capture.origin !== location.origin) {
        stream.getTracks().forEach(t => t.stop()); this.stop('Select this game tab to share it. Other tabs and windows are not shared.'); return;
      }
      s.stream = stream; s.track = track;
      track.addEventListener('ended', () => { if (this.current === s) this.stop('Screen sharing stopped.'); });
      track.addEventListener('capturehandlechange', () => {
        if (track.getCaptureHandle?.()?.handle !== this.handle && this.current === s) this.stop('The shared tab changed.');
      });
      this.sharingBar(s);
      s.observer = new MutationObserver(() => this.protect(s));
      s.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
      this.protect(s);
      this.send('adminViewAccept');
    } catch (e) {
      stream?.getTracks().forEach(t => t.stop());
      if (this.current === s) this.stop(e?.name === 'NotAllowedError' ? 'Game-tab sharing was cancelled.' : 'Game-tab sharing is unavailable in this browser.');
    }
  },
  sharingBar(s) {
    s.label = h('span', `Sharing your game with ${s.name}`);
    s.pause = h('button.btn.sm', { onclick: () => { s.paused = !s.paused; this.protect(s); } }, 'Pause sharing');
    s.bar = h('div.admin-view-sharing', { role: 'status' }, icon('film'), s.label, s.pause,
      h('button.btn.sm', { onclick: () => this.stop() }, 'Stop sharing'));
    document.body.append(s.bar);
  },
  protect(s) {
    if (this.current !== s || !s.track) return;
    const privatePanel = [...document.querySelectorAll('.login-panel, .setup-step-account, input[type=password], [data-private]')].some(el => el.getClientRects().length);
    const paused = !!s.paused || privatePanel;
    s.track.enabled = !paused;
    const label = privatePanel ? 'Sharing paused while account details are open' : paused ? 'Game sharing paused' : `Sharing your game with ${s.name}`;
    const button = s.paused ? 'Resume sharing' : 'Pause sharing';
    if (s.label.textContent !== label) s.label.textContent = label;
    if (s.pause.textContent !== button) s.pause.textContent = button;
    if (paused === s.sentPaused) return;
    s.sentPaused = paused;
    this.send('adminViewState', { paused });
  },
  async ready(s, iceServers = []) {
    if (this.current !== s || s.pc) return;
    if (s.host && !s.stream) { this.stop('The game tab was not shared.'); return; }
    const pc = s.pc = new RTCPeerConnection({ iceServers: iceServers.length ? iceServers : [{ urls: 'stun:stun.cloudflare.com:3478' }] });
    s.ice = [];
    pc.onicecandidate = e => { if (this.current === s && e.candidate) this.send('adminViewSignal', { signal: { candidate: e.candidate.toJSON() } }); };
    pc.onconnectionstatechange = () => {
      if (this.current !== s) return;
      clearTimeout(s.disconnected);
      if (pc.connectionState === 'connected') { if (!s.host) this.status(s); }
      else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.stop('The game-view connection ended.');
      else if (pc.connectionState === 'disconnected') s.disconnected = setTimeout(() => { if (this.current === s) this.stop('The game-view connection was lost.'); }, 10000);
    };
    s.connecting = setTimeout(() => { if (this.current === s && pc.connectionState !== 'connected') this.stop('Could not connect. A network may be blocking direct game views.'); }, 25000);
    if (s.host) {
      for (const track of s.stream.getVideoTracks()) pc.addTrack(track, s.stream);
      const offer = await pc.createOffer();
      if (this.current !== s) return;
      await pc.setLocalDescription(offer);
      if (this.current !== s) return;
      this.send('adminViewSignal', { signal: { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } } });
      s.sentPaused = null; this.protect(s);
    } else {
      s.status.textContent = 'Connecting to the shared game tab…';
      pc.ontrack = e => { if (this.current === s) { s.video.srcObject = e.streams[0] || new MediaStream([e.track]); s.video.play().catch(() => {}); this.status(s); } };
    }
  },
  status(s) { s.status.textContent = s.remotePaused ? 'The player paused sharing.' : 'Live · View only'; },
  async signal(s, signal) {
    if (this.current !== s || !s.pc || !signal) return;
    const pc = s.pc;
    if (signal.description) {
      await pc.setRemoteDescription(signal.description);
      if (this.current !== s) return;
      for (const c of s.ice.splice(0)) await pc.addIceCandidate(c);
      if (s.host) return;
      const answer = await pc.createAnswer();
      if (this.current !== s) return;
      await pc.setLocalDescription(answer);
      if (this.current === s) this.send('adminViewSignal', { signal: { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } } });
    } else if (signal.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate); else s.ice.push(signal.candidate);
    }
  },
  stop(reason = '', notify = true) {
    const s = this.current;
    if (!s) return;
    if (notify) this.send('adminViewStop');
    this.current = null;
    for (const t of [s.timer, s.connecting, s.disconnected]) clearTimeout(t);
    s.observer?.disconnect(); s.pc?.close(); s.stream?.getTracks().forEach(t => t.stop());
    if (s.video) { s.video.pause(); s.video.srcObject = null; }
    s.bar?.remove(); s.dialog?.close(); s.overlay?.close();
    if (reason) Toast.show('Game view ended', reason);
  },
};
