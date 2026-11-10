import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const plain = v => JSON.parse(JSON.stringify(v));
function setup(values = {}) {
  const { Settings: S, HudLayout, SkinEditor, Sync, Bus, __ctx: ctx } = load(['00-util.js', '06-settings.js', '15b-skin-editor.js', '19o-sync.js']);
  S.values = structuredClone(values); S.applyUI = () => {};
  // Persistence is explicit in these tests; no real debounce timers or browser APIs are needed.
  ctx.setTimeout = () => 0; ctx.clearTimeout = () => {};
  let saved;
  ctx.DB = { kvSet: async (k, v) => { saved = structuredClone(v); }, kvGet: async () => saved };
  ctx.AudioManager = { applyVolumes() {} };
  ctx.GameplayScreen = { s: { keys: 4 }, hud: null, renderer: { resize() {} } };
  ctx.Toast = { show() {} };
  const e = Object.create(SkinEditor); e.undo = []; e.paintList = e.paintSettings = () => {};
  return { S, HudLayout, e, Sync, Bus, ctx };
}

test('legacy layout and HUD appearance move to the first actual skin/key count only', () => {
  const legacy = { score: { x: .12, s: 1.3 }, video: { y: -.08 } };
  const { S, HudLayout: H } = setup({ 'hud.layout': legacy, 'gameplay.showPp': false, 'gameplay.hitPositionOffset': -23, 'audio.offset': 14 });
  S.useGui('skin-A', 7);
  assert.deepEqual(plain(H.get()), { sc: legacy.score, acc: legacy.score, pp: legacy.score, mods: legacy.score, background: legacy.video });
  assert.equal(S.get('gameplay.showPp'), false); assert.equal(S.get('gameplay.hitPositionOffset'), -23);
  assert.equal(Object.hasOwn(S.values, 'hud.layout'), false);
  const kept = S.export(); S.useGui('skin-B', 7);
  assert.deepEqual(plain(H.get()), {}); assert.equal(S.get('gameplay.showPp'), true); assert.equal(S.get('gameplay.hitPositionOffset'), 0);
  assert.equal(S.get('audio.offset'), 14);
  S.useGui('skin-A', 4); assert.deepEqual(plain(H.get()), {});
  S.useGui('skin-A', 7); assert.deepEqual(plain(S.export()['hud.profiles']), plain(kept['hud.profiles']));
});

test('each skin and key count restores independent DOM, canvas, background and visibility settings', () => {
  const { S, HudLayout: H } = setup();
  const layouts = new Map();
  for (const skin of ['default', 'skin-A', 'skin-B']) for (const keys of [1, 4, 7, 9, 18]) {
    S.useGui(skin, keys);
    assert.deepEqual(plain(H.get()), {}); assert.equal(H.combo(), null);
    const layout = { sc: { x: keys / 100 }, combo: { s: keys / 10 }, background: { y: -keys / 100 }, hp: { off: keys % 2 === 1 } };
    S.set('hud.layout', layout); S.set('gameplay.progressDisplay', keys === 4 ? 'bar' : 'pie');
    layouts.set(JSON.stringify([skin, keys]), layout);
  }
  for (const [scope, expected] of layouts) {
    S.useGui(...JSON.parse(scope));
    assert.deepEqual(plain(H.get()), expected); assert.deepEqual(plain(H.combo()), expected.combo);
    assert.deepEqual(plain(H.part('hp')), expected.hp); assert.deepEqual(plain(H.part('background')), expected.background);
    assert.equal(S.get('gameplay.progressDisplay'), JSON.parse(scope)[1] === 4 ? 'bar' : 'pie');
  }
});

test('preview, save, undo and reset only touch the current combination', () => {
  const { S, HudLayout: H, e } = setup();
  S.useGui('skin-A', 7); S.set('hud.layout', { combo: { x: .12, s: .8 } }); S.set('gameplay.noteOffset', 9);
  const other = plain(S.values['hud.profiles']);
  S.useGui('skin-A', 4);
  e.setPart('combo', { s: 1.4 }); e.setPart('sc', { y: .2 });
  e.undoStep(); assert.deepEqual(plain(H.get()), { combo: { s: 1.4 } });
  const before = e.snapshot(), d = e.HIT;
  e.preview(d, -34); assert.equal(S.get(d.key), -34);
  e.setStage(d, -34, before); e.undoStep(); assert.equal(S.get(d.key), 0);
  e.resetAll(); assert.deepEqual(plain(H.get()), {});
  e.undoStep(); assert.equal(H.combo().s, 1.4);
  S.reset('hud.layout'); assert.deepEqual(plain(H.get()), {});
  S.set('gameplay.showPp', false); S.reset('gameplay.showPp'); assert.equal(S.get('gameplay.showPp'), true);
  assert.deepEqual(plain(S.values['hud.profiles']['["skin-A",7]']), other['["skin-A",7]']);
  S.useGui('skin-A', 7); assert.equal(H.combo().s, .8); assert.equal(S.get('gameplay.noteOffset'), 9);
});

test('settings export/import retains every combination and sync preserves the local active combination', async () => {
  const { S, Sync, Bus } = setup(); const dirty = [];
  Bus.on('settings:changed', k => dirty.push(k));
  S.useGui('default', 4); S.set('hud.layout', { sc: { x: -.2 } });
  S.useGui('default', 7); S.set('hud.layout', { sc: { x: .3 } }); await S.flush();
  const saved = S.export(); await S.import(saved);
  assert.equal(S.get('hud.layout').sc.x, .3); S.useGui('default', 4); assert.equal(S.get('hud.layout').sc.x, -.2);
  assert.ok(dirty.includes('hud.profiles'), 'Profile edits notify account sync');
  assert.equal(Sync.local('hud.activeProfile'), true); assert.equal(Sync.local('hud.profiles'), false);
  await Sync.apply({ ...saved, 'hud.activeProfile': '["default",7]' });
  assert.equal(S.values['hud.activeProfile'], '["default",4]'); assert.equal(S.get('hud.layout').sc.x, -.2);
});

test('restoring an imported skin with a different local id brings all of its key-count layouts', () => {
  const { S } = setup();
  S.useGui('remote-skin', 4); S.set('hud.layout', { combo: { s: 1.2 } });
  S.useGui('remote-skin', 7); S.set('hud.layout', { sc: { x: .3 } });
  S.useGui('unrelated', 4); S.set('hud.layout', { hp: { off: true } });
  S.remapGuiSkin('remote-skin', 'local-skin');
  S.useGui('local-skin', 4); assert.equal(S.get('hud.layout').combo.s, 1.2);
  S.useGui('local-skin', 7); assert.equal(S.get('hud.layout').sc.x, .3);
  S.useGui('unrelated', 4); assert.equal(S.get('hud.layout').hp.off, true);
  assert.equal(Object.hasOwn(S.values['hud.profiles'], '["remote-skin",4]'), false);
});
