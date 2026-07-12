import type { PresetDef } from "../types";

/**
 * Lava-lamp metaballs: blobs orbit slowly and merge; each blob's size tracks
 * one band (bass/mid/treble round-robin), beats wobble the surface.
 */
export const metaballs: PresetDef = {
  id: "metaballs",
  name: "Metaballs",
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 25 },
    { key: "count", label: "Blobs", min: 2, max: 7, step: 1, default: 5 },
    { key: "size", label: "Size", min: 0.05, max: 0.3, step: 0.005, default: 0.14 },
    { key: "speed", label: "Speed", min: 0.05, max: 1, step: 0.05, default: 0.3 },
    { key: "glow", label: "Glow", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "threshold", label: "Merge", min: 0.6, max: 1.6, step: 0.02, default: 1.0 },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  let hue = param(0); let count = i32(param(1)); let size = param(2);
  let speed = param(3); let glow = param(4); let threshold = param(5);

  let p = centered(uv);

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
    let t = u.time * speed * (0.5 + h * 0.6);
    let pos = vec2f(
      sin(t + ph) * (0.28 + h * 0.1) * u.aspect * 0.8,
      cos(t * 1.31 + ph * 1.7) * (0.24 + h * 0.08),
    );
    let rad = size * (0.55 + band * 1.1 + u.beatIntensity * 0.15);
    let d2 = dot(p - pos, p - pos);
    let contrib = rad * rad / (d2 + 1e-5);
    field += contrib;
    hueAcc += contrib * fi * 24.0;
  }

  let localHue = hue + hueAcc / max(field, 1e-4);

  // Surface + rim
  let surface = smoothstep(threshold, threshold * 1.12, field);
  let rim = smoothstep(threshold * 0.55, threshold, field) * (1.0 - surface);

  // Background
  let r = length(p);
  var col = hsl2rgb(hue + 180.0, 0.4, 0.045) * (1.0 - r * 0.7);

  // Blob body with inner gradient
  let inner = clamp((field - threshold) * 0.35, 0.0, 0.45);
  col = mix(col, hsl2rgb(localHue, 0.85, 0.42 + inner + u.beatIntensity * 0.08), surface);
  // Rim glow
  col += hsl2rgb(localHue + 30.0, 0.9, 0.55) * rim * (0.4 + glow * 0.9);

  col *= 1.0 - r * r * 0.4;
  return vec4f(col, 1.0);
}
`,
};
