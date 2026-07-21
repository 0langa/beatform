import type { PresetDef } from "../types";

/**
 * Aurora — layered curtains of light that waver on an fbm flow, brightened by
 * the spectrum and the selected sync source, with vertical ray texture and an
 * optional starfield. Colour comes from a saturated cosine palette instead of
 * a drifting hsl hue, back curtains sit dimmer/softer for a cheap depth cue,
 * beat response is staggered per curtain, and curtain peaks blow out to a hot
 * white core. Green-to-violet northern-lights look over a genuinely dark sky.
 */
export const aurora: PresetDef = {
  id: "aurora",
  name: "Aurora",
  description:
    "Northern-lights curtains that ripple and glow with the music — slow, ambient, and hypnotic. Reacts to the chosen sync source.",
  styles: [
    { id: "boreal", name: "Boreal", values: {} },
    { id: "magenta", name: "Magenta", values: { hue: 300, hueStep: 40, hueSpread: 60 } },
    {
      id: "ember",
      name: "Ember",
      values: { hue: 20, hueStep: 25, hueSpread: 40, bright: 1.2, sat: 0.9 },
    },
    { id: "ice", name: "Ice", values: { hue: 180, hueStep: 30, hueSpread: 50, thick: 0.16 } },
    {
      id: "cosmic",
      name: "Cosmic",
      values: { hue: 260, hueStep: 60, stars: 1, bgGlow: 0.6, react: 1.2, beatPulse: 0.7 },
    },
    {
      id: "solarStorm",
      name: "Solar Storm",
      values: {
        hue: 95,
        bright: 1.4,
        react: 1.8,
        flow: 2.5,
        wave: 1.8,
        beatPulse: 1.3,
        specAmt: 2.4,
        hueStep: 70,
        rays: 0.9,
      },
    },
    {
      id: "paleDawn",
      name: "Pale Dawn",
      values: {
        hue: 330,
        bright: 0.7,
        react: 0.3,
        flow: 0.4,
        thick: 0.22,
        baseY: 0.35,
        layers: 2,
        beatPulse: 0.1,
        wave: 0.5,
        rays: 0.2,
        sat: 0.36,
        bgGlow: 0.5,
      },
    },
  ],
  params: [
    {
      key: "hue",
      label: "Hue",
      min: 0,
      max: 360,
      step: 1,
      default: 140,
      hint: "Base curtain color",
    },
    {
      key: "bright",
      label: "Brightness",
      min: 0.2,
      max: 2,
      step: 0.05,
      default: 1,
      hint: "Overall glow of the curtains",
    },
    {
      key: "react",
      label: "Reactivity",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.8,
      hint: "How much the sync source (Sync panel) drives the glow — 0 = steady",
    },
    {
      key: "flow",
      label: "Flow",
      min: 0,
      max: 3,
      step: 0.05,
      default: 1,
      hint: "How fast the curtains waver",
    },
    {
      key: "thick",
      label: "Thickness",
      min: 0.04,
      max: 0.3,
      step: 0.01,
      default: 0.12,
      hint: "Vertical thickness of each curtain",
    },
    {
      key: "baseY",
      label: "Height",
      min: 0.2,
      max: 0.8,
      step: 0.01,
      default: 0.5,
      hint: "Where the curtains hang on screen",
    },
  ],
  advanced: [
    {
      key: "layers",
      label: "Curtains",
      min: 1,
      max: 3,
      step: 1,
      default: 3,
      hint: "Number of stacked curtains",
    },
    {
      key: "specAmt",
      label: "Spectrum shape",
      min: 0,
      max: 3,
      step: 0.05,
      default: 1.6,
      hint: "How strongly the spectrum sculpts the curtain brightness across the width",
    },
    {
      key: "beatPulse",
      label: "Beat pulse",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.4,
      hint: "Flash/expand on each detected beat of the sync source, staggered per curtain",
    },
    {
      key: "wave",
      label: "Waviness",
      min: 0,
      max: 2,
      step: 0.05,
      default: 1,
      hint: "How much the curtains undulate",
    },
    {
      key: "hueStep",
      label: "Hue step",
      min: 0,
      max: 120,
      step: 5,
      default: 55,
      hint: "Color shift between curtains",
    },
    {
      key: "hueSpread",
      label: "Hue spread",
      min: 0,
      max: 220,
      step: 5,
      default: 60,
      hint: "Color drift across the width",
    },
    {
      key: "rays",
      label: "Rays",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.6,
      hint: "Vertical ray shimmer texture",
    },
    {
      key: "sat",
      label: "Saturation",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.8,
      hint: "Color saturation",
    },
    {
      key: "stars",
      label: "Stars",
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      hint: "Twinkling starfield behind the curtains",
    },
    {
      key: "bgGlow",
      label: "Sky glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.25,
      hint: "Soft glow rising from the horizon",
    },
    {
      key: "mirror",
      label: "Symmetric",
      min: 1,
      max: 2,
      step: 1,
      default: 1,
      hint: "Fold the curtains and stars left/right into a symmetric aurora — 1 is off",
    },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  let y = uv.y;

  // Optional left/right symmetry — folds curtains AND stars together using
  // the shared club-mirror fold at its bilateral setting (2). 1 = off.
  let cx = (uv.x - 0.5) * u.aspect;
  let foldedX = kaleido(vec2f(cx, 0.0), P_mirror()).x;
  let x = clamp(foldedX / u.aspect + 0.5, 0.0, 1.0);

  // Deep night sky: near-black but hued, not grey, so the curtains have
  // real darkness to glow against instead of sitting on flat mid-grey fog.
  let skyPal = cosPalette(fract(P_hue() / 360.0 + 0.5), vec3f(0.025), vec3f(0.02), vec3f(1.0), vec3f(0.0, 0.33, 0.67));
  var col = skyPal;

  // Optional starfield behind everything (small round points, twinkling).
  if (P_stars() > 0.5) {
    let gp = vec2f(x * u.aspect, y) * 54.0;
    let cell = floor(gp);
    let h = hash21(cell);
    if (h > 0.972) {
      let sp = vec2f(hash21(cell + 0.37), hash21(cell + 0.71));
      let star = smoothstep(0.13, 0.0, length(gp - cell - sp));
      let tw = 0.5 + 0.5 * sin(u.time * (1.0 + h * 6.0) + h * 40.0);
      col += vec3f(0.7, 0.82, 1.0) * star * (h - 0.972) * 20.0 * tw * (1.0 - y * 0.4);
    }
  }

  // Sync-reactive envelope + beat pulse: switching the sync source (bass /
  // treble / kicks / ...) visibly changes the drive here.
  let drive = clamp(u.drive, 0.0, 1.5);
  let layers = i32(P_layers());
  for (var i = 0; i < 3; i++) {
    if (i >= layers) { break; }
    let fi = f32(i);

    // Depth cue: back curtains (higher index) sit dimmer and drift slower —
    // cheap parallax so the stack reads as depth, not three identical
    // decals stacked at different heights.
    let depthT = fi / f32(max(layers - 1, 1));
    let fog = mix(1.0, 0.55, depthT);

    // Per-layer beat stagger (golden-ratio conjugate, same shape as
    // gridPulse()) so curtains don't all flash in perfect unison — identical
    // phase across layers is what reads as one pulsing sheet, not three.
    var pulse = 1.0 + u.driveBeat * P_beatPulse() * u.pulse;
    if (u.bpm > 0.5) {
      let bph = fract(u.beatPhase + fi * 0.6180339887);
      let staggered = max(exp(-bph * 5.0) - 0.03, 0.0) / 0.97;
      pulse = 1.0 + staggered * P_beatPulse() * u.pulse;
    }

    // Non-wrapping spectrum window per curtain (clamp, never fract) so there
    // is no hard seam where the sample index would roll over.
    let sx = clamp(x * 0.82 + fi * 0.09, 0.0, 1.0);
    let spec = binAt(sx);
    // Wavy vertical center of the curtain, drifting slower with depth.
    let flowT = u.time * P_flow() * 0.15 * mix(1.0, 0.6, depthT);
    let wob = fbm(vec2f(x * (2.0 + fi) + fi * 7.0, flowT + fi * 3.0));
    let cy = P_baseY() + 0.15 * fi + (wob - 0.5) * 0.35 * P_wave();
    // Capped so a loud, bass-heavy passage (spec and drive can both sit near
    // their ceiling at once) can't run this away to the point every curtain
    // pixel blows past the hot-core threshold below — it stays a strong,
    // legible reaction instead of a flat white-out.
    let react = min(0.32 + spec * P_specAmt() + drive * P_react(), 2.2);
    let thick = P_thick() * (0.55 + react * 0.9) * pulse;
    let d = (y - cy) / max(thick, 1e-3);
    let band = exp(-d * d);
    let ray = 1.0 - P_rays()
            + P_rays() * (0.5 + 0.5 * sin(x * (60.0 + fi * 30.0) + fbm(vec2f(x * 8.0, u.time * 0.2)) * 8.0));

    // Cosine palette keyed by curtain index + spectrum, instead of an hsl
    // hue that could drift 400+ degrees through the desaturated middle of
    // the wheel — this stays saturated at every hueStep/hueSpread setting.
    let palT = fract(P_hue() / 360.0 + fi * (P_hueStep() / 360.0)
             + (x - 0.5) * (P_hueSpread() / 360.0) + spec * 0.12);
    let chroma = mix(0.08, 0.5, P_sat());
    let pal = cosPalette(palT, vec3f(0.5), vec3f(chroma), vec3f(1.0), vec3f(0.0, 0.33, 0.67));

    // Loudness is logarithmic: compress react through pow(.,0.6) before it
    // drives brightness (doc guidance) so 3 stacked curtains overlapping
    // during a loud passage tonemap into rich saturated colour instead of
    // additively summing straight past white every time.
    let reactGlow = pow(clamp(react / 2.2, 0.0, 1.0), 0.6) * 1.5;
    var layerCol = pal * band * ray * reactGlow * pulse * P_bright() * fog;

    // Hot core: only the curtain's exact vertical centerline, and only where
    // the spectrum is genuinely loud there, desaturates toward white and
    // pushes past 1.0 for tonemap() to roll off. Gating on band (which is a
    // narrow Gaussian peak, naturally rare) rather than on react (which
    // commonly sits above 1) is what keeps this a thin bright seam instead
    // of blowing out the whole curtain — entirely missing before (flat
    // hsl2rgb capped at l=0.55).
    let hot = smoothstep(0.82, 0.98, band) * clamp(spec * 1.3, 0.0, 1.0) * fog;
    layerCol = mix(layerCol, vec3f(1.0, 0.98, 0.95), hot * 0.6 * P_bright());
    layerCol *= 1.0 + hot * 1.0;

    col += layerCol;
  }

  // Soft sky glow rising from the horizon, lifted by the sync source.
  let glowPal = cosPalette(fract(P_hue() / 360.0 + P_hueStep() / 360.0), vec3f(0.5), vec3f(mix(0.08, 0.4, P_sat())), vec3f(1.0), vec3f(0.0, 0.33, 0.67));
  col += glowPal * smoothstep(0.0, 0.55, y) * P_bgGlow() * (0.3 + drive * 0.6) * 0.35;

  col = tonemap(col * 1.1);
  col += grain(uv, 0.012);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
