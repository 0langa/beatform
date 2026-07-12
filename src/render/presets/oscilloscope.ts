import type { PresetDef } from "../types";

/**
 * Time-domain oscilloscope: layered waveform traces with neon glow, layer
 * count and gain audio-reactive.
 */
export const oscilloscope: PresetDef = {
  id: "oscilloscope",
  name: "Oscilloscope",
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 130 },
    { key: "gain", label: "Gain", min: 0.2, max: 2.5, step: 0.05, default: 1.1 },
    { key: "thickness", label: "Thickness", min: 0.001, max: 0.02, step: 0.0005, default: 0.004 },
    { key: "glow", label: "Glow", min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: "layers", label: "Layers", min: 1, max: 4, step: 1, default: 3 },
    { key: "spread", label: "Layer spread", min: 0, max: 0.1, step: 0.002, default: 0.03 },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  let hue = param(0); let gain = param(1); let thickness = param(2);
  let glow = param(3); let layers = i32(param(4)); let spread = param(5);

  // Background: near-black with subtle scanline + bass tint
  var col = hsl2rgb(hue + 40.0, 0.5, 0.03 + u.bass * 0.03);
  col *= 0.9 + 0.1 * sin(uv.y * 400.0);

  // Faint center line
  col += hsl2rgb(hue, 0.3, 0.3) * smoothstep(0.002, 0.0, abs(uv.y - 0.5)) * 0.25;

  for (var i = 0; i < layers; i++) {
    let fi = f32(i);
    // Slight per-layer phase offset fakes a persistence trail
    let x = fract(uv.x + fi * 0.013);
    let w = waveAt(x) * gain * (1.0 - fi * 0.12);
    let y = 0.5 + w * 0.35 + (fi - f32(layers - 1) * 0.5) * spread * u.mid * 4.0;
    let d = abs(uv.y - y);
    let alpha = 1.0 / (fi + 1.0);
    let layerHue = hue + fi * 16.0 + w * 40.0;
    // Bright core + wide glow
    col += hsl2rgb(layerHue, 0.9, 0.6) * smoothstep(thickness, thickness * 0.2, d) * alpha;
    col += hsl2rgb(layerHue, 0.9, 0.5) * exp(-d * (90.0 - glow * 60.0)) * glow * 0.7 * alpha;
  }

  // Beat: whole-scope brightness lift
  col *= 1.0 + u.beatIntensity * 0.25;

  // Vignette
  let d2 = distance(uv, vec2f(0.5));
  col *= 1.0 - d2 * d2 * 0.6;
  return vec4f(col, 1.0);
}
`,
};
