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
    // Boreal — the defaults — three drifting curtains.
    { id: "boreal", name: "Boreal", values: {} },
    // Ice Mirror — horizon reflection on: the sky repeated in ice below it.
    {
      id: "iceMirror",
      name: "Ice Mirror",
      values: {
        hue: 158,
        hueStep: 40,
        hueSpread: 90,
        reflect: 1,
        horizon: 0.62,
        reflectFade: 2.5,
        baseY: 0.24,
        stars: 1,
        bgGlow: 0.3,
        thick: 0.08,
        wave: 1.2,
        bright: 1.05,
        drift: 0.2,
        react: 0.9,
        bassSwell: 0.6,
        rays: 0.56,
        beatPulse: 0.35,
      },
    },
    // Solar Storm — brightest and fastest — full spectrum sculpting, hard beat pulse.
    {
      id: "solarStorm",
      name: "Solar Storm",
      values: {
        hue: 92,
        hueStep: 75,
        bright: 1.05,
        react: 1.2,
        flow: 2.6,
        wave: 1.9,
        beatPulse: 1.2,
        specAmt: 1.55,
        bassSwell: 0.5,
        rays: 0.96,
        drift: 0.45,
        thick: 0.16,
        sat: 0.92,
        bgGlow: 0.5,
      },
    },
    // Silk — editorial. One thin pastel curtain, slow, no rays, no stars.
    {
      id: "silk",
      name: "Silk",
      values: {
        hue: 40,
        layers: 1,
        thick: 0.06,
        flow: 0.3,
        react: 0.3,
        wave: 0.45,
        rays: 0.1,
        sat: 0.5,
        bright: 1.1,
        hueSpread: 110,
        hueStep: 0,
        baseY: 0.42,
        beatPulse: 0.05,
        specAmt: 0.7,
        bassSwell: 0.2,
        bgGlow: 0.5,
        drift: 0.1,
      },
    },
    // Cathedral — left/right mirrored and thick — a symmetric arch over a bright sky glow.
    {
      id: "cathedral",
      name: "Cathedral",
      values: {
        hue: 265,
        mirror: 2,
        thick: 0.24,
        flow: 0.45,
        wave: 1.5,
        hueStep: 60,
        hueSpread: 140,
        sat: 0.86,
        bright: 1.15,
        rays: 0.76,
        stars: 1,
        bgGlow: 0.62,
        react: 1,
        beatPulse: 0.6,
        baseY: 0.46,
        specAmt: 1.9,
        bassSwell: 0.55,
      },
    },
    // Cosmic — stars and sky glow dominate; the curtains sit low and dim.
    {
      id: "cosmic",
      name: "Cosmic",
      values: {
        hue: 100,
        hueStep: 70,
        hueSpread: 40,
        stars: 1,
        bright: 0.7,
        thick: 0.08,
        layers: 2,
        sat: 0.7,
        bgGlow: 0.8,
        baseY: 0.62,
        flow: 0.5,
        wave: 0.7,
        rays: 0.3,
        react: 0.6,
        beatPulse: 0.3,
        specAmt: 1,
        bassSwell: 0.35,
        drift: 0.1,
      },
    },
    // Veil — one curtain at max thickness and waviness — a single sheet filling the frame.
    {
      id: "veil",
      name: "Veil",
      values: {
        hue: 176,
        layers: 1,
        thick: 0.26,
        wave: 2,
        flow: 0.35,
        react: 0.7,
        specAmt: 1.15,
        bassSwell: 1.1,
        bright: 0.85,
        sat: 0.94,
        hueSpread: 180,
        hueStep: 0,
        rays: 0.9,
        beatPulse: 0.7,
        bgGlow: 0.2,
        drift: 0.5,
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
      default: 140,
      hint: "Base curtain color",
    },
    {
      key: "bright",
      label: "Brightness",
      group: "glow",
      min: 0.2,
      max: 2,
      step: 0.05,
      default: 1,
      hint: "Overall glow of the curtains",
    },
    {
      key: "react",
      label: "Reactivity",
      group: "reaction",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.8,
      hint: "How much the sync source (Sync panel) drives the glow — 0 = steady",
    },
    {
      key: "flow",
      label: "Flow",
      group: "motion",
      min: 0,
      max: 3,
      step: 0.05,
      default: 1,
      hint: "How fast the curtains waver",
    },
    {
      key: "thick",
      label: "Thickness",
      group: "shape",
      min: 0.04,
      max: 0.3,
      step: 0.01,
      default: 0.12,
      hint: "Vertical thickness of each curtain",
    },
    {
      key: "baseY",
      label: "Height",
      group: "shape",
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
      group: "shape",
      control: "enum",
      options: [
        { value: 1, label: "1" },
        { value: 2, label: "2" },
        { value: 3, label: "3" },
      ],
      min: 1,
      max: 3,
      step: 1,
      default: 3,
      hint: "Number of stacked curtains",
    },
    {
      key: "specAmt",
      label: "Spectrum shape",
      group: "reaction",
      min: 0,
      max: 3,
      step: 0.05,
      default: 1.6,
      hint: "How strongly the spectrum sculpts the curtain brightness across the width",
    },
    {
      key: "bassSwell",
      label: "Bass swell",
      group: "reaction",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.45,
      hint: "How much low end swells and brightens the curtains — the bass 'breathing' the sky",
    },
    {
      key: "drift",
      label: "Drift",
      group: "motion",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0,
      hint: "Slow sideways drift of the whole curtain field",
    },
    {
      key: "reflect",
      label: "Reflection",
      group: "shape",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0,
      hint: "Mirror the curtains below the horizon for a reflected-on-ice look — 0 is off",
    },
    {
      key: "horizon",
      label: "Horizon",
      group: "shape",
      min: 0.55,
      max: 0.98,
      step: 0.01,
      default: 0.82,
      hint: "Where the reflection line sits (only matters when Reflection is on)",
    },
    {
      key: "reflectFade",
      label: "Reflection fade",
      group: "shape",
      min: 1,
      max: 12,
      step: 0.5,
      default: 4,
      hint: "How quickly the reflection dims with distance below the horizon",
    },
    {
      key: "beatPulse",
      label: "Beat pulse",
      group: "reaction",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.4,
      hint: "Flash/expand on each detected beat of the sync source, staggered per curtain",
    },
    {
      key: "wave",
      label: "Waviness",
      group: "shape",
      min: 0,
      max: 2,
      step: 0.05,
      default: 1,
      hint: "How much the curtains undulate",
    },
    {
      key: "hueStep",
      label: "Hue step",
      group: "color",
      min: 0,
      max: 120,
      step: 5,
      default: 55,
      hint: "Color shift between curtains",
    },
    {
      key: "hueSpread",
      label: "Hue spread",
      group: "color",
      min: 0,
      max: 220,
      step: 5,
      default: 60,
      hint: "Color drift across the width",
    },
    {
      key: "rays",
      label: "Rays",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.6,
      hint: "Vertical ray shimmer texture",
    },
    {
      key: "sat",
      label: "Saturation",
      group: "color",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.8,
      hint: "Color saturation",
    },
    {
      key: "stars",
      label: "Stars",
      group: "backdrop",
      control: "toggle",
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      hint: "Twinkling starfield behind the curtains",
    },
    {
      key: "bgGlow",
      label: "Sky glow",
      group: "backdrop",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.25,
      hint: "Soft glow rising from the horizon",
    },
    {
      key: "mirror",
      label: "Symmetric",
      group: "shape",
      control: "enum",
      options: [
        { value: 1, label: "Off" },
        { value: 2, label: "Mirrored" },
      ],
      min: 1,
      max: 2,
      step: 1,
      default: 1,
      hint: "Fold the curtains and stars left/right into a symmetric aurora — 1 is off",
    },
  ],
  wgsl: /* wgsl */ `
// Bounded, continuous noise clock (seconds of TRACK time in, noise coordinate
// out). u.time grows without bound and fbm's top octave multiplies its input by
// ~17 before hashing the integer cell index, so a long render walks that index
// past the point where f32 can still tell neighbouring cells apart: measured,
// 64 consecutive cells collapse from 20 distinct hashes to 8 by a coordinate of
// 240 and to 1 — completely frozen — by 1600, which max Flow reaches inside an
// hour. Same class as the look kit's grain seed. Folding the clock into a
// TRIANGLE keeps the coordinate inside 0..240 forever AND keeps it continuous;
// a plain fract() wrap would bound it just as well but teleport the whole
// curtain field at every wrap. The first 240/rate seconds are identical to the
// unfolded clock, so shipped looks render unchanged over a normal track, and
// after that the churn simply retraces its path instead of quantising.
fn noiseClock(rate: f32) -> f32 {
  let ph = fract(u.time * rate * (1.0 / 480.0));
  return 240.0 * (1.0 - abs(2.0 * ph - 1.0));
}

// One stack of aurora curtains sampled at horizontal position x and vertical
// position y. Split out of preset() so the horizon reflection below can
// re-evaluate the exact same field at a mirrored y — a real reflection, not a
// second decal. Reads only globals (u.*, P_*), so it stays deterministic.
//
// specX is x's audio twin: the position along the SPECTRUM that this column
// listens to. The two are separate arguments because the Symmetric fold moves
// them apart — see the note at the fold in preset(). Unfolded they are equal,
// so every unmirrored look reads exactly the bins it always did.
fn auroraCurtains(x: f32, specX: f32, y: f32, drive: f32) -> vec3f {
  var acc = vec3f(0.0);
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
    let sx = clamp(specX * 0.82 + fi * 0.09, 0.0, 1.0);
    let spec = binAt(sx);
    // Wavy vertical center of the curtain, drifting slower with depth. Drift
    // slides the whole field sideways over time (monotonic, so it never reads
    // as reversing), parallaxed by depth like the vertical churn.
    // The churn clock is folded (see noiseClock above) so hours of Flow can't
    // walk the fbm cell index out of f32's resolution. Drift is deliberately
    // NOT folded: it is a directional slide whose whole point is that it never
    // reverses, and it runs at a quarter of the churn's top rate, so it stays
    // well inside the resolved range for any realistic render.
    let flowT = noiseClock(P_flow() * 0.15 * mix(1.0, 0.6, depthT));
    let driftX = u.time * P_drift() * 0.08 * mix(1.0, 0.6, depthT);
    let wob = fbm(vec2f(x * (2.0 + fi) + fi * 7.0 + driftX, flowT + fi * 3.0));
    // Frame-safety: the per-layer stack offset is compressed into whatever sky
    // is left below Height, so the back curtain's centre cannot walk off the
    // bottom edge — 0.15*2 on top of Height 0.8 put it at 1.1, entirely
    // offscreen, and the third curtain silently vanished. Every shipped style
    // sits below the knee, so their stacks are unchanged.
    let stackY = softLimit(0.15 * fi, max(0.98 - P_baseY(), 0.02));
    let cy = P_baseY() + stackY + (wob - 0.5) * 0.35 * P_wave();
    // Limited so a loud, bass-heavy passage (spec, drive and bass can all sit
    // near their ceiling at once) can't run this away to the point every
    // curtain pixel blows past the hot-core threshold below — it stays a
    // strong, legible reaction instead of a flat white-out. Bass swell adds
    // the low-end "breathing" of the sky on top of the sync source.
    // SOFT-limited, and against 3.2 rather than the old hard min(., 2.2): once
    // Bass swell joined the sum, Solar Storm (Spectrum shape 2.4, Reactivity
    // 1.8, Bass swell 0.8) pinned that ceiling through every loud chorus, and
    // since react drives curtain THICKNESS this was a hard cap on geometry —
    // the v2.44 law's exact prohibition. Identity below 2.3, so the tuned looks
    // are untouched; above it the response compresses instead of flat-topping.
    let react = softLimit(0.32 + spec * P_specAmt() + drive * P_react() + u.bass * P_bassSwell(), 3.2);
    let thick = P_thick() * (0.55 + react * 0.9) * pulse;
    let d = (y - cy) / max(thick, 1e-3);
    let band = exp(-d * d);
    let ray = 1.0 - P_rays()
            + P_rays() * (0.5 + 0.5 * sin(x * (60.0 + fi * 30.0) + fbm(vec2f(x * 8.0, noiseClock(0.2))) * 8.0));

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
    // additively summing straight past white every time. Normalised against
    // the SAME 3.2 ceiling as the soft limit above — with the old 2.2 divisor
    // the clamp saturated wherever react did, so the glow stopped answering
    // the music for the rest of the passage too.
    let reactGlow = pow(clamp(react / 3.2, 0.0, 1.0), 0.6) * 1.5;
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

    acc += layerCol;
  }
  return acc;
}

fn preset(uv: vec2f) -> vec4f {
  let y = uv.y;

  // Optional left/right symmetry — folds curtains AND stars together using
  // the shared club-mirror fold at its bilateral setting (2). 1 = off.
  let cx = (uv.x - 0.5) * u.aspect;
  let foldedX = kaleido(vec2f(cx, 0.0), P_mirror()).x;
  let x = clamp(foldedX / u.aspect + 0.5, 0.0, 1.0);

  // ...and that fold HALVES the screen coordinate's range: kaleido() returns
  // abs(p.x) at every setting >= 2, so x lands in [0.5, 1] and only ever the
  // RIGHT half of the frame is evaluated, reflected onto the left. That is
  // exactly what a symmetry is supposed to do to GEOMETRY — but x was also the
  // spectrum index, and there halving the range means deafness: each curtain's
  // window (clamp(x * 0.82 + i * 0.09)) collapsed from [0.000, 0.820] to
  // [0.410, 0.820] on the front curtain, and the half it dropped is the LOW
  // one. The shipped Cathedral style is the mirrored look, so Cathedral's
  // curtains had no bass response at all — they sculpted on mid and treble
  // while the kick did nothing, and Bass swell (0.55 there) was the only low
  // end left in the mode.
  //
  // So the spectrum gets its own coordinate, rescaled back onto the full width
  // that the visible half stands for. One threshold, not kaleido()'s two: this
  // preset folds a POINT ON THE X AXIS, and every segments >= 2 leaves that
  // point's x in [0.5, 1] (the wedge branch only re-aims a vector that has no y
  // to re-aim), so the inverse is the same map at 2 as at 12. The enum offers
  // Off and Mirrored only, but the arithmetic does not depend on that.
  //
  // Seam-free by construction: specX is 0 at the mirror line from BOTH sides,
  // so bass meets bass down the centre of the frame and the fold's own
  // reflection is the only symmetry in the picture. Bass now sits at the axis
  // of symmetry and treble runs out to both edges — the arch this style is
  // named for, lit from the middle.
  let specX = select(x, (x - 0.5) * 2.0, P_mirror() >= 1.5);

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
      // Treble and hi-hats make the starfield crackle — the sky's own
      // percussion. Additive over a 1.0 baseline so the resting brightness
      // is unchanged; loud highs flare the stars brighter.
      let spark = 1.0 + u.treble * 1.3 + u.hat * 0.8;
      col += vec3f(0.7, 0.82, 1.0) * star * (h - 0.972) * 20.0 * tw * spark * (1.0 - y * 0.4);
    }
  }

  // Sync-reactive envelope + beat pulse: switching the sync source (bass /
  // treble / kicks / ...) visibly changes the drive here.
  let drive = clamp(u.drive, 0.0, 1.5);
  col += auroraCurtains(x, specX, y, drive);

  // Horizon reflection: below the horizon line the curtains are mirrored and
  // dimmed with depth, like an aurora over still ice or water. Off by default
  // (P_reflect() == 0), so existing projects are untouched.
  if (P_reflect() > 0.01 && y > P_horizon()) {
    let ry = P_horizon() - (y - P_horizon());
    let fade = exp(-(y - P_horizon()) * P_reflectFade());
    col += auroraCurtains(x, specX, ry, drive) * P_reflect() * fade * 0.7;
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
