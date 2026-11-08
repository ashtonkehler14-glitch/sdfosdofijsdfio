import test from 'node:test';
import assert from 'node:assert/strict';
import { PresenceLogic } from '../worker/multiplayer.js';
import { load } from './load.mjs';

function group() {
  const p = new PresenceLogic(() => 1000);
  for (const id of ['host', 'watcher', 'second', 'outsider']) p.join(id, { name: id, pid: id + 'pid00', key: 'key-' + id + '-01234567890123' });
  p.message('watcher', { t: 'watch', to: 'host', chat: true }); p.message('second', { t: 'watch', to: 'host', chat: true });
  return p;
}

test('spectator chat is shared with the host and current watchers without requiring friendship', () => {
  const p = group();
  const out = p.message('watcher', { t: 'specChat', to: 'host', text: 'Hi!' });
  assert.deepEqual(out.map(x => x.to).sort(), ['host', 'second', 'watcher']);
  assert.equal(out[0].msg.line.from.name, 'watcher'); assert.equal(out[0].msg.id, 'host');
  const reply = p.message('host', { t: 'specChat', to: 'host', text: 'Hello spectators' });
  assert.equal(reply.length, 3);
  assert.equal(p.message('second', { t: 'specChatHistory', to: 'host' })[0].msg.lines.length, 2);
  assert.deepEqual(p.message('outsider', { t: 'specChat', to: 'host', text: 'Intrusion' }), []);
  assert.deepEqual(p.message('outsider', { t: 'specChatHistory', to: 'host' }), []);
  p.message('watcher', { t: 'unwatch', to: 'host' });
  assert.deepEqual(p.message('watcher', { t: 'specChatHistory', to: 'host' }), []);
  assert.deepEqual(p.message('watcher', { t: 'specChat', to: 'host', text: 'Left' }), []);
});

test('spectator chat applies mute, spam and word filtering rules', () => {
  const p = group(); p.chatRules.words = ['blocked']; p.chatRules.auto = false;
  assert.notEqual(p.message('watcher', { t: 'specChat', to: 'host', text: 'blocked' })[0].msg.line.text, 'blocked');
  for (let i = 0; i < 4; i++) p.message('watcher', { t: 'specChat', to: 'host', text: 'x' });
  assert.equal(p.message('watcher', { t: 'specChat', to: 'host', text: 'x' })[0].msg.t, 'error');
  p.adminMute('secondpid00', { minutes: 10, reason: 'Test' });
  assert.equal(p.message('second', { t: 'specChat', to: 'host', text: 'x' })[0].msg.t, 'error');
});

test('retry is relayed separately from quit, keeping the same spectator group and chat history', () => {
  const p = group();
  p.message('host', { t: 'play', head: { mapHash: 'abc', title: 'Song', keys: 4, mods: [], rate: 1 } });
  p.message('watcher', { t: 'specChat', to: 'host', text: 'Again!' });
  const end = p.message('host', { t: 'playEnd', quit: true, retry: true });
  assert.ok(end.every(x => x.msg.retry === true));
  p.message('host', { t: 'play', head: { mapHash: 'abc', title: 'Song', keys: 4, mods: [], rate: 1 } });
  assert.equal(p.users.get('host').watchers.size, 2);
  assert.equal(p.message('watcher', { t: 'specChatHistory', to: 'host' })[0].msg.lines[0].text, 'Again!');
});

test('a retry starts directly from the watched play instead of the song-card screen', () => {
  const { Spectate, __ctx } = load(['00-util.js', '19c-online.js']);
  const c = { head: { mapHash: 'abc' }, retrying: true }, launched = [];
  __ctx.Screens = { currentName: 'gameplay', busy: false };
  __ctx.GameplayScreen = { s: { spectate: c } };
  __ctx.BeatmapManager = { mapByHash: () => ({ id: 'local' }) };
  __ctx.Game = { launch: opts => launched.push(opts) };
  Spectate.target = { id: 'host', name: 'Host' }; Spectate.cur = c;
  Spectate.toScreen = () => assert.fail('retry must not return to the song-card screen');
  Spectate.start({ id: 'host', name: 'Host', head: { mapHash: 'abc' }, hist: true });
  assert.equal(launched.length, 1); assert.equal(launched[0].mapId, 'local'); assert.equal(launched[0].spectate, Spectate.cur); assert.equal(launched[0].quick, true);
});
