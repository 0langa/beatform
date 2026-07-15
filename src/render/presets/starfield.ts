import type { PresetDef } from "../types";

/**
 * Particles: a field of individual particles, each with its own wander path,
 * its own beat-scatter direction and a band assignment (bass/mid/treble)
 * that pulses its size. Three parallax layers drift along a configurable
 * direction at energy-driven speed — no shared depth coordinate, so motion
 * reads as many independent particles, not a zooming still.
 *
 * Implementation: layered hash-grid; each cell owns one particle that roams
 * inside its neighborhood (3x3 lookup keeps coverage seamless).
 */
export const starfield: PresetDef = {
  id: "starfield",
  name: "Particles",
  description:
    "Individual particles that dance to the music — beats scatter them, bass/mid/treble pulse their sizes.",
  styles: [
    { id: "drift", name: "Calm Drift", values: { speed: 0.15, beatDance: 0.15, sizePulse: 0.4 } },
    { id: "dance", name: "Beat Dance", values: {} },
    { id: "warp", name: "Warp", values: { fly: 1, speed: 0.5, beatDance: 0.6, sizePulse: 0.6 } },
    {
      id: "snow",
      name: "Snowfall",
      values: { direction: 270, speed: 0.2, beatDance: 0.1, hue: 210, sizePulse: 0.3 },
    },
    {
      id: "rave",
      name: "Rave",
      values: { speed: 0.8, beatDance: 1, sizePulse: 1.6, twinkle: 0.8 },
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
      hint: "How far particles roam around their home position",
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
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  let p = vec2f(uv.x * u.aspect, uv.y);
  let r = distance(uv, vec2f(0.5));

  // Background wash + beat pulse
  var col = hsl2rgb(P_hue() + 30.0, 0.5, P_bgLevel()) * (1.0 + u.bass * 0.5);
  col += hsl2rgb(P_hue(), 0.7, 0.4) * u.driveBeat * P_beatFlash();

  // Speed rides the slow energy envelope; beats add a punchy kick
  let baseSpd = P_speed() * (0.35 + u.drive * P_energyDrive())
              * (1.0 + u.driveBeat * P_beatDance() * 0.8 * u.pulse);
  let ang = radians(P_direction());
  let dirv = vec2f(cos(ang), -sin(ang)); // screen y grows downward; flip so 90deg = up

  let layerCount = i32(P_layers());

  // ---- Fly mode: particles stream toward the viewer ----
  if (P_fly() > 0.5) {
    let pc = vec2f((uv.x - 0.5) * u.aspect, uv.y - 0.5);
    let rr = length(pc) + 1e-3;
    let aa = atan2(pc.y, pc.x);
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
      let h1 = hash21(base + fl * 93.17);
      if (h1 <= P_fill()) {
        let h2 = hash21(base + fl * 93.17 + 41.3);
        let h3 = hash21(base + fl * 93.17 + 77.7);
        let ph = h2 * TAU;
        let wob = vec2f(
          sin(u.time * P_wanderSpeed() * (0.5 + h2) + ph),
          cos(u.time * P_wanderSpeed() * (0.7 + h3) + ph * 1.7),
        ) * P_wander() * 0.25;
        let scat = normalize(vec2f(h2 - 0.5, h3 - 0.5) + 1e-4)
                 * u.driveBeat * P_beatDance() * 0.4 * u.pulse;
        let d = f - (vec2f(0.5) + wob + scat);
        var band = u.bass;
        if (h3 < 0.3333) { band = u.mid; }
        else if (h3 < 0.6666) { band = u.treble; }
        // Approaching particles grow toward the screen edge
        let depthScale = clamp(rr * 2.4, 0.35, 1.8);
        let s = P_size() * (0.5 + h1) * depthScale * (1.0 + band * P_sizePulse());
        let tw = 1.0 - P_twinkle() * (0.5 + 0.5 * sin(u.time * (2.0 + h2 * 9.0) + h1 * 40.0));
        let dist = length(d);
        let core = smoothstep(s * 0.38, s * 0.16, dist);
        let halo = exp(-dot(d, d) / max(s * s * 0.5, 1e-5)) * P_glow() * 0.45;
        let fade = smoothstep(0.03, 0.18, rr); // don't pile up at the center
        let pHue = P_hue() + (h2 - 0.5) * P_hueVariance() * 2.0;
        col += hsl2rgb(pHue, 0.6, 0.82) * core * tw * P_brightness() * fade;
        col += hsl2rgb(pHue, 0.7, 0.55) * halo * tw * P_brightness() * fade;
      }
    }
    col *= 1.0 - r * r * P_vignette();
    return vec4f(col, 1.0);
  }

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
        let cell = base + vec2f(f32(dx), f32(dy));
        let h1 = hash21(cell + fl * 93.17);
        if (h1 > P_fill()) { continue; }
        let h2 = hash21(cell + fl * 93.17 + 41.3);
        let h3 = hash21(cell + fl * 93.17 + 77.7);

        // Home position + smooth per-particle wander
        let ph = h2 * TAU;
        let wob = vec2f(
          sin(u.time * P_wanderSpeed() * (0.5 + h2) + ph),
          cos(u.time * P_wanderSpeed() * (0.7 + h3) + ph * 1.7),
        ) * P_wander() * 0.35;

        // Beat scatter: every particle kicks along its own direction
        let scatDir = normalize(vec2f(h2 - 0.5, h3 - 0.5) + 1e-4);
        let scat = scatDir * u.driveBeat * P_beatDance() * 0.6 * u.pulse;

        let pos = vec2f(f32(dx), f32(dy)) + 0.5 + wob + scat;
        let d = f - pos;

        // Band assignment -> size pulse (bass / mid / treble round-robin)
        var band = u.bass;
        if (h3 < 0.3333) { band = u.mid; }
        else if (h3 < 0.6666) { band = u.treble; }
        let s = P_size() * (0.5 + h1) * layerScale * (1.0 + band * P_sizePulse());

        let tw = 1.0 - P_twinkle() * (0.5 + 0.5 * sin(u.time * (2.0 + h2 * 9.0) + h1 * 40.0));
        let dist = length(d);
        // Crisp core with a hard edge, plus an optional soft halo — a pure
        // gaussian reads as out-of-focus blur.
        let core = smoothstep(s * 0.38, s * 0.16, dist);
        let halo = exp(-dot(d, d) / max(s * s * 0.5, 1e-5)) * P_glow() * 0.45;
        let pHue = P_hue() + (h2 - 0.5) * P_hueVariance() * 2.0;
        col += hsl2rgb(pHue, 0.6, 0.82) * core * tw * P_brightness() * layerScale;
        col += hsl2rgb(pHue, 0.7, 0.55) * halo * tw * P_brightness() * layerScale;
      }
    }
  }

  col *= 1.0 - r * r * P_vignette();
  return vec4f(col, 1.0);
}
`,
};
