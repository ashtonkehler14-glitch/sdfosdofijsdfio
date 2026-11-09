// CHROMIUM_PATH=/usr/bin/chromium node tests/skin-layout-e2e.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'), root = new URL('../', import.meta.url);
const { PNG } = createRequire(import.meta.url)('pngjs');
const server = createServer((req, res) => {
  const path = req.url.split('?')[0]; if (path.includes('..')) { res.writeHead(403).end(); return; }
  for (const p of [path === '/' ? 'index.html' : path.slice(1), 'public' + path]) try { const data = readFileSync(new URL(p, root)); res.setHeader('content-type', path === '/' ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); res.end(data); return; } catch {}
  res.writeHead(404).end();
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r)); let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
  if (await page.$('.onboarding')) { if (await page.$('.setup-choice[data-id=new]')) await page.click('.setup-choice[data-id=new]'); await page.fill('.onboarding .ob-name', 'LayoutTester'); await page.keyboard.press('Enter'); await page.waitForSelector('.setup-step-wom, .setup-step-mobile'); await page.evaluate(() => Onboarding.finish()); }
  await page.waitForFunction(() => !Screens.busy);
  await page.evaluate(async () => {
    Settings.set('medals.unlocked', Object.fromEntries(Medals.all.map(m => [m.id, 1]))); Medals.queue.length = 0;
    while (Overlays.top()) Overlays.top().close(); const blob = await (await fetch('/tests/fixtures/test-set.osz')).blob(); await App.importFiles([new File([blob], 'test-set.osz')]); while (Overlays.top()) Overlays.top().close();
  });
  const identity = await page.evaluate(() => {
    const go = Screens.go, back = ProfileScreen.backParams, remote = ProfileScreen.remote; let sent;
    Screens.go = (name, params) => { sent = params.score; }; ProfileScreen.backParams = () => ({}); ProfileScreen.remote = null;
    ProfileScreen.scoreRow({ remote: true, grade: 'S', score: 987654, pp: 123, title: 'Test', artist: 'Artist', version: 'Hard', mods: [], date: Date.now() }, 123).click();
    Screens.go = go; ProfileScreen.backParams = back; ProfileScreen.remote = remote;
    return { player: sent.player, id: sent.id, expected: Presence.pid() };
  });
  assert.equal(identity.player, 'LayoutTester'); assert.equal(identity.id, 'o-' + identity.expected);
  const settings = await page.evaluate(() => {
    const hidden = SETTINGS_SCHEMA.filter(x => x.g === 'HUD' || ['gameplay.hitPositionOffset', 'gameplay.noteOffset'].includes(x.k)).every(x => x.x);
    const notes = ['gameplay.laneWidth', 'gameplay.noteHeight', 'gameplay.noteBorderWidth', 'gameplay.noteBorderColor'].every(k => { const x = SETTINGS_SCHEMA.find(x => x.k === k); return x.s === 'Skin' && x.g === 'Custom skin' && !!x.when; });
    return { hidden, notes };
  }); assert.deepEqual(settings, { hidden: true, notes: true });
  await page.evaluate(() => RenderScale.root.append(h('div#resolution-probe', { style: { position: 'fixed', left: 0, top: 0, width: '600px', height: '70px', zIndex: 99999, background: '#000', color: '#fff', font: '24px Arial' } }, 'Resolution sample 123456789')));
  const fullPixels = PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width: 600, height: 70 } })).data;
  const res = await page.evaluate(async () => {
    const el = document.querySelector('#app'), before = el.getBoundingClientRect(), dpr = Zoom.dpr(); Settings.set('graphics.renderScale', .5); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const after = el.getBoundingClientRect(); return { before: [before.width, before.height], after: [after.width, after.height], ratio: Zoom.dpr() / dpr, scale: RenderScale.root.dataset.resolutionScale };
  });
  assert.equal(res.ratio, .5); assert.equal(res.scale, '0.5'); assert.ok(Math.abs(res.before[0] - res.after[0]) < 2 && Math.abs(res.before[1] - res.after[1]) < 2, JSON.stringify(res));
  const halfPixels = PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width: 600, height: 70 } })).data;
  assert.ok(!fullPixels.equals(halfPixels), 'Menu text is actually rasterized at the chosen density, not just assigned cancelling CSS transforms');
  await page.evaluate(() => document.querySelector('#resolution-probe').remove());
  await page.evaluate(() => { Settings.set('graphics.renderScale', 1); Settings.set('gameplay.healthStyle', 'stage'); Settings.set('gameplay.showPp', false); Settings.set('gameplay.showHealth', false); SkinEditor.open(); });
  await page.waitForFunction(() => SkinEditor.on && GameplayScreen.s?.running && SkinEditor.boxEls.has('pp') && SkinEditor.boxEls.has('hp'), null, { timeout: 30000 });
  assert.ok(await page.locator('.se-item[data-id=pp]').count()); assert.ok(await page.locator('.se-item[data-id=hp]').count());
  const before = await page.evaluate(() => ({ hp: { ...GameplayScreen.renderer._hudRects.hp }, W: GameplayScreen.renderer.W, H: GameplayScreen.renderer.H }));
  await page.evaluate(() => { SkinEditor.setShown(HUD_PARTS.find(x => x.id === 'hp'), true); SkinEditor.setPart('hp', { x: .1, y: -.1, s: 1.3 }); SkinEditor.setShown(HUD_PARTS.find(x => x.id === 'pp'), true); SkinEditor.setPart('pp', { x: -.1, y: .1, s: 1.2 }); });
  await page.waitForFunction(() => Settings.get('hud.layout').hp?.s === 1.3 && GameplayScreen.renderer._hudRects.hp?.w > 0);
  const after = await page.evaluate(() => ({ hp: GameplayScreen.renderer._hudRects.hp, pp: GameplayScreen.ppEl.style.translate, layout: Settings.get('hud.layout') }));
  assert.ok(after.hp.x > before.hp.x + before.W * .05, JSON.stringify({ before, after })); assert.ok(after.hp.w > before.hp.w);
  assert.ok(after.pp.includes('calc')); assert.equal(after.layout.pp.s, 1.2);
  await page.evaluate(() => SkinEditor.select('stageBackground')); await page.waitForFunction(() => SkinEditor.boxEls.has('stageBackground'));
  await page.evaluate(() => SkinEditor.setPart('stageBackground', { x: .03, y: .02, s: .9 }));
  await page.evaluate(() => SkinEditor.select('noteoptions')); await page.getByRole('slider', { name: 'Note height', exact: true }).waitFor();
  await page.evaluate(() => SkinEditor.select('hudoptions')); await page.getByRole('switch', { name: 'Show performance points counter', exact: true }).waitFor();
  await page.evaluate(() => SkinEditor.close());
  await page.waitForFunction(() => !Screens.busy && Screens.currentName !== 'gameplay');
  await page.evaluate(async () => {
    const blob = await (await fetch('/tests/fixtures/chemuss.osk')).blob(); await SkinManager.importOsk(new File([blob], 'chemuss.osk'));
    await SkinManager.select(SkinManager.skins.find(s => /chemuss/i.test(s.name)).id); Settings.set('gameplay.healthStyle', 'skinstage'); SkinEditor.open();
  });
  await page.waitForFunction(() => SkinEditor.on && GameplayScreen.renderer?._hudRects.stageLeft && GameplayScreen.renderer._hudRects.hp && GameplayScreen.s?.running);
  const sideBefore = await page.evaluate(() => ({ ...GameplayScreen.renderer._hudRects.stageLeft }));
  await page.evaluate(() => { SkinEditor.select('stageLeft'); SkinEditor.setPart('stageLeft', { x: -.1, y: .03, s: 1.4 }); });
  await page.waitForFunction(() => GameplayScreen.renderer._hudRects.stageLeft?.w > 0 && SkinEditor.boxEls.has('stageLeft'));
  const sideAfter = await page.evaluate(() => ({ ...GameplayScreen.renderer._hudRects.stageLeft }));
  assert.ok(sideAfter.x < sideBefore.x && sideAfter.w > sideBefore.w, JSON.stringify({ sideBefore, sideAfter }));
  const crop = await page.evaluate(() => {
    const r = GameplayScreen.renderer, img = document.createElement('canvas'); img.width = 1800; img.height = 90;
    r.layout.tex.stageBottom = { w: img.width, h: img.height, img };
    SkinEditor.setPart('stageBottom', { x: .1, s: 1.5 });
    const width = img.width * r.u * 1.6, x = (r.stageW - width) / 2 + .1 * r.W, end = x + width * 1.5, margins = r._cropMargins();
    return { left: margins[0], right: margins[1], expectedLeft: -x, expectedRight: end - r.stageW };
  });
  assert.ok(crop.left >= crop.expectedLeft && crop.right >= crop.expectedRight, JSON.stringify(crop));
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/skin-editor-layout.png' });
  await page.evaluate(async () => { SkinEditor.close(); await Settings.flush(); });
  await page.reload(); await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
  assert.deepEqual(await page.evaluate(() => { const l = Settings.get('hud.layout'); return [l.pp.s, l.hp.s, l.stageLeft.s, l.stageBottom.s]; }), [1.2, 1.3, 1.4, 1.5]);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(async () => { Settings.set('graphics.renderScale', .5); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const b = document.querySelector('#app').getBoundingClientRect(); return Math.abs(b.width - innerWidth) < 2 && Math.abs(b.height - innerHeight) < 2; }), true);
  assert.deepEqual(errors, []); console.log('PASS: canonical profile score owner, settings organization, desktop/mobile resolution scale, pp/health editing, imported skin graphics, crop bounds and layout persistence');
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
