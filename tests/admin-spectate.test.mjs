import test from 'node:test';
import assert from 'node:assert/strict';
import { PresenceLogic } from '../worker/multiplayer.js';
import { load } from './load.mjs';

const head = { mapHash: 'abc', title: 'Song', keys: 4, mods: [], rate: 1, html: 'PRIVATE', password: 'PRIVATE' };
function setup() {
  let time = 1000;
  const p = new PresenceLogic(() => time);
  for (const [id, pid] of [['a', 'adminpid1'], ['b', 'adminpid2'], ['p', 'player001'], ['x', 'outsider1']]) p.join(id, { name: id, pid, key: 'key-' + pid + '-0123456789' });
  p.adminRole('adminpid1', { name: 'Moderator' }); p.adminRole('adminpid2', { name: 'Moderator' });
  const watch = (who = 'a') => p.message(who, { t: 'adminSpecWatch', to: 'p' });
  return { p, watch, tick: ms => { time += ms; } };
}

test('silent gameplay requires a server-authenticated admin; a badge, forged key or client flag grants nothing', () => {
  const { p, watch } = setup();
  p.adminProfileTags('outsider1', [{ name: 'Admin', colour: '#ffffff' }]);
  assert.equal(watch('x')[0].msg.t, 'adminSpecError');
  p.join('forged', { name: 'Fake', pid: 'adminpid1', key: 'wrong-key-0123456789' });
  assert.equal(watch('forged')[0].msg.t, 'adminSpecError');
  assert.equal(p.adminSpectate.sessions.size, 0);
  const ordinary = p.message('x', { t: 'watch', to: 'p', silent: true, admin: true });
  assert.ok(ordinary.some(x => x.to === 'p' && x.msg.t === 'spectators' && x.msg.names.includes('x')));
});

test('silent gameplay does not enter public spectator counts, names, chat or screen-capture sessions', () => {
  const { p, watch } = setup();
  p.message('p', { t: 'status', status: 'menu', activity: 'songselect' });
  const out = watch();
  assert.equal(out.find(x => x.to === 'a').msg.activity, 'songselect');
  assert.deepEqual(out.filter(x => x.to === 'p'), [{ to: 'p', msg: { t: 'specStream', n: 1 } }]);
  assert.equal(p.list().find(x => x.id === 'p').watchers, 0);
  assert.deepEqual(p.watcherNames(p.users.get('p')), []);
  assert.equal(p.users.get('a').watching, null);
  assert.equal(p.adminView.sessions.size, 0);
  assert.deepEqual(p.message('a', { t: 'specChatHistory', to: 'p' }), []);
  assert.deepEqual(p.message('a', { t: 'specChat', to: 'p', text: 'No access' }), []);
});

test('silent gameplay receives sanitized replay data and public activity, never a Ranked Play room view', () => {
  const { p, watch } = setup();
  p.users.get('p').rp = 'ABCD23';
  const wait = watch().find(x => x.to === 'a').msg;
  assert.equal(wait.room, '');
  const start = p.message('p', { t: 'play', head }).find(x => x.to === 'a').msg;
  assert.equal(start.room, ''); assert.equal(start.head.html, undefined); assert.equal(start.head.password, undefined);
  const frames = p.message('p', { t: 'frames', ev: [100, 0, 1], at: 200, html: 'PRIVATE', act: { k: 'pause', t: 100, secret: 'PRIVATE' } });
  assert.deepEqual(frames, [{ to: 'a', msg: { t: 'specFrames', id: 'p', ev: [100, 0, 1], at: 200, reset: false, last: false, act: { k: 'pause', t: 100 } } }]);
  assert.equal(p.message('p', { t: 'playEnd', retry: true })[0].msg.retry, true);
  const status = p.message('p', { t: 'status', status: 'menu', activity: 'explore', rp: 'ABCD24', password: 'PRIVATE' });
  assert.equal(status.find(x => x.to === 'a').msg.activity, 'explore');
  assert.ok(!status.some(x => x.to === 'a' && x.msg.t === 'specRoom'));
});

test('silent relay rejects chat, room state, interface capture and extra fields', () => {
  const { p, watch } = setup(); watch();
  for (const t of ['specChat', 'specChatHist', 'specRoom', 'adminViewSignal', 'privatePanel', 'html']) assert.deepEqual(p.adminSpectate.relay('p', { t, secret: 'PRIVATE' }), []);
  assert.deepEqual(p.adminSpectate.relay('p', { t: 'specActivity', id: 'p', status: 'menu', activity: 'home', html: 'PRIVATE' }), [{ to: 'a', msg: { t: 'specActivity', id: 'p', status: 'menu', activity: 'home' } }]);
});

