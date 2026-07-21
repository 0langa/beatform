# MP4 Export — Design

Goal: user picks preset + params, clicks Export, gets a high-quality MP4 with
visuals frame-perfectly synced to the music. Resolution/fps selectable
(1080p/1440p/4K, 30/60 fps).

## Why offline rendering (not screen capture)

`MediaRecorder` + `canvas.captureStream()` records the _live_ canvas: dropped
frames under load, VBR timing wobble, realtime-only speed. Sync is
best-effort. Rejected.

Instead: render every frame deterministically, decoupled from wall-clock.

```
decodeAudioData(track)                 ── one decoded AudioBuffer is the
        │                                 single source of truth for both lanes
        ├── audio lane ──────────────► AudioEncoder (AAC 256k, fallback Opus)
        │                                timestamps = sampleIndex / sampleRate
        └── video lane
             OfflineAnalyzer            src/audio/offlineSource.ts (EXISTS)
               frame N → FFT window ending at t = N/fps
               → FeaturePipeline (dt = 1/fps exactly)
               → AudioFeatures identical in kind to live path
             WebGPU render to offscreen texture at export resolution
             → VideoEncoder (H.264 avc1.64xx, hardware accelerated)
               timestamps = N/fps exactly
        ▼
mp4-muxer (npm, pure TS) → File System Access API stream to disk
```

Sync argument: video frame N is _defined_ as t = N/fps of the decoded buffer;
audio timestamps are sample-count arithmetic over the same buffer. Drift is
structurally impossible — there is no clock, only indices.

## Already in place (built alongside the realtime path)

- `FeaturePipeline` — source-agnostic, deterministic: state depends only on
  the input sequence. Fixed `dt = 1/fps` gives reproducible smoothing/beat
  state per frame.
- `OfflineAnalyzer` — walks an AudioBuffer at fixed fps, own `RealFFT`
  (AnalyserNode is realtime-only and unavailable offline).
- Preset contract: presets are pure functions of (features, time, params) —
  no wall-clock, no unseeded randomness. Keep it that way; it is what makes
  export output identical to the live view.
- `WebGPURenderer` renders to any canvas size; export uses an
  `OffscreenCanvas` at target resolution, UI canvas untouched.

## Status: IMPLEMENTED (src/export/videoExporter.ts)

Shipped: frame loop with encode-queue backpressure, per-frame
`queue.onSubmittedWorkDone` sync before canvas snapshot, AAC probe with Opus
fallback, mp4-muxer in-memory fastStart, progress + AbortSignal cancel,
export dialog (resolution 720p→4K/square/vertical, 30/60 fps, auto/manual
bitrate), anchor-download save. Verified E2E: 16 s track → valid MP4,
decodes with duration exactly 16.00 s, seekable; ~140 fps export throughput
at preview size. Dev hook: `window.__runExport({width,height,fps})`.

Background modes are composited centrally in the shader header from a
luma-derived alpha (presets author light-over-black), so every preset gets
preset-animated / solid-color / transparent backgrounds with zero per-preset
code. MP4 carries no alpha: transparent mode renders over black; chroma
green/magenta swatches cover editor keying.

Shipped since this document was first written (it described the v1 pipeline):

- **Worker + OffscreenCanvas move** — encoding runs off the UI thread, with
  frame/frameAck flow control so the queue can't outrun the encoder.
- **Streaming to disk** for hour-long exports; memory stays flat instead of
  holding the whole target.
- **VP9-alpha (WebM) and PNG sequence** for true-alpha deliverables, plus
  **ProRes 4444** via the sidecar below.
- **Rust/ffmpeg sidecar** — bundled LGPL build driving ProRes 4444, GIF and
  animated WebP. Args are built in Rust from structured parameters; the webview
  can never pass raw arguments to a process.
- **HEVC / AV1** behind a runtime capability probe, with fallback.
- **LUFS normalization**, **loop crossfade**, **timeline-driven scene
  resolution**, **lyric overlays**, **audiogram elements** and **batch render**.

Still open (deliberately):

- Hardware-encoder selection (VideoEncoder picks its own backend today).
- A second-display / multi-window performance output — see the Stage-mode
  notes in the roadmap.

## Quality defaults

| Preset | Resolution | fps | H.264 bitrate |
| ------ | ---------- | --- | ------------- |
| High   | 1920×1080  | 60  | 16 Mbps       |
| Ultra  | 2560×1440  | 60  | 28 Mbps       |
| Max    | 3840×2160  | 60  | 50 Mbps       |

Encode speed: GPU shader presets render far faster than realtime; H.264
hardware encode ~100-300 fps at 1080p. A 3-minute track ≈ 1-2 min export.

## Sync precision budget

Export: exact by construction (see above) — frame N _is_ t = N/fps of the
decoded buffer. No jitter, no drift, sample-accurate forever.

Live playback: the analyser reads the samples currently entering the output
device, so visuals lead the ears by the device output latency
(`AudioContext.outputLatency`, ~10-30 ms on Windows/WASAPI), plus one vsync
(8-16 ms) for presentation. Total skew stays inside ±30 ms — well under the
ITU-R BT.1359 detectability window (audio may lag video ~125 ms / lead
~45 ms before humans notice). Both feature paths share the audio clock, so
skew is constant, never accumulating.

If sub-vsync alignment is ever wanted live: delay features through a ring
buffer sized to `outputLatency` before rendering. Knob documented here so it
doesn't get invented twice.

## Invariants to protect

- Presets stay pure (features, time, params) → deterministic export.
- FeaturePipeline never reads wall-clock or AudioContext directly.
- `AudioFeatures` shape changes must update BOTH RealtimeAnalyzer and
  OfflineAnalyzer (shared pipeline makes this automatic today).
