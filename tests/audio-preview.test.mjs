import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

test('streamed speed and pitch changes preserve position, including ramps and reset', async () => {
  const { Music } = load(['00-util.js', '05-audio.js']);
  Music.el = { currentTime: 42, playbackRate: 1, preservesPitch: true, webkitPreservesPitch: true };
  Music.playing = true;
  await Music.setRate(1.5, true, null, { live: true });
  assert.equal(Music.el.playbackRate, 1.5); assert.equal(Music.el.preservesPitch, true);
  await Music.setRate(.75, false, null, { live: true });
  assert.equal(Music.el.playbackRate, .75); assert.equal(Music.el.preservesPitch, false);
  assert.equal(Music.el.webkitPreservesPitch, false);
  Music.rampTo(1.23);
  assert.equal(Music.el.playbackRate, 1.23); assert.equal(Music.rate, 1.23);
  assert.equal(Music.time, 42000);
  await Music.setRate(1, true, null, { live: true });
  assert.equal(Music.el.playbackRate, 1); assert.equal(Music.el.preservesPitch, true);
});

test('live decoded rate changes retain the old clock position and stale stretches cannot overwrite them', async () => {
  const { Music, TimeStretch, AudioManager } = load(['00-util.js', '05-audio.js']);
  AudioManager.now = () => 12;
  Music.buffer = {}; Music.key = 'track'; Music.rate = 1; Music.startCtx = 10; Music.startPos = 30000; Music.playing = true;
  const plays = []; Music.play = (pos, opts) => plays.push({ pos, opts, rate: Music.rate, stretched: Music.stretched });
  const pending = [];
  TimeStretch.stretch = () => new Promise(resolve => pending.push(resolve));
  const slow = Music.setRate(.75, true, null, { live: true });
  const fast = Music.setRate(1.5, true, null, { live: true });
  const buffer = { name: 'new stretch' }; pending[1](buffer);
  assert.equal(await fast, true);
  assert.equal(plays[0].pos, 32000); assert.equal(plays[0].rate, 1.5); assert.equal(plays[0].stretched, buffer);
  pending[0]({ name: 'obsolete' }); assert.equal(await slow, false);
  assert.equal(Music.stretched, buffer); assert.equal(plays.length, 1);
  const otherTrack = Music.setRate(.75, true);
  Music.buffer = { name: 'another song' }; Music._seq = 1;
  pending[2]({}); assert.equal(await otherTrack, false);
  assert.equal(plays.length, 1);
});

function songSelectAudio() {
  const env = load(['00-util.js', '05-audio.js', '08-mods.js', '14-screen-songselect.js']);
  const { Music, SongSelect, AudioManager, __ctx } = env;
  const settings = { 'songselect.mods': [], 'audio.preservePitch': true, 'mods.config': {} };
  const map = { id: 'map', setId: 'set', audioFile: 'song.ogg', firstNote: 1000, lastNote: 101000 };
  __ctx.Settings = { get: key => settings[key] };
  __ctx.Screens = { currentName: 'songselect' };
  __ctx.BeatmapManager = { maps: new Map([['map', map]]) };
  const timers = [];
  __ctx.setInterval = fn => { timers.push(fn); return timers.length; }; __ctx.clearInterval = () => {};
  Music.el = { currentTime: 51, playbackRate: 1, preservesPitch: true };
  Music.key = 'set/song.ogg'; Music.meta = { mapId: 'map', timing: [{ time: 0, beatLength: 500, meter: 4 }] }; Music.playing = true;
  const volumes = [], ticks = []; AudioManager.modVolume = v => volumes.push(v);
  AudioManager.synth = name => name; AudioManager.play = b => ticks.push(b);
  return { ...env, __ctx, settings, map, timers, volumes, ticks };
}

test('song select uses gameplay speed and pitch rules for DT/HT/NC/DC/custom speed and no mods', async () => {
  const { SongSelect, Music, settings } = songSelectAudio();
  for (const [mods, rate, pitch] of [[['DT'], 1.5, true], [['NC'], 1.5, false], [['HT'], .75, true], [['DC'], .75, false], [['RT'], 1.35, true], [[], 1, true]]) {
    settings['songselect.mods'] = mods; settings['mods.config'] = { rate: 1.35 };
    assert.equal(await SongSelect.syncPreviewAudio(), true);
    assert.equal(Music.el.playbackRate, rate); assert.equal(Music.el.preservesPitch, pitch); assert.equal(Music.time, 51000);
  }
  settings['audio.preservePitch'] = false; settings['songselect.mods'] = ['DT'];
  await SongSelect.syncPreviewAudio(); assert.equal(Music.el.preservesPitch, false);
});

test('Wind Up/Down follow beatmap progress; Muted previews respect settings and metronome', async () => {
  const { SongSelect, Music, settings, volumes, ticks, timers } = songSelectAudio();
  settings['songselect.mods'] = ['WU']; await SongSelect.syncPreviewAudio();
  assert.equal(Music.el.playbackRate, 1.25); assert.equal(Music.el.preservesPitch, false);
  Music.el.currentTime = 101; timers.at(-1)(); assert.equal(Music.el.playbackRate, 1.5);
  Music.el.currentTime = 51; settings['songselect.mods'] = ['WD']; await SongSelect.syncPreviewAudio();
  assert.equal(Music.el.playbackRate, .875);
  settings['songselect.mods'] = ['MU']; settings['mods.config'] = { muInverse: 1 }; await SongSelect.syncPreviewAudio();
  assert.equal(volumes.at(-1), 0); assert.equal(ticks.at(-1), 'metronome-lo');
  settings['mods.config'] = { muCount: 0, muMetronome: 0 }; const n = ticks.length;
  await SongSelect.syncPreviewAudio(); assert.equal(volumes.at(-1), 0); assert.equal(ticks.length, n);
  settings['songselect.mods'] = []; await SongSelect.syncPreviewAudio(); assert.equal(volumes.at(-1), 1);
});

test('a selected difficulty sharing the current audio supplies its own ramp timing', async () => {
  const { SongSelect, Music, settings, map, __ctx } = songSelectAudio();
  const selected = { ...map, id: 'other-difficulty', lastNote: 201000 };
  __ctx.BeatmapManager.maps.set(selected.id, selected); SongSelect.selectedId = selected.id;
  settings['songselect.mods'] = ['WU']; await SongSelect.syncPreviewAudio();
  assert.equal(Music.el.playbackRate, 1.125);
  // Searching can select a different song while the old one keeps playing: mods still affect what is heard.
  __ctx.BeatmapManager.maps.set('search-result', { ...selected, id: 'search-result', audioFile: 'other.ogg' });
  SongSelect.selectedId = 'search-result'; await SongSelect.syncPreviewAudio();
  assert.equal(Music.el.playbackRate, 1.25);
});
