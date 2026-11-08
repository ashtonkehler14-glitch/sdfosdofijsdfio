/* Lazer-style dropdowns. Keep the real select as the form/settings source, with an accessible custom menu above it. */
const GameDropdowns = {
  current: null, sequence: 0,
  init() {
    if (this.observer) return;
    const scan = node => { if (node.nodeType !== 1) return; if (node.matches('select')) this.upgrade(node); for (const s of node.querySelectorAll('select')) this.upgrade(s); };
    scan(document.body);
    this.observer = new MutationObserver(records => {
      const changed = new Set();
      for (const r of records) {
        if (r.type === 'childList') for (const n of r.addedNodes) if (n.nodeType === 1) scan(n);
        const s = r.target.nodeType === 1 && r.target.closest('select');
        if (s?._gameDropdown) changed.add(s);
      }
      for (const s of changed) this.sync(s);
      if (this.current && (!this.current.select.isConnected || this.current.select.disabled || !this.current.anchor.getClientRects().length)) this.close(false);
    });
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['selected', 'disabled', 'label', 'value', 'class', 'style', 'aria-label', 'title', 'hidden'] });
    window.addEventListener('keydown', e => this.key(e), true);
    document.addEventListener('pointerdown', e => { if (this.current && !this.current.menu.contains(e.target) && !this.current.anchor.contains(e.target)) this.close(false); }, true);
    window.addEventListener('resize', () => this.close(false));
    document.addEventListener('scroll', e => { if (this.current && !this.current.menu.contains(e.target)) this.close(false); }, true);
    Bus.on('screen:changed', () => this.close(false));
  },
  upgrade(select) {
    if (select._gameDropdown || select.multiple || select.size > 1 || !select.parentNode) return;
    const anchor = h('div.game-select'), text = h('span.game-select-value');
    const button = h('button.game-select-trigger', { type: 'button', role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', onclick: e => {
      e.preventDefault(); if (select.disabled) return;
      if (this.current?.select === select) this.close(); else this.open(select);
    } }, text);
    select.before(anchor); anchor.append(select, button);
    select._gameDropdown = { anchor, button, text, classes: select.className };
    select.classList.add('game-select-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    select.addEventListener('change', () => this.sync(select));
    select.addEventListener('focus', () => button.focus());
    // Programmatic settings resets and collection changes retain the native select API.
    for (const prop of ['value', 'selectedIndex']) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
      if (descriptor?.get && descriptor.set) Object.defineProperty(select, prop, { configurable: true,
        get() { return descriptor.get.call(this); }, set: value => { descriptor.set.call(select, value); this.sync(select); } });
    }
    this.sync(select);
  },
  sync(select) {
    const d = select._gameDropdown;
    if (!d) return;
    const classes = [...select.classList].filter(c => c !== 'game-select-native').join(' ');
    if (d.anchor.className !== `game-select ${classes}`) d.anchor.className = `game-select ${classes}`;
    if (d.anchor.style.cssText !== select.style.cssText) d.anchor.style.cssText = select.style.cssText;
    const value = select.selectedOptions[0]?.label || 'Select…';
    if (d.text.textContent !== value) d.text.textContent = value;
    d.button.disabled = select.disabled;
    d.anchor.hidden = select.hidden;
    d.button.setAttribute('aria-label', select.getAttribute('aria-label') || select.title || select.closest('label')?.querySelector('span')?.textContent || 'Choose an option');
    d.anchor.setAttribute('aria-disabled', String(select.disabled));
    d.button.title = select.title || value;
    if (this.current?.select === select) this.render();
  },
  open(select) {
    if (select.disabled) return;
    this.close(false);
    const d = select._gameDropdown, menu = h('div.game-select-menu', { role: 'listbox', id: `game-dropdown-${++this.sequence}`, 'aria-label': d.button.getAttribute('aria-label') });
    const style = getComputedStyle(d.anchor), rect = d.anchor.getBoundingClientRect();
    for (const name of ['--ob6', '--ob5', '--ob4', '--ob3', '--oc1', '--oc2', '--ohl', '--accent', '--line']) menu.style.setProperty(name, style.getPropertyValue(name));
    menu.style.fontFamily = style.fontFamily;
    menu.style.fontSize = `${Math.max(13, Math.min(18, parseFloat(style.fontSize) * rect.height / (d.anchor.offsetHeight || rect.height)))}px`;
    this.current = { select, anchor: d.anchor, button: d.button, menu, active: select.selectedIndex, typed: '', typedAt: 0 };
    d.button.setAttribute('aria-expanded', 'true'); d.button.setAttribute('aria-controls', menu.id);
    document.body.append(menu); this.render();
    const width = Math.min(innerWidth - 16, Math.max(190, rect.width));
    const below = innerHeight - rect.bottom - 8, above = rect.top - 8, up = below < 180 && above > below;
    menu.style.width = `${width}px`; menu.style.maxHeight = `${Math.max(48, Math.min(340, up ? above : below))}px`;
    menu.style.left = `${clamp(rect.left, 8, Math.max(8, innerWidth - width - 8))}px`;
    menu.style.top = `${up ? Math.max(8, rect.top - menu.offsetHeight - 4) : rect.bottom + 4}px`;
    this.highlight(); d.button.focus({ preventScroll: true });
  },
  options() { const c = this.current; return c ? [...c.select.options].map((option, index) => ({ option, index, disabled: option.disabled || option.parentElement?.disabled || option.hidden })) : []; },
  render() {
    const c = this.current;
    if (!c) return;
    clearEl(c.menu);
    const options = this.options();
    for (const { option, index, disabled } of options) {
      if (option.hidden) continue;
      const row = h('div.game-select-option', { role: 'option', id: `${c.menu.id}-${index}`, 'data-value': option.value,
        'aria-selected': String(index === c.select.selectedIndex), 'aria-disabled': String(!!disabled),
        onpointerenter: () => { if (!disabled && this.current === c) { c.active = index; this.highlight(false); } },
        onpointerdown: e => e.preventDefault(), onclick: e => { e.stopPropagation(); if (!disabled) this.choose(index); } },
        h('span', option.label), index === c.select.selectedIndex ? icon('check') : null);
      c.menu.append(row);
    }
    if (!options.length) c.menu.append(h('div.game-select-empty', 'No options'));
    this.highlight(false);
  },
  highlight(scroll = true) {
    const c = this.current;
    if (!c) return;
    for (const row of c.menu.children) row.classList.toggle('active', row.id === `${c.menu.id}-${c.active}`);
    const row = document.getElementById(`${c.menu.id}-${c.active}`);
    if (row) { c.button.setAttribute('aria-activedescendant', row.id); if (scroll) row.scrollIntoView({ block: 'nearest' }); }
  },
  choose(index) {
    const c = this.current, item = this.options().find(x => x.index === index);
    if (!c || !item || item.disabled) return;
    const previous = c.select.value, value = item.option.value;
    this.close();
    if (previous !== value) { c.select.value = value; c.select.dispatchEvent(new Event('input', { bubbles: true })); c.select.dispatchEvent(new Event('change', { bubbles: true })); }
  },
  close(focus = true) {
    const c = this.current;
    if (!c) return;
    this.current = null; c.menu.remove(); c.button.setAttribute('aria-expanded', 'false'); c.button.removeAttribute('aria-controls'); c.button.removeAttribute('aria-activedescendant');
    if (focus && c.button.isConnected && !c.button.disabled) c.button.focus({ preventScroll: true });
  },
  key(e) {
    const focused = e.target.closest?.('.game-select')?.querySelector('select');
    if (!this.current && (!focused || !['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key))) return;
    if (e.ctrlKey || e.metaKey || e.altKey) { this.close(false); return; }
    if (!this.current) { e.preventDefault(); e.stopImmediatePropagation(); this.open(focused); return; }
    const c = this.current, enabled = this.options().filter(x => !x.disabled), at = enabled.findIndex(x => x.index === c.active);
    if (e.key === 'Tab') { this.close(false); return; }
    if (e.key === 'Escape') this.close();
    else if (e.key === 'Enter' || e.key === ' ') this.choose(c.active);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const next = enabled[clamp(at + (e.key === 'ArrowDown' ? 1 : -1), 0, enabled.length - 1)]; if (next) { c.active = next.index; this.highlight(); } }
    else if (e.key === 'Home' || e.key === 'End') { const next = e.key === 'Home' ? enabled[0] : enabled.at(-1); if (next) { c.active = next.index; this.highlight(); } }
    else if (e.key.length === 1) { const now = performance.now(); c.typed = (now - c.typedAt > 700 ? '' : c.typed) + e.key.toLowerCase(); c.typedAt = now; const next = enabled.find(x => x.option.label.toLowerCase().startsWith(c.typed)); if (next) { c.active = next.index; this.highlight(); } }
    else { this.close(false); return; }
    e.preventDefault(); e.stopImmediatePropagation();
  },
};
