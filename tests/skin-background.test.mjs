import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

function setup(layout) {
  const { HudLayout, HUD_PARTS, __ctx: c } = load(['15b-skin-editor.js']);
  const values = { 'hud.layout': layout }, writes = [];
  c.Settings = { values, get: k => values[k], set: (k, v) => { values[k] = v; writes.push(v); } };
  return { HudLayout, HUD_PARTS, values, writes };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('the image, video and storyboard share one editor component', () => {
  const { HUD_PARTS } = setup({}), scenes = HUD_PARTS.filter(p => p.scene);
  assert.equal(scenes.length, 1); assert.equal(scenes[0].id, 'background');
  for (const selector of ['.gp-bg', '.gp-video', '.gp-sb']) assert.ok(scenes[0].sel.includes(selector));
});

test('existing background geometry wins when old scene layouts differ, without changing other HUD items', () => {
  const original = { background: { x: .1, s: .8 }, video: { x: -.2, off: true }, storyboard: { s: 1.2 }, pp: { x: .3 } };
  const t = setup(original), layout = t.HudLayout.get();
  assert.deepEqual(plain(layout), { background: original.background, pp: original.pp });
  assert.ok(original.video && original.storyboard, 'Migration does not mutate the previous settings object');
  assert.equal(t.writes.length, 1); t.HudLayout.get(); assert.equal(t.writes.length, 1, 'Migration is saved once');
});

test('video-only and storyboard-only customizations carry into the shared background control', () => {
  for (const id of ['video', 'storyboard']) {
    const old = { y: -.1, s: 1.2, off: true }, t = setup({ [id]: old });
    assert.deepEqual(plain(t.HudLayout.get()), { background: old });
    assert.equal(t.HudLayout.part('background').off, true);
  }
});

test('default layouts need no migration or writes', () => {
  const t = setup({ pp: { s: 1.1 } }); t.HudLayout.get(); assert.equal(t.writes.length, 0);
});
