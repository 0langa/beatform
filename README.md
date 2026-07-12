# Audio Visualizer

Desktop music visualizer. Tauri 2 + React + TypeScript, WebGPU rendering (Canvas2D fallback), Rust core.

## Features

- Local file playback (mp3/flac/wav/ogg/m4a) via Web Audio — drag & drop or file picker
- Log-spaced spectrum analysis, asymmetric smoothing, peak hold, band energies, spectral-flux beat detection
- WebGPU fragment-shader presets with live-tweakable parameters
- Synthesized demo track for instant testing without files

## Architecture

```
src/
  audio/
    engine.ts      AudioContext graph, decoded-buffer playback, seek/pause/volume
    features.ts    AnalyserNode -> AudioFeatures (log bins, peaks, bands, beat)
    types.ts       AudioFeatures — the audio->render contract
    demoTrack.ts   OfflineAudioContext demo synth
  render/
    types.ts       Renderer + Preset interfaces, param schemas (serializable)
    webgpuRenderer.ts   fullscreen-triangle pass, preset WGSL compiled in
    canvas2dRenderer.ts fallback renderer, same interface
    presets/
      spectrumBars.ts   default preset (WGSL fragment + param defs)
  App.tsx          transport UI, drag&drop, auto-generated param panel
src-tauri/         Rust shell — native capabilities land here (library scan,
                   system-audio loopback, decode offload) without touching the
                   render or audio contracts
```

Design rule: renderers consume only `AudioFeatures`; presets declare params as
schema. New visuals = new preset file. New audio sources = engine change only.

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
