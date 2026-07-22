# Changelog

All notable changes to Beatform are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning is
pragmatic rather than strict semver: a feature release bumps MINOR, a
fix-only release bumps PATCH. Entries below are derived from the project's
own commit history (`git log` + tags), oldest tag first reversed to newest.

Beatform is free and open source (MIT), distributed only through GitHub
Releases — there is no paid tier, cloud service, or telemetry.

## [Unreleased]

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
