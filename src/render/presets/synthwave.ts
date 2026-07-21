import type { PresetDef } from "../types";

/**
 * Synthwave — a retro perspective grid streaming toward a scanline sun, over
 * rolling mountains and a starfield. The grid, sun glow and horizon all react
 * to the selected sync source; the grid pulses on its beats.
 *
 * Look pass: the floor is an actual dense grid now (both axes ride a real
 * density multiplier — the raw 1/depth mapping only has about 3x dynamic
 * range across the closest two-thirds of the floor, which read as two or
 * three lonely lines), atmospheric fog fades it into haze toward the
 * vanishing point instead of holding constant brightness, the sun gets a
 * genuine hot white core that partially bleeds through its scanline bands,
 * and the mountain ridge catches a thin backlit rim. No mirror/kaleido here
 * — the composition is a single asymmetric horizon + off-center sun, and
 * folding it would break that on purpose-built geometry.
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
      hint: "Silhouetted rolling mountains on the horizon (rise with the bass), rim-lit along the ridge",
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
      hint: "How fine the grid lines are, in both directions",
    },
    {
      key: "scan",
      label: "Sun scanlines",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.6,
      hint: "Strength of the horizontal bands across the sun (the hot core still glows through)",
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
    {
      key: "fog",
      label: "Atmospheric fog",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.8,
      hint: "Grid fades into haze toward the horizon instead of staying constant brightness",
    },
    {
      key: "vignette",
      label: "Vignette",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.3,
      hint: "Darkening toward the screen corners",
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
      // Integer lines-per-beat keeps the scroll continuous across the bar wrap;
      // ×2 before rounding makes each 0.5 of the Speed slider a distinct rate
      // (1..6 lines/beat) instead of round() collapsing the lower half to 1.
      scroll = beatRamp() * max(1.0, round(P_speed() * 2.0));
    }
    // Grid density: a plain 1/depth mapping only has ~3x dynamic range across
    // the CLOSEST two-thirds of the floor (persp goes from 1.0 to 0.32 across
    // that whole span), which is why the old grid read as two or three lonely
    // lines instead of a floor. dens multiplies both axes up to a real
    // density — rounded to an INTEGER so the beat-locked scroll's "integer
    // cells per beat" guarantee above still lands on an integer number of
    // sub-lines too, keeping fract(gz) continuous across the bar wrap.
    let dens = max(1.0, round(P_gridScale() * 9.0));
    let gz = (persp - scroll) * dens;
    let gx = cx * persp * dens;
    let lz = abs(fract(gz) - 0.5);
    let lx = abs(fract(gx) - 0.5);
    let lineW = 0.05 + fy * 0.05;
    let grid = smoothstep(lineW, 0.0, lz) + smoothstep(lineW, 0.0, lx);
    let fade = smoothstep(0.0, 0.06, fy);
    let glow = P_gridGlow() * (0.4 + drive * P_react() + u.bass * 0.3) * pulse;
    var gridCol = hsl2rgb(P_gridHue(), 0.9, 0.55) * grid * fade * glow;

    // Atmospheric fog (IQ): brightness/saturation fall off with the TRUE
    // optical depth (persp, not the density-scaled line coordinate), so the
    // grid recedes into haze approaching the vanishing point instead of
    // holding constant brightness all the way to the horizon — this was the
    // single biggest reason the floor read as flat rather than deep.
    let fogAmt = (1.0 - exp(-persp * 0.22)) * clamp(P_fog(), 0.0, 1.5);
    let fogCol = mix(hsl2rgb(P_gridHue(), 0.5, 0.045), hsl2rgb(P_hue(), 0.55, 0.045), 0.5);
    gridCol = mix(gridCol, fogCol * (grid * 0.7 + 0.3) * fade, clamp(fogAmt, 0.0, 1.0));
    col += gridCol;
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
    // Hot core: a genuinely emissive centre that partially bleeds through the
    // scan bands (real overexposed light does not get fully cut by them) —
    // desaturating toward white and pushing past 1.0 for tonemap() to roll
    // off is what reads as EMITTING rather than merely sun-coloured.
    let core = exp(-sd * sd * (9.0 / max(P_sunR() * P_sunR(), 1e-4)));
    let hot = smoothstep(0.3, 0.85, core) * sunBody;
    sky = mix(sky, vec3f(1.0, 0.97, 0.9), hot * 0.75);
    sky += vec3f(1.0, 0.95, 0.85) * hot * hot * 0.7 * (1.0 - scanGap * 0.6);
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
    // Rim light: a thin warm highlight along the ridge, as if backlit by the
    // sun behind it — sells the silhouette as a shape instead of a flat cutout.
    let ridgeDist = abs(uv.y - ridgeTop);
    col += hsl2rgb(P_hue() + 20.0, 0.85, 0.6) * smoothstep(0.007, 0.0, ridgeDist)
         * (0.5 + drive * 0.4) * P_mountains();
  }
  // Horizon bloom: a tight crisp line plus a wider soft halo, pumped by the
  // sync source — two exp() reaches read as an actual light source instead
  // of a single flat bar.
  let hEdge = abs(uv.y - horizon);
  col += hsl2rgb(P_gridHue(), 0.85, 0.65) * exp(-hEdge * 90.0)
       * (0.5 + u.energy * 0.3 + drive * 0.5) * pulse;
  col += hsl2rgb(P_gridHue(), 0.7, 0.6) * exp(-hEdge * 16.0) * 0.22 * (0.4 + drive * 0.4) * pulse;

  col *= vignette(uv, P_vignette());
  col = tonemap(col * 1.15);
  col += grain(uv, 0.012);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
