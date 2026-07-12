import type { PresetDef } from "../types";

/**
 * Circular spectrum: bars radiate outward from a pulsing core ring, with
 * optional rotational symmetry and beat-kicked rotation.
 */
export const radialBurst: PresetDef = {
  id: "radial-burst",
  name: "Radial Burst",
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 280 },
    { key: "hueSpread", label: "Hue spread", min: 0, max: 240, step: 1, default: 120 },
    { key: "innerRadius", label: "Core size", min: 0.08, max: 0.35, step: 0.005, default: 0.18 },
    { key: "symmetry", label: "Symmetry", min: 1, max: 8, step: 1, default: 2 },
    { key: "rotSpeed", label: "Rotation", min: -1, max: 1, step: 0.02, default: 0.12 },
    { key: "glow", label: "Glow", min: 0, max: 1, step: 0.01, default: 0.55 },
    { key: "peaks", label: "Peak arcs", min: 0, max: 1, step: 1, default: 1 },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  let hue = param(0); let hueSpread = param(1); let innerR = param(2);
  let sym = max(1.0, param(3)); let rotSpeed = param(4); let glow = param(5);

  let p = centered(uv);
  let r = length(p);
  var a = atan2(p.y, p.x) + u.time * rotSpeed * TAU * 0.1 + u.beatIntensity * 0.12;

  // Fold into symmetric segments, mirrored inside each for seamless wrap
  let seg = fract(a / TAU * sym + 10.0);
  let xs = abs(seg * 2.0 - 1.0);
  let v = binAt(xs);
  let pk = peakAt(xs);

  let inner = innerR * (1.0 + u.bass * 0.12 + u.beatIntensity * 0.06);
  let len = v * 0.34;
  let barHue = hue + xs * hueSpread;

  // Background wash
  var col = hsl2rgb(hue + 60.0, 0.5, 0.04 + u.mid * 0.04) * (1.0 - r * 0.8);

  // Radial bar body
  let inBar = step(inner, r) * step(r, inner + len);
  let radial = (r - inner) / max(len, 0.001);
  col = mix(col, hsl2rgb(barHue, 0.85, 0.35 + radial * 0.35), inBar);

  // Glow beyond bar tip
  let tip = inner + len;
  let fall = exp(-max(r - tip, 0.0) * (18.0 - glow * 12.0));
  col += hsl2rgb(barHue, 0.9, 0.5) * fall * glow * v * step(tip, r);

  // Peak arc (toggleable)
  let pkR = inner + pk * 0.34;
  col += hsl2rgb(barHue, 0.3, 0.9) * smoothstep(0.005, 0.0, abs(r - pkR)) * 0.8
       * step(0.5, param(6));

  // Core disc: bass breathes it, beats kick it, band-driven harmonics
  // undulate the edge (smooth shapes, punchy amplitudes — reactive without
  // the per-frame spikes raw waveform sampling caused)
  // Geometry rides only slow signals — fast bands jitter, energy glides
  let pump = 1.0 + u.energy * 0.08 + u.beatIntensity * 0.04;
  let coreR = inner * 0.70 * pump;
  // One slow-rotating dominant mode, amplitude on the slow energy envelope:
  // quiet = near-circle, loud passage = gentle tri-lobe swell. Secondary
  // mode adds subtle detail. Hard clamp keeps the core inside the bar ring.
  let spin = u.time * (0.25 + u.energy * 0.35);
  let amp = inner * (0.03 + u.energy * 0.11);
  var wob = sin(a * 3.0 + spin) * amp
          + sin(a * 6.0 - spin * 0.7 + 1.3) * amp * 0.35;
  let lim = inner * 0.14;
  wob = clamp(wob, -lim, lim);
  let core = smoothstep(coreR + wob + 0.005, coreR + wob - 0.005, r);
  let coreL = 0.12 + u.energy * 0.35 + u.beatIntensity * 0.10;
  col = mix(col, hsl2rgb(hue + 30.0, 0.75, coreL), core);
  // Thin waveform detail ring inside the core: fast micro-motion reads as
  // "alive" on a hairline without deforming the silhouette
  let wr = coreR * 0.55 + waveAt(fract(a / TAU + 0.5)) * 0.02;
  col += hsl2rgb(hue + 50.0, 0.6, 0.65) * smoothstep(0.004, 0.0, abs(r - wr)) * core * 0.5;

  // Vignette
  col *= 1.0 - r * r * 0.5;
  return vec4f(col, 1.0);
}
`,
};
