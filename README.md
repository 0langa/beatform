<p align="center">
  <img src="brand/logo.svg" width="128" alt="Beatform">
</p>

<h1 align="center">Beatform</h1>

<p align="center">
  Desktop music visualizer — WebGPU rendering, deterministic exports, local-first.
</p>

<p align="center">
  <a href="https://github.com/0langa/beatform/releases/latest"><b>Download</b></a>
  ·
  <a href="https://0langa.github.io/beatform/"><b>Docs</b></a>
  ·
  <a href="https://0langa.github.io/beatform/presets"><b>Add a visual mode</b></a>
  ·
  <a href="https://0langa.github.io/beatform/templates"><b>Templates</b></a>
</p>

Tauri 2 + React + TypeScript, WebGPU rendering (Canvas2D fallback), Rust core.

Free and open source. Built to become a professional-grade tool for producers and artists — local-first, no cloud rendering, no watermarks, no subscriptions.

## Features

- Local file playback (mp3/flac/wav/ogg/m4a) via Web Audio — drag & drop or file picker; gapless loop toggle
- Log-spaced spectrum analysis, asymmetric smoothing, peak hold, band energies, spectral-flux beat detection, slow energy envelope, phase-locked waveform
- **16 visual modes** (WebGPU shader presets): Spectrum Bars, Radial Burst,
  Oscilloscope, Particles, Tunnel, Kaleido Nebula, Metaballs, LED Matrix,
  Voice Orb (narration mode), Echo Trails (feedback), Particle Flow (120k GPU
  compute particles), Spectrum Scape (3D), Aurora, Synthwave,
  **Bass Circle** (circular bass visualizer with album art), and **Builder** —
  compose your own from six toggleable layers
- Every mode: 5-7 curated factory **styles**, curated params + full **Advanced** section
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
- **Musical analysis on every track** (background worker): BPM + beat grid
  (visuals get beat/bar phase), kick/snare/hat onset classes as sync
  sources, key detection (Krumhansl), section boundaries as seek-bar ticks
- **Modulation matrix**: route any audio feature (drums, bands, width,
  beat phase...) to any knob of the active visual — applied identically in
  exports
- **Smooth curve toggle**: spline-connected spectrum (Catmull-Rom through
  the bins) instead of hard-edged bars, across all visuals
- **Timeline workstation** (press T): arrange scenes (any visual per song
  part) with beat-snapped drag, crossfade transitions, and keyframe
  automation lanes for any parameter — against a waveform overview with a
  beat/bar ruler and section markers. Exports render the arrangement
  frame-perfectly.
- **Undo/redo** (Ctrl+Z / Ctrl+Y) across every edit, with gesture grouping
  (a slider drag is one step); crash-safe autosave on desktop
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
  is sample-exact. 720p→4K / 30/60 fps / auto or manual bitrate. **HEVC and
  AV1** where the hardware supports them (probed, smaller files, identical
  pixels). Design: [docs/EXPORT-DESIGN.md](docs/EXPORT-DESIGN.md)
- **Transparent WebM export** — VP9 with a real alpha channel (color + alpha
  planes muxed via BlockAdditions) + Opus audio, for OBS overlays and web
  embeds. Pick the _VP9 + alpha_ codec, set Background to Transparent
- **PNG sequence export** with alpha — numbered frames into a folder, keeping
  transparency for compositing in Premiere/Resolve/After Effects
- **ProRes 4444 export** (desktop): one .mov with alpha + untouched PCM audio —
  the editorial mezzanine that drops straight into an NLE. Encoded by a bundled
  LGPL ffmpeg sidecar (separate binary; see THIRD_PARTY_LICENSES.md); frames
  stream from the renderer into ffmpeg, so memory stays flat
- **GIF / animated WebP export** (desktop): seamless loop files via the bundled
  ffmpeg — GIF for anywhere, WebP for small files with alpha. Pairs with Canvas
  loop mode
- **Batch render**: drop in 20 tracks, get 20 titled videos — one per track,
  unattended. Each title comes from that file's own **ID3 tags**, so there is no
  spreadsheet and no retyping; anything untagged falls back to the filename and
  is flagged so you can fix it in place. Everything else (preset, layers,
  timeline, post, loudness) is whatever you have set up. One job at a time, and
  a file that fails costs that one video rather than the night
- **Loudness normalization** on export: match the audio to −14 LUFS (streaming),
  −16 (podcast) or −23 (EBU R128), measured per ITU-R BS.1770-4 and held under a
  −1 dBTP ceiling by a look-ahead true-peak limiter, so nothing clips when a
  streaming service re-encodes it. Audio-only — a normalized export renders
  frame-for-frame identically to the preview. Off by default
- **Music library** (desktop): pick your music folder once — every track
  listed with its real tags (title/artist/duration via lofty), one click to
  play, and finished tracks flow into the next near-gaplessly (the next file
  is read and decoded while the current one plays)
- **Listen to the system** (desktop): WASAPI loopback visualizes whatever the
  PC is playing — Spotify, a browser, a DAW — live, without touching a file.
  Analysis-only tap; nothing is re-emitted to the speakers
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
src-tauri/             Rust shell — dialog/fs plugins, library scan
                       (walkdir + lofty), WASAPI loopback capture (cpal)
```

Design rules: renderers consume only `AudioFeatures`; presets declare params
as schema and stay pure functions of (features, time, params) — purity is
what makes offline export output identical to the live view. New visual =
one preset file + registry entry. Document state lives in the store's
document slice and is what `.avproj` serializes.

## Dev

```
npm install
node scripts/fetch-ffmpeg.mjs  # one-time: ProRes sidecar (~110 MB, not in git)
npm run dev          # browser dev at localhost:1420 (fastest iteration)
npm run tauri dev    # full desktop shell
npm run tauri build  # installer (needs the ffmpeg sidecar fetched)
npm test             # vitest (DSP, schemas, golden traces)
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
```

CI runs typecheck, lint, format check, tests and build on every push/PR.

## Roadmap (next)

- Producer basics, remaining: video/image backgrounds, preset thumbnails
- Musical sync, remaining: stem import as additional sync sources
- Visual ceiling, remaining: custom WGSL preset SDK (in-app editor)
- Ecosystem (v3.0): .avtheme templates + gallery, CI-built installers,
  docs site
