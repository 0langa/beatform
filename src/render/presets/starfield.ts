import type { PresetDef } from "../types";

/**
 * Hyperspace starfield: stars streak outward from center, cruise speed on
 * the slow energy envelope, "punch" controls how hard bass/beats kick.
 * Stateless — star positions are procedural (hashed grid in polar/depth
 * space).
 */
export const starfield: PresetDef = {
  id: "starfield",
  name: "Starfield Warp",
  description: "Flying through a star tunnel — cruise speed follows the track's energy, beats punch the warp.",
  styles: [
    { id: "deep", name: "Deep Space", values: {} },
    { id: "hyper", name: "Hyperdrive", values: { speed: 0.8, streak: 0.9, punch: 0.7 } },
    { id: "drift", name: "Slow Drift", values: { speed: 0.1, punch: 0.1, twinkle: 0.8, streak: 0.2 } },
    { id: "golden", name: "Golden Dust", values: { hue: 45, density: 11, starSize: 140, twinkle: 0.7 } },
  ],
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 220, hint: "Base star and nebula color" },
    { key: "density", label: "Density", min: 2, max: 14, step: 0.5, default: 7, hint: "How many stars fill the sky" },
    { key: "speed", label: "Speed", min: 0.02, max: 1.5, step: 0.02, default: 0.3, hint: "Base flight speed through the field" },
    { key: "punch", label: "Punch", min: 0, max: 1, step: 0.01, default: 0.45, hint: "How hard bass and beats accelerate the warp — 0 = calm cruise" },
    { key: "streak", label: "Streak", min: 0, max: 1, step: 0.01, default: 0.5, hint: "Stars stretch into light trails at speed" },
    { key: "twinkle", label: "Twinkle", min: 0, max: 1, step: 0.01, default: 0.5, hint: "Star brightness shimmer" },
  ],
  advanced: [
    { key: "cruiseFloor", label: "Cruise floor", min: 0, max: 1, step: 0.02, default: 0.25, hint: "Minimum speed even in silence" },
    { key: "cruiseEnergy", label: "Cruise energy", min: 0, max: 2, step: 0.05, default: 0.9, hint: "How much track loudness raises cruise speed" },
    { key: "kickBass", label: "Bass kick", min: 0, max: 3, step: 0.05, default: 1.1, hint: "Bass contribution to the punch acceleration" },
    { key: "kickBeat", label: "Beat kick", min: 0, max: 2, step: 0.05, default: 0.7, hint: "Beat contribution to the punch acceleration" },
    { key: "starFill", label: "Star fill", min: 0.05, max: 0.9, step: 0.05, default: 0.35, hint: "Fraction of sky cells containing a star" },
    { key: "starSize", label: "Star size", min: 20, max: 200, step: 5, default: 90, hint: "Higher = smaller, sharper points" },
    { key: "hueVariance", label: "Hue variance", min: 0, max: 180, step: 5, default: 60, hint: "Random per-star color variation" },
    { key: "centerGlow", label: "Center glow", min: 0, max: 0.8, step: 0.02, default: 0.15, hint: "Warp-core glow at the vanishing point" },
    { key: "beatGlow", label: "Beat glow", min: 0, max: 1, step: 0.02, default: 0.4, hint: "Center glow flash on beats" },
    { key: "bgLevel", label: "Bg level", min: 0, max: 0.1, step: 0.005, default: 0.025, hint: "Deep-space background brightness" },
    { key: "vignette", label: "Vignette", min: 0, max: 1, step: 0.05, default: 0.35, hint: "Darkening toward the screen corners" },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  let p = centered(uv);
  let r = length(p) + 1e-4;
  let a = atan2(p.y, p.x);

  // Cruise speed rides the slow energy envelope (smooth, never jumpy);
  // "punch" controls how much instantaneous bass/beat kicks on top. At
  // punch 0 the field drifts calmly even on hectic tracks.
  let cruise = P_speed() * (P_cruiseFloor() + u.energy * P_cruiseEnergy());
  let kick = (u.bass * P_kickBass() + u.beatIntensity * P_kickBeat()) * P_punch();
  let spd = cruise * (1.0 + kick * 2.2);

  // Deep-space background
  var col = hsl2rgb(P_hue() + 30.0, 0.6, P_bgLevel()) * (1.0 + u.bass * 0.6);
  col += hsl2rgb(P_hue(), 0.7, 0.35) * exp(-r * 6.0)
       * (P_centerGlow() + u.beatIntensity * P_beatGlow());

  // 3 depth layers of procedural stars in (angle, inverse-radius) space
  for (var l = 0; l < 3; l++) {
    let fl = f32(l);
    let angCells = 48.0 + fl * 32.0;
    let z = 0.35 / r + u.time * spd * (1.0 + fl * 0.6) * 4.0;
    let q = vec2f((a / TAU + 0.5) * angCells, z * P_density());
    let cell = floor(q);
    let f = fract(q) - 0.5;
    let h1 = hash21(cell + fl * 91.7);
    let h2 = hash21(cell + fl * 91.7 + 37.1);
    // Only some cells contain a star
    if (h1 > 1.0 - P_starFill()) {
      let off = (vec2f(h1, h2) - 0.5) * 0.6;
      // Streaks: stretch along the motion (depth) axis, more when fast
      let stretch = 1.0 + P_streak() * spd * 10.0;
      let dv = vec2f((f.x - off.x) * 1.4, (f.y - off.y) / stretch);
      let d = length(dv);
      let tw = 0.6 + 0.4 * sin(u.time * (3.0 + P_twinkle() * 12.0) * (0.5 + h2) + h1 * 40.0 + u.treble * 6.0);
      let fade = smoothstep(0.02, 0.2, r) * (1.0 - fl * 0.22);
      let starHue = P_hue() + (h2 - 0.5) * P_hueVariance();
      col += hsl2rgb(starHue, 0.45, 0.85) * exp(-d * d * P_starSize()) * tw * fade;
    }
  }

  // Vignette
  col *= 1.0 - r * r * P_vignette();
  return vec4f(col, 1.0);
}
`,
};
