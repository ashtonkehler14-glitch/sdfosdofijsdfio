"""Independent Python reference for the pinned lazer C# equations; no game JS is used.

Sources: ppy/osu 3f39cfce35f238c7d1a87abcca3ff5f405a91abb (MIT, ppy Pty Ltd),
ppy/osu-framework f05a31a9d82972e9b752060370ec17df17bdabda (2026.1030.0).
See docs/lazer-render-parity.md for source links, scope and platform differences.
Run from any directory: python3 tests/fixtures/lazer-render/generate.py
"""
import json
import math
from pathlib import Path
import struct


def trace(name, samples):
    # InterpolatingFramedClock.ProcessFrame; initial source/frame position is the first sample's position.
    last_ts, initial_rate, source = samples[0]
    current, previous_source, interpolating = source, source, False
    frames = [[last_ts, initial_rate, source, current, interpolating]]
    for ts, rate, source in samples[1:]:
        previous = current
        if interpolating:
            predicted = current + (ts - last_ts) * rate
            current = predicted + (source - predicted) * (1 - math.pow(0.5, (ts - last_ts) / 80))
            if abs(source - current) > (1000 / 60) * 2 * rate:
                current, interpolating = source, False
        else:
            current = source
            if source != previous_source:
                interpolating = True
        if source >= previous_source:
            current = max(previous, current)
        frames.append([ts, rate, source, current, interpolating])
        last_ts, previous_source = ts, source
    return {"name": name, "frames": frames}


clocks = []
for hz in [60, 120, 144, 240, 360]:
    for rate in [.5, 1, 1.5, 2]:
        samples = [(i * 1000 / hz, rate, math.floor(i * 1000 / hz / 20) * 20 * rate) for i in range(36)]
        clocks.append(trace(f"{hz}Hz-{rate}x-stepped-audio", samples))
clocks.append(trace("startup-waits-for-first-source-update", [(i * 10, 1, 0 if i < 6 else (i - 5) * 10) for i in range(16)]))
clocks.append(trace("large-forward-jump-rearms-interpolation", [(0, 1, 0), (10, 1, 10), (20, 1, 20), (30, 1, 300), (40, 1, 300), (50, 1, 310), (60, 1, 320), (70, 1, 330)]))
clocks.append(trace("rate-change", [(0, 1, 0), (10, 1, 10), (20, 1, 20), (30, 2, 40), (40, 2, 60), (50, .5, 65), (60, .5, 70)]))

points = [[0, 1], [1000, 2], [1500, .5], [2000, 0], [2400, 20], [2410, 1]]


def relative_position(time, time_range):
    # SequentialScrollAlgorithm.relativePositionAt, expressed independently of the client's cached ScrollMap.
    position, previous_time, multiplier = 0, points[0][0], points[0][1]
    for next_time, next_multiplier in points[1:]:
        if time < next_time:
            break
        position += (next_time - previous_time) / time_range * multiplier
        previous_time, multiplier = next_time, next_multiplier
    return position + (time - previous_time) / time_range * multiplier


scrolls = []
for height in [480, 720, 1080]:
    for rate in [.5, 1, 1.5, 2]:
        for speed in [1, 20, 40]:
            time_range = 11485 / speed * rate
            for now in [-100, 999.9, 1000, 1499.9, 1500, 2000, 2399.9, 2400, 2405, 2410, 3000]:
                note_time = now + 100 * rate
                distance = (relative_position(note_time, time_range) - relative_position(now, time_range)) * (402 * height / 480)
                # The C# PositionAt API returns float (the clock and integration above use double).
                distance = struct.unpack('f', struct.pack('f', distance))[0]
                scrolls.append([height, rate, speed, now, note_time, distance])

data = {"osu": "3f39cfce35f238c7d1a87abcca3ff5f405a91abb", "framework": "f05a31a9d82972e9b752060370ec17df17bdabda",
        "frameworkPackage": "2026.1030.0", "clocks": clocks, "points": points, "scrolls": scrolls}
Path(__file__).with_name('reference.json').write_text(json.dumps(data, separators=(',', ':')) + '\n')
