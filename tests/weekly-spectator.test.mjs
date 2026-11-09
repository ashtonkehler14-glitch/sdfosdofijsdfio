import test from 'node:test';
import assert from 'node:assert/strict';
import { PresenceLogic } from '../worker/multiplayer.js';

const stamp = s => Date.parse(s);
const map = { onlineSetId: 10, onlineId: 111, keys: 4, title: 'Challenge', artist: 'Artist', version: 'Hard', stars: 4 };

test('weekly challenge uses Monday midnight Central across summer, winter and year boundaries', () => {
  for (const [time, week] of [
    ['2026-10-05T04:59:59Z', '2026-09-28'], ['2026-10-05T05:00:00Z', '2026-10-05'],
    ['2026-12-07T05:59:59Z', '2026-11-30'], ['2026-12-07T06:00:00Z', '2026-12-07'],
    ['2027-01-01T12:00:00Z', '2026-12-28'], ['2027-01-04T06:00:00Z', '2027-01-04'],
  ]) assert.equal(PresenceLogic.weekOf(stamp(time)), week, time);
  assert.equal(PresenceLogic.prevWeek('2027-01-04'), '2026-12-28');
});

test('weekly challenge deadlines and progress duration follow daylight saving changes', () => {
  for (const [week, end, hours] of [
    ['2026-03-02', '2026-03-09T05:00:00Z', 167], ['2026-10-26', '2026-11-02T06:00:00Z', 169],
    ['2026-12-28', '2027-01-04T06:00:00Z', 168],
  ]) {
    const p = new PresenceLogic(() => stamp(week + 'T12:00:00Z')), d = p.dailyMsg('player1');
    assert.equal(d.period, 'week');
    assert.equal(d.endsAt, stamp(end));
    assert.equal(d.endsAt - d.startsAt, hours * 3600000);
  }
});

test('weekly challenge holds its map and board through daily midnights and restarts, then rotates on Monday', () => {
  let now = stamp('2026-10-05T05:00:00Z');
  const p = new PresenceLogic(() => now), saved = [];
  p.persistDaily = d => saved.push(structuredClone(d));
  p.setDailyMap(map);
  p.daily.scores.push({ pid: 'player1', score: 900000 });
  for (const t of ['2026-10-06T05:00:00Z', '2026-10-11T23:59:59Z', '2026-10-12T04:59:59Z']) {
    now = stamp(t);
    assert.equal(p.dailyMsg('player1').total, 1);
    assert.equal(p.dailyNow().map.onlineId, 111);
  }
  const restarted = new PresenceLogic(() => now);
  restarted.daily = structuredClone(p.daily);
  assert.equal(restarted.dailyMsg('player1').total, 1);
  now = stamp('2026-10-12T05:00:00Z');
  assert.deepEqual([p.dailyNow().day, p.daily.map, p.daily.scores], ['2026-10-12', null, []]);
  assert.deepEqual(p.daily.hist, [111]);
  assert.equal(saved.at(-1).period, 'week');
});

test('upgrading an active daily board preserves scores and archives day-based stats without counting days as weeks', () => {
  const p = new PresenceLogic(() => stamp('2026-11-08T17:00:00Z')), savedStats = [];
  const dailyHistory = { plays: 100, current: 9, best: 12, last: '2026-11-08' };
  p.loadDailyStats({ player1: dailyHistory });
  p.persistDailyStats = (pid, v) => savedStats.push([pid, structuredClone(v)]);
  p.daily = { day: '2026-11-08', map, scores: [{ pid: 'player1', score: 765432, at: 10 }], hist: [111] };
  const d = p.dailyMsg('player1');
  assert.equal(d.day, '2026-11-02');
  assert.equal(d.map.onlineId, 111);
  assert.equal(d.you.score, 765432);
  assert.deepEqual(d.stats, { period: 'week', plays: 1, current: 1, best: 1, last: '2026-11-02', dailyHistory });
  p.dailyMsg('player1'); p.countDailyDay('player1', '2026-11-02');
  assert.equal(p.dailyStatsOf('player1').plays, 1);
  assert.equal(savedStats.at(-1)[1].dailyHistory.plays, 100);
  const restarted = new PresenceLogic(p.now);
  restarted.daily = structuredClone(p.daily); restarted.loadDailyStats(Object.fromEntries(p.dailyStats));
  assert.equal(restarted.dailyMsg('player1').stats.plays, 1, 'migration is not repeated after restart');
});

