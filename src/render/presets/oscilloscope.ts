import type { PresetDef } from "../types";

/**
 * Time-domain oscilloscope. The pipeline phase-aligns the waveform to a
 * rising zero-crossing (real-scope trigger), so the trace stands still
 * instead of flickering. "Calm" spatially smooths the trace; auto-gain rides
 * the slow energy envelope so loud passages don't blow up the display.
 */
export const oscilloscope: PresetDef = {
  id: "oscilloscope",
  name: "Oscilloscope",
  description: "The raw sound wave as a stable lab-scope trace, phase-locked so it stands still.",
  styles: [
    { id: "neon", name: "Neon Green", values: {} },
    { id: "amber", name: "Amber CRT", values: { hue: 40, scanline: 0.2, fill: 0, glow: 0.35 } },
    { id: "vapor", name: "Vapor", values: { hue: 290, glow: 0.8, hueWave: 60 } },
    { id: "clinical", name: "Clinical", values: { hue: 200, calm: 0.9, glow: 0.2, fill: 0, mirror: 0 } },
  ],
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 160, hint: "Color of the trace" },
    { key: "gain", label: "Gain", min: 0.2, max: 2, step: 0.05, default: 0.9, hint: "Wave height before auto-gain; higher = taller trace" },
    { key: "calm", label: "Calm", min: 0, max: 1, step: 0.01, default: 0.55, hint: "Smooths the trace — high = flowing curve, low = raw detail" },
    { key: "glow", label: "Glow", min: 0, max: 1, step: 0.01, default: 0.5, hint: "Neon halo around the trace line" },
    { key: "fill", label: "Fill", min: 0, max: 1, step: 1, default: 1, hint: "Soft fill between the trace and the center line" },
    { key: "mirror", label: "Mirror", min: 0, max: 1, step: 1, default: 1, hint: "Faint upside-down ghost copy of the trace" },
  ],
  advanced: [
    { key: "traceAmp", label: "Trace height", min: 0.1, max: 0.5, step: 0.01, default: 0.34, hint: "Screen fraction the wave can occupy" },
    { key: "traceClamp", label: "Height limit", min: 0.2, max: 0.5, step: 0.01, default: 0.44, hint: "Absolute ceiling — the trace never crosses this" },
    { key: "coreWidth", label: "Core width", min: 0.001, max: 0.01, step: 0.0005, default: 0.0035, hint: "Thickness of the bright center line" },
    { key: "agFloor", label: "Auto-gain floor", min: 0.1, max: 1, step: 0.05, default: 0.35, hint: "Lower = quiet parts get amplified more" },
    { key: "agRange", label: "Auto-gain range", min: 0, max: 3, step: 0.1, default: 1.4, hint: "How strongly loudness shrinks the display gain" },
    { key: "hueWave", label: "Hue by wave", min: 0, max: 80, step: 1, default: 24, hint: "Color shifts with the wave's height" },
    { key: "ghostDim", label: "Mirror ghost", min: 0, max: 1, step: 0.05, default: 0.35, hint: "Brightness of the mirrored ghost trace" },
    { key: "fillDim", label: "Fill strength", min: 0, max: 0.5, step: 0.01, default: 0.16, hint: "Opacity of the under-trace fill" },
    { key: "gridLevel", label: "Grid level", min: 0, max: 0.3, step: 0.01, default: 0.06, hint: "Visibility of the background grid" },
    { key: "scanline", label: "Scanlines", min: 0, max: 0.3, step: 0.01, default: 0.1, hint: "CRT-style horizontal line texture" },
    { key: "beatLift", label: "Beat lift", min: 0, max: 0.5, step: 0.01, default: 0.1, hint: "Whole scope brightens on beats" },
    { key: "bgLevel", label: "Bg level", min: 0, max: 0.12, step: 0.004, default: 0.028, hint: "Background brightness" },
    { key: "vignette", label: "Vignette", min: 0, max: 1.2, step: 0.05, default: 0.55, hint: "Darkening toward the screen corners" },
  ],
  wgsl: /* wgsl */ `
// Smoothed waveform sample: box blur over +/-4 taps scaled by calm
fn calmWave(x: f32, calm: f32) -> f32 {
  let spread = calm * 0.012;
  var s = waveAt(x) * 0.30;
  s += (waveAt(x - spread) + waveAt(x + spread)) * 0.22;
  s += (waveAt(x - spread * 2.0) + waveAt(x + spread * 2.0)) * 0.13;
  return s;
}

fn preset(uv: vec2f) -> vec4f {
  // Auto-gain: normalize display height against the slow envelope, so quiet
  // and loud passages fill a similar, stable portion of the screen.
  let gain = P_gain() / (P_agFloor() + u.energy * P_agRange());

  // Background: near-black, subtle bass tint, faint grid
  var col = hsl2rgb(P_hue() + 40.0, 0.4, P_bgLevel() + u.bass * 0.02);
  col *= (1.0 - P_scanline()) + P_scanline() * sin(uv.y * 400.0);
  let gx = smoothstep(0.004, 0.0, abs(fract(uv.x * 8.0) - 0.5) * 0.25);
  let gy = smoothstep(0.004, 0.0, abs(fract(uv.y * 6.0) - 0.5) * 0.25);
  col += hsl2rgb(P_hue(), 0.3, 0.25) * (gx + gy) * P_gridLevel();
  // Center line
  col += hsl2rgb(P_hue(), 0.3, 0.3) * smoothstep(0.0015, 0.0, abs(uv.y - 0.5)) * 0.3;

  let w = calmWave(uv.x, P_calm()) * gain;
  let amp = clamp(w * P_traceAmp(), -P_traceClamp(), P_traceClamp());
  let y = 0.5 + amp;

  // Main trace: crisp core + soft neon glow
  let d = abs(uv.y - y);
  let traceHue = P_hue() + w * P_hueWave();
  col += hsl2rgb(traceHue, 0.85, 0.62) * smoothstep(P_coreWidth(), P_coreWidth() * 0.23, d);
  col += hsl2rgb(traceHue, 0.9, 0.5) * exp(-d * (110.0 - P_glow() * 70.0)) * (0.35 + P_glow() * 0.55);

  // Mirrored ghost trace (dimmer, hue-shifted)
  if (P_mirror() > 0.5) {
    let ym = 0.5 - amp;
    let dm = abs(uv.y - ym);
    col += hsl2rgb(traceHue + 30.0, 0.7, 0.5) * exp(-dm * 160.0) * P_ghostDim();
  }

  // Soft fill from trace toward the center line
  if (P_fill() > 0.5) {
    let between = step(min(y, 0.5), uv.y) * step(uv.y, max(y, 0.5));
    let fade = 1.0 - abs(uv.y - 0.5) / max(abs(amp), 0.001);
    col += hsl2rgb(traceHue, 0.7, 0.4) * between * clamp(fade, 0.0, 1.0) * P_fillDim();
  }

  // Gentle beat lift (no strobe)
  col *= 1.0 + u.beatIntensity * P_beatLift();

  let d2 = distance(uv, vec2f(0.5));
  col *= 1.0 - d2 * d2 * P_vignette();
  return vec4f(col, 1.0);
}
`,
};
