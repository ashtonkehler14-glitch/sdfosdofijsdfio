# Lazer rendering parity audit

Verified on 10 November 2026 against ppy/osu commit
[`3f39cfce35f238c7d1a87abcca3ff5f405a91abb`](https://github.com/ppy/osu/tree/3f39cfce35f238c7d1a87abcca3ff5f405a91abb).
Its [`osu.Game.csproj`](https://github.com/ppy/osu/blob/3f39cfce35f238c7d1a87abcca3ff5f405a91abb/osu.Game/osu.Game.csproj)
depends on framework **2026.1030.0**, whose tag resolves to
[`f05a31a9d82972e9b752060370ec17df17bdabda`](https://github.com/ppy/osu-framework/tree/f05a31a9d82972e9b752060370ec17df17bdabda).
The comparison uses that dependency, rather than assuming current framework master is what lazer runs.

## Findings and implementation

| Path | What the pinned source does | Ashtonkmania |
| --- | --- | --- |
| Audio-driven clock | [`FramedBeatmapClock`](https://github.com/ppy/osu/blob/3f39cfce35f238c7d1a87abcca3ff5f405a91abb/osu.Game/Beatmaps/FramedBeatmapClock.cs) wraps the decoupled track in an interpolating clock and overrides `DriftRecoveryHalfLife` to **80 ms**. | Corrected `GameplayScreen.frameTime` from the framework's 50 ms default to the gameplay override. Existing Web Audio output timestamp mapping remains in place. |
| Interpolation | [`InterpolatingFramedClock.ProcessFrame`](https://github.com/ppy/osu-framework/blob/f05a31a9d82972e9b752060370ec17df17bdabda/osu.Framework/Timing/InterpolatingFramedClock.cs) advances by real elapsed time times rate, then uses `DampContinuously`. It arms interpolation after a source update and disarms it when drift exceeds `1000 / 60 * 2 * rate`. | Uses the same damping expression and threshold. Corrected startup and recovery to re-arm on a source update and interpolate from the following frame. Stale/repeated browser frame timestamps are ignored instead of resetting movement. |
| Scroll speed | [`DrawableManiaRuleset`](https://github.com/ppy/osu/blob/3f39cfce35f238c7d1a87abcca3ff5f405a91abb/osu.Game.Rulesets.Mania/UI/DrawableManiaRuleset.cs) uses `11485 / scrollSpeed`; its time range includes tempo/frequency rate and hit-position compensation. | The existing `11485 / scrollSpeed` and division by playback rate match. Legacy desktop hit-position compensation cancels to `402 / 480 * height`, which is the renderer's existing scroll length. |
| BPM/SV mapping | [`MultiplierControlPoint`](https://github.com/ppy/osu/blob/3f39cfce35f238c7d1a87abcca3ff5f405a91abb/osu.Game/Rulesets/Timing/MultiplierControlPoint.cs) aggregates speed/BPM; [`SequentialScrollAlgorithm`](https://github.com/ppy/osu/blob/3f39cfce35f238c7d1a87abcca3ff5f405a91abb/osu.Game/Rulesets/UI/Scrolling/Algorithms/SequentialScrollAlgorithm.cs) integrates the control points and subtracts current position from note position. | `ScrollMap` uses the same integrated-position difference. The existing implementation passes source-derived position checks across speed changes and stops. This verifies the sequential mode, not lazer's alternative overlapping visualisation mode. |
| Fractional positions | [`ScrollingHitObjectContainer.updatePosition`](https://github.com/ppy/osu/blob/3f39cfce35f238c7d1a87abcca3ff5f405a91abb/osu.Game/Rulesets/UI/Scrolling/ScrollingHitObjectContainer.cs) assigns floating-point X/Y; [`SpriteDrawNode`](https://github.com/ppy/osu-framework/blob/f05a31a9d82972e9b752060370ec17df17bdabda/osu.Framework/Graphics/Sprites/SpriteDrawNode.cs) submits textured GPU quads. | Note Y remains fractional. Actual browser raster tests now prove fractional motion, rather than only checking the arguments passed to `drawImage`. |
| Texture filtering | [`Skin`](https://github.com/ppy/osu/blob/3f39cfce35f238c7d1a87abcca3ff5f405a91abb/osu.Game/Skinning/Skin.cs) creates a `TextureStore`; the pinned [`TextureStore`](https://github.com/ppy/osu-framework/blob/f05a31a9d82972e9b752060370ec17df17bdabda/osu.Framework/Graphics/Textures/TextureStore.cs) defaults to linear filtering. [`TextureAtlas`](https://github.com/ppy/osu-framework/blob/f05a31a9d82972e9b752060370ec17df17bdabda/osu.Framework/Graphics/Textures/TextureAtlas.cs) reserves padded texture regions. | Cached note images include a transparent one-pixel gutter, allowing fractional edge sampling in Chromium. This is a Canvas adaptation, not an identical atlas/shader implementation. Integer-position images retain the previous pixels. |
| Display scheduling | [`GameHost`](https://github.com/ppy/osu-framework/blob/f05a31a9d82972e9b752060370ec17df17bdabda/osu.Framework/Platform/GameHost.cs) supports separate input/update/draw threads and native graphics presentation. | The browser schedules Canvas/DOM through `requestAnimationFrame` on the main thread and its compositor. Existing cadence detection, FPS limiter, sprite warmup and bounded hold rendering remain. Native threading/presentation cannot be reproduced by changing a Canvas setting. |

For legacy hit-position compensation, [`LegacyManiaSkinConfiguration`](https://github.com/ppy/osu/blob/3f39cfce35f238c7d1a87abcca3ff5f405a91abb/osu.Game/Skinning/LegacyManiaSkinConfiguration.cs)
sets the default inset to `(480 - 402) * 1.6`. In the native 768-unit space, scroll length divided by the compensated
time range reduces to `402 * screenHeight / 480 / (11485 / speed * rate)`.
The game retains its existing custom skin and mobile geometry; this audit does not equate those layouts with
lazer's modern built-in skin.

## Reproducible verification

`tests/fixtures/lazer-render/generate.py` independently implements the pinned C# clock equations/state transitions
and sequential scrolling formula in Python. It does not import or execute this game's JS. The resulting
`reference.json` includes **23 clock traces (751 frames)** and **396 scroll positions**.
These are source-derived reference outputs, not recordings or execution of the native lazer binary.

The clock reference covers 60/120/144/240/360 Hz at 0.5x/1x/1.5x/2x, stepped audio, startup with no fresh source
sample, large forward corrections and rate changes. `tests/render-smoothness.test.mjs` compares frame times to
the reference within `1e-9` ms and checks interpolation state. The scroll tests exercise the actual render frame
parameters and compare against the native API's final float precision, including rate, speed, viewport height,
variable speed segments, a zero-speed stop and a brief 20x segment.

Browser tests check 32 rendered-motion combinations (outlines, up/down, flips, reduced resolution and standard/WOM
images), with nine eighth-pixel phases each. Positions must follow the requested phase within 0.02 pixel,
opacity stays within 1%, and integer-phase colours/shapes/anchors must match exactly. The regression fails on the
previous unpadded renderer. Existing hold pixel comparisons, first-note cache checks, keyboard gameplay/replay
agreement and skin-editor tests are also run.

Judgement windows, input timestamp conversion, scoring rules and replay formats are unchanged. Browser guards
still reset explicitly on seek/pause/offset changes and long suspended frames; forward play stays monotonic even
if browser audio timestamps regress. These are deliberate adaptations to the Web Audio/browser lifecycle.

The verified result is source-aligned gameplay clock and scroll mathematics plus measured fractional Canvas
motion. It is not proof of identical native presentation latency, shader output or perceived smoothness on a
physical high refresh display. No side-by-side native client/hardware measurement was available in this environment.
