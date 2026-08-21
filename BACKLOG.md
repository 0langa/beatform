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

- [x] **R2-01 ProRes 4444 exports BT.601, untagged** — `prores_args()`
      (src-tauri/src/prores.rs:145-177) passes none of the four color flags the
      AV1 lane sets; measured on the shipped ffmpeg: red encodes Y′=0.3002
      (≈601), stream reads `yuva444p12le(tv)` with no tags. NLEs assume 709 for
      HD → every ProRes export decodes with ~10% green shift + channel clipping
      on saturated content. Scenario: any ProRes export dropped into
      Resolve/Premiere next to the same project's AV1/MP4 export.
      **FIXED 2026-08-21 (a433242)**: prores_args carries av1's exact four
      flags; contract test updated. New gate `scripts/export-color-verify.mjs`
      (8fe9893, GATES.md §3 row) proves tag AND conversion on the bundled
      build: red now decodes Y′=0.2135 (bt709) vs the 0.3002 this row measured;
      the script's negative control reproduced the 0.3002 exactly.
- [x] **R2-02 Export cancel/failure can delete the user's previous file** — no
      temp-then-rename on the JS lanes: videoExporter.ts:214 opens the picked
      path `truncate:true` before anything encodes; `discard()` removes it on
      cancel/failure. Scenario: re-export over yesterday's song.mp4, cancel at
      10% (or codec refuses at frame 0) → old file gone. PNG-sequence variant
      included.
      **FIXED 2026-08-21 (c26f3f6 + b76dd9d)**: the stream writer stages
      `<target>.partial` and touches the target only via one close-time rename
      (MoveFileExW REPLACE_EXISTING through plugin-fs); discard removes only
      the temp, a failed rename removes the temp and surfaces. New
      `export_allow_partial` command (main-window-gated) extends the dialog's
      exact-file grant to the sibling. PNG variant closed by R2-12's
      collision-free folders (nothing pre-existing is ever written into); the
      buffered Canvas lane writes complete bytes once at the end (R2-30c).
- [x] **R2-03 Perform window freezes the last lyric caption / audiogram** —
      receiver overlay dedupe key omits lyric/audiogram state
      (src/perform/performRuntime.ts:406-441); once dynamics stop, nothing
      pushes a clean overlay (main window heals via refreshOverlay, receiver
      has no equivalent). Scenario: live show, toggle captions off mid-set →
      audience projector keeps the stale line indefinitely.
      **FIXED 2026-08-21, v2.107.0 (7b08fe4)**: dynamics-active bit in the receiver overlay key + a clean overlay push on the OFF transition, mirroring refreshOverlay; ON-flip re-retains. Test pins the exact transition.
- [x] **R2-04 Batch "Retry failed" double-activation runs two batches into the
      same files** — retryFailedBatch (src/state/slices/batchActions.ts:255-307)
      takes no synchronous claim; `batchStatus` flips only after an awaited
      readDir. Scenario: double-click "Retry N failed" → two concurrent export
      loops on identical outPaths, cancel reaches only one.
      **FIXED 2026-08-21 (565f084)**: retryFailedBatch takes startBatch's
      synchronous `batchStarting` claim before ANY await (the readDir and the
      R2-13 pre-flight), checks it in its own guard (retry and start now
      exclude each other), and releases it in an outer finally on every exit.
      Tests: two synchronous back-to-back calls launch exactly one run (red
      before: two); declined and throwing pre-flights both release the claim.
- [x] **R2-05 Batch export lane drops `sections` and `audiogram`** —
      batchRunner.ts:204-266 discards the sections analyzeTrack returns and
      never passes document audiogram; the interactive lane passes both
      (exportActions.ts:520,531). Scenario: sectionPulse modulation route or
      audiogram enabled → batch output differs from interactive output of the
      same document, silently. Violates the one-document-one-render law across
      lanes.
      **FIXED 2026-08-21 (affb4ae)**: TrackInput now carries the analysis
      `sections` and the frozen doc's audiogram (gated on audiogramActive
      exactly like the interactive lane); the 4096-bucket waveform overview
      moved into the shared `audiogram.waveformOverviewOf` so live and batch
      draw from one implementation, computed per decoded track. batchRunner
      suite pins the built job (sections, settings, per-track waveform,
      all-off → undefined).
