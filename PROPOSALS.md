# PROPOSALS — the opinionated half of the 2026-08 quality audit

This file is deliberately separate from `BACKLOG.md`: the ledger holds
confirmed defects, drift and program work; THIS file holds judgment calls —
redesigns, additions, removals — written under the owner's directive that
nothing is sacred and "user did it like this" is not an argument. Every
item ends with a **Verdict:** line for the owner to fill in
(approve / adjust / reject). Nothing here is implemented; approved items
graduate into the BACKLOG program tracks.

Evidence referenced as `ux-shots/NN` lives in
`F:\agent-devstorage\shared-cache\audio-visualizer\artifacts\quality-audit-2026-08\ux-shots\`.

---

## 0. The north star this file argues from

Beatform is two products wearing one coat: an **instant-gratification
toy** (drop a file, it looks great in 10 seconds) and a **production
tool** (deterministic exports, timeline, modulation, batch, MIDI). The
current UI is the toy's UI with the tool's features stuffed into its
pockets. Almost every proposal below is some form of: _give the tool half
a real home without making the toy half heavier._

---

## P-1 · FLAGSHIP — Replace the Visual Settings overlay with a docked Inspector

**Problem (owner-named, confirmed on device).** The panel is a day-1
sidebar form that absorbed ~300 knobs. Evidence from the walkthrough:

- It is an _overlay_ that covers the visual it edits (ux-shots/03) —
  tuning means guessing, closing, checking, reopening.
- One fixed ~270px column: every control is a cramped slider row; long
  sections (a mode's All view, Templates) become an endless single
  scroll (ux-shots/04).
- Tab load is wildly unbalanced: Visual tab carries mode + styles +
  looks + ~300 params + global motion + themes + gallery link; the
  **Live tab holds two controls** (quantize mode + "Enable MIDI…",
  ux-shots/08). Tabs exist because sections overflowed, not because the
  IA was designed.
- **Modulation — the single most powerful creative system in the app —
  is a text link ("+ Route") buried at the bottom of the Sync tab**
  (ux-shots/05). Nobody discovers it; the seed-theme failure made that
  measurable.
- Entry point is one unlabeled icon among eight in the top-right
  (ux-shots/01); the owner correctly calls it hidden.

**Proposal.** Rebuild as a **persistent, resizable right dock** ("the
Inspector"), not a floating overlay:

- The canvas shrinks beside it (letterboxed) instead of being covered —
  tune while you watch. Auto-hide only in Stage mode / fullscreen.
- Left edge of the dock = a compact vertical **section rail** (icons +
  labels): Mode · Style & Looks · Color · Motion · Sync · **Modulation**
  · Scene · Text · Live. Rail replaces both the five tabs and the
  in-page section collapse — one navigation model instead of two.
- Sections are _pages_, not accordion piles: a page gets width to lay
  out 2-column controls, grouped headers, inline preview strips
  (e.g. hue gradient on the hue slider — exists today, keep).
- **Modulation gets a real page**: source × target routing grid with
  per-route depth/curve, live meters on sources, "which params are
  modulated" badges shown back inside the mode page. This is the
  centerpiece justification for the redesign — it turns the app's
  hidden superpower into a visible one.
- Sticky context header: current mode name + style + Reset + Save look,
  always visible regardless of section.
- Search stays global across pages (it is already good).
- Top-bar entry becomes a **labeled** button (proposal: "Studio"),
  sitting with Gallery — the two doors into depth.

**Cost.** LARGE (the biggest single item in this file), touches
App.tsx/ParamsPanel/CSS architecture. Worth staging: dock shell + rail
first (sections keep current internals), then per-section page passes —
this also pairs naturally with Track B (each mode-depth wave lands into a
page that can hold it).

**Verdict:** _____

## P-2 · Naming: three different things are called "settings"

"Visual settings" (panel) / "App settings" (dialog) / shortcut list says
"G — Settings panel". Adopt: **Inspector** (or "Studio") for the panel,
**Preferences** for the app dialog, and never the bare word "settings"
in UI copy again. Folds into Track A's naming sweep if approved.
Effort SMALL. **Verdict:** _____

## P-3 · First-run: earn the first 60 seconds

- Mode strip renders as text-only chips until idle thumbnail render
  fires (ux-shots/01/02) — a brand-new user's first minutes are the
  least impressive minutes the app ever shows. Prerender the first
  8–10 thumbnails eagerly (tiny cost, deterministic content), lazy for
  the rest. Effort SMALL.
- One-time coach marks (3, dismissible, never again): ① drop audio /
  demos → ② mode strip → ③ Studio button. The empty state already
  teaches ①; ② and ③ have nothing. Effort SMALL-MEDIUM.
- Empty state gains a fourth path: "…or start from the **Gallery**"
  (it is the shortest route to "wow" for a user with no file at hand —
  a theme + demo track is a one-click show). Effort SMALL.
  **Verdict:** _____

## P-4 · Live/performance surface deserves its own room (not a starved tab)

The Live tab's two controls + MIDI link (ux-shots/08) undersell a real
capability set (quantized switching, MIDI learn, stage mode, blackout).
Proposal: a **Perform drawer** summoned from Stage mode / a top-bar
toggle: big touch/MIDI-friendly mode pads (1–9 with thumbnails), quantize
toggle, blackout, MIDI learn overlay showing current mappings live.
The Inspector's Live page then only _configures_; the drawer _performs_.
Effort MEDIUM-LARGE. Pairs with parked FEAT-009 (second display) later —
the drawer is the operator console FEAT-009 always implied.
**Verdict:** _____

## P-5 · Timeline: workstation feature, toy controls

Current: bottom drawer, "Enabled" toggle, "+ Scene at playhead",
"+ Automation lane…" dropdown (ux-shots/12). The engine underneath
(beat-snapped scenes, crossfades, keyframe lanes) is export-grade.
Proposal (staged): scene cards with mode thumbnails + per-scene look
picker; lane list panel with add/remove/solo-visibility; click-to-add
keyframes with value scrubbing; snap indicator; remove the
"Enabled" toggle (a timeline with scenes IS enabled; empty = off).
Effort MEDIUM-LARGE. **Verdict:** _____

## P-6 · Fold factory Themes into the Gallery (one browse surface)

Today: 13 factory theme chips live in the panel (ux-shots/04) while
Gallery themes live in the dialog — two browse surfaces for the same
concept, different names (Track A already renames). Proposal: factory
themes become **built-in Gallery entries** (badge: "Built-in", no
download, offline-always) listed first in the Themes filter; the panel
section shrinks to "Save as theme…" + "Browse themes…". One mental
model: _all themes live in the Gallery; some ship with the app._
Keeps offline guarantee, removes duplication, makes the Gallery the
place where quality is visible (which is exactly the seed-bar goal).
Effort MEDIUM. **Verdict:** _____

## P-7 · Modulation expressiveness (pairs with the Inspector page)

Beyond surfacing (P-1): the system itself should grow to carry flagship
themes — per-route **curve/shape** (linear/exp/smooth), **lag/attack**
per route, a **beat-phase LFO source family** (sine/saw/square locked to
beat grid — deterministic by construction, fits the law), and
**route presets** ("kick → zoom punch") as copyable chips. Without this,
C-track themes stay "params that wiggle"; with it they become
choreography. Effort MEDIUM (state+resolve) + the UI in P-1.
Determinism note: all sources already resolve from track time; LFOs from
beat grid keep that. **Verdict:** _____

## P-8 · Export dialog: honest format surface

Clean dialog (ux-shots/09), but format visibility is conditional in ways
users can't predict: transparent-WebM (VP9+alpha) — a README headline
feature — appears only under specific background settings, and 10-bit
AV1 vs plain MP4 read as unrelated siblings. Proposal: show ALL formats
always; unavailable ones render disabled with the one-line reason
("needs Background → Transparent", "hardware HEVC not found") — the
dialog becomes the codec-capability map of the machine. Also: after a
finished export, surface "Show in folder" on the completion toast
(currently verify — if absent, add). Effort SMALL-MEDIUM.
**Verdict:** _____

## P-9 · Retire the panel's dual param views ("Essentials/All") in favor of per-page curation

If P-1 lands, each Inspector page shows its curated controls with an
"Advanced" disclosure _per group_, killing the global Essentials/All
switch (two parallel layouts of the same content = double maintenance,
and "All" is the endless scroll of ux-shots/04). If P-1 is rejected,
keep the switch. Effort folds into P-1. **Verdict:** _____

## P-10 · Small-but-visible polish list (bundle)

- WEBGPU/BPM/KEY/LUFS status chips (panel footer) have no tooltips
  explaining what they mean or that LUFS is momentary (ux-shots/03).
- Seek bar: no hover time bubble; A-B markers are 12px targets.
- Volume state not visible when chrome hidden (by design, but a 1-second
  overlay flash on change would confirm input landed).
- Toast stack: notice + error + applied-theme toasts all render in the
  same center-bottom slot; two at once collide (seen during e2e).
- `.modal` base at 380px forces every new dialog to fight it (Gallery
  did); introduce size variants (`modal-sm/md/lg`) once.
- Mode strip: no keyboard focus ring on chips; arrow-key navigation
  absent (a11y + VJ ergonomics).
  Effort: each SMALL; bundle as one polish release. **Verdict:** _____

---

# From the domain audits — proposals I endorse (with my editorial read)

Defects and drift went to BACKLOG's audit register. These are the
opinion-class ideas from the seven reports that I judge worth your
verdict, deduplicated against P-1…P-10 and each other. Full arguments in
the report files.

## P-11 · Desktop boot from the autosave file, not localStorage (SS-27)

Replace the 15-key localStorage document cache with the already-written
atomic autosave `.bfproj` as the desktop boot source (one `parseProject`
at startup). Deletes the quota-split-brain problem class (defect SS-2)
at the root instead of guarding ten call sites, and collapses persistence
to ONE serialization path. localStorage stays for browser dev + prefs.
My read: highest-leverage state change in the whole audit; do it before
E2's state wave so the wave shrinks. Effort LARGE. **Verdict:** _____

## P-12 · Kill the props-drilling layer; store-direct becomes the only idiom (SS-11 + UI-P1)

App.tsx forwards ~90 useCallbacks into panels (~75 props into
ParamsPanel alone); newer surfaces already subscribe directly. Migrate
the giants (ParamsPanel first), delete ~500 lines of plumbing, and make
defect UI-2's failure class (defeated memo via fresh props) structurally
impossible. Prerequisite for the P-1 Inspector anyway — the dock should
be born store-direct. Effort MEDIUM-LARGE. **Verdict:** _____

## P-13 · One release-gate manifest + one-command release (TQ-26 + PL-M2)

A checked-in gate manifest (what runs when: web gates, cargo
`--workspace` gates, device suites per touched area) that CLAUDE.md,
BACKLOG, ci.yml and release.yml all QUOTE instead of restating — plus
`release.mjs` doing bump → changelog scaffold → tag → CI watch →
publish → verify (signature, SHA256SUMS, live endpoint), resumable.
Three contradicting gate definitions and a seven-prose-step ritual is
how gates rot. Effort MEDIUM. **Verdict:** _____

## P-14 · One harness library under `scripts/lib/` (TQ-25 + PL-11)

The CDP client is copy-pasted 12×, page-polling 13×, with drifted
timeouts and colliding debug ports; only one copy handles socket death.
Shared lib (cdp.ts, app-boot.ts, evidence.ts) + a scenario registry +
one `run.mjs` entry. Every future device test gets cheaper and stops
inheriting the bugs I hit this week (port collisions, vite-reload
context loss, name-wide process kills). Effort LARGE but pays inside
the program itself. **Verdict:** _____

## P-15 · Extend AudioFeatures with what's already computed (AX-22/23)

The pipeline computes-and-discards beat index, section identity,
chromagram; the lyrics sidecar can hand back vocal presence. Exposing
them (uniform block has a clean extension path; golden traces are
additive-safe) gives Track B modes and Track C themes materially richer
fuel — "verse vs drop" reactivity instead of loudness-following.
Effort MEDIUM (audio) + per-mode adoption in B waves.
**Verdict:** _____

## P-16 · Modulation engine v2 (AX-31 — merges into P-7)

Same finding from the audio side as my P-7 from the product side: one
linear rule today (`clamp(base + value·amount·range)`), no per-route
lag/curve/threshold, no beat-locked LFO sources. Treat P-7/P-16 as one
work item: engine (deterministic, track-time LFOs) + the Inspector
routing page (P-1). **Verdict:** _____

## P-17 · Builder gets a virtual-ParamSpec bridge (RP-20)

Builder stacks expose `params: []` — invisible to modulation, MIDI,
automation, styles and panel search. Bridging its storage-buffer slots
into virtual ParamSpecs makes the compositor a first-class citizen of
every control system at once. The render audit calls it the biggest
single depth unlock in the roster; I agree. Effort MEDIUM-LARGE.
**Verdict:** _____

## P-18 · Param schema: two small additions, one refusal (RP-14)

Add display-side `taper` (log sliders for Hz/scale ranges) and
`mod: "smooth" | "snap" | "off"` metadata (fixes defect RP-2's
strobing-toggle class properly). REFUSE vec3/color params — the
one-f32-per-param law is what keeps modulation, MIDI, automation and
serialization uniform; color stays hue/sat/light triplets. Effort SMALL
(schema) + adoption. **Verdict:** _____

## P-19 · Roster: add nothing yet, but keep this ranked list (RP-25)

Retire/merge NOTHING (every mode has a distinct silhouette). Post-
program archetype queue, ranked by payoff/cost: spectrogram waterfall
(cheap, feedback path exists) → typography/lyric-stage mode (pairs with
the lyrics engine) → cover-art-first mode → waveform terrain (a
spectrum-scape layout enum, nearly free) → fluid/reaction-diffusion
(expensive, saved for last). Parked until the program completes — listed
so it stops living in my head. **Verdict:** _____

## P-20 · Lyrics runtime on demand (PL-L1) — flagging, not endorsing

Whisper+onnxruntime (~93 MB) ship in every installer though lyrics
already requires a ≥554 MB model download. The downloader
infrastructure to fetch the runtime on demand exists and is SHA-pinned.
Counterpoint (why I'm neutral): installer is 59.8 MB — not a problem
today, and bundling keeps first-use latency low. Decide on principle
(lean installer vs turnkey feature), not urgency. **Verdict:** _____

## P-21 · Single-source the two user guides (DS-50/51/52)

The in-app guide and the Pages site are hand-maintained twins that both
drifted (15 releases of missing features between them). Generate both
from one content source (guide sections as data), add the missing
Gallery page + FAQ + shortcuts sheet, and build the gallery submission
helper (validate + hash + PR body from a local file) so a first
submission is one command instead of seven manual steps. Effort
MEDIUM-LARGE. Belongs to Track D. **Verdict:** _____

---

## Where the register says "excellent — protect it"

History snapshots, migration architecture, gallery verification chain,
export backpressure + batch isolation, kit.tsx, zero dead CSS, DSP
mutation tests, comment culture. Every proposal above must arrive with
the relevant guardrail suite green; none of them licenses a rewrite of
these.
