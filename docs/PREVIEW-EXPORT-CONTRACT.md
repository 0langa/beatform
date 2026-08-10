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

### Segment exports rebase the clip, not the creative result

A segment export (“export this slice”, the Canvas-loop path) slices the decoded
audio so the rendered clip starts at `t = 0`. Every time-bearing structure the
exporter hands the core is rebased with it — timeline scenes and automation
keyframes, the beat grid, section boundaries, vocal spans, lyric lines _and the
words inside them_, stem envelopes, the audiogram waveform overview — so the
clip resolves the same creative frame at the same musical moment as the preview
does at absolute track time.

Two values stay ABSOLUTE, deliberately, because they record where the clip sits
on the track rather than describing something inside it:

- `bgVideo.timeOffset`, so the video-background loop lands on the same frame the
  preview shows;
- `timeOrigin`, the clip's `t = 0` in track time. It anchors the two things that
  are measured from track time zero rather than from the clip:
  - **the tempo-locked LFO modulation sources** (`lfo:<wave>:<beats>`). The
    offline analyzer stamps the origin onto every frame as
    `AudioFeatures.timeOrigin`, and the LFO reads `time + (timeOrigin ?? 0)`.
    Anchoring on clip time alone put the export's first frame at cycle start
    while the preview sat mid-cycle — at 120 BPM with `lfo:sine:8` and a segment
    starting at 137 s, phase 0 against the preview's 0.25, for the whole clip.
  - **the renderer's clock**, `u.time` (uniform slot 0), which most presets read
    and from which the post chain's film grain seeds (`fract(u.time)`). The
    preview feeds it absolute track time, so the export adds the origin at a
    single chokepoint covering both the presented frame and the 60 Hz
    texture-feedback advance. Those two must translate together: a rigid shift
    preserves the ordering and spacing the feedback simulation depends on, while
    shifting only one would give a feedback preset two clocks inside one frame.

`AudioFeatures.time` itself stays CLIP time on both halves of a segment export.
It is `frame / fps` by definition, and everything listed above has already been
rebased to match it; making it absolute would shift all of them twice. The
renderer's clock is a separate value, derived from it — the two never merge.

Deliberately clip-relative, and not part of the above: the audiogram's progress
bar and clock (a 40 s segment reads `0:00 / 0:40`, with the waveform strip
sliced to match), the lyric and overlay compose timings, and the fixed 60 Hz
feedback state grid, which is anchored to the clip's first frame.

On the live path and on full-track exports `timeOrigin` is absent or 0, so the
arithmetic is exactly what it is without segments.

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

Both paths use Beatform's `RealFFT`, bin mapping, and `FeaturePipeline`. The
responsive detector transform is separate from the optional longer
drawn-spectrum transform: changing display resolution, axis, or interpolation
cannot retune bands, sync, or onset decisions. Long display FFTs refresh on
the same fixed 60 Hz analysis ticks and are held between them.

Windowing differs by purpose. Detector transforms keep the symmetric Hann
window unchanged — beat, onset, band, and every derived feature stay
byte-identical. The longer display-only transforms use an asymmetric window
(half-Hann rise, half-Hann fall over the last N/8) whose peak weight sits
`round(N/8)` samples from the window end, so a 171/341 ms display window no
longer reads a transient half a window late:

- Export shifts the display window forward so its peak lands ON the frame's
  analysis endpoint — exported bars peak within one analysis tick of the
  audible transient (pinned by the click-alignment test). At the track tail
  the shift clamps to the PCM length and gracefully degrades toward
  ends-at-now.
- Preview's display window necessarily still ends at the analyser's "now"; the
  residual display lag is the peak offset (≈ window/8: ~21 ms detailed,
  ~43 ms precise at 48 kHz) minus the output latency the tap already leads
  the speakers by. `spectrumDiagnostics.latencyMs` reports this number and the
  UI shows it.

Sample acquisition differs:

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
