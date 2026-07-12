import type { PresetDef } from "../types";

/**
 * Log-spectrum bars with glow, peak caps, beat-driven background pulse and
 * vignette. Pure fragment-shader preset — the whole screen is computed from
 * features + params, milkdrop-style.
 */
export const spectrumBars: PresetDef = {
  id: "spectrum-bars",
  name: "Spectrum Bars",
  description: "Classic frequency bars: bass left, treble right, each bar the loudness of its band.",
  styles: [
    { id: "classic", name: "Classic", values: {} },
    { id: "sunset", name: "Sunset", values: { hue: 12, hueSpread: 55, glow: 0.6 } },
    { id: "ice", name: "Ice Mono", values: { hue: 200, hueSpread: 0, glow: 0.3, barSat: 0.55 } },
    { id: "club", name: "Club Mirror", values: { mirror: 1, beatZoom: 0.09, glow: 0.7, hueSpread: 140 } },
  ],
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 210, hint: "Base color of the bars (0–360 on the color wheel)" },
    { key: "hueSpread", label: "Hue spread", min: 0, max: 180, step: 1, default: 80, hint: "Color range across the bars — 0 = single color, high = rainbow left to right" },
    { key: "glow", label: "Glow", min: 0, max: 1, step: 0.01, default: 0.45, hint: "Neon light bleeding upward from each bar's tip" },
    { key: "barGap", label: "Bar gap", min: 0, max: 0.6, step: 0.01, default: 0.22, hint: "Empty space between neighboring bars" },
    { key: "beatZoom", label: "Beat zoom", min: 0, max: 0.15, step: 0.005, default: 0.05, hint: "Whole image zooms in slightly on every beat" },
    { key: "mirror", label: "Mirror", min: 0, max: 1, step: 1, default: 0, hint: "Mirror the spectrum around the center — bass in the middle" },
    { key: "peaks", label: "Peak caps", min: 0, max: 1, step: 1, default: 1, hint: "Floating white markers that hold each bar's recent maximum" },
  ],
  advanced: [
    { key: "barHeight", label: "Bar height", min: 0.3, max: 1, step: 0.01, default: 0.92, hint: "Maximum height a bar can reach (fraction of screen)" },
    { key: "barSat", label: "Bar saturation", min: 0, max: 1, step: 0.01, default: 0.85, hint: "Color intensity of bars — 0 = grayscale, 1 = vivid" },
    { key: "barLift", label: "Bar gradient", min: 0, max: 0.6, step: 0.01, default: 0.35, hint: "How much brighter bars get toward their tip" },
    { key: "glowReach", label: "Glow reach", min: 2, max: 14, step: 0.5, default: 10, hint: "How far the tip glow extends before fading" },
    { key: "capBright", label: "Cap brightness", min: 0, max: 1.5, step: 0.05, default: 0.9, hint: "Brightness of the peak-hold markers" },
    { key: "bgLevel", label: "Bg level", min: 0, max: 0.2, step: 0.005, default: 0.05, hint: "Brightness of the background wash behind the bars" },
    { key: "bgBassGlow", label: "Bg bass glow", min: 0, max: 0.2, step: 0.005, default: 0.05, hint: "Background breathes brighter with bass energy" },
    { key: "beatFlash", label: "Beat flash", min: 0, max: 0.4, step: 0.01, default: 0.08, hint: "Background flash added on every beat" },
    { key: "beatBright", label: "Beat brighten", min: 0, max: 0.3, step: 0.01, default: 0.08, hint: "Bars themselves brighten on beats" },
    { key: "vignette", label: "Vignette", min: 0, max: 1.2, step: 0.05, default: 0.55, hint: "Darkening toward the screen corners" },
  ],
  wgsl: /* wgsl */ `
fn preset(uvIn: vec2f) -> vec4f {
  // Beat zoom: scale around center
  var uv = (uvIn - 0.5) / (1.0 + u.beatIntensity * P_beatZoom()) + 0.5;

  // Optional mirror around center column
  var x = uv.x;
  if (P_mirror() > 0.5) { x = abs(uv.x - 0.5) * 2.0; }

  let n = f32(u.binCount);
  let fi = clamp(x * n, 0.0, n - 0.001);
  let i = u32(fi);
  let inBar = fract(fi);
  let v = bins[i];
  let pk = peaks[i];

  // Background: dark radial wash breathing with bass + beat flash
  let d = distance(uv, vec2f(0.5, 0.55));
  let bgHue = P_hue() + 40.0;
  var col = hsl2rgb(bgHue, 0.5, P_bgLevel() + u.bass * P_bgBassGlow()) * (1.0 - d * 0.9);
  col += hsl2rgb(P_hue(), 0.7, 0.5) * u.beatIntensity * P_beatFlash() * (1.0 - d);

  let y = 1.0 - uv.y; // bars grow from bottom
  let barH = v * P_barHeight();
  let gapMask = step(P_barGap() * 0.5, inBar) * step(inBar, 1.0 - P_barGap() * 0.5);
  let barHue = P_hue() + (fi / n) * P_hueSpread();

  // Bar body with vertical gradient
  if (y < barH) {
    let g = y / max(barH, 0.001);
    col = hsl2rgb(barHue, P_barSat(), 0.35 + g * P_barLift() + u.beatIntensity * P_beatBright()) * gapMask
        + col * (1.0 - gapMask);
  } else {
    // Glow above the bar
    let fall = exp(-(y - barH) * (14.0 - P_glow() * P_glowReach()));
    col += hsl2rgb(barHue, 0.9, 0.5) * fall * P_glow() * v * gapMask;
  }

  // Peak caps (toggleable)
  let capD = abs(y - pk * P_barHeight());
  col += hsl2rgb(barHue, 0.3, 0.9) * smoothstep(0.006, 0.0, capD) * gapMask * P_capBright()
       * step(0.5, P_peaks());

  // Vignette
  col *= 1.0 - d * d * P_vignette();
  return vec4f(col, 1.0);
}
`,
};
