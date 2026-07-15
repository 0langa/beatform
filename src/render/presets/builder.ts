import type { PresetDef } from "../types";

/**
 * Builder: compose your own visualization. Six independent layers, each
 * toggleable and individually shaped in Advanced. All layers share the hue
 * scheme and composite additively over the background, so any combination
 * reads as one coherent visual.
 */
export const builder: PresetDef = {
  id: "builder",
  name: "Builder",
  description:
    "Build your own mode: toggle layers on/off, shape each in Advanced, tweak until it's yours.",
  styles: [
    { id: "barsWave", name: "Bars + Wave", values: {} },
    {
      id: "orbit",
      name: "Orbit",
      values: { bars: 0, waveLine: 0, radial: 1, orb: 1, waveCircle: 1, hue: 285 },
    },
    {
      id: "cosmos",
      name: "Cosmos",
      values: { bars: 0, waveLine: 0, stars: 1, orb: 1, hue: 250, bgGlow: 0.5 },
    },
    {
      id: "line",
      name: "Minimal Line",
      values: { bars: 0, waveLine: 1, hueSpread: 0, bgGlow: 0.12, lineGlow: 0.7 },
    },
    {
      id: "pulse",
      name: "Pulse Chamber",
      values: {
        bars: 0,
        waveLine: 0,
        rings: 1,
        radial: 1,
        orb: 1,
        hue: 330,
        hueSpread: 60,
        beatFlash: 0.22,
        orbSize: 0.11,
        radialR: 0.26,
      },
    },
    {
      id: "nightclub",
      name: "Nightclub",
      values: {
        rings: 1,
        stars: 1,
        hue: 200,
        hueSpread: 130,
        beatFlash: 0.3,
        barsGlow: 0.7,
        bgGlow: 0.45,
        starStreak: 0.8,
      },
    },
    {
      id: "solarCore",
      name: "Solar Core",
      values: {
        bars: 0,
        waveLine: 0,
        orb: 1,
        waveCircle: 1,
        rings: 1,
        hue: 40,
        hueSpread: 30,
        orbBeat: 0.4,
        ringEnd: 0.7,
        circleR: 0.34,
        bgGlow: 0.25,
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
      hint: "Base color shared by all layers",
    },
    {
      key: "hueSpread",
      label: "Hue spread",
      min: 0,
      max: 240,
      step: 1,
      default: 90,
      hint: "Color range across each layer — 0 = single color",
    },
    {
      key: "bgGlow",
      label: "Background",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      hint: "Radial background wash brightness",
    },
    {
      key: "beatFlash",
      label: "Beat flash",
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.15,
      hint: "Background pulse on every beat",
    },
    {
      key: "bars",
      label: "Layer: Bars",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Spectrum bars along the bottom",
    },
    {
      key: "radial",
      label: "Layer: Radial",
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      hint: "Circular spectrum ring around the center",
    },
    {
      key: "waveLine",
      label: "Layer: Wave line",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Horizontal oscilloscope trace",
    },
    {
      key: "waveCircle",
      label: "Layer: Wave circle",
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      hint: "Waveform bent into a circle",
    },
    {
      key: "orb",
      label: "Layer: Orb",
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      hint: "Breathing core that follows the track's energy",
    },
    {
      key: "stars",
      label: "Layer: Stars",
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      hint: "Drifting starfield behind everything",
    },
    {
      key: "rings",
      label: "Layer: Pulse rings",
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      hint: "A ring launches from the center on every beat and rides the tempo grid",
    },
  ],
  advanced: [
    {
      key: "barsHeight",
      label: "Bars: height",
      min: 0.1,
      max: 1,
      step: 0.01,
      default: 0.5,
      hint: "Maximum bar height",
    },
    {
      key: "barsGap",
      label: "Bars: gap",
      min: 0,
      max: 0.6,
      step: 0.01,
      default: 0.25,
      hint: "Space between bars",
    },
    {
      key: "barsGlow",
      label: "Bars: glow",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.4,
      hint: "Light bleeding from bar tips",
    },
    {
      key: "barsPeaks",
      label: "Bars: peaks",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Peak-hold caps on the bars",
    },
    {
      key: "radialR",
      label: "Radial: radius",
      min: 0.1,
      max: 0.4,
      step: 0.005,
      default: 0.22,
      hint: "Where the ring sits",
    },
    {
      key: "radialLen",
      label: "Radial: length",
      min: 0.05,
      max: 0.5,
      step: 0.01,
      default: 0.25,
      hint: "Outward reach of the ring bars",
    },
    {
      key: "radialSym",
      label: "Radial: symmetry",
      min: 1,
      max: 8,
      step: 1,
      default: 2,
      hint: "Spectrum repeats around the circle",
    },
    {
      key: "lineY",
      label: "Line: position",
      min: 0.15,
      max: 0.85,
      step: 0.01,
      default: 0.5,
      hint: "Vertical position of the trace",
    },
    {
      key: "lineAmp",
      label: "Line: height",
      min: 0.05,
      max: 0.5,
      step: 0.01,
      default: 0.25,
      hint: "Wave height of the trace",
    },
    {
      key: "lineGlow",
      label: "Line: glow",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      hint: "Neon halo around the trace",
    },
    {
      key: "circleR",
      label: "Circle: radius",
      min: 0.1,
      max: 0.45,
      step: 0.005,
      default: 0.3,
      hint: "Radius of the waveform circle",
    },
    {
      key: "circleAmp",
      label: "Circle: wave",
      min: 0,
      max: 0.15,
      step: 0.005,
      default: 0.05,
      hint: "How much the waveform bends the circle",
    },
    {
      key: "orbSize",
      label: "Orb: size",
      min: 0.05,
      max: 0.3,
      step: 0.005,
      default: 0.14,
      hint: "Resting orb size",
    },
    {
      key: "orbPump",
      label: "Orb: pump",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.5,
      hint: "Orb growth with track energy",
    },
    {
      key: "orbWobble",
      label: "Orb: wobble",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.4,
      hint: "Organic edge undulation",
    },
    {
      key: "starDensity",
      label: "Stars: density",
      min: 2,
      max: 14,
      step: 0.5,
      default: 6,
      hint: "How many stars",
    },
    {
      key: "starSpeed",
      label: "Stars: speed",
      min: 0.02,
      max: 1.2,
      step: 0.02,
      default: 0.3,
      hint: "Base drift speed (energy accelerates it)",
    },
    {
      key: "starStreak",
      label: "Stars: scatter",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.4,
      hint: "Each beat kicks particles in their own direction",
    },
    {
      key: "ringStart",
      label: "Rings: launch radius",
      min: 0.02,
      max: 0.4,
      step: 0.01,
      default: 0.1,
      hint: "Where each pulse ring is born",
    },
    {
      key: "ringEnd",
      label: "Rings: reach",
      min: 0.3,
      max: 1.2,
      step: 0.02,
      default: 0.85,
      hint: "How far a ring travels before the next beat",
    },
    {
      key: "ringSharp",
      label: "Rings: sharpness",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.5,
      hint: "Thin crisp rings vs wide soft waves",
    },
    {
      key: "ringBright",
      label: "Rings: brightness",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.8,
      hint: "Intensity of the pulse rings",
    },
    {
      key: "orbBeat",
      label: "Orb: beat kick",
      min: 0,
      max: 0.6,
      step: 0.02,
      default: 0.25,
      hint: "Extra orb swell on each beat (tempo-locked when the track has a grid)",
    },
    {
      key: "vignette",
      label: "Vignette",
      min: 0,
      max: 1.2,
      step: 0.05,
      default: 0.5,
      hint: "Darkening toward the screen corners",
    },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  let p = centered(uv);
  let r = length(p);
  let a = atan2(p.y, p.x);

  // --- Background wash + beat pulse (tempo-true when the track has a grid)
  let beatP = max(u.driveBeat, gridPulse(6.0));
  var col = hsl2rgb(P_hue() + 40.0, 0.5, 0.05 + u.bass * 0.04) * (1.0 - r * 0.8) * P_bgGlow() * 2.0;
  col += hsl2rgb(P_hue(), 0.7, 0.5) * beatP * P_beatFlash() * (1.0 - r);

  // --- Particles (behind everything else): same recipe as the Particles
  // mode — per-particle wander + beat scatter, crisp cores, drifting field
  if (P_stars() > 0.5) {
    let pp = vec2f(uv.x * u.aspect, uv.y);
    let spd = P_starSpeed() * (0.3 + u.drive * 0.9);
    for (var l = 0; l < 2; l++) {
      let fl = f32(l);
      let n = P_starDensity() * (1.0 + fl * 0.4);
      let q = pp * n - vec2f(0.0, -u.time * spd * n * 0.1); // gentle upward drift
      let base = floor(q);
      let f = q - base;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          let cell = base + vec2f(f32(dx), f32(dy));
          let h1 = hash21(cell + fl * 77.3);
          if (h1 > 0.65) { continue; }
          let h2 = hash21(cell + fl * 77.3 + 31.7);
          let h3 = hash21(cell + fl * 77.3 + 63.1);
          let ph = h2 * TAU;
          let wob = vec2f(sin(u.time * 0.4 * (0.5 + h2) + ph),
                          cos(u.time * 0.4 * (0.7 + h3) + ph * 1.7)) * 0.3;
          let scat = normalize(vec2f(h2 - 0.5, h3 - 0.5) + 1e-4)
                   * u.driveBeat * P_starStreak() * 0.5;
          let d = f - (vec2f(f32(dx), f32(dy)) + 0.5 + wob + scat);
          let s = 0.14 * (0.5 + h1) * (1.0 - fl * 0.25);
          let dist = length(d);
          let core = smoothstep(s * 0.38, s * 0.16, dist);
          let halo = exp(-dot(d, d) / max(s * s * 0.5, 1e-5)) * 0.15;
          col += hsl2rgb(P_hue() + (h2 - 0.5) * P_hueSpread(), 0.5, 0.8)
               * (core + halo) * (1.0 - fl * 0.3) * 0.8;
        }
      }
    }
  }

  // --- Bottom spectrum bars (same sampling as Spectrum Bars: honors the
  // Motion->Detail master and the global Smooth-spectrum toggle)
  if (P_bars() > 0.5) {
    let n = round(mix(8.0, f32(u.binCount), u.detail));
    let fi = clamp(uv.x * n, 0.0, n - 0.001);
    let i = u32(fi);
    let inBar = fract(fi);
    let barCenter = (f32(i) + 0.5) / n;
    var v = binAt(barCenter);
    var pk = peakAt(barCenter);
    var gapMask = step(P_barsGap() * 0.5, inBar) * step(inBar, 1.0 - P_barsGap() * 0.5);
    if (u.smoothBins > 0.5) {
      v = binAt(uv.x);
      pk = peakAt(uv.x);
      gapMask = 1.0;
    }
    let y = 1.0 - uv.y;
    let barH = v * P_barsHeight();
    let bHue = P_hue() + (fi / n) * P_hueSpread();
    if (y < barH) {
      let g = y / max(barH, 0.001);
      col = mix(col, hsl2rgb(bHue, 0.85, 0.35 + g * 0.3), gapMask);
    } else {
      col += hsl2rgb(bHue, 0.9, 0.5) * exp(-(y - barH) * 12.0) * P_barsGlow() * v * gapMask;
    }
    if (P_barsPeaks() > 0.5) {
      let capD = abs(y - pk * P_barsHeight());
      col += hsl2rgb(bHue, 0.3, 0.9) * smoothstep(0.005, 0.0, capD) * gapMask * 0.8;
    }
  }

  // --- Radial spectrum ring
  if (P_radial() > 0.5) {
    let seg = fract(a / TAU * P_radialSym() + 10.0);
    let xs = abs(seg * 2.0 - 1.0);
    let v = binAt(xs);
    let inner = P_radialR() * (1.0 + u.bass * 0.1);
    let len = v * P_radialLen();
    let rHue = P_hue() + xs * P_hueSpread();
    let inBar = step(inner, r) * step(r, inner + len);
    let radial = (r - inner) / max(len, 0.001);
    col = mix(col, hsl2rgb(rHue, 0.85, 0.35 + radial * 0.35), inBar);
    col += hsl2rgb(rHue, 0.9, 0.5) * exp(-max(r - inner - len, 0.0) * 16.0) * 0.4 * v
         * step(inner + len, r);
  }

  // --- Tempo pulse rings: born at the center on every beat, arriving at
  // full reach exactly as the next beat lands (beatPhase). Falls back to the
  // flux pulse's decay when the track has no grid yet.
  if (P_rings() > 0.5) {
    var pt = 1.0 - u.driveBeat;
    var amp = u.driveBeat;
    if (u.bpm > 0.5) {
      pt = u.beatPhase;
      amp = max(exp(-u.beatPhase * 2.5) - 0.08, 0.0) / 0.92;
    }
    if (amp > 0.005) {
      let ringR = mix(P_ringStart(), P_ringEnd(), pt);
      let d = abs(r - ringR);
      let ringHue = P_hue() + 15.0 + pt * P_hueSpread() * 0.3;
      col += hsl2rgb(ringHue, 0.8, 0.55)
           * exp(-d * (30.0 + P_ringSharp() * 90.0)) * amp * P_ringBright();
    }
  }

  // --- Waveform circle
  if (P_waveCircle() > 0.5) {
    let wv = waveAt(fract(a / TAU + 0.5));
    let cr = P_circleR() + wv * P_circleAmp() * (0.5 + u.drive * 1.2);
    let d = abs(r - cr);
    let cHue = P_hue() + 30.0 + wv * 25.0;
    col += hsl2rgb(cHue, 0.7, 0.55) * smoothstep(0.004, 0.0008, d) * 0.7;
    col += hsl2rgb(cHue, 0.8, 0.5) * exp(-d * 110.0) * 0.25;
  }

  // --- Orb core
  if (P_orb() > 0.5) {
    let level = clamp(u.drive * 1.6 + gridPulse(7.0) * P_orbBeat(), 0.0, 1.0);
    let spin = u.time * 0.35;
    let amp = P_orbSize() * P_orbWobble() * (0.1 + level * 0.35);
    let wob = sin(a * 3.0 + spin) * amp + sin(a * 6.0 - spin * 0.8 + 1.5) * amp * 0.4;
    let orbR = P_orbSize() * (1.0 + level * P_orbPump()) + wob;
    let inside = smoothstep(orbR, orbR - 0.01, r);
    let body = hsl2rgb(P_hue() + 20.0, 0.7, 0.18 + level * 0.3 + exp(-r * 6.0) * 0.2);
    col = mix(col, body, inside);
    col += hsl2rgb(P_hue() + 20.0, 0.8, 0.6) * smoothstep(0.005, 0.0, abs(r - orbR)) * 0.6;
  }

  // --- Horizontal wave line (topmost)
  if (P_waveLine() > 0.5) {
    let w = (waveAt(uv.x) * 0.5 + waveAt(uv.x + 0.008) * 0.3 + waveAt(uv.x - 0.008) * 0.2)
          / (0.35 + u.drive * 1.2);
    let y = P_lineY() + clamp(w * P_lineAmp(), -0.4, 0.4);
    let d = abs(uv.y - y);
    let lHue = P_hue() + w * 30.0;
    col += hsl2rgb(lHue, 0.85, 0.62) * smoothstep(0.003, 0.0007, d);
    col += hsl2rgb(lHue, 0.9, 0.5) * exp(-d * (100.0 - P_lineGlow() * 60.0)) * (0.3 + P_lineGlow() * 0.5);
  }

  col *= 1.0 - r * r * P_vignette();
  return vec4f(col, 1.0);
}
`,
};
