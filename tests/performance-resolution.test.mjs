import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function setup(values = {}) {
  const ctx = vm.createContext({ console, performance, addEventListener() {} });
  const files = ['00-util.js', '06-settings.js', '08-mods.js', '09-gameplay.js', '09a-osu-math.js', '10-renderer.js', '15-screen-gameplay.js', '18b-setup.js'];
  vm.runInContext(files.map(f => readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8')).join('\n') + '\n;this.S = Settings; this.G = GameplayScreen; this.devices = SETUP_DEVICES;', ctx);
  ctx.document = { hidden: false }; ctx.Zoom = { dpr: () => 1 };
  ctx.S.values = values; ctx.S.set = (k, v) => { values[k] = v; };
  const G = Object.create(ctx.G); let resized = 0;
  G.renderer = { autoScale: .6, resize() { resized++; } }; G._work = 25; G._displayMs = 1000 / 60;
  return { ctx, S: ctx.S, G, values, resizes: () => resized };
}

test('Performance mode suppresses automatic resolution without losing the saved preference or manual render scale', () => {
  const { S, values } = setup({ 'graphics.performanceMode': true, 'graphics.autoScale': true, 'graphics.renderScale': .75 });
  assert.equal(S.get('graphics.autoScale'), false); assert.equal(S.get('graphics.renderScale'), .75);
  assert.equal(values['graphics.autoScale'], true); assert.equal(S.get('graphics.bgQuality'), 'low');
  assert.equal(S.get('gameplay.hitLighting'), false); assert.equal(S.get('skin.effects'), false);
  assert.equal(S.schema.get('graphics.autoScale').when(), false);
  values['graphics.performanceMode'] = false;
  assert.equal(S.get('graphics.autoScale'), true); assert.equal(S.schema.get('graphics.autoScale').when(), true);
});

test('the Performance setup profile keeps automatic resolution off', () => {
  const { ctx } = setup(), settings = ctx.devices.chromebook.values();
  assert.equal(settings['graphics.performanceMode'], true); assert.equal(settings['graphics.autoScale'], false);
  assert.equal(settings['gameplay.video'], false);
});

test('old low-resolution cache is ignored in Performance mode, including sustained slow frames', () => {
  const { G, values, resizes } = setup({ 'graphics.performanceMode': true, 'graphics.autoScale': true, 'perf.autoScale': .6 });
  G._asPending = 'old downscaling notice'; G._asToast = true; G.initAutoScale();
  assert.equal(G._as.on, false); assert.equal(G._as.scale, 1); assert.equal(G.renderer.autoScale, 1);
  assert.equal(G._asPending, null); assert.equal(G._asToast, false);
  for (let t = 1000; t < 9000; t += 45) G.adaptResolution(45, t, 0);
  assert.equal(G.renderer.autoScale, 1); assert.equal(resizes(), 0); assert.equal(values['perf.autoScale'], .6);
});

test('normal mode still honours automatic resolution and turning it off restores full sharpness', () => {
  const { G, values, resizes } = setup({ 'graphics.performanceMode': false, 'graphics.autoScale': true, 'perf.autoScale': 1 });
  G.initAutoScale();
  for (let t = 1000; t < 6000; t += 45) G.adaptResolution(45, t, 0);
  assert.ok(G.renderer.autoScale < 1); assert.ok(resizes() > 0);
  values['graphics.autoScale'] = false; G.initAutoScale(); assert.equal(G.renderer.autoScale, 1); assert.equal(G._as.on, false);
});