test('an older daily board rotates on upgrade; archived participation is not presented as weekly participation', () => {
  const p = new PresenceLogic(() => stamp('2026-11-09T06:00:00Z'));
  p.daily = { day: '2026-11-08', map, scores: [{ pid: 'player1', score: 100 }], hist: [111] };
  p.loadDailyStats({ player1: { plays: 4, best: 3, current: 1, last: '2026-11-08' } });
  const d = p.dailyMsg('player1');
  assert.equal(d.map, null); assert.equal(d.total, 0);
  assert.equal(d.stats.plays, 0); assert.equal(d.stats.current, 0); assert.equal(d.stats.dailyHistory.plays, 4);
});

test('weekly streaks count one participation per week, allow the current week to finish and break after a missed week', () => {
  let now = stamp('2026-10-05T12:00:00Z');
  const p = new PresenceLogic(() => now);
  p.countDailyDay('player1', '2026-10-05'); p.countDailyDay('player1', '2026-10-05');
  assert.equal(p.dailyStatsOf('player1').plays, 1);
  now = stamp('2026-10-18T12:00:00Z');
  assert.equal(p.dailyStatsOf('player1').current, 1, 'the current week is still open');
  p.countDailyDay('player1', '2026-10-12');
  assert.equal(p.dailyStatsOf('player1').current, 2);
  now = stamp('2026-10-26T12:00:00Z');
  assert.equal(p.dailyStatsOf('player1').current, 0);
  p.countDailyDay('player1', '2026-10-26');
  assert.deepEqual(p.dailyStatsOf('player1'), { period: 'week', plays: 3, current: 1, best: 2, last: '2026-10-26' });
});

test('regular spectators receive live menu activity and a fresh snapshot when joining between songs', () => {
  const p = new PresenceLogic(() => 1);
  p.join('host', { name: 'Player', activity: 'songselect' }); p.join('viewer', { name: 'Watcher' });
  const wait = p.message('viewer', { t: 'watch', to: 'host' }).find(x => x.msg.t === 'specWait');
  assert.deepEqual([wait.msg.status, wait.msg.activity], ['menu', 'songselect']);
  for (const activity of ['explore', 'results', 'home', 'daily']) {
    const out = p.message('host', { t: 'status', status: 'menu', activity });
    assert.deepEqual(out.find(x => x.msg.t === 'specActivity'), { to: 'viewer', msg: { t: 'specActivity', id: 'host', status: 'menu', activity } });
    assert.equal(p.list().find(x => x.id === 'host').activity, activity);
    assert.ok(!p.message('host', { t: 'status', status: 'menu', activity }).some(x => x.msg.t === 'specActivity'), 'unchanged activity does not send extra messages');
  }
  p.message('viewer', { t: 'unwatch', to: 'host' });
  assert.ok(!p.message('host', { t: 'status', status: 'menu', activity: 'songselect' }).some(x => x.msg.t === 'specActivity'));
  assert.equal(p.message('viewer', { t: 'watch', to: 'host' }).find(x => x.msg.t === 'specWait').msg.activity, 'songselect');
});

test('regular spectator activity accepts only known menu identifiers and preserves active-play late joins', () => {
  const p = new PresenceLogic(() => 1);
  p.join('host', { name: 'Player', activity: '<private screen data>' }); p.join('viewer', { name: 'Watcher' });
  assert.equal(p.users.get('host').activity, '');
  p.message('host', { t: 'status', status: 'menu', activity: { html: 'anything' } });
  assert.equal(p.users.get('host').activity, '');
  p.message('host', { t: 'play', head: { mapHash: 'abc', title: 'Song', keys: 4, mods: [], rate: 1, seed: 7 } });
  const active = p.message('viewer', { t: 'watch', to: 'host' });
  assert.equal(active.find(x => x.to === 'viewer').msg.t, 'specStart');
  assert.equal(p.message('host', { t: 'playEnd' })[0].msg.t, 'specEnd');
  assert.equal(p.users.get('host').play, null);
  const out = p.message('host', { t: 'status', status: 'menu', activity: 'songselect' });
  assert.equal(out.find(x => x.msg.t === 'specActivity').msg.activity, 'songselect');
  assert.equal(p.users.get('viewer').watching, 'host');
});
