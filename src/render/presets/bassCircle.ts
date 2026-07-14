import type { PresetDef } from "../types";

/**
 * Bass Circle — the circular "bass visualizer" look (à la trap-nation edits): a
 * glowing centre circle that pumps with the bass, a mirrored ring of radial
 * spectrum bars around it, and a field of floating bokeh particles drifting on
 * their own paths and twinkling behind it. Made to be paired with Bloom.
 *
 * Fragment v1: particles are an ambient hash-grid bokeh field (each wanders +
 * twinkles independently). Obeys the global Motion masters (Rotation drives the
 * ring spin, Pulse the beat pump).
 */
export const bassCircle: PresetDef = {
  id: "bass-circle",
  name: "Bass Circle",
  description:
    "Circular bass visualizer: a pumping glow circle ringed by radial spectrum bars, over a field of floating, twinkling bokeh particles. Turn on Bloom for the full look.",
  styles: [
    { id: "violet", name: "Violet", values: {} },
    {
      id: "inferno",
      name: "Inferno",
      values: { hue: 20, hueSpread: 40, beatPump: 0.3, particles: 1.3 },
    },
    { id: "cyber", name: "Cyber", values: { hue: 180, hueSpread: 120, symmetry: 3, spin: 0.4 } },
    {
      id: "mono",
      name: "Mono",
      values: { hueSpread: 0, particles: 0.6, barLen: 0.3, rimBright: 1.1 },
    },
  ],
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 280, hint: "Base color" },
    {
      key: "radius",
      label: "Circle size",
      min: 0.08,
      max: 0.4,
      step: 0.005,
      default: 0.18,
      hint: "Resting radius of the centre circle",
    },
    {
      key: "pump",
      label: "Pump",
      min: 0,
      max: 0.6,
      step: 0.01,
      default: 0.18,
      hint: "How much the circle + ring swell with the sync source (Motion→Pulse also scales this)",
    },
    {
      key: "barLen",
      label: "Bar length",
      min: 0.05,
      max: 0.5,
      step: 0.01,
      default: 0.24,
      hint: "Outward reach of the radial spectrum bars",
    },
    {
      key: "particles",
      label: "Particles",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 1,
      hint: "Brightness of the floating background bokeh particles",
    },
    {
      key: "rimBright",
      label: "Rim glow",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.8,
      hint: "Brightness of the circle's glowing rim",
    },
  ],
  advanced: [
    {
      key: "symmetry",
      label: "Symmetry",
      min: 1,
      max: 8,
      step: 1,
      default: 2,
      hint: "How many times the spectrum repeats around the ring",
    },
    {
      key: "spin",
      label: "Ring spin",
      min: -1,
      max: 1,
      step: 0.02,
      default: 0,
      hint: "Constant rotation of the bar ring (Motion→Rotation also scales this)",
    },
    {
      key: "hueSpread",
      label: "Hue spread",
      min: 0,
      max: 240,
      step: 5,
      default: 60,
      hint: "Color range around the ring",
    },
    {
      key: "beatPump",
      label: "Beat pump",
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.16,
      hint: "Extra swell on each beat of the sync source",
    },
    {
      key: "gap",
      label: "Ring gap",
      min: 0,
      max: 0.12,
      step: 0.005,
      default: 0.02,
      hint: "Space between the circle and the bars",
    },
    {
      key: "barGlow",
      label: "Bar glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.5,
      hint: "Glow past the bar tips",
    },
    {
      key: "partDensity",
      label: "Particle size",
      min: 3,
      max: 16,
      step: 0.5,
      default: 7,
      hint: "Size + spacing of the floating background particles (lower = bigger, sparser)",
    },
    {
      key: "partFill",
      label: "Particle amount",
      min: 0.1,
      max: 0.9,
      step: 0.05,
      default: 0.45,
      hint: "How many of the background particles are lit",
    },
    {
      key: "partFloat",
      label: "Float speed",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.6,
      hint: "How fast the background particles drift on their own",
    },
    {
      key: "beatBurst",
      label: "Beat burst",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.7,
      hint: "How hard beats brighten the particles",
    },
    {
      key: "vignette",
      label: "Vignette",
      min: 0,
      max: 1.2,
      step: 0.05,
      default: 0.3,
      hint: "Darkening toward the corners",
    },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  let c = centered(uv);
  let r = length(c);
  let a = atan2(c.y, c.x);
  var col = vec3f(0.0);

  // Whole assembly pumps with the sync source (Motion->Pulse scales it).
  let pump = 1.0 + (u.drive * P_pump() + u.driveBeat * P_beatPump()) * u.pulse;
  let circleR = P_radius() * pump;

  // --- Background bokeh particles: each drifts along its own slow path and
  // twinkles, independent of the circle (the classic floating-dust layer).
  // Drawn first so the ring + circle sit on top. ---
  if (P_particles() > 0.01) {
    let beat = 0.5 + u.driveBeat * P_beatBurst() * 0.7;
    for (var l = 0; l < 2; l++) {
      let fl = f32(l);
      let scale = P_partDensity() * (1.0 + fl * 0.7);
      // Parallax layer drift + per-particle wander give independent motion.
      let drift = vec2f(u.time * P_partFloat() * (0.05 - fl * 0.02),
                        u.time * P_partFloat() * (0.03 + fl * 0.02));
      let q = c * scale + drift;
      let cell = floor(q);
      let fq = q - cell;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          let cc = cell + vec2f(f32(dx), f32(dy));
          let h1 = hash21(cc + fl * 57.3);
          if (h1 > P_partFill()) { continue; }
          let h2 = hash21(cc + fl * 57.3 + 11.7);
          let h3 = hash21(cc + fl * 57.3 + 23.1);
          let ph = h2 * TAU;
          let wob = vec2f(sin(u.time * P_partFloat() * (0.5 + h2) + ph),
                          cos(u.time * P_partFloat() * (0.6 + h3) + ph * 1.4)) * 0.38;
          let pos = vec2f(f32(dx), f32(dy)) + 0.5 + wob;
          let d = length(fq - pos);
          let sz = (0.06 + h1 * 0.12) * (1.0 - fl * 0.2);
          let tw = 0.4 + 0.6 * sin(u.time * (0.8 + h2 * 3.0) + h1 * 40.0);
          let core = smoothstep(sz, 0.0, d);
          let halo = exp(-d * d / max(sz * sz * 3.0, 1e-6)) * 0.5;
          col += hsl2rgb(P_hue() + (h2 - 0.5) * P_hueSpread(), 0.5, 0.72)
               * (core + halo) * tw * P_particles() * beat * (1.0 - fl * 0.3);
        }
      }
    }
  }

  // --- Radial spectrum bars, mirrored around the ring (optional slow spin) ---
  let sym = max(1.0, P_symmetry());
  let seg = fract(a / TAU * sym + u.time * P_spin() * 0.05 * u.spin + 0.5);
  let xs = abs(seg * 2.0 - 1.0);
  let v = binAt(xs);
  let barInner = circleR + P_gap();
  let barLen = v * P_barLen();
  let barHue = P_hue() + xs * P_hueSpread();
  let inBar = step(barInner, r) * step(r, barInner + barLen);
  let along = (r - barInner) / max(barLen, 1e-3);
  col = mix(col, hsl2rgb(barHue, 0.9, 0.4 + along * 0.35), inBar);
  col += hsl2rgb(barHue, 0.95, 0.6) * exp(-max(r - (barInner + barLen), 0.0) * 22.0)
       * v * P_barGlow() * step(barInner + barLen, r);

  // --- Centre circle: cool dark fill + a bright glowing rim (over particles) ---
  let inner = smoothstep(circleR, circleR - 0.02, r);
  col = mix(col, hsl2rgb(P_hue(), 0.5, 0.04 + u.drive * 0.07), inner);
  let rim = exp(-abs(r - circleR) * 90.0);
  col += hsl2rgb(P_hue(), 0.9, 0.65) * rim * P_rimBright() * (0.7 + u.drive * 0.6 + u.driveBeat * 0.5);
  col += hsl2rgb(P_hue() + 20.0, 0.8, 0.5) * smoothstep(circleR, 0.0, r) * (0.08 + u.drive * 0.3) * inner;

  col *= 1.0 - r * r * P_vignette();
  return vec4f(col, 1.0);
}
`,
};
