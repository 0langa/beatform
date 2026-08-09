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

Surface names (decided 2026-08-07 as P-2, shipped v2.80.0; the dock's name
revised again in v2.81.0). Older entries in this ledger use the retired
words; they are left as written:

- **Visuals** — the right-hand dock (**G**). Was "Visual settings" or "the
  settings panel", then **Inspector** for exactly one release (v2.80.0).
  **Renamed again in v2.81.0 and superseded: "Inspector" is retired.** The
  owner's reason: it names a kind of window, not what the button reveals.
  Entries in this ledger written before v2.81.0 say "Inspector"; they are
  left as written and mean this surface. The persisted keys moved with the
  word (`inspectorPage`/`inspectorWidth` → `visualsPage`/`visualsWidth`) —
  free, because they had never shipped; after v2.81.0 that costs a
  migration.
- **Preferences** — the Ctrl+, app dialog. Was "App settings". Unchanged by
  v2.81.0 — only the dock was renamed.
- **Control** (or **parameter**, where "control" would collide with the
  verb) — one knob or toggle. **The bare word "settings" is retired from UI
  copy**, with exactly one exemption: "Windows Sound settings", which names
  an OS surface and is capitalized so it reads as a proper noun. Type names
  (`BgSettings`, `ExportSettings`…) and persisted ids are unaffected — P-2
  bans UI copy, not code.

### Track A — Gallery correctness + naming — DONE, shipped v2.73.0 (2026-08-06)

- [x] A1 Install-state truth. Looks: "✓ Added" must track the installed
      look's actual existence — record galleryId → userPresetId at install;
      deleting the look in Visual settings reverts the button to
      "+ Add look". Added state DISABLES the button (today it stays
      clickable and stacks duplicates — owner repro). Themes: applying is
      legitimately repeatable — show a transient "Applied ✓" then return
      to "Apply theme"; no persistent Added state at all ("New Project"
      made the lie obvious).
- [x] A2 Look-vs-theme explainer inside the Gallery dialog (one line each,
      near the filters; type badge tooltips say it too).
- [x] A3 Deep links: the Themes-section shortcut opens the Gallery
      pre-filtered to **Themes**; a matching shortcut in the styles/My
      Looks row opens it pre-filtered to **Looks**.
- [x] A4 Naming sweep per the vocabulary above: "Templates" section
      becomes "Themes", save-dialog filter names, toasts, hints, README,
      docs/, CHANGELOG copy going forward.
