# v3.0.0 Release Plan

_Re-cut 2026-09-02 against v2.108.0 (shipped 2026-08-21). Supersedes the
2026-08-23 plan, which stalled after twelve idle days with none of its phases
started. The live work ledger stays `BACKLOG.md` — rows close there; this
document orders them and defines what "ready" means._

## The bar

v3.0.0 has always been a conviction bar — _"this is exactly how I want Beatform
to be, and I stand behind every single feature"_ — and the owner could never
place an "enough" mark under it. On 2026-09-02 the owner made it concrete:

> **Nothing that was started ships half-done.** 3.0.0 is the release after
> which Beatform can sit for a while in a stable, decently polished state.

That is a finite, checkable rule. A code deep-dive (four independent sweeps:
code markers, docs-vs-code, wiring gaps, feature symmetry) produced the
**half-done inventory** in `BACKLOG.md`. Every row there gets exactly one
verdict from the owner:

- **FINISH** — complete the surface (small, bounded work; no new scope).
- **REMOVE** — take the half-built surface out, so nothing promises what it
  cannot do.
- **DECLARE** — keep it as is, but write the limit down where a user meets it
  (guide, contract doc, Known limitations) — a documented decision, not a
  leftover.

When the inventory is empty, the two owner checks are green, and the release
path is verified, v3 is ready. The tag itself still waits for the owner's
explicit go; no checklist cuts it on its own.

**Out of scope for v3, by decision:** new features (they go to 3.x through the
same ledger), the open-ended play session (dropped as a gate 2026-09-02),
persisted-format changes of any kind, and the trigger-gated rows (Spout, NDI,
macOS/Linux, lyrics streaming rework) which stay on their named triggers.

## Where the project stands (2026-09-02)

- **v2.108.0** is installed and published; `latest.json` serves it; the
  external notes queue holds zero bugs and zero features.
- **Twelve idle days** left drift, all found and fixed in the 2026-09-02
  session: CI on `main` was red (prettier on six agent-config files from the
  docs-compaction commit, plus one `npm audit` high in a dev-only transitive
  dependency); three dependabot PRs (#26 actions, #29 cargo patch, #30 npm
  minor/patch) have waited since 2026-08-19/26; the `dist` and
  `src-tauri/target` junctions pointed at cache folders the devstorage janitor
  had already evicted; `node_modules` was absent on the checkout.
- **Ledgers reset:** the closed audit-round-2 ledger and every old test run
  are frozen under `archive/ledgers/`; `BACKLOG.md` holds only open rows and
  the half-done inventory; `TESTING.md` is the lean v3 acceptance batch.
- **Quality machinery unchanged:** GATES.md manifest, strict 332-case GPU
  pixel matrix, export colorimetry gate, golden traces, five built-app device
  harnesses, `release.mjs` (hardened this session).

## The release train

All real work lands on 2.x releases; the 3.0.0 diff itself is docs and a
version number. Order matters more than dates.

### 1. v2.109.0 — "Housekeeping" (agent; ready to ship once the owner says go)

Everything the 2026-09-02 session produced, shipped through the full ritual:

- CI back to green: prettier drift, `npm audit fix` (browserslist, dev-only).
- Dependabot PRs #26, #29, #30 merged first (owner action — remote mutation),
  then the session's tree rebased on top. #30 bumps `mediabunny` (export
  muxing) → run the built-app export smoke and `export-color-verify`; #29 bumps
  `cpal` and `naga` → run both loopback smokes and the Shadertoy smoke.
- Hardening rows closed: `release.mjs` idempotent commit/tag + stale-run-proof
  watch (protects the v3 ship itself); `batchScanning` aggregated counter
  (R2-31f); fps-cap + paused pin; live-input async-setup window test;
  parserFuzz describe budgets; `buildExportOptions` full-surface test;
  Overgrowth virgin-branch comment; the stale "FROZEN" CSS header.
- Docs truth sweep: EXPORT-DESIGN numbers, SECURITY network inventory
  re-verified, README architecture tree, GIF/WebP in the docs index,
  `.bfpreset`/`.bfbuilder` drop-import documented, installer size, GATES §3/§5
  edges, this plan excluded from the public docs site.
- Ledger reset + archives; `CLAUDE.md` v3 rule rewritten; memory + RECALL
  updated.
- Still to run in this lane: **B5** — WebCodecs-lane 601/709 tagging device
  probe (R2-30 remainder). Fix if the probe finds untagged output; record if
  clean.

