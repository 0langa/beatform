# User guide

Everything the app does, panel by panel — all of it also lives in the app
itself: the **User guide** button in the shortcut overlay (press `H`) opens
a 12-section in-app walkthrough. Keyboard shortcuts: press `H` (or
`?`) in the app (Space play/pause, P/N switch mode, G settings, T timeline,
B batch, Q library, L loop, F fullscreen, S stage, Ctrl+Z undo). Every
shortcut is a letter or digit, so it sits on the same labeled key on every
keyboard layout — QWERTZ, AZERTY and friends included.

## Visual modes

Sixteen modes on the strip: Spectrum Bars, Radial Burst, Oscilloscope,
Particles, Tunnel, Kaleido Nebula, Metaballs, LED Matrix, Voice Orb, Echo
Trails, Particle Flow (120k GPU particles), Spectrum Scape (3D), Aurora,
Synthwave, Bass Circle, and **Builder** (the layer compositor, below).
Each mode has curated **styles** (one-click looks), main parameters, and an
**Advanced** drawer exposing every internal constant worth touching.
Bass Circle and Radial Burst show artwork in their center: the track's
**embedded cover art** by default, or any image you choose via the
**Center image** row (saved per mode). Bass Circle's **Match cover colors**
toggle analyzes whichever image is displayed and sets Hue + Hue spread to
fit it — automatically again on every new track. Hover
any control for a plain-language hint. The settings panel (G) is organized
into **tabs** (Visual / Sync / Scene / Text / Live), every section
collapses, the panel edge drags to resize — and the **search box** at the
top finds any setting by name across all tabs.

## Builder

A real layer compositor: stack up to twelve layers from nine types
(background wash, particles, spectrum bars, radial ring, pulse rings,
waveform circle, orb, wave line, vignette) — the same type as often as you
like. Every layer has its own on/off, opacity, **blend mode**
(Normal / Add / Screen), color (hue + spread) and parameters; reorder with
▲▼, duplicate with ⧉. Stacks save inside your project, and
**Export .avbuilder** shares a stack as a single file anyone can import.

## Sync — what drives the motion

