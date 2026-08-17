import type { PresetDef } from "../types";
import { WGSL_COLOR_CONTROLS } from "../wgslLib";

/**
 * OVERGROWTH — a living reaction-diffusion field (P-19, the roster's last
 * entry).
 *
 * VISUAL IDENTITY. The frame is a culture, not a readout: two invisible
 * chemicals feed on each other (Gray-Scott), and what you watch is the
 * colony they grow — coral fingers reaching, lichen crusts closing over,
 * ink blooming through water. The music farms it: the track's energy sets
 * how fast life spreads, treble etches the growth into finer filament,
 * bass makes the colonies swell and split, and every kick drops a new
 * seed that the field then grows around. Nothing is drawn where the music
 * is — the music changes the RULES, and the picture is what the rules do
 * next. That indirection is the mode's whole character: it never snaps to
 * the beat, it RESPONDS, a beat late and alive, the way a garden responds
 * to weather.
 *
 * QUIET IS STILL ALIVE. A reaction-diffusion field in a living regime
 * animates by itself — worms crawl, spots breathe, ripples churn — so a
 * silent passage keeps moving with zero audio in it. On top of that a
 * whisper-level pilot seed lands on every bar line, so the culture can
 * never die out entirely, and the ground under everything is a lit
 * surface (floorLevel), never a hole.
 *
 * THE STATE IS THE ALPHA LANE, THE PICTURE IS DEVELOPED FROM IT. The
 * composite pass reads only RGB, so the raw output's alpha is a free data
 * channel (the Spectro Falls precedent). Gray-Scott needs TWO fields, so
 * the alpha plane is split into two vertical tiles: the top half stores
 * the substrate A, the bottom half the activator B, each tile covering
 * the whole logical field. Display RGB is composed fresh every frame from
 * field taps — both halves of the canvas show the same full picture — so
 * every look knob (contrast, palette, relief, paper) develops the WHOLE
 * living field at display time, and no glow, grain or vignette can ever
 * accumulate into the chemistry.
 *
 * A FIXED LOGICAL GRID, NOT THE PIXEL GRID. The field is exactly
 * RD_NX × RD_NY cells in UV space at every canvas size — Spectro Falls'
 * resolution-independent slices, generalized to 2D. State is piecewise-
 * constant per cell and every state tap is a textureLoad of the ONE texel
 * holding another cell's centre — never the filtered sampler, whose
 * half-texel straddle at small canvas heights mixed neighbouring data
 * rows into anisotropic extra diffusion and collapsed the whole culture
 * into horizontal banding (this lane's first device walk). Exact texels
 * make the sim walk one identical trajectory at every canvas that gives
 * each data row a texel (≥ 320×360); far below that (the 192×108 GPU
 * matrix) several field rows share a texel and the sim runs coarser —
 * deterministic at that resolution, never anisotropic. At the A/B tile
 * seam that sharing is cross-chemical for the field's outermost edge
 * rows only; the virgin probe pairs with the field centre so it cannot
 * misfire there, and the display insets its bottom rows adaptively so
 * the degradation never reaches the frame.
 *
 * DETERMINISM. State advances only on the fixed 60 Hz feedback clock:
 * u.dt is the fixed step on an advance and ZERO on presentation-only
 * frames, and every state expression multiplies by it — dt = 0 is an
 * exact pass-through, so presentation can never advance chemistry. Beat
 * seeds derive from the BEAT COUNT via the same floor-crossing window
 * Spectro Falls prints beat marks with, positioned by a plastic-constant
 * R2 sequence indexed on that count — the same beat lands the same seed
 * in the live walk, the export's replay-from-zero walk and the GPU
 * matrix. A freshly cleared history is detected in-shader (A and B both
 * ~0, impossible in an evolved field where feed pulls A up everywhere)
 * and initialized to a designed constellation — pure functions of the
 * cell index, never Math.random. After a user SEEK the preview keeps its
 * field (like Spectro Falls keeps its record); a chaotic field never
 * bit-reconverges with the export's replay, but the deterministic
 * skeleton — seed positions, regime, palette — re-locks within bars, so
 * the divergence is texture, never structure.
 *
 * NUMERICS. Karl Sims' parameterization: normalized 3×3 Laplacian (orth
 * 0.2 / diag 0.05 / centre −1), Du = Pattern scale, Dv = Du/2, explicit
 * Euler. The stencil's worst eigenvalue is −1.6, so the update factor is
 * (1 − 1.6·D·dt); dt is clamped to keep D·dt ≤ 1.1 — bigger patterns
 * honestly integrate slower instead of exploding. Bass rides the
 * CHEMISTRY term, not dt, so a drop can surge growth without touching
 * the stability bound.
 */
