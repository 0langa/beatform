# User guide

Everything the app does, panel by panel — all of it also lives in the app
itself: the **User guide** button in the shortcut overlay (press `H`) opens
a 13-section in-app walkthrough. Keyboard shortcuts: press `H` (or
`?`) in the app (Space play/pause, P/N switch mode, G Visuals, T timeline,
B batch, Q library, L loop, I/O set A-B markers, F fullscreen, S stage,
Ctrl+Z undo, Esc close). Every performance shortcut has a letter or digit as
its primary binding, so it sits on the same labeled key on every keyboard
layout — QWERTZ, AZERTY and friends included. The punctuation aliases a few
of them also answer to (`[`, `]`, `\`, `.`) are bound by physical key
position rather than by the printed character, for the same reason.

## Playback and A-B loops

The player seek bar supports a session-only loop region for tuning a look
against one drop or phrase:

1. Press **I** at the start and **O** at the end, or click the **A** and **B**
   buttons beside the loop control.
2. Drag either labeled marker on the seek bar for precise adjustment.
3. Press **L** (or the loop icon). With both markers set, only that region
   loops; without them, the same control loops the whole track.
4. Click **×** beside A/B to clear the region without turning whole-track loop
   off.

Markers reset when a different track loads. They are preview workflow state,
not project or export data.

## Visual modes

Sixteen modes on the strip: Spectrum Bars, Radial Burst, Oscilloscope,
Particles, Tunnel, Kaleido Nebula, Metaballs, LED Matrix, Voice Orb, Echo
Trails, Particle Flow (120k GPU particles), Spectrum Scape (3D), Aurora,
Synthwave, Bass Circle, and **Builder** (the layer compositor, below).
Every mode but Builder has curated **styles** (one-click looks — six to
fourteen of them, depending on the mode) and sorts its controls into groups.
A group leads with the few controls that change the look, then a line
reading **3 expert controls** folding away that group's internal constants —
closed until you click it, and marked **_n_ changed** once you move one of
them. **Show every control**, below the groups, opens every expert line at
once; it then reads **Hide expert controls**. Search reaches expert controls
whether their line is open or not.

Bass Circle and Radial Burst show artwork in their center: the track's
**embedded cover art** by default, or any image you choose via the
**Center image** row (saved per mode). Both also carry a **Match cover
colors** toggle, which analyzes whichever image is displayed and sets Hue +
Hue spread to fit it — automatically again on every new track. Two other
modes use cover art differently: Tunnel can paper the tunnel wall with it
(**Cover wall**), and Echo Trails offers it as a **Source shape**. Hover
any control for a plain-language hint, which appears at the bottom of the
Visuals dock.

## The Visuals dock

**G** opens **Visuals**, the panel on the right that holds every control for
the visual you are building. It is a dock, not an overlay: the picture
runs full width behind it, so you can watch a slider
land while you are dragging it. Drag its left edge to resize (or focus the
edge and use the arrow keys — Shift for larger steps, Home/End for the
extremes); the width is remembered. **Stage mode** (**S**) hides it entirely.

Down its left side is the **section rail** — eight destinations, one page
each:

| Destination        | What is on it                                                |
| ------------------ | ------------------------------------------------------------ |
| **Mode**           | The active visual: its styles and every one of its controls  |
| **Global motion**  | The rotation / pulse / detail masters every visual obeys     |
| **Looks & themes** | Your saved looks, whole-project themes, the Gallery shortcut |
| **Sync**           | What the visual reacts to, and how hard                      |
| **Modulation**     | Routes and stems — audio and LFOs onto individual controls   |
| **Scene**          | Background, frame, post-processing, overlay layers           |
| **Text**           | Lyrics and the audiogram strip                               |
| **Live**           | Beat-quantized mode switching and MIDI                       |

Click a destination to go there; the arrow keys walk the rail (the whole
rail is one Tab stop). Modulation, Scene and Live show a small count when
you have routes, overlay layers or MIDI bindings. A destination the current
visual cannot use — Global motion on a visual that has nothing to rotate or
pulse — is dimmed and says why on hover, pointing you at that visual's own
Motion group on Mode. A header above the page always names the
mode you are editing, plus its style when one is exactly applied. The page
you were last on is remembered.

Pages do not fold. The **control groups** on the Mode page (Shape, Color,
Motion, Reaction, Glow, Image, Camera, Backdrop) still do, and remember it.
Every group a visual declares appears, each showing at least one control
above its expert line. The **search box** spans the top of the dock and
ignores the rail entirely — it finds a control by name wherever it lives,
including behind a closed expert line or a collapsed group.

## Builder

A real layer compositor: stack up to twelve layers from nine types
(background wash, particles, spectrum bars, radial ring, pulse rings,
waveform circle, orb core, wave line, vignette) — the same type as often as
you like. Every layer has its own on/off, opacity, **blend mode**
(Normal / Add / Screen), color (hue + spread) and controls; reorder with
▲▼, duplicate with ⧉. Stacks save inside your project, and
**Export .bfbuilder** shares a stack as a single file anyone can import.

Builder has no style chips. In their place it ships six whole-stack starting
points — Classic, Neon club, Sunset drive, Deep space, Cathedral, Phosphor.
It renders through WGSL codegen, so it is WebGPU-only and switched off on the
Canvas2D fallback.

## Sync — what drives the motion

_Visuals ▸ Sync_ routes ONE source to the current mode: **Kicks** (default),
Energy, Bass, Melody, Voice, Treble, Snare, or Hats. The choice is saved per
mode, so a vocal-heavy mode can sit on Voice while the rest stay on Kicks.
Smoothing has a macro slider plus independent **Attack**/**Release** for
punchy-in, ease-out reactions.

Everything below the source buttons except Smoothing/Attack/Release only
appears on modes that draw a spectrum. On the others, Sync is the eight
source buttons and the response feel, and nothing else.

Modes that draw the spectrum also get three **shape** controls (saved per
mode and included in exports): **Merge** melts isolated spikes into
one connected silhouette (each bar props up its neighbors, Monstercat-style),
**Rounding** averages neighboring bars — real smoothing, unlike the _Smooth
curve_ spline which only rounds corners between still-spiky values — and
**Contrast** flattens (below 50%) or exaggerates (above 50%) the peaks. They
shape the drawn bars only; the sync feel (attack/release, beat pulses) is
untouched.

**Resolution** controls only the spectrum that is drawn. Its three buttons are
labelled with the window they actually produce at your device's sample rate —
roughly **85 ms**, **170 ms** and **340 ms** — rather than with adjectives; the
second doubles the first and the third quadruples it, subject to the
32768-point Web Audio ceiling. A longer window separates closer low tones but
necessarily carries more audio history, and each button spells out the visual
latency that costs. It never changes kicks, beats, band energies, or sync
timing: those stay on the responsive detector FFT.

**Axis** chooses Musical (logarithmic, equal width per octave) or Linear
(equal hertz per horizontal step). **Sampling** chooses **96 bands**, which
resamples the transform into the authored 96-bar budget, or **FFT bins**,
which reads integer transform bins only. FFT-bin mode is linear and uses fewer
bars when the selected range physically contains fewer than 96 bins. The
readout below the controls reports the actual device-rate window, hertz per
bin, native bin count, and rendered count rather than implying detail that the
transform does not contain.

**Low edge** and **High edge** set the frequency span the bars cover. Raising
the low edge (10–500 Hz) stops spending bars on sub-bass the track does not
have; lowering the high edge gives a narrow musical range more of the width.
High edge runs from 22 kHz all the way down to 200 Hz, so the bars can cover
nothing but the low end for an analyzer-style view.

Two kinds of beat reaction work together:

- **Onset pulses** fire on actual hits in the selected band.
- **Beat-grid pulses** ride the track's detected tempo grid (BPM shown in the
  Visuals footer), landing on every metronome beat — Synthwave's grid scrolls
  exactly one line per beat, Tunnel launches a light ring per beat that
  arrives as the next one lands, Bass Circle pumps on the grid. Tracks
  without a detectable grid fall back to onset pulses automatically.

_Visuals ▸ Global motion_ holds three **motion masters**: **Rotation**,
**Pulse** and **Detail** (element count), each scaled globally — dial the
whole app calmer or wilder from one place. Each slider only appears on modes
it can actually move. The fourth master, spectrum smoothing, is a motion
setting but its slider lives on Sync beside the other spectrum controls. The
name says which of the two kinds this page is: a visual's own motion controls
sit in the Motion group on Mode. On a visual that has nothing to rotate or
pulse the destination is dimmed and tells you so.

_Visuals ▸ Modulation_ aims one signal at one knob. It is **target-first**:
pick a control from **+ Modulate a control…** and you get a card for it, then
add the sources that should move it. The target list covers this visual's own
controls **and the post-processing chain** (Exposure, Bloom, Bloom threshold,
Vignette, Chromatic, Film grain) — so the kick can drive Chromatic, bass can
breathe the Bloom, and the whole look moves with the track.

Each route has a **Depth** — the share of the knob's own range added at full
signal, negative to pull the other way — and, behind the card's chevron, a
response curve (**Linear** / **Exp** / **Smooth**) with **Rise** and **Fall**
so it punches or eases. Six one-click **recipes** (Kick punch, Bass swell,
Beat sway, Bar sweep, Drop brightness, Hat sparkle) give you a working route
to edit rather than a blank page.

Sources are the drums and bands (kick, snare, hats, bass, mids, treble,
voice), the track-wide signals (loudness, energy, stereo width, section
change, beat phase, bar phase), the lyric line when one is loaded, any
imported stem's bands, and eighteen tempo-synced **LFOs** — sine, saw or
square across ¼ beat to 8 beats — for movement that does not wait on the
music.

A **Driven by** row above the cards carries one live meter per source in
use; click a chip to filter the cards down to what that source moves. And
wherever the knob itself lives — Mode, or Post on Scene — the slider takes a
**driven** mark while it plays, and its group header counts how many of its
controls are driven. The slider keeps showing your base value; modulation
moves around it. Exports resolve routes from the same track-time functions.

## Layers

Text (with `{title}` / `{artist}` filled from the track's tags), logo
images, or the track's embedded album art. Nine-point anchoring and fractional
sizing use one layout model in preview and export; raster pixels vary with
target resolution.

## Timeline

Press **T**: scenes switch visual modes at beats (drag snaps to the grid),
automation lanes keyframe any parameter, and each scene picks a **Transition**
for its incoming fade — Crossfade, Wipe →, Wipe ↑, Iris, Zoom, Glitch, or
Hard cut. Click a keyframe dot to cycle its curve (linear/smooth/hold);
right-click removes it, and a selected keyframe can be nudged with the arrow
keys or removed with Delete. **✦ Auto-arrange** builds a scene arrangement
from the song's detected sections in one click.

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
  chip) switch the visual. With **Visuals ▸ Live ▸ Quantize** set to **Beat**
  or **Bar**, the switch doesn't happen instantly — it waits and lands exactly
  on the next beat/bar of the detected grid, Ableton-session-launch style. The
  queued mode's chip pulses until it takes over. Off = instant.
- **Stage mode** (the monitor icon, or **S**) hides all the chrome and the
  cursor for a clean, full-bleed output — for a projector, a capture card, or
  screen-share. The mode name flashes briefly on each switch so you can drive
  blind. **0** blacks out (the VJ cut — 1–9 pick modes, 0 cuts to black);
  **Esc** exits.
- **MIDI** (Visuals ▸ Live ▸ MIDI ▸ Enable, on Chromium-based builds): map a
  controller's knobs and pads. **Learn CC** then move a knob to bind it to the
  selected parameter; **Learn note → &lt;mode&gt;** then play a note to switch to
  that mode (it obeys the beat-quantize too). Bindings are remembered. Local
  only, no drivers.
- Pair Stage mode with the **broadcast icon** (loopback, below) and you have a
  live rig: visualize whatever the PC is playing, switch on the beat by hand or
  MIDI, output clean and full-screen.

## Lyrics

Drop an `.lrc` file (any lyrics site exports them) or `.srt` subtitles onto
the window — the current line follows the music, karaoke-style, live and in
every export. Position/size/color, an **Animation** (**Plain** / **Slide up**
/ **Pop**, or **Karaoke** — the line fills bright left-to-right as it's sung)
and fade live on _Visuals ▸ Text_. Drop the lyrics together with
the track or after it; they attach to the loaded track like stems do.

**Generating them (desktop):** with no .lrc at hand, _Visuals ▸ Text_ can
build timed lyrics from the loaded track without anything leaving the
machine. Whisper (on whisper.cpp) transcribes the mix; a UVR MDX-Net model
isolates the vocal; a wav2vec2 forced aligner then times each word against
that isolated vocal, which is what makes the per-word karaoke fill possible.
The models download once — sizes and a time estimate first, each one
SHA-256-verified and discarded on mismatch.

## Stems

Import a stem (drums/bass/vocals bounced from 0:00) on
_Visuals ▸ Modulation_ — it's analyzed once, never played, and its bands
become modulation sources. Hit the **✦** on a stem chip to auto-wire its
kick/bass/snare/hats/mids to the best-matching knobs of the current visual;
tweak the amounts from there.

## Audiogram

_Visuals ▸ Text_ also carries the **Audiogram** section: three track-driven
overlay elements, each its own toggle — **Progress bar**, **Time readout**
(elapsed / total), and **Waveform strip**, a mini overview with a moving
playhead (the podcast/reel look). Turn any of them on and you also get an
**Accent** color and a **Position** of Top or Bottom; exports use the same
timed overlay definition.

## Export

The dialog asks for a **Type** — _Video_ or _Canvas loop_ — and then a
**Format**. MP4, PNG frames and (desktop only) ProRes, AV1 10-bit, GIF and
WebP are the formats; VP9 + alpha is a **codec** inside MP4, and Canvas loop
is a Type rather than a format.

- **MP4** — H.264 everywhere; **HEVC/AV1** appear as codec choices where your
  GPU supports them (probed automatically; codec choice leaves the raw render
  unchanged). 30/60 fps, auto or manual bitrate (2–60 Mbps). Optional
  **loudness normalization** to −14 / −16 / −23 LUFS with a −1 dBTP true-peak
  ceiling (audio only — pixels unchanged).
- **Resolutions follow the frame aspect**: 720p / 1080p / 1440p / 4K on 16:9,
  1080×1920 and 2160×3840 on 9:16, 1080×1080 on 1:1. A vertical project is
  never offered a landscape size.
- **AV1 10-bit** (desktop) — a real 10-bit MP4 (yuv420p10le, BT.709) tapped at
  16-bit float before the 8-bit swapchain, so wide gradients keep their levels
  instead of banding.
- **Video** — pick a short local clip to loop behind the visualization
  (desktop): Fill / Fit / Stretch with zoom and pan, dimmable, deterministic
  (the frame for each moment is a
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
- **ProRes 4444** (the _ProRes_ format) — one `.mov` with alpha + untouched
  PCM audio, straight into Premiere/Resolve/AE. Encoded by the bundled LGPL
  ffmpeg.
- **GIF / animated WebP** — loop files via the bundled ffmpeg, no audio.
  Pair with Canvas loop mode for a seamless loop; WebP keeps alpha.
- **Canvas loop** — a 3–8 s seamless loop at 1080×1920/30 for Spotify
  Canvas; the tail crossfades into the head. Selecting it disables PNG,
  ProRes and AV1.
- **Batch** (**B**) — one video per dropped track, titled from each file's
  own tags (untagged files fall back to the filename and are flagged). A
  failed file costs that one video, never the night; cancel a run and the
  jobs it never reached stay queued for a resume or retry. That queue is
  session state — it does not survive closing the app.

Exports render offline in a worker: the UI stays live, indexed audio/video
timestamps prevent accumulated drift, and on desktop the file streams to disk
so hour-long renders hold flat memory. Preview parity scope and tolerances:
[preview/export truth contract](PREVIEW-EXPORT-CONTRACT.md).

## Preferences & updates

The **gear icon** in the top bar (or **Ctrl+,**) opens **Preferences** — the
choices that follow the app rather than the project, so nothing here is saved
into a `.bfproj`. Four sections: **General** (autosave delay on desktop, the
remembered save-dialog folder), **Modes** (drag the mode strip into your own
order — which is also the order **1**–**9** jump to), **Performance** (a
**live-preview frame cap** of Display / 60 / 30 and a **preview resolution**
of Native / 75% / 50% — exports always render every frame at full size; a
**GPU preference** for dual-GPU laptops, applied on the next launch; and
**Performance display**, a live FPS / CPU / memory readout drawn over the
preview with its own corner, size, colour and stat selection — drawn over
the picture, never into it, so it cannot reach an export), and **Updates**.
Beatform **updates itself**: it checks GitHub Releases shortly after launch
(a plain fetch of a static file — no telemetry, ever). When a new version is
found, a dialog offers it right away — release notes, **Install now** or
Later — and installs with one click and a restart. Turn the automatic check
off in Preferences ▸ Updates if you prefer manual.

## Projects, looks, themes

- **Ctrl+S / Ctrl+O** — `.bfproj` project files (everything, portable).
- **Save look** — a named control set for one mode (`.bfpreset`). Save,
  delete, import and export your looks on _Visuals ▸ Looks & themes_; the
  factory style chips stay on Mode, beside the header that names the active
  one.
- **Themes** — a complete setup as one shareable `.bftheme` file, saved from
  the same page; see [Themes](templates).

The four words, in one place: a **Style** is a chip a visual ships with, a
**Look** is a control set you saved for one mode, a **Theme** is a whole
document in one file, and the **Gallery** is where other people's looks and
themes live.

## Gallery

The **Gallery** button in the top bar browses a curated public collection of
looks and themes without leaving the app. Filter by **All** / **Looks** /
**Themes**, or search by name. **+ Add look** files an entry into your own
saved looks for its mode and applies it; **Apply theme** replaces the whole
document (Ctrl+Z undoes it, as with any theme). _Visuals ▸ Looks & themes_
carries two shortcuts into it, each pre-filtered to the kind you were
looking at.

Entries carry **no code** — a look or theme can only select and parameterize
visuals Beatform already ships. Every file is pinned to an immutable commit,
fetched only from the one allowed location, size-capped and SHA-256-verified
before it is parsed at all; an entry that needs a newer Beatform reads
**Needs app update** instead of half-loading. The collection is
[beatform-app/gallery](https://github.com/beatform-app/gallery) and
submissions are reviewed there.
