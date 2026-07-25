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
      key: "angle",
      label: "Angle",
      min: 0,
      max: 360,
      step: 1,
      default: 0,
      hint: "Static orientation of the ring — place the bass fold wherever you want; works even with Motion→Rotation at 0",
    },
    {
      key: "rotSpeed",
      label: "Rotation",
      min: -1,
      max: 1,
      step: 0.02,
      default: 0.12,
      hint: "Constant spin of the whole ring (scaled by Motion→Rotation); negative = counter-clockwise. Set 0 for a stationary ring — use Angle to aim it",
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
    {
      key: "cover",
      label: "Cover art",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Show the track's embedded cover art inside the core (falls back to the plain core)",
    },
    {
      key: "coverHue",
      label: "Match cover colors",
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      hint: "Analyze the center image and set Hue + Hue spread to match it — reapplies automatically whenever a track with cover art loads",
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
      default: 0.08,
      hint: "Small core size kick on each beat",
    },
    {
      key: "wobBase",
      label: "Wobble base",
      min: 0,
      max: 0.1,
      step: 0.005,
      default: 0.015,
      hint: "Core edge waviness when music is quiet",
    },
    {
      key: "wobAmp",
      label: "Wobble swell",
      min: 0,
      max: 0.3,
      step: 0.005,
      default: 0.06,
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
      key: "coverMix",
      label: "Cover blend",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.85,
      hint: "How strongly the cover art replaces the core's fill",
    },
    {
      key: "coverBright",
      label: "Cover brightness",
      min: 0.1,
      max: 2,
      step: 0.05,
      default: 0.9,
      hint: "Brightness of the cover art inside the core",
    },
    {
      key: "rimBright",
      label: "Core rim",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.7,
      hint: "Glowing rim around the core — pulses with the music so the core reads as the beat anchor",
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
  // Rotation is TIME-only. A beat kick used to add +0.12 rad to the angle,
  // but the pulse DECAYS after each beat — so the whole burst visibly
  // rotated forward on the hit and then slid BACK as the pulse faded
  // ("rotation jumping back and forth", reported across many versions).
  // Angle offsets must be monotonic; beat energy stays in ring breathe,
  // core pump and bloom, which are radial and can decay without lying.
  // Static Angle aims the ring (place the bass fold anywhere) and is
  // deliberately NOT scaled by Motion->Rotation: the master gates MOTION,
  // not orientation — with Rotation at 0 the ring stands still exactly
  // where Angle points it (owner request: "right side at the top,
  // stationary"). The time term stays master-gated and monotonic.
  var a = atan2(p.y, p.x) + P_angle() * (TAU / 360.0)
        + u.time * P_rotSpeed() * TAU * 0.1 * u.spin;

  // Fold into symmetric segments, mirrored inside each for seamless wrap
  let sym = max(1.0, P_symmetry());
  let seg = fract(a / TAU * sym + 10.0);
  let xs = abs(seg * 2.0 - 1.0);
  let v = binAt(xs);
  let pk = peakAt(xs);

  // Frame-safety is SOFT since v2.44: geometry compresses toward the frame
  // border (softLimit/frameReach) instead of clipping at a fixed circle —
  // maxed settings approach the edge smoothly, never slice along one.
  let screenA = atan2(p.y, p.x);
  let inner = softLimit(
    P_innerRadius() * (1.0 + (u.bass * P_ringBreathe() + beatP * 0.06) * u.pulse),
    frameCircle() * 0.9,
  );
  let tipSoft = softLimit(inner + v * P_barLen(), frameReach(screenA));
  let len = max(tipSoft - inner, 0.0);
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
  let pkR = softLimit(inner + pk * P_barLen(), frameReach(screenA));
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
  // The core is a disc, so it compresses against the circle that fits the
  // frame — a maxed Core size fills gracefully instead of walling the screen.
  let coreEdge = softLimit(coreR + wob, frameCircle());
  let core = smoothstep(coreEdge + 0.005, coreEdge - 0.005, r);
  let coreL = 0.12 + u.drive * P_coreBright() + beatP * P_beatBloom();
  var coreFill = hsl2rgb(P_hue() + 30.0, 0.75, coreL);
  if (P_cover() > 0.5 && hasCover()) {
    // Map the core disc to the image using the MAXIMUM the wavy edge can
    // reach (coreR + wobble limit), not the resting radius: mapping to the
    // resting radius sampled past the image at every bulge and drew a ring
    // of clamped edge color (audit R9). The art stays perfectly still —
    // only the mask breathes — so the cover reads as a stable anchor while
    // everything around it moves.
    let artR = max(softLimit(coreR + lim, frameCircle()), 1e-3);
    let cuv = vec2f(p.x / artR, p.y / artR) * 0.5 + vec2f(0.5);
    // Loudness lift + beat bloom keep the art alive without recoloring it.
    let art = coverSample(cuv).rgb * P_coverBright()
            * (0.85 + u.drive * P_coreBright() + beatP * P_beatBloom());
    coreFill = mix(coreFill, art, P_coverMix());
  }
  col = mix(col, coreFill, core);
  // Pulsing rim on the core edge (rework): the old bare edge left the core
  // reading as an unexplained blob — a rim that swells on the grid beat and
  // with loudness makes it legible as THE beat anchor, cover or no cover.
  let rim = exp(-abs(r - coreEdge) * 80.0);
  col += hsl2rgb(P_hue() + 15.0, 0.85, 0.6) * rim * P_rimBright()
       * (0.45 + u.drive * 0.55 + beatP * 0.7);

  // Thin waveform detail ring inside the core: fast micro-motion reads as
  // "alive" on a hairline without deforming the silhouette
  if (P_detailRing() > 0.5) {
    let wr = coreR * P_detailPos() + waveAt(fract(a / TAU + 0.5)) * 0.02;
    col += hsl2rgb(P_hue() + 50.0, 0.6, 0.65) * smoothstep(0.004, 0.0, abs(r - wr)) * core * 0.5;
  }

  // Vignette
  col *= 1.0 - r * r * P_vignette();
  // NOTE: no global r=0.5 fade here. Frame-safety is enforced GEOMETRICALLY —
  // bar length, peak arc and core are all hard-clamped to <=0.47 above — so a
  // full-field multiply is redundant. It also cut the background wash and the
  // tip glow off at r=0.5, which is well inside a 16:9 frame (corners reach
  // r~1.02) and showed up as a hard black circle around the burst.
  return vec4f(col, 1.0);
}
`,
};