Gates: full web + Rust set; device gates for every touched area (see above);
`release.mjs 2.109.0`; install verify (exe + HKCU `DisplayVersion`).

### 2. Owner verdict round (~15 minutes, any time)

Read the half-done inventory in `BACKLOG.md` (HD-01 … HD-nn). Each row carries
evidence, a recommended verdict, and a size. Reply with one word per row —
_finish_, _remove_, or _declare_ — or "take the recommendations". Nothing in
step 3 starts before this; guessing here is exactly how scope grew for thirty
releases.

### 3. v2.110.0 — "Nothing half-done" (agent)

Execute the verdicts:

- FINISH rows land with the house discipline (red-first test, gates, device
  gates for touched areas, guide regenerated when a UI string moves).
- REMOVE rows come out cleanly — UI, state, Rust field, tests, docs — with a
  one-line CHANGELOG note that says what left and why.
- DECLARE rows land as text: guide / contract / `BACKLOG.md` Known limitations,
  each at the place a user meets the limit.

If the owner picks FINISH for the largest row (HD-06, global
saturation/lightness on the nine modes that lack it — shader work with a GPU
matrix re-bless), it ships as its own **v2.111.0** so its pixel re-bless is
reviewable in isolation and never rides along with unrelated fixes.

### 4. Owner checks (~10 minutes, after v2.109.0 or later is installed)

`TESTING.md` A1 (Lyric Stage word timing) and A2 (second-display eyes + HDMI
yank). Anything filed gets fixed as **v2.11x.y** with the same discipline. v3
does not tag over an open finding from these two checks.

### 5. v3.0.0 — the boring cut

Preconditions, all of them:

1. Half-done inventory empty (every row FINISHED, REMOVED, or DECLARED and
   closed in `BACKLOG.md`).
2. A1 and A2 green in `TESTING.md`; any findings shipped.
3. Full web + Rust gates green on the final tree.
4. **Full device battery once** — all six rows of GATES.md §3 regardless of
   touched-area rules: GPU matrix, export colorimetry, gallery E2E, both
   loopback smokes, Shadertoy smoke, lyrics E2E.
5. The 3.0.0 diff contains **no** `schemaVersion`, migration, or preset-ID
   edits (assert it in review — a major version is not a license to break
   documents).
6. The owner says go.

The diff itself:

- `CHANGELOG.md [3.0.0]` — a milestone note (what Beatform is now: 20 modes,
  live performance + second display, lyrics pipeline, deep-color exports,
  Gallery, the determinism law), then the delta since v2.11x. Release-notes
  voice; the update dialog renders it for every 2.x user.
- README: hero shot (owner's pick from the launch kit), Roadmap section
  already rewritten for the 3.0 era, version-agnostic wording checked.
- Guide regenerated if any UI string moved (`npm run build:guide`); docs pages
  free of "2.x"-era phrasing that reads wrong under a 3.0.0 banner.

Ship: `node scripts/release.mjs 3.0.0 --title "Beatform 3.0"`. Post-publish
(GATES.md §4): SHA256SUMS match, signed manifest, live `latest.json` serves
3.0.0, installed-runtime smoke, `TESTING.md` D1 (updater into 3.0.0, HKCU
exact) and D2 (fresh install), D3 (Visuals dock device pass). Close the
ledger: `BACKLOG.md` rows, roadmap memory, RECALL `beatform.latest_release`
claim superseded.

### 6. Launch (owner, at their pace)

The launch kit is drafted end to end
(`OneDrive\Documents\doc\beatform-launch-kit\`). Hero pick, `[SLOT]` fills,
`[VERIFY]` flags, the three screen recordings, and the posting are exclusively
the owner's. Nothing above blocks on it.

## Suggested day plan (elastic — the order is what matters)

| Day | Owner                                        | Agent sessions                                        |
| --- | -------------------------------------------- | ----------------------------------------------------- |
| 1   | Merge dependabot PRs; give the verdict round | Rebase, B5 probe, ship v2.109.0                       |
| 2   | —                                            | v2.110.0 (small FINISH / REMOVE / DECLARE rows)       |
| 3   | A1 + A2 (~10 min) on the installed build     | v2.111.0 if HD-06 is FINISH; fix anything A1/A2 filed |
| 4   | Say go                                       | Full device battery, 3.0.0 diff, ship, verify, close  |

## After 3.0.0

The project sits. 2.x discipline continues as 3.x discipline when work
resumes: same gates, same ledger, same determinism law. New ideas go to the
external notes queue or the trigger table — never straight into a release.
