import type { PresetDef } from "../types";

/**
 * Particle Flow — a GPU compute-particle system. 120k particles are advanced
 * every frame by a curl-noise flow field plus audio forces (bass amplifies the
 * flow, kicks fire per-particle radial bursts), then drawn as additive sprites
 * that bloom into glowing streams. Unlike the fragment-shader "Particles"
 * preset, these are a real simulation with momentum and emergent structure.
 *
 * Driven by the renderer's built-in particle path (PARTICLE_SIM_WGSL +
 * PARTICLE_DRAW_WGSL); the `wgsl` fragment body below is an unused stub.
 * Params map by key into the sim uniform
 * (see PARTICLE_PARAM_KEYS). Deterministic: seeded init, fixed 60 Hz sim rate
 * keyed to track time, no RNG.
 */
export const particleFlow: PresetDef = {
  id: "particle-flow",
  name: "Particle Flow",
  description:
    "120k GPU particles swept through a curl-noise flow field — bass drives the current, kicks scatter them, additive glow blooms the streams.",
  particles: { count: 120_000 },
  styles: [
    { id: "flow", name: "Flow", values: {} },
    {
      id: "nebula",
      name: "Nebula",
      values: { flowStrength: 0.6, swirl: 0.6, damping: 0.97, size: 0.01, brightness: 0.35 },
    },
    {
      id: "storm",
      name: "Storm",
      values: { flowStrength: 1.8, beatBurst: 2.5, audioFlow: 3, damping: 0.9, hueSpread: 120 },
    },
    {
      id: "galaxy",
      name: "Galaxy",
      values: { swirl: 1.2, gravity: 0.5, flowStrength: 0.5, hue: 40, hueSpread: 80 },
    },
    {
      id: "fireflies",
      name: "Fireflies",
      values: {
        hue: 55,
        flowStrength: 0.3,
        swirl: 0.1,
        beatBurst: 0.5,
        size: 0.004,
        brightness: 1.1,
        density: 0.35,
        damping: 0.96,
        audioFlow: 0.8,
        hueSpread: 25,
        sat: 0.7,
      },
    },
    {
      id: "inkWash",
      name: "Ink Wash",
      values: {
        hue: 230,
        flowStrength: 0.5,
        swirl: 0.2,
        beatBurst: 0.8,
        size: 0.018,
        brightness: 0.2,
        flowScale: 0.8,
        damping: 0.985,
        gravity: 0.05,
        sat: 0.3,
        speedColor: 0.1,
        spawnRadius: 0.3,
      },
    },
    {
      id: "flashpoint",
      name: "Flashpoint",
      values: {
        hue: 15,
        flowStrength: 2,
        beatBurst: 3,
        size: 0.005,
        brightness: 0.9,
        flowScale: 2.5,
        damping: 0.85,
        gravity: 0.9,
        audioFlow: 3.5,
        hueSpread: 45,
        speedColor: 0.8,
        spawnRadius: 0.08,
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
      default: 200,
      hint: "Base particle color",
    },
    {
      key: "flowStrength",
      label: "Flow",
      min: 0,
      max: 2,
      step: 0.05,
      default: 1,
      hint: "Strength of the curl-noise current that sweeps the particles",
    },
    {
      key: "swirl",
      label: "Swirl",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.3,
      hint: "Rotational pull around the center",
    },
    {
      key: "beatBurst",
      label: "Beat burst",
      min: 0,
      max: 3,
      step: 0.05,
      default: 1.4,
      hint: "How hard kicks scatter the particles outward",
    },
    {
      key: "size",
      label: "Particle size",
      min: 0.002,
      max: 0.03,
      step: 0.001,
      default: 0.007,
      hint: "On-screen size of each particle",
    },
    {
      key: "brightness",
      label: "Brightness",
      min: 0.1,
      max: 1.5,
      step: 0.05,
      default: 0.5,
      hint: "Additive glow of each particle",
    },
    {
      key: "density",
      label: "Density",
      min: 0.1,
      max: 1,
      step: 0.05,
      default: 1,
      hint: "Fraction of the 120k particles drawn",
    },
  ],
  advanced: [
    {
      key: "flowScale",
      label: "Flow scale",
      min: 0.3,
      max: 4,
      step: 0.1,
      default: 1.6,
      hint: "Spatial frequency of the flow field — higher = finer eddies",
    },
    {
      key: "damping",
      label: "Damping",
      min: 0.8,
      max: 0.99,
      step: 0.005,
      default: 0.93,
      hint: "Velocity retained each step — higher = longer, smoother streams",
    },
    {
      key: "gravity",
      label: "Center pull",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.12,
      hint: "Pull back toward the center — balances the outward fountain",
    },
    {
      key: "audioFlow",
      label: "Bass drive",
      min: 0,
      max: 4,
      step: 0.1,
      default: 2,
      hint: "How much bass amplifies the flow current",
    },
    {
      key: "sizePulse",
      label: "Speed size",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.5,
      hint: "Faster particles grow larger",
    },
    {
      key: "hueSpread",
      label: "Hue spread",
      min: 0,
      max: 180,
      step: 5,
      default: 50,
      hint: "Per-particle color variation",
    },
    {
      key: "speedColor",
      label: "Speed color",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.3,
      hint: "Shifts color by particle speed",
    },
    {
      key: "sat",
      label: "Saturation",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.8,
      hint: "Color saturation",
    },
    {
      key: "spawnRadius",
      label: "Respawn radius",
      min: 0.02,
      max: 0.6,
      step: 0.02,
      default: 0.12,
      hint: "How near the center particles respawn after drifting off-frame",
    },
  ],
  // Unused: particle presets render via the built-in compute path. Stub keeps
  // the shared fragment pipeline compiling.
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f { return vec4f(0.0); }
`,
};
