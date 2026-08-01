# Changelog

All notable changes to Beatform are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning is
pragmatic rather than strict semver: a feature release bumps MINOR, a
fix-only release bumps PATCH. Entries below are derived from the project's
own commit history (`git log` + tags), oldest tag first reversed to newest.

Beatform is free and open source (MIT), distributed only through GitHub
Releases — there is no paid tier, cloud service, or telemetry.

## [Unreleased]

## [2.64.1] - 2026-08-02

### Fixed

- **Closing a shader dialog with unsaved changes no longer errors.** The
  "discard changes?" prompt in the shader editor and the new Shadertoy import
  dialog used the browser's raw `confirm()`, which the desktop shell routes
  through a dialog permission the app deliberately doesn't grant — so the
  installed build showed "Command plugin:dialog|confirm not allowed by ACL"
  instead of asking. Both dialogs now use the app's native yes/no prompt (the
  same one the export disk check uses). Found by the v2.64.0 installed-app
  smoke; the shader editor's prompt had been silently broken this way since it
  was added. A lint rule now blocks raw `confirm`/`alert`/`prompt` so the
  mistake can't ship again.

## [2.64.0] - 2026-08-01

### Added

- **Shadertoy import.** Paste the Image tab of a single-pass Shadertoy shader
  into the new import dialog (shader editor → _Shadertoy…_) and it becomes a
  Beatform visual: the GLSL is translated to WGSL locally by the app itself —
  no network, no build tools — compile-checked on your GPU, and added to the
  mode strip like any custom visual.

  The track's audio arrives exactly the way Shadertoy's own music channel
  does: `iChannel0` is a 512×2 texture with the spectrum on row 0 and the
  waveform on row 1, so audio-reactive shaders work unmodified. `iTime`,
  `iFrame` and `iDate` all follow the track clock — an imported visual
  renders frame-identically in the live preview and in every export.

  Author, source URL and license travel with the visual (Shadertoy's default
  CC BY-NC-SA is preselected), show up in the mode description, and survive
  `.avshader` sharing and project embedding. Re-opening an imported visual
  edits its original GLSL, never the generated WGSL. Clear, line-numbered
  errors point at your GLSL when something isn't supported — multi-pass
  buffers, cubemap/video/keyboard channels, sound shaders, and channels
  passed as `sampler2D` function parameters are declined by name.

  Under the hood: a dedicated render pipeline runs the translated module and
  routes through the shared composite pass, so lyric and text overlays,
  background modes and the whole post chain (bloom, tonemap, grain…) apply to
  imported visuals too. Legacy WebGL-era idioms (`texture2D`,
  `precision`, `const` parameters, BOM/CRLF files) are cleaned up
  automatically; texture reads are rewritten to explicit-LOD form so shaders
  sampling inside branches — most of them — pass WGSL's uniformity rules.
  Project files embedding an imported visual are stamped schema v12 (and
  `.avshader` files v2) so older app versions decline them cleanly instead of
  silently rendering the wrong mode; everything else keeps writing the old
  versions and stays backward-compatible. A new end-to-end gate
  (`npm run test:shadertoy:built`) drives paste → translate → render →
  export twice and asserts bit-identical frame hashes.

## [2.63.0] - 2026-07-29

### Added

- **A-B loop regions for focused live look-tuning.** Set A and B at the
  playhead with the new controls or **I** and **O**, then toggle the selected
  region with **L**. Both labeled markers can be dragged directly on the seek
  bar; clearing them returns an active loop to whole-track behavior.

  Region endpoints are ordered, clamped to the track, and kept at least 100 ms
  apart. Playback uses `AudioBufferSourceNode.loopStart` and `loopEnd`, while
  the UI clock mirrors every wrap and explicitly resets analyzer state—even for
  loops shorter than the old backwards-jump threshold. Markers are session-only
  and clear when a new track loads, so project and export formats stay
  unchanged.

## [2.62.0] - 2026-07-29

### Added

- **Full color controls for every spectrum visual.** Spectrum Bars, Bass Circle,
  Radial Burst, and LED Matrix now expose whole-look Saturation and Lightness
  controls alongside existing hue controls. Saturation 0 produces a genuinely
  neutral grayscale—including LED board and highlight tints—and Lightness can
  lift the visual into clean white without washing dark backgrounds gray.

  Both controls default to the authored look exactly, so existing projects and
  styles render unchanged. The Canvas2D fallback honors the same controls. The
  real WebGPU matrix now includes grayscale and bright-grayscale endpoint cases
  for all four modes; the original 128 default and style pixel hashes did not
  change.

## [2.61.0] - 2026-07-29

### Added

- **Analyzer-quality spectrum views without changing Beatform's punchy sync.**
  Spectrum-capable modes now offer three drawn-spectrum windows (roughly
  85/171/341 ms at 48 kHz), Musical or Linear axes, and either the authored
  96-band view or measured FFT bins with no interpolation. A 30–300 Hz Linear
  view at Precise resolution, for example, draws 92 real bins at 48 kHz rather
  than inventing 96 values between them.

  Longer transforms feed drawn bins only. Kick, beat, band-energy, and sync
  detectors remain on the existing responsive transform, so enabling more
  low-frequency detail cannot make a project feel slower or retune its hits.
  Live and export refresh the long display FFT on the same fixed 60 Hz clock.

  The settings panel reports the current device's actual window length,
  hertz-per-bin, native-bin count, and rendered count. The High edge control
  now reaches 200 Hz for narrow low-frequency analyzer views.

## [2.60.1] - 2026-07-28

### Fixed

- **System-audio visualization no longer runs a beat behind what you are
  hearing.** Watching visuals react to Spotify or a browser, everything arrived
  noticeably late — and the longer a session ran, the worse it got.

  The audio captured from your speakers passes through a small buffer on its way
  to the analyser. That buffer had no way to empty itself: any moment the app
  stuttered left a little extra audio sitting in it, and nothing ever took that
  audio back out, so the delay only ever grew. It waited until a quarter of a
  second had piled up before doing anything about it, which made a QUARTER
  SECOND of lag the normal state of a long session rather than an emergency.

  It now watches how full the buffer gets and gives back only depth a complete
  measurement window proved unnecessary. Late-delivery recovery is credited
  only against frames already emitted as silence, so it cannot manufacture a
  second hole by dropping valid audio.

  The native bridge also stopped pushing full-rate float blocks through
  Tauri's fetch-backed channel path. Capture is converted to PCM16 outside the
  realtime callback, sent in bounded base64 batches below the direct-channel
  threshold, and decoded by the worklet. On the optimized Windows build at
  48 kHz, real two-tone loopback passed at both display rate and a 30 fps cap:
  341–348 ms onset response, 99–101 ms steady ring depth (111–112 ms maximum),
  100% visible tone continuity, and zero worklet underruns during each 12 s
  sustained run. These are validation measurements, not hardware-universal
  latency promises.

- **System-audio visualization stays still when nothing is playing.** With the
  system muted or idle, the visuals still pumped and threw the occasional spike,
  most visibly on Radial Burst and Bass Circle.

  Silence from a sound device is not always silence. Depending on the driver and
  whatever "audio enhancements" it applies, a muted output can still hand over a
  faint hum or dither — far too quiet to hear, but Beatform's analysis is built
  to bring out quiet detail, so it drew it. Live capture now recognises a level
  that low as silence and shows nothing.

  This applies only to system-audio capture. Track playback is untouched; its
  export path has no corresponding gate.

- **Texture-feedback trails now use a fixed 60 Hz state clock.** Oscilloscope
  afterglow and Echo Trails no longer mutate history once per presented frame.
  A 24/30 fps export consumes multiple state ticks before presenting; a
  90/120/144 Hz preview presents fresh motion between ticks without feeding it
  back. Trail decay and sampling density therefore no longer depend on output
  or display fps.

  Oscilloscope's finishing pass also runs before trail carry-forward, so a
  pixel is graded once rather than once for every frame it survives.

- **Ambiguous browser read failures are no longer diagnosed as disk-full by
  name alone.** `NotReadableError` can also mean permissions or concurrent file
  access. Beatform now re-measures the scratch volume at failure time and only
  shows the disk-space explanation when that independent check is low; explicit
  OS/ffmpeg disk-full codes remain translated directly.

### Changed

- **Oscilloscope's trails look brighter.** A direct consequence of the fix
  above: the afterglow now keeps its authored colour and no longer darkens
  toward the corners the longer it lingers. The beam itself is unchanged. If you
  had dialled Persistence up to compensate, it will now read stronger than
  before.

- **Preview/export claims now have one explicit truth contract.** Indexed A/V
  timing and shared project/render definitions are guarantees; live device
  timing and cross-GPU pixels use measured tolerances rather than unsupported
  “exact same pixels” language.

## [2.60.0] - 2026-07-28

### Fixed

