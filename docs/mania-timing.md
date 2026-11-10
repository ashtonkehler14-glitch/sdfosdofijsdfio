# osu!mania timing reference

The timing introduced in rules **3** remains in rules **4**, which adds the
[health/scoring audit](lazer-scoring-parity.md). The timing reference is osu!lazer / ppy/osu commit
[`3f39cfce35f238c7d1a87abcca3ff5f405a91abb`](https://github.com/ppy/osu/tree/3f39cfce35f238c7d1a87abcca3ff5f405a91abb), checked on 9 November 2026.

The relevant upstream files are:

- `osu.Game.Rulesets.Mania/Scoring/ManiaHitWindows.cs`
- `osu.Game/Beatmaps/IBeatmapDifficultyInfo.cs` (`DifficultyRange`)
- `osu.Game/Rulesets/Scoring/HitWindows.cs` (`ResultFor`, `CanBeHit`)
- `osu.Game.Rulesets.Mania/Objects/Drawables/DrawableNote.cs`
- `osu.Game.Rulesets.Mania/Objects/Drawables/DrawableHoldNote{,Head,Tail,Body}.cs`
- `osu.Game.Rulesets.Mania/Objects/TailNote.cs`
- `osu.Game.Rulesets.Mania/UI/OrderedHitPolicy.cs`
- `osu.Game.Rulesets.Mania.Tests/TestSceneHoldNoteInput.cs`

## Standard windows

These are lazer's default mania windows (without the Classic mod), in milliseconds of song time:

| Result | OD 0 | OD 5 | OD 10 |
| --- | ---: | ---: | ---: |
| MAX | 22.4 | 19.4 | 13.9 |
| 300 | 64 | 49 | 34 |
| 200 | 97 | 82 | 67 |
| 100 | 127 | 112 | 97 |
| 50 | 151 | 136 | 121 |
| Miss | 188 | 173 | 158 |

Interpolate using upstream `DifficultyRange`, then calculate
`floor(interpolatedWindow * (rate / difficultyMultiplier)) + 0.5`.
The difficulty multiplier is 1 normally, 1.4 for Hard Rock and `1 / 1.4` for Easy.
Difficulty Adjust replaces OD. Evaluation order and the absence of a rounding epsilon matter at integer edges.
For example, OD 8.8 at 1.25x has a 300 window of **46.5** song milliseconds; the previous calculation gave 47.5.

`timingWindows({rate, ...})` returns these quantised windows divided by rate, retaining the existing
real-millisecond storage and statistics format. `GameplayEngine` converts to song time; re-quantising half-millisecond
values is idempotent. Pass the same initial rate to both. Explicit custom-millisecond judgement settings retain their
existing semantics; they are intentionally outside the default lazer windows.

Judgement boundaries are inclusive. Unpressed heads expire after the late 50 boundary. Hold releases have 1.5x
lenience. A broken hold can be grabbed again, including after the tail up to its ordinary 50 window, but a broken
body or missed head caps a successful tail judgement at 50. Repeated early releases break combo only once.
The input path preserves sub-millisecond timestamps without rounding them to 0.01 ms. It no longer stretches
physical key holds to a minimum of 5 ms, and the legacy event verifier accepts
short releases while still validating event order and alternating presses/releases.

## Compatibility and validation

Replays store their rules version and real-millisecond windows. Rules 1 and 2 retain their original timing and
no-regrab behaviour. Existing scores are not recalculated. New plays, new replay playback, OSR imports and the
legacy event verifier use rules 3; OSR imports use the rate implied by their mods. Importing a stable/Classic OSR
still does not emulate Classic scoring, as before this update.

`tests/fixtures/lazer-timing/windows.json` contains 69 window cases, calculated separately in Python from the pinned
C# expressions using IEEE-754 doubles. These include floating-point integer edges and EZ/HR across 0.5x–2x.
`tests/lazer-timing.test.mjs` checks both sides of every judgement and release boundary, pinned upstream hold-input
scenarios, passive expiry, caps, No Release, replay serialisation, old rules and server/live/replay agreement.

This change matches those judgement rules. It does not guarantee identical physical latency to the native lazer
client: keyboard firmware, browser event delivery, audio devices and display refresh still affect feel. Existing
audio/input offsets and the audio-clock timestamp mapping remain in place. Live inputs still use the existing
30 ms frame grace and monotonic timeline; inputs delivered after that grace cannot rewind expired judgements.
