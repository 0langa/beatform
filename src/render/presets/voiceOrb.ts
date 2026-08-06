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
    // Frost — fine 8-lobe ripple, max sibilance sparkle, ring hugging the body.
    {
      id: "frost",
      name: "Frost",
      values: {
        hue: 198,
        size: 0.15,
        texture: 0.6,
        sparkle: 0.95,
        sparkleScale: 64,
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
      key: "sparkle",
      label: "Sibilance",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      hint: "Rim glints on S/T/hiss sounds",
    },
  ],
  advanced: [
    {
      key: "rmsBlend",
      label: "Instant blend",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.3,
      hint: "0 = slow smooth breathing, 1 = reacts to every syllable",
    },
    {
      key: "voiceFocus",
      label: "Voice focus",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.5,
      hint: "Weights the speech band (300-3400 Hz) over overall loudness — music moves the orb less, voices more",
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
      hint: "Strength of the wide 3-lobe ripple",
    },
    {
      key: "mode2",
      label: "Mode 5 amp",
      group: "motion",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.7,
      hint: "Strength of the medium 5-lobe ripple",
    },
    {
      key: "mode3",
      label: "Mode 8 amp",
      group: "motion",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.45,
      hint: "Strength of the fine 8-lobe ripple",
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
      key: "texture",
      label: "Surface texture",
      group: "shape",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0,
      hint: "Cloudy, slowly-drifting mottling across the orb body — 0 = smooth glass, high = hologram/frosted",
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
      hint: "Halo bleeding outward from the edge",
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
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.45,
      hint: "Darkening toward the screen corners",
    },
    {
      key: "flare",
      label: "Hot flare",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.5,
      hint: "How strongly rising speech volume flares the core and rim toward hot white",
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
    col += ringPal * smoothstep(0.004, 0.0008, dRing) * (0.35 + level * 0.5);
    col += ringPal * exp(-dRing * 120.0) * 0.18;
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
