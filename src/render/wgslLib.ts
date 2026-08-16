/**
 * Shared WGSL snippet library (F5 / audit RP-12, RP-23).
 *
 * The renderer compiles many separate WGSL modules, and several helper
 * definitions used to be pasted into each of them by hand: the ACES tonemap
 * lived in three modules, hsl2rgb in three, the saturation/lightness
 * "colorScale" preamble in four presets, and the standard cosine-palette
 * basis in seventeen call sites. Editing one copy and missing its twins is
 * exactly how shader surfaces drift, so the text now lives HERE, once, and
 * every consumer composes its module string from these constants at the
 * TypeScript level.
 *
 * CONTRACT — zero drift, by construction:
 *
 *  - These are TEXT constants interpolated into the same template literals
 *    that used to carry the copies, so the assembled module strings are
 *    byte-identical to what shipped before this file existed. The golden
 *    shader test (shaderGolden.test.ts) snapshots those assembled strings and
 *    proves it: this consolidation landed with ZERO snapshot updates.
 *  - Consequently, editing a constant here re-renders EVERY consumer. That is
 *    the point — but it also means any edit is a deliberate, visible visual
 *    change across modes: expect golden-shader churn plus a GPU pixel-matrix
 *    re-bless, and justify both in the commit.
 *  - No imports, no logic. This module must stay a leaf so both the renderer
 *    and every preset file can pull snippets without a cycle.
 *
 * Deliberately NOT consolidated: the four per-preset kaleido-fold coordinate
 * rescales (tunnelRings/aurora/oscilloscope/echoTrails). They look alike but
 * fold DIFFERENT domains — a wall angle, a point on the x axis, a waveform
 * sweep, a ring angle with its own seam crossfade — and their tests lift the
 * exact per-preset lines out of each body (kaleidoFold.test.ts). Only the
 * shared kaleido() fold itself is common, and that already lives in the
 * renderer's HEADER.
 */

/**
 * HSL -> RGB, hue in degrees. The shared fragment prelude (HEADER) defines it
 * for every fragment preset; the compute-particle draw module and the 3D mesh
 * module are separate compilation units with their own tiny ABIs, so each
 * embeds this same definition.
 */
export const WGSL_HSL2RGB = `fn hsl2rgb(h: f32, s: f32, l: f32) -> vec3f {
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let hp = fract(h / 360.0) * 6.0;
  let x = c * (1.0 - abs(hp % 2.0 - 1.0));
  var rgb = vec3f(0.0);
  if (hp < 1.0) { rgb = vec3f(c, x, 0.0); }
  else if (hp < 2.0) { rgb = vec3f(x, c, 0.0); }
  else if (hp < 3.0) { rgb = vec3f(0.0, c, x); }
  else if (hp < 4.0) { rgb = vec3f(0.0, x, c); }
  else if (hp < 5.0) { rgb = vec3f(x, 0.0, c); }
  else { rgb = vec3f(c, 0.0, x); }
  return rgb + vec3f(l - c * 0.5);
}`;

/**
 * ACES filmic approximation (Krzysztof Narkowicz) — ONE formula, three
 * historical names. The post chain calls it `aces`, the preset prelude
 * exposes it as `tonemap`, the 3D mesh module as `m3_tonemap`; renaming any
 * of them would change compiled module text (and the preset prelude name is
 * documented custom-preset ABI), so the name stays a parameter and the body
 * is the single source of truth.
 */
export function wgslAcesTonemap(name: string): string {
  return `fn ${name}(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}`;
}

/**
 * The full-preset colour-control preamble: every authored HSL colour routes
 * through `presetColor`, whose saturation/lightness ride the shared
 * `P_saturation()` / `P_lightness()` params (pixel-neutral at their default
 * of 1). Used by the five "full colour controls" presets — spectrum-bars,
 * bass-circle, radial-burst, led-matrix, spectro-falls — and asserted per
 * preset by colorControls.test.ts.
 */
export const WGSL_COLOR_CONTROLS = `fn colorScale(value: f32, control: f32) -> f32 {
  if (control <= 1.0) { return value * control; }
  return min(value * control, 1.0);
}

fn presetColor(h: f32, s: f32, l: f32) -> vec3f {
  return hsl2rgb(h, colorScale(s, P_saturation()), colorScale(l, P_lightness()));
}`;

/**
 * The standard cosine-palette phase offsets — the `d` vector of IQ's
 * col(t) = a + b*cos(TAU*(c*t + d)) — shared by every palette call site in
 * the preset registry (17 at the time of consolidation). This phase spacing
 * (thirds of a turn per channel) is what makes the ramp sweep R->G->B evenly;
 * presets vary brightness/chroma/frequency around it, never the phase.
 */
export const WGSL_PALETTE_PHASE = "vec3f(0.0, 0.33, 0.67)";

/**
 * The standard full basis: half-grey centre, half-range chroma, frequency 1 —
 * the neutral "one full rainbow across t in 0..1" palette. The trailing
 * argument list of cosPalette(t, ...), for the call sites that use the basis
 * unmodified.
 */
export const WGSL_PALETTE_STD = `vec3f(0.5), vec3f(0.5), vec3f(1.0), ${WGSL_PALETTE_PHASE}`;
