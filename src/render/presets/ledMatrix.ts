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
 *
 * v2.47: phosphor ghost trail (recently-vacated cells fade instead of cutting
 * to black), an optional per-column frequency palette (RGB Wall), CRT
 * scanlines + a subtle deterministic flicker, and a beat-driven border flash —
 * so the wall reacts on all three timescales (beat flash / boost, band energy
 * backlight, spectrum + peak texture) and covers the full retro-hardware range
 * from hi-fi VU to amber terminal to Matrix console to a full RGB video wall.
 */
export const ledMatrix: PresetDef = {
  id: "led-matrix",
  name: "LED Matrix",
  description:
    "Retro hi-fi LED wall: columns light bottom-up with the spectrum, green through red, with phosphor trails, scanlines and a beat-flash border.",
  styles: [
    { id: "vu", name: "Hi-Fi Classic", values: {} },
    {
      id: "cyan",
      name: "Ice Blue",
      values: { hueLow: 190, hueHigh: 210, ghost: 0.18, scanline: 0.08 },
    },
    { id: "purple", name: "Purple Rain", values: { hueShift: 250, ghost: 0.24, bloom: 1.0 } },
    {
      id: "bigpixel",
      name: "Big Pixels",
      values: { cols: 24, rows: 12, gap: 0.28, rounded: 0, bloom: 1.0, beatFlash: 0.3 },
    },
    {
      id: "amber",
      name: "Amber Terminal",
      values: {
        hueLow: 45,
        hueHigh: 10,
        gradStart: 0.5,
        gradEnd: 0.95,
        bassGlow: 0.16,
        rounded: 0,
        gap: 0.12,
        scanline: 0.34,
        flicker: 0.12,
        ghost: 0.2,
      },
    },
    {
      id: "terminal",
      name: "Matrix",
      values: {
        hueLow: 120,
        hueHigh: 95,
        cols: 64,
        rows: 32,
        gap: 0.1,
        rounded: 0,
        dim: 0.2,
        bassGlow: 0.05,
        ghost: 0.32,
        scanline: 0.24,
        flicker: 0.08,
      },
    },
    {
      id: "rgb",
      name: "RGB Wall",
      values: {
        spectrumColor: 1,
        bloom: 1.15,
        beatFlash: 0.4,
        panelVariance: 0.5,
        gap: 0.16,
        ghost: 0.14,
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
      key: "spectrumColor",
      label: "Frequency palette",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0,
      hint: "Blend cell color from the height gradient toward a per-column rainbow (bass red, treble violet) — 1.0 is the full RGB video-wall look",
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
      key: "ghost",
      label: "Phosphor trail",
      min: 0,
      max: 0.6,
      step: 0.01,
      default: 0.12,
      hint: "Recently-vacated cells above the live top glow and fade toward the peak, like slow phosphor decay",
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
      key: "beatFlash",
      label: "Beat border",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.2,
      hint: "The wall's outer border flashes on each beat",
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
      key: "scanline",
      label: "Scanlines",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.12,
      hint: "CRT-style horizontal scanline darkening across the panel",
    },
    {
      key: "flicker",
      label: "Flicker",
      min: 0,
      max: 0.6,
      step: 0.02,
      default: 0.05,
      hint: "Subtle rolling brightness flicker, like an old powered display (deterministic)",
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

  // Cell colour: low hue -> high hue as cells climb (default classic green ->
  // red), optionally cross-faded toward a per-COLUMN frequency palette (bass at
  // the red end, treble toward violet) for the full RGB video-wall look. Plus a
  // faint per-LED colour-temperature jitter so the wall doesn't read as one
  // flat sheet of colour.
  let gradHue = mix(P_hueLow(), P_hueHigh(), smoothstep(P_gradStart(), P_gradEnd(), frac));
  let freqHue = (cx + 0.5) / cols * 300.0;
  let cellHue = mix(gradHue, freqHue, P_spectrumColor())
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

  // Phosphor ghost trail: cells ABOVE the live top but BELOW the recent peak
  // glow and fade with distance from the top, so a falling column leaves a
  // decaying wake instead of snapping to black. Deterministic — it reads the
  // peak-hold buffer, no per-frame state.
  let pkLevel = pk * rows;
  let ghostLit = step(cy + 0.5, pkLevel) * (1.0 - lit);
  let ghostFade = exp(-max((cy + 0.5) - level, 0.0) * 0.6);
  col += hsl2rgb(cellHue, 0.85, P_litLevel() * 0.55) * mask * ghostLit * ghostFade * P_ghost();
  col += hsl2rgb(cellHue, 0.7, 0.5) * glow * ghostLit * ghostFade * P_ghost() * P_bloom() * 0.5;

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
  // own height, so it follows the palette instead of staying the default red,
  // plus the same soft bloom as the live cells.
  let pkRow = floor(pk * rows);
  if (cy == pkRow && pk > 0.02 && P_peaks() > 0.5) {
    let pkFrac = (pkRow + 0.5) / rows;
    let pkGrad = mix(P_hueLow(), P_hueHigh(), smoothstep(P_gradStart(), P_gradEnd(), pkFrac));
    let pkHue = mix(pkGrad, freqHue, P_spectrumColor()) + P_hueShift();
    col += hsl2rgb(pkHue, 0.55, P_peakBright()) * mask;
    col += hsl2rgb(pkHue, 0.4, 0.75) * glow * P_bloom() * 0.5;
  }

  // Beat border flash: the wall's outer frame pulses on the tempo grid — a
  // whole-panel beat response distinct from the per-LED beat boost.
  let bdist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  let border = smoothstep(0.07, 0.0, bdist);
  col += hsl2rgb(P_hueHigh() + P_hueShift(), 0.85, 0.5) * border * beatP * P_beatFlash();

  // CRT scanlines: fixed-frequency horizontal darkening, independent of the LED
  // grid so it reads as a display overlay rather than the diode rows.
  let scan = 1.0 - P_scanline() * (0.5 + 0.5 * sin(uv.y * 300.0)) * 0.5;
  // Rolling powered-display flicker. sin() is bounded and deterministic (same
  // track time -> same value in live and export), so it never desyncs.
  let flick = 1.0 - P_flicker() * (0.5 + 0.5 * sin(u.time * 18.0 + uv.y * 40.0)) * 0.5;
  col *= scan * flick;

  // Subtle screen curvature vignette
  let d = distance(uv, vec2f(0.5));
  col *= 1.0 - d * d * P_vignette();
  col = tonemap(col * 1.05);
  col += grain(uv, 0.01);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
