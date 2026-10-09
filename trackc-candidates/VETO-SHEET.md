# Track C — owner veto sheet

Eighteen entries, one row each, with an empty verdict column. Nothing in this
branch has been merged to the registry and nothing will be: C4 exists because
the v1 seed merge rode on a thumbnails-look-fine reading, so this lane's whole
output is an argument you can refuse per entry.

Everything here is reviewable from three places:

- the `.bftheme` / `.bfpreset` files under `themes/` and `looks/` — the exact
  bytes that would move into the gallery repo;
- **28 stills**, one or more per row, all 1280×720 on the WebGPU renderer
  with the track time each frame landed on logged. The JPEG copies live in
  `evidence-web/` (2.3 MB for the set, largest file 212 KB); the PNG
  originals (26 MB) were moved out of git history on 2026-10-09 to the
  external dev drive, `agent-devstorageshared-cacheBeatformartifacts6-10-09_trackc-stillsevidence` (marked KEEP);
- `candidates.ts` and `looks.ts`, which are the typed source the files are
  emitted from, with the reasoning for each entry in the comments.

**How the stills were taken**, because the two halves differ and it matters
when you read them. Rows 1–5 go through the app's real `importThemeText` — the
same entry point a drag-import and a gallery install use — so the frame is
proof the FILE works. Rows 6–18 are applied as a whole document instead: a look
carries params and sync ONLY, so applying one leaves whatever post chain,
background and motion was already loaded, and photographing look #12 through a
store still wearing look #11's leftovers would compare two things that differ
in more than the delta. Every look frame therefore starts from a NEUTRAL
document — default post, default motion, preset background — which is both what
a user gets applying it to a fresh project and what
`scripts/gallery-seed-shots.mjs` captured the currently approved previews
against. Each C2 row is also shot on the same demo track and settle time its own
seed was originally shot with, read out of that harness rather than re-chosen.

`npx vitest run --config trackc-candidates/vitest.config.ts` — 124 test cases,
green. Emitting is deterministic: running it twice in a row leaves zero git
diff, so the committed files really are the bytes that would merge.

**What that suite does and does not prove**, stated precisely so nobody later
trims it on a wrong assumption. It runs two mechanisms that cover different
things:

- It parses every emitted file back through the app's **real validators**
  (`parseTheme` → `validateDocument`, `parseUserPreset`) and asserts nothing
  moved. That catches everything those validators normalize: a route `amount`
  outside −1..1 is clamped, a malformed sync object is dropped, a route to a
  rejected source disappears, an un-`id`ed keyframe gets a random id, scenes
  are re-sorted, a background pointing at a missing asset degrades, an unknown
  preset id falls back to the default mode.
- The validators **never look at a param's spec**. `validParamsByPreset` keeps
  every finite number verbatim — no range, no step, no lookup — and route
  targets are only length-capped, so a route pointing at a key the preset does
  not have round-trips perfectly and is simply inert at render time. Param
  range, step-grid alignment, enum/toggle legality, route-target existence and
  modulation headroom are proven by **hand-written checks read against the
  live specs**, not by the round-trip.

Both mechanisms were confirmed non-vacuous by live mutation, 3/3 caught: a
param pushed outside its spec range failed 2 cases (live-spec checks only — it
round-trips perfectly), a route re-pointed at a key its preset does not have
failed 1 (live-spec check only, same reason), and a route `amount` set to 2
failed 3, one of which is the round-trip diff where the real validator clamped
it back to 1. Reverting restored 124/124.

---

## How to read the verdict column

Write `APPROVE`, `VETO`, or a note. A veto on one row costs nothing anywhere
else — the entries share no ids, no files and no registry rows. Where a single
KEY inside an entry is the arguable part, it is named in the row so you can
approve the entry and veto the key.

---

## C1 — flagship theme candidates

Five full productions. The two live flagships are each a look promoted to a
document — params, a smoothed spectrum, default post, and nothing else: no
modulation at all, no overlay, no background, no timeline. Every row below
commits to the modulation matrix in its **v2** form (per-route response
curves, attack/release lag, tempo-locked LFOs, the section-boundary pulse), a
post chain, the motion masters, and at least one document surface no shipped
content has ever carried.

