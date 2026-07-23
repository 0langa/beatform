# Beatform — Manual Testing Batch

State as of **v2.44.1** (2026-07-23). The first full hardware pass ran on
v2.44.0; every failure it found that was fixable in code is fixed in
v2.44.1 — update in-app (Ctrl+, ▸ Updates) before continuing. Sections:
what's **done**, what needs a **retest because it was just fixed**, and
what's **still untested**.

## ✅ Verified (v2.44.0 pass — no action needed)

- Installer / launch / demo track / sidecar present.
- **Auto-updater** end-to-end (detect → download → restart into new version).
- All 16 modes look correct; **max-settings sweep** on Bass Circle, Radial
  Burst, Voice Orb, Metaballs, Echo Trails: smooth at the frame edge, no
  hard circular clipping (soft frame limits confirmed on hardware).
- Preview ≡ export; lyrics Plain/Slide/Pop live + exported.
- Video background (VP9/WebM): Dim 0.90 / Blur 60 correct live + exported.
- Exports decoded clean: H.264, AV1, **VP9-alpha** (`alpha_mode: 1`),
  **ProRes 4444** (`yuva444p12le` + PCM), GIF.
- Batch: ~20 MP3s unattended, ID3 titles, bad file doesn't kill the run.
- Beat-quantized switching on-beat across genres; pending chip behaves.
- Second display via OS-fullscreen + Stage mode is a usable performance
  output.
- Undo/redo across a real session.
- `.avproj` partial round-trip (mode/params/aspect/video-bg incl. Dim+Blur).
- Builder partial: duplicate/mute/blend-change/reorder all work.

## 🔁 Fixed in v2.44.1 — please retest

- [ ] **Loopback / live input** (was: "Unable to load a worklet's module").
      Root cause: the audio worklet loaded from a `blob:` URL, which the
      app's CSP correctly blocks in installed builds (dev has no CSP, so it
      always worked there). It now ships as a bundled asset. Click the
      broadcast icon while Spotify/a DAW plays — visuals should follow.
- [ ] **Crash recovery** (was: no restore bar after force-kill). Root cause:
      the autosave file had **never been written** — the fs permission set
      granted read but not write scope for the app-data folder, and the
      failure only ever hit the console. Scope granted; additionally, if
      autosave ever fails again the app now shows an error instead of
      staying silent. Retest: edit → wait ~7 s → End Task in Task Manager →
      relaunch → "Restore your unsaved work?" bar → Restore brings edits
      back. Normal close must show no bar.
- [ ] **Stage mode on QWERTZ** (was: `[` entered Stage, Esc stuck). Three
      fixes: AltGr chords (Ctrl+Alt, how QWERTZ types `[ ] \`) are never
      treated as shortcuts anymore; the previous/next-mode and Stage keys
      now bind to the **physical key positions** (the two keys right of P,
      and the key below/right of them — layout-independent); **Esc is
      handled before every other rule**, so it always exits Stage/blackout
      even with a dropdown focused. Retest all three on your layout.
- [ ] **Video background with unsupported codec** (was: raw "Assertion
      failed"). Same clip should now produce a readable message naming the
      codec problem and suggesting H.264/VP9. (Decoding old MPEG-4 Part 2
      files is genuinely unsupported — the fix is the message, not the
      codec.)

## ℹ Explained — not bugs, notes updated

- **HEVC missing from the codec picker**: the picker only offers codecs your
  hardware/OS can actually encode (probed at start); this machine exposes
  H.264/AV1/VP9 but not HEVC encode. The MP4 help text no longer implies
  HEVC is always available.
- **Animated WebP "undecodable by ffmpeg"**: ffmpeg cannot decode animated
  WebP at all (long-standing upstream gap — `image data not found` is its
  standard symptom). Verify WebP loops by opening the file in a
  Chromium-based browser instead; the export pipeline itself was verified
  frame-accurate there.

## ⬜ Still to test (untouched by the fixes)

- [ ] **ProRes 4444 into Premiere/Resolve** with correct transparency
      (needs an NLE install; the technical alpha validation already passed).
- [ ] **Long-form**: a ~2 h mix exports; memory stays flat (< ~2 GB RSS);
      ETA sane.
- [ ] **PNG sequence** export completes into a picked folder (run
      interrupted last time; no known defect).
- [ ] `.avproj` FULL matrix: overlay layers + assets, mod routes, timeline,
      post, motion, **lyric style + audiogram**, and a **custom WGSL
      visual** rendering on a machine that never imported the .avshader.
      (MIDI bindings + quantize are per-install session settings — not in
      the file, not a bug.)
- [ ] Library folder scan + gapless auto-advance on a real folder (blocked
      only by dialog automation last time).
- [ ] `.avtheme` drag-drop import; factory pack applies cleanly.
- [ ] **Builder** remaining: add-layer from the picker, `.avbuilder`
      export → import back, project save/reopen round-trip, export matches
      preview.
- [ ] **MIDI** (needs a controller): enable, learn CC → knob drives a
      setting; learn note → mode switch (beat-quantized); unplug/replug.

## Sign-off

When the retest + still-to-test items are green, the app has cleared its
acceptance bar end-to-end on real hardware — cut the **v3.0.0** milestone.