export const overgrowth: PresetDef = {
  id: "overgrowth",
  name: "Overgrowth",
  description:
    "A living culture the music farms: energy feeds the growth, treble etches it finer, bass makes the colonies swell, and every kick plants a seed the field grows around. Coral, lichen, dividing cells or ink on paper — it keeps living between the beats.",
  styles: [
    // Overgrowth — the defaults: coral fingers in a deep lagoon, ember at
    // the growing tips, a slow upward current.
    { id: "growth", name: "Overgrowth", values: {} },
    // Reef — polyp colonies in shallow water: aqua bodies, pink-coral rims,
    // strong beat seeding and relief. The postcard.
    {
      id: "reef",
      name: "Reef",
      values: {
        form: 3,
        scale: 1.2,
        hue: 185,
        hueSpread: 150,
        seeds: 0.8,
        surge: 0.55,
        glow: 0.9,
        relief: 1.05,
        contrast: 0.6,
        seedSize: 1.2,
        bassGlow: 0.16,
      },
    },
    // Lichen — a slow labyrinth crust closing over stone: gold on grey,
    // colour pulled low, almost still. Reads across a room.
    {
      id: "lichen",
      name: "Lichen",
      values: {
        form: 2,
        scale: 0.7,
        speed: 0.6,
        hue: 48,
        hueSpread: 25,
        saturation: 0.55,
        duo: 0.8,
        growth: 0.3,
        seeds: 0.15,
        flow: 0,
        relief: 1.25,
        glow: 0.35,
        haze: 0.55,
        floorLevel: 0.055,
        grain: 0.5,
      },
    },
    // Sumi — ink in water on paper: the display inverts to a warm page,
    // blooms rise like drops just touched the surface. The gallery chip.
    {
      id: "sumi",
      name: "Sumi",
      values: {
        form: 4,
        paper: 1,
        hue: 215,
        hueSpread: 10,
        saturation: 0.35,
        contrast: 0.7,
        speed: 0.8,
        flow: 0.35,
        seeds: 0.7,
        seedSize: 1.4,
        glow: 0.2,
        relief: 0.45,
        grain: 0.45,
        vignette: 0.2,
      },
    },
    // Mitosis — cells dividing under the strobe: electric magenta into
    // cyan, every kick a new cell, everything pumping. The VJ chip.
    {
      id: "mitosis",
      name: "Mitosis",
      values: {
        form: 1,
        scale: 0.8,
        speed: 1.5,
        hue: 315,
        hueSpread: -95,
        seeds: 0.9,
        surge: 0.8,
        growth: 0.7,
        glow: 1.2,
        relief: 0.5,
        contrast: 0.65,
        bassGlow: 0.2,
        vignette: 0.5,
      },
    },
    // Veins — deep red channels branching through dark tissue, sinking
    // slowly, lit like an emboss. The moody one.
    {
      id: "veins",
      name: "Veins",
      values: {
        form: 2,
        scale: 1.4,
        speed: 0.85,
        hue: 5,
        hueSpread: 15,
        duo: 0.85,
        growth: 0.65,
        etch: 0.15,
        seeds: 0.3,
        flow: -0.15,
        relief: 1.1,
        haze: 0.6,
        floorLevel: 0.03,
        grain: 0.4,
      },
    },
  ],
  params: [
    {
      key: "form",
      label: "Form",
      group: "shape",
      control: "enum",
      // A structural switch: each option is a different (feed, kill) regime
      // of the reaction, and modulating it would teleport the chemistry
      // between regimes every frame (the led-matrix Display rule).
      mod: "off",
      options: [
        { value: 0, label: "Coral", hint: "Fingers that branch and reach — the classic growth" },
        { value: 1, label: "Mitosis", hint: "Cells that swell and divide, always in motion" },
        { value: 2, label: "Labyrinth", hint: "A maze crust that closes over the frame" },
        { value: 3, label: "Polyps", hint: "Stable colonies that hold their ground" },
        { value: 4, label: "Ripples", hint: "An excitable field of spreading waves" },
      ],
      min: 0,
      max: 4,
      step: 1,
      default: 0,
      hint: "Which life the chemistry grows — the reaction's regime",
    },
    {
      key: "scale",
      label: "Pattern scale",
      group: "shape",
      taper: "log",
      min: 0.4,
      max: 2,
      step: 0.05,
      default: 1,
      hint: "Size of the living structures. Bigger patterns also grow slower — that is physics, not a bug",
    },
    {
      key: "speed",
      label: "Tempo",
      group: "motion",
      min: 0.2,
      max: 1.8,
      step: 0.05,
      default: 1,
      hint: "How fast the field lives, independent of the track's tempo",
    },
    {
      key: "hue",
      label: "Hue",
      group: "color",
      control: "hue",
      min: 0,
      max: 360,
      step: 1,
      default: 205,
      hint: "The field's base color — ground, colony bodies and the paper tint sit here",
    },
    {
      key: "hueSpread",
      label: "Hue spread",
      group: "color",
      min: -180,
      max: 180,
      step: 5,
      default: 155,
      hint: "How far around the wheel the growing tips travel from the base",
    },
    {
      key: "saturation",
      label: "Saturation",
      group: "color",
      min: 0,
      max: 2,
      step: 0.01,
      default: 1,
      hint: "Overall color intensity (1 = as designed, 0 = grayscale)",
    },
    {
      key: "lightness",
      label: "Lightness",
      group: "color",
      min: 0,
      max: 2,
      step: 0.01,
      default: 1,
      hint: "Overall brightness of every color (1 = as designed)",
    },
    {
      key: "duo",
      label: "Depth tint",
      group: "color",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.55,
      hint: "Colony interiors drift toward a second hue with depth — the duotone body of the look",
    },
    {
      key: "growth",
      label: "Growth drive",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
      hint: "How hard the track's energy feeds the field — loud passages bloom, quiet ones thin out",
    },
    {
      key: "etch",
      label: "Treble etch",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.35,
      hint: "Treble pushes the chemistry toward finer, more etched structure",
    },
    {
      key: "surge",
      label: "Bass surge",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.4,
      hint: "Bass accelerates the reaction — colonies visibly swell and split on the low end",
    },
    {
      key: "seeds",
      label: "Beat seeds",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.6,
      hint: "Every beat plants a seed the field grows around, placed on a deterministic spiral",
    },
    {
      key: "glow",
      label: "Front glow",
      group: "glow",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.6,
      hint: "Light on the growing front — the living edge between colony and open ground",
    },
    {
      key: "relief",
      label: "Relief light",
      group: "glow",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.7,
      hint: "Embossed side-light over the field, so colonies read as raised growth instead of flat print",
    },
    {
      key: "flow",
      label: "Current",
      group: "motion",
      min: -1,
      max: 1,
      step: 0.05,
      default: 0.1,
      hint: "A slow vertical current carrying the whole culture — positive rises like ink, negative sinks",
    },
  ],
  advanced: [
    {
      key: "contrast",
      label: "Contrast",
      group: "color",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
      hint: "The develop window between open ground and full growth — applied at display time over the whole field",
    },
    {
      key: "seedSize",
      label: "Seed size",
      group: "reaction",
      min: 0.3,
      max: 3,
      step: 0.05,
      default: 1,
      hint: "Radius of every planted seed, beats and bars alike — the top of the range drops whole ink blots",
    },
    {
      key: "barSurge",
      label: "Bar bloom",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
      hint: "Bar lines plant bigger seeds than beats — the phrase-level punctuation",
    },
    {
      key: "paper",
      label: "Paper",
      group: "color",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0,
      hint: "Cross-fade the print negative: dark ink growing on a warm page instead of light on dark",
    },
    {
      key: "haze",
      label: "Field haze",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.35,
      hint: "Soft interior shading from the substrate — the body of each colony, not its edge",
    },
    {
      key: "floorLevel",
      label: "Floor glow",
      group: "backdrop",
      tier: "curated",
      min: 0,
      max: 0.2,
      step: 0.005,
      default: 0.04,
      hint: "Brightness of the open ground — silence is a lit surface here, never a hole",
    },
    {
      key: "bassGlow",
      label: "Ground wash",
      group: "backdrop",
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.12,
      hint: "The ground breathes with the bass beneath the culture",
    },
    {
      key: "vignette",
      label: "Vignette",
      group: "backdrop",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.35,
      hint: "Corner darkening around the frame",
    },
    {
      key: "grain",
      label: "Grain",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.25,
      hint: "Film grain over the print, livelier when the energy is",
    },
  ],
  wgsl: /* wgsl */ `
${WGSL_COLOR_CONTROLS}

// ---------------------------------------------------------------------------
// The logical field. RD_NX x RD_NY CELLS in UV space at every canvas size —
// resolution independence is this pair of constants, nothing else. State is
// piecewise-constant per cell; every state tap reads a cell CENTRE, so cell
// centres resample cell centres exactly and the sim walks one trajectory at
// every canvas from ~640x360 up (below that, reads bleed — deterministic per
// resolution, and only ever a touch of extra diffusion).
// ---------------------------------------------------------------------------
const RD_NX: f32 = 320.0;
const RD_NY: f32 = 180.0;

fn clampCell(c: vec2f) -> vec2f {
  return clamp(c, vec2f(0.0), vec2f(RD_NX - 1.0, RD_NY - 1.0));
}

/** Centre of a cell, in field UV. */
fn cellCenter(c: vec2f) -> vec2f {
  return (c + vec2f(0.5)) / vec2f(RD_NX, RD_NY);
}

// The two chemicals share the alpha plane as vertical tiles: substrate A in
// the top half, activator B in the bottom half. The composite pass derives
// its own alpha and never reads this lane, so the tiles are pure data.
//
// STATE reads are textureLoad — the exact-texel idiom, not the filtered
// sampler. The tiles stack 360 data rows into the frame, so at canvas
// heights under ~720 a FILTERED tap at a row centre straddles texels and
// mixes neighbouring rows: extra vertical diffusion the horizontal axis
// does not get, and the whole culture collapsed into horizontal banding
// (caught on device at 960x540, the first walk of this lane). textureLoad
// reads the one texel that holds the cell — exact at every canvas that
// gives each data row a texel (>= 360 rows tall), bit-stable across
// preview and export sizes, and merely coarser (never anisotropic) below.
fn stateA(c: vec2f) -> f32 {
  let dims = vec2f(textureDimensions(feedbackTex));
  let cc = cellCenter(clampCell(c));
  let p = clamp(vec2f(cc.x, cc.y * 0.5) * dims, vec2f(0.0), dims - vec2f(1.0));
  return textureLoad(feedbackTex, vec2i(p), 0).a;
}
fn stateB(c: vec2f) -> f32 {
  let dims = vec2f(textureDimensions(feedbackTex));
  let cc = cellCenter(clampCell(c));
  let p = clamp(vec2f(cc.x, 0.5 + cc.y * 0.5) * dims, vec2f(0.0), dims - vec2f(1.0));
  return textureLoad(feedbackTex, vec2i(p), 0).a;
}

/** Distance between a cell and a field-UV point, in CELLS — the metric every
 * seed radius is written in, aspect-true on the field's own 16:9 grid. */
fn cellDist(c: vec2f, p: vec2f) -> f32 {
  return length(c + vec2f(0.5) - p * vec2f(RD_NX, RD_NY));
}

/**
 * The R2 low-discrepancy sequence (plastic constant): seed #i's position.
 * Deterministic and well spread — consecutive beats never clump, and the
 * same beat count lands the same seed in the live walk, the export's
 * replay-from-zero walk and the GPU matrix.
 */
fn r2pos(i: f32) -> vec2f {
  return fract(vec2f(0.5 + i * 0.7548776662, 0.5 + i * 0.5698402910));
}

/**
 * Continuous beat position, anchored to the detected grid through beatPhase
 * (the Spectro Falls beat-mark derivation). Tracks with no grid yet fall
 * back to a fixed virtual 100 BPM lattice so seeding stays deterministic
 * and musical-ish either way.
 */
fn beatPosAt(t: f32) -> f32 {
  if (u.bpm >= 1.0) { return t * u.bpm / 60.0 - u.beatPhase; }
  return t * 1.6667;
}

// ---------------------------------------------------------------------------
// The chemistry. Karl Sims' Gray-Scott: normalized 3x3 Laplacian, Du = the
// Pattern-scale knob, Dv = Du/2. Each Form is a (feed, kill) anchor in the
// living band; audio wiggles AROUND the anchor in small absolute deltas, so
// every reachable point stays alive.
// ---------------------------------------------------------------------------
// Anchors tuned ON DEVICE against this exact grid, not copied from the
// Pearson map: the 320x180 discretization shifts every regime a little.
// The book's mitosis point (f .0367 / k .0649) sat close enough to the
// death line here that the constellation extinguished to a handful of
// dots in twenty seconds, and the book's coral point grew closed rings
// instead of reaching fingers — both re-anchored by walking the field and
// looking, the only tuning instrument this mode respects.
fn formFeed() -> f32 {
  let f = P_form();
  if (f < 0.5) { return 0.0460; } // Coral — the worm band: fingers, not rings
  if (f < 1.5) { return 0.0310; } // Mitosis — dividing blobs that SUSTAIN
  if (f < 2.5) { return 0.0290; } // Labyrinth
  if (f < 3.5) { return 0.0300; } // Polyps
  return 0.0140;                  // Ripples
}
fn formKill() -> f32 {
  let f = P_form();
  if (f < 0.5) { return 0.0630; }
  if (f < 1.5) { return 0.0625; }
  if (f < 2.5) { return 0.0570; }
  if (f < 3.5) { return 0.0620; }
  return 0.0500;
}

/** Feed rate this tick: the track's energy farms the field. Clamped to the
 * band where SOME regime lives, whatever the knobs say. */
fn feedNow() -> f32 {
  return clamp(formFeed() + P_growth() * 0.012 * (u.energy - 0.45), 0.006, 0.09);
}

/** Kill rate this tick: treble etches the structure finer. The small depth
 * is deliberate — the living band is narrow, and +-0.006 already morphs
 * worms into filament without crossing the death line. */
fn killNow() -> f32 {
  return clamp(formKill() + P_etch() * 0.006 * (u.treble - 0.4), 0.043, 0.071);
}

/**
 * Integration step for this tick. u.dt is the fixed 60 Hz feedback step on a
 * state advance and ZERO on presentation-only frames — every state change
 * multiplies by this, so presentation is an exact pass-through by
 * construction. The clamp is the stability bound: the Laplacian stencil's
 * worst eigenvalue is -1.6, so D*dt must stay comfortably under 1.25;
 * capping at 1.1 keeps the worst mode damped at every reachable setting —
 * which is why big patterns (large Du) honestly grow slower.
 */
fn stepDt() -> f32 {
  return min(P_speed(), 1.1 / max(P_scale(), 0.0001)) * u.dt * 60.0;
}

/**
 * Whole-cell vertical drift (the Current): the same floor-difference idiom
 * as Spectro Falls' scroll, in cells — the field only ever moves by WHOLE
 * cells per tick, so drifting costs no resampling and the record never
 * blurs. Positive current rises like ink; the boundary row stretches.
 */
fn flowShift() -> f32 {
  let rate = P_flow() * 14.0;
  return floor(u.time * rate) - floor((u.time - u.dt) * rate);
}

/**
 * THE VIRGIN CONSTELLATION — what a freshly cleared field grows from. A
 * cleared history reads A = B = 0, a state no evolved field can reach
 * (feed pulls A up everywhere), so the first advance detects it and lays
 * this designed seed set: fourteen R2-placed discs with growing radii, a
 * centre pair, and per-cell hash dither to break the symmetry organically.
 * Pure functions of the cell index — never Math.random.
 */
fn seedField(c: vec2f) -> f32 {
  let q = cellCenter(clampCell(c));
  var b = 0.0;
  for (var i = 0; i < 14; i++) {
    let fi = f32(i);
    let r = P_seedSize() * (3.0 + 2.2 * fract(fi * 0.381966)) * mix(0.7, 1.3, fract(fi * 0.618034));
    let d = cellDist(clampCell(c), r2pos(fi));
    b = max(b, (1.0 - smoothstep(r * 0.45, r, d)) * 0.9);
  }
  // The centre pair: two touching discs just off-centre, so the very first
  // bar already shows a composed subject growing outward.
  let dc1 = cellDist(clampCell(c), vec2f(0.47, 0.5));
  let dc2 = cellDist(clampCell(c), vec2f(0.53, 0.52));
  let rc = P_seedSize() * 6.5;
  b = max(b, (1.0 - smoothstep(rc * 0.5, rc, min(dc1, dc2))) * 0.95);
  return clamp(b + (hash21(c) - 0.5) * 0.08, 0.0, 1.0);
}

/**
 * Beat seeding for this tick. The beat COUNT is the index: the crossing
 * window floor(pos(t)) != floor(pos(t - u.dt)) fires exactly once per beat
 * on the fixed clock (and never on a dt = 0 presentation frame, where the
 * window is empty). Bars plant bigger (Bar bloom), and every bar carries a
 * whisper-level pilot even at Beat seeds 0 — the culture can never die.
 */
fn beatStamp(c: vec2f) -> f32 {
  let bHere = floor(beatPosAt(u.time));
  if (bHere == floor(beatPosAt(u.time - u.dt))) { return 0.0; }
  let isBar = fract(bHere * 0.25) < 0.125;
  var strength = P_seeds();
  if (isBar) { strength = max(strength, 0.22); }
  if (strength < 0.001) { return 0.0; }
  // Radius tracks sqrt(Pattern scale) — the regime's own wavelength law
  // (wavelength ~ sqrt(D)). A radius fixed in cells was SUPER-critical at
  // fine scales: every stamp ignited a filled front and the culture
  // flooded into a featureless lake within a couple of minutes (caught on
  // the 150 s device walk). Tracking the wavelength keeps a seed the same
  // size RELATIVE to the life around it at every scale — and the injection
  // is a modest push, not a saturated disc, so a stamp ignites growth
  // without ever being a flood nucleus itself.
  let radius = P_seedSize() * sqrt(max(P_scale(), 0.1))
             * (3.2 + select(0.0, 3.0 * P_barSurge(), isBar));
  let d = cellDist(clampCell(c), r2pos(bHere + 7.0));
  return (1.0 - smoothstep(radius * 0.45, radius, d)) * (0.42 + 0.33 * strength);
}

/**
 * One Gray-Scott step for THIS pixel's tile, returning the new stored value
 * (A in the top tile, B in the bottom). All taps go through the virgin
 * branch together: a cleared field integrates its first step FROM the
 * constellation, so seed and chemistry share one code path.
 */
fn advance(c0: vec2f, tileA: bool) -> f32 {
  // Virgin = the WHOLE history was just cleared, so the probe pairs the own
  // cell with the field's CENTRE cell — a cell the A/B tile seam can never
  // corrupt. Probing only the own cell made seam-corrupted EDGE cells (on
  // sub-grid canvases, where several field rows share a texel) read as
  // forever-virgin: they re-initialized to the hot constellation every
  // single tick and burned a bright hairline along the frame edge.
  let centre = vec2f(RD_NX * 0.5, RD_NY * 0.5);
  let virgin = stateA(c0) + stateB(c0) < 0.001 && stateA(centre) + stateB(centre) < 0.001;
  let c = c0 + vec2f(0.0, flowShift());

  // Gather the 3x3 neighbourhood of this pixel's own chemical plus the
  // partner chemical at the centre — ten taps, the whole cost of the sim.
  var lap = 0.0;
  var self0 = 0.0;
  var partner = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let n = c + vec2f(f32(dx), f32(dy));
      var v: f32;
      if (virgin) {
        v = select(seedField(n), 1.0, tileA);
      } else {
        v = select(stateB(n), stateA(n), tileA);
      }
      if (dx == 0 && dy == 0) {
        self0 = v;
        lap -= v;
      } else if (dx == 0 || dy == 0) {
        lap += v * 0.2;
      } else {
        lap += v * 0.05;
      }
    }
  }
  if (virgin) {
    partner = select(1.0, seedField(c), tileA);
  } else {
    partner = select(stateA(c), stateB(c), tileA);
  }

  let a = select(partner, self0, tileA);
  let b = select(self0, partner, tileA);
  let dt = stepDt();
  // Bass surges the CHEMISTRY, not the integrator: reaction and feed/kill
  // run on a bass-accelerated clock while diffusion keeps the stability
  // bound — colonies swell and split on the low end without ever exploding.
  let chem = dt * (1.0 + P_surge() * u.bass * 0.9);
  let react = a * b * b;
  var next: f32;
  if (tileA) {
    next = a + P_scale() * lap * dt + (feedNow() * (1.0 - a) - react) * chem;
  } else {
    next = b + P_scale() * 0.5 * lap * dt + (react - (feedNow() + killNow()) * b) * chem;
    next = max(next, beatStamp(c0) * step(0.0001, u.dt));
  }
  return clamp(next, 0.0, 1.0);
}

// ---------------------------------------------------------------------------
// The darkroom. Display is developed fresh from the field every frame — the
// state stays raw chemistry, so contrast, palette, relief and paper re-print
// the WHOLE living field, not just what grows after the knob moved.
// ---------------------------------------------------------------------------

/** The develop window: activator concentration -> heat. */
fn develop(b: f32) -> f32 {
  let lo = mix(0.10, 0.035, P_contrast());
  let hi = mix(0.42, 0.24, P_contrast());
  return smoothstep(lo, hi, b);
}

fn preset(uv: vec2f) -> vec4f {
  // -------- state advance for THIS pixel's tile ---------------------------
  let tileA = uv.y < 0.5;
  var q = uv;
  if (tileA) { q = vec2f(uv.x, uv.y * 2.0); }
  else { q = vec2f(uv.x, (uv.y - 0.5) * 2.0); }
  let ownCell = floor(clamp(q, vec2f(0.0), vec2f(0.9999)) * vec2f(RD_NX, RD_NY));
  let stored = advance(ownCell, tileA);

  // -------- display: manual bilinear over cell centres --------------------
  // Four B taps + four A taps reconstruct a smooth field from the piecewise-
  // constant cells; the same four B taps also yield the gradient the relief
  // light shades with, so smoothing and lighting share their reads. The y
  // range is inset from the BOTTOM edge because the A/B tile seam poisons
  // it on sub-grid canvases: A-tile reads for the last field rows resolve
  // to the texel row that stores B row 0, so the substrate read ~0 there
  // and the interior tint burned a hairline along the frame's bottom. The
  // inset scales with how many field rows share one texel (520/canvas
  // height, ~1.4x the sharing ratio) — at every real canvas (>= 360 rows)
  // it stays the constant 1.5 rows, so full-size pixels are untouched;
  // only the degraded sizes trade a few duplicated edge rows for a clean
  // frame.
  let seamInset = max(1.5, 520.0 / vec2f(textureDimensions(feedbackTex)).y);
  let fi = vec2f(
    uv.x * RD_NX - 0.5,
    clamp(uv.y * RD_NY - 0.5, 0.5, RD_NY - seamInset),
  );
  let c0 = floor(fi);
  let fr = fi - c0;
  let b00 = stateB(c0);
  let b10 = stateB(c0 + vec2f(1.0, 0.0));
  let b01 = stateB(c0 + vec2f(0.0, 1.0));
  let b11 = stateB(c0 + vec2f(1.0, 1.0));
  let bS = mix(mix(b00, b10, fr.x), mix(b01, b11, fr.x), fr.y);
  let aS = mix(
    mix(stateA(c0), stateA(c0 + vec2f(1.0, 0.0)), fr.x),
    mix(stateA(c0 + vec2f(0.0, 1.0)), stateA(c0 + vec2f(1.0, 1.0)), fr.x),
    fr.y,
  );
  let grad = vec2f(
    mix(b10 - b00, b11 - b01, fr.y),
    mix(b01 - b00, b11 - b10, fr.x),
  );

  let heat = develop(bS);
  // Substrate depletion = how deep inside a colony this point sits. The
  // interior body of the look, distinct from the growing edge.
  let deep = clamp(1.0 - aS, 0.0, 1.0);
  let beatP = max(u.driveBeat, gridPulse(7.0));
  let pump = 1.0 + beatP * 0.35 * u.pulse;

  // The ground: open field is a lit surface breathing with the bass —
  // never a hole, so an empty culture reads as quiet rather than broken.
  var col = presetColor(P_hue(), 0.5, P_floorLevel() * (0.8 + 0.4 * (1.0 - uv.y)));
  col += presetColor(P_hue() + P_hueSpread() * 0.4, 0.7, 0.2)
       * u.bass * P_bassGlow() * (1.0 - 0.5 * heat);

  // Colony interiors: the duotone body, drifting toward the second hue with
  // depth. Haze is the flesh of the look; the edges below are its light.
  col += presetColor(P_hue() + P_hueSpread() * (0.2 + 0.55 * P_duo() * deep), 0.85, 0.32)
       * deep * P_haze() * (0.7 + 0.3 * heat);

  // A soft veil of the activator field, read through the hardware filter —
  // the ONE sampled feedback read (state goes through textureLoad, see
  // stateA). Display-only softness that never feeds back into chemistry;
  // it is also what opts the preset into the renderer's feedback path
  // (presetUsesFeedback statically scans for this call). The v range is
  // inset past the tile seam: a filtered tap AT v = 0.5 mixes the A tile's
  // bottom texels into the veil — substrate reads ~1, so the top edge of
  // the frame grew a bright hairline.
  let mist = feedbackSample(vec2f(uv.x, clamp(0.5 + uv.y * 0.5, 0.5042, 0.9958))).a;
  col += presetColor(P_hue() + P_hueSpread() * 0.35, 0.7, 0.28) * mist * P_haze() * 0.25;

  // The growing FRONT: the band where the field crosses the develop window
  // — literally the line between colony and open ground, i.e. where life
  // is happening right now.
  let front = heat * (1.0 - heat) * 4.0;

  // The membrane: heat squared for luminance (the Spectro Falls lesson —
  // reserve the bright end for genuine peaks), peaks whiting out so a hot
  // rim reads as lit rather than painted. The hue is keyed on the FRONT,
  // not on raw heat: the first device walks ran the ramp on heat alone and
  // every style painted itself wall-to-wall in its TIP colour, because
  // inside a worm heat saturates to 1 — the fill and the edge were the
  // same colour. Keying on front puts the coral's FLESH on the base hue
  // and spends the spread on the growing edges and genuine peaks, which is
  // the two-tone organism the mode is named for.
  let white = pow(heat, 3.2) * 0.7;
  col += presetColor(P_hue() + P_hueSpread() * (0.12 + 0.55 * front + 0.33 * white),
                     0.92 - 0.62 * white, 0.5)
       * heat * heat * pump;

  // And the front's own light: the living edge flares on the beat
  // (Pulse-gated), in the tip colour the membrane ramp reaches for.
  col += presetColor(P_hue() + P_hueSpread() * 0.8, 0.6, 0.55)
       * front * front * P_glow() * (0.55 + 0.45 * beatP * u.pulse);

  // Relief: embossed side-light from the field's own gradient, lit from the
  // upper-left like a print. Highlights add, shadows multiply down — the
  // difference between raised growth and a flat stain.
  let gm = clamp(length(grad) * 6.0, 0.0, 1.0);
  let shade = dot(grad * 6.0, vec2f(-0.6, -0.8));
  col += presetColor(P_hue() + P_hueSpread(), 0.35, 0.6)
       * clamp(shade, 0.0, 1.0) * gm * P_relief() * 0.6;
  col *= 1.0 - clamp(-shade, 0.0, 1.0) * gm * P_relief() * 0.35;

  // Paper: the print negative. Ink density from heat + interior depth on a
  // warm page in the same palette family, relief highlights kept so the ink
  // still sits IN the paper. A cross-fade, so half-paper looks are real.
  if (P_paper() > 0.001) {
    let inkAmt = clamp(heat * 1.15 + deep * 0.5 * P_haze(), 0.0, 1.0);
    let page = presetColor(P_hue(), 0.1, 0.85 - 0.1 * uv.y);
    let ink = presetColor(P_hue() + P_hueSpread() * 0.3, 0.55, 0.14);
    var pcol = mix(page, ink, inkAmt);
    pcol += presetColor(P_hue(), 0.2, 0.5) * clamp(shade, 0.0, 1.0) * gm * P_relief() * 0.25;
    pcol *= 1.0 - beatP * 0.1 * u.pulse;
    col = mix(col, pcol, P_paper());
  }

  col *= vignette(uv, P_vignette());
  col = tonemap(col * 1.04);
  col += grain(uv, 0.008 + P_grain() * 0.03 * (0.4 + 0.6 * u.energy));
  // Alpha is this pixel's DATA lane, not its opacity: the tile's chemical
  // as advanced this tick, read back by the next advance one tick later.
  return vec4f(max(col, vec3f(0.0)), stored);
}
`,
};
