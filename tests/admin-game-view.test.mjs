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

test('no signals before player acceptance; signalling stays inside the accepted pair', () => {
  const { p, request } = setup();
  const out = request(), session = out[0].msg.session;
  assert.equal(out[1].to, 'p'); assert.equal(out[1].msg.name, 'a'); assert.equal(out[1].msg.role, 'Moderator');
  const offer = { t: 'adminViewSignal', session, signal: { description: { type: 'offer', sdp: 'v=0' } } };
  assert.deepEqual(p.message('p', offer), []);
  assert.deepEqual(p.message('a', { t: 'adminViewAccept', session }), []);
  assert.deepEqual(p.message('x', { t: 'adminViewAccept', session }), []);
  assert.equal(p.message('p', { t: 'adminViewAccept', session }).length, 2);
  assert.deepEqual(p.message('x', offer), []);
  const relayed = p.message('p', { ...offer, to: 'x' });
  assert.equal(relayed[0].to, 'a'); assert.equal(relayed[0].msg.signal.description.sdp, 'v=0');
  assert.deepEqual(p.message('a', offer), [], 'watcher cannot send an offer');
  assert.equal(p.message('a', { ...offer, signal: { description: { type: 'answer', sdp: 'v=0' } } })[0].to, 'p');
  assert.deepEqual(p.message('a', { t: 'adminViewState', session, paused: true }), []);
  assert.equal(p.message('p', { t: 'adminViewState', session, paused: true })[0].msg.paused, true);
});

test('direct admin viewing requires prior player opt-in and preserves the notification choice', () => {
  const { p, tick } = setup();
  assert.equal(p.message('a', { t: 'adminViewRequest', to: 'p', direct: true })[0].msg.t, 'adminViewError');
  assert.equal(p.adminView.sessions.size, 0);
  p.message('p', { t: 'adminViewAvailability', enabled: true });
  assert.equal(p.list().find(u => u.id === 'p').adminViewReady, true);
  for (const notify of [false, true]) {
    const out = p.message('a', { t: 'adminViewRequest', to: 'p', direct: true, notify });
    assert.equal(out.some(x => x.msg.t === 'adminViewRequest'), false, 'no repeated player request');
    const ready = out.find(x => x.to === 'p' && x.msg.t === 'adminViewReady');
    assert.equal(ready.msg.notify, notify);
    p.message('p', { t: 'adminViewAvailability', enabled: false });
    assert.equal(p.adminView.sessions.size, 0);
    tick(15001); p.message('p', { t: 'adminViewAvailability', enabled: true });
  }
});

test('ending an admin view keeps prior opt-in until the player explicitly stops sharing', () => {
  const { AdminGameView: A, __ctx } = load(['19q-admin-game-view.js']);
  let stopped = 0, closed = 0;
  __ctx.document = { querySelectorAll: () => [] }; __ctx.Presence = { send() {} };
  const s = { host: true, standby: true, session: 's', track: { enabled: true }, label: {}, pause: {}, pc: { close: () => closed++ },
    stream: { getTracks: () => [{ stop: () => stopped++ }] }, observer: { disconnect() {} }, bar: { remove() {} } };
  A.current = A.available = s; A.stop();
  assert.equal(A.current, null); assert.equal(A.available, s); assert.equal(stopped, 0); assert.equal(closed, 1);
  A.disable(); assert.equal(A.available, null); assert.equal(stopped, 1);
});

test('relay configuration is sent only to the accepted pair, and malformed entries are ignored', () => {
  const { p, request } = setup();
  p.adminView.configure(JSON.stringify([{ urls: 'turns:relay.test:5349?transport=tcp', username: 'u', credential: 'test' }, { urls: 'https://not-an-ice-server.test' }]));
  const out = request(), session = out[0].msg.session;
  assert.equal(JSON.stringify(out).includes('credential'), false);
  const ready = p.message('p', { t: 'adminViewAccept', session });
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
  tick(90001); assert.equal(p.adminView.prune().length, 2); assert.equal(p.adminView.sessions.size, 0);
  const next = open(); p.message('p', { t: 'adminViewAccept', session: next });
  tick(30 * 60000 + 1); assert.equal(p.adminView.prune().length, 2);
});

test('a cancelled viewer stops a pending request that arrives after its window closed', () => {
  const { AdminGameView: A, __ctx } = load(['19q-admin-game-view.js']);
  const sent = []; __ctx.Presence = { send: m => sent.push(m) };
  A.on({ t: 'adminViewPending', session: 'late' });
  assert.equal(sent[0].t, 'adminViewStop'); assert.equal(sent[0].session, 'late');
});

test('sharing rejects another tab or a monitor before sending acceptance', async () => {
  for (const displaySurface of ['monitor', 'browser']) {
    const { AdminGameView: A, __ctx } = load(['19q-admin-game-view.js']);
    let stopped = false; const sent = [];
    const track = { stop: () => { stopped = true; }, getSettings: () => ({ displaySurface }), getCaptureHandle: () => ({ handle: 'another-tab', origin: 'https://game.test' }) };
    __ctx.navigator = { mediaDevices: { getDisplayMedia: async () => ({ getTracks: () => [track], getVideoTracks: () => [track] }) } };
    __ctx.location = { origin: 'https://game.test' }; __ctx.Presence = { send: m => sent.push(m) }; __ctx.Toast = { show() {} };
    A.handle = 'this-game'; const s = A.current = { host: true, session: 's' };
    await A.share(s);
    assert.equal(stopped, true); assert.equal(A.current, null); assert.equal(sent.some(x => x.t === 'adminViewAccept'), false);
  }
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
