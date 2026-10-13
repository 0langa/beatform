import type { ParamSpec, PresetDef } from "../types";

/**
 * THE LOOK KIT (3.2): the finishing knobs every fragment visual answers to.
 *
 * Measured on 2026-10-13 across the strip: the modes read as unequally
 * customizable not because the lean ones lacked ideas but because the
 * finishing — symmetry, a tilt, a beat zoom, a beat flash, a hue drift, grain,
 * scanlines, a frequency window — had been re-invented on some modes and
 * never reached the others (Particles answered 19 of 24 knob concepts,
 * Synthwave 8). The kit closes that gap once, here: a mode declares which
 * concepts it already owns natively (`KitChoice`), and `withKit` appends the
 * missing ones to its `advanced` block and wraps its fragment entry so the
 * same shared WGSL applies them.
 *
 * THREE RULES, all load-bearing:
 *
 * 1. ABI-APPEND ONLY. The kit specs go at the END of `advanced`, in one fixed
 *    order, so every existing accessor index is unchanged and no shipped
 *    pixel hash moves for the addition itself (abiOrder.test.ts's documented
 *    "genuine param addition" case).
 * 2. EXACT NO-OP AT THE DEFAULTS. Every kit knob defaults to its off value
 *    (0, or 1 for the fold enum) and every kit effect is guarded by a branch
 *    that never runs at that value — not "multiplied by zero", which would
 *    still touch the arithmetic. A default document renders bit-identically;
 *    only the GPU matrix's extreme/min|max sweeps, which drive the new keys,
 *    see the kit at all.
 * 3. FOLDS NEVER TOUCH STATE. The uv fold (mirror, angle, spin, beat zoom)
 *    runs BEFORE the body and is only offered to modes whose body has no
 *    feedback history to misread through a folded coordinate; the finish
 *    (flash, hue spin, grain, scanlines) runs on the returned RGB and leaves
 *    alpha untouched, so the alpha-state modes (Spectro Falls, Overgrowth,
 *    LED Matrix) keep their chemistry. The three RGB-accumulating feedback
 *    modes (Oscilloscope, Metaballs, Echo Trails) take no kit at all: their
 *    output IS next frame's history, and a flash or grain applied there
 *    would compound frame over frame.
 * 4. THE FINISH IS SCREEN-SPACE. Grain and scanlines are drawn in the frame's
 *    own uv, never the folded one: a mirror must not mirror the grain, a spin
 *    must not tilt the scanlines, a beat zoom must not pump them. And in the
 *    transparent delivery (bgMode 2, where composite() derives coverage from
 *    the light) grain scales with the light under it, as the post chain's
 *    does — grain on nothing would otherwise read as speckled coverage over
 *    the empty frame of a PNG-sequence, VP9-alpha or ProRes 4444 export.
 *
 * Masters: the kit's spin honours Motion→Rotation (u.spin) and its beat zoom
 * and flash honour Motion→Pulse (u.pulse), and the terms are only emitted for
 * modes that take those knobs — so presetMasters() keeps telling the truth
 * about which masters move a mode.
 */
export interface KitChoice {
  /** Symmetry fold (`mirror`, the club 1..12 enum). false = the mode has its own. */
  mirror?: boolean;
  /** Static `angle` plus continuous `spin` of the whole frame. */
  rotation?: boolean;
  /** `beatZoom`: the frame pumps toward the centre on the beat. */
  beatZoom?: boolean;
  /** `beatFlash`: a brightness lift on the beat. */
  beatFlash?: boolean;
  /** `hueSpin`: the whole picture's hue drifts around the wheel over time. */
  hueSpin?: boolean;
  /** `grain`: film grain over the finished frame. */
  grain?: boolean;
  /** `scanline`: CRT-style horizontal lines over the finished frame. */
  scanline?: boolean;
  /**
   * `freqLo`/`freqHi`: the slice of the spectrum this mode listens to — every
   * binAt()/peakAt() in the body is remapped through it. Only for modes that
   * read the spectrum at all.
   */
  freq?: boolean;
}

export const KIT_KEYS = [
  "mirror",
  "angle",
  "spin",
  "beatZoom",
  "beatFlash",
  "hueSpin",
  "grain",
  "scanline",
  "freqLo",
  "freqHi",
] as const;

const MIRROR_OPTIONS = [
  { value: 1, label: "None", hint: "The frame as the mode draws it" },
  { value: 2, label: "Mirrored", hint: "Left and right halves mirror each other" },
  { value: 3, label: "3 segments" },
  { value: 4, label: "4 segments" },
  { value: 5, label: "5 segments" },
  { value: 6, label: "6 segments" },
  { value: 7, label: "7 segments" },
  { value: 8, label: "8 segments" },
  { value: 9, label: "9 segments" },
  { value: 10, label: "10 segments" },
  { value: 11, label: "11 segments" },
  { value: 12, label: "12 segments" },
];

