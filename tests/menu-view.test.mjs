import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

function source() {
  const { MenuView, __ctx: c } = load(['19qb-menu-view.js']);
  let tick, privateOpen = false;
  const packets = [], flags = [];
  const element = (tag = 'DIV', children = [], privateNode = false) => ({ nodeType: 1, localName: tag.toLowerCase(), tagName: tag, attributes: [], childNodes: children, isConnected: true, scrollLeft: 0, scrollTop: 0, matches: selector => privateNode && selector.includes('[data-private]'), closest: () => null, contains: n => children.includes(n) });
  const body = element('BODY');
  c.document = { body, documentElement: element('HTML'), addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [] };
  c.window = { addEventListener() {}, removeEventListener() {} }; c.location = { href: 'http://localhost/' }; c.innerWidth = 1440; c.innerHeight = 960;
  c.MutationObserver = class { observe() {} disconnect() {} };
  c.Bus = { on: () => () => {} }; c.Screens = { currentName: 'home' }; c.GameplayScreen = {};
  c.setInterval = fn => { tick = fn; return 1; }; c.clearInterval = () => {};
  const channel = { readyState: 'open', bufferedAmount: 0, send: raw => { const p = JSON.parse(raw); if (p.n === 1) packets.push(JSON.parse(p.d)); }, close() {} };
  const owner = { host: true, capture: { setSuspended: x => flags.push(x) } };
  const m = MenuView.open(owner, channel, () => true, () => privateOpen);
  let key = 100;
  const receive = value => channel.onmessage({ data: JSON.stringify({ k: key++, i: 0, n: 1, d: JSON.stringify(value) }) });
  return { MenuView, c, m, body, element, channel, packets, flags, receive, tick: async () => { tick(); await new Promise(r => setTimeout(r, 10)); }, privacy: x => { privateOpen = x; m.setPaused(x); } };
}

test('menu streaming suspends screenshots in menus and resumes video for running gameplay', async () => {
  const s = source();
  try {
    s.receive({ t: 'ready' }); await s.tick();
    assert.equal(s.flags.at(-1), true);
    assert.ok(s.packets.some(p => p.t === 'snapshot' && p.w === 1440));
    s.c.Screens.currentName = 'gameplay'; s.c.GameplayScreen.s = { running: true }; await s.tick();
    assert.equal(s.flags.at(-1), false);
    assert.ok(s.packets.some(p => p.t === 'mode' && p.active === false));
    s.c.SkinEditor = { on: true }; await s.tick(); assert.equal(s.flags.at(-1), true, 'The skin editor shares its live controls, not only the preview playfield');
    s.c.SkinEditor.on = false; s.c.Overlays = { top: () => ({}) }; await s.tick(); assert.equal(s.flags.at(-1), true, 'Gameplay dialogs use the lightweight menu path');
  } finally { s.m.stop(); }
});

test('private panels pause menu serialization and do not enter the transmitted tree', async () => {
  const s = source();
  try {
    const secret = { nodeType: 3, nodeValue: 'PRIVATE CODE', isConnected: true };
    s.body.childNodes.push(s.element('DIV', [secret], true));
    s.receive({ t: 'ready' }); await s.tick();
    assert.ok(!JSON.stringify(s.packets).includes('PRIVATE CODE'));
    s.privacy(true); const before = s.packets.filter(p => p.t === 'snapshot').length; await s.tick();
    assert.equal(s.packets.filter(p => p.t === 'snapshot').length, before);
    assert.equal(s.packets.at(-1).blocked, true);
    s.privacy(false); await s.tick();
    assert.ok(s.packets.filter(p => p.t === 'snapshot').length > before);
  } finally { s.m.stop(); }
});

test('the source accepts readiness acknowledgments, not remote clicks, keys or navigation', async () => {
  const s = source();
  try {
    for (const t of ['click', 'keydown', 'navigate', 'input', 'eval']) s.receive({ t, value: 'anything' });
    assert.equal(s.m.ready, undefined); assert.equal(s.packets.length, 0);
    s.receive({ t: 'ready' }); await s.tick(); assert.equal(s.m.ready, true);
  } finally { s.m.stop(); }
});

test('oversized or malformed menu fragments are discarded without allocating unbounded messages', () => {
  const s = source();
  try {
    for (const data of ['bad json', JSON.stringify({ k: 1, i: 0, n: 100000, d: 'x' }), JSON.stringify({ k: 1, i: 0, n: 1, d: 'x'.repeat(9000) })]) s.channel.onmessage({ data });
    assert.equal(s.m.parts.size, 0);
  } finally { s.m.stop(); }
});

test('remote menu markup cannot introduce scripts, frames, HTML injection containers or URL CSS escapes', () => {
  const { MenuView } = load(['19qb-menu-view.js']);
  for (const tag of ['script', 'iframe', 'object', 'embed', 'foreignobject', 'link', 'meta', 'style']) assert.equal(MenuView.tags.has(tag), false);
  assert.equal(MenuView.attr('onclick'), false); assert.equal(MenuView.attr('onerror'), false); assert.equal(MenuView.attr('srcdoc'), false);
  assert.equal(MenuView.css('background: u\\72l(https://example.invalid)', () => 'blocked'), '');
  assert.equal(MenuView.css('background:url(https://example.invalid)', () => 'mv:1'), 'background:url("mv:1")');
  assert.ok(!MenuView.css('@import "evil"; color:white', () => '').includes('@import'));
});
