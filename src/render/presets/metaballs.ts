import type { PresetDef } from "../types";

/**
 * Lava-lamp metaballs: blobs orbit slowly and merge; each blob's size tracks
 * one band (bass/mid/treble round-robin), beats wobble the surface.
 */
export const metaballs: PresetDef = {
  id: "metaballs",
  name: "Metaballs",
  description: "Lava-lamp blobs that merge and split — each blob's size follows bass, mids or treble.",
  styles: [
    { id: "lava", name: "Lava", values: {} },
    { id: "mercury", name: "Mercury", values: { hue: 210, hueField: 4, glow: 0.3 } },
    { id: "toxic", name: "Toxic", values: { hue: 100, count: 6, speed: 0.5, hueField: 40 } },
    { id: "sunspot", name: "Sunspot", values: { hue: 40, size: 0.2, threshold: 1.3, count: 3 } },
  ],
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 25, hint: "Base blob color" },
    { key: "count", label: "Blobs", min: 2, max: 7, step: 1, default: 5, hint: "Number of blobs in the lamp" },
    { key: "size", label: "Size", min: 0.05, max: 0.3, step: 0.005, default: 0.14, hint: "Base blob size" },
    { key: "speed", label: "Speed", min: 0.05, max: 1, step: 0.05, default: 0.3, hint: "How fast the blobs orbit and drift" },
    { key: "glow", label: "Glow", min: 0, max: 1, step: 0.01, default: 0.5, hint: "Bright rim where blob surfaces meet" },
    { key: "threshold", label: "Merge", min: 0.6, max: 1.6, step: 0.02, default: 1.0, hint: "Lower = blobs fuse together sooner and blobbier" },
  ],
  advanced: [
    { key: "orbitX", label: "Orbit width", min: 0.1, max: 0.5, step: 0.01, default: 0.28, hint: "Horizontal travel range of the blobs" },
    { key: "orbitY", label: "Orbit height", min: 0.1, max: 0.5, step: 0.01, default: 0.24, hint: "Vertical travel range of the blobs" },
    { key: "radiusFloor", label: "Size floor", min: 0.1, max: 1.5, step: 0.05, default: 0.55, hint: "Blob size in silence" },
    { key: "radiusBand", label: "Band swell", min: 0, max: 2.5, step: 0.05, default: 1.1, hint: "How much each blob grows with its band (bass/mid/treble)" },
    { key: "beatSwell", label: "Beat swell", min: 0, max: 0.6, step: 0.02, default: 0.15, hint: "All blobs puff briefly on beats" },
    { key: "rimStart", label: "Rim start", min: 0.2, max: 1, step: 0.02, default: 0.55, hint: "How far outside the surface the glow rim begins" },
    { key: "innerGrad", label: "Inner gradient", min: 0, max: 1, step: 0.02, default: 0.35, hint: "Brightness build-up toward blob centers" },
    { key: "hueField", label: "Hue per blob", min: 0, max: 60, step: 1, default: 24, hint: "Color difference between individual blobs" },
    { key: "beatBright", label: "Beat brighten", min: 0, max: 0.3, step: 0.01, default: 0.08, hint: "Blob brightness lift on beats" },
    { key: "bgLevel", label: "Bg level", min: 0, max: 0.15, step: 0.005, default: 0.045, hint: "Background brightness" },
    { key: "vignette", label: "Vignette", min: 0, max: 1, step: 0.05, default: 0.4, hint: "Darkening toward the screen corners" },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  let p = centered(uv);
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
    let rad = P_size() * (P_radiusFloor() + band * P_radiusBand() + u.beatIntensity * P_beatSwell());
    let d2 = dot(p - pos, p - pos);
    let contrib = rad * rad / (d2 + 1e-5);
    field += contrib;
    hueAcc += contrib * fi * P_hueField();
  }

  let localHue = P_hue() + hueAcc / max(field, 1e-4);

  // Surface + rim
  let surface = smoothstep(P_threshold(), P_threshold() * 1.12, field);
  let rim = smoothstep(P_threshold() * P_rimStart(), P_threshold(), field) * (1.0 - surface);

  // Background
  let r = length(p);
  var col = hsl2rgb(P_hue() + 180.0, 0.4, P_bgLevel()) * (1.0 - r * 0.7);

  // Blob body with inner gradient
  let inner = clamp((field - P_threshold()) * 0.35, 0.0, P_innerGrad() + 0.1);
  col = mix(col, hsl2rgb(localHue, 0.85, 0.42 + inner + u.beatIntensity * P_beatBright()), surface);
  // Rim glow
  col += hsl2rgb(localHue + 30.0, 0.9, 0.55) * rim * (0.4 + P_glow() * 0.9);

  col *= 1.0 - r * r * P_vignette();
  return vec4f(col, 1.0);
}
`,
};
