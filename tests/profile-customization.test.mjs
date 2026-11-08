import test from 'node:test';
import assert from 'node:assert/strict';
import { PresenceLogic, Matchmaker, cleanProfileAppearance, cleanProfileTags } from '../worker/multiplayer.js';
import { load } from './load.mjs';

const tags = [{ name: 'Skin creator', colour: '#72e4c1' }, { name: 'Tournament winner', colour: '#ffb07c' }];
const banner = 'data:image/webp;base64,UklGRg==';

test('profile appearance validation agrees between game and server, excluding unsafe image sources', () => {
  const { ProfileAppearance, __ctx } = load(['12b-profile-appearance.js']);
  __ctx.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  for (const input of [null, {}, { style: 'aurora', banner, position: 27, bio: 'Hello' },
    { style: 'url(evil)', banner: 'data:image/svg+xml;base64,PHN2Zz4=', position: -100, bio: '\u0000<hello>\nthere' },
    { banner: 'https://tracker.example/banner.png', bio: 'x'.repeat(200), position: Infinity },
    { banner: 'data:image/png;base64,' + 'a'.repeat(48000), position: 300 }]) {
    assert.deepEqual(JSON.parse(JSON.stringify(ProfileAppearance.clean(input))), cleanProfileAppearance(input));
  }
  assert.equal(cleanProfileAppearance({ style: 'aurora', banner }).banner, banner);
  assert.equal(cleanProfileAppearance({ banner: 'javascript:alert(1)' }).banner, '');
});

test('community tags persist, are sanitized, and never confer staff access', () => {
  const p = new PresenceLogic(); const writes = {};
  p.persistMod = (kind, pid, value) => { writes[`${kind}:${pid}`] = value; };
  p.join('player', { pid: 'player123', name: 'Player', key: 'x'.repeat(32) });
  p.adminProfileTags('player123', tags);
  assert.equal(p.isStaff('player123'), false); assert.equal(p.roleOf('player123'), null);
  assert.deepEqual(p.profileMsg('player123').profileTags, tags);
  assert.deepEqual(p.adminRow('player123').profileTags, tags);
  const restored = new PresenceLogic(); restored.loadMod({ profileTags: { player123: writes['pt:player123'] } });
  assert.deepEqual(restored.profileMsg('player123').profileTags, tags);
  assert.equal(restored.isStaff('player123'), false);
  p.adminProfileTags('player123', []);
  assert.deepEqual(p.profileMsg('player123').profileTags, []); assert.equal(writes['pt:player123'], null);
  assert.deepEqual(cleanProfileTags([{ name: ' Test ', colour: 'url(evil)' }, { name: 'test', colour: '#ffffff' }, { name: '', colour: '#ffffff' }]), [{ name: 'Test', colour: '#b8a1ff' }]);
});

test('player-supplied profile data cannot forge tags, roles or admin access', () => {
  const p = new PresenceLogic(); p.join('player', { pid: 'player123', name: 'Player', key: 'x'.repeat(32) });
  p.adminProfileTags('player123', tags);
  p.message('player', { t: 'stats', profile: { name: 'Player', profileTags: [{ name: 'Owner', colour: '#ffcc22' }], role: { owner: true }, admin: true, appearance: { style: 'aurora', banner, position: 35, bio: 'Hello' } } });
  const msg = p.profileMsg('player123');
  assert.deepEqual(msg.profileTags, tags); assert.equal(msg.role, null); assert.equal(p.isStaff('player123'), false);
  assert.equal(msg.data.profileTags, undefined); assert.equal(msg.data.role, undefined); assert.equal(msg.data.admin, undefined);
  assert.equal(msg.data.appearance.banner, banner);
  p.message('player', { t: 'profileTags', pid: 'player123', tags: [] });
  assert.deepEqual(p.profileMsg('player123').profileTags, tags);
});

function adminHarness() {
  const m = Object.create(Matchmaker.prototype);
  m.presence = new PresenceLogic(); m.env = {}; m.loadFriends = async () => {}; m.send = () => {}; m.logAdmin = () => {};
  return m;
}
const request = (actor, body) => new Request('https://internal/admin/profileTags', { method: 'POST', headers: { 'x-admin-who': actor }, body: JSON.stringify(body) });

test('tag assignment API requires an owner or admin; tagged players cannot administer tags', async () => {
  const m = adminHarness();
  m.presence.adminProfileTags('player123', [{ name: 'Admin', colour: '#ffffff' }]);
  assert.equal((await m.admin('profileTags', request('player123', { pid: 'player123', tags }))).status, 401);
  assert.equal((await m.admin('profileTags', request('owner', { pid: 'player123', tags }))).status, 200);
  m.presence.adminRole('staff123', { name: 'Moderator', colour: '#ffffff' });
  assert.equal((await m.admin('profileTags', request('staff123', { pid: 'player123', tags: [] }))).status, 200);
  assert.equal(m.presence.isStaff('player123'), false);
  assert.equal((await m.admin('profileTags', request('staff123', { pid: 'player123', tags: [{ name: '', colour: '#ffffff' }] }))).status, 400);
  assert.equal((await m.admin('profileTags', request('staff123', { pid: 'player123', tags: [...tags, ...tags] }))).status, 400);
  assert.equal((await m.admin('profileTags', request('staff123', { pid: 'player123', tags: [{ name: 'X', colour: 'red' }] }))).status, 400);
});

test('older devices keep an existing profile appearance while merging scores', () => {
  const a = { appearance: cleanProfileAppearance({ style: 'midnight', banner }), top: [], recent: [] };
  const merged = PresenceLogic.mergeProfile(a, { name: 'Other device', top: [], recent: [] });
  assert.deepEqual(merged.appearance, a.appearance);
});
