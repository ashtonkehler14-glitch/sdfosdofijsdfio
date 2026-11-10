import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from './load.mjs';

const { GameplayEngine, timingWindows, RULES, J } = load(['00-util.js', '08-mods.js', '09-gameplay.js', '09a-osu-math.js']);
const fixtures = JSON.parse(readFileSync(new URL('fixtures/lazer-timing/windows.json', import.meta.url)));
const note = (time = 1500, end = time, col = 0) => ({ time, end, col, isLN: end > time });
function engine({ od = 8, rate = 1, mods = [], rules = RULES, notes = [note()], ...options } = {}) {
  // Serialisation matters: a replay has plain arrays, with no hidden properties or window-calculation context.
  const windows = JSON.parse(JSON.stringify(timingWindows({ od, rate, mods, rules, ...options })));
  return new GameplayEngine({ notes, keys: 2, windows, rate, mods, rules, noFail: true, hpMult: 1 });
}

test('new plays use rules 4; pinned lazer window fixtures survive replay serialisation', () => {
  assert.equal(RULES, 4);
  for (const f of fixtures) {
    const e = engine(f);
    assert.deepEqual(Array.from(e.W), f.windows, JSON.stringify(f));
  }
});

test('lazer judgement edges are inclusive on both sides at every rate and difficulty', () => {
  for (const f of fixtures) for (let j = 0; j < 5; j++) for (const sign of [-1, 1]) {
    for (const extra of [0, .0001]) {
      const e = engine(f);
      e.input(0, true, 1500 + sign * (f.windows[j] + extra));
      assert.equal(e.notes[0].headJ, j + (extra ? 1 : 0), JSON.stringify({ f, j, sign, extra }));
      assert.equal(e.score.judged, 1);
    }
  }
});

test('lazer hold tails have 1.5 times the note window, including its exact edges', () => {
  for (const f of fixtures) for (let j = 0; j < 5; j++) for (const sign of [-1, 1]) {
    for (const extra of [0, .0001]) {
      const e = engine({ ...f, notes: [note(1500, 4000)] });
      e.input(0, true, 1500);
      e.input(0, false, 4000 + sign * (f.windows[j] * 1.5 + extra));
      assert.equal(e.notes[0].tailJ, j + (extra ? 1 : 0), JSON.stringify({ f, j, sign, extra }));
      assert.equal(e.score.judged, 2);
    }
  }
});

test('a head expires only after the late 50 edge; presses before the early miss edge do nothing', () => {
  const e = engine();
  e.advance(1500 + e.W[J.BAD]); assert.equal(e.score.judged, 0);
  e.advance(1500 + e.W[J.BAD] + .0001); assert.equal(e.notes[0].headJ, J.MISS);
  const early = engine();
  early.input(0, true, 1500 - early.W[J.MISS] - .0001); assert.equal(early.score.judged, 0);
  early.input(0, false, 1500 - early.W[J.MISS]);
  early.input(0, true, 1500 - early.W[J.MISS]); assert.equal(early.notes[0].headJ, J.MISS);
});

// Outcomes/timestamps from TestSceneHoldNoteInput.cs, ppy/osu @ 3f39cfce35f238c7d1a87abcca3ff5f405a91abb.
for (const [name, events, expected] of [
  ['CorrectInput', [[1500, 1], [4000, 0]], [J.MARV, J.MARV]],
  ['NoInput', [], [J.MISS, J.MISS]],
  ['LateRelease', [[1500, 1], [5250, 0]], [J.MARV, J.MISS]],
  ['PressAtStartAndBreak', [[1500, 1], [1510, 0]], [J.MARV, J.MISS]],
  ['PressAtStartThenReleaseAndImmediatelyRepress', [[1500, 1], [1501, 0], [1502, 1], [4000, 0]], [J.MARV, J.BAD]],
  ['PressAtStartThenBreakThenRepressAndReleaseAfterTail', [[1500, 1], [1510, 0], [2500, 1], [5250, 0]], [J.MARV, J.MISS]],
  ['PressAtStartThenBreakThenRepressAndReleaseAtTail', [[1500, 1], [1510, 0], [2500, 1], [4000, 0]], [J.MARV, J.BAD]],
  ['PressDuringNoteAndReleaseAtTail', [[2500, 1], [4000, 0]], [J.MISS, J.BAD]],
  ['PressDuringNoteAndReleaseAfterTail', [[2500, 1], [5250, 0]], [J.MISS, J.MISS]],
]) test(`upstream hold fixture: ${name}`, () => {
  const e = engine({ notes: [note(1500, 4000)] });
  for (const [t, down] of events) e.input(0, !!down, t);
  e.advance(6000);
  assert.deepEqual([e.notes[0].headJ, e.notes[0].tailJ], expected);
  assert.equal(e.score.judged, 2);
});

