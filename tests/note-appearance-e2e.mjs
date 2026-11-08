// Focused browser checks for note geometry, outlines, settings persistence and visual-only Percy.
// CHROMIUM_PATH=/usr/bin/chromium node tests/note-appearance-e2e.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
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
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.AshtonkMania?.App);
  const result = await page.evaluate(async () => {
    const S = AshtonkMania.Settings;
    const c = document.createElement('canvas'); c.width = 200; c.height = 300;
    const r = new ManiaRenderer(c, { touch: false });
    r.s = 1; r.H = 300; r._tx = 0; r.colW = [40]; r._noteRefW = 40; r.womD = 1;
    r.layout = { widthForNoteHeightScale: 0 };
    const tex = { w: 40, h: 20 };
    await S.set('gameplay.noteHeight', 1);
    const baseHeight = r._noteH(tex, 0);
    await S.set('gameplay.noteHeight', 1.5);
    const tallHeight = r._noteH(tex, 0), receptorHeight = r._noteH(tex, 0, false);
    const img = document.createElement('canvas'); img.width = img.height = 10;
    const x = img.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(2, 2, 6, 6);
    await S.set('gameplay.noteBorderWidth', 2); await S.set('gameplay.noteBorderColor', '#ff0000');
    const outline = r._outlinedNote(img, 10, 10);
    const pixel = (cv, x, y) => [...cv.getContext('2d').getImageData(x, y, 1, 1).data];
    const edge = pixel(outline.img, 2, 6), center = pixel(outline.img, 6, 6), transparent = pixel(outline.img, 0, 0);
    const cached = outline === r._outlinedNote(img, 10, 10);
    // Borders follow nontransparent pixels; bars render in either scroll direction without moving their timing edge.
    const bars = [];
    for (const up of [false, true]) {
      r.up = up; r.ctx.clearRect(0, 0, 200, 300); r._womNoteBar(20, 100, 40, 30, '#ffffff');
      bars.push(pixel(c, 40, up ? 215 : 85)[3] > 0);
    }
    // Positive Percy shortens the drawing, negative extends it. The engine note's end is untouched.
    const tails = [];
    r.layout = { keys: 1, tex: { note: [null], noteH: [null], noteL: [null], noteT: [null] } };
    r.colX = [0]; r.colW = [40]; r._y0 = 250;
    r._drawLN = (_c, _x, _w, head, tail) => tails.push([head, tail]);
    const ends = [];
    for (const percy of [150, -150, 0]) {
      const n = { time: 100, end: 200, isLN: true, state: NS.PENDING };
      r._drawNotes({ engine: { columns: [[n]], ptr: [0] }, scroll: { pos: t => t, posAt: t => t }, pxPerMs: 1, percy }, 0);
      ends.push(n.end);
    }
    AshtonkMania.SettingsPanel.open();
    const hasControls = ['Note height', 'Note border thickness', 'Note border colour', 'Column width (lane width)'].every(l => document.querySelector(`[aria-label="${l}"]`));
    const rows = ModSelect.configRows(['PC']);
    const slider = rows[0].querySelector('input'); slider.value = '-250'; slider.dispatchEvent(new Event('input'));
    await S.flush();
    return { baseHeight, tallHeight, receptorHeight, edge, center, transparent, cached, bars, tails, ends, hasControls, percyMin: slider.min, percy: S.get('mods.config').percy };
  });
  assert.equal(result.baseHeight, 20); assert.equal(result.tallHeight, 30); assert.equal(result.receptorHeight, 20);
  assert.deepEqual(result.edge, [255, 0, 0, 255]); assert.deepEqual(result.center, [255, 255, 255, 255]);
  assert.equal(result.transparent[3], 0); assert.equal(result.cached, true); assert.deepEqual(result.bars, [true, true]);
  assert.deepEqual(result.tails, [[150, 150], [150, -100], [150, 50]]); assert.deepEqual(result.ends, [200, 200, 200]);
  assert.equal(result.hasControls, true); assert.equal(result.percyMin, '-500'); assert.equal(result.percy, -250);
  await page.reload(); await page.waitForFunction(() => window.AshtonkMania?.Settings);
  const saved = await page.evaluate(() => [AshtonkMania.Settings.get('gameplay.noteHeight'), AshtonkMania.Settings.get('gameplay.noteBorderColor'), AshtonkMania.Settings.get('mods.config').percy]);
  assert.deepEqual(saved, [1.5, '#ff0000', -250]);
  console.log('PASS: note height, shape outlines, cache, scroll directions, Percy, UI and persistence');
} finally { await browser?.close(); server.closeAllConnections(); server.close(); }
