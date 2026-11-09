import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { GameViewBudget: Budget } = load(['19q0-view-budget.js']);
function frames(b, { hz = 60, limit = 0, work = 2, count = 180, start = 1000, dt = 1000 / hz } = {}) {
  for (let i = 0; i < count; i++) { const ts = start + i * dt; b.begin(ts); b.sample(ts, work, limit); }
  return start + (count - 1) * dt;
}
test('the FPS target follows the real display and configured limiter, including 120/144/240Hz', () => {
  for (const hz of [60, 120, 144, 240]) {
    const b = new Budget(); frames(b, { hz, limit: hz, work: .4 });
    assert.ok(Math.abs(b.targetMs - 1000 / hz) < .1);
    frames(b, { hz, limit: 60, work: .4, start: 10000 });
    assert.ok(Math.abs(b.targetMs - 1000 / 60) < .1);
  }
});
test('missed frames reduce stream quality without redefining the player FPS goal', () => {
  const b = new Budget(); frames(b);
  const end = frames(b, { hz: 60, limit: 60, dt: 1000 / 30, start: 5000, work: 3 });
  assert.equal(b.level, 0); assert.ok(Math.abs(b.targetMs - 1000 / 60) < .1);
  assert.equal(b.canSpend(end + 16, .2), false);
});
test('busy game frames have first claim on time; no forced minimum stream work', () => {
  const b = new Budget(); const end = frames(b, { work: 16 });
  assert.equal(b.level, 0); assert.equal(b.canSpend(end + 1), false); assert.equal(b.due(end + 1), false);
  assert.ok(b.slack(end + 15) === 0);
});
test('healthy rendering recovers quality slowly, while spikes and CPU-limited encoding back off quickly', () => {
  const b = new Budget(); b.level = 1;
  frames(b, { work: 1, count: 180 }); assert.equal(b.level, 1, 'short recovery does not oscillate quality');
  frames(b, { work: 1, count: 480, start: 4000 }); assert.ok(b.level >= 2);
  const before = b.level; b.encoder(15000, true); assert.equal(b.level, before - 1);
  b.painted(15500, 6); assert.equal(b.level, Math.max(0, before - 2));
});
test('manual capture emits only at its adaptive rate, within a bounded idle slice', () => {
  const b = new Budget(); const end = frames(b, { work: 1 }); b.level = 2;
  assert.equal(b.due(end + 2), true); b.painted(end + 2, .4);
  b.begin(end + 16.67); assert.equal(b.due(end + 18), false);
  b.begin(end + 116.67); assert.equal(b.due(end + 118), true);
  assert.ok(b.slice(end + 118) <= .8);
});

test('a single short timestamp at a screen transition cannot invent a faster display', () => {
  const b = new Budget(); b.begin(1000); b.sample(1000, 1); b.begin(1002); b.sample(1002, 1);
  frames(b, { start: 1018.67, count: 180, work: 1 }); assert.ok(Math.abs(b.displayMs - 1000 / 60) < .1);
});
test('a 60 FPS limiter on a 144Hz display does not mistake its alternating intervals for stutter', () => {
  const b = new Budget(); let last = -1;
  for (let i = 0; i < 600; i++) {
    const ts = 1000 + i * 1000 / 144, draw = Math.floor(i * 60 / 144);
    b.begin(ts); b.sample(ts, 1, 60, draw !== last); last = draw;
  }
  assert.equal(b.level, 5); assert.ok(Math.abs(b.targetMs - 1000 / 60) < .1);
});

test('recovering stream quality never reduces text resolution, frame rate or encoder allowance', () => {
  for (let i = 1; i < Budget.TIERS.length; i++) {
    const before = Budget.TIERS[i - 1], after = Budget.TIERS[i];
    assert.ok(after.width >= before.width); assert.ok(after.fps >= before.fps); assert.ok(after.bitrate >= before.bitrate);
  }
});
