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
housekeeping → owner verdict round → v2.110.0 (+ v2.111.0 if HD-06 is FINISH)
→ owner checks A1/A2 → 3.0.0 docs/version-only diff after a full device
battery. The tag waits for the owner's explicit go.

## Owner-pending (only the owner can close these)

- [ ] **Verdict round** — one word per HD row below: _finish_ / _remove_ /
      _declare_, or "take the recommendations". Nothing in v2.110.0 starts
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

- [ ] **HD-01 Batch export silently ignores the export panel's format.**
      `startBatch` hardcodes `format: "mp4"` (src/state/slices/batchActions.ts:210)
      and never reads `settings.format` — pick PNG sequence, ProRes, AV1 10-bit,
      GIF or WebP, queue a batch, get MP4s with no notice. Deep-color follows
      format, so it is dropped too. Recommended: **FINISH-lite** — refuse the
      unsupported formats up front with a notice and label the batch panel
      "MP4 / WebM" (S); full lane parity for the sidecar formats is M.
      Verdict: \_\_\_
- [ ] **HD-02 Batch ignores Canvas-loop mode** (`settings.mode` never read;
      no segment, no loop crossfade, wrong size). Recommended: **FINISH-lite**
      — refuse canvas mode in batch with a notice (fold into HD-01) (S).
      Verdict: \_\_\_
- [ ] **HD-03 Batch drops stems and vocal spans** — `TrackInput` carries
      neither, so stem routes and the "Vocals (lyrics)" mod source read 0 in
      batch output while the interactive export honours them (same class as
      R2-05, one layer up). Recommended: **FINISH** — pass both through like
      sections/audiogram (S). Verdict: \_\_\_
- [ ] **HD-14 The A-B loop region cannot be exported** — `segment` is set only
      in canvas mode (src/state/slices/exportActions.ts:230); the loop is a
      preview-only tool. Recommended: **DECLARE** in the guide next to the A-B
      keys (S); an "Export loop region" checkbox would be M. Verdict: \_\_\_
- [ ] **HD-24 Batch progress shows only instantaneous fps** (no average
      speed) and classifies errors without the single-export lane's
      translation + scratch re-measure + ffmpeg log tail. Recommended:
      **FINISH** — reuse the single lane's helpers (S). Verdict: \_\_\_

### Rendering and modes

- [ ] **HD-06 Nine of twenty modes lack the global Saturation + Lightness
      pair** the other eleven treat as standard (oscilloscope, tunnel-rings,
      nebula, metaballs, voice-orb, echo-trails, aurora, synthwave, Builder) —
      and exactly those nine have no `color/grayscale` pixel case. The most
      visible inconsistency in the mode strip. Recommended: **FINISH** as its
      own release v2.111.0 (L — nine shaders through `presetColor`, styles
      re-checked, GPU matrix re-bless with per-mode visual proof), else
      **DECLARE** in the guide (S). Verdict: \_\_\_
- [ ] **HD-07 The second-display window inherits the operator's fps cap.**
      Cap-skipped tickless frames return before `publishPerformFrame`
      (src/state/services.ts:452) and ticked capped frames publish
      `advance-only`, which the receiver never presents
      (src/perform/performRuntime.ts:127). A battery knob throttles the
      audience. Recommended: **FINISH** — publish and present the mirror
      regardless of the preview cap (S/M; verify on the real second display).
      Verdict: \_\_\_
- [ ] **HD-09 Automation lanes on toggle/enum parameters interpolate
      linearly** — the lane picker offers every param, but `addKeyframe`
      defaults `curve: "linear"` (src/state/timeline.ts:31,140), so a bool or
      enum lane yields fractional values between keys. Recommended:
      **FINISH** — default `hold` for non-numeric params and snap their lane
      values (S). Verdict: \_\_\_
- [ ] **HD-15 Three analysis fields are computed every frame and consumed by
      nothing** — `beatIndex`, `barIndex`, `chroma` (P-15 "reactivity fuel",
      src/audio/types.ts:83, "per-mode adoption is a later wave"); `vocal` and
      `sectionPulse` from the same batch ARE routable mod sources.
      Recommended: **DECLARE** — reword the comment to state exactly which
      fields have consumers and that the rest are an internal contract with
      measured cost (S); **REMOVE** the three would also be S. Verdict: \_\_\_
- [ ] **HD-23 Canvas2D fallback is one generic look and unreachable on
      healthy hardware** — no toggle forces it; only a real GPU loss reaches
      it; no pixel baseline. PREVIEW-EXPORT-CONTRACT already scopes it.
      Recommended: **DECLARE** (already documented; 0). Verdict: \_\_\_

### Live performance and MIDI

- [ ] **HD-18 MIDI must be re-enabled by hand on every launch.** Bindings
      persist (`LS_MIDI`, src/state/persistence.ts:612); `midiEnabled` is
      session-only and nothing re-enables at boot, so saved bindings do
      nothing until the user clicks Enable. Recommended: **FINISH** — persist
      the enable flag and re-enable on boot (permission is granted Rust-side)
      (S). Verdict: \_\_\_
