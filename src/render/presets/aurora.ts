import type { PresetDef } from "../types";

/**
 * Aurora — layered curtains of light that waver on an fbm flow, brightened by
 * the spectrum and the selected sync source, with vertical ray texture and an
 * optional starfield. Green-to-violet northern-lights look over a dark sky.
 */
export const aurora: PresetDef = {
  id: "aurora",
  name: "Aurora",
  description:
    "Northern-lights curtains that ripple and glow with the music — slow, ambient, and hypnotic. Reacts to the chosen sync source.",
  styles: [
    { id: "boreal", name: "Boreal", values: {} },
    { id: "magenta", name: "Magenta", values: { hue: 300, hueStep: 40, hueSpread: 60 } },
    {
      id: "ember",
      name: "Ember",
      values: { hue: 20, hueStep: 25, hueSpread: 40, bright: 1.2, sat: 0.9 },
    },
    { id: "ice", name: "Ice", values: { hue: 180, hueStep: 30, hueSpread: 50, thick: 0.16 } },
    {
      id: "cosmic",
      name: "Cosmic",
      values: { hue: 260, hueStep: 60, stars: 1, bgGlow: 0.6, react: 1.2, beatPulse: 0.7 },
    },
    {
      id: "solarStorm",
      name: "Solar Storm",
      values: {
        hue: 95,
        bright: 1.4,
        react: 1.8,
        flow: 2.5,
        wave: 1.8,
        beatPulse: 1.3,
        specAmt: 2.4,
        hueStep: 70,
        rays: 0.9,
      },
    },
    {
      id: "paleDawn",
      name: "Pale Dawn",
      values: {
        hue: 330,
        bright: 0.7,
        react: 0.3,
        flow: 0.4,
        thick: 0.22,
        baseY: 0.35,
        layers: 2,
        beatPulse: 0.1,
        wave: 0.5,
        rays: 0.2,
        sat: 0.36,
        bgGlow: 0.5,
      },
    },
  ],
  params: [
    {
      key: "hue",
      label: "Hue",
      min: 0,
      max: 360,
      step: 1,
      default: 140,
      hint: "Base curtain color",
    },
    {
      key: "bright",
      label: "Brightness",
      min: 0.2,
      max: 2,
      step: 0.05,
      default: 1,
      hint: "Overall glow of the curtains",
    },
    {
      key: "react",
      label: "Reactivity",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.8,
      hint: "How much the sync source (Sync panel) drives the glow — 0 = steady",
    },
    {
      key: "flow",
      label: "Flow",
      min: 0,
      max: 3,
      step: 0.05,
      default: 1,
      hint: "How fast the curtains waver",
    },
    {
      key: "thick",
      label: "Thickness",
      min: 0.04,
      max: 0.3,
      step: 0.01,
      default: 0.12,
      hint: "Vertical thickness of each curtain",
    },
    {
      key: "baseY",
      label: "Height",
      min: 0.2,
      max: 0.8,
      step: 0.01,
      default: 0.5,
      hint: "Where the curtains hang on screen",
    },
  ],
  advanced: [
    {
      key: "layers",
      label: "Curtains",
      min: 1,
      max: 3,
      step: 1,
      default: 3,
      hint: "Number of stacked curtains",
    },
    {
      key: "specAmt",
      label: "Spectrum shape",
      min: 0,
      max: 3,
      step: 0.05,
      default: 1.6,
      hint: "How strongly the spectrum sculpts the curtain brightness across the width",
    },
    {
      key: "beatPulse",
      label: "Beat pulse",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.4,
      hint: "Flash/expand on each detected beat of the sync source",
    },
    {
      key: "wave",
      label: "Waviness",
      min: 0,
      max: 2,
      step: 0.05,
      default: 1,
      hint: "How much the curtains undulate",
    },
    {
      key: "hueStep",
      label: "Hue step",
      min: 0,
      max: 120,
      step: 5,
      default: 55,
      hint: "Color shift between curtains",
    },
    {
      key: "hueSpread",
      label: "Hue spread",
      min: 0,
      max: 220,
      step: 5,
      default: 60,
      hint: "Color drift across the width",
    },
    {
      key: "rays",
      label: "Rays",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.6,
      hint: "Vertical ray shimmer texture",
    },
    {
      key: "sat",
      label: "Saturation",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.8,
      hint: "Color saturation",
    },
    {
      key: "stars",
      label: "Stars",
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      hint: "Twinkling starfield behind the curtains",
    },
    {
      key: "bgGlow",
      label: "Sky glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.25,
      hint: "Soft glow rising from the horizon",
    },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  var col = vec3f(0.0);
  let x = uv.x;
  let y = uv.y;

  // Optional starfield behind everything (small round points, twinkling).
  if (P_stars() > 0.5) {
    let gp = vec2f(x * u.aspect, y) * 54.0;
    let cell = floor(gp);
    let h = hash21(cell);
    if (h > 0.972) {
      let sp = vec2f(hash21(cell + 0.37), hash21(cell + 0.71));
      let star = smoothstep(0.13, 0.0, length(gp - cell - sp));
      let tw = 0.5 + 0.5 * sin(u.time * (1.0 + h * 6.0) + h * 40.0);
      col += vec3f(0.7, 0.82, 1.0) * star * (h - 0.972) * 20.0 * tw * (1.0 - y * 0.4);
    }
  }

  // Sync-reactive envelope + beat pulse: switching the sync source (bass /
  // treble / kicks / ...) visibly changes the drive here.
  let drive = clamp(u.drive, 0.0, 1.5);
  let pulse = 1.0 + u.driveBeat * P_beatPulse() * u.pulse;
  let layers = i32(P_layers());
  for (var i = 0; i < 3; i++) {
    if (i >= layers) { break; }
    let fi = f32(i);
    // Non-wrapping spectrum window per curtain (clamp, never fract) so there is
    // no hard seam where the sample index would roll over.
    let sx = clamp(x * 0.82 + fi * 0.09, 0.0, 1.0);
    let spec = binAt(sx);
    // Wavy vertical center of the curtain.
    let wob = fbm(vec2f(x * (2.0 + fi) + fi * 7.0, u.time * P_flow() * 0.15 + fi * 3.0));
    let cy = P_baseY() + 0.15 * fi + (wob - 0.5) * 0.35 * P_wave();
    let react = 0.32 + spec * P_specAmt() + drive * P_react();
    let thick = P_thick() * (0.55 + react * 0.9) * pulse;
    let d = (y - cy) / max(thick, 1e-3);
    let band = exp(-d * d);
    let ray = 1.0 - P_rays()
            + P_rays() * (0.5 + 0.5 * sin(x * (60.0 + fi * 30.0) + fbm(vec2f(x * 8.0, u.time * 0.2)) * 8.0));
    let hue = P_hue() + fi * P_hueStep() + (x - 0.5) * P_hueSpread() + spec * 26.0;
    col += hsl2rgb(hue, P_sat(), 0.55) * band * ray * react * pulse * P_bright();
  }

  // Soft sky glow rising from the horizon, lifted by the sync source.
  col += hsl2rgb(P_hue() + P_hueStep(), P_sat() * 0.8, 0.5)
       * smoothstep(0.0, 0.55, y) * P_bgGlow() * (0.3 + drive * 0.6) * 0.35;
  return vec4f(col, 1.0);
}
`,
};
