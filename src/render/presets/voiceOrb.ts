import type { PresetDef } from "../types";

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
    { id: "aqua", name: "Aqua Calm", values: {} },
    { id: "warm", name: "Warm Host", values: { hue: 25, sparkle: 0.35 } },
    {
      id: "midnight",
      name: "Midnight",
      values: { hue: 260, sparkle: 0.8, rimGlow: 0.5, flare: 0.3 },
    },
    {
      id: "minimal",
      name: "Minimal",
      values: { ring: 0, sparkle: 0.1, wobble: 0.25, flare: 0.15 },
    },
    {
      id: "broadcast",
      name: "Broadcast",
      values: {
        hue: 0,
        sparkle: 0.25,
        wobble: 0.35,
        voiceFocus: 0.9,
        response: 0.75,
        rmsBlend: 0.5,
        flare: 0.75,
      },
    },
    {
      id: "forest",
      name: "Forest",
      values: { hue: 140, sparkle: 0.4, wobble: 0.7, size: 0.19, ring: 1, flare: 0.4 },
    },
  ],
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 195, hint: "Orb color" },
    {
      key: "size",
      label: "Size",
      min: 0.08,
      max: 0.3,
      step: 0.005,
      default: 0.16,
      hint: "Resting orb size",
    },
    {
      key: "response",
      label: "Response",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
      hint: "How strongly the orb reacts to speech loudness",
    },
    {
      key: "wobble",
      label: "Wobble",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      hint: "Surface ripple driven by vowel tones",
    },
    {
      key: "ring",
      label: "Wave ring",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Circular waveform orbiting the orb",
    },
    {
      key: "sparkle",
      label: "Sibilance",
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
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.3,
      hint: "0 = slow smooth breathing, 1 = reacts to every syllable",
    },
    {
      key: "voiceFocus",
      label: "Voice focus",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.5,
      hint: "Weights the speech band (300-3400 Hz) over overall loudness — music moves the orb less, voices more",
    },
    {
      key: "growth",
      label: "Level growth",
      min: 0,
      max: 1.4,
      step: 0.05,
      default: 0.85,
      hint: "How much the orb grows when speaking (kept inside the frame)",
    },
    {
      key: "idleBreath",
      label: "Idle breathing",
      min: 0,
      max: 0.05,
      step: 0.002,
      default: 0.012,
      hint: "Gentle size pulse during silence",
    },
    {
      key: "wobScale",
      label: "Wobble scale",
      min: 0,
      max: 0.08,
      step: 0.002,
      default: 0.03,
      hint: "Overall ripple depth",
    },
    {
      key: "mode1",
      label: "Mode 3 amp",
      min: 0,
      max: 2,
      step: 0.05,
      default: 1,
      hint: "Strength of the wide 3-lobe ripple",
    },
    {
      key: "mode2",
      label: "Mode 5 amp",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.7,
      hint: "Strength of the medium 5-lobe ripple",
    },
    {
      key: "mode3",
      label: "Mode 8 amp",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.45,
      hint: "Strength of the fine 8-lobe ripple",
    },
    {
      key: "coreGlow",
      label: "Core glow",
      min: 0,
      max: 0.6,
      step: 0.02,
      default: 0.18,
      hint: "Inner light at the orb's center",
    },
    {
      key: "rimGlow",
      label: "Rim glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.3,
      hint: "Halo bleeding outward from the edge",
    },
    {
      key: "ringDist",
      label: "Ring distance",
      min: 1.1,
      max: 1.9,
      step: 0.05,
      default: 1.45,
      hint: "How far the wave ring orbits from the orb (kept inside the frame)",
    },
    {
      key: "ringWave",
      label: "Ring wave",
      min: 0,
      max: 0.12,
      step: 0.005,
      default: 0.045,
      hint: "How much the voice waveform bends the ring",
    },
    {
      key: "sparkleScale",
      label: "Sparkle scale",
      min: 10,
      max: 80,
      step: 2,
      default: 34,
      hint: "Size of the sibilance glints",
    },
    {
      key: "bgLevel",
      label: "Bg level",
      min: 0,
      max: 0.12,
      step: 0.005,
      default: 0.035,
      hint: "Background wash brightness",
    },
    {
      key: "vignette",
      label: "Vignette",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.45,
      hint: "Darkening toward the screen corners",
    },
    {
      key: "flare",
      label: "Hot flare",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.5,
      hint: "How strongly rising speech volume flares the core and rim toward hot white",
    },
    {
      key: "mirror",
      label: "Club mirror",
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
  let idle = (1.0 - smoothstep(0.03, 0.12, level)) * sin(u.time * 1.3) * P_idleBreath();

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
  let radius = min(P_size() * (1.0 + level * P_growth()) + idle, 0.4);
  let edge = min(radius + disp, 0.46);

  // Cosine palette instead of flat hsl2rgb fills — stays saturated at low
  // brightness (the background wash) and gives the hot-white pushes below
  // clean room to exceed 1.0 without a per-channel clip.
  // The classic cosPalette basis runs its rainbow opposite HSL (red still
  // lands at t=0, but t increasing walks red->magenta->blue->cyan->green->
  // yellow->red) — "1.0 - hue/360" un-reverses it so Hue keeps its label.
  let baseT = 1.0 - P_hue() / 360.0;
  let pal = cosPalette(baseT, vec3f(0.5), vec3f(0.5), vec3f(1.0), vec3f(0.0, 0.33, 0.67));

  // Background: quiet radial wash that warms slightly with speech
  var col = mix(pal, vec3f(1.0), 0.15) * (P_bgLevel() + level * 0.02) * (1.0 - r * 0.75);

  // Orb body: soft inner gradient, brighter core as level rises
  let inside = smoothstep(edge, edge - 0.012, r);
  let coreGlow = exp(-r * (7.0 - level * 2.0));
  let bodyLevel = 0.16 + level * 0.30 + coreGlow * (P_coreGlow() + level * 0.25);
  var body = pal * bodyLevel;
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
    let ringR = min(radius * P_ringDist() + wv * P_ringWave() * (0.35 + level * 1.2), 0.47);
    let dRing = abs(r - ringR);
    let ringT = fract(baseT + 0.07 + wv * 0.05);
    let ringPal = cosPalette(ringT, vec3f(0.5), vec3f(0.5), vec3f(1.0), vec3f(0.0, 0.33, 0.67));
    col += ringPal * smoothstep(0.004, 0.0008, dRing) * (0.35 + level * 0.5);
    col += ringPal * exp(-dRing * 120.0) * 0.18;
  }

  // Vignette is the shared smooth full-field falloff (never a hard-edged
  // circle — the orb/rim/ring above are already clamped to r<=0.47).
  col *= vignette(uv, P_vignette());
  col = tonemap(col * 1.15);
  col += grain(uv, 0.012);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