- [x] **R2-06 Determinism chokepoint guard hole: crossfade prev-side automation
      merge unguarded** — deleting `{ ...pParams, ...frame.automation }`
      (src/state/frameResolve.ts:105-109) survives the FULL 2872-test suite
      (mutation-proven). Scenario for the guarded regression: automation lane
      live during any scene crossfade — outgoing side renders stale params and
      no gate catches it.
      **CLOSED 2026-08-21 (0d6fc3a)**: frameResolve.test.ts gains the
      mid-crossfade automation case asserting on `prev.params`.
      Mutation-verified: re-applying exactly that mutant fails only the new
      test ("expected 100 to be 42", 1 failed | 12 passed); restored, 13
      pass.
- [x] **R2-07 README claims the second-display output window is "still to
      come"** — it shipped in v2.104.0 (perform_window.rs, D drawer);
      README:256-258 roadmap + missing Features bullet. Scenario: a user
      evaluating from README concludes the flagship live feature doesn't exist.
      **FIXED 2026-08-21, wave 0 (be38754)**: README roadmap + a dedicated second-display/Perform-drawer features bullet.
- [ ] **R2-08 `Math.hypot` is ~70% of every FFT call** — fft.ts:178; measured
      537 µs → ~165 µs per 4096-pt call with `Math.sqrt(a*a+b*b)` (43× on the
      hot instruction). Runs once per rAF on the UI thread + per export tick;
      "precise" display spectrum pays 2.81 ms/frame. Scenario: high-refresh
      panels and every export pay ~17% of a core for nothing. Fix is one
      expression; requires golden-trace + GPU-matrix re-bless discipline
      (last-ulp shifts).

### P2

