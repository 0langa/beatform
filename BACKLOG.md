# Beatform Backlog and Alignment Ledger

Last reconciled: **2026-07-30**

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

Time-sensitive values below were checked on 2026-07-30:

| Fact                    | Verified state                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Repository              | `0langa/beatform`                                                                      |
| Branch                  | Clean `main`, aligned with `origin/main`                                               |
| Source version          | `2.63.0` in all five version-bearing files                                             |
| HEAD / tag              | `bfe171d` / `v2.63.0`                                                                  |
| Latest public release   | `v2.63.0`, published 2026-07-29                                                        |
| Open GitHub issues      | 0                                                                                      |
| Open pull requests      | 2: Dependabot PRs #9 and #10                                                           |
| Installed desktop app   | `2.61.0` at `C:\Users\Julius\AppData\Local\Beatform\Beatform.exe`                      |
| Running desktop app     | None during audit                                                                      |
| Explicit source markers | No `TODO`, `FIXME`, `XXX`, or `HACK` markers found in `src`, `src-tauri`, or `scripts` |

Current product constraints remain:

- Free and open source.
- GitHub Releases distribution.
- Local-first; no paid tier, cloud dependency, store account, or telemetry.
- Preview/export determinism and WYSIWYG remain hard contracts.
- Windows is the currently shipped desktop platform.

## Execution order

Work top to bottom unless fresh evidence changes priority.

| Order | ID         | Status      | Work                                                    |
| ----- | ---------- | ----------- | ------------------------------------------------------- |
| 1     | ALIGN-001  | READY       | Install/update to current release and smoke `v2.63.0`   |
| 2     | DEP-001    | READY       | Resolve jsdom 30 Dependabot PR #9                       |
| 3     | DEP-002    | READY       | Resolve Rust base64 0.23 Dependabot PR #10              |
| 4     | DOC-001    | READY       | Repair public metadata and planning-document drift      |
| 5     | FEAT-001   | RESEARCH    | Prove or reject Shadertoy/GLSL compatibility            |
| 6     | FEAT-003   | CONSIDERING | Design a trusted, seeded community preset index         |
| 7     | VERIFY-001 | RESEARCH    | Measure long-export renderer heap behavior              |
| 8     | VERIFY-003 | READY       | Close Web MIDI transport gap with free virtual loopback |
| 9     | FEAT-004   | CONSIDERING | Best-possible local automatic lyrics epic               |
| 10    | FEAT-005   | RESEARCH    | Genuine 10-bit HEVC/AV1 export architecture             |
| 11    | FEAT-009   | CONSIDERING | True second-display performance window                  |

`VERIFY-002`, `VIS-001`, and `DSP-001` remain gated or decision-bound. They do
not block work above.

## Immediate stabilization and maintenance

### ALIGN-001 — Current installed-release acceptance

**Status:** READY  
**Why:** Source and public release are `v2.63.0`, but audited installed app is
still `2.61.0`. Source tests and release artifacts do not replace installed-app
evidence for the two intervening releases.

Scope:

- Update/install from the public `v2.63.0` release.
- Confirm executable product version is `2.63.0`.
- Confirm updater path remains functional; record whether the update was
  in-app or installer-driven.
- Smoke launch, file open, preview playback, one short MP4 export, and shutdown.
- Smoke v2.62 analysis changes:
  - Analyzer mode selection.
  - Color mode selection.
  - Deterministic behavior after seek/restart.
- Smoke v2.63 A-B loop behavior:
  - Set, edit, enable, disable, and clear loop.
  - Boundary behavior at start/end.
  - Seek and pause/resume interactions.
- Recheck clean shutdown and absence of an orphaned Beatform process.
- Record results in `TESTING.md`.

Acceptance gate:

- Installed binary reports `2.63.0`.
- No launch, playback, export, updater, analyzer, or A-B loop regression.
- Any failure becomes a focused GitHub issue or a new ledger item with exact
  reproduction steps.

### DEP-001 — jsdom 30 dependency update