| #   | Entry                                                                                 | Mode           | What it demonstrates                                                                                                                                                                                                                                                                                                                                                                                                                                              | Evidence                                                                                                                | Registry action                                                    | APPROVE / VETO |
| --- | ------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------- |
| 1   | **Deep Current** — bioluminescent folds a long way under the surface; nothing strikes | `nebula`       | 7 routes, every one curved or lagged. `smooth` curve + 1.4 s release on the bass swell; 2.2 s release on loudness→bloom; **saw LFO** (8 beats) on the drive glow as a tide; two sine LFOs on fold angle and scale; **sectionPulse→hue** with a 6 s release. `smoothSpectrum`, solid ink background, motion masters pulled down.                                                                                                                                   | `deep-current-quiet.png`, `deep-current-swell.png`                                                                      | **Replace `deep-current`** — same id, same name, content re-pins   |                |
| 2   | **Sunset Circuit** — the drive home, not the set; nothing in it flashes               | `synthwave`    | The only entry with **no beat route at all**. Six routes, all smooth curves on slow envelopes (1.6 s, 3 s releases). **Timeline automation lanes**: the sun sinks and the fog rolls in across the first 24 s, both lanes ending on the base value so deleting them holds the shot. Film grain at 0.085 doing the era work in the post chain.                                                                                                                      | `sunset-circuit-lane-03s.png`, `sunset-circuit-lane-09s.png`, `sunset-circuit-lane-15s.png` (the move, in three frames) | **Replace `sunset-circuit`** — same id, same name, content re-pins |                |
| 3   | **Cold Open** — an amber trace on a broadcast reticle under a hard editorial lockup   | `oscilloscope` | **Overlay lockup**: three text layers, `{title}`/`{artist}` tokens, wide-tracked kicker. **Timeline scenes + a `glitch` transition**: 12 s of standby, then a 2.5 s cut into the full instrument. **Audiogram** progress bar. **Lyric style** moved to the top so words cannot land on the artist line. Six routes incl. `sectionPulse→post:chromatic`.                                                                                                           | `cold-open-standby.png`, `cold-open-glitch.png`, `cold-open-open.png`                                                   | **New entry** `cold-open`                                          |                |
| 4   | **Meteor Hour** — a wide-open sky at festival scale                                   | `particles`    | **`energy→density`** with a 1.5 s attack and 3.5 s release: the sky physically empties through a breakdown and refills through the build — arrangement response, not beat response. **`sectionPulse→shootingStars`**, `exp`-curved, 4 s release: a shower at every boundary that burns out over the next bars. Seven routes.                                                                                                                                      | `meteor-hour-build.png`, `meteor-hour-drop.png`                                                                         | **New entry** `meteor-hour`                                        |                |
| 5   | **Blacklight** — a lit lattice running away from you in the dark                      | `tunnel-rings` | The **wireframe material**, which no shipped content has ever selected, with lit junctions and 4-fold mirror. Three sources nothing else uses: a **square LFO** on the lattice brightness (softened by 40 ms/180 ms lag so it swells rather than strobes), **`barPhase`** winding up the centre glow across each bar, and **`sectionPulse→mirror`** — a `mod: "snap"` enum, so a section boundary steps the shaft from four-fold to six-fold and walks back down. | `blacklight-lattice.png`, `blacklight-peak.png`                                                                         | **New entry** `blacklight`                                         |                |

### Things to hold against these five before approving

- **Two modes collide with the factory pack.** `synthwave` is Chrome Sunset's
  and `tunnel-rings` is Hyperlane's. Unavoidable at five candidates — the pack
  already spends 13 of the 16 modes — so both were placed as far from the
  incumbent as the mode allows (Chrome Sunset is driving and beat-locked,
  Sunset Circuit has no beat route at all; Hyperlane is a tiled corkscrew,
  Blacklight is a wireframe lattice). It is still two entries a user could
  reasonably say look like something they already have. **Rows 2 and 5 are the
  ones to veto if you disagree.**
- **Row 5 is the weakest of the five.** The lattice reads and the geometry is
  distinct, but the shaft fills with a flat mauve wash instead of going black
  between the wires (5–6% of the frame is in black, against 50–77% for rows
  2 and 3). Its rhythm routes are the most interesting in the set, which is
  why it is here rather than dropped; if you want it tighter the fix is inside
  the mode (a fog/level control that reaches the wireframe fill), not inside
  the theme.
- **All five are 16:9.** The factory pack already covers 9:16 and 1:1; these
  are the entries that become screenshots, and a mixed-aspect flagship set
  makes them incomparable. A deliberate choice, not an oversight.
