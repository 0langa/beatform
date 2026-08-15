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
 *
 * Depth wave (Track B, audit RP-24.14): the genre's missing composition
 * elements, all fragment-local and all ABSENT at the defaults so the stock
 * look is pixel-identical to the pre-wave build:
 *  - The road: a perspective strip converging on the grid's own vanishing
 *    point, with neon edge rails and dashed lane markers. It rides the SAME
 *    `scroll` variable as the grid — beat-locked when the grid is, free
 *    otherwise — so preview and export cannot diverge (determinism law).
 *    Off at the default width 0; the whole block is gated.
 *  - Sun banding family: the hardcoded scanline constants became params.
 *    Band count/thickness/shift default to exactly the old 28 / 0.5 / 0
 *    (the widening term stays count x 2.5 = the old 70), and Sun warmth
 *    scales the old +45 degree gradient offset (default 1 = +45).
 *  - City skyline: flat-roofed towers silhouetted at the horizon, seeded per
 *    column from hash21 (pure function of uv — deterministic), with lit
 *    windows that flicker with the treble via the existing u.treble feature
 *    lane. Absent at the default height 0; the block is gated.
 *
 * Canvas2D fallback: there is no per-mode branch there — the fallback draws
 * its single generic bars look and reads only hue/hueSpread/saturation/
 * lightness/barGap/peaks, so every road/skyline/banding param is ignored
 * exactly like the mode's other non-`hue` params (the F1 banner says so).
 *
 * Star twinkle still multiplies raw u.time (audit RP-21): migrating it to a
 * shared noiseClock changes default pixels, so it is deliberately NOT part
 * of this wave — it belongs to a batched hash-input re-bless.
 */