**Status:** READY  
**Source:** [Dependabot PR #9](https://github.com/0langa/beatform/pull/9)

Audited state:

- Updates `jsdom` from `29.1.1` to `30.0.1`.
- Development dependency, semver-major.
- PR is clean and mergeable.
- CI, Rust, and audit checks are green.

Action:

1. Review upstream breaking changes against Beatform's test environment.
2. Check lockfile diff for unrelated movement.
3. Run full local gate.
4. Merge if green; otherwise document exact incompatibility and close or pin.
5. Pull merged `main` and re-run version agreement plus a focused UI test.

Acceptance gate:

- Full local and GitHub gates pass.
- No hidden DOM-environment behavior change in UI tests.
- PR is merged or explicitly closed with a durable reason.

### DEP-002 — Rust base64 0.23 dependency update

**Status:** READY  
**Source:** [Dependabot PR #10](https://github.com/0langa/beatform/pull/10)

Audited state:

- Updates Rust `base64` from `0.22.1` to `0.23.0`.
- Direct production dependency.
- PR is clean and mergeable.
- CI, Rust, and audit checks are green.

Action:

1. Review upstream API and behavior changes.
2. Inspect every repository call site; confirm chosen engine and padding
   behavior remain intentional.
3. Run full local gate, including loopback/native tests.
4. Merge if green; otherwise document exact incompatibility and close or pin.

Acceptance gate:

- Encoding/decoding behavior is unchanged where compatibility matters.
- Rust and loopback gates pass locally and in GitHub Actions.
- PR is merged or explicitly closed with a durable reason.

### DOC-001 — Public metadata and planning truth

**Status:** READY

Known drift:

- GitHub repository description says **10** WebGPU visual modes; current
  product and README expose **16**.
- README roadmap compresses current work into “second display still to come”
  and does not point to the full candidate/evidence queue.
- Ignored `ROADMAP.md` still calls `v2.30` current and contains work that has
  since shipped.
- `TESTING.md` records a completed historical acceptance batch but has not yet
  recorded installed `v2.63.0` acceptance.

Action:

- Update GitHub description to current capability count and concise current
  positioning.
- Keep README's short roadmap, but link this ledger as canonical detail.
- Treat ignored `ROADMAP.md` as historical; do not copy its stale queue into
  new work.
- Add current installed-release evidence to `TESTING.md` after ALIGN-001.
- Check root docs for version/capability drift after each release.

Acceptance gate:

- Public metadata, README, this ledger, and current code agree.
- Historical documents are labeled or referenced so agents cannot reasonably
  mistake them for the live queue.

## Strategic feature candidates

### FEAT-001 — Shadertoy/GLSL import compatibility

**Status:** RESEARCH  
**Decision after spike:** implement a bounded compatibility format, or reject.

Why this is not a parser toggle:

- Current custom presets are WGSL snippets inserted into Beatform's shared
  shader module (`src/render/presets/custom.ts`, `src/ui/ShaderEditor.tsx`).
- Shadertoy shaders use `mainImage`, Shadertoy uniforms, GLSL ES conventions,
  and channel semantics.
- Naga can parse supported modern/Vulkan-style GLSL, but does not directly
  provide Shadertoy compatibility or merge emitted modules into Beatform's
  snippet ABI.
- Shader licensing and attribution must remain valid.

Required spike:

1. Build a small, representative, redistribution-safe shader corpus:
   simple color, audio-reactive, feedback-free texture use, multiple channels,
   common Shadertoy idioms, and known unsupported constructs.
2. Define candidate input contract:
   accepted GLSL version, `mainImage`, supported uniforms/channels, texture
   rules, size limits, loop/complexity limits, and license metadata.
3. Prototype preprocess → parse/transpile → validate.
4. Compare two architectures:
   - AST/module integration with existing shared renderer ABI.
   - Dedicated compatibility render path with explicit uniforms and textures.
5. Measure:
   - Corpus parse/compile/pass rate.
   - Visual correctness, not compile success alone.
   - Startup and per-frame cost.
   - Failure diagnostics.
   - Preview/export determinism.
6. Threat-model imported shader workload and persistence.
7. Write a decision record before production implementation.

Acceptance gate for approving implementation:

- Measured corpus success rate is high enough to make import useful.
- Unsupported behavior has clear diagnostics.
- Resource limits prevent accidental or hostile GPU abuse.
- Attribution/license data survives import and export.
- Selected architecture preserves Beatform's preview/export contract.

Do not market “thousands of compatible shaders” before measured pass rate and
redistribution rights exist.

### FEAT-003 — Community preset index

**Status:** CONSIDERING  
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

**Status:** CONSIDERING  
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

**Status:** RESEARCH  
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

**Status:** RESEARCH  
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

**Status:** READY  
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

| Area                               | Verified shipped state                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| Video background blur              | Preview/export WYSIWYG path shipped                                              |
| Lyric animation                    | Plain, slide, pop, wipe/karaoke behavior shipped                                 |
| Web MIDI controls                  | Mapping/state feature shipped; only transport evidence gap remains               |
| Stage performance                  | Stage mode, blackout, HUD, and beat-quantized switching shipped                  |
| A-B looping                        | Shipped in `v2.63.0`                                                             |
| Audio fixed-clock contract         | Sample-rate handling, deterministic reset/seek, and fixed-clock analysis shipped |
| Loopback capture                   | Native loopback path and deterministic smoke gate shipped                        |
| Analyzer presentation              | Analyzer modes, color modes, and opt-in display-spectrum path shipped            |
| FEAT-002                           | Shipped in `v2.63.0`                                                             |
| FEAT-006                           | Shipped in `v2.62.0`                                                             |
| FEAT-007 / FEAT-008                | Shipped in `v2.61.0` / `v2.62.0`; old bass-bin interpolation note is superseded  |
| Audio DSP plan phases              | v2.58–v2.60 work complete; only limitations above remain                         |
| Physical non-US keyboard           | Owner-reported physical pass                                                     |
| Original hardware acceptance batch | Green in `TESTING.md`; current-version delta still belongs to ALIGN-001          |

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
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
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
- Installed artifact is smoke-tested; source/dev server alone is insufficient.

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