_Settings → Sync_ routes ONE source to every mode: **Kicks** (default),
Energy, Bass, Melody, Voice, Treble, Snare, or Hats. Smoothing has a macro
slider plus independent **Attack**/**Release** for punchy-in, ease-out
reactions.

Modes that draw the spectrum also get three **shape** controls (saved per
mode and included in exports): **Merge** melts isolated spikes into
one connected silhouette (each bar props up its neighbors, Monstercat-style),
**Rounding** averages neighboring bars — real smoothing, unlike the _Smooth
curve_ spline which only rounds corners between still-spiky values — and
**Contrast** flattens (below 50%) or exaggerates (above 50%) the peaks. They
shape the drawn bars only; the sync feel (attack/release, beat pulses) is
untouched.

**Low edge** and **High edge** set the frequency span the bars cover. The
bars are spaced geometrically across it — equal width per octave — so
raising the low edge stops spending bars on sub-bass a track doesn't have,
and lowering the high edge gives the musical range more of the width.

Two kinds of beat reaction work together:

- **Onset pulses** fire on actual hits in the selected band.
- **Beat-grid pulses** ride the track's detected tempo grid (BPM shown in the
  panel footer), landing on every metronome beat — Synthwave's grid scrolls
  exactly one line per beat, Tunnel launches a light ring per beat that
  arrives as the next one lands, Bass Circle pumps on the grid. Tracks
  without a detectable grid fall back to onset pulses automatically.

**Motion masters** scale rotation, pulse strength, element count, and
spectrum smoothing globally — dial the whole app calmer or wilder from one
place.

_Settings → Sync → Modulation_ routes any audio feature to any knob. The
target list covers this visual's own parameters **and the post-processing
chain** — so the kick can drive Chromatic, bass can breathe the Bloom, and
the whole look moves with the track. Exports resolve routes from the same
track-time functions.

## Layers

Text (with `{title}` / `{artist}` filled from the track's tags), logo
images, or the track's embedded album art. Nine-point anchoring and fractional
sizing use one layout model in preview and export; raster pixels vary with
target resolution.

## Timeline

Press **T**: scenes switch visual modes at beats (drag snaps to the grid),
automation lanes keyframe any parameter, and each scene picks a **Transition**
for its incoming fade — crossfade, wipe, iris, zoom, glitch, or hard cut.
Click a keyframe dot to cycle its curve (linear/smooth/hold); right-click
removes it. **✦ Auto-arrange** builds a scene arrangement from the song's
detected sections in one click.

## Library and live input (desktop)

- **Q** opens the music library: pick your folder once, every track appears
  with real tags; click to play; finished tracks flow into the next
  near-gaplessly.
- The **broadcast icon** visualizes whatever Windows is playing — Spotify, a
  browser, a DAW — via native loopback. Analysis-only: nothing echoes back
  out. Play/pause stops listening.

## Live performance

Beatform doubles as a live/VJ tool. Everything here is preview-only — it never
changes an export.

- **Jump between modes hands-free.** Number keys **1–9** (or clicking a mode
  chip) switch the visual. With **Settings ▸ Live ▸ Quantize** set to **Beat**
  or **Bar**, the switch doesn't happen instantly — it waits and lands exactly
  on the next beat/bar of the detected grid, Ableton-session-launch style. The
  queued mode's chip pulses until it takes over. Off = instant.
- **Stage mode** (the monitor icon, or **S**) hides all the chrome and the
  cursor for a clean, full-bleed output — for a projector, a capture card, or
  screen-share. The mode name flashes briefly on each switch so you can drive
  blind. **0** blacks out (the VJ cut — 1–9 pick modes, 0 cuts to black);
  **Esc** exits.
- **MIDI** (Settings ▸ MIDI ▸ Enable, on Chromium-based builds): map a
  controller's knobs and pads. **Learn CC** then move a knob to bind it to the
  selected setting; **Learn note → &lt;mode&gt;** then play a note to switch to
  that mode (it obeys the beat-quantize too). Bindings are remembered. Local
  only, no drivers.
- Pair Stage mode with the **broadcast icon** (loopback, below) and you have a
  live rig: visualize whatever the PC is playing, switch on the beat by hand or
  MIDI, output clean and full-screen.

## Lyrics

Drop an `.lrc` file (any lyrics site exports them) or `.srt` subtitles onto
the window — the current line follows the music, karaoke-style, live and in
every export. Position/size/color, an **Animation** (plain / slide / pop, or
**karaoke** — the line fills bright left-to-right as it's sung) and fade live in
the panel's **Lyrics** section. Drop the lyrics together with
the track or after it; they attach to the loaded track like stems do.

## Stems

Import a stem (drums/bass/vocals bounced from 0:00) in the panel's
**Modulation** section — it's analyzed once, never played, and its bands
become modulation sources. Hit the **✦** on a stem chip to auto-wire its
kick/bass/snare/hats/mids to the best-matching knobs of the current visual;
tweak the amounts from there.

## Audiogram

The panel's **Audiogram** section adds track-driven overlay elements — a
progress bar, an elapsed/total time readout, and a mini-waveform strip with
a moving playhead (the podcast/reel look). Position and accent color are
yours; exports use the same timed overlay definition.

## Export

- **MP4** — H.264 everywhere; **HEVC/AV1** where your GPU supports them
  (probed automatically; codec choice leaves the raw render unchanged). 720p→4K, 30/60
  fps, auto or manual bitrate. Optional **loudness normalization** to −14 /
  −16 / −23 LUFS with a −1 dBTP true-peak ceiling (audio only — pixels
  unchanged).
- **Video** — pick a short local clip to loop behind the visualization
  (desktop): cover-fit, dimmable, deterministic (the frame for each moment is a
  pure function of track time in both paths). Decoded to a fixed loop of the
  first seconds; raster output still follows the truth-contract tolerances.
- **Per-mode backgrounds** — the Background section's scope switch ("All
  modes" / "This mode") gives any mode its own background, image and video
  included: Spectrum Bars can sit on your video loop while Bass Circle keeps
  its animated backdrop. Modes without an override follow the shared one.
- **WebM VP9 + alpha** — pick the _VP9 + alpha_ codec to write a transparent
  `.webm` (color + alpha planes, Opus audio) for OBS overlays and web embeds.
  Set Background to Transparent.
- **PNG frames** — numbered stills with alpha (set Background to
  Transparent) for compositing.
- **ProRes 4444** — one `.mov` with alpha + untouched PCM audio, straight
  into Premiere/Resolve/AE. Encoded by the bundled LGPL ffmpeg.
- **GIF / animated WebP** — loop files via the bundled ffmpeg, no audio.
  Pair with Canvas loop mode for a seamless loop; WebP keeps alpha.
- **Canvas loop** — a 3–8 s seamless loop at 1080×1920/30 for Spotify
  Canvas; the tail crossfades into the head.
- **Batch** (**B**) — one video per dropped track, titled from each file's
  own tags. A failed file costs that one video, never the night.

Exports render offline in a worker: the UI stays live, indexed audio/video
timestamps prevent accumulated drift, and on desktop the file streams to disk
so hour-long renders hold flat memory. Preview parity scope and tolerances:
[preview/export truth contract](PREVIEW-EXPORT-CONTRACT.md).

## App settings & updates

The **gear icon** in the top bar (or **Ctrl+,**) opens the app-settings
page — preferences about the app itself,
separate from the per-visual panel: autosave delay, the remembered
save-dialog folder, a **live-preview frame cap** (30/60 — exports always
render every frame), a **GPU preference** for dual-GPU laptops, and updates.
Beatform **updates itself**: it checks GitHub Releases shortly after launch
(a plain fetch of a static file — no telemetry, ever). When a new version is
found, a dialog offers it right away — release notes, **Install now** or
Later — and installs with one click and a restart. Turn the automatic check
off in settings if you prefer manual.

## Projects, looks, templates

- **Ctrl+S / Ctrl+O** — `.avproj` project files (everything, portable).
- **Save look** — a named parameter set for one mode (`.avpreset`).
- **Templates** — a complete setup as one shareable `.avtheme` file; see
  [Templates](templates).
