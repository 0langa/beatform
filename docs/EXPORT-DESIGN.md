# MP4 Export — Design

Goal: user picks preset + params, clicks Export, gets a high-quality MP4 with
visuals frame-perfectly synced to the music. Resolution/fps selectable
(1080p/1440p/4K, 30/60 fps).

## Why offline rendering (not screen capture)

`MediaRecorder` + `canvas.captureStream()` records the *live* canvas: dropped
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

Sync argument: video frame N is *defined* as t = N/fps of the decoded buffer;
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

## To build (implementation order)

1. `src/export/videoExporter.ts` — orchestrator: loop frames, backpressure on
   `VideoEncoder.encodeQueueSize`, progress callback, cancel.
2. Audio encode: `AudioEncoder` with `mp4a.40.2` (AAC-LC 256 kbps); probe
   support via `AudioEncoder.isConfigSupported`, fall back to Opus-in-MP4
   (fine in modern players; note in UI).
3. Mux: `mp4-muxer` package (avc + aac/opus, streaming writes).
4. File out: `showSaveFilePicker` → `FileSystemWritableFileStream` (WebView2
   supports it; Tauri dialog+fs plugin as fallback).
5. UI: export dialog (resolution, fps, bitrate presets), progress bar
   (frame N / total), cancel button. Run exporter in a Worker with
   OffscreenCanvas so the UI thread stays alive.
6. Later, Rust escape hatch: if a codec is missing in WebView2, pipe raw
   frames to an ffmpeg sidecar via Tauri command. Same OfflineAnalyzer feeds
   it — only the encode/mux tail changes.

## Quality defaults

| Preset  | Resolution | fps | H.264 bitrate |
| ------- | ---------- | --- | ------------- |
| High    | 1920×1080  | 60  | 16 Mbps       |
| Ultra   | 2560×1440  | 60  | 28 Mbps       |
| Max     | 3840×2160  | 60  | 50 Mbps       |

Encode speed: GPU shader presets render far faster than realtime; H.264
hardware encode ~100-300 fps at 1080p. A 3-minute track ≈ 1-2 min export.

## Invariants to protect

- Presets stay pure (features, time, params) → deterministic export.
- FeaturePipeline never reads wall-clock or AudioContext directly.
- `AudioFeatures` shape changes must update BOTH RealtimeAnalyzer and
  OfflineAnalyzer (shared pipeline makes this automatic today).