- [x] A5 Gates + device e2e extended to cover A1 semantics (delete-look
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
      Recommended queue in the table below (OWNER RESHUFFLES BEFORE WAVES
      START); wave 0 = F5 WGSL consolidation + param-schema
      taper/mod-metadata first.

#### B0 recommended queue

| #   | Mode                    | Effort            | Why here                                                 |
| --- | ----------------------- | ----------------- | -------------------------------------------------------- |
| 1   | voice-orb               | S                 | Depth already built; pure curation — proves the template |
| 2   | aurora                  | M                 | The canary; unblocks C3's hand-tuned look                |
| 3   | synthwave               | M                 | Road/sun/skyline = genre-defining absences               |
| 4   | led-matrix              | S                 | Waterfall scroll = spectrogram-lite archetype            |
| 5   | spectrum-bars           | S                 | Default mode; stereo split rides unread `width` lane     |
| 6   | bass-circle             | S                 | Cover-art core lifts from radial-burst                   |
| 7   | particles               | S                 | Color tier + snare shooting stars                        |
| 8   | nebula                  | S                 | Kills RP-6 sat-drift; palette phase; star parallax       |
| 9   | echo-trails             | M                 | Source-shape enum multiplies identity                    |
| 10  | metaballs               | M                 | Lava smear + per-band blob weighting                     |
| 11  | oscilloscope (fragment) | M                 | Multi-trace band split; XY lane → renderer block         |
| 12  | tunnel                  | S–M               | Already deep; wall materials = safe filler               |
| 13  | spectrum-scape          | L (renderer wave) | ABI growth; biggest ceiling raise                        |
| 14  | particle-flow           | M–L (renderer)    | PU struct growth; trails = separate LARGE call           |
| 15  | oscilloscope XY lane    | M (renderer)      | Lands while ABI is open                                  |
| 16  | builder2 RP-20 bridge   | M–L               | Biggest unlock, own project; pull earlier if C1 needs    |
| —   | radial-burst            | —                 | Leave alone — it IS the bar                              |

B0 surprises worth reading in the matrix: hint coverage is 359/359 (wave
hint-work = touch-ups only); curated-tier GROUP holes don't follow param
counts (metaballs has zero beat-response in main; led-matrix hides
motion+beat in advanced); styles under-exercise enums (`coverFit` set by
NO style anywhere). NEW defect from B0: led-matrix canvas2d fallback
loses hue entirely to a `hueShift` key mismatch (+ builder2 canvas2d =
all-default bars) — added to the severity-2 pool.

**Owner decisions locked 2026-08-06 (click-round):** queue = B0 order
as ranked · renderer-ABI waves INCLUDED after the fragment waves ·
Builder bridge stays #16 (last) · **full license for new drawn elements**
per the matrix sketches (defaults stay pixel-identical) · **styles:
follow the sketches freely, including reworking weak existing styles
(their look may change)** · re-bless authority: agent-side — device
before/after shot strips per mode, owner veto post-hoc · cadence: one
2.x release per 3-4-mode batch · AX-1: "Kicks" gets REAL kick semantics
(default reactivity becomes punchier; not a silent fall-through).

Execution plan: **Wave 0 DONE 2026-08-06** (F5 + RP-14 schema `taper`/`mod`
— 29 params mod:"off", 15 mod:"snap", nebula scale log-taper proving case —

- AX-1 real kick semantics, one deliberate trace re-bless; device matrix
  zero movement) → then **Batch 1 DONE
  2026-08-06** (voice-orb satellites/ring-styles; aurora
  palette-family/5-curtains/moon/horizon; synthwave road/banded-sun/
  skyline; led-matrix Waterfall spectrogram + canvas2d hue fix; 14 new +
  6 reworked styles; defaults pixel-identical on device except
  led-matrix's declared feedback-path LSB class; matrix re-blessed
  137→151 with strip evidence at devstorage depth-batch1-strips;
  shipped v2.74.0 2026-08-07 — GitHub tag-webhook outage bypassed via new
  release.yml workflow_dispatch escape hatch) → **Batch 2 DONE, shipped
  v2.75.0 2026-08-07** (spectrum-bars stereo/caps/reflection/trim;
  bass-circle segments/beat-bokeh/authored-core + spin promoted;
  particles color-tier/snare-meteors/constellation; nebula v14 saturation
  migration + duo-palette/stars/wind; 15 new + 7 reworked styles; matrix
  151→168, all four @defaults device-identical, 7 changed hashes all
  declared; strips at devstorage depth-batch2-strips) → **Batch 3 DONE,
  shipped v2.76.0 2026-08-07** (echo-trails source enum incl cover-art
  accumulator + off-axis vortex + warp fields; metaballs smear/
  bassWeight/eccentric/environment + beatSwell promoted, feedback
  reclassification = pre-declared metaballs-family LSB class;
  oscilloscope multi-trace split + beam/dots/sample-hold + graticule +
  persist promoted; tunnel hex/wireframe/organic materials + cover-wall
  mosaic + junctions + centerGlow promoted; 20 new styles; matrix
  168→188 with 160 identical and 8 changed all pre-declared; strips at
  devstorage depth-batch3-strips) → **Renderer block DONE, shipped
  v2.77.0 2026-08-07** (spectrum-scape M3U 112→192: beat-response/color
  tier/layouts/bar shapes/light+fog, 13→27 params, first 3D deck 7→12
  — integration added m3_desat env grading for the grayscale contract;
  particle-flow PU 96→144: field families jet/vortex-street/orbital,
  ring/line attractors, mid+treble routing, ribbon streaks, backdrop,
  deck 7→14; oscilloscope-XY: planar-stereo binding 11 + waveformL/R
  cut at ONE shared trigger, waveAt2/waveXY prelude, XY/Lissajous
  display + xyRotate goniometer, 3 styles — strictly additive, waveAt
  byte-identical; matrix 188→204→207 with ZERO existing-hash movement
  across both re-blesses; strips at renderer-block-strips; XY proven on
  real stereo tracks) → **Builder bridge DONE, shipped v2.78.0
  2026-08-07 — TRACK B COMPLETE** (RP-20: virtual ParamSpec list
  `l<i>.opacity/hue/hueSpread` + `l<i>.<paramKey>` generated at makeDef
  time so the compiled def carries real params+groups and the WeakMap
  enumeration caches are correct by construction; builderStack stays the
  persisted truth with a derived paramsByPreset mirror; ONE shared
  `packBuilderFrame` chokepoint in live loop + export worker routes
  mods/automation/MIDI into the storage buffer with dirty-checked
  uploads — zero WGSL change; 6 factory stacks as chips
  (classic/neon-club/sunset-drive/deep-space/cathedral/phosphor);
  builder2 looks + resetParams + timeline laneSpec now real; matrix
  207→213, six additive `builder2/stack/*` cases, every pre-existing
  hash byte-identical; shots at 2026-08-07_builder-bridge-factory-stacks).
  One release per batch.

* [x] B1..Bn Per-mode upgrade waves in the B0-ranked order — ALL DONE
      (batches 1-3, renderer block, builder bridge; v2.74.0–v2.78.0).

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

- [x] D1 **DONE (docs truth pass, 2026-08-09).** The 12-section staleness
      sweep landed: every section read against the live code, a **Gallery**
      section added (13 now — `docs/guide.md`'s section count updated with
      it), and the Style/Look/Theme/Gallery vocabulary defined in one place
      on the Projects section. Corrected FALSE claims, not phrasing: the
      Preferences section listed neither the **Modes** tab, preview
      resolution nor Performance display (the same hole D2 fixed in
      `docs/guide.md` in v2.80.0 — the in-app copy was never touched);
      "every shortcut is a letter or digit" (Space, arrows, `?`, `[ ] \ .`
      all exist — the truth is _primary_ bindings are letters/digits, the
      punctuation aliases are `e.code`-bound); "Every mode has Styles"
      (Builder has none — it has six stack presets); post chain missing
      Filmic tonemap and Bloom threshold; background Image "cover-fit"
      (it is Fill/Fit/Stretch + zoom + pan); the background scope switch
      labels; lyric animation labels; audiogram Position (Top/Bottom only,
      not free); the transition list missing Wipe ↑; the export list missing
      **AV1 10-bit** and mis-filing Canvas loop as a format; "Match cover
      colors" attributed to Bass Circle alone; Builder's "orb" (Orb core).
      The Modulation paragraph was rewritten for v2.83.0 — target-first
      cards, depth, curve/rise/fall, six recipes, LFO sources, the **Driven
      by** meters and the **driven** mark on the sliders themselves.
- [ ] D2 README + docs/ site + gallery-repo docs same sweep. **README,
      `docs/index.md`, `docs/guide.md` and `docs/templates.md` done in
      v2.80.0** (surface names + Template→Theme residue + the Preferences
      tab inventory, which had never listed Modes or Performance; the
      factory-pack names in `docs/index.md` named four themes that have not
      existed since the seed set was rebuilt). **Second pass 2026-08-09**
      re-ran all four against the code and fixed what v2.80.0's naming pass
      did not look at: README's "5-7 curated factory styles" (it is 6-14),
      its Preferences one-liner (same missing tabs as D1), its sync-source
      list (missing snare/hats), its "letter/digit keys only" claim, its
      "cover-fit image", and a **Dev section that named only
      `fetch-ffmpeg.mjs`** while `tauri build` needs whisper, onnxruntime
      and the lyrics sidecar too — plus a CI line that claimed five web
      gates when CI also runs cargo fmt/clippy/test and two audits.
      `docs/templates.md` advertised `projectSchemaVersion: 6`; the app
      writes **14**. `docs/presets.md` told new preset authors to write
      "5–7 curated looks". **Gallery-repo docs DONE 2026-08-09** (cloned,
      audited against `src/state/gallery.ts`, pushed as `beatform-app/gallery`
      `9e8a132`). Three real errors, two of them security-relevant because
      they OVERSTATED the protection: (a) "before downloading, the app checks
      the declared `sizeBytes` and enforces it as a hard limit" — it does not.
      `verifiedFetch` awaits the whole body, then requires an EXACT match; what
      genuinely runs pre-download is the index-parse rejection of any entry
      declaring over `MAX_CONTENT_BYTES` (32 MB / 512 KB preview) plus the
      `entryGate` minAppVersion+schemaVersion check, which `galleryActions`
      does call before `fetchEntryContent`. (b) tombstones were described as
      "optionally pointing at a successor via `replacedBy`" as if the app
      followed it — `gallery.ts` never reads that field, and a tombstoned
      entry returns `null` at parse before anything could. (c) the worked
      example's theme `schemaVersion` said "currently 13"; `PROJECT_VERSION`
      is **14**. Plus one retired-vocabulary hit ("full shareable templates")
      in README and `themes/README.md`. Verified clean and unchanged:
      `looks/README.md`, `SECURITY.md`, `CONTRIBUTING.md`, the 11-entry count,
      the 2.72.0 Gallery-button claim, the licence list, the moderation
      policy. Validator green on a FULL clone — note `--depth 1` makes
      `scripts/validate.mjs` report every pin unreachable, which reads as 22
      failures and is purely a shallow-clone artefact.
      The `/templates` URL rename stays filed and OUT OF SCOPE: it breaks
      every inbound link, including external ones, and is the owner's call.
- [x] D3 **DONE (2026-08-09) — repo-wide string audit is clean in the
      surfaces this track owns.** No "Inspector" anywhere in `src/`,
      `docs/` or README. No "Template" in any rendered UI string, tooltip
      or aria-label. The two legitimate survivors are intact and were not
      touched: `SectionDef.id: "Templates"` (title reads "Looks & themes")
      and the shader editor's `NEW_SHADER_TEMPLATE` starter shader.
      Deliberately left: the word `templates` inside the Looks & themes
      section's hidden search blob (`ParamsPanel.tsx`) — it is a search
      alias, not a label, and it is the word a user coming from an older
      build would type. **Filed, not fixed** (all outside this track's
      write scope — see the D5 note): "Builder Studio" in a user-facing
      toast in `App.tsx`, and "template" as the running word for `.bftheme`
      throughout `src/state/factoryThemes.ts`, `themes.ts`, `project.ts`
      and `store.ts` comments.
- [x] D4 **CLOSED — already fixed, no work needed.** The premise held only
      until commit `cecbdaf` ("docs(changelog): restore the missing 2.74.0
      heading"): the v2.74.0 notes had been written but had **lost their
      `## [2.74.0]` heading**, so they were being absorbed into the 2.75.0
      section and `changelogNotes.ts` — which slices on `## [x.y.z]` — skipped
      the version entirely in the update dialog. The heading was restored,
      not the notes reconstructed. Verified 2026-08-09:
      `rg -n "^## \[2\.74\.0\]" CHANGELOG.md` → `388:## [2.74.0] - 2026-08-07`,
      and every heading from `[2.70.0]` to `[2.84.0]` is present and in order.
- [x] D5 **DONE 2026-08-09.** (a) fixed in `52721e9`, (b) and (c) fixed in
      `75fab1d` — comment sweep over `themes.ts` / `factoryThemes.ts` + its
      test / `project.ts` / `store.ts` / `overlay.ts`, plus two things the
      sweep found that the entry did not name: the **Assembly** factory
      theme's `meta.description` opened "Six Builder Studio layers" and IS
      rendered (the theme chip's `title`, and the Gallery), making it the
      last user-visible survivor of the retired name; and `services.ts`
      carried a dead `Settings ▸ Performance` path. Correction to this
      entry's own premise: `themes.ts` was assumed to keep "template" as
      HISTORY, so it was scoped as untouchable — it did not. All three uses
      were present-tense definitions of the live format and were corrected.
      Left deliberately: "template" in its other senses (the batch
      export-options template, the `{title}`/`{artist}` text expansion, the
      GitHub PR template) and the "Essentials" mentions in `prefs.ts`, which
      are correct history. Still open, one comment site: `webgpuRenderer.ts`
      ~2109 says `Settings ▸ Performance`; held only because another change
      was in flight in that file.
      ORIGINAL ENTRY — **naming residue outside the docs track's
      write scope.** Three findings, all reported rather than changed:
      (a) `src/App.tsx` — the Canvas2D-fallback toast tells the user
      "Builder Studio … [is] switched off"; the mode is called **Builder**
      everywhere a user can see it, and "Studio" is a retired surface word.
      One-word fix in a user-facing string.
      (b) `src/state/factoryThemes.ts`, `themes.ts`, `project.ts`,
      `store.ts` and `src/render/overlay.ts` still use "template" as the
      running word for a `.bftheme` ("Factory template packs", "Apply a
      template's document", "a template gallery"). Comments only — no
      rendered string — but it is the retired vocabulary sitting in the
      files that define the format.
      (c) **Code-truth defect, not naming:** the comment at
      `ParamsPanel.tsx:1065-1069` says collapse state "persisted as
      `Templates` must keep applying to this section". It cannot —
      `prefs.ts:295-299` filters `collapsedSections` down to entries
      prefixed `group:`, so a bare `Templates` key is pruned on read, and
      the `SectionDef.id` doc comment 670 lines above says the opposite
      ("P-1 retired in-page section collapse, so nothing reads these off
      disk any more"). One of the two comments is wrong and the id's
      justification is the wrong one. **The id itself must still not be
      renamed** — it is a React key whose churn buys nothing — but the
      stated reason should be corrected to match `prefs.ts`.

### Track E — Hardening burn-down (NEW, from the audit register)

- [x] E1 **largely DONE — hardening wave shipped v2.73.0 (2026-08-06):**
      fixed PL-1/2/3/4, SS-1/2/3, UI-1/2/3 (+UI-5 focus trap), AX-2/3/6,
      RP-1, DS-1/3 (SECURITY/CONTRIBUTING), DS-15 (gallery CI
      byte-verification, gallery repo), DS-18 (changelog links), TQ-1/2/6.
      ALIGN-002/E4 shipped v2.72.1 by the concurrent session. AX-1 shipped
      in v2.74.0 wave 0 (real kick semantics, one deliberate trace
      re-bless) — the owner's design call came in the same round. REMAINING
      from the shortlist: **RP-4** (→ E3), **DS-5/7/12** (README/guide/
      pages staleness → Track D scope), **TQ-3** (fixed), **SS-2** (fixed).
      **Correction (2026-08-08): UI-2 did not actually close in v2.73.0.**
      The panel still reconciled on the 4 Hz playback/loudness tick — the
      test that passed measured prop identity through a `memo()` boundary
      that a zero-prop component can never exercise, i.e. it was vacuously
      green. Genuinely closed in **v2.80.0** (P-12 wave 1, program-extension
      item 3): the store-direct rewrite plus a commit-count test that is red
      on the pre-migration build. Treat any "memo is now effective" claim as
      unproven until a render-count assertion backs it.
- [ ] E2 Severity-2 waves per domain (state → UI → audio/export →
      platform → render), each wave gated + released.
      **REGISTER UNREACHABLE (2026-08-09).** The severity-2 list this item
      was written against lives in the archived audit at
      `beatform-archive\v3-acceptance-2026-07-27\`, and that drive is not
      mounted — no drive under C:–H: carries it (F: is the only
      devstorage-participating volume and holds no archive). It is also
      2026-07-27 vintage, i.e. ~14 releases stale, and E1 already closed an
      unknown number of its entries in passing. Waves therefore re-derive
      against the CURRENT tree; if the archive comes back, reconcile rather
      than assume either list is complete.
      **Wave 1 (state) — PART DONE 2026-08-09.** Swept the persisted-session
      surface, which is the state domain's whole untrusted-input story that
      `parserFuzz` does not cover: file parsers read bytes the user chose to
      open, these loaders read bytes a PREVIOUS INSTALL left behind, at boot,
      before anything is on screen. `src/state/persistenceFuzz.test.ts` puts
      arbitrary stored text under all 22 keys and asserts that no loader
      throws and none returns a non-finite number anywhere in its result —
      the second one matters because `JSON.stringify` writes NaN/Infinity
      back as `null`, so a leak resets the setting one launch LATER, which is
      about as hard to trace as a bug gets. Plus a prototype-pollution
      assertion over the four per-preset maps.
      **Found: nothing.** `readJson` already try/catches, `safeSetItem`
      already degrades on quota with a throttled notice, and every loader
      routes through a `valid*` validator. Read `history.ts` for the obvious
      companion defect (unbounded redo stack — `popRedo` pushes onto
      `undoStack` with no `MAX_DEPTH` check) and it is NOT one: entries only
      move between the two stacks and `pushHistory` clears redo, so
      undo+redo is conserved at ≤ 100.
      Wave 1 is PART done because "state" is bigger than persistence — the
      document model, `modMatrix`, `frameResolve` and the store slices have
      not had the same pass. Not started: waves 2–5.
- [x] E3 **DONE 2026-08-09 — RP-4 investigated and CLOSED as NOT A DEFECT.**
      The mechanism the finding named does not exist in the code, and did not
      exist when the measurement was taken. `WebGPURenderer.create()` requests
      its OWN adapter and device every call and `dispose()` destroys it; all
      particle state is instance-private (`particleBuf`, `particleCapacity`,
      `simStepsDone`, `particleInitPending`); `setPreset` re-seeds from a pure
      hash of the particle index while zeroing the step counter; and the only
      module-level mutable binding in the 3,980-line `webgpuRenderer.ts` is a
      memoized f16 LUT. `git show da068f5:src/render/webgpuRenderer.ts`
      confirms the same structure at the time of the bisection, so the
      original conclusion was unsupported even then.
      The recorded evidence also contradicts itself: the sim is an INTEGRATOR,
      so a perturbed buffer diverges at the frame it was perturbed and never
      rejoins — "frame 9 alone, neighbours intact" is the opposite shape, and
      the "crossfade tail" is just loop mode's head/tail blend
      (`exportCore.ts:973-993`) echoing one changed head frame.
      Pinned by `src/render/particleSimIsolation.test.ts`: a real renderer
      against a recording stub device, capturing the whole particle GPU stream
      (the 1,920,000-byte seed upload, every 144-byte uniform slot, every
      dispatch), asserting that a thumbnail walk using the forbidden sim params
      leaves a later export walk byte-identical — on a separate instance AND on
      the same one. Five mutations, all red. **Methodological note worth
      keeping: mutation 2 (a module-level `seededCount`, i.e. the literal RP-4
      hypothesis) initially PASSED** — trace equality alone is blind to a leak
      that skews every run identically. Fixed by asserting the recorded walk's
      SHAPE as well. The comment at `thumbnails.ts:46` no longer asserts a bug
      that is not there; the hard rule stays, as belt and braces.
- [ ] E3a **NEW, from E3 — the residual, and it needs hardware.** What
      actually moved frame 9 was never reproduced, and RP-4's explanation is
      now ruled out. Leading hypothesis is a CAPTURE race, not a sim bug:
      `exportCore.ts:968-976` awaits `renderer.gpuDone()` and then
      `createImageBitmap(canvas)`, and `onSubmittedWorkDone` resolving is not a
      guarantee the swapchain front buffer has flipped — which produces exactly
      a one-off frame with intact neighbours, and is load-sensitive, so a
      heavier preceding thumbnail sim changes the load. **The experiment that
      settles it costs one run:** export the same Particle Flow loop twice back
      to back with NO code change and hash the PNG frames. One differing frame
      between two identical runs means the coupling never existed and the
      bisection was chasing capture noise; two hash-identical runs mean the
      original observation is real and deserves a fresh bisect.
      Also recorded from the same sweep, NOT a defect: Particle Flow's sim
      reads audio lanes per FRAME, not per STEP (`webgpuRenderer.ts:57-61`), so
      at 30 fps two steps share one feature sample and a 60 fps preview
      legitimately reaches a different particle state than a 30 fps export.
      Documented behaviour, and the stated reason hash baselines are only ever
      compared at equal fps.
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

- [x] F1 DONE 2026-08-06 — `GATES.md` is the single manifest; CLAUDE.md/
      CONTRIBUTING/this file quote it; release.yml gained the missing
      clippy+fmt (its "same gates" claim was false); `cargo fmt --all`
      everywhere (bare fmt skipped the sidecar). Plus `scripts/release.mjs`:
      resumable 8-step one-command release (P-13).
- [x] F2 DONE v2.73.0 — timeouts root-fix landed; rerun-before-believing
      retired (CLAUDE.md updated).
- [x] F3 LITE DONE 2026-08-06 (P-14-lite) — `scripts/lib/` (cdp/app/demo)
      now backs 9 fully-ported + 4 partially-ported harnesses with unique
      port bases, isolated WV2 profiles, PID-tree-only kills, socket-death
      rejection; two harnesses re-proven on device post-port. Full
      scenario-registry framework deliberately deferred.
- [ ] F4 Close the invariant-coverage holes: ~~overlay-compose chokepoint
      direct tests~~, ~~exportCore determinism test~~, GPU matrix
      param-extreme + post/motion variants, parser fuzzing (fast-check +
      one cargo-fuzz target on the GLSL translator). DONE in v2.73.0:
      MIDI illegal-invocation regression stub (mutation-checked),
      `no-restricted-globals` for bare confirm/alert/prompt.
      DONE 2026-08-08 (first two holes, 26 tests, every one mutation-checked):
      `src/render/overlayCompose.test.ts` (recording-2D-context traces over
      `rasterizeOverlay` + `composeOverlayFrame`: determinism, no wall
      clock/randomness, equal-frame-key ⇒ equal draw, segment-shift
      equivalence, resolution independence, font-probe degrade, stale-asset
      re-decode), `src/state/liveOverlayCompose.test.ts` +
      `src/export/exportCoreDeterminism.test.ts` (the two callers asserted
      against the SAME compose tuple), and the export walk proven identical
      across two runs under a moving wall clock, with `createModEvalState`
      counted per run and the 60 Hz feedback walk proven to hold its own lag
      memory. **CLOSED 2026-08-09 — both remaining holes done.**
      (1) **GPU matrix variants.** The matrix rendered every case through
      `DEFAULT_POST` and `DEFAULT_MOTION` at default params, so it pinned the
      MIDDLE of the space and nothing else: `runPost` skips the whole
      bright/blur/blur chain behind `if (this.post.bloom > 0)`, which means
      bloom, vignette, grain, chromatic aberration and the ACES tonemap had
      ZERO pixel coverage in the gate whose job is pixel drift, and motion
      uniforms 28–31 were pinned at one value each. Added: two param-extreme
      cases per preset (every spec at `min`, then at `max` — no per-control
      special case, because min..max IS the legal span of every control type),
      seven post probes and five motion probes over `spectrum-bars` and
      `oscilloscope` (the two built-ins that read spin/pulse/detail through
      different arithmetic). Probe presets are pinned BY ID and throw when
      missing — a silent fallback would re-bless the probe under a name that
      no longer describes it. A black frame stays a hard failure everywhere
      EXCEPT `/extreme/`, where "brightness at min renders nothing" is the
      correct answer; those are counted and printed instead (same read-it-
      never-wave-it-through rule as the dock audit's `overflow`).
      (2) **Parser fuzzing.** Rust: `mod fuzz` in `shadertoy.rs` — a
      deterministic xorshift mutator over a six-seed corpus, run on its own
      thread so a hang fails instead of stalling CI, `catch_unwind` so a panic
      reports as a panic and not as a timeout, and `BEATFORM_FUZZ_ITERS` for
      deep runs. It lives inside `cargo test --workspace` on purpose: a
      cargo-fuzz target needs nightly and therefore cannot be a gate, and this
      invariant is only worth anything if every commit checks it.
      **The cargo-fuzz target was attempted and DECLINED, on a build log
      rather than an opinion.** nightly and cargo-fuzz 0.13.2 were installed
      and a `transpile` target authored; `cargo +nightly fuzz build` fails
      because the target links the whole `beatform` lib, which runs
      `tauri::generate_context!`, and that macro does not compile in the fuzz
      build (E0063). Making it work needs the transpiler split into its own
      crate — a real architectural change in service of a harness that can
      never be a gate here (CI is stable-only). Revisit if the transpiler
      ever moves out on its own merits. Cost of the attempt, both reverted: a
      `pub mod shadertoy;` and a `fuzz/` directory.
      JS: `src/state/parserFuzz.test.ts` — fast-check over `parseProject`,
      `parseTheme`, `parseLrc`/`parseSrt`/`parseLyrics` and the three
      per-frame lyric readers. Five properties, each mutation-checked. One of
      them (the save/load round trip) was VACUOUS on first write and is
      recorded as such in the file: junk input collapses to defaults, so
      deleting `motion` from `serializeProject` left it green until a
      realistic-document generator replaced the junk one.
      **Three real defects, all found by the Rust fuzzer, all fixed here** —
      see F4b/F4c below.
- [x] F4b **DEFECT found by F4 fuzzing, FIXED 2026-08-09** — `transpile`
      **panicked** on a shader with a multi-byte char in front of a channel
      helper. `find_sampler_fns` walked back with
      `rfind(|c: char| …).map(|p| p + 1)`, and `p + 1` lands INSIDE any
      multi-byte char, so the next `&str` slice panicked. Reachable straight
      from the import dialog: `transpile_shadertoy` is a Tauri command over
      pasted text, and a non-breaking space is what copying code out of a
      rendered web page gives you. Fixed with `after_char()` at all three
      sites (two in `find_sampler_fns`, one in the prototype loop). Regression
      test uses the NBSP shape a person would actually produce, plus the
      literal brace-and-BOM soup the fuzzer generated.
- [x] F4c **DEFECT found by F4 fuzzing, FIXED 2026-08-09** — duplicate or
      OVERLOADED channel helpers corrupted the source instead of failing it.
      Two definitions sharing a name each scanned the whole view for calls, so
      one call site was queued for rewrite twice, and the second application
      replaced the first replacement plus the bytes after it — on the fuzzer's
      doubled shader, exactly `;\n}\n`, merging two statements and deleting a
      brace. Only a `debug_assert` on line count caught it, so in a RELEASE
      build it was silent: naga then rejected a shader that should have
      imported and pointed at the wrong line. Two fixes: rewrites that overlap
      one already applied on the same pass are dropped and re-scanned next
      pass; and clone ownership is assigned to the earliest definition of a
      name rather than filtered by name at embed time, which was emitting
      every clone once per overload ("Function already defined"). Nested
      `outer(iChannel0, inner(iChannel1, uv))` was the same overlap bug and is
      covered by the same guard. Three named regression tests, each
      mutation-checked against its own fix.
- [x] F4a **DEFECT found by F4 — FIXED, shipped v2.83.0** — a SEGMENT export (Canvas-loop
      mode) does not shift lyric WORD timings, so the karaoke wipe diverges
      from the preview. `videoExporter.ts` (~line 347) rebuilds each line as
      `{ ...l, t: l.t - segment.start, end: l.end - segment.start }`; `words`
      rides the spread in unshifted TRACK time while `lyricProgressAt` reads
      it against CLIP time. Repro: line t=60..64 with word tags, segment
      start 58, `anim: "wipe"` — preview progress sweeps 0.159 → 0.966 across
      t=60.5..63.9 while the export resolves 0 at every one of those frames,
      i.e. the whole line renders dim with no sung fill. Fixed by
      `shiftLyricsForSegment` (`src/state/lyrics.ts`), which maps `words`
      (`t`, `end`) with the same offset and is called from
      `videoExporter.ts:345`. Regression: `src/export/segmentLyricShift.test.ts`
      — and note it IMPORTS the real helper rather than restating the shift,
      because the first version of that test reimplemented it and stayed green
      with the fix mutated out.
- [x] F5 DONE 2026-08-06 (wave 0) — `src/render/wgslLib.ts`; ACES/hsl2rgb/
      color-controls/palette sites consolidated byte-identically
      (shaderGolden zero snapshot updates; device GPU matrix 137 cases
      zero movement). Kaleido-fold rescales deliberately left private
      (genuinely different domains).

### Track G — Store-direct + naming follow-ups (NEW, from the v2.80.0 refactor release)

Everything v2.80.0 deliberately left undone. The release's prime invariant
was zero behavior change and zero pixel change, so each of these was cut for
a named reason rather than forgotten. G1–G7 are the whole deferral list;
nothing else from that release is outstanding.

- [ ] G1 **READY — P-12 wave 2: the other seven panels go store-direct.**
      PlayerBar, TimelinePanel, LibraryPanel, PresetStrip, BatchPanel,
      ShaderEditor, ShadertoyImport. Wave 1 covered ParamsPanel only,
      because the evidence mapped that panel exhaustively and the others'
      data props not at all — migrating them blind alongside the idiom's
      first use is how a "zero behavior change" release stops being one.
      **TimelinePanel is the bigger performance target than ParamsPanel
      ever was**: 11 props including `time` at 4 Hz and `activeParams` at
      pointer rate, over an ~11,280 px / ~840-element DOM, with zero render
      coverage before this release. v2.80.0 left `renderProbe()`-based
      commit-count tests on TimelinePanel and PlayerBar precisely so wave 2
      starts with a net — start by making those go red. BatchPanel's
      `formatLabel` derivation is the sole reason App still subscribes to
      all of `exportSettings`.
- [x] G2 **CLOSED BY DELETION in v2.81.0 (P-1 stage 1). No migration was
      written, and none is owed.** The finding was real: the first section's
      `SectionDef` used `id: props.preset.name`, so renaming a visual mode's
      display name silently reset that mode's collapse state. P-1 deleted
      the mechanism the bug lived in — **in-page section collapse no longer
      exists**, the rail is the only navigation model, and `CollapsibleSection`
      is gone from `kit.tsx` with its two kit tests. The id is now a React
      key only and moved to `preset.id` anyway (ParamsPanel.tsx), so the
      contract violation is closed on both sides. `collapsedSections`
      survives with a narrowed meaning: `validPrefs` prunes it to
      `group:`-prefixed keys, which are `ParamGroups`' per-group folds and
      the array's only remaining reader — a `preset.name`→`preset.id`
      rewrite would have produced entries nothing reads. **The blocking
      clause is lifted: a visual mode's display name may now be changed
      freely.** Side effect worth recording — the prune also fixes a
      pre-existing cap bug: `collapsedSections` was `.slice(0, 64)` (keeping
      the head) while the toggle appended, so at the cap new folds were
      dropped on the round-trip while the UI showed them applied. Dropping
      ~16 section ids plus one `preset.name` entry per mode restores the
      headroom P-9's per-group state will spend.
- [ ] G3 **READY — extract the Visuals dock's footer `hint`.** Moving the
      pointer across the dock re-renders the whole ~2,000-line panel
      once per row crossed — a _higher_ frequency than the 4 Hz `lufs` tick
      v2.80.0 fixed. Deferred because `onHint` is threaded through
      ParamGroups, BuilderPanel and every `kit.tsx` row, so fixing it means
      restructuring the hint channel. **Do not put `hint` in the zustand
      store**: that would broadcast pointer-rate churn to every subscriber
      in the app.
- [ ] G4 Push subscriptions down to `ParamRow` — the real slider-drag fix
      (`setParam` writes `activeParams` on every pointermove). Requires
      `ParamGroups`/`paramControls` to become store-aware, which invalidates
      the two largest surviving unit suites (`ParamGroups.test.tsx`,
      `kit.test.tsx`). Sequence **after** P-1's page model exists —
      **unblocked as of v2.81.0**, though the pages themselves are still
      un-curated until P-1 stage 2 (Track H).
- [x] G5 **DONE 2026-08-09 — into `state/updater.ts`, deliberately NOT into the
      store.** Two reasons, both measured rather than asserted. The live
      `Update` handle is already module-scoped and cannot be serialized, so
      putting the phase in the store would split ONE machine across two owners
      — the exact arrangement G7 exists to remove. And zustand runs every
      subscriber's selector on every `set()`, so a per-chunk download counter
      would sweep the whole app hundreds of times per install; mutation MU-C
      (emit also writes the store) measures that directly at 20 store
      notifications against 0. The prefs precedent won instead:
      `subscribePrefs` + a stable snapshot + `useSyncExternalStore`.
      `SettingsDialog` now takes NO props. `window.__setUpdatePhase` keeps its
      `(phase, open = true)` signature and points at `setUpdatePhase`, so it
      still drives both the prompt and Preferences ▸ Updates. Selector law
      respected with two separate stable snapshots rather than one allocating
      object — MU-E (return a fresh object) goes red with the real
      "Maximum update depth exceeded".
      **One drafted test was VACUOUS and was caught before landing:** the
      "unmounting releases its subscription" case counted notifications on the
      TEST's own listener, so it moved whether or not the dialog leaked —
      proven by swapping the component for a `<div />` and watching it stay
      green. Rewritten against a `__updateListenerCount()` seam, mirroring
      `ModMeters.__meterCount`. Nine mutations, all red.
      ORIGINAL — Move the `UpdatePhase` state machine out of `App.tsx` and finish
      SettingsDialog. Its four update props are the only prop-drilling left
      into an otherwise store-direct dialog; the machine is deliberately not
      in the store today, and touching it would have meant a third
      structural edit to App.tsx in one release.
- [x] G6 **DONE 2026-08-09.** The leg reads `currentBuilderStack()` before it
      runs and hands that back in its `finally`, so the harness borrows the
      builder module global and returns what it took. No store import — the
      boundary the deferral was protecting holds, because `builder2`'s own
      module global IS the render layer's mirror of `s.builderStack`
      (`store.ts` writes it at 682/1263/1733/2118, `services.ts:487` packs
      against it every frame), and `builder2.ts` already exported the accessor.
      The renderer's builder BUFFER is deliberately still restored to
      `packBuilderParams(defaultBuilderStack())` rather than the borrowed pack:
      the matrix seeds that buffer with the default pack before any case runs,
      so handing back the default leaves the renderer exactly as the leg found
      it. Hash stability is by construction — identical call sequence, identical
      frame budget, identical case ids, and the only cases after this leg are
      the post/motion probes on `spectrum-bars`/`oscilloscope`, whose WGSL has
      no `LP()` accessor. Extracted as `runBuilderStackCases()` so the contract
      is provable in Vitest with no GPU; mutation A (restore the default stack,
      i.e. the original bug) goes red.
      ORIGINAL — `gpuMatrix.ts` restores `rebuildBuilder2(defaultBuilderStack())`
      rather than the store's stack, so module state can diverge from
      `s.builderStack` after `window.__runGpuMatrix()`. Pre-existing and
      harness-only — observable only with the Visuals dock open in Builder
      mode, and the gate's `spectrumSmoke` leg uses `spectrum-bars`. Left
      alone because the fix puts a store-shaped change inside the render
      layer; do it deliberately, not opportunistically.
- [x] G7 **DONE 2026-08-09 — and the drift had ALREADY HAPPENED, which is why
      zero behaviour change was not achievable.** `exportConfig.ts` said
      "…which **is unavailable** on this system"; `App.tsx:545` said "…which
      **isn't available** on this system" — the same button and the dialog it
      opens giving two different reasons — and `BatchPanel.tsx:84` carried a
      THIRD copy, drifted the same way. One machine, one missing capability,
      three voices. The constant owns the sentence now and App consumes it (it
      already had three other consumers and is re-exported through `store.ts`'s
      frozen public surface, so a future edit reaches for it); Batch keeps its
      own subject and consequence but shares the clause via a new
      `NO_HARDWARE_RENDERING_CLAUSE`. **User-visible delta: the two top-bar
      tooltips now read "is unavailable", on Canvas2D-fallback machines only.**
      The guard is `exportConfig.test.ts`, and note WHY asserting the current
      string would not have worked — both copies were individually correct. It
      scans shipping source (vite `?raw` glob; `node:fs` is unavailable with no
      `@types/node`) for an exact copy, for the distinctive opening
      "Video export needs hardware rendering" — deliberately narrower than
      "hardware rendering (WebGPU)", which eight unrelated surfaces legitimately
      use — and for whoever derives `exportBlocked` referencing the constant.
      Four mutations red, including one that inverts the test's own file filter
      so it cannot pass by walking nothing. Costs ~7s of suite time.
      ORIGINAL — Deduplicate `exportBlocked` (`App.tsx`) against
      `SIMPLIFIED_EXPORT_REASON` (`store.ts`) — a real F2-class drift risk.
      Deferred because it lives in the top bar that P-1 restructures.
      **Unblocked as of v2.81.0**: P-1 stage 1's only top-bar edit was
      turning the dock toggle into a labelled `.ghost-btn`; the export
      cluster is untouched and no later stage is scheduled to move it.
- [x] G8 **DONE 2026-08-09.** `lyrics-e2e.mjs` and `perf-family-check.mjs`
      both use `attachWithRecovery` now, following `gallery-e2e.mjs` rather
      than inventing a second idiom. `lyrics-e2e` also pulled its FIRST
      `__invoke` IPC call inside the probe — previously only the later IPC leg
      was guarded — while keeping its `FAIL:` console contract. Unproven end to
      end: that recovery actually absorbs a live Vite reload in these two. The
      mechanism is `gallery-e2e`'s, unchanged, but the device harnesses have
      not been run since.
      ORIGINAL — **Device harnesses that attach without recovery.**
      `scripts/lyrics-e2e.mjs` wraps its FIRST IPC call in the re-attach
      dance but not the initial `attach()` + `waitHooks` eval, and
      `scripts/perf-family-check.mjs` uses bare `attach()` — both die on a
      cold Vite reload with "Cannot find execution context" before reaching
      any assertion. `gallery-e2e.mjs` uses `attachWithRecovery` and does
      not. Port the survivors to `attachWithRecovery`. Found during the
      v2.80.0 gate run, where `test:lyrics` could not be executed at all;
      the branch it guards (`lyricFileName` gating the lyrics panels, which
      W1 rewired) was verified directly in the running app instead.
- [x] G9 **DONE 2026-08-09 — and the bug was caught live while being fixed.**
      `checkDevServer()` in `scripts/lib/app.mjs` reads `devUrl` from
      `tauri.conf.json` (the same config the shell loads, so the probe cannot
      check a different port than the app uses) and GETs `public/icon.svg` from
      BOTH address families when the host is `localhost` — `127.0.0.1` and
      `[::1]`, because the whole failure mode is two servers, one per family.
      Response bytes prove the project; `Last-Modified` against
      `statSync().mtime` proves the CHECKOUT. Anything else answering throws
      loudly, naming `devUrl`, the offending origin, this harness's root and
      the dual-stack fix; nothing answering fails fast instead of burning the
      240s timeout. Best-effort culprit ID asks the offender for a path via
      `/@fs/`, since Vite's 403 body lists its own serving roots — purely
      diagnostic, the verdict never depends on it. `spawnApp` starts the probe
      overlapping app boot and `waitForPage` awaits it before its first poll;
      it cannot become async, because every harness does
      `app = spawnApp(...)` and then `killTree(app)` in a `finally`.
      Proven against a real Vite 8.1.5 server, 6/6 cases: right tree passes; a
      sibling worktree with a BYTE-IDENTICAL `icon.svg` is rejected on mtime
      and its root named; a foreign server on `[::1]` while ours holds
      `127.0.0.1` is caught; killing it makes the case pass; foreign
      `Last-Modified` with the same bytes is caught; a dead port reports "no
      dev server answered". **And a real instance turned up during the
      session:** the probe failed against an actual `:1420` server rooted at
      the MAIN repo while the harness ran from a worktree — exactly this bug,
      caught by the new code, with the culprit named. GATES.md section 3 now
      documents `npm run dev -- --host` and `TAURI_DEV_HOST=127.0.0.1`.
      ORIGINAL — **A stale dev server silently poisons every e2e harness.** The
      harnesses spawn the debug exe, which loads the configured `devUrl`
      on port 1420; a leftover Vite from an earlier run — bound
      IPv6-only, since `host: false` resolves to `[::1]` on this machine —
      answers that URL and serves a different tree, so the harness attaches
      to the wrong app and fails with a misleading context error. Two
      fixes worth having: make `spawnApp` assert the server it reaches is
      the one the harness expects (a build-stamp probe), and document
      `TAURI_DEV_HOST=127.0.0.1` / `npm run dev -- --host` as the
      dual-stack incantation. Costs real debugging time every session.

**Frozen by v2.80.0, revised by v2.81.0 — renaming any of these is a silent
user-data or gate break, not a cleanup.** Persisted:
`viz.exportSettings.v1`, `beatform.prefs.v1`, `panelOpen`, `panelWidth`
(**sizes the Library ONLY since P-1**; `visualsWidth` is a sibling field, so
no stored value was ever reinterpreted as a dock width), `visualsWidth`
(380..760), `visualsPage` **and its eight ids** — the ids are frozen, the
rail LABELS are not — `paramsTab` **and its five values** (declared,
validated, never written again: its whole remaining job is seeding
`visualsPage` for upgrading installs, and deleting the field would delete
the seed on first boot), `collapsedSections` (**`group:`-prefixed keys
only** since P-1 — bare section ids are pruned on read; the literal is
duplicated into `prefs.ts` because state must not import UI, and
`prefs.test.ts` asserts it equals `ParamGroups.GROUP_KEY`), `advancedOpen`,
the whole `LEGACY` map, and all 15 SectionDef ids (including `"Templates"`,
titled "Themes") — now React keys only, no longer persisted identities.
Tooling-coupled CSS: `.params-panel` (still the dock root — `gpu-pixel-matrix.mjs`
scrapes its `textContent` and scopes `__auditUI` to it; no
`.visuals-dock` alias was added, an orphan class with no rule is the
`.builder-factory-chips` mistake), `.panel-scroll` (the auditor's
scrollable-ancestor walk must find it), **`.rail-item` + its
`data-section`** (`gpu-pixel-matrix.mjs:205` selects `.rail-item` and
matches `dataset.section === "sync"` — the ATTRIBUTE, never the label,
because rail labels are an iterated design surface and the page ids are
frozen in prefs), `.panel-resize-handle`, `--panel-w`, and
`.update-hero-close` — the shared
CDP bootstrap clicks that last one, so every device harness hangs at startup
if it changes. **Removed from this list by P-1:** `.section-toggle` and
`.panel-tabs` (both deleted with the collapse and tab machinery). Also
corrected: the `.panel-*` family is **not** nine harness call sites — no
harness selects `.panel-search`, `.panel-scroll`, `.panel-footer`,
`.panel-heading`, `.panel-resize-handle` or `.param-density`; only
`.params-panel` is tooling-coupled, plus `.panel-scroll` indirectly through
`__auditUI`. Also standing: the `{showPanel && <ParamsPanel />}` mount gate
stays in App (moving it inside would persist eleven pieces of local UI state
across close/open), `memo()` does not come back to a zero-prop component,
and `useShallow` stays unused — it has no prior art here and does not remove
the `useMemo` anyway.

### Track H — P-1 stages 2 and 3 (NEW, from the v2.81.0 dock release)

**P-1 IS COMPLETE as of v2.83.0.** Stage 1 shipped the dock and the rail
(v2.81.0), stage 2 the per-group expert tiers (v2.82.0), stage 3 the
Modulation showpiece and the page-independent `driven` mark (v2.83.0).
H1/H2/H3/H5/H6 are closed. What remains under this track — H4, H7, H8, and
H9–H13 opened by stage 3 — is follow-on work, not P-1.

**Stage 1 shipped in v2.81.0** and is deliberately a SHELL: the floating
overlay became a persistent, resizable right dock (the visual runs full-bleed
behind it; `--visuals-w` keeps other chrome clear; the drag is split into `--visuals-w-set` /
`--visuals-w-live` so only the dock tracks the pointer and the canvas
commits once, or every pointermove destroys and recreates every render
target at full DPR and strobes feedback trails to black); the five tabs AND
the per-section collapses (13 of the 15 sections had one) became ONE
vertical rail of eight destinations (Mode · Motion · Themes · Sync ·
Modulation · Scene · Text · Live)
with roving-tabindex keyboard, badges, and dimmed-with-a-reason
unavailability; Modulation became a top-level destination; a non-scrolling
context header names the mode and its active style; Stage mode suppresses
the dock by layout instead of destructively closing it; the Library got its
own resize grip; both separators take the keyboard. **Zero section bodies
changed** — stage 1 is a pure re-parenting. Everything below is what that
buys and what it does not.

- [x] H1 **ANSWERED in v2.82.0 — the pile was a TIER problem, not a grouping
      problem, and the answer is "nowhere: no group gets its own rail
      destination."** The measured registry refuted the premise this entry
      was written on. Group _presence_ is nearly constant (12 of 15 modes use
      exactly 6 groups, 3 use 7), the median curated cell is **2 rows** and
      the largest anywhere is **6** — so a group rail would have changed by
      1-2 rows between modes: maximum navigation churn for almost no
      differentiation. The real concentration is on the other axis: **259 of
      433 params (60%) are expert tier**, and every cell holding 8+ rows is
      majority-advanced. Stage 2 therefore split by tier, per group, in
      place. H2's "Color becomes a new rail item, nine destinations" is
      **declined** on that evidence, not forgotten.
- [x] H2 **PARTLY SHIPPED in v2.82.0, partly declined.** Shipped: user looks,
      the save form, Import and the look `GalleryLink` moved to the `themes`
      page, relabelled **Looks & themes** (page id untouched); the rail's
      `Motion` is now **Global motion** with a signpost on its unavailable
      state. Declined: the group carve-out pages — see H1. The factory style
      chips deliberately **stayed on Mode**, beside the context header that
      names the active one; separating a chip row from the heading that
      reports its state is a regression. The group-subset argument
      `ParamGroups` would have needed is specified and frozen as a comment at
      its insertion point, unimplemented, because an orphan surface with no
      consumer is the `.builder-factory-chips` mistake.
- [x] H3 **SHIPPED in v2.82.0 — P-9 done as written here.** Per-group expert
      disclosure keyed by group id in a new `advancedGroups` prefs field,
      seeded once from `advancedOpen`, which stays declared and validated for
      one release (delete in 2.83.0). **NOT done in 2.83.0 — that release was
      P-1 stage 3 and touching the prefs schema in it would have put a
      migration in the middle of a UI wave. Carry it: delete `advancedOpen`
      and its `validPrefs` clause in the next prefs-touching release.** Two things the entry did not anticipate:
      the UI calls the tier **expert controls**, not "Advanced" — the retired
      drawer owned that word and reusing it would blur the distinction; and a
      bulk **Show every control** button was required, because per-group
      disclosures alone charge a power user one click per group where the
      switch charged one. It writes every group id in a SINGLE update — the
      naive per-group loop collapses to last-write-wins.
      Also fixed here so the disclosures were not mostly empty theatre: 21
      registry promotions via a new `ParamSpec.tier?: "curated"` flag that
      re-tiers **in place**. Specs are never moved between `params[]` and
      `advanced[]` — those arrays ARE the ABI and a move repacks every
      accessor index. Guarded permanently by `abiOrder.test.ts` (baseline
      captured pre-change) and `curation.test.ts` (every group of every
      built-in has at least one control above its expert line).
- [x] H4 **SHIPPED in v2.84.0 — partly, and one third declined on evidence.**
      SHIPPED: the dock's first container context (named `visuals` on
      `.visuals-page`, tokens on `.panel-scroll` — a container is excluded
      from its own query's subject set, so the token MUST live on a
      descendant); one label step 76px → 104px at `C ≥ 300`; the angle row
      stacks below `C 351`; both measured Layers overflows; `.mod-select`
      deleted, not re-derived (zero consumers tree-wide — a rule with no
      emitter is the `.builder-factory-chips` mistake).
      **THE DEFECT THIS TURNED OUT TO BE ABOUT:** at the 380 floor the angle
      row's `1fr` collapsed to **0px** — no draggable track at all — on six
      built-ins, two of them (radial-burst "Angle", particles "Direction") at
      CURATED tier, on screen with no disclosure opened. `__auditUI` went
      **1 → 0** and the A/B was proven live by neutralising the container.
      The Layers editor overflowed **44px** and its flags row **58px**, with
      Size/Opacity/Glow at width 0 and the colour swatch at 8 of 36px.
      **CORRECTED GEOMETRY (D2), so the old numbers stop propagating:** the
      container is `visualsWidth − 166` = **214.7 / 314.7 / 594.7** at dock
      380 / 480 / 760; the scroller's content column is `visualsWidth − 203`
      = **177 / 277 / 557**. The earlier `−206` / 174·274·554 was 3px
      pessimistic. Two-column layouts remain unreachable at every width.
      **A regression this release introduced and then fixed before shipping:**
      the stacked angle row first sized its readout `auto`, so the readout
      grew with its own digit count and slid the dial 6.2px left across 9/10
      and 99/100 — `Dial.set` re-reads the rect on every pointermove, so a
      stationary pointer that had produced 100 read 88.1, an 11.9° backward
      kick that oscillates while dragging. Pinned to the 44px column every
      other readout uses. `__auditUI` is blind to it; only a human drag found
      it.
      **ITEM 3 (Scene restructure) DECLINED**, four measured reasons: Scene is
      11 rows over 4 headed sections — better delimited per row than Sync's 13
      rows in ONE undifferentiated section that nobody has flagged; the
      proposed regrouping folds Frame (the aspect of the whole render, preview
      AND export) into Background where an aspect search would resolve to a
      section titled "Background"; Post as a collapsible needs a permanent
      `collapsedSections` id (prefs has no migration) and would hide the six
      `is-driven` post rows behind a closed disclosure with no count pill;
      Scene uses zero `PARAM_GROUPS` machinery, so every sub-structure is new
      hand-built DOM and new leaves to audit. **ITEM 1 (context-header
      actions) NOT SHIPPED — it is product judgement, see H14.**
- [ ] H14 **READY — the context-header actions (H4 item 1), an owner decision
      packet, not an implementation task.** Six questions, each with its
      measurement: (Q2) which Reset does a header carry — params-only with an
      honest label, or page-aware? `resetParams()` touches only the active
      preset's params; Motion's and Post's Resets call `setMotion`/`setPost`,
      are conditional on drift, and cannot move. Params-only = a button inert
      on 7 pages and two visible "Reset"s on Scene; page-aware = a feature,
      not a move. (Q3) where does header **Save look** land? The form is two
      ParamsPanel-level `useState`s on the Looks page; inline is ruled out by
      measurement (header inner 186.7px at the floor) and a popover would be
      the dock's first floating layer, so the only mechanical option
      (`changePage("themes")`) PERSISTS `visualsPage` — a save today reopens
      on Looks & themes next session. (Q4) does the "n changed" pill survive?
      It cannot enter the header (`outside-scope-x +28px` at 380) and its
      designed neighbour would be leaving. (Q5) may the header be two rows
      below C 332? Prototyped clean, +18.6px permanent non-scrolling. (Q6)
      `+ Save look` → `Save look` costs 11.5px and touches 4 files. (Q7)
      should `.section-title` gain ellipsis? It is shared with LayersPanel,
      BuilderPanel and TimelinePanel, and preset names are unbounded
      (Shadertoy imports), so the header has no truncation strategy today.
      **`__auditUI` cannot gate any of this** — see H16. Fit thresholds
      measured: dock ≥ 498 for text buttons, C 332 for the two-row collapse.
- [ ] H15 **READY — the general stacked row below `C 300` (dock < 466).** The
      only layout that gives a non-angle slider more than 35px at the floor:
      track 23 → 161px (7×), enum select 76 → 161px, wrapped labels → 0. Price:
      row 16 → 22px, Mode-page scroll +9.9% at the floor, and a different-
      looking row for the whole 380–465 band. Deferred because today's 23px
      track is NOT an auditor failure, so shipping it unattended would be a
      taste call with no defect behind it. **The CSS is frozen, complete and
      commented-out at its insertion point in the H4 block** — enabling it is
      uncommenting one block, and the parsed CSSOM was verified to contain
      exactly two `@container` rules, so the frozen one is provably inert.
- [ ] H16 **READY — two harness gaps that let a 0px slider ship for three
      releases.** (a) `.panel-scroll` declares `overflow-y: auto`, so the other
      axis computes to `auto` too and `__auditUI`'s `outside-scope-x` walk
      ALWAYS finds a scrollable ancestor — it can never fire inside the dock;
      a too-wide row grows a scrollbar instead of reporting. (b) its
      `text-clip` check requires `el.children.length === 0`, so a truncated
      `<select>` is invisible. Those two together are why both Layers
      overflows were invisible to the gate. v2.84.0 lands the evidence
      REPORT-ONLY: `dockLayoutSmoke` records per-page overflow at both dock
      ends without asserting it (Q8 — turning it into an assertion could light
      up pre-existing failures app-wide, which is a decision, not a fix). **A
      non-empty `overflow` entry is a finding to fix or file — never wave it
      through as "auditor clean".**
- [x] H5 **SHIPPED in v2.83.0 — and P-1 is COMPLETE with it (stages 1, 2 and
      3 all delivered: v2.81.0, v2.82.0, v2.83.0).** The Modulation body was
      lifted out of `ParamsPanel` into a store-direct, zero-prop
      `ModulationPage` and rebuilt as **one card per modulated control**, not
      the source × target grid this entry asked for. The grid was refuted by
      the corpus before a line was written: across the 13 factory themes,
      `distinct targets === route count` in **13 of 13** and distinct sources
      is strictly smaller in 3 of 13 (mean 3.08 sources per theme) — the
      target is the primary key of a route in every shipped document, the
      target axis is the smaller one (26–37 targets vs 34–62 sources), and
      the card's grouping key IS `applyMods`' accumulation key. A grid would
      also have drawn cells only for valid pairs, which makes a legacy
      off-param route **invisible but still saved** — strictly worse than the
      bug the T8 assertion exists to prevent.
      Delivered: live meters per source-in-use and per route (a pull-only rAF
      writing ONE CSS custom property on refs — no store field, no setState,
      no canvas, so the v2.80.0/v2.82.0 reconciliation win survives); a
      painted range per route reading `0.20 → 0.68` with the knob's own clamp
      named when it stops the swing short; curve/rise/fall behind a per-route
      disclosure that is never width-gated and prints a non-default shape on
      the CLOSED face; rise/fall raised from a 2 s slider cap to the
      validator's real `MOD_LAG_MAX_SEC` (10) with real labels; a
      target-first create picker that deletes two shipped bugs by
      construction (`addModRoute(source, "")` on a preset with no targets,
      and N clicks stacking N compounding routes); the stem escape-hatch
      option for reopened stem projects.
      **The page-independent mark shipped as `.param-slot.is-driven`** — a
      CSS class on the slot `is-advanced` already uses, zero new DOM
      (`.param-row` is a fixed `76px minmax(0,1fr) 44px` grid app-wide),
      merged into the existing `.group-count` pill so a route into a
      collapsed group or a closed expert tier is still visible. Named
      **driven**, not "modulated", so timeline automation lanes join it
      additively (H11 below). Scene's six post rows carry it through a LOCAL
      wrapper in `ParamsPanel`, never a prop on the shared `SliderRow` — the
      kit serves LayersPanel, ExportDialog, BuilderPanel and TimelinePanel
      and none of them has any business knowing modulation exists.
      **Both open questions are DECIDED, not deferred — do not re-litigate:**
      (1) **The native `<select>` survives**, for the target and source
      pickers only. It is the one enumeration surface that is keyboard- and
      screen-reader-complete for free and it keeps the registry-derived
      assertions meaningful. `App.css`'s forced-dark `option`/`optgroup` rule
      therefore **stays and must not be touched**. (2) **MIDI CC does not
      join, and stays on Live.** It is a different binding class: MIDI writes
      the document through `setParam` (`midiActions.ts`), so the slider
      physically moves and the binding is self-describing; modulation is
      non-destructive per frame. Merging them would move the Live rail badge
      and R9's contract for no user gain — which is also why MIDI gets no
      `driven` mark.
      Every v2.79.0 document-shape guarantee was carried into the rewritten
      tests with its SUBJECT preserved (T7–T11, R3, R9, R11): `mod: 'off'`
      params stay out of the picker, a legacy off-param route stays visible,
      inert, unrewritten AND deletable, the whole LFO family is offered,
      recipes land real routes, and Linear/0 still write `undefined` —
      asserted on the persisted projection — the key list of a
      `JSON.parse(JSON.stringify(route))` round-trip — not on the in-memory
      object. Nothing new is
      persisted: no `ModRoute` field, no prefs key, no `schemaVersion` bump.
- [x] H6 **Map defect, recorded so it is not re-derived: two of the four P-1
      planning documents asserted that `CollapsibleSection` / `.section-toggle`
      had call sites outside the panel (ExportDialog was named).** Verified
      false before stage 1 was written — one production call site,
      `ParamsPanel.tsx`, plus `kit.test.tsx`. It was deleted outright with
      its CSS and its two kit tests. Cost of the wrong claim, had it been
      believed: the whole "delete the collapse mechanism" decision (D4/G2)
      looks impossible instead of trivial.
- [x] H7 **CLOSED 2026-08-09 — the doc-pointer half needed no work, and the
      guide-diff half produced a list (below) rather than edits.** Both named
      defects were already gone, verified with `git blame` rather than
      assumed: `docs/templates.md` lost its dead `▸ Visual ▸` path in
      `a0473fc` (2026-08-08), and `GuideDialog.tsx` lost "across all tabs"
      and "the Visuals does nothing" in `4310d93` (the Track D truth pass).
      This entry was written at v2.81.0 and two rounds of doc work overtook
      it. What the sweep DID find and fix (`75fab1d`): `docs/templates.md`
      told authors to "add Post" without naming its page (now
      `Scene ▸ Post`), `services.ts` carried a dead `Settings ▸ Performance`
      path, and the in-app guide claimed the LFOs run "¼ beat to 8 **bars**"
      — `modMatrix.ts:84` says the rates are BEATS per cycle and there are
      **eighteen** of them (3 waves × 6 rates). `docs/guide.md` already had
      that right; the in-app copy was the wrong side.
      **The rail labels are `Mode · Global motion · Looks & themes · Sync ·
Modulation · Scene · Text · Live`** — `ParamsPanel.tsx` `VISUALS_PAGES`,
      not the bare page ids. Two earlier briefs (including one of mine) wrote
      the ids as if they were labels; they are not interchangeable.
- [ ] H7a **NEW — the in-app guide and `docs/guide.md` have diverged in 23
      places.** Produced by the H7 sweep, deliberately unfixed: this is the
      input to **P-21 (single-source guides)**, and hand-patching both copies
      is exactly the maintenance P-21 exists to delete. Everything below was
      checked against the code, not against the other document.
      **One is FALSE, not merely missing** — the LFO range, fixed in
      `75fab1d`. Everything else is a hole on one side.
      **Misfiled:** `guide.md` files image/video framing and the
      All-modes/This-mode scope switch under **Export**; they live on
      **Scene** (`ParamsPanel.tsx:1500-1502`).
      **Only in `docs/guide.md`** (12): the whole spectrum-analysis block
      (Resolution ~85/170/340 ms, Axis, Sampling, Low/High edge, the
      readout); onset pulses vs beat-grid pulses; the Global motion page —
      the in-app guide names it once in a rail list and never says what is
      on it; group folding survives while page folding does not; Canvas loop
      disabling PNG/ProRes/AV1; MP4 2–60 Mbps and the −1 dBTP ceiling; the
      named cover-art controls (Cover wall, Source shape); Learn note →
      mode; lyrics attaching to the track like stems; the four-word summary
      including Gallery; the preview/export truth-contract link; the ✕ that
      clears A-B.
      **Only in the in-app guide** (9): **the entire custom-shader editor** —
      the `+` chip, `.bfshader`, single-pass Shadertoy import, Canvas2D
      gating — which is the biggest hole on the `guide.md` side and its only
      WGSL mention is Builder codegen; the post chain's actual contents and
      that they are modulation targets; frame aspect Fill/16:9/9:16/1:1;
      autosave + the crash Restore prompt; the timeline override rules; that
      the dock remembers the PAGE as well as the width; the **More** group;
      _Auto-play next_; and Gallery pinning described loosely as an
      "immutable version" where `guide.md` correctly says "immutable commit".
      **Missing from BOTH** (2, found in the code): **Drive** and **Drive
      pulse**, the first two entries of `MOD_SOURCES`
      (`modMatrix.ts:142-143`), and the **Edit lyrics** section on Text
      (`ParamsPanel.tsx:1884-1886`).
- [x] H7-ORIGINAL **Stale doc pointers left by the v2.81.0 mechanical rename, in
      files outside the docs unit's ownership.** Each is a path a user can
      follow and fail: `docs/templates.md` says
      _Visuals ▸ Visual ▸ Themes ▸ Save as theme…_ and
      `src/ui/GuideDialog.tsx` says the search box "finds any control by
      name, across all tabs" plus the ungrammatical "the Visuals does
      nothing". **There is no `Visual` destination any more** — the rail
      reads Mode · Motion · Themes · Sync · Modulation · Scene · Text · Live,
      so every `▸ Visual ▸` path is dead. Sweep both, and diff the in-app
      guide against `docs/guide.md`: they are hand-kept in sync today, which
      is exactly what P-21 (single-source guides, Track D) exists to fix.
- [x] H8 **DONE 2026-08-09.** `shotCanvas` (`scripts/lib/cdp.mjs`) reads
      `showPanel`, calls `setShowPanel(false)` — the action, not a raw
      `setState`, because it also writes the `panelOpen` pref — measures and
      shoots inside a `try`, and restores in a `finally` whose restore eval is
      `.catch`-swallowed so a dead socket cannot replace the original failure.
      Proven a no-op for every caller today, by source rather than by
      assertion: `prefs.ts:138` defaults `panelOpen: false`, `store.ts:1101`
      seeds `showPanel` from it, every `spawnApp` harness uses an isolated
      WebView2 profile so localStorage starts empty, and the only two
      `shotCanvas` callers (`wave-shots.mjs`, `gallery-seed-shots.mjs`) never
      touch the dock. `gpu-pixel-matrix.mjs` is the one script that opens it,
      and it does not call `shotCanvas` at all. Unverified: that the restored
      dock and the un-letterboxed clip look right in a real device screenshot.
      ORIGINAL — **`shotCanvas` still frames the canvas with the dock open — the
      P-1 plan's R16 mitigation was specified and not implemented.**
      `scripts/lib/cdp.mjs:93` clips `Page.captureScreenshot` to the
      `<canvas>` bounding rect. Since P-1 that rect is the LETTERBOXED
      canvas, so any evidence shot taken with the dock open has a different
      frame from every shot in the archive — and GATES.md makes wave-shot
      evidence the basis of the `test:gpu` re-bless protocol, i.e. old and
      new screenshots stop being comparable exactly when a re-bless needs
      them side by side. Not urgent today (`panelOpen` defaults to `false`
      and no harness opens the dock before shooting), which is why it slipped
      — but it is a silent trap the first time someone does. Fix: read
      `showPanel`, `setShowPanel(false)`, measure + shoot, restore. Also
      noted while verifying: the plan's `railFound` / `auditScopeOk` booleans
      were not added to the `spectrumSmoke` payload either; the smoke throws
      `"Visuals rail: no Sync destination"` instead, which names the failure
      just as well — recorded so nobody re-derives the gap as a defect.

**H9–H13 opened 2026-08-08 by the v2.83.0 (P-1 stage 3) plan §7.** They are
the things that plan deliberately kept OUT of stage 3, recorded here so they
read as scope decisions rather than leaks. _(The plan numbered them H8–H12;
H8 was already taken by the `shotCanvas` entry above, so they are filed one
higher. Nothing else moved.)_

- [ ] H9 **Exact post-lag route meters.** The v2.83.0 indicator is the RAW
      source through the CURVE — the shipping `sourceValue` fed through the
      shipping `shapedValue` — and deliberately **not** post-attack/release.
      It could not be: the per-route lag evaluator MUTATES the caller's memo
      and the live
      loop owns exactly one, so a UI call through it would advance every
      lagged route's envelope a second time per frame and change what the
      renderer draws — preview would diverge from export depending on whether
      the panel happens to be open. That is why it is not exported from
      `modMatrix.ts`. Doing this properly means publishing resolved per-route
      values OUT of the loop, PerfOverlay-style (a module-level slot filled
      only where the evaluator already runs), and it must never reach
      `exportCore` — a worker has no panel. Buys accuracy on a minority of
      routes: **0 of the 43 routes in the 13 shipped factory themes carry
      curve or lag**, so for shipped content today's indicator is bit-exactly
      the multiplicand. The card names the discrepancy in a hint while any
      rise/fall is set. **Blocked on evidence that anyone tunes lag enough to
      notice.**
- [x] H10 **DONE 2026-08-09.** `addModRoute` rejects any `param` that is not
      a routable target and no-ops on a duplicate `(source, param)`, both
      before `ctx.record("mod-add")`, so a refused call costs no Ctrl+Z —
      matching `autoRouteStem` and `applyModRouteRecipe`. Routability is
      `postTargetKey(param) !== null || isModTarget(paramSpecMap(preset).get(param))`,
      which is the same three things the create picker enumerates and the same
      predicate `resolveTarget` in `modRoutePresets.ts` uses: no hand-written
      key list, and `ModulationPage.tsx` untouched. `validModRoutes`, the
      persisted shape and `schemaVersion` are unchanged, and a legacy document
      carrying an off-param or duplicate route still loads unchanged.
      **Correction to this entry's own premise:** it said the action is
      "callable from recipes". It is not — `applyModRouteRecipe` appends
      `recipeRoutes(...)` output directly and never calls `addModRoute`, and
      MIDI learn writes `midiBindings`, not `ModRoute`s. Today's only callers
      are `ModulationPage.tsx:407` and `gpu-pixel-matrix.mjs:314`, and the
      harness seeds targets from the picker filtered on `!option.disabled`, so
      it can never pass an unroutable or already-routed param. The
      "Already routed — tweak the existing route's amount instead" flash is
      structurally unaffected and is pinned by a test.
      ORIGINAL — **Harden `addModRoute` at the action, not just at the UI.** It
      accepts `param: ""` (then `validModRoutes` drops the route on the next
      load — it silently vanishes from the saved file) and it does not dedupe
      on `(source, param)` (N calls stack N compounding routes on one knob).
      v2.83.0 makes both **unreachable from the UI** by construction — the
      create picker offers only real targets and greys out routed ones — but
      the action is still callable from recipes, tests and future callers.
      Fix: reject an empty/unknown `param`, and dedupe on `(source, param)`.
      Note `modRoutePresets`' "Already routed — tweak the existing route's
      amount instead" flash is the user-visible half and must keep firing, or
      a second recipe click reads as a broken button.
- [ ] H11 **Extend the `driven` mark to timeline automation lanes.** Purely
      additive by design: the vocabulary was chosen for it (v2.83.0 named the
      mark **driven**, not "modulated", precisely so this needs no rename
      across CSS, markup and tests). Automation lanes (`timeline.ts`, applied
      in `frameResolve.ts` **before** modulation) drive the same param keys
      just as invisibly, `TimelinePanel` already lets you add a lane per param
      key, and `drivenParamKeys(preset, mods)` is a pure function with one
      call site — widening it to `(preset, mods, lanes)` is the whole change,
      plus the same treatment for Scene's post rows.
- [ ] H12 **Per-route solo/mute and route reordering on a stacked card.**
      `applyMods` sums in **array order** and clamps per route, so order is
      genuinely user-visible when two routes share one knob — and a card is
      where that finally became legible. Both need document-shape decisions
      first: mute is an optional validated `ModRoute` field (and
      `validModRoutes` OMITS rather than defaults, so anything added must
      round-trip a v1 route unchanged), reorder is array position. Reorder
      also needs a coalescing decision for the drag gesture: `"mod-add"` is
      in history's UNGROUPABLE set while `updateModRoute` coalesces by
      `mod:${id}:${keys}`.
- [ ] H13 **Bulk actions on the Modulation page** — "clear every route for
      this source", "set depth on N routes". Deliberately absent from
      v2.83.0: a bulk destructive action crosses audit UI-3 (needs
      `askConfirm` plus a T13-shaped test) and needs a history decision
      first, because `"mod-add"` is UNGROUPABLE — N cleared routes would push
      N undo entries unless a new grouped label is introduced. Per-route `✕`
      correctly keeps no confirm: it is one undoable history record.

### Approved program extension (owner: "Approve as ranked", 2026-08-06)

All PROPOSALS.md verdicts are in (see that file for per-item text).
Execution sequence around the running Track B program:

1. **Now, parallel to Track B** (scripts/infra, no collision):
   P-13 gate manifest + `release.mjs` · P-14-lite shared harness module
   (`scripts/lib/` — cdp/boot/evidence, kill the 12 copies).
2. ~~**Parallel to batches 2–3:** P-16/P-7 modulation engine v2 + P-15
   AudioFeatures extension = the "reactivity fuel" item feeding Track C.~~
   **DONE, shipped v2.79.0 2026-08-07** (ran after the B waves rather than
   parallel to them — B never blocked on it, and C does). Engine: per-route
   `curve` (linear/exp/smooth) + `attack`/`release` lag via caller-owned
   `ModEvalState` (fresh per export run ⇒ bit-identical exports; live state
   clears at the seek chokepoint), beat-locked `lfo:<wave>:<beats>` sources
   (stateless, pure over the beat grid), six route recipes as chips. Fuel:
   `beatIndex`/`barIndex`/`sectionIndex`/`sectionPulse`/`chroma`(12)/`vocal`
   on AudioFeatures, all additive — golden traces re-blessed ZERO. `vocal`
   and `sectionPulse` registered as mod sources; the rest is fuel for the
   per-mode adoption a later wave owns. Wiring notes worth keeping: vocal
   presence rides its OWN export field because the `lyrics` job field only
   travels when the overlay is drawn (deriving from it would have zeroed the
   source whenever the user hid the words while preview kept modulating);
   sections + spans are segment-shifted like the beat grid; the live feed is
   ONE store subscription, not a call at each of the nine `lyrics` writers.
   GPU matrix 213 cases, zero movement.
3. ~~**Post-batch-3 refactor release:** P-12 store-direct migration (kills
   props-drilling) + P-2 naming (Inspector / Preferences).~~
   **DONE, shipped v2.80.0 2026-08-08.** P-12 **wave 1 only**: ParamsPanel
   plus its two exclusive children (LayersPanel, BuilderPanel) went
   store-direct — the 82-member props interface and the 46 App-level
   `useCallback` forwarders deleted, `memo()` removed rather than kept (with
   zero props it can never bail, so it was a false contract), and the footer
   badges split into `PanelFooterBadges` so the 4 Hz `lufs` tick no longer
   reconciles a 2,000-line panel (audit UI-2). Foundation: a new
   `src/state/selectors.ts` collapses the per-mode background expression
   that lived in **five** places (the divergence behind BG1) into one
   function, and an eslint `no-restricted-syntax` rule makes an allocating
   zustand-v5 selector unwritable — that mistake is a white screen on mount,
   not a slow render. P-2: the right-hand dock is the **Inspector** (the
   name v2.80.0 actually shipped — **superseded by "Visuals" in v2.81.0**;
   this record is left as written), the
   Ctrl+, dialog is **Preferences**, and one knob is a **control** (or
   **parameter**); 39 UI strings changed while every persisted id, prefs
   field and CSS class stayed frozen (Track G lists the freeze). Binding
   invariant: zero behavior change, zero pixel change — GPU matrix 213
   cases, and a single moved hash stops the release rather than being
   re-blessed. Wave 2 (the other seven panels) and six other deliberate
   deferrals: **Track G**.
4. **After Track B completes:** P-1 dock (staged: shell + rail →
   per-section pages → Modulation showpiece page) with P-9 folded in.
   **Stage 1 DONE, shipped v2.81.0 2026-08-08.** Scope: the panel stopped
   being a floating overlay and became a persistent, resizable right dock
   the visual runs behind (`--visuals-w`, with the set/live width
   split that keeps a resize drag from re-allocating every render target at
   60 Hz); the five tabs and the per-section collapses (13 of the 15 sections) were BOTH
   replaced by one vertical rail of eight destinations, so there is exactly
   one navigation model; **Modulation became a top-level destination**,
   which is the change the redesign was approved for; a non-scrolling
   context header names the mode and its active style; Stage mode suppresses
   the dock by layout rather than destructively closing it; the Library got
   the resize grip it had been missing whenever the dock was shut; both
   separators take the keyboard, and the rail is one tab stop with
   follow-focus arrows. Prefs: new `visualsPage` (seeded from the retired
   `paramsTab`, so upgrading users land where they left off) and
   `visualsWidth` (a SIBLING of `panelWidth`, never a reinterpretation);
   `collapsedSections` narrowed to `group:` keys. **Zero section bodies
   changed** and no control moved between concepts. `test:gpu` must come
   back 213/213 with **zero hash movement**, and if it does not, the failure
   is a SELECTOR failure — **never** run `test:gpu:update` for it: panel
   layout cannot move an exported or matrix pixel, because `exportCore`
   allocates its own `OffscreenCanvas` inside a worker with no DOM reference
   and the matrix allocates its own 192×108 surface at dpr 1.
   Owner call taken mid-stage: the dock is **Visuals**, superseding
   v2.80.0's "Inspector" — see the vocabulary block. Stages 2 and 3, and
   the honest limit of what stage 1 bought: **Track H**.
5. **Track C (seed v2):** with modulation v2 live; P-6 factory-themes-
   into-Gallery lands here.
6. **Track D (docs):** after P-1's rename settles; P-21 single-source
   guides + submission tooling is D's engine.
7. **Fillers, any release:** P-3 first-run, P-8 export-format honesty,
   P-10 polish bundle. **Own release, after program:** P-11 boot-from-
   autosave.
8. **Post-program:** un-park FEAT-009 + P-4 together. Parked: P-19 list.
   Rejected for now: P-20 (lyrics runtime on demand).

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
5. **PROPOSALS.md verdict pass**: 10 product proposals (P-1 … P-10 polish
   bundle) + the endorsed audit proposals appended there await your
   approve/adjust/reject per item. Note that PROPOSALS.md titles P-1
   "…a docked Inspector" — that document is quoted verbatim throughout and
   predates both renames; the surface is **Visuals**.

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

**Canonical definition: `GATES.md`** — this section quotes it; if they ever
disagree, GATES.md wins. Use gates proportional to the changed layer;
release-ready work runs the full set.

### Web application (GATES.md §1)

```
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

### Rust/Tauri (GATES.md §2 — ALWAYS --workspace/--all)

```
cargo fmt --all -- --check                              # from src-tauri/
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

### Device gates (GATES.md §3 — mandatory per touched area)

```
npm run test:gpu
node scripts/gallery-e2e.mjs
npm run test:loopback:built
npm run test:loopback:built:30
npm run test:shadertoy:built
npm run test:lyrics
```

GATES.md §3 says when each is mandatory and carries the GPU-matrix
re-bless protocol.

### Version/release agreement (GATES.md §4)

```
node scripts/bump-version.mjs --verify
```

The full release checklist (clean tree, gates green, CHANGELOG current,
five files agree, workflow green, SHA256SUMS match, signed manifest, live
latest.json, installed smoke, ALIGN-002 DisplayVersion) lives in
GATES.md §4 and is automated by `node scripts/release.mjs`.

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