- [ ] **HD-19 MIDI can bind only knob→param and note→mode.** Blackout,
      play/pause, Stage, next/previous mode, volume and A-B keys — the Perform
      drawer's own controls — have no MIDI target (src/state/midi.ts:35); the
      drawer arms note-learn only, CC-learn lives on Visuals ▸ Live; CC learn
      is limited to the active mode's mod-targetable params (no Global motion,
      Post, volume). Recommended: **FINISH the VJ core** — blackout,
      play/pause, next/prev mode as note targets, CC-learn from the drawer
      (M) — and **DECLARE** the rest (S). Verdict: \_\_\_
- [ ] **HD-16 `loopback_died` is never polled.** The Rust command exists
      (src-tauri/src/loopback.rs:348, registered) and its doc says the
      frontend polls it to drop the "listening" indicator; no TS call site
      exists. A dead capture device leaves the broadcast icon lit over
      silence. Recommended: **FINISH** — poll or event it into the live-input
      state (S). Verdict: \_\_\_

### Lyrics

- [ ] **HD-17 Lyrics model manager can download but never verify or
      remove.** `lyrics_model_verify` / `lyrics_model_remove` exist in Rust
      and as TS wrappers (src/state/platform.ts:302,307); no button calls
      either — multi-GB models cannot be reclaimed from inside the app.
      Recommended: **FINISH** — Verify and Remove actions in LyricsGenPanel
      (S/M). Verdict: \_\_\_
- [ ] **HD-08 Line re-align has no cancel and no progress.** Transcribe has a
      stage-weighted bar, ETA and cancel; re-align sets
      `lyricsRealign: { index }` and offers nothing else
      (src/state/slices/lyricsEditActions.ts:231). Recommended: **FINISH** —
      cancel + indeterminate progress (M). Verdict: \_\_\_
- [ ] **HD-11 `.srt` is read-only** — imports, drop-imports, but export always
      writes `.lrc`. Recommended: **DECLARE** in the guide ("LRC is the
      output format; SRT imports are converted") (S). Verdict: \_\_\_
- [ ] **HD-20 The lyrics editor's Ctrl+Z / Ctrl+Y** (src/ui/LyricsEditPanel.tsx:335)
      appear in no shortcut sheet and no help prose; the coverage test scans
      only `useAppShortcuts.ts`. Recommended: **FINISH** — one sheet row (S).
      Verdict: \_\_\_

### Files, import, Gallery, Shadertoy

- [ ] **HD-10 `.bftheme` imports only by drag-and-drop** — export has a native
      dialog (src/state/slices/projectIOActions.ts:76); import has no dialog,
      no button, no file input. Recommended: **FINISH** — "Import theme…" via
      the existing dialog helper next to the export (S). Verdict: \_\_\_
- [ ] **HD-13 Gallery: an updated upstream entry reads "Already in My Looks"
      forever** (`entryGate` compares only `minAppVersion`/`savedWith`, never
      the entry's hash against the installed copy), and removal lives on a
      different surface than install with no label on the card. Recommended:
      **FINISH** hash-aware gate (S/M) + **DECLARE** the removal location on
      the card (S). Verdict: \_\_\_
- [ ] **HD-12 Shadertoy import never warns.** `iChannel1-3` bind an empty
      texture, so shaders that sample them compile and silently render black
      there; multi-pass (Buffer A-D / Common) is not detected; the transpiler
      has no warning channel at all (src-tauri/src/shadertoy.rs,
      src/ui/ShadertoyImport.tsx:150). Recommended: **FINISH** — detect
      `iChannel1-3` and buffer references, surface warnings in the dialog for
      the shader actually pasted (M). Verdict: \_\_\_

### Performance display

- [ ] **HD-05 The GPU % stat can be enabled but never shows a value.**
      Toggle (src/ui/SettingsDialog.tsx:56) → overlay row
      (src/ui/PerfOverlay.tsx:204) → Rust field (src-tauri/src/perfstats.rs:85)
      is fully wired with no collector; it renders "—" forever. Recommended:
      **REMOVE** the toggle, row and field (S; Rust gates). Implementing a PDH
      GPU-engine collector would be M. Verdict: \_\_\_

### Code that promises a second consumer

- [ ] **HD-21 Dead or duplicated helpers.** `isExporting`
      (src/state/store.ts:3415) is documented as the Escape/close guard but
      `useAppShortcuts.ts:86` re-implements it inline and differently
      (divergence risk); `saveBinaryFile` (platform.ts:57) has zero callers;
      `getPerformBridgeStats`, `isBindableMessage`, `LED_MATRIX_HUE_KEYS` are
      test-only exports whose production callers re-implement the logic; 14
      more module-local exports have no importer. Recommended: **FINISH** —
      route the callers through the one helper, delete the rest (S).
      Verdict: \_\_\_

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
