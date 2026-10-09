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

- [ ] **ALIGN-002 regressed: the HKCU uninstall entry does not follow in-app
      updates.** After 2.108.0 → 2.110.0 → 2.111.0 through the in-app updater,
      `beatform.exe` reports ProductVersion 2.111.0 but
      `HKCU\...\Uninstall\*` DisplayVersion still reads **2.108.0** (checked
      after both updates). The NSIS `/UPDATE` path installs the files and
      skips (or fails to write) the uninstall registry values. Reproduce:
      install an older setup exe, update in-app, read DisplayVersion. Fix
      lives in the NSIS template / tauri bundler config, then re-verify per
      GATES.md §4. Size S–M.
- [x] **Updater error dialog showed no reason** — Tauri plugin commands
      reject with a plain string, `(e as Error).message` was `undefined`.
      Fixed on main (`errorText` in `src/state/updater.ts`, two tests). The
      live failure behind it was C: at 10 MB free: the updater writes the
      60 MB installer to `%TEMP%` first; freeing space fixed the update.

## Owner-pending (only the owner can close these)

- [ ] **Verdict round** — one word per HD row below: _finish_ / _remove_ /
      _declare_, or "take the recommendations". Nothing in v2.111.0 starts
      before this.
- [x] **Merge dependabot PRs** — DONE 2026-09-02 on the owner's go: #26
      (rust-cache action), #29 (lofty 0.25.1, cpal 0.18.2, naga 30.0.1) and
      #31 (the npm minor/patch group, 13 updates incl. mediabunny 1.55.4,
      vite 8.2.2, vitest 4.1.11, eslint 10.9.1; #30 was dependabot's earlier
      copy of the same group, closed by dependabot) squash-merged after CI.
- [ ] **A1 Lyric Stage word timing** (~3 min) — TESTING.md § A1. Closes
      FEAT-004.
- [ ] **A2 Second-display eyes + HDMI yank** (~5 min) — TESTING.md § A2.
      Closes FEAT-009.
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
      (S). Verdict: **FINISH** — closed 2026-09-03 (9c7daf8): `midiEnabled` lives in AppPrefs (additive boolean, validator defaults a missing key to false); `initApp` calls `restoreMidi()` quietly at boot; Enable sets the flag, Disable clears it. Prefs + midiActions tests. Device check pending: relaunch with MIDI left on and confirm it re-arms without a click.
- [x] **HD-19 MIDI can bind only knob→param and note→mode.** Blackout,
      play/pause, Stage, next/previous mode, volume and A-B keys — the Perform
      drawer's own controls — have no MIDI target (src/state/midi.ts:35); the
      drawer arms note-learn only, CC-learn lives on Visuals ▸ Live; CC learn
      is limited to the active mode's mod-targetable params (no Global motion,
      Post, volume). Recommended: **FINISH the VJ core** — blackout,
      play/pause, next/prev mode as note targets, CC-learn from the drawer
      (M) — and **DECLARE** the rest (S). Verdict: **FINISH core + DECLARE rest** — closed 2026-09-03 (9c7daf8): `CommandBinding` (blackout, playPause, nextMode, prevMode) dispatches the same store actions the keys take (`setBlackout` gated like the `0` key, `togglePlay`, `stepPreset` → beat-quantized queue); the Perform drawer carries a Pad picker with Learn note and a Knob picker with Learn CC over the active mode's mod targets; `validMidiBindings` round-trips the new kind and drops unknown commands. Guide MIDI text declares volume, A-B, Stage and Global/Post as keyboard-and-mouse only. Ledger claim corrected: the drawer never had play/pause or next/prev _buttons_ — the keys' store actions are the target. Device check pending: real controller pass (see the row's report).
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
      the card (S). Verdict: **FINISH + DECLARE** — closed 2026-09-03 (93fb127): `installedLookState` compares the registry's per-entry sha256 with the digest recorded at install; a changed entry reads "Update look" and installs over the old copy through the verified path. The install record moved from session-only to a validated localStorage map (`viz.galleryInstalled.v1`, additive; no file format touched) — which also fixed the Gallery forgetting every install after a restart. Installed cards say removal lives under Visuals ▸ Looks & themes. Ledger claim corrected: the gate compared `minAppVersion`/`schemaVersion` (no `savedWith` exists). Device check pending: `node scripts/gallery-e2e.mjs` step 5b (update path).
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
- [ ] GPU matrix: transitions are proven on one non-feedback pair
      (spectrum-bars ← radial-burst) and post/motion on two modes; add a
      feedback-mode pair and a Builder pair (re-bless with proof).
- [ ] `paramsTab` pref (src/state/prefs.ts:73) is frozen — validated,
      persisted and diffed, consumed only by its own migration to
      `visualsPage`. Drop it with a prefs migration + test, or leave with a
      one-line comment.
- [ ] Overgrowth mist seam sub-LSB inset (F4 nit): below one 8-bit LSB, frozen
      into the blessed baseline, cosmetic only — **parked** by decision.
- [ ] exportWorker bundle duplicates the codec+renderer stacks (~1.0 MB,
      lazy-loaded; disk-only cost) — **parked** by decision.
- [ ] mediabunny upstream: WebM CodecDelay=0 / SeekPreRoll misuse — issue text
      drafted in the archived audit reports; **posting is the owner's action**.
- [ ] Review nanos, recorded: toggleLoop's 1 ms jump detector can misfire on an
      AudioContext quantum tick; loopback worklet arms `delivered` on a
      zero-frame delivery (Rust never sends one); redo after
      shader-delete-undo does not re-delete (library merge semantics); Esc
      with Stage active AND a dialog open exits Stage first.

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