- **The stills stage the track tags.** Cold Open's lockup reads `{title}` and
  `{artist}` from the loaded track, and a demo track loads with an empty
  artist, so the capture sets "Cold Open / Beatform" as stand-in tags. Nothing
  else in any frame is staged.
- **No entry uses `vocal` or a stem source**, deliberately — see the product
  notes below.

---

## C2 — look pass 2 (the nine live looks)

A look carries params and sync ONLY. That is the format's design, so the pass
has exactly two axes: the parameters Track B added to a mode, and `sync` —
which the `.bfpreset` envelope has always supported and which **not one of the
nine carries today**, so all nine currently play at whatever response feel the
app was last left on, including the three whose descriptions are statements
about response.

Each row shows only the delta. The emitted `.bfpreset` is the seed plus the
delta, because that is what the file format is. The suite reads
`scripts/gallery-seed-shots.mjs` and asserts every base still equals the live
seed key for key, so no delta here was proposed against a copy that drifted.

| #   | Look                | Mode             | Delta (only what changes)                                                                                                                                                                                          | Why                                                                                                                                                                                                                                                                                                                                                                                                                                       | Evidence                                               | APPROVE / VETO |
| --- | ------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------- |
| 6   | **Abyssal Bloom**   | `nebula`         | `saturation` 0.7 → **0.94**; `+duo` 0.55, `+hue2` 285, `+stars` 0.35, `+windStrength` 0.22, `+windAngle` 190; `+sync` bass/0.55                                                                                    | **Carries a real bug.** Authored before schema v14 changed what nebula's `saturation` MEANS, and `.bfpreset` is one of the three stores that documentedly cannot ride that migration — so the authored 0.7 is read today as a scaler and the look renders about a quarter flatter than you approved. 0.94 is the exact equal-render value. The rest is the second palette anchor, the star field and the current direction Track B added. | `abyssal-bloom-before.png` + `abyssal-bloom-after.png` |                |
| 7   | **Solar Temple**    | `spectrum-scape` | `+barShape` 2 (round columns), `+bandGlow`, `+hotBeat`, `+glowBeat`, `+driveHeight`, `+hotWindow`, `+fogDensity`, `+fillLight`, `+ambientLight`, `+hueLift`, `+saturation`; `barWidth` grid fix; `+sync` kick/0.38 | The largest gap of the nine: 12 authored params against a mode that carries 27 after the renderer wave, and none of the 15 it gained. Everything it needed to be a _temple_ was in that 15 — columns, a light rig, haze, and the beat/band response it had no way to express.                                                                                                                                                             | `solar-temple-before.png` + `solar-temple-after.png`   |                |
| 8   | **VHS Sunrise**     | `synthwave`      | `+roadW` 0.5, `+roadLanes`, `+roadGlow`, `+skyline`, `+skyDensity`, `+windows`, `+sunWarm`, `+scanCount`, `+scanWidth`; `scan`/`sunRays` grid fixes; `+sync` kick/0.3                                              | Ten new params landed on this mode and the seed uses none, so it is a sky with nothing underneath it. The road is the floor the genre is named for; the city's windows ride the treble; the striped sun stops being a fixed sprite.                                                                                                                                                                                                       | `vhs-sunrise-proposed.png`                             |                |
| 9   | **Solar Cascade**   | `particle-flow`  | `+field` 3 (orbital), `+attractor` 1 (ring), `+ribbon`, `+midSwirl`, `+trebleJitter`, `+saturation`, `+vignette`, `+bgLevel`; `size`/`sat` grid fixes; `+sync` kick/0.28                                           | The description sells a galaxy; curl noise was the only field available, so what it rendered was weather with a centre pull bolted on. Orbital + ring attractor is the shape the words already describe, and two more bands now reach a look that heard only bass and kick.                                                                                                                                                               | `solar-cascade-proposed.png`                           |                |
| 10  | **Orchid Glass**    | `metaballs`      | `+environment` 1 (Studio), `+bassWeight` 0.45, `+eccentric` 0.28; `speed`/`gloss`/`threshold`/`bgLevel` grid fixes; `+sync` bass/0.5                                                                               | The description says "lit like studio chrome" and the look renders in the Void, because the gloss environment did not exist when it was authored. **`smear` declined**: enabling it moves the mode onto the high-precision trail path, which is a performance reclassification, not a look decision.                                                                                                                                      | `orchid-glass-before.png` + `orchid-glass-after.png`   |                |
| 11  | **Prism Cathedral** | `echo-trails`    | `+source` 1 (star), `+warp` 2 (radial wave); `thick`/`flowSwirl` grid fixes; `+sync` kick/0.32                                                                                                                     | The accumulator could only eat a ring when this was authored, so "stained-glass petals" were six copies of the same closed loop. The star source makes the lobes it already asks for into points of light. **`warp` is the arguable key** — veto it alone if the radial wave is too much.                                                                                                                                                 | `prism-cathedral-proposed.png`                         |                |
| 12  | **Obsidian Pulse**  | `bass-circle`    | `+coreFill` 2 (waveform), `+segments` 24, `+segGap` 0.18, `+partBeat` 0.45; `+sync` kick/0.28                                                                                                                      | The one seed that sets `cover: 0` — a deliberately empty centre, which is exactly the case `coreFill` was added for. A live waveform ring keeps "a pump you can feel in the artwork" true on tracks with no artwork.                                                                                                                                                                                                                      | `obsidian-pulse-proposed.png`                          |                |
| 13  | **Neon Monsoon**    | `tunnel-rings`   | `+junction` 0.5; `tileSpectrum`/`fogFar` grid fixes; `+sync` kick/0.26                                                                                                                                             | The thinnest delta, deliberately. Junctions flash the intersection mouths on the beat, pure addition to a look already built around "leans into the drums". **`material` declined**: swapping the wall away from tiles changes the silhouette, and the seed's own description names the tiles.                                                                                                                                            | `neon-monsoon-proposed.png`                            |                |
| 14  | **Glass Mandala**   | `radial-burst`   | _(no param delta)_; `+sync` bass/0.55                                                                                                                                                                              | The one seed with nothing available: Track B's queue left Radial Burst alone on the grounds that it already is the bar. Its whole deepening is the sync block — and "breathe with the low end, made for slow, heavy sets" is a statement about response, which the look currently does not make. Listed so you can see the pass looked and found only this.                                                                               | `glass-mandala-proposed.png`                           |                |

