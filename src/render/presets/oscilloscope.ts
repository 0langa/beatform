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
 */
export const oscilloscope: PresetDef = {
  id: "oscilloscope",
  name: "Oscilloscope",
  description: "The raw sound wave as a stable lab-scope trace, phase-locked so it stands still.",
  styles: [
    { id: "neon", name: "Neon Green", values: {} },
    { id: "amber", name: "Amber CRT", values: { hue: 40, scanline: 0.2, fill: 0, glow: 0.35 } },
    { id: "vapor", name: "Vapor", values: { hue: 290, glow: 0.8, hueWave: 60, persist: 0.55 } },
    {
      id: "clinical",
      name: "Clinical",
      values: { hue: 200, calm: 0.9, glow: 0.2, fill: 0, mirror: 0, persist: 0 },
    },
    {
      id: "phosphor",
      name: "Phosphor",
      values: {
        hue: 120,
        calm: 0.3,
        glow: 0.6,
        fill: 0,
        mirror: 0,
        scanline: 0.3,
        gridLevel: 0.12,
        coreWidth: 0.003,
        bgLevel: 0.036,
        vignette: 0.9,
        persist: 0.68,
      },
    },
    {
      id: "hotline",
      name: "Hotline",
      values: {
        hue: 320,
        calm: 0.75,
        glow: 0.9,
        coreWidth: 0.008,
        hueWave: 40,
        ghostDim: 0.6,
        beatLift: 0.2,
        persist: 0.5,
      },
    },
    {
      id: "ecg",
      name: "Cardiogram",
      values: {
        hue: 5,
        calm: 0.12,
        glow: 0.15,
        fill: 0,
        mirror: 0,
        gridLevel: 0.18,
        coreWidth: 0.0025,
        gain: 0.74,
        hueWave: 0,
        bgLevel: 0.02,
        vignette: 0.4,
        persist: 0,
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
      default: 160,
      hint: "Color of the trace",
    },
    {
      key: "gain",
      label: "Gain",
      min: 0.2,
      max: 2,
      step: 0.05,
      default: 0.9,
      hint: "Wave height before auto-gain; higher = taller trace",
    },
    {
      key: "calm",
      label: "Calm",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.55,
      hint: "Smooths the trace — high = flowing curve, low = raw detail",
    },
    {
      key: "glow",
      label: "Glow",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      hint: "Neon halo around the trace line — a tight bloom plus a wide soft reach",
    },
    {
      key: "fill",
      label: "Fill",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Soft fill between the trace and the center line",
    },
    {
      key: "mirror",
      label: "Mirror",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Faint upside-down ghost copy of the trace",
    },
  ],
  advanced: [
    {
      key: "traceClamp",
      label: "Height limit",
      min: 0.2,
      max: 0.5,
      step: 0.01,
      default: 0.44,
      hint: "Absolute ceiling — the trace never crosses this",
    },
    {
      key: "coreWidth",
      label: "Core width",
      min: 0.001,
      max: 0.01,
      step: 0.0005,
      default: 0.0035,
      hint: "Thickness of the bright center line",
    },
    {
      key: "agFloor",
      label: "Auto-gain floor",
      min: 0.1,
      max: 1,
      step: 0.05,
      default: 0.35,
      hint: "Lower = quiet parts get amplified more",
    },
    {
      key: "agRange",
      label: "Auto-gain range",
      min: 0,
      max: 3,
      step: 0.1,
      default: 1.4,
      hint: "How strongly loudness shrinks the display gain",
    },
    {
      key: "hueWave",
      label: "Hue by wave",
      min: 0,
      max: 80,
      step: 1,
      default: 24,
      hint: "Color shifts with the wave's height and drifts gently along the sweep",
    },
    {
      key: "ghostDim",
      label: "Mirror ghost",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.35,
      hint: "Brightness of the mirrored ghost trace",
    },
    {
      key: "fillDim",
      label: "Fill strength",
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.16,
      hint: "Opacity of the under-trace fill",
    },
    {
      key: "gridLevel",
      label: "Grid level",
      min: 0,
      max: 0.3,
      step: 0.01,
      default: 0.06,
      hint: "Visibility of the background graticule",
    },
    {
      key: "scanline",
      label: "Scanlines",
      min: 0,
      max: 0.3,
      step: 0.01,
      default: 0.1,
      hint: "CRT-style horizontal line texture",
    },
    {
      key: "beatLift",
      label: "Beat lift",
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.1,
      hint: "Whole scope brightens and the beam hot-flashes on beats",
    },
    {
      key: "bgLevel",
      label: "Bg level",
      min: 0,
      max: 0.12,
      step: 0.004,
      default: 0.028,
      hint: "Background brightness",
    },
    {
      key: "vignette",
      label: "Vignette",
      min: 0,
      max: 1.2,
      step: 0.05,
      default: 0.55,
      hint: "Darkening toward the screen corners",
    },
    {
      key: "persist",
      label: "Phosphor persist",
      min: 0,
      max: 0.85,
      step: 0.02,
      default: 0.4,
      hint: "CRT afterglow — how long the beam lingers and fades between frames",
    },
    {
      key: "kaleido",
      label: "Kaleidoscope",
      min: 1,
      max: 2,
      step: 1,
      default: 1,
      hint: "Fold the trace left/right into a symmetric mirror image — 1 is off",
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

fn preset(uv: vec2f) -> vec4f {
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

  // Graticule: real lab-scope convention is 10x8 divisions with the center
  // row/column drawn brighter — not a flat even cross-hatch.
  let dv = vec2f(fuv.x * 10.0, fuv.y * 8.0);
  let gl = abs(fract(dv) - 0.5);
  var grid = smoothstep(0.05, 0.0, gl.x) + smoothstep(0.05, 0.0, gl.y);
  grid += smoothstep(0.006, 0.0, abs(fuv.x - 0.5)) * 1.6
        + smoothstep(0.006, 0.0, abs(fuv.y - 0.5)) * 1.6;
  col += hsl2rgb(P_hue(), 0.25, 0.32) * grid * P_gridLevel();

  let w = calmWave(fuv.x, P_calm()) * gain;
  // Trace height comes from Gain (× the fixed display scale); Height limit is
  // the hard ceiling. (These were a redundant pair with a separate traceAmp
  // multiplier — folded away so there's one amplitude knob, not two.)
  let amp = clamp(w * 0.34, -P_traceClamp(), P_traceClamp());
  let y = 0.5 + amp;

  // Colour drifts gently along the sweep and with wave height — a bounded
  // wobble around the user's hue rather than a full sweep, so it stays
  // inside one saturated family instead of crossing HSL's muddy mid-tones.
  let sweep = sin(fuv.x * 5.0 + u.time * 0.12) * 0.35
            + sin(fuv.x * 1.7 - u.time * 0.05) * 0.65;
  let traceHue = P_hue() + w * P_hueWave() + sweep * P_hueWave() * 0.4;

  // Main trace: crisp coloured core, then a white-hot centre so the beam
  // reads as EMITTING rather than merely being a coloured line.
  let d = abs(fuv.y - y);
  let core = smoothstep(P_coreWidth(), P_coreWidth() * 0.23, d);
  let hot = smoothstep(0.45, 0.95, core) * (0.75 + beatP * 0.5);
  var beam = hsl2rgb(traceHue, 0.85, 0.62) * core;
  beam = mix(beam, vec3f(1.0), hot);
  beam *= 1.0 + hot * 1.6;
  col += beam;

  // Two-tier glow: a tight bloom hugging the beam plus a much wider, softer
  // halo — one exp() reads as an outline, two at different reach reads as an
  // actual light source.
  let glowTight = exp(-d * (170.0 - P_glow() * 90.0));
  let glowWide = exp(-d * 22.0) * 0.45;
  col += hsl2rgb(traceHue, 0.9, 0.55) * (glowTight * 0.6 + glowWide)
       * (0.35 + P_glow() * 0.75) * (1.0 + beatP * 0.6);

  // Mirrored ghost trace (dimmer, hue-shifted) — the vertical-flip toggle;
  // unrelated to the Kaleido fold above.
  if (P_mirror() > 0.5) {
    let ym = 0.5 - amp;
    let dm = abs(fuv.y - ym);
    col += hsl2rgb(traceHue + 30.0, 0.7, 0.5) * exp(-dm * 160.0) * P_ghostDim();
  }

  // Soft fill from trace toward the center line
  if (P_fill() > 0.5) {
    let between = step(min(y, 0.5), fuv.y) * step(fuv.y, max(y, 0.5));
    let fade = 1.0 - abs(fuv.y - 0.5) / max(abs(amp), 0.001);
    col += hsl2rgb(traceHue, 0.7, 0.4) * between * clamp(fade, 0.0, 1.0) * P_fillDim();
  }

  // Gentle beat lift (no strobe)
  col *= 1.0 + beatP * P_beatLift();

  // Phosphor persistence: last frame's beam lingers and fades, like a real
  // CRT's afterglow. max(), not +=, so a STABLE trace converges to its own
  // fresh brightness instead of the trail re-brightening it forever — only a
  // shape that's still changing leaves a visible ghost. Decay is expressed
  // per SECOND (pow(.., dt*60)), not per rendered frame, so a 30 fps export
  // fades at the same track-time rate as a 60 fps preview.
  let decay = pow(clamp(P_persist(), 0.0001, 0.98), u.dt * 60.0);
  col = max(col, feedbackSample(uv).rgb * decay);

  let d2 = distance(uv, vec2f(0.5));
  col *= 1.0 - d2 * d2 * P_vignette();
  col = tonemap(col * 1.1);
  col += grain(uv, 0.012);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