/** The kit's specs for a mode, in ABI order, only the concepts it asked for. */
export function kitSpecs(choice: KitChoice): ParamSpec[] {
  const specs: ParamSpec[] = [];
  if (choice.mirror) {
    specs.push({
      key: "mirror",
      label: "Mirror",
      hint: "Fold the frame into a symmetry: a left/right mirror, or a kaleidoscope of 3 to 12 wedges around the centre",
      group: "shape",
      control: "enum",
      mod: "snap",
      options: MIRROR_OPTIONS,
      min: 1,
      max: 12,
      step: 1,
      default: 1,
    });
  }
  if (choice.rotation) {
    specs.push(
      {
        key: "angle",
        label: "Angle",
        hint: "Turn the whole frame — aim the picture; 0 keeps the mode's own orientation",
        group: "motion",
        control: "angle",
        min: 0,
        max: 360,
        step: 1,
        default: 0,
      },
      {
        key: "spin",
        label: "Spin",
        hint: "Rotate the whole frame continuously, degrees per second — negative spins the other way; Motion→Rotation scales it",
        group: "motion",
        min: -60,
        max: 60,
        step: 1,
        default: 0,
      },
    );
  }
  if (choice.beatZoom) {
    specs.push({
      key: "beatZoom",
      label: "Beat zoom",
      hint: "The whole frame pumps toward the centre on every beat; Motion→Pulse scales it",
      group: "reaction",
      min: 0,
      max: 0.3,
      step: 0.01,
      default: 0,
    });
  }
  if (choice.beatFlash) {
    specs.push({
      key: "beatFlash",
      label: "Beat flash",
      hint: "The whole picture brightens on every beat and settles back; Motion→Pulse scales it",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
    });
  }
  if (choice.hueSpin) {
    specs.push({
      key: "hueSpin",
      label: "Hue spin",
      hint: "Drift every colour around the wheel over time, degrees per second — the look cycles through the palette; 0 holds it",
      group: "color",
      min: -60,
      max: 60,
      step: 1,
      default: 0,
    });
  }
  if (choice.grain) {
    specs.push({
      key: "grain",
      label: "Grain",
      hint: "Film grain over the finished frame — a little reads as texture, a lot as a damaged print",
      group: "backdrop",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
    });
  }
  if (choice.scanline) {
    specs.push({
      key: "scanline",
      label: "Scanlines",
      hint: "CRT-style horizontal lines over the finished frame",
      group: "backdrop",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
    });
  }
  if (choice.freq) {
    specs.push(
      {
        key: "freqLo",
        label: "Low edge",
        hint: "Where the mode's spectrum starts — raise it to drop the sub-bass out of the picture",
        group: "shape",
        min: 0,
        max: 0.75,
        step: 0.01,
        default: 0,
      },
      {
        key: "freqHi",
        label: "High edge",
        hint: "Where the mode's spectrum ends — lower it to zoom in on the bass and mids",
        group: "shape",
        min: 0.25,
        max: 1,
        step: 0.01,
        default: 1,
      },
    );
  }
  return specs;
}

/**
 * The shared WGSL, generated per mode so it references only the accessors
 * that mode declares: a concept the mode owns natively, or did not ask for,
 * becomes a literal that keeps its branch closed.
 */
