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
      hint: "Thickness of the bright center line",
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
      key: "gridLevel",
      label: "Grid level",
      group: "backdrop",
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
      key: "kaleido",
      label: "Kaleidoscope",
      group: "shape",
      control: "enum",
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

  // Graticule: real lab-scope convention is 10x8 divisions with the center
  // row/column drawn brighter — not a flat even cross-hatch.
  let dv = vec2f(fuv.x * 10.0, fuv.y * 8.0);
  let gl = abs(fract(dv) - 0.5);
  var grid = smoothstep(0.05, 0.0, gl.x) + smoothstep(0.05, 0.0, gl.y);
  grid += smoothstep(0.006, 0.0, abs(fuv.x - 0.5)) * 1.6
        + smoothstep(0.006, 0.0, abs(fuv.y - 0.5)) * 1.6;
  col += hsl2rgb(P_hue(), 0.25, 0.32) * grid * P_gridLevel() * (1.0 + beatP * P_gridBeat());

  let w = calmWave(wx, P_calm()) * gain;
  // Trace height comes from Gain (× the fixed display scale); Height limit is
  // the SOFT ceiling (v2.44 law): loud peaks compress asymptotically toward it
  // via softLimit instead of flat-topping against a hard clamp, so a maxed
  // trace approaches the frame edge smoothly with no visible clipped plateau.
  // Signed so both lobes limit symmetrically around the center line.
  let raw = w * 0.34;
  let amp = sign(raw) * softLimit(abs(raw), P_traceClamp());
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
  col += beam * P_traceBright();

  // Two-tier glow: a tight bloom hugging the beam plus a much wider, softer
  // halo — one exp() reads as an outline, two at different reach reads as an
  // actual light source.
  let glowTight = exp(-d * (170.0 - P_glow() * 90.0));
  let glowWide = exp(-d * 22.0) * 0.45;
  col += hsl2rgb(traceHue, 0.9, 0.55) * (glowTight * 0.6 + glowWide)
       * (0.35 + P_glow() * 0.75) * (1.0 + beatP * 0.6) * P_traceBright();

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
  // shape that's still changing leaves a visible ghost. Decay is expressed
  // per SECOND (pow(.., dt*60)), not per rendered frame, so a 30 fps export
  // fades at the same track-time rate as a 60 fps preview.
  //
  // ...with the exponent floored at 1.0, i.e. never FASTER than 60 fps.
  // max() unions the recent sweeps rather than adding them, and covering the
  // trace's excursion band takes a roughly frame-rate-independent NUMBER of
  // sweeps — so what decides whether the band fills is the per-frame factor,
  // not the per-second one. Above 60 fps the per-second form pushes that
  // per-frame factor toward 1 (0.6/frame at 60 fps, 0.75/frame at 120 Hz),
  // and a 120 Hz preview turned the same settings that are a clean trace at
  // 60 fps into a solid slab — the live preview disagreeing with its own
  // export. Flooring the exponent pins the trail at its authored 60 fps
  // density on high-refresh displays (it fades over less wall time there,
  // which degrades gracefully; the alternative saturates). At and below
  // 60 fps — every export frame rate — this is a no-op and the per-second
  // fade rate above is untouched.
  let decay = pow(clamp(P_persist(), 0.0001, 0.98), max(u.dt * 60.0, 1.0));
  col = max(col, feedbackSample(uv).rgb * decay);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