test('broken holds break combo once; regrabbing never restores a full tail judgement', () => {
  const e = engine({ notes: [note(1500, 4000), note(2000, 2000, 1)] });
  e.input(0, true, 1500); e.input(0, false, 1510);
  e.input(1, true, 2000); e.input(1, false, 2001);
  e.input(0, true, 2500); e.input(0, false, 2501);
  assert.equal(e.score.combo, 1, 'a second early release cannot break combo again');
  e.input(0, true, 3000); e.input(0, false, 4000);
  assert.equal(e.notes[0].tailJ, J.BAD);
  assert.equal(e.score.comboBreaks, 1);
  assert.equal(e.score.combo, 2);
});

test('regrabbing is allowed through the normal late 50 window, but not the extra release lenience', () => {
  for (const extra of [0, .0001]) {
    const e = engine({ notes: [note(1500, 4000)] });
    e.input(0, true, 1500); e.input(0, false, 1510);
    const t = 4000 + e.W[J.BAD] + extra;
    e.input(0, true, t); e.input(0, false, t + 1);
    e.advance(6000);
    assert.equal(e.notes[0].tailJ, extra ? J.MISS : J.BAD);
  }
});

test('broken hold caps never promote a miss; No Release still awards a capped tail after regrab', () => {
  const e = engine({ notes: [note(1500, 4000)] });
  e.input(0, true, 1500); e.input(0, false, 1510); e.input(0, true, 2500);
  e.input(0, false, 4000 - e.TW[J.BAD] - 1);
  assert.equal(e.notes[0].tailJ, J.MISS);
  const nr = engine({ notes: [note(1500, 4000)], mods: ['NR'] });
  nr.input(0, true, 1500); nr.input(0, false, 1510); nr.input(0, true, 2500);
  nr.advance(4001); assert.equal(nr.notes[0].tailJ, J.BAD);
});

test('Difficulty Adjust, custom OD and custom millisecond windows remain supported', () => {
  assert.deepEqual(Array.from(engine({ od: 8, mods: ['DA'], odOverride: 5 }).W), [19.5, 49.5, 82.5, 112.5, 136.5, 173.5]);
  assert.deepEqual(Array.from(engine({ mode: 'custom', customOD: 5 }).W), [19.5, 49.5, 82.5, 112.5, 136.5, 173.5]);
  assert.deepEqual(Array.from(engine({ mode: 'ms', customMs: '10,20,30,40,50,60', rate: 1.5 }).W), [15.5, 30.5, 45.5, 60.5, 75.5, 90.5]);
});

test('rules 1 and 2 replay results stay unchanged when the same inputs score differently under rules 3', () => {
  for (const rules of [1, 2, 3]) {
    const e = engine({ rules, notes: [note(1500, 4000)] });
    for (const [t, down] of [[1500, 1], [1510, 0], [2500, 1], [4000, 0]]) e.input(0, !!down, t);
    e.advance(6000);
    assert.equal(e.notes[0].tailJ, rules < 3 ? J.MISS : J.BAD);
  }
  const old = engine({ rules: 2, od: 8.8, rate: 1.25 });
  const current = engine({ od: 8.8, rate: 1.25 });
  assert.equal(old.W[J.PERF], 47.5); assert.equal(current.W[J.PERF], 46.5);
});

test('live inputs, saved replay and legacy server verification produce identical corrected hold results', () => {
  const { verifyPlay } = load(['00-util.js', '03-beatmap-parser.js', '03b-mania-convert.js', '08-mods.js', '09-gameplay.js', '09a-osu-math.js', '09c-verify.js']);
  const text = 'osu file format v14\n[General]\nMode:3\n[Difficulty]\nCircleSize:2\nOverallDifficulty:8\nHPDrainRate:5\n[TimingPoints]\n0,500,4,1,0,100,1,0\n[HitObjects]\n128,192,1500,128,0,4000:0:0:0:0:';
  const events = [1500, 0, 1, 1501, 0, 0, 1502, 0, 1, 4000, 0, 0];
  const live = engine({ notes: [note(1500, 4000)] }), replay = engine({ notes: [note(1500, 4000)] });
  for (let i = 0; i < events.length; i += 3) live.input(events[i + 1], !!events[i + 2], events[i]);
  for (let i = 0; i < events.length; i += 3) { replay.advance(events[i] - .1); replay.input(events[i + 1], !!events[i + 2], events[i]); }
  live.advance(6000); replay.advance(6000);
  const verified = verifyPlay(text, { events });
  assert.ok(!verified.error, verified.error);
  assert.deepEqual(live.summary(), replay.summary());
  assert.deepEqual(Array.from(verified.counts), Array.from(live.score.counts));
  assert.equal(verified.maxCombo, live.score.maxCombo);
  assert.equal(verified.score, live.score.scoreStd);
});
