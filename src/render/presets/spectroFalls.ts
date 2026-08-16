import type { PresetDef } from "../types";
import { WGSL_COLOR_CONTROLS } from "../wgslLib";

/**
 * SPECTRO FALLS — the spectrogram waterfall as a first-class visual (P-19).
 *
 * VISUAL IDENTITY. Not an analyser readout: a river of light. The song draws
 * itself as it plays, one razor-thin slice of spectrum at a time, and the
 * picture flows away from the "now" edge — kicks print as bars along the
 * bottom, hats as bright dust along the top, a held synth as a stack of steady
 * rails, a vocal as a wandering ribbon. You can read a track's arrangement off
 * the frame without hearing it, and it stays beautiful for a whole set.
 *
 * `led-matrix`'s Waterfall display is the LITE version of this idea — a coarse
 * LED grid that happens to scroll. Here the scrolling time-frequency image is
 * the entire identity, at image resolution, with a palette and a lighting
 * model built for it: a thermal ramp whose hue TRAVELS with loudness (so one
 * hue wheel recolours the whole mode and still reads as heat), peaks that
 * desaturate to white instead of merely saturating, and a halo bled along the
 * frequency axis so a tone reads as emitting rather than printed.
 *
 * THE RECORD IS A NEGATIVE. Each pixel stores the RAW spectrum level in the
 * output's alpha channel (the composite pass derives its own alpha and never
 * reads it) and the next state advance reads it back one slice further from
 * the entry edge. Because the stored value is raw, every look knob — contrast,
 * air lift, palette, glow, age fade — is applied at DISPLAY time and therefore
 * re-develops the WHOLE visible history, not just the slices recorded after
 * the change. Turning the contrast up is a darkroom, not a wipe.
 *
 * DETERMINISM. The scroll resolves from TRACK time, never a frame counter:
 * the slice counter is floor(time * speed), and one advance shifts the record
 * by exactly the slices that counter gained over this tick's u.dt — the shared
 * fixed 60 Hz feedback clock (fixedFeedback.ts), which reports dt = 0 on
 * presentation-only frames so presentation never scrolls, it re-shows the last
 * state. History moves by WHOLE slices and is read back from the data channel,
 * so cell centres resample cell centres: no generation loss, and no bloom,
 * grain or vignette accumulating into the record. A seek simply refills the
 * frame with fresh slices.
 *
 * TONE, CALIBRATED ON REAL MUSIC. Colour follows loudness linearly so the
 * ramp reads across its whole range; BRIGHTNESS follows it squared, because
 * music puts most of its energy in the bottom two octaves and a linear ramp
 * blows that half into a flat white mass. Air lift is a SEE-SAW about the
 * middle of the axis — lifting the top also pulls the bottom down — for the
 * same reason: a one-sided boost left the bass pinned at full heat. Both were
 * measured against the shipped demo tracks on a real GPU, not guessed.
 *
 * MUSICAL BY CONSTRUCTION. The bins are log-spaced, so equal steps along the
 * frequency axis are equal frequency RATIOS — the optional grid marks real
 * musical divisions rather than decorative stripes. And each slice knows WHEN
 * it was recorded (its index is exactly how many counter steps ago it
 * entered), so the beat grid can be printed onto the record and scroll in
 * lockstep with it, anchored to the detected grid through beatPhase.
 */