- **A project now reacts the same on a high-refresh screen as it does in its
  own export.** On a 144 Hz display the preview fired far more beats and drum
  hits than the exported video of the same project — measured on real music,
  about 75% more. Beatform's whole promise is that what you see is what you
  render, and this broke it for anyone on a fast monitor.

  The cause was that onset detection stepped once per drawn frame. Spectral
  flux is a frame-to-frame difference, so drawing more often did not measure the
  music more finely — it simply gave the detector more chances to fire. It now
  steps on a fixed clock, so the beats you get depend on the track and nothing
  else.

  **The preview is not any less smooth.** The spectrum, peak caps, motion and
  all the levels still update on every frame you draw; only the decision to
  trigger moved. And the same fix applies to exports: rendering at 30 fps no
  longer finds a different set of hits than 60.

  Two limits are honest rather than hidden. A live preview reads the audio only
  when it draws, so a display slower than 60 Hz analyses at its own rate, and on
  a faster one the beat count can differ by one. Before this it differed by a
  factor of 2.4.

## [2.59.0] - 2026-07-28

### Fixed

- **High-sample-rate audio devices now see the same music everyone else does.**
  Beatform takes its analysis rate from whatever your output device runs at, but
  the analysis window was a fixed size regardless — so on a 96 kHz interface it
  examined half as much time and half as much low-frequency detail as on a
  48 kHz one. The effect was not subtle: on identical audio, the bass level
  driving every reaction and modulation read **72% higher** at 96 kHz. Projects
  built on such a device genuinely behaved differently, and nothing in the app
  explained why.

  The window is now held constant across devices instead of the bin count, so
  44.1, 48, 96 and 192 kHz all read the same track the same way. **If you run at
  44.1 or 48 kHz — most people — nothing changes at all.** If you run higher,
  your bass reactions will be calmer and more accurate, and closer to what the
  same project shows on any other machine.

### Changed

- The beat detector's frequency band is now specified in hertz rather than in
  FFT bins, and the detectors' absolute thresholds scale with bin density.
  **Both are unit corrections with no visible effect** — beat times measured
  identical at 44.1, 48 and 96 kHz before and after, loud and quiet. They keep
  the band meaning the same frequencies on every device rather than drifting
  with the sample rate.

- The oscilloscope's waveform length no longer follows the analysis window size,
  so the trace looks the same regardless of the transform behind it.

## [2.58.0] - 2026-07-28

### Fixed

- **Dragging the playhead no longer sets off a beat that isn't in the music.**
  After a seek the analyser compared the new position against wherever you just
  came from, and that difference was almost always big enough to trigger a
  beat, kick, snare or hat — so scrubbing punched the visuals on nearly every
  drag. Looping a track did the same thing at the top of every lap. The
  analyser is now told when the audio it is about to hear isn't a continuation
  of what came before: on seek, loop, loading a track, and switching in or out
  of system audio.

  Scrubbing still looks the way it did otherwise — the spectrum, peak caps and
  motion carry across a seek rather than blinking out and rebuilding, and there
  is no dead moment before beats resume.

- **A recording with a DC offset no longer pegs the bottom bar of the
  spectrum.** If you dragged the analysed frequency range down toward its 10 Hz
  floor, any file carrying a constant offset lit the lowest bar and held it
  there for the whole track, in both the preview and the export. That bar now
  reads the music.

### Changed

- The drum-onset detector's threshold now scales with frame time, matching the
  beat and sync detectors. **This is a consistency fix with no visible effect**
  — measured, every frame rate from 30 to 144 already found the same hits, down
  to levels far below anything audible. It is tidied now so the value can be
  adjusted later without quietly behaving differently on a high-refresh display.

## [2.57.0] - 2026-07-28

### Added

- **You can reorder the mode strip.** App settings (gear, or Ctrl+,) has a new
  **Modes** tab — drag a mode to move it, or use the up/down buttons, and
  "Restore default order" puts it back. Your order is saved, survives closing
  the app, and carries across updates. If a future version adds a new mode it
  appears in your list rather than going missing, and if you have never
  customised the order you still get any improved default that ships later.

### Changed

- **A new default order for the mode strip**, arranged by how the modes
  actually relate to each other rather than the order they happened to be
  built in.
- **The 1–9 keys and the next/previous shortcuts now follow the strip you see**,
  so pressing 3 always selects the third mode shown.
- **Particles and Particle Flow have readable previews.** Both were rendering
  as nearly-black tiles — dark blue particles on a black background at
  thumbnail size. Every mode's preview was checked; those two were the only
  ones that needed it, and no mode's actual appearance changed.

## [2.56.0] - 2026-07-28

### Fixed

- **The mirrored looks in Tunnel, Aurora and Oscilloscope now react to the
  whole track.** Turning on the club mirror was quietly narrowing what the
  visual could hear. Tunnel's **Kaleido Tube** was reading only the lowest
  sixth of the spectrum — bass, with no mid or treble at all — despite being
  described as stained glass lit by the spectrum. Aurora's **Cathedral** lost
  its bass response entirely. Oscilloscope's **Lissajous** was drawing from
  half the waveform, and the half it dropped was the one holding the trigger,
  so the figure sat off-centre instead of anchored to the middle of the
  screen.
- These are the same underlying issue fixed for Echo Trails in 2.55.0, now
  closed everywhere it occurs. **No look was retuned to compensate** — each
  was measured before and after, and every one still renders at the exposure
  it was authored with. Looks with the mirror switched off are unchanged
  down to the byte.

## [2.55.0] - 2026-07-28

### Fixed

- **Echo Trails renders the same at every frame rate.** Its trails got dimmer
  the lower the frame rate went, so a 30 fps export did not match what you saw
  in a 60 Hz preview, and a high-refresh monitor looked brighter still. On the
  Supernova look a 30 fps export was rendering at roughly two-thirds the
  brightness of the preview. All three frame rates now match, and 60 fps output
  is unchanged from before.
- **The hard edge in Echo Trails is gone.** A straight cut ran through the
  ring at the same angle in every look, most obvious with Rounding turned up.
  The ring reads the sound left-to-right and then wraps, so the highest
  frequencies landed directly against the lowest and the tunnel smeared that
  step outward every frame. There were actually two edges in the same place —
  one in the shape, one in the colour — and both are closed.
- **Echo Trails' mirrored looks now react to the whole track.** Prism and Rose
  Window were only ever reading a thin slice from the middle of the spectrum —
  about 12% and 6% of it — so they never responded to bass or treble at all.
  Every mirrored setting now covers the full range. Rose Window's brightness
  was rebalanced to match, since it can suddenly hear a lot more.

### Changed

- Build tooling updated (Vite 8, and the media muxer that writes MP4 and WebM
  files). Exports were checked before and after: rendered output is
  byte-for-byte identical, and WebM files are too.

## [2.54.0] - 2026-07-27

### Fixed

- **The Oscilloscope no longer turns into a solid slab.** Two looks —
  Lissajous and Smoke Signal — filled the whole frame with a bright block
  instead of drawing a trace. The afterglow was set high enough that the trail
  outlived the time the beam needed to sweep the display, so every pixel it
  had recently touched stayed lit at full brightness. The two looks are
  retuned, and the afterglow slider no longer goes into the range where this
  happens — no position it can still reach behaves differently than before.
- **The same project now looks the same on a high-refresh screen.** The
  Oscilloscope's afterglow got thicker the higher your monitor's refresh rate
  went, so a 120 Hz preview did not match a 30 fps export. It is now pinned to
  the density it was designed at. Exports are unaffected.
- **Spectrum Scape stopped washing out to white on loud tracks.** All seven of
  its looks lost their colour and depth on a loud master. Three separate
  causes: the loudness boost was being applied twice, the Glow amount silently
  scaled with the Height setting, and the highlight on tall bars triggered on
  every bar at once instead of only the peaks. Quiet material renders exactly
  as it did before.
- **Four Spectrum Scape looks rebuilt.** Street Level, Neon Grid, Canyon and
  Top Down were showing a flat wall, a fused mass, a single bar face and a
  pale plate respectively. All four now read as legible 3D geometry on
  everything from a −2.9 LUFS master to a −16.9 LUFS one.

## [2.53.0] - 2026-07-27

### Added

- **A settings panel built to grow.** Parameters that are really a _choice_ —
  symmetry, mirror mode, image fit — are now dropdowns instead of sliders, and
  on/off settings are switches. Colours get a proper colour picker, hues get a
  rainbow track, and angles get a dial you can drag. Settings are grouped by
  what they do (Shape, Colour, Motion, Reaction, Glow, Image, Camera,
  Backdrop) rather than by the order they happened to be written in.
- **Search now finds everything.** Typing in the settings search box filters
  individual settings and opens whichever groups contain them. Previously the
  advanced tier was never searched at all, so most settings could not be found
  by name.
- **112 new looks across every mode**, replacing the old set. These change how
  a mode _behaves_ — mirroring, symmetry, layer counts, trails, camera framing,
  reaction curves — instead of only recolouring it. Every mode also gets at
  least one clean, minimal look for when the music should lead.
- **13 new templates**, replacing all the old ones. Each is a complete
  starting point: Cover Story repaints itself from your artwork, Hyperlane
  makes a drop lurch forward, Liquid Chrome splits the light on a wide mix,
  Polar Night never strobes, Editorial Ink is deliberately restrained, On Air
  is a square podcast deliverable, Pocket Rave is vertical for phones.

### Fixed

