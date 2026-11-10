// Freeze historical rules using the shipped code, before the lazer scoring audit.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import vm from 'node:vm';
const source = '68541b7', root = new URL('../../../', import.meta.url);
const files = ['00-util.js', '03-beatmap-parser.js', '03b-mania-convert.js', '08-mods.js', '09-gameplay.js', '09a-osu-math.js'];
const ctx = vm.createContext({ console, performance });
vm.runInContext(files.map(f => execFileSync('git', ['show', `${source}:src/js/${f}`], { cwd: root, encoding: 'utf8' })).join('\n') + '\nthis.E = GameplayEngine; this.W = timingWindows; this.D = DifficultyCalculator;', ctx);
const notes = [
  { time: 1000, end: 1000, col: 0, isLN: false },
  { time: 1500, end: 2200, col: 1, isLN: true },
  { time: 2600, end: 2600, col: 2, isLN: false },
  { time: 3100, end: 3700, col: 3, isLN: true },
  { time: 4500, end: 4500, col: 2, isLN: false },
];
const events = [990, 0, 1, 1018, 0, 0, 1487, 1, 1, 2010, 1, 0, 2649, 2, 1, 2660, 2, 0, 3095, 3, 1, 3700, 3, 0];
const cases = [];
for (const rules of [1, 2, 3]) for (const mods of [[], ['EZ'], ['HT'], ['RT'], ['PF']]) {
  const rate = mods.includes('HT') ? .75 : mods.includes('RT') ? .85 : 1, modConfig = { rate: .85 };
  ctx.Settings = { get: k => k === 'mods.config' ? modConfig : undefined };
  const windows = Array.from(ctx.W({ od: 7, mods, rate, rules }));
  const input = { notes, keys: 4, windows, rate, mods, rules, hp: 5.3, modConfig, accuracyMode: 'v1' };
  const e = new ctx.E(input);
  for (let i = 0; i < events.length; i += 3) e.input(events[i + 1], events[i + 2] === 1, events[i]);
  e.advance(10000);
  const s = e.summary();
  cases.push({ input, events, expected: { score: s.score, scoreStd: s.scoreStd, accuracy: s.accuracy, counts: s.counts, combo: s.combo, maxCombo: s.maxCombo, health: e.health.value, multiplier: e.health.mult, failed: e.health.failed, timeline: e.health.timeline, stars: ctx.D.calculate(notes, 4, rate) } });
}
writeFileSync(new URL('legacy.json', import.meta.url), JSON.stringify({ source, cases }, null, 2) + '\n');
