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
    Settings.set('gameplay.showPp', false); Settings.set('gameplay.noteOffset', 5); Settings.set('audio.offset', 12);
    NeruCameo.make = () => null;
    return meta.id;
  });
  async function open(skin, keys) {
    await page.evaluate(async ({ skin, keys }) => {
      NeruCameo.make = () => null;
      await SkinManager.select(skin);
      const m = [...BeatmapManager.maps.values()].find(m => m.keys === keys && !m.problems.length);
      if (!m) throw new Error(`Missing ${keys}K fixture`);
      SongSelect.selectedId = m.id; SkinEditor.open();
    }, { skin, keys });
    await page.waitForFunction(keys => SkinEditor.on && GameplayScreen.s?.running && GameplayScreen.s.keys === keys, keys);
    assert.match(await page.locator('.se-tt').textContent(), new RegExp(`${keys}K`));
  }
  async function close() {
    await page.evaluate(() => SkinEditor.close()); await page.waitForFunction(() => !Screens.busy && Screens.currentName !== 'gameplay');
  }
  const read = () => page.evaluate(() => ({ layout: Settings.get('hud.layout'), pp: Settings.get('gameplay.showPp'), note: Settings.get('gameplay.noteOffset'), hit: Settings.get('gameplay.hitPositionOffset') }));
  await open('default', 4);
  assert.equal((await read()).layout.sc.s, 1.1); assert.equal((await read()).pp, false); assert.equal((await read()).note, 5);
  const expected = new Map();
  for (const [i, [skin, keys]] of [['default', 4], ['default', 7], [imported, 4], [imported, 7]].entries()) {
    if (i) await open(skin, keys);
    if (i) assert.deepEqual(await read(), { layout: {}, pp: true, note: 0, hit: 0 }, 'A new combination starts at its own skin defaults');
    await page.evaluate(i => {
      SkinEditor.setPart('sc', { x: -.03 * (i + 1), s: 1.1 + i / 10 });
      SkinEditor.setPart('combo', { x: .02 * i, s: .8 + i / 10 });
      SkinEditor.setPart('background', { y: .02 * (i + 1), s: .9 });
      SkinEditor.setPart('badge', { off: i % 2 === 1 });
      Settings.set('gameplay.showPp', i % 2 === 1);
      SkinEditor.setStage(SkinEditor.stageDef('noteoff'), i + 5);
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
  assert.deepEqual(errors, []);
  console.log('PASS: separate Custom/imported 4K/7K GUI, legacy migration, rendered DOM/canvas/scene settings, stage previews, scoped reset/undo and reload persistence');
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
