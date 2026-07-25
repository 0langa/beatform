# Changelog

All notable changes to Beatform are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning is
pragmatic rather than strict semver: a feature release bumps MINOR, a
fix-only release bumps PATCH. Entries below are derived from the project's
own commit history (`git log` + tags), oldest tag first reversed to newest.

Beatform is free and open source (MIT), distributed only through GitHub
Releases — there is no paid tier, cloud service, or telemetry.

## [Unreleased]

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

[Unreleased]: https://github.com/0langa/beatform/compare/v2.37.2...HEAD
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
