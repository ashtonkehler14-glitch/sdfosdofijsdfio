// CHROMIUM_PATH=/usr/bin/chromium node tests/render-smoothness-e2e.mjs
// Optional: BASELINE_RENDERER=/path/to/previous-10-renderer.js compares the previous renderer in the same browser.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
  if (await page.$('.onboarding')) {
    if (await page.$('.setup-choice[data-id=new]')) await page.click('.setup-choice[data-id=new]');
    await page.fill('.onboarding .ob-name', 'SmoothnessTester'); await page.keyboard.press('Enter');
    await page.waitForSelector('.setup-step-wom, .setup-step-mobile'); await page.evaluate(() => Onboarding.finish());
  }
  await page.waitForFunction(() => !Screens.busy);
  if (process.env.BASELINE_RENDERER) await page.addScriptTag({ content: 'window.RenderBaseline = (() => {\n' + readFileSync(process.env.BASELINE_RENDERER, 'utf8') + '\nreturn ManiaRenderer;})();' });
  const result = await page.evaluate(async () => {
    while (Overlays.top()) Overlays.top().close();
    Settings.set('audio.autoplay', false); Settings.set('gameplay.noteBorderWidth', 2); Settings.set('gameplay.noteBorderColor', '#0066cc');
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:720px'; document.body.append(canvas);
    const layout = await SkinManager.current.mania(4), r = new ManiaRenderer(canvas); r.setLayout(layout);
    // An asymmetrical, translucent tile makes texture-phase errors visible in both directions.
    const img = document.createElement('canvas'); img.width = 16; img.height = 7;
    const p = img.getContext('2d'); p.fillStyle = '#28c4aacc'; p.fillRect(0, 0, 16, 7); p.fillStyle = '#ff44aa'; p.fillRect(0, 1, 10, 2); p.fillStyle = '#ffffff'; p.fillRect(11, 4, 5, 3);
    const tex = { w: 16, h: 7, img, frames: [img], frameAt: () => img };
    const ctx = r.ctx, H = r.H;
    function reference(tex, x, w, top, bottom, style, realNow, flip = false) {
      const th = Math.max(2, tex.h * (w / tex.w));
      this.ctx.save(); this.ctx.beginPath(); this.ctx.rect(x, this.up ? this.H - bottom : top, w, bottom - top); this.ctx.clip();
      if (style === 2) { for (let y = bottom - th; y > top - th; y -= th) this._img(tex.img, x, y, w, th, flip); }
      else { for (let y = top; y < bottom; y += th) this._img(tex.img, x, y, w, th, flip); }
      this.ctx.restore();
    }
    r.legacy = false;
    let pixelCases = 0, nonEmptyCases = 0, maxDifference = 0;
    for (const up of [false, true]) for (const flip of [false, true]) for (const style of [1, 2]) {
      r.up = up;
      for (const [top, bottom] of [[-10000.125, H - 40.5], [-13.75, H + 2000.5], [123.375, H - 145.25], [-500, -10], [H + 10, H + 200]]) {
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, H);
        reference.call(r, tex, 20, 31.3, top, bottom, style, 0, flip);
        const expected = ctx.getImageData(18, 0, 37, H).data;
        if (expected.some(v => v !== 0)) nonEmptyCases++;
        ctx.clearRect(0, 0, canvas.width, H); r._drawBody(tex, 20, 31.3, top, bottom, style, 0, flip);
        const actual = ctx.getImageData(18, 0, 37, H).data;
        let diff = 0; for (let i = 0; i < actual.length; i++) diff = Math.max(diff, Math.abs(actual[i] - expected[i]));
        if (diff > 1) throw new Error('Hold pixels changed: ' + JSON.stringify({ up, flip, style, top, bottom, diff }));
        maxDifference = Math.max(maxDifference, diff); pixelCases++;
      }
    }
    // First tap/head/tail draw must not create its custom outline after loader-time prewarming.
    r.setLayout(layout);
    const create = document.createElement; let created = 0;
    document.createElement = function (name, ...args) { if (name === 'canvas') created++; return create.call(this, name, ...args); };
    try {
      for (let c = 0; c < layout.keys; c++) for (const [tex, flip] of [[layout.tex.note[c], r.fl.note[c]], [layout.tex.noteH[c], r.fl.head[c]], [layout.tex.noteT[c], r.fl.tail[c]]]) {
        if (tex) for (const frame of tex.frames) r._noteImg(frame, r.colX[c], 100.375, r.colW[c], r._noteH(tex, c), flip);
      }
    } finally { document.createElement = create; }
    // Prove note motion keeps fractional pixels even at reduced resolution, in both directions.
    let motionCases = 0;
    for (const scale of [1, .6]) for (const up of [false, true]) for (const hz of [60, 144, 240]) {
      r.autoScale = scale; r.resize(true); r.up = up;
      const tex = layout.tex.note[0], positions = [], draw = ctx.drawImage;
      ctx.drawImage = function (...args) { positions.push(args[2]); return draw.apply(this, args); };
      try { for (let i = 0; i < 30; i++) r._noteImg(tex.frames[0], r.colX[0], 200.125 + i * .371 * 1000 / hz, r.colW[0], r._noteH(tex, 0), r.fl.note[0]); }
      finally { ctx.drawImage = draw; }
      const expected = .371 * 1000 / hz * (up ? -1 : 1);
      for (let i = 1; i < positions.length; i++) if (Math.abs(positions[i] - positions[i - 1] - expected) > 1e-8) throw new Error('Note motion was pixel-snapped');
      motionCases++;
    }
    r.autoScale = 1; r.resize(true); r.legacy = false; r.up = false;
    const results = [];
    for (const baseline of window.RenderBaseline ? [true, false] : [false]) {
      const body = baseline ? RenderBaseline.prototype._drawBody : r._drawBody, original = r._img;
      let calls = 0; r._img = function (...args) { calls++; return original.apply(this, args); };
      const times = [];
      try {
        for (let frame = 0; frame < 24; frame++) {
          const start = performance.now();
          ctx.clearRect(0, 0, canvas.width, r.H);
          for (let c = 0; c < 8; c++) body.call(r, tex, 20 + c * 40, 31.3, -20000.125 + frame * 2.375, r.H - 30.125, c % 2 + 1, 0);
          times.push(performance.now() - start);
        }
      } finally { r._img = original; }
      times.sort((a, b) => a - b); results.push({ baseline, drawCallsPerFrame: calls / 24, medianSubmitMs: times[12], p95SubmitMs: times[22] });
    }
    r.destroy?.(); canvas.remove();
    return { pixelCases, nonEmptyCases, maxDifference, motionCases, firstNoteCanvasAllocations: created, results };
  });
  assert.equal(result.firstNoteCanvasAllocations, 0, 'Outlines are prepared before their first note appears');
  assert.equal(result.nonEmptyCases, 24, 'Visual comparisons must include actual visible hold pixels');
  if (result.results.length === 2) assert.ok(result.results[1].drawCallsPerFrame < result.results[0].drawCallsPerFrame / 10);
  assert.deepEqual(errors, []); console.log('PASS: pixel parity, prewarmed outlines and subpixel motion', JSON.stringify(result));
  if (process.env.PERF_RESULT) writeFileSync(process.env.PERF_RESULT, JSON.stringify(result, null, 2) + '\n');
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
