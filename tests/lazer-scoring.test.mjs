// Expected values come from compiled upstream C# classes, not a second copy of the JavaScript implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { load } from './load.mjs';

const M = load(['00-util.js', '03-beatmap-parser.js', '03b-mania-convert.js', '08-mods.js', '09-gameplay.js', '09a-osu-math.js']);
const { HealthSystem, ScoreSystem, OsuMath, ManiaStarRating, DifficultyCalculator, RULES } = M;
const ref = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/lazer-scoring/reference.json.gz', import.meta.url))));
const close = (actual, expected, context, tolerance = 1e-11) => assert.ok(Math.abs(actual - expected) <= tolerance, `${context}: ${actual} != ${expected}`);

test('new plays use the pinned lazer health/scoring rules and midpoint-to-even rounding', () => {
  assert.equal(RULES, 4); assert.equal(ref.source, 'd551a04bc4fa613bc25cf04d6e7becbd5cca64cf');
  for (const [n, rounded] of [[.5, 0], [1.5, 2], [2.5, 2], [-.5, 0], [-1.5, -2], [.5000000000000001, 1], [.49999999999999994, 0]]) assert.equal(OsuMath.roundEven(n), rounded);
  const score = new ScoreSystem(1, { mods: ['EZ'], accuracyMode: 'v1' }); score.add(1);
  assert.equal(score.score, 473024); assert.equal(score.scoreStd, score.score); assert.equal(score.accuracy, 300 / 305);
});

test('health calibration, every judgement, fail conditions and Easy lives match native C# scenarios', () => {
  for (let i = 0; i < ref.inputs.health.length; i++) {
    const c = ref.inputs.health[i], expected = ref.expected.health[i];
    const h = new HealthSystem({ hp: c.hp, hpOverride: c.hpOverride, mods: c.mods, notes: c.notes, breaks: c.breaks });
    assert.equal(expected.drain, 0, c.id); close(h.mult, expected.multiplier, c.id + ' multiplier');
    assert.equal(h.rawHp, Math.fround(expected.hp));
    for (let k = 0; k < c.events.length; k++) {
      const e = c.events[k], result = expected.timeline[k];
      if (e.j < 0) h.earlyRelease(e.t); else h.apply(e.j, e.t, e.hold);
      close(h.value, result.value, `${c.id} HP at ${k}`);
      assert.equal(h.failed, result.failed, `${c.id} failed at ${k}`);
      assert.equal(h.extraLives, result.lives, `${c.id} remaining lives at ${k}`);
    }
  }
});

test('score, weighted accuracy, combo and mod multipliers match every native C# score frame', () => {
  for (let i = 0; i < ref.inputs.score.length; i++) {
    const c = ref.inputs.score[i], expected = ref.expected.score[i];
    const s = new ScoreSystem(c.total, { mods: c.mods, modConfig: c.config });
    assert.equal(s.mult, expected.multiplier, c.id + ' multiplier');
    for (let k = 0; k < c.sequence.length; k++) {
      if (c.sequence[k] < 0) s.breakCombo(); else s.add(c.sequence[k]);
      const frame = expected.timeline[k], label = `${c.id} at ${k}`;
      assert.equal(s.scoreStd, frame.score, label + ' score'); assert.equal(s.score, frame.score);
      assert.equal(s.accuracy, frame.accuracy, label + ' accuracy'); assert.equal(s.combo, frame.combo, label + ' combo'); assert.equal(s.maxCombo, frame.maxCombo, label + ' max combo');
    }
  }
});

test('pp and its separate 320-weighted accuracy match the native ManiaPerformanceCalculator', () => {
  for (let i = 0; i < ref.inputs.pp.length; i++) {
    const c = ref.inputs.pp[i], expected = ref.expected.pp[i];
    close(OsuMath.pp(c.stars, c.counts, c.mods), expected.pp, c.id, 1e-9);
    assert.equal(OsuMath.ppAccuracy(c.counts), expected.accuracy, c.id + ' pp accuracy');
  }
});

test('full-precision difficulty and pp match C# strain classes, including chords, holds and rates', () => {
  for (let i = 0; i < ref.inputs.difficulty.length; i++) {
    const c = ref.inputs.difficulty[i], expected = ref.expected.difficulty[i];
    close(ManiaStarRating.calculate(c.notes, c.keys, c.rate), expected.stars, c.id + ' strain');
    const stars = DifficultyCalculator.calculate(c.notes, c.keys, c.rate);
    close(stars, expected.stars, c.id + ' full precision stars');
    const n = c.notes.reduce((n, note) => n + (note.isLN ? 2 : 1), 0);
    close(OsuMath.pp(stars, [n, 0, 0, 0, 0, 0]), expected.pp, c.id + ' pp pipeline', 1e-9);
  }
});

