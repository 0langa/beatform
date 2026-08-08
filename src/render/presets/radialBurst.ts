import type { PresetDef } from "../types";
import { WGSL_COLOR_CONTROLS } from "../wgslLib";

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
    // Violet Pulse — the defaults — a breathing core inside a mirrored spectrum ring.
    { id: "violet", name: "Violet Pulse", values: {} },
    // Sun Dial — symmetry 1 and no spin: one long unfolded fan, aimed straight up.
    {
      id: "sunDial",
      name: "Sun Dial",
      values: {
        hue: 38,
        hueSpread: 60,
        symmetry: 1,
        angle: 270,
        rotSpeed: 0,
        innerRadius: 0.13,
        barLen: 0.4,
        coreSize: 0.45,
        glow: 0.42,
        rimBright: 1.15,
        wobBase: 0.005,
        wobAmp: 0.02,
        wobClamp: 0.05,
        spinBase: 0.05,
        spinEnergy: 0.1,
        detailPos: 0.7,
        vignette: 0.7,
      },
    },
    // Mandala — 8-fold, short bars, big wobbling core — a slow rotating rosette.
    {
      id: "mandala",
      name: "Mandala",
      values: {
        hue: 292,
        hueSpread: 200,
        symmetry: 8,
        rotSpeed: 0.06,
        innerRadius: 0.24,
        barLen: 0.16,
        coreSize: 0.9,
        wobBase: 0.05,
        wobAmp: 0.18,
        wobClamp: 0.2,
        spinBase: 0.6,
        spinEnergy: 0.7,
        glow: 0.35,
        rimBright: 0.5,
        peaks: 0,
        coreBright: 0.5,
        detailPos: 0.8,
        vignette: 0.6,
      },
    },
    // Liquid Core — cover off, core at max size and wobble: a lava blob that eats the ring.
    {
      id: "liquidCore",
      name: "Liquid Core",
      values: {
        hue: 172,
        hueSpread: 70,
        cover: 0,
        symmetry: 3,
        innerRadius: 0.3,
        coreSize: 0.95,
        barLen: 0.12,
        wobBase: 0.08,
        wobAmp: 0.26,
        wobClamp: 0.24,
        spinBase: 0.9,
        spinEnergy: 1.1,
        glow: 0.3,
        rimBright: 1.2,
        coreBright: 0.7,
        corePump: 0.2,
        coreBeat: 0.16,
        beatBloom: 0.28,
        ringBreathe: 0.3,
        peaks: 0,
        detailRing: 0,
        vignette: 0.75,
      },
    },
    // Vinyl — editorial. A still, perfectly round cover disc with a hairline ring.
    {
      id: "vinyl",
      name: "Vinyl",
      values: {
        hue: 348,
        hueSpread: 0,
        symmetry: 1,
        rotSpeed: 0.04,
        innerRadius: 0.32,
        coreSize: 0.95,
        barLen: 0.1,
        glow: 0.12,
        spinBase: 0,
        spinEnergy: 0,
        wobBase: 0,
        wobAmp: 0,
        wobClamp: 0.005,
        corePump: 0.03,
        coreBeat: 0.02,
        coreBright: 0.2,
        beatBloom: 0.04,
        ringBreathe: 0.03,
        rimBright: 0.65,
        peaks: 0,
        detailRing: 0,
        coverMix: 1,
        coverBright: 1,
        coverZoom: 1.05,
        vignette: 0.6,
      },
    },
    // Supernova — longest bars, hardest breathe and bloom, hot rim — peak energy.
    {
      id: "supernova",
      name: "Supernova",
      values: {
        hue: 8,
        hueSpread: 45,
        innerRadius: 0.11,
        barLen: 0.4,
        glow: 0.95,
        ringBreathe: 0.34,
        corePump: 0.24,
        coreBeat: 0.18,
        beatBloom: 0.36,
        coreBright: 0.72,
        rimBright: 1.45,
        rotSpeed: 0.22,
        spinBase: 0.8,
        spinEnergy: 1.2,
        wobAmp: 0.16,
        wobClamp: 0.18,
        vignette: 0.35,
      },
    },
    // Ice Compass — 4-fold, frozen at 45 degrees, calm core: an instrument, not a firework.
    {
      id: "compass",
      name: "Ice Compass",
      values: {
        hue: 198,
        hueSpread: 40,
        symmetry: 4,
        rotSpeed: 0,
        angle: 45,
        innerRadius: 0.16,
        barLen: 0.26,
        coreSize: 0.6,
        glow: 0.3,
        coreBright: 0.16,
        rimBright: 0.9,
        wobBase: 0.005,
        wobAmp: 0.03,
        wobClamp: 0.06,
        spinBase: 0.1,
        spinEnergy: 0.15,
        detailPos: 0.45,
        vignette: 0.55,
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
      hint: "Base color of the ring and core",
    },
    {
      key: "hueSpread",
      label: "Hue spread",
      group: "color",
      min: 0,
      max: 240,
      step: 1,
      default: 120,
      hint: "Color range around the circle — 0 = single color",
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
      key: "innerRadius",
      label: "Core size",
      group: "shape",
      min: 0.08,
      max: 0.35,
      step: 0.005,
      default: 0.18,
      hint: "Radius of the whole center arrangement",
    },
    {
      key: "symmetry",
      label: "Symmetry",
      group: "shape",
      control: "enum",
      mod: "snap",
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
      hint: "How many times the spectrum repeats around the circle",
    },
    {
      key: "angle",
      label: "Angle",
      group: "motion",
      control: "angle",
      min: 0,
      max: 360,
      step: 1,
      default: 0,
      hint: "Static orientation of the ring — place the bass fold wherever you want; works even with Motion→Rotation at 0",
    },
    {
      key: "rotSpeed",
      label: "Rotation",
      group: "motion",
      min: -1,
      max: 1,
      step: 0.02,
      default: 0.12,
      hint: "Constant spin of the whole ring (scaled by Motion→Rotation); negative = counter-clockwise. Set 0 for a stationary ring — use Angle to aim it",
    },
    {
      key: "glow",
      label: "Glow",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.55,
      hint: "Light bleeding outward past the bar tips",
    },
    {
      key: "peaks",
      label: "Peak arcs",
      group: "shape",
      control: "toggle",
      mod: "off",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Floating white arcs holding each angle's recent maximum",
    },
    {
      key: "cover",
      label: "Cover art",
      group: "image",
      control: "toggle",
      mod: "off",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Show the track's embedded cover art inside the core (falls back to the plain core)",
    },
    {
      key: "coverHue",
      label: "Match cover colors",
      group: "image",
      control: "toggle",
      mod: "off",
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
      group: "shape",
      min: 0.1,
      max: 0.4,
      step: 0.01,
      default: 0.3,
      hint: "Maximum outward reach of the bars (kept inside the frame)",
    },
    {
      key: "ringBreathe",
      label: "Ring breathe",
      group: "reaction",
      tier: "curated",
      min: 0,
      max: 0.4,
      step: 0.01,
      default: 0.12,
      hint: "Whole ring expands with bass energy",
    },
    {
      key: "coreSize",
      label: "Core scale",
      group: "shape",
      min: 0.3,
      max: 0.95,
      step: 0.01,
      default: 0.7,
      hint: "Blue core size relative to the ring",
    },
    {
      key: "corePump",
      label: "Core pump",
      group: "reaction",
      min: 0,
      max: 0.3,
      step: 0.01,
      default: 0.08,
      hint: "Core slowly grows with overall loudness",
    },
    {
      key: "coreBeat",
      label: "Core beat kick",
      group: "reaction",
      min: 0,
      max: 0.2,
      step: 0.01,
      default: 0.08,
      hint: "Small core size kick on each beat",
    },
    {
      key: "wobBase",
      label: "Wobble base",
      group: "motion",
      min: 0,
      max: 0.1,
      step: 0.005,
      default: 0.015,
      hint: "Core edge waviness when music is quiet",
    },
    {
      key: "wobAmp",
      label: "Wobble swell",
      group: "reaction",
      min: 0,
      max: 0.3,
      step: 0.005,
      default: 0.06,
      hint: "How much the edge waves grow in loud passages",
    },
    {
      key: "wobClamp",
      label: "Wobble limit",
      group: "motion",
      min: 0,
      max: 0.25,
      step: 0.005,
      default: 0.14,
      hint: "Hard cap on edge deformation — keeps the core inside the ring",
    },
    {
      key: "spinBase",
      label: "Wobble spin",
      group: "motion",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.25,
      hint: "Base rotation speed of the edge waves",
    },
    {
      key: "spinEnergy",
      label: "Spin energy",
      group: "reaction",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.35,
      hint: "Extra wave rotation as the track gets louder",
    },
    {
      key: "coreBright",
      label: "Core brightness",
      group: "glow",
      min: 0,
      max: 0.8,
      step: 0.02,
      default: 0.35,
      hint: "How much the core lights up with loudness",
    },
    {
      key: "detailRing",
      label: "Detail ring",
      group: "shape",
      control: "toggle",
      mod: "off",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Thin waveform hairline inside the core",
    },
    {
      key: "detailPos",
      label: "Detail position",
      group: "shape",
      min: 0.2,
      max: 0.9,
      step: 0.01,
      default: 0.55,
      hint: "Where the hairline sits inside the core",
    },
    {
      key: "beatBloom",
      label: "Beat bloom",
      group: "reaction",
      min: 0,
      max: 0.4,
      step: 0.01,
      default: 0.1,
      hint: "Core brightness flash on each beat",
    },
    {
      key: "coverMix",
      label: "Cover blend",
      group: "image",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.85,
      hint: "How strongly the cover art replaces the core's fill",
    },
    {
      key: "coverBright",
      label: "Cover brightness",
      group: "image",
      min: 0.1,
      max: 2,
      step: 0.05,
      default: 0.9,
      hint: "Brightness of the cover art inside the core",
    },
    {
      key: "coverFit",
      label: "Image fit",
      group: "image",
      control: "enum",
      mod: "off",
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
      hint: "Fill (crops to the core) / Fit (whole image, no crop) / Stretch (distorts to fill)",
    },
    {
      key: "coverZoom",
      label: "Image zoom",
      group: "image",
      min: 0.25,
      max: 3,
      step: 0.01,
      default: 1,
      hint: "Scale the image inside the core — zoom in on the part you want",
    },
    {
      key: "coverX",
      label: "Image X",
      group: "image",
      min: -0.5,
      max: 0.5,
      step: 0.005,
      default: 0,
      hint: "Slide the image sideways inside the core",
    },
    {
      key: "coverY",
      label: "Image Y",
      group: "image",
      min: -0.5,
      max: 0.5,
      step: 0.005,
      default: 0,
      hint: "Slide the image up or down inside the core",
    },
    {
      key: "rimBright",
      label: "Core rim",
      group: "glow",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.7,
      hint: "Glowing rim around the core — pulses with the music so the core reads as the beat anchor",
    },
    {
      key: "vignette",
      label: "Vignette",
      group: "backdrop",
      tier: "curated",
      min: 0,
      max: 1.2,
      step: 0.05,
      default: 0.5,
      hint: "Darkening toward the screen corners",
    },
  ],
  wgsl: /* wgsl */ `
${WGSL_COLOR_CONTROLS}

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

  // Background wash. The max() is load-bearing: r reaches ~1.02 in the corners
  // of a 16:9 frame and 1.27 at 21:9, where a bare (1.0 - r * 0.8) goes
  // NEGATIVE and the wash starts subtracting light from whatever is behind the
  // preset instead of fading out against it.
  var col = presetColor(P_hue() + 60.0, 0.5, 0.04 + u.mid * 0.04) * max(1.0 - r * 0.8, 0.0);

  // Radial bar body
  let inBar = step(inner, r) * step(r, inner + len);
  let radial = (r - inner) / max(len, 0.001);
  col = mix(col, presetColor(barHue, 0.85, 0.35 + radial * 0.35), inBar);

  // Glow beyond bar tip
  let tip = inner + len;
  let fall = exp(-max(r - tip, 0.0) * (18.0 - P_glow() * 12.0));
  col += presetColor(barHue, 0.9, 0.5) * fall * P_glow() * v * step(tip, r);

  // Peak arc (toggleable)
  let pkR = softLimit(inner + pk * P_barLen(), frameReach(screenA));
  col += presetColor(barHue, 0.3, 0.9) * smoothstep(0.005, 0.0, abs(r - pkR)) * 0.8
       * step(0.5, P_peaks());

  // Core disc: geometry rides only slow signals — fast bands jitter,
  // energy glides. One slow-rotating dominant mode; amplitude on the slow
  // envelope; hard clamp keeps the core inside the bar ring.
  let pump = 1.0 + (u.drive * P_corePump() + beatP * P_coreBeat()) * u.pulse;
  let coreR = inner * P_coreSize() * pump;
  // What multiplies u.time is params-only. With u.drive inside the rate the
  // wave phase was t*v(t), not the integral of v, so every transient whipped
  // the crests by t*(rate change) — a fraction of a radian early in a track,
  // several radians two minutes in. Loudness now adds a BOUNDED phase offset:
  // it still visibly stirs the waves, and the error no longer grows with time.
  // Both terms stay behind Motion->Rotation (u.spin), as before, so Rotation 0
  // still means a dead-still edge.
  let spin = (u.time * P_spinBase() + u.drive * P_spinEnergy() * 3.0) * u.spin;
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
  var coreFill = presetColor(P_hue() + 30.0, 0.75, coreL);
  if (P_cover() > 0.5 && hasCover()) {
    // Map the core disc to the image using the MAXIMUM the wavy edge can
    // reach (coreR + wobble limit), not the resting radius: mapping to the
    // resting radius sampled past the image at every bulge and drew a ring
    // of clamped edge color (audit R9). The art stays perfectly still —
    // only the mask breathes — so the cover reads as a stable anchor while
    // everything around it moves.
    let artR = max(softLimit(coreR + lim, frameCircle()), 1e-3);
    let box = vec2f(p.x / artR, p.y / artR) * 0.5 + vec2f(0.5);
    // The core is a disc (square box), so a non-square image needs fitting or
    // it stretches — see fitUV.
    let cuv = fitUV(box, coverAspect(), 1.0, P_coverFit(), P_coverZoom(),
                    vec2f(P_coverX(), P_coverY()));
    if (inBox(cuv)) {
      // Loudness lift + beat bloom keep the art alive without recoloring it.
      let art = coverSample(cuv).rgb * P_coverBright()
              * (0.85 + u.drive * P_coreBright() + beatP * P_beatBloom());
      coreFill = mix(coreFill, art, P_coverMix());
    }
  }
  col = mix(col, coreFill, core);
  // Pulsing rim on the core edge (rework): the old bare edge left the core
  // reading as an unexplained blob — a rim that swells on the grid beat and
  // with loudness makes it legible as THE beat anchor, cover or no cover.
  let rim = exp(-abs(r - coreEdge) * 80.0);
  col += presetColor(P_hue() + 15.0, 0.85, 0.6) * rim * P_rimBright()
       * (0.45 + u.drive * 0.55 + beatP * 0.7);

  // Thin waveform detail ring inside the core: fast micro-motion reads as
  // "alive" on a hairline without deforming the silhouette
  if (P_detailRing() > 0.5) {
    let wr = coreR * P_detailPos() + waveAt(fract(a / TAU + 0.5)) * 0.02;
    col += presetColor(P_hue() + 50.0, 0.6, 0.65) * smoothstep(0.004, 0.0, abs(r - wr)) * core * 0.5;
  }

  // Vignette. Clamped at zero because r*r reaches ~1.04 in the corners of a
  // 16:9 frame (1.61 at 21:9) while Vignette goes to 1.2 — the bare
  // 1.0 - r*r*amt lands at -0.25 there, and a negative multiplier makes the
  // corners SUBTRACT light, denting the backdrop below black.
  col *= max(1.0 - r * r * P_vignette(), 0.0);
  // NOTE: no global r=0.5 fade here. Frame-safety is enforced GEOMETRICALLY —
  // bar length, peak arc and core are all soft-limited against the frame above
  // (softLimit against frameReach/frameCircle, so they approach the border and
  // never slice along it) — so a full-field multiply is redundant. It also cut
  // the background wash and the tip glow off at r=0.5, which is well inside a
  // 16:9 frame (corners reach r~1.02) and showed up as a hard black circle
  // around the burst.
  // The final max() is the same rule as the vignette: this preset must never
  // hand the compositor a negative channel to subtract from the background.
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
