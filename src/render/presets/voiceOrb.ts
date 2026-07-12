import type { PresetDef } from "../types";

/**
 * Voice mode: built for voiceovers/narration, not music. A central orb
 * breathes with the speech envelope (energy floor keeps it alive in pauses),
 * formant-band harmonics ripple its surface, sibilance sparkles the rim, and
 * an optional circular waveform ring orbits it. No beat machinery — speech
 * has none worth strobing to.
 */
export const voiceOrb: PresetDef = {
  id: "voice-orb",
  name: "Voice Orb",
  description: "Made for voiceovers: an orb that breathes with speech, ripples with vowels, sparkles on S-sounds.",
  styles: [
    { id: "aqua", name: "Aqua Calm", values: {} },
    { id: "warm", name: "Warm Host", values: { hue: 25, sparkle: 0.35 } },
    { id: "midnight", name: "Midnight", values: { hue: 260, sparkle: 0.8, rimGlow: 0.5 } },
    { id: "minimal", name: "Minimal", values: { ring: 0, sparkle: 0.1, wobble: 0.25 } },
  ],
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 195, hint: "Orb color" },
    { key: "size", label: "Size", min: 0.08, max: 0.3, step: 0.005, default: 0.16, hint: "Resting orb size" },
    { key: "response", label: "Response", min: 0, max: 1, step: 0.01, default: 0.6, hint: "How strongly the orb reacts to speech loudness" },
    { key: "wobble", label: "Wobble", min: 0, max: 1, step: 0.01, default: 0.5, hint: "Surface ripple driven by vowel tones" },
    { key: "ring", label: "Wave ring", min: 0, max: 1, step: 1, default: 1, hint: "Circular waveform orbiting the orb" },
    { key: "sparkle", label: "Sibilance", min: 0, max: 1, step: 0.01, default: 0.5, hint: "Rim glints on S/T/hiss sounds" },
  ],
  advanced: [
    { key: "rmsBlend", label: "Instant blend", min: 0, max: 1, step: 0.02, default: 0.3, hint: "0 = slow smooth breathing, 1 = reacts to every syllable" },
    { key: "growth", label: "Level growth", min: 0, max: 2, step: 0.05, default: 0.85, hint: "How much the orb grows when speaking" },
    { key: "idleBreath", label: "Idle breathing", min: 0, max: 0.05, step: 0.002, default: 0.012, hint: "Gentle size pulse during silence" },
    { key: "wobScale", label: "Wobble scale", min: 0, max: 0.08, step: 0.002, default: 0.03, hint: "Overall ripple depth" },
    { key: "mode1", label: "Mode 3 amp", min: 0, max: 2, step: 0.05, default: 1, hint: "Strength of the wide 3-lobe ripple" },
    { key: "mode2", label: "Mode 5 amp", min: 0, max: 2, step: 0.05, default: 0.7, hint: "Strength of the medium 5-lobe ripple" },
    { key: "mode3", label: "Mode 8 amp", min: 0, max: 2, step: 0.05, default: 0.45, hint: "Strength of the fine 8-lobe ripple" },
    { key: "coreGlow", label: "Core glow", min: 0, max: 0.6, step: 0.02, default: 0.18, hint: "Inner light at the orb's center" },
    { key: "rimGlow", label: "Rim glow", min: 0, max: 1, step: 0.02, default: 0.3, hint: "Halo bleeding outward from the edge" },
    { key: "ringDist", label: "Ring distance", min: 1.1, max: 2.2, step: 0.05, default: 1.45, hint: "How far the wave ring orbits from the orb" },
    { key: "ringWave", label: "Ring wave", min: 0, max: 0.12, step: 0.005, default: 0.045, hint: "How much the voice waveform bends the ring" },
    { key: "sparkleScale", label: "Sparkle scale", min: 10, max: 80, step: 2, default: 34, hint: "Size of the sibilance glints" },
    { key: "bgLevel", label: "Bg level", min: 0, max: 0.12, step: 0.005, default: 0.035, hint: "Background wash brightness" },
    { key: "vignette", label: "Vignette", min: 0, max: 1, step: 0.05, default: 0.45, hint: "Darkening toward the screen corners" },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  let p = centered(uv);
  let r = length(p);
  let a = atan2(p.y, p.x);

  // Speech level: mostly the slow envelope, a touch of instantaneous —
  // keeps the orb's size calm instead of pumping on every syllable.
  let level = clamp(mix(u.energy, u.rms, P_rmsBlend()) * (0.6 + P_response() * 1.4), 0.0, 1.0);
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

  let radius = P_size() * (1.0 + level * P_growth()) + idle;
  let edge = radius + disp;

  // Background: quiet radial wash that warms slightly with speech
  var col = hsl2rgb(P_hue() + 30.0, 0.45, P_bgLevel() + level * 0.02) * (1.0 - r * 0.75);

  // Orb body: soft inner gradient, brighter core as level rises
  let inside = smoothstep(edge, edge - 0.012, r);
  let coreGlow = exp(-r * (7.0 - level * 2.0));
  let body = hsl2rgb(P_hue(), 0.7, 0.16 + level * 0.30 + coreGlow * (P_coreGlow() + level * 0.25));
  col = mix(col, body, inside);

  // Rim: bright line at the orb edge + soft outer halo
  let rimD = abs(r - edge);
  col += hsl2rgb(P_hue() + 20.0, 0.8, 0.62) * smoothstep(0.006, 0.0, rimD) * (0.5 + level * 0.5);
  col += hsl2rgb(P_hue(), 0.8, 0.5) * exp(-max(r - edge, 0.0) * 22.0) * P_rimGlow() * (0.3 + level);

  // Sibilance sparkles: treble grain riding the rim band
  let rimBand = exp(-rimD * 40.0);
  let grain = pow(noise2(p * P_sparkleScale() + vec2f(u.time * 5.0, -u.time * 3.0)), 10.0);
  col += vec3f(1.0, 0.98, 0.95) * grain * rimBand * u.treble * P_sparkle() * 2.2;

  // Circular waveform ring
  if (P_ring() > 0.5) {
    let wv = waveAt(fract(a / TAU + 0.5));
    let ringR = radius * P_ringDist() + wv * P_ringWave() * (0.35 + level * 1.2);
    let dRing = abs(r - ringR);
    let ringHue = P_hue() + 25.0 + wv * 20.0;
    col += hsl2rgb(ringHue, 0.7, 0.55) * smoothstep(0.004, 0.0008, dRing) * (0.35 + level * 0.5);
    col += hsl2rgb(ringHue, 0.8, 0.5) * exp(-dRing * 120.0) * 0.18;
  }

  col *= 1.0 - r * r * P_vignette();
  return vec4f(col, 1.0);
}
`,
};
