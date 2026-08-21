# BACKLOG — the live work ledger

This is the canonical ledger (per CLAUDE.md): read it before feature work,
update it when finishing. It was reset on **2026-08-20** after the
quality-consolidation program completed (2.99.0 → 2.104.2 shipped the last of
it). The full 5k-line history — every DONE record, evidence trail, dismissed
finding and design decision through v2.104.2 — is preserved verbatim at
**[archive/ledgers/](archive/ledgers/)**. Consult it for context; never reopen
rows from it. User-facing history lives in CHANGELOG.md; process memory in the
agents' memory stores.

Rules unchanged: never rename a persisted ID without a migration; new modes
follow the registry + grid + matrix re-bless discipline; GATES.md is canonical
for what "done" means; quality over speed.

## Owner-pending (only the owner can close these)

- [ ] **FEAT-004 word-timing verdict** — the cold-boot retest's subjective
      half: watch Lyric Stage's karaoke fill on a known song, say whether the
      timing feels right. (Instrumented half PASSED 2026-08-19: cold
      generation 2:45, honest ETAs, RTF learning persists — archive has the
      full record.) Guide: the repo's sibling directory
      `..\AI text stuff\beatform-owner-board-2026-08-20.md`
      (`C:\Users\Julius\source\repos\AI text stuff\`).
- [ ] **FEAT-009 eyes-only legs** — subjective sharpness/smoothness on the
      real second display, ~5 min stability impression, and the HDMI hotplug
      yank/replug. (All programmatic legs PASSED 2026-08-19 on real mixed-DPI
      hardware.)
- [ ] **Launch kit** — README hero pick, [SLOT] fills, [VERIFY] flag checks,
      the 3 screen-recording animateds, and posting (exclusively the owner's
      action). Kit: `OneDrive\Documents\doc\beatform-launch-kit\`.
- [x] **Fresh-session unbiased audit** — EXECUTED 2026-08-21 (owner-triggered
      ahead of the play session): nine-domain fresh-eyes audit against source,
      tests, git, device (debug shell drive + measurements) and the published
      releases. Findings filed below in "Audit round 2"; dismissals recorded
      with reasons. The play session itself remains open.

## Audit round 2 (2026-08-21) — findings ledger

Nine-domain unbiased audit (correctness ×2, determinism, export, security,
docs, tests, ledger/memory, performance) + main-thread device drive of the
debug shell (same code as v2.104.2). Every row carries evidence and a reaching
scenario; suspicions that failed to produce one are under "Dismissed". Fix
verdicts pending the owner's Phase-2 round; nothing below is started.

### P1 — serious, user-reaching

- [ ] **R2-01 ProRes 4444 exports BT.601, untagged** — `prores_args()`
      (src-tauri/src/prores.rs:145-177) passes none of the four color flags the
      AV1 lane sets; measured on the shipped ffmpeg: red encodes Y′=0.3002
      (≈601), stream reads `yuva444p12le(tv)` with no tags. NLEs assume 709 for
      HD → every ProRes export decodes with ~10% green shift + channel clipping
      on saturated content. Scenario: any ProRes export dropped into
      Resolve/Premiere next to the same project's AV1/MP4 export.
- [ ] **R2-02 Export cancel/failure can delete the user's previous file** — no
      temp-then-rename on the JS lanes: videoExporter.ts:214 opens the picked
      path `truncate:true` before anything encodes; `discard()` removes it on
      cancel/failure. Scenario: re-export over yesterday's song.mp4, cancel at
      10% (or codec refuses at frame 0) → old file gone. PNG-sequence variant
      included.
- [ ] **R2-03 Perform window freezes the last lyric caption / audiogram** —
      receiver overlay dedupe key omits lyric/audiogram state
      (src/perform/performRuntime.ts:406-441); once dynamics stop, nothing
      pushes a clean overlay (main window heals via refreshOverlay, receiver
      has no equivalent). Scenario: live show, toggle captions off mid-set →
      audience projector keeps the stale line indefinitely.
- [ ] **R2-04 Batch "Retry failed" double-activation runs two batches into the
      same files** — retryFailedBatch (src/state/slices/batchActions.ts:255-307)
      takes no synchronous claim; `batchStatus` flips only after an awaited
      readDir. Scenario: double-click "Retry N failed" → two concurrent export
      loops on identical outPaths, cancel reaches only one.
- [ ] **R2-05 Batch export lane drops `sections` and `audiogram`** —
      batchRunner.ts:204-266 discards the sections analyzeTrack returns and
      never passes document audiogram; the interactive lane passes both
      (exportActions.ts:520,531). Scenario: sectionPulse modulation route or
      audiogram enabled → batch output differs from interactive output of the
      same document, silently. Violates the one-document-one-render law across
      lanes.
- [ ] **R2-06 Determinism chokepoint guard hole: crossfade prev-side automation
      merge unguarded** — deleting `{ ...pParams, ...frame.automation }`
      (src/state/frameResolve.ts:105-109) survives the FULL 2872-test suite
      (mutation-proven). Scenario for the guarded regression: automation lane
      live during any scene crossfade — outgoing side renders stale params and
      no gate catches it.
- [ ] **R2-07 README claims the second-display output window is "still to
      come"** — it shipped in v2.104.0 (perform_window.rs, D drawer);
      README:256-258 roadmap + missing Features bullet. Scenario: a user
      evaluating from README concludes the flagship live feature doesn't exist.
- [ ] **R2-08 `Math.hypot` is ~70% of every FFT call** — fft.ts:178; measured
      537 µs → ~165 µs per 4096-pt call with `Math.sqrt(a*a+b*b)` (43× on the
      hot instruction). Runs once per rAF on the UI thread + per export tick;
      "precise" display spectrum pays 2.81 ms/frame. Scenario: high-refresh
      panels and every export pay ~17% of a core for nothing. Fix is one
      expression; requires golden-trace + GPU-matrix re-bless discipline
      (last-ulp shifts).

### P2

- [ ] **R2-09 Killed app leaves truncated media at the destination** — JS lanes
      have no destroy-cleanup (sidecar lanes do: lib.rs:276-288) and no
      "export running" close guard. Scenario: close mid-MP4-export → partial
      file sits next to user files looking real.
- [ ] **R2-10 Cancel is inert during sidecar finalize** —
      exportActions.ts:625-629 never calls `proresAbort` from the cancel
      signal; GIF does ALL encoding in finalize. Scenario: cancel a 3-min GIF
      at "100%" → runs minutes anyway (bounded only by the 20-min timeout).
- [ ] **R2-11 GIF cap counts frames, not bytes** — 5400-frame cap
      (exportActions.ts:441-446) permits a 4K GIF ≈179 GB ffmpeg working set →
      the OOM the cap exists to stop. Cap on frames×w×h.
- [ ] **R2-12 PNG sequence folder reuse mixes stale frames into new runs** —
      fixed `<name>_frames` dir, no pre-clean: a shorter re-export leaves the
      old tail (frame_003600+…) interleaved for the NLE to ingest silently.
- [ ] **R2-13 Batch runs skip the disk-space preflight** the single-export path
      has (exportActions.ts:314-361 vs none in batchActions) — the overnight
      surface is the one without the check.
- [ ] **R2-14 Export worker can pick a different GPU adapter than the preview** —
      powerPreference pref is not carried into the job; worker resolves
      "default" (webgpuRenderer.ts:2264-2270). Dual-GPU laptops: preview dGPU,
      export iGPU → same-machine pixel divergence.
- [ ] **R2-15 Hidden legacy `builder` preset has zero guard coverage** — kept
      renderable forever (presets/index.ts:72-82) but excluded from
      shaderGolden and all 314 matrix cases; its byte-identity promise is
      unguarded (mutation-adjacent: proven absent from both loops).
- [ ] **R2-16 GPU matrix blind spots + soft verdict** — matrix never exercises
      the feedback two-call shape, transitions, bg modes 1-4, overlays, or deep
      capture (gpuMatrix.ts:157-170,242); and it passes on raw hash deltas
      (fails only on 16×9-thumbnail tolerances) while GATES.md §3 tells the
      hash-delta re-bless story. The renderer's most intricate machinery has no
      device-pixel guard.
- [ ] **R2-17 `.bfbuilder` parse gate has zero tests** — version-gate mutant
      survived the full suite; a `>=` slip refuses every valid file
      (builder2.ts:441-459). Sibling formats all pin their gates.
- [ ] **R2-18 Escape after Stage mode closes and persists away the workspace** —
      the Esc cascade (useAppShortcuts.ts:55-85) also runs
      setShowPanel(false)/setShowLibrary(false)/setShowTimeline(false),
      contradicting the recorded P-1 rationale in store.ts:2846 ("leaving
      Stage must not cost the workspace"); prefs persist the loss across
      restarts.
- [ ] **R2-19 Queued quantized switch survives track loads / project opens /
      undo / track end** — pendingPresetId cleared in only 3 places; a stale
      switch fires at the next boundary of content it was never aimed at
      (mid-set surprise).
- [ ] **R2-20 Custom-shader delete: no confirm, undo cannot restore
      unreferenced defs** — ShaderEditor.tsx:253; history snapshots embed only
      referenced defs → a misclick permanently destroys WGSL while the undo
      toast implies otherwise.
- [ ] **R2-21 Lyrics re-align can attach word timings to a duplicate-text line
      at the same index** — guard is index+text (lyricsEditActions.ts:254-266);
      edits are not blocked during the sidecar run; choruses make collisions
      normal.
- [ ] **R2-22 Step-under-quantize double-press cancels instead of stepping** —
      stepPreset routes through queuePreset's cancel-on-same-target branch
      (store.ts:2043-2081); double-tap of `]` mid-set nets nothing pending.
- [ ] **R2-23 Undo groups two look/theme/style applications within 800 ms into
      one entry** — UNGROUPABLE (history.ts:34-49) lacks the three keys; A/B
      comparing two looks then Ctrl+Z jumps past both.
- [ ] **R2-24 NaN poisoning of width/LUFS is permanent for the session** — one
      non-finite sample in a float-PCM WAV → stereoWidth NaN → width EMA and
      the LUFS biquad/ring never recover (stereo.ts:6-21,
      featurePipeline.ts:734-737, lufs.ts:68-140); "Stereo width" is a stock
      mod source, so NaN reaches params/uniforms and persists across clean
      tracks until restart.
- [ ] **R2-25 fpsCap caps presentation, not DSP** — ana.update runs per rAF
      before the cap check (services.ts:434 vs 456-468); 144 Hz + cap 30 still
      pays ~99 ms/s of DSP for 30 presented frames. The battery knob barely
      touches the dominant cost.
- [ ] **R2-26 Autosave stringifies the full document (assets included,
      pretty-printed) on the UI thread** — store.ts:1456 → project.ts:192
      `JSON.stringify(file, null, 2)`; measured 3.3 ms/739 KB, linear ⇒
      150-250 ms hitches per autosave on embedded-video projects.
- [ ] **R2-27 Records drift (memory layer)** — five wrongs telling yesterday's
      story: roadmap-progress.md missing its 2.104.2 entry while MEMORY.md
      claims it; quality-consolidation card still "ACTIVE/paused" though the
      program completed; post-restart-battery card still reads armed though
      executed 2026-08-19; RECALL closeout instruction points at dead card #87
      with an op that can't work (live claim card #95, supersede-not-update);
      owner notes doc lists FEAT-004/FEAT-005 as "considering" though shipped
      (moves to HISTORY per its own contract). Plus: RECALL cards #92-94 are
      instruction-shaped diagnostic prompts stored as VALIDATED requirements
      and re-injected into sessions by the prompt hook — memory contamination;
      deprecate.
- [ ] **R2-28 Licensing/docs truth cluster** — THIRD_PARTY_LICENSES.md:
      "exclusively ProRes" false (same sidecar drives AV1 10-bit/GIF/WebP) and
      the direct-deps table omits 8 crates (count stale: 541);
      style/control counts stale on four surfaces ("6-14 styles" → 6-15,
      "~430 controls" → 559; CONTRIBUTING "5-7" contradicts the floor);
      README "every item in TESTING.md green" vs an explicit unchecked item +
      stale TESTING lines (v2.53 reference, VERIFY-002 "postponed" though
      passed, empty sign-off); CLAUDE.md's changelog mechanism claim wrong
      (dialog FETCHES from GitHub; local edits invisible to a running dev
      app); EXPORT-DESIGN.md still lists the shipped second display as "still
      open" and omits AV1 from the sidecar line.

### P3 (clusters; full detail in the audit reports)

- [ ] **R2-29 Security defense-in-depth (4)** — perform-window-reachable
      telemetry (`scratch_dir` leaks username path, `disk_space` is a mounted-
      volume oracle → add `assert_main_window`); gallery size check runs after
      full buffering (pre-check Content-Length); `style-src 'unsafe-inline'`;
      lofty parser surface (schedule cargo-audit cadence). No P0/P1 anywhere.
- [ ] **R2-30 Export delivery nits (10)** — AAC priming/Opus pre-skip
      unsignaled (~20-45 ms late audio; device-probe then edit-list fix);
      mediabunny WebM writes CodecDelay=0 / misuses SeekPreRoll (upstream bug —
      report it); VP9 fullCodecString unpinned (probe/encode drift); codecProbe
      AV1/VP9 level ladders under-declare; WebCodecs-lane 601/709 untagged
      (device-probe worthwhile given R2-01); PNG mode lacks the no-sink guard
      the deep lane has; canvas export of a <3 s track produces a
      Spotify-rejectable file without warning; canvas loop ships fragmented
      MP4 where progressive would be safer; full-track animated WebP is
      uncapped while libwebp_anim assembles in RAM (verify, then cap like
      GIF); ffmpeg death on the abort path deletes the log tail unread.
- [ ] **R2-31 Live/state nits (11)** — MIDI learn stays armed after its
      surfaces close; enable/disable MIDI race; quantized switch fires
      immediately on forward seek across a boundary; batch resume ETA uses the
      original startedAt; dropped .bfpreset/.bfbuilder files fall through to
      the audio decoder ("could not decode"); concurrent batch-add scans
      corrupt the scanning counter; lyrics tier download double-activation;
      three unguarded module-scope localStorage reads; perform cover-art
      fingerprint can length-collide; ShaderEditor chip-load replaces a dirty
      draft without the confirm its close path has; lyrics editor rows keyed
      by index.
- [ ] **R2-32 Audio/DSP nits (9)** — reset("source") keeps bpm/beatPhase (live
      sessions run the dead track's BPM for tempo-locked LFOs); gapless
      auto-advance skips the source reset (stale beat/section indices over the
      next track's opening); loop-toggle teleport fires one phantom onset;
      live is beat-blind 0.2 s after load while exports pre-roll warm (and the
      offline comment claims otherwise); envelope comments describe the render
      clock while code (correctly) uses the analysis clock; momentary LUFS
      under-reads ~400 ms after resume; oscilloscope span is
      sample-rate-dependent (96/192 kHz devices see 2-4× zoom); surround
      tracks: preview analyzes the full downmix, export only the front pair;
      loopback ring can wrap on multi-second render stalls (self-heals) +
      pre-priming inflates underrun stats. Cosmetics: dead `void prevUpdate`,
      loopback.rs 2× reserve, half-sample latency readout.
- [ ] **R2-33 Determinism contract docs (3)** — PREVIEW-EXPORT-CONTRACT
      overclaims "exactly" for feedback replay; canvas-loop audio crossfade
      feeding the analyzers is undocumented; the cross-frame-state carve-out
      names two modes but applies to Particle Flow and the other feedback
      modes.
- [ ] **R2-34 Test hygiene (3)** — parserFuzz describes lack the 30 s budgets;
      buildExportOptions test title promises "the full surface" but asserts
      ~18/35 fields; project.ts docblock still denies the theme-v14 threading
      that exists and is tested.
- [ ] **R2-35 Perf residuals (4)** — exportWorker bundle duplicates ~1.0 MB of
      codec+renderer stacks; boot graph eagerly parses the 511 KB codec stack
      (dynamic-import at three call sites would defer it); ~15-25 small
      allocations/frame against the loop's allocation-free doctrine
      (measured harmless); dB→linear round-trip costs ~50-166 µs/frame on
      detailed/precise displays. Undo snapshot 4.3 ms/push on a 120-scene doc
      (bounded, fine).
- [ ] **R2-36 Docs small (3)** — fetch-ffmpeg.mjs header names only ProRes;
      README format list omits aac/opus the library scanner accepts; GATES.md
      §3 cites "matrix 269/269" while the baseline holds 314 cases.
- [ ] **R2-37 Ledger small (4)** — "nine releases 2.99.0→2.104.2" is eight;
      MEMORY.md hardcodes `D:\beatform-archive` against its own probe-the-
      letter rule; pre-rename `audio-visualizer` devstorage paths linger in
      live memory guidance; BACKLOG's FEAT-004 guide pointer is ambiguous
      (file lives in the repo-sibling "AI text stuff" dir, not OneDrive).

### Dismissed (with reasons — the round's negative results)

- Perform-window Esc "dead" — refuted on device: direct `perform_escape`
  invoke from the output window resolves and closes it; the non-response was
  the harness's synthetic keydown, not the app.
- Default-mode-on-boot suspicion — profile persistence explains it; fresh
  profile boots Spectrum Bars (screenshot evidence).
- Prototype pollution via crafted preset/theme/project/shader files — every
  parser rebuilds clean objects; verified field-by-field (security agent).
- ffmpeg argv injection via paths/tags — structurally built argv, local-
  absolute output enforcement, pinned formats; UNC/TOCTOU/symlink paths all
  closed and test-pinned.
- Batch/PCM crossfade double-apply, watchdog false kills, A-B loop maths,
  autosave clobber races, zustand selector allocations, timeline drag
  stale-closures — all specifically hunted, all clean (agents' dismissed
  lists).
- 24/25 fps tick shimmer (no such fps offered), meter float drift (~4e-8),
  gate-reopen onset flash (real onset), decodeAudioData long-file ceiling
  (mediabunny fallback verified).

## Next hardening pass (agent-ready, not scheduled — small, non-blocking)

- [ ] Unit test for the fps-cap + paused interaction (the `advance-only`
      branch under `capSkipped` is device-proven but has no vitest pin —
      2.104.2 review noted it; both consumers read one shared boolean, so
      risk is low).
- [ ] Live-capture async-setup window test (`startLiveInput`: `playing` reads
      false during the worklet-load await — correct behavior, untested).
- [ ] Overgrowth mist seam sub-LSB inset (F4 nit, 2.103.0 review): fixed-UV
      inset under-insets below ~119 px canvas height; deterministic,
      below one 8-bit LSB, frozen into the blessed baseline — cosmetic only.
- [ ] Overgrowth present-only virgin-branch comment (F5 nit): one-line
      comment explaining why the un-dt-gated visTex-alpha write is harmless.
- [ ] Perform drawer: dedicated fullscreen MIDI-learn overlay (P-4's one
      not-built possible follow-up; the drawer shows mappings live instead).

## Trigger-gated (activate on the named trigger, not before)

| Row                                                                                                            | Trigger                                     |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Spout output (share live visuals to Resolume/OBS on-machine)                                                   | A real user with a real rig asks            |
| NDI output (live visuals over LAN)                                                                             | Same                                        |
| macOS / Linux ports (Tauri supports them; WASAPI loopback, registry heal, job objects are Windows-bound today) | Genuine demand — issues/users               |
| Lyrics streaming rework (whole-decode memory ceiling → 90-min limit stands)                                    | A user actually hits the limit meaningfully |
| DSP-001 — DC-offset waveform/trigger behavior                                                                  | A reproducible report                       |
| DSP-002 — Short analyzer history after seek                                                                    | A reproducible report                       |

## Known limitations (by-design verdicts — do not "fix" without an owner decision)

- **VIS-001** — Aurora's mirrored hue spread is folded into the mode's
  identity (owner verdict 2026-08-16; Ember Veil is the registry's showcase
  of it).
- **DSP-001 / DSP-002** — see trigger table; recorded behavior, not defects,
  until a report proves user harm.
- **Feedback modes after a live seek** — the preview keeps pre-seek history
  (finite for Spectro Falls, indefinite for Overgrowth); exports always
  replay from clip start. Documented in docs/PREVIEW-EXPORT-CONTRACT.md.
- **Batch renders carry no lyrics** — Lyric Stage degrades to its rehearsal
  in batch output (recorded 2.101.0).

## Cleared-work pointer

Everything shipped through **v2.104.2** (2026-08-19) — including the entire
2026-08 quality-consolidation program, the P-19 five-mode roster, FEAT-004/005/009,
P-1…P-21, Tracks A–F, and the hardening waves — is recorded with evidence in
[archive/ledgers/BACKLOG-through-v2.104.2.md](archive/ledgers/BACKLOG-through-v2.104.2.md)
and [archive/ledgers/PROPOSALS-2026-08-audit.md](archive/ledgers/PROPOSALS-2026-08-audit.md).
