/* Admin game view renders only this app's menus and gameplay. No browser display capture or remote control. */
const AdminGameView = {
  current: null,
  init() {
    Bus.on('presence:changed', () => { if (!Presence.ws) this.stop('The online connection closed.'); });
    Bus.on('presence:admin', () => { if (this.current && !this.current.host && !Presence.isAdmin) this.stop('Admin access ended.'); });
    window.addEventListener('pagehide', () => this.stop());
  },
  send(t, extra = {}) { const s = this.current; if (s?.session) Presence.send({ t, session: s.session, ...extra }); },
  request(u) {
    if (!Staff.on() || !Presence.ws || !u?.id || u.id === Presence.me) return;
    if (this.current) { Toast.err('Live View already open', 'Finish the current view first.'); return; }
    if (typeof RTCPeerConnection === 'undefined') { Toast.err('Live View unavailable', 'This browser does not support live game views.'); return; }
    this.start(u, false);
  },
  start(u, notify) {
    if (!Staff.on() || this.current || !Presence.ws) return;
    const s = this.current = { host: false, name: u.name || 'Player', session: null };
    this.viewer(s);
    s.timer = setTimeout(() => { if (this.current === s) this.stop('The request timed out.'); }, 95000);
    Presence.send({ t: 'adminViewRequest', to: u.id, direct: true, notify });
  },
  viewer(s) {
    s.video = h('video.admin-view-video', { autoplay: true, muted: true, playsinline: true, 'aria-label': 'Live player game view' });
    s.status = h('span', { role: 'status', 'aria-live': 'polite' }, 'Connecting to the player’s game…');
    const panel = h('div.admin-view-panel.ov', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Live View' },
      h('div.admin-view-heading', h('b', s.name), h('span', 'Live game · View only')),
      h('div.admin-view-stage', s.video), h('div.admin-view-footer', s.status, h('button.btn', { onclick: () => this.stop() }, 'Stop watching')));
    s.overlay = makeOverlay(panel, { cls: 'admin-view-wrap', backdrop: false, onClose: () => { if (this.current === s) this.stop(); } });
    document.body.append(s.overlay.el);
  },
  on(m) {
    if (m.t === 'adminViewReady' && m.host) {
      if (this.current || typeof RTCPeerConnection === 'undefined') { Presence.send({ t: 'adminViewStop', session: m.session }); return; }
      const source = this.current = { host: true, session: m.session, name: m.name || 'Admin' };
      if (m.notify) Toast.show('Live View', `${source.name} is viewing your game.`);
      this.share(source).then(() => {
        if (this.current !== source) return;
        source.timer = setTimeout(() => { if (this.current === source) this.stop('The 30-minute game view ended.'); }, 30 * 60000);
        return this.ready(source, m.iceServers);
      }).catch(e => { if (this.current === source) this.stop(e.message || 'The game view could not connect.'); });
      return;
    }
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
  PRIVATE: '.login-panel, .setup-step-account, input[type=password], [data-private]',
  privateOpen() {
    const nodes = this.current?.privateNodes || [...document.querySelectorAll(this.PRIVATE)];
    return nodes.some(el => el.isConnected !== false && el.getClientRects().length);
  },
  async share(s) {
    if (this.current !== s) return;
    s.privateNodes = null; // Until the observer is installed, privateOpen reads the live document.
    const capture = await GameViewCapture.create(s, () => this.current === s, () => this.privateOpen());
    if (!capture) return;
    if (this.current !== s) { capture.stop(); return; }
    s.capture = capture; s.stream = capture.stream; s.track = capture.track;
    try { s.track.contentHint = 'detail'; } catch { /* optional hint */ }
    this.sharingBar(s);
    s.privateNodes = [...document.querySelectorAll(this.PRIVATE)];
    s.observer = new MutationObserver(records => {
      const relevant = records.some(r => r.type === 'attributes' ? r.target.matches(this.PRIVATE) || s.privateNodes.some(el => r.target === el || r.target.contains(el)) :
        [...r.addedNodes, ...r.removedNodes].some(el => el.nodeType === 1 && (el.matches(this.PRIVATE) || el.querySelector(this.PRIVATE) || s.privateNodes.some(n => el.contains(n)))));
      if (!relevant) return;
      s.privateNodes = [...document.querySelectorAll(this.PRIVATE)]; this.protect(s);
    });
    s.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'type', 'data-private'] });
    this.protect(s);
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
    const privatePanel = this.privateOpen();
    const paused = !!s.paused || privatePanel;
    s.capture?.setPaused(paused);
    // Manual canvas tracks must stay enabled to transmit their black privacy frames.
    s.track.enabled = !paused || !!s.capture?.manual;
    const label = privatePanel ? 'Sharing paused while account details are open' : paused ? 'Game sharing paused' : `Sharing your game with ${s.name}`;
    const button = s.paused ? 'Resume sharing' : 'Pause sharing';
    if (s.label.textContent !== label) s.label.textContent = label;
    if (s.pause.textContent !== button) s.pause.textContent = button;
    if (paused === s.sentPaused) return;
    s.sentPaused = paused;
    if (this.current === s) this.send('adminViewState', { paused });
  },
  async ready(s, iceServers = []) {
    if (this.current !== s || s.pc) return;
    if (s.host && !s.stream) { this.stop('The game view could not start.'); return; }
    const pc = s.pc = new RTCPeerConnection({ iceServers: iceServers.length ? iceServers : [{ urls: 'stun:stun.cloudflare.com:3478' }] });
    s.ice = [];
    pc.onicecandidate = e => { if (this.current === s && e.candidate) this.send('adminViewSignal', { signal: { candidate: e.candidate.toJSON() } }); };
    pc.onconnectionstatechange = () => {
      if (this.current !== s) return;
      clearTimeout(s.disconnected);
      if (pc.connectionState === 'connected') {
        if (!s.host) this.status(s);
        else for (const sender of pc.getSenders()) s.capture?.setSender(sender);
      }
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
      s.status.textContent = 'Connecting to the player’s game…';
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
    s.pc?.close();
    s.observer?.disconnect(); if (s.capture) s.capture.stop(); else s.stream?.getTracks().forEach(t => t.stop());
    if (s.video) { s.video.pause(); s.video.srcObject = null; }
    s.bar?.remove(); s.dialog?.close(); s.overlay?.close();
    if (reason) Toast.show('Game view ended', reason);
  },
};
