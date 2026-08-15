import type { PresetDef } from "../types";
import { WGSL_PALETTE_STD } from "../wgslLib";

/**
 * Voice mode: built for voiceovers/narration, not music. A central orb
 * breathes with the speech envelope (energy floor keeps it alive in pauses),
 * formant-band harmonics ripple its surface, sibilance sparkles the rim, and
 * an optional circular waveform ring orbits it. No beat machinery — speech
 * has none worth strobing to.
 *
 * Visual-review fixes (docs/VISUAL-DESIGN.md):
 *   - body/background/ring were flat hsl2rgb fills — swapped for a cosPalette
 *     cosine gradient, which reads richer at the same brightness (section 1);
 *   - nothing ever exceeded 1.0, so the orb only ever got "lighter", never
 *     read as emitting. Loud speech now pushes the core and rim toward a
 *     genuine hot-white flare (new `flare` param), with tonemap() as the
 *     final color step to roll that off instead of clipping per channel;
 *   - added a club-mirror `mirror` param (kaleido): the orb silhouette itself
 *     stays circular (it's radius-gated), but the formant ripple, sparkle
 *     field and wave ring all read angle, so folding them makes a symmetric
 *     voice-reactive mandala — an opt-in look, off by default.
 *
 * Track B depth wave (audit RP-24.9 / B0): the mode had a full expert tier
 * hiding its character behind the Advanced fold, so this wave is curation
 * plus two additive features rather than construction:
 *   - promoted to Essentials: `texture`, `flare`, `mirror` (the B0 list) and
 *     `voiceFocus` (the knob that decides whether this is a VOICE orb or a
 *     music orb — the mode's character axis, and what Full Band pivots on);
 *   - `satellites`: up to three companion orbs, each breathing with its own
 *     slice of the speech band, so multi-speaker podcasts read as multiple
 *     voices — the mode's own headline use case. Off by default;
 *   - `ringStyle`: the wave ring as the classic line, a chain of dots, or
 *     beads threaded on a faint line. Line (the shipped look) by default.
 * Both features are gated off at their defaults, so existing projects and
 * the default chip render pixel-identically to the pre-wave shader.
 */
