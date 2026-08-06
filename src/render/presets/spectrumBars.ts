import type { PresetDef } from "../types";
import { WGSL_COLOR_CONTROLS } from "../wgslLib";

/**
 * Log-spectrum bars with glow, peak caps, beat-driven background pulse and
 * vignette. Pure fragment-shader preset — the whole screen is computed from
 * features + params, milkdrop-style.
 */
export const spectrumBars: PresetDef = {
  id: "spectrum-bars",
  name: "Spectrum Bars",
  description:
    "Classic frequency bars: bass left, treble right, each bar the loudness of its band.",
  styles: [
    // Classic — the defaults — balanced neon bars with peak caps.
    { id: "classic", name: "Classic", values: {} },
    // Ember Wall — no gap, near-max height: one solid slab of light, caps off.
    {
      id: "emberWall",
      name: "Ember Wall",
      values: {
        hue: 14,
        hueSpread: 45,
        barGap: 0.02,
        glow: 0.18,
        glowReach: 4,
        peaks: 0,
        barSat: 0.95,
        barLift: 0.5,
        barHeight: 0.9,
        bgLevel: 0.02,
        bgBassGlow: 0.03,
        beatBright: 0.16,
        beatZoom: 0.02,
        vignette: 0.85,
      },
    },
    // Hairline — editorial. Thin desaturated ticks, wide air, caps carry the reading.
    {
      id: "hairline",
      name: "Hairline",
      values: {
        hue: 268,
        hueSpread: 25,
        barGap: 0.56,
        glow: 0.05,
        glowReach: 2.5,
        barSat: 0.22,
        barLift: 0.52,
        barHeight: 0.6,
        capBright: 1.3,
        bgLevel: 0.005,
        bgBassGlow: 0.01,
        beatFlash: 0,
        beatBright: 0.02,
        beatZoom: 0,
        vignette: 0.2,
      },
    },
    // Neon Mirror — mirrored (bass centred) and glow-dominant — the club poster.
    {
      id: "neonMirror",
      name: "Neon Mirror",
      values: {
        mirror: 1,
        hue: 305,
        hueSpread: 165,
        glow: 0.95,
        glowReach: 13.5,
        barGap: 0.34,
        barSat: 0.9,
        barLift: 0.18,
        barHeight: 0.68,
        capBright: 0.35,
        bgLevel: 0.07,
        bgBassGlow: 0.15,
        beatFlash: 0.2,
        beatZoom: 0.09,
        vignette: 0.65,
      },
    },
    // Skyline — mirrored, gapless, tallest bars, no caps: a city profile, not a meter.
    {
      id: "skyline",
      name: "Skyline",
      values: {
        mirror: 1,
        hue: 212,
        hueSpread: 48,
        barGap: 0.05,
        barHeight: 0.92,
        barLift: 0.58,
        barSat: 0.55,
        glow: 0.28,
        glowReach: 6.5,
        peaks: 0,
        bgLevel: 0.025,
        bgBassGlow: 0.1,
        beatZoom: 0.035,
        vignette: 0.95,
      },
    },
    // Broadcast — a grey studio ladder; every audio reaction off but the level itself.
    {
      id: "broadcast",
      name: "Broadcast",
      values: {
        hue: 130,
        hueSpread: 0,
        barGap: 0.28,
        glow: 0.08,
        glowReach: 3,
        barSat: 0.1,
        barLift: 0.46,
        capBright: 1.5,
        barHeight: 0.8,
        bgLevel: 0.015,
        bgBassGlow: 0,
        beatFlash: 0,
        beatBright: 0,
        beatZoom: 0,
        vignette: 0.4,
      },
    },
    // Slow Burn — short bars under a full-reach glow — the light, not the bars, is the subject.
    {
      id: "slowBurn",
      name: "Slow Burn",
      values: {
        hue: 190,
        hueSpread: 100,
        glow: 0.9,
        glowReach: 8,
        barHeight: 0.55,
        barGap: 0.44,
        barSat: 0.75,
        barLift: 0.3,
        peaks: 0,
        bgLevel: 0.035,
        bgBassGlow: 0.08,
        beatFlash: 0.24,
        beatBright: 0.12,
        beatZoom: 0.015,
        vignette: 0.4,
      },
    },
    // Pulse Room — everything beat-driven: max beat zoom, flash and bar lift.
    {
      id: "pulseRoom",
      name: "Pulse Room",
      values: {
        hue: 340,
        hueSpread: 90,
        barGap: 0.18,
        glow: 0.6,
        glowReach: 9,
        barSat: 0.88,
        barLift: 0.3,
        barHeight: 0.75,
        capBright: 0.6,
        bgLevel: 0.1,
        bgBassGlow: 0.18,
        beatZoom: 0.15,
        beatFlash: 0.34,
        beatBright: 0.26,
        vignette: 0.5,
      },
    },
  ],
  params: [
    {
      key: "hue",
      label: "Hue",
      group: "color",
      control: "hue",
      min: 0,
      max: 360,
      step: 1,
      default: 210,
      hint: "Base color of the bars (0–360 on the color wheel)",
    },
    {
      key: "hueSpread",
      label: "Hue spread",
      group: "color",
      min: 0,
      max: 180,
      step: 1,
      default: 80,
      hint: "Color range across the bars — 0 = single color, high = rainbow left to right",
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
      key: "glow",
      label: "Glow",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.45,
      hint: "Neon light bleeding upward from each bar's tip",
    },
    {
      key: "barGap",
      label: "Bar gap",
      group: "shape",
      min: 0,
      max: 0.6,
      step: 0.01,
      default: 0.22,
      hint: "Empty space between neighboring bars",
    },
    {
      key: "beatZoom",
      label: "Beat zoom",
      group: "reaction",
      min: 0,
      max: 0.15,
      step: 0.005,
      default: 0.05,
      hint: "Whole image zooms in slightly on every beat",
    },
    {
      key: "mirror",
      label: "Mirror",
      group: "shape",
      control: "toggle",
      mod: "off",
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      hint: "Mirror the spectrum around the center — bass in the middle",
    },
    {
      key: "peaks",
      label: "Peak caps",
      group: "shape",
      control: "toggle",
      mod: "off",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Floating white markers that hold each bar's recent maximum",
    },
  ],
  advanced: [
    {
      key: "barHeight",
      label: "Bar height",
      group: "shape",
      min: 0.3,
      max: 0.92,
      step: 0.01,
      default: 0.82,
      hint: "Maximum height a bar can reach (fraction of screen; leaves room for the peak caps)",
    },
    {
      key: "barSat",
      label: "Bar saturation",
      group: "color",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.85,
      hint: "Color intensity of bars — 0 = grayscale, 1 = vivid",
    },
    {
      key: "barLift",
      label: "Bar gradient",
      group: "glow",
      min: 0,
      max: 0.6,
      step: 0.01,
      default: 0.35,
      hint: "How much brighter bars get toward their tip",
    },
    {
      key: "glowReach",
      label: "Glow reach",
      group: "glow",
      min: 2,
      max: 14,
      step: 0.5,
      default: 10,
      hint: "How far the tip glow extends before fading",
    },
    {
      key: "capBright",
      label: "Cap brightness",
      group: "glow",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.9,
      hint: "Brightness of the peak-hold markers",
    },
    {
      key: "bgLevel",
      label: "Bg level",
      group: "backdrop",
      min: 0,
      max: 0.2,
      step: 0.005,
      default: 0.05,
      hint: "Brightness of the background wash behind the bars",
    },
    {
      key: "bgBassGlow",
      label: "Bg bass glow",
      group: "backdrop",
      min: 0,
      max: 0.2,
      step: 0.005,
      default: 0.05,
      hint: "Background breathes brighter with bass energy",
    },
    {
      key: "beatFlash",
      label: "Beat flash",
      group: "reaction",
      min: 0,
      max: 0.4,
      step: 0.01,
      default: 0.08,
      hint: "Background flash added on every beat",
    },
    {
      key: "beatBright",
      label: "Beat brighten",
      group: "reaction",
      min: 0,
      max: 0.3,
      step: 0.01,
      default: 0.08,
      hint: "Bars themselves brighten on beats",
    },
    {
      key: "vignette",
      label: "Vignette",
      group: "backdrop",
      min: 0,
      max: 1.2,
      step: 0.05,
      default: 0.55,
      hint: "Darkening toward the screen corners",
    },
  ],
  wgsl: /* wgsl */ `
${WGSL_COLOR_CONTROLS}

fn preset(uvIn: vec2f) -> vec4f {
  // Beat zoom: scale around center (Motion→Pulse master scales it)
  var uv = (uvIn - 0.5) / (1.0 + u.driveBeat * P_beatZoom() * u.pulse) + 0.5;

  // Optional mirror around center column
  var x = uv.x;
  if (P_mirror() > 0.5) { x = abs(uv.x - 0.5) * 2.0; }

  // Bar count: Motion→Detail scales from a coarse minimum up to the full bin
  // count. Each bar resamples the spectrum at its center so fewer bars still
  // span the whole range. detail=1 -> binCount, identical to raw bins.
  let n = round(mix(8.0, f32(u.binCount), u.detail));
  let fi = clamp(x * n, 0.0, n - 0.001);
  let i = u32(fi);
  let inBar = fract(fi);
  let barCenter = (f32(i) + 0.5) / n;
  var v = binAt(barCenter);
  var pk = peakAt(barCenter);
  if (u.smoothBins > 0.5) {
    // Smooth mode: continuous spline silhouette instead of discrete bars
    v = binAt(x);
    pk = peakAt(x);
  }

  // Background: dark radial wash breathing with bass + beat flash
  let d = distance(uv, vec2f(0.5, 0.55));
  let bgHue = P_hue() + 40.0;
  var col = presetColor(bgHue, 0.5, P_bgLevel() + u.bass * P_bgBassGlow()) * (1.0 - d * 0.9);
  col += presetColor(P_hue(), 0.7, 0.5) * u.driveBeat * P_beatFlash() * (1.0 - d);

  let y = 1.0 - uv.y; // bars grow from bottom
  let barH = v * P_barHeight();
  var gapMask = step(P_barGap() * 0.5, inBar) * step(inBar, 1.0 - P_barGap() * 0.5);
  if (u.smoothBins > 0.5) { gapMask = 1.0; }
  let barHue = P_hue() + (fi / n) * P_hueSpread();

  // Bar body with vertical gradient
  if (y < barH) {
    let g = y / max(barH, 0.001);
    col = presetColor(barHue, P_barSat(), 0.35 + g * P_barLift() + u.driveBeat * P_beatBright()) * gapMask
        + col * (1.0 - gapMask);
  } else {
    // Glow above the bar
    let fall = exp(-(y - barH) * (14.0 - P_glow() * P_glowReach()));
    col += presetColor(barHue, 0.9, 0.5) * fall * P_glow() * v * gapMask;
  }

  // Peak caps (toggleable)
  let capD = abs(y - pk * P_barHeight());
  col += presetColor(barHue, 0.3, 0.9) * smoothstep(0.006, 0.0, capD) * gapMask * P_capBright()
       * step(0.5, P_peaks());

  // Vignette
  col *= 1.0 - d * d * P_vignette();
  return vec4f(col, 1.0);
}
`,
};
