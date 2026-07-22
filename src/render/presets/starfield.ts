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
      default: 14,
      hint: "How many particles fill the screen",
    },
    {
      key: "size",
      label: "Particle size",
      min: 0.05,
      max: 0.4,
      step: 0.01,
      default: 0.11,
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
      default: 0.7,
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

  let energy = P_speed() * (0.4 + u.drive * P_energyDrive());

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
      let rate = energy * (1.0 - P_parallax() * fract(fs * 0.37) * 0.45)
               * (1.0 + u.driveBeat * P_beatDance() * 0.8 * u.pulse);
      let phase = fract(fs * 0.6180339887 + u.time * rate * 0.28);
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
          if (h4 < 0.3333) { band = u.mid; } else if (h4 < 0.6666) { band = u.treble; }
          // Small, crisp point; capped so a near star becomes a thin STREAK
          // flying past rather than a fat soft blob.
          let rad = min(P_size() * (0.3 + h1) / (Z * gs) * (1.0 + band * P_sizePulse()), 0.05);
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
          let hueOff = (h3 - 0.5) * P_hueVariance();
          let sPal = cosPalette(1.0 - (P_hue() + hueOff) / 360.0, vec3f(0.5), vec3f(0.5), vec3f(1.0), vec3f(0.0, 0.33, 0.67));
          let lum = (core * 1.6 + halo) * fade * tw * (0.5 + band * 0.9);
          let hot = smoothstep(0.26, 0.06, Z) * P_hotCore() * (0.4 + h1);
          col += mix(sPal, vec3f(1.0), hot * 0.7) * lum * P_brightness();
        }
      }
    }
    } else {
    // ---- DRIFT MODE: independent particles drifting on a shared current ----
    let baseSpd = energy * (1.0 + u.driveBeat * P_beatDance() * 0.8 * u.pulse);
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
      let q = p * scl - flow * u.time;
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
          if (h4 < 0.3333) { band = u.mid; } else if (h4 < 0.6666) { band = u.treble; }
          let depthV = mix(0.5, 1.4, h1);
          let rad = P_size() * 0.4 / scl * depthV * (0.7 + band * P_sizePulse());
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
          let hueOff = (h3 - 0.5) * P_hueVariance();
          let sPal = cosPalette(1.0 - (P_hue() + hueOff) / 360.0, vec3f(0.5), vec3f(0.5), vec3f(1.0), vec3f(0.0, 0.33, 0.67));
          let lum = (core * 1.4 + bloom) * tw * depthV * (0.55 + band * 0.9);
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
