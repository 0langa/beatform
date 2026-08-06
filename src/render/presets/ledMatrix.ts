import type { PresetDef } from "../types";
import { WGSL_COLOR_CONTROLS } from "../wgslLib";

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
 *
 * Depth wave (Track B): a Display switch turns the same wall into a scrolling
 * SPECTROGRAM — each row one time slice, new rows entering at the bottom
 * (Waterfall Up) or top (Waterfall Down) and riding the texture-feedback path.
 * History is carried as per-cell DATA in the raw output's alpha channel (the
 * composite pass derives its own alpha and never reads it), so the record
 * never re-reads rendered pixels: no generation loss, no bloom or scanlines
 * accumulating into it. The scroll resolves from TRACK time — the row counter
 * is floor(u.time * rate) and state advances on the shared fixed 60 Hz
 * feedback clock (fixedFeedback.ts), the same grid live and in export.
 * Default Display = Bars, whose branch keeps the pre-wave expressions
 * unchanged, expression for expression.
 */
export const ledMatrix: PresetDef = {
  id: "led-matrix",
  name: "LED Matrix",
  description:
    "Retro hi-fi LED wall: columns light bottom-up with the spectrum, green through red — or switch the display to Waterfall and the wall becomes a scrolling spectrogram. Phosphor trails, scanlines and a beat-flash border.",
  styles: [
    // Hi-Fi Classic — the defaults — a hi-fi green-to-red LED wall.
    { id: "vu", name: "Hi-Fi Classic", values: {} },
    // Jumbotron — full per-column RGB palette on a big bright panel — a stadium screen.
    {
      id: "jumbotron",
      name: "Jumbotron",
      values: {
        spectrumColor: 1,
        cols: 80,
        rows: 40,
        gap: 0.1,
        bloom: 1.3,
        panelVariance: 0.7,
        beatFlash: 0.45,
        ghost: 0.16,
        scanline: 0.04,
        dim: 0.14,
        litLevel: 0.5,
        hotBoost: 0.24,
        vignette: 0.6,
      },
    },
    // Terminal — fine square pixels, long phosphor trail, scanlines, caps off.
    {
      id: "terminal",
      name: "Terminal",
      values: {
        hueLow: 122,
        hueHigh: 96,
        cols: 72,
        rows: 36,
        gap: 0.08,
        rounded: 0,
        dim: 0.16,
        bassGlow: 0.04,
        ghost: 0.4,
        scanline: 0.3,
        flicker: 0.1,
        bloom: 0.4,
        peaks: 0,
        panelVariance: 0.16,
        litLevel: 0.4,
        beatFlash: 0.06,
        gradStart: 0.2,
        gradEnd: 0.8,
        vignette: 0.7,
      },
    },
    // Chunky — 20x10 square pixels — a scoreboard you can count.
    {
      id: "chunky",
      name: "Chunky",
      values: {
        cols: 20,
        rows: 10,
        gap: 0.3,
        rounded: 0,
        bloom: 1.1,
        beatFlash: 0.35,
        peakBright: 1.1,
        panelVariance: 0.2,
        dim: 0.28,
        hueLow: 190,
        hueHigh: 320,
        gradStart: 0.26,
        gradEnd: 0.86,
        hotBoost: 0.3,
        scanline: 0.06,
        vignette: 0.45,
      },
    },
    // Amber Terminal — amber tube: heavy scanlines, flicker, panel variance.
    {
      id: "amber",
      name: "Amber Terminal",
      values: {
        hueLow: 45,
        hueHigh: 8,
        gradStart: 0.5,
        gradEnd: 0.94,
        rounded: 0,
        gap: 0.12,
        scanline: 0.44,
        flicker: 0.16,
        ghost: 0.26,
        bassGlow: 0.14,
        cols: 56,
        rows: 28,
        bloom: 0.55,
        dim: 0.22,
        panelVariance: 0.5,
        peakBright: 1,
        litLevel: 0.42,
        vignette: 0.75,
      },
    },
    // Blueprint — editorial. Wide-gap round dots, unlit dots visible, no bloom at all.
    {
      id: "blueprint",
      name: "Blueprint",
      values: {
        cols: 32,
        rows: 16,
        gap: 0.44,
        dim: 0.55,
        hueLow: 200,
        hueHigh: 200,
        gradStart: 0.4,
        gradEnd: 0.9,
        litLevel: 0.6,
        hotBoost: 0.04,
        bloom: 0.1,
        scanline: 0,
        flicker: 0,
        panelVariance: 0.06,
        bassGlow: 0.02,
        beatFlash: 0.04,
        beatBoost: 0.02,
        ghost: 0.04,
        peakBright: 1.15,
        vignette: 0.2,
      },
    },
    // Nightclub — max bloom and border flash, part-spectrum palette — the wall as a light.
    {
      id: "nightclub",
      name: "Nightclub",
      values: {
        cols: 64,
        rows: 32,
        gap: 0.2,
        spectrumColor: 0.6,
        hueShift: 210,
        bloom: 1.25,
        beatFlash: 0.85,
        beatBoost: 0.24,
        bassGlow: 0.2,
        ghost: 0.3,
        panelVariance: 0.6,
        flicker: 0.08,
        litLevel: 0.52,
        hotBoost: 0.34,
        peakBright: 1.2,
        dim: 0.2,
        vignette: 0.4,
      },
    },
    // Spectrogram — the studio analyzer: fine square grid scrolling up, cold
    // blue floor to red-hot ceiling, clean panel, calm border.
    {
      id: "spectrogram",
      name: "Spectrogram",
      values: {
        display: 1,
        cols: 64,
        rows: 48,
        gap: 0.08,
        rounded: 0,
        scrollSpeed: 18,
        hueLow: 232,
        hueHigh: 12,
        gradStart: 0.06,
        gradEnd: 0.7,
        litLevel: 0.5,
        dim: 0.12,
        bloom: 0.5,
        histFade: 0.15,
        scanline: 0.06,
        flicker: 0,
        panelVariance: 0.12,
        beatFlash: 0.08,
        vignette: 0.3,
      },
    },
    // Code Rain — green phosphor sinking from the top, long fade, heavy CRT
    // dressing — the console wall from the other side of the screen.
    {
      id: "rain",
      name: "Code Rain",
      values: {
        display: 2,
        rows: 40,
        gap: 0.22,
        rounded: 0,
        scrollSpeed: 8,
        hueLow: 138,
        hueHigh: 96,
        gradStart: 0.1,
        gradEnd: 0.8,
        litLevel: 0.56,
        dim: 0.1,
        bloom: 0.65,
        histFade: 0.55,
        scanline: 0.34,
        flicker: 0.12,
        panelVariance: 0.3,
        beatFlash: 0.04,
        beatBoost: 0.04,
        vignette: 0.7,
      },
    },
    // Prism Roll — the frequency palette on a fast waterfall: every column
    // keeps its rainbow hue and loudness becomes pure brightness.
    {
      id: "prism",
      name: "Prism Roll",
      values: {
        display: 1,
        spectrumColor: 1,
        cols: 80,
        rows: 40,
        gap: 0.12,
        scrollSpeed: 24,
        litLevel: 0.56,
        hotBoost: 0.3,
        dim: 0.06,
        bloom: 1.1,
        histFade: 0.3,
        scanline: 0.02,
        panelVariance: 0.24,
        beatFlash: 0.3,
        beatBoost: 0.12,
        vignette: 0.35,
      },
    },
  ],
  params: [
    {
      key: "display",
      label: "Display",
      group: "shape",
      control: "enum",
      mod: "off",
      options: [
        {
          value: 0,
          label: "Bars",
          hint: "Classic columns lighting bottom-up with the live spectrum",
        },
        {
          value: 1,
          label: "Waterfall ↑",
          hint: "Scrolling spectrogram — new rows enter at the bottom and rise",
        },
        {
          value: 2,
          label: "Waterfall ↓",
          hint: "Scrolling spectrogram — new rows enter at the top and sink",
        },
      ],
      min: 0,
      max: 2,
      step: 1,
      default: 0,
      hint: "What the wall shows: live spectrum bars, or a scrolling spectrogram where each row is one moment of the track",
    },
    {
      key: "cols",
      label: "Columns",
      mod: "snap",
      group: "shape",
      min: 16,
      max: 96,
      step: 1,
      default: 48,
      hint: "LED columns — fewer = chunkier retro look",
    },
    {
      key: "rows",
      label: "Rows",
      mod: "snap",
      group: "shape",
      min: 8,
      max: 48,
      step: 1,
      default: 24,
      hint: "LED rows — the resolution of each column, and the length of the Waterfall's memory",
    },
    {
      key: "gap",
      label: "Cell gap",
      group: "shape",
      min: 0.05,
      max: 0.5,
      step: 0.01,
      default: 0.18,
      hint: "Spacing between LEDs",
    },
    {
      key: "rounded",
      label: "Rounded",
      group: "shape",
      control: "toggle",
      mod: "off",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Round LEDs vs square pixels",
    },
    {
      key: "hueShift",
      label: "Hue shift",
      group: "color",
      control: "hue",
      min: 0,
      max: 360,
      step: 1,
      default: 0,
      hint: "Rotate the whole color scheme around the wheel",
    },
    {
      key: "saturation",
      label: "Saturation",
      group: "color",
      min: 0,
      max: 2,
      step: 0.01,
      default: 1,
      hint: "Whole-visual color intensity — 0 = grayscale, 1 = authored color, 2 = double (clipped at vivid)",
    },
    {
      key: "lightness",
      label: "Lightness",
      group: "color",
      min: 0,
      max: 2,
      step: 0.01,
      default: 1,
      hint: "Whole-visual lightness — 0 = black, 1 = authored lightness, 2 = double (clipped at white)",
    },
    {
      key: "ghost",
      label: "Phosphor trail",
      group: "motion",
      min: 0,
      max: 0.6,
      step: 0.01,
      default: 0.12,
      hint: "Recently-vacated cells above the live top glow and fade toward the peak, like slow phosphor decay (Bars display)",
    },
    {
      key: "scrollSpeed",
      label: "Scroll speed",
      group: "motion",
      taper: "log",
      min: 2,
      max: 40,
      step: 0.5,
      default: 12,
      hint: "Waterfall rows per second — slow keeps a long memory on the wall, fast reads like a broadcast analyzer (Waterfall display)",
    },
    {
      key: "beatBoost",
      label: "Beat boost",
      group: "reaction",
      min: 0,
      max: 0.3,
      step: 0.01,
      default: 0.08,
      hint: "All lit LEDs brighten on beats",
    },
    {
      key: "dim",
      label: "Unlit glow",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      hint: "Visibility of LEDs that are currently off",
    },
  ],
  advanced: [
    {
      key: "hueLow",
      label: "Low hue",
      group: "color",
      control: "hue",
      min: 0,
      max: 360,
      step: 1,
      default: 120,
      hint: "Color of the bottom (quiet) cells — default green. In Waterfall, the color of quiet slices",
    },
    {
      key: "hueHigh",
      label: "High hue",
      group: "color",
      control: "hue",
      min: 0,
      max: 360,
      step: 1,
      default: 0,
      hint: "Color of the top (loud) cells — default red. In Waterfall, the color of loud slices",
    },
    {
      key: "spectrumColor",
      label: "Frequency palette",
      group: "color",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0,
      hint: "Blend cell color from the height gradient toward a per-column rainbow (bass red, treble violet) — 1.0 is the full RGB video-wall look",
    },
    {
      key: "gradStart",
      label: "Gradient start",
      group: "color",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.45,
      hint: "Column height where the color starts changing — in Waterfall, the loudness where a slice starts heating up",
    },
    {
      key: "gradEnd",
      label: "Gradient end",
      group: "color",
      min: 0.3,
      max: 1,
      step: 0.02,
      default: 0.92,
      hint: "Column height where the top color is reached — in Waterfall, the loudness that reads white-hot",
    },
    {
      key: "litLevel",
      label: "Lit brightness",
      group: "glow",
      min: 0.2,
      max: 0.8,
      step: 0.02,
      default: 0.45,
      hint: "Brightness of lit LEDs",
    },
    {
      key: "hotBoost",
      label: "Top-cell boost",
      group: "glow",
      min: 0,
      max: 0.4,
      step: 0.02,
      default: 0.15,
      hint: "Extra brightness for the topmost lit cells — in Waterfall, for the loudest slices",
    },
    {
      key: "bassGlow",
      label: "Bass backlight",
      group: "reaction",
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.1,
      hint: "Panel background breathes with the bass",
    },
    {
      key: "beatFlash",
      label: "Beat border",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.2,
      hint: "The wall's outer border flashes on each beat",
    },
    {
      key: "peaks",
      label: "Peak dots",
      group: "shape",
      control: "toggle",
      mod: "off",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Bright dot holding each column's recent maximum (Bars display)",
    },
    {
      key: "peakBright",
      label: "Peak brightness",
      group: "glow",
      min: 0.3,
      max: 1.2,
      step: 0.05,
      default: 0.85,
      hint: "Brightness of the peak-hold dots",
    },
    {
      key: "bloom",
      label: "LED bloom",
      group: "glow",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.8,
      hint: "Soft light bleeding from each lit LED into the gap around it",
    },
    {
      key: "histFade",
      label: "History fade",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.35,
      hint: "How much Waterfall rows dim as they age toward the exit edge — 0 keeps every slice equally bright (Waterfall display)",
    },
    {
      key: "scanline",
      label: "Scanlines",
      group: "backdrop",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.12,
      hint: "CRT-style horizontal scanline darkening across the panel",
    },
    {
      key: "flicker",
      label: "Flicker",
      group: "backdrop",
      min: 0,
      max: 0.6,
      step: 0.02,
      default: 0.05,
      hint: "Subtle rolling brightness flicker, like an old powered display (deterministic)",
    },
    {
      key: "panelVariance",
      label: "Panel variance",
      group: "backdrop",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.4,
      hint: "Per-diode brightness + color-temperature jitter and tile-to-tile banding, like a real assembled wall",
    },
    {
      key: "vignette",
      label: "Vignette",
      group: "backdrop",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
      hint: "Screen-curvature darkening at the corners",
    },
  ],
  wgsl: /* wgsl */ `
${WGSL_COLOR_CONTROLS}

fn presetRgb(rgb: vec3f) -> vec3f {
  let gray = vec3f(dot(rgb, vec3f(0.2126, 0.7152, 0.0722)));
  let saturation = P_saturation();
  var adjusted = mix(gray, rgb, saturation);
  if (saturation > 1.0) {
    adjusted = rgb + (rgb - gray) * (saturation - 1.0);
  }
  let lightness = P_lightness();
  if (lightness <= 1.0) { return adjusted * lightness; }
  return min(adjusted * lightness, vec3f(1.0));
}

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

  // Per-COLUMN frequency palette (bass at the red end, treble toward violet)
  // — shared by both displays and by the peak dot.
  let freqHue = (cx + 0.5) / cols * 300.0;

  let mask = ledCell(vec2f(lx, ly), P_gap(), P_rounded());
  let glow = ledGlow(vec2f(lx, ly));

  // Panel brightness falloff: LED walls are built from physical tiles, and
  // even within one tile output isn't perfectly even — a coarse per-tile
  // band (not a smooth radial vignette) stands in for that construction.
  let tileId = floor(vec2f(cx, cy) / 8.0);
  let panelFalloff = mix(1.0, 0.82 + 0.22 * hash21(tileId * 3.7), pv);

  var col = presetRgb(vec3f(0.006, 0.008, 0.01)); // panel/PCB background
  // A faint structural grid on the mounting board — reads as physical
  // hardware instead of an empty void between LEDs.
  let edge = min(min(lx, 1.0 - lx), min(ly, 1.0 - ly));
  col += presetRgb(vec3f(0.01, 0.012, 0.014)) * smoothstep(0.035, 0.0, edge) * (1.0 - mask);
  // Panel backlight breathes with the bass — the wall reads the music even
  // between columns, without touching the LED look itself.
  col += presetColor(P_hueLow() + P_hueShift(), 0.8, 0.3) * u.bass * P_bassGlow();

  // Raw-output alpha is this cell's DATA value for the waterfall's history
  // (the composite pass derives its own alpha and never reads this). Bars
  // write the live column value too, so flipping the Display mid-track
  // bootstraps the record with "now" instead of garbage.
  var dataA = v;

  if (P_display() < 0.5) {
    // ===== Bars: the classic live-spectrum wall (the default). This branch
    // keeps the pre-waterfall expressions unchanged, term for term. =====

    // Cell colour: low hue -> high hue as cells climb (default classic green
    // -> red), optionally cross-faded toward the per-column frequency palette
    // for the full RGB video-wall look. Plus a faint per-LED colour-
    // temperature jitter so the wall doesn't read as one flat sheet of colour.
    let gradHue = mix(P_hueLow(), P_hueHigh(), smoothstep(P_gradStart(), P_gradEnd(), frac));
    let cellHue = mix(gradHue, freqHue, P_spectrumColor())
                + P_hueShift() + jHue * 6.0 * pv;

    // Unlit LEDs faintly visible
    col += presetColor(cellHue, 0.5, 0.04) * mask * P_dim() * (1.0 - lit);

    // Phosphor ghost trail: cells ABOVE the live top but BELOW the recent peak
    // glow and fade with distance from the top, so a falling column leaves a
    // decaying wake instead of snapping to black. Deterministic — it reads the
    // peak-hold buffer, no per-frame state.
    let pkLevel = pk * rows;
    let ghostLit = step(cy + 0.5, pkLevel) * (1.0 - lit);
    let ghostFade = exp(-max((cy + 0.5) - level, 0.0) * 0.6);
    col += presetColor(cellHue, 0.85, P_litLevel() * 0.55) * mask * ghostLit * ghostFade * P_ghost();
    col += presetColor(cellHue, 0.7, 0.5) * glow * ghostLit * ghostFade * P_ghost() * P_bloom() * 0.5;

    // Lit LEDs: flat mask body, brighter near the column's current top, plus
    // beat boost — then a soft bloom that bleeds past the mask into the gap,
    // which is what makes a dot read as EMITTING rather than printed.
    let hot = P_litLevel() + P_hotBoost() * smoothstep(level - 2.0, level, cy + 0.5)
            + beatP * P_beatBoost();
    let litBright = hot * mix(1.0, panelFalloff * (0.82 + jBright * 0.36), pv);
    var ledCol = presetColor(cellHue, 0.9 - jSat * 0.15 * pv, litBright) * mask * lit;
    ledCol += presetColor(cellHue, 0.75, 0.62) * glow * lit * P_bloom() * (0.4 + v * 0.6)
            * (0.6 + jBright * 0.5 * pv);
    // Hot-core desaturation on the brightest cells (top of a loud column) so
    // they read as genuinely emitting instead of merely "very saturated green".
    let veryHot = smoothstep(0.8, 1.1, hot) * lit;
    ledCol = mix(ledCol, presetRgb(vec3f(1.0, 0.98, 0.92)), veryHot * 0.55 * mask);
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
      col += presetColor(pkHue, 0.55, P_peakBright()) * mask;
      col += presetColor(pkHue, 0.4, 0.75) * glow * P_bloom() * 0.5;
    }
  } else {
    // ===== Waterfall: the wall becomes a scrolling spectrogram. Each row is
    // one time slice; new rows enter at the entry edge (bottom for Waterfall
    // Up, top for Down) and history rides the texture-feedback path, advanced
    // on the shared fixed 60 Hz TRACK-time clock (fixedFeedback.ts) — the
    // same grid live and in export, and a paused track drains to dark exactly
    // like hardware watching a stopped input.
    //
    // The scroll resolves from track time, never frame count: the row counter
    // is floor(u.time * rate), and one state advance shifts history by
    // exactly the rows that counter gained over this tick's u.dt (one fixed
    // tick on advances, 0 on presentation-only frames — presentation never
    // scrolls, it re-shows the last state; the stepped row-by-row crawl is
    // the hardware look, not an accident). A seek that jumps the counter
    // simply refills the wall with fresh rows.
    //
    // Row content is read back from the data channel (raw alpha), so history
    // stays exact per-cell values instead of re-read pixels — cell centers
    // resample cell centers, integer rows at a time, no generation loss.
    let down = P_display() > 1.5;
    let rate = P_scrollSpeed();
    let shift = floor(u.time * rate) - floor((u.time - u.dt) * rate);
    let rowFromEntry = select(cy, rows - 1.0 - cy, down);
    var slice = v;
    if (rowFromEntry >= max(shift, 1.0) - 0.5) {
      // Older rows: this cell's slice sat "shift" rows nearer the entry edge
      // when the previous state was captured. The entry row keeps the LIVE
      // spectrum and is sampled-and-held into history by the next shift.
      let srcFromEntry = rowFromEntry - shift;
      let srcCy = select(srcFromEntry, rows - 1.0 - srcFromEntry, down);
      slice = feedbackSample(vec2f((cx + 0.5) / cols, 1.0 - (srcCy + 0.5) / rows)).a;
    }
    dataA = slice;

    // Loudness -> colour: the same low->high ramp the bars climb, driven by
    // the slice's loudness instead of cell height — Gradient start/end double
    // as the spectrogram's contrast knobs. The per-column frequency palette
    // cross-fades in unchanged (loudness becomes pure brightness there).
    let heat = smoothstep(P_gradStart(), P_gradEnd(), slice);
    let cellHue = mix(mix(P_hueLow(), P_hueHigh(), heat), freqHue, P_spectrumColor())
                + P_hueShift() + jHue * 6.0 * pv;
    let lit2 = smoothstep(0.02, 0.1, slice);
    // Older slices dim toward the exit edge — depth cue for the scroll.
    let ageFade = 1.0 - P_histFade() * (rowFromEntry / max(rows - 1.0, 1.0));

    // Quiet cells sit at the unlit floor, exactly like dark bar cells.
    col += presetColor(cellHue, 0.5, 0.04) * mask * P_dim() * (1.0 - lit2);

    // Lit cells: brightness follows the slice, the top-cell boost becomes a
    // loudest-slice boost, and the whole record still pumps with the beat.
    let hot = P_litLevel() * (0.4 + 0.6 * heat) + P_hotBoost() * smoothstep(0.78, 1.0, slice)
            + beatP * P_beatBoost();
    let litBright = hot * mix(1.0, panelFalloff * (0.82 + jBright * 0.36), pv) * ageFade;
    var ledCol = presetColor(cellHue, 0.9 - jSat * 0.15 * pv, litBright) * mask * lit2;
    ledCol += presetColor(cellHue, 0.75, 0.62) * glow * lit2 * P_bloom() * (0.25 + slice * 0.75)
            * (0.6 + jBright * 0.5 * pv) * ageFade;
    // Hot-core desaturation on genuinely loud slices, same trick as the bars.
    let veryHot = smoothstep(0.85, 1.05, slice) * lit2;
    ledCol = mix(ledCol, presetRgb(vec3f(1.0, 0.98, 0.92)), veryHot * 0.55 * mask);
    ledCol *= 1.0 + veryHot * 0.6;
    col += ledCol;
  }

  // Beat border flash: the wall's outer frame pulses on the tempo grid — a
  // whole-panel beat response distinct from the per-LED beat boost.
  let bdist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  let border = smoothstep(0.07, 0.0, bdist);
  col += presetColor(P_hueHigh() + P_hueShift(), 0.85, 0.5) * border * beatP * P_beatFlash();

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
  return vec4f(max(col, vec3f(0.0)), dataA);
}
`,
};
