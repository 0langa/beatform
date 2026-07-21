import type { PresetDef } from "../types";

/**
 * Particles: a field of individual particles with real per-particle identity
 * — size, hue, "heat" and wander phase are all hashed from a stable per-cell
 * seed and held for the particle's lifetime, never re-rolled per frame. Per
 * docs/VISUAL-DESIGN.md section 4, uniformly-scattered, independently-rolled
 * particles ARE white noise — that is definitionally why the old version read
 * as TV static / phone wallpaper. Fixes applied here, each targeting one named
 * cause:
 *   - continuous per-particle depth (not just 3 discrete layers) drives size
 *     + brightness, so near particles are bigger and brighter, not just
 *     "layer 0 vs layer 2";
 *   - a low-frequency noise field biases the fill probability so particles
 *     clump into loose clusters and open gaps instead of a uniform scatter;
 *   - a shared curl-noise flow field (divergence-free) replaces purely
 *     independent per-particle wander, so neighbors drift as one current
 *     instead of on uncorrelated orbits;
 *   - each particle elongates along its own velocity — bulk drift normally,
 *     its own beat-scatter direction on a hit — cheap motion blur that reads
 *     as a music-reactive streak instead of a static dot;
 *   - a cosine gradient (cosPalette) replaces the old pastel hsl2rgb pick, and
 *     a rare "heat" hash pushes the brightest few particles to a near-white,
 *     over-1.0 core that tonemap() rolls off instead of clipping.
 *
 * Implementation: layered hash-grid; each cell owns one particle that roams
 * inside its neighborhood (3x3 lookup keeps coverage seamless).
 */
