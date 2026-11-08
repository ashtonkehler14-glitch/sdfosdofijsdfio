import test from 'node:test';
import assert from 'node:assert/strict';
import { PresenceLogic } from '../worker/multiplayer.js';
import { load } from './load.mjs';

function setup() {
  let time = 1000;
  const p = new PresenceLogic(() => time);
  for (const [id, pid] of [['a', 'adminpid1'], ['p', 'player001'], ['x', 'outsider1']]) p.join(id, { name: id, pid, key: 'key-' + pid + '-0123456789' });
  p.adminRole('adminpid1', { name: 'Moderator' });
  const request = () => p.message('a', { t: 'adminViewRequest', to: 'p' });
  const open = () => request().find(x => x.msg.t === 'adminViewPending').msg.session;
  return { p, request, open, tick: ms => { time += ms; } };
}

test('admin game view requires a server-authenticated admin; badges and forged identity give no access', () => {
  const { p } = setup();
  p.adminProfileTags('outsider1', [{ name: 'Admin', colour: '#ffffff' }]);
  assert.equal(p.message('x', { t: 'adminViewRequest', to: 'p', admin: true })[0].msg.t, 'adminViewError');
  p.join('forged', { name: 'Pretend admin', pid: 'adminpid1', key: 'wrong-key-0123456789' });
  assert.equal(p.message('forged', { t: 'adminViewRequest', to: 'p' })[0].msg.t, 'adminViewError');
  assert.equal(p.adminView.sessions.size, 0);
});

test('an admin joins directly without a player enable step; signals stay inside that authenticated pair', () => {
  const { p, request } = setup(), out = request(), session = out[0].msg.session;
  assert.equal(out.some(x => x.msg.t === 'adminViewRequest'), false);
  assert.equal(out.find(x => x.to === 'p' && x.msg.t === 'adminViewReady').msg.name, 'a');
  const offer = { t: 'adminViewSignal', session, signal: { description: { type: 'offer', sdp: 'v=0' } } };
  assert.deepEqual(p.message('x', offer), []);
  const relayed = p.message('p', { ...offer, to: 'x' });
  assert.equal(relayed[0].to, 'a');
  assert.deepEqual(p.message('a', offer), [], 'watcher cannot send an offer');
  assert.equal(p.message('a', { ...offer, signal: { description: { type: 'answer', sdp: 'v=0' } } })[0].to, 'p');
  assert.deepEqual(p.message('a', { t: 'adminViewState', session, paused: true }), []);
  assert.equal(p.message('p', { t: 'adminViewState', session, paused: true })[0].msg.paused, true);
});

test('direct viewing preserves the notification choice and never waits for player activation', () => {
  const { p, tick } = setup();
  for (const notify of [false, true]) {
    const out = p.message('a', { t: 'adminViewRequest', to: 'p', direct: true, notify });
    assert.equal(out.some(x => x.msg.t === 'adminViewRequest'), false);
    const ready = out.find(x => x.to === 'p' && x.msg.t === 'adminViewReady');
    assert.equal(ready.msg.notify, notify);
    p.message('p', { t: 'adminViewStop', session: ready.msg.session });
    assert.equal(p.adminView.sessions.size, 0); tick(3001);
  }
});

test('ending an admin view stops its app capture and removes the sharing indicator', () => {
  const { AdminGameView: A, __ctx } = load(['19q-admin-game-view.js']);
  let stopped = 0, closed = 0, removed = 0; __ctx.Presence = { send() {} };
  const s = { host: true, session: 's', capture: { stop: () => stopped++ }, pc: { close: () => closed++ },
    observer: { disconnect() {} }, bar: { remove: () => removed++ } };
  A.current = s; A.stop();
  assert.equal(A.current, null); assert.equal(stopped, 1); assert.equal(closed, 1); assert.equal(removed, 1);
});

test('relay configuration is sent only to the authenticated pair, and malformed entries are ignored', () => {
  const { p, request } = setup();
  p.adminView.configure(JSON.stringify([{ urls: 'turns:relay.test:5349?transport=tcp', username: 'u', credential: 'test' }, { urls: 'https://not-an-ice-server.test' }]));
  const ready = request().filter(x => x.msg.t === 'adminViewReady');
  assert.deepEqual(ready.map(x => x.to).sort(), ['a', 'p']);
  assert.equal(ready[0].msg.iceServers.length, 1); assert.equal(ready[0].msg.iceServers[0].username, 'u');
  p.adminView.configure('not json'); assert.equal(p.adminView.iceServers.length, 0);
});