- **Saving a project no longer forgets your analysed frequency range.** If you
  narrowed the range the visuals listen to, that setting was silently reset to
  the default every time the file was reopened.

## [2.52.0] - 2026-07-27

### Added

- **Exports now check for disk space before they start, on both drives that
  matter.** A ProRes export can spend ten minutes rendering only to fail
  because the _system_ drive filled up — even when the drive you chose has
  hundreds of gigabytes free. The pre-flight estimates what the job needs and
  warns if either the destination or the scratch space is short, so you find
  out in a second rather than after the work is gone. It warns; it does not
  block, because you may know something it does not.

### Fixed

- **Disk-full during export said "permission problems".** The underlying error
  is worded that way by the browser engine, and it was shown verbatim — sending
  you to check file permissions when the real problem was a full drive. It now
  names the drive that actually ran out, and says plainly that the original
  wording is misleading.
- **A cancelled or rejected ProRes export left its staged audio behind.** The
  prepared audio track — up to ~691 MB for an hour-long song — stayed in the
  temporary folder on the system drive, the very drive most likely to be
  short of space. Repeated attempts stacked up more copies.
- **Two different tooltips for the same button.** The gear in the top bar and
  the button in the help dialog both open App settings but described it
  differently.

## [2.51.0] - 2026-07-26

### Fixed

- **Long exports now hold steady instead of growing.** 2.50.0 made the encoders
  wait for the disk, which nearly doubled export speed — but exports run on a
  background thread, and on that path handing a chunk to the main thread
  returned immediately, so there was still nothing real to wait for. A
  measured 2-hour export improved but kept climbing. The background thread now
  waits for each chunk to actually reach the disk before producing the next
  one, so only one chunk is ever in flight. This is the same handshake the PNG
  image-sequence lane has always used; the video lane never had it.
- **A slow drive no longer aborts a healthy export.** Because the export thread
  now deliberately waits while a chunk is written, the "worker stopped
  responding" safety check could mistake that wait for a hang and kill the
  export. It now ignores time spent waiting on our own disk writes. This
  affected the image-sequence lane too, ever since it gained the same
  handshake — a single frame or chunk slower than 30 seconds (a stalled
  network share, a sleeping USB drive) was enough to trigger it.

## [2.50.0] - 2026-07-26

### Fixed

- **Long exports no longer balloon in memory or slow to a crawl.** A 2-hour
  720p30 export was measured growing **+152 MB every 10 minutes** while its
  render rate decayed from ~130 fps to ~30 fps. The file it produced was
  always correct — this was throughput and memory, not corruption.
  The cause was a missing brake: chunks were handed to the file writer without
  ever waiting for the disk, so whatever the disk had not yet flushed stayed
  in memory. At the 720p30 default that is roughly the entire encoded video,
  about 16 MB per minute, and the resulting garbage-collector pressure is what
  dragged the frame rate down. The encoders now wait for the disk, so a slow
  drive slows the export instead of filling RAM.

### Changed

- **The MP4 writer moved to mediabunny**, which already produced the app's
  WebM files. The previous library was deprecated by its own author in favour
  of mediabunny, and shipping one maintained muxer instead of two removes a
  dependency. Exports are byte-identical in content; every codec was
  re-verified end to end (H.264, HEVC, AV1 in MP4 with AAC, plus VP9+alpha in
  WebM with Opus), along with frame counts, durations and PNG-sequence
  determinism.

### Note

- Exporting to a **file** streams to disk and stays flat. The in-browser
  preview export has nowhere to stream to and must hold the whole file in
  memory by definition, so it is only suitable for short clips — the desktop
  app always uses the streaming path.

## [2.49.1] - 2026-07-26

### Fixed

- **Dropping a project file onto the window opens it.** It reported "Could
  not decode ... (Unable to decode audio data)" instead: the drop handler
  recognised shaders, templates and lyrics, then handed everything else to the
  audio loader — so a `.avproj` was fed to the audio decoder. The bug had been
  there as long as the feature, but was unreachable until 2.49.0 made drops
  arrive at all on Windows.
- The drop overlay says "Drop to load" rather than "Drop to play", since audio
  is only one of the five things you can drop.

## [2.49.0] - 2026-07-25

The audit-remediation release. An independent five-part audit read every
surface of the app; this is everything it found, fixed and pinned by tests.

### Fixed

- **Drag and drop works again on Windows.** Dropping a file on the window did
  nothing in installed builds: Tauri intercepts the OS drop by default, and
  the app only ever listened for the browser-level event, so nothing reached
  it. The interception is now disabled and the drop path is live again for
  audio files, projects, themes, shaders and lyrics.
- **Visuals no longer drift out of time with the music.** Particles, Tunnel
  and Radial Burst multiplied elapsed track time by a speed that itself moved
  with the audio, so every loudness swing displaced the whole field by an
  amount that grew the longer the track ran — smooth at the start, stuttering
  and re-rolling minutes in. Audio now changes the motion without dragging the
  accumulated position with it.
- **Bass Circle particles no longer punch dark specks into your background.**
  Their twinkle went negative for part of each cycle, subtracting light
  instead of dimming.
- **Echo Trails no longer washes toward white.** With Echo hue drift on, the
  colour rotation was quietly adding brightness on every generation, so trails
  brightened as they aged instead of decaying.
- **Aurora keeps responding on loud passages** instead of flat-lining once the
  bass swell pushed it into a hard ceiling. Voice Orb no longer vanishes at
  high Wobble, Metaballs blobs stay in frame at high Orbit height, and
  Synthwave's sun can no longer be pushed entirely off-screen.
- **Corners can no longer go darker than black.** Radial Burst and Bass
  Circle's vignette could drive the image negative over a solid or image
  background.
- **The Builder chip in the mode strip is no longer a black square.**
- Tunnel's Hyperdrive style, and ~30 other factory style values across the
  library, sat on settings the sliders themselves could not reach — so the
  look changed the first time you touched the knob. All now land on the grid,
  with a test that keeps every future style honest.

### Changed

- **The app is honest when hardware rendering is unavailable.** On the
  simplified fallback renderer it now says so in a banner that stays put
  (instead of a notice that vanished after four seconds), and the features
  that renderer genuinely cannot do — post-processing, Motion masters, Builder
  Studio, the shader editor, scene transitions, video backgrounds — are
  disabled with the reason on hover, rather than silently accepting settings
  and discarding them. Video export and batch render are refused up front
  instead of failing after a save dialog and a full decode, and a batch run
  aborts once rather than failing every track in turn. Background images still
  honour fit, zoom and pan on this path.
- Typing an exact value on a slider now rounds half-steps the way the slider
  itself does (typing 35 on a percent row no longer read back 34).

### Security

- The ProRes/GIF/WebP encoder now refuses an output path that did not come
  from the save dialog. Previously any absolute path with the right extension
  was accepted and overwritten, and removed on failure.
- A wedged encoder can no longer hang the app forever at "Finishing": the
  finalize step is bounded, and cancelling during it genuinely stops ffmpeg
  instead of reporting success while the process lived on.
- An imported project or theme can no longer specify a font that silently
  breaks text rendering; font names are validated and fall back cleanly.

### Under the hood

- Live audio capture no longer allocates inside the realtime audio callback
  (a buffer pool replaces per-callback allocation), which removes a glitch
  risk on the live-input path.
- Fixed leaks: video-background decoding released nothing when a clip failed
  part-way, overlay bitmaps were dropped without being closed, and the Builder
  shader cache grew without bound for the whole session.
- The developer export/batch probes now go through the same code path the real
  export uses, instead of a hand-copied duplicate that had drifted — a
  Builder-mode probe could previously report success for an all-black video.
- 485 automated tests (up from 420), plus 24 on the Rust side.

## [2.48.1] - 2026-07-25

### Fixed

- **The spectrum was silently ignoring 61 of its frequency bins.** Each drawn
  band stopped one bin short of where the next began, so any bin holding a
  band boundary belonged to neither — a tone landing in one drew barely a
  third of its true height. Bands now tile the frequency axis exactly, and
  the value stays continuous as a band grows past one bin wide (it could
  jump between two different rules before). Introduced in 2.48.0.
- **Dragging the Low edge into the High edge no longer resets both.** Too
  narrow a span was thrown away wholesale, which also wiped whatever you had
  set on the other slider; it is now nudged to the closest valid span.
- **Background/centre-image pan no longer depends on zoom.** At 4x zoom a
  quarter-turn of the X slider threw the image a whole frame away, leaving
  most of the slider useless. Pan is now measured in frame widths at every
  zoom level, as documented.
- The lowest bar can no longer be lit permanently by a file's DC offset.

## [2.48.0] - 2026-07-25

### Added

- **Type an exact slider value.** Double-click any slider (or its number, or
  press Enter/F2 on it) and type the value you want. Enter commits, Escape
  cancels, and what you type is clamped and snapped exactly like dragging —
  so landing precisely on 0, or on 1.00, no longer depends on your mouse
  hand.
- **Fit and align images in the centre of a mode.** Bass Circle and Radial
  Burst can show cover art (or your own picture) in the middle, and it used
  to be squashed to fill the circle whenever the image wasn't square. There
  are now **Image fit** (Fill / Fit / Stretch), **Image zoom** and **Image
  X/Y** controls: Fill crops to the circle keeping the proportions, Fit shows
  the whole picture, and Stretch is the old distort-to-fill if you want it.
  Zoom and X/Y let you frame exactly the part you want.