export const starfield: PresetDef = {
  id: "starfield",
  name: "Particles",
  description:
    "Individual particles that dance to the music — beats scatter and streak them, bass/mid/treble pulse their sizes.",
  styles: [
    {
      id: "drift",
      name: "Calm Drift",
      values: {
        speed: 0.15,
        beatDance: 0.15,
        sizePulse: 0.4,
        clump: 0.3,
        streak: 0.15,
        hotCore: 0.35,
      },
    },
    { id: "dance", name: "Beat Dance", values: {} },
    {
      id: "warp",
      name: "Warp",
      values: {
        fly: 1,
        speed: 0.5,
        beatDance: 0.6,
        sizePulse: 0.6,
        streak: 0.9,
        hotCore: 0.7,
        clump: 0.4,
      },
    },
    {
      id: "snow",
      name: "Snowfall",
      values: {
        direction: 270,
        speed: 0.2,
        beatDance: 0.1,
        hue: 210,
        sizePulse: 0.3,
        streak: 0.1,
        hotCore: 0.25,
        clump: 0.35,
      },
    },
    {
      id: "rave",
      name: "Rave",
      values: {
        speed: 0.8,
        beatDance: 1,
        sizePulse: 1.6,
        twinkle: 0.8,
        streak: 1.1,
        hotCore: 0.9,
        clump: 0.6,
      },
    },
    {
      id: "deepField",
      name: "Deep Field",
      values: {
        hue: 45,
        density: 20,
        size: 0.08,
        speed: 0.05,
        beatDance: 0.05,
        sizePulse: 0.4,
        wander: 0.2,
        twinkle: 0.7,
        hueVariance: 60,
        glow: 0.2,
        brightness: 0.6,
        clump: 0.7,
        streak: 0.05,
        hotCore: 0.5,
      },
    },
    {
      id: "embers",
      name: "Embers",
      values: {
        hue: 18,
        density: 14,
        size: 0.09,
        speed: 0.35,
        direction: 85,
        beatDance: 0.25,
        wander: 0.8,
        wanderSpeed: 1.2,
        twinkle: 0.6,
        hueVariance: 30,
        glow: 0.5,
        brightness: 1,
        streak: 0.6,
        hotCore: 0.8,
        clump: 0.55,
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
      default: 210,
      hint: "Base particle color",
    },
    {
      key: "density",
      label: "Density",
      min: 4,
      max: 24,
      step: 1,
      default: 10,
      hint: "How many particles fill the screen",
    },
    {
      key: "size",
      label: "Particle size",
      min: 0.05,
      max: 0.4,
      step: 0.01,
      default: 0.15,
      hint: "Base size of each particle",
    },
    {
      key: "speed",
      label: "Motion",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.2,
      hint: "Drift speed — loudness accelerates it smoothly",
    },
    {
      key: "direction",
      label: "Direction",
      min: 0,
      max: 360,
      step: 5,
      default: 90,
      hint: "Drift direction in degrees (90 = up, 270 = down)",
    },
    {
      key: "beatDance",
      label: "Beat dance",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      hint: "Each beat kicks every particle in its own direction",
    },
    {
      key: "sizePulse",
      label: "Size pulse",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.8,
      hint: "Particles grow with their band: bass, mids or treble",
    },
    {
      key: "fly",
      label: "Fly mode",
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      hint: "Particles fly toward you instead of drifting — speed rides the music",
    },
    {
      key: "clump",
      label: "Clumping",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.5,
      hint: "Groups particles into loose clusters and open gaps instead of an even scatter",
    },
    {
      key: "streak",
      label: "Motion streaks",
      min: 0,
      max: 1.5,
      step: 0.02,
      default: 0.5,
      hint: "Stretches particles along their direction of travel — beats stretch them harder",
    },
    {
      key: "hotCore",
      label: "Hot cores",
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
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.6,
      hint: "How much the sync source speeds up the drift",
    },
    {
      key: "wander",
      label: "Wander",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.5,
      hint: "How far particles roam from home, carried partly by a shared drifting current",
    },
    {
      key: "wanderSpeed",
      label: "Wander speed",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.35,
      hint: "How fast the roaming motion is",
    },
    {
      key: "fill",
      label: "Fill",
      min: 0.2,
      max: 1,
      step: 0.02,
      default: 0.7,
      hint: "Fraction of grid cells that contain a particle",
    },
    {
      key: "layers",
      label: "Layers",
      min: 1,
      max: 3,
      step: 1,
      default: 3,
      hint: "Parallax depth layers",
    },
    {
      key: "parallax",
      label: "Parallax",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.5,
      hint: "Speed difference between layers",
    },
    {
      key: "hueVariance",
      label: "Hue variance",
      min: 0,
      max: 180,
      step: 5,
      default: 40,
      hint: "Random per-particle color variation",
    },
    {
      key: "twinkle",
      label: "Twinkle",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.4,
      hint: "Per-particle brightness shimmer",
    },
    {
      key: "glow",
      label: "Glow halo",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.35,
      hint: "Soft halo around the crisp particle core",
    },
    {
      key: "brightness",
      label: "Brightness",
      min: 0.2,
      max: 1.5,
      step: 0.05,
      default: 0.8,
      hint: "Overall particle brightness",
    },
    {
      key: "beatFlash",
      label: "Beat flash",
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.1,
      hint: "Background pulse on beats",
    },
    {
      key: "bgLevel",
      label: "Bg level",
      min: 0,
      max: 0.1,
      step: 0.005,
      default: 0.02,
      hint: "Background wash brightness",
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
      key: "mirror",
      label: "Club mirror",
      min: 1,
      max: 12,
      step: 1,
      default: 1,
      hint: "Fold the field into mirrored wedges around the center — 1 is off, 2 mirrors left/right, higher makes a kaleidoscope",
    },
  ],
  wgsl: /* wgsl */ `
// Divergence-free-ish flow field (Bridson curl noise, cheapened to noise2
// instead of full fbm — this only needs to be smooth, not detailed). Nearby
// samples point in similar directions, so particles drift as a shared current
// instead of each wandering on its own uncorrelated orbit — see
// docs/VISUAL-DESIGN.md section 4 on why independently-rolled fields read as
// noise.
fn curlFlow(p: vec2f) -> vec2f {
  let e = 0.08;
  let dx = (noise2(p + vec2f(e, 0.0)) - noise2(p - vec2f(e, 0.0))) / (2.0 * e);
  let dy = (noise2(p + vec2f(0.0, e)) - noise2(p - vec2f(0.0, e))) / (2.0 * e);
  return vec2f(dy, -dx);
}

fn preset(uv: vec2f) -> vec4f {
  let pBase = centered(uv);

  // Background: a dark cosine-palette tint (stays saturated near black,
  // unlike hsl2rgb walked through a drifting hue) plus a faint warped nebula
  // for ambient depth, breathing with bass. Ambient full-field wash only —
  // no discrete geometry here, so it may safely fill the whole frame.
  // NOTE: the classic cosPalette basis below cycles its rainbow in the
  // OPPOSITE direction from HSL (red still lands at t=0, but t increasing
  // walks red->magenta->blue->cyan->green->yellow->red). "1.0 - hue/360"
  // un-reverses it so the Hue param still tracks its label across the wheel
  // (hue=210 is actually blue, not cyan-green).
  let hueT = 1.0 - P_hue() / 360.0;
  let bgPal = cosPalette(hueT + 0.08, vec3f(0.5), vec3f(0.5), vec3f(1.0), vec3f(0.0, 0.33, 0.67));
  var col = bgPal * P_bgLevel() * (1.0 + u.bass * 0.6);
  let nebT = warpFbm(pBase * 0.55 + u.time * 0.02, 0.7 + u.mid * 1.1);
  let nebPal = cosPalette(nebT * 0.4 + hueT + 0.15, vec3f(0.5), vec3f(0.4), vec3f(1.0, 1.0, 0.8), vec3f(0.1, 0.3, 0.5));
  col += nebPal * nebT * nebT * 0.05 * (0.4 + u.mid * 0.8);
  col += bgPal * u.driveBeat * P_beatFlash() * u.pulse;

  // Speed rides the slow energy envelope; beats add a punchy kick
  let baseSpd = P_speed() * (0.35 + u.drive * P_energyDrive())
              * (1.0 + u.driveBeat * P_beatDance() * 0.8 * u.pulse);
  let ang = radians(P_direction());
  let dirv = vec2f(cos(ang), -sin(ang)); // screen y grows downward; flip so 90deg = up

  let layerCount = i32(P_layers());

  // ---- Fly mode: particles stream toward the viewer ----
  if (P_fly() > 0.5) {
    // Direction steers the vanishing point so the field flies toward a point
    // offset from center (banking). Mirror folds around the TRUE center
    // first, so "Club mirror" reads as a consistent kaleidoscope regardless
    // of banking.
    let pk = kaleido(pBase, P_mirror());
    let pc = pk - dirv * 0.15;
    let rr = length(pc) + 1e-3;
    let aa = atan2(pc.y, pc.x);
    // Every particle in this pixel's angular column shares one flight
    // direction (radially out from the vanishing point) — reused below for
    // the motion-streak elongation instead of recomputed per particle.
    let flightDir = normalize(pc + vec2f(1e-4, 0.0));
    for (var l = 0; l < layerCount; l++) {
      let fl = f32(l);
      let angCells = 40.0 + fl * 24.0 + P_density() * 2.0;
      let z = 0.32 / rr;
      // Per-angular-column speed variation: columns approach at different
      // rates, so the field never reads as one zooming image
      let colH = hash21(vec2f(floor((aa / TAU + 0.5) * angCells), fl * 51.3));
      let spd = baseSpd * (1.0 - P_parallax() * fl * 0.3) * (0.65 + colH * 0.7);
      let q = vec2f((aa / TAU + 0.5) * angCells,
                    z * (P_density() * 0.55) - u.time * spd * 3.0);
      let base = floor(q);
      let f = q - base;
      let cell = base + fl * 93.17;
      let h1 = hash21(cell);
      // Low-frequency field biases fill probability so particles clump into
      // loose clusters/voids instead of an even Poisson-like scatter.
      let clumpN = noise2(base * 0.05 + fl * 6.0 + 40.0);
      let fillP = clamp(mix(P_fill(), P_fill() * (1.7 - 1.4 * clumpN), P_clump()), 0.0, 1.0);
      if (h1 <= fillP) {
        let h2 = hash21(cell + 41.3);
        let h3 = hash21(cell + 77.7);
        let h4 = hash21(cell + 61.11);
        let hDepth = hash21(cell + 21.7);
        let ph = h2 * TAU;
        let flow = curlFlow(base * 0.1 + vec2f(fl * 13.0, 60.0) + u.time * 0.05);
        let wob = (vec2f(sin(u.time * P_wanderSpeed() * (0.5 + h2) + ph),
                         cos(u.time * P_wanderSpeed() * (0.7 + h3) + ph * 1.7)) * 0.4
                  + flow * 0.6) * P_wander() * 0.25;
        let scatDir = normalize(vec2f(h2 - 0.5, h3 - 0.5) + 1e-4);
        let scat = scatDir * u.driveBeat * P_beatDance() * 0.4 * u.pulse;
        let d = f - (vec2f(0.5) + wob + scat);
        var band = u.bass;
        if (h3 < 0.3333) { band = u.mid; }
        else if (h3 < 0.6666) { band = u.treble; }
        // Approaching particles grow toward the screen edge; continuous
        // per-particle depth adds further near=bigger variance on top so
        // depth reads as a gradient, not three discrete steps.
        let depthScale = clamp(rr * 2.4, 0.35, 1.8) * mix(0.6, 1.6, hDepth);
        let s = P_size() * (0.5 + h1) * depthScale * (1.0 + band * P_sizePulse());
        // Two incommensurate frequencies instead of one sine: a single pure
        // sine is perfectly symmetric/periodic and reads as mechanical.
        let twPhase = u.time * (1.3 + h2 * 3.0) + h1 * 40.0;
        let tw = 1.0 - P_twinkle() * (0.5 + 0.35 * sin(twPhase) + 0.15 * sin(twPhase * 1.618 + h3 * 6.0));

        // Elongate along velocity (flight direction, kicked toward this
        // particle's own scatter direction on a beat) for cheap motion blur —
        // an anisotropic distance metric instead of an isotropic gaussian.
        let vel = normalize(flightDir + scatDir * u.driveBeat * 1.6 * u.pulse + flow * 0.4);
        let perp = vec2f(-vel.y, vel.x);
        let stretch = 1.0 + P_streak() * (0.6 + u.driveBeat * 1.8 * u.pulse);
        let dl = dot(d, vel);
        let dp = dot(d, perp);
        let dist = sqrt((dl * dl) / (stretch * stretch) + dp * dp);
        let core = smoothstep(s * 0.38, s * 0.16, dist);
        let halo = exp(-dist * dist / max(s * s * 0.5, 1e-5)) * P_glow() * 0.45;
        let fade = smoothstep(0.03, 0.18, rr); // don't pile up at the center
        // Rare "heat" hash (independent of size/band) pushes a small subset
        // of particles to a near-white, over-1.0 core — tonemap() rolls that
        // off later instead of a hard per-channel clip.
        let heat = smoothstep(0.78, 0.99, h4) * P_hotCore();
        let depthBright = mix(0.45, 1.3, hDepth);
        var pcol = cosPalette(fract(hueT + (h2 - 0.5) * P_hueVariance() / 180.0),
                               vec3f(0.5), vec3f(0.5), vec3f(1.0), vec3f(0.0, 0.33, 0.67));
        pcol = mix(pcol, vec3f(1.0), heat);
        let inten = P_brightness() * fade * depthBright * tw * (1.0 + heat * 1.8);
        col += pcol * core * inten;
        col += pcol * halo * inten * 0.9;
      }
    }
    col *= vignette(uv, P_vignette());
    col = tonemap(col * 1.2);
    col += grain(uv, 0.012);
    return vec4f(max(col, vec3f(0.0)), 1.0);
  }

  let p = kaleido(pBase, P_mirror());

  for (var l = 0; l < layerCount; l++) {
    let fl = f32(l);
    let layerScale = 1.0 - fl * 0.22;                        // far layers smaller/dimmer
    let spd = baseSpd * (1.0 - P_parallax() * fl * 0.35);    // parallax speed spread
    let n = P_density() * (1.0 + fl * 0.4);

    let q = p * n - dirv * u.time * spd * n * 0.12;
    let base = floor(q);
    let f = q - base;

    // 3x3 neighborhood: particles may roam outside their own cell
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let cellXY = base + vec2f(f32(dx), f32(dy));
        let cell = cellXY + fl * 93.17;
        let h1 = hash21(cell);
        // Low-frequency field biases fill probability so particles clump
        // into loose clusters/voids instead of an even Poisson-like scatter —
        // uniform density is exactly what reads as "wallpaper".
        let clumpN = noise2(cellXY * 0.045 + fl * 6.0 + 40.0);
        let fillP = clamp(mix(P_fill(), P_fill() * (1.7 - 1.4 * clumpN), P_clump()), 0.0, 1.0);
        if (h1 > fillP) { continue; }
        let h2 = hash21(cell + 41.3);
        let h3 = hash21(cell + 77.7);
        let h4 = hash21(cell + 61.11);
        let hDepth = hash21(cell + 21.7);

        // Home position + smooth per-particle wander, blended with a shared
        // curl-noise current so neighboring particles drift coherently
        // instead of each wandering on an uncorrelated orbit.
        let ph = h2 * TAU;
        let flow = curlFlow(cellXY * 0.12 + vec2f(fl * 17.0, 90.0) + u.time * 0.045);
        let wob = (vec2f(sin(u.time * P_wanderSpeed() * (0.5 + h2) + ph),
                         cos(u.time * P_wanderSpeed() * (0.7 + h3) + ph * 1.7)) * 0.4
                  + flow * 0.6) * P_wander() * 0.35;

        // Beat scatter: every particle kicks along its own direction
        let scatDir = normalize(vec2f(h2 - 0.5, h3 - 0.5) + 1e-4);
        let scat = scatDir * u.driveBeat * P_beatDance() * 0.6 * u.pulse;

        let pos = vec2f(f32(dx), f32(dy)) + 0.5 + wob + scat;
        let d = f - pos;

        // Band assignment -> size pulse (bass / mid / treble round-robin)
        var band = u.bass;
        if (h3 < 0.3333) { band = u.mid; }
        else if (h3 < 0.6666) { band = u.treble; }
        // Continuous per-particle depth (not just the 3 discrete layers)
        // drives size, so near/far reads as a gradient of individuals.
        let depthScale = mix(0.6, 1.6, hDepth);
        let s = P_size() * (0.5 + h1) * layerScale * depthScale * (1.0 + band * P_sizePulse());

        // Two incommensurate frequencies instead of one sine — a lone sine is
        // perfectly symmetric/periodic and reads as mechanical twinkling.
        let twPhase = u.time * (1.3 + h2 * 3.0) + h1 * 40.0;
        let tw = 1.0 - P_twinkle() * (0.5 + 0.35 * sin(twPhase) + 0.15 * sin(twPhase * 1.618 + h3 * 6.0));

        // Elongate along velocity — bulk drift normally, kicked toward this
        // particle's own scatter direction on a beat — for cheap motion blur.
        let vel = normalize(dirv * 0.6 + scatDir * u.driveBeat * 1.6 * u.pulse + flow * 0.5 + vec2f(1e-4, 0.0));
        let perp = vec2f(-vel.y, vel.x);
        let stretch = 1.0 + P_streak() * (0.5 + u.driveBeat * 1.8 * u.pulse);
        let dl = dot(d, vel);
        let dp = dot(d, perp);
        let dist = sqrt((dl * dl) / (stretch * stretch) + dp * dp);

        // Crisp core with a hard edge, plus an optional soft halo — a pure
        // gaussian reads as out-of-focus blur.
        let core = smoothstep(s * 0.38, s * 0.16, dist);
        let halo = exp(-dist * dist / max(s * s * 0.5, 1e-5)) * P_glow() * 0.45;
        // Rare "heat" hash (independent of size/band) pushes a small subset
        // of particles to a near-white, over-1.0 core — the difference
        // between "light-colored" and actually emitting.
        let heat = smoothstep(0.78, 0.99, h4) * P_hotCore();
        let depthBright = mix(0.5, 1.3, hDepth);
        var pcol = cosPalette(fract(hueT + (h2 - 0.5) * P_hueVariance() / 180.0),
                               vec3f(0.5), vec3f(0.5), vec3f(1.0), vec3f(0.0, 0.33, 0.67));
        pcol = mix(pcol, vec3f(1.0), heat);
        let inten = P_brightness() * layerScale * depthBright * tw * (1.0 + heat * 1.8);
        col += pcol * core * inten;
        col += pcol * halo * inten * 0.9;
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
