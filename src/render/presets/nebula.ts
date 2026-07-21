import type { PresetDef } from "../types";

/**
 * Domain-warped fbm nebula with optional kaleidoscope fold. A cosine palette
 * keyed off filament density stays saturated (no drifting hsl hue), the
 * field is genuinely dark between filaments, and density peaks blow out to
 * a hot white core. Bass drives brightness, mids shift the palette phase,
 * treble adds sparkle grain; beats launch a ripple ring from the center.
 */
export const nebula: PresetDef = {
  id: "nebula",
  name: "Kaleido Nebula",
  description:
    "Flowing cosmic filaments in a kaleidoscope — bass lights them up, beats send a ripple wave.",
  styles: [
    { id: "magenta", name: "Magenta Storm", values: {} },
    { id: "aurora", name: "Aurora", values: { hue: 140, kaleido: 1, flow: 0.2, hueRange: 60 } },
    { id: "ink", name: "Ink", values: { hue: 220, contrast: 0.8, sparkle: 0.2, saturation: 0.45 } },
    { id: "prism", name: "Prism Eight", values: { kaleido: 8, hueRange: 240, sparkle: 0.7 } },
    {
      id: "ultraviolet",
      name: "Ultraviolet",
      values: {
        hue: 265,
        hueRange: 40,
        kaleido: 1,
        scale: 1.6,
        contrast: 0.7,
        flow: 0.08,
        driveGlow: 0.22,
        beatRipple: 0.8,
      },
    },
    {
      id: "solar",
      name: "Solar Flare",
      values: {
        hue: 0,
        hueRange: 45,
        kaleido: 4,
        scale: 3.2,
        flow: 0.3,
        sparkle: 0.85,
        contrast: 0.35,
        beatBloom: 0.35,
      },
    },
  ],
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 60, hint: "Base cloud color" },
    {
      key: "scale",
      label: "Scale",
      min: 0.8,
      max: 6,
      step: 0.1,
      default: 2.4,
      hint: "Cloud size — low = big billows, high = fine detail",
    },
    {
      key: "flow",
      label: "Flow speed",
      min: 0,
      max: 0.6,
      step: 0.01,
      default: 0.12,
      hint: "How fast the clouds drift and churn",
    },
    {
      key: "kaleido",
      // min stays 0, not 1: this preset shipped a `kaleido` param before, and
      // saved projects (incl. the "Lo-fi Haze" factory theme) store kaleido:0
      // for "off". Raising the floor to 1 would put that existing data out of
      // range and fail validation on load. kaleido() treats anything <1.5 as
      // off, so 0 and 1 both mean "natural clouds" — harmless overlap, and it
      // keeps every old file loading.
      label: "Kaleido",
      min: 0,
      max: 12,
      step: 1,
      default: 6,
      hint: "Mirror segments — 0-1 = natural clouds, higher = mandala",
    },
    {
      key: "contrast",
      label: "Contrast",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      hint: "Sharpness between bright filaments and dark gaps",
    },
    {
      key: "sparkle",
      label: "Sparkle",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      hint: "Tiny glints driven by treble (hi-hats, cymbals)",
    },
    {
      key: "beatRipple",
      label: "Beat ripple",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
      hint: "A distortion ring expands from center on every beat",
    },
  ],
  advanced: [
    {
      key: "warp",
      label: "Domain warp",
      min: 0,
      max: 4,
      step: 0.1,
      default: 1.8,
      hint: "How much the clouds fold into filaments",
    },
    {
      key: "hueRange",
      label: "Hue range",
      min: 0,
      max: 300,
      step: 5,
      default: 110,
      hint: "Color span across the cosine palette, keyed by filament density",
    },
    {
      key: "midHueShift",
      label: "Mid hue shift",
      min: 0,
      max: 200,
      step: 5,
      default: 70,
      hint: "Melody/mids push the palette phase around",
    },
    {
      key: "brightFloor",
      label: "Brightness floor",
      min: 0,
      max: 0.6,
      step: 0.01,
      default: 0.22,
      hint: "Filament brightness gain in silence — gaps stay dark regardless",
    },
    {
      key: "bassBright",
      label: "Bass brighten",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.45,
      hint: "How much bass lights the filaments",
    },
    {
      key: "saturation",
      label: "Saturation",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.75,
      hint: "Color intensity — 0 = grayscale",
    },
    {
      key: "sparkleScale",
      label: "Sparkle scale",
      min: 2,
      max: 30,
      step: 1,
      default: 9,
      hint: "Size of the treble glints",
    },
    {
      key: "sparkleSharp",
      label: "Sparkle sharpness",
      min: 4,
      max: 40,
      step: 1,
      default: 18,
      hint: "Higher = fewer, more pin-point glints",
    },
    {
      key: "rippleWidth",
      label: "Ripple width",
      min: 4,
      max: 40,
      step: 1,
      default: 16,
      hint: "Thickness of the beat ripple ring",
    },
    {
      key: "rippleWarp",
      label: "Ripple distortion",
      min: 0,
      max: 0.3,
      step: 0.01,
      default: 0.09,
      hint: "How strongly the ripple bends the clouds",
    },
    {
      key: "beatBloom",
      label: "Beat bloom",
      min: 0,
      max: 0.6,
      step: 0.02,
      default: 0.18,
      hint: "Center brightness flash on beats",
    },
    {
      key: "driveGlow",
      label: "Drive glow",
      min: 0,
      max: 0.5,
      step: 0.02,
      default: 0.12,
      hint: "Clouds brighten with the sync source (Sync panel)",
    },
    {
      key: "vignette",
      label: "Vignette",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.35,
      hint: "Darkening toward the screen corners",
    },
    {
      key: "hotCore",
      label: "Hot core",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.7,
      hint: "How hard bright filament peaks blow out to white",
    },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  var p = centered(uv);

  // Kaleidoscope fold (club mirror). The mirror axes spin slowly so a
  // mandala reads as alive rather than a frozen sticker. 1 = off, matching
  // the shared kaleido() convention used across every preset.
  let mirrorN = P_kaleido();
  if (mirrorN >= 1.5) {
    p = rot2(u.time * P_flow() * 0.35 * u.spin) * p;
    p = kaleido(p, mirrorN);
  }

  // Beat ripple: a distortion ring expands from center as the beat envelope
  // decays (1 -> 0 maps to radius 0 -> edge). Makes the sync unmistakable
  // without changing the field's character between beats.
  let ripR = length(p);
  if (u.driveBeat > 0.01 && ripR > 1e-4) {
    let rippleR = (1.0 - u.driveBeat) * 1.1;
    let wave = exp(-abs(ripR - rippleR) * P_rippleWidth()) * u.driveBeat * P_beatRipple();
    p += (p / ripR) * wave * P_rippleWarp();
  }

  let q = p * P_scale();
  let tFlow = u.time * P_flow();
  let flowOff = vec2f(tFlow, -tFlow * 0.7);

  // Domain-warped fbm (IQ): fbm of a position displaced by fbm turns smooth
  // blobby noise into filament structure — the actual "fog" -> "nebula"
  // difference the old version was missing entirely. Mid energy breathes
  // the warp strength so filaments visibly writhe with the melody.
  let warpAmt = P_warp() * (0.7 + u.mid * 0.6);
  let densityRaw = warpFbm(q + flowOff, warpAmt);

  // fbm (and warpFbm, which is built on it) is a sum of smoothed random
  // octaves, so it clusters tightly in a narrow ~0.42-0.75 mid-gray band and
  // almost never reaches true 0 or 1 (verified by rendering densityRaw
  // directly as grayscale). Renormalizing that OBSERVED range before shaping
  // is what actually produces black gaps and rare bright peaks — feeding the
  // raw clustered value straight into pow() left the whole frame a uniform
  // mid-tone wash (no black, no true peaks), which is exactly the muddy,
  // low-contrast look this rewrite is fixing.
  let density = clamp((densityRaw - 0.42) / 0.32, 0.0, 1.0);

  // Contrast shaping pushes mid-density DOWN toward the dark field so gaps
  // between filaments read as genuinely empty instead of a uniform haze.
  let sharp = 2.0 + P_contrast() * 4.0;
  let v = pow(density, sharp);

  // Cosine palette keyed off density + a mid-driven phase shift, instead of
  // an hsl hue drifting across hueRange + midHueShift degrees (up to ~500
  // degrees of travel) — exactly what walked the old version through the
  // desaturated olive/brown middle of the HSL wheel. This stays saturated
  // at every step.
  let palT = fract(v * (P_hueRange() / 360.0) + P_hue() / 360.0
           + (P_midHueShift() / 360.0) * u.mid * 0.5);
  let chroma = mix(0.06, 0.5, P_saturation());
  let pal = cosPalette(palT, vec3f(0.5), vec3f(chroma), vec3f(1.0), vec3f(0.0, 0.33, 0.67));

  // Genuinely dark field: near-black but hued, not grey, so filaments have
  // real darkness to glow against instead of sitting on a lit haze.
  let bgT = fract(P_hue() / 360.0 + 0.5);
  let bg = cosPalette(bgT, vec3f(0.03), vec3f(0.025), vec3f(1.0), vec3f(0.0, 0.33, 0.67));

  // Density-driven brightness: audio multiplies the GAIN on the filaments
  // rather than lifting the whole frame, so gaps stay dark even when bass
  // is pumping hard — only lit structure gets brighter, never the void.
  let energyGain = P_brightFloor() + u.bass * P_bassBright() + u.drive * P_driveGlow();
  var col = bg + pal * v * (0.5 + energyGain * 1.6);

  // Hot core: filament peaks desaturate toward white and push past 1.0 so
  // tonemap() gives them a real emissive rolloff instead of a flat clip —
  // the single biggest thing missing from the old muddy version. Threshold
  // sits high on the renormalized range so only genuine peaks blow out, not
  // the common mid-density fill.
  let hot = smoothstep(0.7, 0.97, density) * (0.5 + u.bass * 0.5 + u.driveBeat * 0.3);
  col = mix(col, vec3f(1.0, 0.98, 0.95), hot * 0.8);
  col *= 1.0 + hot * P_hotCore() * 1.8;

  // Treble sparkle: pin-point glints from the noise field's own hash (never
  // re-rolled per frame), riding on top of everything else.
  let g = pow(noise2(q * P_sparkleScale() + vec2f(tFlow * 6.0, -tFlow * 4.0)), P_sparkleSharp());
  col += vec3f(1.0, 0.95, 0.9) * g * u.treble * P_sparkle() * 2.2;

  // A standing hot core at the very center, not just a beat flash: bass
  // sets its baseline brightness (the doc's bass -> core-radius/wash
  // mapping, slow and weighty) so there is always a small visible source at
  // the nebula's heart, and driveBeat adds a flash on top. Falloff is steep
  // (exp * 6) so this stays a tight pinpoint even at full bass + a beat
  // peak, rather than blooming out to cover the whole frame.
  let core = length(p);
  let corePulse = 0.1 + u.bass * 0.2 + u.driveBeat * P_beatBloom() * 0.8;
  col += mix(pal, vec3f(1.0), 0.55) * corePulse * exp(-core * 6.0) * 1.3;
  if (u.driveBeat > 0.01) {
    let rippleR2 = (1.0 - u.driveBeat) * 1.1;
    let rim = exp(-abs(ripR - rippleR2) * 20.0) * u.driveBeat * P_beatRipple();
    col += mix(pal, vec3f(1.0), 0.6) * rim * 0.7;
  }

  col *= vignette(uv, P_vignette());
  col = tonemap(col * 1.1);
  col += grain(uv, 0.012);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
