import type { PresetDef } from "../types";

/**
 * Retro LED spectrum matrix: quantized cells lighting bottom-up per column,
 * classic green->yellow->red gradient (hue-shiftable), peak-hold dot per
 * column.
 */
export const ledMatrix: PresetDef = {
  id: "led-matrix",
  name: "LED Matrix",
  params: [
    { key: "cols", label: "Columns", min: 16, max: 96, step: 1, default: 48 },
    { key: "rows", label: "Rows", min: 8, max: 48, step: 1, default: 24 },
    { key: "gap", label: "Cell gap", min: 0.05, max: 0.5, step: 0.01, default: 0.18 },
    { key: "hueShift", label: "Hue shift", min: 0, max: 360, step: 1, default: 0 },
    { key: "dim", label: "Unlit glow", min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: "rounded", label: "Rounded", min: 0, max: 1, step: 1, default: 1 },
  ],
  wgsl: /* wgsl */ `
fn ledCell(l: vec2f, gap: f32, rounded: f32) -> f32 {
  let c = l - 0.5;
  if (rounded > 0.5) {
    let d = length(c);
    return smoothstep(0.5 - gap * 0.5, 0.35 - gap * 0.5, d);
  }
  let e = vec2f(0.5 - gap * 0.5);
  let m = step(abs(c), e);
  return m.x * m.y;
}

fn preset(uv: vec2f) -> vec4f {
  let cols = max(4.0, param(0)); let rows = max(4.0, param(1));
  let gap = param(2); let hueShift = param(3); let dim = param(4);
  let rounded = param(5);

  let cx = floor(uv.x * cols);
  let lx = fract(uv.x * cols);
  let yb = 1.0 - uv.y;
  let cy = floor(yb * rows);
  let ly = fract(yb * rows);

  let v = binAt((cx + 0.5) / cols);
  let pk = peakAt((cx + 0.5) / cols);

  let level = v * rows;
  let lit = step(cy + 0.5, level);
  let frac = (cy + 0.5) / rows;

  // green (120) -> yellow -> red (0) as cells climb
  let cellHue = mix(120.0, 0.0, smoothstep(0.45, 0.92, frac)) + hueShift;

  let mask = ledCell(vec2f(lx, ly), gap, rounded);

  var col = vec3f(0.008, 0.01, 0.012); // panel background
  // Unlit LEDs faintly visible
  col += hsl2rgb(cellHue, 0.6, 0.05) * mask * dim * (1.0 - lit);
  // Lit LEDs, brighter near the top of the column's level
  let hot = 0.45 + 0.15 * smoothstep(level - 2.0, level, cy + 0.5) + u.beatIntensity * 0.08;
  col += hsl2rgb(cellHue, 0.9, hot) * mask * lit;

  // Peak-hold dot
  let pkRow = floor(pk * rows);
  if (cy == pkRow && pk > 0.02) {
    col += hsl2rgb(hueShift + 10.0, 0.4, 0.85) * mask;
  }

  // Subtle screen curvature vignette
  let d = distance(uv, vec2f(0.5));
  col *= 1.0 - d * d * 0.5;
  return vec4f(col, 1.0);
}
`,
};
