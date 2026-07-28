# Preview / export truth contract

Beatform aims for one creative result across preview and export. “Exact” has a
narrow meaning here. This document defines what code guarantees, what release
tests measure, and what hardware timing prevents from being identical.

## Guaranteed

### Deterministic export timeline

- Video frame `N` is evaluated at track time `N / fps`.
- Audio timestamps come from sample indices over the same decoded PCM.
- Timeline scenes, automation, modulation, background-frame selection, lyrics,
  and audiogram keys resolve from that track time.
- No wall clock participates in export. A long render cannot accumulate A/V
  drift.
- Texture-feedback history advances on an integer-indexed 60 Hz state clock,
  independent of output fps. Frames between ticks present fresh content without
  mutating history.

### Shared creative definition

Preview and export use the same project document, preset WGSL, parameter
defaults, frame resolver, modulation functions, post settings, and overlay
composition code. Loudness normalization changes encoded audio only; it does
not change export analysis or rendered pixels.

### Repeatable export input

Given the same app build, project, decoded PCM, export settings, GPU/driver, and
output dimensions, the raw frame walk is deterministic. Encoded MP4/WebM bytes
are not promised to be byte-identical: hardware encoders, drivers, and container
metadata may differ without changing decoded content.

## Measured parity, not identity

### Audio analysis

Both paths use Beatform's `RealFFT`, Hann window, bin mapping, and
`FeaturePipeline`. Sample acquisition differs:

- Export uses a fixed 16.67 ms analysis lookahead.
- Preview reads a live Web Audio tap ahead of the speakers by device-dependent,
  smoothed output latency, commonly 10–40 ms.
- Continuous bins, peaks, bands, and drive update at presentation cadence.
  Characterization tests require spectrum cosine similarity above `0.998`
  across 30/60/144 fps fixtures; they do not require numeric identity.
- Offline onset decisions run on the canonical 60 Hz grid and must keep event
  counts equal across tested export rates. Live displays above 60 Hz gate onset
  decisions to the same cadence, but tap timing may move one event. A physical
  display below 60 Hz cannot reconstruct audio windows it never sampled.

Result: preview/export reaction should be perceptually aligned and must not
drift, but transient placement is not promised at the same millisecond.

### Pixels

Exact preview/export pixel equality is not promised across different:

- resolutions or aspect ratios;
- GPUs, drivers, WebView2 builds, or shader compiler backends;
- presentation rates for continuous, non-stateful motion;
- text rasterization sizes and output color/codec paths.

Release validation therefore uses canonical fixtures, timestamps, dimensions,
and tolerance-based decoded-pixel comparisons. It separately requires zero WGSL
compile errors and zero uncaptured WebGPU errors.

## Not promised

- Live system-audio capture has no export counterpart.
- Canvas2D fallback approximates Spectrum Bars only; it is not WebGPU parity.
- A preview rendered at one fps is not expected to equal an export sampled at a
  different timestamp between fixed state ticks.
- Encoded files are not byte-reproducible across hardware encoders.

## Release gates

Any change to analysis, feedback, shaders, render graph, timeline resolution,
or overlays must pass:

1. focused behavior regression tests;
2. full TypeScript/Vitest/Rust gates;
3. real WebGPU compilation for every built-in preset and style;
4. canonical real-GPU pixel baselines across every built-in preset and style;
5. fixed-clock and preview/export event traces across 24/30/48/60/90/120/144 Hz
   fixtures where applicable;
6. device-runtime smoke tests, including system-audio silence, known audio, and
   sustained loopback capture when loopback code changed.

If a gate has not run, release notes must say so. Source snapshots alone prove
shader text stability, not compilability or pixel correctness.
