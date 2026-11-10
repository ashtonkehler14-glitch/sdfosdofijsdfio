// CHROMIUM_PATH=/usr/bin/chromium node tests/performance-resolution-e2e.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'), root = new URL('../', import.meta.url);
const server = createServer((req, res) => {
  const path = req.url.split('?')[0]; if (path.includes('..')) return res.writeHead(403).end();
  for (const p of [path === '/' ? 'index.html' : path.slice(1), 'public' + path]) {
    try { const data = readFileSync(new URL(p, root)); res.setHeader('content-type', path === '/' ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); return res.end(data); } catch {}
  }
  res.writeHead(404).end();
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r)); let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
  if (await page.$('.onboarding')) {
    if (await page.$('.setup-choice[data-id=new]')) await page.click('.setup-choice[data-id=new]');
    await page.fill('.onboarding .ob-name', 'ResolutionTester'); await page.keyboard.press('Enter');
    await page.waitForSelector('.setup-step-wom, .setup-step-mobile'); await page.evaluate(() => Onboarding.finish());
  }
  await page.waitForFunction(() => !Screens.busy);
  await page.evaluate(async () => {
    Settings.set('medals.unlocked', Object.fromEntries(Medals.all.map(m => [m.id, 1]))); Medals.queue.length = 0;
    while (Overlays.top()) Overlays.top().close(); const blob = await (await fetch('/tests/fixtures/test-set.osz')).blob();
    await App.importFiles([new File([blob], 'test-set.osz')]); while (Overlays.top()) Overlays.top().close();
    Settings.set('graphics.performanceMode', false); Settings.set('graphics.autoScale', true); Settings.set('graphics.renderScale', 1); Settings.set('perf.autoScale', .6);
    NeruCameo.make = () => null;
    const m = [...BeatmapManager.maps.values()].find(m => m.version === '4K Normal'); Game.launch({ mapId: m.id, mods: ['AT'], mode: 'play' });
  });
  await page.waitForFunction(() => GameplayScreen.s?.running);
  const measure = () => page.evaluate(() => {
    const G = GameplayScreen, r = G.renderer, host = r.canvas.parentElement;
    return { scale: r.autoScale, auto: G._as.on, height: r.canvas.height, expected: Math.round((r._hostH ?? host.clientHeight) * Zoom.dpr()),
      noteHeight: r._noteH(r.layout.tex.note[0], 0), hitFraction: r.hitY / r.H, windows: [...G.s.engine.W], manual: Settings.get('graphics.renderScale'), bgQuality: Settings.get('graphics.bgQuality'),
      lighting: Settings.get('gameplay.hitLighting'), effects: Settings.get('skin.effects') };
  });
  const before = await measure(); assert.equal(before.scale, .6); assert.ok(before.height < before.expected * .7);
  await page.evaluate(() => SettingsPanel.open('Graphics'));
  await page.getByRole('switch', { name: 'Performance mode', exact: true }).click();
  const sharp = await measure();
  assert.equal(sharp.auto, false); assert.equal(sharp.scale, 1); assert.equal(sharp.height, sharp.expected);
  assert.ok(sharp.noteHeight > before.noteHeight * 1.6); assert.ok(Math.abs(sharp.hitFraction - before.hitFraction) < .002);
  assert.deepEqual(sharp.windows, before.windows); assert.equal(sharp.bgQuality, 'low'); assert.equal(sharp.lighting, false); assert.equal(sharp.effects, false);
  assert.equal(await page.getByRole('switch', { name: 'Automatic resolution', exact: true }).count(), 0);
  await page.evaluate(() => { const G = GameplayScreen; G._work = 40; const start = performance.now(); for (let t = start; t < start + 8000; t += 45) G.adaptResolution(45, t, 0); });
  assert.equal((await measure()).height, sharp.height); assert.equal((await measure()).scale, 1);
  // The explicit whole-game render scale still follows the player's choice.
  await page.getByRole('slider', { name: 'Render scale', exact: true }).evaluate(el => { el.value = '.75'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  const manual = await measure(); assert.equal(manual.manual, .75); assert.equal(manual.scale, 1); assert.equal(manual.height, manual.expected);
  await page.getByRole('switch', { name: 'Performance mode', exact: true }).click();
  assert.equal(await page.getByRole('switch', { name: 'Automatic resolution', exact: true }).getAttribute('aria-checked'), 'true');
  assert.equal((await measure()).scale, .6, 'The saved normal-mode preference is retained');
  await page.getByRole('switch', { name: 'Automatic resolution', exact: true }).click();
  const restored = await measure(); assert.equal(restored.scale, 1); assert.equal(restored.auto, false); assert.equal(restored.height, restored.expected);
  await page.getByRole('switch', { name: 'Performance mode', exact: true }).click(); await page.evaluate(async () => Settings.flush());
  await page.reload(); await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
  assert.equal(await page.evaluate(() => Settings.get('graphics.performanceMode') && !Settings.get('graphics.autoScale')), true);
  assert.deepEqual(errors, []);
  console.log('PASS: live full-resolution notes, slow-frame protection, lighter effects, manual scale, settings controls and persistence', JSON.stringify({ before: before.height, sharp: sharp.height, manual: manual.height }));
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
