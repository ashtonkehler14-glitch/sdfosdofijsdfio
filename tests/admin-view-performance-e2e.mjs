// BASELINE_CAPTURE=/path/to/previous-19qa-game-capture.js CHROMIUM_PATH=/usr/bin/chromium node tests/admin-view-performance-e2e.mjs
// A repeatable capture benchmark; real authenticated WebRTC/privacy checks live in admin-game-view-e2e.mjs.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = new URL('../', import.meta.url);
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path.includes('..')) { res.writeHead(403).end(); return; }
  try {
    let data; try { data = readFileSync(new URL(path === '/' ? 'index.html' : path.slice(1), root)); }
    catch { data = readFileSync(new URL('public' + path, root)); }
    res.setHeader('Content-Type', path === '/' ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); res.end(data);
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const results = [];
  for (const legacy of process.env.BASELINE_CAPTURE ? [true, false] : [false]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(() => localStorage.setItem('am.noInstallPrompt', '1'));
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
    if (await page.$('.onboarding')) {
      await page.click('.setup-choice[data-id="new"]'); await page.fill('.onboarding .ob-name', 'Performance check'); await page.keyboard.press('Enter');
      await page.waitForSelector('.setup-step-wom, .setup-step-mobile'); await page.evaluate(() => AshtonkMania.Onboarding.finish());
    }
    await page.evaluate(async () => {
      while (Overlays.top()) Overlays.top().close();
      const A = AshtonkMania; await A.Settings.set('graphics.fpsLimit', 60); await A.Settings.set('audio.autoplay', false);
      const blob = await (await fetch('/tests/fixtures/test-set.osz')).blob(); await A.App.importFiles([new File([blob], 'test-set.osz')]);
      while (Overlays.top()) Overlays.top().close();
      await GameViewCapture.load();
    });
    if (legacy) await page.addScriptTag({ content: 'window.LegacyCapture = (() => {\n' + readFileSync(process.env.BASELINE_CAPTURE, 'utf8') + '\nreturn GameViewCapture;})();' });
    await page.evaluate(async legacy => {
      const source = legacy ? window.LegacyCapture : GameViewCapture;
      const owner = AdminGameView.current = { host: true, name: 'Performance check' };
      owner.capture = await source.create(owner, () => AdminGameView.current === owner, () => AdminGameView.privateOpen());
      owner.stream = owner.capture.stream; owner.track = owner.capture.track;
      window.perfTimes = []; window.perfLong = [];
      const cap = owner.capture, end = cap.gameFrameEnd;
      cap.gameFrameEnd = function (ts, work, limit, drawn) { if (drawn) window.perfTimes.push({ ts, work }); end?.call(this, ts, work, limit, drawn); };
      window.perfObserver = new PerformanceObserver(list => window.perfLong.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))));
      window.perfObserver.observe({ type: 'longtask', buffered: false });
    }, legacy);
    const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_RATE || 4) });
    await page.evaluate(() => {
      const A = AshtonkMania, m = [...A.BeatmapManager.maps.values()].find(m => m.keys === 4 && !m.problems.length);
      A.Game.launch({ mapId: m.id, mods: ['AT'], mode: 'play' });
    });
    await page.waitForFunction(() => AshtonkMania.GameplayScreen.s?.running);
    await page.waitForTimeout(Number(process.env.WARMUP_MS || 800)); const start = await page.evaluate(() => performance.now());
    await page.waitForTimeout(Number(process.env.SAMPLE_MS || 6000));
    const metrics = await page.evaluate(({ start, legacy }) => {
      const frames = window.perfTimes.filter(x => x.ts >= start), dt = frames.slice(1).map((f, i) => f.ts - frames[i].ts).sort((a, b) => a - b);
      const cap = AdminGameView.current.capture;
      const r = { legacy, fps: frames.length > 1 ? (frames.length - 1) * 1000 / (frames.at(-1).ts - frames[0].ts) : 0,
        p95FrameMs: dt[Math.floor(dt.length * .95)], longTasks: window.perfLong.filter(e => e.start >= start).length,
        longTaskMs: window.perfLong.filter(e => e.start >= start).reduce((n, e) => n + e.duration, 0), limit: Settings.get('graphics.fpsLimit'),
        streamFps: cap.budget?.quality.fps || 30, streamWidth: cap.canvas.width, snapshotYields: cap.yielded || 0, manualFrames: !!cap.manual, snapshots: cap.snapshots || null, hudSnapshots: cap.hudSnapshots || 0, fullSnapshots: cap.fullSnapshots || 0, paintedFrames: cap.paintedFrames || 0 };
      AdminGameView.stop(); window.perfObserver.disconnect(); return r;
    }, { start, legacy });
    assert.equal(metrics.limit, 60); assert.ok(metrics.fps > 0);
    if (!legacy) { assert.equal(metrics.manualFrames, true); assert.ok(metrics.snapshotYields > 0); assert.ok(metrics.paintedFrames > 0, 'The budget must still produce actual game-view frames'); assert.ok(metrics.streamFps <= 30); }
    assert.deepEqual(errors, []); results.push(metrics); console.log(JSON.stringify(metrics)); await context.close();
  }
  if (process.env.PERF_RESULT) writeFileSync(process.env.PERF_RESULT, JSON.stringify(results, null, 2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