test('oversized or malformed signals are rejected and high-rate signalling closes the session', () => {
  const { p, open } = setup(), session = open();
  p.message('p', { t: 'adminViewAccept', session });
  assert.deepEqual(p.message('p', { t: 'adminViewSignal', session, signal: { description: { type: 'offer', sdp: 'x'.repeat(48001) } } }), []);
  assert.deepEqual(p.message('p', { t: 'adminViewSignal', session, signal: { candidate: { candidate: 'x', sdpMLineIndex: -1 } } }), []);
  assert.deepEqual(p.message('p', { t: 'adminViewSignal', session, signal: { arbitrary: 'script' } }), []);
  for (let i = 0; i < 180; i++) p.message('p', { t: 'adminViewSignal', session, signal: { candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 } } });
  assert.equal(p.adminView.sessions.size, 0);
});

for (const how of ['stop', 'disconnect', 'offline', 'demote']) test(`game view tears down on ${how}`, () => {
  const { p, open } = setup(), session = open();
  p.message('p', { t: 'adminViewAccept', session });
  const out = how === 'stop' ? p.message('p', { t: 'adminViewStop', session }) : how === 'disconnect' ? p.leave('p') : how === 'offline' ? p.message('a', { t: 'vis', v: 'offline' }) : p.adminUnrole('adminpid1');
  assert.equal(p.adminView.sessions.size, 0);
  assert.ok(out.some(x => x.to === 'a' && x.msg.t === 'adminViewEnd'));
  assert.ok(out.some(x => x.to === 'p' && x.msg.t === 'adminViewEnd'));
});

test('requests expire and share slots/rate limits prevent repeated or overlapping requests', () => {
  const { p, open, request, tick } = setup(), session = open();
  assert.equal(request()[0].msg.t, 'adminViewError');
  assert.deepEqual(p.message('x', { t: 'adminViewStop', session }), []);
  tick(30 * 60000 + 1); assert.equal(p.adminView.prune().length, 2); assert.equal(p.adminView.sessions.size, 0);
  const next = open(); p.message('p', { t: 'adminViewAccept', session: next });
  tick(30 * 60000 + 1); assert.equal(p.adminView.prune().length, 2);
});

test('a cancelled viewer stops a pending request that arrives after its window closed', () => {
  const { AdminGameView: A, __ctx } = load(['19q-admin-game-view.js']);
  const sent = []; __ctx.Presence = { send: m => sent.push(m) };
  A.on({ t: 'adminViewPending', session: 'late' });
  assert.equal(sent[0].t, 'adminViewStop'); assert.equal(sent[0].session, 'late');
});

test('the source uses app rendering without requesting browser screen/tab access', async () => {
  const { AdminGameView: A, __ctx } = load(['19q-admin-game-view.js']);
  let created = 0;
  const capture = { stream: {}, track: { enabled: true }, setPaused() {}, stop() {} };
  __ctx.GameViewCapture = { create: async () => { created++; return capture; } };
  __ctx.navigator = { mediaDevices: { getDisplayMedia: () => assert.fail('No tab-sharing prompt may be used') } };
  __ctx.document = { body: {}, querySelectorAll: () => [] }; __ctx.Presence = { send() {} };
  __ctx.MutationObserver = class { observe() {} };
  A.sharingBar = s => { s.label = {}; s.pause = {}; };
  const s = A.current = { host: true, session: 's', name: 'Admin' };
  await A.share(s); assert.equal(created, 1); assert.equal(s.capture, capture); assert.equal(s.stream, capture.stream);
});

test('account details pause the video track, and manual pause stays set when the panel closes', () => {
  const { AdminGameView: A, __ctx } = load(['19q-admin-game-view.js']);
  let privatePanel = false;
  __ctx.document = { querySelectorAll: () => privatePanel ? [{ getClientRects: () => [1] }] : [] };
  __ctx.Presence = { send() {} };
  const s = A.current = { session: 's', track: { enabled: true }, label: {}, pause: {}, name: 'Admin' };
  privatePanel = true; A.protect(s); assert.equal(s.track.enabled, false);
  privatePanel = false; A.protect(s); assert.equal(s.track.enabled, true);
  s.paused = true; privatePanel = true; A.protect(s);
  privatePanel = false; A.protect(s); assert.equal(s.track.enabled, false);
  s.paused = false; A.protect(s); assert.equal(s.track.enabled, true);
});
