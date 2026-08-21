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
  <a href="https://0langa.github.io/beatform/templates"><b>Themes</b></a>
</p>

Tauri 2 + React + TypeScript, WebGPU rendering (Canvas2D fallback), Rust core.

Runs on **Windows 10/11 (x64)** — a ~57 MB installer from [Releases](https://github.com/0langa/beatform/releases/latest), no account, no setup wizard questions. macOS/Linux builds aren't offered yet; the stack (Tauri 2) supports them, so open an issue if you'd use one.

Free and open source. Built to become a professional-grade tool for producers and artists — local-first, no cloud rendering, no watermarks, no subscriptions.

## Features

- Local file playback (mp3/flac/wav/ogg/m4a) via Web Audio — drag & drop or
  file picker; whole-track or draggable A-B region looping with sample-accurate
  Web Audio endpoints
- Configurable log/linear spectrum analysis with 85/171/341 ms-class drawn-spectrum resolution, optional measured FFT bins with no interpolation, asymmetric smoothing, peak hold, band energies, spectral-flux beat detection, slow energy envelope, phase-locked waveform. Longer display FFTs never retune onset detectors
- **20 visual modes** (WebGPU shader presets): Spectrum Bars, Radial Burst,
  Oscilloscope, Particles, Tunnel, Kaleido Nebula, Metaballs, LED Matrix,
  **Spectro Falls** (scrolling spectrogram waterfall), **Lyric Stage**
  (typography-first — the words are the visual, word-level karaoke fill from
  the lyrics engine), **Gatefold** (artwork-first — the track's cover framed
  on a stage lit by its own colors; a generated sleeve when a track has
  none), **Overgrowth** (a living reaction-diffusion culture the music
  farms — energy feeds the growth, kicks plant seeds, deterministic in
  every export), Voice Orb (narration
  mode), Echo Trails (feedback), Particle Flow (120k GPU
  compute particles), Spectrum Scape (3D — spectrum rings/rows/spiral, or the
  track's waveform as rolling terrain), Aurora, Synthwave,
  **Bass Circle** (circular bass visualizer with album art), and **Builder** — a real
  layer compositor: stack up to twelve layers, each with its own blend mode,
  color and parameters; share stacks as `.bfbuilder` files
- Every mode but Builder: 6-15 curated factory **styles**, plus its controls
  sorted into groups (over 550 app-wide). Each group leads with the controls that change the
  look and folds its internal constants behind its own **expert line**, closed
  by default and counting what you have changed; **Show every control** opens
  them all at once. Plain-language **hint** for every control (tooltip + live
  hint bar), all persisted per mode. Builder carries six whole-stack starting
  points instead of style chips
- **Visuals dock** (press **G**): a persistent, keyboard-resizable right-hand
  column the visual runs full width behind — tune while
  you watch. One vertical **section rail** of eight destinations (Mode, Global
  motion, Looks & themes, Sync, Modulation, Scene, Text, Live), each a page; a
  header naming the current mode and style; a search box that finds any control
  by name across every page, expert controls included. Stage mode (**S**) hides
  it entirely
- **User looks**: save your own named looks per visual mode on _Looks &
  themes_, share them as `.bfpreset` files (import/export)
- **Gallery**: browse a public, curated collection of community looks and
  themes right in the app (top-bar button) — every entry pinned to an
  immutable version and checksum-verified before it is ever parsed; add a
  look or apply a theme in one click. The 13 factory themes live here too,
  marked **Built-in** and available with no connection at all. Submissions
  are reviewed on GitHub
  ([beatform-app/gallery](https://github.com/beatform-app/gallery))
- **Shadertoy import**: paste a single-pass Shadertoy shader (the Image tab)
  and it becomes a Beatform visual — translated to WGSL locally, audio on
  `iChannel0` in Shadertoy's own music-texture layout, track-clock time so
  exports match previews exactly, author/license attribution kept with the
  visual and its `.bfshader` exports
- **Auto-updates**: the app checks GitHub Releases and installs new versions
  in one click (signature-verified; no telemetry — the check is a plain fetch
  of a static file). **Preferences** (Ctrl+,), four tabs: _General_ (autosave
  delay, remembered save-dialog folder), _Modes_ (drag the mode strip into
  your own order), _Performance_ (live frame cap, preview resolution, GPU
  preference, and a **Performance display** FPS/CPU/memory overlay drawn over
  the preview and never into it), _Updates_
- **Project files**: save/open the whole setup (preset, params, sync,
  background, layers) as versioned `.bfproj` files — Ctrl+S / Ctrl+O,
  native dialogs
- **Overlay layers**: text with `{title}`/`{artist}` auto-fill from tags,
  logos/images, one-click album art — anchored, resolution-independent,
  resolved from the same project document in exports
- **Frame aspects** (Fill / 16:9 / 9:16 / 1:1) with letterboxed preview and
  aspect-matched export resolutions up to vertical 4K
- **Spotify Canvas mode**: pick any 3-8 s segment, export a 1080×1920
  seamless loop (tail crossfades into the head — invisible loop point)
- **Loudness meter**: momentary LUFS (ITU-R BS.1770) live readout; stereo
  width feature for presets
- **Musical analysis on every track** (background worker): BPM + beat grid
  (visuals get beat/bar phase), kick/snare/hat onset classes as sync
  sources, key detection (Krumhansl), section boundaries as seek-bar ticks
- **Modulation matrix**: target-first cards routing any audio feature (drums,
  bands, width, beat/bar phase, section change, the lyric line, an imported
  stem's bands) or one of eighteen beat-synced LFOs onto any knob of the
  active visual **and the whole post chain** — with depth, response curve,
  rise/fall, six one-click recipes, live per-source meters, and a _driven_
  mark on the sliders themselves. Resolved by the same track-time functions in
  exports
- **Smooth curve toggle**: spline-connected spectrum (Catmull-Rom through
  the bins) instead of hard-edged bars, across all visuals
- **Timeline workstation** (press T): arrange scenes (any visual per song
  part) with beat-snapped drag, seven scene transitions (crossfade, two
  wipes, iris, zoom, glitch, hard cut), and keyframe
  automation lanes for any parameter — against a waveform overview with a
  beat/bar ruler and section markers. Exports resolve the arrangement from
  deterministic track-time timestamps.
- **Undo/redo** (Ctrl+Z / Ctrl+Y) across every edit, with gesture grouping
  (a slider drag is one step); crash-safe autosave on desktop, offered back on the
  next launch if the app died with unsaved work
- Sync-source system: choose what visuals react to (kicks, energy, bass,
  melody, voice, treble, snare, hats) + smoothing/attack/release, saved per mode
- Background system on every preset: preset-animated, any solid color
  (incl. chroma green/magenta swatches), transparent (luma alpha,
  checkerboard preview), an **image** (or album art), or a looped
  **video** (desktop; deterministic frame-by-track-time so exports match).
  Image and video share a Fill/Fit/Stretch framing row with zoom and pan, and
  a scope switch gives any single mode its own background
- **MP4 export**: offline-rendered WebCodecs pipeline (H.264 + AAC, hardware
  encode, faster than realtime) running **in a worker** — the UI never
  freezes. On desktop, exports **stream straight to disk** (fragmented MP4,
  flat memory — hour-long renders are fine). Export A/V timestamps share one
  decoded-audio clock, so drift cannot accumulate. Preview and export share
  DSP/render code but live device timing is not numerically identical; see the
  [preview/export truth contract](docs/PREVIEW-EXPORT-CONTRACT.md). 720p→4K /
  30/60 fps / auto or manual bitrate. **HEVC and
  AV1** where the hardware supports them (probed; codec choice does not change
  the raw render). Design: [docs/EXPORT-DESIGN.md](docs/EXPORT-DESIGN.md)
- **Transparent WebM export** — VP9 with a real alpha channel (color + alpha
  planes muxed via BlockAdditions) + Opus audio, for OBS overlays and web
  embeds. Pick the _VP9 + alpha_ codec, set Background to Transparent
- **PNG sequence export** with alpha — numbered frames into a folder, keeping
  transparency for compositing in Premiere/Resolve/After Effects
- **ProRes 4444 export** (desktop): one .mov with alpha + untouched PCM audio —
  the editorial mezzanine that drops straight into an NLE. Encoded by a bundled
  LGPL ffmpeg sidecar (separate binary; see THIRD_PARTY_LICENSES.md); frames
  stream from the renderer into ffmpeg, so memory stays flat
- **AV1 10-bit export** (desktop): genuine 10-bit MP4 (yuv420p10le, BT.709) —
  the render is tapped at 16-bit float **before** the 8-bit swapchain, so
  smooth gradients keep all their levels instead of banding. Raw 64-bit
  frames stream into the bundled ffmpeg's SVT-AV1 encoder; memory stays flat
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
  streaming service re-encodes it. Audio-only — toggling normalization does
  not change that export's visual analysis or raw frames. Off by default
- **Timed lyrics (.lrc / .srt)**: drop a lyrics file on the window and the
  current line renders karaoke-style over the visual — position, size, color
  and fades configurable from the same timed definition in every export
- **Music library** (desktop): pick your music folder once — every track
  listed with its real tags (title/artist/duration via lofty; scans
  mp3/flac/wav/ogg/m4a plus aac/opus), one click to
  play, and finished tracks flow into the next near-gaplessly (the next file
  is read and decoded while the current one plays)
- **Listen to the system** (desktop): WASAPI loopback visualizes whatever the
  PC is playing — Spotify, a browser, a DAW — live, without touching a file.
  Analysis-only tap; nothing is re-emitted to the speakers
- **Live performance / VJ**: jump between modes with number keys **1–9** or a
  MIDI controller, with optional **beat-quantized takeover** (the switch lands
  on the next beat/bar, Ableton-style); **Stage mode** (**S**) gives a clean
  chrome-free full-bleed output with blackout and a mode-name HUD; **Web MIDI**
  maps knobs to any parameter and notes to modes (local, no drivers). Preview-only
  — never affects exports
- **Second-display output window**: a chrome-free performance window on any
  monitor (fullscreen or movable), mirroring the live visual for the audience
  while you keep the full workstation — plus the **Perform drawer** (**D**):
  mode pads, blackout, monitor picker and live MIDI mappings in one operator
  console. Escape steps fullscreen down before it closes; hotplugging
  monitors re-clamps the window
- Product chrome: auto-hides while playing (the Visuals dock stays lit),
  keyboard shortcuts (press H — every performance shortcut has a letter or
  digit as its primary binding, so it works on every keyboard layout; the
  punctuation aliases are bound by physical key position),
  hover-scrub seek bar, onboarding empty state, GPU-loss auto-recovery
- Three synthesized demo tracks (120 BPM house / 174 BPM DnB / 70 BPM ambient)
  for instant cross-style testing without files

## Architecture

```
src/
  audio/
    engine.ts          AudioContext graph, decoded-buffer playback, seek/volume
    featurePipeline.ts source-agnostic spectrum->AudioFeatures (deterministic)
    realtimeSource.ts  live analysis — shared DSP, device-timed input
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
    project.ts         .bfproj schema, validation, migration point
    userPresets.ts     .bfpreset user looks
    platform.ts        Tauri/browser file dialogs + IO
    persistence.ts     localStorage cache (last session)
  App.tsx              view layer over the store
docs/EXPORT-DESIGN.md  offline-rendered, frame-perfect MP4 export design
src-tauri/             Rust shell — dialog/fs plugins, library scan
                       (walkdir + lofty), WASAPI loopback capture (cpal)
```

Design rules: renderers consume only `AudioFeatures`; presets declare params
as schema and stay pure functions of (features, time, params) — purity is
what makes the indexed offline frame walk repeatable. Live device sampling and
cross-hardware pixels remain measured parity, not identity. New visual = one
preset file + registry entry. Document state lives in the store's document
slice and is what `.bfproj` serializes.

## Dev

```
npm install

# one-time, none of these are in git:
node scripts/fetch-ffmpeg.mjs          # ffmpeg sidecar (~110 MB) — ProRes/AV1/GIF/WebP
node scripts/fetch-whisper.mjs         # whisper.cpp runtime (lyrics)
node scripts/fetch-onnxruntime.mjs     # onnxruntime + DirectML (lyrics)
node scripts/build-lyrics-sidecar.mjs  # lyrics sidecar exe — required before any cargo
                                       # command works (the bundle resource must exist)

npm run dev          # browser dev at localhost:1420 (fastest iteration)
npm run tauri dev    # full desktop shell
npm run tauri build  # installer (needs every sidecar above)
npm test             # vitest (DSP, schemas, golden traces)
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
```

The full gate list — web, Rust, and the device/E2E suites with the rules for
when each is mandatory — is [`GATES.md`](GATES.md). CI runs the web gates
(typecheck, lint, format check, tests, build) on every push/PR, plus a desktop
job (`cargo fmt --all`, `cargo clippy --workspace`, `cargo test --workspace`)
and a dependency audit. Always pass `--workspace`/`--all` to cargo: bare cargo
silently skips the lyrics-sidecar member.

## Roadmap

The foundations → workstation → visual-ceiling → pro-delivery → ecosystem →
storytelling → motion → live-performance ("Stage") arc is **complete and
shipped** — beat-quantized switching, Web MIDI, Stage mode, and the
second-display output window with its Perform drawer all landed (v2.104.0).
Everything stays free and open source, GitHub-only, with no monetization.

Current work, evidence gaps, feature candidates and explicit non-goals are kept
in [`BACKLOG.md`](BACKLOG.md). That ledger is the canonical detailed queue;
older local roadmap and plan files are historical records.

The full on-hardware acceptance pass (2026-07-27) is **complete** — every item
in its scope green, including real-hardware drag-and-drop, a physical
non-US keyboard, a two-hour export soak and a ProRes 4444 alpha round-trip in
DaVinci Resolve; `TESTING.md` records the pass and the few surfaces added
since it ran.
**v3.0.0 is not a version bump waiting on a checklist.** It is the point where
this is exactly the app it should be — every feature something to stand behind,
not merely something that works. Passing the acceptance pass is evidence toward
that, not a trigger for it. Development continues on the 2.x line.
