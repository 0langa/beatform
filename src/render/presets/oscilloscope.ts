import type { PresetDef } from "../types";

/**
 * Time-domain oscilloscope. The pipeline phase-aligns the waveform to a
 * rising zero-crossing (real-scope trigger), so the trace stands still
 * instead of flickering. "Calm" spatially smooths the trace; auto-gain rides
 * the slow energy envelope so loud passages don't blow up the display.
 *
 * Look pass: a hot white core (not just a coloured line) with a two-tier
 * glow, a real 10x8 lab-scope graticule, colour that drifts gently along the
 * sweep, phosphor persistence via feedbackSample() so the beam leaves a
 * fading afterglow instead of snapping frame-to-frame, and an optional
 * kaleido fold for a symmetric "vector scope" look.
 *
 * Depth wave (Track B batch 3): the one-mono-trace / one-axis ceiling falls
 * without moving a default pixel. `traces` splits the beam into stacked
 * band-filtered lanes built fragment-locally from the single waveform lane
 * (see laneWave); `renderMode` swaps the beam's
 * distance field for sampled dot pips or sample-hold treads; `graticule`
 * swaps the measurement furniture; `persist` is promoted into the curated
 * tier so the motion lens has its knob. Beat-driven brightness now rides the
 * Motion Pulse master and sample density rides Detail — this mode's first
 * two master handles. Every new axis reduces to an exact IEEE identity (or a
 * branch never entered) at the factory defaults — oscilloscope.test.ts
 * proves the reachable parts, the device pixel matrix holds the rest.
 *
 * XY / Lissajous (renderer block W3): the second waveform lane arrives, and
 * with it the genre's poster shot. `display` steers the beam by the stereo
 * pair — waveXY(): left drives X, right drives Y — instead of sweeping it by
 * time: phase ellipses, Lissajous roses, and the oscilloscope-music tracks
 * that literally draw with this convention. The path is marched as chords
 * with an additive dwell term (light concentrates where the beam lingers,
 * like a real CRT), each deflection axis obeys the v2.44 soft ceiling, the
 * graticule grows a square goniometer face with phase diagonals, and
 * `xyRotate` at 45 stands mono material upright (the mid/side convention).
 * Sweep stays the default and is byte-identical: the dispatch at the top of
 * preset() is a branch never entered at the factory settings. Mono sources
 * honestly draw the x == y diagonal — the hint says so.
 */
