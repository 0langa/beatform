import type { PresetDef } from "../types";

/**
 * Retro LED spectrum matrix: quantized cells lighting bottom-up per column,
 * classic green->yellow->red gradient (hue-shiftable), peak-hold dot per
 * column.
 *
 * Look pass: each lit cell gets a soft per-dot bloom bleeding into the gap
 * around it (not just a hard-edged mask), a faint structural grid on the
 * board between cells, a per-LED brightness/colour-temperature jitter that's
 * fixed per cell (hashed from its own coordinate, never re-rolled per frame)
 * so the wall reads as individual diodes, and a coarse per-tile brightness
 * band standing in for uneven panel assembly — real LED walls are built from
 * physical tiles and are never perfectly uniform.
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
      key: "bloom",
      label: "LED bloom",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.8,
      hint: "Soft light bleeding from each lit LED into the gap around it",
    },
    {
      key: "panelVariance",
      label: "Panel variance",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.4,
      hint: "Per-diode brightness + color-temperature jitter and tile-to-tile banding, like a real assembled wall",
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

// Soft per-dot bloom: unlike ledCell's hard mask, this glows continuously
// from the cell's center out into the gap — the difference between a
// printed dot and one that is actually emitting light.
fn ledGlow(l: vec2f) -> f32 {
  let c = l - 0.5;
  return exp(-dot(c, c) * 6.0);
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

  // Fixed per-LED identity: hashed once from the cell's own coordinate, so it
  // never re-rolls frame to frame — manufacturing variance, not shimmer.
  let cellId = vec2f(cx, cy);
  let jBright = hash21(cellId) - 0.5; // +-0.5, brightness jitter
  let jHue = hash21(cellId + 91.7) - 0.5; // +-0.5, colour-temperature jitter
  let jSat = hash21(cellId + 173.3); // 0..1
  let pv = P_panelVariance();

  let beatP = max(u.driveBeat, gridPulse(9.0));

  // low hue -> high hue as cells climb (default classic green -> red), plus a
  // faint per-LED colour-temperature jitter so the wall doesn't read as one
  // flat sheet of colour.
  let cellHue = mix(P_hueLow(), P_hueHigh(), smoothstep(P_gradStart(), P_gradEnd(), frac))
              + P_hueShift() + jHue * 6.0 * pv;

  let mask = ledCell(vec2f(lx, ly), P_gap(), P_rounded());
  let glow = ledGlow(vec2f(lx, ly));

  // Panel brightness falloff: LED walls are built from physical tiles, and
  // even within one tile output isn't perfectly even — a coarse per-tile
  // band (not a smooth radial vignette) stands in for that construction.
  let tileId = floor(vec2f(cx, cy) / 8.0);
  let panelFalloff = mix(1.0, 0.82 + 0.22 * hash21(tileId * 3.7), pv);

  var col = vec3f(0.006, 0.008, 0.01); // panel/PCB background
  // A faint structural grid on the mounting board — reads as physical
  // hardware instead of an empty void between LEDs.
  let edge = min(min(lx, 1.0 - lx), min(ly, 1.0 - ly));
  col += vec3f(0.01, 0.012, 0.014) * smoothstep(0.035, 0.0, edge) * (1.0 - mask);
  // Panel backlight breathes with the bass — the wall reads the music even
  // between columns, without touching the LED look itself.
  col += hsl2rgb(P_hueLow() + P_hueShift(), 0.8, 0.3) * u.bass * P_bassGlow();
  // Unlit LEDs faintly visible
  col += hsl2rgb(cellHue, 0.5, 0.04) * mask * P_dim() * (1.0 - lit);

  // Lit LEDs: flat mask body, brighter near the column's current top, plus
  // beat boost — then a soft bloom that bleeds past the mask into the gap,
  // which is what makes a dot read as EMITTING rather than printed.
  let hot = P_litLevel() + P_hotBoost() * smoothstep(level - 2.0, level, cy + 0.5)
          + beatP * P_beatBoost();
  let litBright = hot * mix(1.0, panelFalloff * (0.82 + jBright * 0.36), pv);
  var ledCol = hsl2rgb(cellHue, 0.9 - jSat * 0.15 * pv, litBright) * mask * lit;
  ledCol += hsl2rgb(cellHue, 0.75, 0.62) * glow * lit * P_bloom() * (0.4 + v * 0.6)
          * (0.6 + jBright * 0.5 * pv);
  // Hot-core desaturation on the brightest cells (top of a loud column) so
  // they read as genuinely emitting instead of merely "very saturated green".
  let veryHot = smoothstep(0.8, 1.1, hot) * lit;
  ledCol = mix(ledCol, vec3f(1.0, 0.98, 0.92), veryHot * 0.55 * mask);
  ledCol *= 1.0 + veryHot * 0.6;
  col += ledCol;

  // Peak-hold dot (toggleable) — takes the column gradient's color at its
  // own height, so it follows Cyan Wall/Purple Rain instead of staying the
  // default red, plus the same soft bloom as the live cells.
  let pkRow = floor(pk * rows);
  if (cy == pkRow && pk > 0.02 && P_peaks() > 0.5) {
    let pkFrac = (pkRow + 0.5) / rows;
    let pkHue = mix(P_hueLow(), P_hueHigh(), smoothstep(P_gradStart(), P_gradEnd(), pkFrac))
              + P_hueShift();
    col += hsl2rgb(pkHue, 0.55, P_peakBright()) * mask;
    col += hsl2rgb(pkHue, 0.4, 0.75) * glow * P_bloom() * 0.5;
  }

  // Subtle screen curvature vignette
  let d = distance(uv, vec2f(0.5));
  col *= 1.0 - d * d * P_vignette();
  col = tonemap(col * 1.05);
  col += grain(uv, 0.01);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
