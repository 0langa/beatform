import type { PresetDef } from "../types";

/**
 * Circular spectrum: bars radiate outward from a calm breathing core, with
 * optional rotational symmetry and beat-kicked rotation.
 */
export const radialBurst: PresetDef = {
  id: "radial-burst",
  name: "Radial Burst",
  description:
    "Spectrum bars radiating from a calm breathing core — bass near the fold, treble at the seam.",
  styles: [
    { id: "violet", name: "Violet Pulse", values: {} },
    { id: "solar", name: "Solar", values: { hue: 30, hueSpread: 50 } },
    { id: "emerald", name: "Emerald", values: { hue: 140, hueSpread: 80, glow: 0.7 } },
    { id: "kaleido", name: "Kaleido Six", values: { symmetry: 6, rotSpeed: 0.3, hueSpread: 200 } },
    {
      id: "crimson",
      name: "Crimson Bloom",
      values: { hue: 350, hueSpread: 35, innerRadius: 0.24, glow: 0.85, rotSpeed: -0.08 },
    },
    {
      id: "arctic",
      name: "Arctic Halo",
      values: {
        hue: 195,
        hueSpread: 45,
        symmetry: 4,
        rotSpeed: 0.06,
        glow: 0.4,
        innerRadius: 0.14,
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
      default: 280,
      hint: "Base color of the ring and core",
    },
    {
      key: "hueSpread",
      label: "Hue spread",
      min: 0,
      max: 240,
      step: 1,
      default: 120,
      hint: "Color range around the circle — 0 = single color",
    },
    {
      key: "innerRadius",
      label: "Core size",
      min: 0.08,
      max: 0.35,
      step: 0.005,
      default: 0.18,
      hint: "Radius of the whole center arrangement",
    },
    {
      key: "symmetry",
      label: "Symmetry",
      min: 1,
      max: 8,
      step: 1,
      default: 2,
      hint: "How many times the spectrum repeats around the circle",
    },
    {
      key: "rotSpeed",
      label: "Rotation",
      min: -1,
      max: 1,
      step: 0.02,
      default: 0.12,
      hint: "Constant spin of the whole ring; negative = counter-clockwise",
    },
    {
      key: "glow",
      label: "Glow",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.55,
      hint: "Light bleeding outward past the bar tips",
    },
    {
      key: "peaks",
      label: "Peak arcs",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Floating white arcs holding each angle's recent maximum",
    },
  ],
  advanced: [
    {
      key: "barLen",
      label: "Bar length",
      min: 0.1,
      max: 0.4,
      step: 0.01,
      default: 0.3,
      hint: "Maximum outward reach of the bars (kept inside the frame)",
    },
    {
      key: "ringBreathe",
      label: "Ring breathe",
      min: 0,
      max: 0.4,
      step: 0.01,
      default: 0.12,
      hint: "Whole ring expands with bass energy",
    },
    {
      key: "coreSize",
      label: "Core scale",
      min: 0.3,
      max: 0.95,
      step: 0.01,
      default: 0.7,
      hint: "Blue core size relative to the ring",
    },
    {
      key: "corePump",
      label: "Core pump",
      min: 0,
      max: 0.3,
      step: 0.01,
      default: 0.08,
      hint: "Core slowly grows with overall loudness",
    },
    {
      key: "coreBeat",
      label: "Core beat kick",
      min: 0,
      max: 0.2,
      step: 0.01,
      default: 0.04,
      hint: "Small core size kick on each beat",
    },
    {
      key: "wobBase",
      label: "Wobble base",
      min: 0,
      max: 0.1,
      step: 0.005,
      default: 0.03,
      hint: "Core edge waviness when music is quiet",
    },
    {
      key: "wobAmp",
      label: "Wobble swell",
      min: 0,
      max: 0.3,
      step: 0.005,
      default: 0.11,
      hint: "How much the edge waves grow in loud passages",
    },
    {
      key: "wobClamp",
      label: "Wobble limit",
      min: 0,
      max: 0.25,
      step: 0.005,
      default: 0.14,
      hint: "Hard cap on edge deformation — keeps the core inside the ring",
    },
    {
      key: "spinBase",
      label: "Wobble spin",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.25,
      hint: "Base rotation speed of the edge waves",
    },
    {
      key: "spinEnergy",
      label: "Spin energy",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.35,
      hint: "Extra wave rotation as the track gets louder",
    },
    {
      key: "coreBright",
      label: "Core brightness",
      min: 0,
      max: 0.8,
      step: 0.02,
      default: 0.35,
      hint: "How much the core lights up with loudness",
    },
    {
      key: "detailRing",
      label: "Detail ring",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Thin waveform hairline inside the core",
    },
    {
      key: "detailPos",
      label: "Detail position",
      min: 0.2,
      max: 0.9,
      step: 0.01,
      default: 0.55,
      hint: "Where the hairline sits inside the core",
    },
    {
      key: "beatBloom",
      label: "Beat bloom",
      min: 0,
      max: 0.4,
      step: 0.01,
      default: 0.1,
      hint: "Core brightness flash on each beat",
    },
    {
      key: "vignette",
      label: "Vignette",
      min: 0,
      max: 1.2,
      step: 0.05,
      default: 0.5,
      hint: "Darkening toward the screen corners",
    },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  let p = centered(uv);
  let r = length(p);
  // Beat kicks ride the tempo grid when the track has one (gridPulse falls
  // back to the flux pulse when it doesn't); real onsets still win via max.
  let beatP = max(u.driveBeat, gridPulse(7.0));
  var a = atan2(p.y, p.x) + (u.time * P_rotSpeed() * TAU * 0.1 + beatP * 0.12) * u.spin;

  // Fold into symmetric segments, mirrored inside each for seamless wrap
  let sym = max(1.0, P_symmetry());
  let seg = fract(a / TAU * sym + 10.0);
  let xs = abs(seg * 2.0 - 1.0);
  let v = binAt(xs);
  let pk = peakAt(xs);

  let inner = P_innerRadius() * (1.0 + (u.bass * P_ringBreathe() + beatP * 0.06) * u.pulse);
  // Frame-safety: the top/bottom edge sits at r=0.5, so a radial bar's tip must
  // never pass ~0.47 or the burst spills out of frame at any loudness/setting.
  let len = min(v * P_barLen(), max(0.0, 0.47 - inner));
  let barHue = P_hue() + xs * P_hueSpread();

  // Background wash
  var col = hsl2rgb(P_hue() + 60.0, 0.5, 0.04 + u.mid * 0.04) * (1.0 - r * 0.8);

  // Radial bar body
  let inBar = step(inner, r) * step(r, inner + len);
  let radial = (r - inner) / max(len, 0.001);
  col = mix(col, hsl2rgb(barHue, 0.85, 0.35 + radial * 0.35), inBar);

  // Glow beyond bar tip
  let tip = inner + len;
  let fall = exp(-max(r - tip, 0.0) * (18.0 - P_glow() * 12.0));
  col += hsl2rgb(barHue, 0.9, 0.5) * fall * P_glow() * v * step(tip, r);

  // Peak arc (toggleable)
  let pkR = min(inner + pk * P_barLen(), 0.47);
  col += hsl2rgb(barHue, 0.3, 0.9) * smoothstep(0.005, 0.0, abs(r - pkR)) * 0.8
       * step(0.5, P_peaks());

  // Core disc: geometry rides only slow signals — fast bands jitter,
  // energy glides. One slow-rotating dominant mode; amplitude on the slow
  // envelope; hard clamp keeps the core inside the bar ring.
  let pump = 1.0 + (u.drive * P_corePump() + beatP * P_coreBeat()) * u.pulse;
  let coreR = inner * P_coreSize() * pump;
  let spin = u.time * (P_spinBase() + u.drive * P_spinEnergy()) * u.spin;
  let amp = inner * (P_wobBase() + u.drive * P_wobAmp());
  var wob = sin(a * 3.0 + spin) * amp
          + sin(a * 6.0 - spin * 0.7 + 1.3) * amp * 0.35;
  let lim = inner * P_wobClamp();
  wob = clamp(wob, -lim, lim);
  let core = smoothstep(coreR + wob + 0.005, coreR + wob - 0.005, r);
  let coreL = 0.12 + u.drive * P_coreBright() + beatP * P_beatBloom();
  col = mix(col, hsl2rgb(P_hue() + 30.0, 0.75, coreL), core);

  // Thin waveform detail ring inside the core: fast micro-motion reads as
  // "alive" on a hairline without deforming the silhouette
  if (P_detailRing() > 0.5) {
    let wr = coreR * P_detailPos() + waveAt(fract(a / TAU + 0.5)) * 0.02;
    col += hsl2rgb(P_hue() + 50.0, 0.6, 0.65) * smoothstep(0.004, 0.0, abs(r - wr)) * core * 0.5;
  }

  // Vignette
  col *= 1.0 - r * r * P_vignette();
  // Frame-safety fade: guarantee nothing (bar tips, tip-glow, wash) stays
  // bright past the top/bottom edge (r=0.5), so the burst never spills out.
  col *= smoothstep(0.5, 0.45, r);
  return vec4f(col, 1.0);
}
`,
};