### One finding that spans the nine

**Thirteen values across six of the nine sit off their spec's step grid.**
They render as authored right up until the user brushes the slider, at which
point the range input snaps them and the look silently becomes a different
one. `src/render/presetStyles.test.ts` enforces grid alignment for in-code
styles; nothing enforced it for anything that ships. Every delta above carries
the one-step correction, and both suites in this lane now assert it. Worth
considering as a rule for the gallery's own CI validator.

---

## C3 — new looks Track B unlocked

Four modes with no gallery entry at all, each carrying a visual that Track B
made reachable and that no shipped look or theme has ever selected.

| #   | Look                                                                       | Mode            | What it demonstrates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Registry action             | Evidence                   | APPROVE / VETO |
| --- | -------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------- | -------------- |
| 15  | **Ember Veil** — aurora in ember and gold over a moonlit ridge             | `aurora`        | **C3's named target.** The v1 round dropped Aurora as "resists scripted tuning" — it did, because the palette was a hardcoded cosine basis that `hue` could only ROTATE, so every attempt landed back in the same green-violet family. `palWarm` +0.7 and `palSpan` 1.25 parameterize the basis itself; this is territory no Aurora content has occupied. Plus the scene the mode gained and has never shipped: five curtains, a low moon with its own halo, a rough ridge, the ice reflection. Slow envelopes on both edges. | **New entry** `ember-veil`  | `ember-veil-proposed.png`  |                |
| 16  | **Sonar Wall** — the LED wall as a scrolling spectrogram                   | `led-matrix`    | Waterfall is a display MODE, not a tweak — a real-time spectrogram on the texture-feedback path. It exists in the product and has never once been what a user sees when they click something. Peaks and rounding off, because a waterfall is a surface, not a bar chart.                                                                                                                                                                                                                                                      | **New entry** `sonar-wall`  | `sonar-wall-proposed.png`  |                |
| 17  | **Wide Glass** — left channel one way, right the other, over a glass floor | `spectrum-bars` | `stereoSplit` drives the halves from the actual stereo field rather than mirroring one signal, so a mono bounce and a wide master do not look the same. Reflection floor, dot caps, and a frequency trim so the bar budget is spent where the music is. On the mode most people meet first.                                                                                                                                                                                                                                   | **New entry** `wide-glass`  | `wide-glass-proposed.png`  |                |
| 18  | **Phase Bloom** — a true phase scope drawing Lissajous figures             | `oscilloscope`  | The XY display is a second instrument inside the mode — planar stereo binding, both channels cut at one shared trigger — and like the waterfall it has never shipped inside anything clickable. `xyRotate: 45` is the documented convention that stands a mono signal upright.                                                                                                                                                                                                                                                | **New entry** `phase-bloom` | `phase-bloom-proposed.png` |                |