export const voiceOrb: PresetDef = {
  id: "voice-orb",
  name: "Voice Orb",
  description:
    "Made for voiceovers: an orb that breathes with speech, ripples with vowels, sparkles on S-sounds.",
  styles: [
    // Aqua Calm — the defaults — a calm orb with a waveform ring.
    { id: "aqua", name: "Aqua Calm", values: {} },
    // Podcast — small, smooth, ring pushed far out: a quiet talking-head badge.
    {
      id: "podcast",
      name: "Podcast",
      values: {
        hue: 212,
        size: 0.13,
        response: 0.5,
        wobble: 0.28,
        ringDist: 1.75,
        ringWave: 0.02,
        sparkle: 0.2,
        rmsBlend: 0.12,
        voiceFocus: 0.8,
        growth: 0.6,
        coreGlow: 0.1,
        rimGlow: 0.22,
        flare: 0.28,
        breathGlow: 0.18,
        idleBreath: 0.008,
        mode2: 0.4,
        mode3: 0.15,
        bgLevel: 0.02,
        vignette: 0.4,
      },
    },
    // Roundtable — three satellite voices around a host orb, no ring: a panel
    // discussion where whoever is speaking visibly lights up.
    {
      id: "roundtable",
      name: "Roundtable",
      values: {
        hue: 258,
        size: 0.13,
        satellites: 3,
        satSize: 0.34,
        satDist: 1.9,
        satOrbit: 0.12,
        ring: 0,
        response: 0.5,
        voiceFocus: 0.86,
        rmsBlend: 0.4,
        wobble: 0.35,
        growth: 0.6,
        rimGlow: 0.4,
        flare: 0.3,
        coreGlow: 0.22,
        breathGlow: 0.2,
        sparkle: 0.3,
        bgLevel: 0.025,
        vignette: 0.5,
      },
    },
    // Hologram — textured body folded six ways with a tight ring — projected, not solid.
    {
      id: "hologram",
      name: "Hologram",
      values: {
        hue: 176,
        size: 0.19,
        texture: 0.86,
        sparkle: 0.7,
        sparkleScale: 52,
        rimGlow: 0.6,
        flare: 0.3,
        mirror: 6,
        ringDist: 1.3,
        ringWave: 0.08,
        wobble: 0.7,
        mode3: 1.2,
        coreGlow: 0.3,
        breathGlow: 0.12,
        bgLevel: 0.03,
        vignette: 0.5,
      },
    },
    // Broadcast — ring off, instant syllable response, hot flare: a live mic light.
    {
      id: "broadcast",
      name: "Broadcast",
      values: {
        hue: 8,
        size: 0.18,
        ring: 0,
        response: 0.9,
        rmsBlend: 0.7,
        voiceFocus: 0.96,
        growth: 1.15,
        wobble: 0.3,
        mode1: 1.4,
        mode2: 0.5,
        mode3: 0.2,
        flare: 0.9,
        rimGlow: 0.5,
        coreGlow: 0.36,
        sparkle: 0.24,
        breathGlow: 0.06,
        idleBreath: 0.006,
        bgLevel: 0.02,
        vignette: 0.55,
      },
    },
    // Sonar — a dotted sweep ring and two small contact blips patrolling far
    // out: speech pings the display, silence breathes like a idle scope.
    {
      id: "sonar",
      name: "Sonar",
      values: {
        hue: 135,
        size: 0.12,
        ringStyle: 1,
        ringCount: 56,
        ringDist: 1.6,
        ringWave: 0.03,
        satellites: 2,
        satSize: 0.16,
        satDist: 2.2,
        satOrbit: 0.45,
        response: 0.75,
        rmsBlend: 0.5,
        voiceFocus: 0.9,
        wobble: 0.25,
        mode3: 0.9,
        sparkle: 0.35,
        sparkleScale: 60,
        flare: 0.24,
        coreGlow: 0.3,
        rimGlow: 0.24,
        texture: 0.16,
        breathGlow: 0.3,
        idleBreath: 0.02,
        bgLevel: 0.02,
        vignette: 0.65,
      },
    },
    // Candlelight — ring off, big slow wobble and idle breathing — a flame in the dark.
    {
      id: "candlelight",
      name: "Candlelight",
      values: {
        hue: 28,
        size: 0.2,
        ring: 0,
        texture: 0.42,
        wobble: 0.85,
        wobScale: 0.05,
        mode1: 1.5,
        mode2: 0.9,
        mode3: 0.3,
        sparkle: 0.12,
        flare: 0.62,
        coreGlow: 0.42,
        breathGlow: 0.4,
        idleBreath: 0.028,
        rimGlow: 0.44,
        growth: 0.65,
        rmsBlend: 0.2,
        bgLevel: 0.03,
        vignette: 0.6,
      },
    },
    // Pearls — a close bead necklace around a softly textured orb: elegant,
    // slow, the beads glinting as syllables pass under them.
    {
      id: "pearls",
      name: "Pearls",
      values: {
        hue: 318,
        size: 0.17,
        ringStyle: 2,
        ringCount: 33,
        ringDist: 1.35,
        ringWave: 0.02,
        response: 0.45,
        wobble: 0.3,
        wobScale: 0.02,
        texture: 0.3,
        sparkle: 0.7,
        sparkleScale: 44,
        flare: 0.4,
        rimGlow: 0.5,
        coreGlow: 0.14,
        breathGlow: 0.22,
        growth: 0.5,
        bgLevel: 0.045,
        vignette: 0.4,
      },
    },
    // Frost — fine 8-lobe ripple folded eight ways into a literal snowflake,
    // max sibilance sparkle, ring hugging the body. (Wave rework: the 8-fold
    // mirror is what makes the name true — the 8-lobe ripple was already here.)
    {
      id: "frost",
      name: "Frost",
      values: {
        hue: 198,
        size: 0.15,
        texture: 0.6,
        sparkle: 0.95,
        sparkleScale: 64,
        mirror: 8,
        mode1: 0.5,
        mode2: 1,
        mode3: 1.6,
        wobble: 0.6,
        wobScale: 0.04,
        rimGlow: 0.42,
        flare: 0.34,
        ringDist: 1.15,
        ringWave: 0.09,
        coreGlow: 0.1,
        bgLevel: 0.02,
        vignette: 0.5,
      },
    },
    // Full Band — voice focus off — reacts to whole music, max ring wave and wobble.
    {
      id: "fullBand",
      name: "Full Band",
      values: {
        hue: 292,
        size: 0.17,
        voiceFocus: 0,
        rmsBlend: 0.8,
        response: 0.85,
        growth: 1.3,
        wobble: 1,
        wobScale: 0.07,
        mode1: 1.2,
        mode2: 1.2,
        mode3: 1,
        ringDist: 1.6,
        ringWave: 0.12,
        sparkle: 0.6,
        flare: 0.8,
        rimGlow: 0.7,
        coreGlow: 0.5,
        texture: 0.2,
        breathGlow: 0.04,
        idleBreath: 0.004,
        bgLevel: 0.04,
        vignette: 0.35,
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
      default: 195,
      hint: "Orb color",
    },
    {
      key: "size",
      label: "Size",
      group: "shape",
      min: 0.08,
      max: 0.3,
      step: 0.005,
      default: 0.16,
      hint: "Resting orb size",
    },
    {
      key: "satellites",
      label: "Satellites",
      group: "shape",
      control: "enum",
      mod: "snap",
      options: [
        { value: 0, label: "None" },
        { value: 1, label: "1 orb" },
        { value: 2, label: "2 orbs" },
        { value: 3, label: "3 orbs" },
      ],
      min: 0,
      max: 3,
      step: 1,
      default: 0,
      hint: "Small companion orbs circling the main one — each breathes with its own slice of the voice, so extra speakers read as extra orbs",
    },
    {
      key: "ring",
      label: "Wave ring",
      group: "shape",
      control: "toggle",
      mod: "off",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Circular waveform orbiting the orb",
    },
    {
      key: "ringStyle",
      label: "Ring style",
      group: "shape",
      control: "enum",
      mod: "off",
      options: [
        { value: 0, label: "Line" },
        { value: 1, label: "Dots" },
        { value: 2, label: "Beads" },
      ],
      min: 0,
      max: 2,
      step: 1,
      default: 0,
      hint: "How the wave ring is drawn — a solid line, a chain of small dots, or a few larger beads threaded on a faint line",
    },
    {
      key: "mirror",
      label: "Club mirror",
      group: "shape",
      control: "enum",
      mod: "snap",
      options: [
        { value: 1, label: "Off" },
        { value: 2, label: "Mirrored" },
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
      ],
      min: 1,
      max: 12,
      step: 1,
      default: 1,
      hint: "Fold the ripple pattern into a symmetric mandala around the orb — 1 is off, 2 mirrors left/right, higher makes a kaleidoscope",
    },
    {
      key: "texture",
      label: "Surface texture",
      group: "shape",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      hint: "Cloudy, slowly-drifting mottling across the orb body — 0 = smooth glass, high = hologram/frosted",
    },
    {
      key: "response",
      label: "Response",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
      hint: "How strongly the orb reacts to speech loudness",
    },
    {
      key: "voiceFocus",
      label: "Voice focus",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      hint: "Weights the speech band (300-3400 Hz) over overall loudness — music moves the orb less, voices more",
    },
    {
      key: "wobble",
      label: "Wobble",
      group: "motion",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      hint: "Surface ripple driven by vowel tones",
    },
    {
      key: "sparkle",
      label: "Sibilance",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      hint: "Rim glints on S/T/hiss sounds",
    },
    {
      key: "flare",
      label: "Hot flare",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      hint: "How strongly rising speech volume flares the core and rim toward hot white",
    },
  ],
  advanced: [
    {
      key: "rmsBlend",
      label: "Instant blend",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.3,
      hint: "0 = slow smooth breathing, 1 = reacts to every syllable",
    },
    {
      key: "growth",
      label: "Level growth",
      group: "reaction",
      min: 0,
      max: 1.4,
      step: 0.05,
      default: 0.85,
      hint: "How much the orb grows when speaking (kept inside the frame)",
    },
    {
      key: "idleBreath",
      label: "Idle breathing",
      group: "motion",
      min: 0,
      max: 0.05,
      step: 0.002,
      default: 0.012,
      hint: "Gentle size pulse during silence",
    },
    {
      key: "wobScale",
      label: "Wobble scale",
      group: "motion",
      min: 0,
      max: 0.08,
      step: 0.002,
      default: 0.03,
      hint: "Overall ripple depth",
    },
    {
      key: "mode1",
      label: "Mode 3 amp",
      group: "motion",
      min: 0,
      max: 2,
      step: 0.05,
      default: 1,
      hint: "Strength of the wide 3-lobe ripple (key: mode1)",
    },
    {
      key: "mode2",
      label: "Mode 5 amp",
      group: "motion",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.7,
      hint: "Strength of the medium 5-lobe ripple (key: mode2)",
    },
    {
      key: "mode3",
      label: "Mode 8 amp",
      group: "motion",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.45,
      hint: "Strength of the fine 8-lobe ripple (key: mode3)",
    },
    {
      key: "coreGlow",
      label: "Core glow",
      group: "glow",
      min: 0,
      max: 0.6,
      step: 0.02,
      default: 0.18,
      hint: "Inner light at the orb's center",
    },
    {
      key: "breathGlow",
      label: "Breath glow",
      group: "glow",
      min: 0,
      max: 0.6,
      step: 0.02,
      default: 0.14,
      hint: "Slow brightness breathing of the orb and its aura during silence — fades out while talking",
    },
    {
      key: "rimGlow",
      label: "Rim glow",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.3,
      hint: "Halo bleeding outward from the edge (satellites share it for their own rims)",
    },
    {
      key: "ringDist",
      label: "Ring distance",
      group: "shape",
      min: 1.1,
      max: 1.9,
      step: 0.05,
      default: 1.45,
      hint: "How far the wave ring orbits from the orb (kept inside the frame)",
    },
    {
      key: "ringWave",
      label: "Ring wave",
      group: "shape",
      min: 0,
      max: 0.12,
      step: 0.005,
      default: 0.045,
      hint: "How much the voice waveform bends the ring",
    },
    {
      key: "ringCount",
      label: "Ring dots",
      group: "shape",
      mod: "snap",
      min: 8,
      max: 72,
      step: 1,
      default: 36,
      hint: "How many dots the ring breaks into (Beads use a third of this) — needs Ring style set to Dots or Beads",
    },
    {
      key: "satSize",
      label: "Satellite size",
      group: "shape",
      min: 0.12,
      max: 0.45,
      step: 0.01,
      default: 0.28,
      hint: "Satellite size as a share of the main orb — each still swells as its own voice speaks",
    },
    {
      key: "satDist",
      label: "Satellite distance",
      group: "shape",
      min: 1.3,
      max: 2.4,
      step: 0.05,
      default: 1.75,
      hint: "How far the satellites circle from the main orb (kept inside the frame)",
    },
    {
      key: "satOrbit",
      label: "Orbit speed",
      group: "motion",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.2,
      hint: "How fast the satellites travel around the orb — 0 parks them in place",
    },
    {
      key: "sparkleScale",
      label: "Sparkle scale",
      group: "glow",
      min: 10,
      max: 80,
      step: 2,
      default: 34,
      hint: "Size of the sibilance glints",
    },
    {
      key: "bgLevel",
      label: "Bg level",
      group: "backdrop",
      min: 0,
      max: 0.12,
      step: 0.005,
      default: 0.035,
      hint: "Background wash brightness",
    },
    {
      key: "vignette",
      label: "Vignette",
      group: "backdrop",
      tier: "curated",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.45,
      hint: "Darkening toward the screen corners",
    },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  var p = centered(uv);
  p = kaleido(p, P_mirror());
  let r = length(p);
  let a = atan2(p.y, p.x);

  // Speech level: mostly the slow envelope, a touch of instantaneous —
  // keeps the orb's size calm instead of pumping on every syllable. u.voice
  // (the dedicated 300-3400 Hz band) anchors it to actual speech energy, so
  // music bleed (bass, cymbals) moves the orb far less than a voice does.
  let raw = mix(u.drive, u.rms, P_rmsBlend());
  let speech = mix(raw, u.voice, P_voiceFocus());
  let level = clamp(speech * (0.6 + P_response() * 1.4), 0.0, 1.0);
  // Idle breathing keeps the orb alive during pauses, fades out when talking
  let silence = 1.0 - smoothstep(0.03, 0.12, level);
  let idle = silence * sin(u.time * 1.3) * P_idleBreath();
  // Breath GLOW is the brightness companion to the size breathing above: a
  // slow 0..1 swell (never negative, so it only ever adds light) that fades
  // out the instant speech begins.
  let breathG = silence * (0.5 + 0.5 * sin(u.time * 1.3)) * P_breathGlow();

  // Surface wobble: three slowly-rotating sinusoidal modes whose amplitudes
  // track wide formant-band averages (~200 Hz - 3 kHz). The shape itself is
  // always smooth — voice only modulates how much each mode swells, so the
  // edge undulates organically instead of twitching per-bin.
  let f1 = (binAt(0.32) + binAt(0.36) + binAt(0.40)) / 3.0;
  let f2 = (binAt(0.44) + binAt(0.48) + binAt(0.52)) / 3.0;
  let f3 = (binAt(0.55) + binAt(0.58) + binAt(0.61)) / 3.0;
  let m1 = sin(a * 3.0 + u.time * 0.6);
  let m2 = sin(a * 5.0 - u.time * 0.8 + 1.7);
  let m3 = sin(a * 8.0 + u.time * 1.1 + 4.1);
  let disp = (m1 * f1 * P_mode1() + m2 * f2 * P_mode2() + m3 * f3 * P_mode3())
           * P_wobble() * P_wobScale() * (0.25 + level * 0.75);

  // Frame-safety: the orb (and its ring below) must stay inside the frame —
  // the top/bottom edge is r=0.5 — however loud the voice or high the growth.
  // Soft frame limits (v2.44 law; audit R3 — the one spot the kit missed):
  // the orb compresses toward the largest inscribed circle instead of
  // flattening against a hard 0.4/0.46 wall at max Size + loud voice.
  let radius = softLimit(P_size() * (1.0 + level * P_growth()) + idle, frameCircle() * 0.86);
  // The ripple is applied as a FRACTION of the body, not as an absolute offset.
  // At max mode amps and max Wobble disp reaches +-0.48 while Size bottoms out
  // at 0.08, and a raw radius + disp then goes NEGATIVE on the trough of every
  // ripple: softLimit() is identity below its knee, so it passes that straight
  // through, inside is 0 everywhere and the orb AND its rim blink out on half
  // of each cycle. Bounding the ratio holds the surface between 0.4x and 1.9x
  // the body; at any sane setting disp/radius sits well inside that window, so
  // the ripple itself is unchanged.
  let edge = softLimit(radius * (1.0 + clamp(disp / max(radius, 1e-3), -0.6, 0.9)),
                       frameCircle() * 0.95);

  // Cosine palette instead of flat hsl2rgb fills — stays saturated at low
  // brightness (the background wash) and gives the hot-white pushes below
  // clean room to exceed 1.0 without a per-channel clip.
  // The classic cosPalette basis runs its rainbow opposite HSL (red still
  // lands at t=0, but t increasing walks red->magenta->blue->cyan->green->
  // yellow->red) — "1.0 - hue/360" un-reverses it so Hue keeps its label.
  let baseT = 1.0 - P_hue() / 360.0;
  let pal = cosPalette(baseT, ${WGSL_PALETTE_STD});

  // Background: quiet radial wash that warms slightly with speech
  var col = mix(pal, vec3f(1.0), 0.15) * (P_bgLevel() + level * 0.02) * (1.0 - r * 0.75);

  // Orb body: soft inner gradient, brighter core as level rises
  let inside = smoothstep(edge, edge - 0.012, r);
  let coreGlow = exp(-r * (7.0 - level * 2.0));
  let bodyLevel = 0.16 + level * 0.30 + coreGlow * (P_coreGlow() + level * 0.25);
  var body = pal * bodyLevel;
  // Surface texture: slowly-drifting fbm mottling read in orb-local space, so
  // it folds with the club mirror and gives the body a cloudy / holographic /
  // frosted character instead of a smooth even fill. Off by default.
  if (P_texture() > 0.01) {
    let tn = fbm(p * 7.0 + vec2f(u.time * 0.12, -u.time * 0.09));
    body *= (1.0 - P_texture() * 0.55) + P_texture() * 0.55 * (0.35 + tn * 1.3);
  }
  // Hot core: loud speech desaturates the very center toward white and pushes
  // it past 1.0 — the difference between "brighter" and actually emitting.
  let hot = smoothstep(0.5, 0.95, coreGlow * level) * P_flare();
  body = mix(body, vec3f(1.0), hot) * (1.0 + hot * 1.4);
  col = mix(col, body, inside);

  // Rim: bright line at the orb edge + soft outer halo, flaring hot on peaks
  let rimD = abs(r - edge);
  let rimHot = smoothstep(0.3, 0.9, level) * P_flare();
  let rimCol = mix(pal, vec3f(1.0), 0.35 + rimHot * 0.5);
  col += rimCol * smoothstep(0.006, 0.0, rimD) * (0.5 + level * 0.5) * (1.0 + rimHot * 1.2);
  col += pal * exp(-max(r - edge, 0.0) * 22.0) * P_rimGlow() * (0.3 + level);

  // Sibilance sparkles: treble noise riding the rim band
  let rimBand = exp(-rimD * 40.0);
  let sparkleN = pow(noise2(p * P_sparkleScale() + vec2f(u.time * 5.0, -u.time * 3.0)), 10.0);
  col += vec3f(1.0, 0.98, 0.95) * sparkleN * rimBand * u.treble * P_sparkle() * 2.2;

  // Circular waveform ring
  if (P_ring() > 0.5) {
    let wv = waveAt(fract(a / TAU + 0.5));
    let ringR = softLimit(radius * P_ringDist() + wv * P_ringWave() * (0.35 + level * 1.2),
                          frameCircle());
    let dRing = abs(r - ringR);
    let ringT = fract(baseT + 0.07 + wv * 0.05);
    let ringPal = cosPalette(ringT, ${WGSL_PALETTE_STD});
    if (P_ringStyle() < 0.5) {
      // Line — the classic continuous waveform ring, expressions untouched
      // from before Ring style existed, so the default look cannot drift.
      col += ringPal * smoothstep(0.004, 0.0008, dRing) * (0.35 + level * 0.5);
      col += ringPal * exp(-dRing * 120.0) * 0.18;
    } else {
      // Dots / beads: the same waveform radius, sampled at N fixed angular
      // stations instead of drawn as a continuous line. round() guards the
      // comb against a fractional count — mod:"snap" keeps modulated values
      // whole, but a partial station at the wrap seam must stay impossible
      // by construction. At integer counts the +-PI wrap is seamless: both
      // representations of the seam station sample waveAt(0).
      let beads = P_ringStyle() > 1.5;
      let n = max(round(select(P_ringCount(), P_ringCount() / 3.0, beads)), 3.0);
      let seg = TAU / n;
      let ai = floor(a / seg + 0.5) * seg;
      let wvi = waveAt(fract(ai / TAU + 0.5));
      let stR = softLimit(radius * P_ringDist() + wvi * P_ringWave() * (0.35 + level * 1.2),
                          frameCircle());
      // Planar distance to the station point: radial offset + arc offset.
      let dDot = sqrt((r - stR) * (r - stR) + (a - ai) * (a - ai) * r * r);
      // Station size scales with the arc spacing so neighbours never merge;
      // beads are fewer and fatter than dots.
      let dotR = stR * seg * select(0.26, 0.36, beads);
      let stT = fract(baseT + 0.07 + wvi * 0.05);
      let stPal = cosPalette(stT, ${WGSL_PALETTE_STD});
      // Each station swells on its own waveform sample, so syllables visibly
      // travel around the ring instead of brightening it uniformly.
      let swell = 0.8 + abs(wvi) * 1.5 + level * 0.3;
      col += stPal * smoothstep(dotR, dotR * 0.35, dDot) * (0.4 + level * 0.5) * swell;
      col += stPal * exp(-dDot * 90.0) * 0.14;
      if (beads) {
        // Beads read as pearls on a thread: a specular white centre plus the
        // faint line they hang from.
        col += vec3f(1.0, 0.99, 0.96) * smoothstep(dotR * 0.45, 0.0, dDot) * 0.5 * swell;
        col += ringPal * exp(-dRing * 120.0) * 0.09;
      }
    }
  }

  // Satellite orbs: companion voices around the main orb. Each satellite
  // tracks its own slice of the speech band (low / mid / high formants), so
  // in a two- or three-person recording different orbs visibly light up as
  // different voices speak. Drawn in folded space, so the club mirror
  // multiplies them into the same mandala as everything else. Off by default.
  if (P_satellites() > 0.5) {
    for (var i = 0; i < 3; i++) {
      let fi = f32(i);
      if (fi < P_satellites() - 0.5) {
        // Non-overlapping two-bin formant slices per satellite (0.30..0.60).
        let band = (binAt(0.30 + fi * 0.12) + binAt(0.36 + fi * 0.12)) * 0.5;
        // Slow deterministic orbit off track time (never wall clock), with
        // staggered speeds so the trio never freezes into one constellation.
        let aSat = u.time * P_satOrbit() * (0.5 + fi * 0.23) + fi * (TAU / 3.0) + 0.7;
        // Frame safety, same law as the orb and ring: the satellite's EDGE
        // (centre + own radius) compresses against the frame circle. The hard
        // cap on sr keeps a companion a companion at any Size x swell combo.
        let sr = min(radius * P_satSize() * (0.7 + band * 1.4 + level * 0.3),
                     frameCircle() * 0.22);
        let orbitR = softLimit(radius * P_satDist(), frameCircle() * 0.97 - sr);
        let c = vec2f(cos(aSat), sin(aSat)) * orbitR;
        let d = length(p - c);
        let satT = fract(baseT + 0.05 + fi * 0.07);
        let satPal = cosPalette(satT, ${WGSL_PALETTE_STD});
        // A miniature of the orb's own grammar: soft body that brightens as
        // its band speaks, a rim halo sharing the Rim glow knob, and a share
        // of the breath glow so a silent panel still reads alive.
        let satInside = smoothstep(sr, sr * 0.55, d);
        col += satPal * satInside * (0.22 + band * 1.0 + level * 0.18 + breathG * 0.5);
        col += satPal * exp(-max(d - sr, 0.0) * 30.0) * (0.1 + band * 0.45) * (0.4 + P_rimGlow());
      }
    }
  }

  // Breath glow: during silence the orb body and its outer halo swell in
  // brightness (size breathing is handled separately by idle), a calm 'alive'
  // pulse for a resting mic that vanishes the moment speech starts.
  col += pal * inside * breathG;
  col += pal * exp(-max(r - edge, 0.0) * 20.0) * breathG * 0.6;

  // Vignette is the shared smooth full-field falloff (never a hard-edged
  // circle — the orb, rim and ring above are already soft-limited against
  // frameCircle(), which tracks the frame's short side rather than the fixed
  // radius the pre-v2.44 code clipped against).
  col *= vignette(uv, P_vignette());
  col = tonemap(col * 1.15);
  col += grain(uv, 0.012);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