export function kitWgsl(choice: KitChoice): string {
  const fold: string[] = [];
  if (choice.beatZoom) {
    fold.push(
      "  let bz = P_beatZoom();",
      "  if (bz > 0.0) { uv = (uv - 0.5) / (1.0 + u.driveBeat * bz * u.pulse) + 0.5; }",
    );
  }
  const angle = choice.rotation ? "P_angle() + P_spin() * u.time * u.spin" : "0.0";
  const mirror = choice.mirror ? "P_mirror()" : "1.0";
  if (choice.rotation || choice.mirror) {
    fold.push(
      `  let ka = ${angle};`,
      `  let km = ${mirror};`,
      "  if (ka != 0.0 || km >= 1.5) {",
      "    var p = centered(uv);",
      "    if (ka != 0.0) { p = rot2(ka * TAU / 360.0) * p; }",
      "    p = kaleido(p, km);",
      "    uv = vec2f(p.x / u.aspect + 0.5, p.y + 0.5);",
      "  }",
    );
  }
  const finish: string[] = [];
  if (choice.beatFlash) {
    finish.push(
      "  let bf = P_beatFlash();",
      "  if (bf > 0.0) { rgb *= 1.0 + u.driveBeat * bf * 0.8 * u.pulse; }",
    );
  }
  if (choice.hueSpin) {
    finish.push(
      "  let hs = P_hueSpin();",
      "  if (hs != 0.0) { rgb = hueRotate(rgb, hs * u.time); }",
    );
  }
  if (choice.scanline) {
    finish.push(
      "  let sl = P_scanline();",
      "  if (sl > 0.0) { rgb *= 1.0 - sl * 0.45 * (0.5 + 0.5 * sin(uv.y * 120.0 * TAU)); }",
    );
  }
  if (choice.grain) {
    // ±0.1 at the top of the slider: judged on device, 0.35 turned a tunnel
    // into a sandstorm at max, while 0.2 still reads as a damaged print there
    // and as texture around 0.3. Transparent delivery (rule 4): the grain
    // scales with the light it lands on, so it never manufactures coverage.
    finish.push(
      "  let gr = P_grain();",
      "  if (gr > 0.0) {",
      "    let lit = select(1.0, clamp(max(rgb.r, max(rgb.g, rgb.b)), 0.0, 1.0), u.bgMode == 2u);",
      "    rgb += vec3f(grain(uv, gr * 0.2) * lit);",
      "  }",
    );
  }
  // The window's edges overlap in range (Low edge up to 0.75, High edge down
  // to 0.25), so two sliders or a modulation route can cross them; a crossed
  // window reads the same slice the right way round, never a reversed
  // spectrum. At the defaults mix(0, 1, x) is exactly x.
  const freq = choice.freq
    ? [
        "fn kitWin(x: f32) -> f32 { let lo = P_freqLo(); let hi = P_freqHi(); return mix(min(lo, hi), max(lo, hi), x); }",
        "fn kitBin(x: f32) -> f32 { return binAt(kitWin(x)); }",
        "fn kitPeak(x: f32) -> f32 { return peakAt(kitWin(x)); }",
      ]
    : [];
  return [
    "",
    "// ---- Look kit (presets/kit.ts): shared finishing knobs, exact no-ops at their defaults.",
    ...freq,
    "fn kitFold(uvIn: vec2f) -> vec2f {",
    "  var uv = uvIn;",
    ...fold,
    "  return uv;",
    "}",
    "fn kitFinish(rgbIn: vec3f, uv: vec2f) -> vec3f {",
    "  var rgb = rgbIn;",
    ...finish,
    "  return rgb;",
    "}",
    "fn preset(uv: vec2f) -> vec4f {",
    "  let c = presetBody(kitFold(uv));",
    "  return vec4f(kitFinish(c.rgb, uv), c.a); // screen-space finish (rule 4)",
    "}",
    "",
  ].join("\n");
}

/**
 * Attach the kit to a preset: append the chosen specs to `advanced`, rename
 * the mode's own `fn preset` to `fn presetBody`, remap its spectrum reads
 * through the frequency window when asked, and append the shared WGSL with
 * the new `fn preset` wrapper. The mode's file stays the readable source of
 * its own look; the kit is a declared suffix.
 */
const choices = new Map<string, KitChoice>();

/** Which kit concepts a built-in mode took — for the tests and the bench. */
export function kitChoiceOf(presetId: string): KitChoice | undefined {
  return choices.get(presetId);
}

export function withKit(def: PresetDef, choice: KitChoice): PresetDef {
  const specs = kitSpecs(choice);
  choices.set(def.id, choice);
  const own = new Set([...def.params, ...(def.advanced ?? [])].map((s) => s.key));
  for (const s of specs) {
    if (own.has(s.key)) {
      throw new Error(`kit: ${def.id} already declares "${s.key}" — mark the concept as owned`);
    }
  }
  if (!/\nfn preset\(/.test(def.wgsl)) {
    throw new Error(`kit: ${def.id} has no fn preset( entry to wrap`);
  }
  let wgsl = def.wgsl.replace(/\nfn preset\(/, "\nfn presetBody(");
  if (choice.freq) {
    if (!/\b(binAt|peakAt)\(/.test(wgsl)) {
      throw new Error(`kit: ${def.id} asked for a frequency window but reads no spectrum`);
    }
    wgsl = wgsl.replace(/\bbinAt\(/g, "kitBin(").replace(/\bpeakAt\(/g, "kitPeak(");
  }
  return {
    ...def,
    advanced: [...(def.advanced ?? []), ...specs],
    wgsl: wgsl + kitWgsl(choice),
  };
}
