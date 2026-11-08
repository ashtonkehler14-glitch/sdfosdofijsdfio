import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

function audioBuffer(channels, length, sampleRate, copyAPI = true) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return {
    numberOfChannels: channels, length, sampleRate,
    getChannelData: c => data[c],
    ...(copyAPI ? { copyToChannel: (source, channel) => data[channel].set(source) } : {}),
  };
}

for (const copyAPI of [true, false]) {
  for (const rate of [0.75, 1.5]) {
    test(`time stretch preserves distinct stereo channels at ${rate}x (${copyAPI ? 'copyToChannel' : 'fallback'})`, async () => {
      const { TimeStretch, AudioManager } = load(['00-util.js', '05-audio.js']);
      AudioManager.ctx = { createBuffer: (chs, len, sr) => audioBuffer(chs, len, sr, copyAPI) };
      const input = audioBuffer(2, 8000, 8000);
      // Opposite polarity and different volume: detect swapped, duplicated or silent channels.
      for (let i = 0; i < input.length; i++) {
        input.getChannelData(0)[i] = 0.4 * Math.sin(i * 2 * Math.PI * 220 / 8000);
        input.getChannelData(1)[i] = -0.5 * input.getChannelData(0)[i];
      }
      const out = await TimeStretch.stretch(input, rate, 'stereo');
      assert.equal(out.numberOfChannels, 2);
      assert.equal(out.sampleRate, 8000);
      const left = out.getChannelData(0), right = out.getChannelData(1);
      assert.ok(left.some(v => Math.abs(v) > 0.1), 'left channel contains audio');
      assert.ok(right.some(v => Math.abs(v) > 0.05), 'right channel contains audio');
      for (let i = 0; i < out.length; i++) assert.ok(Math.abs(right[i] + left[i] * 0.5) < 1e-6, 'channel balance and polarity are preserved');
      assert.equal(await TimeStretch.stretch(input, rate, 'stereo'), out, 'cached result retains stereo');
    });
  }
}

test('mono time stretch stays mono', async () => {
  const { TimeStretch, AudioManager } = load(['00-util.js', '05-audio.js']);
  AudioManager.ctx = { createBuffer: (chs, len, sr) => audioBuffer(chs, len, sr) };
  const input = audioBuffer(1, 8000, 8000); input.getChannelData(0).fill(0.25);
  const out = await TimeStretch.stretch(input, 1.25, 'mono');
  assert.equal(out.numberOfChannels, 1);
  assert.ok(out.getChannelData(0).some(v => v > 0.1));
});