export const spectroFalls: PresetDef = {
  id: "spectro-falls",
  name: "Spectro Falls",
  description:
    "The song draws itself: every moment of the spectrum prints as one thin slice and flows away from the live edge, quiet blues through white-hot peaks. Scroll it down, up or sideways, mirror the frequency axis, and let the beat grid print into the record.",
  styles: [
    // Spectro Falls — the defaults — a violet-to-ember river falling down the
    // frame with a hot live edge.
    { id: "falls", name: "Spectro Falls", values: {} },
    // Sonar — mirrored axis, bass blooming out of the centre line, slow and
    // deep. The wall of a submarine, not a studio.
    {
      id: "sonar",
      name: "Sonar",
      values: {
        axis: 1,
        direction: 1,
        slices: 220,
        speed: 20,
        hue: 168,
        hueSpread: 60,
        airLift: 0.35,
        quiet: 0.05,
        loud: 0.82,
        fade: 0.55,
        glow: 1,
        edge: 0.35,
        spill: 0.75,
        grid: 0,
        beatMarks: 0,
        bassGlow: 0.22,
        vignette: 0.6,
      },
    },
    // Tape Scroll — pitch stands up the y axis and the record runs off to the
    // left, the way an editor draws a spectrogram. Fine slices, hard contrast,
    // grid on: the honest instrument.
    {
      id: "tape",
      name: "Tape Scroll",
      values: {
        direction: 2,
        slices: 360,
        speed: 30,
        hue: 196,
        hueSpread: 150,
        airLift: 0.65,
        quiet: 0.05,
        loud: 0.95,
        glow: 0.3,
        edge: 0.4,
        fade: 0.1,
        hotWhite: 0.7,
        spill: 0.2,
        grid: 0.3,
        gridLines: 10,
        beatMarks: 0.35,
        vignette: 0.15,
      },
    },
    // Prism Rain — every frequency keeps its own hue and loudness becomes pure
    // brightness. Fast, wide, luminous: the VJ chip.
    {
      id: "prism",
      name: "Prism Rain",
      values: {
        prism: 1,
        axis: 2,
        slices: 260,
        hue: 300,
        quiet: 0.07,
        loud: 0.88,
        glow: 1.15,
        spill: 0.8,
        edge: 1.1,
        beatBoost: 0.55,
        fade: 0.4,
        hotWhite: 0.7,
        grid: 0,
        beatMarks: 0.3,
        vignette: 0.3,
      },
    },
    // Ember Drift — chunky slices rising slowly out of the dark, heavy age
    // fade, everything glowing. Ambient, and readable across a room.
    {
      id: "ember",
      name: "Ember Drift",
      values: {
        direction: 1,
        slices: 44,
        speed: 12,
        hue: 22,
        hueSpread: 45,
        airLift: 0.35,
        quiet: 0.1,
        loud: 0.92,
        glow: 1,
        spill: 0.9,
        edge: 0.5,
        fade: 0.7,
        hotWhite: 0.8,
        floorLevel: 0.055,
        bassGlow: 0.28,
        grid: 0,
        beatMarks: 0,
        vignette: 0.65,
      },
    },
    // Score — the record as sheet music: bars and beats printed across it,
    // frequency grid on, colour pulled almost out. What a producer wants.
    {
      id: "score",
      name: "Score",
      values: {
        direction: 3,
        slices: 300,
        speed: 20,
        hue: 42,
        hueSpread: 20,
        saturation: 0.35,
        airLift: 0.6,
        quiet: 0.04,
        loud: 0.92,
        glow: 0.2,
        edge: 0.3,
        fade: 0.05,
        beatBoost: 0.05,
        hotWhite: 0.85,
        spill: 0.15,
        grid: 0.45,
        gridLines: 12,
        beatMarks: 0.7,
        floorLevel: 0.02,
        vignette: 0.1,
      },
    },
  ],
  params: [
    {
      key: "direction",
      label: "Scroll",
      group: "shape",
      control: "enum",
      // A structural switch, not a performance move: modulating it would tear
      // the record's layout apart every frame (led-matrix's Display, same).
      mod: "off",
      options: [
        {
          value: 0,
          label: "Down",
          hint: "New slices enter at the top and fall — the classic waterfall",
        },
        { value: 1, label: "Up", hint: "New slices enter at the bottom and rise" },
        {
          value: 2,
          label: "Left",
          hint: "Pitch stands up the frame, the record runs off to the left",
        },
        {
          value: 3,
          label: "Right",
          hint: "Pitch stands up the frame, the record runs off to the right",
        },
      ],
      min: 0,
      max: 3,
      step: 1,
      default: 0,
      hint: "Which way the record flows — and, for the sideways pair, which axis carries pitch",
    },
    {
      key: "slices",
      label: "Time slices",
      group: "shape",
      mod: "snap",
      min: 8,
      max: 480,
      step: 1,
      default: 180,
      hint: "How many moments fill the frame: more = finer detail and a longer memory, fewer = chunky bands",
    },
    {
      key: "axis",
      label: "Frequency axis",
      group: "shape",
      control: "enum",
      // Folding the axis re-maps where each frequency LANDS; modulating it
      // would strobe the mapping. It wipes through the record as it scrolls.
      mod: "off",
      options: [
        { value: 0, label: "Low to high", hint: "Bass at one edge, air at the other" },
        {
          value: 1,
          label: "Bass centred",
          hint: "Mirrored: bass down the middle, air out to both edges",
        },
        {
          value: 2,
          label: "Air centred",
          hint: "Mirrored the other way: air down the middle, bass at both edges",
        },
      ],
      min: 0,
      max: 2,
      step: 1,
      default: 0,
      hint: "Straight, or folded into a symmetric pair",
    },
    {
      key: "speed",
      label: "Scroll speed",
      group: "motion",
      taper: "log",
      min: 2,
      max: 60,
      step: 1,
      default: 60,
      hint: "Slices per second. 60 is one slice per frame — the smoothest flow; slow it down for a longer window on the track",
    },
    {
      key: "hue",
      label: "Hue",
      group: "color",
      control: "hue",
      min: 0,
      max: 360,
      step: 1,
      default: 248,
      hint: "Where the quiet end of the heat ramp sits on the wheel",
    },
    {
      key: "hueSpread",
      label: "Heat spread",
      group: "color",
      min: -180,
      max: 180,
      step: 5,
      default: 120,
      hint: "How far around the wheel loudness travels — the difference between quiet and peak colour",
    },
    {
      key: "saturation",
      label: "Saturation",
      group: "color",
      min: 0,
      max: 2,
      step: 0.01,
      default: 1,
      hint: "Overall color intensity (1 = as designed, 0 = grayscale)",
    },
    {
      key: "lightness",
      label: "Lightness",
      group: "color",
      min: 0,
      max: 2,
      step: 0.01,
      default: 1,
      hint: "Overall brightness of every color (1 = as designed)",
    },
    {
      key: "prism",
      label: "Prism",
      group: "color",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0,
      hint: "Cross-fade to a per-frequency rainbow, where loudness becomes pure brightness",
    },
    {
      key: "quiet",
      label: "Quiet floor",
      group: "reaction",
      min: 0,
      max: 0.5,
      step: 0.005,
      default: 0.06,
      hint: "Level that still counts as silence — raise it to clean the noise out of the record",
    },
    {
      key: "loud",
      label: "Loud peak",
      group: "reaction",
      min: 0.3,
      max: 1,
      step: 0.01,
      default: 0.9,
      hint: "Level that reads as fully hot. Together with Quiet floor this is the record's contrast",
    },
    {
      key: "airLift",
      label: "Air lift",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
      hint: "Tilts the spectrum: lifts the air and pulls the low end down, so hats and detail stay visible instead of drowning under the bass",
    },
    {
      key: "beatBoost",
      label: "Beat boost",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.3,
      hint: "How hard the whole record flares on the beat",
    },
    {
      key: "glow",
      label: "Glow",
      group: "glow",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.5,
      hint: "Halo bled around loud content — what makes a tone read as emitting rather than printed",
    },
    {
      key: "edge",
      label: "Now line",
      group: "glow",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.75,
      hint: "The live edge: how brightly the newest slice burns as it enters",
    },
    {
      key: "fade",
      label: "Age fade",
      group: "motion",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.3,
      hint: "How much older slices sink back as they travel — depth for the scroll",
    },
  ],
  advanced: [
    {
      key: "hotWhite",
      label: "White hot",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.35,
      hint: "How readily peaks blow out to white instead of staying merely saturated",
    },
    {
      key: "spill",
      label: "Spill",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
      hint: "How far the halo bleeds along the frequency axis around a loud tone",
    },
    {
      key: "floorLevel",
      label: "Floor glow",
      group: "backdrop",
      tier: "curated",
      min: 0,
      max: 0.2,
      step: 0.005,
      default: 0.035,
      hint: "Brightness of the silent ground — silence is a surface here, never a hole",
    },
    {
      key: "grid",
      label: "Frequency grid",
      group: "backdrop",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.1,
      hint: "Faint ratio lines across the frequency axis, so the eye can place a harmonic",
    },
    {
      key: "gridLines",
      label: "Grid divisions",
      group: "backdrop",
      mod: "snap",
      min: 2,
      max: 16,
      step: 1,
      default: 8,
      hint: "How many equal frequency-ratio divisions the grid draws",
    },
    {
      key: "beatMarks",
      label: "Beat marks",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.2,
      hint: "Prints the detected beat grid into the record — bars stronger than beats — and scrolls it with the music",
    },
    {
      key: "axisFocus",
      label: "Axis focus",
      group: "shape",
      min: -1,
      max: 1,
      step: 0.05,
      default: 0,
      hint: "Spends more of the axis on the low end (positive) or on the high end (negative)",
    },
    {
      key: "bassGlow",
      label: "Ground wash",
      group: "backdrop",
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.12,
      hint: "The ground breathes with the bass behind the record",
    },
    {
      key: "vignette",
      label: "Vignette",
      group: "backdrop",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.35,
      hint: "Corner darkening around the frame",
    },
  ],
  wgsl: /* wgsl */ `
${WGSL_COLOR_CONTROLS}

// ---------------------------------------------------------------------------
// The falling axis. Every scroll direction is the SAME record read through one
// pair of coordinates: \`s\` runs 0 (the entry edge, where now arrives) to 1
// (the exit edge, where the oldest slice leaves), and \`perp\` is the frequency
// axis in raw uv. Writing the scroll once against that pair is what keeps the
// four directions from being four subtly different implementations.
// ---------------------------------------------------------------------------
fn fallS(uv: vec2f) -> f32 {
  let d = P_direction();
  if (d < 0.5) { return uv.y; }
  if (d < 1.5) { return 1.0 - uv.y; }
  if (d < 2.5) { return 1.0 - uv.x; }
  return uv.x;
}

// Vertical scroll spreads frequency across x. Sideways scroll stands pitch UP
// the y axis, low at the bottom — the way a score, a piano roll and every
// audio editor draw it.
fn fallPerp(uv: vec2f) -> f32 {
  if (P_direction() < 1.5) { return uv.x; }
  return 1.0 - uv.y;
}

/** The uv a (frequency, along-scroll) pair sits at — fallS/fallPerp inverted. */
fn fallUV(perp: f32, s: f32) -> vec2f {
  let d = P_direction();
  if (d < 0.5) { return vec2f(perp, s); }
  if (d < 1.5) { return vec2f(perp, 1.0 - s); }
  if (d < 2.5) { return vec2f(1.0 - s, 1.0 - perp); }
  return vec2f(s, 1.0 - perp);
}

/**
 * Screen position -> position along the analysed span. The bins are already
 * log-spaced, so this stays a MUSICAL axis: equal steps are equal frequency
 * ratios, which is what makes the grid below mark intervals rather than
 * decorate. Axis focus is a plain power warp (>0 spends more of the frame on
 * the low end), and the mirror layouts fold the MAPPING, not the image — old
 * slices keep the data stored at their own pixels, so a fold wipes through the
 * record as it scrolls instead of tearing it.
 */
fn freqPos(perp: f32) -> f32 {
  var x = clamp(perp, 0.0, 1.0);
  // Named fold, not layout: "layout" is a WGSL RESERVED word, and a module
  // that uses one does not even parse.
  let fold = P_axis();
  if (fold > 1.5) { x = 1.0 - abs(x * 2.0 - 1.0); }
  else if (fold > 0.5) { x = abs(x * 2.0 - 1.0); }
  return pow(x, exp2(P_axisFocus() * 1.6));
}

/**
 * The live spectrum at a frequency position, as a CONTINUOUS curve. binAt()
 * alone returns the hard nearest bin — 96 of them, which is 20 px columns at
 * 1080p — so this samples it at two bin CENTRES (where binAt returns those
 * bins exactly) and interpolates between them. Still binAt, so the shared
 * Spectrum-smooth master reaches this mode like every other spectrum reader.
 */
fn liveLevel(fx: f32) -> f32 {
  let n = f32(u.binCount);
  let fi = clamp(fx, 0.0, 0.999) * n - 0.5;
  let i = floor(fi);
  let a = binAt((i + 0.5) / n);
  let b = binAt((i + 1.5) / n);
  return clamp(mix(a, b, fi - i), 0.0, 1.0);
}

/** Slices across the frame. The Detail master thins them out toward chunky
 * bands, the way it thins bars and points on every other mode. */
fn sliceCount() -> f32 {
  return max(floor(P_slices() * mix(0.35, 1.0, u.detail)), 4.0);
}

/**
 * Slices the record shifted on THIS state advance. Derived from TRACK time:
 * the counter is floor(time * speed), and u.dt is the fixed 60 Hz feedback
 * step — 0 on presentation-only frames, so presentation re-shows the last
 * state instead of scrolling it. The stepped, slice-at-a-time crawl is the
 * look; a sub-slice scroll would bilinear-blur the record every tick.
 */
fn slideSlices() -> f32 {
  let rate = max(P_speed(), 0.01);
  return floor(u.time * rate) - floor((u.time - u.dt) * rate);
}

/**
 * The recorded RAW level at (frequency position, slice index from the entry
 * edge). Slices younger than this tick's shift have not been recorded yet, so
 * they carry the live spectrum: the entry edge always shows now, and the next
 * shift samples-and-holds it into history. Everything older is read back from
 * the DATA channel (raw alpha), never from rendered pixels — slice centres
 * resample slice centres, whole slices at a time, so the record neither blurs
 * nor accumulates bloom.
 */
fn sliceAt(perp: f32, si: f32, rows: f32, shift: f32) -> f32 {
  if (si < max(shift, 1.0) - 0.5) { return liveLevel(freqPos(perp)); }
  let src = (si - shift + 0.5) / rows;
  return feedbackSample(fallUV(perp, src)).a;
}

/**
 * Loudness -> colour. The hue TRAVELS with heat (quiet sits on the anchor,
 * peaks land a whole spread away), which is what lets one hue wheel recolour
 * the entire mode and still read as temperature. Prism swaps that ramp for a
 * per-frequency rainbow, where loudness becomes pure brightness. The hot core
 * desaturates toward white: a peak that is only "very saturated orange" reads
 * as painted, one that blows out reads as lit.
 */
fn heatColor(heat: f32, fx: f32, level: f32) -> vec3f {
  let h = clamp(heat, 0.0, 1.0);
  let ramp = P_hue() + P_hueSpread() * h;
  let hue = mix(ramp, P_hue() + fx * 300.0, P_prism());
  let white = pow(h, mix(9.0, 1.6, P_hotWhite()));
  return presetColor(hue, 0.95 - 0.82 * white, level);
}

/** Black/white points, with the air tilt folded in. Applied at DISPLAY time to
 * whatever the record holds, so moving either end re-develops the whole
 * visible history rather than only the slices recorded after the change. */
fn develop(raw: f32, fx: f32) -> f32 {
  // Spectral tilt — a SEE-SAW about the middle of the axis, not a one-sided
  // boost: lifting the air also pulls the low end down. Music puts most of
  // its energy in the bottom couple of octaves, so a lift that only raised
  // the top left the whole bass half pinned at full heat: a white wall with
  // no structure in it. exp2 keeps the factor positive at every setting.
  let lifted = clamp(raw * exp2(P_airLift() * (fx * 2.0 - 1.0) * 2.2), 0.0, 1.0);
  return smoothstep(P_quiet(), max(P_loud(), P_quiet() + 0.02), lifted);
}

fn preset(uv: vec2f) -> vec4f {
  let rows = sliceCount();
  let shift = slideSlices();
  let s = fallS(uv);
  let perp = fallPerp(uv);
  let si = floor(clamp(s, 0.0, 0.99999) * rows);
  let fx = freqPos(perp);

  // The record. Raw, so every knob below is retroactive over the whole frame.
  let raw = sliceAt(perp, si, rows, shift);
  let heat = develop(raw, fx);

  // Slices sink as they travel: dimmer with distance from now, which is what
  // turns a flat readout into a river with depth.
  let age = si / max(rows - 1.0, 1.0);
  let ageDim = 1.0 - P_fade() * age;

  let beatP = max(u.driveBeat, gridPulse(8.0));
  let pump = 1.0 + beatP * P_beatBoost() * 0.9 * u.pulse;

  // The ground. Silence is a SURFACE, not a hole — an empty record has to read
  // as quiet, never as broken — and it breathes with the bass behind the
  // picture so the frame is alive even between slices.
  var col = presetColor(P_hue(), 0.6, P_floorLevel() * (1.0 - 0.35 * age));
  col += presetColor(P_hue() + P_hueSpread() * 0.5, 0.75, 0.22)
       * u.bass * P_bassGlow() * (1.0 - age * 0.6);

  // Frequency grid: equal steps along this axis are equal frequency RATIOS, so
  // these are musical divisions. Width comes from the screen-space derivative,
  // so a line stays a line however hard Axis focus warps the mapping.
  let scaled = fx * max(floor(P_gridLines()), 1.0);
  let gpos = fract(scaled);
  let gwide = max(fwidth(scaled), 1e-4);
  let gline = smoothstep(gwide * 1.2, 0.0, min(gpos, 1.0 - gpos));
  col += presetColor(P_hue() + P_hueSpread(), 0.35, 0.5) * gline * P_grid() * 0.35;

  // Tempo marks. Every slice knows WHEN it was recorded — its index is exactly
  // how many counter steps ago it entered — so the beat grid can be printed
  // onto the record and scroll in lockstep with the music. Anchored to the
  // detected grid through beatPhase, so the marks sit on the beat rather than
  // on t = 0, and a bar line prints stronger than a beat line.
  if (u.bpm > 1.0 && P_beatMarks() > 0.001) {
    let rate = max(P_speed(), 0.01);
    let bps = u.bpm / 60.0;
    let anchor = u.time * bps - u.beatPhase;
    let counter = floor(u.time * rate);
    let bHere = (counter - si) / rate * bps - anchor;
    let bPrev = (counter - si - 1.0) / rate * bps - anchor;
    let onBeat = select(0.0, 0.4, floor(bHere) != floor(bPrev));
    let onBar = select(0.0, 1.0, floor(bHere * 0.25) != floor(bPrev * 0.25));
    col += presetColor(P_hue() + P_hueSpread() * 0.8, 0.4, 0.5)
         * max(onBeat, onBar) * P_beatMarks() * 0.5 * ageDim;
  }

  // The record itself. COLOUR follows heat linearly (the ramp has to read
  // across the whole range), BRIGHTNESS follows it squared — music puts most
  // of its energy in the low half of the spectrum, and a linear brightness
  // ramp blows that half to a flat white mass with no structure in it. The
  // squared curve reserves the bright end for genuine peaks, which is what
  // makes a spectrogram legible rather than merely lit.
  col += heatColor(heat, fx, 0.5) * heat * heat * ageDim * pump;

  // Spill: a tone bleeds light into the frequencies AROUND it. Sampled along
  // the frequency axis only — the time axis already smears through the scroll
  // — four taps at widening spacing, squared so the halo keeps a tight core
  // instead of hazing the whole frame.
  let d = P_spill() * 0.012;
  let tapNear = sliceAt(perp - d, si, rows, shift) + sliceAt(perp + d, si, rows, shift);
  let tapWide = sliceAt(perp - d * 2.4, si, rows, shift) + sliceAt(perp + d * 2.4, si, rows, shift);
  let halo = develop(clamp(tapNear * 0.35 + tapWide * 0.15, 0.0, 1.0), fx);
  col += heatColor(halo, fx, 0.55) * halo * halo * P_glow() * 0.55 * ageDim * pump;

  // The now line — the read head. Without it the frame is a picture; with it
  // the mode is visibly PLAYING. A soft flare over the newest slices, then a
  // thin bright playhead pinned to the entry edge itself.
  let entry = exp(-s * rows * 0.35);
  col += heatColor(heat, fx, 0.6) * entry * P_edge() * (0.3 + 0.9 * heat) * pump;
  col += presetColor(P_hue() + P_hueSpread(), 0.22, 0.72)
       * smoothstep(1.8 / rows, 0.0, s) * P_edge() * (0.15 + 0.55 * heat);

  col *= vignette(uv, P_vignette());
  col = tonemap(col * 1.04);
  col += grain(uv, 0.008);
  // Alpha is this pixel's DATA lane, not its opacity: the raw level the next
  // state advance reads back one slice further from the entry edge.
  return vec4f(max(col, vec3f(0.0)), raw);
}
`,
};
