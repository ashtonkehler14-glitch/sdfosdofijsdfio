import test from 'node:test';
import assert from 'node:assert/strict';
import { Matchmaker, PresenceLogic, codeHash } from '../worker/multiplayer.js';
import { load } from './load.mjs';

const original = 'K7QM3XRA9DPZW2HF', pid = 'player001';
function setup() {
  const m = Object.create(Matchmaker.prototype), data = new Map(); let chain = Promise.resolve();
  const storage = { get: async k => data.get(k), put: async (k, v) => data.set(k, structuredClone(v)), delete: async k => data.delete(k), list: async ({ prefix }) => new Map([...data].filter(([k]) => k.startsWith(prefix))),
    transaction(fn) { const task = chain.then(() => fn(storage)); chain = task.catch(() => {}); return task; } };
  m.state = { storage }; m.env = { ADMIN_CODE: 'BBBBBBBBBBBBBBBB' }; m.presence = new PresenceLogic();
  m.presence.join('p', { pid, key: 'player-device-key-0123456789', name: 'Player' });
  m.presence.setCode(pid, codeHash(original));
  m.presence.join('a', { pid: 'admin001', key: 'admin-device-key-0123456789', name: 'Staff' });
  m.presence.adminRole('admin001', { name: 'Moderator' });
  m.closeGone = () => {}; m.loadFriends = async () => {}; m.preloadPlayer = async () => {}; m.send = () => {};
  const request = (body, actor) => new Request('https://internal/', { method: 'POST', headers: { ...(actor ? { 'x-admin-who': actor } : {}) }, body: JSON.stringify(body) });
  return { m, data, issue: async (actor = 'owner', body = {}) => m.admin('playerCode', request({ pid, ...body }, actor)),
    link: async code => m.account('link', request({ code })) };
}

test('admin recovery codes are single-use, expire, and leave permanent codes/devices intact', async () => {
  const { m, data, issue, link } = setup();
  const before = m.presence.keyHashes(pid).slice(), { code, expires } = await (await issue('admin001')).json();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{16}$/); assert.ok(expires > Date.now() && expires <= Date.now() + 600001);
  assert.equal(JSON.stringify([...data]).includes(code), false, 'plaintext code is never persisted');
  assert.equal(JSON.stringify(m.adminLog).includes(code), false, 'audit log never contains the code');
  assert.equal(m.presence.codes.get(codeHash(original)), pid); assert.deepEqual(m.presence.keyHashes(pid), before);
  const [first, second] = await Promise.all([link(code), link(code)]);
  assert.deepEqual([first.status, second.status].sort(), [200, 401], 'concurrent redemptions cannot reuse a code');
  const d = await (first.ok ? first : second).json(); assert.equal(d.pid, pid); assert.equal(d.recovery, true);
  assert.equal(m.presence.codes.get(codeHash(original)), pid); assert.ok(m.presence.keyHashes(pid).includes(before[0]));
  assert.equal((await link(original)).status, 200, 'original player code still signs in');
});

test('replacement, explicit revocation, expiry and code rotation revoke temporary codes', async () => {
  const { m, data, issue, link } = setup();
  const first = await (await issue()).json(), next = await (await issue()).json();
  assert.equal((await link(first.code)).status, 401);
  await issue('owner', { revoke: true }); assert.equal((await link(next.code)).status, 401);
  const expired = await (await issue()).json(); data.get('rc:' + codeHash(expired.code)).exp = Date.now() - 1;
  assert.equal((await link(expired.code)).status, 401);
  const rotated = await (await issue()).json(); m.presence.setCode(pid, codeHash('AAAAAAAAAAAAAAAA'));
  assert.equal((await link(rotated.code)).status, 401);
});

test('recovery codes cannot be issued by non-admins or for staff/banned/deleted/missing accounts', async () => {
  const { m, issue } = setup();
  assert.equal((await issue('outsider1')).status, 401);
  assert.equal((await issue('owner', { pid: 'admin001' })).status, 403);
  m.presence.bans.set(pid, { until: Date.now() + 60000 }); assert.equal((await issue()).status, 400);
  m.presence.bans.delete(pid); m.presence.deleted.add(pid); assert.equal((await issue()).status, 400);
  assert.equal((await issue('owner', { pid: 'missing01' })).status, 400);
});

test('removing the issuing admin role invalidates their unredeemed code', async () => {
  const { m, issue, link } = setup(); const d = await (await issue('admin001')).json();
  m.presence.adminUnrole('admin001'); assert.equal((await link(d.code)).status, 401);
});

test('a redeemed temporary code is not saved as the player permanent code on the client', async () => {
  const { Account: A } = load(['19n-account.js']); let kept;
  A.me = () => ({}); A.linked = () => false; A.call = async () => ({ recovery: true, pid }); A.became = async (_d, code) => { kept = code; };
  await A.link(original); assert.equal(kept, '');
});

test('signing out other devices revokes unredeemed temporary sign-in codes', async () => {
  const { m, issue, link } = setup(); const d = await (await issue()).json();
  const r = await m.account('others', new Request('https://internal/', { method: 'POST', body: JSON.stringify({ pid, key: 'player-device-key-0123456789' }) }));
  assert.equal(r.status, 200); assert.equal((await link(d.code)).status, 401);
});
