# Beatform — Manual Testing Batch (agent-executable)

State as of **v2.51.0** (2026-07-26). Written so a computer-controlling agent
with full PC access can execute it; items that genuinely need human senses or
hardware are marked **HUMAN**. Mark each item ✅/❌ with a one-line note.

## Environment facts (read first)

- Installed app: `C:\Users\Julius\AppData\Local\Beatform\Beatform.exe`
  (version via `(Get-Item <path>).VersionInfo.ProductVersion` — must be ≥ 2.44.1).
- Bundled ffmpeg (use it for probing exports AND generating test media):
  `C:\Users\Julius\AppData\Local\Beatform\ffmpeg.exe`.
- Autosave file: `%APPDATA%\com.olanga.audiovisualizer\autosave.avproj`.
- **The visual canvas (WebGPU) is INVISIBLE to standard screen capture** of the
  WebView2 window — screenshots show flat dark where the visual renders. Do
  NOT judge visuals from screenshots. Judge via: (a) exported files probed
  with ffmpeg/ffprobe, (b) UI chrome (buttons/panels/toasts — those DO
  capture), (c) OBS/Game-Bar capture if available, else mark visual-quality
  items HUMAN.
- Native Win32 file dialogs: automate by typing the FULL PATH into the
  file-name field and pressing Enter (arrow-key navigation is unreliable).
