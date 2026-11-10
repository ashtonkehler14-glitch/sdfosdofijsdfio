// CHROMIUM_PATH=/usr/bin/chromium node tests/skin-gui-profiles-e2e.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'), root = new URL('../', import.meta.url);
const server = createServer((req, res) => {
  const path = req.url.split('?')[0]; if (path.includes('..')) return res.writeHead(403).end();
  for (const p of [path === '/' ? 'index.html' : path.slice(1), 'public' + path]) try {
    const data = readFileSync(new URL(p, root)); res.setHeader('content-type', path === '/' ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); return res.end(data);
  } catch {}
  res.writeHead(404).end();
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r)); let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
  if (await page.$('.onboarding')) {
    if (await page.$('.setup-choice[data-id=new]')) await page.click('.setup-choice[data-id=new]');
    await page.fill('.onboarding .ob-name', 'GuiTester'); await page.keyboard.press('Enter');
    await page.waitForSelector('.setup-step-wom, .setup-step-mobile'); await page.evaluate(() => Onboarding.finish());
  }
  await page.waitForFunction(() => !Screens.busy);
  const imported = await page.evaluate(async () => {
    Settings.set('medals.unlocked', Object.fromEntries(Medals.all.map(m => [m.id, 1]))); Medals.queue.length = 0;
    while (Overlays.top()) Overlays.top().close();
    const maps = await (await fetch('/tests/fixtures/test-set.osz')).blob(); await App.importFiles([new File([maps], 'test-set.osz')]);
    const skin = await (await fetch('/tests/fixtures/chemuss.osk')).blob(); const meta = await SkinManager.importOsk(new File([skin], 'chemuss.osk'));
    while (Overlays.top()) Overlays.top().close();
    Settings.set('hud.layout', { sc: { x: -.04, s: 1.1 }, combo: { x: .03, s: .8 }, background: { y: .02 } });
    Settings.set('gameplay.showPp', false); Settings.set('skin.receptorAlpha', 55); Settings.set('audio.offset', 12);
    NeruCameo.make = () => null;
    return meta.id;
  });
  async function open(skin, keys) {
    await page.evaluate(async ({ skin, keys }) => {
      NeruCameo.make = () => null;
      await SkinManager.select(skin);
      Settings.set('ui.skinEditorKeys', keys);
      const m = [...BeatmapManager.maps.values()].find(m => m.keys === 4 && !m.problems.length);
      if (!m) throw new Error(`Missing ${keys}K fixture`);
      SongSelect.selectedId = m.id; SkinEditor.open();
    }, { skin, keys });
    await page.waitForFunction(keys => SkinEditor.on && GameplayScreen.s?.running && GameplayScreen.s.keys === keys, keys);
    assert.match(await page.locator('.se-tt').textContent(), new RegExp(`${keys}K`));
  }
  async function close() {
    await page.evaluate(() => SkinEditor.close()); await page.waitForFunction(() => !Screens.busy && Screens.currentName !== 'gameplay');
  }
  const read = () => page.evaluate(() => ({ layout: Settings.get('hud.layout'), pp: Settings.get('gameplay.showPp'), alpha: Settings.get('skin.receptorAlpha'), hit: Settings.get('gameplay.hitPositionOffset') }));
  await open('default', 4);
  assert.equal((await read()).layout.sc.s, 1.1); assert.equal((await read()).pp, false); assert.equal((await read()).alpha, 55);
  const expected = new Map();
  for (const [i, [skin, keys]] of [['default', 4], ['default', 7], [imported, 4], [imported, 7]].entries()) {
    if (i) await open(skin, keys);
    if (i) assert.deepEqual(await read(), { layout: {}, pp: true, alpha: 100, hit: 0 }, 'A new combination starts at its own skin defaults');
    await page.evaluate(i => {
      SkinEditor.setPart('sc', { x: -.03 * (i + 1), s: 1.1 + i / 10 });
      SkinEditor.setPart('combo', { x: .02 * i, s: .8 + i / 10 });
      SkinEditor.setPart('background', { y: .02 * (i + 1), s: .9 });
      SkinEditor.setPart('badge', { off: i % 2 === 1 });
      Settings.set('gameplay.showPp', i % 2 === 1);
      SkinEditor.setStage(SkinEditor.stageDef('keyalpha'), i + 55);
      const before = SkinEditor.snapshot(); SkinEditor.previewHit(-10 * (i + 1)); SkinEditor.setHit(-10 * (i + 1), before);
    }, i);
    expected.set(JSON.stringify([skin, keys]), await read()); await close();
  }
  await page.evaluate(async () => Settings.flush()); await page.reload();
  await page.waitForFunction(() => document.querySelector('#loading-screen.done') && !Screens.busy);
  for (const [scope, state] of expected) {
    await open(...JSON.parse(scope));
    assert.deepEqual(await read(), state, 'Reload and real skin/key switches restore the matching layout');
    const rendered = await page.evaluate(() => ({
      scale: GameplayScreen.scoreEl.style.scale, background: GameplayScreen.bgEl.style.translate,
      badgeHidden: GameplayScreen.hud.querySelector('.hud-replay').classList.contains('hl-off'),
      canvasCombo: HudLayout.combo(), audioOffset: Settings.get('audio.offset')
    }));
    assert.ok(Math.abs(+rendered.scale - state.layout.sc.s) < 1e-12); assert.ok(rendered.background.includes('calc('));
    assert.equal(rendered.badgeHidden, !!state.layout.badge?.off); assert.deepEqual(rendered.canvasCombo, state.layout.combo); assert.equal(rendered.audioOffset, 12);
    if (JSON.parse(scope)[0] === imported && JSON.parse(scope)[1] === 4) {
      const all = await page.evaluate(() => Settings.export()['hud.profiles']);
      await page.getByRole('button', { name: 'Reset all', exact: true }).click(); assert.deepEqual((await read()).layout, {});
      await page.getByRole('button', { name: 'Undo', exact: true }).click(); assert.deepEqual(await read(), state);
      assert.deepEqual(await page.evaluate(() => Settings.export()['hud.profiles']), all, 'Undoing reset leaves every saved combination intact');
    }
    const restoredScale = await page.evaluate(() => {
      const profiles = Settings.export()['hud.profiles'];
      profiles[Settings.values['hud.activeProfile']]['hud.layout'].sc.s = 1.65;
      Settings.set('hud.profiles', profiles);
      return +GameplayScreen.scoreEl.style.scale;
    });
    assert.equal(restoredScale, 1.65, 'A restored profile updates the running HUD immediately');
    await close();
  }
  await open('default', 7);
  assert.deepEqual(await page.evaluate(() => Object.values(SkinEditor.groups).map(g => g.open)), [true, false, false]);
  assert.equal(await page.locator('.se-box:not(.se-hitline)').count(), 0, 'Collapsed component sections have no draggable boxes');
  await page.locator('.se-hud > summary').click();
  await page.waitForFunction(() => SkinEditor.boxEls.has('sc'));
  await page.locator('.se-item[data-id=sc]').click();
  assert.equal(await page.evaluate(() => SkinEditor.sel), 'sc');
  await page.locator('.se-advanced > summary').click();
  await page.waitForFunction(() => SkinEditor.boxEls.has('background') && !SkinEditor.boxEls.has('sc'));
  assert.equal(await page.evaluate(() => SkinEditor.sel), null);
  assert.deepEqual(await page.evaluate(() => Object.values(SkinEditor.groups).map(g => g.open)), [false, true, false]);
  await page.evaluate(() => SkinEditor.select('sc')); assert.equal(await page.evaluate(() => SkinEditor.sel), null, 'Collapsed HUD cannot be selected while Advanced is open');
  await page.locator('.se-stage > summary').click();
  await page.waitForFunction(() => !SkinEditor.boxEls.size && !!SkinEditor._hitEl);
  await page.locator('.se-item[data-id=hudoptions]').click();
  assert.equal(await page.getByRole('switch', { name: 'Show performance points counter', exact: true }).count(), 0);
  await page.locator('.se-item[data-id=noteoptions]').click();
  assert.equal(await page.getByRole('slider', { name: 'Note height', exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => GameplayScreen.s.rec.keys), 4, 'A 4K background song can preview 7K');
  assert.equal(await page.locator('.se-item[data-id=noteoff]').count(), 0);
  await page.evaluate(() => { window.editorAudio = Music.source; window.editorGen = Music.gen; window.editorTime = Music.time; SkinEditor.setPart('sc', { s: 1.25 }); Settings.set('gameplay.laneWidth', .85); });
  const keyCount = page.getByRole('combobox', { name: 'Preview key count', exact: true });
  for (const keys of [9, 1, 18, 7]) {
    await keyCount.click(); await page.getByRole('option', { name: `${keys}K`, exact: true }).click();
    await page.waitForFunction(keys => GameplayScreen.s.keys === keys && GameplayScreen.renderer.layout.keys === keys && GameplayScreen.s.engine.columns.length === keys, keys);
    assert.equal(await page.evaluate(() => Settings.get('gameplay.laneWidth')), keys === 7 ? .85 : 1, 'Column width does not transfer to other key counts');
    if (keys !== 7) await page.evaluate(() => Settings.set('gameplay.laneWidth', 1.2));
    const playback = await page.evaluate(() => ({ sameSource: Music.source === window.editorAudio, sameGen: Music.gen === window.editorGen, time: Music.time, running: GameplayScreen.s.running, valid: GameplayScreen.s.baseNotes.every(n => n.col >= 0 && n.col < GameplayScreen.s.keys) }));
    assert.equal(playback.sameSource, true); assert.equal(playback.sameGen, true); assert.equal(playback.running, true); assert.equal(playback.valid, true);
  }
  assert.equal((await read()).layout.sc.s, 1.25, 'Changing columns restores the selected layout');
  assert.equal(await page.evaluate(() => SkinEditor.undo.length), 0, 'Undo history never crosses key counts');
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); GameplayScreen.pauseAway(); GameplayScreen.pause(); GameplayScreen.tapToResume(); GameplayScreen.replayToggle(); });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => GameplayScreen.s.running && Music.playing && Music.time > window.editorTime && !GameplayScreen.pauseEl && !GameplayScreen.tapEl), true, 'Editor interactions and focus changes keep music playing');
  await page.evaluate(() => { window.loopSession = GameplayScreen.s; window.loopEditor = SkinEditor.el; Music.play(Music.duration - 250); });
  await page.waitForFunction(() => Music.time < 1000 && Music.playing, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => GameplayScreen.s === window.loopSession && SkinEditor.el === window.loopEditor && GameplayScreen.s.keys === 7 && GameplayScreen.s.running), true, 'End of song loops without reopening the editor or loader');
  await close();
  await page.evaluate(() => {
    const m = [...BeatmapManager.maps.values()].find(m => m.keys === 4 && !m.problems.length);
    Settings.set('ui.skinEditorKeys', 7); Settings.set('gameplay.unpauseDelay', 0);
    Game.launch({ mapId: m.id, mods: ['NF'], mode: 'play', quick: true });
  });
  await page.waitForFunction(() => GameplayScreen.s?.running && !SkinEditor.on && GameplayScreen.loaderGone);
  await page.evaluate(() => { GameplayScreen.pause(); window.originalPlay = GameplayScreen.s; window.originalEngine = GameplayScreen.s.engine; window.originalPos = Music.pausedPos; window.originalScore = GameplayScreen.s.engine.score.scoreStd; SkinEditor.open(); });
  await page.waitForFunction(() => SkinEditor.on && GameplayScreen.s?.editorPreview && GameplayScreen.s.keys === 7);
  assert.equal(await page.evaluate(() => Music.playing && GameplayScreen.s.running && GameplayScreen.s !== window.originalPlay && window.originalPlay.keys === 4 && window.originalPlay.engine === window.originalEngine), true, 'A paused solo play uses an isolated, playing editor preview');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  assert.equal(await page.evaluate(() => GameplayScreen.s === window.originalPlay && GameplayScreen.s.engine === window.originalEngine && GameplayScreen.s.engine.score.scoreStd === window.originalScore && GameplayScreen.s.keys === 4 && !GameplayScreen.s.running && Math.abs(Music.pausedPos - window.originalPos) < 1 && !!GameplayScreen.pauseEl), true, 'Closing restores the original engine, score, columns and paused position');
  await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.waitForFunction(() => GameplayScreen.s?.running);
  await page.evaluate(() => GameplayScreen.pause());
  assert.equal(await page.evaluate(() => !!GameplayScreen.pauseEl && !GameplayScreen.s.running), true, 'Ordinary gameplay pause still works');
  assert.deepEqual(errors, []);
  console.log('PASS: independent 1K/7K/9K/18K previews, uninterrupted audio source, looping without reload, paused-play isolation/restoration, no Note offset, separate skin layouts and persistence');
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