- **Fit and align background images and videos** with the same Fill / Fit /
  Stretch, zoom and X/Y controls, instead of the fixed crop-to-fill.
- **Animate the post-processing chain.** Exposure, Bloom, Bloom threshold,
  Vignette, Chromatic and Film grain are now modulation targets, so the kick
  can drive the chromatic split or the bass can breathe the bloom. Pick them
  under "Post-processing" in the Modulation target list; they render
  identically in exports.
- **Set the analysed frequency range.** _Settings → Sync_ gained **Low edge**
  and **High edge**: the drawn bars are spaced geometrically across that
  span, so you can stop spending bars on sub-bass a track doesn't have, or
  give the musical range more of the width.

### Fixed

- **The bass end of the spectrum is no longer one wide flat block.** One FFT
  bin covers ~12 Hz, so every drawn band below ~40 Hz landed on the _same_
  bin and several neighbouring bars were handed one identical value. Bands
  narrower than a bin are now interpolated at their centre, so the low end
  follows the actual spectrum slope instead of stepping. Spectra render
  slightly differently at the very bottom as a result — this is the fix, not
  a regression.

## [2.47.1] - 2026-07-25

### Changed

- **The update dialog now shows the real release notes** — the full,
  human-written bullet list for every version between the one you're on
  and the one being offered, pulled straight from the changelog and
  rendered in the dialog (headings, bullets, bold). No more one-line
  blurb with a GitHub link: if you're four versions behind, you see all
  four "What's new in …" sections before deciding. Offline, the short
  summary still shows as a fallback.

## [2.47.0] - 2026-07-25

The gap-closing release: every visual mode brought up to the standard set
by Spectrum Bars, Radial Burst and Bass Circle — richer styles, deeper
controls, and beat-grid musicality — each in its own character.

### Changed

- **Oscilloscope** — trace peaks now soft-compress instead of flat-topping
  against a hard clamp; new Trace brightness control, graticule beat flash,
  and a Laser style (8 styles total).
- **Tunnel** — new Ice Cave style and a whole-wall beat flash stacked on the
  travelling beat rings (7 styles).
- **Synthwave** — Sun offset, Horizon height and Star density controls; new
  Chrome Dawn and Storm styles (9 styles). The one-line-per-beat grid
  scroll is untouched.
- **Particles** — Band color (bass/mid/treble tinting), Size variance and a
  grid-locked Beat brightness pop, all at zero added per-pixel cost; new
  Beat Dance / Warp / Rave / Deep Field / Embers styles.
- **Metaballs** — a true specular Gloss with adjustable Light angle, a
  grid-locked Beat squash (the lamp gulps on the beat), and blob count that
  rides the Detail master; Mercury / Toxic / Abyss / Binary styles.
- **Echo Trails** — per-generation Echo hue drift (energy-neutral, so the
  feedback stays stable), Ring shape (N-lobed star) with Beat bloom; new
  styles showcasing both.
- **Kaleido Nebula** — static Angle (aim the fold, independent of
  Motion→Rotation), Spin control, and a Depth layer for volume; re-curated
  to 7 styles (Stained Glass, Mandala, Oil Slick, Fractal Ice, …).
- **Aurora** — bass-swelled curtains, slow Drift, treble-crackled stars,
  and an optional true horizon Reflection; 7 styles from Polar Night to
  Pastel Dream.
- **Voice Orb** — surface Texture and a silence-only Breath glow; 7
  studio-oriented styles (Podcast Blue, Warm Studio, Hologram, …).
- **LED Matrix** — per-column Spectrum color (the RGB-wall look), phosphor
  Ghosting, CRT Scanlines, deterministic Flicker and a Beat flash border;
  7 hardware looks from Hi-Fi Classic to Amber Terminal.
- **Spectrum Scape** — 7 curated camera-and-palette styles (Night City,
  Sunrise Metropolis, Cyber District, Top Down, …) and wider Height /
  Distance / Glow ranges. Its 3D pipeline has a fixed parameter set, so the
  upgrade is curation rather than new sliders — no dead controls.
- **Particle Flow** — six new styles that actually explore the simulation's
  range (Galaxy, Swarm, Ink Drop, Solar Wind, Blizzard, Firehose).

Every upgraded mode was verified deterministic (double-export hash
identical) with a clean GPU validation log, and every new parameter obeys
the soft frame-limit and monotonic-rotation laws.

## [2.46.2] - 2026-07-25

### Added

- **Static Angle controls.** Radial Burst (main) and Bass Circle (Advanced)
  gain an **Angle** slider that aims the bar ring anywhere — and it works
  with Motion → Rotation at 0. Rotation used to be all-or-nothing: the
  motion master gated the per-mode rotation entirely, so there was no way
  to park the ring at a chosen orientation. Orientation is no longer
  motion.
- **Match cover colors in Radial Burst** — the same toggle Bass Circle has,
  driven by whichever image the core actually shows (cover art or a custom
  center image).

### Changed

- **Radial Burst's core got a rework.** The wobbling center read as random
  — calmer default edge waviness, a stronger beat kick, and a new pulsing
  rim (Advanced → Core rim) that swells with loudness and lands on the
  tempo grid, so the core reads as the beat anchor with or without cover
  art. The art itself now maps to the wobble's maximum reach, fixing the
  ring of smeared edge color that appeared at high Wobble.

### Fixed

- The Background mode picker (Animated / Solid / Transparent / Image /
  Video) wraps onto a second row on narrow panels instead of cutting
  labels off at both edges.

## [2.46.1] - 2026-07-25

Every finding from the independent v3-readiness audit that could be fixed
without a design decision, fixed and verified — including two Critical
determinism repairs.

### Fixed

- **Per-mode backgrounds now render in the live preview** (they already
  rendered in exports). The render loop re-applied the global background
  every frame, silently overwriting the override within ~16 ms — the
  flagship v2.46.0 feature looked broken on screen while exporting
  correctly. Live and export now resolve backgrounds through the same
  rule, pinned by a live-vs-export parity test.
- **Long tracks (>90 min) analyze identically in preview and export.**
  The fallback decoder kept the file's native sample rate while the live
  path analyzes at the audio device's rate — on the common 44.1-vs-48 kHz
  mismatch, every exported frequency bin sat ~8% off its live position.
  The fallback now resamples once, exactly like the normal path; chunk
  seams also no longer risk one-sample clicks.
- **Opening a project no longer overwrites your newer custom shaders.**
  A project embedding an older copy of a shader you've since edited used
  to silently revert and persist it, with no undo. Your library version
  now wins on content divergence, with a notice.
- **The update dialog** traps focus, closes on Esc, and shows a proper
  error screen with Retry if an install fails (it used to just vanish);
  double-clicking Install can no longer double-run an install.
- **Beats on high-refresh displays**: the onset threshold now scales with
  frame time, so a 144 Hz preview fires the same beats a 60 fps export
  renders. 60 fps behavior is bit-identical.
- **Batch "Match cover colors"** now re-matches per track — previously
  every batched video wore the first track's colors.
- Voice Orb joins the v2.44 soft frame-limit family (no more hard
  circular clip at max size); film-grain dither no longer degrades hours
  into a long track; GIF export caps at ~3 minutes with a clear message
  instead of exhausting memory; a wedged ffmpeg finalize can no longer
  deadlock the export abort; toggling a per-mode background off frees its
  embedded image/video; the mode strip's edge fades (shipped inert in
  v2.46.0) actually appear; panels no longer fade out while you read
  them; the guide's aspect-ratio list matches the app; plus a dozen
  smaller correctness, a11y and docs repairs.

### Deferred from the audit (need design decisions or hardware sessions)

- 2-hour export memory streaming (A2), decode cancellation (A3),
  fs-scope binding of sidecar output paths (E1), slider-drag render
  batching (U2).

## [2.46.0] - 2026-07-24

### Added

- **Per-mode backgrounds.** The Background section (Scene tab) gains a
  scope switch: **All modes** (the shared background, as before) or
  **This mode** — give any visual mode its own background, including a
  custom image or looping video. Spectrum Bars can sit on your video loop
  while Bass Circle keeps its animated backdrop. Overrides live in the
  project file (schema v11), survive restarts, and exports resolve them
  exactly like the preview.
- **Custom center images.** Modes that draw artwork in their center
  (Bass Circle, Radial Burst) get a **Center image** row: choose any
  image to replace the track's embedded cover art, per mode. "Match
  cover colors" matches whichever image is actually displayed. One click
  returns to the track's cover.
- **In-app user guide.** Press H → **User guide…**: a twelve-section,
  human-written walkthrough of everything Beatform does — from first
  track to Builder stacks, timelines, live performance and every export
  format. No internet needed; it ships inside the app.

### Changed

- **The update dialog got a real design.** Accent hero band, a version
  transition (current → new), properly formatted release notes
  (headings, bullets, bold), a real progress bar with percent and MB,
  and a one-click restart — replacing the plain text box from v2.45.0.

### Fixed

