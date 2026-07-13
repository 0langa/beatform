# Audio Visualizer

Desktop music visualizer. Tauri 2 + React + TypeScript, WebGPU rendering (Canvas2D fallback), Rust core. v1.5.0.

Free and open source. Built to become a professional-grade tool for producers and artists — local-first, no cloud rendering, no watermarks, no subscriptions.

## Features

- Local file playback (mp3/flac/wav/ogg/m4a) via Web Audio — drag & drop or file picker; gapless loop toggle
- Log-spaced spectrum analysis, asymmetric smoothing, peak hold, band energies, spectral-flux beat detection, slow energy envelope, phase-locked waveform
- **10 visual modes** (WebGPU shader presets): Spectrum Bars, Radial Burst,
  Oscilloscope, Particles, Tunnel, Kaleido Nebula, Metaballs,
  LED Matrix, Voice Orb (narration mode), and **Builder** — compose your own
  from six toggleable layers
- Every mode: 4 factory **styles**, curated params + full **Advanced** section
  (~150 knobs app-wide), plain-language **hint** for every setting (tooltip +
  live hint bar), all persisted per mode
- **User looks**: save your own named looks per visual mode, share them as
  `.avpreset` files (import/export)
- **Project files**: save/open the whole setup (preset, params, sync,
  background, layers) as versioned `.avproj` files — Ctrl+S / Ctrl+O,
  native dialogs
- **Overlay layers**: text with `{title}`/`{artist}` auto-fill from tags,
  logos/images, one-click album art — anchored, resolution-independent,
  rendered into exports identically
- **Frame aspects** (Fill / 16:9 / 9:16 / 1:1) with letterboxed preview and
  aspect-matched export resolutions up to vertical 4K
- **Spotify Canvas mode**: pick any 3-8 s segment, export a 1080×1920
  seamless loop (tail crossfades into the head — invisible loop point)
- **Loudness meter**: momentary LUFS (ITU-R BS.1770) live readout; stereo
  width feature for presets
- Sync-source system: choose what visuals react to (kicks, energy, bass,
  melody, voice, treble) + smoothing, per mode
- Background system on every preset: preset-animated, any solid color
  (incl. chroma green/magenta swatches), or transparent (luma alpha,
  checkerboard preview)
- **MP4 export**: offline-rendered WebCodecs pipeline (H.264 + AAC, hardware
  encode, faster than realtime) running **in a worker** — the UI never
  freezes. On desktop, exports **stream straight to disk** (fragmented MP4,
  flat memory — hour-long renders are fine). WYSIWYG by construction: the
  live view and the export run the exact same FFT/windowing math, and sync
  is sample-exact. 720p→4K / 30/60 fps / auto or manual bitrate.
  Design: [docs/EXPORT-DESIGN.md](docs/EXPORT-DESIGN.md)
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
    realtimeSource.ts  live analysis — same RealFFT as export (WYSIWYG)
    offlineSource.ts   PcmData driver at fixed fps (export path)
    dsp/fft.ts         own real FFT (Hann), shared by live + offline paths
    types.ts           AudioFeatures — the audio->render contract
    demoTrack.ts       OfflineAudioContext demo synth
  render/
    types.ts           Renderer + Preset interfaces, param schemas (serializable)
    webgpuRenderer.ts  fullscreen-triangle pass, shared WGSL header/ABI
    canvas2dRenderer.ts fallback renderer, same interface
    presets/           one file per visual; index.ts is the registry
  export/
    exportCore.ts      env-agnostic render+encode+mux pipeline
    exportWorker.ts    module worker running the core off the main thread
    videoExporter.ts   orchestration: worker/inline, blob or stream-to-disk
  state/
    store.ts           zustand store: document slice (project payload) + session
    services.ts        engine/analyzer/renderer singletons + frame loop
    project.ts         .avproj schema, validation, migration point
    userPresets.ts     .avpreset user looks
    platform.ts        Tauri/browser file dialogs + IO
    persistence.ts     localStorage cache (last session)
  App.tsx              view layer over the store
docs/EXPORT-DESIGN.md  offline-rendered, frame-perfect MP4 export design
src-tauri/             Rust shell — dialog + fs plugins; more native
                       capabilities land here (library scan, WASAPI loopback)
```

Design rules: renderers consume only `AudioFeatures`; presets declare params
as schema and stay pure functions of (features, time, params) — purity is
what makes offline export output identical to the live view. New visual =
one preset file + registry entry. Document state lives in the store's
document slice and is what `.avproj` serializes.

## Dev

```
npm install
npm run dev          # browser dev at localhost:1420 (fastest iteration)
npm run tauri dev    # full desktop shell
npm run tauri build  # installer
npm test             # vitest (DSP, schemas, golden traces)
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
```

CI runs typecheck, lint, format check, tests and build on every push/PR.

## Roadmap (next)

- Producer basics, remaining: video/image backgrounds, preset thumbnails
- Musical sync: BPM/beat-grid tracking, kick/snare/hat onset classes,
  key detection, stem import as sync sources, modulation matrix
- Timeline: scenes, keyframes, automation, undo/redo
- Visual ceiling: multi-pass render graph, real bloom/post stack, compute
  particles, 3D camera scenes, custom WGSL preset SDK
- Delivery: PNG sequences + alpha, more codecs, batch render queue,
  system-audio loopback (WASAPI), library sidebar
