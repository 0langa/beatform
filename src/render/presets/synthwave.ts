import type { PresetDef } from "../types";

/**
 * Synthwave — a retro perspective grid streaming toward a scanline sun, over
 * rolling mountains and a starfield. The grid, sun glow and horizon all react
 * to the selected sync source; the grid pulses on its beats.
 */
export const synthwave: PresetDef = {
  id: "synthwave",
  name: "Synthwave",
  description:
    "Retro neon grid racing toward a scanline sun over mountains and stars — grid and horizon pulse with the sync source.",
  styles: [
    { id: "sunset", name: "Sunset", values: {} },
    { id: "miami", name: "Miami", values: { hue: 320, gridHue: 190 } },
    {
      id: "toxic",
      name: "Toxic",
      values: { hue: 90, gridHue: 140, speed: 2, beatPulse: 0.7, mountains: 0.5 },
    },
    {
      id: "vapor",
      name: "Vapor",
      values: { hue: 285, gridHue: 300, sunR: 0.34, speed: 0.5, sunRays: 0.5, gridLock: 0 },
    },
    {
      id: "outrun",
      name: "Outrun",
      values: { hue: 12, gridHue: 285, mountains: 0.6, stars: 1, react: 1.2, beatPulse: 0.8 },
    },
    {
      id: "midnight",
      name: "Midnight Drive",
      values: {
        hue: 230,
        gridHue: 205,
        sunY: 0.2,
        sunR: 0.22,
        mountains: 0.55,
        speed: 0.7,
        gridGlow: 0.8,
        scan: 0.3,
      },
    },
    {
      id: "gold",
      name: "Golden Hour",
      values: {
        hue: 42,
        gridHue: 35,
        sunR: 0.36,
        sunRays: 0.65,
        scan: 0.85,
        mountains: 0.45,
        gridGlow: 1.2,
        beatPulse: 0.35,
      },
    },
  ],
  params: [
    {
      key: "hue",
      label: "Sun hue",
      min: 0,
      max: 360,
      step: 1,
      default: 20,
      hint: "Sun / sky color",
    },
    {
      key: "gridHue",
      label: "Grid hue",
      min: 0,
      max: 360,
      step: 1,
      default: 300,
      hint: "Color of the neon floor grid",
    },
    {
      key: "speed",
      label: "Speed",
      min: 0,
      max: 3,
      step: 0.05,
      default: 1,
      hint: "How fast the grid races toward you",
    },
    {
      key: "react",
      label: "Reactivity",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.8,
      hint: "How much the sync source (Sync panel) pumps the grid + horizon",
    },
    {
      key: "sunR",
      label: "Sun size",
      min: 0.1,
      max: 0.4,
      step: 0.01,
      default: 0.28,
      hint: "Radius of the sun",
    },
    {
      key: "gridGlow",
      label: "Grid glow",
      min: 0,
      max: 2,
      step: 0.05,
      default: 1,
      hint: "Base brightness of the grid",
    },
  ],
  advanced: [
    {
      key: "beatPulse",
      label: "Beat pulse",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.5,
      hint: "Grid + horizon flash on each beat of the sync source",
    },
    {
      key: "mountains",
      label: "Mountains",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.35,
      hint: "Silhouetted rolling mountains on the horizon (rise with the bass)",
    },
    {
      key: "stars",
      label: "Stars",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Starfield in the sky",
    },
    {
      key: "sunRays",
      label: "Sun rays",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0,
      hint: "Rotating rays radiating from the sun",
    },
    {
      key: "sunY",
      label: "Sun height",
      min: 0.1,
      max: 0.45,
      step: 0.01,
      default: 0.3,
      hint: "Vertical position of the sun above the horizon",
    },
    {
      key: "gridScale",
      label: "Grid density",
      min: 0.2,
      max: 2,
      step: 0.05,
      default: 0.7,
      hint: "How fine the grid columns are",
    },
    {
      key: "scan",
      label: "Sun scanlines",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.6,
      hint: "Strength of the horizontal bands across the sun",
    },
    {
      key: "gridLock",
      label: "Beat-locked grid",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Grid lines cross exactly on the beat (needs the track's beat grid; off = free speed)",
    },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  var col = vec3f(0.0);
  let cx = (uv.x - 0.5) * u.aspect;
  let horizon = 0.5;
  let drive = clamp(u.drive, 0.0, 1.5);
  // Pump on the tempo grid when the track has one (gridPulse falls back to
  // the flux pulse when it doesn't); flux onsets still add on top via max.
  let pulse = 1.0 + max(u.driveBeat, gridPulse(6.0)) * P_beatPulse() * u.pulse;

  if (uv.y > horizon) {
    // --- Floor: perspective grid receding to the horizon.
    let fy = uv.y - horizon;                 // 0 at horizon .. 0.5 at bottom
    let persp = 0.16 / max(fy, 0.004);
    // Beat-locked scroll: exactly round(speed) grid lines cross per beat,
    // riding the real beat grid (rubato and all). Continuous across the bar
    // wrap because 4 beats always advance an integer number of cells. Falls
    // back to free time-scroll when the track has no grid (u.bpm == 0) —
    // at 120 BPM both modes move at the same average rate.
    var scroll = u.time * P_speed() * 2.0;
    if (P_gridLock() > 0.5 && u.bpm > 0.5) {
      scroll = beatRamp() * max(1.0, round(P_speed()));
    }
    let gz = persp - scroll;
    let gx = cx * persp * P_gridScale();
    let lz = abs(fract(gz) - 0.5);
    let lx = abs(fract(gx) - 0.5);
    let lineW = 0.035 + fy * 0.12;
    let grid = smoothstep(lineW, 0.0, lz) + smoothstep(lineW, 0.0, lx);
    let fade = smoothstep(0.0, 0.12, fy);
    let glow = P_gridGlow() * (0.4 + drive * P_react() + u.bass * 0.3) * pulse;
    col += hsl2rgb(P_gridHue(), 0.9, 0.55) * grid * fade * glow;
  } else {
    // --- Sky.
    // Rolling mountain silhouette rising from the horizon (bass lifts it).
    let hills = fbm(vec2f(uv.x * 3.0 + 4.0, 7.3));
    let mh = (0.25 + hills * 0.6) * P_mountains() * (0.55 + u.bass * 0.9);
    let ridgeTop = horizon - mh * 0.28;
    let mtn = smoothstep(ridgeTop - 0.004, ridgeTop, uv.y);

    // Sun with a vertical gradient + widening scanline gaps.
    let sunCtr = vec2f(cx, uv.y - (horizon - P_sunY()));
    let sd = length(sunCtr);
    let sunBody = smoothstep(P_sunR(), P_sunR() - 0.008, sd);
    let scanPos = horizon - uv.y;
    let scanGap = P_scan() * step(0.5, fract(scanPos * (28.0 + scanPos * 70.0)));
    let sunGrad = mix(
      hsl2rgb(P_hue() + 45.0, 0.95, 0.62),
      hsl2rgb(P_hue(), 0.95, 0.55),
      clamp((uv.y - (horizon - P_sunY() - P_sunR())) / (2.0 * P_sunR()), 0.0, 1.0),
    );
    var sky = sunGrad * sunBody * (1.0 - scanGap);
    sky += hsl2rgb(P_hue() + 30.0, 0.8, 0.45) * smoothstep(P_sunR() * 2.3, 0.0, sd) * (0.35 + drive * 0.35);
    // Rotating sun rays (optional).
    if (P_sunRays() > 0.01) {
      let ang = atan2(sunCtr.y, sunCtr.x);
      let rays = 0.5 + 0.5 * sin(ang * 16.0 + u.time * 0.6);
      sky += hsl2rgb(P_hue() + 40.0, 0.9, 0.5) * rays
           * smoothstep(P_sunR() * 3.2, P_sunR(), sd) * P_sunRays() * (0.4 + drive * 0.6);
    }
    // Sky gradient darkening upward.
    sky += hsl2rgb(P_hue() + 60.0, 0.6, 0.12) * (horizon - uv.y) * 1.2;
    // Stars (small round points behind the sun, above the mountains).
    if (P_stars() > 0.5) {
      let gp = vec2f(uv.x * u.aspect, uv.y) * 60.0;
      let cell = floor(gp);
      let h = hash21(cell);
      if (h > 0.972) {
        let sp = vec2f(hash21(cell + 0.37), hash21(cell + 0.71));
        let star = smoothstep(0.13, 0.0, length(gp - cell - sp));
        sky += vec3f(0.9, 0.92, 1.0) * star * (h - 0.972) * 22.0
             * (0.5 + 0.5 * sin(u.time * 2.0 + h * 40.0)) * smoothstep(horizon, 0.0, uv.y);
      }
    }
    // Mountains are a dark silhouette over the sky.
    col += mix(sky, sky * 0.1, mtn);
  }
  // Horizon bloom line, pumped by the sync source.
  col += hsl2rgb(P_gridHue(), 0.8, 0.6) * exp(-abs(uv.y - horizon) * 55.0)
       * (0.4 + u.energy * 0.3 + drive * 0.5) * pulse;
  return vec4f(col, 1.0);
}
`,
};
