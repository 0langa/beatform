# v3.0.0 Release Plan

_Written 2026-08-23, against v2.108.0. This is the working plan for the days
between now and the 3.0.0 tag. The live work ledger stays `BACKLOG.md` — rows
close there; this document orders them and defines what "ready" means._

## The bar

v3.0.0 has always been defined as a conviction bar, not a milestone: **the
owner can say "this is exactly how I want Beatform to be, and I stand behind
every single feature."** The owner has now decided to go for it. Everything
below prepares the release; the tag itself still waits for that sentence —
no checklist going green cuts v3 on its own.

## Where the project stands (2026-08-23)

- **v2.108.0** shipped 2026-08-21 — the fourth wave of audit round 2, which
  is **complete**: two full unbiased audits (2026-08-06: 273 items;
  2026-08-21: nine domains) have been run and burned down. Four releases
  shipped on the final day alone, each CI-green, device-gated, and
  install-verified.
- **Zero open bugs.** The external notes queue is empty; the live BACKLOG
  carries no defect rows — only small hardening items, owner-only checks,
  and deliberately trigger-gated future work.
- **Quality machinery in place:** GATES.md gate manifest, strict GPU pixel
  matrix (332 cases, any hash delta fails), export colorimetry gate, golden
  traces, five built-app device harnesses, `release.mjs` one-command ritual.
