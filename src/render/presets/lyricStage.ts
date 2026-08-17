import type { PresetDef } from "../types";
import { WGSL_COLOR_CONTROLS } from "../wgslLib";

/**
 * LYRIC STAGE — typography as the visual (P-19 roster entry 2).
 *
 * VISUAL IDENTITY. The words ARE the picture. The current line stands centre
 * stage in big type; the line just sung hangs above it, the one coming up
 * waits below; the karaoke fill sweeps through each word on the aligner's own
 * word timings, and the word being sung RIGHT NOW carries the light — weight,
 * glow and colour ride the music, so a kick lands in the type the way it
 * lands in the room. Behind the words the stage itself stays alive: a lit
 * floor, a breathing bass wash, the spectrum as a faint skyline.
 *
 * THE TEXT PATH. A fragment shader cannot rasterize glyphs, so the words
 * arrive the way cover art does: the host rasterizes the current lyric
 * moment into the LYRIC PLATE (render/lyricPlate.ts) — a pure function of
 * (lines, quantized track time) both render loops compose identically — and
 * this shader samples it through lyricSample(). The plate's channels are
 * CLASSES, not paint (R glyph / G karaoke-lit / B active word), so every
 * real colour is decided here, by the user's knobs, and re-develops the
 * whole stage the moment a knob moves. Three fixed bands (prev / main /
 * next) let the shader scale and place each line class independently; a
 * status block in the plate's corner carries the line-fade alpha, which is
 * what powers the parametric entrance without a single new uniform lane.
 *
 * NEVER A BLANK CANVAS. Most tracks have no lyrics loaded, and the mode must
 * look ALIVE there too — so with no plate bound (hasLyrics() false), and in
 * the instrumental gaps of a track that has one (the status block reads
 * empty), the stage runs a REHEARSAL: a type specimen of greeked word-blocks
 * in the same three-band layout, karaoke-swept in lockstep with the bar
 * (beatRamp), the block under the sweep pulsing on the beat. It previews
 * exactly what the mode does with real words — placeholder type, publishing's
 * own move — and it is precisely what the GPU matrix and the strip thumbnail
 * render, so the blessed baselines pin the degrade, not an accident.
 *
 * DETERMINISM. The shader is a pure function of (features, time, params,
 * plate). The plate is keyed and quantized host-side (1/64 fade, 1/32 fill —
 * the caption compositor's own grids); segment exports ship pre-shifted
 * lines, so plate state and u.time agree on both paths by construction. No
 * feedback: the stage redraws whole every frame, so there is no history to
 * diverge. Cross-machine font rasterization stays measured parity, exactly
 * as the shipped caption overlay's — same stack, same contract.
 */
