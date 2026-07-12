import type { PresetDef } from "../types";

/**
 * Voice mode: built for voiceovers/narration, not music. A central orb
 * breathes with the speech envelope (energy floor keeps it alive in pauses),
 * formant-band spectrum ripples its surface, sibilance sparkles the rim, and
 * an optional circular waveform ring orbits it. No beat machinery — speech
 * has none worth strobing to.
 */
export const voiceOrb: PresetDef = {
  id: "voice-orb",
  name: "Voice Orb",
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 195 },
    { key: "size", label: "Size", min: 0.08, max: 0.3, step: 0.005, default: 0.16 },
    { key: "response", label: "Response", min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: "wobble", label: "Wobble", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "ring", label: "Wave ring", min: 0, max: 1, step: 1, default: 1 },
    { key: "sparkle", label: "Sibilance", min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  let hue = param(0); let size = param(1); let response = param(2);
  let wobble = param(3); let ring = param(4); let sparkle = param(5);

  let p = centered(uv);
  let r = length(p);
  let a = atan2(p.y, p.x);

  // Speech level: mostly the slow envelope, a touch of instantaneous —
  // keeps the orb's size calm instead of pumping on every syllable.
  let level = clamp(mix(u.energy, u.rms, 0.3) * (0.6 + response * 1.4), 0.0, 1.0);
  // Idle breathing keeps the orb alive during pauses, fades out when talking
  let idle = (1.0 - smoothstep(0.03, 0.12, level)) * sin(u.time * 1.3) * 0.012;

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
  let disp = (m1 * f1 * 1.0 + m2 * f2 * 0.7 + m3 * f3 * 0.45)
           * wobble * 0.030 * (0.25 + level * 0.75);

  let radius = size * (1.0 + level * 0.85) + idle;
  let edge = radius + disp;

  // Background: quiet radial wash that warms slightly with speech
  var col = hsl2rgb(hue + 30.0, 0.45, 0.035 + level * 0.02) * (1.0 - r * 0.75);

  // Orb body: soft inner gradient, brighter core as level rises
  let inside = smoothstep(edge, edge - 0.012, r);
  let coreGlow = exp(-r * (7.0 - level * 2.0));
  let body = hsl2rgb(hue, 0.7, 0.16 + level * 0.30 + coreGlow * (0.18 + level * 0.25));
  col = mix(col, body, inside);

  // Rim: bright line at the orb edge + soft outer halo
  let rimD = abs(r - edge);
  col += hsl2rgb(hue + 20.0, 0.8, 0.62) * smoothstep(0.006, 0.0, rimD) * (0.5 + level * 0.5);
  col += hsl2rgb(hue, 0.8, 0.5) * exp(-max(r - edge, 0.0) * 22.0) * 0.30 * (0.3 + level);

  // Sibilance sparkles: treble grain riding the rim band
  let rimBand = exp(-rimD * 40.0);
  let grain = pow(noise2(p * 34.0 + vec2f(u.time * 5.0, -u.time * 3.0)), 10.0);
  col += vec3f(1.0, 0.98, 0.95) * grain * rimBand * u.treble * sparkle * 2.2;

  // Circular waveform ring
  if (ring > 0.5) {
    let wv = waveAt(fract(a / TAU + 0.5));
    let ringR = radius * 1.45 + wv * 0.045 * (0.35 + level * 1.2);
    let dRing = abs(r - ringR);
    let ringHue = hue + 25.0 + wv * 20.0;
    col += hsl2rgb(ringHue, 0.7, 0.55) * smoothstep(0.004, 0.0008, dRing) * (0.35 + level * 0.5);
    col += hsl2rgb(ringHue, 0.8, 0.5) * exp(-dRing * 120.0) * 0.18;
  }

  col *= 1.0 - r * r * 0.45;
  return vec4f(col, 1.0);
}
`,
};
