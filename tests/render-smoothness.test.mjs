import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function setup() {
  const values = {}, writes = [];
  const ctx = vm.createContext({ console, performance, addEventListener() {}, document: { hidden: false, addEventListener() {} },
    Settings: { get: k => values[k], set: (k, v) => { values[k] = v; writes.push([k, v]); } }, Zoom: { dpr: () => 1 },
    Music: { gen: 1, playing: true } });
  const files = ['00-util.js', '08-mods.js', '09-gameplay.js', '09a-osu-math.js', '10-renderer.js', '15-screen-gameplay.js'];
  vm.runInContext(files.map(f => readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8')).join('\n') + '\n;this.G = GameplayScreen; this.R = ManiaRenderer; this.S = ScrollMap;', ctx);
  return { ctx, G: Object.create(ctx.G), R: ctx.R, values, writes };
}

test('tiled hold work is bounded by visible height while preserving the original texture phase', () => {
  const { R } = setup(), tex = { w: 17, h: 3.7, frames: [{}], frameAt: () => ({}) };
  for (const style of [1, 2]) for (const up of [false, true]) for (const [top, bottom] of [[-100000.125, 701.25], [-13.75, 10000.5], [100.125, 412.375], [-500, -10], [800, 2000]]) {
    const drawn = [], r = Object.create(R.prototype);
    r.ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {} }; r.H = 720; r.up = up;
    r._img = (img, x, y, w, h) => drawn.push([y, h]);
    r._drawBody(tex, 0, 31, top, bottom, style, 0);
    const th = Math.max(2, tex.h * 31 / tex.w), expected = [];
    if (style === 2) { for (let y = bottom - th; y > top - th; y -= th) if (y <= 720 && y + th > 0) expected.push(y); }
    else { for (let y = top; y < bottom; y += th) if (y + th > 0 && y < 720) expected.push(y); }
    assert.ok(drawn.length <= Math.ceil(720 / th) + 2, `${top}…${bottom}: ${drawn.length}`);
    if (bottom <= 0 || top >= 720) { assert.equal(drawn.length, 0); continue; }
    assert.equal(drawn.length, expected.length, JSON.stringify({ style, top, bottom, first: drawn[0], expectedFirst: expected[0] }));
    for (let i = 0; i < drawn.length; i++) assert.ok(Math.abs(drawn[i][0] - expected[i]) < 1e-6, 'visible tiles must keep their anchor');
  }
});

test('legacy and stretched hold bodies retain their original drawing paths', () => {
  const { R } = setup(), tex = { frames: [{}], frameAt: () => ({}) };
  for (const legacy of [false, true]) for (const style of [0, 1, 2]) {
    if (!legacy && style) continue;
    const calls = [], r = Object.create(R.prototype); r.legacy = legacy; r.u = 1;
    r._img = (...args) => calls.push(['stretch', ...args.slice(1)]);
    r._imgTop = (...args) => calls.push(['legacy', ...args.slice(1)]);
    r._drawBody(tex, 10, 30, -10000, 650, style, 0);
    assert.equal(calls.length, 1); assert.equal(calls[0][0], style ? 'legacy' : 'stretch');
    assert.deepEqual(calls[0].slice(1, 5), [10, -10000, 30, 10650]);
  }
});

test('mobile hit/hold lighting follows the resized lane while retaining authored skin offsets', () => {
  const { R, values } = setup(), r = Object.create(R.prototype);
  values['gameplay.laneWidth'] = 1;
  r.layout = { columnWidth: [72, 48] }; r.s = 591 / 480; r.u = 591 / 768; r.legacy = true;
  const t = { w: 230 }, widths = [0, 0]; r.fnf = true;
  for (const size of [80, 134, 180]) {
    r.colW = [size, size];
    for (const c of [0, 1]) {
      const w = r._lightW(t, c, widths);
      assert.ok(Math.abs(w / t.w - size / 48) < 1e-12);
      // Kori's flash silhouette is 24 texture pixels above the texture centre. It must remain half a note
      // above the hit anchor when its lane is resized, just as it is in the original skin.
      assert.ok(Math.abs(-24 * w / t.w - -size / 2) < 1e-12);
    }
  }
});

test('desktop lighting keeps native dimensions; explicit mobile flash widths keep their proportion', () => {
  const { R, values } = setup(), r = Object.create(R.prototype);
  values['gameplay.laneWidth'] = 1.25;
  r.layout = { columnWidth: [72] }; r.s = 1.5; r.u = 1.5 / 1.6; r.legacy = true; r.colW = [180];
  const t = { w: 230 };
  for (const width of [0, 30, 90]) {
    const native = t.w * r.u * (width || 72 * 1.25) / 30;
    r.fnf = false; assert.equal(r._lightW(t, 0, [width]), native);
    r.fnf = true; assert.equal(r._lightW(t, 0, [width]), native * (180 / (72 * 1.5 * 1.25)));
  }
});

function resolution({ hz = 60, dt = 1000 / hz, limit = 0, on = true, work = 3 } = {}) {
  const { G, values } = setup(); values['graphics.renderScale'] = 1;
  G._refresh = 1000 / hz; G._work = work; G._displayMs = 1000 / 60; G._refreshSamples = []; G._refreshAt = 0;
  for (let t = 0; t < 1000; t += 1000 / hz) G.sampleRefresh(1000 / hz, t);
  G._as = { on, scale: 1, times: [], work: [], t0: 0, bad: 0, smooth: 0, windows: 0, capped: 0 };
  let resizes = 0; G.renderer = { resize() { resizes++; } };
  for (let t = 1000, i = 0; t < 5400; i++) {
    const interval = typeof dt === 'function' ? dt(i) : dt;
    G._refresh += (Math.min(50, Math.max(2, interval)) - G._refresh) * .1;
    G.sampleRefresh(interval, t); G.adaptResolution(interval, t, limit); t += interval;
  }
  return { scale: G._as.scale, resizes, G };
}

test('automatic resolution responds to missed refreshes on 120/144/165/240Hz screens', () => {
  for (const hz of [120, 144, 165, 240]) for (const limit of [0, hz]) {
    const result = resolution({ hz, dt: 2000 / hz, limit });
    assert.ok(result.scale < 1, `${hz}Hz limit ${limit}: skipped every other refresh`);
    assert.ok(result.resizes > 0);
  }
});

test('stable high refresh rendering and intentional FPS caps do not lower resolution', () => {
  for (const hz of [60, 120, 144, 165, 240]) for (const limit of [0, hz]) assert.equal(resolution({ hz, limit }).scale, 1);
  const capped = resolution({ hz: 144, limit: 60, dt: i => (i % 5 < 3 ? 2 : 3) * 1000 / 144 });
  assert.equal(capped.scale, 1, '60 fps on a 144Hz screen necessarily alternates refresh counts');
});

test('slow-device fallback, disabled scaling and browser battery caps keep working', () => {
  assert.ok(resolution({ hz: 30, dt: 40, work: 20 }).scale < 1, 'overloaded devices still target at least 60');
  assert.equal(resolution({ hz: 144, dt: 2000 / 144, on: false }).scale, 1);
  assert.equal(resolution({ hz: 60, dt: 1000 / 30, work: 1 }).scale, 1, 'resolution cannot fix a browser-imposed battery cap');
});

test('missed refreshes retain the established cadence; a single short callback cannot invent a faster display', () => {
  const { G } = setup(); G._displayMs = 1000 / 60; G._refreshSamples = []; G._refreshAt = 0;
  G.sampleRefresh(2.1, 1000);
  for (let t = 1016; t < 4000; t += 1000 / 60) G.sampleRefresh(1000 / 60, t);
  assert.equal(G._displayMs, 1000 / 60);
  for (let t = 4000; t < 6000; t += 1000 / 144) G.sampleRefresh(1000 / 144, t);
  assert.equal(G._displayMs, 1000 / 144);
  for (let t = 6000; t < 10000; t += 2000 / 144) G.sampleRefresh(2000 / 144, t);
  assert.equal(G._displayMs, 1000 / 144, 'a long run of missed frames must not halve the FPS goal');
});

test('lazer-style scrolling follows display timestamps at 60–360Hz and every playback rate', () => {
  for (const hz of [60, 120, 144, 165, 240, 360]) for (const rate of [.5, 1, 1.5, 2]) {
    const { G } = setup(); G.s = { rate }; G.offsetMs = () => 0; G.gameTime = ts => ts * rate;
    const dt = 1000 / hz; let previous = G.frameTime(1000);
    for (let i = 1; i <= 500; i++) {
      const t = G.frameTime(1000 + i * dt);
      assert.ok(Math.abs(t - previous - dt * rate) < 1e-8, `${hz}Hz ${rate}x`); previous = t;
    }
  }
});

test('visual clock smooths stepped audio readings and resets on seeks, pauses and offsets', () => {
  const { G, ctx } = setup(); G.s = { rate: 1 }; let offset = 0;
  G.offsetMs = () => offset; G.gameTime = ts => Math.floor(ts / 20) * 20;
  let previous = G.frameTime(1000);
  for (let i = 1; i < 500; i++) {
    const ts = 1000 + i * 1000 / 144, t = G.frameTime(ts);
    assert.ok(t >= previous, 'a waiting source cannot move backwards');
    if (i > 4) assert.ok(t > previous, 'notes must keep moving between audio updates once interpolation starts');
    assert.ok(Math.abs(t - G.gameTime(ts)) < 34); previous = t;
  }
  ctx.Music.gen++; G.gameTime = () => 500; assert.equal(G.frameTime(5000), 500, 'a replay seek resets interpolation');
  ctx.Music.playing = false; assert.equal(G.frameTime(5100), 500); assert.equal(G.frameTime(5200), 500);
  ctx.Music.playing = true; offset = 20; G.gameTime = () => 480;
  assert.equal(G.frameTime(5300), 480, 'changing offset applies immediately');
});

const lazerReference = JSON.parse(readFileSync(new URL('fixtures/lazer-render/reference.json', import.meta.url)));

test('visual clock matches the pinned lazer gameplay reference, including 80ms damping and source re-arming', () => {
  assert.equal(lazerReference.frameworkPackage, '2026.1030.0');
  for (const trace of lazerReference.clocks) {
    const { G } = setup(); G.s = {}; G.offsetMs = () => 0;
    for (const [ts, rate, source, expected, interpolating] of trace.frames) {
      G.s.rate = rate; G.gameTime = () => source;
      assert.ok(Math.abs(G.frameTime(ts) - expected) < 1e-9, `${trace.name} @ ${ts}`);
      assert.equal(G._vc.interpolating, interpolating, `${trace.name} interpolation @ ${ts}`);
    }
  }
});

test('repeated or stale browser frame timestamps cannot move notes backwards or restart interpolation', () => {
  const { G, ctx } = setup(); G.s = { rate: 1 }; G.offsetMs = () => 0; G.gameTime = ts => ts;
  assert.equal(G.frameTime(1000), 1000);
  assert.equal(G.frameTime(1010), 1010); assert.equal(G._vc.interpolating, true);
  assert.equal(G.frameTime(1005), 1010); assert.equal(G.frameTime(1010), 1010);
  assert.equal(G._vc.ts, 1010); assert.equal(G._vc.interpolating, true);
  assert.equal(G.frameTime(1020), 1020);
  ctx.Music.gen++; assert.equal(G.frameTime(500), 500, 'explicit backward seeks still reset the clock');
});

test('render frame scroll distances match lazer across speed, rate, BPM/SV segments and stops', () => {
  const { ctx, G, R, values } = setup();
  const points = lazerReference.points;
  let pos = 0;
  const segments = points.map(([time, vel], i) => {
    if (i) pos += (time - points[i - 1][0]) * points[i - 1][1];
    return { time, vel, pos };
  });
  const scroll = new ctx.S(segments), renderer = Object.create(R.prototype);
  renderer.layout = { columnWidth: [64] }; renderer.colScale = 1;
  let frame; renderer.render = g => { frame = g; }; G.renderer = renderer;
  for (const [height, rate, speed, now, noteTime, expected] of lazerReference.scrolls) {
    renderer.H = height; renderer.s = height / 480;
    G.s = { scroll, rate }; values['gameplay.scrollSpeed'] = speed;
    G.stillFrame(now);
    const actual = (scroll.posAt(noteTime) - frame.posNow) * frame.pxPerMs;
    assert.ok(Math.abs(actual - expected) <= Math.max(1e-5, Math.abs(expected) * 1e-7), JSON.stringify({ height, rate, speed, now, actual, expected }));
  }
});
