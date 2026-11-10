# Note rendering and frame pacing

Checked on 10 November 2026 against:

- [osu-framework `InterpolatingFramedClock`, pinned at `0d5edae`](https://github.com/ppy/osu-framework/blob/0d5edae7264553239183f38ea32fdb5ef2a98dd9/osu.Framework/Timing/InterpolatingFramedClock.cs).
- [ppy: latency and unlimited frame rates](https://github.com/ppy/osu/wiki/Latency-and-unlimited-frame-rates).
- [MDN: `requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).
- [MDN: optimising canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas).

The existing visual clock already follows lazer's core approach: interpolate using elapsed real time, recover audio
drift with a 50 ms half-life, and resynchronise on large deviations or seeks. Animation already uses the browser's
frame timestamp and moving notes retain fractional vertical positions. These paths are preserved. MDN's general
integer-coordinate advice is useful for static edges, but rounding moving notes would introduce visible stepping,
especially at reduced resolution. Existing sprite caching, cropped canvas and GPU warmup are also retained.

## Changes

1. **Bound tiled hold work by the screen height.** Previously non-legacy tiled hold bodies submitted every tile
   between the head and tail, even if almost all of them were outside the canvas. Canvas clipping discarded pixels
   but did not avoid those JavaScript and canvas calls. The renderer now jumps to the first visible tile, retaining
   the original texture anchor, clipping, animation and flip. Stretched and legacy hold-body paths are unchanged.
2. **Prepare custom note outlines with the existing sprites.** Tap, hold-head and hold-tail animation frames have
   their outlines cached and submitted for texture upload during layout preparation. Previously only their base
   sprites were prepared, so the first visible outlined note built its own extra canvas during gameplay. Geometry
   or border changes still create variants at the new size; timing-colour variants retain their existing on-demand
   path. No animation frames or visual effects are removed.
3. **Respect high refresh rate budgets in automatic resolution.** The old target never went above 60 fps. The target
   now uses the observed display interval and the player's configured cap, with the original 60 Hz fallback for
   overloaded devices. Thus missed 120/144/165/240 Hz refreshes can trigger the existing gradual scaling policy.
   A bounded 120-sample window learns cadence using a lower percentile at most twice a second; the fastest
   established cadence is retained during the play so sustained skipped frames cannot lower the performance goal.
   Disabling automatic resolution still disables scaling. Stable intentional caps and browser battery caps retain
   their previous protections. The frame limiter and its timestamp scheduling are unchanged.

Judgement windows, input timestamps, engine rules, audio offsets, replay events and scoring are unchanged.

## Validation

`node --test tests/render-smoothness.test.mjs` covers tile phase/work bounds, legacy/stretched bodies, high refresh
rate adaptation, intentional caps, disabled scaling, battery caps, and the existing visual clock at 60–360 Hz and
0.5x–2x playback. It includes stepped audio positions, seeks, pauses and offset changes.

`CHROMIUM_PATH=/usr/bin/chromium node tests/render-smoothness-e2e.mjs` checks actual canvas pixels against the old
tiling algorithm in 40 cases, including upscroll, flipped textures, fractional coordinates and fully offscreen bodies.
It also verifies no first-note outline canvas allocations and fractional movement at full/reduced resolution.

To compare the previous complete renderer in the same browser, save `src/js/10-renderer.js` from the parent commit
and supply its absolute path as `BASELINE_RENDERER`. Optional `PERF_RESULT` saves the measurements as JSON.

The development Chromium stress case drew eight long tiled holds over 24 frames. Draw submissions per frame fell
from **12,009 to 345** (97.1% fewer); median JavaScript submission time fell from **9.1 ms to 0.4 ms**. All 40 pixel
comparisons were identical, and the first tap/head/tail draws allocated no outline canvases. These are measurements
of this deliberately long-hold workload, not a general FPS multiplier or a measurement of display presentation latency.

Browser scheduling, garbage collection elsewhere in the app, GPU contention, tab throttling and device load can
still delay frames. A web client cannot guarantee zero stutters on every device. Native 120/144/240 Hz hardware
was not available here; those cadences are tested with deterministic timestamps. Actual Chromium canvas rendering,
keyboard gameplay/replay parity and skin-editor integration are exercised separately.
