# Lazer mania health, score, accuracy and pp

New plays use rules **4**, audited against ppy/osu commit
[`d551a04bc4fa613bc25cf04d6e7becbd5cca64cf`](https://github.com/ppy/osu/tree/d551a04bc4fa613bc25cf04d6e7becbd5cca64cf)
on 10 November 2026. This is a direct implementation of the upstream arithmetic, not a fitted approximation.

## Health

[ManiaHealthProcessor](https://github.com/ppy/osu/blob/d551a04bc4fa613bc25cf04d6e7becbd5cca64cf/osu.Game.Rulesets.Mania/Scoring/ManiaHealthProcessor.cs)
calls the legacy drain calibration to obtain its recovery multiplier and then returns **zero passive drain**.
The game follows the same calibration, break handling and nested hold-head/tail contributions.
New rules run calibration until upstream's convergence condition; the old 4,000-iteration limit is restricted to historical replays.

The HP difficulty and mod adjustments use the same float precision as `BeatmapDifficulty.DrainRate`.
The parenthesised `(DrainRate + 1)` in miss/Meh penalties is also a float operation before the double multiplication.
Recovery amounts, clipping to 0–1 and the framework's `1e-7` failure comparison follow upstream.
Hold heads and tails each have half a normal note's miss penalty; hold-body combo breaks do not invent an HP penalty.

By default, Easy restores full health on its first two failures, as
[ModEasyWithExtraLives](https://github.com/ppy/osu/blob/d551a04bc4fa613bc25cf04d6e7becbd5cca64cf/osu.Game/Rulesets/Mods/ModEasyWithExtraLives.cs)
does. No Fail rejects failure without inventing a health floor. Sudden Death and Perfect use judgement fail conditions;
they do not force the health bar to zero. The health graph records actual values without rounding to three decimals.
Multiplayer separately records that a failure occurred when a round allows play to continue.

## Score and accuracy

[ManiaScoreProcessor](https://github.com/ppy/osu/blob/d551a04bc4fa613bc25cf04d6e7becbd5cca64cf/osu.Game.Rulesets.Mania/Scoring/ManiaScoreProcessor.cs)
uses 150,000 points for the logarithmic combo portion and 850,000 for the accuracy portion.
Accuracy weights are **305 / 300 / 200 / 100 / 50 / 0**. Both ends of a hold contribute; a body combo break does not add an accuracy judgement.

[ScoreProcessor.updateScore](https://github.com/ppy/osu/blob/d551a04bc4fa613bc25cf04d6e7becbd5cca64cf/osu.Game/Rulesets/Scoring/ScoreProcessor.cs)
rounds the unmultiplied score first, then multiplies and rounds again. Both operations use .NET's midpoint-to-even rule.
JavaScript's single `Math.round(raw * multiplier)` was different, including a one-Great Easy play: **473,024**, not 473,025.
Mod multipliers are calculated from the play's own configuration, including the native truncation used by slowing mods.
New plays use weighted accuracy and standardised scoring; the alternate Classic accuracy setting is removed.

## Difficulty and pp

The existing
[ManiaPerformanceCalculator](https://github.com/ppy/osu/blob/d551a04bc4fa613bc25cf04d6e7becbd5cca64cf/osu.Game.Rulesets.Mania/Difficulty/ManiaPerformanceCalculator.cs)
formula matched the native reference. Its accuracy deliberately uses **320** for Perfect; displayed accuracy uses 305.
No Fail's pp multiplier is 0.75, independently of its 0.5 score multiplier.

The inputs are corrected: star ratings retain full precision until display, and live pp uses earned hit counts rather than projecting
those counts over unplayed notes. Difficulty sorting uses upstream's legacy quicksort on rounded **original** start times,
including its tied-chord ordering. The parser preserves the file order of simultaneous notes, as `LegacyBeatmapDecoder` and `BeatmapConverter` do, and does not drop native hit objects. Historical replay parsing retains the old column sorting and overlap filtering. Timing deltas and precision comparisons preserve native operation order.
The difficulty cache version is **3**, so installed maps are recalculated.

## Verification and compatibility

`tests/fixtures/lazer-scoring/generate.py` compiles the pinned upstream C# health, mania score, performance and strain/preprocessing classes.
The score event-bookkeeping prefix and arithmetic are extracted verbatim from the base `ScoreProcessor`; graphical callbacks are excluded.
Small adapters provide beatmaps, bindables and framework interfaces. They do not replace the mania formulas with JavaScript.
The fixture is compressed JSON with the inputs, outputs, upstream commit and normalised source SHA-256 hashes.
See the [fixture instructions](../tests/fixtures/lazer-scoring/README.md).

The 401 scenarios include 54 health traces, 189 judgement-by-judgement score traces, 103 pp inputs and 55 difficulty/pp traces.
Score, accuracy and combo must match the C# outputs exactly. Health and difficulty tolerate at most `1e-11` absolute floating-point
error; pp tolerates `1e-9` for platform math-library differences. These are comparison tolerances, not adjustments made to game values.
The checks cover chords, overlapping holds, fractional times, rates, misses, fail mods, Easy lives and mod multipliers.

Rules **1–3** retain their scoring, health, accuracy and difficulty calculations. Fifteen frozen replay scenarios generated from
shipped commit `68541b7` test those historical results. New replays store rules 4; the client and server verifier share the same engine.
The browser gameplay test exercises real keyboard input, DT playback, saved replay results and the new rules version.
This validates the numerical processors and their game integration; it is not a claim that the browser runs lazer's native input or rendering framework.