export const lyricStage: PresetDef = {
  id: "lyric-stage",
  name: "Lyric Stage",
  description:
    "The words are the visual: the current line stands centre stage in audio-reactive type — word-by-word karaoke fill, the sung word carrying the light — with the last and next lines in supporting roles. No lyrics loaded? The stage rehearses with placeholder type, swept in time with the bar.",
  styles: [
    // Lyric Stage — the defaults: cool white-on-midnight centre stage, warm
    // lit words, a quiet skyline behind.
    { id: "stage", name: "Lyric Stage", values: {} },
    // Neon Marquee — lower third, hot magenta against cyan, chromatic fringe
    // and heavy glow. The VJ chip.
    {
      id: "marquee",
      name: "Neon Marquee",
      values: {
        layout: 1,
        size: 0.9,
        hue: 315,
        hueSpread: -130,
        chromaSplit: 0.45,
        glow: 1.1,
        flare: 0.55,
        wordGlow: 1.05,
        ghostBars: 0.4,
        unsungDim: 0.3,
        bassStage: 0.5,
        drift: 0.15,
        vignette: 0.5,
      },
    },
    // Teleprompter — top billing, full context, almost no effects: the
    // honest reading machine. What a rehearsal room wants on the wall.
    {
      id: "prompter",
      name: "Teleprompter",
      values: {
        layout: 2,
        size: 0.8,
        context: 1,
        contextScale: 0.7,
        hue: 145,
        hueSpread: 10,
        glow: 0.15,
        chromaSplit: 0,
        flare: 0.05,
        drift: 0,
        ghostBars: 0,
        beatPunch: 0.1,
        wordGlow: 0.35,
        stageLevel: 0.03,
        flutter: 0,
        vignette: 0.15,
      },
    },
    // Stadium — huge gold type, hard beat punch, the crowd-flash flare. The
    // chorus of an arena anthem.
    {
      id: "stadium",
      name: "Stadium",
      values: {
        size: 1.4,
        hue: 45,
        hueSpread: 25,
        beatPunch: 0.8,
        flare: 0.7,
        wordGlow: 1.35,
        unsungDim: 0.25,
        bassStage: 0.6,
        glow: 0.9,
        entrance: 0.7,
        chromaSplit: 0.1,
        greekRows: 3,
        ghostBars: 0.45,
        vignette: 0.45,
      },
    },
    // Velvet — small, slow, rose-warm, everything soft: the ballad look.
    // Drift and flutter on, punch nearly off.
    {
      id: "velvet",
      name: "Velvet",
      values: {
        size: 0.85,
        context: 0.4,
        hue: 335,
        hueSpread: 20,
        drift: 0.5,
        entrance: 0.9,
        beatPunch: 0.15,
        wordGlow: 0.5,
        chromaSplit: 0.05,
        glow: 0.95,
        flutter: 0.3,
        stageLevel: 0.075,
        bassStage: 0.2,
        ghostBars: 0.1,
        vignette: 0.55,
      },
    },
    // Ink — colour pulled almost out, hard sung/unsung contrast, no fringe,
    // no skyline: print on paper. The letterpress chip.
    {
      id: "ink",
      name: "Ink",
      values: {
        context: 0.45,
        hue: 40,
        hueSpread: 0,
        saturation: 0.25,
        lightness: 1.1,
        unsungDim: 0.2,
        glow: 0.1,
        chromaSplit: 0,
        flare: 0.1,
        drift: 0.1,
        beatPunch: 0.25,
        greekRows: 3,
        ghostBars: 0,
        stageLevel: 0.075,
        flutter: 0.05,
        vignette: 0.2,
      },
    },
  ],
  params: [
    {
      key: "layout",
      label: "Stage anchor",
      group: "shape",
      control: "enum",
      // A structural switch: modulating it would teleport the whole text
      // stack every frame (the led-matrix Display rule).
      mod: "off",
      options: [
        { value: 0, label: "Center stage", hint: "The current line holds the middle of the frame" },
        { value: 1, label: "Lower third", hint: "Text sits low — room for a visual above" },
        { value: 2, label: "Top billing", hint: "Text rides high — teleprompter style" },
      ],
      min: 0,
      max: 2,
      step: 1,
      default: 0,
      hint: "Where the current line stands on the stage",
    },
    {
      key: "size",
      label: "Type size",
      group: "shape",
      min: 0.6,
      max: 1.6,
      step: 0.05,
      default: 1,
      hint: "Scale of the current line's type",
    },
    {
      key: "context",
      label: "Context",
      group: "shape",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.6,
      hint: "Presence of the supporting cast — the line just sung and the one coming up",
    },
    {
      key: "tilt",
      label: "Tilt",
      group: "shape",
      min: -1,
      max: 1,
      step: 0.05,
      default: 0,
      hint: "Shears the type for an italic, stage-raked look",
    },
    {
      key: "hue",
      label: "Hue",
      group: "color",
      control: "hue",
      min: 0,
      max: 360,
      step: 1,
      default: 210,
      hint: "The stage's base color — unsung words and the floor sit here",
    },
    {
      key: "hueSpread",
      label: "Sung shift",
      group: "color",
      min: -180,
      max: 180,
      step: 5,
      default: 40,
      hint: "How far around the wheel the SUNG words travel from the base hue",
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
      key: "drift",
      label: "Drift",
      group: "motion",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.25,
      hint: "Slow float of the stage — the backdrop sways with the track's energy",
    },
    {
      key: "entrance",
      label: "Entrance",
      group: "motion",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
      hint: "How much a new line settles into place — a zoom that eases out as the line lands",
    },
    {
      key: "beatPunch",
      label: "Beat punch",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.35,
      hint: "The type pumps on the beat",
    },
    {
      key: "wordGlow",
      label: "Word light",
      group: "reaction",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.7,
      hint: "How hard the word being sung right now carries the light",
    },
    {
      key: "chromaSplit",
      label: "Chroma split",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.15,
      hint: "RGB fringe on the type, driven by the treble",
    },
    {
      key: "glow",
      label: "Glow",
      group: "glow",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.6,
      hint: "Halo around the type — what makes the words read as lit rather than printed",
    },
    {
      key: "flare",
      label: "Beat flare",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.3,
      hint: "A stage-wide flash of light on the beat",
    },
    {
      key: "ghostBars",
      label: "Skyline",
      group: "backdrop",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.25,
      hint: "The spectrum as a faint skyline behind the words",
    },
  ],
  advanced: [
    {
      key: "stageLevel",
      label: "Floor glow",
      group: "backdrop",
      min: 0,
      max: 0.2,
      step: 0.005,
      default: 0.05,
      hint: "Brightness of the empty stage — silence is a lit surface here, never a hole",
    },
    {
      key: "unsungDim",
      label: "Unsung level",
      group: "color",
      min: 0.1,
      max: 1,
      step: 0.05,
      default: 0.45,
      hint: "Brightness of the words not yet sung — lower for harder karaoke contrast",
    },
    {
      key: "contextScale",
      label: "Context size",
      group: "shape",
      min: 0.3,
      max: 0.8,
      step: 0.05,
      default: 0.5,
      hint: "Type scale of the supporting lines, relative to the main line",
    },
    {
      key: "greekRows",
      label: "Rehearsal rows",
      group: "shape",
      mod: "snap",
      min: 2,
      max: 5,
      step: 1,
      default: 4,
      hint: "Rows of placeholder type when no lyrics are loaded",
    },
    {
      key: "glowReach",
      label: "Glow reach",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
      hint: "How far the halo spreads from each glyph",
    },
    {
      key: "bassStage",
      label: "Bass wash",
      group: "backdrop",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.35,
      hint: "The stage floor breathes with the bass",
    },
    {
      key: "flutter",
      label: "Flutter",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.15,
      hint: "A fine shimmer over the glyphs, livelier when the treble is",
    },
    {
      key: "rehearse",
      label: "Rehearsal",
      group: "shape",
      min: 0,
      max: 1,
      step: 0.05,
      default: 1,
      hint: "Presence of the placeholder type when no words are on stage",
    },
    {
      key: "vignette",
      label: "Vignette",
      group: "backdrop",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.35,
      hint: "Corner darkening around the stage",
    },
  ],
  wgsl: /* wgsl */ `
${WGSL_COLOR_CONTROLS}

/** Authored-RGB counterpart of presetColor, for the one place this mode
 * paints a literal tint (the chromatic fringe): led-matrix's exact
 * desaturation-mix idiom, so saturation 0 collapses the fringe to its own
 * luminance instead of leaving red/blue ghosts on a grayscale stage. */
fn presetRgb(rgb: vec3f) -> vec3f {
  let gray = vec3f(dot(rgb, vec3f(0.2126, 0.7152, 0.0722)));
  let saturation = P_saturation();
  var adjusted = mix(gray, rgb, saturation);
  if (saturation > 1.0) {
    adjusted = rgb + (rgb - gray) * (saturation - 1.0);
  }
  let lightness = P_lightness();
  if (lightness <= 1.0) { return adjusted * lightness; }
  return min(adjusted * lightness, vec3f(1.0));
}

// ---------------------------------------------------------------------------
// Plate geometry — MIRRORS lyricPlate.ts (PLATE_*_BAND / the 4px status
// block). lyricStage.test.ts asserts these numbers against the module's
// exported constants, so neither side can drift alone.
// ---------------------------------------------------------------------------
const BAND_PREV_LO: f32 = 0.06;
const BAND_PREV_HI: f32 = 0.24;
const BAND_MAIN_LO: f32 = 0.28;
const BAND_MAIN_HI: f32 = 0.72;
const BAND_NEXT_LO: f32 = 0.76;
const BAND_NEXT_HI: f32 = 0.94;

/** Global line state from the plate's status block: R = main-line fade,
 * G = prev presence, B = next presence. Sampled at (2px, 2px) — the centre
 * of the 4x4 block, where bilinear filtering is exact — and zero when no
 * plate is bound, which is exactly "nothing on stage". */
fn stageStatus() -> vec3f {
  if (!hasLyrics()) { return vec3f(0.0); }
  let dims = vec2f(textureDimensions(lyricTex));
  return lyricSample(vec2f(2.0, 2.0) / dims).rgb;
}

/**
 * Sample one band of the plate, re-staged: the band's own plate span maps to
 * a chosen screen centre with its own scale, sheared by the tilt. Outside
 * the mapped span returns 0 — a scaled band can never bleed its neighbour
 * in, because the plate coordinate is clamped to the band itself.
 */
fn bandTap(uv: vec2f, lo: f32, hi: f32, centerY: f32, scale: f32, skew: f32) -> vec4f {
  let s = max(scale, 0.05);
  let dy = uv.y - centerY;
  let px = 0.5 + (uv.x - 0.5 + dy * skew) / s;
  let py = (lo + hi) * 0.5 + dy / s;
  if (py < lo || py > hi || px < 0.0 || px > 1.0) { return vec4f(0.0); }
  return lyricSample(vec2f(px, py));
}

/** Where the main line stands (Stage anchor). The supporting lines stack a
 * fixed stage-distance above and below, clamped on-frame by construction
 * (0.30 - 0.26 = 0.04, 0.70 + 0.26 = 0.96). */
fn mainCenterY() -> f32 {
  let a = P_layout();
  if (a < 0.5) { return 0.5; }
  if (a < 1.5) { return 0.70; }
  return 0.30;
}

/**
 * Colour one glyph tap. The plate's channels are premultiplied classes:
 * coverage in r (it carries the line fade), the lit fraction in g/r, the
 * active-word mask in b/r. Unsung words hold the base hue dimmed; sung words
 * travel the Sung-shift; the word under the needle adds the Word-light —
 * pumped by the beat, because THAT is where the music lives in this mode.
 */
fn glyphColor(tap: vec4f, uv: vec2f) -> vec3f {
  let cov = tap.r;
  if (cov < 0.004) { return vec3f(0.0); }
  let lit = clamp(tap.g / max(cov, 1e-4), 0.0, 1.0);
  let act = clamp(tap.b / max(cov, 1e-4), 0.0, 1.0);
  let unsung = presetColor(P_hue(), 0.45, 0.30 + 0.42 * P_unsungDim());
  let sung = presetColor(P_hue() + P_hueSpread(), 0.72, 0.68);
  var col = mix(unsung, sung, lit);
  let pulse = max(u.driveBeat, gridPulse(6.0));
  col += presetColor(P_hue() + P_hueSpread(), 0.55, 0.62)
       * act * P_wordGlow() * (0.55 + 0.45 * pulse);
  // Flutter: a fine, treble-live shimmer over the glyph field. Hashed on a
  // coarse grid and an 8 Hz TRACK-time step — deterministic, never a wall
  // clock.
  let tw = hash21(floor(uv * vec2f(96.0, 54.0)) + floor(u.time * 8.0));
  col *= 1.0 + P_flutter() * (tw - 0.5) * (0.35 + 0.65 * u.treble);
  return col * cov;
}

/** The whole text stack (three bands) at one screen position: colour plus
 * the raw main-band coverage (for the glow pass to reuse). */
fn textStack(uv: vec2f, mainScale: f32, skew: f32) -> vec3f {
  let mainC = mainCenterY();
  var col = glyphColor(bandTap(uv, BAND_MAIN_LO, BAND_MAIN_HI, mainC, mainScale, skew), uv);
  // Chromatic fringe: coverage-only side taps tint the edges rather than
  // re-running the full colour pipeline three times. The tints are authored
  // RGB, so they route through presetRgb — a raw literal here ignored the
  // saturation control and fringed red/blue over a grayscale stage.
  let split = P_chromaSplit() * (0.3 + 0.7 * u.treble) * 0.006;
  if (split > 1e-5) {
    let covR = bandTap(uv + vec2f(split, 0.0), BAND_MAIN_LO, BAND_MAIN_HI, mainC, mainScale, skew).r;
    let covB = bandTap(uv - vec2f(split, 0.0), BAND_MAIN_LO, BAND_MAIN_HI, mainC, mainScale, skew).r;
    col += presetRgb(vec3f(0.8, 0.06, 0.10)) * covR * 0.5;
    col += presetRgb(vec3f(0.10, 0.06, 0.8)) * covB * 0.5;
  }
  // Supporting cast: the sung line above, the coming line below, both in the
  // base hue at context presence. Their plate alpha already carries their
  // own hold/lead fades.
  let ctx = P_context();
  if (ctx > 0.001) {
    let cs = P_contextScale();
    let prev = bandTap(uv, BAND_PREV_LO, BAND_PREV_HI, mainC - 0.26, cs, skew);
    let next = bandTap(uv, BAND_NEXT_LO, BAND_NEXT_HI, mainC + 0.26, cs, skew);
    col += presetColor(P_hue(), 0.35, 0.55) * (prev.r + next.r) * ctx * 0.8;
  }
  return col;
}

/**
 * The rehearsal: greeked word-blocks in the main band's place, karaoke-swept
 * once per BAR through beatRamp so the placeholder sings in time. One row of
 * blocks; widths are hashed per (row, slot), so every row reads as a
 * different line of a specimen sheet. Returns (coverage, lit).
 */
fn greekRow(x: f32, fy: f32, row: f32, sweep: f32) -> vec2f {
  // Rounded row core: full inside, soft caps at the row's top and bottom.
  let core = smoothstep(0.48, 0.30, abs(fy - 0.5));
  var xk = 0.08 + 0.05 * hash11(row * 31.7);
  var cov = 0.0;
  var lit = 0.0;
  for (var k = 0; k < 8; k++) {
    let wk = 0.045 + 0.115 * hash11(row * 17.3 + f32(k) * 3.7);
    if (xk + wk > 0.92) { break; }
    let inWord = smoothstep(xk - 0.004, xk + 0.004, x)
               * smoothstep(xk + wk + 0.004, xk + wk - 0.004, x);
    cov = max(cov, inWord);
    lit = max(lit, inWord * clamp((sweep - xk) / max(wk, 1e-3), 0.0, 1.0));
    xk = xk + wk + 0.03;
  }
  return vec2f(cov * core, lit * core);
}

fn preset(uv: vec2f) -> vec4f {
  let status = stageStatus();
  let presence = max(status.r, max(status.g, status.b));
  let beat = max(u.driveBeat, gridPulse(7.0));

  // Slow stage sway — backdrop only (swaying TEXT reads as broken), riding
  // the slow energy envelope and the Rotation master.
  let sway = vec2f(sin(u.time * 0.31), cos(u.time * 0.23))
           * 0.03 * P_drift() * (0.35 + 0.65 * u.energy) * u.spin;
  let buv = uv + sway;

  // The stage floor: a lit surface graded toward the bottom, never a hole,
  // breathing with the bass. The empty stage has to read as QUIET.
  var col = presetColor(P_hue(), 0.5, P_stageLevel() * (0.55 + 0.9 * (1.0 - buv.y)));
  col += presetColor(P_hue() + P_hueSpread() * 0.4, 0.6, 0.16)
       * u.bass * P_bassStage() * (1.0 - abs(buv.y - 0.72) * 1.6);

  // The skyline: the spectrum as a faint city behind the words. binAt keeps
  // it on the shared Spectrum-smooth master; Detail thins the columns.
  if (P_ghostBars() > 0.001) {
    let cols = max(floor(48.0 * mix(0.4, 1.0, u.detail)), 8.0);
    let cx = (floor(buv.x * cols) + 0.5) / cols;
    let level = binAt(cx) * 0.55;
    let sky = smoothstep(level + 0.02, level - 0.10, 1.0 - buv.y);
    col += presetColor(P_hue(), 0.55, 0.30) * sky * P_ghostBars() * 0.55;
  }

  // The words. Entrance: a new line lands slightly LARGE and settles as its
  // fade completes — scaled by the status alpha the plate carries, so a
  // 30 fps export walks the same settle the 144 Hz preview does.
  let settle = 1.0 + (1.0 - status.r) * P_entrance() * 0.16;
  let pump = 1.0 + beat * P_beatPunch() * 0.10 * u.pulse;
  let skew = P_tilt() * 0.35;
  if (hasLyrics()) {
    let scale = P_size() * settle * pump;
    col += textStack(uv, scale, skew);
    // Halo: TWO RINGS of eight taps each, tight to the letterforms. Glyph
    // coverage is high-frequency data — a handful of wide point taps renders
    // as legible offset COPIES of the text (measured on device: four taps at
    // ~1% spread drew a dark echo of the whole line), so the halo has to be
    // many close taps whose average reads as dilation. Squared response
    // keeps it hugging the strokes; the tint follows the centre tap's own
    // sung/active state so unsung words never drown in glow.
    let mainC = mainCenterY();
    let center = bandTap(uv, BAND_MAIN_LO, BAND_MAIN_HI, mainC, scale, skew);
    let d1 = 0.0035 + P_glowReach() * 0.0065;
    var halo = 0.0;
    for (var k = 0; k < 8; k++) {
      let a = f32(k) * 0.7853981634; // TAU / 8
      let o = vec2f(cos(a), sin(a));
      halo += bandTap(uv + o * d1, BAND_MAIN_LO, BAND_MAIN_HI, mainC, scale, skew).r * 0.085;
      halo += bandTap(uv + o * d1 * 1.9, BAND_MAIN_LO, BAND_MAIN_HI, mainC, scale, skew).r * 0.04;
    }
    let cLit = clamp(max(center.g, center.b) / max(center.r, 1e-4), 0.0, 1.0);
    col += presetColor(P_hue() + P_hueSpread(), 0.6, 0.55)
         * halo * halo * P_glow() * (0.35 + 0.65 * max(cLit, 0.25 + 0.4 * beat))
         * (0.8 + 0.5 * beat * u.pulse);
  }

  // The rehearsal, whenever nothing real is on stage: no lyrics loaded, or
  // an instrumental stretch. The gate has a DEADZONE, not a linear fade —
  // measured on device, 1 - presence let the specimen flash through every
  // ordinary 1 s inter-line gap (the prev line's hold decays presence to
  // ~0.8 there, which read as placeholder blocks strobing behind the real
  // words). The smoothstep keeps short gaps clean and lets the specimen
  // bloom only once a genuine break has run for a couple of seconds; the
  // next line's lead-in raises presence again, so it also exits early.
  let rehearse = P_rehearse() * smoothstep(0.55, 0.15, presence);
  if (rehearse > 0.001) {
    let rows = clamp(floor(P_greekRows() * mix(0.55, 1.0, u.detail)), 2.0, 5.0);
    let rowH = 0.085 * P_size() * pump;
    let top = mainCenterY() - rows * rowH * 0.5;
    let ry = (uv.y - top) / max(rowH, 1e-4);
    if (ry >= 0.0 && ry < rows) {
      let row = floor(ry);
      // One sweep per bar, tempo-locked; a gridless track walks at a fixed
      // musical-ish pace from TRACK time.
      let sweep = select(fract(u.time * 0.22), u.barPhase, u.bpm > 1.0);
      let g = greekRow(uv.x + (ry - rows * 0.5) * rowH * skew, fract(ry), row, sweep);
      // The middle row is the headline; the needle's block takes the beat.
      let headline = select(0.55, 1.0, abs(row - floor(rows * 0.5)) < 0.5);
      let needle = exp(-abs(uv.x - sweep) * 16.0);
      var greek = presetColor(P_hue(), 0.4, 0.30 + 0.42 * P_unsungDim()) * g.x;
      greek = mix(greek, presetColor(P_hue() + P_hueSpread(), 0.65, 0.62) * g.x, g.y);
      greek += presetColor(P_hue() + P_hueSpread(), 0.5, 0.5)
             * g.x * needle * beat * P_wordGlow() * 0.6;
      col += greek * headline * rehearse;
    }
  }

  // Beat flare: the stage's own light answering the kick, brightest at the
  // floor so it reads as house lights rather than a screen flash.
  col += presetColor(P_hue() + P_hueSpread() * 0.5, 0.45, 0.5)
       * beat * P_flare() * 0.16 * u.pulse * (1.3 - uv.y);

  col *= vignette(uv, P_vignette());
  col = tonemap(col * 1.05);
  col += grain(uv, 0.008);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
