import type { PresetDef } from "../types";
import { WGSL_COLOR_CONTROLS } from "../wgslLib";

/**
 * Log-spectrum bars with glow, peak caps, beat-driven background pulse and
 * vignette. Pure fragment-shader preset — the whole screen is computed from
 * features + params, milkdrop-style.
 *
 * Depth wave (Track B): four new axes, every one absent at its default so the
 * factory frame is bit-identical to the pre-wave shader —
 *  - stereoSplit: each bar cracks into an L/R pair whose separation rides the
 *    track's stereo width (u.width — the first built-in to read that lane).
 *    Mono sources hold width at 0, so the pair melts back into one solid bar.
 *  - capShape: flat (today) / rounded crowns / rounded + LED-pip peak caps.
 *  - reflect(+reflectFade): lifts the baseline onto a wet stage floor that
 *    mirrors bars, glow and caps, dimming with depth (aurora's precedent).
 *  - sway: the whole wall leans on track time, anchored at the floor — scaled
 *    by u.spin so the Motion→Rotation master finally has a handle here.
 *  - freqLo/freqHi (advanced): trim dead spectrum edges off the drawn span.
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
    // Stereo Field — the width axis made the subject: every bar is an L/R pair
    // that cracks apart when the mix opens up, cyan sweeping to violet.
    {
      id: "stereoField",
      name: "Stereo Field",
      values: {
        hue: 190,
        hueSpread: 130,
        stereoSplit: 1,
        barGap: 0.26,
        barHeight: 0.78,
        barSat: 0.8,
        glow: 0.55,
        glowReach: 8,
        beatZoom: 0.03,
        vignette: 0.5,
      },
    },
    // Night Stage — the reflection floor as a venue: rounded bars on a wet
    // black stage under a purple wash, the rig leaning almost imperceptibly.
    {
      id: "nightStage",
      name: "Night Stage",
      values: {
        hue: 275,
        hueSpread: 45,
        reflect: 0.85,
        reflectFade: 3,
        capShape: 1,
        sway: 0.12,
        barGap: 0.3,
        barHeight: 0.62,
        barLift: 0.45,
        glow: 0.6,
        glowReach: 9,
        bgLevel: 0.03,
        bgBassGlow: 0.08,
        beatBright: 0.12,
        vignette: 0.8,
      },
    },
    // Hi-Fi — the amber VFD deck: dot peak caps, trimmed span, no strobe —
    // the hardware meter of the WMP era.
    {
      id: "hiFi",
      name: "Hi-Fi",
      values: {
        hue: 38,
        hueSpread: 0,
        capShape: 2,
        barGap: 0.34,
        barHeight: 0.7,
        barSat: 0.6,
        barLift: 0.5,
        glow: 0.12,
        glowReach: 3,
        capBright: 1.2,
        bgLevel: 0.01,
        bgBassGlow: 0.01,
        beatFlash: 0,
        beatBright: 0.04,
        beatZoom: 0,
        vignette: 0.3,
        freqLo: 0.06,
        freqHi: 0.94,
      },
    },
    // Undertow — the sway lens leading: a tall teal wall leaning in slow
    // water over a faint pool, caps off.
    {
      id: "undertow",
      name: "Undertow",
      values: {
        hue: 185,
        hueSpread: 30,
        sway: 0.8,
        reflect: 0.4,
        reflectFade: 2,
        barGap: 0.1,
        barHeight: 0.88,
        barLift: 0.5,
        glow: 0.35,
        peaks: 0,
        bgLevel: 0.03,
        bgBassGlow: 0.12,
        beatZoom: 0.02,
        vignette: 0.9,
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
    {
      key: "stereoSplit",
      label: "Stereo split",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      hint: "Each bar cracks into a left/right pair as the mix widens — mono sources stay solid",
    },
    {
      key: "capShape",
      label: "Bar tops",
      group: "shape",
      control: "enum",
      mod: "off",
      min: 0,
      max: 2,
      step: 1,
      default: 0,
      options: [
        { value: 0, label: "Flat", hint: "Hard rectangular tops — the classic meter" },
        { value: 1, label: "Rounded", hint: "A soft dome crowns each bar" },
        {
          value: 2,
          label: "Dot caps",
          hint: "Rounded bars with a floating LED pip for each peak marker",
        },
      ],
      hint: "Shape of each bar's top — flat rectangle, rounded crown, or hi-fi dot caps",
    },
    {
      key: "reflect",
      label: "Reflection",
      group: "shape",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      hint: "Lifts the bars onto a dark floor that mirrors them — 0 is off",
    },
    {
      key: "sway",
      label: "Sway",
      group: "motion",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      hint: "Bars lean gently side to side over time, anchored at the floor",
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
      tier: "curated",
      min: 0,
      max: 1.2,
      step: 0.05,
      default: 0.55,
      hint: "Darkening toward the screen corners",
    },
    {
      key: "reflectFade",
      label: "Reflection fade",
      group: "shape",
      taper: "log",
      min: 1,
      max: 12,
      step: 0.5,
      default: 5,
      hint: "How quickly the mirrored bars dim with depth below the floor line",
    },
    {
      key: "freqLo",
      label: "Low trim",
      group: "shape",
      min: 0,
      max: 0.75,
      step: 0.01,
      default: 0,
      hint: "Cut the spectrum's low end so the bars start above the silent sub-bass",
    },
    {
      key: "freqHi",
      label: "High trim",
      group: "shape",
      min: 0.25,
      max: 1,
      step: 0.01,
      default: 1,
      hint: "Cut the spectrum's top end so the bars stop before the dead treble",
    },
  ],
  wgsl: /* wgsl */ `
${WGSL_COLOR_CONTROLS}

// Frequency trim: map a 0..1 screen position onto the trimmed span of the
// spectrum. At the defaults (low 0, high 1) every step is an IEEE identity —
// max(1, 0 + 0.05) = 1, then 0 + (1 - 0) * pos = 1 * pos = pos — so binAt/
// peakAt receive bit-identical positions and the untrimmed picture cannot move.
fn spanPos(pos: f32) -> f32 {
  let lo = P_freqLo();
  let hi = max(P_freqHi(), lo + 0.05);
  return lo + (hi - lo) * pos;
}

fn preset(uvIn: vec2f) -> vec4f {
  // Beat zoom: scale around center (Motion→Pulse master scales it)
  var uv = (uvIn - 0.5) / (1.0 + u.driveBeat * P_beatZoom() * u.pulse) + 0.5;

  // Sway (motion lens): the whole wall leans side to side on track time,
  // anchored at the bottom edge so the bases stay planted; u.spin gives the
  // Motion→Rotation master a handle. At the default the added term is an
  // exact IEEE zero (finite sin * 0 = ±0, and x + ±0 = x for every uv.x this
  // pipeline produces), so the default frame is bit-identical.
  uv.x += sin(u.time * 0.6) * P_sway() * u.spin * 0.06 * (1.0 - uv.y);

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
  var v = binAt(spanPos(barCenter));
  var pk = peakAt(spanPos(barCenter));
  if (u.smoothBins > 0.5) {
    // Smooth mode: continuous spline silhouette instead of discrete bars
    v = binAt(spanPos(x));
    pk = peakAt(spanPos(x));
  }

  // Background: dark radial wash breathing with bass + beat flash
  let d = distance(uv, vec2f(0.5, 0.55));
  let bgHue = P_hue() + 40.0;
  var col = presetColor(bgHue, 0.5, P_bgLevel() + u.bass * P_bgBassGlow()) * (1.0 - d * 0.9);
  col += presetColor(P_hue(), 0.7, 0.5) * u.driveBeat * P_beatFlash() * (1.0 - d);

  // Reflection floor: lifts the baseline so a mirror pool fits below it. At
  // the default the baseline stays on the screen edge — y - 0.0 is exact and
  // no pixel has y < 0, so the pool block below never runs.
  let base = P_reflect() * 0.24;
  let y = 1.0 - uv.y - base; // height above the (possibly lifted) baseline
  let barH = v * P_barHeight();

  // Stereo pair: a notch splits each bar into two posts whose separation
  // rides the track's stereo width (u.width — mono sources hold 0, melting
  // the pair back into one solid bar). At the default split the two step
  // edges coincide, the notch is exactly 0, and gapMask multiplies by 1.
  let sep = min(P_stereoSplit() * u.width * 0.35, 0.5 - P_barGap() * 0.5 - 0.03);
  let notch = step(0.5 - sep, inBar) - step(0.5 + sep, inBar);
  var gapMask = step(P_barGap() * 0.5, inBar) * step(inBar, 1.0 - P_barGap() * 0.5)
              * (1.0 - notch);
  if (u.smoothBins > 0.5) { gapMask = 1.0; }
  let barHue = P_hue() + (fi / n) * P_hueSpread();

  // Bar tops: 0 = flat (crown stays exactly 0.0, so topH = barH - 0.0 is
  // bit-exact), 1/2 = a semicircular crown sized to the bar's on-screen
  // width. Inert in smooth-spectrum mode, where there are no cells to crown.
  var crown = 0.0;
  if (P_capShape() > 0.5 && u.smoothBins < 0.5) {
    let cw = max((1.0 - P_barGap()) * 0.5, 0.001); // body half-width, cell units
    let cx = clamp((inBar - 0.5) / cw, -1.0, 1.0);
    let rad = (1.0 - P_barGap()) / n * u.aspect * 0.5; // half bar width, y units
    crown = (1.0 - sqrt(max(1.0 - cx * cx, 0.0))) * min(rad, barH);
  }
  let topH = barH - crown;

  // Bar body with vertical gradient (glow above it). The y >= 0.0 guards are
  // inert at the default: with base = 0 every pixel has y >= 0, so the
  // branches select exactly as the old if/else did.
  if (y >= 0.0 && y < topH) {
    let g = y / max(barH, 0.001);
    col = presetColor(barHue, P_barSat(), 0.35 + g * P_barLift() + u.driveBeat * P_beatBright()) * gapMask
        + col * (1.0 - gapMask);
  } else if (y >= 0.0) {
    // Glow above the bar
    let fall = exp(-(y - topH) * (14.0 - P_glow() * P_glowReach()));
    col += presetColor(barHue, 0.9, 0.5) * fall * P_glow() * v * gapMask;
  }

  // Peak caps (toggleable): a hairline across the bar, or floating LED pips
  // on Dot caps. step(0.0, y) keeps them out of the pool — a multiply by
  // exactly 1.0 while the baseline sits on the screen edge.
  let capY = pk * P_barHeight();
  let capD = abs(y - capY);
  var capM = smoothstep(0.006, 0.0, capD);
  if (P_capShape() > 1.5 && u.smoothBins < 0.5) {
    let px = abs(inBar - 0.5) / max((1.0 - P_barGap()) * 0.5, 0.001);
    capM = smoothstep(0.016, 0.004, capD) * smoothstep(1.0, 0.5, px);
  }
  col += presetColor(barHue, 0.3, 0.9) * capM * gapMask * P_capBright()
       * step(0.5, P_peaks()) * step(0.0, y);

  // Reflection pool: below the lifted baseline the bar field is re-evaluated
  // at the mirrored height and dimmed with depth — a wet stage floor, not a
  // second light source. Never entered at the default (no pixel has y < 0).
  if (P_reflect() > 0.001 && y < 0.0) {
    let ry = -y; // depth below the floor line
    let fadeR = exp(-ry / max(base, 0.001) * P_reflectFade());
    var rcol = vec3f(0.0);
    if (ry < topH) {
      let rg = ry / max(barH, 0.001);
      rcol = presetColor(barHue, P_barSat(), 0.35 + rg * P_barLift() + u.driveBeat * P_beatBright()) * gapMask;
    } else {
      let rfall = exp(-(ry - topH) * (14.0 - P_glow() * P_glowReach()));
      rcol = presetColor(barHue, 0.9, 0.5) * rfall * P_glow() * v * gapMask;
    }
    rcol += presetColor(barHue, 0.3, 0.9) * smoothstep(0.006, 0.0, abs(ry - capY)) * gapMask
          * P_capBright() * step(0.5, P_peaks());
    // The floor darkens a touch so the ghost reads as a surface sheen.
    col = col * (1.0 - P_reflect() * 0.3) + rcol * P_reflect() * fadeR * 0.6;
  }

  // Vignette
  col *= 1.0 - d * d * P_vignette();
  return vec4f(col, 1.0);
}
`,
};