- [x] **R2-09 Killed app leaves truncated media at the destination** — JS lanes
      have no destroy-cleanup (sidecar lanes do: lib.rs:276-288) and no
      "export running" close guard. Scenario: close mid-MP4-export → partial
      file sits next to user files looking real.
      **FIXED 2026-08-21 (b1218c7, with c26f3f6)**: onCloseRequested asks
      ("An export is running — close anyway? The partial file will be
      removed.") while exporting/exportPreparing/batch is running; a confirmed
      close cancels both lanes and polls (bounded 2 s) for the teardown —
      which is the `.partial` discard — before the flush+destroy continues.
      And post-R2-02 the JS lanes' in-flight file IS a `.partial`, never the
      real name.
- [x] **R2-10 Cancel is inert during sidecar finalize** —
      exportActions.ts:625-629 never calls `proresAbort` from the cancel
      signal; GIF does ALL encoding in finalize. Scenario: cancel a 3-min GIF
      at "100%" → runs minutes anyway (bounded only by the 20-min timeout).
      **FIXED 2026-08-21 (7bbffcd)**: the finalize span (all four sidecar
      lanes) arms an abort→proresAbort listener — Rust tolerates
      abort-during-finalize by design — removed once finalize settles;
      exactly one abort per session, and the resulting cancel keeps showing
      nothing (AbortError rethrow).
- [x] **R2-11 GIF cap counts frames, not bytes** — 5400-frame cap
      (exportActions.ts:441-446) permits a 4K GIF ≈179 GB ffmpeg working set →
      the OOM the cap exists to stop. Cap on frames×w×h.
      **FIXED 2026-08-21 (66c4074)**: ANIM_PIXEL_BUDGET = 5400×1920×1080 px
      (exactly the old cap's 1080p implication), refusal names the
      per-resolution/fps limit and what to reduce; animated WebP is under the
      same cap (libwebp_anim assembles the whole animation in RAM — the old
      "WebP streams" comment was wrong).
- [x] **R2-12 PNG sequence folder reuse mixes stale frames into new runs** —
      fixed `<name>_frames` dir, no pre-clean: a shorter re-export leaves the
      old tail (frame_003600+…) interleaved for the NLE to ingest silently.
      **FIXED 2026-08-21 (b76dd9d)**: pickSequenceDir walks `_frames`, `-2`,
      `-3`, … past any non-empty existing folder (empty ones are reused,
      nothing pre-existing is ever deleted — destructive-op policy); the
      toast and Show-in-folder report the name that won.
- [x] **R2-13 Batch runs skip the disk-space preflight** the single-export path
      has (exportActions.ts:314-361 vs none in batchActions) — the overnight
      surface is the one without the check.
      **FIXED 2026-08-21 (a5b1986)**: startBatch sums per-job
      estimateExportBytes (new sumDiskNeeds) over the queued jobs and runs
      the identical warn-and-override askConfirm before flipping to running;
      silently skipped when diskSpace answers null (browser/unqueryable).
- [x] **R2-14 Export worker can pick a different GPU adapter than the preview** —
      powerPreference pref is not carried into the job; worker resolves
      "default" (webgpuRenderer.ts:2264-2270). Dual-GPU laptops: preview dGPU,
      export iGPU → same-machine pixel divergence.
      **FIXED 2026-08-21 (06f20e7)**: buildJob — the main-thread job assembly
      both lanes flow through, so batch inherits — always emits
      `powerPreference` into the ExportJob; the worker's
      WebGPURenderer.create takes the job's value and only the live path
      (which can see prefs) falls back. Tests pin the job field (including
      an explicit "default" — an absent key would re-blind the worker) and
      the create() argument; the segment-shift census classifies the field
      TIMELESS.
- [x] **R2-15 Hidden legacy `builder` preset has zero guard coverage** — kept
      renderable forever (presets/index.ts:72-82) but excluded from
      shaderGolden and all 314 matrix cases; its byte-identity promise is
      unguarded (mutation-adjacent: proven absent from both loops).
      **FIXED 2026-08-21 (5e79d2d), pending device bless**: shaderGolden
      iterates [...presets, builder] — WGSL accessors+body and param ABI
      snapshot-pinned, census updated (snapshot diff pure additions) — and
      the matrix enumerates `builder/@defaults`, appended at the run's end so
      no existing hash can move. The new case correctly fails a device run
      with the existing "matrix case drift" error until the orchestrator
      blesses on device; baseline JSON untouched here.
- [x] **R2-16 GPU matrix blind spots + soft verdict** — matrix never exercises
      the feedback two-call shape, transitions, bg modes 1-4, overlays, or deep
      capture (gpuMatrix.ts:157-170,242); and it passes on raw hash deltas
      (fails only on 16×9-thumbnail tolerances) while GATES.md §3 tells the
      hash-delta re-bless story. The renderer's most intricate machinery has no
      device-pixel guard.
      **FIXED 2026-08-21 (29c9fbc), pending device bless** (owner verdict:
      strict): any raw hash delta now FAILS — the comparison lives in
      scripts/gpu-pixel-verdict.mjs (pure, Node-tested), perceptual metrics
      demoted to per-failure diagnostics, `--update` the only bless path,
      GATES.md §3 rewritten. 17 deterministic cases appended after the
      existing sequence (6 + 7 + 3 + 1): feedback/export-walk for all six
      feedbackSample presets (the exportCore advance+present shape), all 7
      transition kinds frozen mid-fade on spectrum-bars/radial-burst, bg
      solid/transparent/image (synthesized gradient; video skipped — no
      deterministic fixture), deep/spectrum-bars via readbackDeepFrame +
      pure deepCaseMetrics. expectedMatrixCaseIds() locks enumeration
      (runner self-check + Node census: the 314 baseline ids reproduced in
      order + the 18 new ids — these 17 plus R2-15's builder/@defaults, the
      whole pending-bless set). Device run fails with case drift until the
      orchestrator blesses. Overlay cases remain uncovered (need a bitmap
      fixture — deliberately out of this pass).
- [x] **R2-17 `.bfbuilder` parse gate has zero tests** — version-gate mutant
      survived the full suite; a `>=` slip refuses every valid file
      (builder2.ts:441-459). Sibling formats all pin their gates.
      **CLOSED 2026-08-21 (c210b0e)**: builder2File.test.ts pins the gate
      matrix mirroring custom.test.ts — round-trip, non-JSON refused, wrong
      kind refused, current+1 refused with the newer-app message,
      exactly-current accepted, whitelist tolerance (junk dropped/clamped),
      missing stack → empty. Mutation-verified: `>` → `>=` fails the suite 4
      ways; restored, all 7 pass.
- [x] **R2-18 Escape after Stage mode closes and persists away the workspace** —
      the Esc cascade (useAppShortcuts.ts:55-85) also runs
      setShowPanel(false)/setShowLibrary(false)/setShowTimeline(false),
      contradicting the recorded P-1 rationale in store.ts:2846 ("leaving
      Stage must not cost the workspace"); prefs persist the loss across
      restarts.
      **FIXED 2026-08-21, v2.107.0 (fccf0b7)**: Esc inside Stage exits Stage only (also disarms MIDI learn first — review D3); the cascade is untouched outside Stage. Guide regenerated.
- [x] **R2-19 Queued quantized switch survives track loads / project opens /
      undo / track end** — pendingPresetId cleared in only 3 places; a stale
      switch fires at the next boundary of content it was never aimed at
      (mid-set surprise).
      **FIXED 2026-08-21, v2.107.0 (4b6a75b)**: pendingPresetId (and lastQuantizeTick) cleared via the invalidateAnalysis/applyDocument/onEnded chokepoints; three red-proven tests through the real initApp tick.
- [x] **R2-20 Custom-shader delete: no confirm, undo cannot restore
      unreferenced defs** — ShaderEditor.tsx:253; history snapshots embed only
      referenced defs → a misclick permanently destroys WGSL while the undo
      toast implies otherwise.
      **FIXED 2026-08-21, v2.107.0 (df4d3ca)**: delete behind askConfirm; history snapshots embed the doomed def so undo genuinely restores it (localStorage write-back pinned). Deleting also un-queues a pending switch to it (review O2, 70937bd).
- [x] **R2-21 Lyrics re-align can attach word timings to a duplicate-text line
      at the same index** — guard is index+text (lyricsEditActions.ts:254-266);
      edits are not blocked during the sidecar run; choruses make collisions
      normal.
      **FIXED 2026-08-21, v2.107.0 (c1523e1 + b2e4361)**: structural edits (split included) AND their undo/redo lock while the aligner runs; text edits stay live and correctly void the apply.
- [x] **R2-22 Step-under-quantize double-press cancels instead of stepping** —
      stepPreset routes through queuePreset's cancel-on-same-target branch
      (store.ts:2043-2081); double-tap of `]` mid-set nets nothing pending.
      **FIXED 2026-08-21, v2.107.0 (aa34200)**: step keys walk from the pending target (]] queues two ahead); chip cancel-toggle preserved.
- [x] **R2-23 Undo groups two look/theme/style applications within 800 ms into
      one entry** — UNGROUPABLE (history.ts:34-49) lacks the three keys; A/B
      comparing two looks then Ctrl+Z jumps past both.
      **FIXED 2026-08-21, v2.107.0 (fa754e6)**: look/theme/style joined UNGROUPABLE; six rapid applications = six undo entries.
- [x] **R2-24 NaN poisoning of width/LUFS is permanent for the session** — one
      non-finite sample in a float-PCM WAV → stereoWidth NaN → width EMA and
      the LUFS biquad/ring never recover (stereo.ts:6-21,
      featurePipeline.ts:734-737, lufs.ts:68-140); "Stereo width" is a stock
      mod source, so NaN reaches params/uniforms and persists across clean
      tracks until restart.
      **FIXED 2026-08-21 (8650b64)**: stereoWidth reads any window whose
      summed accumulators go non-finite as silent (0); the pipeline holds
      the previous width/lufs on non-finite input (a glitched frame costs
      one frame, not the session); the LUFS biquads reset-to-silence on a
      non-finite output and the meter clamps a non-finite block power to 0
      at the ring's door — prevention policy: the incremental sum stays
      exact and a poisoned reading ages out within one ring length.
      integratedLufs inherits the biquad guard (it used to lose everything
      after the glitch to the absolute gate). Tests written FIRST (all red
      pre-fix); corrupt-track integrated within 0.5 LU of clean;
      featurePipelineFuzz now generates width/lufs with occasional
      NaN/±Infinity (mutation-checked: dropping the width guard reds both
      properties with width=NaN).
- [ ] **R2-25 fpsCap caps presentation, not DSP** — ana.update runs per rAF
      before the cap check (services.ts:434 vs 456-468); 144 Hz + cap 30 still
      pays ~99 ms/s of DSP for 30 presented frames. The battery knob barely
      touches the dominant cost.
- [ ] **R2-26 Autosave stringifies the full document (assets included,
      pretty-printed) on the UI thread** — store.ts:1456 → project.ts:192
      `JSON.stringify(file, null, 2)`; measured 3.3 ms/739 KB, linear ⇒
      150-250 ms hitches per autosave on embedded-video projects.
- [x] **R2-27 Records drift (memory layer)** — five wrongs telling yesterday's
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
      **FIXED 2026-08-21, wave 0**: all five memory-layer wrongs corrected (roadmap 2.104.2+audit entries, consolidation card COMPLETED, battery card EXECUTED, RECALL rule → supersede-by-claim-key, owner notes FEAT-004/005 → HISTORY with outcomes); RECALL #92-94 deprecated with lifecycle notes.
- [x] **R2-28 Licensing/docs truth cluster** — THIRD_PARTY_LICENSES.md:
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

      **FIXED 2026-08-21, wave 0 (be38754)**: THIRD_PARTY ffmpeg scope + 8 crates + ~540 count; style/control counts on all four surfaces (6-15, 550+); README TESTING claim scoped; CLAUDE.md changelog mechanism truth; EXPORT-DESIGN second display + AV1 + resolutions; TESTING.md stale lines + VERIFY-002 sign-off.
- [x] **R2-29 Security defense-in-depth (4)** — perform-window-reachable
      telemetry (`scratch_dir` leaks username path, `disk_space` is a mounted-
      volume oracle → add `assert_main_window`); gallery size check runs after
      full buffering (pre-check Content-Length); `style-src 'unsafe-inline'`;
      lofty parser surface (schedule cargo-audit cadence). No P0/P1 anywhere.
      **2/4 landed 2026-08-21 (10df960)**: disk_space/scratch_dir/perf_stats
      are main-window-gated (loopback_died deliberately open: no window
      handle, one atomic bool), and verifiedFetch refuses a header-declared
      oversize before buffering (byte-count backstop kept). REMAINING:
      `style-src 'unsafe-inline'`, cargo-audit cadence.
      **CLOSED 2026-08-21, v2.105.0 (10df960)**: the two actionable items landed (assert_main_window on disk_space/scratch_dir/perf_stats — loopback_died takes no window; gallery Content-Length pre-cap with byte-count backstop). The two residuals are accepted posture, recorded here: style-src unsafe-inline (no injection sink exists; nonce infeasible with the bundler today) and the lofty parser surface (mitigation = cargo-audit cadence in CI audit job).
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
      **6/10 landed 2026-08-21 (4307ac1, 66c4074)**: VP9 fullCodecString
      pinned; PNG no-sink guard added; <3 s canvas track refused before the
      dialog; canvas loop now buffered progressive MP4 written once to the
      picked path (owner verdict: ingest compatibility); WebP capped under
      R2-11's pixel budget; prores_abort returns the log's last ~2 KB (read
      before cleanup) and the TS side folds it into the surfaced error ahead
      of translateExportError. **AAC priming: CLOSED NEGATIVE 2026-08-21** —
      device probe through the real MP4 lane (six 1-sample-rise clicks at
      exact 0.5 s intervals, 48 kHz, decoded back via the bundled ffmpeg)
      measured 0.00 ms offset on every click: the platform encoder
      pre-compensates its timestamps, no edit-list fix needed (probe:
      scratchpad aac-priming-probe; evidence report archived with the lane).
      REMAINING: mediabunny CodecDelay upstream report, codecProbe level
      ladders, WebCodecs-lane 601/709 tagging probe.
- [x] **R2-31 Live/state nits (11)** — MIDI learn stays armed after its
      surfaces close; enable/disable MIDI race; quantized switch fires
      immediately on forward seek across a boundary; batch resume ETA uses the
      original startedAt; dropped .bfpreset/.bfbuilder files fall through to
      the audio decoder ("could not decode"); concurrent batch-add scans
      corrupt the scanning counter; lyrics tier download double-activation;
      three unguarded module-scope localStorage reads; perform cover-art
      fingerprint can length-collide; ShaderEditor chip-load replaces a dirty
      draft without the confirm its close path has; lyrics editor rows keyed
      by index.
      **10/11 LANDED 2026-08-21, v2.107.0** (learn disarm incl. dock-close/Stage-entry/Esc-in-Stage; MIDI enable/disable generation guard; forward-seek quantize guard; batch resume ETA restamp; .bfpreset/.bfbuilder drop import; download claim; localStorage guards; FNV cover fingerprint memoized by reference — review D1; dirty-draft confirm on chip-load/New; stable lyric row uids, session-only, provably never persisted). REMAINING (hardening): 31f batchScanning concurrent counter (deferred by the lane to avoid a cross-lane batchActions conflict — now safe to do).
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
- [x] **R2-33 Determinism contract docs (3)** — PREVIEW-EXPORT-CONTRACT
      overclaims "exactly" for feedback replay; canvas-loop audio crossfade
      feeding the analyzers is undocumented; the cross-frame-state carve-out
      names two modes but applies to Particle Flow and the other feedback
      modes.
      **FIXED 2026-08-21, wave 0 (be38754)**: contract carve-out names every stateful mode, replay claim is structural, canvas-loop audio crossfade documented.
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
- [x] **R2-36 Docs small (3)** — fetch-ffmpeg.mjs header names only ProRes;
      README format list omits aac/opus the library scanner accepts; GATES.md
      §3 cites "matrix 269/269" while the baseline holds 314 cases.
      **FIXED 2026-08-21, wave 0 (be38754)**: fetch-ffmpeg header names all four lanes; README library formats include aac/opus; GATES E3f note no longer implies a frozen 269.
- [x] **R2-37 Ledger small (4)** — "nine releases 2.99.0→2.104.2" is eight;
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

      **FIXED 2026-08-21, wave 0**: eight-releases correction, drive-letter probe wording, devstorage rename note in the consolidation card, BACKLOG guide pointer names the sibling dir.
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
