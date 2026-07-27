import type { PresetDef } from "../types";

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
 */
export const starfield: PresetDef = {
  id: "starfield",
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
    // Rave — every reaction knob up — scatter, size pulse, band colour, beat pops.
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
      hint: "Each beat kicks every particle in its own direction",
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
fn preset(uv: vec2f) -> vec4f {
  var p = kaleido(centered(uv), P_mirror());

  // Dark hued field (a cosine tint stays saturated near black where an hsl hue
  // would go grey), plus a faint warped nebula breathing with bass -- ambient
  // wash only, safe to fill the frame.
  let hueT = 1.0 - P_hue() / 360.0;
  let bgPal = cosPalette(hueT + 0.08, vec3f(0.5), vec3f(0.5), vec3f(1.0), vec3f(0.0, 0.33, 0.67));
  var col = bgPal * P_bgLevel() * (1.0 + u.bass * 0.6);
  // A plain fbm, not warpFbm: this ambient wash is barely visible (x0.05), so
  // the domain-warp's extra two fbm evals per pixel (15 noise2 -> 5) were pure
  // cost for no visible gain.
  let nebT = fbm(p * 0.5 + u.time * 0.02);
  col += bgPal * nebT * nebT * 0.05 * (0.4 + u.mid * 0.8);
  col += bgPal * u.driveBeat * P_beatFlash() * u.pulse;

  // Grid-locked beat brightness pop applied to every particle's luminance in
  // both modes. Frame-constant, so hoisted out of the cell loops. u.pulse gates
  // it; default Beat brightness of 0 makes this exactly 1.0 (no change).
  let beatPop = 1.0 + max(u.driveBeat, gridPulse(7.0)) * P_beatPop() * u.pulse;

  if (P_fly() > 0.5) {
    // ---- TRUE 3D STARFIELD: discrete stars stream from far to the camera ----
    // Each depth SHELL scrolls toward the viewer; a star spawns far (small,
    // dim, near the vanishing point), approaches while growing/brightening and
    // streaking outward, then the shell wraps = despawn + a fresh one far away.
    // Flying THROUGH independent particles, not a zoomed image.
    let gs = 2.0 + P_density() * 0.45;
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
      // whole field re-rolled mid-track. Loudness and beats now ride as a
      // BOUNDED additive phase offset, so they still push the field toward you
      // without ever re-seeding it.
      let baseRate = P_speed() * (1.0 - P_parallax() * fract(fs * 0.37) * 0.45);
      let phase = fract(fs * 0.6180339887 + u.time * baseRate * 0.28
                      + u.drive * P_energyDrive() * 0.4
                      + u.driveBeat * P_beatDance() * 0.25 * u.pulse);
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
          let clumpN = noise2(cell * 0.15 + fs * 7.0);
          let h1 = hash21(cell + fs * 31.7);
          let fillP = clamp(mix(P_fill(), P_fill() * (1.7 - 1.4 * clumpN), P_clump()), 0.0, 1.0);
          if (h1 > fillP) { continue; }
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
          let flight = normalize(starScreen + vec2f(1e-4, 0.0));
          let perp = vec2f(-flight.y, flight.x);
          let stretch = 1.0 + P_streak() * (1.0 - Z) * (2.5 + u.driveBeat * 3.0 * u.pulse);
          // EARLY DISTANCE CULL: a star's glow reaches at most ~3 core-radii, so
          // past that skip the sqrt / twinkle sins / palette cos / halo exp that
          // dominate the per-star cost. Stars are sparse, so most cells stop here.
          let reach = rad * stretch * 3.0 + 0.003;
          if (dot(dvec, dvec) > reach * reach) { continue; }
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
          let sPal = cosPalette(1.0 - (P_hue() + hueOff) / 360.0, vec3f(0.5), vec3f(0.5), vec3f(1.0), vec3f(0.0, 0.33, 0.67));
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
    // actually reads in drift mode is scat, already an additive offset.)
    let baseSpd = P_speed() * 0.6;
    let push = u.drive * P_energyDrive() * 0.08
             + u.driveBeat * P_beatDance() * 0.06 * u.pulse;
    let ang = radians(P_direction());
    let dir = vec2f(cos(ang), -sin(ang));
    let layerCount = i32(P_layers());
    // Hoisted out of the per-cell loop (were recomputed 27x per pixel): the
    // wander clock, and a single GLOBAL current (one sin/cos for the whole
    // frame) that sways every particle together instead of a per-cell flow.
    let wt = u.time * (0.25 + P_wanderSpeed() * 0.6);
    let gCur = vec2f(sin(u.time * 0.3), cos(u.time * 0.26)) * 0.12;
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
      // 3x3 neighbourhood so a jittered star near a cell edge still draws.
      for (var oy = -1; oy <= 1; oy = oy + 1) {
        for (var ox = -1; ox <= 1; ox = ox + 1) {
          let cell = base + vec2f(f32(ox), f32(oy)) + fl * 93.17;
          let h1 = hash21(cell);
          let clumpN = noise2((base + vec2f(f32(ox), f32(oy))) * 0.1 + fl * 6.0);
          let fillP = clamp(mix(P_fill(), P_fill() * (1.7 - 1.4 * clumpN), P_clump()), 0.0, 1.0);
          if (h1 > fillP) { continue; }
          let h2 = hash21(cell + 41.3);
          let h3 = hash21(cell + 77.7);
          let h4 = hash21(cell + 13.1);
          // Free per-particle float: ONE incommensurate sine pair on this
          // particle's own phase (down from three pairs) plus the hoisted global
          // current — still reads as free wandering, at a third of the trig.
          let fph = h2 * TAU;
          let drift = vec2f(sin(wt * (0.8 + 0.5 * h2) + fph), cos(wt * (0.7 + 0.5 * h3) + fph * 1.3)) * 0.34;
          let wob = (drift + gCur) * P_wander();
          let scatDir = normalize(vec2f(h2 - 0.5, h3 - 0.5) + 1e-4);
          let scat = scatDir * u.driveBeat * P_beatDance() * 0.35 * u.pulse;
          let home = (base + vec2f(f32(ox), f32(oy)) + vec2f(0.5) + wob + scat) / scl;
          let d = p - home;
          var band = u.bass;
          var bandTint = 0.0;
          if (h4 < 0.3333) { band = u.mid; bandTint = 1.0; } else if (h4 < 0.6666) { band = u.treble; bandTint = 2.0; }
          let depthV = mix(0.5, 1.4, h1);
          // Extra per-particle size spread (neutral at Size variance = 0).
          let szExtra = max(1.0 + (h1 - 0.5) * P_sizeVar() * 1.4, 0.1);
          let rad = P_size() * 0.4 / scl * depthV * (0.7 + band * P_sizePulse()) * szExtra;
          let stretch = 1.0 + P_streak() * (0.2 + u.driveBeat * 1.0 * u.pulse);
          // EARLY DISTANCE CULL — the real speedup. A particle's glow reaches at
          // most ~2.8 core-radii; beyond that its contribution is under 1% yet
          // was computed anyway. Particles are sparse, so most of the
          // 3x3-times-layers cells stop HERE, before the sqrt / twinkle sin /
          // palette cos / bloom exp that dominate the per-particle cost.
          let reach = rad * stretch * 2.8 + 0.004;
          if (dot(d, d) > reach * reach) { continue; }
          // Streak follows the particle's own drift; light in drift mode so
          // free-floating particles stay mostly point-like, stretching on a beat.
          let vel = normalize(gCur + drift * 0.5 + scatDir * u.driveBeat * 1.4 * u.pulse + vec2f(1e-4, 0.0));
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
          let sPal = cosPalette(1.0 - (P_hue() + hueOff) / 360.0, vec3f(0.5), vec3f(0.5), vec3f(1.0), vec3f(0.0, 0.33, 0.67));
          let lum = (core * 1.4 + bloom) * tw * depthV * (0.55 + band * 0.9) * beatPop;
          let hot = smoothstep(0.6, 1.4, depthV) * P_hotCore() * (0.4 + h1);
          col += mix(sPal, vec3f(1.0), hot * 0.7) * lum * P_brightness();
        }
      }
    }
  }

  col *= vignette(uv, P_vignette());
  col = tonemap(col * 1.2);
  col += grain(uv, 0.012);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
