import type { PresetDef } from "../types";

/**
 * Hyperspace starfield: stars streak outward from center, speed driven by
 * bass, twinkle by treble, beat adds a warp kick. Stateless — star positions
 * are procedural (hashed grid in polar/depth space).
 */
export const starfield: PresetDef = {
  id: "starfield",
  name: "Starfield Warp",
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 220 },
    { key: "density", label: "Density", min: 2, max: 14, step: 0.5, default: 7 },
    { key: "speed", label: "Speed", min: 0.05, max: 1.5, step: 0.05, default: 0.4 },
    { key: "warp", label: "Bass warp", min: 0, max: 3, step: 0.05, default: 1.4 },
    { key: "streak", label: "Streak", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "twinkle", label: "Twinkle", min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  let hue = param(0); let density = param(1); let speed = param(2);
  let warp = param(3); let streak = param(4); let twinkle = param(5);

  let p = centered(uv);
  let r = length(p) + 1e-4;
  let a = atan2(p.y, p.x);

  let spd = speed * (0.35 + u.bass * warp + u.beatIntensity * 0.8);

  // Deep-space background
  var col = hsl2rgb(hue + 30.0, 0.6, 0.025) * (1.0 + u.bass * 0.6);
  col += hsl2rgb(hue, 0.7, 0.35) * exp(-r * 6.0) * (0.15 + u.beatIntensity * 0.4);

  // 3 depth layers of procedural stars in (angle, inverse-radius) space
  for (var l = 0; l < 3; l++) {
    let fl = f32(l);
    let angCells = 48.0 + fl * 32.0;
    let z = 0.35 / r + u.time * spd * (1.0 + fl * 0.6) * 4.0;
    let q = vec2f((a / TAU + 0.5) * angCells, z * density);
    let cell = floor(q);
    let f = fract(q) - 0.5;
    let h1 = hash21(cell + fl * 91.7);
    let h2 = hash21(cell + fl * 91.7 + 37.1);
    // Only some cells contain a star
    if (h1 > 0.65) {
      let off = (vec2f(h1, h2) - 0.5) * 0.6;
      // Streaks: stretch along the motion (depth) axis, more when fast
      let stretch = 1.0 + streak * spd * 10.0;
      let dv = vec2f((f.x - off.x) * 1.4, (f.y - off.y) / stretch);
      let d = length(dv);
      let tw = 0.6 + 0.4 * sin(u.time * (3.0 + twinkle * 12.0) * (0.5 + h2) + h1 * 40.0 + u.treble * 6.0);
      let fade = smoothstep(0.02, 0.2, r) * (1.0 - fl * 0.22);
      let starHue = hue + (h2 - 0.5) * 60.0;
      col += hsl2rgb(starHue, 0.45, 0.85) * exp(-d * d * 90.0) * tw * fade;
    }
  }

  // Vignette
  col *= 1.0 - r * r * 0.35;
  return vec4f(col, 1.0);
}
`,
};
