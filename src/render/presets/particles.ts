import type { PresetDef } from "../types";
import { WGSL_PALETTE_STD } from "../wgslLib";

/**
 * Particles: real, individually-identified particles — each one's size, hue,
 * "heat", band and wander phase are hashed from a stable per-cell seed and
 * held for its lifetime, never re-rolled per frame (docs/VISUAL-DESIGN.md §4:
 * independently re-rolled particles ARE white noise, which is why the field
 * used to read as flat TV static). Each particle reacts to its OWN frequency
 * band (bass / mid / treble), streaks along its own direction of travel, and
 * flares to a near-white hot core when it is close/loud.
 *
 * Two modes:
 *   - DRIFT: particles drift across the screen on a shared divergence-free
 *     curl current, with per-particle depth (near = bigger/brighter).
 *   - FLY: a TRUE perspective starfield. Depth SHELLS scroll toward the
 *     camera; a star spawns far away (small, dim, near the vanishing point),
 *     approaches while growing/brightening and stretching into a radial
 *     streak, then despawns as it passes and a fresh one appears far away —
 *     flying THROUGH the particles rather than zooming a flat image. Each
 *     shell's grid is rotated by its own angle so the naturally-sparse
 *     vanishing point doesn't stack into a hard dark cross at screen centre.
 *
 * Depth work (Track B): three opt-in layers on top of the drift/fly ambience —
 *   - RP-6 colour tier: whole-visual Saturation/Lightness scalers, graded once
 *     over the finished tonemapped frame (presetRgb), structurally identity at
 *     their 1/1 defaults.
 *   - Snare shooting stars: per-EVENT meteors on a hashed track-time slot grid,
 *     lit by the snare/transient lane (see the shootingStars fn).
 *   - Constellation links: near-neighbour threads on the layer-0 drift grid
 *     (see the cstPoint fn), fill/clump-aware so lines join only real dots.
 * All three are exactly neutral at factory defaults: the 0-default gates skip
 * their blocks whole, and the colour tier's neutral path returns its input.
 */
