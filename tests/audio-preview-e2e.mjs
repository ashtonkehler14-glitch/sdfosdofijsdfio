// CHROMIUM_PATH=/usr/bin/chromium node tests/audio-preview-e2e.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = new URL('../', import.meta.url);
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path.includes('..')) { res.writeHead(403).end(); return; }
  try {
    let data;
    try { data = readFileSync(new URL(path === '/' ? 'index.html' : path.slice(1), root)); }
    catch { data = readFileSync(new URL('public' + path, root)); }
    res.setHeader('Content-Type', path === '/' ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  for (const touch of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: touch, isMobile: touch });
    await context.addInitScript(() => localStorage.setItem('am.noInstallPrompt', '1'));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
    if (await page.$('.onboarding')) {
      if (await page.$('.setup-choice[data-id="new"]')) await page.click('.setup-choice[data-id="new"]');
      await page.fill('.onboarding .ob-name', 'AudioTest'); await page.keyboard.press('Enter');
      await page.waitForSelector('.setup-step-wom, .setup-step-mobile');
      await page.evaluate(() => AshtonkMania.Onboarding.finish());
    }
    await page.evaluate(async () => {
      const blob = await (await fetch('/tests/fixtures/test-set.osz')).blob();
      await AshtonkMania.App.importFiles([new File([blob], 'test-set.osz')]);
      while (Overlays.top()) Overlays.top().close();
      const m = [...AshtonkMania.BeatmapManager.maps.values()].find(m => m.keys === 4 && !m.problems.length);
      await AshtonkMania.Screens.go('songselect', { mapId: m.id });
    });
    await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'songselect' && AshtonkMania.Music.playing);
    for (const [mod, rate, preserve] of [['DT', 1.5, true], ['NC', 1.5, false], ['HT', .75, true], ['DC', .75, false], ['RT', 1.35, true], ['', 1, true]]) {
      const state = await page.evaluate(async ({ mod }) => {
        const { Music, SongSelect, Settings, Bus } = AshtonkMania;
        const before = Music.time;
        await Settings.set('mods.config', { ...ModSystem.config(), rate: 1.35 });
        await Settings.set('songselect.mods', mod ? [mod] : []); Bus.emit('mods:changed');
        await SongSelect.syncPreviewAudio();
        return { before, after: Music.time, rate: Music.rate, native: !!Music.el, nativeRate: Music.el?.playbackRate, pitch: Music.el?.preservesPitch, stretched: !!Music.stretched, sourceRate: Music.source?.playbackRate.value, playing: Music.playing };
      }, { mod });
      assert.equal(state.rate, rate); assert.equal(state.native, !touch); assert.equal(state.playing, true);
      if (touch) { assert.equal(state.stretched, preserve && rate !== 1); assert.equal(state.sourceRate, state.stretched ? 1 : rate); }
      else { assert.equal(state.nativeRate, rate); assert.equal(state.pitch, preserve); }
      assert.ok(Math.abs(state.after - state.before) < 1500, JSON.stringify(state));
    }
    // Changing audio files while a speed mod is selected applies it to the new track as well.
    await page.evaluate(async () => {
      const { Settings, SongSelect, BeatmapManager, Bus } = AshtonkMania;
      await Settings.set('songselect.mods', ['NC']); Bus.emit('mods:changed');
      const m = [...BeatmapManager.maps.values()].find(m => m.keys === 9 && !m.problems.length);
      SongSelect.select(m.id);
    });
    await page.waitForFunction(() => AshtonkMania.Music.meta?.mapId === AshtonkMania.SongSelect.selectedId && AshtonkMania.Music.rate === 1.5 && AshtonkMania.Music.playing);
    await page.evaluate(() => AshtonkMania.SongSelect.play());
    await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s?.running);
    assert.equal(await page.evaluate(() => AshtonkMania.Music.rate), 1.5);
    assert.equal(await page.evaluate(() => !!AshtonkMania.Music.stretched), false);
    await page.evaluate(() => AshtonkMania.Screens.go('songselect'));
    await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'songselect' && AshtonkMania.Music.playing && AshtonkMania.Music.rate === 1.5);
    await page.evaluate(() => AshtonkMania.Screens.go('home'));
    await page.waitForFunction(() => AshtonkMania.Screens.currentName === 'home');
    assert.equal(await page.evaluate(() => AshtonkMania.Music.rate), 1);
    assert.equal(await page.evaluate(() => AshtonkMania.AudioManager.modGain.gain.value), 1);
    assert.deepEqual(errors, []);
    console.log(`PASS: ${touch ? 'touch / decoded' : 'desktop / streamed'} previews match speed/pitch mods, retain position, follow track changes and gameplay, reset on exit`);
    await context.close();
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
