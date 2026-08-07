import type { PresetDef } from "../types";
import { WGSL_PALETTE_PHASE } from "../wgslLib";

/**
 * Lava-lamp metaballs: blobs orbit slowly and merge; each blob's size tracks
 * one band (bass/mid/treble round-robin), beats wobble the surface. Colour
 * comes from a saturated cosine palette instead of a drifting hsl hue, the
 * field's natural 1/d^2 falloff gives every blob a hot white nucleus, and
 * beat response is staggered per blob so they don't all pulse in lockstep.
 *
 * Depth wave (Track B batch 3): `beatSwell` promoted to the curated tier (the
 * roster's worst beat-response hole — all five reaction knobs were Advanced),
 * plus four neutral-by-default depth params, each branch-gated so the default
 * path keeps the pre-wave expressions term for term:
 *  - `smear` — texture-feedback goo residue (max-fold, never add), the
 *    lava-lamp afterimage finally real;
 *  - `bassWeight` — tilts the band round-robin's gains toward the bass blobs;
 *  - `eccentric` — per-blob oval squash about a hashed, FIXED axis;
 *  - `environment` — what the gloss sheen reflects (void / studio / horizon).
 *
 * NOTE (device-matrix class): the mere presence of feedbackSample() in this
 * source reclassifies the MODE onto the texture-feedback render graph — raw
 * visual into the 16f visTex, then the standalone composite pass, instead of
 * the M24 inline direct path. Math at defaults is expression-identical, but
 * the 16f intermediate double-rounding moves existing pixel-matrix hashes by
 * the same pre-declared ±1-LSB class led-matrix's waterfall shipped with in
 * batch 1. Exports of this mode now run the fixed 60 Hz feedback walk (same
 * cost class as echo-trails).
 */
