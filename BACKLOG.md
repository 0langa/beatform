# BACKLOG — the live work ledger

Canonical ledger (per CLAUDE.md): read before feature work, update when
finishing. Reset **2026-09-02** for the v3.0.0 program. Everything closed
before that day is frozen verbatim under
**[archive/ledgers/](archive/ledgers/)** (`BACKLOG-through-v2.104.2.md`,
`PROPOSALS-2026-08-audit.md`, `BACKLOG-through-v2.108.0.md`,
`TESTING-through-2026-08-04.md`) — consult for context; never reopen rows from
it. User-facing history lives in CHANGELOG.md; process memory in the agents'
memory stores.

Rules unchanged: never rename a persisted ID without a migration; new modes
follow registry + grid + matrix re-bless discipline; GATES.md is canonical for
"done"; quality over speed.

## v3.0.0 program (ACTIVE — owner re-cut 2026-09-02)

The bar: **nothing that was started ships half-done.** Ordered plan and release
train in **[docs/V3-RELEASE-PLAN.md](docs/V3-RELEASE-PLAN.md)**: v2.109.0
housekeeping → owner verdict round → v2.111.0 (one release, HD-06 included;
v2.110.0 became the 2026-10-09 beat-sync release)
→ owner checks A1/A2 → 3.0.0 docs/version-only diff after a full device
battery. The tag waits for the owner's explicit go.

## Open after 2.111.0 (found 2026-10-10 on the owner's machine)

- [x] **ALIGN-002 "regressed": the HKCU uninstall entry did not follow two
      in-app updates.** DECLARED 2026-10-10 — not a Beatform regression; the
      cause sits outside the repo, and the existing boot self-heal repairs it
      on the next normal launch. Evidence, all from the owner's machine:
      (1) the tauri-cli 2.12.1 NSIS template still writes `DisplayVersion`
      unconditionally in its Install section; (2) the 2.111.0 installer DID
      run that section — it wrote `uninstall.exe` at 00:13:43 and relaunched
      the app the same second — yet the key's LastWriteTime stayed at
      2026-08-21 (the 2.108.0 install): none of its registry writes landed;
      (3) the app's own boot heal (`uninstall_entry.rs`) ran in that relaunched
      process and did not land either; (4) the SAME installed binary started
      normally healed the key at once (its stderr said "DisplayVersion healed to
      2.111.0"; the key reads 2.111.0 since); (5) key ACL,
      owner and integrity are normal and an unsigned probe writes the key fine.
      Only processes descending from the updater-launched installer were
      refused. What changed on the machine between the good 2.108.0 install
      and the two failing updates: Avira Security (installed 2026-09-23) and
      Avira System Speedup (2026-10-07). Most likely the security product
      blocks registry writes from that process tree; its logs record nothing
      for Beatform, so this stays a strong suspicion, not a proof. Re-check
      at TESTING.md D1: read `DisplayVersion` after ONE ordinary relaunch, not
      only straight after the update.
- [x] **Updater error dialog showed no reason** — Tauri plugin commands
      reject with a plain string, `(e as Error).message` was `undefined`.
      Fixed on main (`errorText` in `src/state/updater.ts`, two tests). The
      live failure behind it was C: at 10 MB free: the updater writes the
      60 MB installer to `%TEMP%` first; freeing space fixed the update.

## Owner-pending (only the owner can close these)

- [x] **Verdict round** — done: every HD row below carries its verdict and
      shipped in v2.111.0 (row stayed open by oversight; closed 2026-10-10).
- [x] **Merge dependabot PRs** — DONE 2026-09-02 on the owner's go: #26
      (rust-cache action), #29 (lofty 0.25.1, cpal 0.18.2, naga 30.0.1) and
      #31 (the npm minor/patch group, 13 updates incl. mediabunny 1.55.4,
      vite 8.2.2, vitest 4.1.11, eslint 10.9.1; #30 was dependabot's earlier
      copy of the same group, closed by dependabot) squash-merged after CI.
- [ ] **A1 Lyric Stage word timing** (~3 min) — TESTING.md § A1. Closes
      FEAT-004. **The measurable half is done (2026-10-10):** the new probe
      `scripts/lyrics-timing-probe.mjs` (speech with sample-exact word onsets
      over a music bed, the real sidecar end to end) found the first words of
      a song with an intro lit **3.7 s early** and two sung lines run together
      per line; fixed in the sidecar (see "Done 2026-10-10"), the probe now
      passes (54 words, worst 0.15 s, median 0.04 s) and two public-domain
      sung recordings split into exactly their real lines. What is left is
      taste only: generate lyrics for a song you know and say whether it
      feels right — the fix needs a REGENERATE, old LRCs keep old timing.
- [ ] **A2 Second-display eyes + HDMI yank** (~5 min) — TESTING.md § A2.
      Closes FEAT-009. Still needs a second physical display (this machine
      has one monitor). The fps-cap lift is unit-tested (`effectiveFpsCap`).