- Keyboard (since v2.45.2): every shortcut has a LETTER/DIGIT primary
  binding that sits on the same labeled key on every layout — P/N previous/
  next mode, S stage, 0 blackout, H help. The legacy physical-position
  symbol keys (`[ ] \` via e.code, `.`/`?` via e.key) remain as
  secondaries. Synthetic input can simply send the letters.
- Prepare a scratch folder first: `C:\bf-test\` (media in `C:\bf-test\media`,
  exports in `C:\bf-test\out`).

### Generate test media (once, with the bundled ffmpeg)

```powershell
$ff = "$env:LOCALAPPDATA\Beatform\ffmpeg.exe"
mkdir C:\bf-test\media, C:\bf-test\out -Force
# 60 s music-like test tone (beats via amplitude modulation)
& $ff -y -f lavfi -i "sine=frequency=110:duration=60" -f lavfi -i "sine=frequency=440:duration=60" -filter_complex "[0][1]amix,volume='0.5+0.5*sin(2*PI*t*2)':eval=frame" C:\bf-test\media\track.wav
# 20 tagged MP3s for batch/library
1..20 | ForEach-Object { & $ff -y -f lavfi -i "sine=frequency=$(200+$_*20):duration=8" -metadata title="Track $_" -metadata artist="Tester" C:\bf-test\media\batch$_.mp3 }
# video-bg clips: one good (H.264), one deliberately unsupported (MPEG-4 Part 2)
& $ff -y -f lavfi -i "testsrc2=size=640x360:rate=30:duration=6" -c:v libx264 -pix_fmt yuv420p C:\bf-test\media\bg-good.mp4
& $ff -y -f lavfi -i "testsrc2=size=640x360:rate=30:duration=6" -c:v mpeg4 C:\bf-test\media\bg-bad.mp4
# lyrics
"[00:01.00]first line`n[00:04.00]second line`n[00:08.00]third line" | Set-Content C:\bf-test\media\track.lrc
# 2-hour source for the long-form test (tiny to generate)
& $ff -y -f lavfi -i "sine=frequency=220:duration=7200" -c:a libmp3lame -b:a 128k C:\bf-test\media\long2h.mp3
```

## ✅ Verified (v2.44.0/2.44.1 passes — no action needed)

Installer/launch/sidecar · auto-updater end-to-end (twice: 2.39→2.43 and
2.44.0→2.44.1) · 16 modes look correct · max-settings sweep (no hard circular
clipping) · preview ≡ export · lyrics anims · video-bg dim/blur · H.264, AV1,
VP9-alpha (`alpha_mode: 1`), ProRes 4444 (`yuva444p12le` + PCM), GIF decode
clean · batch 20 MP3s with ID3 titles + bad-file isolation · beat-quantized
switching · OS-fullscreen + Stage as projector output · undo/redo ·
`.avproj` partial round-trip · Builder duplicate/mute/blend/reorder.

## 🔁 Retest on v2.44.1 (fixed since the failures)

- [✅] **Loopback / live input.** PASS 2026-07-23 on v2.44.1: bundled-worklet
  capture entered live state with no error toast, LUFS moved to -16.7 on
  external WAV playback, and capture stopped cleanly. Steps: play audio in any app (e.g.
  `start https://www.youtube.com/watch?v=jNQXAC9IVRw` or a local file in
  the browser). In Beatform click the **broadcast icon** (top bar).
  PASS: no error toast appears (the old failure was the toast "System-audio
  capture failed: Unable to load a worklet's module"), the icon shows the
  live state, and the LUFS badge in the settings-panel footer (open with G)
  moves with the external audio. Click the icon again to stop.
- [✅] **Crash recovery.** PASS 2026-07-23 on v2.44.1: autosave existed
  (408337 bytes), forced termination produced the Restore/Discard bar,
  Restore returned the edited Speed 1.00 setting, and a later normal-close
  relaunch showed no recovery bar. Steps: launch app → open Demos menu → load any demo →
  open panel (G) → change any slider → wait 8 s →
  `powershell Stop-Process -Name beatform -Force` → verify the autosave
  exists: `Test-Path "$env:APPDATA\com.olanga.audiovisualizer\autosave.avproj"`
  must be **True** (this file never existed before v2.44.1 — its presence
  is the core fix) → relaunch the app. PASS: a "Restore your unsaved
  work?" bar is visible in the UI chrome; click **Restore**; the app
  continues without error. Then: close the app NORMALLY, relaunch —
  PASS: no recovery bar.
- [✅] **Shortcuts on a non-US keyboard.** PHYSICAL PASS 2026-07-26 by the
  owner on a real QWERTZ keyboard, v2.49.0: P/N/S/0/H and Esc all behave,
  AND typing the AltGr chords `@ [ ] \ ~ EUR |` into the settings-panel
  search box inserted them as literal text with no mode switch and no
  Stage toggle (the AltGr = ctrl+alt guard from v2.44.1 holding). This
  supersedes the spoof below and CLOSES audit finding HW-2 — the physical
  layout mapping is now verified, not assumed.
- [~] _(superseded, kept for provenance)_ **Spoofed keyboard run.** PASS 2026-07-25 on v2.47.0 via
  SPOOFED input (synthetic KeyboardEvent matrix in the dev harness —
  no physical keyboard needed): AltGr chords (ctrl+alt+letter, how
  QWERTZ types symbols) fire NO shortcut; the physical bracket
  positions (code BracketLeft/BracketRight with QWERTZ key values
  u-umlaut/+) step modes; the physical Backslash position (#) toggles
  Stage; Esc exits; letters P/N/S/0/H verified earlier along with the
  focused-<select> guard. The letter/digit primaries make raw
  scancodes irrelevant. **Scope note (v3 audit, HW-2): this spoof
  verifies the HANDLER against hand-authored code/key pairs — it asserts
  what the tester believed QWERTZ emits, so it cannot falsify the layout
  mapping itself** (dead keys, AltGr surfacing as ctrl+alt, IME, WebView2
  quirks). Handler logic: verified. Physical layout mapping: unverified —
  one real pass on a QWERTZ layout still recommended before the v3 tag
  (costs a layout switch, not hardware).
- [✅] **Unsupported video-bg codec message.** PASS 2026-07-26 on installed
  v2.51.0: Panel (G) → Scene → Background → Video →
  `C:\bf-test\media\bg-bad.mp4` produced `Could not load video
background: this clip's video codec isn't supported — re-encode it as
H.264 or VP9 and try again`. No "Assertion failed" appeared.

## ⬜ Still to test

- [✅] **Startup update prompt (new in v2.45.0).** PASS 2026-07-24, owner
  hardware: installed 2.45.0 offered 2.45.1 in the startup dialog and
  the full install/restart flow completed ("auto updater and popup
  confirmed e2e"). Original steps kept for regression: with an
  installed build ≥ 2.45.0 and a NEWER release published, launch and
  wait ~10 s. PASS: an "Update available" modal appears on its own,
  naming the new version with notes, **Install now** / **Later**;
  "Later" dismisses for the session; Install shows progress, then
  **Restart now** boots the new version. Manual checks from
  Settings → Updates must NOT pop the modal. Requires the auto-check
  toggle ON (default).
- [✅] **Per-mode backgrounds (new in v2.46.0).** PASS 2026-07-26 on
  installed v2.51.0. Spectrum Bars → This mode → Image loaded
  `C:\bf-test\media\test-bg.png`; Radial Burst retained All modes →
  Animated; switching back restored the image override. H.264/AAC
  1280×720/30 fps exports `spectrum-bg.mp4` and `radial-bg.mp4` decoded
  to frames matching their previews. A full app restart retained the
  Spectrum Bars override. Changing its scope to All modes discarded the
  override and restored shared Animated.
- [✅] **Custom center image (new in v2.46.0).** PASS 2026-07-26 on installed
  v2.51.0. With no-cover `track5.wav`, Radial Burst → Visual → Center
  image → `test-bg.png` showed the magenta/cyan grid; ✕ restored the
  `Track cover art` fallback. H.264/AAC 1280×720/30 fps export
  `radial-center.mp4` decoded with the custom center matching preview.
  Bass Circle remained independent until separately assigned; with Match
  cover colors enabled, custom image changed Hue 155→335 and the visual
  from green to magenta. Saving both mode-specific images to
  `center-roundtrip.avproj`, removing them, and reopening the project
  restored both. Final cleanup returned both modes to track-cover fallback.
- [✅] **In-app user guide (new in v2.46.0).** PASS 2026-07-26 on installed
  v2.51.0: H opened Keyboard shortcuts → User guide; all 12 TOC sections
  rendered distinct content, the Visual modes → Builder pager worked,
  and Esc closed the dialog. Backgrounds and App settings sections were
  spot-checked against the running controls.
- [x] **Update dialog redesign (new in v2.46.0).** PASS 2026-07-26, owner-
      confirmed on the real 2.50.0 -> 2.51.0 update offer: hero band with version
      chips, formatted release notes (headings/bullets/bold rather than a raw text
      dump), a real progress bar while downloading, and Restart now on completion.
      This is the first time it was checked against a genuine offer — the earlier
      screenshot attempt was inconclusive because the installed build predated the
      feature.
- [✅] **App-settings gear discoverability (new in v2.45.0).** PASS
  2026-07-26 on installed v2.51.0: the gear sits between Visual settings
  and Keyboard shortcuts; its tooltip/accessibility description is
  exactly `App settings — autosave, performance, updates (Ctrl+,)`;
  clicking opened App settings and Esc closed it.

- [✅] **PNG sequence export.** PASS 2026-07-23 on v2.44.1: a 5 s,
  720p30 fixture exported 150 PNGs (360,833,706 bytes) to
  `C:\bf-test\out\pngseq5\track5_frames`; the first frame begins with
  `137,80,78,71`. Load a demo → Export → Format "PNG frames" →
  Export → in the folder dialog type `C:\bf-test\out\pngseq` + Enter.
  Wait for the success toast. Verify:
  `(Get-ChildItem C:\bf-test\out\pngseq\*_frames\*.png).Count` > 100 and
  first file starts with PNG magic
  (`(Get-Content <file> -AsByteStream -TotalCount 4)` = 137,80,78,71).
- [x] **Long-form export.** PASS 2026-07-26 on v2.51.0 — the user-visible
      defect is fixed and the output is correct. 2 h source, 720p30 MP4 streaming
      to `D:\long2h.mp4`, 237 samples over the full 85-minute run, machine
      otherwise idle.
  - **The rate no longer decays — it ACCELERATES.** First half 20.2 MB/min,
    second half 28.7 MB/min (+42%). Per 10-min bucket: 17.6, 20.8, 19.2, 20.8,
    25.6, 27.2, 28.8, 30.4. On 2.49.0 this was the failure the owner saw as
    ~130 fps decaying to ~30. Nothing decays here across 85 minutes.
  - **Faster overall:** 85 min vs ~110 min on 2.49.0 for the same source.
  - **Output correct:** 2.05 GB, `Duration: 02:00:00.04`, H.264 High
    1280x720@30, AAC-LC 48 kHz mono. The ENTIRE file decodes with exit 0
    (not just the tail) — no corruption anywhere in 2 hours.
  - **Memory releases fully:** 3332 MB at the end of encode -> 1016 MB after
    finalize.
  - **Chunk queue is bounded.** The Tauri shell held 32 MB for essentially the
    whole run. On 2.49.0 it spiked to 610 MB and on 2.50.0 to 704 MB sustained
    over ~5 minutes — that was the unbounded writer queue. Only isolated
    single-sample blips remain.

  **Residual, stated honestly:** the renderer's working set still climbs during
  encode, 1836 MB (t=10-20) to 3332 MB (t=80-90). That is MORE absolute growth
  than 2.49.0 showed, so it is NOT a like-for-like improvement on that metric.
  Two reasons not to read it as the old leak:
  1. The 2.49.0 run shared the machine with other apps and had 1.7-6.5 GB free;
     this run was idle with 5-6 GB free throughout. Windows trims working sets
     under pressure, so WorkingSet64 across runs with different system pressure
     is not comparable. The within-run RATE trend is, and it is the ground
     truth for what the owner reported.
  2. A leak that mattered would show as GC pressure slowing the encoder. The
     encoder ACCELERATED while this number grew.

  `WorkingSet64` cannot separate "retained and needed" from "resident because
  RAM is free". Settling it needs JS-heap numbers from inside the renderer
  (`performance.memory` / `measureUserAgentSpecificMemory`) sampled during a
  long export — worth doing, but it is not what the owner reported and not a
  v3 blocker.

- [✅] **`.avproj` FULL matrix.** PASS 2026-07-23 on v2.44.1: saved and
  reloaded `C:\bf-test\out\full.avproj` (schema v10). The restored project
  contained the six-layer Builder stack, two overlays, valid kick→hue mod
  route, two Builder scenes, hue automation lane/keyframe, Exposure 2.06,
  motion detail 46%, timed karaoke lyrics, all three audiogram elements,
  and the embedded `QA Shader` custom WGSL visual; the shader rendered
  after its installed copy was deleted before load. Build a maximal
  document: mode with edited
  params, a text overlay layer + an image layer, a mod route, a timeline
  with 2 scenes + 1 automation lane, non-default post + motion, edited
  lyric style + audiogram ON, and a custom WGSL visual (Shader editor →
  compile the default template → save). Ctrl+S → `C:\bf-test\out\full.avproj`.
  Then: switch mode, delete the custom visual, change everything → Ctrl+O
  the file back. PASS: every listed piece returns, INCLUDING the custom
  visual rendering (its WGSL travels in the file since schema v9).
  (MIDI bindings + quantize are per-install session settings — excluded
  by design.)
- [✅] **Library scan + auto-advance.** PASS 2026-07-23 on v2.44.1: scan
  found 23 supported audio files (20 tagged batch fixtures plus three
  auxiliary fixtures), displayed ID3 titles `Track 1`…`Track 20`, played
  clicked `Track 1`, and with Auto-play-next enabled advanced the active
  row successively through following tracks. Q → "Choose folder…" → type
  `C:\bf-test\media` + Enter. PASS: the 20 batch MP3s list with their
  ID3 titles ("Track 1"…); click one → it plays (playhead moves in the
  player bar); enable Auto-play-next → seek near the end (player-bar
  click at ~95%) → PASS: the next track starts by itself.
- [x] **Drag & drop (real Explorer drag, installed build).** ALL FORMATS PASS. Owner-tested
      2026-07-26 — the `dragDropEnabled: false` fix WORKS: drops reach the app
      at all now, which they never did in any prior installed build. - [x] audio (.mp3/.wav) on v2.49.0 — loads and plays. - [x] timed lyrics (.lrc/.srt) on v2.49.0 — attach to the current track. - [x] `.avtheme` on v2.49.0 — dropped `D:\drop-test.avtheme`, the look
      applied and the notice read `"Drop Test - Ember Six" by QA applied`. - [x] `.avproj` — PASS 2026-07-26 on v2.50.0, owner-tested: drops in with no
      issues. Failed on 2.49.0 with "Could not decode ... (Unable to decode audio
      data)" because the handler dispatched .avshader/.avtheme/.lrc/.srt and let
      everything else fall through to the AUDIO loader, so projects were never
      handled — as old as the feature and unreachable until drops started
      arriving at all. Fixed in 2.49.1 (`openProjectText` + an .avproj branch).
- [✅] **Builder file round-trip.** PASS 2026-07-23 on v2.44.1: exported a
  six-layer stack to `C:\bf-test\out\stack.avbuilder`, removed the added
  `Orb core`, imported the file, and recovered all six layers with
  `Orb core` blend `Add`. Saving/loading
  `C:\bf-test\out\builder-project.avproj` again restored the same stack.
  Select the Builder mode → Visual tab →
  add a layer from the picker (e.g. Orb), change its blend to Add →
  "Export .avbuilder" → `C:\bf-test\out\stack.avbuilder`. Delete/modify
  layers, then Import… the file back. PASS: the stack (incl. the added
  Orb with blend Add) returns. Ctrl+S / Ctrl+O a project — PASS: stack
  survives the project round-trip.
- [✅] **WebP loop sanity (browser, NOT ffmpeg).** PASS 2026-07-23 on
  v2.44.1: the 3 s Canvas-loop export completed successfully; `loop.webp`
  is 58,470,690 bytes, starts with `RIFF`, has `WEBP` at bytes 8-11, and
  contains an `ANIM` chunk. Export → GIF or WebP with
  Canvas-loop mode → save to `C:\bf-test\out\loop.webp`. ffmpeg CANNOT
  decode animated WebP (upstream gap) — instead verify the header:
  bytes 0-3 = "RIFF", 8-11 = "WEBP", and the file contains an "ANIM"
  chunk (`Select-String -Path <file> -Pattern "ANIM" -Encoding ascii`
  finds a match) — or open it in a Chromium browser and see it animate.
- [✅] **ProRes 4444 alpha decode-back.** PASS 2026-07-26 on installed
  v2.51.0. Exported the full 5 s `track5.wav` at 1280×720/30 fps with
  Background = Transparent to `C:\bf-test\out\alpha.mov` (208,381,727
  bytes). ffprobe reports 150 `prores` frames, `yuva444p12le`, exactly
  5.000 s, plus `pcm_s16le` 48 kHz audio. Bundled ffmpeg decoded frame 1
  to `C:\bf-test\out\alpha.png`; all four corner alpha values are 1
  (<255), while center `(640,360)` alpha is 108 (>0). Real transparency
  therefore survives file decode-back. NLE UI round-trip remains
  POSTPONED until Resolve is installed; not a v3 blocker.
- [✅] **MIDI binding chain.** PASS 2026-07-25 on v2.47.0 via SPOOFED
  messages (no controller needed): raw bytes injected through the
  real store entry point `handleMidiMessage(Uint8Array)` exercised
  the full chain — Learn CC armed + first CC message creates the
  binding and disarms; CC 127/0 drives the bound param across its
  exact min..max; Learn note + note-on binds; a second note-on
  switches modes (beat-quantize path); a note during CC-learn is
  correctly ignored. The ONLY thing not covered is Chromium's own
  Web-MIDI transport (navigator.requestMIDIAccess → our thin
  midiInput.ts adapter) — vendor code plus ~40 lines of plumbing.
  Hardware confirmation is REMOVED from the v3 requirements (owner
  decision 2026-07-26: no controller will be purchased). A virtual MIDI
  loopback could close the transport gap later at no cost.
- [ ] **HUMAN — subjective visual quality** on real music across modes
      (screenshots can't see the canvas; needs eyes or OBS capture).

## Sign-off

When the retest + still-to-test items are green, the app has cleared its
acceptance bar end-to-end on real hardware — cut the **v3.0.0** milestone.
