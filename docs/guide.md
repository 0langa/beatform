# User guide

Everything the app does, panel by panel. Keyboard shortcuts: press `?` in
the app (Space play/pause, `[`/`]` switch mode, G settings, T timeline,
B batch, Q library, L loop, F fullscreen, Ctrl+Z undo).

## Visual modes

Sixteen modes on the strip: Spectrum Bars, Radial Burst, Oscilloscope,
Particles, Tunnel, Kaleido Nebula, Metaballs, LED Matrix, Voice Orb, Echo
Trails, Particle Flow (120k GPU particles), Spectrum Scape (3D), Aurora,
Synthwave, Bass Circle, and Builder (a six-layer compositor you assemble
yourself). Each mode has curated **styles** (one-click looks), main
parameters, and an **Advanced** drawer exposing every internal constant
worth touching. Hover any control for a plain-language hint.

## Sync — what drives the motion

_Settings → Sync_ routes ONE source to every mode: **Kicks** (default),
Energy, Bass, Melody, Voice, Treble, Snare, or Hats. Smoothing has a macro
slider plus independent **Attack**/**Release** for punchy-in, ease-out
reactions.

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

## Layers

Text (with `{title}` / `{artist}` filled from the track's tags), logo
images, or the track's embedded album art. Nine-point anchoring, fractional
sizing. Layers render identically in preview and export.

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
- **Stage mode** (the monitor icon, or **`\`**) hides all the chrome and the
  cursor for a clean, full-bleed output — for a projector, a capture card, or
  screen-share. The mode name flashes briefly on each switch so you can drive
  blind. **`.`** blacks out (the VJ cut); **Esc** exits.
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
every export. Position/size/color, an entry **Animation** (plain / slide / pop)
and fade live in the panel's **Lyrics** section. Drop the lyrics together with
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
yours; everything renders identically in exports.

## Export

- **MP4** — H.264 everywhere; **HEVC/AV1** where your GPU supports them
  (probed automatically; identical pixels, smaller files). 720p→4K, 30/60
  fps, auto or manual bitrate. Optional **loudness normalization** to −14 /
  −16 / −23 LUFS with a −1 dBTP true-peak ceiling (audio only — pixels
  unchanged).
- **Video** — pick a short local clip to loop behind the visualization
  (desktop): cover-fit, dimmable, deterministic (the frame for each moment is a
  pure function of track time, so exports match the preview). Decoded to a
  fixed loop of the first seconds.
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

Exports render offline in a worker: the UI stays live, sync is sample-exact,
and on desktop the file streams to disk so hour-long renders hold flat
memory.

## Projects, looks, templates

- **Ctrl+S / Ctrl+O** — `.avproj` project files (everything, portable).
- **Save look** — a named parameter set for one mode (`.avpreset`).
- **Templates** — a complete setup as one shareable `.avtheme` file; see
  [Templates](templates).
