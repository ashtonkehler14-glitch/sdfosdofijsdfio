// CHROMIUM_PATH=/usr/bin/chromium node tests/mobile-column-alignment-e2e.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 591 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }), errors = [];
  await page.addInitScript(() => localStorage.setItem('am.noInstallPrompt', '1'));
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
  if (await page.$('.onboarding')) {
    if (await page.$('.setup-choice[data-id=new]')) await page.click('.setup-choice[data-id=new]');
    await page.fill('.onboarding .ob-name', 'MobileTester'); await page.keyboard.press('Enter');
    await page.waitForSelector('.setup-step-wom, .setup-step-mobile'); await page.evaluate(() => Onboarding.finish());
  }
  await page.waitForFunction(() => !Screens.busy);
  const result = await page.evaluate(async () => {
    while (Overlays.top()) Overlays.top().close();
    const skin = SkinManager.skins.find(s => /kori/i.test(s.name));
    if (!skin) throw new Error('Bundled Kori skin must be installed');
    await SkinManager.select(skin.id);
    Settings.set('gameplay.mobileLayout', 'expanded'); Settings.set('gameplay.laneWidth', 1);
    Settings.set('gameplay.hitLighting', true); Settings.set('skin.effects', true); Settings.set('skin.receptorAlpha', 100);
    Settings.set('gameplay.noteHeight', 1); Settings.set('gameplay.noteOffset', 0); Settings.set('gameplay.hitPositionOffset', 0);
    Settings.set('gameplay.noteBorderWidth', 0); Settings.set('input.keyOverlay', false);
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:1280px;height:591px'; document.body.append(canvas);
    const r = new ManiaRenderer(canvas), ctx = r.ctx, cases = [];
    function measure(draw) {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, r.H); draw();
      const w = Math.ceil(r.colW[0]), pixels = ctx.getImageData(0, 0, w, r.H).data;
      let first = -1, last = -1;
      for (let y = 0; y < r.H; y++) {
        let max = 0; for (let x = 0; x < w; x++) max = Math.max(max, pixels[(y * w + x) * 4 + 3]);
        if (max > 30) { if (first < 0) first = y; last = y; }
      }
      if (first < 0) throw new Error('No visible pixels in alignment measurement');
      return (first + last) / 2;
    }
    for (const keys of [4, 7, 9]) for (const scale of [1, .6]) for (const direction of ['down', 'up']) {
      Settings.set('gameplay.scrollDirection', direction); r.autoScale = scale; r.setLayout(await SkinManager.current.mania(keys));
      if (!r.fnf || !r.legacy) throw new Error('Expected touch layout with imported skin');
      for (let c = 1; c < keys; c++) if (Math.abs(r.colX[c] - r.colX[c - 1] - r.colW[c - 1]) > 1e-8) throw new Error('A gap remains between columns');
      const held = Array(keys).fill(false), texture = r.layout.tex.note[0], nh = r._noteH(texture, 0);
      const note = measure(() => r._noteImg(texture.frameAt(0), 0, r.hitY - nh, r.colW[0], nh, r.fl.note[0]));
      const receptor = measure(() => r._drawKeys({ held }, 1000));
      const effect = { type: 'N', col: 0, t0: 920 }; r.effects = [effect]; r._lastN = [effect]; r._holdFx = [];
      const hit = measure(() => r._drawLighting({ engine: { holding: [] } }, 1000));
      r.effects = []; r._holdFx = [{ on: true, t0: 800, t1: -1e9 }];
      const hold = measure(() => r._drawLighting({ engine: { holding: [true] } }, 1000));
      const tolerance = 2.5;
      if (Math.abs(hit - note) > tolerance || Math.abs(receptor - note) > tolerance || Math.abs(hold - note) > tolerance) throw new Error('Mobile hit feedback is misaligned: ' + JSON.stringify({ keys, scale, direction, note, receptor, hit, hold }));
      cases.push({ keys, scale, direction, note, receptor, hit, hold });
    }
    // A representative expanded frame for visual review, with a tap flash and a held note.
    Settings.set('gameplay.scrollDirection', 'down'); r.autoScale = 1; r.setLayout(await SkinManager.current.mania(4)); r.healthMode = null;
    const notes = [0, 1, 2, 3].map(col => ({ col, time: col === 2 ? 1150 : 1000, end: col === 1 ? 2500 : col === 2 ? 1150 : 1000, isLN: col === 1 }));
    const engine = new GameplayEngine({ notes, keys: 4, windows: timingWindows(), noFail: true, hpMult: 1 }); engine.input(1, true, 1000);
    const effect = { type: 'N', col: 0, t0: 920 }; r.effects = [effect]; r._lastN = [effect];
    r._holdFx = [null, { on: true, t0: 800, t1: -1e9 }];
    const scroll = new ScrollMap([{ time: 0, pos: 0, vel: 1 }]);
    r.render({ now: 1000, realNow: 1000, scroll, posNow: 1000, pxPerMs: r.scrollLength / (11485 / 20), engine, held: [false, true, false, false], hidden: null, percy: 0, flashlight: 0 });
    const screenshot = canvas.toDataURL('image/png'); r.dispose(); canvas.remove();
    return { cases, screenshot };
  });
  if (process.env.SHOT_DIR) { mkdirSync(process.env.SHOT_DIR, { recursive: true }); writeFileSync(process.env.SHOT_DIR + '/expanded-mobile-columns.png', Buffer.from(result.screenshot.split(',')[1], 'base64')); }
  delete result.screenshot;
  assert.deepEqual(errors, []); assert.equal(result.cases.length, 12);
  console.log('PASS: adjoining mobile lanes and pixel-aligned note/receptor/hit/hold feedback', JSON.stringify(result));
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
