# Beatform — Manual Testing Batch

The one hand-off checklist for things that need a **human on real hardware** — everything
else (unit/golden tests, type-check, lint, format, Rust tests, dependency audit) runs
automatically in CI, and the render/export invariants are covered by the dev harness. Run this **once, on the installed build**, after an autonomous work
session. Grab the newest `Beatform_<version>_x64-setup.exe` from the
[GitHub Releases](https://github.com/0langa/beatform/releases) page.

Mark each ✅ / ❌ with a note. Grouped by what it exercises.

## Install & boot

- [ ] Installer runs; app launches; a demo track plays and renders with no console errors.
- [ ] ffmpeg sidecar present — ProRes / GIF / WebP export options are enabled (not greyed).

## Core render & export

- [ ] Each of the 16 visual modes looks correct and "pro": no maxing-out, nothing out of
      frame, dynamics read as spikes not mush, sync feels locked to the track.
- [ ] Export a clip in H.264, then spot-check HEVC / AV1 / VP9-alpha / PNG-seq / ProRes /
      GIF / WebP — each opens in a player or NLE.
- [ ] **ProRes 4444 with alpha drops into Premiere/Resolve** with correct transparency.
- [ ] Preview ≡ export: the exported clip matches what the preview showed.
- [ ] Video background: pick a clip, set **Dim + Blur** — the blur looks right and the export
      matches the preview.
- [ ] Lyrics: import an `.lrc`, try the **Plain / Slide / Pop** animations — each looks right
      live and in the export.
- [ ] Long-form: a ~2 h mix exports; memory stays flat (< ~2 GB RSS); the ETA is sane.

## Batch

- [ ] Drop ~20 MP3s → 20 titled videos, unattended; titles come from ID3 tags; one bad file
      doesn't kill the run; skip / retry / resume behave.

## Live performance (Phase 9 — the hardware-dependent surface)

- [ ] **Beat-quantized switching** feels on-beat on real tracks across genres/BPMs. Number
      keys 1–9 and mode chips both queue; the pending chip pulses; it lands on the boundary.
- [ ] **Stage mode** (toolbar button or `\`): all chrome hides, cursor hides, output is clean
      and full-bleed; the mode-name HUD flashes on switch; `.` blackout works; `Esc` exits.
- [ ] **MIDI** (needs a controller): Settings ▸ MIDI ▸ Enable; the device is listed;
      "Learn CC" + wiggle a knob binds it and the knob then drives that setting across its
      range; "Learn note → mode" + play a note switches modes (beat-quantized); unplug/replug
      is handled.
- [ ] **Loopback**: visualize real desktop audio (Spotify / DAW master) live.
- [ ] **Second display / projector** — note the true multi-window output is **not built**;
      the supported approach is: put the app fullscreen on the projector display at the OS
      level, then enter Stage mode. Confirm it's a usable performance output today.

## Projects, library, misc

- [ ] Save/open `.avproj` round-trips: mode + params, styles, background (incl. **video-bg
      Dim/Blur**), overlay layers and assets, aspect, mod routes, timeline, post and motion.
      (Lyric style, MIDI bindings, quantize mode and the audiogram are **session settings**,
      not part of the project file — they persist per install, not per project. Not a bug.)
- [ ] Library folder scan + gapless auto-advance on a real music folder.
- [ ] `.avtheme` import via drag-drop; a factory pack applies cleanly.
- [ ] Undo/redo across a real editing session.
- [ ] **Crash recovery**: make some edits, wait ~6 s (autosave is debounced 5 s), then kill
      the app from Task Manager (End Task — do **not** close it normally). Relaunch: a
      "closed unexpectedly / Restore your unsaved work?" bar appears. **Restore** brings the
      edits back; **Discard** dismisses it for good. Closing the app normally must NOT show
      the bar on the next launch.

## Sign-off

When all green, the app has cleared its own acceptance bar end-to-end on real hardware —
a good moment to cut the **v3.0.0** "1.0-grade" milestone.
