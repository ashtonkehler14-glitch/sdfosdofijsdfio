// Ephemeral signalling for an authenticated admin’s read-only game view. Video never passes through this service.
export class AdminGameView {
  constructor(presence) { this.p = presence; this.sessions = new Map(); this.asked = new Map(); this.iceServers = []; }
  configure(value) {
    try {
      const list = JSON.parse(value || '[]');
      this.iceServers = Array.isArray(list) ? list.slice(0, 4).flatMap(s => {
        const urls = (Array.isArray(s?.urls) ? s.urls : [s?.urls]).filter(u => typeof u === 'string' && u.length <= 512 && /^(stun|stuns|turn|turns):[^\s]+$/i.test(u)).slice(0, 4);
        return urls.length ? [{ urls, ...(typeof s.username === 'string' ? { username: s.username.slice(0, 256) } : {}), ...(typeof s.credential === 'string' ? { credential: s.credential.slice(0, 512) } : {}) }] : [];
      }) : [];
    } catch { this.iceServers = []; }
  }
  end(session, reason = 'Sharing stopped.') {
    const s = this.sessions.get(session);
    if (!s) return [];
    this.sessions.delete(session);
    return [s.admin, s.player].filter(id => this.p.users.has(id)).map(to => ({ to, msg: { t: 'adminViewEnd', session, reason } }));
  }
  leave(id) { return [...this.sessions].flatMap(([key, s]) => s.admin === id || s.player === id ? this.end(key, 'A player disconnected.') : []); }
  prune() {
    const now = this.p.now(), out = [];
    for (const [key, s] of this.sessions) if (now >= s.expires || !this.p.isStaff(this.p.users.get(s.admin)?.pid)) out.push(...this.end(key, 'The game-view session ended.'));
    for (const [id, at] of this.asked) if (now - at > 60000) this.asked.delete(id);
    return out;
  }
  message(id, m) {
    const u = this.p.users.get(id), now = this.p.now();
    const error = msg => [{ to: id, msg: { t: 'adminViewError', msg } }];
    if (!u) return [];
    if (m.t === 'adminViewRequest') {
      if (!this.p.isStaff(u.pid)) return error('Only admins can request a game view.');
      const player = this.p.users.get(m.to);
      if (!player?.pid || player.vis === 'offline' || m.to === id || player.pid === u.pid) return error('That player is not available.');
      if (this.asked.has(id) && now - this.asked.get(id) < 3000) return error('Please wait before starting another game view.');
      if ([...this.sessions.values()].some(s => [s.admin, s.player].includes(id) || [s.admin, s.player].includes(m.to))) return error('A game-view request or share is already open.');
      const session = crypto.randomUUID();
      this.sessions.set(session, { admin: id, player: m.to, accepted: false, expires: now + 90000, count: 0, window: now });
      this.asked.set(id, now);
      const s = this.sessions.get(session); s.accepted = true; s.expires = now + 30 * 60000;
      return [{ to: id, msg: { t: 'adminViewPending', session, name: player.name } },
        { to: id, msg: { t: 'adminViewReady', session, host: false, iceServers: this.iceServers } },
        { to: m.to, msg: { t: 'adminViewReady', session, host: true, name: u.name, notify: m.notify === true, iceServers: this.iceServers } }];
    }
    const s = this.sessions.get(m.session);
    if (!s || id !== s.admin && id !== s.player) return [];
    if (now >= s.expires || !this.p.isStaff(this.p.users.get(s.admin)?.pid)) return this.end(m.session, 'The game-view session ended.');
    if (m.t === 'adminViewStop') return this.end(m.session, s.accepted ? 'Sharing stopped.' : 'The request was declined or cancelled.');
    if (!s.accepted) return [];
    const to = id === s.admin ? s.player : s.admin;
    if (m.t === 'adminViewState' && id === s.player) return [{ to, msg: { t: 'adminViewState', session: m.session, paused: m.paused === true } }];
    if (m.t !== 'adminViewSignal') return [];
    if (now - s.window > 60000) { s.window = now; s.count = 0; }
    if (++s.count > 180) return this.end(m.session, 'Too many connection messages.');
    let signal;
    if (m.signal?.description) {
      const d = m.signal.description, expected = id === s.player ? 'offer' : 'answer';
      if (d.type !== expected || typeof d.sdp !== 'string' || d.sdp.length > 48000) return [];
      signal = { description: { type: d.type, sdp: d.sdp } };
    } else if (m.signal?.candidate && typeof m.signal.candidate === 'object') {
      const c = m.signal.candidate;
      if (typeof c.candidate !== 'string' || c.candidate.length > 3000 || (c.sdpMid != null && (typeof c.sdpMid !== 'string' || c.sdpMid.length > 64)) || (c.sdpMLineIndex != null && (!Number.isInteger(c.sdpMLineIndex) || c.sdpMLineIndex < 0 || c.sdpMLineIndex > 64))) return [];
      signal = { candidate: { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null } };
    } else return [];
    return [{ to, msg: { t: 'adminViewSignal', session: m.session, signal } }];
  }
}