- **What remains open** (all of it small, listed in BACKLOG.md):
  1. Three owner-only verdicts (word timing, second-display eyes, play
     session).
  2. A dozen agent-ready hardening rows.
  3. The launch kit (drafted; posting is the owner's).
  4. One unchecked device item in TESTING.md (Visuals dock + section rail
     pass, new in v2.81.0).

## The path to 3.0.0

Ship order is chosen so the v3.0.0 diff itself is tiny and boring: all real
work lands on 2.x first, and the major tag is a low-risk cut of an
already-verified main.

### Phase A — Owner conviction checks (owner, ~15 min + play time)

These are literally the "stand behind every feature" checks for the two
flagship features. Guides live in BACKLOG.md "Owner-pending".

- [ ] **A1. FEAT-004 word-timing verdict** (~3 min): watch Lyric Stage's
      karaoke fill on a known song; one-sentence verdict to any session.
- [ ] **A2. FEAT-009 eyes-only legs** (~5 min): second-display sharpness /
      smoothness impression, ~5 min stability, HDMI yank + replug.
- [ ] **A3. Play session** (open-ended): just use the app. Anything that
      feels off gets filed in BACKLOG.md and fixed in Phase C. This is the
      conviction bar's real input — v3 waits for it.

### Phase B — Hardening burn-down → ship as v2.109.0 (agent)

Do first, in this order (the first row protects the v3 ship itself):

- [ ] **B1. `release.mjs` robustness** — idempotent commit/tag step and a
      watch step that never re-attaches to a stale run (bit twice during the
      2.108 wave). The v3 release goes through this script; harden it first.
- [ ] **B2. `batchScanning` aggregated counter** (R2-31f) — the one real
      residual defect-shaped row.
- [ ] **B3. Test-hygiene set** — fps-cap+paused vitest pin; live-capture
      async-setup window test; parserFuzz 30 s describe budgets;
      buildExportOptions test title vs asserted fields (R2-34 remainder).
- [ ] **B4. Overgrowth present-only virgin-branch comment** (one line).
- [ ] **B5. WebCodecs-lane 601/709 tagging device probe** (R2-30 remainder)
      — colorimetry truth belongs in a release named "I stand behind every
      export". Fix if the probe finds untagged/wrong output; record if clean.

Explicitly **parked for v3**, with reasons recorded in BACKLOG.md (parking
is a decision, not a leftover):

- Overgrowth mist seam sub-LSB inset — below one 8-bit LSB, frozen into the
  blessed baseline, cosmetic only.
- exportWorker duplicate bundle (~1.0 MB) — lazy-loaded; disk-only cost.
- Perform-drawer fullscreen MIDI-learn overlay — product follow-up; the
  drawer already shows mappings live.
- codecProbe AV1/VP9 level-ladder accuracy — hardening, not user-reaching.
- mediabunny upstream issue post — owner action, external account; good
  citizenship, not a gate.

Ship the phase as **v2.109.0** through the full ritual (web + Rust gates,
device gates for touched areas, release.mjs, install verify).

### Phase C — Findings wave (only if Phase A files anything)

Anything the play session or the eyes checks surface gets the house
discipline — repro, fix, red-first test, gates — and ships as **v2.109.x**.
If nothing is filed, this phase is skipped. v3 does not tag over known
unfixed findings from Phase A.

### Phase D — v3 acceptance batch (TESTING.md)

Per TESTING.md's own reuse rule: reset the boxes, update the "State as of"
line, replace the banner — same file, new batch. Keep it lean; the
automated device gates already guard most surfaces continuously. The batch
covers only what automation can't:

- [ ] **D1. Updater path into 3.0.0** — installed 2.x app receives and
      installs the 3.0.0 offer (semver major bump through the live
      manifest), HKCU DisplayVersion exact after (ALIGN-002 check).
- [ ] **D2. Fresh install** of the 3.0.0 setup on a clean profile: first-run
      boots, demo plays, one export completes.
- [ ] **D3. Visuals dock + section rail device pass** — the one unchecked
      item in the current TESTING.md; run it as written there.
- [ ] **D4. Spot checks** rolled into A1–A3 (lyrics, perform window, real
      music across modes) — the owner's Phase A verdicts are this evidence;
      link them rather than re-running.

### Phase E — Release surface (agent, riding the v3 commit)

The actual v3.0.0 diff. Nothing behavioral — docs, version, presentation:

- [ ] **E1. CHANGELOG.md `[3.0.0]` section** — user-facing UI (the update
      dialog renders it for every 2.x user updating in). It should read as a
      milestone note: what Beatform is now (20 modes, live performance +
      second display, lyrics pipeline, deep-color exports, Gallery,
      determinism law), then the delta since 2.109.x. Written as release
      notes, not a commit list.
- [ ] **E2. README pass** — embed the hero shot the owner picks from the
      launch kit; verify feature list, platform facts and version-agnostic
      wording survive a major bump.
- [ ] **E3. Docs truth sweep** — guide regenerated if any UI string moved
      (`npm run build:guide`), docs site pages current, no "2.x" phrasing
      that reads wrong under a 3.0.0 banner.
- [ ] **E4. No persisted-format changes.** v3.0.0 changes no schema, no
      preset IDs, no file formats — assert it in review: the diff contains
      no `schemaVersion` or migration edits. A major version number is not a
      license to break documents.

### Phase F — Ship v3.0.0

Preconditions, all of them:

1. Phases A–E closed (A3's verdict included).
2. Full web + Rust gates green on the final tree.
3. **Full device-gate battery once** — all six rows of GATES.md §3
   regardless of touched-area rules. A milestone release earns the complete
   sweep: GPU matrix, export colorimetry, gallery E2E, both loopback
   smokes, Shadertoy smoke, lyrics E2E.
4. The owner says the sentence. That is the trigger; nothing else is.

Then:

```
node scripts/release.mjs 3.0.0 --title "Beatform 3.0"
```

Post-publish (GATES.md §4 in full): SHA256SUMS match, signed manifest,
live latest.json serves 3.0.0, installed-runtime smoke, HKCU
DisplayVersion 3.0.0 exact. Close the ledger: BACKLOG rows, roadmap
memory, RECALL latest-release claim superseded.

### Phase G — Launch (owner, at their pace)

The launch kit is drafted end to end; what remains is exclusively the
owner's: hero pick (feeds E2), the [SLOT] fills and [VERIFY] flags in the
post drafts, the three screen-recording animateds, and the posting itself.
Aligning the posts with the 3.0.0 release being live is the natural moment,
but nothing in Phases A–F blocks on it.

## Suggested day plan

| Day | Owner                             | Agent sessions                                        |
| --- | --------------------------------- | ----------------------------------------------------- |
| 1   | A1 + A2 (~15 min), start A3       | B1–B5, ship v2.109.0                                  |
| 2   | Finish A3, file anything          | Phase C fixes if filed; open the TESTING.md batch (D) |
| 3   | Hero pick + [SLOT]s (G prep)      | D1–D3, Phase E, full device battery                   |
| 4   | Say the sentence; post the launch | Ship 3.0.0, verify, close ledgers                     |

Days are elastic — the order is what matters. If A3 files findings, Phase C
stretches the middle and the tag simply moves; the plan does not.

## What v3.0.0 deliberately is not

- Not a feature release — trigger-gated rows (Spout, NDI, macOS/Linux,
  lyrics streaming rework) stay gated on their named triggers.
- Not a format break — every 2.x project, preset, theme and shader file
  opens unchanged; the updater carries every 2.x install forward.
- Not the end of the line — 2.x discipline continues as 3.x discipline:
  same gates, same ledger, same determinism law.