- **UI polish pass across every mode and window size.** Sliders no
  longer push their value readout past the panel edge on narrow panels
  (worst in the Advanced drawer); the mode strip on narrow windows now
  fades at the edges when more modes are hidden, scrolls with the mouse
  wheel, and always auto-scrolls the active mode into view; and hovering
  a setting with a long hint no longer makes the whole panel jump — the
  hint footer keeps a fixed two-line height (the full text stays in the
  tooltip).
- Replacing a background image/video or a center image now garbage-
  collects the old embedded asset only when nothing else (an overlay,
  another mode's background, a center image) still uses it.

## [2.45.2] - 2026-07-24

### Changed

- **Layout-proof keyboard shortcuts.** Every shortcut now has a letter or
  digit as its primary key — the only keys whose printed label sits in the
  same place on every major layout (QWERTY, QWERTZ, AZERTY, …):
  **P / N** previous/next mode, **S** Stage mode, **0** blackout (the digit
  row now reads: 1–9 pick a mode, 0 cuts to black), **H** shortcut list.
  The old symbol bindings (`[` `]` `\` `.` `?`) still work as secondaries
  for muscle memory. Tooltips, the shortcut overlay and the docs all name
  the letter keys now.

## [2.45.1] - 2026-07-24

### Added

- **Radial Burst: cover art in the core.** The track's embedded cover now
  fills the breathing center disc (same as Bass Circle's circle) — on by
  default when the track has art, with a **Cover art** toggle plus
  **Cover blend** and **Cover brightness** in Advanced. The wobbling core
  edge crops the art organically; loudness and beats lift its brightness.
  Tracks without embedded art keep the classic plain core.
- **Bass Circle: Match cover colors.** A new toggle that analyzes the
  cover art's dominant color and sets **Hue** and **Hue spread** to fit —
  immediately when switched on, and again automatically whenever a track
  with cover art loads. Near-grayscale covers are ignored (your colors
  stay). The analysis writes plain slider values into the project, so
  exports match the preview exactly and one Ctrl+Z restores the previous
  colors.

## [2.45.0] - 2026-07-24

### Added

- **Update prompt on startup.** When the automatic check (on by default,
  Settings → Updates) finds a newer release shortly after launch, a dialog
  now offers it directly: version, release notes, **Install now** / Later.
  Install shows download progress and then offers a one-click restart.
  Previously the result of the startup check was only visible if you dug
  into Settings → Updates yourself. Manual checks still report inline in
  the Settings dialog, and "Later" only dismisses until the next launch.
- **App settings gear in the top bar.** App-level preferences (autosave,
  performance, updates) were reachable only via Ctrl+, or a small button
  inside the shortcuts overlay. There is now a gear icon in the top bar,
  next to the visual-settings sliders icon.

- **Spectrum shape controls** (Settings → Sync, in every mode that draws the
  spectrum): three new sliders that shape the drawn bars themselves, beyond
  the existing spline that only rounds corners between still-spiky values.
  - **Merge** — Monstercat-style neighbor falloff: every bar props up its
    neighbors with an exponential decay, melting isolated spikes into one
    connected silhouette.
  - **Rounding** — kernel average across neighboring bars: real smoothing
    that removes hard spikes and lows instead of merely curving between them.
  - **Contrast** — below 50% flattens the spectrum toward fuller, calmer
    bars; above 50% exaggerates peaks against valleys. 50% is exactly the
    previous look.

  All three are saved per mode in the project file, applied before the
  attack/release envelope so the sync feel is untouched, and rendered
  identically in preview and export. Defaults are neutral — existing
  projects look byte-for-byte the same.

## [2.44.3] - 2026-07-24

### Fixed

- **Radial Burst no longer looks like it rotates backwards.** A beat kick
  added a rotation offset that decayed after every hit, so the whole burst
  visibly slid back as each pulse faded — reported as "rotation jumping back
  and forth" across many versions. Rotation is now purely time-driven
  (monotonic); the beat still hits through ring breathe, core pump and glow.

### Added

- **Project ▸ New project** — one click resets the document to clean
  defaults (timeline off, overlays/assets cleared, params/post/motion/lyric
  style/audiogram/Builder stack default). Undoable with a single Ctrl+Z.
  Loaded track, volume and app preferences are untouched. Useful whenever a
  loaded project or test session leaves the app in a state you don't want.

## [2.44.2] - 2026-07-24

### Fixed

- **Tracks longer than ~90 minutes load again.** Chromium's audio decoder
  has an undocumented ceiling (a 90-minute file decodes, a 2-hour one is
  rejected outright — bisected on this engine). Long tracks now fall back to
  an incremental decoder, so 2-hour mixes load, play and export. Decoding a
  2-hour file takes a couple of minutes; the app is not hung.
- The friendly unsupported-video-codec message really ships this time — it
  had been written for v2.44.1 but was lost in the edit that produced that
  build (the acceptance run caught it: "Assertion failed" was still showing).

## [2.44.1] - 2026-07-23

Fixes for everything the first full hardware test found (thank you,
checklist). All three were real bugs that only manifest in installed builds.

### Fixed

- **Live input (loopback) works in installed builds.** The audio worklet
  loaded from a `blob:` URL, which the app's own Content-Security-Policy
  correctly blocks — development builds carry no CSP, so it always worked
  there and never on a real install. The worklet now ships as a bundled
  asset.
- **Crash recovery actually works now.** The autosave file had never been
  written: the filesystem permission set granted read but not write scope
  for the app-data folder, and the failure only ever reached the console.
  The scope is granted, and any future autosave failure surfaces as a
  visible error instead of silently disabling recovery.
- **Keyboard shortcuts on QWERTZ (and other non-US layouts).** AltGr chords
  (how QWERTZ types `[ ] \`) are no longer misread as shortcuts; the
  previous/next-mode and Stage-mode keys bind to physical key positions so
  they sit on the same keys on every layout; and Esc is now handled before
  every other rule, so it always exits Stage mode and blackout — even with
  a dropdown focused.
- Unsupported video-background codecs (e.g. old MPEG-4 files) report a
  readable message naming the problem instead of "Assertion failed".
- The MP4 help text no longer implies HEVC is always available — the codec
  picker only ever offers what your hardware can encode.

## [2.44.0] - 2026-07-23

### Fixed

- **No more hard circular edges at extreme settings** (reported live on Bass
  Circle and Radial Burst). Frame safety is now soft and frame-shaped: maxed
  geometry compresses smoothly toward the actual frame border instead of
  clipping at a fixed circle, engine-wide (Radial Burst, Bass Circle, Voice
  Orb, Metaballs, Echo Trails, all Builder layers). Radial elements now reach
  further sideways than vertically on wide frames — like the frame itself.
  Several size/reach sliders gained wider ranges now that extremes are safe,
  and the rule is codified in the preset-authoring docs.

### Changed

- **One Builder.** The strip shows a single Builder (the layer compositor);
  the classic Builder is retired from the strip but old projects and scenes
  that use it keep rendering exactly as before.

## [2.43.0] - 2026-07-23

The polish release — the audit's last open finding closed, and the docs
caught up with everything the last five releases shipped.

### Fixed

- **Cancelled batch runs can resume.** Cancelling used to strand every
  not-yet-run job as "queued" with no way back; the panel now offers
  "Resume N queued" (and "Retry failed + resume queued" together).

### Changed

- Guide, README and the manual test checklist now cover Builder Studio, the
  app-settings page, the tabbed panel and the auto-updater.

## [2.42.0] - 2026-07-23

### Added

- **Builder Studio** — a real layer compositor, replacing the fixed-toggle
  Builder concept. Stack up to twelve layers from nine types (background
  wash, particles, spectrum bars, radial ring, pulse rings, waveform circle,
  orb, wave line, vignette), each with its own enable, opacity, blend mode
  (Normal / Add / Screen), color (hue + spread) and parameters. Duplicate,
  reorder and mute layers freely; the same type can appear as many times as
  you like.
- **Share stacks as `.avbuilder` files** (export/import), and stacks save
  inside your project file (schema v10) — a project renders identically on
  any machine.
- The classic Builder mode is unchanged — existing projects render exactly
  as before.

### Under the hood

- Layer parameters live in a GPU storage buffer, so a deep stack never hits
  the parameter ceiling and every slider drag is a buffer write — structural
  edits (add/remove/reorder/blend) compile once per stack shape and are
  cached.

## [2.41.0] - 2026-07-23

The settings release — the two UI structures the app had outgrown, rebuilt.

### Added

- **App settings page (Ctrl+,).** App-level preferences finally have a home,
  separate from the per-visual panel: autosave delay, remembered save folder,
  a live-preview frame cap (30/60/display — exports always render every
  frame), a GPU preference for dual-GPU machines, and the updater controls
  (moved from Help) with an auto-check toggle.
- **The settings panel grew up.** Five tabs (Visual / Sync / Scene / Text /
  Live) instead of one 13-section scroll, every section collapsible (both
  remembered), and a search box that finds any setting across all tabs by
  name — with ~300 parameters in the app, "type bloom" beats scrolling.

### Changed

- Small app preferences consolidated into one validated store
  (`beatform.prefs.v1`) with automatic migration; heavy per-project caches
  intentionally stay separate.

## [2.40.0] - 2026-07-22

The foundation release: a consolidation pass the codebase had earned after
seventy feature releases. Little changes visually — everything underneath got
simpler, and one long-standing paper cut is gone.

### Added

- **The settings/library panel is resizable.** Drag its left edge (240-440 px);
  the width persists. The fixed narrow column was a root cause of the settings
  UI feeling cramped — the full panel overhaul builds on this next.

### Changed

- App shell split up: the Export dialog, the global keyboard map and the dev
  probes are their own modules; the 2,900-line state store is now a core plus
  eleven per-domain slices; every settings surface shares one control kit
  (single toggle/slider/segmented idiom — behavior identical).
- Chrome layout offsets derive from CSS variables instead of hand-computed
  pixel chains (the class of bug where an open timeline buried other panels).
- Component-level UI tests now run alongside the unit suite.

## [2.39.0] - 2026-07-22

### Added

- **The app updates itself.** Beatform checks GitHub Releases shortly after
  launch (and on demand from **Help ▸ Check for updates**), downloads the new
  installer with progress, verifies its cryptographic signature against a key
  built into the app, installs, and offers a one-click restart. No telemetry —
  the check is a plain fetch of a static file on GitHub, and it fails silently
  when offline.
- MSI installs are outside the auto-update path (it uses the NSIS installer);
  new MSIs stay available on the releases page.

### Changed

- Release hygiene: versions are stamped by `scripts/bump-version.mjs` across
  all five version-carrying files with a `--verify` mode; SECURITY.md now
  documents update integrity and the key-rotation policy.

## [2.38.0] - 2026-07-22

Correctness & performance closeout — the audit backlog is now empty.

### Added

- **Projects carry everything they render (schema v9).** Lyric style,
  audiogram settings and any custom WGSL visual the project references now
  travel inside the `.avproj`, so a project opened on another machine renders
  identically — including custom visuals nobody imported separately. Older
  files load unchanged; lyric/audiogram edits join the undo history; deleting
  a custom visual and undoing restores it.
- **Export settings persist** across launches, and every save dialog opens in
  the folder you last saved to.

### Fixed

- **Disk-full stops an export immediately** with the real error — previously
  a full disk at minute 5 of a 60-minute export silently rendered the
  remaining 55 minutes into nothing.

### Performance

- The default render path (neutral post chain) skips the whole post graph —
  no full-res HDR intermediate, no extra fullscreen pass per frame.
- Crossfade/feedback/particle/3D render targets are released after ~5 s of
  disuse instead of being retained all session (~330 MB back at 4K).
- The audio and video encoder lanes interleave (audio no longer buffers
  ahead of frame one), and ProRes audio stages in 8 MB chunks — long-export
  memory is genuinely flat.

## [2.37.2] - 2026-07-22

### Performance

- **Particles runs far cheaper in both modes.** It draws a grid of particles at
  every pixel, and that per-pixel work had grown well past what an integrated
  GPU can hold at a smooth frame rate — playback stuttered and felt delayed.
  The background wash, the drifting current and the per-particle motion are all
  computed a cheaper way now, and **Fly mode** (Warp, Rave) halves the depth
  shells it walks. Measured against Tunnel as the reference, Fly went from
  roughly 3.6x Tunnel's cost to about 1.25x — the same cost as the drifting
  mode. Both modes look the same as before: still free-floating individual
  particles, still a deep streaking starfield.

## [2.37.1] - 2026-07-22

A hardening patch from re-auditing the full report against the current code —
correctness, security, accessibility and supply-chain fixes. No visual changes.

### Security

- **Library folder scanning is now scope-gated.** `scan_audio_library` walked
  any path it was handed and returned file paths and tags; it now honours the
  filesystem scope, so only a folder you actually picked can be scanned.

### Fixed

- The in-app version (Help modal, and the stamp in every saved project/preset/
  theme) was stuck ten releases stale; it is now correct and pinned by a test so
  it can't silently drift again.
- A background **mode** switch made right after a colour drag no longer collapses
  into a single undo — mode changes undo on their own.
- Switching backgrounds no longer leaks the previous image/video asset into the
  saved project when both were set.
- The Motion controls a preset exposes are now decided from its real shader code,
  not text that might only appear in a comment.
- "Simplified rendering" (the Canvas2D fallback) is now an auto-clearing notice
  instead of a red error that sat on screen the whole session.

### Accessibility

- Tabbing with the keyboard during playback no longer lands on hidden, unreachable
  controls — focused chrome reveals itself and re-arms the idle timer.

### Build

- CI Actions are pinned to commit SHAs and Dependabot keeps them (plus npm and
  Cargo dependencies) current.

## [2.37.0] - 2026-07-22

The visuals pass, part two — three modes reworked from the ground up, plus two
audit fixes.

### Changed

- **Tunnel** is a real tube you fly down, not a zoomed disc. Rings rush past in
  depth and longitudinal flutes converge at a dark vanishing point with a hot
  core; a corkscrew twist reads as a waterslide, and the wall is shaded like a
  round pipe. (Added: corkscrew, roundness and surface-texture controls.)
- **Particles** are real particles floating in space now, not a flat field
  warped to the music. Each one has its own depth, frequency band, twinkle and
  drift, floating freely on its own organic path. **Fly mode** is a true
  perspective starfield — stars stream from far away, grow and streak past you.
- **Particle Flow** now reacts to the music: a bass pump and a beat flash on
  brightness, and a velocity kick that scatters the field on beats, while the
  smooth curl flow is preserved.

### Fixed

- Feedback presets are detected by an actual call to the ABI helper, not any
  mention of it — a preset that only referenced it in a comment no longer pays
  for an unused extra render pass.

### Docs

- `THIRD_PARTY_LICENSES.md` now documents the statically-linked Rust crates.

## [2.36.1] - 2026-07-22

### Changed

- The mode selector no longer wraps each preview in an oval pill. Thumbnails
  are now clean framed previews with the label beneath; the selected mode is
  shown by an accent ring on its thumbnail instead of a filled pill.

## [2.36.0] - 2026-07-21

The visuals release. Every one of the 16 modes was reworked to a single quality
bar, and a regression that had blanked the live preview is fixed.

### Fixed

- **The live preview is no longer black.** Track playback was wired to the
  volume node instead of the analysis tap, so the analysers heard digital
  silence while audio still played — and since every visual is audio-driven,
  the whole canvas went dark except the background. Exports were never
  affected (they analyse the file directly), which is why it slipped a release.
  A graph-shape test now guards it.

### Changed

- **All 16 visual modes rebuilt to match Spectrum Bars and Bass Circle.** A
  shared "look kit" (saturated cosine palettes instead of muddy HSL hue drift,
  domain-warped noise, ACES tone mapping, dithering, vignette) now backs every
  mode. Highlights:
  - **Tunnel** — was a flat olive dartboard, now a real perspective tunnel
    receding to a hot vanishing point.
  - **Particles** — was flat uniform static, now a curl-noise flow field with
    depth, motion streaks and hot cores.
  - **Kaleido Nebula** — was muddy olive fog, now a saturated violet filament
    mandala over true black.
  - **Synthwave** — the horizon grid was nearly empty, now a dense converging
    perspective grid with a glowing sun.
  - **Oscilloscope** — gained a hot beam core, CRT phosphor persistence and a
    lab graticule. **LED Matrix** — per-dot bloom and panel texture.
    **Metaballs, Aurora, Echo Trails, Voice Orb, Spectrum Scape** — depth,
    hot cores and per-element motion.
- **Club mirror everywhere it fits.** The kaleidoscope/mirror fold Spectrum
  Bars had is now a param on the modes where it makes visual sense.

### Notes

- Existing `.avproj` projects keep every setting; only new optional params were
  added. Non-default named styles may render a slightly different (still
  saturated) colour than the old HSL maths gave them — a cosmetic follow-up.

## [2.35.0] - 2026-07-21

A hardening release: the whole render/export/state stack, CI, and the docs
were worked through against a full internal code audit. Nothing here changes
how you use Beatform, but a lot of it changes whether Beatform does the right
thing when something goes wrong.

### Added

- **Crash recovery.** The autosave has been written every 5 s for a long time
  and nothing ever read it back. It does now: if Beatform is killed with
  unsaved work, the next launch offers to restore it. A clean quit shows
  nothing.
- Media size limits on background images (32 MB) and video (192 MB), with an
  error that names the file's real size, instead of a renderer OOM.
- Repository documentation a public project should have: CHANGELOG, SECURITY,
  CODE_OF_CONDUCT, CODEOWNERS, and a PR template.

### Fixed

- **Exports no longer start beat-blind.** The first ~0.2 s of every export had
  no beat, kick, snare or hat, because the detector warmup counted from when
  the analyzer was built rather than from the track. The preview, warm for
  minutes, fired them at the same moment — a straight preview/export mismatch
  at the most visible point in the video.
- **Crossfades into and out of feedback presets** (Echo Trails) no longer pop.
  The outgoing preset's trail was being wiped at the exact instant the fade
  began, while it was still fully visible.
- **A wedged ProRes/GIF/WebP export can be cancelled.** A blocked frame write
  held the same lock cancel needed, so a stalled encoder was unkillable.
  Finishing a long export no longer freezes the window either.
- Feedback trails and the particle simulation are frame-rate independent, so a
  30 fps export matches a 60 fps preview instead of drifting.
- Losing the system-audio device no longer bricks loopback until restart — it
  reconnects on the next start instead of answering "already running" forever.
- Overlay rendering stopped churning a full-resolution GPU texture every frame
  during lyric fades (measured: 49,884 texture creations and 47 GPU validation
  errors over one fade, now zero of each).
- A GPU device loss during startup is no longer silently dropped.
- Export/batch robustness: a killed export worker fails instead of hanging
  forever; Cancel and Skip interrupt a track while it is still decoding;
  cancelling a batch no longer strands the untouched jobs as unreachable.
- Video backgrounds, custom presets edited inside timeline scenes, undo/redo
  grouping, and keyframe editing all had correctness bugs; all fixed.
- Accessibility: focus traps in dialogs, keyboard-reachable setting hints,
  labels on icon-only buttons, and a described canvas.

### Changed

- Project schema is now version 8, distinguishing files saved with video
  backgrounds. Older projects still open unchanged.
- The release workflow runs the same gates as CI. Running a smaller set is how
  two releases previously shipped from a failing main.
- The UI no longer re-renders the whole tree several times a second alongside
  the render loop.
- Startup bundle split: the main chunk dropped from 1,059 kB to 381 kB.

### Security

- Temp files are created in a way that cannot be redirected through a planted
  symlink.
- Removed an unused plugin whose permission expansion would have granted a
  URL-open primitive.

## [2.34.1] - 2026-07-20

### Fixed

- Hard circular edge on Radial Burst / Voice Orb — removed a full-field edge
  fade that carved a visible circle.

## [2.34.0] - 2026-07-19

### Added

- Karaoke-style word-wipe animation for timed lyrics.

## [2.33.0] - 2026-07-19

### Added

- Stage mode (`\`): chrome-free full-bleed output with a blackout toggle and
  a mode-name HUD, for live performance.

## [2.32.0] - 2026-07-19

### Added

- Web MIDI control — map CC messages to any parameter and notes to mode
  switches (local, no drivers).

## [2.31.0] - 2026-07-19

### Added

- Video background blur.
- Lyric entry animations.

### Changed

- Accessibility closeout pass (loop-button labeling, modal close-button
  labels).

## [2.30.0] - 2026-07-18

### Added

- Beat-quantized hotkey preset switching — a mode switch lands on the next
  beat/bar instead of taking effect instantly.

## [2.29.1] - 2026-07-18

### Changed

- Timeline keyframes are keyboard-operable.
- Preset strip is memoized.
- Theme colors moved to CSS variables.

## [2.29.0] - 2026-07-18

### Added

- Per-mode "master" control gating and unified controls.
- Keyboard accessibility pass on settings controls.

### Fixed

- Nine dead, redundant, or miscalibrated preset parameters recalibrated.

### Changed

- Reduced hot-path allocations; debounced settings persistence.

## [2.28.3] - 2026-07-18

### Fixed

- Spectrum display dynamics expanded so bars spike instead of bunching
  together.

## [2.28.2] - 2026-07-18

### Fixed

- Audit-fix pass: frame safety, export segment fidelity, ffmpeg sidecar
  cleanup.

## [2.28.1] - 2026-07-17

### Fixed

- Spectrum headroom and frame-safe geometry for Voice Orb and Bass Circle.

## [2.28.0] - 2026-07-17

### Added

- Looped video backgrounds (desktop) — decoded deterministically by track
  time so exports match the preview.

## [2.27.0] - 2026-07-17

### Added

- Scene transition library for the timeline.

## [2.26.0] - 2026-07-17

### Added

- Audiogram overlay elements, via a unified dynamic-overlay compositor.
- Auto-arrange timeline scenes from detected song sections.
- One-click stem auto-routing to the active visual.

## [2.25.0] - 2026-07-17

### Added

- Timed lyric overlays from `.lrc` / `.srt` files.

## [2.24.0] - 2026-07-17

### Added

- GIF and animated WebP loop export via the bundled ffmpeg sidecar.

### Fixed

- Eight defects from a pre-v3.0 adversarial audit, plus fifteen more from a
  second wave covering the remaining surfaces.

## [2.23.0] - 2026-07-16

### Added

- Transparent WebM export (VP9 + real alpha channel) via mediabunny.

## [2.22.0] - 2026-07-16

### Added

- In-app WGSL shader editor — write and preview your own visual, no build
  tools required.

## [2.21.0] - 2026-07-16

### Added

- Import stems as modulation sources.

## [2.20.0] - 2026-07-16

### Added

- Live-rendered preset thumbnails in the mode strip.

## [2.19.0] - 2026-07-16

### Added

- Image backgrounds — artwork behind the visualization (project schema v7).

## [2.18.0] - 2026-07-16

### Changed

- Rebranded the project to **Beatform**.

### Added

- Public documentation site (GitHub Pages): user guide, preset SDK, template
  spec.

## [2.17.0] - 2026-07-16

### Added

- `.avtheme` templates — shareable looks, factory packs, drag-to-import.

## [2.16.0] - 2026-07-16

### Added

- ProRes 4444 export with alpha via a bundled ffmpeg sidecar (desktop).

## [2.15.0] - 2026-07-16

### Added

- "Listen to the system" — visualize system audio via WASAPI loopback
  (desktop), analysis-only.

## [2.14.0] - 2026-07-16

### Added

- Music library sidebar: folder scan, real tags via lofty, near-gapless
  auto-advance.

## [2.13.0] - 2026-07-15

### Added

- HEVC and AV1 export via a WebCodecs hardware-capability probe.

## [2.12.0] - 2026-07-15

### Fixed

- Beats now land on the audible transient in every sync path.
- Twenty defects from an adversarial audit of the state/render/UI layers.

### Added

- Tempo-grid sync in every visual mode, additional factory style libraries,
  Builder pulse rings.

## [2.11.2] - 2026-07-15

### Fixed

- Bass Circle album art was rendering upside down.

## [2.11.1] - 2026-07-14

### Fixed

- Fourteen defects found by adversarially reviewing the 2.11.0 batch-render
  feature.

## [2.11.0] - 2026-07-14

### Added

- Batch render: drop in a folder of tracks, get one titled video per track,
  unattended — titles read from each file's own ID3 tags.

## [2.10.1] - 2026-07-14

### Fixed

- Export failures were being silently swallowed instead of surfaced.

## [2.10.0] - 2026-07-14

### Added

- App logo and icon set.
- LUFS-normalized export audio with a look-ahead true-peak limiter.

## [2.9.0] - 2026-07-14

### Added

- PNG image-sequence export with alpha.

## [2.8.0] - 2026-07-14

### Added

- Album art in Bass Circle via a cover-art texture in the preset ABI.
- Global "Spectrum smooth" motion master.

## [2.7.0] - 2026-07-14

### Added

- Bass Circle preset — trap-nation-style circular visualizer.

## [2.6.1] - 2026-07-14

### Added

- Independent Attack/Release smoothing for sync sources.

## [2.6.0] - 2026-07-14

### Added

- Global Rotation / Pulse / Detail motion masters across all visual modes.

## [2.5.1] - 2026-07-14

### Fixed

- Aurora seam artifact; sync reactivity on newer modes.

### Added

- Richer controls for the newer render modes.

## [2.5.0] - 2026-07-14

### Added

- "Visual Ceiling": HDR post-processing stack, feedback/trails buffer (Echo
  Trails preset), GPU compute-particle system (Particle Flow), a 3D render
  pass (Spectrum Scape), and the Aurora and Synthwave presets.

## [2.0.2] - 2026-07-14

### Fixed

- Export hang, crossfade ordering, fps/beat-grid mismatch, mono LUFS
  computation.

## [2.0.1] - 2026-07-14

### Fixed

- WYSIWYG/state bugs from the v2.0 review: a shared per-frame resolver, the
  export worker/inline fallback, timeline drag correctness, cached-settings
  validation.

## [2.0.0] - 2026-07-13

### Added

- "Workstation": timeline with scenes, crossfade transitions, keyframe
  automation lanes, undo/redo, autosave.

## [1.7.0] - 2026-07-13

### Added

- Musical sync: beat-grid tempo tracking, kick/snare/hat onset classes,
  musical key detection, section-boundary markers, modulation matrix.

## [1.5.0] - 2026-07-13

### Added

- Overlay layers (text / logo / album art), multi-aspect frames, Spotify
  Canvas seamless-loop export, stereo-width feature, BS.1770 LUFS metering.

## [1.3.0] - 2026-07-13

### Added

- Foundations: zustand state store, `.avproj` project files, `.avpreset`
  user looks, worker-based export pipeline with streaming-to-disk, tests and
  CI.

## [1.2.0] - 2026-07-13

### Added

- Sync-source system — choose what the visuals react to.

## [1.1.0] - 2026-07-13

### Changed

- Starfield rewritten as the Particles preset ("Fly" mode).

## [1.0.0] - 2026-07-13

### Fixed

- Verification hardening pass across the v0.9.0 surface.

## [0.9.0] - 2026-07-12

Initial public release.

### Added

- Tauri + WebGPU audio visualizer scaffold with an initial visual preset
  library, including Voice Orb and Builder mode.
- Deterministic offline MP4 export.
- Advanced settings (every internal preset constant tunable).
- Onboarding UI, keyboard shortcuts, auto-hiding chrome.
- Three synthesized demo tracks.

[Unreleased]: https://github.com/0langa/beatform/compare/v2.63.0...HEAD
[2.63.0]: https://github.com/0langa/beatform/compare/v2.62.0...v2.63.0
[2.62.0]: https://github.com/0langa/beatform/compare/v2.61.0...v2.62.0
[2.61.0]: https://github.com/0langa/beatform/compare/v2.60.1...v2.61.0
[2.60.1]: https://github.com/0langa/beatform/compare/v2.60.0...v2.60.1
[2.60.0]: https://github.com/0langa/beatform/compare/v2.59.0...v2.60.0
[2.59.0]: https://github.com/0langa/beatform/compare/v2.58.0...v2.59.0
[2.58.0]: https://github.com/0langa/beatform/compare/v2.57.0...v2.58.0
[2.57.0]: https://github.com/0langa/beatform/compare/v2.56.0...v2.57.0
[2.56.0]: https://github.com/0langa/beatform/compare/v2.55.0...v2.56.0
[2.55.0]: https://github.com/0langa/beatform/compare/v2.54.0...v2.55.0
[2.54.0]: https://github.com/0langa/beatform/compare/v2.53.0...v2.54.0
[2.53.0]: https://github.com/0langa/beatform/compare/v2.52.0...v2.53.0
[2.52.0]: https://github.com/0langa/beatform/compare/v2.51.0...v2.52.0
[2.51.0]: https://github.com/0langa/beatform/compare/v2.50.0...v2.51.0
[2.50.0]: https://github.com/0langa/beatform/compare/v2.49.1...v2.50.0
[2.49.1]: https://github.com/0langa/beatform/compare/v2.49.0...v2.49.1
[2.49.0]: https://github.com/0langa/beatform/compare/v2.48.1...v2.49.0
[2.48.1]: https://github.com/0langa/beatform/compare/v2.48.0...v2.48.1
[2.48.0]: https://github.com/0langa/beatform/compare/v2.47.1...v2.48.0
[2.47.1]: https://github.com/0langa/beatform/compare/v2.47.0...v2.47.1
[2.47.0]: https://github.com/0langa/beatform/compare/v2.46.2...v2.47.0
[2.46.2]: https://github.com/0langa/beatform/compare/v2.46.1...v2.46.2
[2.46.1]: https://github.com/0langa/beatform/compare/v2.46.0...v2.46.1
[2.46.0]: https://github.com/0langa/beatform/compare/v2.45.2...v2.46.0
[2.45.2]: https://github.com/0langa/beatform/compare/v2.45.1...v2.45.2
[2.45.1]: https://github.com/0langa/beatform/compare/v2.45.0...v2.45.1
[2.45.0]: https://github.com/0langa/beatform/compare/v2.44.3...v2.45.0
[2.44.3]: https://github.com/0langa/beatform/compare/v2.44.2...v2.44.3
[2.44.2]: https://github.com/0langa/beatform/compare/v2.44.1...v2.44.2
[2.44.1]: https://github.com/0langa/beatform/compare/v2.44.0...v2.44.1
[2.44.0]: https://github.com/0langa/beatform/compare/v2.43.0...v2.44.0
[2.43.0]: https://github.com/0langa/beatform/compare/v2.42.0...v2.43.0
[2.42.0]: https://github.com/0langa/beatform/compare/v2.41.0...v2.42.0
[2.41.0]: https://github.com/0langa/beatform/compare/v2.40.0...v2.41.0
[2.40.0]: https://github.com/0langa/beatform/compare/v2.39.0...v2.40.0
[2.39.0]: https://github.com/0langa/beatform/compare/v2.38.0...v2.39.0
[2.38.0]: https://github.com/0langa/beatform/compare/v2.37.2...v2.38.0
[2.37.2]: https://github.com/0langa/beatform/compare/v2.37.1...v2.37.2
[2.37.1]: https://github.com/0langa/beatform/compare/v2.37.0...v2.37.1
[2.37.0]: https://github.com/0langa/beatform/compare/v2.36.1...v2.37.0
[2.36.1]: https://github.com/0langa/beatform/compare/v2.36.0...v2.36.1
[2.36.0]: https://github.com/0langa/beatform/compare/v2.35.0...v2.36.0
[2.35.0]: https://github.com/0langa/beatform/compare/v2.34.1...v2.35.0
[2.34.1]: https://github.com/0langa/beatform/compare/v2.34.0...v2.34.1
[2.34.0]: https://github.com/0langa/beatform/compare/v2.33.0...v2.34.0
[2.33.0]: https://github.com/0langa/beatform/compare/v2.32.0...v2.33.0
[2.32.0]: https://github.com/0langa/beatform/compare/v2.31.0...v2.32.0
[2.31.0]: https://github.com/0langa/beatform/compare/v2.30.0...v2.31.0
[2.30.0]: https://github.com/0langa/beatform/compare/v2.29.1...v2.30.0
[2.29.1]: https://github.com/0langa/beatform/compare/v2.29.0...v2.29.1
[2.29.0]: https://github.com/0langa/beatform/compare/v2.28.3...v2.29.0
[2.28.3]: https://github.com/0langa/beatform/compare/v2.28.2...v2.28.3
[2.28.2]: https://github.com/0langa/beatform/compare/v2.28.1...v2.28.2
[2.28.1]: https://github.com/0langa/beatform/compare/v2.28.0...v2.28.1
[2.28.0]: https://github.com/0langa/beatform/compare/v2.27.0...v2.28.0
[2.27.0]: https://github.com/0langa/beatform/compare/v2.26.0...v2.27.0
[2.26.0]: https://github.com/0langa/beatform/compare/v2.25.0...v2.26.0
[2.25.0]: https://github.com/0langa/beatform/compare/v2.24.0...v2.25.0
[2.24.0]: https://github.com/0langa/beatform/compare/v2.23.0...v2.24.0
[2.23.0]: https://github.com/0langa/beatform/compare/v2.22.0...v2.23.0
[2.22.0]: https://github.com/0langa/beatform/compare/v2.21.0...v2.22.0
[2.21.0]: https://github.com/0langa/beatform/compare/v2.20.0...v2.21.0
[2.20.0]: https://github.com/0langa/beatform/compare/v2.19.0...v2.20.0
[2.19.0]: https://github.com/0langa/beatform/compare/v2.18.0...v2.19.0
[2.18.0]: https://github.com/0langa/beatform/compare/v2.17.0...v2.18.0
[2.17.0]: https://github.com/0langa/beatform/compare/v2.16.0...v2.17.0
[2.16.0]: https://github.com/0langa/beatform/compare/v2.15.0...v2.16.0
[2.15.0]: https://github.com/0langa/beatform/compare/v2.14.0...v2.15.0
[2.14.0]: https://github.com/0langa/beatform/compare/v2.13.0...v2.14.0
[2.13.0]: https://github.com/0langa/beatform/compare/v2.12.0...v2.13.0
[2.12.0]: https://github.com/0langa/beatform/compare/v2.11.2...v2.12.0
[2.11.2]: https://github.com/0langa/beatform/compare/v2.11.1...v2.11.2
[2.11.1]: https://github.com/0langa/beatform/compare/v2.11.0...v2.11.1
[2.11.0]: https://github.com/0langa/beatform/compare/v2.10.1...v2.11.0
[2.10.1]: https://github.com/0langa/beatform/compare/v2.10.0...v2.10.1
[2.10.0]: https://github.com/0langa/beatform/compare/v2.9.0...v2.10.0
[2.9.0]: https://github.com/0langa/beatform/compare/v2.8.0...v2.9.0
[2.8.0]: https://github.com/0langa/beatform/compare/v2.7.0...v2.8.0
[2.7.0]: https://github.com/0langa/beatform/compare/v2.6.1...v2.7.0
[2.6.1]: https://github.com/0langa/beatform/compare/v2.6.0...v2.6.1
[2.6.0]: https://github.com/0langa/beatform/compare/v2.5.1...v2.6.0
[2.5.1]: https://github.com/0langa/beatform/compare/v2.5.0...v2.5.1
[2.5.0]: https://github.com/0langa/beatform/compare/v2.0.2...v2.5.0
[2.0.2]: https://github.com/0langa/beatform/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/0langa/beatform/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/0langa/beatform/compare/v1.7.0...v2.0.0
[1.7.0]: https://github.com/0langa/beatform/compare/v1.5.0...v1.7.0
[1.5.0]: https://github.com/0langa/beatform/compare/v1.3.0...v1.5.0
[1.3.0]: https://github.com/0langa/beatform/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/0langa/beatform/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/0langa/beatform/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/0langa/beatform/compare/v0.9.0...v1.0.0
[0.9.0]: https://github.com/0langa/beatform/releases/tag/v0.9.0
