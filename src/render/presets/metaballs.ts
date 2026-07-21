import type { PresetDef } from "../types";

/**
 * Lava-lamp metaballs: blobs orbit slowly and merge; each blob's size tracks
 * one band (bass/mid/treble round-robin), beats wobble the surface. Colour
 * comes from a saturated cosine palette instead of a drifting hsl hue, the
 * field's natural 1/d^2 falloff gives every blob a hot white nucleus, and
 * beat response is staggered per blob so they don't all pulse in lockstep.
 */
export const metaballs: PresetDef = {
  id: "metaballs",
  name: "Metaballs",
  description:
    "Lava-lamp blobs that merge and split — each blob's size follows bass, mids or treble.",
  styles: [
    { id: "lava", name: "Lava", values: {} },
    { id: "mercury", name: "Mercury", values: { hue: 210, hueField: 4, glow: 0.3 } },
    { id: "toxic", name: "Toxic", values: { hue: 100, count: 6, speed: 0.5, hueField: 40 } },
    { id: "sunspot", name: "Sunspot", values: { hue: 40, size: 0.2, threshold: 1.3, count: 3 } },
    {
      id: "abyss",
      name: "Abyss",
      values: {
        hue: 228,
        count: 4,
        speed: 0.15,
        glow: 0.7,
        hueField: 10,
        bgLevel: 0.015,
        vignette: 0.7,
      },
    },
    {
      id: "swarm",
      name: "Swarm",
      values: {
        hue: 275,
        count: 7,
        size: 0.07,
        speed: 0.6,
        threshold: 1.34,
        glow: 0.4,
        hueField: 32,
        radiusBand: 0.9,
        beatSwell: 0.3,
        mirror: 6,
      },
    },
    {
      id: "binary",
      name: "Binary",
      values: {
        hue: 340,
        count: 2,
        size: 0.28,
        speed: 0.1,
        threshold: 0.8,
        glow: 0.6,
        orbitX: 0.2,
        orbitY: 0.15,
        radiusFloor: 0.8,
        innerGrad: 0.5,
      },
    },
  ],
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 25, hint: "Base blob color" },
    {
      key: "count",
      label: "Blobs",
      min: 2,
      max: 7,
      step: 1,
      default: 5,
      hint: "Number of blobs in the lamp",
    },
    {
      key: "size",
      label: "Size",
      min: 0.05,
      max: 0.3,
      step: 0.005,
      default: 0.14,
      hint: "Base blob size",
    },
    {
      key: "speed",
      label: "Speed",
      min: 0.05,
      max: 1,
      step: 0.05,
      default: 0.3,
      hint: "How fast the blobs orbit and drift",
    },
    {
      key: "glow",
      label: "Glow",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      hint: "Bright rim where blob surfaces meet",
    },
    {
      key: "threshold",
      label: "Merge",
      min: 0.6,
      max: 1.6,
      step: 0.02,
      default: 1.0,
      hint: "Lower = blobs fuse together sooner and blobbier",
    },
  ],
  advanced: [
    {
      key: "orbitX",
      label: "Orbit width",
      min: 0.1,
      max: 0.5,
      step: 0.01,
      default: 0.28,
      hint: "Horizontal travel range of the blobs",
    },
    {
      key: "orbitY",
      label: "Orbit height",
      min: 0.1,
      max: 0.5,
      step: 0.01,
      default: 0.24,
      hint: "Vertical travel range of the blobs",
    },
    {
      key: "radiusFloor",
      label: "Size floor",
      min: 0.1,
      max: 1.5,
      step: 0.05,
      default: 0.5,
      hint: "Blob size in silence",
    },
    {
      key: "energyGrow",
      label: "Energy growth",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.7,
      hint: "All blobs swell smoothly with track loudness — the main sync",
    },
    {
      key: "radiusBand",
      label: "Band swell",
      min: 0,
      max: 2.5,
      step: 0.05,
      default: 0.45,
      hint: "Per-blob extra growth from its band (bass/mid/treble)",
    },
    {
      key: "beatSwell",
      label: "Beat swell",
      min: 0,
      max: 0.6,
      step: 0.02,
      default: 0.2,
      hint: "Blobs pump on every beat, staggered so they don't all swell at once",
    },
    {
      key: "rimStart",
      label: "Rim start",
      min: 0.2,
      max: 1,
      step: 0.02,
      default: 0.55,
      hint: "How far outside the surface the glow rim begins",
    },
    {
      key: "innerGrad",
      label: "Inner gradient",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.35,
      hint: "Brightness build-up toward blob centers",
    },
    {
      key: "hueField",
      label: "Hue per blob",
      min: 0,
      max: 60,
      step: 1,
      default: 24,
      hint: "Color difference between individual blobs",
    },
    {
      key: "beatBright",
      label: "Beat brighten",
      min: 0,
      max: 0.3,
      step: 0.01,
      default: 0.08,
      hint: "Blob brightness lift on beats",
    },
    {
      key: "bgLevel",
      label: "Bg level",
      min: 0,
      max: 0.15,
      step: 0.005,
      default: 0.045,
      hint: "Background brightness",
    },
    {
      key: "vignette",
      label: "Vignette",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.4,
      hint: "Darkening toward the screen corners",
    },
    {
      key: "mirror",
      label: "Club mirror",
      min: 1,
      max: 12,
      step: 1,
      default: 1,
      hint: "Fold the blob field into mirrored wedges — 1 is off, 2 mirrors left/right, higher makes a kaleidoscope",
    },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  var p = centered(uv);
  // Club mirror: fold the field before summing blobs so the orbit becomes a
  // symmetric mandala. 1 = off.
  p = kaleido(p, P_mirror());

  let count = i32(P_count());

  var field = 0.0;
  var hueAcc = 0.0;
  for (var i = 0; i < count; i++) {
    let fi = f32(i);
    let h = hash11(fi + 1.0);
    let ph = fi * 2.399963; // golden angle spacing
    // Band assignment round-robin
    var band = u.bass;
    if (i % 3 == 1) { band = u.mid; }
    if (i % 3 == 2) { band = u.treble; }
    let t = u.time * P_speed() * (0.5 + h * 0.6);
    let pos = vec2f(
      sin(t + ph) * (P_orbitX() + h * 0.1) * u.aspect * 0.8,
      cos(t * 1.31 + ph * 1.7) * (P_orbitY() + h * 0.08),
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

    // Size = calm floor + smooth energy breathing (primary sync) + a gentle
    // per-band accent + a staggered beat gulp. Capped so a loud beat can't
    // inflate a single ball into a full-frame solid wash — it stays a blob
    // that merges, not a fill.
    let rad = min(P_size() * (P_radiusFloor() + u.drive * P_energyGrow()
            + band * P_radiusBand() + beatMul * P_beatSwell() * u.pulse), 0.34);
    let d2 = dot(p - pos, p - pos);
    let contrib = rad * rad / (d2 + 1e-5);
    field += contrib;
    hueAcc += contrib * fi * P_hueField();
  }

  // Cosine palette keyed by the same contribution-weighted blend that used
  // to drive an hsl hue — stays saturated instead of drifting toward mud.
  let paletteT = fract(P_hue() / 360.0 + (hueAcc / max(field, 1e-4)) / 360.0);
  let pal = cosPalette(paletteT, vec3f(0.5), vec3f(0.42), vec3f(1.0, 1.0, 1.0), vec3f(0.0, 0.33, 0.67));

  // Surface + rim
  let surface = smoothstep(P_threshold(), P_threshold() * 1.12, field);
  let rim = smoothstep(P_threshold() * P_rimStart(), P_threshold(), field) * (1.0 - surface);

  // Background: dark complementary wash with a slow fbm texture so the void
  // behind the blobs reads as atmosphere instead of a flat vector fill.
  let r = length(p);
  let bgN = fbm(p * 1.1 + u.time * 0.025);
  let bgPal = cosPalette(fract(P_hue() / 360.0 + 0.5), vec3f(0.04), vec3f(0.03), vec3f(1.0), vec3f(0.0, 0.33, 0.67));
  var col = bgPal * mix(0.7, 1.3, bgN) * (1.0 - r * 0.7) + vec3f(P_bgLevel());

  // Blob body with inner gradient
  let inner = clamp((field - P_threshold()) * 0.35, 0.0, P_innerGrad() + 0.1);
  col = mix(col, pal * (0.55 + inner * 1.3 + u.driveBeat * P_beatBright()), surface);
  // Rim glow
  col += mix(pal, vec3f(1.0), 0.3) * rim * (0.4 + P_glow() * 0.9);

  // Hot core: the field's own 1/d^2 falloff blows out to white exactly at
  // each blob's nucleus (and even harder where blobs overlap), so every
  // blob reads as emitting rather than merely being a flat colored disc.
  let hot = smoothstep(P_threshold() * 1.15, P_threshold() * 2.2, field);
  col = mix(col, vec3f(1.0, 0.98, 0.95), hot * 0.75);
  col *= 1.0 + hot * 1.4;

  col *= vignette(uv, P_vignette());
  col = tonemap(col * 1.05);
  col += grain(uv, 0.012);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