**What the three before/after pairs do and do not show.** Rows 6, 7 and 10 are
shot twice because their argument is a comparison rather than a description.
The `-before` frame is the seed EXACTLY as it ships today — its own params, and
no sync at all, since not one of the nine carries one. The `-after` frame is
the whole proposed row, so the visible difference is the ENTIRE delta, not any
single key in it. That matters most on row 6: the saturation correction is
arithmetic (0.7 ÷ 0.75 = 0.9333, snapped to 0.94 on the 0.02 grid) and on its
own it is a modest lift, while most of what you can see between those two
frames is `duo` + `hue2` putting a second palette anchor in, `stars` adding the
field behind the clouds, and the wind giving the water a direction. Approve or
veto the row as a whole; if you want the saturation fix WITHOUT the rest, say
so on the row and it ships as a one-key delta.

---

## Product notes this lane turned up (not decisions — findings)

1. **Two registered modulation sources are dark until you feed them.**
   `vocal` only carries a signal once lyrics exist (`realtimeSource.ts:306`,
   `offlineSource.ts:466`) and `stem1..4:*` only once stems are imported.
   Routing to either in shipped content ships a route that does nothing on a
   bare track, so no candidate uses them.
   **Credit where it is due: the stem case is already half-handled.** A route
   whose stem source matches no loaded stem renders as
   `"<source> (stem not loaded)"` in its row (`ModulationPage.tsx:867-868`),
   deliberately, so a reopened stem project does not show a blank route. The
   gap is the FRESH picker: choosing a stem source for a stem you have not
   loaded gives no such warning at the moment you choose it, and `vocal` has
   no affordance of this kind at all — it simply reads zero. A "no signal"
   state on the source picker itself, or on the driven-by meter, would close
   both.
2. **A preset's `hue` is not the colour you get.** The shared cosine palette
   is intuitive on its own (195 really is blue), but each mode adds a phase
   offset from its own hue spread and spectrum colouring. Measured: Kaleido
   Nebula's frame mean lands near `284 - hue`, so this lane's deep blue sits
   at hue 90. Synthwave needed 45/330 rather than 28/202 to read gold.
   **The sharpest case is the Tunnel's Wireframe material**, where a six-value
   hue sweep moved the frame's measured mean hue by four degrees in total. The
   mechanism is DILUTION, not exclusion — the hue-driven palette is present in
   every term, but in that branch the dominant ones are mixed a long way toward
   a fixed near-white: the beat-pulse ring is `mix(pal, vec3f(1.0), 0.5)` and
   the hot vanishing core `mix(pal, vec3f(1.0), 0.6)`
   (`tunnelRings.ts:1155,1159`), while the branch's own wall term is scaled
   down hard (`lit = tileLevel*0.12 + surf*0.05 + v*tileSpectrum*0.2`, line 1041) and the wires get a fixed brightness floor
   (`seamLevel = groutLevel*1.3 + 0.15`). Net effect: whatever `hue` says, the
   frame is dominated by desaturated near-white terms, so the base colour
   barely reads. That is why row 5 was renamed from Blueprint to Blacklight
   rather than shipped promising a cyan it will not render. Not necessarily a
   bug — the floor exists so a wireframe with no wires is not an empty screen —
   but it does make `hue` close to inoperative in that material, which is worth
   a look.
3. **Authoring a bright mode at a neutral exposure is a trap.** Kaleido Nebula
   and Particles both emit well past 1.0 across large regions; every one of
   those values clips to white before the post chain can shape it. Three of
   the five candidates came back from the first capture with 0% of the frame
   in black. `post.exposure` at 0.35–0.45 with the tonemap on is what fixed
   them. Nothing warns an author about this.
4. **`constellation` is scoped to drift mode** by its own hint, so setting it
   on a `fly` look ships a number that renders nothing. Meteor Hour leaves it
   out; the panel gives no sign the two controls are exclusive.
5. **Step-grid alignment is unenforced for shipped content** — see the C2
   finding above.

---

# Appendix — P-6 implementation note

