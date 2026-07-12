import type { PresetDef } from "../types";

/**
 * Infinite tunnel of concentric rings flying toward the viewer, ring radius
 * wobbled by the spectrum at each angle.
 */
export const tunnelRings: PresetDef = {
  id: "tunnel-rings",
  name: "Tunnel",
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 15 },
    { key: "hueSpread", label: "Hue spread", min: 0, max: 240, step: 1, default: 90 },
    { key: "speed", label: "Speed", min: 0.05, max: 1.2, step: 0.05, default: 0.35 },
    { key: "rings", label: "Ring density", min: 2, max: 16, step: 0.5, default: 7 },
    { key: "wobble", label: "Wobble", min: 0, max: 1, step: 0.01, default: 0.45 },
    { key: "rotation", label: "Rotation", min: -1, max: 1, step: 0.02, default: 0.15 },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  let hue = param(0); let hueSpread = param(1); let speed = param(2);
  let rings = param(3); let wobble = param(4); let rotation = param(5);

  let p = centered(uv);
  let r = length(p) + 1e-3;
  let a = atan2(p.y, p.x) + u.time * rotation * TAU * 0.08;
  let xs = abs(fract(a / TAU + 1.0) * 2.0 - 1.0);

  // Spectrum displaces the ring surface at this angle
  let disp = binAt(xs) * wobble;

  // Depth coordinate: rings at integer z fly toward viewer
  let z = 0.28 / r + u.time * speed * 4.0 * (1.0 + u.beatIntensity * 0.25);
  let zr = z * rings * 0.25 + disp;
  let s = fract(zr);
  let ringIdx = floor(zr);

  // Ring line brightness, thicker when the spectrum is loud here
  let width = 8.0 + (1.0 - binAt(xs)) * 26.0;
  let line = exp(-abs(s - 0.5) * width);

  let ringHue = hue + fract(ringIdx * 0.13) * hueSpread + xs * 30.0;
  // Distance fog: far rings (small r) fade out, so does the screen edge
  let fog = smoothstep(0.015, 0.25, r) * (1.0 - smoothstep(0.75, 1.3, r));

  var col = hsl2rgb(hue + 60.0, 0.5, 0.03);
  col += hsl2rgb(ringHue, 0.8, 0.5 + u.beatIntensity * 0.12) * line * fog;
  // Center glow breathing with rms
  col += hsl2rgb(hue, 0.8, 0.5) * exp(-r * 9.0) * (0.25 + u.rms * 0.9);

  col *= 1.0 - r * r * 0.3;
  return vec4f(col, 1.0);
}
`,
};
