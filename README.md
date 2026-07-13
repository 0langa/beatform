# Audio Visualizer

Desktop music visualizer. Tauri 2 + React + TypeScript, WebGPU rendering (Canvas2D fallback), Rust core. v1.0.0.

## Features

- Local file playback (mp3/flac/wav/ogg/m4a) via Web Audio — drag & drop or file picker; gapless loop toggle
- Log-spaced spectrum analysis, asymmetric smoothing, peak hold, band energies, spectral-flux beat detection, slow energy envelope, phase-locked waveform
- **10 visual modes** (WebGPU shader presets): Spectrum Bars, Radial Burst,
  Oscilloscope, Starfield Warp, Tunnel, Kaleido Nebula, Metaballs,
  LED Matrix, Voice Orb (narration mode), and **Builder** — compose your own
  from six toggleable layers
- Every mode: 4 factory **styles**, curated params + full **Advanced** section
  (~150 knobs app-wide), plain-language **hint** for every setting (tooltip +
  live hint bar), all persisted per mode
- Background system on every preset: preset-animated, any solid color
  (incl. chroma green/magenta swatches), or transparent (luma alpha,
  checkerboard preview)
- **MP4 export**: offline-rendered WebCodecs pipeline (H.264 + AAC, hardware
  encode, faster than realtime) — WYSIWYG from the live view, sample-exact
  sync by construction, 720p→4K / 30/60 fps / auto or manual bitrate.
  Design: [docs/EXPORT-DESIGN.md](docs/EXPORT-DESIGN.md); live skew ≤ ~30 ms
  constant, export drift-free
- Product chrome: auto-hides while playing, keyboard shortcuts (press ?),
  hover-scrub seek bar, onboarding empty state, GPU-loss auto-recovery
- Three synthesized demo tracks (120 BPM house / 174 BPM DnB / 70 BPM ambient)
  for instant cross-style testing without files

## Architecture

```
src/
  audio/
    engine.ts          AudioContext graph, decoded-buffer playback, seek/volume
    featurePipeline.ts source-agnostic spectrum->AudioFeatures (deterministic)
    realtimeSource.ts  AnalyserNode driver (live playback)
    offlineSource.ts   AudioBuffer driver at fixed fps (MP4 export path)
    dsp/fft.ts         own real FFT (AnalyserNode is realtime-only)
    types.ts           AudioFeatures — the audio->render contract
    demoTrack.ts       OfflineAudioContext demo synth
  render/
    types.ts           Renderer + Preset interfaces, param schemas (serializable)
    webgpuRenderer.ts  fullscreen-triangle pass, shared WGSL header/ABI
                       (uniforms, bins/peaks/waveform buffers, hsl/noise/fbm)
    canvas2dRenderer.ts fallback renderer, same interface
    presets/           one file per visual; index.ts is the registry
  App.tsx              transport UI, preset picker, auto-generated param panel
docs/EXPORT-DESIGN.md  offline-rendered, frame-perfect MP4 export design
src-tauri/             Rust shell — native capabilities land here (library scan,
                       system-audio loopback, ffmpeg fallback) without touching
                       the render or audio contracts
```

Design rules: renderers consume only `AudioFeatures`; presets declare params
as schema and stay pure functions of (features, time, params) — purity is
what makes offline export output identical to the live view. New visual =
one preset file + registry entry.

## Dev

```
npm install
npm run dev          # browser dev at localhost:1420 (fastest iteration)
npm run tauri dev    # full desktop shell
npm run tauri build  # installer
```

## Roadmap

- Preset gallery + save/load (params are already JSON-serializable)
- Library sidebar: folder scan via Rust, queue, gapless playback
- More presets: waveform tunnel, particles (compute shaders), 3D scenes
- System-audio loopback visualization (WASAPI via Rust)
