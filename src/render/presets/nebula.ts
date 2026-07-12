import type { PresetDef } from "../types";

/**
 * Flowing fbm-noise nebula with optional kaleidoscope fold. Bass drives
 * brightness, mids shift color, treble adds sparkle grain.
 */
export const nebula: PresetDef = {
  id: "nebula",
  name: "Kaleido Nebula",
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 300 },
    { key: "scale", label: "Scale", min: 0.8, max: 6, step: 0.1, default: 2.4 },
    { key: "flow", label: "Flow speed", min: 0, max: 0.6, step: 0.01, default: 0.12 },
    { key: "kaleido", label: "Kaleido", min: 0, max: 12, step: 1, default: 6 },
    { key: "contrast", label: "Contrast", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "sparkle", label: "Sparkle", min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  let hue = param(0); let scale = param(1); let flow = param(2);
  let kaleido = param(3); let contrast = param(4); let sparkle = param(5);

  var p = centered(uv);

  // Kaleidoscope fold
  if (kaleido >= 2.0) {
    let r = length(p);
    var a = atan2(p.y, p.x) + u.time * flow * 0.5;
    let seg = TAU / kaleido;
    a = abs(fract(a / seg + 10.0) - 0.5) * seg;
    p = vec2f(cos(a), sin(a)) * r;
  }

  let q = p * scale;
  let t = u.time * flow;

  // Domain-warped fbm
  let warp = fbm(q + vec2f(t, -t * 0.7));
  let n = fbm(q + vec2f(warp * 1.8) + vec2f(-t * 0.5, t * 0.9));

  // Contrast shaping; bass lifts the floor
  let sharp = 1.0 + contrast * 3.0;
  let v = pow(clamp(n, 0.0, 1.0), sharp);

  let nebHue = hue + n * 110.0 + u.mid * 70.0;
  var col = hsl2rgb(nebHue, 0.75, v * (0.22 + u.bass * 0.45) + 0.02);

  // Treble sparkle grain
  let g = pow(noise2(q * 9.0 + vec2f(t * 6.0, -t * 4.0)), 18.0);
  col += vec3f(1.0, 0.95, 0.9) * g * u.treble * sparkle * 2.0;

  // Beat bloom from center
  let r2 = length(p);
  col += hsl2rgb(hue, 0.8, 0.55) * u.beatIntensity * 0.18 * exp(-r2 * 3.0);

  col *= 1.0 - dot(p, p) * 0.35;
  return vec4f(col, 1.0);
}
`,
};
