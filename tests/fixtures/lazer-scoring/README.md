# Native scoring reference

The compressed reference contains **401** scenarios evaluated by .NET 10 from osu!lazer commit
[`d551a04bc4fa613bc25cf04d6e7becbd5cca64cf`](https://github.com/ppy/osu/tree/d551a04bc4fa613bc25cf04d6e7becbd5cca64cf).
It is generated independently of the game's JavaScript implementation. Run the comparison with:

```sh
node --test tests/lazer-scoring.test.mjs
```

To regenerate with a .NET 10 SDK:

```sh
python3 tests/fixtures/lazer-scoring/generate.py --dotnet /path/to/dotnet
```

The generator downloads source at the pinned commit. `--source-root /path/to/source` uses an already downloaded copy with the
original repository paths. A temporary C# console project compiles the upstream mania health/score/pp and strain classes unchanged.
The base score processor's numerical methods and event-bookkeeping prefix are inserted directly from the source.
`Adapters.cs` provides test-only framework interfaces, bindables and beatmap objects. `Program.cs` supplies cases and serialises results.
Framework precision comparisons and mathematical helpers use the same expressions as upstream.
Source hashes normalise UTF-8 BOM, CRLF and trailing whitespace to one final newline; arithmetic is not rewritten.

`reference.json.gz` contains input cases and native outputs. Compression has a fixed zero timestamp.
`legacy.json` separately freezes historical rules 1, 2 and 3 from the shipped game; regenerate it with `generate-legacy.mjs`.

Upstream osu! code is Copyright (c) ppy Pty Ltd, MIT licensed. The legacy sort helper credits Microsoft and is also MIT licensed.
Source URLs and the full reproduction manifest are stored in the fixture and explained in [the audit](../../../docs/lazer-scoring-parity.md).
