import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

function native() {
  const { TabViewCapture: T, __ctx: c } = load(['19q0-view-budget.js', '19qc-tab-view.js']);
  let valid = true, privateNow = false;
  const calls = [], target = {}, track = { enabled: true, kind: 'video', contentHint: '', stopped: false, getSettings: () => ({ displaySurface: 'browser' }), cropTo: async value => { calls.push(['crop', value]); }, applyConstraints: async value => { calls.push(['constraints', value]); }, stop() { this.stopped = true; } };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  c.navigator = { mediaDevices: { getDisplayMedia: async options => { calls.push(['picker', options]); return stream; } } };
  c.CropTarget = { fromElement: async () => target }; c.BrowserCaptureMediaStreamTrack = function () {}; c.BrowserCaptureMediaStreamTrack.prototype.cropTo = () => {};
  c.document = { documentElement: {} }; c.location = { origin: 'https://game.test', protocol: 'https:' }; c.window = { addEventListener() {}, removeEventListener() {} }; c.innerWidth = 1440; c.innerHeight = 960;
  return { T, c, calls, track, target, create: onended => T.create(() => valid, () => privateNow, onended), cancel: () => { valid = false; }, privacy: x => { privateNow = x; } };
}

test('exact view requests only a browser tab and verifies this document before returning a disabled track', async () => {
  const t = native(), s = await t.create();
  try {
    assert.equal(t.calls[0][0], 'picker'); assert.equal(t.calls[0][1].audio, false);
    assert.equal(t.calls[0][1].monitorTypeSurfaces, 'exclude'); assert.equal(t.calls[0][1].video.frameRate.max, 30);
    assert.equal(t.calls[1][0], 'crop'); assert.equal(t.calls[1][1], t.target);
    assert.equal(s.native, true); assert.equal(s.track.enabled, false);
    s.setPaused(false); assert.equal(s.track.enabled, true);
    t.privacy(true); s.setPaused(false); assert.equal(s.track.enabled, false);
    t.privacy(false); s.setPaused(true); assert.equal(s.track.enabled, false);
  } finally { s.stop(); }
  assert.equal(t.track.stopped, true);
});

test('selecting another tab, window or an unsupported surface cannot enter exact view', async () => {
  for (const wrongWindow of [true, false]) {
    const t = native();
    if (wrongWindow) t.track.getSettings = () => ({ displaySurface: 'window' });
    else t.track.cropTo = async () => { throw new Error('Target belongs to another tab'); };
    await assert.rejects(t.create(), /current game tab/); assert.equal(t.track.stopped, true); assert.equal(t.track.enabled, false);
  }
});

test('a session stopped while the browser picker is open releases the selected stream', async () => {
  const t = native(); t.cancel(); assert.equal(await t.create(), null); assert.equal(t.track.stopped, true);
});

test('the browser Stop action is honored while current-tab verification is still pending', async () => {
  const t = native(); let ended = 0;
  t.track.cropTo = async () => { t.track.onended(); };
  assert.equal(await t.create(() => { ended++; t.cancel(); }), null);
  assert.equal(ended, 1); assert.equal(t.track.stopped, true);
});

test('unsupported clients retain the lightweight view without opening a browser picker', async () => {
  const t = native(); t.c.CropTarget = undefined; assert.equal(t.T.supported(), false);
  await assert.rejects(t.create(), /lightweight view/); assert.equal(t.calls.length, 0);
});

test('a matching browser capture handle avoids a redundant full-document crop', async () => {
  const t = native(), configs = [];
  t.c.location = { origin: 'https://game.test' }; t.c.MediaStreamTrack = function () {}; t.c.MediaStreamTrack.prototype.getCaptureHandle = () => {};
  t.c.navigator.mediaDevices.setCaptureHandleConfig = value => configs.push(value);
  t.track.getCaptureHandle = () => ({ handle: configs[0].handle, origin: 'https://game.test' });
  t.track.cropTo = () => assert.fail('A verified current-tab stream needs no region-capture copy');
  const s = await t.create();
  assert.equal(s.verification, 'handle'); assert.equal(t.track.enabled, false);
  s.stop(); assert.equal(configs.at(-1).handle, '');
});

test('local HTML uses a nonce-only handle because file origins cannot be an origin allowlist entry', async () => {
  const t = native(), configs = [];
  t.c.location = { origin: 'null', protocol: 'file:' }; t.c.MediaStreamTrack = function () {}; t.c.MediaStreamTrack.prototype.getCaptureHandle = () => {};
  t.c.navigator.mediaDevices.setCaptureHandleConfig = value => configs.push(value);
  t.track.getCaptureHandle = () => ({ handle: configs[0].handle });
  t.track.cropTo = () => assert.fail('A matching local-document nonce already verifies the selected tab');
  const s = await t.create();
  try {
    assert.equal(configs[0].exposeOrigin, false); assert.deepEqual(Array.from(configs[0].permittedOrigins), ['*']);
    assert.equal(s.verification, 'handle'); assert.equal(s.track.enabled, false);
  } finally { s.stop(); }
});

test('a local HTML capture still rejects another tab and stops its unshared stream', async () => {
  const t = native();
  t.c.location = { origin: 'file://', protocol: 'file:' }; t.c.MediaStreamTrack = function () {}; t.c.MediaStreamTrack.prototype.getCaptureHandle = () => {};
  t.c.navigator.mediaDevices.setCaptureHandleConfig = () => {};
  t.track.getCaptureHandle = () => ({ handle: 'not-this-file' });
  await assert.rejects(t.create(), /current game tab/); assert.equal(t.track.stopped, true);
});