test('live pp uses actual judgements; historical replay counters retain their recorded behaviour', () => {
  const c = M.__ctx; c.addEventListener = () => {};
  vm.runInContext(readFileSync(new URL('../src/js/15-screen-gameplay.js', import.meta.url), 'utf8') + '\nthis.Gameplay = GameplayScreen;', c);
  const g = Object.create(c.Gameplay), counts = [45, 3, 2, 0, 0, 0], e = { score: { counts, judged: 50 }, totalJudgements: 3000 };
  g.s = { stars: 5, mods: [], rules: 4 };
  assert.equal(g.livePp(e), OsuMath.pp(5, counts));
  g.s.rules = 3; assert.equal(g.livePp(e), OsuMath.pp(5, counts.map(n => n * 60)));
});

test('No Fail keeps its pass, while multiplayer can record a failed score without forcing HP to zero', () => {
  const h = new HealthSystem({ hp: 5, mods: ['SD'], noFail: true }); h.apply(5, 1000);
  assert.equal(h.failed, false); assert.equal(h.wouldFail, true); assert.equal(h.value, .955);
  const nf = new HealthSystem({ hp: 5, mods: ['NF'], noFail: true });
  for (let i = 0; i < 100; i++) nf.apply(5, i * 100);
  assert.equal(nf.failed, false); assert.equal(nf.wouldFail, false); assert.equal(nf.value, 0);
});

test('rules 1–3 replays retain their frozen scores, accuracy, health, fail state and rounded difficulty', () => {
  const legacy = JSON.parse(readFileSync(new URL('./fixtures/lazer-scoring/legacy.json', import.meta.url)));
  for (const { input, events, expected } of legacy.cases) {
    const e = new M.GameplayEngine(input);
    for (let i = 0; i < events.length; i += 3) e.input(events[i + 1], events[i + 2] === 1, events[i]);
    e.advance(10000); const s = e.summary();
    const actual = JSON.parse(JSON.stringify({ score: s.score, scoreStd: s.scoreStd, accuracy: s.accuracy, counts: s.counts, combo: s.combo, maxCombo: s.maxCombo, health: e.health.value, multiplier: e.health.mult, failed: e.health.failed, timeline: e.health.timeline, stars: DifficultyCalculator.calculate(input.notes, 4, input.rate, { legacy: true }) }));
    assert.deepEqual(actual, expected, `historical rules ${input.rules} ${input.mods.join()}`);
  }
});

test('the real parser retains native chord file order and all objects; old replay parsing stays unchanged', () => {
  const i = ref.inputs.difficulty.findIndex(c => c.id === 'file-order/chords'), c = ref.inputs.difficulty[i];
  const text = 'osu file format v14\n[General]\nMode:3\n[Metadata]\nTitle:Order\nArtist:Test\nVersion:4K\n[Difficulty]\nCircleSize:4\nHPDrainRate:7.3\nOverallDifficulty:7\n[TimingPoints]\n0,500,4,2,1,100,1,0\n[HitObjects]\n' + c.notes.map(n => `${(n.col + .5) * 128},192,${n.time},${n.isLN ? 128 : 1},0,${n.isLN ? n.end + ':' : ''}0:0:0:0:`).join('\n');
  const bm = M.BeatmapParser.parse(text), notes = M.BeatmapParser.toManiaNotes(bm);
  assert.deepEqual(Array.from(notes.slice(0, 4), n => n.col), [3, 0, 2, 1]);
  close(DifficultyCalculator.calculate(notes, 4), ref.expected.difficulty[i].stars, 'parsed chord difficulty');
  const hi = ref.inputs.health.findIndex(c => c.id === 'file-order/chords');
  close(new HealthSystem({ hp: bm.hp, notes }).mult, ref.expected.health[hi].multiplier, 'parsed chord health');
  const legacy = M.BeatmapParser.toManiaNotes(bm, 0, { legacy: true });
  assert.deepEqual(Array.from(legacy.slice(0, 4), n => n.col), [0, 1, 2, 3]);
  const duplicate = M.BeatmapParser.parse(text + '\n448,192,0,1,0,0:0:0:0:');
  assert.equal(M.BeatmapParser.toManiaNotes(duplicate).length, notes.length + 1);
  assert.equal(M.BeatmapParser.toManiaNotes(duplicate, 0, { legacy: true }).length, legacy.length);
});
