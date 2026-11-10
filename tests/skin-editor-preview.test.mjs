import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const plain = v => JSON.parse(JSON.stringify(v));

test('the editor remembers its own 1K–18K choice, independently of the background song', () => {
  const { SkinEditor: E, __ctx: c } = load(['15b-skin-editor.js']);
  let chosen;
  c.Settings = { get: () => chosen }; c.GameplayScreen = { s: { keys: 7, rec: { keys: 7 } } };
  assert.equal(E.keyCount(), 4);
  for (const keys of [1, 4, 9, 18]) { chosen = keys; assert.equal(E.keyCount(), keys); }
  for (const invalid of [0, 19, -2, 7.5, 'broken']) { chosen = invalid; assert.equal(E.keyCount(), 4); }
});

test('preview column conversion merges chords and trims holds without changing beatmap notes or samples', () => {
  const { SkinEditor: E, __ctx: c } = load(['15b-skin-editor.js']);
  c.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const notes = [
    { col: 0, time: 100, end: 500, isLN: true, sample: { name: 'tap' } },
    { col: 3, time: 100, end: 100, isLN: false },
    { col: 1, time: 300, end: 300, isLN: false },
    { col: 2, time: 450, end: 800, isLN: true }
  ], saved = structuredClone(notes);
  const one = plain(E.previewNotes(notes, 4, 1));
  assert.deepEqual(one.map(n => [n.col, n.time, n.end, n.isLN]), [[0, 100, 299, true], [0, 300, 300, false], [0, 450, 800, true]]);
  for (const keys of [1, 4, 7, 18]) {
    const out = E.previewNotes(notes, 4, keys);
    assert.ok(out.every(n => Number.isInteger(n.col) && n.col >= 0 && n.col < keys));
    assert.deepEqual(plain(out[0].sample), notes[0].sample);
  }
  assert.deepEqual(notes, saved);
});

test('Note offset is removed from the editor, settings and both global and per-layout imports', async () => {
  const { Settings: S, SkinEditor: E, __ctx: c } = load(['00-util.js', '06-settings.js', '15b-skin-editor.js']);
  const old = { 'gameplay.noteOffset': 9, 'wom.noteOffset': -30, 'hud.profiles': { '["default",4]': { 'gameplay.noteOffset': 7, 'wom.noteOffset': 21, 'hud.layout': { combo: { s: 1.2 } } } } };
  const clean = plain(S.clean(old));
  assert.equal(S.schema.has('gameplay.noteOffset'), false); assert.equal(S.schema.has('wom.noteOffset'), false);
  assert.equal(E.stageDef('noteoff'), undefined);
  assert.deepEqual(clean, { 'hud.profiles': { '["default",4]': { 'hud.layout': { combo: { s: 1.2 } } } } });
  assert.equal(old['hud.profiles']['["default",4]']['gameplay.noteOffset'], 7, 'Import cleaning preserves its input');
  c.DB = { kvGet: async () => structuredClone(old) }; S.applyUI = () => {};
  await S.load();
  assert.equal(Object.hasOwn(S.values, 'gameplay.noteOffset'), false);
  assert.equal(Object.hasOwn(S.values['hud.profiles']['["default",4]'], 'wom.noteOffset'), false);
});

test('editor previews ignore pause triggers while ordinary solo games still pause', () => {
  const c = vm.createContext({ console, addEventListener() {}, J: { MARV: 0, PERF: 1, GREAT: 2, GOOD: 3, BAD: 4, MISS: 5 } });
  vm.runInContext(readFileSync(new URL('../src/js/15-screen-gameplay.js', import.meta.url), 'utf8') + '\nthis.G = GameplayScreen;', c);
  const g = Object.create(c.G); let paused = 0;
  c.Music = { pause() { paused++; } }; c.SkinManager = { sample: async () => {} }; c.Spectate = { hostAct() {} };
  g.params = { skinEditor: true }; g.s = { running: true }; g.releaseAll = g.showPause = () => {}; g.gameTime = () => 0;
  for (const fn of ['pause', 'pauseAway', 'tapToResume', 'replayToggle']) g[fn]();
  assert.equal(paused, 0); assert.equal(g.s.running, true);
  g.params.skinEditor = false; g.s.editorPreview = true;
  for (const fn of ['pause', 'pauseAway', 'tapToResume', 'replayToggle']) g[fn]();
  assert.equal(paused, 0);
  g.s.editorPreview = false; g.pause(); assert.equal(paused, 1); assert.equal(g.s.running, false);
});

test('appearance settings exclude Note height and controls already available beside each component', () => {
  const { SkinEditor: E, Settings: S, HUD_PARTS } = load(['00-util.js', '06-settings.js', '15b-skin-editor.js']);
  assert.equal(S.schema.has('gameplay.noteHeight'), false);
  assert.equal(Object.hasOwn(S.clean({ 'gameplay.noteHeight': 2 }), 'gameplay.noteHeight'), false);
  for (const row of E.appearanceRows(true)) assert.equal(HUD_PARTS.some(p => p.setting === row.k), false, row.k);
  assert.ok(E.appearanceRows(true).some(row => row.k === 'gameplay.healthStyle'));
  assert.ok(E.appearanceRows(true).some(row => row.k === 'gameplay.progressDisplay'));
  assert.ok(E.appearanceRows(false).every(row => row.k !== 'gameplay.noteHeight'));
});

test('opening an editor section clears prior selection and only exposes that section for movement', () => {
  const { SkinEditor, __ctx: c } = load(['15b-skin-editor.js']);
  const e = Object.create(SkinEditor);
  e.groups = { stage: { open: true }, advanced: { open: false }, hud: { open: false } };
  e.sceneGroup = { scrollIntoView() {} }; e.selection = new Set(['sc']); e.sel = 'sc';
  e.el = { classList: { remove() {}, toggle() {} }, querySelector() {} }; e.paintList = e.paintSettings = e.frame = () => {};
  e.setSection('advanced');
  assert.deepEqual(Array.from(e.selection), []); assert.equal(e.sel, null);
  assert.deepEqual(Object.values(e.groups).map(g => g.open), [false, true, false]);
  assert.ok(e.parts().every(p => p.advanced)); e.select('sc'); assert.equal(e.sel, null);
  e.setSection('hud'); assert.ok(e.parts().every(p => !p.advanced));
  e.select('sc'); assert.equal(e.sel, 'sc'); e.select('background'); assert.equal(e.sel, 'sc');
  e.setSection('stage'); assert.equal(e.parts().length, 0); e.select('hitpos'); assert.equal(e.sel, 'hitpos');
  e.setSection(null); assert.equal(e.parts().length, 0); assert.equal(e.sel, null);
});
