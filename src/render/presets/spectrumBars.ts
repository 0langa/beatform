import type { PresetDef } from "../types";

/**
 * Log-spectrum bars with glow, peak caps, beat-driven background pulse and
 * vignette. Pure fragment-shader preset — the whole screen is computed from
 * features + params, milkdrop-style.
 */
export const spectrumBars: PresetDef = {
  id: "spectrum-bars",
  name: "Spectrum Bars",
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 210 },
    { key: "hueSpread", label: "Hue spread", min: 0, max: 180, step: 1, default: 80 },
    { key: "glow", label: "Glow", min: 0, max: 1, step: 0.01, default: 0.45 },
    { key: "barGap", label: "Bar gap", min: 0, max: 0.6, step: 0.01, default: 0.22 },
    { key: "beatZoom", label: "Beat zoom", min: 0, max: 0.15, step: 0.005, default: 0.05 },
    { key: "mirror", label: "Mirror", min: 0, max: 1, step: 1, default: 0 },
  ],
  wgsl: /* wgsl */ `
fn preset(uvIn: vec2f) -> vec4f {
  let hue = param(0); let hueSpread = param(1); let glow = param(2);
  let barGap = param(3); let beatZoom = param(4); let mirror = param(5);

  // Beat zoom: scale around center
  var uv = (uvIn - 0.5) / (1.0 + u.beatIntensity * beatZoom) + 0.5;

  // Optional mirror around center column
  var x = uv.x;
  if (mirror > 0.5) { x = abs(uv.x - 0.5) * 2.0; }

  let n = f32(u.binCount);
  let fi = clamp(x * n, 0.0, n - 0.001);
  let i = u32(fi);
  let inBar = fract(fi);
  let v = bins[i];
  let pk = peaks[i];

  // Background: dark radial wash breathing with bass + beat flash
  let d = distance(uv, vec2f(0.5, 0.55));
  let bgHue = hue + 40.0;
  var col = hsl2rgb(bgHue, 0.5, 0.05 + u.bass * 0.05) * (1.0 - d * 0.9);
  col += hsl2rgb(hue, 0.7, 0.5) * u.beatIntensity * 0.08 * (1.0 - d);

  let y = 1.0 - uv.y; // bars grow from bottom
  let barH = v * 0.92;
  let gapMask = step(barGap * 0.5, inBar) * step(inBar, 1.0 - barGap * 0.5);
  let barHue = hue + (fi / n) * hueSpread;

  // Bar body with vertical gradient
  if (y < barH) {
    let g = y / max(barH, 0.001);
    col = hsl2rgb(barHue, 0.85, 0.35 + g * 0.35 + u.beatIntensity * 0.08) * gapMask
        + col * (1.0 - gapMask);
  } else {
    // Glow above the bar
    let fall = exp(-(y - barH) * (14.0 - glow * 10.0));
    col += hsl2rgb(barHue, 0.9, 0.5) * fall * glow * v * gapMask;
  }

  // Peak caps
  let capD = abs(y - pk * 0.92);
  col += hsl2rgb(barHue, 0.3, 0.9) * smoothstep(0.006, 0.0, capD) * gapMask * 0.9;

  // Vignette
  col *= 1.0 - d * d * 0.55;
  return vec4f(col, 1.0);
}
`,
};