- [ ] **Launch kit** (not a gate) — hero pick, `[SLOT]` fills, `[VERIFY]`
      flags, three screen recordings, posting.
      Kit: `OneDrive\Documents\doc\beatform-launch-kit\`.
- **Play session** — DROPPED as a v3 gate 2026-09-02 (owner choice). The
  automated device battery plus A1/A2 stand in for it.

## Half-done inventory (the v3 gate — every row needs a verdict, then closes)

Found 2026-09-02 by four independent read-only sweeps of the code (markers,
docs-vs-code, wiring gaps, feature symmetry). Each row: what a user can reach
that is not finished, where, the recommended verdict, and a size (S < 2 h,
M ≈ half a day, L ≈ 1-2 days incl. re-bless). **Verdict** is the owner's word;
until written it is blank. A row closes when its verdict is executed and the
evidence is recorded here.

### Export and batch

- [x] **HD-01 Batch export silently ignores the export panel's format.**
      `startBatch` hardcodes `format: "mp4"` (src/state/slices/batchActions.ts:210)
      and never reads `settings.format` — pick PNG sequence, ProRes, AV1 10-bit,
      GIF or WebP, queue a batch, get MP4s with no notice. Deep-color follows
      format, so it is dropped too. Recommended: **FINISH-lite** — refuse the
      unsupported formats up front with a notice and label the batch panel
      "MP4 / WebM" (S); full lane parity for the sidecar formats is M.
      Verdict: **FINISH-lite** — closed 2026-09-03 (88c97b1): `batchSettingsRefusal()` in `startBatch` refuses PNG/ProRes/AV1 10-bit/GIF/WebP (and canvas mode, HD-02) before the folder dialog, naming the tile and the fix; the panel disables Start with the same sentence and says "Batch renders whole tracks as MP4 / WebM". Code fact: `FormatPreset.format` is literally `"mp4"` and WebM rides the `vp9a` codec, which was already passed through — so the only admissible format id is mp4.
- [x] **HD-02 Batch ignores Canvas-loop mode** (`settings.mode` never read;
      no segment, no loop crossfade, wrong size). Recommended: **FINISH-lite**
      — refuse canvas mode in batch with a notice (fold into HD-01) (S).
      Verdict: **FINISH-lite** — closed 2026-09-03 (88c97b1): canvas-loop mode refused in the same `batchSettingsRefusal()` path as HD-01, with tests for each refusal and for MP4 passing through.
- [x] **HD-03 Batch drops stems and vocal spans** — `TrackInput` carries
      neither, so stem routes and the "Vocals (lyrics)" mod source read 0 in
      batch output while the interactive export honours them (same class as
      R2-05, one layer up). Recommended: **FINISH** — pass both through like
      sections/audiogram (S). Verdict: **DECLARE with a guard** (not the literal pass-through) — closed 2026-09-03 (88c97b1). The code refutes the row: `loadFile` clears `stems` and `lyrics` on every load because both are imports bounced/timed for ONE track; sections and the audiogram are recomputed per batch track from its own audio, stems and lyrics cannot be. Passing the loaded track's stems to twenty other songs would paint one song's drums onto every other — the opposite of the determinism law. An interactive export of any batch track, loaded fresh, carries neither, so batch already resolves the same frames. What ships: `TrackInput` stays free of stems/lyrics (pinned), and the Batch panel warns up front (`batchInertSources`) when the loaded track's stems or lyrics feed the setup (stem routes, Vocals source, captions). Guide updated.
- [x] **HD-14 The A-B loop region cannot be exported** — `segment` is set only
      in canvas mode (src/state/slices/exportActions.ts:230); the loop is a
      preview-only tool. Recommended: **DECLARE** in the guide next to the A-B
      keys (S); an "Export loop region" checkbox would be M. Verdict: **DECLARE** — closed 2026-09-03 (e121697): the guide's A-B paragraph now says the loop is a preview tool and exports never render just the A-B region.
- [x] **HD-24 Batch progress shows only instantaneous fps** (no average
      speed) and classifies errors without the single-export lane's
      translation + scratch re-measure + ffmpeg log tail. Recommended:
      **FINISH** — reuse the single lane's helpers (S). Verdict: **FINISH** — closed 2026-09-03 (88c97b1): the single lane's 5 s windowed rate ring became `SpeedMeter` (pure, tested) and both lanes use it; batch rows read `42 fps · avg 38`; failed batch jobs go through `describeFailure` = the single lane's `classifyError` + `translateExportError` over a fresh scratch re-measure. Ledger claim inverted: the old batch `fps` was the cumulative average, the single lane had the window. The ffmpeg log tail does not apply — batch never runs a sidecar. Loose end noted, not a row: `ExportDialog.tsx` computes `avgSpeed` but renders only `speed`.

### Rendering and modes

- [x] **HD-06 Nine of twenty modes lack the global Saturation + Lightness
      pair** the other eleven treat as standard (oscilloscope, tunnel-rings,
      nebula, metaballs, voice-orb, echo-trails, aurora, synthwave, Builder) —
      and exactly those nine have no `color/grayscale` pixel case. The most
      visible inconsistency in the mode strip. Recommended: **FINISH** as its
      own release v2.111.0 (L — nine shaders through `presetColor`, styles
      re-checked, GPU matrix re-bless with per-mode visual proof), else
      **DECLARE** in the guide (S). Verdict: **FINISH (eight modes) + DECLARE (Builder)** — executed 2026-09-03 on `wt/color` (796390d, b33e2a3, 2507b8d, 2e996f2, defb321), ships as v2.111.0. Code facts that corrected the row: six of the eight are cosine-palette RGB modes with no `hsl2rgb`, so the HSL `presetColor` contract cannot apply — they route through a new shared `presetRgb`/`presetRgbAt` in wgslLib.ts written as `rgb*s + gray*(1-s)` (exact identity at s = 1 under fma, unlike `mix`); Oscilloscope and Synthwave (HSL modes) route every `hsl2rgb` through `presetColor` and their tinted whites through `presetRgb`. Tunnel/Metaballs/Voice Orb/Aurora route the finished frame after tonemap; Echo Trails routes its three injection sites, never the fed-back history; Kaleido Nebula keeps its RP-6 `saturation` and gains `lightness` plus a final stage that only engages below saturation 1/16 (styles and the default untouched). Builder is DECLARED: its `paramsByPreset.builder2` is a derived mirror rewritten from the stack on every edit and load, so a real global key needs a `.bfbuilder` format change — colour stays per layer by design. Pixel neutrality at the defaults argued and pinned (shaderGolden snapshot: exactly 16 changed entries; gpuMatrix ids: +16). **Device gate pending:** `npm run test:gpu` must show 316 unchanged hashes, 16 moved `extreme/min|max` cases (they sweep the new keys) and 16 new `color/*` cases, then `npm run test:gpu:update` → 348 cases; visual checks per mode at saturation 0 / lightness 2.
- [x] **HD-07 The second-display window inherits the operator's fps cap.**
      Cap-skipped tickless frames return before `publishPerformFrame`
      (src/state/services.ts:452) and ticked capped frames publish
      `advance-only`, which the receiver never presents
      (src/perform/performRuntime.ts:127). A battery knob throttles the
      audience. Recommended: **FINISH** — publish and present the mirror
      regardless of the preview cap (S/M; verify on the real second display).
      Verdict: **FINISH** — closed 2026-09-03 (46ab64c): `effectiveFpsCap` lifts the preview cap while the mirror is live (pure, unit-tested); the Preferences hint says so. Owner check A2 confirms it on the real second display.
- [x] **HD-09 Automation lanes on toggle/enum parameters interpolate
      linearly** — the lane picker offers every param, but `addKeyframe`
      defaults `curve: "linear"` (src/state/timeline.ts:31,140), so a bool or
      enum lane yields fractional values between keys. Recommended:
      **FINISH** — default `hold` for non-numeric params and snap their lane
      values (S). Verdict: **FINISH** — closed 2026-09-03 (b799394): new keyframes on toggle/enum/snap params start on `hold`, dots land on whole values, and `resolveActiveFrame` rounds and clamps automated values for those params in the shared chokepoint (frameResolve tests).
- [x] **HD-15 Three analysis fields are computed every frame and consumed by
      nothing** — `beatIndex`, `barIndex`, `chroma` (P-15 "reactivity fuel",
      src/audio/types.ts:83, "per-mode adoption is a later wave"); `vocal` and
      `sectionPulse` from the same batch ARE routable mod sources.
      Recommended: **DECLARE** — reword the comment to state exactly which
      fields have consumers and that the rest are an internal contract with
      measured cost (S); **REMOVE** the three would also be S. Verdict: **DECLARE** — closed 2026-09-03 (e121697): the `AudioFeatures` comment names the consumers field by field and states that `beatIndex`/`barIndex`/`chroma` have none and adoption is not scheduled.
- [x] **HD-23 Canvas2D fallback is one generic look and unreachable on
      healthy hardware** — no toggle forces it; only a real GPU loss reaches
      it; no pixel baseline. PREVIEW-EXPORT-CONTRACT already scopes it.
      Recommended: **DECLARE** (already documented; 0). Verdict: **DECLARE** — closed 2026-09-03: already documented in PREVIEW-EXPORT-CONTRACT.md; nothing to change.

### Live performance and MIDI

- [x] **HD-18 MIDI must be re-enabled by hand on every launch.** Bindings
      persist (`LS_MIDI`, src/state/persistence.ts:612); `midiEnabled` is
      session-only and nothing re-enables at boot, so saved bindings do
      nothing until the user clicks Enable. Recommended: **FINISH** — persist
      the enable flag and re-enable on boot (permission is granted Rust-side)
      (S). Verdict: **FINISH** — closed 2026-09-03 (9c7daf8): `midiEnabled` lives in AppPrefs (additive boolean, validator defaults a missing key to false); `initApp` calls `restoreMidi()` quietly at boot; Enable sets the flag, Disable clears it. Prefs + midiActions tests. Device check DONE 2026-10-10: `scripts/midi-e2e.mjs` leg 8 relaunches on the same profile, never calls Enable, and sees MIDI re-armed plus a saved CC binding applying exactly once (loopMIDI virtual port, the real WebView2 Web MIDI path).
- [x] **HD-19 MIDI can bind only knob→param and note→mode.** Blackout,
      play/pause, Stage, next/previous mode, volume and A-B keys — the Perform
      drawer's own controls — have no MIDI target (src/state/midi.ts:35); the
      drawer arms note-learn only, CC-learn lives on Visuals ▸ Live; CC learn
      is limited to the active mode's mod-targetable params (no Global motion,
      Post, volume). Recommended: **FINISH the VJ core** — blackout,
      play/pause, next/prev mode as note targets, CC-learn from the drawer
      (M) — and **DECLARE** the rest (S). Verdict: **FINISH core + DECLARE rest** — closed 2026-09-03 (9c7daf8): `CommandBinding` (blackout, playPause, nextMode, prevMode) dispatches the same store actions the keys take (`setBlackout` gated like the `0` key, `togglePlay`, `stepPreset` → beat-quantized queue); the Perform drawer carries a Pad picker with Learn note and a Knob picker with Learn CC over the active mode's mod targets; `validMidiBindings` round-trips the new kind and drops unknown commands. Guide MIDI text declares volume, A-B, Stage and Global/Post as keyboard-and-mouse only. Ledger claim corrected: the drawer never had play/pause or next/prev _buttons_ — the keys' store actions are the target. Device check DONE 2026-10-10: `scripts/midi-e2e.mjs` leg 7 note-learns all four commands through the real Web MIDI path; next/previous step the strip, play/pause toggles the transport, the blackout pad is inert outside Stage and fires inside it. A hardware controller sends the same messages through the same Windows MIDI stack.
- [x] **HD-16 `loopback_died` is never polled.** The Rust command exists
      (src-tauri/src/loopback.rs:348, registered) and its doc says the
      frontend polls it to drop the "listening" indicator; no TS call site
      exists. A dead capture device leaves the broadcast icon lit over
      silence. Recommended: **FINISH** — poll or event it into the live-input
      state (S). Verdict: **FINISH** — closed 2026-09-03 (63d3a78): the store polls `loopback_died` once a second while listening (`liveInputWatch.ts`, unit-tested) and tears the session down with a notice when the device is gone.

### Lyrics

- [x] **HD-17 Lyrics model manager can download but never verify or
      remove.** `lyrics_model_verify` / `lyrics_model_remove` exist in Rust
      and as TS wrappers (src/state/platform.ts:302,307); no button calls
      either — multi-GB models cannot be reclaimed from inside the app.
      Recommended: **FINISH** — Verify and Remove actions in LyricsGenPanel
      (S/M). Verdict: **FINISH** — closed 2026-09-03 (afea521): LyricsGenPanel lists every model on disk with Verify (checksum re-check) and Remove (askConfirm first; also clears stalled `.part` downloads); a transient `modelOp` claim locks download/generate/re-align while one runs; both re-read `lyricsModelsState()` like the download path. Device check pending: Verify and Remove on a real model.
- [x] **HD-08 Line re-align has no cancel and no progress.** Transcribe has a
      stage-weighted bar, ETA and cancel; re-align sets
      `lyricsRealign: { index }` and offers nothing else
      (src/state/slices/lyricsEditActions.ts:231). Recommended: **FINISH** —
      cancel + indeterminate progress (M). Verdict: **FINISH** — closed 2026-09-03 (afea521): re-align shows an indeterminate bar with Cancel; `cancelLyricsRealign` reuses `lyrics_generate_cancel` (the sidecar's line-align job shares the generate slot, verified in lyrics.rs), a run-local token drops late results, `lyricsRealign` clears in `finally`, the document stays untouched (undo depth 0 pinned). No Rust change. Device check pending: Cancel during a real re-align.
- [x] **HD-11 `.srt` is read-only** — imports, drop-imports, but export always
      writes `.lrc`. Recommended: **DECLARE** in the guide ("LRC is the
      output format; SRT imports are converted") (S). Verdict: **DECLARE** — closed 2026-09-03 (afea521): guide paragraph states LRC is the format Beatform writes and that SRT imports convert (an SRT cue's explicit end time is not kept); Save .lrc / Import lyrics tooltips and the save-dialog filter label say the same; pinned by `guideContent.test.ts` and a lyricsEditActions test.
- [x] **HD-20 The lyrics editor's Ctrl+Z / Ctrl+Y** (src/ui/LyricsEditPanel.tsx:335)
      appear in no shortcut sheet and no help prose; the coverage test scans
      only `useAppShortcuts.ts`. Recommended: **FINISH** — one sheet row (S).
      Verdict: **FINISH** — closed 2026-09-03 (afea521): two Editing rows on the shortcut sheet; the coverage test now also scans `LyricsEditPanel.tsx` and asserts lyrics-specific rows exist (the plain union check passed vacuously because Ctrl+Z/Y exist app-wide). Ledger claim corrected: the guide prose already mentioned the editor's keys; the sheet and the test were the gap.

### Files, import, Gallery, Shadertoy

- [x] **HD-10 `.bftheme` imports only by drag-and-drop** — export has a native
      dialog (src/state/slices/projectIOActions.ts:76); import has no dialog,
      no button, no file input. Recommended: **FINISH** — "Import theme…" via
      the existing dialog helper next to the export (S). Verdict: **FINISH** — closed 2026-09-03 (63d3a78): "Import theme…" beside "Save as theme…" opens the native dialog and feeds the drop-import's parser (`importThemeFromFile`, tested).
- [x] **HD-13 Gallery: an updated upstream entry reads "Already in My Looks"
      forever** (`entryGate` compares only `minAppVersion`/`savedWith`, never
      the entry's hash against the installed copy), and removal lives on a
      different surface than install with no label on the card. Recommended:
      **FINISH** hash-aware gate (S/M) + **DECLARE** the removal location on
      the card (S). Verdict: **FINISH + DECLARE** — closed 2026-09-03 (93fb127): `installedLookState` compares the registry's per-entry sha256 with the digest recorded at install; a changed entry reads "Update look" and installs over the old copy through the verified path. The install record moved from session-only to a validated localStorage map (`viz.galleryInstalled.v1`, additive; no file format touched) — which also fixed the Gallery forgetting every install after a restart. Installed cards say removal lives under Visuals ▸ Looks & themes. Ledger claim corrected: the gate compared `minAppVersion`/`schemaVersion` (no `savedWith` exists). Device check DONE 2026-10-10: `node scripts/gallery-e2e.mjs` green against the live registry, step 5b included ("Update look" enabled, update installs over the old copy, same preset id, digest restored, persisted).
- [x] **HD-12 Shadertoy import never warns.** `iChannel1-3` bind an empty
      texture, so shaders that sample them compile and silently render black
      there; multi-pass (Buffer A-D / Common) is not detected; the transpiler
      has no warning channel at all (src-tauri/src/shadertoy.rs,
      src/ui/ShadertoyImport.tsx:150). Recommended: **FINISH** — detect
      `iChannel1-3` and buffer references, surface warnings in the dialog for
      the shader actually pasted (M). Verdict: **FINISH** — closed 2026-09-03 (542606c): the import dialog scans the pasted GLSL and lists, before Translate, the empty channels it samples (iChannel1–3), that iMouse is always zero, and Buffer A–D / Common mentions; advisory, never a gate (`shadertoyWarnings.ts`, pure, tested; dialog test).

### Performance display

- [x] **HD-05 The GPU % stat can be enabled but never shows a value.**
      Toggle (src/ui/SettingsDialog.tsx:56) → overlay row
      (src/ui/PerfOverlay.tsx:204) → Rust field (src-tauri/src/perfstats.rs:85)
      is fully wired with no collector; it renders "—" forever. Recommended:
      **REMOVE** the toggle, row and field (S; Rust gates). Implementing a PDH
      GPU-engine collector would be M. Verdict: **REMOVE** — closed 2026-09-03 (46ab64c): toggle, overlay row, prefs key and the Rust `gpu_pct` field are gone; old prefs blobs that still carry the key are ignored by the validator.

### Code that promises a second consumer

- [x] **HD-21 Dead or duplicated helpers.** `isExporting`
      (src/state/store.ts:3415) is documented as the Escape/close guard but
      `useAppShortcuts.ts:86` re-implements it inline and differently
      (divergence risk); `saveBinaryFile` (platform.ts:57) has zero callers;
      `getPerformBridgeStats`, `isBindableMessage`, `LED_MATRIX_HUE_KEYS` are
      test-only exports whose production callers re-implement the logic; 14
      more module-local exports have no importer. Recommended: **FINISH** —
      route the callers through the one helper, delete the rest (S).
      Verdict: **FINISH** — closed 2026-09-03 (63d3a78): `isExporting` and `saveBinaryFile` deleted (no callers; the Escape handler gates the export and batch dialogs separately on purpose); 13 module-local helpers/types de-exported per knip. Test-only exports with production twins (`getPerformBridgeStats`, `isBindableMessage`, `LED_MATRIX_HUE_KEYS`) stay: their production callers read the same module state, not a copy.

### Pre-decided (recorded so nobody reopens them; verdict already DECLARE)

- **HD-22 `.bfpreset` and the last-session cache carry no document-schema
  stamp**, so a pre-v14 Kaleido Nebula look renders ~21% flatter than the
  same look saved in a `.bfproj`. A retroactive migration was **rejected by a
  judge panel in 2026-08**: unstamped values are ambiguous (the same `1.0` is a
  pre-v14 ceiling and a post-v14 neutral), and migrating would oversaturate
  every look already fixed by hand. `appVersion` has been stamped into every
  `.bfpreset` since 2026-08-13 so the NEXT such change can be gated. Documented
  in code (userPresets.ts:42-66) and pinned by tests. Stays DECLARE.

## Hardening (agent-ready, not v3 gates)

- [x] **B5 — WebCodecs-lane 601/709 tagging device probe** (R2-30 remainder):
      **CLOSED CLEAN 2026-09-02** — new `scripts/webcodecs-color-probe.mjs`
      drove the debug shell through a real H.264 export of a red document and
      a PNG frame of the same document as RGB truth: stream reads
      `yuv420p(tv, bt709, progressive)`; measured Y′ 0.1764 vs BT.709
      prediction 0.1762 (BT.601 would read 0.2449). Tagged AND converted
      correctly; nothing to fix. Artifacts on devstorage
      (`artifacts/2026-09-02_webcodecs-color-probe`).
      user-reaching).
- [x] GPU matrix: transitions are proven on one non-feedback pair
      (spectrum-bars ← radial-burst) and post/motion on two modes; add a
      feedback-mode pair and a Builder pair (re-bless with proof).
      **DONE 2026-10-10:** `transition/pair-feedback/mid` (echo-trails ←
      spectrum-bars) and `transition/pair-builder/mid` (builder2 default stack
      ← spectrum-bars), crossfade at mix 0.5 (`TRANSITION_PAIR_CASES`,
      gpuMatrix.ts). `npm run test:gpu` first: the 348 existing hashes all
      matched, the only drift was the two added ids; both rendered at 960×540
      through the real WebGPU renderer and checked by eye (a clean 50/50 blend,
      the echo history intact — no black frame); then `test:gpu:update` →
      350 cases, baseline diff = 14 added lines, 0 changed.
- [x] `paramsTab` pref (src/state/prefs.ts:73) is frozen — validated,
      persisted and diffed, consumed only by its own migration to
      `visualsPage`. **Closed 2026-10-10 as "leave":** its FROZEN (P-1)
      docblock already says why it stays, and dropping it is a persisted-prefs
      change the v3 program rules out.
- [ ] Overgrowth mist seam sub-LSB inset (F4 nit): below one 8-bit LSB, frozen
      into the blessed baseline, cosmetic only — **parked** by decision.
- [ ] exportWorker bundle duplicates the codec+renderer stacks (~1.0 MB,
      lazy-loaded; disk-only cost) — **parked** by decision.
- [ ] mediabunny upstream: WebM CodecDelay=0 / SeekPreRoll misuse — issue text
      drafted in the archived audit reports; **posting is the owner's action**.
- [x] Review nanos — all four closed 2026-10-10:
      (1) **toggleLoop's 1 ms jump detector misfired on a playing clock** —
      FIXED: the engine counts its own playhead relocations
      (`AudioEngine.relocations`) and the four loop/region actions compare
      that count; a render-quantum tick between reads is no longer a
      "teleport" (red-first test with a ticking clock in
      loopToggleReset.test.ts, engine counter test in engineGraph.test.ts,
      mutation-checked). (2) **loopback worklet armed `delivered` on a
      zero-frame chunk** — FIXED (`if (frames > 0)`; red-first test).
      (3) **redo after shader-delete-undo does not re-delete** — DECLARED: the
      custom-shader library lives outside the document snapshots, so redo is
      conservative (the shader stays in the library; nothing is lost). Making
      redo delete again would need library state in the undo history.
      (4) **Esc with Stage active and a dialog open** — FIXED at the cause:
      Stage hides every `.modal-backdrop`, so H / Ctrl+, / B opened dialogs
      nobody could see; those keys are now inert in Stage (guide says so).

## 2026-10-11 — "polish everything toward 3.0.0" pass (owner-initiated)

Owner's brief: find and fix anything still bugged or unoptimal, deepen the
modes (Tunnel named as the example: "doesn't feel like travelling through an
actual tunnel continuously"), full permission to change mode behaviour. Ships
as the next 2.x; each row records its gate evidence. **Gates on the tree
below (2026-10-11):** typecheck, lint, format, 3,251 vitest tests, build —
all green; `src-tauri/` untouched (Rust set not required); GPU matrix
re-blessed with the exact tunnel-only drift recorded in its row. Also in
this pass: every Builder layer control gained a hover hint (the nine layer
kinds had none — the panel footer said "Hover a control to see what it
does" and showed nothing). UI sweep in the browser dev build (every
Visuals page, Export, Preferences, Gallery, Perform drawer, Timeline, the
four newest modes): no defect found.

- [x] **Tunnel travel model — continuous flight.** Cause found in the
      shader: `travelT = t·v + drive·k + kick·stride` — loudness and the beat
      were POSITION offsets, so the wall ran backwards on every dip and every
      kick shoved-then-slid; at the shipped defaults those shoves were most
      of the visible motion (cruise 0.1155 depth-units/s vs a 0.27-unit
      loudness swing). Fix: (1) a per-track **travel curve** — loudness-
      integrated time computed at analysis beside the grid/sections
      (`src/audio/analysis/travel.ts`, 50 ms RMS hops, mean-normalised so it
      runs 1 s/s on average, floored so silence never parks), carried through
      the live analyzer, the export job (rebased for segments like the grid)
      and the batch runner, and surfaced as **`u.travel`**; (2) a continuous
      **`u.beatCount`** uniform (beatIndex + phase) and a prelude
      **`beatRide()`** (one unit per beat, front-loaded ease, monotonic); (3)
      the shader blends `u.time` toward `u.travel` by Cruise energy and adds
      `beatRide()·stride` — every term one-way; (4) default `speed` 0.15 →
      0.45. Tests: travel curve (monotonic, normalised, floor, interpolation,
      segment rebase), export key census + segment-shift matrix carry
      `travel`, beatRide lifted from the prelude (integers at boundaries,
      no wrap step, monotonic, front-loaded), store/analyzer mocks.
- [x] **Tunnel Hue dial was a phase nudge.** The hue entered the palette as
      a phase offset of `t` under a cosine of frequency `spread`
      (0.08–0.67 cycles), so the 0..360 dial moved the colour by at most
      that fraction of the wheel:
      every look sat in one red-to-magenta band (Ice Cave at 195 rendered
      pink; Vector Grid at 130 never green — confirmed on screen before the
      fix). Fix: prelude `hueRotate()` (Rodrigues about the grey axis, exact
      identity at 0) applied to the finished palette; the depth drift keeps
      its spread. Lifted test: red → green at 120°, blue at 240°, grey fixed.
- [x] **Tunnel depth cues** — three opt-in params appended to `params[]`
      (abiOrder baseline updated; defaults 0, guarded off): **Camera drift**
      (exact off-axis unwrap: `|q·z + cam| = 1` solved per fragment, so the
      near wall leans in while the vanishing point holds — tested: wall at
      radius 1 for every q/cam, pinhole depth at cam 0), **Lamps** (ceiling
      fixtures at travel stations, pool + bulb, before the fog), **Dust**
      (three shells inside the bore, one hashed mote per (angle, travel)
      cell drawn at its exact projection, radial metric stretched by cruise
      rate → streaks at speed), plus **Roll** (signed slider, camera turns
      about the axis on `u.time`, gated by the Rotation master) and the
      **Detail** master wired to flute/ring counts (`select()` guard keeps
      the authored counts bit-exact at 1 — the Global motion page used to
      offer the tunnel only Pulse). New **Metro** style; Hyperdrive `dust 0.7`,
      Waterslide `sway 0.35`, Vector Grid speed 0.45 → 0.5 (it restated the
      new default). Verified on screen in the browser dev build (Metro,
      Hyperdrive, Waterslide, Ice Cave, Vector Grid, Honeycomb, Ember;
      paused frame pairs at 6.0 / 6.3 s show rings and motes streaming
      outward).
- [x] **Shader prelude ABI** — `Uniforms` grows `travel`/`beatCount`
      (bytes 144/148, `UNIFORM_SIZE` 160); `demoFeatures` carries a mild
      monotonic travel deviation so the matrix exercises the blend;
      `docs/presets.md` documents both uniforms, `beatRide()` and
      `hueRotate()`. shaderGolden + gpuMatrix census snapshots re-blessed
      (`tunnel-rings/style/metro` added). **GPU matrix re-blessed
      2026-10-11:** `npm run test:gpu` first (case drift: the added Metro
      id), then `test:gpu:update` and a diff of the new baseline against
      git — 350 → 351 cases, **exactly 19 moved, all `tunnel-rings/*`**
      (defaults, 15 styles, both colour cases, `extreme/max`), 1 added,
      0 missing; `tunnel-rings/extreme/min` and every other mode's case
      kept its hash — the new uniforms and prelude helpers are inert
      outside the one mode that reads them.

## Done 2026-10-10 — "do everything still open" pass (owner-initiated)

**Shipped as v2.112.0 "Lyrics on time" on 2026-10-11** (CI green, published
latest, signature present, SHA256SUMS match). Owner-manual after the in-app
update: ALIGN-002 `DisplayVersion` = 2.112.0 after one ordinary relaunch, then
A1 (regenerate lyrics first).

Owner asked for every open row, test and nearby defect to be finished, with
"requires the owner" notes treated as possibly stale. Gates: web set green
(typecheck, lint, format, 3,233 vitest tests, build); Rust set green (fmt, clippy
`-D warnings`, `cargo test --workspace`; on this machine with `-j 1`, see
the environment note below).

- [x] **Lyrics: first words lit seconds early; sung lines run together.**
      Found by the new `scripts/lyrics-timing-probe.mjs` (A1's measurable
      half). whisper.cpp token times are spread across a segment, not
      measured, so a segment opening on an intro put its first words in the
      intro and the per-line alignment window never held the voice (3.7 s
      early). Now the sidecar aligns each whole whisper segment and cuts lines
      at the singer's real pauses (`stage_segments` → `align_segments` →
      `split_aligned` → `finish` in lines.rs/align.rs): a long gap always, a
      0.6 s gap the VAD confirms, a breath near the middle of an over-long
      line; a lone word rejoins the line it belongs to; the trailing
      alignment pad stops at the next segment (it let "rain" grab the 'N' of
      the next "Nothing"). Probe: 54/54 words, median 0.04 s, worst 0.15 s,
      8 clean lines; Star-Spangled Banner solo → exactly its 8 lines; "Over
      There" (1917) → its real lines. 60 sidecar unit tests.
- [x] **Lyrics generation failed late on a PC short of memory.** The sidecar
      held the isolation session (~2 GB) while whisper loaded; whisper died on
      `GGML_ASSERT(buffer)` after the long isolation stage. Session and
      decoded mix are now dropped first (shipped 2.111.0 sidecar fails both
      real songs on this machine; the new one completes them). A remaining
      out-of-memory now reads as plain words (`describeLyricsFailure`).
- [x] **Export dialog shows time left** (finishes the HD-24 loose end:
      `avgSpeed` was computed "for ETA math" and never shown) — `etaLabel`
      in speedMeter.ts, silent before 5 %, tests in both files.
- [x] **Device checks closed:** HD-18 + HD-19 (`midi-e2e.mjs` legs 7–8 over
      loopMIDI), HD-13 (`gallery-e2e.mjs` incl. 5b), TESTING.md D3
      (new `scripts/dock-device-pass.mjs`, 23 checks green — the letterbox
      item was superseded by the full-bleed stage; the probe asserts the
      current contract). HD-08 and HD-17 legs added to `lyrics-e2e.mjs`
      (Cancel during a real re-align; Verify through the store + Remove), run
      green 2026-10-11: see below.
- [x] **Run `npm run test:lyrics:quick` after a reboot.** PASSED 2026-10-11
      after a reboot (non-paged pool back to 0.57 GB): every leg OK —
      download/cancel/resume/verify, generation (9 lines, 79 words timed),
      editor leg incl. real re-align, **re-align Cancel (HD-08) stopped in
      1.3 s with lines untouched**, mid-run cancel, **store Verify + Remove
      (HD-17)**; exit 0. Before the reboot it was tried twice: it
      passed download/cancel/resume/verify, then died in generation on memory
      (DirectML 8007000E once, whisper aborting while loading the audio once) — this machine's
      non-paged kernel pool sat at ~6.8 GB (a driver leak; candidates: the
      Avira Security / Phantom VPN drivers installed 2026-09-23), leaving
      ~2 GB of commit for the debug app plus the sidecar. Not a Beatform
      defect; the same leg passed before the leak.
- [x] **Pre-release device set for 2.112.0** (2026-10-11): `test:gpu` 350
      cases, 0 raw hash deltas; `test:loopback:built` and `:30` green (the
      30 fps leg failed twice only because a YouTube tab was playing — the
      harness's own "idle baseline was not silent" note; green once paused).
- [x] **Full `npm run test:lyrics` lost its dense-mix song** — FIXED
      2026-10-11. `Muse - Madness.flac` vanished from the old
      `claude-cache/beatform/bf-test/media/` layout. The leg now uses Green
      Day - American Idiot from the owner's library, kept in a KEEP folder
      (`shared-cache\Beatform\artifacts\lyrics-fixtures\`, README there),
      and it gained a GATE: generated line starts against the song's real
      synced `.lrc` (`compareWithReference`): ≥ 40 % of real lines found,
      median ≤ 0.75 s, no line > 1.5 s off. The owner's first pick
      (Linkin Park - Numb.mp3) is a mislabelled file — 0/28 lines found; a
      whisper screen of five candidates scored it 22 % vs 80-94 % for real
      ones. Flag renamed `--skip-dense` (`--skip-madness` still works).
- [x] **Lyrics: a line lit up 3 s early after a held note** — FIXED
      2026-10-11, found by that gate. Whisper started the "Welcome to…"
      segment at 28.0 s, inside the previous line's held last note (voice
      to 28.6 s, silence, next line from 30.8 s); aligned alone, the
      segment matched its first two words to the held note (−3.16 s). Now a
      segment whose start sits inside continuous voice aligns BEHIND its
      predecessor's text and keeps only its own words (`needs_context` in
      align.rs). Pairs, not chains: the first version joined neighbours into
      chains, hit the 35 s window cap at exactly this boundary and changed
      nothing — whisper cuts dense vocals every 8-10 s, nearly all inside
      voice. Result: that line −3.16 → +0.74 s; song median 0.41 s, worst
      0.74 s (deterministic over two runs). Synthetic probe unchanged
      (median 41 ms, worst 154 ms). Two red-first tests, four mutants
      caught. Gates: web + Rust sets, `test:lyrics` (full, gate live) and
      `test:lyrics:quick`. **Shipped as v2.112.1 "Lyrics stay on the beat"
      on 2026-10-11** (CI green, published latest, signature present,
      SHA256SUMS match). A1 should run on 2.112.1, lyrics regenerated.

## Done 2026-10-09 — beat-sync audit (owner-initiated; owner picked "fix all three")

Owner report: visuals felt less on-beat / less immersive than YouTube
visualizers. Measured with a synthetic song at four mastering levels and ten
real tracks from the owner's test library (hardstyle, EDM, reggae, hip hop).
Onset **timing was never the problem** (pulses land within ±7 ms of the
transient, pinned by `syncLatency.test.ts`). Three findings, two fixed, one
declared:

- [x] **Band levels pinned at 1.0.** `bandMean` on the −90..−22 dBFS sync
      scale ×1.6 saturated on any real bass: ten real songs read `drive`
      (default Kicks mode) at 1.00 for 95%+ of frames, bass p5 0.9–1.0. Fixed
      with a per-band adaptive peak reference (`BandLevel` in
      `featurePipeline.ts`: mean dB over the band, peak hold releasing
      4 dB/s, floor −50 dB, amplitude-like curve 10^(Δ·0.03), instant attack,
      12/s release). After: `drive` p5 0.10–0.57, p95 0.82–0.97 on the same
      songs. Detectors (flux on `mag`) untouched → beat frames in the golden
      trace identical; only the bass/mid/treble/drive columns of
      `offlineSource.test.ts.snap` moved (re-blessed with that check). GPU
      pixel matrix unaffected (renders `demoFeatures`, not the pipeline).
- [x] **Live preview pulses led the ear.** Tap-derived features were
      presented at graph-head time while the grid was latency-compensated —
      a kick flashed `outputLatency − one frame` (≈50 ms on the reference
      machine) before it was audible, and `max(driveBeat, gridPulse)` smeared
      into two pulses. `RealtimeAnalyzer.present()` now serves tap-derived
      fields from a 64-entry snapshot ring delayed by the loop's presentation
      lag (`latency − DISPLAY_LEAD + avOffset`), time-derived fields live.
      New **Preferences ▸ Performance ▸ Visual timing offset** (−250..250 ms,
      `prefs.avOffsetMs`) for latency the browser cannot report (Bluetooth).
      Preview-only; exports never take the path. Tests: ring semantics in
      `realtimeSource.test.ts`, loop arithmetic in `services.test.ts`.
- **DECLARED — onset detectors not retuned.** The synthetic song showed
  ~50% off-beat fires (a re-fire ~140 ms after kicks over a sustained
  sub, chance fires on stationary noise). On real songs those fires are
  REAL events: scored against the beat grid with eighth-note positions,
  ±100 ms, the kick detector reads recall 81% / precision 92%. Ten
  threshold variants (echo gate, σ term, median, rising edge, higher
  multiplier, unclamped flux scale) were simulated on the ten songs and
  none improved F1 (best 0.598 vs 0.585 current; the σ variant lost
  recall 67→44%). No change without a measured win. Probe scripts kept in
  the session scratchpad, not the repo.

## Done 2026-09-02 (in the working tree; ships as v2.109.0 on the owner's go)

- CI on `main` back to green locally: prettier drift on six agent-config files
  from the docs-compaction commit; `npm audit fix` cleared the browserslist
  high (dev-only transitive dependency, lockfile only).
- Checkout repaired: `node_modules` installed; the `dist` and
  `src-tauri/target` junctions' targets on the devstorage drive had been
  janitor-evicted — recreated (routing logged).
- Hardening rows closed: `release.mjs` idempotent commit/tag + stale-run-proof
  watch with a Node-tested helper module; `batchScanning` aggregated counter
  (R2-31f); fps-cap + paused vitest pin; live-input async-setup window test —
  which found and fixed a real defect: `AudioEngine.startLiveInput` stopped the
  source before its first await without emitting, so the transport showed
  "playing" over silence for the worklet load (permanently if the load
  threw); it now emits like `pause()` (src/audio/engine.ts);
  parserFuzz 30 s describe budgets; `buildExportOptions` test now asserts all
  39 option keys with a compiler-enforced key list; Overgrowth virgin-branch
  comment (TS header, snapshot untouched); H15 CSS header no longer claims
  "FROZEN, UNIMPLEMENTED" for a shipped block.
- Docs truth sweep (EXPORT-DESIGN numbers, SECURITY inventory, README tree,
  GIF/WebP in the docs index, drop-import of `.bfpreset`/`.bfbuilder`,
  installer size, GATES §3/§5 edges, plan excluded from the public site) —
  see the session report for the per-item record.
- **Dependabot #29 (cpal 0.18.1 → 0.18.2) would have killed live capture** —
  caught by `npm run test:loopback:built` in this lane ("known tone did not
  reach analyzer … native delivery covered 0.00 s"), never shipped. cpal 0.18.2
  reports a WASAPI capture data discontinuity (routine on a loopback tap each
  time the render endpoint wakes) as `ErrorKind::Xrun`, and loopback.rs ended
  the session on any stream error. Fix: `stream_error_ends_capture` classifies
  — Xrun continues, everything else still marks the session dead — with a unit
  test; both loopback smokes re-run green after the rebuild.
- Ledgers: this file reset; archives written; TESTING.md reset to the v3
  batch; CLAUDE.md v3 rule rewritten; owner notes doc FEAT-003 → HISTORY;
  memory + RECALL updated (card #106 supersedes #105; #77/#100 deprecated).

## Trigger-gated (activate on the named trigger, not before)

| Row                                                                                                            | Trigger                                     |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Spout output (share live visuals to Resolume/OBS on-machine)                                                   | A real user with a real rig asks            |
| NDI output (live visuals over LAN)                                                                             | Same                                        |
| macOS / Linux ports (Tauri supports them; WASAPI loopback, registry heal, job objects are Windows-bound today) | Genuine demand — issues/users               |
| Lyrics streaming rework (whole-decode memory ceiling → 90-min limit stands)                                    | A user actually hits the limit meaningfully |
| DSP-001 — DC-offset waveform/trigger behavior                                                                  | A reproducible report                       |
| DSP-002 — Short analyzer history after seek                                                                    | A reproducible report                       |
| Multi-format fan-out per batch track (`formats[]` exists in the model, `startBatch` always passes one)         | A user asks for it                          |

## Known limitations (by-design verdicts — do not "fix" without an owner decision)

- **VIS-001** — Aurora's mirrored hue spread is folded into the mode's
  identity (owner verdict 2026-08-16; Ember Veil is the registry's showcase
  of it).
- **DSP-001 / DSP-002** — see trigger table; recorded behavior, not defects,
  until a report proves user harm.
- **Feedback modes after a live seek** — preview keeps pre-seek history
  (finite for Spectro Falls, indefinite for Overgrowth); exports always
  replay from clip start. Documented in docs/PREVIEW-EXPORT-CONTRACT.md.
- **Batch renders carry no lyrics** — Lyric Stage degrades to its rehearsal
  in batch output (recorded 2.101.0).
- **Builder↔Builder crossfade with two different stacks** is unrepresentable
  (one shared buffer); the active frame's stack wins (services.ts).
- DECLARE verdicts from the half-done inventory are appended here as they
  land, each with the doc location where the user meets the limit.

## Cleared-work pointer

Everything shipped through **v2.108.0** (2026-08-21) — the 2026-08 quality
program, audit rounds 1 and 2, FEAT-004/005/009, P-1…P-21, the hardening
waves — is recorded with evidence in
[archive/ledgers/](archive/ledgers/README.md).