export const metaballs: PresetDef = {
  id: "metaballs",
  name: "Metaballs",
  description:
    "Lava-lamp blobs that merge and split — each blob's size follows bass, mids or treble.",
  styles: [
    // Lava — the defaults — five merging blobs in a warm lamp.
    { id: "lava", name: "Lava", values: {} },
    // Chrome — gloss at max with a tight rim: liquid mercury, one hue.
    {
      id: "chrome",
      name: "Chrome",
      values: {
        hue: 150,
        hueField: 3,
        count: 4,
        size: 0.17,
        speed: 0.2,
        gloss: 0.98,
        glow: 0.22,
        innerGrad: 0.12,
        rimStart: 0.72,
        threshold: 1.1,
        squash: 0.06,
        lightAngle: 60,
        radiusFloor: 0.7,
        energyGrow: 0.5,
        radiusBand: 0.25,
        bgLevel: 0.01,
        vignette: 0.6,
      },
    },
    // Binary — two big slow masses on a narrow orbit — they meet and part.
    {
      id: "binary",
      name: "Binary",
      values: {
        hue: 340,
        hueField: 40,
        count: 2,
        size: 0.28,
        speed: 0.1,
        threshold: 0.78,
        glow: 0.62,
        orbitX: 0.2,
        orbitY: 0.16,
        radiusFloor: 0.85,
        innerGrad: 0.56,
        gloss: 0.6,
        energyGrow: 0.35,
        beatSwell: 0.28,
        squash: 0.1,
        rimStart: 0.5,
        vignette: 0.55,
      },
    },
    // Swarm — seven small fast blobs, high merge threshold, folded six ways.
    {
      id: "swarm",
      name: "Swarm",
      values: {
        hue: 278,
        hueField: 34,
        count: 7,
        size: 0.1,
        speed: 0.75,
        threshold: 1.2,
        glow: 0.42,
        radiusBand: 1.1,
        beatSwell: 0.36,
        mirror: 6,
        orbitX: 0.34,
        orbitY: 0.3,
        gloss: 0.2,
        innerGrad: 0.2,
        squash: 0.3,
        bgLevel: 0.02,
        vignette: 0.45,
      },
    },
    // Eclipse — no gloss, no inner gradient, max glow: dark bodies with burning rims.
    {
      id: "eclipse",
      name: "Eclipse",
      values: {
        hue: 95,
        hueField: 8,
        size: 0.2,
        speed: 0.15,
        gloss: 0,
        glow: 0.8,
        innerGrad: 0,
        rimStart: 0.28,
        threshold: 1.3,
        energyGrow: 0.9,
        radiusBand: 0.3,
        beatSwell: 0.24,
        beatBright: 0.02,
        squash: 0.12,
        bgLevel: 0.005,
        vignette: 0.85,
      },
    },
    // Sunspot — three fused blobs, strongest energy growth and beat squash.
    {
      id: "sunspot",
      name: "Sunspot",
      values: {
        hue: 330,
        hueField: 14,
        count: 3,
        size: 0.22,
        threshold: 1.34,
        glow: 0.75,
        gloss: 0.42,
        innerGrad: 0.7,
        energyGrow: 1.35,
        radiusBand: 0.9,
        beatSwell: 0.42,
        beatBright: 0.2,
        squash: 0.34,
        speed: 0.25,
        orbitX: 0.22,
        orbitY: 0.2,
        rimStart: 0.44,
        bgLevel: 0.06,
        vignette: 0.35,
      },
    },
    // Petri — editorial. Small, slow, well-separated, thin rims on near-black.
    {
      id: "petri",
      name: "Petri",
      values: {
        hue: 160,
        hueField: 6,
        count: 6,
        size: 0.09,
        speed: 0.1,
        threshold: 1.5,
        glow: 0.2,
        gloss: 0.1,
        innerGrad: 0.06,
        rimStart: 0.34,
        orbitX: 0.46,
        orbitY: 0.42,
        radiusFloor: 0.95,
        energyGrow: 0.2,
        radiusBand: 0.15,
        beatSwell: 0.06,
        beatBright: 0.02,
        squash: 0,
        bgLevel: 0.005,
        vignette: 0.25,
      },
    },
    // Goo — the smear flagship: six fused red-hot masses dragging long
    // slowly-melting residue, band response tilted hard toward the bass.
    {
      id: "goo",
      name: "Goo",
      values: {
        hue: 8,
        count: 6,
        size: 0.19,
        speed: 0.2,
        threshold: 0.88,
        glow: 0.6,
        gloss: 0.26,
        smear: 0.8,
        bassWeight: 0.55,
        beatSwell: 0.3,
        squash: 0.28,
        energyGrow: 1.0,
        radiusBand: 0.7,
        innerGrad: 0.5,
        bgLevel: 0.03,
        vignette: 0.5,
      },
    },
    // Amoeba — the eccentricity flagship: four tilted bio-green ovals drifting
    // like organisms under a microscope, a faint smear as their wake.
    {
      id: "amoeba",
      name: "Amoeba",
      values: {
        hue: 130,
        hueField: 16,
        count: 4,
        size: 0.2,
        speed: 0.15,
        threshold: 0.84,
        eccentric: 0.9,
        smear: 0.25,
        glow: 0.35,
        gloss: 0.12,
        innerGrad: 0.56,
        radiusFloor: 0.8,
        energyGrow: 0.45,
        beatSwell: 0.1,
        squash: 0.08,
        orbitX: 0.34,
        orbitY: 0.3,
        bgLevel: 0.035,
        vignette: 0.5,
      },
    },
    // Showroom — the Studio environment flagship: three calm cobalt masses
    // under a softbox wrap, gloss near max so the sheet reads.
    {
      id: "showroom",
      name: "Showroom",
      values: {
        hue: 215,
        hueField: 4,
        count: 3,
        size: 0.21,
        speed: 0.15,
        threshold: 1.06,
        environment: 1,
        gloss: 0.9,
        glow: 0.3,
        innerGrad: 0.14,
        rimStart: 0.66,
        lightAngle: 145,
        radiusFloor: 0.75,
        energyGrow: 0.45,
        radiusBand: 0.2,
        beatSwell: 0.12,
        squash: 0.06,
        bgLevel: 0.015,
        vignette: 0.55,
      },
    },
    // Mercury Dawn — the Horizon environment flagship: slow molten chrome at
    // first light — sky sheet on top, a burning line at each equator.
    {
      id: "mercury",
      name: "Mercury Dawn",
      values: {
        hue: 35,
        hueField: 10,
        size: 0.24,
        speed: 0.1,
        threshold: 0.92,
        environment: 2,
        gloss: 1.0,
        glow: 0.25,
        eccentric: 0.15,
        smear: 0.35,
        innerGrad: 0.1,
        rimStart: 0.4,
        lightAngle: 180,
        radiusFloor: 0.9,
        energyGrow: 0.3,
        radiusBand: 0.15,
        beatSwell: 0.08,
        squash: 0.04,
        orbitY: 0.18,
        bgLevel: 0.02,
        vignette: 0.6,
      },
    },
  ],
  params: [
    {
      key: "hue",
      label: "Hue",
      group: "color",
      control: "hue",
      min: 0,
      max: 360,
      step: 1,
      default: 25,
      hint: "Base blob color",
    },
    {
      key: "count",
      label: "Blobs",
      group: "shape",
      control: "enum",
      mod: "snap",
      options: [
        { value: 2, label: "2" },
        { value: 3, label: "3" },
        { value: 4, label: "4" },
        { value: 5, label: "5" },
        { value: 6, label: "6" },
        { value: 7, label: "7" },
      ],
      min: 2,
      max: 7,
      step: 1,
      default: 5,
      hint: "Number of blobs in the lamp",
    },
    {
      key: "size",
      label: "Size",
      group: "shape",
      min: 0.05,
      max: 0.3,
      step: 0.005,
      default: 0.14,
      hint: "Base blob size",
    },
    {
      key: "speed",
      label: "Speed",
      group: "motion",
      min: 0.05,
      max: 1,
      step: 0.05,
      default: 0.3,
      hint: "How fast the blobs orbit and drift",
    },
    {
      key: "glow",
      label: "Glow",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      hint: "Bright rim where blob surfaces meet",
    },
    {
      key: "threshold",
      label: "Merge",
      group: "shape",
      min: 0.6,
      max: 1.6,
      step: 0.02,
      default: 1.0,
      hint: "Lower = blobs fuse together sooner and blobbier",
    },
    {
      key: "gloss",
      label: "Gloss",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.35,
      hint: "Liquid-metal specular sheen that slides across the blob surfaces — high reads as mercury/chrome",
    },
    // Promoted from Advanced (depth batch 3): the curated tier had ZERO
    // beat-response knobs — the roster's worst lens hole. Spec is verbatim
    // (key, range, default, hint), a pure tier move; saved documents address
    // params by key, so nothing changes for them.
    {
      key: "beatSwell",
      label: "Beat swell",
      group: "reaction",
      min: 0,
      max: 0.6,
      step: 0.02,
      default: 0.2,
      hint: "Blobs pump on every beat, staggered so they don't all swell at once",
    },
    {
      key: "smear",
      label: "Lava smear",
      group: "motion",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      hint: "Blobs leave a slowly-melting goo residue behind as they move — 0 wipes the lamp clean every frame",
    },
  ],
  advanced: [
    {
      key: "orbitX",
      label: "Orbit width",
      group: "motion",
      min: 0.1,
      max: 0.5,
      step: 0.01,
      default: 0.28,
      hint: "Horizontal travel range of the blobs",
    },
    {
      key: "orbitY",
      label: "Orbit height",
      group: "motion",
      min: 0.1,
      max: 0.5,
      step: 0.01,
      default: 0.24,
      hint: "Vertical travel range of the blobs",
    },
    {
      key: "radiusFloor",
      label: "Size floor",
      group: "shape",
      min: 0.1,
      max: 1.5,
      step: 0.05,
      default: 0.5,
      hint: "Blob size in silence",
    },
    {
      key: "energyGrow",
      label: "Energy growth",
      group: "reaction",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.7,
      hint: "All blobs swell smoothly with track loudness — the main sync",
    },
    {
      key: "radiusBand",
      label: "Band swell",
      group: "reaction",
      min: 0,
      max: 2.5,
      step: 0.05,
      default: 0.45,
      hint: "Per-blob extra growth from its band (bass/mid/treble)",
    },
    {
      key: "rimStart",
      label: "Rim start",
      group: "glow",
      min: 0.2,
      max: 1,
      step: 0.02,
      default: 0.55,
      hint: "How far outside the surface the glow rim begins",
    },
    {
      key: "innerGrad",
      label: "Inner gradient",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.35,
      hint: "Brightness build-up toward blob centers",
    },
    {
      key: "hueField",
      label: "Hue per blob",
      group: "color",
      min: 0,
      max: 60,
      step: 1,
      default: 24,
      hint: "Color difference between individual blobs",
    },
    {
      key: "beatBright",
      label: "Beat brighten",
      group: "reaction",
      min: 0,
      max: 0.3,
      step: 0.01,
      default: 0.08,
      hint: "Blob brightness lift on beats",
    },
    {
      key: "bgLevel",
      label: "Bg level",
      group: "backdrop",
      min: 0,
      max: 0.15,
      step: 0.005,
      default: 0.045,
      hint: "Background brightness",
    },
    {
      key: "vignette",
      label: "Vignette",
      group: "backdrop",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.4,
      hint: "Darkening toward the screen corners",
    },
    {
      key: "mirror",
      label: "Club mirror",
      group: "shape",
      control: "enum",
      mod: "snap",
      options: [
        { value: 1, label: "Off" },
        { value: 2, label: "Mirrored" },
        { value: 3, label: "3 segments" },
        { value: 4, label: "4 segments" },
        { value: 5, label: "5 segments" },
        { value: 6, label: "6 segments" },
        { value: 7, label: "7 segments" },
        { value: 8, label: "8 segments" },
        { value: 9, label: "9 segments" },
        { value: 10, label: "10 segments" },
        { value: 11, label: "11 segments" },
        { value: 12, label: "12 segments" },
      ],
      min: 1,
      max: 12,
      step: 1,
      default: 1,
      hint: "Fold the blob field into mirrored wedges — 1 is off, 2 mirrors left/right, higher makes a kaleidoscope",
    },
    {
      key: "lightAngle",
      label: "Light angle",
      group: "glow",
      control: "angle",
      min: 0,
      max: 360,
      step: 5,
      default: 125,
      hint: "Direction the gloss highlight comes from (a fixed orientation — Motion does not spin it)",
    },
    {
      key: "squash",
      label: "Beat squash",
      group: "reaction",
      min: 0,
      max: 0.6,
      step: 0.02,
      default: 0.18,
      hint: "The whole lamp squishes flatter for an instant on each beat, like a gulping lava lamp",
    },
    {
      key: "bassWeight",
      label: "Bass weight",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      hint: "Tilts the lamp toward the low end — bass blobs swell harder while mid and treble blobs calm down",
    },
    {
      key: "eccentric",
      label: "Eccentricity",
      group: "shape",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      hint: "Squashes each blob into its own tilted oval, one fixed axis per blob — 0 keeps perfect circles",
    },
    {
      key: "environment",
      label: "Gloss environment",
      group: "glow",
      control: "enum",
      mod: "off",
      options: [
        {
          value: 0,
          label: "Void",
          hint: "A single hard highlight from the light angle — the classic lamp",
        },
        {
          value: 1,
          label: "Studio",
          hint: "Broad softbox wrap plus a dim fill from the far side — showroom liquid",
        },
        {
          value: 2,
          label: "Horizon",
          hint: "Sky sheet on top and a bright line at each equator — chrome outdoors",
        },
      ],
      min: 0,
      max: 2,
      step: 1,
      default: 0,
      hint: "What the gloss sheen reflects; only visible with some Gloss dialed in",
    },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  var p = centered(uv);
  // Club mirror: fold the field before summing blobs so the orbit becomes a
  // symmetric mandala. 1 = off.
  p = kaleido(p, P_mirror());

  // Blob count rides the Detail master (v2.44 masters law) so the strip's
  // Detail knob thins or fills the lamp; clamped to the loop's safe range. At
  // Detail = 1 this is exactly P_count(), so saved looks render unchanged.
  let count = i32(clamp(round(P_count() * u.detail), 2.0, 8.0));

  // Pulse gate shaping (v2.66): the Pulse master spans 0..2 but the beat
  // geometry below was tuned at 1, and a LINEAR gate blew it past its design
  // envelope above ~50% (owner: "lava lamp suffering from epilepsy").
  // softLimit is identity through 1.15 — the shipped 0..100% response is
  // byte-identical — and compresses the top so 200% lands near 1.6x: "more",
  // not "twice the violence". Each geometry term below ALSO saturates its own
  // total, so a maxed param and a maxed Pulse cannot stack into a strobe.
  let pulseG = softLimit(u.pulse, 1.6);

  // Beat squash: the whole lamp squishes flatter for an instant on each beat
  // (grid-locked when a tempo grid exists, flux fallback otherwise), like a
  // gulping lava lamp. It is a per-axis SCALE of the sample point, never an
  // angle offset, so it obeys the monotonic law; u.pulse gates it. Only the
  // blob field reads this warped point — the background wash stays still.
  // The envelope leans 3:1 on gridPulse: beatPhase advances smoothly frame to
  // frame while driveBeat attacks in a single frame, and at high Pulse that
  // frame-edge read as a strobe — off-grid flux hits still land at quarter
  // weight (with no grid gridPulse RETURNS driveBeat, so the mix is a no-op).
  // The smoothstep eases the visual edge — same peak, but the response holds
  // near the top and lands gently instead of snapping — and softLimit
  // saturates the TOTAL squash so max-param x max-Pulse tops out at a 1.55x
  // axis scale instead of the old 2.2x.
  let squashEnv = clamp(mix(u.driveBeat, gridPulse(6.0), 0.75), 0.0, 1.0);
  let squashEase = squashEnv * squashEnv * (3.0 - 2.0 * squashEnv);
  let squashB = softLimit(squashEase * P_squash() * pulseG, 0.55);
  let sq = 1.0 + squashB;
  let pf = vec2f(p.x / sq, p.y * sq);

  var field = 0.0;
  var hueAcc = 0.0;
  var nrm = vec2f(0.0);
  // Merge-artifact bookkeeping (v2.68): gMag sums the MAGNITUDES of the
  // per-blob gradient terms while nrm sums the vectors, so |nrm|/gMag is a
  // dimensionless 0..1 measure of gradient agreement — 1 on an isolated
  // flank, ~0 at a merge saddle where opposing gradients cancel. maxContrib
  // is the strongest single blob's field share, so the hot nucleus below can
  // key off "one ball's own core" instead of the merged sum.
  var gMag = 0.0;
  var maxContrib = 0.0;
  for (var i = 0; i < count; i++) {
    let fi = f32(i);
    let h = hash11(fi + 1.0);
    let ph = fi * 2.399963; // golden angle spacing
    // Band assignment round-robin
    var band = u.bass;
    if (i % 3 == 1) { band = u.mid; }
    if (i % 3 == 2) { band = u.treble; }
    // Bass weight (depth batch 3): tilt the lamp toward the low end — the
    // bass blobs' band term swells harder while mid/treble blobs calm down,
    // so a bass-heavy track grows a bass-heavy lamp. Guarded: bandW stays
    // exactly 1.0 at the 0 default and the multiply below is an IEEE identity
    // (x * 1.0 == x), keeping every pre-wave document bit-for-bit. rad still
    // passes through softLimit, so a maxed weight cannot push a blob past the
    // same frame ceiling the calm path respects.
    var bandW = 1.0;
    if (P_bassWeight() > 0.0) {
      var tilt = 1.35;
      if (i % 3 == 1) { tilt = -0.45; }
      if (i % 3 == 2) { tilt = -0.7; }
      bandW = 1.0 + P_bassWeight() * tilt;
    }
    let t = u.time * P_speed() * (0.5 + h * 0.6);
    // Frame-safety: the X amplitude was already written against the frame
    // (aspect * 0.8 keeps it inside the half-width), the Y amplitude was not —
    // Orbit height at its max plus the per-blob spread reached 0.58 against a
    // frame that ends at 0.5, so a blob's CENTRE orbited off the top and bottom
    // edges and the lamp lost a ball for part of every cycle. frameReach at
    // straight-up is the vertical half-extent, and softLimit compresses toward
    // it rather than clipping; the defaults sit below the knee, unchanged.
    let orbitY = softLimit(P_orbitY() + h * 0.08, frameReach(TAU * 0.25));
    let pos = vec2f(
      sin(t + ph) * (P_orbitX() + h * 0.1) * u.aspect * 0.8,
      cos(t * 1.31 + ph * 1.7) * orbitY,
    );

    // Per-blob beat response, staggered by the golden-ratio conjugate (same
    // shape as gridPulse(), phase-shifted per blob) so blobs don't all
    // swell in perfect lockstep on every hit — identical phase across N
    // elements reads as one pulsing blob instead of N independent ones.
    var beatMul = u.driveBeat;
    if (u.bpm > 0.5) {
      let bph = fract(u.beatPhase + fi * 0.6180339887);
      beatMul = max(exp(-bph * 5.0) - 0.03, 0.0) / 0.97;
    }
    // Ease the gulp the same way as the squash: smoothstep keeps the peak but
    // softens the attack frame and the decay tail so the swell reads as a
    // breath, not a flash.
    let beatCl = clamp(beatMul, 0.0, 1.0);
    let beatEase = beatCl * beatCl * (3.0 - 2.0 * beatCl);

    // The swell saturates BEFORE joining the calm terms: the outer softLimit
    // below caps the SUM, so at high Pulse a raw swell simply dominated the
    // calm size and every beat slammed each ball to the frame ceiling and
    // back (the other half of the strobe). Capping the swell contribution
    // itself keeps it a big confident gulp ON TOP of the calm size — 200%
    // reads bigger, never "full-size flash". Identity through swell 0.36, so
    // the default (0.2) and every factory style pass through untouched at
    // Pulse = 1.
    let swell = softLimit(beatEase * P_beatSwell() * pulseG, 0.5);

    // Size = calm floor + smooth energy breathing (primary sync) + a gentle
    // per-band accent + a staggered beat gulp. Capped so a loud beat can't
    // inflate a single ball into a full-frame solid wash — it stays a blob
    // that merges, not a fill.
    // Soft frame limit (v2.44): a maxed Size approaches a frame-filling
    // blob smoothly instead of pinning every ball to one clipped radius.
    let rad = softLimit(P_size() * (P_radiusFloor() + u.drive * P_energyGrow()
            + band * P_radiusBand() * bandW + swell), frameCircle() * 0.8);
    var diff = pf - pos;
    // Eccentricity (depth batch 3): squash each blob's distance metric into
    // an oval about its own hashed, FIXED axis — orientation is a pure
    // function of the blob index, never of time, so export matches preview
    // and the ovals hold still while they orbit. rot2 into the blob frame,
    // area-preserving (x*s, y/s) squash, rot2 back: the field, the merge
    // behaviour and the gloss gradient all see the same warped offset.
    // Guarded: at the 0 default diff is the untouched pre-wave vector.
    if (P_eccentric() > 0.0) {
      let axis = hash11(fi + 31.0) * TAU;
      let ecc = P_eccentric() * (0.35 + 0.65 * hash11(fi + 47.0));
      let s = 1.0 + ecc * 0.9;
      let el = rot2(axis) * diff;
      diff = rot2(-axis) * vec2f(el.x * s, el.y / s);
    }
    let d2 = dot(diff, diff);
    let contrib = rad * rad / (d2 + 1e-5);
    field += contrib;
    hueAcc += contrib * fi * P_hueField();
    // Accumulate the field gradient (points outward from the blobs) so the
    // gloss pass below has a real surface normal to light — folded into this
    // same loop, no extra neighbourhood walk.
    nrm += diff * (contrib / (d2 + 1e-5));
    // |diff * contrib/d²| = contrib/d — the same term's length, summed
    // without cancellation, for the gradient-confidence ratio.
    gMag += contrib * inverseSqrt(d2 + 1e-5);
    maxContrib = max(maxContrib, contrib);
  }

  // Cosine palette keyed by the same contribution-weighted blend that used
  // to drive an hsl hue — stays saturated instead of drifting toward mud.
  let paletteT = fract(P_hue() / 360.0 + (hueAcc / max(field, 1e-4)) / 360.0);
  let pal = cosPalette(paletteT, vec3f(0.5), vec3f(0.42), vec3f(1.0, 1.0, 1.0), ${WGSL_PALETTE_PHASE});

  // Surface + rim. The surface window is widened to at least ~1.5 pixels of
  // field change (fwidth(field) = per-pixel field delta): the fixed
  // threshold..1.12x band is 0.12x threshold wide in FIELD space, which at
  // default scales spans many pixels — there aa is a small fraction of the
  // band and the look is unchanged — but where iso-lines bunch (merge pinches,
  // small fast blobs) that same band collapses below a pixel and the
  // silhouette aliased into an inconsistent hard edge. max() keeps the wider
  // of the two windows, so edges only ever gain softness, never lose it.
  let aa = fwidth(field) * 1.5;
  let surface = smoothstep(P_threshold() - aa, max(P_threshold() * 1.12, P_threshold() + aa), field);
  let rim = smoothstep(P_threshold() * P_rimStart(), P_threshold(), field) * (1.0 - surface);

  // Background: dark complementary wash with a slow fbm texture so the void
  // behind the blobs reads as atmosphere instead of a flat vector fill.
  let r = length(p);
  let bgN = fbm(p * 1.1 + u.time * 0.025);
  let bgPal = cosPalette(fract(P_hue() / 360.0 + 0.5), vec3f(0.04), vec3f(0.03), vec3f(1.0), ${WGSL_PALETTE_PHASE});
  var col = bgPal * mix(0.7, 1.3, bgN) * (1.0 - r * 0.7) + vec3f(P_bgLevel());

  // Blob body with inner gradient
  let inner = clamp((field - P_threshold()) * 0.35, 0.0, P_innerGrad() + 0.1);
  col = mix(col, pal * (0.55 + inner * 1.3 + u.driveBeat * P_beatBright()), surface);
  // Rim glow
  col += mix(pal, vec3f(1.0), 0.3) * rim * (0.4 + P_glow() * 0.9);

  // Liquid-metal gloss: a specular highlight sliding across the blob surface,
  // lit from a static direction (Light angle is an ORIENTATION, so it is not
  // scaled by the Rotation master). The accumulated field gradient gives the
  // outward surface normal; a tight power makes a sharp chrome/mercury sheen.
  // Confined to the surface, with a little life from the drive envelope.
  //
  // Gradient confidence (v2.68): at a merge saddle the per-blob gradients
  // cancel, normalize() then blows up a near-zero vector and N spins across a
  // few pixels — the sheen tore into pointy creases exactly along merge lines.
  // An ABSOLUTE magnitude gate can't fix this portably: at the isosurface of
  // an isolated blob |nrm| = contrib/d = threshold^1.5/rad, which across the
  // factory styles (rad 0.05..0.28, threshold 0.78..1.5) spans roughly 4..40,
  // so any fixed lo/hi window melts one style's gloss while missing another's
  // saddles. |nrm|/gMag is scale-free: on an isolated flank one term
  // dominates (a blob at 3x the surface distance adds contrib/d proportional
  // to 1/d^3, about 4% — even several far blobs leave the ratio above ~0.75)
  // while equal opposing gradients at a saddle drive it to 0. smoothstep
  // 0.25..0.7 therefore keeps today's gloss on every isolated-blob flank
  // (ratio >= 0.7 -> conf = 1) and melts the sheen smoothly to nothing as the
  // normal loses definition, instead of letting it tear.
  let conf = smoothstep(0.25, 0.7, length(nrm) / max(gMag, 1e-6));
  let N = normalize(nrm + vec2f(1e-5, 0.0));
  let L = vec2f(cos(radians(P_lightAngle())), sin(radians(P_lightAngle())));
  var sheen = pow(max(dot(N, L), 0.0), 6.0) * conf;
  var sheenCol = mix(pal, vec3f(1.0), 0.7);
  // Gloss environment (depth batch 3): what the sheen REFLECTS. 0 (Void, the
  // default) is the pre-wave single hard key — both vars above initialize to
  // exactly the old expressions and the branches below only run off-default,
  // so the default path multiplies the identical chain. Screen-up is -N.y
  // (uv.y grows downward and centered() keeps that sign).
  let env = P_environment();
  if (env > 1.5) {
    // Horizon: a chrome ball outdoors. A sky sheet where the normal faces
    // up-screen, a hard bright line where it grazes the horizon (each blob's
    // equator), dark ground below by omission (light is only ever added),
    // plus the key at reduced weight so Light angle still reads.
    let sky = smoothstep(-0.2, 0.65, -N.y) * 0.5;
    let horizonLine = pow(1.0 - abs(N.y), 8.0) * 0.4;
    sheen = (sky + horizonLine) * conf + sheen * 0.45;
    sheenCol = mix(pal, vec3f(1.0), 0.6);
  } else if (env > 0.5) {
    // Studio: softbox wrap — a broad low-power sheet from the key direction,
    // a dim fill card from the far side, and the tight key on top. Peak sits
    // near the void look's ceiling so Gloss reads on the same scale.
    let sheet = pow(max(dot(N, L), 0.0), 2.0) * conf;
    let fill = pow(max(dot(N, -L), 0.0), 3.0) * conf;
    sheen = sheen * 0.6 + sheet * 0.45 + fill * 0.18;
    sheenCol = mix(pal, vec3f(1.0), 0.85);
  }
  col += sheenCol * sheen * surface * P_gloss() * (0.6 + u.drive * 0.5);

  // Hot core: the field's own 1/d^2 falloff spikes to huge values only very
  // near a blob's point-mass centre. The band must therefore start WELL above
  // the surface threshold — at 1.15x it saturated across the entire blob
  // interior (field >> threshold everywhere inside) and turned the whole blob
  // into one white mass, the exact blow-out this was meant to avoid. 3x..10x
  // isolates just the nucleus; the tone map then rolls it off as emission.
  // Keyed off maxContrib, NOT the summed field (v2.68): overlapping blobs
  // pushed the SUM past 3x threshold over the whole merged region and washed
  // it blurry white. maxContrib is one ball's own share, so each ball keeps
  // its tight nucleus and merging never multiplies white area — for an
  // isolated blob maxContrib == field (minus far-blob crumbs), so the
  // single-blob nucleus is pixel-identical. Band semantics stay 3x..10x
  // relative to threshold.
  let hot = smoothstep(P_threshold() * 3.0, P_threshold() * 10.0, maxContrib);
  col = mix(col, vec3f(1.0, 0.97, 0.92), hot * 0.6);
  col += pal * hot * (0.5 + u.driveBeat * 0.5);

  col *= vignette(uv, P_vignette());
  col = tonemap(col * 1.05);
  col += grain(uv, 0.012);
  // Lava smear (depth batch 3): the mode's texture-feedback opt-in. The
  // previous RAW frame — this same function's last output, pre-composite, so
  // no background/overlay ever accumulates — is folded in with max(), never
  // add: a max accumulator is bounded by the brightest fresh frame by
  // construction, so tonemap living inside the loop is safe (echo-trails must
  // ban tonemap because it ADDS; here nothing compounds) and residue decays
  // exponentially without ever brightening standing geometry. keep is
  // dt-scaled the same way echo-trails' decay is: on fixed 60 Hz state ticks
  // u.dt = 1/60 so keep applies exactly once per tick; on presentation-only
  // frames u.dt = 0 so keep = 1 and held history is shown untouched — state
  // advances only on the shared fixed clock (fixedFeedback.ts), the same
  // grid live and in export. sqrt(smear) spends the knob's lower half on
  // short tails: 0.25 is a few-frame wipe, 1.0 a multi-second goo memory.
  // Sampling at the un-warped uv hits texel centers exactly (visTex matches
  // the target size), so held residue never blurs generation to generation.
  // Guarded: smear = 0 returns the exact pre-wave expression below.
  var outCol = max(col, vec3f(0.0));
  if (P_smear() > 0.0) {
    let keep = pow(mix(0.62, 0.992, sqrt(P_smear())), u.dt * 60.0);
    outCol = max(outCol, feedbackSample(uv).rgb * keep);
  }
  return vec4f(outCol, 1.0);
}
`,
};
