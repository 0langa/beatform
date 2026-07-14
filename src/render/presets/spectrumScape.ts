import type { PresetDef } from "../types";

/**
 * Spectrum Scape — a 3D pass. A depth-tested grid of instanced columns whose
 * heights follow the spectrum (radially, so frequency rings ripple outward),
 * lit by a directional light and viewed through an orbiting perspective camera.
 *
 * Rendered by the renderer's built-in 3D path (MESH3D_WGSL); the `wgsl`
 * fragment body below is an unused stub. The camera params (orbit/pitch/
 * distance/fov) are regular params, so they are keyframeable via automation and
 * modulation. Bar heights come from the shared bins buffer — deterministic and
 * WYSIWYG like every other preset.
 */
export const spectrumScape: PresetDef = {
  id: "spectrum-scape",
  name: "Spectrum Scape",
  description:
    "A 3D city of bars rippling to the spectrum, flown by an orbiting camera. Tall bars glow — pair with bloom.",
  mesh3d: { grid: 28 },
  styles: [
    { id: "city", name: "City", values: {} },
    {
      id: "calm",
      name: "Calm Orbit",
      values: { camSpin: 5, camPitch: 24, heightScale: 4, emissive: 0.35 },
    },
    {
      id: "canyon",
      name: "Canyon",
      values: { camPitch: 12, camDist: 12, heightScale: 9, spacing: 0.7, hue: 20 },
    },
    {
      id: "topdown",
      name: "Top Down",
      values: { camPitch: 78, camDist: 17, camSpin: 8, hueRange: 200 },
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
      hint: "Base color of the bars",
    },
    {
      key: "heightScale",
      label: "Height",
      min: 1,
      max: 14,
      step: 0.5,
      default: 6,
      hint: "How tall the bars grow with the spectrum",
    },
    {
      key: "camPitch",
      label: "Camera pitch",
      min: 5,
      max: 85,
      step: 1,
      default: 32,
      hint: "Camera elevation angle (5 = low, 85 = top-down)",
    },
    {
      key: "camDist",
      label: "Camera distance",
      min: 8,
      max: 26,
      step: 0.5,
      default: 15,
      hint: "How far back the camera sits",
    },
    {
      key: "camSpin",
      label: "Orbit speed",
      min: -60,
      max: 60,
      step: 1,
      default: 12,
      hint: "Auto-orbit speed in degrees/sec — 0 to hold still",
    },
    {
      key: "emissive",
      label: "Glow",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.5,
      hint: "How much the bars self-illuminate — tall bars glow brightest",
    },
  ],
  advanced: [
    {
      key: "fov",
      label: "Field of view",
      min: 25,
      max: 90,
      step: 1,
      default: 50,
      hint: "Lens angle — wide feels dramatic, narrow feels flat/telephoto",
    },
    {
      key: "hueRange",
      label: "Hue spread",
      min: 0,
      max: 300,
      step: 5,
      default: 120,
      hint: "Color variation from center to edge",
    },
    {
      key: "barWidth",
      label: "Bar width",
      min: 0.1,
      max: 0.9,
      step: 0.02,
      default: 0.42,
      hint: "Thickness of each column relative to the spacing",
    },
    {
      key: "spacing",
      label: "Spacing",
      min: 0.3,
      max: 1.2,
      step: 0.05,
      default: 0.6,
      hint: "Distance between columns",
    },
    {
      key: "light",
      label: "Light",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.9,
      hint: "Directional light strength",
    },
    {
      key: "camYaw",
      label: "Camera angle",
      min: 0,
      max: 360,
      step: 1,
      default: 30,
      hint: "Starting orbit angle (add automation for a fly-through)",
    },
    {
      key: "targetY",
      label: "Look height",
      min: 0,
      max: 4,
      step: 0.1,
      default: 1,
      hint: "Height the camera aims at",
    },
  ],
  // Unused: 3D presets render via the built-in mesh path. Stub keeps the shared
  // fragment pipeline compiling.
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f { return vec4f(0.0); }
`,
};
