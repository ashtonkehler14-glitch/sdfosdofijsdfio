import test from 'node:test';
import assert from 'node:assert/strict';
import { rankedOnly, Matchmaker, PresenceLogic } from '../worker/multiplayer.js';
import { lookupExactBeatmap, handleLookupBeatmap, osuApi, resetOsuLogin } from '../worker/index.js';
import { load } from './load.mjs';

const sum = 'a'.repeat(32), result = { pp: 321, score: 987654, beatmapSetId: 42, beatmapId: 123 };
test('a ranked set ID cannot rank an unlisted or edited difficulty, including zero-PP scores', async () => {
  const missing = async () => { throw Object.assign(new Error('Not found'), { status: 404 }); };
  for (const pp of [0, 321]) {
    const r = await rankedOnly({ ...result, pp }, sum, {}, missing);
    assert.equal(r.pp, 0); assert.equal(r.unlisted, true); assert.equal(r.rankStatus, 'missing');
  }
  const changed = await rankedOnly(result, sum, {}, async () => ({ id: 123, checksum: 'b'.repeat(32), beatmapset: { status: 'ranked' } }));
  assert.equal(changed.unlisted, true); assert.equal(changed.pp, 0);
});

test('only exact online ranked/approved difficulties keep ranked PP; lookup failures remain retryable', async () => {
  for (const status of ['ranked', 'approved', 'loved', 'pending', 'qualified', 'graveyard']) {
    const r = await rankedOnly(result, sum, {}, async checksum => { assert.equal(checksum, sum); return { id: 77, checksum, beatmapset_id: 9, beatmapset: { status } }; });
    assert.equal(r.pp, ['ranked', 'approved'].includes(status) ? 321 : 0); assert.equal(r.beatmapId, 77); assert.equal(r.beatmapSetId, 9); assert.equal(r.rankStatus, status);
  }
  const r = await rankedOnly(result, sum, {}, async () => { throw Object.assign(new Error('Busy'), { status: 503 }); });
  assert.equal(r.rankingUnavailable, true); assert.equal(r.pp, 0); assert.equal(r.unlisted, undefined);
});

test('unlisted submissions and catch-up batches cannot create leaderboard/ranking entries', async () => {
  const m = Object.create(Matchmaker.prototype); m.presence = new PresenceLogic();
  m.presence.join('s', { name: 'Player', pid: 'player001', key: 'key-player001-0123456789' });
  m.loadFriends = async () => {}; m.ensureBests = async () => {}; m.send = () => {};
  m.state = { storage: { get: async () => assert.fail('unlisted maps must not load leaderboards'), put: async key => assert.ok(key.startsWith('bm:'), 'only the map identity proof is stored') } };
  const base = { pid: 'player001', key: 'key-player001-0123456789' }, hash = 'f'.repeat(64), r = { ...result, unlisted: true, rankStatus: 'missing', pp: 0 };
  const request = b => new Request('https://game.test/internal', { method: 'POST', body: JSON.stringify(b) });
  const one = await (await m.score(request({ ...base, hash, r }))).json();
  assert.equal(one.ok, true); assert.equal(one.rankStatus, 'missing'); assert.equal(one.rank, undefined);
  const many = await (await m.scores(request({ ...base, items: [{ hash, r }] }))).json();
  assert.equal(many.results[0].unranked, true); assert.equal(m.presence.boards.size, 0); assert.equal(m.presence.ranks.size, 0);
});

test('local totals require difficulty-level confirmation, not copied set status or old score metadata', () => {
  const { ScoreManager: S, __ctx } = load(['00-util.js', '08-mods.js', '11-managers.js']);
  const map = { hash: 'map', setId: 'set' };
  __ctx.BeatmapManager = { mapByHash: () => map, setById: new Map([['set', { status: 'ranked' }]]) };
  __ctx.SR_VERSION = 1;
  const score = { mapHash: 'map', status: 'ranked', passed: true, pp: 999, srVersion: 1, mods: [] };
  assert.equal(S.isRanked(score), false); assert.equal(S.ppOf(score), 0);
  map.rankStatus = 'missing'; assert.equal(S.isRanked(score), false);
  map.rankStatus = 'ranked'; assert.equal(S.isRanked(score), true); assert.equal(S.ppOf(score), 999);
  map.rankStatus = 'approved'; assert.equal(S.isRanked(score), true);
  map.rankStatus = 'pending'; assert.equal(S.ppOf(score), 0);
  assert.equal(S.ppOf(score, { includeUnranked: true }), 999, 'results can display calculated pp');
  assert.equal(S.bestPpPerMap([score]).length, 0, 'displaying unranked pp never counts toward totals');
  __ctx.OsuMath = { pp: () => 321 };
  assert.equal(S.ppOf({ ...score, pp: 0 }, { includeUnranked: true }), 321, 'recalculate a stored ranked-only zero');
  assert.equal(S.ppOf({ ...score, passed: false }, { includeUnranked: true }), 0, 'failed plays retain their rules');
});

test('exact lookup uses the explorer fallback only when its actual checksum matches', async () => {
  resetOsuLogin(); osuApi.cache.clear();
  const env = {}, calls = [];
  const fetcher = async url => {
    calls.push(String(url));
    return new Response(JSON.stringify({ id: 42, status: 'ranked', beatmaps: [{ id: 7, checksum: sum }, { id: 8, checksum: 'b'.repeat(32) }] }), { headers: { 'content-type': 'application/json' } });
  };
  const found = await lookupExactBeatmap(sum, env, fetcher, 42);
  assert.equal(found.id, 7); assert.equal(found.checksum, sum); assert.equal(found.beatmapset.status, 'ranked');
  assert.ok(calls.some(x => x.startsWith('https://webosumania.com/api/getBeatmap')));
  await assert.rejects(() => lookupExactBeatmap('c'.repeat(32), env, fetcher, 42), e => e.status === 404);
  const response = await handleLookupBeatmap(new URL(`https://game.test/api/lookupBeatmap?checksum=${sum}&id=999&setId=42`), env, fetcher);
  assert.equal((await response.json()).beatmapId, 7);
});
