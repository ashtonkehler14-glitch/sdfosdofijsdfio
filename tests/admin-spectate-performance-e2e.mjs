// CHROMIUM_PATH=/usr/bin/chromium CPU_RATE=4 node tests/admin-spectate-performance-e2e.mjs
// Source-side A/B benchmark. Authenticated, real playback is covered by admin-spectate-e2e.mjs.
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
  for (const path of ['unwatched', 'replay', 'interface']) {
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
      Settings.set('graphics.fpsLimit', 60); Settings.set('audio.autoplay', false);
      const blob = await (await fetch('/tests/fixtures/test-set.osz')).blob(); await App.importFiles([new File([blob], 'test-set.osz')]);
      while (Overlays.top()) Overlays.top().close();
    });
    const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_RATE || 4) });
    await page.evaluate(async path => {
      window.perfFrames = []; window.perfPackets = []; window.perfTasks = []; window.perfCaptureCalls = 0;
      Presence.send = function (msg) { const json = JSON.stringify(msg); if (msg.t === 'frames') window.perfPackets.push({ at: performance.now(), bytes: json.length }); };
      const owner = AdminGameView.current = { host: true, name: 'Performance check' };
      const actualCreate = GameViewCapture.create;
      GameViewCapture.create = function (...args) { window.perfCaptureCalls++; return actualCreate.apply(this, args); };
      const cap = owner.capture = path === 'interface' ? await GameViewCapture.create(owner, () => AdminGameView.current === owner, () => AdminGameView.privateOpen()) : { stop() {} };
      const end = cap.gameFrameEnd;
      cap.gameFrameEnd = function (ts, work, limit, drawn) { if (drawn) window.perfFrames.push({ ts, work }); end?.call(this, ts, work, limit, drawn); };
      Spectate.host.moderators = path === 'replay' ? 1 : 0;
      window.perfObserver = new PerformanceObserver(list => window.perfTasks.push(...list.getEntries().map(e => ({ at: e.startTime, duration: e.duration }))));
      window.perfObserver.observe({ type: 'longtask', buffered: false });
      const m = [...BeatmapManager.maps.values()].find(m => m.keys === 4 && !m.problems.length);
      Game.launch({ mapId: m.id, mods: ['NF'], mode: 'play' });
    }, path);
    await page.waitForFunction(() => GameplayScreen.loaderGone && GameplayScreen.s?.running, null, { timeout: 30000 });
    await page.evaluate(() => {
      let index = 0;
      window.perfKeys = setInterval(() => {
        const code = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'][index++ % 4];
        document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })); document.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      }, 30);
    });
    await page.waitForTimeout(800);
    const start = await page.evaluate(() => performance.now()); await page.waitForTimeout(6000);
    const metrics = await page.evaluate(({ start, path }) => {
      const frames = window.perfFrames.filter(f => f.ts >= start), dt = frames.slice(1).map((f, i) => f.ts - frames[i].ts).sort((a, b) => a - b);
      const cap = AdminGameView.current?.capture, packets = window.perfPackets.filter(p => p.at >= start), ms = performance.now() - start;
      const r = { path, fps: frames.length > 1 ? (frames.length - 1) * 1000 / (frames.at(-1).ts - frames[0].ts) : 0,
        p95FrameMs: dt[Math.floor(dt.length * .95)], longTasks: window.perfTasks.filter(t => t.at >= start).length,
        captureCalls: window.perfCaptureCalls, captureFrames: cap?.paintedFrames || 0, captureSnapshots: cap?.snapshots || 0,
        replayPacketsPerSecond: packets.length * 1000 / ms, replayBytesPerSecond: packets.reduce((n, p) => n + p.bytes, 0) * 1000 / ms,
        limit: Settings.get('graphics.fpsLimit'), recordedInputs: GameplayScreen.s.events.length,
        width: path === 'interface' ? cap.canvas.width : null, videoFps: path === 'interface' ? cap.budget.quality.fps : null };
      clearInterval(window.perfKeys); window.perfObserver.disconnect(); Spectate.host.moderators = 0; AdminGameView.stop(); return r;
    }, { start, path });
    assert.equal(metrics.limit, 60); assert.ok(metrics.fps > 0); assert.ok(metrics.recordedInputs > 0);
    if (path === 'replay') { assert.equal(metrics.captureCalls, 0); assert.equal(metrics.captureFrames, 0); assert.equal(metrics.captureSnapshots, 0); assert.ok(metrics.replayPacketsPerSecond > 0 && metrics.replayPacketsPerSecond <= 21); }
    if (path === 'unwatched') assert.equal(metrics.replayPacketsPerSecond, 0);
    if (path === 'interface') assert.ok(metrics.captureFrames > 0);
    assert.deepEqual(errors, []); results.push(metrics); console.log(JSON.stringify(metrics)); await context.close();
  }
  if (process.env.PERF_RESULT) writeFileSync(process.env.PERF_RESULT, JSON.stringify(results, null, 2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
