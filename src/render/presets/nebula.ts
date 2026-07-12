import type { PresetDef } from "../types";

/**
 * Flowing fbm-noise nebula with optional kaleidoscope fold. Bass drives
 * brightness, mids shift color, treble adds sparkle grain; beats launch a
 * ripple ring from the center.
 */
export const nebula: PresetDef = {
  id: "nebula",
  name: "Kaleido Nebula",
  description: "Flowing cosmic clouds in a kaleidoscope — bass lights them up, beats send a ripple wave.",
  styles: [
    { id: "magenta", name: "Magenta Storm", values: {} },
    { id: "aurora", name: "Aurora", values: { hue: 140, kaleido: 0, flow: 0.2, hueRange: 60 } },
    { id: "ink", name: "Ink", values: { hue: 220, contrast: 0.8, sparkle: 0.2, saturation: 0.45 } },
    { id: "prism", name: "Prism Eight", values: { kaleido: 8, hueRange: 240, sparkle: 0.7 } },
  ],
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 300, hint: "Base cloud color" },
    { key: "scale", label: "Scale", min: 0.8, max: 6, step: 0.1, default: 2.4, hint: "Cloud size — low = big billows, high = fine detail" },
    { key: "flow", label: "Flow speed", min: 0, max: 0.6, step: 0.01, default: 0.12, hint: "How fast the clouds drift and churn" },
    { key: "kaleido", label: "Kaleido", min: 0, max: 12, step: 1, default: 6, hint: "Mirror segments — 0 = natural clouds, higher = mandala" },
    { key: "contrast", label: "Contrast", min: 0, max: 1, step: 0.01, default: 0.5, hint: "Sharpness between bright clouds and dark gaps" },
    { key: "sparkle", label: "Sparkle", min: 0, max: 1, step: 0.01, default: 0.5, hint: "Tiny glints driven by treble (hi-hats, cymbals)" },
    { key: "beatRipple", label: "Beat ripple", min: 0, max: 1, step: 0.01, default: 0.6, hint: "A distortion ring expands from center on every beat" },
  ],
  advanced: [
    { key: "warp", label: "Domain warp", min: 0, max: 4, step: 0.1, default: 1.8, hint: "How much the clouds fold into themselves" },
    { key: "hueRange", label: "Hue range", min: 0, max: 300, step: 5, default: 110, hint: "Color span across cloud density" },
    { key: "midHueShift", label: "Mid hue shift", min: 0, max: 200, step: 5, default: 70, hint: "Melody/mids push the colors around the wheel" },
    { key: "brightFloor", label: "Brightness floor", min: 0, max: 0.6, step: 0.01, default: 0.22, hint: "Cloud brightness in silence" },
    { key: "bassBright", label: "Bass brighten", min: 0, max: 1, step: 0.02, default: 0.45, hint: "How much bass lights the clouds" },
    { key: "saturation", label: "Saturation", min: 0, max: 1, step: 0.02, default: 0.75, hint: "Color intensity — 0 = grayscale" },
    { key: "sparkleScale", label: "Sparkle scale", min: 2, max: 30, step: 1, default: 9, hint: "Size of the treble glints" },
    { key: "sparkleSharp", label: "Sparkle sharpness", min: 4, max: 40, step: 1, default: 18, hint: "Higher = fewer, more pin-point glints" },
    { key: "rippleWidth", label: "Ripple width", min: 4, max: 40, step: 1, default: 16, hint: "Thickness of the beat ripple ring" },
    { key: "rippleWarp", label: "Ripple distortion", min: 0, max: 0.3, step: 0.01, default: 0.09, hint: "How strongly the ripple bends the clouds" },
    { key: "beatBloom", label: "Beat bloom", min: 0, max: 0.6, step: 0.02, default: 0.18, hint: "Center brightness flash on beats" },
    { key: "vignette", label: "Vignette", min: 0, max: 1, step: 0.05, default: 0.35, hint: "Darkening toward the screen corners" },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  var p = centered(uv);

  // Kaleidoscope fold
  if (P_kaleido() >= 2.0) {
    let r = length(p);
    var ang = atan2(p.y, p.x) + u.time * P_flow() * 0.5;
    let seg = TAU / P_kaleido();
    ang = abs(fract(ang / seg + 10.0) - 0.5) * seg;
    p = vec2f(cos(ang), sin(ang)) * r;
  }

  // Beat ripple: a distortion ring expands from center as beatIntensity
  // decays (1 -> 0 maps to radius 0 -> edge). Makes the sync unmistakable
  // without changing the nebula's character between beats.
  let rp = length(p);
  if (u.beatIntensity > 0.01 && rp > 1e-4) {
    let rippleR = (1.0 - u.beatIntensity) * 1.1;
    let wave = exp(-abs(rp - rippleR) * P_rippleWidth()) * u.beatIntensity * P_beatRipple();
    p += (p / rp) * wave * P_rippleWarp();
  }

  let q = p * P_scale();
  let t = u.time * P_flow();

  // Domain-warped fbm
  let warp = fbm(q + vec2f(t, -t * 0.7));
  let n = fbm(q + vec2f(warp * P_warp()) + vec2f(-t * 0.5, t * 0.9));

  // Contrast shaping; bass lifts the floor
  let sharp = 1.0 + P_contrast() * 3.0;
  let v = pow(clamp(n, 0.0, 1.0), sharp);

  let nebHue = P_hue() + n * P_hueRange() + u.mid * P_midHueShift();
  var col = hsl2rgb(nebHue, P_saturation(), v * (P_brightFloor() + u.bass * P_bassBright()) + 0.02);

  // Treble sparkle grain
  let g = pow(noise2(q * P_sparkleScale() + vec2f(t * 6.0, -t * 4.0)), P_sparkleSharp());
  col += vec3f(1.0, 0.95, 0.9) * g * u.treble * P_sparkle() * 2.0;

  // Beat bloom from center + bright rim tracing the ripple front
  let r2 = length(p);
  col += hsl2rgb(P_hue(), 0.8, 0.55) * u.beatIntensity * P_beatBloom() * exp(-r2 * 3.0);
  if (u.beatIntensity > 0.01) {
    let rippleR2 = (1.0 - u.beatIntensity) * 1.1;
    let rim = exp(-abs(rp - rippleR2) * 20.0) * u.beatIntensity * P_beatRipple();
    col += hsl2rgb(P_hue() + 40.0, 0.7, 0.6) * rim * 0.5;
  }

  col *= 1.0 - dot(p, p) * P_vignette();
  return vec4f(col, 1.0);
}
`,
};
