// Silent moderation uses ordinary replay events and public presence, never UI capture or chat.
export class AdminSpectate {
  constructor(presence) { this.p = presence; this.sessions = new Map(); }
  viewers(player) { return [...this.sessions].filter(([, s]) => s.player === player).map(([id]) => id); }
  count(player) { return this.viewers(player).length; }
  stream(player, full = false) {
    return this.p.users.has(player) ? [{ to: player, msg: { t: 'specStream', n: this.count(player), ...(full ? { full: true } : {}) } }] : [];
  }
  end(id, reason = 'Moderation spectate ended.') {
    const s = this.sessions.get(id);
    if (!s) return [];
    this.sessions.delete(id);
    const host = this.p.users.get(s.player);
    if (host && !host.watchers.size && !this.count(s.player)) { host.hist = false; host.ev = []; }
    return [...(this.p.users.has(id) ? [{ to: id, msg: { t: 'adminSpecEnd', id: s.player, reason } }] : []), ...this.stream(s.player)];
  }
  valid(id, s) {
    return this.p.isStaff(this.p.users.get(id)?.pid) && this.p.users.has(s.player) && this.p.users.get(s.player).vis !== 'offline' && this.p.now() < s.expires;
  }
  prune() { return [...this.sessions].flatMap(([id, s]) => this.valid(id, s) ? [] : this.end(id)); }
  leave(id) { return [...this.sessions].flatMap(([viewer, s]) => viewer === id || s.player === id ? this.end(viewer, 'A player disconnected.') : []); }
  // This allowlist prevents accidental forwarding of chat, room state, HTML, images or account details.
  relay(player, msg) {
    if (!['specStart', 'specFrames', 'specEnd', 'specActivity'].includes(msg.t)) return [];
    const keys = { specStart: ['id', 'name', 'pid', 'head', 'ev', 'at', 'hist'], specFrames: ['id', 'ev', 'at', 'reset', 'last', 'act'], specEnd: ['id', 'quit', 'retry'], specActivity: ['id', 'status', 'activity'] }[msg.t];
    const replay = { t: msg.t };
    for (const key of keys) if (key in msg) replay[key] = msg[key];
    if (msg.t === 'specStart') replay.room = '';
    const out = [];
    for (const id of this.viewers(player)) {
      const s = this.sessions.get(id);
      if (!this.valid(id, s)) out.push(...this.end(id));
      else out.push({ to: id, msg: replay });
    }
    return out;
  }
  message(id, msg) {
    if (msg.t === 'adminSpecStop') return this.end(id);
    if (msg.t !== 'adminSpecWatch') return [];
    const u = this.p.users.get(id), player = String(msg.to || ''), host = this.p.users.get(player);
    const error = reason => [{ to: id, msg: { t: 'adminSpecError', id: player, reason } }];
    if (!this.p.isStaff(u?.pid)) return error('Only admins can use moderation spectate.');
    if (!host?.pid || host.vis === 'offline' || player === id || host.pid === u.pid) return error('That player is not available.');
    const previous = this.sessions.get(id);
    const out = previous && previous.player !== player ? this.end(id) : [];
    if (u.watching) out.push(...this.p.unwatch(id, u.watching));
    const first = !host.watchers.size && !this.count(player);
    this.sessions.set(id, { player, expires: this.p.now() + 30 * 60000 });
    out.push({ to: id, msg: host.play
      ? { t: 'specStart', id: player, name: host.name, pid: host.pid, room: '', head: host.play, ev: host.hist ? host.ev : [], at: host.t, hist: host.hist }
      : { t: 'specWait', id: player, name: host.name, pid: host.pid, room: '', status: host.status, activity: host.activity || '' } });
    out.push(...this.stream(player, !!host.play && (first || !host.hist)));
    return out;
  }
}
