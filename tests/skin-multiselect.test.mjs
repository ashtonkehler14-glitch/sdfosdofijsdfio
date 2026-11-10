import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

function setup(layout = {}) {
  const { SkinEditor, __ctx: ctx } = load(['15b-skin-editor.js']);
  const values = { 'hud.layout': layout }, editor = Object.create(SkinEditor);
  ctx.Settings = { values, get: k => values[k], set: (k, v) => { values[k] = v; } };
  ctx.GameplayScreen = { hud: null, renderer: { resize() {} } };
  editor.selection = new Set(); editor.sel = null; editor.undo = []; editor.advanced = false;
  editor.paintList = editor.paintSettings = () => {};
  return { editor, values, ctx };
}
const plain = v => JSON.parse(JSON.stringify(v));

test('Shift/Ctrl/Command toggle HUD items; plain list selection replaces the group', () => {
  const { editor: e } = setup();
  e.select('sc'); e.selectEvent('acc', { shiftKey: true }); e.selectEvent('combo', { ctrlKey: true }); e.selectEvent('hp', { metaKey: true });
  assert.deepEqual(Array.from(e.selectionIds()), ['sc', 'acc', 'combo', 'hp']);
  e.selectEvent('acc', { ctrlKey: true }); assert.deepEqual(Array.from(e.selectionIds()), ['sc', 'combo', 'hp']);
  e.selectEvent('hp', { shiftKey: true }); assert.equal(e.sel, 'combo');
  e.select('pp'); assert.deepEqual(Array.from(e.selectionIds()), ['pp']); assert.equal(e.sel, 'pp');
  e.selectEvent('pp', { ctrlKey: true }); assert.deepEqual(Array.from(e.selectionIds()), []); assert.equal(e.sel, null);
});

test('starting a drag on a selected box preserves the group; a new box replaces it', () => {
  const { editor: e } = setup(); e.select('sc'); e.select('acc', { toggle: true });
  e.select('sc', { preserve: true }); assert.deepEqual(Array.from(e.selectionIds()), ['sc', 'acc']); assert.equal(e.sel, 'sc');
  e.select('combo', { preserve: true }); assert.deepEqual(Array.from(e.selectionIds()), ['combo']);
});

test('group translation keeps spacing, scales, visibility and unrelated parts without mutating its start snapshot', () => {
  const { editor: e } = setup();
  const start = { sc: { x: .1, y: -.2, s: 1.2 }, combo: { x: -.3, y: .4, s: .8, off: true }, hp: { x: .7 } };
  const result = e.translatedLayout(start, ['sc', 'combo'], .05, -.025);
  assert.ok(Math.abs((result.sc.x - result.combo.x) - (start.sc.x - start.combo.x)) < 1e-12);
  assert.ok(Math.abs((result.sc.y - result.combo.y) - (start.sc.y - start.combo.y)) < 1e-12);
  assert.deepEqual(plain(result.hp), start.hp);
  assert.equal(result.combo.s, .8); assert.equal(result.combo.off, true); assert.equal(result.sc.s, 1.2);
  assert.deepEqual(start.sc, { x: .1, y: -.2, s: 1.2 });
});

test('a group move is saved and undone in one step, restoring the exact prior layout', () => {
  const original = { sc: { x: .1 }, combo: { y: .2 }, hp: { s: 1.3 } };
  const { editor: e, values } = setup(original); e.select('sc'); e.select('combo', { toggle: true });
  e.commit(e.translatedLayout(e.layout(), e.selectionIds(), .08, .04));
  assert.equal(e.undo.length, 1); assert.ok(Math.abs(values['hud.layout'].combo.y - .24) < 1e-12);
  e.undoStep(); assert.deepEqual(plain(values['hud.layout']), original); assert.equal(e.undo.length, 0);
  assert.deepEqual(Array.from(e.selectionIds()), ['sc', 'combo']);
});

test('group hide affects every selected part and preserves other layout fields, with one undo', () => {
  const original = { sc: { x: .1 }, combo: { y: .2, s: .7 }, hp: { s: 1.3 } };
  const { editor: e, values } = setup(original); e.select('sc'); e.select('combo', { toggle: true }); e.hideSelection();
  assert.equal(values['hud.layout'].sc.off, true); assert.equal(values['hud.layout'].combo.off, true);
  assert.deepEqual(plain(values['hud.layout'].hp), original.hp); assert.equal(e.undo.length, 1);
  e.undoStep(); assert.deepEqual(plain(values['hud.layout']), original);
});

test('stage controls and appearance settings stay single selections; basic mode rejects advanced items', () => {
  const { editor: e } = setup(); e.select('sc'); e.selectEvent('hitpos', { ctrlKey: true });
  assert.deepEqual(Array.from(e.selectionIds()), []); assert.equal(e.sel, 'hitpos');
  e.select('sc'); e.selectEvent('background', { shiftKey: true }); assert.deepEqual(Array.from(e.selectionIds()), ['sc']);
  e.select('hudoptions'); assert.deepEqual(Array.from(e.selectionIds()), []); assert.equal(e.sel, 'hudoptions');
  e.advanced = true; e.select('background'); e.select('sc', { toggle: true }); assert.deepEqual(Array.from(e.selectionIds()), ['background', 'sc']);
  e.select(null); assert.deepEqual(Array.from(e.selectionIds()), []); assert.equal(e.sel, null);
});