export const synthwave: PresetDef = {
  id: "synthwave",
  name: "Synthwave",
  description:
    "Retro neon grid racing toward a banded sun — optional road, city skyline, mountains and stars. Grid, sun and horizon pulse with the sync source.",
  styles: [
    // Sunset — the defaults — sun, grid and mountains.
    { id: "sunset", name: "Sunset", values: {} },
    // Miami — high horizon, fast dense grid, cyan floor against a pink sun.
    {
      id: "miami",
      name: "Miami",
      values: {
        hue: 322,
        gridHue: 188,
        sunR: 0.32,
        sunRays: 0.3,
        scan: 0.66,
        mountains: 0.2,
        gridGlow: 1.25,
        gridScale: 0.8,
        horizonY: 0.46,
        fog: 0.7,
        speed: 1.2,
        beatPulse: 0.6,
        starDensity: 0.2,
        vignette: 0.35,
      },
    },
    // Midnight Drive — mostly floor, deep fog, sun nearly set — and since the
    // depth wave, an actual road to drive: dim rails vanishing into the haze.
    {
      id: "midnight",
      name: "Midnight Drive",
      values: {
        hue: 232,
        gridHue: 206,
        horizonY: 0.38,
        gridScale: 1.3,
        gridGlow: 0.85,
        sunY: 0.14,
        sunR: 0.18,
        mountains: 0.6,
        fog: 1.2,
        speed: 0.75,
        scan: 0.28,
        starDensity: 0.5,
        react: 0.6,
        beatPulse: 0.3,
        vignette: 0.55,
        roadW: 0.5,
        roadGlow: 0.75,
      },
    },
    // Big Sun — sky-heavy: lowest horizon, biggest sun, rays, coarse grid, no stars.
    {
      id: "bigSun",
      name: "Big Sun",
      values: {
        hue: 8,
        horizonY: 0.6,
        sunR: 0.36,
        sunY: 0.42,
        sunRays: 0.3,
        scan: 0.86,
        mountains: 0.72,
        gridScale: 0.4,
        gridGlow: 0.8,
        stars: 0,
        fog: 0.5,
        speed: 0.6,
        react: 0.7,
        beatPulse: 0.4,
        vignette: 0.4,
      },
    },
    // Hyperdrive — grid lock off at top speed, mountains gone, tiny sun — pure motion.
    {
      id: "hyperdrive",
      name: "Hyperdrive",
      values: {
        hue: 280,
        gridHue: 190,
        speed: 2.6,
        gridScale: 1.7,
        gridGlow: 1.7,
        gridLock: 0,
        sunR: 0.12,
        sunY: 0.1,
        sunRays: 0.9,
        scan: 0.1,
        mountains: 0,
        starDensity: 0.8,
        fog: 0.35,
        horizonY: 0.42,
        react: 1.5,
        beatPulse: 1.1,
        vignette: 0.25,
      },
    },
    // Chrome Dawn — editorial. Pale monochrome, heavy haze, low glow, no stars.
    {
      id: "chrome",
      name: "Chrome Dawn",
      values: {
        hue: 202,
        gridHue: 196,
        sunR: 0.26,
        sunY: 0.24,
        sunRays: 0.14,
        scan: 0.24,
        mountains: 0.32,
        gridGlow: 0.55,
        gridScale: 0.45,
        horizonY: 0.52,
        fog: 1.4,
        speed: 0.5,
        react: 0.4,
        beatPulse: 0.15,
        stars: 0,
        vignette: 0.2,
      },
    },
    // Storm Ridge — mountains at max under a buried sun — the ridge is the subject.
    {
      id: "storm",
      name: "Storm Ridge",
      values: {
        hue: 254,
        gridHue: 282,
        mountains: 1,
        sunY: 0.12,
        sunR: 0.2,
        gridGlow: 0.7,
        gridScale: 0.9,
        scan: 0.5,
        fog: 1.3,
        speed: 1.4,
        beatPulse: 0.95,
        react: 1.2,
        stars: 0,
        vignette: 0.6,
      },
    },
    // Golden Hour — sun pushed off-centre with wide scan bands and a matching warm grid.
    {
      id: "gold",
      name: "Golden Hour",
      values: {
        hue: 14,
        gridHue: 40,
        sunX: -0.52,
        sunR: 0.34,
        sunRays: 0.28,
        scan: 0.8,
        mountains: 0.5,
        gridGlow: 1.15,
        gridScale: 0.6,
        horizonY: 0.54,
        fog: 0.9,
        speed: 0.8,
        starDensity: 0.4,
        beatPulse: 0.35,
        vignette: 0.35,
      },
    },
    // Outrun — the arcade night-drive: wide road, two dashed dividers, hard
    // rails, cyan grid under a magenta sky at speed.
    {
      id: "outrun",
      name: "Outrun",
      values: {
        hue: 305,
        gridHue: 190,
        roadW: 0.62,
        roadLanes: 2,
        roadGlow: 1.45,
        speed: 2,
        gridScale: 1.1,
        gridGlow: 1.2,
        sunR: 0.26,
        sunY: 0.18,
        scan: 0.72,
        scanCount: 24,
        mountains: 0.2,
        starDensity: 0.5,
        fog: 0.75,
        horizonY: 0.46,
        react: 1.1,
        beatPulse: 0.8,
        vignette: 0.4,
      },
    },
    // Neon Metropolis — the city horizon: packed towers with windows working
    // the treble, hills gone, a big sun rising behind the skyline.
    {
      id: "metropolis",
      name: "Neon Metropolis",
      values: {
        hue: 282,
        gridHue: 322,
        skyline: 0.75,
        skyDensity: 0.7,
        windows: 0.8,
        mountains: 0,
        sunR: 0.34,
        sunY: 0.2,
        sunX: 0.22,
        scan: 0.5,
        sunWarm: 0.8,
        speed: 0.85,
        gridScale: 0.8,
        gridGlow: 1.05,
        fog: 1.1,
        starDensity: 0.44,
        react: 0.9,
        beatPulse: 0.55,
        vignette: 0.45,
      },
    },
    // Poster Sun — the record-sleeve classic: a huge warm sun cut by a few
    // thick bands, one dashed road running straight at it, no stars.
    {
      id: "poster",
      name: "Poster Sun",
      values: {
        hue: 12,
        gridHue: 268,
        sunR: 0.4,
        sunY: 0.34,
        scan: 0.96,
        scanCount: 13,
        scanWidth: 0.62,
        sunWarm: 1.6,
        sunRays: 0.2,
        roadW: 0.4,
        roadGlow: 1.1,
        mountains: 0.5,
        speed: 0.65,
        stars: 0,
        fog: 0.6,
        horizonY: 0.55,
        react: 0.6,
        beatPulse: 0.3,
        vignette: 0.35,
      },
    },
    // City Limits — driving into town: four lanes of road running at a
    // low-slung skyline under a thin blue dusk.
    {
      id: "cityLimits",
      name: "City Limits",
      values: {
        hue: 215,
        gridHue: 165,
        roadW: 0.5,
        roadLanes: 3,
        roadGlow: 1.2,
        skyline: 0.55,
        skyDensity: 0.55,
        windows: 0.6,
        mountains: 0.12,
        sunR: 0.22,
        sunY: 0.16,
        scan: 0.4,
        scanCount: 34,
        speed: 1.35,
        gridScale: 0.9,
        fog: 1,
        starDensity: 0.36,
        react: 1,
        beatPulse: 0.65,
        vignette: 0.5,
      },
    },
  ],
  params: [
    {
      key: "hue",
      label: "Sun hue",
      group: "color",
      control: "hue",
      min: 0,
      max: 360,
      step: 1,
      default: 20,
      hint: "Sun / sky color",
    },
    {
      key: "gridHue",
      label: "Grid hue",
      group: "color",
      control: "hue",
      min: 0,
      max: 360,
      step: 1,
      default: 300,
      hint: "Color of the neon floor grid (the road's rails ride it too)",
    },
    {
      key: "speed",
      label: "Speed",
      group: "motion",
      min: 0,
      max: 3,
      step: 0.05,
      default: 1,
      hint: "How fast the grid races toward you",
    },
    {
      key: "react",
      label: "Reactivity",
      group: "reaction",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.8,
      hint: "How much the sync source (Sync panel) pumps the grid + horizon",
    },
    {
      key: "beatPulse",
      label: "Beat pulse",
      group: "reaction",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.5,
      hint: "Grid + horizon flash on each beat of the sync source",
    },
    {
      key: "sunR",
      label: "Sun size",
      group: "shape",
      min: 0.1,
      max: 0.4,
      step: 0.01,
      default: 0.28,
      hint: "Radius of the sun",
    },
    {
      key: "roadW",
      label: "Road",
      group: "shape",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0,
      hint: "Perspective road racing down the grid to the vanishing point — 0 is no road at all",
    },
    {
      key: "skyline",
      label: "Skyline",
      group: "shape",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      hint: "City towers silhouetted on the horizon — sets their height; 0 clears the view",
    },
    {
      key: "mountains",
      label: "Mountains",
      group: "shape",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      hint: "Silhouetted rolling mountains on the horizon (rise with the bass), rim-lit along the ridge",
    },
    {
      key: "gridGlow",
      label: "Grid glow",
      group: "glow",
      min: 0,
      max: 2,
      step: 0.05,
      default: 1,
      hint: "Base brightness of the grid",
    },
    {
      key: "scan",
      label: "Sun bands",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.6,
      hint: "Strength of the dark bands sliced across the sun (the hot core still glows through)",
    },
  ],
  advanced: [
    {
      key: "sunWarm",
      label: "Sun warmth",
      group: "color",
      min: 0,
      max: 2,
      step: 0.05,
      default: 1,
      hint: "How far the top of the sun leans warmer than its base hue — 0 is a flat one-color disc",
    },
    {
      key: "sunY",
      label: "Sun height",
      group: "shape",
      min: 0.1,
      max: 0.45,
      step: 0.01,
      default: 0.3,
      hint: "Vertical position of the sun above the horizon",
    },
    {
      key: "sunX",
      label: "Sun offset",
      group: "shape",
      min: -0.6,
      max: 0.6,
      step: 0.02,
      default: 0,
      hint: "Horizontal position of the sun — 0 is centered, negative moves it left",
    },
    {
      key: "scanCount",
      label: "Band count",
      group: "glow",
      taper: "log",
      mod: "snap",
      min: 8,
      max: 56,
      step: 1,
      default: 28,
      hint: "How many bands slice the sun — fewer reads as a bigger, bolder poster sun",
    },
    {
      key: "scanWidth",
      label: "Band thickness",
      group: "glow",
      min: 0.1,
      max: 0.9,
      step: 0.01,
      default: 0.5,
      hint: "How much of each slice the dark band covers",
    },
    {
      key: "scanPhase",
      label: "Band shift",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      hint: "Slides the band pattern up or down the sun — automate it to make the bands crawl",
    },
    {
      key: "sunRays",
      label: "Sun rays",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0,
      hint: "Rotating rays radiating from the sun",
    },
    {
      key: "roadLanes",
      label: "Lane markers",
      group: "shape",
      control: "enum",
      mod: "snap",
      options: [
        { value: 0, label: "None", hint: "Bare road between the rails" },
        { value: 1, label: "Center dash", hint: "One dashed divider down the middle" },
        { value: 2, label: "Two dashes", hint: "Three lanes of road" },
        { value: 3, label: "Three dashes", hint: "Four lanes of road" },
      ],
      min: 0,
      max: 3,
      step: 1,
      default: 1,
      hint: "Dashed lane dividers on the road — they cross exactly on the beat whenever the grid does (needs a Road)",
    },
    {
      key: "roadGlow",
      label: "Road glow",
      group: "glow",
      min: 0,
      max: 2,
      step: 0.05,
      default: 1,
      hint: "Brightness of the road's neon edge rails and lane dashes (needs a Road)",
    },
    {
      key: "skyDensity",
      label: "Building density",
      group: "shape",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      hint: "How tightly the towers pack the horizon — low is sparse outskirts, high is downtown (needs a Skyline)",
    },
    {
      key: "windows",
      label: "Window lights",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      hint: "Lit windows across the towers, flickering with the treble (needs a Skyline)",
    },
    {
      key: "gridScale",
      label: "Grid density",
      group: "shape",
      taper: "log",
      min: 0.2,
      max: 2,
      step: 0.05,
      default: 0.7,
      hint: "How fine the grid lines are, in both directions",
    },
    {
      key: "horizonY",
      label: "Horizon height",
      group: "shape",
      min: 0.35,
      max: 0.62,
      step: 0.01,
      default: 0.5,
      hint: "Where the horizon line sits — lower raises it for more grid floor, higher drops it for more sky",
    },
    {
      key: "stars",
      label: "Stars",
      group: "backdrop",
      control: "toggle",
      mod: "off",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Starfield in the sky",
    },
    {
      key: "starDensity",
      label: "Star density",
      group: "backdrop",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.3,
      hint: "How many stars fill the sky (needs Stars on)",
    },
    {
      key: "gridLock",
      label: "Beat-locked grid",
      group: "motion",
      control: "toggle",
      mod: "off",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Grid lines cross exactly on the beat (needs the track's beat grid; off = free speed)",
    },
    {
      key: "fog",
      label: "Atmospheric fog",
      group: "backdrop",
      tier: "curated",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.8,
      hint: "Grid fades into haze toward the horizon instead of staying constant brightness",
    },
    {
      key: "vignette",
      label: "Vignette",
      group: "backdrop",
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
  let horizon = P_horizonY();
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
      // x2 before rounding makes each 0.5 of the Speed slider a distinct rate
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

    // --- Road (optional; the block is GATED so the default width 0 renders
    // pixel-identically to the road-less build). World-space x is cx * persp
    // — the same mapping the grid's own verticals use — so the road's edges
    // converge on the grid's exact vanishing point. Lane dashes reuse the
    // grid's scroll variable untouched: beat-locked dashes when the grid
    // is beat-locked, free-running when it isn't, identical in preview and
    // export by construction. Dash frequency is dens * 0.5: 4 beats always
    // advance an integer number of dash cycles, so the pattern stays
    // continuous across the bar wrap exactly like the grid rows.
    if (P_roadW() > 0.004) {
      let halfW = P_roadW() * 0.3;
      let wx = cx * persp;
      let road = smoothstep(halfW, halfW * 0.92, abs(wx));
      // Asphalt: knock the grid down inside the road so it reads as tarmac
      // laid over the wireframe world (a trace of grid ghosts through).
      gridCol *= 1.0 - road * 0.82;
      // Neon edge rails where road meets grid: a crisp world-space line plus
      // a soft halo, both foreshortening naturally with perspective.
      let edgeD = abs(abs(wx) - halfW);
      let edgeW = 0.012 + fy * 0.02;
      let edgeGlow = P_roadGlow() * (0.55 + drive * P_react() * 0.5 + u.bass * 0.25) * pulse;
      var roadCol = hsl2rgb(P_gridHue(), 0.95, 0.62) * smoothstep(edgeW, 0.0, edgeD);
      roadCol += hsl2rgb(P_gridHue(), 0.8, 0.5) * exp(-edgeD * 60.0) * 0.3;
      // Lane markers: up to three dashed dividers spaced evenly across the
      // road, scrolling at the grid's own rate.
      let lanes = P_roadLanes();
      if (lanes > 0.5) {
        let dash = step(0.5, fract((persp - scroll) * dens * 0.5));
        for (var i = 0; i < 3; i++) {
          if (f32(i) > lanes - 0.5) { break; }
          let fi = f32(i) + 1.0;
          let laneD = abs(wx - (-halfW + 2.0 * halfW * fi / (lanes + 1.0)));
          roadCol += vec3f(1.0, 0.95, 0.75) * smoothstep(edgeW * 0.8, 0.0, laneD) * dash * 0.8;
        }
      }
      // The road sits in the same atmosphere as the grid: fog dims it toward
      // the vanishing point, fade lifts it off the horizon line.
      col += roadCol * fade * edgeGlow * mix(1.0, 0.25, clamp(fogAmt, 0.0, 1.0));
    }
    col += gridCol;
  } else {
    // --- Sky.
    // Rolling mountain silhouette rising from the horizon (bass lifts it).
    let hills = fbm(vec2f(uv.x * 3.0 + 4.0, 7.3));
    let mh = (0.25 + hills * 0.6) * P_mountains() * (0.55 + u.bass * 0.9);
    let ridgeTop = horizon - mh * 0.28;
    let mtn = smoothstep(ridgeTop - 0.004, ridgeTop, uv.y);

    // Sun with a vertical gradient + widening scanline gaps.
    // Frame-safety: Sun height is soft-limited against the sky that actually
    // exists above the horizon. Raw, the lowest Horizon (0.35) with the highest
    // Sun height (0.45) put the centre at uv.y = -0.10 — above the top edge,
    // and at a small Sun size the entire disc sat offscreen, so the mode
    // silently lost its subject. Reserving half a radius of sky keeps the disc
    // in frame at every combination; at the defaults this is a ~0.002 shift.
    let sunCy = horizon - softLimit(P_sunY(), max(horizon - P_sunR() * 0.5, 0.02));
    let sunCtr = vec2f(cx - P_sunX(), uv.y - sunCy);
    let sd = length(sunCtr);
    let sunBody = smoothstep(P_sunR(), P_sunR() - 0.008, sd);
    let scanPos = horizon - uv.y;
    // Banding family (depth wave): the pre-wave constants became params with
    // defaults that reproduce them EXACTLY — count 28 (widening term stays
    // count x 2.5 = the old 70), gap duty 1 - 0.5, shift + 0. The device
    // pixel matrix holds this to bit-identity at the defaults.
    let scanGap = P_scan() * step(1.0 - P_scanWidth(),
      fract(scanPos * (P_scanCount() + scanPos * (P_scanCount() * 2.5)) + P_scanPhase()));
    let sunGrad = mix(
      hsl2rgb(P_hue() + 45.0 * P_sunWarm(), 0.95, 0.62),
      hsl2rgb(P_hue(), 0.95, 0.55),
      clamp((uv.y - (sunCy - P_sunR())) / (2.0 * P_sunR()), 0.0, 1.0),
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
      // Density maps to the hash threshold: denser field = lower bar to clear.
      // Brightness normalizes by the remaining headroom so stars stay a
      // consistent brightness regardless of how many are lit.
      let thr = mix(0.985, 0.94, P_starDensity());
      if (h > thr) {
        let sp = vec2f(hash21(cell + 0.37), hash21(cell + 0.71));
        let star = smoothstep(0.13, 0.0, length(gp - cell - sp));
        sky += vec3f(0.9, 0.92, 1.0) * star * (h - thr) / max(1.0 - thr, 0.01) * 0.62
             * (0.5 + 0.5 * sin(u.time * 2.0 + h * 40.0)) * smoothstep(horizon, 0.0, uv.y);
      }
    }
    // --- City skyline (optional; GATED so the default height 0 renders
    // pixel-identically to the skyline-less build). Flat-roofed towers on a
    // per-column hash — a pure function of uv, so preview and export agree
    // by construction. Buildings stand in FRONT of sun, stars and mountains
    // (they darken whatever the sky composed behind them), the genre image.
    var city = 0.0;
    var winGlow = vec3f(0.0);
    if (P_skyline() > 0.004) {
      // Column width in aspect-corrected units: density packs the towers.
      let colW = mix(0.17, 0.05, clamp(P_skyDensity(), 0.0, 1.0));
      let bx = (uv.x * u.aspect) / colW;
      let cell = floor(bx);
      let h1 = hash21(vec2f(cell, 3.7));
      // Some columns sit out entirely: sparse outskirts at low density,
      // near-solid downtown at high.
      let present = step(mix(0.35, 0.06, clamp(P_skyDensity(), 0.0, 1.0)), h1);
      let th = (0.25 + h1 * 0.75) * P_skyline() * 0.2;
      let towerTop = horizon - th;
      // Inset the walls so adjacent towers read as separate buildings.
      let inset = smoothstep(0.03, 0.1, fract(bx)) * smoothstep(0.97, 0.9, fract(bx));
      city = smoothstep(towerTop - 0.003, towerTop, uv.y) * inset * present;
      // Lit windows: a seeded grid inside each tower, flickering with the
      // treble through the existing feature lane (glimmer rides TRACK time).
      if (P_windows() > 0.004) {
        let wp = vec2f(fract(bx) * 4.0, (horizon - uv.y) * 110.0);
        let wcell = floor(wp);
        let wh = hash21(wcell * 0.37 + vec2f(cell * 13.7, cell * 7.1));
        let lit = step(0.62, wh);
        let wdot = smoothstep(0.5, 0.18, abs(fract(wp.x) - 0.5))
                 * smoothstep(0.5, 0.25, abs(fract(wp.y) - 0.5));
        let glimmer = 0.6 + 0.4 * sin(u.time * 3.0 + wh * 43.0);
        winGlow = vec3f(1.0, 0.83, 0.55) * lit * wdot * city * P_windows()
                * glimmer * (0.45 + u.treble * 0.95);
      }
    }
    // Mountains are a dark silhouette over the sky; the city is a darker one
    // over both (city = 0.0 leaves this arithmetic exactly neutral).
    var skyOut = mix(sky, sky * 0.1, mtn);
    skyOut = mix(skyOut, skyOut * 0.05, city);
    col += skyOut + winGlow;
    // Rim light: a thin warm highlight along the ridge, as if backlit by the
    // sun behind it — sells the silhouette as a shape instead of a flat
    // cutout. Towers standing in front of the ridge mask it.
    let ridgeDist = abs(uv.y - ridgeTop);
    col += hsl2rgb(P_hue() + 20.0, 0.85, 0.6) * smoothstep(0.007, 0.0, ridgeDist)
         * (0.5 + drive * 0.4) * P_mountains() * (1.0 - city);
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