export const particles: PresetDef = {
  // Renamed from the legacy internal id "starfield" (the display name has been
  // "Particles" since long before). Loaders migrate the old id everywhere it
  // persists — see RENAMED_PRESET_IDS in ./index.ts.
  id: "particles",
  name: "Particles",
  description:
    "Individual particles that dance to the music — beats scatter and streak them, bass/mid/treble pulse their sizes.",
  styles: [
    // Drift — the defaults — a clumped field wandering on a shared current.
    { id: "drift", name: "Drift", values: {} },
    // Warp Core — fly mode: stars stream past the camera, hard streaks, tempo-locked pops.
    {
      id: "warp",
      name: "Warp Core",
      values: {
        fly: 1,
        speed: 0.75,
        density: 16,
        size: 0.1,
        beatDance: 0.55,
        sizePulse: 0.7,
        streak: 1.2,
        hotCore: 0.86,
        clump: 0.36,
        parallax: 0.8,
        glow: 0.46,
        brightness: 1,
        twinkle: 0.2,
        hue: 205,
        hueVariance: 60,
        bandColor: 40,
        beatPop: 0.7,
        sizeVar: 0.5,
        bgLevel: 0.015,
        vignette: 0.55,
      },
    },
    // Snowfall — falling downward, dense, tiny, barely reactive — quiet weather.
    {
      id: "snow",
      name: "Snowfall",
      values: {
        hue: 205,
        direction: 270,
        speed: 0.3,
        density: 13,
        size: 0.13,
        beatDance: 0.06,
        sizePulse: 0.25,
        streak: 0.08,
        hotCore: 0.2,
        clump: 0.2,
        fill: 0.9,
        wander: 0.46,
        wanderSpeed: 0.6,
        hueVariance: 25,
        twinkle: 0.56,
        glow: 0.26,
        brightness: 0.7,
        parallax: 0.7,
        sizeVar: 0.7,
        beatFlash: 0.03,
        bgLevel: 0.01,
        vignette: 0.5,
      },
    },
    // Embers — rising, warm, heavy wander and streak: sparks off a fire.
    {
      id: "embers",
      name: "Embers",
      values: {
        hue: 16,
        hueVariance: 30,
        density: 12,
        size: 0.1,
        speed: 0.4,
        direction: 85,
        beatDance: 0.28,
        sizePulse: 0.9,
        streak: 0.7,
        hotCore: 0.9,
        clump: 0.62,
        wander: 0.9,
        wanderSpeed: 1.25,
        twinkle: 0.6,
        glow: 0.5,
        brightness: 1.05,
        sizeVar: 0.95,
        bandColor: 15,
        beatPop: 0.35,
        bgLevel: 0.03,
        vignette: 0.6,
      },
    },
    // Kaleidoscope — 6-fold mirror turns the field into a rotating mandala of points.
    {
      id: "kaleido",
      name: "Kaleidoscope",
      values: {
        mirror: 6,
        hue: 300,
        hueVariance: 90,
        bandColor: 60,
        speed: 0.3,
        density: 8,
        size: 0.2,
        clump: 0.7,
        streak: 0.36,
        hotCore: 0.5,
        sizePulse: 1.1,
        twinkle: 0.3,
        glow: 0.7,
        brightness: 1.05,
        sizeVar: 0.6,
        layers: 2,
        parallax: 0.3,
        wander: 0.5,
        wanderSpeed: 0.5,
        beatDance: 0.4,
        beatPop: 0.5,
        vignette: 0.5,
      },
    },
    // Deep Field — editorial. Sparse, near-still, wide size spread, twinkle carries it.
    {
      id: "deepField",
      name: "Deep Field",
      values: {
        hue: 40,
        hueVariance: 55,
        density: 11,
        size: 0.18,
        speed: 0.05,
        beatDance: 0.02,
        sizePulse: 0.3,
        streak: 0.04,
        hotCore: 0.46,
        clump: 0.76,
        fill: 0.46,
        wander: 0.16,
        wanderSpeed: 0.15,
        twinkle: 0.6,
        glow: 0.3,
        brightness: 0.95,
        parallax: 0.26,
        sizeVar: 1.3,
        bandColor: 20,
        beatFlash: 0.02,
        bgLevel: 0.01,
      },
    },
    // Rave — every reaction knob up — scatter, size pulse, band colour, beat
    // pops, snare meteors.
    {
      id: "rave",
      name: "Rave",
      values: {
        hue: 285,
        hueVariance: 120,
        density: 12,
        size: 0.14,
        speed: 1.1,
        beatDance: 0.95,
        sizePulse: 1.7,
        twinkle: 0.8,
        streak: 1.2,
        hotCore: 0.96,
        clump: 0.6,
        bandColor: 75,
        beatPop: 1.1,
        sizeVar: 0.7,
        glow: 0.7,
        brightness: 1.2,
        beatFlash: 0.32,
        bgLevel: 0.04,
        vignette: 0.3,
        shootingStars: 0.55,
      },
    },
    // Bokeh — five huge out-of-focus discs on one layer: shallow depth of field.
    {
      id: "bokeh",
      name: "Bokeh",
      values: {
        hue: 330,
        hueVariance: 70,
        density: 8,
        size: 0.28,
        speed: 0.1,
        layers: 1,
        fill: 0.72,
        clump: 0.3,
        glow: 1,
        brightness: 0.55,
        hotCore: 0.2,
        twinkle: 0.5,
        streak: 0.06,
        sizePulse: 0.5,
        sizeVar: 1.1,
        wander: 0.5,
        wanderSpeed: 0.3,
        beatDance: 0.12,
        bgLevel: 0.03,
        vignette: 0.55,
      },
    },
    // Meteor Shower — a near-still night sky where every snare streaks meteors
    // across the field: the event layer IS the look.
    {
      id: "meteorShower",
      name: "Meteor Shower",
      values: {
        shootingStars: 0.85,
        hue: 215,
        hueVariance: 30,
        density: 10,
        size: 0.09,
        speed: 0.1,
        direction: 55,
        beatDance: 0.1,
        sizePulse: 0.4,
        streak: 0.1,
        hotCore: 0.7,
        clump: 0.6,
        fill: 0.5,
        wander: 0.3,
        wanderSpeed: 0.2,
        twinkle: 0.56,
        glow: 0.3,
        brightness: 0.85,
        sizeVar: 0.9,
        beatFlash: 0.04,
        bgLevel: 0.015,
        vignette: 0.45,
      },
    },
    // Constellation — a linked star chart: clustered magnitudes threaded
    // together by near-neighbour lines, breathing with the drive.
    {
      id: "constellation",
      name: "Constellation",
      values: {
        constellation: 0.75,
        hue: 195,
        hueVariance: 45,
        density: 9,
        size: 0.14,
        speed: 0.05,
        beatDance: 0.08,
        sizePulse: 0.35,
        streak: 0.04,
        hotCore: 0.5,
        clump: 0.66,
        fill: 0.62,
        layers: 2,
        parallax: 0.3,
        wander: 0.24,
        wanderSpeed: 0.15,
        twinkle: 0.66,
        glow: 0.28,
        brightness: 0.9,
        sizeVar: 1.2,
        beatFlash: 0.02,
        bgLevel: 0.01,
        vignette: 0.45,
      },
    },
    // Warp Prism — fly mode INSIDE the club mirror (the deck's first fly +
    // mirror pairing), surging hard on the sync drive (first style to move
    // energyDrive off its default).
    {
      id: "warpPrism",
      name: "Warp Prism",
      values: {
        fly: 1,
        mirror: 8,
        energyDrive: 1.6,
        speed: 1.15,
        density: 18,
        size: 0.09,
        beatDance: 0.6,
        sizePulse: 0.6,
        streak: 1.4,
        hotCore: 0.9,
        clump: 0.3,
        parallax: 0.84,
        glow: 0.5,
        brightness: 1.1,
        twinkle: 0.16,
        hue: 160,
        hueVariance: 80,
        bandColor: 45,
        beatPop: 0.8,
        sizeVar: 0.55,
        vignette: 0.5,
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
      default: 210,
      hint: "Base particle color",
    },
    // RP-6 colour tier — spec shape and hints are the roster contract, shared
    // verbatim with spectrum-bars (the color-tier reference preset).
    {
      key: "saturation",
      label: "Saturation",
      group: "color",
      min: 0,
      max: 2,
      step: 0.01,
      default: 1,
      hint: "Whole-visual color intensity — 0 = grayscale, 1 = authored color, 2 = double (clipped at vivid)",
    },
    {
      key: "lightness",
      label: "Lightness",
      group: "color",
      min: 0,
      max: 2,
      step: 0.01,
      default: 1,
      hint: "Whole-visual lightness — 0 = black, 1 = authored lightness, 2 = double (clipped at white)",
    },
    {
      key: "density",
      label: "Density",
      group: "shape",
      min: 4,
      max: 24,
      step: 1,
      default: 14,
      hint: "How many particles fill the screen",
    },
    {
      key: "size",
      label: "Particle size",
      group: "shape",
      min: 0.05,
      max: 0.4,
      step: 0.01,
      default: 0.11,
      hint: "Base size of each particle",
    },
    {
      key: "speed",
      label: "Motion",
      group: "motion",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.2,
      hint: "Drift speed — loudness accelerates it smoothly",
    },
    {
      key: "direction",
      label: "Direction",
      group: "motion",
      control: "angle",
      min: 0,
      max: 360,
      step: 5,
      default: 90,
      hint: "Drift direction in degrees (90 = up, 270 = down)",
    },
    {
      key: "beatDance",
      label: "Beat dance",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      hint: "Each beat sends every particle gliding to a new spot of its own",
    },
    {
      key: "sizePulse",
      label: "Size pulse",
      group: "reaction",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.8,
      hint: "Particles grow with their band: bass, mids or treble",
    },
    {
      key: "fly",
      label: "Fly mode",
      group: "motion",
      control: "toggle",
      mod: "off",
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      hint: "Particles fly toward you instead of drifting — speed rides the music",
    },
    {
      key: "clump",
      label: "Clumping",
      group: "shape",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.5,
      hint: "Groups particles into loose clusters and open gaps instead of an even scatter",
    },
    {
      key: "streak",
      label: "Motion streaks",
      group: "motion",
      min: 0,
      max: 1.5,
      step: 0.02,
      default: 0.5,
      hint: "Stretches particles along their direction of travel — beats stretch them harder",
    },
    {
      key: "hotCore",
      label: "Hot cores",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.6,
      hint: "The brightest few particles flare past pure color into a near-white core",
    },
    {
      key: "shootingStars",
      label: "Shooting stars",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      hint: "Snare hits launch shooting stars — meteors on paths hashed from the track clock, so every hit streaks the same in preview and export",
    },
    {
      key: "constellation",
      label: "Constellation",
      group: "shape",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      hint: "Threads of light link each particle to its nearest neighbors — higher reaches further and holds more of the lattice together (drift mode)",
    },
  ],
  advanced: [
    {
      key: "energyDrive",
      label: "Sync drive",
      group: "reaction",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.6,
      hint: "How much the sync source speeds up the drift",
    },
    {
      key: "wander",
      label: "Wander",
      group: "motion",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.7,
      hint: "How far particles roam from home, carried partly by a shared drifting current",
    },
    {
      key: "wanderSpeed",
      label: "Wander speed",
      group: "motion",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.35,
      hint: "How fast the roaming motion is",
    },
    {
      key: "fill",
      label: "Fill",
      group: "shape",
      min: 0.2,
      max: 1,
      step: 0.02,
      default: 0.7,
      hint: "Fraction of grid cells that contain a particle",
    },
    {
      key: "layers",
      label: "Layers",
      group: "shape",
      control: "enum",
      mod: "snap",
      options: [
        { value: 1, label: "1" },
        { value: 2, label: "2" },
        { value: 3, label: "3" },
      ],
      min: 1,
      max: 3,
      step: 1,
      default: 3,
      hint: "Parallax depth layers",
    },
    {
      key: "parallax",
      label: "Parallax",
      group: "motion",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.5,
      hint: "Speed difference between layers",
    },
    {
      key: "hueVariance",
      label: "Hue variance",
      group: "color",
      min: 0,
      max: 180,
      step: 5,
      default: 40,
      hint: "Random per-particle color variation",
    },
    {
      key: "twinkle",
      label: "Twinkle",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.4,
      hint: "Per-particle brightness shimmer",
    },
    {
      key: "glow",
      label: "Glow halo",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.35,
      hint: "Soft halo around the crisp particle core",
    },
    {
      key: "brightness",
      label: "Brightness",
      group: "glow",
      min: 0.2,
      max: 1.5,
      step: 0.05,
      default: 0.8,
      hint: "Overall particle brightness",
    },
    {
      key: "beatFlash",
      label: "Beat flash",
      group: "reaction",
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.1,
      hint: "Background pulse on beats",
    },
    {
      key: "bgLevel",
      label: "Bg level",
      group: "backdrop",
      min: 0,
      max: 0.1,
      step: 0.005,
      default: 0.02,
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
      default: 0.35,
      hint: "Darkening toward the screen corners",
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
      hint: "Fold the field into mirrored wedges around the center — 1 is off, 2 mirrors left/right, higher makes a kaleidoscope",
    },
    {
      key: "sizeVar",
      label: "Size variance",
      group: "shape",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0,
      hint: "Extra spread in particle sizes — 0 is even, higher mixes tiny sparks with big soft ones",
    },
    {
      key: "bandColor",
      label: "Band color",
      group: "color",
      min: 0,
      max: 120,
      step: 5,
      default: 0,
      hint: "Tint each particle by the frequency it follows — bass, mids and treble each take their own hue",
    },
    {
      key: "beatPop",
      label: "Beat brightness",
      group: "reaction",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0,
      hint: "Every particle flares brighter on each beat, grid-locked to the tempo",
    },
  ],
  wgsl: /* wgsl */ `
// Per-beat resting spot for one star: direction and radius hashed from the
// star's cell seed AND the beat index. beatRamp() indexes beats mod 4, so the
// walk is bar-periodic and the bar wrap resumes exactly where beat 3's glide
// ended -- continuous by construction, no state, no snap. Radius floor of 0.4
// keeps every hop visible; the unit-disc bound is what the cell-coverage
// budget below is computed from.
fn danceTarget(seed: vec2f, i: f32) -> vec2f {
  let a = hash21(seed + i * 19.19 + 3.7) * TAU;
  let r = 0.4 + 0.6 * hash21(seed + i * 7.31 + 11.3);
  return vec2f(cos(a), sin(a)) * r;
}

// RP-6 whole-visual colour tier, RGB form. This preset's colour is additive
// cosPalette accumulation with no single authored-HSL chokepoint, so the
// scaler grades the finished frame the way led-matrix's own presetRgb grades
// its authored tints. Neutral-BY-CONSTRUCTION at the defaults: saturation 1.0
// matches NEITHER strict branch guard so rgb passes through untouched, and
// lightness 1.0 is an exact IEEE multiply-by-one — factory output stays
// bit-identical without leaning on mix() rounding behaviour at t = 1.
fn presetRgb(rgb: vec3f) -> vec3f {
  let saturation = P_saturation();
  var adjusted = rgb;
  if (saturation < 1.0) {
    let gray = vec3f(dot(rgb, vec3f(0.2126, 0.7152, 0.0722)));
    adjusted = mix(gray, rgb, saturation);
  } else if (saturation > 1.0) {
    let gray = vec3f(dot(rgb, vec3f(0.2126, 0.7152, 0.0722)));
    adjusted = rgb + (rgb - gray) * (saturation - 1.0);
  }
  let lightness = P_lightness();
  if (lightness <= 1.0) { return adjusted * lightness; }
  return min(adjusted * lightness, vec3f(1.0));
}

// ---- Snare shooting stars -------------------------------------------------
// Per-EVENT meteors, not a field behaviour: the snare/transient lane decides
// WHEN they show, a hashed track-time slot grid decides WHAT shows. Five
// detuned lanes each carve track time into fixed slots; a slot hashes its own
// birth moment, start point, heading, span and width from (lane, slot index)
// alone — pure functions of track time with zero accumulated state, so any
// frame (live preview, an export frame, a scrub landing mid-flight) resolves
// the identical meteor. Birth sits in the first third of its slot and the
// flight always ends inside the same slot, so a meteor can never cross a slot
// boundary and get re-seeded mid-air (particles.test.ts sweeps the bound).
// The gate is what makes them EVENTS: lanes run dark until a hit lights the
// in-flight set — the freshest meteor flares brightest, the older ones read
// as the shower's stragglers.
fn shootingStars(p: vec2f, gate: f32) -> vec3f {
  var acc = vec3f(0.0);
  // Density knob: the fraction of slot events that actually fire.
  let duty = 0.3 + 0.7 * P_shootingStars();
  // Meteors fall AGAINST the drift direction (default Direction 90 = field
  // drifts up, meteors fall down) with a hashed +/-26 degree spread each.
  let mAngBase = radians(P_direction()) + TAU * 0.5;
  for (var li = 0; li < 5; li = li + 1) {
    let lane = f32(li);
    // Golden-ratio detuned periods keep lanes permanently out of sync, so
    // consecutive snare hits catch different lanes mid-flight and every hit
    // fires a fresh hashed trajectory.
    let period = 0.85 + 0.4 * fract(lane * 0.6180339887 + 0.23);
    let slot = floor(u.time / period);
    let seed = vec2f(lane * 13.71 + 1.7, slot);
    if (hash21(seed + 31.7) > duty) { continue; }
    // Birth in the first 0.05..0.33 of the slot; life at most 0.65 of it —
    // the worst case ends at 0.98 of the slot, contained by construction.
    let birth = (slot + 0.05 + 0.28 * hash21(seed)) * period;
    let life = period * (0.4 + 0.25 * hash21(seed + 7.3));
    let prog = (u.time - birth) / life;
    if (prog <= 0.0 || prog >= 1.0) { continue; }
    // Attack over the first 6% of the flight, then a tapering burn-out; the
    // gate rides on top so only hits make lanes visible at all.
    let env = smoothstep(0.0, 0.06, prog) * pow(1.0 - prog, 1.6) * gate;
    if (env < 1e-3) { continue; }
    let h2 = hash21(seed + 5.13);
    let h3 = hash21(seed + 9.71);
    let h4 = hash21(seed + 17.39);
    let h5 = hash21(seed + 23.97);
    let start = vec2f((h2 - 0.5) * u.aspect * 1.15, (h3 - 0.5) * 1.15);
    let mAng = mAngBase + (h4 - 0.5) * 0.9;
    let mDir = vec2f(cos(mAng), -sin(mAng));
    let head = start + mDir * (prog * (0.5 + 0.55 * h5));
    // The tail ramps in over the first fifth of the flight so a fresh meteor
    // grows its streak instead of popping in at full length.
    let tailLen = (0.1 + 0.2 * h5) * smoothstep(0.0, 0.2, prog);
    let ab = mDir * tailLen;
    let toP = p - (head - ab);
    let hSeg = clamp(dot(toP, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    let dSeg = length(toP - ab * hSeg);
    let w = 0.006 + 0.004 * h5;
    // Crisp streak brightening toward the head, plus a hot head bloom.
    let core = smoothstep(w * 3.5, w * 0.4, dSeg) * (0.3 + 0.7 * hSeg * hSeg);
    let headD = p - head;
    let halo = exp(-dot(headD, headD) * 260.0) * (0.55 + P_glow() * 0.7);
    let hueOff = (h3 - 0.5) * P_hueVariance();
    let mPal = cosPalette(1.0 - (P_hue() + hueOff) / 360.0, ${WGSL_PALETTE_STD});
    // Meteors flare toward white like the field's own hot cores.
    acc += mix(mPal, vec3f(1.0), 0.3 + 0.4 * P_hotCore()) * (core * 1.1 + halo) * env;
  }
  return acc;
}

// ---- Constellation linking ------------------------------------------------
// The LAYER-0 drift particle of one cell, in that layer's own q-space: position
// and existence resolved by the EXACT same hashes, wander, clump and beat-
// dance rules as the drawn dot (particles.test.ts pins the shared
// expressions), so a link lands ON its star, never beside it. Two deliberate
// differences, both serving the 3x3 coverage budget the link pass shares
// with the dot loops:
//  - the offset is hard-clamped to +/-0.4 cells. Identity across the whole
//    default range (|wander| + |dance| stays under 0.4 until Wander pushes
//    past ~0.85), so links stick exactly to their dots; at extreme Wander +
//    Beat dance the line end compresses toward the cell while the dot
//    overshoots — a soft tether, instead of link segments escaping the
//    enumeration window and CLIPPING along invisible straight cell borders.
//    With the clamp an endpoint sits within 0.9 cells of its cell corner, and
//    the 0.05-cell line half-width keeps every drawn pixel inside 1 cell of
//    the endpoint cells — which the 3x3 anchor window covers exactly.
//  - z carries existence (1 = a particle lives here), because a link may only
//    join two REAL dots — fill/clump holes stay holes.
fn cstPoint(cell: vec2f, wt: f32, gCur: vec2f, bPrev: f32, bIdx: f32, bFr: f32,
            danceAmp: f32, pGeo: f32) -> vec3f {
  let h1 = hash21(cell);
  let fillPMax = clamp(P_fill() * (1.0 + 0.7 * P_clump()), 0.0, 1.0);
  if (h1 > fillPMax) { return vec3f(0.0); }
  if (P_clump() > 1e-3) {
    let clumpN = noise2(cell * 0.1);
    let fillP = clamp(mix(P_fill(), P_fill() * (1.7 - 1.4 * clumpN), P_clump()), 0.0, 1.0);
    if (h1 > fillP) { return vec3f(0.0); }
  }
  let h2 = hash21(cell + 41.3);
  let h3 = hash21(cell + 77.7);
  let fph = h2 * TAU;
  let drift = vec2f(sin(wt * (0.8 + 0.5 * h2) + fph), cos(wt * (0.7 + 0.5 * h3) + fph * 1.3)) * 0.34;
  let wob = (drift + gCur) * P_wander();
  var dance = vec2f(0.0);
  if (u.bpm >= 1.0) {
    if (danceAmp > 1e-5) {
      dance = mix(danceTarget(cell, bPrev), danceTarget(cell, bIdx), bFr) * danceAmp;
    }
  } else {
    let scatDir = normalize(vec2f(h2 - 0.5, h3 - 0.5) + 1e-4);
    dance = scatDir * softLimit(u.driveBeat * P_beatDance() * 0.35 * pGeo, 0.45);
  }
  let off = clamp(wob + dance, vec2f(-0.4), vec2f(0.4));
  return vec3f(cell + vec2f(0.5) + off, 1.0);
}

fn preset(uv: vec2f) -> vec4f {
  var p = kaleido(centered(uv), P_mirror());

  // ---- Pulse + beat-grid masters (v2.66 overhaul) --------------------------
  // pGeo replaces raw u.pulse on every GEOMETRIC beat term. The slider runs
  // 0..2 but the geometry was tuned at 1.0, and linear scaling doubled every
  // displacement at 200% (the "explodes outward then floods" video). This
  // curve is exact at 0 and 1 and compresses the top (2.0 -> ~1.45), so 200%
  // reads punchier, not twice as far. Still a true gate: pulse 0 -> 0.
  let pGeo = u.pulse * 1.6 / (1.0 + 0.6 * u.pulse);
  // Tempo-grid beat walk. bIdx/bFr slice beatRamp() (0..4, advancing 1.0 per
  // grid beat, bar-wrap continuous) into "which beat" and "how far into it".
  // The glide eases over the first 45% of the beat, then RESTS: each beat
  // moves a star TO a new hashed spot, never back. The old scat term scaled
  // the instantaneous driveBeat envelope, so its decay dragged every star
  // back to where it started -- the long-standing "jerked back" complaint.
  let ramp = beatRamp();
  let bIdx = floor(ramp);
  let bPrev = (bIdx + 3.0) % 4.0;
  let bFr = smoothstep(0.0, 0.45, fract(ramp));
  // Bounded surge shape for fly mode: eased beat count minus the linear ramp.
  // Both wrap identically at the bar, so the difference is continuous and
  // stays within about [-0.03, 0.55] -- a per-beat forward surge with zero
  // net phase drift, and (capped at the use site) no backward motion between
  // surges.
  let surgeCurve = bIdx + bFr - ramp;
  // The beat grid ticks straight through silence; gate tempo-locked motion on
  // the smoothed drive so a quiet intro stays still (the calm look is
  // unchanged) and the release is a slow settle, never a per-beat rubber-band.
  let gate = smoothstep(0.02, 0.2, u.drive);
  // Dance amplitude in CELL units. Max 1.0 * 0.3 * 1.45 = 0.44 cells at
  // Beat dance 1.0 / pulse 200% -- the coverage bound below relies on this.
  let danceAmp = P_beatDance() * 0.3 * pGeo * gate;

  // Dark hued field (a cosine tint stays saturated near black where an hsl hue
  // would go grey), plus a faint warped nebula breathing with bass -- ambient
  // wash only, safe to fill the frame.
  let hueT = 1.0 - P_hue() / 360.0;
  let bgPal = cosPalette(hueT + 0.08, ${WGSL_PALETTE_STD});
  var col = bgPal * P_bgLevel() * (1.0 + u.bass * 0.6);
  // A plain fbm, not warpFbm: this ambient wash is barely visible (x0.05), so
  // the domain-warp's extra two fbm evals per pixel (15 noise2 -> 5) were pure
  // cost for no visible gain.
  let nebT = fbm(p * 0.5 + u.time * 0.02);
  col += bgPal * nebT * nebT * 0.05 * (0.4 + u.mid * 0.8);
  // Full-frame flash saturates at 0.3 (softLimit, identity below the knee so
  // pulse 100% is untouched at the default Beat flash): linear-in-pulse it hit
  // 0.5 * 2.0 = a solid frame of palette on every beat, the magenta flood in
  // the owner's video. A wash must stay a wash.
  col += bgPal * softLimit(u.driveBeat * P_beatFlash() * pGeo, 0.3);

  // Grid-locked beat brightness pop applied to every particle's luminance in
  // both modes. Frame-constant, so hoisted out of the cell loops. pGeo gates
  // it; default Beat brightness of 0 makes this exactly 1.0 (no change). The
  // softLimit cap (max 2.6x luminance) keeps a maxed slider from bleaching
  // the whole field white at pulse 200% (was 4.0x).
  let beatPop = 1.0 + softLimit(max(u.driveBeat, gridPulse(7.0)) * P_beatPop() * pGeo, 1.6);

  if (P_fly() > 0.5) {
    // ---- TRUE 3D STARFIELD: discrete stars stream from far to the camera ----
    // Each depth SHELL scrolls toward the viewer; a star spawns far (small,
    // dim, near the vanishing point), approaches while growing/brightening and
    // streaking outward, then the shell wraps = despawn + a fresh one far away.
    // Flying THROUGH independent particles, not a zoomed image.
    let gs = 2.0 + P_density() * 0.45;
    // Frame-constant hoists — each of these was recomputed in the innermost
    // cell loop (3x3 x shells = up to 54x per pixel) for a value that cannot
    // vary within a frame. The surge term buys back a softLimit (tanh) per
    // cell. Beat stretch itself is soft-capped: linear in u.pulse it ran to
    // 2.5 + 6.0 at 200% — a ~13x smear whose covered area multiplied the
    // per-pixel tail cost across every shell (the 10 FPS cliff) while
    // blowing past cell coverage (the mid-screen cutoff).
    let streakSurge = 2.5 + softLimit(u.driveBeat * 3.0 * pGeo, 3.0);
    // Upper bound on fillP over every possible clump-noise value (noise2 is
    // in [0,1]), so an empty cell can be rejected BEFORE paying for the
    // clump noise2 — exact: h1 above the bound can never pass the full test.
    let fillPMax = clamp(P_fill() * (1.0 + 0.7 * P_clump()), 0.0, 1.0);
    // Identity gate: mix(a, b, 0) = a, so at Clumping 0 the noise2 result is
    // discarded anyway — skip the call (27+ noise2 evals/pixel at 3 layers).
    let clumpOn = P_clump() > 1e-3;
    // Shells are the fly-mode cost multiplier: every shell walks a 3x3 cell
    // neighbourhood, so 4-per-layer meant 108 cell iterations PER PIXEL (and
    // 108 clump noise2 evals with it) — several times the cost of any other
    // preset. Two per layer still reads as a deep, continuously-streaming field
    // because the shells are golden-ratio spread across depth.
    let shells = i32(P_layers()) * 2;
    for (var sI = 0; sI < shells; sI = sI + 1) {
      let fs = f32(sI);
      // The coefficient on u.time is PARAMS-ONLY. It used to carry u.drive and
      // u.driveBeat, which makes the shell position t*v(t) instead of the
      // integral of v: whenever the rate moved, the phase jumped by
      // t*(rate change) — an error that grows LINEARLY with track time. A beat
      // shifted the shell phase 0.20 at t=5 s but 4.68 at t=120 s, i.e. the
      // whole field re-rolled mid-track. Loudness and beats still ride as
      // BOUNDED additive phase offsets, so they push the field toward you
      // without ever re-seeding it.
      let baseRate = P_speed() * (1.0 - P_parallax() * fract(fs * 0.37) * 0.45);
      var beatPh = 0.0;
      if (u.bpm >= 1.0) {
        // Tempo-locked surge: the shell travels its normal distance but
        // bunches that travel onto the beats. Cap: base scroll advances
        // baseRate*0.28 phase/s and the ramp runs u.bpm/60 beats/s, so any
        // amp <= ampMax keeps total phase velocity >= 0 — the field surges
        // forward on each beat and NEVER slides back (the envelope push it
        // replaces returned all of its displacement as driveBeat decayed).
        // Floor guards softLimit's knee math when Motion is 0 (ampMax -> 0
        // would divide 0/0 inside softLimit); the surge is invisible there
        // anyway because a parked field has no travel to bunch up.
        let ampMax = max(baseRate * 0.28 * 60.0 / max(u.bpm, 1.0), 1e-4);
        beatPh = softLimit(P_beatDance() * 0.2 * pGeo * gate, ampMax) * surgeCurve;
      } else {
        // No grid yet: keep the envelope push, halved and capped, so the
        // residual settle-back is a small ease instead of a lurch.
        beatPh = softLimit(u.driveBeat * P_beatDance() * 0.12 * pGeo, 0.15);
      }
      let phase = fract(fs * 0.6180339887 + u.time * baseRate * 0.28
                      + u.drive * P_energyDrive() * 0.4
                      + beatPh);
      let Z = mix(1.25, 0.05, phase);           // far -> at the camera
      // Rotate each shell's grid by a different angle. Otherwise every shell's
      // naturally-sparse vanishing point (the grid origin) sits on the same
      // screen axes and they STACK into a hard dark cross through the centre.
      // Rotated, each shell's sparse region points a different way and they
      // fill each other's gaps.
      let rot = rot2(fs * 2.3994 + 0.5);
      let rotT = transpose(rot);
      let world = rot * (p * Z * gs);
      let baseCell = floor(world);
      for (var oy = -1; oy <= 1; oy = oy + 1) {
        for (var ox = -1; ox <= 1; ox = ox + 1) {
          let cell = baseCell + vec2f(f32(ox), f32(oy)) + fs * 17.0;
          let h1 = hash21(cell + fs * 31.7);
          // Cheap exact reject first, clump noise only for survivors.
          if (h1 > fillPMax) { continue; }
          if (clumpOn) {
            let clumpN = noise2(cell * 0.15 + fs * 7.0);
            let fillP = clamp(mix(P_fill(), P_fill() * (1.7 - 1.4 * clumpN), P_clump()), 0.0, 1.0);
            if (h1 > fillP) { continue; }
          }
          let h2 = hash21(cell + 41.3 + fs * 3.1);
          let h3 = hash21(cell + 77.7 + fs * 5.3);
          let h4 = hash21(cell + 13.1 + fs * 9.7);
          let starW = baseCell + vec2f(f32(ox), f32(oy)) + vec2f(0.2 + 0.6 * h2, 0.2 + 0.6 * h3);
          let starScreen = (rotT * starW) / (Z * gs);   // un-rotate back to screen
          let dvec = p - starScreen;
          var band = u.bass;
          var bandTint = 0.0;
          if (h4 < 0.3333) { band = u.mid; bandTint = 1.0; } else if (h4 < 0.6666) { band = u.treble; bandTint = 2.0; }
          // Optional extra per-particle size spread on top of the existing depth
          // spread. Neutral (1.0) at Size variance = 0 so the tuned look holds.
          let szExtra = max(1.0 + (h1 - 0.5) * P_sizeVar() * 1.4, 0.1);
          // Small, crisp point; capped so a near star becomes a thin STREAK
          // flying past rather than a fat soft blob.
          let rad = min(P_size() * (0.3 + h1) / (Z * gs) * (1.0 + band * P_sizePulse()) * szExtra, 0.05);
          var stretch = 1.0 + P_streak() * (1.0 - Z) * streakSurge;
          // COVERAGE BOUND: the 3x3 neighbourhood only sees a star whose full
          // extent stays within 1.5 cells of its cell centre; jitter spends
          // 0.3 of that, leaving 1.2 cells for glow reach. Anything longer
          // used to clip at a straight invisible cell edge. Shorten the
          // streak to fit; the reach min() below radially caps the rare case
          // where the unstretched radius alone overflows (giant Size +
          // Size pulse combos, which clipped far worse before).
          let reachMax = 1.2 / (Z * gs);
          if (rad * stretch * 3.0 + 0.003 > reachMax) {
            stretch = max((reachMax - 0.003) / max(rad * 3.0, 1e-5), 1.0);
          }
          // EARLY DISTANCE CULL: a star's glow reaches at most ~3 core-radii, so
          // past that skip the sqrt / twinkle sins / palette cos / halo exp that
          // dominate the per-star cost. Stars are sparse, so most cells stop here.
          let reach = min(rad * stretch * 3.0 + 0.003, reachMax);
          if (dot(dvec, dvec) > reach * reach) { continue; }
          // Deferred past the cull: normalize costs a sqrt and most cells
          // stop at the cull above.
          let flight = normalize(starScreen + vec2f(1e-4, 0.0));
          let perp = vec2f(-flight.y, flight.x);
          let dl = dot(dvec, flight);
          let dp = dot(dvec, perp);
          let dist = sqrt(dl * dl / (stretch * stretch) + dp * dp);
          let fade = smoothstep(1.25, 0.9, Z) * smoothstep(0.05, 0.17, Z);
          let twP = u.time * (1.3 + h2 * 3.0) + h1 * 40.0;
          let tw = 1.0 - P_twinkle() * (0.5 + 0.35 * sin(twP) + 0.15 * sin(twP * 1.618));
          // Bright pinpoint + tight bloom -- a crisp point of light, not bokeh.
          let cd = dist / max(rad, 1e-5);
          let core = 1.0 / (1.0 + cd * cd * 10.0);
          let halo = exp(-cd * cd * 1.3) * P_glow() * 0.4;
          // Band color: bass keeps the base hue, mids and treble step away from
          // it by Band color degrees each — a legible bass/mid/treble split.
          let hueOff = (h3 - 0.5) * P_hueVariance() + bandTint * P_bandColor();
          let sPal = cosPalette(1.0 - (P_hue() + hueOff) / 360.0, ${WGSL_PALETTE_STD});
          let lum = (core * 1.6 + halo) * fade * tw * (0.5 + band * 0.9) * beatPop;
          let hot = smoothstep(0.26, 0.06, Z) * P_hotCore() * (0.4 + h1);
          col += mix(sPal, vec3f(1.0), hot * 0.7) * lum * P_brightness();
        }
      }
    }
    } else {
    // ---- DRIFT MODE: independent particles drifting on a shared current ----
    // Same rule as fly mode: what multiplies u.time is params-only, so the
    // field can never teleport by t*(rate change) when loudness moves. Audio
    // becomes a bounded positional PUSH added below. (The beat kick the eye
    // actually reads in drift mode is the per-star dance, a bounded additive
    // offset walked on the tempo grid.)
    let baseSpd = P_speed() * 0.6;
    // The driveBeat term that used to ride here shifted the WHOLE field along
    // dir and slid it back as the envelope decayed — that beat energy now
    // lives entirely in the per-star dance below, which never retraces. Only
    // the slow drive push remains; its seconds-scale envelope reads as swell,
    // not snap.
    let push = u.drive * P_energyDrive() * 0.08;
    let ang = radians(P_direction());
    let dir = vec2f(cos(ang), -sin(ang));
    let layerCount = i32(P_layers());
    // Hoisted out of the per-cell loop (were recomputed 27x per pixel): the
    // wander clock, and a single GLOBAL current (one sin/cos for the whole
    // frame) that sways every particle together instead of a per-cell flow.
    let wt = u.time * (0.25 + P_wanderSpeed() * 0.6);
    let gCur = vec2f(sin(u.time * 0.3), cos(u.time * 0.26)) * 0.12;
    // More frame-constant hoists (each was recomputed 27x per pixel at 3
    // layers). The beat stretch buys back a softLimit (tanh) per cell; it is
    // soft-capped because linear in u.pulse the term hit 0.2 + 2.0 at 200%,
    // smearing every particle into a dash (and past its cell coverage) —
    // max is 0.2 + 1.1.
    let stretchBase = 1.0 + P_streak() * (0.2 + softLimit(u.driveBeat * pGeo, 1.1));
    // Upper bound on fillP over every clump-noise value (noise2 in [0,1]):
    // rejects an empty cell BEFORE its clump noise2 — exact, h1 above the
    // bound can never pass the full test.
    let fillPMax = clamp(P_fill() * (1.0 + 0.7 * P_clump()), 0.0, 1.0);
    // Identity gates: mix(a, b, 0) = a and dance * 0 = 0, so at Clumping 0
    // the clump noise2 (27/pixel) and at danceAmp 0 (Beat dance 0, pulse 0,
    // or the drive gate closed — all frame-uniform) the two danceTarget
    // hashes per cell are computed only to be discarded. Skip them.
    let clumpOn = P_clump() > 1e-3;
    let danceOn = danceAmp > 1e-5;
    for (var l = 0; l < layerCount; l = l + 1) {
      let fl = f32(l);
      let scl = (P_density() + fl * 3.0) * 0.5;
      let par = 1.0 - P_parallax() * fl * 0.3;
      // Only a GENTLE overall drift in the chosen direction — the free
      // per-particle float below is the dominant motion, so particles wander
      // every which way instead of marching in formation.
      let flow = dir * baseSpd * par * 0.06;
      let q = p * scl - flow * u.time - dir * push * par;
      let base = floor(q);
      let radBase = P_size() * 0.4 / scl;
      // 3x3 neighbourhood so a jittered star near a cell edge still draws.
      for (var oy = -1; oy <= 1; oy = oy + 1) {
        for (var ox = -1; ox <= 1; ox = ox + 1) {
          let cell = base + vec2f(f32(ox), f32(oy)) + fl * 93.17;
          let h1 = hash21(cell);
          // Cheap exact reject first, clump noise only for survivors.
          if (h1 > fillPMax) { continue; }
          if (clumpOn) {
            let clumpN = noise2((base + vec2f(f32(ox), f32(oy))) * 0.1 + fl * 6.0);
            let fillP = clamp(mix(P_fill(), P_fill() * (1.7 - 1.4 * clumpN), P_clump()), 0.0, 1.0);
            if (h1 > fillP) { continue; }
          }
          let h2 = hash21(cell + 41.3);
          let h3 = hash21(cell + 77.7);
          let h4 = hash21(cell + 13.1);
          // Free per-particle float: ONE incommensurate sine pair on this
          // particle's own phase (down from three pairs) plus the hoisted global
          // current — still reads as free wandering, at a third of the trig.
          let fph = h2 * TAU;
          let drift = vec2f(sin(wt * (0.8 + 0.5 * h2) + fph), cos(wt * (0.7 + 0.5 * h3) + fph * 1.3)) * 0.34;
          let wob = (drift + gCur) * P_wander();
          // Beat dance: glide to a NEW hashed resting offset each grid beat
          // (see the bIdx/bFr note up top) instead of displacing by the beat
          // envelope, whose decay yanked the star straight back. danceVel is
          // the hop direction, kept for the streak so it stretches along the
          // actual motion. Targets live in a unit disc scaled by danceAmp
          // (<= 0.44 cells at pulse 200%), which the coverage budget below
          // counts on.
          var dance = vec2f(0.0);
          var danceVel = vec2f(0.0);
          if (u.bpm >= 1.0) {
            if (danceOn) {
              let tPrev = danceTarget(cell, bPrev);
              let tCur = danceTarget(cell, bIdx);
              dance = mix(tPrev, tCur, bFr) * danceAmp;
              danceVel = (tCur - tPrev) * danceAmp * 2.0;
            }
          } else {
            // No beat grid: fall back to the envelope scatter, softLimit-
            // capped at 0.45 cells — the residual settle-back is a small
            // ease instead of the old full-amplitude rubber-band.
            let scatDir = normalize(vec2f(h2 - 0.5, h3 - 0.5) + 1e-4);
            dance = scatDir * softLimit(u.driveBeat * P_beatDance() * 0.35 * pGeo, 0.45);
            danceVel = scatDir * softLimit(u.driveBeat * 1.4 * pGeo, 2.0);
          }
          let off = wob + dance;
          // Distance measured in q-SPACE (then rescaled to p units): q already
          // carries the flow/push translation, so cell ENUMERATION and drawn
          // particle POSITION share one drifting frame — the field genuinely
          // translates along Direction. The old form placed the particle's
          // home in p-space, WITHOUT the flow offset that q subtracts, so the
          // enumeration window slid away from the drawn positions at flow
          // rate; once ~1.5 cells apart, a pixel's true neighbours fell
          // outside its 3x3 window and particles + glow cut off along
          // straight cell-boundary lines perpendicular to Direction (~2:20
          // into a track at default Motion, sooner when faster), and a
          // Direction change teleported the offset — instant full-frame
          // smeared strips. Now a Direction change is an ordinary clean
          // param change.
          let d = (q - (base + vec2f(f32(ox), f32(oy)) + vec2f(0.5) + off)) / scl;
          var band = u.bass;
          var bandTint = 0.0;
          if (h4 < 0.3333) { band = u.mid; bandTint = 1.0; } else if (h4 < 0.6666) { band = u.treble; bandTint = 2.0; }
          let depthV = mix(0.5, 1.4, h1);
          // Extra per-particle size spread (neutral at Size variance = 0).
          let szExtra = max(1.0 + (h1 - 0.5) * P_sizeVar() * 1.4, 0.1);
          let rad = radBase * depthV * (0.7 + band * P_sizePulse()) * szExtra;
          var stretch = stretchBase;
          // COVERAGE BOUND (mirror of fly mode): d is measured in q-space, so
          // this budget is exact under any amount of drift — the 3x3
          // neighbourhood covers 1.5 cells beyond the cell centre; wob +
          // dance spend at most ~0.9 of that, and the glow reach may not
          // spend more than the rest — shorten the streak to fit, radially
          // cap the reach (min below) as the last resort for oversized Size
          // combos. This is what removes the streak-overflow clip edges.
          let reachMax = (1.5 - max(abs(off.x), abs(off.y))) / scl;
          if (rad * stretch * 2.8 + 0.004 > reachMax) {
            stretch = max((reachMax - 0.004) / max(rad * 2.8, 1e-5), 1.0);
          }
          // EARLY DISTANCE CULL — the real speedup. A particle's glow reaches at
          // most ~2.8 core-radii; beyond that its contribution is under 1% yet
          // was computed anyway. Particles are sparse, so most of the
          // 3x3-times-layers cells stop HERE, before the sqrt / twinkle sin /
          // palette cos / bloom exp that dominate the per-particle cost.
          let reach = min(rad * stretch * 2.8 + 0.004, reachMax);
          if (dot(d, d) > reach * reach) { continue; }
          // Streak follows the particle's own drift; light in drift mode so
          // free-floating particles stay mostly point-like, stretching on a beat.
          let vel = normalize(gCur + drift * 0.5 + danceVel + vec2f(1e-4, 0.0));
          let perp = vec2f(-vel.y, vel.x);
          let dl = dot(d, vel);
          let dp = dot(d, perp);
          let dist = sqrt(dl * dl / (stretch * stretch) + dp * dp);
          let twP = u.time * (1.3 + h2 * 3.0) + h1 * 40.0;
          let tw = 1.0 - P_twinkle() * (0.5 + 0.35 * sin(twP) + 0.15 * sin(twP * 1.618));
          // A bright PINPOINT (1/(1+r^2) has an intense centre and a fast
          // falloff = a crisp glowing dot) plus a small tight bloom, instead
          // of a soft-edged disc. This is what makes it read as a distinct
          // particle rather than an out-of-focus light.
          let cd = dist / max(rad, 1e-5);
          let core = 1.0 / (1.0 + cd * cd * 10.0);
          let bloom = exp(-cd * cd * 1.3) * P_glow() * 0.45;
          // Band color: bass keeps the base hue, mids/treble step away by Band
          // color degrees each — the same legible split as fly mode.
          let hueOff = (h3 - 0.5) * P_hueVariance() + bandTint * P_bandColor();
          let sPal = cosPalette(1.0 - (P_hue() + hueOff) / 360.0, ${WGSL_PALETTE_STD});
          let lum = (core * 1.4 + bloom) * tw * depthV * (0.55 + band * 0.9) * beatPop;
          let hot = smoothstep(0.6, 1.4, depthV) * P_hotCore() * (0.4 + h1);
          col += mix(sPal, vec3f(1.0), hot * 0.7) * lum * P_brightness();
        }
      }
    }

    // ---- Constellation links: near-neighbour threads on the layer-0 grid ---
    // Opt-in (default 0 = the block never runs). Anchored to the SAME cell
    // grid the sim already walks: a 4x4 window of layer-0 particles is
    // resolved once (16 cstPoint evaluations — each east/south link endpoint
    // is shared by two anchors, cheaper than 9 anchors x 3 fresh points),
    // then every anchor cell links toward its east and south neighbours only.
    // Bounded by construction: at most 18 segment tests per pixel, never an
    // O(n^2) pair search.
    let cst = P_constellation();
    if (cst > 1e-3) {
      // Layer 0's own q-space, term for term (par = 1 there), so base0/q0 are
      // bit-identical to the dot loop's and links land exactly on dots.
      let scl0 = P_density() * 0.5;
      let flow0 = dir * baseSpd * 0.06;
      let q0 = p * scl0 - flow0 * u.time - dir * push;
      let base0 = floor(q0);
      var pts: array<vec3f, 16>;
      for (var iy = 0; iy < 4; iy = iy + 1) {
        for (var ix = 0; ix < 4; ix = ix + 1) {
          pts[iy * 4 + ix] = cstPoint(base0 + vec2f(f32(ix) - 1.0, f32(iy) - 1.0),
                                      wt, gCur, bPrev, bIdx, bFr, danceAmp, pGeo);
        }
      }
      // The knob buys reach AND presence together: short links appear first,
      // a maxed knob holds most of the lattice threaded.
      let maxLen = 0.55 + 1.2 * cst;
      var linkAcc = 0.0;
      for (var iy = 0; iy < 3; iy = iy + 1) {
        for (var ix = 0; ix < 3; ix = ix + 1) {
          let A = pts[iy * 4 + ix];
          if (A.z < 0.5) { continue; }
          for (var k = 0; k < 2; k = k + 1) {
            // k = 0: south neighbour; k = 1: east neighbour.
            let B = pts[select(iy * 4 + ix + 1, (iy + 1) * 4 + ix, k == 0)];
            if (B.z < 0.5) { continue; }
            let ab = B.xy - A.xy;
            let len = length(ab);
            // Fade to nothing well before the coverage bound, so an over-long
            // link melts away instead of ever clipping.
            let op = smoothstep(maxLen, maxLen * 0.5, len);
            if (op < 1e-3) { continue; }
            let toQ = q0 - A.xy;
            let hSeg = clamp(dot(toQ, ab) / max(len * len, 1e-5), 0.0, 1.0);
            let dq = length(toQ - ab * hSeg);
            // Thin, crisp thread (widths in CELL units — re-prove the
            // coverage note on cstPoint before touching the 0.05).
            let line = smoothstep(0.05, 0.016, dq);
            // Brightest where it meets its stars, dimmest mid-span: light
            // strung BETWEEN dots, not a wireframe drawn over them.
            let endW = 0.55 + 0.9 * abs(hSeg - 0.5);
            linkAcc += line * op * endW;
          }
        }
      }
      if (linkAcc > 0.0) {
        let lPal = cosPalette(1.0 - P_hue() / 360.0, ${WGSL_PALETTE_STD});
        // Threads breathe with the sync drive and pop with the same
        // grid-locked beat brightness as the dots they join.
        col += lPal * linkAcc * cst * (0.4 + 0.35 * u.drive) * beatPop * P_brightness() * 0.6;
      }
    }
  }

  // ---- Snare shooting stars: an event overlay over either mode -------------
  // Default 0 = the block never runs (bit-identical factory output). Drawn in
  // the kaleido-folded frame, so Club mirror folds the meteor shower with the
  // field. pGeo ties the burst into the Pulse master exactly like every other
  // beat-driven term; the driveBeat floor keeps the lane alive on material
  // where the snare classifier stays quiet.
  let met = P_shootingStars();
  if (met > 1e-3) {
    let mGate = softLimit(max(u.snare, u.driveBeat * 0.35) * 1.2 * pGeo, 1.0);
    if (mGate > 1e-3) {
      col += shootingStars(p, mGate) * P_brightness();
    }
  }

  col *= vignette(uv, P_vignette());
  // RP-6 colour tier grades the finished frame AFTER tonemap: the range there
  // is 0..1, so Lightness above 1 clips at white monotonically instead of
  // fighting the ACES shoulder. Identity at the 1/1 defaults.
  col = presetRgb(tonemap(col * 1.2));
  col += grain(uv, 0.012);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
