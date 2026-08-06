# Beatform Backlog and Alignment Ledger

Last reconciled: **2026-08-06** (post v2.72.0 — Gallery live; quality consolidation program + full audit register active)

This is Beatform's canonical current-work ledger. It records what is complete,
what still needs evidence, what is ready to execute, and what remains only a
candidate. Agents must update this file when work changes those facts.

## Authority and operating rules

Use this order when claims conflict:

1. Current repository code, tests, configuration, and reproducible tool output.
2. This ledger.
3. `TESTING.md` for manual test history and acceptance procedures.
4. Current GitHub issues, pull requests, releases, and workflows.
5. External notes and RECALL memory as leads that require verification.
6. Old plans, reviews, handoffs, and conversation summaries as historical
   context only.

`ROADMAP.md` and `PLAN-*.md` are local, ignored planning records. Their shipped
history can be useful, but their current-state claims do not override this
ledger. `beatform-audio-analysis-architecture-review.md` is an independent
review of an older architecture snapshot, not an active implementation plan.

Listing a feature here does **not** approve implementation. Respect its status:

- **READY** — execution can begin without another product decision.
- **RESEARCH** — gather named evidence before choosing architecture.
- **CONSIDERING** — valid candidate, not approved for implementation.
- **DECISION** — owner choice is required before behavior changes.
- **GATED** — blocked on named hardware, software, demand, or external evidence.
- **KNOWN LIMITATION** — documented behavior; do not change without a trigger.
- **SOMEDAY** — deliberately outside the current queue.
- **DONE** — verified shipped work; do not reopen without new evidence.

## Reconciled baseline

Time-sensitive values below were checked on 2026-08-06:

| Fact                    | Verified state                                                                                                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository              | `0langa/beatform`                                                                                                                                                                                                                                                           |
| Branch                  | Clean `main`, aligned with `origin/main`                                                                                                                                                                                                                                    |
| Source version          | `2.72.0` in all five version-bearing files                                                                                                                                                                                                                                  |
| HEAD / latest tag       | `a6f511c` (docs commits after release) / `v2.72.0` on release commit `1fcf60e`                                                                                                                                                                                              |
| Latest public release   | `v2.72.0`, published 2026-08-05 (Gallery top-bar surface; registry live with 11 seeds); setup-exe SHA-256 `1ce9bb83…` matches `SHA256SUMS.txt`, updater manifest signed, live latest endpoint serves `2.72.0`                                                               |
| Open GitHub issues      | 0                                                                                                                                                                                                                                                                           |
| Open pull requests      | 5 — all Dependabot (#11 npm minor/patch group; #12 rustls patch; #13 windows-core 0.62; #14 sha2 0.11; #15 webview2-com 0.39). #13/#15 track wry's pins (see `Cargo.toml` comment) — review before merging, not auto-merge                                                  |
| Installed desktop app   | `2.72.0` (binary `ProductVersion` verified 2026-08-06) — auto-update chain 2.67→2.72 worked                                                                                                                                                                                 |
| Uninstall registry      | `2.72.1`, matching the binary (verified 2026-08-06) — self-healing since v2.72.1: the app repairs `DisplayVersion` on every boot. The genuine updater path was caught skipping the write LIVE (2.72.0→2.72.1) and the heal corrected it on first launch. ALIGN-002 RESOLVED |
| Running desktop app     | Not checked during this reconciliation                                                                                                                                                                                                                                      |
| Explicit source markers | Re-verified 2026-08-06: no `TODO`, `FIXME`, `XXX`, or `HACK` markers in `src`, `src-tauri`, or `scripts`                                                                                                                                                                    |

Current product constraints remain:

- Free and open source.
- GitHub Releases distribution.
- Local-first; no paid tier, cloud dependency, store account, or telemetry.
- Preview/export determinism and WYSIWYG remain hard contracts.
- Windows is the currently shipped desktop platform.

## QUALITY CONSOLIDATION PROGRAM — active 2026-08-06, feature queue PAUSED

Owner directive (2026-08-06, verbatim intent): stop pumping out new
surfaces; bring the EXISTING feature surface to the bar first, because
shallow foundations drag down every future addition. Triggers named by the
owner: (1) the two seed themes are "glorified looks" — no modulation, no
overlay layers, large parts of the app untouched — below the standing seed
bar ("high effort and quality… impressive and visually stunning… so that
users feel inclined to try creating and uploading their own"); (2) many
modes lack the customization depth of the developed ones (Radial Burst,
Tunnel), capping what looks/themes can even express; (3) naming drift
(Templates vs Themes vs Styles vs Looks) with a stale in-app user guide
completing the confusion; (4) fresh Gallery correctness bugs.

**FEAT-009 and ALL new feature work PARKED until this program completes.**

### Audit register — 2026-08-06 full-product audit

Seven parallel domain audits (state/store, UI code, render/presets,
audio/export, platform/infra, docs/strings, test infrastructure) plus an
on-device UX walkthrough (60+ screenshots, every surface incl. deep
scroll). Full evidence reports — every item with file:line — live at
`F:\agent-devstorage\shared-cache\audio-visualizer\artifacts\quality-audit-2026-08\`
(`state-store.md`, `ui-code.md`, `render-presets.md`, `audio-export.md`,
`platform-infra.md`, `docs-strings.md`, `tests-quality.md`, `ux-shots/`).
Those reports are the canonical detail; this register is the distilled,
tracked view. Headline claims were re-verified by hand before writing
this (AX-1, PL-4, TQ-3, DS-18 — all reproduced). Opinion-class output
went to `PROPOSALS.md`, not here.

**Totals:** 84 confirmed defects · 55 drift groups · 49 future-proofing
risks · ~85 proposals (in PROPOSALS.md). 273 items.

#### Severity-1 shortlist (real user harm, fix first — Track E order)

| ID    | Defect                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AX-1  | Default sync mode "Kicks" never reads the kick detector — `featurePipeline.ts:819-822` falls through to `f.energy`; UI hint promises what it can't do  |
| PL-1  | Closing the app mid-export orphans ffmpeg, finalizes a TRUNCATED file at the user's path, leaks the staged WAV in %TEMP% forever                       |
| SS-1  | Lyrics generated for track A silently attach to track B (with success toast) if a track loads during the run                                           |
| PL-3  | Lyrics sidecar audio decode can two-pipe-deadlock; decode child unregistered with canceller — wedged generate unkillable until app exit                |
| PL-2  | `lyrics_generate`/`align` check-then-set race orphans a running inference child with no kill handle                                                    |
| UI-2  | ParamsPanel `memo` permanently defeated (3 inline arrows + fresh `.filter()` in App.tsx) — 2,033-line panel reconciles at the playback tick            |
| UI-1  | Escape while typing in 5 inputs (panel search, look/theme name, gallery search, batch retitle) tears down the whole panel stack                        |
| UI-3  | Saved-look delete: no confirm, NOT undoable, 9-px ✕ two px from Export — while lyrics clear confirms and shader delete is undoable                     |
| SS-3  | Batch refusal errors render only inside ExportDialog (which isn't open); Batch Start silently dead-clicks during single export                         |
| AX-3  | Export-worker watchdog has no setup-phase heartbeat — long track + loudness falsely killed at 30 s, silently re-rendered inline                        |
| AX-2  | Every export builds a second full OfflineAnalyzer for texture feedback even when unused — doubles DSP, ~1.4 GB extra on a 2 h track                    |
| AX-6  | Timeline-scene image/video backgrounds never asset-resolved — live and export degrade DIFFERENTLY (genuine preview≠export corner)                      |
| RP-1  | Preset crossfade caches by id: an edited custom preset fades out rendering OLD WGSL with NEW param packing                                             |
| RP-4  | thumbnails.ts documents a measured cross-renderer particle-sim coupling that shifted an export frame — open determinism question, previously untracked |
| PL-4  | Web MIDI origin gate is a prefix match — `http://localhost:1420.evil.com` / `:14205` pass `own_origin` (`midi_permission.rs:27`)                       |
| SS-2  | ~10 unguarded `localStorage.setItem` savers throw QuotaExceeded mid-action in the quota regime the app explicitly supports                             |
| DS-1  | SECURITY.md factually wrong since v2.69/v2.71 (network-request inventory, CSP claim, threat-model omissions)                                           |
| DS-3  | CONTRIBUTING.md setup yields a broken build (no sidecar steps) and mandates `cargo test --lib` (skips the workspace member) — same trap in PR template |
| TQ-3  | BACKLOG's own "standard gates" (this file, lines ~1145) run cargo without `--workspace` — the exact silent-skip CLAUDE.md warns about                  |
| DS-15 | Gallery submission docs promise CI byte-verification that provably never fires for real submissions (validator checks only `pin === HEAD`)             |

Severity-2 and lower: tracked per report (SS-4..10, UI-4..12, RP-2..5,
AX-4..12, PL-5..10, DS-2..23, TQ-1..12 etc.) — burn down by domain in
Track E waves after the shortlist.

#### Notable "genuinely excellent — do not churn" findings

History's asset-sharing snapshots; project.ts conditional-version
migrations; gallery.ts verification chain; exportCore's env-agnostic
claim, backpressure chain and batch isolation (all verified true);
App.css has ZERO dead selectors; kit.tsx; DSP mutation-tested
characterization; the audit-tagged comment culture. Refactors must not
regress these.

### Canonical vocabulary (decided 2026-08-06, applies everywhere from now on)

- **Style** — built-in curated per-mode chip (factory, lives in code).
- **Look** — shareable saved snapshot of ONE mode (params + sync,
  `.bfpreset`, "My Looks").
- **Theme** — complete setup (whole project document, `.bftheme`).
  **The word "Template" is retired** in UI, guide, docs, code comments.
- **Gallery** — the public curated collection of looks + themes.

### Track A — Gallery correctness + naming (first; small; ships as one release)

- [ ] A1 Install-state truth. Looks: "✓ Added" must track the installed
      look's actual existence — record galleryId → userPresetId at install;
      deleting the look in Visual settings reverts the button to
      "+ Add look". Added state DISABLES the button (today it stays
      clickable and stacks duplicates — owner repro). Themes: applying is
      legitimately repeatable — show a transient "Applied ✓" then return
      to "Apply theme"; no persistent Added state at all ("New Project"
      made the lie obvious).
- [ ] A2 Look-vs-theme explainer inside the Gallery dialog (one line each,
      near the filters; type badge tooltips say it too).
- [ ] A3 Deep links: the Themes-section shortcut opens the Gallery
      pre-filtered to **Themes**; a matching shortcut in the styles/My
      Looks row opens it pre-filtered to **Looks**.
- [ ] A4 Naming sweep per the vocabulary above: "Templates" section
      becomes "Themes", save-dialog filter names, toasts, hints, README,
      docs/, CHANGELOG copy going forward.
- [ ] A5 Gates + device e2e extended to cover A1 semantics (delete-look
      revert, theme transient state, no dup-stacking).

### Track B — Mode depth equalization (the core of the program)

Bring every mode to the customization class of Radial Burst/Tunnel so
each can carry a publish-worthy look. Aurora's resistance to seed tuning
was the canary.

- [ ] B0 Audit matrix (agent sweep, no code): per mode — curated + advanced
      param counts, param-group coverage (shape / color / motion / beat
      response / texture), style count + spread, modulation-target
      richness, hint quality, visual ceiling notes, gap list, effort class
      (S/M/L). Output: ranked upgrade queue for owner sign-off.
      Current param-count tiers (from the registry dump, curated params):
      shallow — voice-orb 6, aurora 6, synthwave 6, spectrum-scape 6;
      mid — metaballs 7, nebula 7, echo-trails 7, particle-flow 7,
      oscilloscope 7, tunnel 8 (rich styles offset the count);
      developed — spectrum-bars 9, led-matrix 9, bass-circle 10,
      particles 11, radial-burst 12. Builder is its own world (out of
      scope here).
- [x] B0 **DONE 2026-08-06** — full matrix at
      `F:\agent-devstorage\shared-cache\audio-visualizer\artifacts\quality-audit-2026-08\b0-mode-depth-matrix.md`.
      Recommended queue (OWNER RESHUFFLES BEFORE WAVES START); wave 0 =
      F5 WGSL consolidation + param-schema taper/mod-metadata first:

      | #   | Mode                    | Effort            | Why here                                              |
              | --- | ----------------------- | ----------------- | ----------------------------------------------------- |
              | 1   | voice-orb               | S                 | Depth already built; pure curation — proves the template |
              | 2   | aurora                  | M                 | The canary; unblocks C3's hand-tuned look             |
              | 3   | synthwave               | M                 | Road/sun/skyline = genre-defining absences            |
              | 4   | led-matrix              | S                 | Waterfall scroll = spectrogram-lite archetype         |
              | 5   | spectrum-bars           | S                 | Default mode; stereo split rides unread `width` lane  |
              | 6   | bass-circle             | S                 | Cover-art core lifts from radial-burst                |
              | 7   | particles               | S                 | Color tier + snare shooting stars                     |
              | 8   | nebula                  | S                 | Kills RP-6 sat-drift; palette phase; star parallax    |
              | 9   | echo-trails             | M                 | Source-shape enum multiplies identity                 |
              | 10  | metaballs               | M                 | Lava smear + per-band blob weighting                  |
              | 11  | oscilloscope (fragment) | M                 | Multi-trace band split; XY lane → renderer block      |
              | 12  | tunnel                  | S–M               | Already deep; wall materials = safe filler            |
              | 13  | spectrum-scape          | L (renderer wave) | ABI growth; biggest ceiling raise                     |
              | 14  | particle-flow           | M–L (renderer)    | PU struct growth; trails = separate LARGE call        |
              | 15  | oscilloscope XY lane    | M (renderer)      | Lands while ABI is open                               |
              | 16  | builder2 RP-20 bridge   | M–L               | Biggest unlock, own project; pull earlier if C1 needs |
              | —   | radial-burst            | —                 | Leave alone — it IS the bar                           |

              B0 surprises worth reading in the matrix: hint coverage is 359/359
              (wave hint-work = touch-ups only); curated-tier GROUP holes don't
              follow param counts (metaballs has zero beat-response in main;
              led-matrix hides motion+beat in advanced); styles under-exercise
              enums (`coverFit` set by NO style anywhere). NEW defect from B0:
              led-matrix canvas2d fallback loses hue entirely to a `hueShift`
              key mismatch (+ builder2 canvas2d = all-default bars) — added to
              the severity-2 pool.

- [ ] B1..Bn Per-mode upgrade waves in the B0-ranked order (worktree
      agents, one mode per agent — the proven v2.47/v2.68 pattern):
      params + groups + styles + hints + GPU-matrix re-bless + device
      screenshots per mode. Shallow tier first.

### Track C — Seed set v2 (after B lands for the modes involved)

- [ ] C1 Flagship themes (3–5), built as full productions: modulation
      routes, overlay layers (text/logo), backgrounds, post chain, scene
      timeline where it serves the piece — each one demonstrably touching
      the surfaces the current two ignore. Replaces deep-current /
      sunset-circuit (registry `replacedBy` or in-place update — IDs
      stay, content re-pins).
- [ ] C2 Look pass 2: deepen the nine live looks where B raises a mode's
      ceiling (looks carry params + sync ONLY by design — full-capability
      showcase is the themes' job; the explainer from A2 makes that
      visible to users too).
- [ ] C3 Aurora hand-tuned look (needs B first — the mode, not the tuner,
      was the limit) + seeds for any mode whose upgrade unlocks one.
- [ ] C4 Owner validation loop per batch — explicit approve/veto PER
      ENTRY before anything merges to registry main. (Process fix: the
      v1 seed merge rode on a thumbnails-look-fine reading; never again.)

### Track D — Docs truth pass (after A naming lands)

- [ ] D1 In-app user guide full rewrite against the current app: define
      Style/Look/Theme/Gallery per the vocabulary, add a Gallery section,
      correct every drifted term ("Styles — curated one-click looks" etc.),
      sweep all 12 sections for staleness (guide predates lyrics, Gallery,
      perf overlay, preview scale…).
- [ ] D2 README + docs/ site + gallery-repo docs same sweep.
- [ ] D3 Repo-wide string audit for "template"/naming residue (UI strings,
      tooltips, aria-labels, comments).

### Track E — Hardening burn-down (NEW, from the audit register)

- [ ] E1 Severity-1 shortlist above, roughly in table order (AX-1 sync
      semantics needs a small design call: give "Kicks" the kick
      detector it advertises + migrate existing docs' expectations).
- [ ] E2 Severity-2 waves per domain (state → UI → audio/export →
      platform → render), each wave gated + released.
- [ ] E3 Register the RP-4 determinism question as its own
      investigate-and-close item (measure, fix or document).
- [x] E4 ALIGN-002 — **DONE, shipped v2.72.1 (2026-08-06), proven on the
      live path.** Two-stage diagnosis: (1) the tauri-cli 2.11.4 NSIS
      template writes `DisplayVersion` UNCONDITIONALLY, and running the
      released setup by hand with the updater's arguments (`/P /UPDATE`)
      DID rewrite the key (`2.39.0 → 2.72.0`); (2) BUT the genuine
      in-app update (ShellExecuteW from the running app) was then caught
      skipping the write in real time — the driven 2.72.0→2.72.1
      auto-update left binary=`2.72.1` / registry=`2.72.0`. A concurrent
      session's interim "current pipeline is correct" conclusion is
      thereby superseded. Fix: boot-time self-heal
      (`src-tauri/src/uninstall_entry.rs`; winreg already in tree; debug
      builds skip; missing key never created; real-registry round-trip
      test). Proof: registry read `2.72.1` seconds after the updated
      app's first launch. Ritual registry check now expects the EXACT
      version after every update (one-behind note retired) — with the
      heal, any future installer skip is invisible by the time anyone
      looks.

### Track F — Test & release infrastructure (NEW, from the audit)

- [ ] F1 One checked-in release-gate manifest quoted by CLAUDE.md,
      BACKLOG, ci.yml, release.yml (today: three contradicting
      definitions; release.yml omits clippy/fmt); `--workspace`
      everywhere.
- [ ] F2 Root-fix the "thermal-flaky" DSP test (timeout config, remedy
      already exists in store.test.ts pattern) — retire
      rerun-before-believing.
- [ ] F3 Consolidate the 13 device harnesses onto one `scripts/lib/`
      (CDP client ×12 copies today) + scenario registry + JSON evidence
      envelopes (design sketch in tests-quality.md TQ-25).
- [ ] F4 Close the invariant-coverage holes: overlay-compose chokepoint
      direct tests, exportCore determinism test, MIDI illegal-invocation
      regression stub, `no-restricted-globals` for bare confirm/alert,
      GPU matrix param-extreme + post/motion variants, parser fuzzing
      (fast-check + one cargo-fuzz target on the GLSL translator).
- [ ] F5 WGSL shared-helper consolidation (ACES ×3, hsl2rgb ×3, palette
      basis ×17 — RP-12/23) as a ZERO-pixel-change PR gated by the GPU
      matrix, BEFORE Track B waves.

### Decision points for the owner

1. **Live themes now**: tombstone deep-current + sunset-circuit
   immediately (Gallery shows 9 looks until C1), or leave them until C1
   replaces them? (Recommendation: pull them — they're the flagged
   offenders and the userbase is small.)
2. **B0 ranking**: after the audit matrix lands, priority order is yours
   to reshuffle before waves start. Note from the render audit:
   spectrum-scape and particle-flow are ABI-bound (renderer work, not
   preset-file work) and must be planned as renderer waves; Builder's
   ParamSpec bridge (RP-20) is the single biggest depth unlock.
3. **Release cadence during the program**: keep shipping each track as
   its own 2.x release (recommendation), or batch tracks?
4. **Track order** (recommendation): E1 severity-1 shortlist → A
   (gallery correctness + naming) → F1/F2 (gates + flake, tiny) → B0
   audit matrix sign-off → F5 (WGSL consolidation) → B waves ∥ E2 →
   D docs truth → C seed v2. Approve or reshuffle.
5. **PROPOSALS.md verdict pass**: 10 product proposals (P-1 Inspector
   dock … P-10 polish bundle) + the endorsed audit proposals appended
   there await your approve/adjust/reject per item.

### Parked (do not start)

| ID       | Status | Work                                   |
| -------- | ------ | -------------------------------------- |
| FEAT-009 | PARKED | True second-display performance window |

### FEAT-003 — Gallery (public curated registry) — DONE, LIVE

**Status:** DONE — fully live 2026-08-05. v2.71.0 shipped the verified-
download core (allowlist + commit pin + exact size + SHA-256 before parse);
v2.72.0 gave it the top-bar dialog surface; 11 owner-approved seeds live on
registry `main` (content pinned a795bac). Open follow-ups live in the
program tracks (A gallery correctness, C seed v2). Full record: ARCHIVE at
the bottom of this file.

## Immediate stabilization and maintenance

### ALIGN-001 — Current installed-release acceptance

**Status:** DONE 2026-08-01 — installed-release acceptance smoke passed on
the shipped build. Full record: ARCHIVE at the bottom of this file.

### ALIGN-002 — Windows uninstall registry stuck at 2.39.0

**Status:** RESOLVED 2026-08-06 — **shipped in v2.72.1.** Key sat at
`2.39.0` through five updates; a manual updater-style install wrote it,
but the genuine in-app update path was then caught skipping the write
live (2.72.0→2.72.1). The app now self-heals its uninstall entry on
every boot; proven on-device seconds after the updated app's first
launch. Full detail: Track E → E4. Original record: ARCHIVE at the
bottom of this file.

### DOC-001 — Public metadata and planning truth

**Status:** DONE 2026-07-30 — public metadata corrected, ledger became a
committed repo file. Full record: ARCHIVE at the bottom of this file.

## Strategic feature candidates

### FEAT-001 — Shadertoy/GLSL import compatibility

**Status:** SHIPPED v2.64.0 (2026-08-02); sampler-param follow-up in
v2.65.0. Shadertoy import is a live feature (Rust/naga transpiler,
`.bfshader` files, attribution kept). Full record incl. both spike
datasets and corpus pass rates: ARCHIVE at the bottom of this file.

### FEAT-003 — Community preset index

**Status:** SUPERSEDED — this was the original planning entry; every owner
decision locked 2026-08-04 (org, repo, licenses, moderation, seed bar) is
preserved in the ARCHIVE copy and realized by the DONE entry above.

### FEAT-004 owner first-impressions (2026-08-04, overloaded-PC session — retest pending)

Recorded from the owner's first hands-on with v2.69.0 (PC concurrently
running three AI sessions — numbers not representative, owner retests on a
clean boot):

- **Progress stall at stage boundary:** "Finding vocal lines — 100%" sat
  > 5 min before whisper-medium visibly started. Stage pct reaches 100 before
  > the next stage emits its first progress (medium's first-token latency is
  > the worst case). Polish: stage-transition display ("starting
  > transcription…"), never a stale 100%.
- **Estimate source question:** owner asked if ETA is hardware-detected —
  it is a sustained-RTF table measured on the reference machine, split only
  by the DML probe. Refinement (already recorded): persist measured RTF from
  completed runs into later estimates.
- **Quality read:** word/line DETECTION "rock solid"; TIMINGS "pretty
  unreliable right now" — tuning target for the next lyrics round, editor
  covers the gap meanwhile. Small tier ~5 min under heavy load.
- Debug shell feels slower than installed build (expected: dev overhead +
  load; sidecar is release-profile either way).
- MIDI learn untested (no hardware; owner may access equipment on the
  weekend).

### EXT-RENAME — file extensions `.av*` → `.bf*`

**Status:** DONE — shipped v2.70.0 (2026-08-05). No backwards compat;
JSON `kind` discriminators renamed too; gallery repo updated in the same
push. Full record: ARCHIVE at the bottom of this file.

### FEAT-003 original design notes (kept)

Original design requirements — all satisfied by the shipped Gallery (the
security model was implemented as specified, verified by tests + device
E2E). Full record: ARCHIVE at the bottom of this file.

### FEAT-004 — Best-possible local automatic lyrics

**Status:** DONE — shipped v2.69.0 (2026-08-04): fully local vocal
isolation → whisper transcription → word-level forced alignment, model
manager with verified resumable downloads, correction editor with
per-line re-align. Owner first-impressions section above stays ACTIVE
(clean-boot retest pending). Recorded follow-ups: stage-transition
progress display, measured-RTF estimate refinement, whisper Vulkan
benchmark, language picker. Full record (4 phases, all device evidence):
ARCHIVE at the bottom of this file.

### FEAT-005 — Genuine 10-bit HEVC/AV1 export

**Status:** DONE — shipped v2.67.0 (2026-08-03): true 10-bit AV1
(16-bit float tap BEFORE the 8-bit swapchain, rgba64le pipe into
SVT-AV1; 752 distinct decoded levels proven vs the 256 ceiling). Open
follow-up recorded: ProRes deep-color pipe. Full record: ARCHIVE at the
bottom of this file.

### FEAT-009 — True second-display performance window

**Status:** CONSIDERING  
**Existing foundation:** Stage mode, blackout, HUD, beat-quantized switching,
and Web MIDI are shipped.

Required design:

- Create and own a second Tauri webview window.
- Select target monitor and fullscreen mode.
- Synchronize renderer state, audio features, transport, and frame timing
  without duplicating incompatible control state.
- Keep operator UI on primary display and clean output on performance display.
- Define window loss/reconnect, monitor hotplug, focus, escape, and shutdown
  behavior.
- Preserve single-window Stage mode as fallback.
- Add manual dual-monitor and mixed-DPI acceptance matrix.

Acceptance gate:

- Clean, frame-stable output on a second physical display.
- No duplicated audio playback or analysis drift.
- Predictable window lifecycle and monitor recovery.
- Export path remains unaffected.

## Verification and evidence gaps

### VERIFY-001 — Long-export renderer memory characterization

**Status:** CLOSED 2026-08-03 — no leak: 2×85 min soak, flat JS heap
plateau; working-set growth is reclaimable cache. Full record: ARCHIVE at
the bottom of this file.

### VERIFY-002 — ProRes 4444 NLE interoperability

**Status:** GATED  
**Gate:** DaVinci Resolve or another target NLE must be installed.

Existing evidence:

- ProRes 4444 alpha export decodes back successfully.
- Alpha round-trip is covered outside an NLE.

Remaining check:

- Import representative alpha export into target NLE.
- Place above contrasting footage.
- Check alpha edges, premultiplication, color, duration, frame rate, and seek.
- Re-export or render a short composite and inspect.

This does not block current releases. Close when target software is available.

### VERIFY-003 — Web MIDI browser-to-adapter transport

**Status:** DONE 2026-08-04 — the transport was double-dead on every
shipped build (unbound `requestMIDIAccess` + WebView2 permission denial);
both fixed and E2E-proven against loopMIDI. NOTE: audit defect PL-4
(origin prefix match in `midi_permission.rs`) touches this area — tracked
in the audit register. Full record: ARCHIVE at the bottom of this file.

## Behavior decisions and known limitations

### VIS-001 — Aurora mirrored hue spread

**Status:** DECISION  
**Owner choice required before changing shipped visuals.**

Current behavior:

- Mirrored Aurora folds `x` into approximately `[0.5, 1]`.
- Palette hue spread also uses folded `x`, producing about half the nominal
  range and a one-sided offset.
- Spectrum indexing uses separately rescaled `specX` and is already corrected.

Decision:

- **Preserve:** treat current palette behavior as part of shipped mirrored
  styles.
- **Change:** rescale palette coordinate in mirrored mode, knowingly altering
  existing Cathedral and other mirrored looks.

If changed:

- Add golden coverage for mirrored and unmirrored styles.
- Review every factory Aurora style.
- Document intentional visual migration in changelog.

No action until owner chooses or a user-facing defect provides new evidence.

### DSP-001 — DC-offset waveform and trigger behavior

**Status:** KNOWN LIMITATION  
**Priority:** Low; no current user report.

Current behavior:

- FFT magnitudes use the DC-blocked analysis path.
- `f.waveform` remains the raw input window in real-time and offline sources.
- Rising-zero-crossing trigger therefore operates on raw waveform data.

Impact:

- Strong DC-offset audio can draw an off-center oscilloscope.
- Rising-zero-crossing trigger can fail or lose phase stability.

Trigger for work:

- Reproducible real-world file/device report, or a planned waveform-quality
  release.

Potential solution must preserve:

- Preview/export equality.
- Existing waveform amplitude meaning.
- Trigger determinism.
- Tests for positive/negative DC offset and silence.

### DSP-002 — Short analyzer history after seek

**Status:** KNOWN LIMITATION

`AnalyserNode` can retain about 85 ms of pre-seek samples, so several preview
frames may straddle old and new positions. Feature-pipeline priming prevents a
false detector pulse. Removing the residual would require a different audio tap
or analyzer lifecycle and is not justified by current evidence.

Do not “fix” by adding ad hoc smoothing/reset behavior. Reopen only with a
visible seek artifact and a deterministic reproduction.

## Deliberately deferred / someday

These are valid ideas but not active work:

| Item                                          | Status     | Re-entry gate                                                                              |
| --------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| macOS/Linux installers, signing, notarization | SOMEDAY    | Sustained demand plus hardware and release-maintenance capacity                            |
| Spout/NDI native output                       | GATED      | User demand, Windows capture hardware/software, native-library plan, end-to-end validation |
| More factory modes/styles/themes              | SOMEDAY    | Specific quality concept; never add filler for count                                       |
| Community seeding/outreach                    | GATED      | Owner action; agents must never post or represent owner without explicit approval          |
| `v3.0.0`                                      | DECISION   | Owner conviction that product merits milestone; no checklist auto-trigger                  |
| Full multi-resolution FFT/CQT default         | NOT QUEUED | Fresh measured deficiency not solved by shipped opt-in display FFT                         |
| Separate stem-separation feature              | FOLDED     | Part of FEAT-004 automatic-lyrics pipeline                                                 |

## Cleared work — do not reopen without evidence

| Area                               | Verified shipped state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEP-001 jsdom 30                   | Merged 2026-07-30 (#9, `d24f714`). Node floor satisfied (local 24.18, CI 24); full web gate green on merge-with-main: typecheck, lint, format, 984/984 tests, build                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| DEP-002 base64 0.23                | Merged 2026-07-30 (#10). Encode-only call site (`loopback.rs`, `STANDARD` engine — semantics unchanged in 0.23); cargo fmt/clippy/test green; built loopback gates green at 60 fps (depth 80.7 ms, visible 100%) and 30 fps (depth 90 ms, visible 100%, 0 underruns)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Video background blur              | Preview/export WYSIWYG path shipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Lyric animation                    | Plain, slide, pop, wipe/karaoke behavior shipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Web MIDI controls                  | Mapping/state feature shipped; only transport evidence gap remains                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Stage performance                  | Stage mode, blackout, HUD, and beat-quantized switching shipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A-B looping                        | Shipped in `v2.63.0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Audio fixed-clock contract         | Sample-rate handling, deterministic reset/seek, and fixed-clock analysis shipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Loopback capture                   | Native loopback path and deterministic smoke gate shipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Analyzer presentation              | Analyzer modes, color modes, and opt-in display-spectrum path shipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| FEAT-002                           | Shipped in `v2.63.0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| FEAT-006                           | Shipped in `v2.62.0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| FEAT-007 / FEAT-008                | Shipped in `v2.61.0` / `v2.62.0`; old bass-bin interpolation note is superseded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Audio DSP plan phases              | v2.58–v2.60 work complete; only limitations above remain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Physical non-US keyboard           | Owner-reported physical pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| FEAT-001 Shadertoy import          | **Shipped v2.64.0, 2026-08-01.** Full import feature: Rust/naga transpiler with GLSL-line diagnostics, dedicated compat pipeline (overlays/bg/post apply), Shadertoy-layout audio texture, track-clock uniforms (preview === export), attribution, conditional v2/v12 schemas. Gates: 10 Rust tests, 1003/1003 web, GPU matrix 136 cases zero raw hash changes, loopback green, new e2e gate `test:shadertoy:built` bit-identical across two export runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Owner-feedback round → v2.66.0     | Shipped 2026-08-03 from the owner's play-session findings: dropdown/route-row UI fixes; Pulse composed across 0–200% in Tunnel/Metaballs/Particles (softLimit knees + eased envelopes, identity at shipped ranges); Particles reworked (beat-walk glides TO new spots — no rubber-band; cell-coverage bounds fix the mid-screen cutoff; ~10× overdraw cut); Tunnel speed ceiling 2× + Curve waterslide travel + Waterslide style; display-spectrum latency fixed (asymmetric display window + centroid-aligned export — bars land within 1 analysis tick of the transient, live visual latency 341→43 ms and 171→21 ms, detectors byte-identical). Evidence: 1010/1010 tests, golden re-bless scoped to the 3 modules, GPU matrix 137 cases (delta confined + Waterslide case), device sweep at pulse 200% (0 GPU errors, no flood, curved-tunnel export bit-deterministic), release verified end-to-end                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| v2.68.1 perf-display patch         | Shipped 2026-08-04, owner-reported same day: the overlay's FPS counted its own rAF ticks (fire at display Hz regardless — the frame cap skips presents INSIDE ticks), so cap 30 on a 120 Hz panel read 120 while monitor-Hz changes tracked instantly (the tick-counting signature). services.ts now counts PRESENTED frames (`getPresentedFrames`, incremented beside the render call, skipped on cap-skip ticks); the overlay's rAF is only a sampling clock. Live-verified: cap 30 → "FPS 30.0 / 33.3 ms", uncapped → "FPS 120.0 / 8.3 ms". Row label "Frame" → "Frame time". New `__presentedFrames` dev hook; regression test (4:1 present-skip must read the capped rate). Gotcha recorded: probing a Vite dev module via direct `import("/src/...")` gets a SEPARATE instance from the app graph — probe through devHooks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Owner-feedback round 2 → v2.68.0   | Shipped 2026-08-04 from the owner's second play session (4 worktree agents + central integration): **Tunnel Color fade** slider (the hard color-switch ring was a real discontinuity — cosPalette's non-integer frequency across the `fract` wrap; new param crossfades one period apart, default 0 bit-identical, matrix-proven); **Particles seams/Direction fixed** (drift-mode enumerated cells and drawn positions lived in different frames — `q`-space vs `p`-space — so past ~1.5 cells of accumulated flow (~2:19 at default speed) particles clipped along straight cell lines and a Direction change shredded the frame; distance now computed in q-space, the field genuinely translates; device-verified clean at t=2:42 and at Direction 360°); **Particles iGPU perf pass** (clump-noise/danceTarget gates exact at 0, softLimit hoists, post-cull reordering); **internal rename starfield→particles** (conditional schema v13; migrations across projects/autosave/localStorage caches/preset order/looks; canonicalPresetId in index.ts); **Metaballs merge polish** (gradient-confidence gate kills saddle creases, hot keyed off per-ball max not the summed field, fwidth screen-space edge AA — naga-validated); **performance overlay** (pure-DOM, default off, corner/size/color/per-stat config, new Rust `perf_stats` via sysinfo 0.39; GPU% honestly "—"); **Preview resolution** Native/75%/50% (live canvas backing store only; device-verified 1920→960→1920). Evidence: 1057/1057 tests + 55 Rust, GPU matrix delta exactly the 17 intended rows (9 particles + 8 metaballs; tunnel byte-identical), `scripts/v268-visual-check.mjs` screenshots against the owner's bug screenshots, overlay live with real numbers (FPS 60.0, frame 16.7 ms, webgpu 1920×1170) |
| ALIGN-001 v2.63.0 acceptance       | DONE 2026-08-01: installed-binary version + nine-check UI smoke green, export artifact hash-verified — recorded in `TESTING.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Original hardware acceptance batch | Green in `TESTING.md`; v2.63.0 delta closed by ALIGN-001 above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CI ffmpeg sidecar pin              | Re-pinned 2026-08-01 after upstream pruned the mid-month autobuild (CI 404 on `rust` job). Now n8.1.2-34 from BtbN's July month-end tag; only month-end tags are retained permanently — rule documented in `scripts/fetch-ffmpeg.mjs`. New hash pinned, fetch verified end-to-end locally, Rust suite green with the new sidecar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Standard gates

Use gates proportional to the changed layer. Release-ready work runs the full
set.

### Web application

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test -- --maxWorkers=2
npm run build
```

### Rust/Tauri

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --workspace
```

### Rendering/audio specialist gates

```powershell
npm run test:gpu
npm run test:loopback:built
npm run test:loopback:built:30
```

Run GPU pixel matrix when shader, renderer, color, presentation, or export
pixels can change. Run built loopback gates when native audio capture, timing,
packaging, or Tauri integration can change.

### Version/release agreement

```powershell
node scripts/bump-version.mjs --verify
```

Before a release:

- Working tree clean.
- Full gates green.
- Manual delta acceptance recorded.
- `CHANGELOG.md` current.
- Five version-bearing files agree.
- Tag points to intended commit.
- GitHub release workflow succeeds.
- Published artifact names, hashes, manifest, updater signature, and download
  URLs are independently checked.
- The GitHub release workflow leaves a DRAFT — publish it
  (`gh release edit vX.Y.Z --draft=false --title "Beatform vX.Y.Z" --latest`)
  and confirm the live latest endpoint serves the new version before calling
  the release done.
- Installed artifact is smoke-tested; source/dev server alone is insufficient.
- After the installed app updates, the HKCU uninstall entry's
  `DisplayVersion` matches the new binary (ALIGN-002 regression check).

Large builds, caches, and regenerated artifacts must follow host
`agent-devstorage` routing policy. Source files stay in the repository.

## Definition of “backlog cleared”

Backlog is cleared when:

- ALIGN-001, DEP-001, DEP-002, and DOC-001 are complete.
- Open GitHub issues are zero or each maps to an active ledger item.
- Open pull requests are zero or each has an explicit decision and owner.
- Every strategic candidate is approved, rejected, or deliberately deferred
  with evidence; “considering” is not silently treated as implementation work.
- Verification gaps are closed or remain explicitly gated with named trigger.
- Known limitations are documented and have no contradicting user reports.
- README, GitHub metadata, changelog, tests, release, and installed-app evidence
  agree on current product state.

This does not mean every “someday” feature is built. It means no unresolved work
is hidden, ambiguous, duplicated, or accidentally treated as complete.

## Ledger update protocol

When changing this file:

1. Keep stable IDs.
2. Update status and evidence in the same commit as implementation when
   practical.
3. Add exact acceptance evidence; do not write “tested” without naming gate.
4. Move shipped work to **Cleared work**.
5. Convert failures into focused items with reproduction and ownership.
6. Remove duplicates rather than maintaining parallel queues.
7. Recheck time-sensitive baseline values instead of copying this snapshot.

## ARCHIVE — full records of completed work

Relocated verbatim on 2026-08-06 so the active half of the ledger reads
without scrolling through finished work. Stubs remain at each entry's
original position. Nothing was edited in the move; these records remain
authoritative for evidence, gotchas and scope of the completed items.

### FEAT-003 — Gallery (public curated registry) — DONE, LIVE

**Status:** DONE — **fully live 2026-08-05** across three releases:

- **v2.71.0** — verified-download core + first browser UI. Security path
  (BACKLOG design honored line by line): fixed registry URL (only remote
  host in CSP connect-src; img-src deliberately excludes it so previews
  can only render as hash-verified blob: URLs), strict allowlist regex on
  every URL at parse AND download time, exact-size before SHA-256 before
  parse, installs through the drag-import validators, no network without
  explicit user action, minAppVersion/schemaVersion gates show-but-disable.
  17 adversarial unit tests.
- **v2.72.0** — owner-directed surface promotion: top-bar **Gallery**
  button (new IconGallery) opens a dedicated dialog (wide grid,
  All/Looks/Themes filters, search, refresh; Esc/backdrop close);
  Templates keeps a "Browse the Gallery…" shortcut. Gotcha: `.modal`'s
  380px base width sits later in App.css and beat the plain class —
  `.modal.gallery-dialog` compound selector.
- **Registry LIVE on main** (beatform-app/gallery de3325b): 11 seeds
  (9 looks + 2 themes), owner-approved from delivered screenshots, all
  content commit-pinned to a795bac and hash-validated at the pin.
  Candidates: prism-cathedral, orchid-glass, abyssal-bloom,
  solar-cascade, neon-monsoon, solar-temple, vhs-sunrise, obsidian-pulse,
  glass-mandala + themes deep-current, sunset-circuit.
- **E2E** `scripts/gallery-e2e.mjs` drives the TRUE default path (live
  main registry, no override) on the debug shell over the real CSP:
  registry 11/11, previews 11/11 verified, look install → My Looks +
  applied, theme apply, dialog surface (11 cards / filter 2 themes /
  search 1 / 11 blob imgs) — green.
- Evidence: `F:\agent-devstorage\shared-cache\audio-visualizer\artifacts\feat003-seeds\`
  (KEEP-marked). Aurora-mode seed dropped (resists scripted tuning; later
  hand-tuned round). Design harness: `scripts/gallery-seed-shots.mjs`.
- Open follow-ups (no dates): aurora seed round two; grow the registry
  from community submissions (PR template + CI validator already
  enforce the contract); shader-type entries need a new registry version
  - stricter review bar (schema `type` enum is extensible).

`FEAT-004` **shipped in v2.69.0** (2026-08-04) — see its DONE entry; owner
first-impressions recorded below (retest pending).

`EXT-RENAME` **shipped in v2.70.0** (2026-08-05) — see its DONE entry. The
Gallery public-launch gate is cleared.

`VERIFY-003` **closed 2026-08-04** — found the MIDI transport double-dead
(unbound `requestMIDIAccess` + unhandled WebView2 permission), both fixed
and E2E-proven against loopMIDI; see its DONE entry. Unreleased-on-main
alongside it: the perf-overlay process-family aggregation. Both ship with
the next release.

`FEAT-005` **shipped in v2.67.0** (2026-08-03) — see its DONE entry.

`VERIFY-001` closed 2026-08-03 (no leak — see its DONE entry); the FEAT-001
sampler-param follow-up shipped in `v2.65.0` the same day.

`DEP-001`, `DEP-002` and `DOC-001` completed 2026-07-30; `ALIGN-001` completed
2026-08-01; `FEAT-001` **shipped in v2.64.0** and its ACL-confirm fix in
**v2.64.1** (both 2026-08-02, both smoke-verified on the installed build);
`ALIGN-002` resolved 2026-08-02 — registry now matches the binary, check
folded into the release ritual. The stabilization block is EMPTY: every
remaining item is a strategic candidate or research task.

`VERIFY-002`, `VIS-001`, and `DSP-001` remain gated or decision-bound. They do
not block work above.

### ALIGN-001 — Current installed-release acceptance

**Status:** DONE 2026-08-01.

- Install step: owner-driven update 2026-07-30; binary verified `2.63.0`.
- Smoke: executed 2026-08-01 by a Computer Use agent against the installed
  app — all nine checks green (launch/open/preview, analyzer modes with
  correct 341 ms / 2.93 Hz/bin / 5451-native-bin readouts, v2.62 per-mode
  color controls, seek/restart determinism, full A-B loop matrix including
  wrap/drag/clear semantics, 3 s 1080×1920 MP4 export with ffmpeg
  decode-back exit 0, clean shutdown with zero orphaned processes).
  Full table in `TESTING.md`; export artifact + SHA-256 verified against
  the on-disk file on bulk-secondary devstorage.
- Updater-path verification deliberately excluded: NSIS preserves packaged
  build timestamps, so the applied update's path is unrecoverable after the
  fact. It is testable only on the NEXT release, together with ALIGN-002's
  registry experiment.

### ALIGN-002 — Windows uninstall registry stuck at 2.39.0

**Status:** DONE 2026-08-02 — resolved by observation across two updates.

**Experiment 2 result (in-app update 2.64.0 → 2.64.1):** registry
`DisplayVersion = 2.64.1`, matching the installed executable exactly. The
"now-fixed" model wins: registry writing works correctly; the intermediate
`2.63.0` reading was a one-off transitional artifact of the first
correctly-writing update after the long freeze. Apps & Features now shows
the true version. Acceptance gate met (value matches binary). The historical
mechanism of the 2.39.0-era freeze stays unexplained and DELIBERATELY
unpursued — the observable defect is gone; reopen only if a future
post-update check regresses. That check is now part of the release ritual
(see Version/release agreement below).

Original finding and experiment history kept for the record:

**Found:** 2026-07-30, while forensically checking how the 2.61→2.63 update
was applied.

Evidence:

- `HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*` has exactly
  one Beatform entry with `DisplayVersion = 2.39.0`; HKLM and WOW6432Node
  have none.
- Installed `Beatform.exe` reports product version `2.63.0`.
- Consequence: Windows "Installed apps" / "Apps & Features" shows Beatform
  as version 2.39.0 — roughly 24 releases stale. User-visible metadata
  defect; uninstaller path itself untested.

**Experiment 1 result (2026-08-02, in-app update 2.63.0 → 2.64.0):** the
registry DID advance — from the stuck `2.39.0` to `2.63.0` — but reads ONE
RELEASE BEHIND the installed executable. So the updater path writes the key,
with a lagging value. Two candidate models, decided by the next update:

- **One-behind:** something records the OUTGOING version during the update
  (e.g. a re-registration step running before the new payload lands). After
  updating to v2.64.1 the key would read `2.64.0`.
- **Now-fixed:** `2.63.0` was a one-off transitional artifact and writes are
  correct going forward. After updating to v2.64.1 the key would read
  `2.64.1`.

(The years-long `2.39.0` freeze remains unexplained under both models —
possibly an installer-template change fixed writing somewhere between v2.40
and v2.63, with this the first update to exercise it. Root-cause via the NSIS
template only if the next reading is still wrong.)

Remaining question:

- Whether a fresh manual installer run behaves differently from the in-app
  update — only worth testing if the v2.64.1 reading is still lagging.

Acceptance gate:

- After the next release's update, `DisplayVersion` matches the installed
  binary, and the uninstall entry still points at a working uninstaller.
- Root cause named in this entry; regression check added to the release
  ritual (query the key post-update).

Side note recorded for ALIGN-001: NSIS extracts files with their packaged
build timestamps (exe shows 2026-07-29 21:28, the release build time), so
file times cannot distinguish in-app update from manual installer run.
"Updater path remains functional" is only truly testable on the NEXT
release; the smoke should not block on it.

### DOC-001 — Public metadata and planning truth

**Status:** DONE 2026-07-30 (standing per-release check remains below)

Completed 2026-07-30:

- `BACKLOG.md` committed and linked from README as the canonical queue
  (`5876eee`); README's 16-mode claim verified against the preset registry
  (15 named strip presets + Builder Studio in
  `src/render/presets/index.ts`).
- GitHub repository description updated (10 → 16 modes, deterministic-export
  positioning) with the owner's elevated token, owner-authorized;
  verified live via `gh repo view`.

Standing:

- Add installed-release evidence to `TESTING.md` after ALIGN-001 smoke.
- Check root docs for version/capability drift after each release.

Acceptance gate:

- Public metadata, README, this ledger, and current code agree.
- Historical documents are labeled or referenced so agents cannot reasonably
  mistake them for the live queue.

### FEAT-001 — Shadertoy/GLSL import compatibility

**Status:** DONE — **shipped in v2.64.0, 2026-08-01.** Paste-the-Image-tab
import dialog; Rust/naga transpiler with the spike-proven contract and
GLSL-line diagnostics; dedicated compat render pipeline through fs_composite
(overlays/backgrounds/post apply); iChannel0 audio texture in Shadertoy's
music layout; every uniform track-clock-derived so preview === export;
attribution part of the def; conditional `.avshader` v2 / `.avproj` v12
schemas. Evidence: 10 Rust tests, 1003/1003 web tests, GPU matrix 136 cases
zero raw hash changes, built loopback green, and the permanent e2e gate
`npm run test:shadertoy:built` (paste→transpile→render→export×2,
bit-identical hashes). Full history in the notes doc's shipped section.

**Follow-up shipped in v2.65.0 (2026-08-02): sampler-param specialization.**
Helpers taking `sampler2D` parameters — the #1 real-world failure class —
now translate: the transpiler clones each such function per concrete
`iChannelN` argument (fixpoint pass; nested forwarding resolves naturally;
clones embed at the original's blanked location so line mapping AND naga's
declaration-order rules survive). Bias sampling (`texture(ch, uv, bias)`)
rewrites to level 0 like plain sampling, and an extra `mainSound`/`mainVR`
next to `mainImage` is dead code, not a rejection. Real-corpus pass rate:
**34/40 → 37/40 (92.5%)**, all 37 device-compile clean; remaining rejects
are two GLSL quines and one `texture()` overload mismatch. Non-resolvable
channels (ternary/variable) get a named per-line error. Evidence: 19 unit
tests + `corpus_pass_rate` (ignored, CORPUS_DIR), e2e smoke imports a
specialized shader and asserts the diagnostic case, release verified
end-to-end (tag `ea588f8`, SHA/manifest/endpoint checked).

**Still deliberately out of scope (candidate follow-ups, not defects):**
multipass buffers, cubemap/video/keyboard channels, static textures on
iChannel1–3, and channels chosen at runtime (specialization needs a
literal `iChannel0..3` at the call site).

Spike record below is kept for the contract details and their evidence.

**Spike 2 results (2026-08-01).** 40 real single-pass shaders (Reinder
Nijhoff's self-published GitHub backup — deliberately the HARD end: advanced
raymarchers/pathtracers, one-author bias documented; fetched for analysis
only, sources not archived). Results archived KEEP-marked at
`E:\agent-devstorage\shared-cache\audio-visualizer\artifacts\2026-08-01_shadertoy-spike2\`:

- **34/40 (85%) full naga pipeline** after three contract fixes real input
  forced: UTF-8 BOM/CRLF strip; parameter-`const` strip
  (semantics-preserving); emit-time `textureSample` →
  `textureSampleLevel(..., 0.0)` rewrite (WGSL forbids implicit-LOD sampling
  in non-uniform control flow — tint enforces it, **naga's validator does
  not**, so device compile must remain part of the import validation path;
  level 0 is bit-identical because channel textures carry no mip chain).
- **All 55 emitted modules (both corpora) compile clean on a real WebGPU
  device.**
- Residual failures, all clean rejects: 3× sampler-as-function-parameter
  (the one production task — function specialization or upstream naga), 2×
  quines (exotic global types), 1× `texture()` overload mismatch.

**Spike 1 results (2026-07-30).** Full evidence, corpus, harness and emitted
WGSL archived at
`F:\agent-devstorage\shared-cache\audio-visualizer\artifacts\2026-07-30_shadertoy-spike\`
(KEEP-marked), `REPORT.md` there is the decision record. Headlines:

- 22-shader self-authored idiom corpus through naga 30 (glsl-in → wgsl-out):
  **21/21 expected-pass shaders pass** (~1 ms each); the cubemap shader
  rejects as required; multipass feedback parses, so multipass must be
  rejected from import metadata, not source.
- All 21 emitted WGSL modules **compile clean on a real WebGPU device**, and
  8 representative ones **render correctly** with a full synthetic bind group
  (uniforms + 512×2 audio texture); numeric spot check exact
  (0.5+0.5·sin(t) → measured 128/235/204).
- Working wrapper contract found (GLSL 460, UBO for all iUniforms, SEPARATE
  texture/sampler bindings, `iChannelN` as object-like macros expanding to
  `sampler2D(tex, samp)`, `texture2D` alias placed after declarations,
  Y-flip footer). naga has NO combined-sampler support; loose uniforms are
  rejected; naga 30.0.0 needs the `spv-in` cargo feature to build at all.
- **Known cap on real-world pass rate:** `sampler2D` as a function parameter
  fails to parse. Real Shadertoy helpers use this constantly — production
  needs an import-layer rewrite pass (specialize/inline channel args) or an
  upstream naga fix. `#if/#else` works.
- Architecture decision: **dedicated compatibility render path** (standalone
  pipeline, `@group(0)` bindings 0–5, Beatform-fed deterministic uniforms,
  audio as Shadertoy-convention 512×2 texture), NOT an AST merge into the
  snippet-prelude ABI. Emitted modules are self-contained; merging would be
  fragile surgery with no user benefit. Determinism holds by construction
  (all uniforms from track clock).

Why this is not a parser toggle:

- Current custom presets are WGSL snippets inserted into Beatform's shared
  shader module (`src/render/presets/custom.ts`, `src/ui/ShaderEditor.tsx`).
- Shadertoy shaders use `mainImage`, Shadertoy uniforms, GLSL ES conventions,
  and channel semantics.
- Naga can parse supported modern/Vulkan-style GLSL, but does not directly
  provide Shadertoy compatibility or merge emitted modules into Beatform's
  snippet ABI.
- Shader licensing and attribution must remain valid.

Spike plan status: steps 1–5 and 7 done 2026-07-30 (see results above);
step 6 (threat model) is partially covered by the existing custom-preset
safety model (compile check, device-loss recovery, WebGPU sandbox) and
completes with the resource-limit design below.

Required spike 2 (real corpus):

1. Fetch 30–50 real CC-licensed Shadertoy shaders through the API with
   license filtering, at analysis time only — never redistributed.
2. Measure honest pass rate; classify failures (expect sampler-param to
   dominate). Decide: import-layer rewrite pass vs upstream naga PR.
3. Define resource limits: loop/complexity caps, compile timeout, source
   size cap (existing 50 KB custom cap is the reference point).
4. Design license/attribution UX: paste-to-import is the clean path;
   Shadertoy's default license is CC BY-NC-SA — attribution metadata must
   survive `.avshader` export.
5. Map naga diagnostics back to user source lines (subtract wrapper header,
   same pattern as `compilePresetCheck`).

Acceptance gate for approving implementation:

- Measured corpus success rate is high enough to make import useful.
- Unsupported behavior has clear diagnostics.
- Resource limits prevent accidental or hostile GPU abuse.
- Attribution/license data survives import and export.
- Selected architecture preserves Beatform's preview/export contract.

Do not market “thousands of compatible shaders” before measured pass rate and
redistribution rights exist.

### FEAT-003 — Community preset index

**Status:** IN PROGRESS — owner decisions locked 2026-08-04:

- **Home:** GitHub org `beatform-app` (owner-created; 0langa auth has org
  admin — verified push/admin on repos). Public contact:
  `beatformapp@gmail.com` (custom domain later, needs domain first).
- **Repo:** `beatform-app/gallery`; in-app label **"Gallery"** (rename-able
  later if scope grows). Content lives IN the repo; the app fetches
  commit-pinned `raw.githubusercontent.com` URLs (immutability by
  construction); removal = tombstone.
- **Launch types:** looks (.bfpreset-class) + themes; type enum extensible.
- **License:** repo MIT; per-entry required license field, CC0-1.0 or
  CC-BY-4.0 only at launch.
- **Moderation:** owner-curated only (0langa merges every PR).
- **Seed content:** agent-generated candidates, owner validates; bar =
  impressive/visually stunning, shows Beatform's ceiling, inspires user
  submissions.
- Skeleton (registry schema + hand-rolled validator + CI + submission
  template + policies) generated into the repo by agent 2026-08-04.
- ~~GATE before public launch: EXT-RENAME below~~ **CLEARED 2026-08-05**
  (`.av*` → `.bf*` shipped in v2.70.0; FEAT-004 gate cleared with v2.69.0).
  Remaining before public launch: seed presets + in-app Gallery browser.

### EXT-RENAME — file extensions `.av*` → `.bf*`

**Status:** DONE — **shipped in v2.70.0** (2026-08-05). Owner-approved
2026-08-04 with **no backwards compatibility** (current userbase = for-fun +
e2e helpers). Full inventory was five formats, not the three first listed:
`.avproj`, `.avpreset`, `.avtheme`, `.avbuilder`, `.avshader` → `.bf*`.
Clean break went one level deeper than the filename on purpose: the JSON
`kind` discriminators inside the files renamed too (`"avproj"`→`"bfproj"`
etc.), so pre-rename files are rejected at the kind gate even if hand-renamed
— nothing legacy can leak into Gallery-hosted content, which is hash-pinned
forever. In-app state (localStorage looks/params/caches) stores bare
documents without kind wrappers, so nothing user-local was lost; the
schemaVersion migration chain is untouched (localStorage still rides it).
41 files touched (dialog filters, drop handlers, accept attrs, autosave
filename, error strings, docs/, TESTING.md, SECURITY.md); CHANGELOG history
and this ledger's historical entries intentionally keep the old names.
Gates: typecheck/lint/prettier clean, 1110 web + 108 Rust tests green,
clippy clean. Gallery skeleton updated in the same push. Gallery
public-launch gate: CLEARED.

### FEAT-003 original design notes (kept)

**Dependency:** FEAT-001 only if index will include GLSL/Shadertoy content.

Existing foundation:

- Theme/user-preset parsers and shader compile validation already exist.
- Current CSP permits `raw.githubusercontent.com`.
- Local persistence already exists for user content.

Required design:

- Start with a small reviewed registry, not an empty browser.
- Registry record must include:
  - Stable ID and immutable content URL.
  - SHA-256.
  - Preset type and schema version.
  - Author, source, license, and attribution.
  - Minimum Beatform version.
  - Preview asset and its hash.
  - Declared byte size.
- Download flow:
  - Enforce origin and byte-size limits.
  - Download to memory or quarantine.
  - Verify hash before parse.
  - Parse and compile before preview.
  - Show permissions/attribution.
  - Persist only after explicit user install.
- Define index moderation, removal, broken-link, and malicious-update process.
- Seed enough high-quality presets to justify discovery UI.

Acceptance gate:

- Immutable and verified content path.
- No arbitrary remote code or silent replacement.
- Clear license/attribution UX.
- Offline behavior is graceful.
- Registry has useful reviewed content at launch.

### FEAT-004 — Best-possible local automatic lyrics

**Status:** DONE — **shipped in v2.69.0** (2026-08-04). All four phases device-proven same day: spike (GO + 3 adjustments), sidecar+model manager+line LRC (Madness 29 lines, 3 crashers caught pre-user), word alignment (29/29 lines word-timed, conf bimodal, aligner corrects whisper stamps), correction editor (byte-identical round-trip, per-line re-align, red/amber flags). Gates: 1110 web + 108 Rust tests, device E2E exit 0 each phase. Evidence: feat004-* dirs on devstorage + models release v1. Approval gate met on every item: quality > whisper-only (isolation+VAD+alignment), fully local practical (4 min GPU / 15-18 min CPU per song, honest estimates), MIT/Apache only, costs explicit pre-download, correction UI makes imperfect output useful. Open (recorded): whisper Vulkan self-build benchmark; measured-RTF estimate refinement; language picker UI. Originally: IN PROGRESS — owner approved 2026-08-04 (order swapped with
FEAT-003; owner does the index repo setup in parallel). Desk research
complete same day; full cited report at
`F:\agent-devstorage\shared-cache\audio-visualizer\artifacts\feat004-research.md`.

**Research verdict (2026-08-04):** fully-local pipeline is feasible on the
reference machine (i5-1135G7/Iris Xe) with an all-MIT/Apache stack and zero
Python. v1 architecture: one Rust sidecar exe (ffmpeg-sidecar supervision +
license-isolation pattern) — UVR MDX-Net vocal ONNX (~50–70 MB, MIT) via
`ort` for isolation → whisper.cpp (MIT, Vulkan ~12× on Intel iGPUs;
medium/small default, large-v3-turbo documented WORSE on sung vocals) →
wav2vec2-base-960h (Apache-2.0) ONNX emissions + ~100-line Rust CTC Viterbi
for word alignment (whisper's own word stamps are ±100–400 ms — not
karaoke-grade). Separation-as-VAD segmentation matches the published
open-source SOTA lyrics recipe (arXiv 2506.15514). ~5–10 min per 4-min song
on the reference machine, cancellable. Models download on first use
(0.6–2 GB user-chosen tier) from a Beatform-owned GitHub models release,
SHA-256 pinned. EXCLUSIONS found: torchaudio MMS aligner /
ctc-forced-aligner weights are CC-BY-NC (poison for free OSS); Demucs v4 =
RTF ≈ 1.0 + unclear weight license → optional HQ tier later, not v1.
Ledger corrections: no lyrics editor exists today (only LRC/SRT import +
styling) — the correction UI is NEW work and the hero feature; the karaoke
wipe interpolates line duration and needs a per-word schema + wipe upgrade.

**Phases:** (1) legal/eval spike — frozen corpus, license/hash matrix,
measured RTF/WER on device; (2) isolation + transcription → line-level LRC
(already-shippable value); (3) word alignment + A2 word-tag LRC + parser/
schema/wipe upgrade; (4) correction-editor polish.

**Phase 2 STARTED 2026-08-04** (worktree agent on `feat/lyrics-p2`: sidecar + model manager + line-level LRC UI; dense-mix validation track = owner-supplied Muse - Madness.flac on devstorage). **Phase 1 COMPLETE 2026-08-04 — verdict GO with three adjustments** (full
data: `F:\...\artifacts\feat004-spike\REPORT.md` + license-hash-matrix +
5-track PD corpus + stems + 14 runs, all KEEP-marked; models ~2.7 GB cached):

- Every stage ran on the reference machine with release-pinnable artifacts.
  Voc_FT isolation clean (synthetic-instrumental control collapsed to
  −67.9 dB — no hallucinated vocals); wav2vec2 CTC leg real and cheap
  (logits [1,1499,32] @ 20 ms resolution, RTF 0.095 CPU); whisper medium
  measurably better on sung text than small; word stamps drift up to ±1 s on
  held notes → forced alignment justified.
- **Adjustment 1 — thermals:** sustained CPU RTF is 2–3× cold (MDX 0.85 →
  1.86–2.45). CPU-only 4-min song ≈ 15–18 min, not the research's estimate.
  Time-estimate UX must use sustained numbers.
- **Adjustment 2 — DirectML inverts per stage:** MDX via DML RTF 0.52 (4–5×
  win, default-when-available); wav2vec2 via DML 4× SLOWER than CPU (CPU
  only). Whisper Vulkan: NO official Windows binary exists — phase-2
  build+benchmark task, not an assumption. GPU-assisted 4-min song ≈ 4 min.
- **Adjustment 3 — separation-as-VAD, not naive stem feeding:** on this
  vocal-forward PD corpus the stem did not improve Whisper text and the
  full mix segmented into nicer musical lines; stem stays mandatory for
  alignment + no-vocals detection (per arXiv:2506.15514). Dense-mix benefit
  needs an owner-supplied modern track in phase 2.
- Licensing: Voc_FT MIT per UVR README but no license file beside weights
  and UVR's LICENSE link 404s today (evidence archived) — phase 2 credits
  UVR in-app + mirrors vetted hashes; production wav2vec2 ONNX self-exported
  from Apache-2.0 facebook safetensors (community export lacks license tag).
- Default download ≈ 0.65 GB (small tier); medium opt-in +1.53 GB; peak
  stage RAM 3.3 GB — sequential-stage-safe on 16 GB.

**Phase 2 COMPLETE 2026-08-04 — isolation + transcription → line-level LRC,
on branch `feat/lyrics-p2` (release is central):**

- New workspace sidecar `src-tauri/lyrics-sidecar` (separate exe, ffmpeg
  pattern): ort `=2.0.0-rc.13` load-dynamic against the pinned official
  onnxruntime.dll 1.22.1 (DirectML build) + DirectML.dll 1.15.4, both
  nupkg- and per-DLL-SHA-256-pinned in `scripts/fetch-onnxruntime.mjs`;
  whisper.cpp v1.9.1 zip pinned in `scripts/fetch-whisper.mjs`. The MDX
  STFT is a Rust/realfft port of the spike's verified loop — stem RMS
  −16.52 dB vs the spike python stem's −16.4/−16.5. All three adjustments
  implemented: sustained-RTF estimates, DML-default-with-detected-CPU-
  fallback, whisper on the FULL MIX + separation-as-VAD post-split
  (hallucination drop / run-on split / trusted-empty-silent-stem rule).
- Model manager: manifest pinned in `lyrics.rs` (a test pins the pins);
  `beatform-app/models` release `v1` is LIVE and GitHub's own asset digests
  match the matrix byte-for-byte; Range-resume + streamed SHA-256 before
  the final name; device-E2E proved download→cancel→RESUME→verify against
  the real release. UI: Text tab "Generate lyrics" with tier picker
  (small 554 MB / medium +1.53 GB), DML-probe-split time estimate,
  staged progress + cancel; result lands through loadLyricsText — the
  import path, unchanged.
- Owner's dense-mix test (Muse – Madness, 341 s) through the real store
  flow: 29 musically-segmented lines, 270 s warm (615 s thermally
  degraded), isolate DML RTF 0.73, whisper small RTF 0.53, VAD found
  238 s of vocals; stem-vs-mix shared-vocab 96 % (text parity — exactly
  adjustment 3). Transcript + stem archived under
  `F:\...\artifacts\feat004-p2-e2e\`.
- Phase-3 prep DONE: first-party wav2vec2 ONNX export from the Apache-2.0
  safetensors (optimum), MatMul-only dynamic int8 (122 MB), argmax-
  identical to fp32 AND to the reference copy; uploaded to the same
  release with vocab.json.
- Gotchas for the ledger: reqwest `rustls-no-provider` PANICS without an
  installed provider (the updater installs its own — never inherit that
  accident); ORT DirectML wedges/fast-fails in DLL_PROCESS_DETACH → the
  sidecar exits via TerminateProcess after flushing its result; a REAL
  mid-inference DML crash (0xffffffff, hot package) is handled by a
  one-shot announced CPU retry in the store action; CDP evals cannot
  resolve bare import specifiers → `__invoke` dev hook; optimum 2.x moved
  ONNX export to `optimum-onnx`; non-virtual workspace root = bare cargo
  commands skip member crates (CI now `--workspace`).

**Size:** Multi-release epic. A cheap Whisper-only MVP is explicitly rejected.

Target pipeline:

1. Demucs-class vocal isolation.
2. Whisper-class transcription.
3. wav2vec2-class forced alignment.
4. Musical line segmentation.
5. Enhanced LRC output with per-word timing.
6. Correction UI for text, words, lines, and timing.

Research required before architecture:

- Freeze a legal evaluation corpus spanning clean vocals, dense mixes,
  accents, languages, rap, live material, harmonies, and instrumentals.
- Build model/license/runtime redistribution matrix.
- Measure word error rate, timestamp error, line segmentation quality, runtime,
  peak RAM/VRAM, model disk usage, and output stability.
- Design model manager:
  download source, hashes/signatures, versions, disk estimates, cancellation,
  resume, removal, and offline errors.
- Define CPU, integrated-GPU, and discrete-GPU fallbacks.
- Preserve existing manual/imported lyric workflow.
- Define job progress, cancellation, crash recovery, and partial-result rules.

Approval gate:

- Quality materially exceeds a Whisper-only path.
- Fully local operation is practical on supported Windows hardware.
- Models and runtimes are legally redistributable.
- Disk, time, and hardware costs are explicit before download/run.
- Correction workflow makes imperfect output useful.

### FEAT-005 — Genuine 10-bit HEVC/AV1 export

**Status:** DONE — **shipped in v2.67.0** (2026-08-03). Every acceptance-gate
item met with independent evidence:

- **Implementation** (two worktree agents + central integration, all merged
  via `feat/av1-10`): `fs_final` deep variant renders into an offscreen
  `rgba16float` target with `COPY_SRC` (zero new shader text — the same
  fs_final WGSL, so preview===export holds by construction); readback strips
  256-byte row padding and a 65536-entry LUT converts f16→u16
  (`webgpuRenderer.ts` `setDeepCapture`/`readbackDeepFrame`,
  `deepFrameToRgba64`). `ExportJob.deepColor` + `hooks.onRawFrame` in
  exportCore (awaited = ffmpeg-paced backpressure; rejects png-mode and
  loop-crossfade combos). Worker relay mirrors frame/frameAck as
  rawFrame/rawFrameAck, one transferred frame in flight, abort releases the
  pending ack. Rust `av1_begin` reuses the ProRes sidecar verbatim with the
  arg vector `-f rawvideo -pix_fmt rgba64le … -c:v libsvtav1 -preset 6
-crf 24 -pix_fmt yuv420p10le` + explicit bt709/tv flags (cargo contract
  test pins it). New format `"av1-10"` (a format like prores, NOT a
  VideoCodecId), desktop-gated "AV1 10-bit" UI, preflight at 0.15 B/px-frame.
- **Independent inspection:** `scripts/deepcolor-verify.mjs` (ffmpeg leg,
  synthetic u16 ramp): av1 + yuv420p10le + bt709 metadata, **880 distinct
  decoded luma levels** (8-bit ceiling 256).
- **Beyond-8-bit end to end on device:** `scripts/av1-e2e.mjs` drives the
  debug shell over CDP through a REAL export (tunnel preset, 8 s, 640×360):
  final raw frame carries **4961 distinct u16 red values**; the finished
  .mp4 decodes back to **752 distinct 10-bit luma levels**. (Needs Vite dev
  on 127.0.0.1:1420; uses debug-only `debug_allow_path` — a hard error in
  release builds — to stand in for the save dialog's `allow_file`.)
- **No regression:** GPU pixel matrix 137 cases zero hash changes (deep
  capture defaults off); 1032 vitest + 54 Rust tests green.
- **Deterministic:** two independent device E2E runs produced
  **byte-identical** .mp4 files (663881 bytes, same level counts) — the
  determinism law holds through the deep tap AND the SVT-AV1 software
  encoder.
- **Unsupported hardware is a non-issue by construction:** libsvtav1 is
  software encoding via the bundled pinned ffmpeg — no hardware gate, no
  fake label. Slow machines just encode slower.

**Shipped follow-up still open (recorded, not yet done):** switch the ProRes
frame payload from 8-bit PNG to the same `rgba64le` pipe so ProRes 4444
becomes genuinely deep (today ffmpeg merely widens 8-bit PNGs to
`yuva444p10le`).

<details>
<summary>Original architecture decision (2026-08-03, pre-implementation)</summary>

**Decisive map findings (file:line verified):**

- The 8-bit boundary is `fs_final` targeting the swapchain
  (`webgpuRenderer.ts:2169`, fast path `:3112`); EVERY export lane sits
  downstream of it — **including ProRes, whose "10-bit" `yuva444p10le`
  output is fed 8-bit canvas PNGs** (`exportCore.ts:808`) that ffmpeg merely
  widens. The same honesty class as the old canvas2d findings; the new tap
  fixes it as a follow-up.
- No high-precision readback exists anywhere; `sceneTex` lacks `COPY_SRC`
  (`:1979`, one-token change), and the correct tap is NOT sceneTex (that is
  pre-tonemap HDR) but a **new `fs_final` variant rendering
  post-tonemap-pre-quantize into an offscreen `rgba16float`** target, with
  the neutral-post fast path forced off in 10-bit mode.
- Sidecar plumbing (`prores.rs` begin/write/finish/abort + WAV staging +
  backpressure chain in `exportActions.ts:236-356`) reuses essentially
  verbatim. The bundled pinned ffmpeg has `libsvtav1` + `yuv420p10le`
  (pin-implied capability; the pin hash IS the probe).
- "AV1 10-bit" must be a **format** (like `prores`), NOT a `VideoCodecId` —
  codec ids route through the WebCodecs probe and mediabunny's 8-bit lane.

**Decided architecture:**

1. Renderer tap: `COPY_SRC` on the offscreen 16f target; new `fs_final`
   variant + `copyTextureToBuffer`/`mapAsync` readback returning f16 rows;
   WGSL or CPU converts to `rgba64le` u16 (linear scale of the tonemapped
   0..1 output, ×65535).
2. Pipe `-f rawvideo -pix_fmt rgba64le -s WxH` into ffmpeg; RGB→YUV in
   swscale with EXPLICIT bt709 matrix/primaries/trc + tv range flags (this
   is the "documented conversion"; swscale dithers on 16→10 reduction);
   `-c:v libsvtav1 -pix_fmt yuv420p10le` + native aac; mp4 container.
3. New `ExportSettings.format: "av1-10"`, desktop-gated UI beside ProRes,
   preflight/batch/buildExportOptions plumbing mirroring prores exactly.
4. Verification harness (the acceptance gate — no existing tool measures
   exported pixel fidelity): export a smooth synthetic gradient, ffprobe
   asserts `yuv420p10le` + bt709 metadata, decode back to 16-bit raw and
   assert >256 distinct levels across the gradient (proves beyond-8-bit
   information survived end to end), plus deterministic double-run hashes.
5. Follow-up once the tap is proven: switch the ProRes frame payload from
   8-bit PNG to the same `rgba64le` pipe, making ProRes genuinely deep.

**Size:** Rendering/export architecture project, not a codec-string change.

Current truth:

- Scene rendering uses `rgba16float`
  (`src/render/webgpuRenderer.ts`).
- Final presentation/export crosses the current canvas/video-sample path
  (`src/export/exportCore.ts`).
- That path does not prove 10-bit pixels reach the encoder.
- Codec capability probes alone cannot establish end-to-end bit depth.
- Previous host probe accepted raw `I420P10` construction, but reported HEVC
  Main10 and AV1 10-bit encoding unsupported on that machine while 8-bit was
  supported.
- **2026-08-01 sidecar probe:** the bundled LGPL ffmpeg (n8.1.2-34) ships
  `libsvtav1` supporting `yuv420p10le` — software 10-bit AV1 encoding with
  ZERO hardware dependency — plus `librav1e`/`libaom-av1`, hardware AV1/HEVC
  encoders (NVENC/QSV/AMF/MediaFoundation), and the existing 10-bit
  `prores_ks`. The "unsupported hardware" blocker therefore dissolves for a
  sidecar-based path: WebCodecs hardware support becomes an optional fast
  path, not a gate. The honest-pixel-pipeline architecture work (items 1–8
  below) is unchanged and remains the real project.

Required architecture work:

1. Define supported bit depths, chroma formats, transfer functions, primaries,
   range, alpha rules, and container metadata.
2. Build explicit `rgba16float` → 10-bit YUV conversion with documented
   tone/gamut mapping and dithering.
3. Avoid any implicit 8-bit canvas readback in the 10-bit path.
4. Probe Main10 codec configurations and distinguish:
   - WebCodecs hardware path.
   - Unsupported hardware.
   - Optional local fallback such as bundled/managed FFmpeg, if legally and
     operationally acceptable.
5. Verify encoded bitstream and container metadata using an independent parser.
6. Decode back to high precision and measure gradients, clipping, and banding.
7. Test GPU/driver/codec matrix and deterministic fallback behavior.
8. Decide whether unsupported machines hide, disable, or redirect the option.

Acceptance gate:

- Independent inspection proves 10-bit coded output and correct metadata.
- Pixel tests prove information beyond 8-bit survives end to end.
- Preview/export color transform is documented and visually controlled.
- Unsupported hardware fails clearly; no fake “10-bit” label.

</details>

### VERIFY-001 — Long-export renderer memory characterization

**Status:** DONE 2026-08-03 — no leak; both acceptance criteria met.

Method: `scripts/heap-soak.mjs` drives the debug shell over CDP through a
full-length PNG-probe export (renders every frame through the real export
chokepoints, discards frame data so no video blob contaminates the
measurement) while sampling renderer JS heap and this app's process working
sets every 15 s, plus 90 s of post-finalize settling. Two 85-minute runs
(153,000 frames each) and one 5-minute control, CSVs KEEP-marked at
`F:\agent-devstorage\shared-cache\audio-visualizer\artifacts\2026-08-02_verify-001-heap\`.

Findings:

- **JS heap: bounded plateau, dead flat.** Per-third averages 1021/1024/1024
  and 1024/1023/1023 MB across the two long runs. The plateau height IS the
  decoded track (85 min mono at the 48 kHz context rate ≈ 979 MB float32) plus
  ~45 MB app baseline — confirmed by the control scaling to ~101 MB for a
  5-minute track. Zero growth trend over 340+ samples.
- **Working set: transient cache, not retention.** Fluctuates 2–6.5 GB during
  the export with NO consistent direction (run 1 thirds rose 3.2→3.9 GB, run
  2 went 3.9→2.9→3.3 GB), and settles post-finalize to ≈ the JS heap
  (920–1090 MB long runs, 730–810 MB control). The 2026-07 `TESTING.md`
  observation (1.8→3.3 GB WorkingSet64) was this same reclaimable
  GPU/driver/WebView cache pressure.
- Post-finalize resources return to the explained baseline: the decoded
  track stays loaded by design; everything else is released.

No app code was added — the sampling is entirely harness-side (CDP +
PowerShell), so there is no diagnostic flag to remove. No follow-up item.
Reopen only with a reproducible OOM or a post-finalize baseline that stops
matching the decoded-track explanation.

Original research plan kept for the record:

**Priority:** Medium; not a proven leak or a v3 blocker.

Existing evidence in `TESTING.md`:

- An 85-minute export completed correctly and faster than real time.
- Prior leak symptom did not recur.
- Memory released after finalization.
- Renderer `WorkingSet64` rose roughly 1.8 GB → 3.3 GB during the run.

Gap:

Working set growth can be resident cache and does not identify live JavaScript
objects. Need renderer-level heap evidence.

Action:

- Add opt-in diagnostic sampling using `performance.memory` where available and
  `measureUserAgentSpecificMemory` where supported.
- Sample at fixed wall-clock intervals during a representative long export.
- Correlate JS heap, process working set, frame count, decoded media caches,
  encoder queues, and post-finalize settling.
- Repeat at least twice with the same project and once with a short control.
- Remove or keep diagnostics behind an explicit developer flag.

Acceptance gate:

- Heap curve reaches a bounded plateau or retained growth has an identified
  owner and reproduction.
- Post-finalize resources return to an explained baseline.
- Any confirmed leak gets its own focused work item and regression test.

### VERIFY-003 — Web MIDI browser-to-adapter transport

**Status:** DONE 2026-08-04 — and it found the feature dead on the shipped
transport. Full table in `TESTING.md`; fixes in `2e6bfbb`, ship with the
next release.

- **Finding 1 (frontend):** `startMidi` called `requestMIDIAccess` unbound —
  "Illegal invocation" on every real Chromium, silently converted to the
  "MIDI isn't available" notice. Spoofed doubles never caught it (plain
  functions have no receiver requirement). Fixed: method call on navigator.
- **Finding 2 (WebView2):** Chromium's MIDI permission gate surfaces as
  `PermissionRequested` kind 11 and is silently denied when unhandled. New
  `midi_permission.rs` allows that kind for the app's own origins only,
  installed from `on_page_load` (in `setup` the window doesn't exist yet).
- **Proof:** `scripts/midi-e2e.mjs` against loopMIDI (`loopMIDI Beatform`,
  teVirtualMIDI 1.3.0.43) with a winmm sender: permission + discovery + CC
  learn + CC apply (exact scaling, exactly one change per message) + note
  learn/preset switch + disable/re-enable with still exactly one change per
  message. Acceptance gate met.
- **Scope:** physical hot-plug (port add/remove mid-run) not driven — the
  owner's loopMIDI stays untouched; `onstatechange` re-attach covered by the
  reconnect cycle + review. Reopen only if a real controller misbehaves.

Original entry for the record:

**Status (historical):** READY  
**Priority:** Low.

Existing evidence:

- Pure MIDI mapping and state chain are tested.
- Spoofed/manual mapping behavior passed.
- Physical controller purchase was rejected as unnecessary.

Gap:

`navigator.requestMIDIAccess()` through the real adapter has not been verified
against a real or virtual MIDI port.

Action:

- Install a reputable free virtual MIDI loopback driver.
- Send note and CC messages from a local test client.
- Verify permission prompt, device discovery, hotplug, note-to-mode mapping,
  CC-to-setting mapping, reconnect, and shutdown cleanup.
- Record exact driver/version and results in `TESTING.md`.

Acceptance gate:

- At least one real browser MIDI transport path passes end to end.
- No stuck subscriptions or duplicate messages after reconnect.