test('a capture handle from another tab or origin is rejected without falling back to a different surface', async () => {
  for (const wrongOrigin of [true, false]) {
    const t = native(); let config;
    t.c.location = { origin: 'https://game.test' }; t.c.MediaStreamTrack = function () {}; t.c.MediaStreamTrack.prototype.getCaptureHandle = () => {};
    t.c.navigator.mediaDevices.setCaptureHandleConfig = value => { if (value.handle) config = value; };
    t.track.getCaptureHandle = () => ({ handle: wrongOrigin ? config.handle : 'another-tab', origin: wrongOrigin ? 'https://other.test' : 'https://game.test' });
    await assert.rejects(t.create(), /current game tab/); assert.equal(t.track.stopped, true);
  }
});

test('video negotiation prefers a browser-reported efficient encoder and retains every fallback codec', async () => {
  const t = native(), codecs = [{ mimeType: 'video/VP8' }, { mimeType: 'video/H264' }, { mimeType: 'video/rtx' }]; let selected;
  t.c.RTCRtpSender = { getCapabilities: () => ({ codecs }) };
  t.c.navigator.mediaCapabilities = { encodingInfo: async config => ({ supported: true, smooth: true, powerEfficient: config.video.contentType === 'video/H264' }) };
  await t.T.preferEfficientCodec({ getTransceivers: () => [{ sender: { track: { kind: 'video' } }, setCodecPreferences: order => { selected = order; } }] });
  assert.equal(selected[0], codecs[1]); assert.equal(selected.length, codecs.length); assert.ok(selected.includes(codecs[0]) && selected.includes(codecs[2]));
});

test('a static tab or unavailable encoder statistics cannot leave the old menu covering native video', async () => {
  const t = native(), timers = [];
  t.c.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; }; t.c.clearTimeout = () => {};
  const s = await t.create();
  try {
    s.setSender({ getStats: async () => { throw new Error('Stats unavailable'); }, getParameters: () => ({}) });
    timers.find(x => x.ms === 750).fn(); assert.equal(s.ready, true);
  } finally { s.stop(); }
});

function switching() {
  const { AdminGameView: A, __ctx: c } = load(['19q-admin-game-view.js']);
  let privateNow = false;
  const old = { track: { kind: 'video', enabled: true }, stream: {}, setPaused(x) { this.paused = x; }, stop() { this.stopped = true; } };
  const next = { native: true, track: { kind: 'video', readyState: 'live', enabled: false }, stream: {}, setPaused(x) { this.paused = x; this.track.enabled = !x; }, stop() { this.stopped = true; }, setSender() {} };
  const sender = { track: old.track, replaceTrack: async track => { sender.track = track; } };
  c.document = { querySelectorAll: () => privateNow ? [{ getClientRects: () => [1] }] : [] };
  c.Presence = { send() {} }; c.Toast = { err() {}, show() {} }; c.TabViewCapture = { create: async () => next };
  const s = A.current = { host: true, capture: old, stream: old.stream, track: old.track, label: {}, pause: {}, exact: {}, pc: { connectionState: 'connected', getSenders: () => [sender] } };
  return { A, s, old, next, sender, privacy: x => { privateNow = x; } };
}

test('privacy and Pause protect both streams during an asynchronous track replacement', async () => {
  const t = switching(); let finish, entered;
  const started = new Promise(r => { entered = r; });
  t.sender.replaceTrack = () => new Promise(r => { finish = r; entered(); });
  const work = t.A.switchCapture(t.s); await started;
  assert.equal(t.s.pendingCapture, t.next);
  t.privacy(true); t.A.protect(t.s); assert.equal(t.next.track.enabled, false); assert.equal(t.old.paused, true);
  finish(); await work;
  assert.equal(t.s.capture, t.next); assert.equal(t.old.stopped, true); assert.equal(t.next.paused, true); assert.equal(t.s.pendingCapture, null);
});

test('a failed replacement restores the existing live view and stops the unused stream', async () => {
  const t = switching(); let count = 0;
  t.sender.replaceTrack = async track => { if (!count++) throw new Error('Cannot replace'); t.sender.track = track; };
  await t.A.switchCapture(t.s);
  assert.equal(t.s.capture, t.old); assert.equal(t.sender.track, t.old.track); assert.equal(t.old.stopped, undefined); assert.equal(t.next.stopped, true);
});

test('switching capture modes preserves the measured high-refresh target and reduced quality', async () => {
  const t = switching(); t.old.budget = { displayMs: 1000 / 144, level: 0 }; t.next.budget = { displayMs: 1000 / 60, level: 5 };
  await t.A.switchCapture(t.s);
  assert.equal(t.next.budget.displayMs, 1000 / 144); assert.equal(t.next.budget.level, 0);
});

test('the browser Stop sharing action ends Live View instead of silently restoring app capture', async () => {
  const t = switching(); await t.A.switchCapture(t.s); let reason;
  t.A.stop = value => { reason = value; t.A.current = null; };
  t.next.onended(); assert.equal(t.A.current, null); assert.equal(reason, 'Tab sharing ended.');
});
