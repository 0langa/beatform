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
    // Night City — the defaults — an orbiting night skyline.
    { id: "city", name: "Night City", values: {} },
    // Street Level — a low, wide vantage just outside the city, eye level with
    // the outer rooftops: near facades run off the bottom of frame, the towers
    // in the middle rise against the sky.
    //
    // Re-conceived, because the literal reading of the name is not reachable
    // here and every earlier attempt at it produced a flat slab.
    // Three fixed facts of the mesh path force this:
    //
    //  1. Bar height is a RADIAL function of the spectrum (bin index ~ distance
    //     from the centre), so every ring is one constant height. The row
    //     nearest the camera is therefore always a flat-topped wall, never a
    //     jagged skyline — there is no camera angle that makes it read as
    //     separate buildings of different heights.
    //  2. On real music the outer (treble) ring measures ~0.43 where the centre
    //     measures ~0.88 — half, not a tenth. So the near wall is always about
    //     half the height of the towers behind it, and an eye low enough to be
    //     "under" the towers is also under the wall, which then fills the lens.
    //  3. The camera always looks slightly DOWN: the eye sits sin(pitch)*dist
    //     above the look-at point. There is no upward tilt to be had.
    //
    // So the look is built the other way round: put the eye a little ABOVE the
    // outer roofline and let the towers do the rising. targetY 4 (the max) with
    // the minimum 5-degree pitch puts the eye at ~5.4, against an outer wall of
    // ~4.6 — over it on average, under it on the loud peaks, so the near wall
    // breathes across your eyeline with the music.
    {
      id: "street",
      name: "Street Level",
      values: {
        // The height term shifts hue by hLit*24 in the shader, which at
        // heightScale 8 is ~+120 degrees on the tallest bars — so the base hue
        // is chosen for where the CENTRE lands (82 + 118 ~ 200, cyan tips), and
        // the spread carries the outskirts round to magenta.
        hue: 82,
        hueRange: 145,
        heightScale: 8,
        camPitch: 5,
        // 16 with spacing 0.5: the field's half-extent is 13.5*0.5 = 6.75 and
        // its CORNER is 1.414x that (9.55), so a camera whose horizontal radius
        // is cos(5)*16 = 15.9 clears the corner by 6.4 even at the worst point
        // of the orbit. Both earlier versions failed this test — 9 stood inside
        // the field outright, and 14 against spacing 0.75 cleared the flat edge
        // (10.1) but not the corner (14.3), so a quarter of every orbit pressed
        // the lens against one bar face. That is the "flat wall of stripes".
        camDist: 16,
        camSpin: 4,
        fov: 46,
        targetY: 4,
        // Glow down, key light UP — the opposite of what this look used to do.
        // Emissive is view-independent, so it flattens: at 1.15 it swamped the
        // lighting and every facade rendered the same pale value, which is what
        // made the wall unreadable even once it stopped being white. The key
        // light only reaches two of a column's four side faces, so it is the
        // term that actually separates one facade from the next.
        emissive: 0.35,
        light: 1.15,
        spacing: 0.5,
        barWidth: 0.28,
      },
    },
    // Flyover — telephoto from far and high — the grid reads as terrain.
    {
      id: "flyover",
      name: "Flyover",
      values: {
        hue: 152,
        hueRange: 90,
        camPitch: 58,
        camDist: 27,
        camSpin: -5,
        fov: 32,
        targetY: 0.4,
        emissive: 0.35,
        light: 1.25,
      },
    },
    // Top Down — near-vertical: the concentric spectrum rings become a radial plot.
    //
    // Retuned, because this was the last washed look in the mode. Measured over
    // 30 frames of a real export on the loudest master in the library (-2.9
    // LUFS): the old values rendered a mean luminance of 0.854 with 66% of the
    // frame above 0.85 on average — 95% on the worst frame — at a saturation of
    // 0.317. That is the pale near-white plate: no rings, no depth, no colour.
    // The same 30 frames now measure mean 0.487, saturation 0.485, and NOT ONE
    // pixel above 0.85 on any frame.
    //
    // Nadir is the one vantage where the mode's usual cues do not work, and
    // each value below answers a specific reason why:
    //
    //  1. Looking straight down, nearly every visible face is a TOP face, and
    //     they all share one normal — so the key light resolves to a CONSTANT
    //     over the whole plate and separates nothing. That leaves hue and the
    //     height emissive as the only terms that vary bar to bar. Glow at 0.55
    //     added ~2.3x the lit value to every bar (the emissive term clamps at
    //     half the bar shape, and on a broadband master even the outer ring
    //     sits at that clamp), which both pushed the plate past the tone map's
    //     shoulder AND — being view-independent — collapsed the top-face to
    //     side-face ratio from ~2.5:1 to ~1.2:1, erasing the one cue still
    //     reading. Glow 0.1 with Light 1.15 is the trade Street Level makes,
    //     for the same reason: the key light is the term that separates one
    //     face from the next, the glow is the term that erases the difference.
    //  2. Depth here cannot come from shading, so it has to come from the LENS.
    //     Field of view 45 -> 80. A wide lens makes the outer columns lean away
    //     from centre and show their sides, so the plate reads as columns of
    //     different heights instead of a quilt. This is the change that put the
    //     geometry back — the exposure change alone only made it a dimmer quilt.
    //  3. Distance 17 -> 13, and Height back to the default 6 (it is not
    //     restated below). Height is what decides how much of the frame the
    //     shader's hot core can occupy: heightNorm is scale-free, so the SET of
    //     bars that go white-hot is fixed by the spectrum, but how large they
    //     loom is not. At Height 9 the hot inner disc subtended more than the
    //     whole 80-degree lens; at 6 it is a core inside a magenta ring. The
    //     eye sits sin(84)*13 = 12.9 up and the tallest bar the shader can
    //     build is 1.0 * 6 * 1.4 = 8.4, so the camera stays clear of the towers
    //     even at full drive on a full-scale bin.
    //  4. Spacing 0.75 -> 0.9 against the same 0.7 bar width: fill drops from
    //     93% — adjacent tops touching, hence "quilt" — to 78%, so every cell
    //     has a visible edge. The field's silhouette also now covers the frame
    //     vertically at ANY loudness (13*tan(40) = 10.9 against a half-extent
    //     of 13.5*0.9 = 12.15), instead of shrinking away on quiet material.
    //  5. Hue spread 240 -> 130. The shader shifts hue by hLit*24, which at
    //     Height 6 is ~90 degrees at the centre against ~45 at the rim, so a
    //     240 spread carried the corners a full turn back onto the centre's own
    //     hue and the ramp ate its own tail. 130 keeps the plate one forward
    //     sweep — pale core, magenta ring, crimson field, amber corners — and
    //     it stays that sweep from -17 to -3 LUFS.
    {
      id: "topdown",
      name: "Top Down",
      values: {
        hue: 205,
        hueRange: 130,
        camPitch: 84,
        camDist: 13,
        camSpin: 10,
        fov: 80,
        targetY: 0,
        emissive: 0.1,
        light: 1.15,
        barWidth: 0.7,
        spacing: 0.9,
      },
    },
    // Monolith — editorial. One hue, no orbit, key light carries the form — a study model.
    {
      id: "monolith",
      name: "Monolith",
      values: {
        hue: 215,
        hueRange: 0,
        heightScale: 4.5,
        camPitch: 26,
        camDist: 18,
        camSpin: 0,
        camYaw: 45,
        fov: 38,
        targetY: 0.6,
        emissive: 0.1,
        light: 1.45,
        barWidth: 0.62,
        spacing: 0.7,
      },
    },
    // Neon Grid — a lattice of glowing studs on the widest spacing the mode
    // allows, seen from above the field: the dark between the elements is the
    // look. Almost no key light — these are light sources, not lit objects.
    //
    // The height is deliberately LOW, which is the whole fix. A grid
    // is legible only where you can see past its front row, and the condition
    // for that is geometric: a bar of height h at horizontal distance d from an
    // eye at height Y hides the ground behind it unless h < s*Y/d. At the old
    // heightScale 16 the bars ran to 22 units from a 16-unit-high camera, so
    // nothing was ever visible past the first row and 784 columns fused into a
    // single field of spikes. At 3 they top out near 4, the near half of the
    // lattice opens up, and the far half compresses into a horizon — which is
    // what a grid in perspective is supposed to do.
    //
    // Low bars also stabilise the palette: the shader's hue shift rides bar
    // height (hLit*24), so a tall style repaints itself as the track gets
    // louder. At heightScale 3 the shift spans ~20-45 degrees instead of ~220,
    // and the look holds the same violet-to-magenta from -17 to -3 LUFS.
    {
      id: "neonGrid",
      name: "Neon Grid",
      values: {
        hue: 210,
        hueRange: 65,
        heightScale: 3,
        camPitch: 45,
        camDist: 27,
        camSpin: 8,
        fov: 44,
        targetY: 0.4,
        // 0.85, not 1.85. The emissive term is normalised against Height and
        // clamps at half the bar's shape, so it tops out near 3x emissive
        // BEFORE the beat gain — 1.85 therefore drove every bar, not just the
        // tall ones, past the tone map's shoulder and the grid rendered as a
        // near-white sheet. Under 1 the studs keep their hue and only the
        // spectrum's peak ring goes white-hot.
        emissive: 0.85,
        light: 0.25,
        barWidth: 0.32,
        spacing: 1.2,
      },
    },
    // Canyon — bars almost touching at max height — slabs with streets between them.
    {
      id: "canyon",
      name: "Canyon",
      values: {
        hue: 24,
        hueRange: 90,
        heightScale: 14,
        camPitch: 40,
        // 18, not 13 (v2.53.0) — same reason as Street Level: at 0.9 spacing
        // the field's half-extent is ~12.6, so 13 sat on its edge and a
        // full-height near slab filled the lens. 18 is far enough out to see
        // the streets between the slabs, which is the whole look.
        camDist: 18,
        camSpin: -6,
        fov: 70,
        targetY: 2,
        emissive: 0.4,
        light: 1.1,
        barWidth: 0.88,
        spacing: 0.9,
      },
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
