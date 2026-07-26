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
 *
 * NOTE (integrator): every param here maps 1:1 into the mesh3d uniform the
 * renderer builds in renderMesh3d() (hue, hueRange, heightScale, barWidth,
 * spacing, light, emissive + the camera keys camYaw/camSpin/camPitch/camDist/
 * fov/targetY). That set is the whole control surface the 3D shader reads —
 * adding a param key here would render a dead slider, so this upgrade stays on
 * curated styles, tuned defaults/ranges and clearer hints. The city already
 * reacts musically inside the shader: bar heights ride u.drive, tall tops glow
 * hotter on u.driveBeat (Motion→Pulse-gated), and the orbit speed is
 * Motion→Rotation-gated.
 */
export const spectrumScape: PresetDef = {
  id: "spectrum-scape",
  name: "Spectrum Scape",
  description:
    "A 3D city of bars rippling to the spectrum, flown by an orbiting camera. Tall bars glow hotter on the beat — pair with Bloom.",
  mesh3d: { grid: 28 },
  styles: [
    { id: "city", name: "Night City", values: {} },
    {
      id: "sunrise",
      name: "Sunrise Metropolis",
      values: {
        hue: 28,
        hueRange: 55,
        heightScale: 7,
        camPitch: 18,
        camDist: 18,
        camSpin: 5,
        emissive: 0.7,
        light: 1.1,
        fov: 55,
        targetY: 1.5,
      },
    },
    {
      id: "cyber",
      name: "Cyber District",
      values: {
        hue: 300,
        hueRange: 200,
        heightScale: 11,
        camPitch: 10,
        camDist: 10,
        camSpin: 8,
        emissive: 1.1,
        fov: 74,
        targetY: 2.2,
        spacing: 0.65,
      },
    },
    {
      id: "mono",
      name: "Monochrome",
      values: {
        hue: 210,
        hueRange: 0,
        heightScale: 6,
        camPitch: 34,
        camDist: 16,
        camSpin: 6,
        emissive: 0.25,
        light: 1.3,
        barWidth: 0.5,
      },
    },
    {
      id: "heat",
      name: "Heatmap",
      values: {
        hue: 220,
        hueRange: 20,
        heightScale: 13,
        camPitch: 42,
        camDist: 17,
        camSpin: 4,
        emissive: 0.8,
        light: 0.8,
      },
    },
    {
      id: "flyover",
      name: "Flyover",
      values: {
        hue: 155,
        heightScale: 6,
        camPitch: 55,
        camDist: 26,
        camSpin: -4,
        emissive: 0.4,
        fov: 35,
        hueRange: 90,
        light: 1.2,
      },
    },
    {
      id: "topdown",
      name: "Top Down",
      values: { hue: 190, camPitch: 78, camDist: 18, camSpin: 8, hueRange: 200, emissive: 0.5 },
    },
  ],
  params: [
    {
      key: "hue",
      label: "Hue",
      group: "color",
      control: "hue",
      min: 0,
      max: 360,
      step: 1,
      default: 200,
      hint: "Base color of the bars (rings shift away from it by Hue spread; tall bars shift hotter)",
    },
    {
      key: "heightScale",
      label: "Height",
      group: "shape",
      min: 1,
      max: 18,
      step: 0.5,
      default: 6,
      hint: "How tall the bars grow with the spectrum — high values build a dense skyline",
    },
    {
      key: "camPitch",
      label: "Camera pitch",
      group: "camera",
      min: 5,
      max: 85,
      step: 1,
      default: 32,
      hint: "Camera elevation angle (5 = street level, 85 = straight down)",
    },
    {
      key: "camDist",
      label: "Camera distance",
      group: "camera",
      min: 8,
      max: 30,
      step: 0.5,
      default: 15,
      hint: "How far back the camera sits — near feels immersive, far reads as a flyover",
    },
    {
      key: "camSpin",
      label: "Orbit speed",
      group: "camera",
      min: -60,
      max: 60,
      step: 1,
      default: 12,
      hint: "Auto-orbit speed in degrees/sec — 0 to hold still, negative to reverse (Motion→Rotation also scales this)",
    },
    {
      key: "emissive",
      label: "Glow",
      group: "glow",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.5,
      hint: "How much the bars self-illuminate — tall bars glow brightest; pair with Bloom",
    },
  ],
  advanced: [
    {
      key: "fov",
      label: "Field of view",
      group: "camera",
      min: 25,
      max: 90,
      step: 1,
      default: 50,
      hint: "Lens angle — wide feels dramatic and towering, narrow feels flat/telephoto",
    },
    {
      key: "hueRange",
      label: "Hue spread",
      group: "color",
      min: 0,
      max: 300,
      step: 5,
      default: 120,
      hint: "Color variation from center to edge — 0 makes a single-color monochrome city",
    },
    {
      key: "barWidth",
      label: "Bar width",
      group: "shape",
      min: 0.1,
      max: 0.9,
      step: 0.02,
      default: 0.42,
      hint: "Thickness of each column relative to the spacing",
    },
    {
      key: "spacing",
      label: "Spacing",
      group: "shape",
      min: 0.3,
      max: 1.2,
      step: 0.05,
      default: 0.6,
      hint: "Distance between columns — wider opens the streets between buildings",
    },
    {
      key: "light",
      label: "Light",
      group: "glow",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.9,
      hint: "Directional key-light strength — carries the architectural form of unlit bars",
    },
    {
      key: "camYaw",
      label: "Camera angle",
      group: "camera",
      control: "angle",
      min: 0,
      max: 360,
      step: 1,
      default: 30,
      hint: "Starting orbit angle (add automation on top for a scripted fly-through)",
    },
    {
      key: "targetY",
      label: "Look height",
      group: "camera",
      min: 0,
      max: 4,
      step: 0.1,
      default: 1,
      hint: "Height the camera aims at — raise it to look up the towers at street level",
    },
  ],
  // Unused: 3D presets render via the built-in mesh path. Stub keeps the shared
  // fragment pipeline compiling.
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f { return vec4f(0.0); }
`,
};
