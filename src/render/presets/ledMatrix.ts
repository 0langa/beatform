import type { PresetDef } from "../types";

/**
 * Retro LED spectrum matrix: quantized cells lighting bottom-up per column,
 * classic green->yellow->red gradient (hue-shiftable), peak-hold dot per
 * column.
 */
export const ledMatrix: PresetDef = {
  id: "led-matrix",
  name: "LED Matrix",
  description:
    "Retro hi-fi LED wall: columns light bottom-up with the spectrum, green through red.",
  styles: [
    { id: "vu", name: "Classic VU", values: {} },
    { id: "cyan", name: "Cyan Wall", values: { hueLow: 190, hueHigh: 210 } },
    { id: "purple", name: "Purple Rain", values: { hueShift: 250 } },
    { id: "bigpixel", name: "Big Pixels", values: { cols: 24, rows: 12, gap: 0.28, rounded: 0 } },
    {
      id: "amber",
      name: "Amber Meter",
      values: { hueLow: 45, hueHigh: 10, gradStart: 0.5, gradEnd: 0.95, bassGlow: 0.16 },
    },
    {
      id: "terminal",
      name: "Terminal",
      values: {
        hueLow: 120,
        hueHigh: 95,
        cols: 64,
        rows: 32,
        gap: 0.1,
        rounded: 0,
        dim: 0.2,
        bassGlow: 0.05,
      },
    },
  ],
  params: [
    {
      key: "cols",
      label: "Columns",
      min: 16,
      max: 96,
      step: 1,
      default: 48,
      hint: "LED columns — fewer = chunkier retro look",
    },
    {
      key: "rows",
      label: "Rows",
      min: 8,
      max: 48,
      step: 1,
      default: 24,
      hint: "LED rows — the resolution of each column",
    },
    {
      key: "gap",
      label: "Cell gap",
      min: 0.05,
      max: 0.5,
      step: 0.01,
      default: 0.18,
      hint: "Spacing between LEDs",
    },
    {
      key: "hueShift",
      label: "Hue shift",
      min: 0,
      max: 360,
      step: 1,
      default: 0,
      hint: "Rotate the whole color scheme around the wheel",
    },
    {
      key: "dim",
      label: "Unlit glow",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      hint: "Visibility of LEDs that are currently off",
    },
    {
      key: "rounded",
      label: "Rounded",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Round LEDs vs square pixels",
    },
    {
      key: "peaks",
      label: "Peak dots",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Bright dot holding each column's recent maximum",
    },
  ],
  advanced: [
    {
      key: "hueLow",
      label: "Low hue",
      min: 0,
      max: 360,
      step: 1,
      default: 120,
      hint: "Color of the bottom (quiet) cells — default green",
    },
    {
      key: "hueHigh",
      label: "High hue",
      min: 0,
      max: 360,
      step: 1,
      default: 0,
      hint: "Color of the top (loud) cells — default red",
    },
    {
      key: "gradStart",
      label: "Gradient start",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.45,
      hint: "Column height where the color starts changing",
    },
    {
      key: "gradEnd",
      label: "Gradient end",
      min: 0.3,
      max: 1,
      step: 0.02,
      default: 0.92,
      hint: "Column height where the top color is reached",
    },
    {
      key: "litLevel",
      label: "Lit brightness",
      min: 0.2,
      max: 0.8,
      step: 0.02,
      default: 0.45,
      hint: "Brightness of lit LEDs",
    },
    {
      key: "hotBoost",
      label: "Top-cell boost",
      min: 0,
      max: 0.4,
      step: 0.02,
      default: 0.15,
      hint: "Extra brightness for the topmost lit cells",
    },
    {
      key: "beatBoost",
      label: "Beat boost",
      min: 0,
      max: 0.3,
      step: 0.01,
      default: 0.08,
      hint: "All lit LEDs brighten on beats",
    },
    {
      key: "bassGlow",
      label: "Bass backlight",
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.1,
      hint: "Panel background breathes with the bass",
    },
    {
      key: "peakBright",
      label: "Peak brightness",
      min: 0.3,
      max: 1.2,
      step: 0.05,
      default: 0.85,
      hint: "Brightness of the peak-hold dots",
    },
    {
      key: "vignette",
      label: "Vignette",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
      hint: "Screen-curvature darkening at the corners",
    },
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
  let cols = max(4.0, P_cols());
  let rows = max(4.0, P_rows());

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

  // low hue -> high hue as cells climb (default classic green -> red)
  let cellHue = mix(P_hueLow(), P_hueHigh(), smoothstep(P_gradStart(), P_gradEnd(), frac))
              + P_hueShift();

  let mask = ledCell(vec2f(lx, ly), P_gap(), P_rounded());

  var col = vec3f(0.008, 0.01, 0.012); // panel background
  // Panel backlight breathes with the bass — the wall reads the music even
  // between columns, without touching the LED look itself.
  col += hsl2rgb(P_hueLow() + P_hueShift(), 0.8, 0.3) * u.bass * P_bassGlow();
  // Unlit LEDs faintly visible
  col += hsl2rgb(cellHue, 0.6, 0.05) * mask * P_dim() * (1.0 - lit);
  // Lit LEDs, brighter near the top of the column's level
  let hot = P_litLevel() + P_hotBoost() * smoothstep(level - 2.0, level, cy + 0.5)
          + u.driveBeat * P_beatBoost();
  col += hsl2rgb(cellHue, 0.9, hot) * mask * lit;

  // Peak-hold dot (toggleable) — takes the column gradient's color at its
  // own height, so it follows Cyan Wall/Purple Rain instead of staying the
  // default red (the old code misused hueShift as an absolute hue).
  let pkRow = floor(pk * rows);
  if (cy == pkRow && pk > 0.02 && P_peaks() > 0.5) {
    let pkFrac = (pkRow + 0.5) / rows;
    let pkHue = mix(P_hueLow(), P_hueHigh(), smoothstep(P_gradStart(), P_gradEnd(), pkFrac))
              + P_hueShift();
    col += hsl2rgb(pkHue, 0.55, P_peakBright()) * mask;
  }

  // Subtle screen curvature vignette
  let d = distance(uv, vec2f(0.5));
  col *= 1.0 - d * d * P_vignette();
  return vec4f(col, 1.0);
}
`,
};
