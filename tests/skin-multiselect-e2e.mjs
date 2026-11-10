// CHROMIUM_PATH=/usr/bin/chromium node tests/skin-multiselect-e2e.mjs
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
  if (await page.$('.onboarding')) {
    if (await page.$('.setup-choice[data-id=new]')) await page.click('.setup-choice[data-id=new]');
    await page.fill('.onboarding .ob-name', 'GroupTester'); await page.keyboard.press('Enter');
    await page.waitForSelector('.setup-step-wom, .setup-step-mobile'); await page.evaluate(() => Onboarding.finish());
  }
  await page.waitForFunction(() => !Screens.busy);
  const start = { sc: { x: -.02, y: .01, s: 1.1 }, acc: { x: -.05, y: .03, s: .85 }, combo: { x: .04, y: .02, s: 1.2 }, hp: { x: .02, s: 1.25 } };
  await page.evaluate(async start => {
    Settings.set('medals.unlocked', Object.fromEntries(Medals.all.map(m => [m.id, 1]))); Medals.queue.length = 0;
    while (Overlays.top()) Overlays.top().close();
    const blob = await (await fetch('/tests/fixtures/test-set.osz')).blob(); await App.importFiles([new File([blob], 'test-set.osz')]);
    while (Overlays.top()) Overlays.top().close();
    Settings.set('ui.skinEditorAdvanced', false); Settings.set('hud.layout', start); NeruCameo.make = () => null;
    SkinEditor.open();
  }, start);
  await page.waitForFunction(() => SkinEditor.on && GameplayScreen.s?.running, null, { timeout: 30000 });
  await page.locator('.se-hud > summary').click();
  await page.waitForFunction(() => ['sc', 'acc', 'combo'].every(id => SkinEditor.boxEls.has(id)));
  const row = id => page.locator(`.se-l .se-item[data-id="${id}"]`), box = id => page.locator(`.se-box[data-id="${id}"]`);
  const selected = () => page.evaluate(() => SkinEditor.selectionIds());
  const layout = () => page.evaluate(() => Settings.get('hud.layout'));
  const undoCount = () => page.evaluate(() => SkinEditor.undo.length);
  async function drag(id, dx, dy, cancel = false) {
    const b = await box(id).boundingBox(); assert.ok(b, id);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 5 });
    if (cancel) await box(id).dispatchEvent('pointercancel', { pointerId: 1 });
    await page.mouse.up();
  }
  const dimensions = () => page.evaluate(() => { const h = GameplayScreen.hud, r = h.getBoundingClientRect(); return { w: r.width, h: r.height, clientW: h.clientWidth, clientH: h.clientHeight }; });
  function moved(before, after, ids, dx, dy) {
    for (const id of ids) {
      assert.ok(Math.abs((after[id].x || 0) - (before[id]?.x || 0) - dx) < 1e-6, `${id} x`);
      assert.ok(Math.abs((after[id].y || 0) - (before[id]?.y || 0) - dy) < 1e-6, `${id} y`);
      assert.equal(after[id].s, before[id]?.s); assert.equal(after[id].off, before[id]?.off);
    }
  }
  await row('sc').click(); await row('acc').click({ modifiers: ['Shift'] }); await box('combo').click({ modifiers: ['Control'] });
  assert.deepEqual(await selected(), ['sc', 'acc', 'combo']); assert.deepEqual(await layout(), start); assert.equal(await undoCount(), 0);
  await page.waitForFunction(() => document.querySelectorAll('.se-box.on').length === 3);
  assert.equal(await page.locator('.se-item[aria-selected=true]').count(), 3);
  assert.equal(await page.locator('.se-set .se-head').textContent(), '3 items selected');
  assert.equal(await box('sc').locator('.se-handle').isVisible(), false);
  const size = await dimensions(); await drag('sc', 48, 22);
  moved(start, await layout(), ['sc', 'acc', 'combo'], 48 / size.w, 22 / size.h);
  assert.deepEqual((await layout()).hp, start.hp); assert.equal(await undoCount(), 1); assert.equal((await selected()).length, 3);
  await page.keyboard.press('Control+z'); assert.deepEqual(await layout(), start);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
  moved(start, await layout(), ['sc', 'acc', 'combo'], 1 / size.clientW, 10 / size.clientH);
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); assert.deepEqual(await layout(), start);
  await row('acc').click({ modifiers: ['Control'] }); assert.deepEqual(await selected(), ['sc', 'combo']);
  await row('acc').click({ modifiers: ['Shift'] }); assert.deepEqual(await selected(), ['sc', 'combo', 'acc']);
  const undoBeforeCancel = await undoCount(); await drag('sc', 35, 18, true);
  assert.deepEqual(await layout(), start); assert.equal(await undoCount(), undoBeforeCancel);
  assert.equal(await page.evaluate(() => !SkinEditor._dragging && HudLayout.override === null), true);
  await page.keyboard.press('Delete'); const hidden = await layout();
  assert.ok(['sc', 'acc', 'combo'].every(id => hidden[id].off)); assert.deepEqual(hidden.hp, start.hp);
  await page.keyboard.press('Control+z'); assert.deepEqual(await layout(), start);
  await box('sc').click(); assert.deepEqual(await selected(), ['sc']);
  assert.equal(await box('sc').locator('.se-handle').isVisible(), true, 'A plain click without dragging returns to single-item editing');
  await page.keyboard.press('Escape'); assert.deepEqual(await selected(), []); assert.equal(await page.evaluate(() => SkinEditor.on), true);

  // Expanding Advanced clears HUD selection and limits dragging to the scene/stage components.
  await row('sc').click(); await page.locator('.se-advanced > summary').click();
  await row('stageBackground').click({ modifiers: ['Control'] }); await row('background').click({ modifiers: ['Shift'] });
  assert.deepEqual(await selected(), ['stageBackground', 'background']);
  await page.waitForFunction(() => SkinEditor.boxEls.has('stageBackground') && SkinEditor.boxEls.has('background'));
  assert.equal(await box('sc').count(), 0);
  const mixedSize = await dimensions(); await drag('stageBackground', -32, 16);
  const mixed = await layout(); moved(start, mixed, ['stageBackground', 'background'], -32 / mixedSize.w, 16 / mixedSize.h);
  assert.deepEqual(mixed.hp, start.hp);
  assert.deepEqual(mixed.sc, start.sc);
  await page.locator('.se-hud > summary').click();
  assert.deepEqual(await selected(), []);
  await row('sc').click(); await box('sc').locator('.se-handle').waitFor({ state: 'visible' });
  await page.keyboard.press('ArrowLeft'); assert.deepEqual((await layout()).background, mixed.background);

  // Closing during a drag cancels the preview, and saved group positions survive a reload.
  await row('acc').click({ modifiers: ['Control'] }); const saved = await layout();
  const b = await box('sc').boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 25, b.y + b.height / 2 + 12, { steps: 3 });
  await page.evaluate(() => SkinEditor.close()); await page.mouse.up();
  assert.deepEqual(await layout(), saved); assert.equal(await page.evaluate(() => HudLayout.override), null);
  await page.evaluate(async () => Settings.flush()); await page.reload(); await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
  assert.deepEqual(await layout(), saved); assert.deepEqual(errors, []);
  console.log('PASS: Shift/Ctrl canvas/list multi-selection, group dragging/nudging, one-step undo, cancel, mixed components, basic mode and persistence');
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
