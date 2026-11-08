import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveRankProof } from '../worker/beatmap-rank-proof.js';
import { Matchmaker, PresenceLogic } from '../worker/multiplayer.js';
const file = new TextEncoder().encode('osu file format v14\r\n[Metadata]\r\nBeatmapID:42\r\nBeatmapSetID:7\r\n');
const hash = createHash('sha256').update(file).digest('hex'), sum = createHash('md5').update(file).digest('hex');
const lookup = async checksum => ({ id: 42, checksum, beatmapset_id: 7, beatmapset: { status: 'ranked' } });

test('legacy validation matches exact bytes, never copied IDs, a same-name difficulty or the old ok flag', async () => {
  const good = await resolveRankProof(hash, { onlineId: 42 }, {}, { fetchImpl: async () => new Response(file), lookup });
  assert.equal(good.listed, true); assert.equal(good.checksum, sum); assert.equal(good.status, 'ranked');
  const copied = await resolveRankProof('a'.repeat(64), { onlineId: 42, ok: true }, {}, { fetchImpl: async () => new Response(file), lookup });
  assert.equal(copied.listed, false);
  const setCopy = await resolveRankProof('b'.repeat(64), { onlineSetId: 7, version: 'Hard' }, {}, {
    setInfo: async () => ({ beatmaps: [{ id: 42, version: 'Hard' }] }), fetchImpl: async () => new Response(file), lookup });
  assert.equal(setCopy.listed, false);
  assert.equal((await resolveRankProof('old-title-only', { onlineId: 42 }, {})).listed, false);
});

test('download/API outages defer cleanup, while a definitive missing difficulty fails verification', async () => {
  const busy = await resolveRankProof(hash, { onlineId: 42 }, {}, { fetchImpl: async () => new Response('', { status: 503 }) });
  assert.equal(busy, null);
  const gone = await resolveRankProof(hash, { onlineId: 42 }, {}, { fetchImpl: async () => new Response('', { status: 404 }) });
  assert.equal(gone.listed, false);
  const lookupBusy = await resolveRankProof(hash, { onlineId: 42 }, {}, { fetchImpl: async () => new Response(file), lookup: async () => { throw { status: 503 }; } });
  assert.equal(lookupBusy, null);
  const lookupMissing = await resolveRankProof(hash, { onlineId: 42 }, {}, { fetchImpl: async () => new Response(file), lookup: async () => { throw { status: 404 }; } });
  assert.equal(lookupMissing.listed, false);
});

function setup() {
  const m = Object.create(Matchmaker.prototype), data = new Map(), alarms = [];
  const storage = { get: async k => structuredClone(data.get(k)), put: async (k, v) => data.set(k, structuredClone(v)), delete: async k => data.delete(k),
    list: async ({ prefix, limit = 1000, startAfter = '' }) => new Map([...data].filter(([k]) => k.startsWith(prefix) && k > startAfter).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)),
    setAlarm: async at => alarms.push(at) };
  m.state = { storage }; m.presence = new PresenceLogic(); m.env = {}; m.loadFriends = async () => {}; m.send = () => {};
  const P = m.presence;
  P.persistRank = (pid, r) => { const { bests, ...rest } = r; data.set('rk:' + pid, structuredClone(rest)); data.set('rb:' + pid, structuredClone(bests)); };
  P.persistFirsts = (pid, firsts) => data.set('f1:' + pid, structuredClone(firsts));
  return { m, P, data, alarms };
}

test('the persisted migration cleans offline players, old ok=true scores, ranked score, bonus PP, profile totals and map first places', async () => {
  const { m, P, data, alarms } = setup(), bad = 'a'.repeat(64), good = hash;
  for (const [key, listed] of [[bad, false], [good, true]]) data.set('bm:' + key, { version: 1, listed, status: listed ? 'ranked' : 'missing', checked: Date.now() });
  const entry = (pp, score) => ({ pp, score, acc: 1, grade: 'SS', title: 'Song', version: 'Hard', ok: true });
  for (const pid of ['player001', 'player002']) {
    const bests = pid === 'player001' ? { [good]: entry(100, 700000), [bad]: entry(900, 1000000) } : { [bad]: entry(900, 1000000) };
    const rec = { pid, name: pid, bests, rk: Object.keys(bests).map(k => k.slice(0, 10)), rep: { pp: 5000, rscore: 2000000 } };
    PresenceLogic.revalue(rec); P.ranks.set(pid, rec); P.persistRank(pid, rec);
    data.set('pf:' + pid, { top: Object.entries(bests).map(([mapHash, b]) => ({ ...b, mapHash, passed: true, accuracy: 1 })) });
    P.auth.set(pid, 'key-hash');
  }
  P.firsts.set('player002', { [bad]: { pp: 900 } });
  P.boards.set(bad, [{ pid: 'player002', score: 1000000 }]); data.set('lb:' + bad, P.boards.get(bad));
  data.set('lb:' + good, [{ pid: 'player001', score: 700000 }]); data.set('lbid:42', good);
  await m.auditStoredScores();
  assert.equal(data.get('rank-file-audit-v1').phase, 'boards'); assert.ok(alarms.length);
  assert.equal(P.ranks.get('player001').rscore, 700000); assert.ok(P.ranks.get('player001').pp < 110);
  assert.equal(P.ranks.get('player001').bests[bad], undefined); assert.equal(P.ranks.get('player001').rk.length, 1);
  assert.equal(P.ranks.get('player002').pp, 0); assert.equal(P.ranks.get('player002').rscore, 0);
  assert.equal(P.rankings('player002').total, 1); assert.deepEqual(P.boards.get(bad), []);
  assert.equal(data.has('lb:' + bad), false); assert.equal(P.firsts.get('player002')[bad], undefined);
  assert.equal(data.get('rb:player001')[bad], undefined);
  await m.auditStoredScores(); assert.equal(data.get('rank-file-audit-v1'), true);
  // An older profile report cannot put the unlisted score back on the rankings.
  await m.verifyTop('player002', [{ mapHash: bad, pp: 9000, onlineId: 42, passed: true }], {}, { force: true });
  assert.equal(P.ranks.get('player002').pp, 0);
});

test('a deferred lookup preserves the existing score and does not advance the persisted cursor past that player', async () => {
  const { m, P, data, alarms } = setup(), key = 'b'.repeat(64);
  const rec = { pid: 'player001', bests: { [key]: { pp: 300, score: 1000000, title: 'Old map' } }, rep: { pp: 0 } };
  PresenceLogic.revalue(rec); P.ranks.set(rec.pid, rec); P.persistRank(rec.pid, rec); m.mapProof = async () => null;
  await m.auditStoredScores();
  assert.equal(rec.bests[key].pp, 300); assert.equal(data.has('rank-file-audit-v1'), false);
  assert.ok(alarms.at(-1) >= Date.now() + 59000);
});

test('removing an unlisted board also removes its bonus credit beyond the retained best-play list', async () => {
  const { m, P } = setup(), key = 'c'.repeat(64), good = hash;
  const rec = { pid: 'player001', bests: { [good]: { pp: 100, score: 800000, grade: 'S', acc: 1 } }, rk: [good.slice(0, 10), key.slice(0, 10)] };
  PresenceLogic.revalue(rec); P.ranks.set(rec.pid, rec); const before = rec.pp;
  await m.dropUnlistedBoard(key); assert.deepEqual(rec.rk, [good.slice(0, 10)]); assert.ok(rec.pp < before);
});
