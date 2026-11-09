// CHROMIUM_PATH=/usr/bin/chromium node tests/mania-timing-e2e.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = new URL('../', import.meta.url);
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path.includes('..')) return res.writeHead(403).end();
  for (const p of [path === '/' ? 'index.html' : path.slice(1), 'public' + path]) {
    try { const data = readFileSync(new URL(p, root)); res.setHeader('content-type', path === '/' ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); return res.end(data); } catch {}
  }
  res.writeHead(404).end();
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
  if (await page.$('.onboarding')) {
    if (await page.$('.setup-choice[data-id=new]')) await page.click('.setup-choice[data-id=new]');
    await page.fill('.onboarding .ob-name', 'TimingTester'); await page.keyboard.press('Enter');
    await page.waitForSelector('.setup-step-wom, .setup-step-mobile'); await page.evaluate(() => Onboarding.finish());
  }
  await page.waitForFunction(() => !Screens.busy);
  await page.evaluate(async () => {
    Settings.set('medals.unlocked', Object.fromEntries(Medals.all.map(m => [m.id, 1]))); Medals.queue.length = 0;
    while (Overlays.top()) Overlays.top().close();
    const blob = await (await fetch('/tests/fixtures/test-set.osz')).blob();
    await App.importFiles([new File([blob], 'test-set.osz')]);
    while (Overlays.top()) Overlays.top().close();
    Settings.set('gameplay.judgementMode', 'od'); Settings.set('input.latency', 0); Settings.set('audio.offset', 0);
    NeruCameo.make = () => null;
    const m = [...BeatmapManager.maps.values()].find(m => m.version === '4K Normal');
    Game.launch({ mapId: m.id, mods: ['NF', 'DT'], mode: 'play' });
  });
  await page.waitForFunction(() => GameplayScreen.s?.running);
  const input = await page.evaluate(() => {
    const G = GameplayScreen, original = G.s;
    const n = { time: 1500, end: 4000, col: 0, isLN: true };
    const engine = new GameplayEngine({ notes: [n], keys: 1, windows: timingWindows(), noFail: true, hpMult: 1 });
    const s = { ...original, engine, held: [false], down: [new Set()], events: [], rate: 1, mods: [], practice: false };
    try {
      G.s = s;
      G.keyDown(0, 'KeyD', 1500);
      G.keyDown(0, 'KeyF', 1500.1); G.keyUp(0, 'KeyD', 1500.2);
      const stillHeld = s.held[0];
      G.keyUp(0, 'KeyF', 1500.504);
      G.keyDown(0, 'KeyD', 1501); G.keyUp(0, 'KeyD', 4000);
      return { stillHeld, events: s.events, tail: engine.notes[0].tailJ, rules: original.rules, rate: original.rate, windows: original.engine.W, expected: timingWindows({ od: original.bm.od, mods: original.mods, rate: original.rate }).map(w => Math.floor(w * original.rate + 1e-9) + .5) };
    } finally { G.s = original; }
  });
  assert.equal(input.stillHeld, true, 'releasing one of two bindings keeps the column held');
  assert.deepEqual(input.events, [1500, 0, 1, 1500.504, 0, 0, 1501, 0, 1, 4000, 0, 0]);
  assert.equal(input.tail, 4); assert.equal(input.rules, 3); assert.equal(input.rate, 1.5);
  assert.deepEqual(input.windows, input.expected, 'gameplay passes its actual modded rate to the window calculation');

  // Actual keyboard handlers and audio clock: play a map at DT, then compare stored playback and verification.
  await page.evaluate(() => new Promise(resolve => {
    const G = GameplayScreen, s = G.s, codes = Settings.keybinds(s.keys).map(c => c[0]);
    const events = s.engine.notes.flatMap(n => [[n.time, n.col, 1], [n.isLN ? n.end : n.time + 30, n.col, 0]]).sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    let i = 0;
    const tick = () => {
      while (i < events.length && events[i][0] <= G.gameTime()) {
        const [, c, down] = events[i++];
        window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: codes[c], key: codes[c], bubbles: true }));
      }
      if (i < events.length) setTimeout(tick, 1); else resolve();
    }; tick();
  }));
  await page.waitForFunction(() => Screens.currentName === 'results', null, { timeout: 25000 });
  const result = await page.evaluate(async () => {
    const score = Screens.current.p.score, replay = await ReplayManager.get(score.replayId);
    const bm = (await BeatmapManager.load(replay.mapId)).bm;
    const notes = prepareNotes(BeatmapParser.toManiaNotes(bm), replay.keys, replay.mods, replay.seed);
    const engine = new GameplayEngine({ notes, keys: replay.keys, windows: replay.windows, rate: replay.rate, mods: replay.mods, rules: replay.rules, hpMult: 1 });
    for (let i = 0; i < replay.events.length; i += 3) engine.input(replay.events[i + 1], !!replay.events[i + 2], replay.events[i]);
    engine.advance(1e9);
    return { counts: score.counts, replayCounts: engine.summary().counts, acc: score.accuracy, rules: replay.rules, events: replay.events.length };
  });
  assert.equal(result.counts[5], 0, JSON.stringify(result)); assert.ok(result.acc > .95, JSON.stringify(result));
  assert.deepEqual(result.counts, result.replayCounts); assert.equal(result.rules, 3); assert.ok(result.events > 100);
  assert.deepEqual(errors, []);
  console.log('PASS: short releases, dual bindings, hold regrabs, DT live keyboard/audio timing and saved replay parity', JSON.stringify(result));
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