test('late joining silent gameplay requests replay history once and shares it with regular watchers', () => {
  const { p, watch } = setup();
  p.message('p', { t: 'play', head });
  assert.equal(watch().find(x => x.to === 'p').msg.full, true);
  p.message('p', { t: 'frames', ev: [100, 0, 1], at: 300, reset: true, last: true });
  const second = watch('b');
  assert.deepEqual(second.find(x => x.to === 'b').msg.ev, [100, 0, 1]);
  assert.equal(second.find(x => x.to === 'p').msg.full, undefined);
  p.message('x', { t: 'watch', to: 'p' });
  const leave = p.message('x', { t: 'unwatch', to: 'p' });
  assert.equal(leave[0].msg.n, 0); assert.equal(p.users.get('p').hist, true);
  assert.deepEqual(p.users.get('p').ev, [100, 0, 1], 'regular watchers leaving do not discard a moderation replay');
  assert.deepEqual(p.message('p', { t: 'frames', ev: [], at: 400 }).map(x => x.to).sort(), ['a', 'b']);
  p.message('a', { t: 'adminSpecStop' });
  assert.equal(p.users.get('p').hist, true);
  p.message('b', { t: 'adminSpecStop' });
  assert.equal(p.users.get('p').hist, false); assert.deepEqual(p.users.get('p').ev, []);
});

test('switching normal and silent spectating removes the previous subscription without duplicating frames', () => {
  const { p, watch } = setup();
  p.message('a', { t: 'watch', to: 'p', chat: true });
  const silent = watch();
  assert.ok(silent.some(x => x.to === 'p' && x.msg.t === 'spectators' && x.msg.n === 0));
  assert.equal(p.users.get('a').watching, null);
  p.message('a', { t: 'watch', to: 'p' });
  assert.equal(p.adminSpectate.sessions.size, 0); assert.equal(p.users.get('a').watching, 'p');
  assert.deepEqual(p.message('p', { t: 'play', head }).map(x => x.to), ['a']);
});

for (const how of ['stop', 'admin disconnect', 'player disconnect', 'offline', 'demote', 'expire']) test(`silent gameplay ends on ${how} and stops sending replay events`, () => {
  const { p, watch, tick } = setup(); watch();
  const out = how === 'stop' ? p.message('a', { t: 'adminSpecStop' }) : how === 'admin disconnect' ? p.leave('a') : how === 'player disconnect' ? p.leave('p') : how === 'offline' ? p.message('p', { t: 'vis', v: 'offline' }) : how === 'demote' ? p.adminUnrole('adminpid1') : (tick(30 * 60000), p.adminSpectate.prune());
  assert.equal(p.adminSpectate.sessions.size, 0);
  assert.ok(out.some(x => x.to === 'a' && x.msg.t === 'adminSpecEnd'));
  assert.ok(!p.adminSpectate.relay('p', { t: 'specFrames', id: 'p', ev: [], at: 999 }).some(x => x.to === 'a'));
});

test('admin access is checked again at each replay transmission, even before the next prune', () => {
  const { p, watch } = setup(); watch(); p.roles.delete('adminpid1');
  const out = p.message('p', { t: 'play', head });
  assert.ok(out.some(x => x.to === 'a' && x.msg.t === 'adminSpecEnd'));
  assert.ok(!out.some(x => x.to === 'a' && x.msg.t === 'specStart'));
});

test('regular spectator chat never broadcasts to a silent moderator', () => {
  const { p, watch } = setup(); watch(); p.message('x', { t: 'watch', to: 'p' });
  assert.deepEqual(p.message('x', { t: 'specChat', to: 'p', text: 'Hello' }).map(x => x.to).sort(), ['p', 'x']);
});

test('source replay transport stays separate from spectator toasts and chat', () => {
  const { Spectate, __ctx } = load(['00-util.js', '19c-online.js']);
  __ctx.GameplayScreen = {};
  __ctx.SpectatorChat = { refresh: () => assert.fail('silent transport must not show chat') };
  Spectate.paintWatchers = () => assert.fail('silent transport must not create viewer names or toasts');
  Spectate.on({ t: 'specStream', n: 2 });
  assert.equal(Spectate.host.moderators, 2); assert.equal(Spectate.host.watchers, 0);
});

test('Admin Spectate defaults directly to replay rendering, without dialogs, WebRTC or interface capture', () => {
  const { AdminGameView, __ctx } = load(['00-util.js', '19q-admin-game-view.js']);
  const watched = [];
  __ctx.Staff = { on: () => true }; __ctx.Presence = { ws: {}, me: 'admin' };
  __ctx.Spectate = { watch: (...args) => watched.push(args) };
  __ctx.Dialog = { popup: () => assert.fail('The optimized main path must not wait for a dialog') };
  __ctx.GameViewCapture = { create: () => assert.fail('The optimized main path must not capture UI') };
  AdminGameView.request({ id: 'player', name: 'Player' });
  assert.equal(watched.length, 1); assert.equal(watched[0][0].id, 'player'); assert.equal(watched[0][1].silent, true);
  assert.equal(AdminGameView.current, null);
});

test('starting an interface view stops the native replay subscription so the player does not run both paths', () => {
  const { AdminGameView, __ctx } = load(['00-util.js', '19q-admin-game-view.js']), stopped = [], sent = [];
  __ctx.Staff = { on: () => true }; __ctx.Presence = { ws: {}, send: m => sent.push(m) };
  __ctx.Spectate = { target: { silent: true }, toScreen: () => stopped.push('screen'), stop: () => stopped.push('stop') };
  __ctx.setTimeout = () => 0; AdminGameView.viewer = () => {};
  AdminGameView.start({ id: 'player', name: 'Player' }, false);
  assert.deepEqual(stopped, ['screen', 'stop']); assert.equal(sent[0].t, 'adminViewRequest');
});
