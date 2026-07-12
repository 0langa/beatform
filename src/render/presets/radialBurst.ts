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

  // Peak arc
  let pkR = inner + pk * 0.34;
  col += hsl2rgb(barHue, 0.3, 0.9) * smoothstep(0.005, 0.0, abs(r - pkR)) * 0.8;

  // Core disc: waveform-textured, rms-breathing
  let coreR = inner * 0.72;
  let wob = waveAt(fract(a / TAU + 0.5)) * 0.02 * (1.0 + u.rms * 2.0);
  let core = smoothstep(coreR + wob + 0.004, coreR + wob - 0.004, r);
  col = mix(col, hsl2rgb(hue + 30.0, 0.7, 0.12 + u.rms * 0.45 + u.beatIntensity * 0.2), core);

  // Vignette
  col *= 1.0 - r * r * 0.5;
  return vec4f(col, 1.0);
}
`,
};
