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
    // Violet — the defaults — pumping circle, mirrored bars, bokeh field.
    { id: "violet", name: "Violet", values: {} },
    // Bokeh — few huge soft particles crowding a small circle — the field is the look.
    {
      id: "bokeh",
      name: "Bokeh",
      values: {
        hue: 322,
        hueSpread: 90,
        particles: 1.35,
        partDensity: 3,
        partFill: 0.75,
        partFloat: 0.35,
        beatBurst: 1.2,
        radius: 0.15,
        barLen: 0.12,
        gap: 0.05,
        barGlow: 0.28,
        rimBright: 0.95,
        pump: 0.24,
        beatPump: 0.22,
        vignette: 0.55,
      },
    },
    // Vinyl — editorial. A big still cover disc, hairline bars, no particles.
    {
      id: "vinyl",
      name: "Vinyl",
      values: {
        hue: 350,
        hueSpread: 0,
        radius: 0.36,
        barLen: 0.06,
        gap: 0.01,
        particles: 0,
        rimBright: 0.5,
        barGlow: 0.1,
        symmetry: 1,
        spin: 0.06,
        pump: 0.06,
        beatPump: 0.04,
        coverMix: 1,
        coverBright: 1,
        coverZoom: 1.05,
        vignette: 0.5,
      },
    },
    // Turbine — 8-fold bars spinning fast off a tiny hub over fine dust.
    {
      id: "turbine",
      name: "Turbine",
      values: {
        hue: 186,
        hueSpread: 130,
        symmetry: 8,
        spin: 0.46,
        radius: 0.1,
        barLen: 0.32,
        gap: 0.04,
        barGlow: 0.8,
        rimBright: 1.2,
        particles: 0.55,
        partDensity: 13,
        partFill: 0.3,
        partFloat: 1.2,
        beatBurst: 0.5,
        pump: 0.28,
        beatPump: 0.24,
        vignette: 0.45,
      },
    },
    // Inferno — max pump, longest bars, densest embers — the loudest version.
    {
      id: "inferno",
      name: "Inferno",
      values: {
        hue: 16,
        hueSpread: 45,
        radius: 0.2,
        barLen: 0.3,
        pump: 0.44,
        beatPump: 0.36,
        beatBurst: 1.6,
        particles: 1.45,
        partDensity: 9.5,
        partFill: 0.6,
        partFloat: 1,
        rimBright: 1.35,
        barGlow: 0.86,
        symmetry: 3,
        spin: -0.08,
        gap: 0.03,
        vignette: 0.35,
      },
    },
    // Mono Ink — cover and particles off: white ring and bars on black, aimed upward.
    {
      id: "monoInk",
      name: "Mono Ink",
      values: {
        hue: 210,
        hueSpread: 0,
        cover: 0,
        particles: 0,
        barGlow: 0.06,
        rimBright: 1.45,
        radius: 0.13,
        barLen: 0.28,
        gap: 0.08,
        pump: 0.1,
        beatPump: 0.08,
        symmetry: 1,
        angle: 90,
        vignette: 0.15,
      },
    },
    // Halo — widest gap: the bars float as a detached ring around a small core.
    {
      id: "halo",
      name: "Halo",
      values: {
        hue: 268,
        hueSpread: 200,
        radius: 0.11,
        gap: 0.12,
        barLen: 0.3,
        symmetry: 4,
        spin: -0.24,
        barGlow: 0.6,
        rimBright: 0.7,
        particles: 0.9,
        partDensity: 5,
        partFill: 0.25,
        partFloat: 0.25,
        beatBurst: 0.9,
        pump: 0.3,
        beatPump: 0.2,
        vignette: 0.6,
      },
    },
    // Gold Rush — warm 2-fold ring, slow spin, cover art zoomed in a touch.
    {
      id: "gold",
      name: "Gold Rush",
      values: {
        hue: 44,
        hueSpread: 30,
        spin: 0.14,
        radius: 0.22,
        barLen: 0.2,
        barGlow: 0.6,
        rimBright: 1.3,
        beatBurst: 1,
        particles: 1.2,
        partDensity: 8.5,
        partFill: 0.5,
        pump: 0.22,
        beatPump: 0.2,
        coverZoom: 1.2,
        vignette: 0.4,
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
      default: 280,
      hint: "Base color",
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
      key: "radius",
      label: "Circle size",
      group: "shape",
      min: 0.08,
      max: 0.42,
      step: 0.005,
      default: 0.18,
      hint: "Resting radius of the centre circle",
    },
    {
      key: "pump",
      label: "Pump",
      group: "reaction",
      min: 0,
      max: 0.6,
      step: 0.01,
      default: 0.18,
      hint: "How much the circle + ring swell with the sync source (Motion→Pulse also scales this)",
    },
    {
      key: "barLen",
      label: "Bar length",
      group: "shape",
      min: 0.05,
      max: 0.32,
      step: 0.01,
      default: 0.24,
      hint: "Outward reach of the radial spectrum bars (kept inside the frame)",
    },
    {
      key: "particles",
      label: "Particles",
      group: "shape",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 1,
      hint: "Brightness of the floating background bokeh particles",
    },
    {
      key: "rimBright",
      label: "Rim glow",
      group: "glow",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.8,
      hint: "Brightness of the circle's glowing rim",
    },
    {
      key: "cover",
      label: "Cover art",
      group: "image",
      control: "toggle",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Show the track's embedded cover art inside the circle (falls back to a plain fill)",
    },
    {
      key: "coverHue",
      label: "Match cover colors",
      group: "image",
      control: "toggle",
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      hint: "Analyze the cover art and set Hue + Hue spread to match it — reapplies automatically whenever a track with cover art loads",
    },
  ],
  advanced: [
    {
      key: "symmetry",
      label: "Symmetry",
      group: "shape",
      control: "enum",
      options: [
        { value: 1, label: "1×" },
        { value: 2, label: "2×" },
        { value: 3, label: "3×" },
        { value: 4, label: "4×" },
        { value: 5, label: "5×" },
        { value: 6, label: "6×" },
        { value: 7, label: "7×" },
        { value: 8, label: "8×" },
      ],
      min: 1,
      max: 8,
      step: 1,
      default: 2,
      hint: "How many times the spectrum repeats around the ring",
    },
    {
      key: "angle",
      label: "Ring angle",
      group: "motion",
      control: "angle",
      min: 0,
      max: 360,
      step: 1,
      default: 0,
      hint: "Static orientation of the bar ring — aim it anywhere; works even with Motion→Rotation at 0",
    },
    {
      key: "spin",
      label: "Ring spin",
      group: "motion",
      min: -1,
      max: 1,
      step: 0.02,
      default: 0,
      hint: "Constant rotation of the bar ring (scaled by Motion→Rotation); 0 = stationary — use Ring angle to aim it",
    },
    {
      key: "hueSpread",
      label: "Hue spread",
      group: "color",
      min: 0,
      max: 240,
      step: 5,
      default: 60,
      hint: "Color range around the ring",
    },
    {
      key: "beatPump",
      label: "Beat pump",
      group: "reaction",
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.16,
      hint: "Extra swell on each beat of the sync source",
    },
    {
      key: "gap",
      label: "Ring gap",
      group: "shape",
      min: 0,
      max: 0.12,
      step: 0.005,
      default: 0.02,
      hint: "Space between the circle and the bars",
    },
    {
      key: "barGlow",
      label: "Bar glow",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.5,
      hint: "Glow past the bar tips",
    },
    {
      key: "partDensity",
      label: "Particle size",
      group: "shape",
      min: 3,
      max: 16,
      step: 0.5,
      default: 7,
      hint: "Size + spacing of the floating background particles (lower = bigger, sparser)",
    },
    {
      key: "partFill",
      label: "Particle amount",
      group: "shape",
      min: 0.1,
      max: 0.9,
      step: 0.05,
      default: 0.45,
      hint: "How many of the background particles are lit",
    },
    {
      key: "partFloat",
      label: "Float speed",
      group: "motion",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.6,
      hint: "How fast the background particles drift on their own",
    },
    {
      key: "beatBurst",
      label: "Beat burst",
      group: "reaction",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.7,
      hint: "How hard beats brighten the particles",
    },
    {
      key: "coverMix",
      label: "Cover blend",
      group: "image",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.9,
      hint: "How strongly the cover art replaces the circle's fill",
    },
    {
      key: "coverBright",
      label: "Cover brightness",
      group: "image",
      min: 0.1,
      max: 2,
      step: 0.05,
      default: 0.85,
      hint: "Brightness of the cover art inside the circle",
    },
    {
      key: "coverFit",
      label: "Image fit",
      group: "image",
      control: "enum",
      options: [
        {
          value: 0,
          label: "Fill",
          hint: "Cover the whole slot; whatever does not fit is cropped off",
        },
        { value: 1, label: "Fit", hint: "Show all of it, letterboxed" },
        { value: 2, label: "Stretch", hint: "Squash it to fill the slot exactly" },
      ],
      min: 0,
      max: 2,
      step: 1,
      default: 0,
      hint: "Fill (crops to the circle) / Fit (whole image, no crop) / Stretch (distorts to fill)",
    },
    {
      key: "coverZoom",
      label: "Image zoom",
      group: "image",
      min: 0.25,
      max: 3,
      step: 0.01,
      default: 1,
      hint: "Scale the image inside the circle — zoom in on the part you want",
    },
    {
      key: "coverX",
      label: "Image X",
      group: "image",
      min: -0.5,
      max: 0.5,
      step: 0.005,
      default: 0,
      hint: "Slide the image sideways inside the circle",
    },
    {
      key: "coverY",
      label: "Image Y",
      group: "image",
      min: -0.5,
      max: 0.5,
      step: 0.005,
      default: 0,
      hint: "Slide the image up or down inside the circle",
    },
    {
      key: "vignette",
      label: "Vignette",
      group: "backdrop",
      min: 0,
      max: 1.2,
      step: 0.05,
      default: 0.3,
      hint: "Darkening toward the corners",
    },
  ],
  wgsl: /* wgsl */ `
fn colorScale(value: f32, control: f32) -> f32 {
  if (control <= 1.0) { return value * control; }
  return min(value * control, 1.0);
}

fn presetColor(h: f32, s: f32, l: f32) -> vec3f {
  return hsl2rgb(h, colorScale(s, P_saturation()), colorScale(l, P_lightness()));
}

fn preset(uv: vec2f) -> vec4f {
  let c = centered(uv);
  let r = length(c);
  let a = atan2(c.y, c.x);
  var col = vec3f(0.0);

  // Whole assembly pumps with the sync source (Motion->Pulse scales it).
  // The beat part rides the tempo grid when the track has one — the pump
  // lands on every metronome beat, not only on flux spikes — and max() lets
  // strong off-grid hits still punch through.
  let beatP = max(u.driveBeat, gridPulse(7.0));
  let pump = 1.0 + (u.drive * P_pump() + beatP * P_beatPump()) * u.pulse;
  // Frame-safety is SOFT since v2.44: the swollen disc compresses toward
  // the largest circle the frame fits instead of clipping at a fixed 0.34 —
  // a maxed Circle size grows to near the frame edge, smoothly.
  let circleR = softLimit(P_radius() * pump, frameCircle() * 0.86);

  // --- Background bokeh particles: each drifts along its own slow path and
  // twinkles, independent of the circle (the classic floating-dust layer).
  // Drawn first so the ring + circle sit on top. ---
  if (P_particles() > 0.01) {
    let beat = 0.5 + beatP * P_beatBurst() * 0.7;
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
          // sin() is remapped to 0..1 BEFORE the 0.4 + 0.6 * mix. A bare
          // 0.4 + 0.6 * sin() spans -0.2..1.0, so for ~23% of every particle's
          // twinkle cycle the multiplier is NEGATIVE and the particle
          // SUBTRACTS light — dark specks punched into a solid or image
          // background (bug L4). Particles are on by default, so this was
          // visible out of the box.
          let tw = 0.4 + 0.6 * (0.5 + 0.5 * sin(u.time * (0.8 + h2 * 3.0) + h1 * 40.0));
          let core = smoothstep(sz, 0.0, d);
          let halo = exp(-d * d / max(sz * sz * 3.0, 1e-6)) * 0.5;
          col += presetColor(P_hue() + (h2 - 0.5) * P_hueSpread(), 0.5, 0.72)
               * (core + halo) * tw * P_particles() * beat * (1.0 - fl * 0.3);
        }
      }
    }
  }

  // --- Radial spectrum bars, mirrored around the ring (optional slow spin) ---
  let sym = max(1.0, P_symmetry());
  // Static Ring angle is NOT gated by the motion master (orientation, not
  // motion) — the time-driven spin term still is.
  let seg = fract((a + P_angle() * (TAU / 360.0)) / TAU * sym
                  + u.time * P_spin() * 0.05 * u.spin + 0.5);
  let xs = abs(seg * 2.0 - 1.0);
  let v = binAt(xs);
  let barInner = circleR + P_gap();
  // Bar tips compress toward the frame border along their own angle (soft
  // frame limit, v2.44) — on a wide frame the side bars reach further than
  // the top/bottom ones, exactly like the frame itself does.
  let tipSoft = softLimit(barInner + v * P_barLen(), frameReach(a));
  let barLen = max(tipSoft - barInner, 0.0);
  let barHue = P_hue() + xs * P_hueSpread();
  let inBar = step(barInner, r) * step(r, barInner + barLen);
  let along = (r - barInner) / max(barLen, 1e-3);
  col = mix(col, presetColor(barHue, 0.9, 0.4 + along * 0.35), inBar);
  col += presetColor(barHue, 0.95, 0.6) * exp(-max(r - (barInner + barLen), 0.0) * 22.0)
       * v * P_barGlow() * step(barInner + barLen, r);

  // --- Centre circle: cover art (or a cool dark fill) + a bright glowing rim ---
  let inner = smoothstep(circleR, circleR - 0.02, r);
  var fill = presetColor(P_hue(), 0.5, 0.04 + u.drive * 0.07);
  if (P_cover() > 0.5 && hasCover()) {
    // Map the disc to the image (0..1), so the art fills the circle. No flip on
    // y: uv already arrives top-down from the vertex stage, so centered()'s y
    // grows downward exactly like the texture's v does. Negating it here hung
    // the cover upside down.
    let box = vec2f(c.x / circleR, c.y / circleR) * 0.5 + vec2f(0.5);
    // The disc is square, so a non-square image needs fitting or it stretches.
    let cuv = fitUV(box, coverAspect(), 1.0, P_coverFit(), P_coverZoom(),
                    vec2f(P_coverX(), P_coverY()));
    if (inBox(cuv)) {
      let art = coverSample(cuv).rgb * P_coverBright();
      fill = mix(fill, art, P_coverMix());
    }
  }
  col = mix(col, fill, inner);
  let rim = exp(-abs(r - circleR) * 90.0);
  col += presetColor(P_hue(), 0.9, 0.65) * rim * P_rimBright() * (0.7 + u.drive * 0.6 + beatP * 0.5);
  col += presetColor(P_hue() + 20.0, 0.8, 0.5) * smoothstep(circleR, 0.0, r) * (0.08 + u.drive * 0.3) * inner;

  // Vignette, clamped at zero: r*r reaches ~1.04 in the corners of a 16:9 frame
  // (1.61 at 21:9) while Vignette goes to 1.2, so the bare 1.0 - r*r*amt lands
  // at -0.25 out there. A negative multiplier makes the corners SUBTRACT light
  // and dent a solid or image background below black instead of darkening
  // toward it. The final max() enforces the same rule on everything above.
  col *= max(1.0 - r * r * P_vignette(), 0.0);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