P-6 rides with Track C by its own verdict, and it is deliberately NOT built in
this lane: it edits the Visuals panel, and P-5's panel work would collide with
it file for file. This is the one page it needs to start from the moment the
veto round closes.

## What P-6 is

Factory themes become **built-in Gallery entries**. Today the two live in
different places with different affordances: the Gallery dialog browses the
remote registry (download, hash-verify, install), while the 13 factory themes
are a row of chips in the Visuals panel's Themes section that apply on click.
A user looking for "a complete look" has to know both exist. After P-6 the
Gallery is the one place complete looks come from, the factory pack is in it
marked **Built-in**, and the panel section shrinks to two buttons.

## The four pieces

1. **Factory themes appear as Gallery entries.** They need to reach the
   dialog's grid without going near the network path: no `contentUrl`, no
   `sha256`, no size cap, no `minAppVersion` gate — a built-in entry is
   already in the binary. The cleanest shape is a synthetic entry type the
   list merges in ahead of the fetched ones, with the download/verify branch
   skipped and "install" resolving straight to `applyTheme`.
2. **A "Built-in" badge.** The dialog already renders a type badge per card
   (`look` / `theme`) with a one-sentence tooltip from `ENTRY_BLURB`; the
   built-in mark is a sibling of that, and it needs its own sentence in the
   same place so the two badges tell one story.
3. **Offline always.** The built-in rows must render when the registry fetch
   fails — which is the current empty/error state for the whole dialog. That
   is the piece most likely to be missed: the failure path has to draw the
   built-ins and put the error where the remote rows would have been, rather
   than replacing the grid.
4. **The panel section shrinks to two buttons.** The `FACTORY_THEMES.map(...)`
   chip row goes; what remains is "Save theme…" / "Import…" plus the existing
   `GalleryLink` deep link, now pre-filtered to `theme`. Deleting the chip row
   is what makes the Gallery the single door.

## Files it touches

| File                                                           | Change                                                                                                                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ui/GalleryDialog.tsx`                                     | Merge built-ins into the grid; "Built-in" badge + its blurb; make the fetch-failure path still render them                                                                                        |
| `src/state/gallery.ts`                                         | A built-in entry shape alongside `GalleryEntry`; `entryGate()` must return `null` for them (no `minAppVersion`, no `schemaVersion` gate)                                                          |
| `src/state/slices/galleryActions.ts`                           | `installGalleryEntry` gains a branch that skips fetch/hash/parse for a built-in and calls `applyTheme` directly; decide whether built-ins write `galleryInstalled` at all (they are not installs) |
| `src/ui/ParamsPanel.tsx`                                       | Delete the factory-theme chip row (~line 1327); keep Save/Import; point `GalleryLink` at `filter="theme"`                                                                                         |
| `src/state/factoryThemes.ts`                                   | Unchanged as data. It gains one derived export: the pack as gallery-entry rows                                                                                                                    |
| `src/state/gallery.test.ts`, `src/state/factoryThemes.test.ts` | Built-ins are ungated, survive a failed registry fetch, and apply without touching the network                                                                                                    |
| `scripts/gallery-e2e.mjs`                                      | Its dialog-surface assertions count cards ("11 cards / filter 2 themes / search 1 / 11 blob imgs") — every one of those numbers moves                                                             |
| `docs/guide.md`, `README.md`                                   | The Gallery and Themes sections both describe the current two-doors arrangement                                                                                                                   |

## Traps

- **`gallery-e2e.mjs` asserts exact counts** against the LIVE registry on
  `main`. Adding 13 built-ins changes all of them, and the script drives the
  true default path with no override — so it fails the moment P-6 lands unless
  its expectations move in the same commit.
- **A built-in must not be gated.** `entryGate()` compares `minAppVersion` and
  `schemaVersion` and returns a "update the app" string; a built-in has
  neither, and falling through the version comparison would show the pack as
  permanently un-installable.
- **The preview image.** Remote entries render previews as hash-verified
  `blob:` URLs, and the CSP's `img-src` deliberately excludes the raw host.
  Built-ins have no preview at all today. Either they ship thumbnails in the
  bundle or the card needs an honest no-preview state — worth deciding before
  the work starts, because it changes the card component either way.
- **"Install" is the wrong verb** for something already present. The button
  copy needs its own decision (Apply?), and it is user-facing text, so it
  belongs to the same naming pass that settled Style / Look / Theme / Gallery.