export const oscilloscope: PresetDef = {
  id: "oscilloscope",
  name: "Oscilloscope",
  description: "The raw sound wave as a stable lab-scope trace, phase-locked so it stands still.",
  styles: [
    // Neon Green — the defaults — a filled, mirrored lab trace.
    { id: "neon", name: "Neon Green", values: {} },
    // Lissajous — kaleido fold plus long persistence: the trace draws a symmetric figure.
    {
      id: "lissajous",
      name: "Lissajous",
      values: {
        hue: 285,
        kaleido: 2,
        persist: 0.56,
        fill: 0,
        mirror: 0,
        coreWidth: 0.0015,
        glow: 0.85,
        traceBright: 1.6,
        hueWave: 55,
        gridLevel: 0.02,
        scanline: 0,
        calm: 0.35,
        bgLevel: 0.012,
        vignette: 0.8,
        beatLift: 0.16,
      },
    },
    // Amber CRT — warm phosphor tube — scanlines, graticule, ghost trace, medium afterglow.
    {
      id: "amber",
      name: "Amber CRT",
      values: {
        hue: 38,
        calm: 0.5,
        glow: 0.4,
        traceBright: 1.1,
        fill: 0,
        ghostDim: 0.5,
        scanline: 0.28,
        gridLevel: 0.14,
        gridBeat: 0.6,
        persist: 0.6,
        coreWidth: 0.004,
        hueWave: 12,
        bgLevel: 0.024,
        vignette: 0.85,
      },
    },
    // Ribbon — fill and ghost at full: a thick soft band rather than a line.
    {
      id: "ribbon",
      name: "Ribbon",
      values: {
        hue: 200,
        hueWave: 45,
        gain: 1.3,
        calm: 0.85,
        glow: 0.25,
        traceBright: 0.85,
        fillDim: 0.5,
        ghostDim: 0.7,
        coreWidth: 0.008,
        traceClamp: 0.36,
        gridLevel: 0,
        scanline: 0,
        persist: 0.2,
        bgLevel: 0.04,
        vignette: 0.5,
      },
    },
    // Laser — hairline core at max brightness on near-black, aggressive auto-gain.
    {
      id: "laser",
      name: "Laser",
      values: {
        hue: 348,
        calm: 0.18,
        glow: 1,
        traceBright: 2.2,
        coreWidth: 0.0015,
        fill: 0,
        mirror: 0,
        gridLevel: 0.02,
        scanline: 0,
        persist: 0.3,
        bgLevel: 0.008,
        vignette: 0.9,
        hueWave: 8,
        beatLift: 0.22,
        agFloor: 0.25,
        agRange: 1.9,
        traceClamp: 0.46,
      },
    },
    // Cardiogram — editorial. Low gain, low ceiling, hard graticule, no glow — a chart recorder.
    {
      id: "ecg",
      name: "Cardiogram",
      values: {
        hue: 4,
        gain: 0.7,
        calm: 0.08,
        glow: 0.1,
        traceBright: 1.2,
        fill: 0,
        mirror: 0,
        gridLevel: 0.2,
        gridBeat: 0.1,
        coreWidth: 0.0025,
        hueWave: 0,
        bgLevel: 0.02,
        vignette: 0.35,
        persist: 0,
        scanline: 0.04,
        traceClamp: 0.3,
        agFloor: 0.7,
        agRange: 0.4,
      },
    },
    // Smoke Signal — max smoothing and afterglow, thick core: one slow drifting plume.
    {
      id: "smoke",
      name: "Smoke Signal",
      values: {
        hue: 260,
        gain: 0.5,
        calm: 1,
        glow: 0.7,
        traceBright: 0.6,
        coreWidth: 0.009,
        fillDim: 0.3,
        ghostDim: 0.8,
        hueWave: 70,
        gridLevel: 0,
        scanline: 0,
        persist: 0.6,
        bgLevel: 0.008,
        vignette: 0.6,
        beatLift: 0.05,
        agFloor: 0.9,
        agRange: 0.3,
        traceClamp: 0.5,
      },
    },
    // Analyzer Bench — the tri-trace lab bench: bass/mid/treble lanes stacked
    // on graticule rows under the full reticle, each band riding its own
    // energy. Low hue-wave so every lane holds its channel colour.
    {
      id: "bench",
      name: "Analyzer Bench",
      values: {
        hue: 130,
        traces: 3,
        bandHue: 48,
        bandDim: 0.8,
        graticule: 3,
        gridLevel: 0.16,
        gridBeat: 0.5,
        scanline: 0.05,
        calm: 0.3,
        gain: 1.05,
        glow: 0.35,
        traceBright: 1.35,
        coreWidth: 0.002,
        fill: 0,
        mirror: 0,
        persist: 0.28,
        bgLevel: 0.02,
        vignette: 0.45,
        beatLift: 0.08,
        hueWave: 10,
      },
    },
    // Dot Sampler — the digital-scope dot display: discrete pips with medium
    // afterglow trails, sighted through the crosshair face.
    {
      id: "sampler",
      name: "Dot Sampler",
      values: {
        hue: 316,
        renderMode: 1,
        graticule: 2,
        gridLevel: 0.12,
        gridBeat: 0.9,
        calm: 0.4,
        glow: 0.75,
        traceBright: 1.9,
        coreWidth: 0.005,
        fill: 0,
        mirror: 0,
        persist: 0.5,
        scanline: 0,
        bgLevel: 0.012,
        vignette: 0.7,
        beatLift: 0.18,
        hueWave: 42,
      },
    },
    // Logic Analyzer — two sample-hold channels, raw signal (no Calm), no
    // graticule, crisp short afterglow: square treads and risers like a
    // digital capture. Band hue 0 keeps both channels in one phosphor colour.
    {
      id: "logic",
      name: "Logic Analyzer",
      values: {
        hue: 175,
        traces: 2,
        bandHue: 0,
        bandDim: 0.9,
        traceSpread: 0.24,
        renderMode: 2,
        graticule: 1,
        calm: 0.05,
        gain: 1.1,
        glow: 0.2,
        traceBright: 1.5,
        coreWidth: 0.0025,
        fill: 0,
        mirror: 0,
        persist: 0.12,
        scanline: 0.12,
        bgLevel: 0.016,
        vignette: 0.4,
        beatLift: 0.06,
        hueWave: 0,
        agFloor: 0.5,
        agRange: 0.9,
      },
    },
    // Fireflies — the kaleido fold's second life: dot pips folded into a
    // symmetric figure at maximum persistence, so the swarm leaves drifting
    // light trails. Same fold as Lissajous, a genuinely different instrument.
    {
      id: "fireflies",
      name: "Fireflies",
      values: {
        hue: 95,
        kaleido: 2,
        renderMode: 1,
        persist: 0.6,
        calm: 0.5,
        glow: 0.9,
        traceBright: 2,
        coreWidth: 0.004,
        fill: 0,
        mirror: 0,
        gridLevel: 0.02,
        scanline: 0,
        bgLevel: 0.008,
        vignette: 0.85,
        hueWave: 55,
        beatLift: 0.2,
      },
    },
    // Lissajous Rose — the second lane's poster shot: the beam steered by the
    // stereo channels, long persistence, angle-driven colour. A stereo track
    // draws its phase as closed figures; mono honestly draws the diagonal.
    {
      id: "xyrose",
      name: "Lissajous Rose",
      values: {
        display: 1,
        hue: 318,
        hueWave: 62,
        calm: 0.25,
        gain: 1.35,
        agFloor: 0.5,
        agRange: 0.8,
        glow: 0.85,
        traceBright: 1.9,
        coreWidth: 0.002,
        persist: 0.6,
        graticule: 1,
        gridLevel: 0,
        scanline: 0,
        bgLevel: 0.008,
        vignette: 0.8,
        beatLift: 0.15,
        fill: 0,
        mirror: 0,
      },
    },
    // Phase Scope — the goniometer bench: XY rotated 45 so mono material
    // stands upright, the reticle face with its phase diagonals, green
    // phosphor, working persistence. The lab instrument for stereo width.
    {
      id: "phase",
      name: "Phase Scope",
      values: {
        display: 1,
        xyRotate: 45,
        hue: 130,
        hueWave: 8,
        calm: 0.4,
        gain: 1.15,
        agFloor: 0.5,
        agRange: 1,
        glow: 0.45,
        traceBright: 1.35,
        coreWidth: 0.003,
        persist: 0.34,
        graticule: 3,
        gridLevel: 0.15,
        gridBeat: 0.5,
        bgLevel: 0.02,
        vignette: 0.5,
        beatLift: 0.06,
        fill: 0,
        mirror: 0,
      },
    },
    // Vector Draw — for the tracks that draw pictures: raw path (no Calm, so
    // the drawn image keeps its corners), hairline white-hot beam on bare
    // phosphor, enough afterglow to hold a figure together between frames.
    {
      id: "vectordraw",
      name: "Vector Draw",
      values: {
        display: 1,
        hue: 150,
        hueWave: 4,
        calm: 0,
        gain: 1.1,
        agFloor: 0.6,
        agRange: 0.9,
        glow: 0.55,
        traceBright: 2.1,
        coreWidth: 0.0015,
        persist: 0.44,
        graticule: 1,
        gridLevel: 0.02,
        scanline: 0,
        bgLevel: 0.008,
        vignette: 0.7,
        fill: 0,
        mirror: 0,
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
      default: 160,
      hint: "Color of the trace",
    },
    {
      key: "gain",
      label: "Gain",
      group: "reaction",
      min: 0.2,
      max: 2,
      step: 0.05,
      default: 0.9,
      hint: "Wave height before auto-gain; higher = taller trace",
    },
    {
      key: "calm",
      label: "Calm",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.55,
      hint: "Smooths the trace — high = flowing curve, low = raw detail",
    },
    {
      key: "glow",
      label: "Glow",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      hint: "Neon halo around the trace line — a tight bloom plus a wide soft reach",
    },
    {
      key: "traceBright",
      label: "Trace brightness",
      group: "glow",
      min: 0.3,
      max: 2.5,
      step: 0.05,
      default: 1,
      hint: "Overall intensity of the beam and its halo — push high for a hot laser line",
    },
    {
      key: "fill",
      label: "Fill",
      group: "shape",
      control: "toggle",
      mod: "off",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Soft fill between the trace and the center line",
    },
    {
      key: "mirror",
      label: "Mirror",
      group: "shape",
      control: "toggle",
      mod: "off",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Faint upside-down ghost copy of the trace",
    },
    {
      key: "traces",
      label: "Traces",
      group: "shape",
      control: "enum",
      mod: "off",
      options: [
        { value: 1, label: "Single", hint: "One full-range beam — the classic scope" },
        {
          value: 2,
          label: "Lows + highs",
          hint: "Two lanes: the smoothed low end below, the detail it sheds above",
        },
        {
          value: 3,
          label: "Bass / mid / treble",
          hint: "Three band lanes, each riding its own energy — the analyzer bench",
        },
      ],
      min: 1,
      max: 3,
      step: 1,
      default: 1,
      hint: "Split the beam into stacked band-filtered channels — spacing, hue step and per-channel dim live in the expert tier",
    },
    {
      key: "renderMode",
      label: "Beam mode",
      group: "shape",
      control: "enum",
      mod: "off",
      options: [
        { value: 0, label: "Vector", hint: "Continuous line — the classic CRT beam" },
        {
          value: 1,
          label: "Dots",
          hint: "Discrete sample pips, like a digital scope's dot display",
        },
        {
          value: 2,
          label: "Sample-hold",
          hint: "Staircase treads with square risers — the logic-analyzer look",
        },
      ],
      min: 0,
      max: 2,
      step: 1,
      default: 0,
      hint: "How the trace is drawn: solid beam, sampled dots, or held steps. Dot/step density rides the Motion Detail master",
    },
    {
      key: "persist",
      label: "Phosphor persist",
      group: "motion",
      min: 0,
      // Ceiling lowered from 0.85 (v2.53.0). Persistence composites with
      // max(), i.e. it UNIONS the recent sweeps; a trace on real music is a
      // dense scribble, so once the trail lives long enough for the union to
      // cover the whole excursion band the band goes flat white and the scope
      // stops reading as a scope. Measured at 60 fps on five masters spanning
      // -13.8 to -4.9 LUFS (and on the built-in groove demo): 0.60 keeps a
      // legible trace on every one, 0.64 starts filling, 0.70+ is a solid
      // slab at ANY other setting — that top third of the slider had no
      // usable position on any material. The default (0.4) and every value
      // still reachable render exactly as they did before.
      max: 0.6,
      step: 0.02,
      default: 0.4,
      hint: "CRT afterglow — how long the beam lingers and fades between frames",
    },
    {
      key: "display",
      label: "Display",
      group: "shape",
      control: "enum",
      mod: "off",
      options: [
        {
          value: 0,
          label: "Sweep",
          hint: "Time runs left to right — the classic scope trace",
        },
        {
          value: 1,
          label: "XY",
          hint: "The left channel drives X, the right drives Y — phase ellipses and Lissajous figures; mono material draws the diagonal",
        },
      ],
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      hint: "How the beam travels: swept by time, or steered by the stereo channels (XY) — the convention Lissajous figures and oscilloscope music are drawn in. Mono sources draw a diagonal line",
    },
  ],
  advanced: [
    {
      key: "traceClamp",
      label: "Height limit",
      group: "shape",
      min: 0.2,
      max: 0.5,
      step: 0.01,
      default: 0.44,
      hint: "Absolute ceiling — the trace never crosses this",
    },
    {
      key: "coreWidth",
      label: "Core width",
      group: "shape",
      min: 0.001,
      max: 0.01,
      step: 0.0005,
      default: 0.0035,
      hint: "Thickness of the bright center line (and the size of dot pips)",
    },
    {
      key: "traceSpread",
      label: "Trace spacing",
      group: "shape",
      min: 0,
      max: 0.32,
      step: 0.01,
      default: 0.25,
      hint: "How far apart the band lanes sit — 0 overlays them on one centre line. Single-trace mode ignores it",
    },
    {
      key: "agFloor",
      label: "Auto-gain floor",
      group: "reaction",
      min: 0.1,
      max: 1,
      step: 0.05,
      default: 0.35,
      hint: "Lower = quiet parts get amplified more",
    },
    {
      key: "agRange",
      label: "Auto-gain range",
      group: "reaction",
      min: 0,
      max: 3,
      step: 0.1,
      default: 1.4,
      hint: "How strongly loudness shrinks the display gain",
    },
    {
      key: "hueWave",
      label: "Hue by wave",
      group: "color",
      min: 0,
      max: 80,
      step: 1,
      default: 24,
      hint: "Color shifts with the wave's height and drifts gently along the sweep",
    },
    {
      key: "bandHue",
      label: "Band hue shift",
      group: "color",
      min: 0,
      max: 120,
      step: 1,
      default: 40,
      hint: "Hue step between band traces — bass keeps your hue, mid and treble walk this far around the wheel",
    },
    {
      key: "ghostDim",
      label: "Mirror ghost",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.35,
      hint: "Brightness of the mirrored ghost trace",
    },
    {
      key: "fillDim",
      label: "Fill strength",
      group: "glow",
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.16,
      hint: "Opacity of the under-trace fill",
    },
    {
      key: "bandDim",
      label: "Band dim",
      group: "glow",
      min: 0.25,
      max: 1,
      step: 0.05,
      default: 0.85,
      hint: "Brightness of each higher band lane relative to the one below — the bass channel is the master beam",
    },
    {
      key: "graticule",
      label: "Graticule",
      group: "backdrop",
      control: "enum",
      mod: "off",
      options: [
        { value: 0, label: "Grid", hint: "The classic 10x8 division mesh" },
        { value: 1, label: "None", hint: "Bare phosphor — no measurement furniture" },
        { value: 2, label: "Crosshair", hint: "Just the two centre axes with division ticks" },
        {
          value: 3,
          label: "Reticle",
          hint: "Full mesh plus fine ticks and an edge frame — the lab instrument",
        },
      ],
      min: 0,
      max: 3,
      step: 1,
      default: 0,
      hint: "Which measurement furniture the screen wears — Grid level sets how bright, and the beat flash still applies",
    },
    {
      key: "gridLevel",
      label: "Grid level",
      group: "backdrop",
      tier: "curated",
      min: 0,
      max: 0.3,
      step: 0.01,
      default: 0.06,
      hint: "Visibility of the background graticule",
    },
    {
      key: "gridBeat",
      label: "Graticule beat flash",
      group: "backdrop",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.4,
      hint: "Graticule lines brighten on each beat — subtle life in the grid",
    },
    {
      key: "scanline",
      label: "Scanlines",
      group: "backdrop",
      min: 0,
      max: 0.3,
      step: 0.01,
      default: 0.1,
      hint: "CRT-style horizontal line texture",
    },
    {
      key: "beatLift",
      label: "Beat lift",
      group: "reaction",
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.1,
      hint: "Whole scope brightens and the beam hot-flashes on beats",
    },
    {
      key: "bgLevel",
      label: "Bg level",
      group: "backdrop",
      min: 0,
      max: 0.12,
      step: 0.004,
      default: 0.028,
      hint: "Background brightness",
    },
    {
      key: "vignette",
      label: "Vignette",
      group: "backdrop",
      min: 0,
      max: 1.2,
      step: 0.05,
      default: 0.55,
      hint: "Darkening toward the screen corners",
    },
    {
      key: "kaleido",
      label: "Kaleidoscope",
      group: "shape",
      control: "enum",
      mod: "off",
      options: [
        { value: 1, label: "Off" },
        { value: 2, label: "Mirrored" },
      ],
      min: 1,
      max: 2,
      step: 1,
      default: 1,
      hint: "Fold the trace left/right into a symmetric mirror image — 1 is off",
    },
    {
      key: "xyRotate",
      label: "XY rotate",
      group: "shape",
      min: 0,
      max: 360,
      step: 1,
      default: 0,
      hint: "Spin the XY figure about the centre — 45 stands mono material upright, the goniometer convention. The Sweep display ignores it",
    },
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

// Fragment-local band split, built from the SAME box-blur family the trace
// has always been conditioned with: a wider blur is a lowpass on the sweep,
// so band lanes are differences of blurs (a discretised difference-of-
// Gaussians bank). This is the whole reason multi-trace can exist inside
// this wave at all — the SWEEP face reads ONE waveform lane. (The true
// second channel has since landed as renderer ABI — the XY display below
// reads the real stereo pair via waveXY() — but the sweep bench keeps its
// band-split character: lanes by REGISTER, not by channel, each riding its
// own energy.) What the split does locally: divide the one lane by
// frequency and let each band ride its own energy uniform
// (u.bass/u.mid/u.treble), so the lanes move
// independently even though they share a window.
//   band 0 — the full-range shipped signal, untouched. The early return is
//            the single-trace neutrality guarantee: no other line runs.
//   band 1 — lows  (2-lane): everything below the treble shelf
//   band 2 — highs (2-lane top, 3-lane treble): the detail the blur sheds
//   band 3 — bass  (3-lane): the widest blur — kick and bassline only
//   band 4 — mid   (3-lane): what sits between the bass and treble cuts
// Blur offsets (+1.2 / +3.0 on top of Calm) were sized against the demo
// groove's two components (4 and 17 cycles per window): the bass cut keeps
// ~37% of the low component and ~0% of the high one; the treble residual
// keeps ~70% of the high and sheds the low. Calm stays meaningful on every
// lane — the cuts ride on top of it, so smoothing the scope smooths the
// whole bench. The floors keep quiet bands drawing a live line; the energy
// terms make each lane pump with its own register.
fn laneWave(x: f32, band: f32) -> f32 {
  let base = calmWave(x, P_calm());
  if (band < 0.5) { return base; }
  let mids = calmWave(x, P_calm() + 1.2);
  if (band < 1.5) { return mids * (0.45 + u.bass * 0.7 + u.mid * 0.35); }
  if (band < 2.5) { return (base - mids) * (0.9 + u.treble * 1.6); }
  let lows = calmWave(x, P_calm() + 3.0);
  if (band < 3.5) { return lows * (0.55 + u.bass * 1.5); }
  return (mids - lows) * (1.0 + u.mid * 1.6);
}

// One scope channel: signal in, light out. The whole beam kit — coloured
// core, white-hot centre, two-tier glow, mirror ghost, under-fill — for a
// lane centred at \`center\`, height-scaled by \`hscale\`, band-filtered by
// \`band\` (see laneWave) and dimmed by \`dim\`. \`colIn\` is threaded through BY
// VALUE and returned: the adds inside land on the running frame colour in
// exactly the order the pre-wave inline code applied them, so the
// single-trace call (center 0.5, hscale 1.0, band 0.0, hueOff 0.0, dim 1.0)
// is not merely equivalent but the same float-op sequence — IEEE addition
// does not associate, so a "sum the lane, add it once" refactor would drift
// by ulps and the pixel matrix hashes exact bytes. Every generalisation
// reduces to an exact identity at those arguments: x*1.0, x+0.0, select's
// false arm, branches not entered (proven in oscilloscope.test.ts).
fn traceLayer(colIn: vec3f, fuv: vec2f, wx: f32, xs: f32, center: f32,
              hscale: f32, band: f32, hueOff: f32, dim: f32,
              gain: f32, beatP: f32) -> vec3f {
  var col = colIn;
  let w = laneWave(wx, band) * gain;
  // Trace height comes from Gain (× the fixed display scale); Height limit is
  // the SOFT ceiling (v2.44 law): loud peaks compress asymptotically toward it
  // via softLimit instead of flat-topping against a hard clamp, so a maxed
  // trace approaches the frame edge smoothly with no visible clipped plateau.
  // Signed so both lobes limit symmetrically around the center line. The lane
  // height scale multiplies AFTER the limiter, so a stacked lane is the full
  // trace scaled into its lane — ceiling included — not a re-tuned one.
  let raw = w * 0.34;
  let amp = sign(raw) * softLimit(abs(raw), P_traceClamp()) * hscale;
  let y = center + amp;

  // Colour drifts gently along the sweep and with wave height — a bounded
  // wobble around the user's hue rather than a full sweep, so it stays
  // inside one saturated family instead of crossing HSL's muddy mid-tones.
  let sweep = sin(fuv.x * 5.0 + u.time * 0.12) * 0.35
            + sin(fuv.x * 1.7 - u.time * 0.05) * 0.65;
  let traceHue = P_hue() + hueOff + w * P_hueWave() + sweep * P_hueWave() * 0.4;

  // The beam's distance field. Vector mode: vertical distance to the
  // continuous trace — the shipped scope. Dots and Sample-hold swap in a
  // sampled field below; the core/hot/glow chain downstream is shared, so a
  // beam mode changes WHERE the beam is, never what the beam is made of.
  var d = abs(fuv.y - y);
  // Ghost and fill follow the drawn profile (yP/ampP), so in the sampled
  // modes the furniture tracks what is actually on screen.
  var yP = y;
  var ampP = amp;
  // Dot pips read at ~2.6x the vector core width — a hairline dot is just
  // noise. select's false arm hands the untouched accessor through, so the
  // vector beam never sees the factor.
  let cw = select(P_coreWidth(), P_coreWidth() * 2.6,
                  P_renderMode() > 0.5 && P_renderMode() < 1.5);
  if (P_renderMode() > 0.5) {
    // Sampled display: quantize the sweep. Density rides the Motion Detail
    // master (u.detail) — this mode's first Detail handle; the floor keeps a
    // recognisable trace at Detail 0. Dots sample finer than treads: pips
    // can sit shoulder to shoulder, treads need width to read as held.
    let n = max(floor(select(96.0, 44.0, P_renderMode() > 1.5) * u.detail), 6.0);
    let cell = floor(wx * n);
    let hw = laneWave(clamp((cell + 0.5) / n, 0.0, 0.9999), band) * gain;
    let hraw = hw * 0.34;
    let hamp = sign(hraw) * softLimit(abs(hraw), P_traceClamp()) * hscale;
    yP = center + hamp;
    ampP = hamp;
    if (P_renderMode() < 1.5) {
      // Dots: round pips at this cell's sample and both neighbours, so the
      // field is continuous across cell edges and halos overlap honestly.
      // xs converts sweep-space dx into the same screen-height units d is
      // measured in (aspect, plus the kaleido fold's 2x compression).
      var dd = 1000.0;
      for (var i = -1.0; i < 1.5; i += 1.0) {
        let sx = (cell + i + 0.5) / n;
        let sw = laneWave(clamp(sx, 0.0, 0.9999), band) * gain;
        let sraw = sw * 0.34;
        let sy = center + sign(sraw) * softLimit(abs(sraw), P_traceClamp()) * hscale;
        dd = min(dd, length(vec2f((wx - sx) * xs, fuv.y - sy)));
      }
      d = dd;
    } else {
      // Sample-hold: a flat tread across this cell...
      d = abs(fuv.y - yP);
      // ...joined to the nearer neighbour by a vertical riser, so level
      // changes read as square logic edges instead of torn gaps.
      let side = select(-1.0, 1.0, fract(wx * n) > 0.5);
      let bx = (cell + 0.5 + side * 0.5) / n;
      let nw = laneWave(clamp((cell + side + 0.5) / n, 0.0, 0.9999), band) * gain;
      let nraw = nw * 0.34;
      let ny = center + sign(nraw) * softLimit(abs(nraw), P_traceClamp()) * hscale;
      let dy = max(max(min(yP, ny) - fuv.y, fuv.y - max(yP, ny)), 0.0);
      d = min(d, length(vec2f((wx - bx) * xs, dy)));
    }
  }

  // Main trace: crisp coloured core, then a white-hot centre so the beam
  // reads as EMITTING rather than merely being a coloured line. Beat-driven
  // brightness rides the Motion Pulse master — an exact 1x at its default.
  let core = smoothstep(cw, cw * 0.23, d);
  let hot = smoothstep(0.45, 0.95, core) * (0.75 + beatP * 0.5 * u.pulse);
  var beam = hsl2rgb(traceHue, 0.85, 0.62) * core;
  beam = mix(beam, vec3f(1.0), hot);
  beam *= 1.0 + hot * 1.6;
  col += beam * P_traceBright() * dim;

  // Two-tier glow: a tight bloom hugging the beam plus a much wider, softer
  // halo — one exp() reads as an outline, two at different reach reads as an
  // actual light source.
  let glowTight = exp(-d * (170.0 - P_glow() * 90.0));
  let glowWide = exp(-d * 22.0) * 0.45;
  col += hsl2rgb(traceHue, 0.9, 0.55) * (glowTight * 0.6 + glowWide)
       * (0.35 + P_glow() * 0.75) * (1.0 + beatP * 0.6 * u.pulse) * P_traceBright() * dim;

  // Mirrored ghost trace (dimmer, hue-shifted) — the vertical-flip toggle;
  // unrelated to the Kaleido fold. Mirrors about the LANE centre, and in the
  // sampled beam modes about the drawn profile.
  if (P_mirror() > 0.5) {
    let ym = center - ampP;
    let dm = abs(fuv.y - ym);
    col += hsl2rgb(traceHue + 30.0, 0.7, 0.5) * exp(-dm * 160.0) * P_ghostDim() * dim;
  }

  // Soft fill from trace toward the lane's center line
  if (P_fill() > 0.5) {
    let between = step(min(yP, center), fuv.y) * step(fuv.y, max(yP, center));
    let fade = 1.0 - abs(fuv.y - center) / max(abs(ampP), 0.001);
    col += hsl2rgb(traceHue, 0.7, 0.4) * between * clamp(fade, 0.0, 1.0) * P_fillDim() * dim;
  }
  return col;
}

// ---- XY / Lissajous display (the second waveform lane's payoff) -----------
// One smoothed stereo path sample: the same box-blur family the sweep trace
// is conditioned with (calmWave), applied to BOTH channels of the pair, so
// Calm keeps one meaning across the two displays. Three taps rather than
// five: the chord rendering below is itself a low-pass on the figure, and
// this runs inside a per-fragment loop where every tap is three more
// (uniform, cache-hot) buffer reads.
fn xyPoint(t: f32, calm: f32) -> vec2f {
  let spread = calm * 0.014;
  return waveXY(t) * 0.4 + (waveXY(t - spread) + waveXY(t + spread)) * 0.3;
}

// A path sample as screen deflection: gain, then the v2.44 soft ceiling PER
// AXIS — a real scope's X and Y amplifiers limit independently — so a hot
// master compresses toward the frame instead of clipping through it. Units
// are frame heights, like the sweep trace's amp.
fn xyDeflect(t: f32, calm: f32, g: f32) -> vec2f {
  let s = xyPoint(t, calm) * g * 0.44;
  return vec2f(
    sign(s.x) * softLimit(abs(s.x), P_traceClamp()),
    sign(s.y) * softLimit(abs(s.y), P_traceClamp()),
  );
}

// The XY face: the beam steered by the channels instead of swept by time —
// left drives X, right drives Y, the oscilloscope-music convention (mono
// material draws the x == y diagonal, honestly). The path is marched as
// chords between successive stereo samples with an additive dwell term, so
// light concentrates where the beam moves slowly and crossings genuinely
// brighten — the two behaviours that make a real XY scope read as a beam
// rather than a plotted line. Everything else is the sweep face's grammar:
// auto-gain, the beam kit's constants, the furniture, the finish-then-union
// order, the same persistence law.
fn xyScope(uv: vec2f) -> vec4f {
  // Furniture frame: centered, aspect-corrected, kaleido-folded like the
  // sweep face. The graticule is screen furniture, so it does NOT rotate.
  let gf = kaleido(centered(uv), P_kaleido());
  // Beam frame: XY rotate spins the figure about the centre; 45 stands mono
  // material upright — the goniometer (mid/side) convention.
  let fr = rot2(P_xyRotate() * (TAU / 360.0)) * gf;

  // Auto-gain and the tempo-locked pulse, exactly as the sweep face rides them.
  let gxy = P_gain() / (P_agFloor() + u.drive * P_agRange());
  let beatP = max(u.driveBeat, gridPulse(8.0));

  // Background + scanlines: the same face the sweep display wears.
  var col = hsl2rgb(P_hue() + 40.0, 0.4, P_bgLevel() + u.bass * 0.02);
  col *= (1.0 - P_scanline()) + P_scanline() * (0.5 + 0.5 * sin(uv.y * 400.0));

  // Graticule, XY voice: square divisions about the centre (a phase scope's
  // face is square, not 10x8). Same four faces, same light: Grid level sets
  // brightness and the beat flash rides the Pulse master.
  let gv = gf * 8.0;
  var mesh = 0.0;
  if (P_graticule() < 0.5) {
    let gl = abs(fract(gv) - 0.5);
    mesh = smoothstep(0.05, 0.0, gl.x) + smoothstep(0.05, 0.0, gl.y);
    mesh += (smoothstep(0.006, 0.0, abs(gf.x)) + smoothstep(0.006, 0.0, abs(gf.y))) * 1.6;
  } else if (P_graticule() > 2.5) {
    // Reticle: the mesh, the centre axes, and the two phase diagonals — the
    // in-phase / anti-phase reference lines a goniometer face carries.
    let gl = abs(fract(gv) - 0.5);
    mesh = smoothstep(0.05, 0.0, gl.x) + smoothstep(0.05, 0.0, gl.y);
    mesh += (smoothstep(0.006, 0.0, abs(gf.x)) + smoothstep(0.006, 0.0, abs(gf.y))) * 1.6;
    mesh += (smoothstep(0.005, 0.0, abs(gf.x - gf.y) * 0.7071)
          + smoothstep(0.005, 0.0, abs(gf.x + gf.y) * 0.7071)) * 0.9;
  } else if (P_graticule() > 1.5) {
    // Crosshair: the two centre axes with a tick at every division.
    mesh = (smoothstep(0.006, 0.0, abs(gf.x)) + smoothstep(0.006, 0.0, abs(gf.y))) * 1.6;
    mesh += smoothstep(0.05, 0.0, abs(fract(gv.x) - 0.5)) * smoothstep(0.02, 0.008, abs(gf.y));
    mesh += smoothstep(0.05, 0.0, abs(fract(gv.y) - 0.5)) * smoothstep(0.02, 0.008, abs(gf.x));
  }
  col += hsl2rgb(P_hue(), 0.25, 0.32) * mesh * P_gridLevel() * (1.0 + beatP * P_gridBeat() * u.pulse);

  // The path march. Chord count rides the Motion Detail master; the floor
  // keeps a readable figure at Detail 0. Every path tap is at a
  // fragment-independent t, so the storage reads are uniform (broadcast)
  // loads — the per-fragment cost is the distance math alone.
  let nSeg = max(floor(120.0 * u.detail), 24.0);
  // Dots reuses the sweep's pip sizing; Sample-hold has no XY meaning and
  // honestly reads as dots too.
  let dots = P_renderMode() > 0.5;
  let cwXY = P_coreWidth() * select(1.0, 2.6, dots);
  // Glow widens the dwell halo, the same lever it is on the sweep beam.
  let dwellK = 140.0 - P_glow() * 60.0;
  var dmin = 1000.0;
  var dgh = 1000.0;
  var dwell = 0.0;
  var prev = xyDeflect(0.0, P_calm(), gxy);
  for (var i = 1.0; i <= nSeg; i += 1.0) {
    let cur = xyDeflect(i / nSeg, P_calm(), gxy);
    var dd = 0.0;
    if (dots) {
      dd = length(fr - cur);
    } else {
      let pa = fr - prev;
      let ba = cur - prev;
      let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-7), 0.0, 1.0);
      dd = length(pa - ba * h);
    }
    dmin = min(dmin, dd);
    // Dwell: each chord leaves one parcel of light in its own exp() halo, so
    // where the beam lingers (short, bunched chords) the parcels stack and
    // the figure brightens — a real CRT's speed response.
    dwell += exp(-dd * dwellK);
    if (P_mirror() > 0.5) { dgh = min(dgh, length(vec2f(fr.x, -fr.y) - cur)); }
    prev = cur;
  }
  // Normalised by chord count so Detail changes resolution, not brightness.
  let energy = dwell * (26.0 / nSeg);

  // The beam kit, XY voice: colour drifts with the angle about the centre —
  // a bounded wobble around the user's hue, like the sweep's drift along x.
  let hueXY = P_hue() + atan2(fr.y, fr.x) * (P_hueWave() * 0.16)
            + sin(u.time * 0.11) * P_hueWave() * 0.35;
  let coreXY = smoothstep(cwXY, cwXY * 0.23, dmin);
  let hotXY = smoothstep(0.45, 0.95, coreXY) * (0.75 + beatP * 0.5 * u.pulse);
  var beamXY = hsl2rgb(hueXY, 0.85, 0.62) * coreXY;
  beamXY = mix(beamXY, vec3f(1.0), hotXY);
  beamXY *= 1.0 + hotXY * 1.6;
  col += beamXY * P_traceBright();

  // Two-tier glow: the dwell energy IS the tight bloom (it already hugs the
  // path); the wide soft halo reads off the nearest approach.
  let glowWideXY = exp(-dmin * 22.0) * 0.45;
  col += hsl2rgb(hueXY, 0.9, 0.55) * (energy * 0.6 + glowWideXY)
       * (0.35 + P_glow() * 0.75) * (1.0 + beatP * 0.6 * u.pulse) * P_traceBright();

  // Anti-phase ghost — this face's voice of the same ghost-trace toggle
  // (RP-7: the mirror key means ghost trace here, never a fold): the figure
  // with its right channel inverted, dim and hue-shifted.
  if (P_mirror() > 0.5) {
    col += hsl2rgb(hueXY + 30.0, 0.7, 0.5) * exp(-dgh * 160.0) * P_ghostDim();
  }

  // Gentle beat lift, then the finishing kit BEFORE the persistence union —
  // the law the sweep face settled: a pixel is graded exactly once, in the
  // frame it was fresh, and the loop that carries it afterwards stays the
  // pure per-second decay.
  col *= 1.0 + beatP * P_beatLift() * u.pulse;
  let dv2 = distance(uv, vec2f(0.5));
  col *= 1.0 - dv2 * dv2 * P_vignette();
  col = tonemap(col * 1.1);
  col += grain(uv, 0.012);
  let decayXY = pow(clamp(P_persist(), 0.0001, 0.98), u.dt * 60.0);
  col = max(col, feedbackSample(uv).rgb * decayXY);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}

fn preset(uv: vec2f) -> vec4f {
  // Display dispatch. XY is a wholly separate face; everything below this
  // line is the shipped sweep scope, textually untouched. display defaults
  // to Sweep (0), so the branch is never entered at the factory settings —
  // the single-trace neutrality guarantee extends to the whole wave.
  if (P_display() > 0.5) { return xyScope(uv); }
  // Kaleidoscope fold — a SEPARATE knob from Mirror (the vertical ghost
  // trace below): this folds the whole screen left/right into a symmetric
  // "vector scope" look. Capped at 2 (bilateral only, not a full radial
  // kaleidoscope): the trace is a left-to-right sweep, not an inherently
  // radial scene like Tunnel, so higher wedge counts would just chop it into
  // arbitrary slices instead of reading as a designed pattern. At 1 (default)
  // kaleido() passes p through unchanged, so fuv == uv exactly and the stock
  // trace is byte-identical.
  let kp = kaleido(centered(uv), P_kaleido());
  let fuv = vec2f(kp.x / u.aspect + 0.5, kp.y + 0.5);

  // The sweep coordinate, which is NOT fuv.x once the fold is on.
  //
  // kaleido() returns abs(p.x) at 2, so fuv.x lands in [0.5, 1]: the right half
  // of the frame, reflected onto the left. Correct for the GEOMETRY — that is
  // what the fold is for, and the graticule and the hue drift below rightly
  // follow it — but calmWave()/waveAt() index the waveform BUFFER with it, so
  // the folded trace only ever drew the buffer's second half. Two things are
  // wrong with that, and only the second is the one this preset shares with the
  // spectrum modes:
  //
  //   1. The dropped half is the one with the trigger in it. The pipeline
  //      phase-aligns sample 0 to a rising zero crossing precisely so the trace
  //      stands still, and index 0.5 is an arbitrary sample of arbitrary value.
  //      That sample lands at fuv.x = 0.5 — the mirror line, the apex of the
  //      symmetric figure, and the graticule's own bright centre column, i.e.
  //      the single most prominent point in the frame. The figure's spine
  //      therefore hinged on the one place in the buffer the trigger does NOT
  //      hold still, and Lissajous' long persistence smeared that jitter.
  //   2. Half the sweep was unrenderable at that setting: the folded scope drew
  //      strictly less of the waveform than the unfolded one, in the same area.
  //
  // Rescaling the visible half back onto the whole buffer fixes both — every
  // sample is drawn, and buffer index 0 sits at the mirror line, so the figure
  // is anchored at the trigger's zero crossing, dead centre of the graticule.
  //
  // "Whole buffer per wedge" is not automatic here the way it is for a
  // spectrum: a spectrum index that cannot reach a bin is deaf to that
  // frequency forever, whereas both halves of a waveform window carry the same
  // frequencies, so the case has to be made on the trigger and on wasted screen
  // rather than on deafness. The cost is real and is the reason it needs
  // making: the sweep now runs at twice the samples per pixel. That is
  // affordable and was measured — the buffer is 512 points, so a folded half of
  // a 1280-wide export still spends 1.25 px on each point, and waveAt()
  // interpolates between them, so the trace stays a resolved line rather than a
  // dotted one. Calm is deliberately NOT rescaled to compensate: it is a filter
  // on the SIGNAL (a box blur in buffer units), and a filter that changed its
  // cutoff because the display folded would be the same category of mistake as
  // this one.
  //
  // Seam-free by construction — the fold is a mirror, so wx meets itself at the
  // mirror line — and at kaleido 1 select() returns fuv.x untouched, so the
  // unfolded trace is bit-identical.
  let wx = select(fuv.x, (fuv.x - 0.5) * 2.0, P_kaleido() >= 1.5);

  // Auto-gain: normalize display height against the slow envelope, so quiet
  // and loud passages fill a similar, stable portion of the screen.
  let gain = P_gain() / (P_agFloor() + u.drive * P_agRange());
  // Tempo-locked pulse: lands on the beat grid when the track has one, real
  // transients still punch through off-grid.
  let beatP = max(u.driveBeat, gridPulse(8.0));

  // Background: near-black, subtle bass tint. Scanlines are a DISPLAY
  // property, not scene content, so they key off the raw screen uv, not the
  // kaleido-folded one.
  var col = hsl2rgb(P_hue() + 40.0, 0.4, P_bgLevel() + u.bass * 0.02);
  // 0.5 + 0.5*sin, not raw sin: raw sin spans -1..1, so half of every scanline
  // cycle drove the multiplier negative and clipped to black instead of
  // modulating brightness.
  col *= (1.0 - P_scanline()) + P_scanline() * (0.5 + 0.5 * sin(uv.y * 400.0));

  // Graticule. Grid is the shipped default — real lab-scope convention, 10x8
  // divisions with the center row/column drawn brighter, not a flat even
  // cross-hatch. The other faces swap the furniture, never the light: every
  // face keys off Grid level for brightness and pulses with the beat flash
  // (which now rides the Motion Pulse master — exact 1x at its default).
  var grid = 0.0;
  if (P_graticule() < 0.5) {
    let dv = vec2f(fuv.x * 10.0, fuv.y * 8.0);
    let gl = abs(fract(dv) - 0.5);
    grid = smoothstep(0.05, 0.0, gl.x) + smoothstep(0.05, 0.0, gl.y);
    grid += smoothstep(0.006, 0.0, abs(fuv.x - 0.5)) * 1.6
          + smoothstep(0.006, 0.0, abs(fuv.y - 0.5)) * 1.6;
  } else if (P_graticule() > 2.5) {
    // Full reticle: the mesh, the doubled centre axes, fine 5-per-division
    // minor ticks along both axes, and a measurement frame at the edge.
    let dv = vec2f(fuv.x * 10.0, fuv.y * 8.0);
    let gl = abs(fract(dv) - 0.5);
    grid = smoothstep(0.05, 0.0, gl.x) + smoothstep(0.05, 0.0, gl.y);
    grid += smoothstep(0.006, 0.0, abs(fuv.x - 0.5)) * 1.6
          + smoothstep(0.006, 0.0, abs(fuv.y - 0.5)) * 1.6;
    grid += smoothstep(0.02, 0.0, abs(fract(fuv.x * 50.0) - 0.5))
          * smoothstep(0.014, 0.005, abs(fuv.y - 0.5)) * 0.9;
    grid += smoothstep(0.02, 0.0, abs(fract(fuv.y * 40.0) - 0.5))
          * smoothstep(0.022, 0.008, abs(fuv.x - 0.5)) * 0.9;
    let edge = min(min(fuv.x, 1.0 - fuv.x), min(fuv.y, 1.0 - fuv.y));
    grid += smoothstep(0.004, 0.0, edge) * 1.2;
  } else if (P_graticule() > 1.5) {
    // Crosshair: just the two centre axes with a tick at every division —
    // the measurement look with the mesh stripped away.
    grid = (smoothstep(0.006, 0.0, abs(fuv.x - 0.5))
          + smoothstep(0.006, 0.0, abs(fuv.y - 0.5))) * 1.6;
    grid += smoothstep(0.05, 0.0, abs(fract(fuv.x * 10.0) - 0.5))
          * smoothstep(0.02, 0.008, abs(fuv.y - 0.5));
    grid += smoothstep(0.05, 0.0, abs(fract(fuv.y * 8.0) - 0.5))
          * smoothstep(0.032, 0.013, abs(fuv.x - 0.5));
  }
  // Face 1 (None) is bare phosphor: grid stays 0.0 and the add below is an
  // exact +0 at every pixel.
  col += hsl2rgb(P_hue(), 0.25, 0.32) * grid * P_gridLevel() * (1.0 + beatP * P_gridBeat() * u.pulse);

  // Sweep-space -> screen-height conversion for the sampled beam modes:
  // aspect makes dot pips round, and the kaleido fold halves the screen run
  // of one sweep unit.
  let xs = select(1.0, 0.5, P_kaleido() >= 1.5) * u.aspect;

  // The channel deck. Single is the shipped scope, drawn by the same call
  // chain at exact-identity arguments. The stacked layouts put lane centres
  // at 0.5 +/- spacing — the default 0.25 offsets each lane baseline exactly
  // two graticule divisions from the centre row (the same phase the centre
  // line itself holds against the mesh, whose painted lines sit at the
  // half-division offsets), the way a bench scope parks channels whole
  // divisions apart; spacing 0 overlays every lane on the centre line. Lanes
  // draw at 0.55 height so stacked excursions stay in lane at typical
  // levels and interleave softly (additive light) at extremes. Bass anchors
  // the deck — bottom lane, the user's hue, full brightness; each higher
  // band steps bandHue around the wheel and bandDim down in brightness.
  if (P_traces() < 1.5) {
    col = traceLayer(col, fuv, wx, xs, 0.5, 1.0, 0.0, 0.0, 1.0, gain, beatP);
  } else if (P_traces() < 2.5) {
    let sp = P_traceSpread();
    col = traceLayer(col, fuv, wx, xs, 0.5 + sp, 0.55, 1.0, 0.0, 1.0, gain, beatP);
    col = traceLayer(col, fuv, wx, xs, 0.5 - sp, 0.55, 2.0, P_bandHue(), P_bandDim(), gain, beatP);
  } else {
    let sp = P_traceSpread();
    col = traceLayer(col, fuv, wx, xs, 0.5 + sp, 0.55, 3.0, 0.0, 1.0, gain, beatP);
    col = traceLayer(col, fuv, wx, xs, 0.5, 0.55, 4.0, P_bandHue(), P_bandDim(), gain, beatP);
    col = traceLayer(col, fuv, wx, xs, 0.5 - sp, 0.55, 2.0, P_bandHue() * 2.0,
                     P_bandDim() * P_bandDim(), gain, beatP);
  }

  // Gentle beat lift (no strobe) — rides the Pulse master like every other
  // beat-driven brightness term.
  col *= 1.0 + beatP * P_beatLift() * u.pulse;

  // The finishing kit runs BEFORE the persistence union, not after it.
  //
  // This preset's return value IS next frame's feedbackSample(): the renderer
  // captures the raw visual and hands it back (webgpuRenderer, feedback path).
  // So a post chain applied after the union lands on the FED-BACK pixel too,
  // and every persisted frame re-applies it. What that costs is not subtle:
  //
  //   - tonemap is an S-curve, and in the dark half it LIFTS (t(0.2) = 0.30).
  //     Re-applied per frame it fights the decay, so the trail's real per-frame
  //     gain was decay x ~1.5 at 60 fps but decay x ~1.14 at 30 — the same
  //     project's afterglow measurably shorter in its 30 fps export than in its
  //     own preview, which is the one thing this app does not do.
  //   - vignette is a <=1 multiply applied once per RENDERED frame while decay
  //     is per SECOND, so a one-second-old trail took 60 vignette applications
  //     at 60 fps against 30 at 30 (0.8625^30 ~ 0.012 corner divergence at the
  //     default 0.55).
  //   - a trail pixel was therefore also darker and flatter than the brightness
  //     it was authored at, having been graded once for every frame it survived
  //     rather than once when it was drawn.
  //
  // Posting first fixes all three at once: a pixel is graded exactly once, in
  // the frame it was fresh, and the loop that carries it afterwards is the pure
  // per-second decay it was always documented to be. Echo Trails reached the
  // same place from the other direction — it keeps the vignette in the loop and
  // gives it a per-second exponent (vgFade), and drops tonemap entirely — which
  // it has to, because it ACCUMULATES with += and needs a bounded loop gain.
  // A max() union has no runaway to bound, so it can simply post first.
  //
  // Fresh beam pixels are unchanged wherever the trace dominates its own trail,
  // which is every lit pixel of the beam; the afterglow is brighter and holds
  // its authored colour, at every frame rate.
  let d2 = distance(uv, vec2f(0.5));
  col *= 1.0 - d2 * d2 * P_vignette();
  col = tonemap(col * 1.1);
  col += grain(uv, 0.012);

  // Phosphor persistence: last frame's beam lingers and fades, like a real
  // CRT's afterglow. max(), not +=, so a STABLE trace converges to its own
  // fresh brightness instead of the trail re-brightening it forever — only a
  // shape that's still changing leaves a visible ghost. Renderer advances
  // feedback history on a fixed 60 Hz state clock. Canonical ticks carry
  // u.dt=1/60; presentation-only frames carry u.dt=0 and are never copied
  // back into history. This keeps both decay RATE and sweep DENSITY invariant
  // across 24/30/60/120/144 fps without freezing fresh beam presentation.
  let decay = pow(clamp(P_persist(), 0.0001, 0.98), u.dt * 60.0);
  col = max(col, feedbackSample(uv).rgb * decay);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
