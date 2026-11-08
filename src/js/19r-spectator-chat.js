/* The room/lounge chat controls, shared by the watched player and their current spectators. */
const SpectatorChat = {
  id: null, lines: [], unread: 0, panel: null,
  context() {
    if (!Presence.ws) return null;
    if (Spectate.target) return { id: Spectate.target.id, name: Spectate.target.name, host: false };
    return Spectate.host.watchers > 0 ? { id: Presence.me, name: ProfileManager.profile.name, host: true } : null;
  },
  init() {
    Bus.on('screen:changed', () => this.refresh());
    Bus.on('presence:changed', () => this.refresh());
  },
  refresh() {
    const c = this.context();
    if (c?.id !== this.id) {
      this.close(); this.id = c?.id || null; this.lines = []; this.unread = 0;
      if (c) Presence.send({ t: 'specChatHistory', to: c.id });
    }
    if (c?.host && !this.hostButton) {
      this.hostButton = h('button.btn.spec-host-chat', { 'aria-label': 'Open spectator chat', onclick: () => this.toggle() }, icon('chat'), h('span'));
      document.body.append(this.hostButton);
    }
    if (this.hostButton) {
      this.hostButton.hidden = !c?.host || !!this.panel;
      this.hostButton.lastChild.textContent = `Spectator chat${this.unread ? ` (${this.unread})` : ''}`;
    }
    Spectate.paintMsgDot();
  },
  on(m) {
    this.refresh();
    if (!this.id || m.id !== this.id) return;
    if (m.t === 'specChatHist') {
      const all = new Map();
      for (const l of [...(m.lines || []), ...this.lines]) if (l?.from && typeof l.text === 'string') all.set(`${l.at}|${l.from.pid}|${l.text}`, l);
      this.lines = [...all.values()].sort((a, b) => a.at - b.at).slice(-100);
      if (this.panel) this.paint();
    } else if (m.line?.from && typeof m.line.text === 'string') {
      this.lines.push(m.line); this.lines = this.lines.slice(-100);
      if (this.panel) this.append(m.line);
      else if (m.line.from.pid !== Presence.pid()) this.unread++;
    }
    this.refresh();
  },
  toggle() { if (this.panel) this.close(); else this.open(); },
  open() {
    this.refresh();
    const c = this.context();
    if (!c) return;
    if (this.panel) return;
    if (Chat.o) Chat.close();
    this.unread = 0;
    this.list = h('div.mp-chat-list', { role: 'log', 'aria-live': 'polite', 'aria-label': 'Spectator messages' });
    this.input = h('input.input', { type: 'text', maxlength: 300, placeholder: 'Type a message…', 'aria-label': 'Spectator chat message', autocomplete: 'off' });
    const send = () => { const text = this.input.value.trim(); if (!text || !Presence.ws || !this.context()) return; Presence.send({ t: 'specChat', to: this.id, text }); this.input.value = ''; };
    this.input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); send(); } if (e.key === 'Escape') this.close(); });
    this.input.addEventListener('keyup', e => e.stopPropagation());
    const panel = this.panel = h('section.spectator-chat.mp-side.ov', { role: 'region', 'aria-label': 'Spectator chat' },
      h('div.spectator-chat-head', h('div', h('h3', 'Spectator chat'), h('span', c.host ? 'You and your spectators' : `${c.name} and their spectators`)),
        h('button.icon-btn', { 'aria-label': 'Close spectator chat', onclick: () => this.close() }, icon('x'))),
      h('div.mp-tabpane', this.list, h('div.spectator-chat-send', this.input, h('button.btn.sm', { onclick: send }, 'Send'))));
    // A panel, rather than a screen overlay: stays open across the player's retry without pausing their play.
    panel.addEventListener('keydown', e => e.stopPropagation());
    document.body.append(panel); this.paint(); this.refresh();
    if (!Mobile.touch) this.input.focus({ preventScroll: true });
  },
  paint() {
    if (!this.list) return;
    clearEl(this.list);
    if (!this.lines.length) this.list.append(h('div.mp-msg.sys', 'Messages here are shared with the player and their current spectators.'));
    else for (const l of this.lines) this.append(l, false);
    this.list.scrollTop = this.list.scrollHeight;
  },
  append(l, scroll = true) {
    if (!this.list) return;
    const atEnd = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 48;
    this.list.querySelector('.mp-msg.sys')?.remove();
    const line = h(`div.mp-msg${l.from.pid === Presence.pid() ? '.mine' : ''}`, h('b', l.from.name), h('span', l.text));
    line.title = new Date(l.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    this.list.append(line);
    while (this.list.children.length > 100) this.list.firstChild.remove();
    if (scroll && (atEnd || l.from.pid === Presence.pid())) this.list.scrollTop = this.list.scrollHeight;
  },
  close() { this.panel?.remove(); this.panel = null; this.list = null; this.input = null; if (this.hostButton) this.hostButton.hidden = !this.context()?.host; },
};
