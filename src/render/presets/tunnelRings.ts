import type { PresetDef } from "../types";
import { WGSL_PALETTE_PHASE } from "../wgslLib";

/**
 * A real tube you fly down, not a zoomed disc. The wall is unwrapped with the
 * pinhole depth 1/r (frame centre = the far vanishing point, frame edge = the
 * near mouth), and every wall feature streams outward from the centre toward
 * the viewer as time advances — the actual motion of travelling down a pipe.
 * Circular rings rush past in depth; longitudinal flutes run down the tube's
 * length and CONVERGE at the vanishing point (the strongest "this is a round
 * 3D tube" cue); a one-sided cylinder shade curves the wall; fog recedes the
 * far end into haze. Spectrum lights the circumference, beats send a ring of
 * light receding to the core, and a corkscrew twist reads as a waterslide.
 * The Curve knob bends the tube's PATH: the centreline wanders as a fixed
 * function of travel distance, so perspective shows the bends ahead and the
 * camera leans into them — up, down, left, right, like riding a flume
 * instead of staring down a straight illuminated bore.
 *
 * The v2.76 depth wave rebuilds what the wall can BE. A Wall material enum
 * swaps the tile grid for staggered hex plates, a glowing wireframe lattice
 * or warpFbm organic tissue — each branch only reshapes the fragment-local
 * wall fields (fill, seam mask, seam gain); palette, fog, beat ring and core
 * stay shared. Cover wall papers every wall cell with the track's album art
 * (the first mode to wrap the art around the viewer), lit by the wall's own
 * light so it reads as printed on the bore. Junctions cut side-bore mouths
 * into the wall at fixed TRAVEL stations — features of the tube, like the
 * rings, never event state — that flash with the beat grid and race past.
 * All three default to off/Tiles and the tile math is untouched, so every
 * pre-wave document renders bit-identically.
 */
export const tunnelRings: PresetDef = {
  id: "tunnel-rings",
  name: "Tunnel",
  description:
    "Flying into a tiled tunnel — the spectrum lights tile columns, grout lines flash on beats.",
  styles: [
    // Ember — the defaults — a lit tiled tube with travelling beat rings.
    { id: "ember", name: "Ember", values: {} },
    // Wireframe — tiles off, seams up: a pure neon wire tube with no wall.
    {
      id: "wireframe",
      name: "Wireframe",
      values: {
        hue: 190,
        hueSpread: 30,
        speed: 0.25,
        rings: 10,
        spokes: 16,
        twist: 0,
        tileLevel: 0.01,
        tileSat: 0.4,
        tileSpectrum: 0.5,
        groutLevel: 0.44,
        groutWidth: 0.02,
        checker: 0,
        surfaceWarp: 0,
        roundness: 0.15,
        centerGlow: 0.5,
        fogFar: 0.85,
        fogNear: 0.02,
        beatPulse: 0.75,
        beatBright: 0.24,
        pulseWidth: 12,
        vignette: 0.45,
      },
    },
    // Corkscrew — max twist on six wide flutes — a helical slide.
    {
      id: "corkscrew",
      name: "Corkscrew",
      values: {
        hue: 275,
        hueSpread: 110,
        speed: 0.35,
        rings: 5,
        spokes: 6,
        twist: 2.8,
        groutWidth: 0.12,
        groutLevel: 0.28,
        tileLevel: 0.16,
        tileSat: 0.9,
        checker: 0.18,
        roundness: 0.9,
        surfaceWarp: 1.8,
        beatPulse: 0.6,
        fogFar: 0.75,
        centerGlow: 0.3,
        vignette: 0.4,
      },
    },
    // Cathedral — editorial. Slowest cruise, 24 fine flutes, deep fog, almost no beat.
    {
      id: "cathedral",
      name: "Cathedral",
      values: {
        hue: 40,
        hueSpread: 20,
        speed: 0.05,
        rings: 3.5,
        spokes: 24,
        twist: 0.15,
        roundness: 1,
        surfaceWarp: 0.4,
        tileLevel: 0.08,
        tileSat: 0.36,
        tileSpectrum: 0.12,
        checker: 0.03,
        groutWidth: 0.03,
        groutLevel: 0.2,
        fogNear: 0.03,
        fogFar: 0.45,
        centerGlow: 0.14,
        beatPulse: 0.25,
        beatBright: 0.04,
        cruiseFloor: 0.16,
        cruiseEnergy: 0.3,
        pulseWidth: 6,
        vignette: 0.7,
      },
    },
    // Hyperdrive — top speed with beat acceleration and a blown-out vanishing point.
    {
      id: "hyper",
      name: "Hyperdrive",
      values: {
        hue: 262,
        hueSpread: 90,
        speed: 0.85,
        rings: 12,
        spokes: 20,
        twist: 1.9,
        beatSpeed: 0.34,
        beatPulse: 0.95,
        beatBright: 0.4,
        cruiseFloor: 0.7,
        cruiseEnergy: 1.6,
        fogFar: 0.95,
        fogNear: 0.005,
        centerGlow: 0.72,
        pulseWidth: 14,
        tileSpectrum: 0.5,
        tileSat: 0.86,
        surfaceWarp: 0.7,
        groutLevel: 0.22,
        roundness: 0.4,
        vignette: 0.25,
      },
    },
    // Kaleido Tube — 6-fold fold of the tube itself — spectrum-lit stained glass.
    {
      id: "kaleidoTube",
      name: "Kaleido Tube",
      values: {
        mirror: 6,
        hue: 320,
        hueSpread: 160,
        speed: 0.2,
        rings: 8,
        spokes: 8,
        twist: 1.2,
        tileSat: 0.9,
        tileSpectrum: 0.7,
        groutLevel: 0.24,
        groutWidth: 0.045,
        checker: 0.14,
        roundness: 0.3,
        surfaceWarp: 0.9,
        centerGlow: 0.4,
        beatPulse: 0.8,
        vignette: 0.4,
      },
    },
    // Ice Cave — surface warp near max, few seams, rounded wall: an organic bore.
    {
      id: "iceCave",
      name: "Ice Cave",
      values: {
        hue: 195,
        hueSpread: 34,
        speed: 0.1,
        rings: 4,
        spokes: 10,
        twist: 0.25,
        roundness: 0.95,
        surfaceWarp: 2.9,
        tileSat: 0.5,
        tileLevel: 0.2,
        tileSpectrum: 0.3,
        checker: 0.02,
        groutWidth: 0.12,
        groutLevel: 0.3,
        fogFar: 0.85,
        fogNear: 0.04,
        centerGlow: 0.36,
        beatPulse: 0.5,
        beatBright: 0.1,
        vignette: 0.55,
      },
    },
    // Waterslide — the curve feature at full song: fast cruise around strong
    // bends, rounded wet wall, the camera leaning through every turn.
    {
      id: "waterslide",
      name: "Waterslide",
      values: {
        hue: 200,
        hueSpread: 60,
        speed: 1.5,
        curve: 0.7,
        curveScale: 1.2,
        rings: 9,
        twist: 1.4,
        roundness: 0.9,
        surfaceWarp: 1.6,
        tileSat: 0.8,
        tileSpectrum: 0.4,
        groutWidth: 0.07,
        groutLevel: 0.3,
        fogFar: 0.9,
        centerGlow: 0.5,
        beatPulse: 0.8,
        beatBright: 0.2,
        cruiseFloor: 0.6,
        cruiseEnergy: 1.2,
        vignette: 0.4,
      },
    },
    // Foundry — few huge high-contrast tiles, heavy checker — molten plates flying past.
    {
      id: "foundry",
      name: "Foundry",
      values: {
        hue: 18,
        hueSpread: 45,
        rings: 4,
        spokes: 8,
        tileLevel: 0.36,
        checker: 0.3,
        groutWidth: 0.03,
        groutLevel: 0.34,
        tileSat: 0.94,
        tileSpectrum: 0.24,
        surfaceWarp: 2,
        roundness: 0.85,
        beatPulse: 0.85,
        beatBright: 0.34,
        centerGlow: 0.6,
        fogFar: 0.6,
        pulseWidth: 5,
        vignette: 0.6,
      },
    },
    // Honeycomb — the hex material: staggered amber plates, per-cell shimmer
    // (checker drives the cell tone spread), a club wall of honey glass.
    {
      id: "honeycomb",
      name: "Honeycomb",
      values: {
        material: 1,
        hue: 45,
        hueSpread: 40,
        speed: 0.3,
        rings: 6,
        spokes: 14,
        twist: 0.5,
        tileSat: 0.9,
        tileSpectrum: 0.5,
        checker: 0.24,
        groutWidth: 0.04,
        groutLevel: 0.3,
        roundness: 0.7,
        surfaceWarp: 0.6,
        centerGlow: 0.4,
        beatPulse: 0.75,
      },
    },
    // Vector Grid — the wireframe material as a look: phosphor-green lattice
    // over the void, flat shading, long draw distance — an 80s vector display.
    {
      id: "vector",
      name: "Vector Grid",
      values: {
        material: 2,
        hue: 130,
        hueSpread: 12,
        speed: 0.45,
        rings: 9,
        spokes: 16,
        twist: 0,
        roundness: 0.1,
        surfaceWarp: 0,
        tileLevel: 0.02,
        tileSpectrum: 0.3,
        groutWidth: 0.03,
        groutLevel: 0.4,
        fogFar: 0.9,
        centerGlow: 0.56,
        beatPulse: 0.9,
        pulseWidth: 16,
        vignette: 0.35,
      },
    },
    // Gullet — the organic material at full flesh: crimson peristaltic bore,
    // wide soft veins, maximum roundness — riding something's throat.
    {
      id: "gullet",
      name: "Gullet",
      values: {
        material: 3,
        hue: 355,
        hueSpread: 25,
        speed: 0.2,
        rings: 5,
        spokes: 8,
        twist: 0.6,
        roundness: 1,
        surfaceWarp: 2.6,
        tileLevel: 0.18,
        tileSat: 0.86,
        tileSpectrum: 0.36,
        groutWidth: 0.09,
        groutLevel: 0.26,
        fogNear: 0.03,
        fogFar: 0.75,
        centerGlow: 0.24,
        beatPulse: 0.55,
        beatBright: 0.22,
        vignette: 0.6,
      },
    },
    // Gallery — the cover wall headline: big well-lit art panels framed by
    // grout, cruising slowly so every cover can be read as it slides past.
    {
      id: "gallery",
      name: "Gallery",
      values: {
        coverWall: 1,
        speed: 0.1,
        rings: 4.5,
        spokes: 6,
        twist: 0.2,
        tileLevel: 0.14,
        tileSpectrum: 0.3,
        checker: 0,
        groutWidth: 0.045,
        groutLevel: 0.3,
        roundness: 0.5,
        surfaceWarp: 0.3,
        centerGlow: 0.3,
        beatPulse: 0.5,
        beatBright: 0.1,
        fogFar: 0.8,
        vignette: 0.4,
      },
    },
    // Interchange — the junction look: fast transit tube where side-bore
    // mouths strobe with the kick as they whip past.
    {
      id: "interchange",
      name: "Interchange",
      values: {
        junction: 1,
        hue: 210,
        hueSpread: 50,
        speed: 0.7,
        rings: 8,
        twist: 0.3,
        cruiseFloor: 0.6,
        cruiseEnergy: 1.2,
        beatPulse: 0.85,
        beatBright: 0.26,
        pulseWidth: 12,
        tileSpectrum: 0.4,
        groutLevel: 0.2,
        fogFar: 0.85,
        centerGlow: 0.4,
      },
    },
    // Slipstream — the colorFade look: the palette permanently mid-crossfade
    // (fade 1) over a wide spread, so colour pours down the bore instead of
    // switching — an iridescent oil-slick tube.
    {
      id: "slipstream",
      name: "Slipstream",
      values: {
        colorFade: 1,
        hue: 280,
        hueSpread: 180,
        speed: 0.55,
        rings: 10,
        twist: 1.2,
        roundness: 0.45,
        surfaceWarp: 0.9,
        tileSat: 0.9,
        tileSpectrum: 0.4,
        groutLevel: 0.16,
        centerGlow: 0.5,
        beatPulse: 0.6,
        fogFar: 0.9,
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
      default: 15,
      hint: "Base tunnel color",
    },
    {
      key: "hueSpread",
      label: "Hue spread",
      group: "color",
      min: 0,
      max: 240,
      step: 1,
      default: 70,
      hint: "Color variation between ring rows",
    },
    {
      // Default 0 = the hard palette step every saved look renders today. The
      // shader skips the blend branch entirely at 0, so old projects (and every
      // factory style, none of which set this) stay bit-identical.
      key: "colorFade",
      label: "Color fade",
      group: "color",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      hint: "Smooths the tunnel's color transitions — 0 is a hard switch, 1 crossfades continuously",
    },
    {
      key: "speed",
      label: "Speed",
      group: "motion",
      // Max was 1 through v2.65; the owner wanted real velocity headroom, so
      // the range doubled. Pure multiplier on u.time — every saved value
      // renders identically, and the shader derates ring contrast above the
      // OLD ceiling so the new top end streams instead of strobing.
      min: 0.05,
      max: 2,
      step: 0.05,
      default: 0.15,
      hint: "Base flight speed into the tunnel",
    },
    {
      key: "rings",
      label: "Ring density",
      group: "shape",
      min: 3,
      max: 14,
      step: 0.5,
      default: 7,
      hint: "How many tile rows are visible in the depth",
    },
    {
      key: "spokes",
      label: "Spokes",
      group: "shape",
      min: 4,
      max: 24,
      step: 2,
      default: 12,
      hint: "Tile columns around the tunnel wall",
    },
    {
      // Default 0 = the shipped tile math, kept verbatim in the shader's
      // untaken-branch path — old looks render bit-identically without
      // storing a value. Values are permanent: new materials append.
      key: "material",
      label: "Wall material",
      group: "shape",
      control: "enum",
      mod: "off",
      options: [
        { value: 0, label: "Tiles", hint: "The classic lit ceramic grid" },
        { value: 1, label: "Hex", hint: "Staggered honeycomb plates with per-cell shimmer" },
        {
          value: 2,
          label: "Wireframe",
          hint: "No wall at all — a glowing vector lattice with hot crossing nodes",
        },
        {
          value: 3,
          label: "Organic",
          hint: "A living bore — peristaltic tissue and branching veins instead of tiles",
        },
      ],
      min: 0,
      max: 3,
      step: 1,
      default: 0,
      hint: "What the wall is built from — Tiles is the shipped ceramic; the others rebuild the surface",
    },
    {
      key: "beatPulse",
      label: "Beat pulse",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.7,
      hint: "Each beat sends a ring of light flying into the tunnel",
    },
    {
      // Default 0 = no junctions, and the whole block is guarded off — the
      // straight uninterrupted bore every saved look renders today.
      key: "junction",
      label: "Junctions",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      hint: "Cuts side-bore mouths into the wall ahead — they flash on the beat and race past like passing platforms",
    },
    {
      // Default 0 = the straight bore every project saved before this param
      // existed — old looks render identically without storing a value.
      key: "curve",
      label: "Curve",
      group: "motion",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0,
      hint: "Bends the tube's path like a waterslide — 0 keeps it straight",
    },
    {
      // Default 0 = no art on the wall; the block is guarded off AND gated on
      // hasCover(), so tracks without embedded art keep the bare material.
      key: "coverWall",
      label: "Cover wall",
      group: "image",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      hint: "Papers every wall cell with the track's cover art — an album mosaic wrapped around you, streaming past",
    },
    {
      // Promoted from Advanced (v2.76, pure spec move): the curated tier
      // covered shape/color/motion/reaction but had no glow handle at all.
      key: "centerGlow",
      label: "Center glow",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.2,
      hint: "Glow at the tunnel's vanishing point",
    },
  ],
  advanced: [
    {
      key: "cruiseFloor",
      label: "Cruise floor",
      group: "motion",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      hint: "Minimum speed even in silence",
    },
    {
      key: "curveScale",
      label: "Curve length",
      group: "motion",
      min: 0.25,
      max: 2,
      step: 0.05,
      default: 1,
      hint: "How tight the bends are — low is long sweeping arcs, high is a twisty flume",
    },
    {
      key: "cruiseEnergy",
      label: "Cruise energy",
      group: "reaction",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.9,
      hint: "How much track loudness raises speed",
    },
    {
      key: "beatSpeed",
      label: "Beat speed kick",
      group: "reaction",
      min: 0,
      max: 0.5,
      step: 0.02,
      default: 0.08,
      hint: "Brief acceleration on each beat",
    },
    {
      key: "tileLevel",
      label: "Tile level",
      group: "backdrop",
      tier: "curated",
      min: 0,
      max: 0.4,
      step: 0.01,
      default: 0.1,
      hint: "Base tile brightness with no music",
    },
    {
      key: "tileSpectrum",
      label: "Tile spectrum",
      group: "color",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.25,
      hint: "How strongly the spectrum lights tiles at their angle",
    },
    {
      key: "pulseWidth",
      label: "Pulse width",
      group: "reaction",
      min: 2,
      max: 20,
      step: 0.5,
      default: 9,
      hint: "Thickness of the traveling beat ring (higher = tighter)",
    },
    {
      key: "tileSat",
      label: "Tile saturation",
      group: "color",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.75,
      hint: "Tile color intensity",
    },
    {
      key: "checker",
      label: "Checker contrast",
      group: "backdrop",
      min: 0,
      max: 0.3,
      step: 0.01,
      default: 0.06,
      hint: "Brightness difference of alternating tiles",
    },
    {
      key: "groutWidth",
      label: "Grout width",
      group: "shape",
      min: 0.01,
      max: 0.2,
      step: 0.005,
      default: 0.055,
      hint: "Thickness of the lines between tiles",
    },
    {
      key: "groutLevel",
      label: "Grout level",
      group: "backdrop",
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.1,
      hint: "Grout line brightness between beats",
    },
    {
      key: "fogNear",
      label: "Fog near",
      group: "backdrop",
      min: 0.005,
      max: 0.1,
      step: 0.001,
      default: 0.012,
      hint: "How close to the center tiles fade into darkness",
    },
    {
      key: "fogFar",
      label: "Fog reach",
      group: "backdrop",
      min: 0.3,
      max: 0.95,
      step: 0.05,
      default: 0.7,
      hint: "Where the tunnel starts fading toward the screen edges",
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
    {
      key: "mirror",
      label: "Club mirror",
      group: "shape",
      control: "enum",
      mod: "snap",
      options: [
        { value: 1, label: "Off" },
        { value: 2, label: "Mirrored" },
        { value: 3, label: "3 segments" },
        { value: 4, label: "4 segments" },
        { value: 5, label: "5 segments" },
        { value: 6, label: "6 segments" },
        { value: 7, label: "7 segments" },
        { value: 8, label: "8 segments" },
        { value: 9, label: "9 segments" },
        { value: 10, label: "10 segments" },
        { value: 11, label: "11 segments" },
        { value: 12, label: "12 segments" },
      ],
      min: 1,
      max: 12,
      step: 1,
      default: 1,
      hint: "Fold the tunnel into mirrored wedges — 1 is off, 2 mirrors left/right, higher makes a kaleidoscope",
    },
    {
      key: "twist",
      label: "Corkscrew",
      group: "shape",
      min: 0,
      max: 3,
      step: 0.05,
      default: 0.8,
      hint: "Spirals the flutes down the tube like a waterslide auger",
    },
    {
      key: "roundness",
      label: "Roundness",
      group: "shape",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.6,
      hint: "Cylinder shading — a lit and a shadowed side so the wall reads as curved, not flat",
    },
    {
      key: "surfaceWarp",
      label: "Surface texture",
      group: "shape",
      min: 0,
      max: 3,
      step: 0.05,
      default: 1.2,
      hint: "Worn/wet surface detail on the tube wall",
    },
    {
      key: "beatBright",
      label: "Beat flash",
      group: "reaction",
      min: 0,
      max: 0.6,
      step: 0.01,
      default: 0.15,
      hint: "Whole tunnel wall brightens on each beat, on top of the travelling ring",
    },
  ],
  wgsl: /* wgsl */ `
// The tube's centreline as a lateral offset (tube-radius units) per unit of
// TRAVEL distance -- two incommensurate sines per axis, so the path bends
// left, right, up and down without visibly repeating. A function of travel,
// never of time: the bend is a fixed property of the tube itself, which is
// what makes preview === export trivial and lets a parked camera (speed 0,
// silence) stand mid-bend with zero drift.
fn tubePath(s: f32) -> vec2f {
  // Frequencies are deliberately LOW: the screen-space remap below is only
  // injective while path-slope * visible-depth stays near 1, so tighter
  // bends here would not read as tighter bends -- they would fold the
  // centre of the frame over itself (observed live before the retune).
  return vec2f(sin(s * 0.34) + 0.60 * sin(s * 0.121),
               cos(s * 0.26) + 0.60 * sin(s * 0.089)) * 0.35;
}

// Analytic d/ds of tubePath: the camera's forward tangent along the bend.
fn tubePathD(s: f32) -> vec2f {
  return vec2f(0.340 * cos(s * 0.34) + 0.073 * cos(s * 0.121),
               -0.260 * sin(s * 0.26) + 0.053 * cos(s * 0.089)) * 0.35;
}

// Hexagon edge distance for the Hex wall material: p is the offset from a
// cell centre in lattice units (lattice pitch (1, sqrt(3)), cell "radius"
// 0.5 toward every neighbour). 0 on the cell border, 0.5 at the centre --
// the honeycomb analogue of min(d, 1 - d) on the square tile grid.
fn hexEdge(p: vec2f) -> f32 {
  let q = abs(p);
  return 0.5 - max(dot(q, vec2f(0.5, 0.8660254)), q.x);
}

fn preset(uv: vec2f) -> vec4f {
  // Club mirror folds the tube into radial wedges. 1 = off.
  let mirrorN = P_mirror();
  var p = kaleido(centered(uv), mirrorN);

  // Beat kick, tempo-grid locked with a flux fallback.
  let kickP = max(u.driveBeat, gridPulse(6.0));

  // POSITION gets its own beat envelope. kickP's instant attack is right for
  // brightness pops and wrong for travel: the camera crossing the whole shove
  // distance in one frame is the owner's "camera is just teleporting". With a
  // tempo grid the shove rises over the first tenth of the beat and has
  // decayed to zero by the wrap, so travel is CONTINUOUS across every beat
  // boundary (the 1.5 restores unit peak -- rise*decay tops out near 0.66 at
  // phase 0.1). Without a grid there is no phase to ease across (determinism
  // forbids accumulated smoothing), so driveBeat's attack stays and the
  // saturated amplitude below keeps it a nudge rather than a jump.
  var kickPos = u.driveBeat;
  if (u.bpm > 0.5) {
    kickPos = 1.5 * smoothstep(0.0, 0.1, u.beatPhase)
            * max(exp(-u.beatPhase * 4.0) - 0.018, 0.0) / 0.982;
  }

  // What multiplies u.time is PARAMS-ONLY. Folding u.drive/kickP into the speed
  // made travel = t*v(t) instead of the integral of v, so every change in
  // loudness snapped the whole wall forward or back by t*(speed change): fine
  // in the first seconds, a hard stutter/strobe after ~30 s of track. Loudness
  // and beats are now BOUNDED additive travel offsets — they still shove you
  // down the pipe, but the ring pattern can never be re-seeded mid-track.
  // The beat shove is GATED by the pulse master and SATURATES: softLimit is
  // identity through the whole default range (0.08 * pulse 2 sits far below
  // the 0.288 knee, so stock feel is untouched), while Beat speed kick maxed
  // out at pulse 200% lands on the 0.4-depth-unit ceiling instead of shoving
  // a full depth unit -- punchy, never a teleport.
  let travelT = u.time * P_speed() * P_cruiseFloor() * 2.2
              + u.drive * P_cruiseEnergy() * 0.3
              + kickPos * softLimit(P_beatSpeed() * u.pulse, 0.4);

  // Waterslide curvature: the cross-section centre this fragment belongs to
  // is displaced by where the centreline sits at the fragment's depth,
  // relative to where the camera sits now. A wall point at depth z projects
  // to (C(t + z) - C(t)) / z - lean: bends ahead sweep the far tube off
  // centre while the mouth around the viewer stays put -- exactly the
  // water-slide view. "lean" is the camera looking along its own tangent,
  // slightly exaggerated (1.15) so the vanishing point swings against each
  // bend and the near field tips the other way; the lean is what sells
  // "riding the slide" over "watching a bent pipe". Deliberately NOT gated by
  // u.spin: this is orientation of travel, not decoration rotation.
  var q = p;
  let curveAmt = P_curve();
  if (curveAmt > 1e-4) {
    let cw = P_curveScale();
    let cam = tubePath(travelT * cw) * curveAmt;
    let lean = tubePathD(travelT * cw) * (cw * curveAmt * 1.15);
    // The path is sampled at the STRAIGHT-tube depth, once, explicitly. The
    // exact bent depth would be a fixed-point problem (depth depends on the
    // bent centre depends on depth), and solving it was tried and rejected
    // live: where the bend rate approaches the contraction limit the
    // iteration stops converging and the centre of the frame collapses into
    // a flat untextured disc (and softLimit's tanh fed with depth 500
    // overflowed exp() on the GPU into NaN specks). The explicit map is the
    // classic demoscene form: geometrically first-order, visually identical
    // in motion, and it degrades gracefully -- extreme Curve x Curve length
    // gives a slight lens-like stretch near the centre, never an artifact
    // disc. The depth cap at 5 makes the offset CONSTANT for the far field:
    // past it the tube continues as a rigid shift (the vanishing point
    // parked off-centre), which fog has mostly swallowed anyway.
    let cz = min(1.0 / max(length(p), 2e-3), 5.0);
    let off = (tubePath((travelT + cz) * cw) * curveAmt - cam) / cz - lean;
    q = p - off;
  }
  let r = max(length(q), 2e-3);
  let a = atan2(q.y, q.x);

  // Depth. 1/r is the pinhole distance down the axis of a cylinder: the centre
  // of the frame (r -> 0) is infinitely far, the frame edge is the near mouth
  // of the tube. Adding time streams every wall feature from the vanishing
  // point OUTWARD toward the viewer -- the actual motion of flying down a
  // pipe, not a texture being zoomed.
  let depth = 1.0 / r;
  let travel = depth + travelT;
  // Corkscrew: flutes spiral with depth like a waterslide auger.
  let aTwist = a + travel * P_twist() * 0.15;

  // Spectrum around the circumference, keyed to the wall angle rather than to
  // aTwist so it sits where the ear expects regardless of the corkscrew.
  //
  // ...but a is read off the coordinate AFTER kaleido() folded it, and the
  // fold does not preserve the angle's RANGE: it collapses the whole circle
  // onto one fundamental domain — the half-plane [-pi/2, pi/2] at Club mirror 2
  // (which is abs(p.x), not the N=2 case of the wedge formula), and the wedge
  // [0, pi/N] at N >= 3. Pushing that folded angle through the UNFOLDED mapping
  // below therefore addressed a SLICE of the spectrum and nothing outside it:
  // [0, 0.5] at mirror 2 and [0, 1/N] at N >= 3, i.e. bins 0-15 of 96 at the
  // shipped Kaleido Tube (mirror 6) and 8 bins at mirror 12. Kaleido Tube is
  // described in its own entry above as "spectrum-lit stained glass" and lit
  // exclusively on the bottom sixth of the spectrum — no mid, no treble, a
  // stained glass window that could only hear the kick drum.
  //
  // So the FOLDED case rescales the domain kaleido() actually leaves reachable
  // onto the whole spectrum, keyed off THE SAME two thresholds kaleido() itself
  // branches on (1.5 = fold at all, 2.5 = radial wedges rather than a plain
  // left/right mirror). Every wedge then carries one complete bass-to-treble
  // sweep, which is what a kaleidoscope OF a spectrum should be.
  //
  // Seam-free by construction, and for the same reason the unfolded line was
  // already written as a triangle: the fold is a MIRROR, so the folded angle
  // runs 0 -> span -> 0 -> span round the circle, and a linear rescale of it is
  // exactly the abs(seg * 2 - 1) sweep the unfolded branch performs by hand —
  // bass meeting bass at one wedge edge, treble meeting treble at the next.
  // Above the fold does the reflecting; below the preset does it itself.
  //
  // Curve addendum: kaleido() folded p into the fundamental domain, but the
  // angle is read off q — the BENT frame — so with curvature the local angle
  // can step outside that domain. The folded branch therefore MIRRORS
  // out-of-domain angles back in (the same reflection the fold itself
  // performs, in triangle form) instead of clamping, which would pin a
  // whole arc of wall to bin 0 or bin 95 mid-bend. Inside [0, 1] the
  // triangle IS the identity, so a straight tube renders bit-identically.
  let folded = mirrorN >= 1.5;
  let foldLo = select(TAU * -0.25, 0.0, mirrorN >= 2.5);
  let foldSpan = select(TAU * 0.5, TAU * 0.5 / mirrorN, mirrorN >= 2.5);
  let xs = select(abs(fract(a / TAU + 0.5) * 2.0 - 1.0),
                  abs(fract(((a - foldLo) / foldSpan + 1.0) * 0.5) * 2.0 - 1.0), folded);
  let v = binAt(xs);
  let pk = peakAt(xs);

  // Cosine palette by depth -- consecutive rings are related, saturated
  // colours instead of a drifting hue (a drifting hue is how this went muddy).
  let t = fract(travel * 0.05 + P_hue() / 360.0);
  let spread = max(P_hueSpread() / 360.0, 0.08);
  var pal = cosPalette(t, vec3f(0.5), vec3f(0.5), vec3f(1.0) * spread, ${WGSL_PALETTE_PHASE});

  // Color fade. cosPalette's frequency vector is "spread" -- non-integer over
  // its whole range -- so cosPalette(1-) != cosPalette(0+) and the fract wrap
  // above is a hard colour step. travel is per-pixel (depth = 1/r), so that
  // step is a RING in screen space sweeping outward as travelT advances: the
  // owner's "abrupt colour switch". The fix crossfades across the wrap
  // between THE SAME curve one period apart -- cosPalette(t) against
  // cosPalette(t -/+ 1), i.e. exactly outgoing colour against incoming
  // colour -- inside a window of width P_colorFade() centred on the wrap.
  // uw is the signed distance to the nearest wrap and is CONTINUOUS through
  // it (t: 1- -> 0+ maps to uw: 0- -> 0+), so the mix passes through 50/50
  // exactly at the seam: C0-continuous in travel for any fade > 0.
  // smoothstep's flat ends make the window edges seamless too, and outside
  // the window mw is exactly 0, so the wall matches the unfaded palette
  // there bit-for-bit. At fade 1 the window spans the whole period -- the
  // wall is permanently mid-crossfade. Guarded so fade 0 (the default, every
  // factory style, every saved look) never touches pal at all, and the one
  // extra cosPalette eval is only paid when the fade is actually on.
  let fadeW = P_colorFade();
  if (fadeW > 1e-4) {
    let hw = fadeW * 0.5;
    let uw = t - select(0.0, 1.0, t >= 0.5);
    let m = smoothstep(-hw, hw, uw);
    let mw = 0.5 - abs(m - 0.5);
    let palIn = cosPalette(t - select(-1.0, 1.0, t >= 0.5),
                           vec3f(0.5), vec3f(0.5), vec3f(1.0) * spread, ${WGSL_PALETTE_PHASE});
    pal = mix(pal, palIn, mw);
  }

  // Circular rings stacked in depth, rushing outward past the viewer. Thin
  // BRIGHT bands on a dark wall (high contrast) read as pipe segments flying
  // by -- the previous version summed everything to a flat wash.
  let ringF = travel * P_rings() * 0.35;
  let ringD = fract(ringF);
  let ringLine = smoothstep(P_groutWidth() * 1.6, 0.0, min(ringD, 1.0 - ringD));
  let ringParity = f32(i32(floor(ringF)) & 1);

  // The speed range tops out at 2x its old ceiling. The sustained ring pass
  // rate is PARAMS-ONLY (audio only adds bounded offsets, never sustained
  // rate), so it can be derated deterministically: above ~11 rings/s — just
  // past the old ceiling of 10.78, unreachable by any saved look — radial
  // bands cross a third of a period per 24 fps export frame and strobe
  // instead of streaming. Ring structure (lines + parity checker) fades to
  // 30% there; flutes, palette drift and fog are angular/low-frequency and
  // keep carrying the sense of speed without aliasing.
  let ringRate = P_speed() * P_cruiseFloor() * 2.2 * P_rings() * 0.35;
  let ringVis = 1.0 - 0.7 * smoothstep(11.0, 21.0, ringRate);

  // Longitudinal flutes running down the tube LENGTH and converging at the
  // vanishing point. Converging perspective lines are the single strongest
  // "this is a round 3D tube" cue.
  let fluteF = aTwist / TAU * P_spokes();
  let fluteD = fract(fluteF);
  let fluteLine = smoothstep(P_groutWidth() * 2.2, 0.0, min(fluteD, 1.0 - fluteD));
  let fluteShade = 0.5 + 0.5 * cos(fluteF * TAU);

  // Wall surface texture, scrolling WITH the wall so it reads as a worn/wet
  // surface rather than a flat gradient.
  let surf = warpFbm(vec2f(a / TAU * 5.0, travel * 0.4), P_surfaceWarp() * (0.4 + u.mid * 0.8));

  // Cylinder shading: light the round cross-section from one side so there is
  // a lit stripe and a shadowed stripe around the circumference -- the wall
  // curves away instead of reading flat.
  let round = mix(1.0, 0.3 + 0.7 * (0.5 + 0.5 * cos(a - 2.2)), P_roundness());

  // Wall base: DARK, lifted by structure + spectrum. Alternating ring parity
  // (checker) gives neighbouring segments distinct tone so travel reads.
  var lit = P_tileLevel() * (0.55 + ringParity * P_checker() * ringVis)
          + fluteShade * 0.22
          + surf * 0.3
          + v * P_tileSpectrum();
  var seam = max(ringLine * ringVis, fluteLine);
  var seamLevel = P_groutLevel();

  // --- Wall material (v2.76 depth wave) -----------------------------------
  // Tiles (0, the default) is the shipped math above, verbatim -- no branch
  // taken, bit-identical. The other materials only rewrite the fragment-local
  // wall fields (lit / seam / seamLevel); palette, cylinder shade, fog, beat
  // ring and core stay shared, so every material lives in the same tube.
  let wallMat = P_material();
  if (wallMat > 2.5) {
    // Organic -- the gullet. The grid dissolves: a domain-warped tissue field
    // displaces soft peristaltic waves down the bore, and its contour band
    // runs along the wall as branching veins (Grout width sets vein reach,
    // Surface texture how gnarled the tissue is). The angle enters MIRRORED
    // (the same triangle fold the spectrum mapping uses) because fbm is not
    // periodic in a/TAU -- the fold keeps the tissue seamless round the wall.
    let am = abs(fract(a / TAU + 0.5) * 2.0 - 1.0);
    let tis = warpFbm(vec2f(am * 3.0, travel * 0.22), 1.2 + P_surfaceWarp() * 0.9);
    let flesh = 0.5 + 0.5 * cos((ringF * 0.25 + tis * 1.1) * TAU);
    // Veins are CONTOUR LINES of the tissue -- several iso-levels via fract,
    // so they branch and pinch where the field bends (a single wide band
    // around one level read as a flat wash, tried live). Line width breathes
    // with the field's own gradient, which is what makes them organic.
    let lvl = abs(fract(tis * 3.0 + 0.5) - 0.5) * 0.333;
    let vein = smoothstep(P_groutWidth() * 1.1, 0.0, lvl);
    lit = P_tileLevel() * 0.7 + flesh * 0.34 + surf * 0.22 + v * P_tileSpectrum();
    seam = vein * (0.35 + 0.65 * flesh);
  } else if (wallMat > 1.5) {
    // Wireframe -- the wall vanishes: a vector lattice over the void.
    // Gaussian line profiles (not smoothstep bars) give the wires a bloom-
    // like halo, and crossings carry a hot node the peaks blow out. Ring
    // wires keep the sustained-speed derate (ringVis) exactly like tile rows.
    let lw = max(P_groutWidth(), 0.012);
    let rgd = min(ringD, 1.0 - ringD);
    let fgd = min(fluteD, 1.0 - fluteD);
    let ringGlow = exp(-rgd * rgd / (lw * lw * 3.0)) * ringVis;
    let fluteGlow = exp(-fgd * fgd / (lw * lw * 5.5));
    lit = P_tileLevel() * 0.12 + surf * 0.05 + v * P_tileSpectrum() * 0.2;
    seam = ringGlow + fluteGlow + ringGlow * fluteGlow * (1.5 + pk * 3.0);
    // The lattice IS the wall, so the wires get a floor the grout slider
    // cannot dim to nothing -- a wireframe with no wires is an empty screen.
    seamLevel = P_groutLevel() * 1.3 + 0.15;
  } else if (wallMat > 0.5) {
    // Hex -- staggered honeycomb plates: two interleaved rect lattices make
    // the hex grid; whichever candidate centre is nearer owns the fragment
    // (the classic two-lattice hex trick, in unwrapped wall space).
    let hx = vec2f(fluteF, ringF * 0.8660254);
    let latR = vec2f(1.0, 1.7320508);
    let ia = floor(hx / latR);
    let ib = floor(hx / latR + vec2f(0.5));
    let ga = hx - (ia + vec2f(0.5)) * latR;
    let gb = hx - ib * latR;
    let useA = dot(ga, ga) < dot(gb, gb);
    let gv = select(gb, ga, useA);
    let edge = hexEdge(gv);
    // Per-cell tone seed, integer-exact and wrap-safe: the angular index
    // wraps modulo Spokes so the cell straddling the angle seam keeps ONE
    // tone (fract(rawIndex / spokes) differs across the wrap by f32
    // rounding), and the row index -- odd rows lattice A, even lattice B --
    // wraps mod 64 so hash21 never sees the huge phases that lose mantissa
    // late in long tracks (grain()'s fract(u.time) precedent).
    let spokeN = max(P_spokes(), 4.0);
    let ix = select(ib.x, ia.x, useA);
    let ixw = ix - spokeN * floor(ix / spokeN);
    let iy = select(ib.y * 2.0, ia.y * 2.0 + 1.0, useA);
    let iyw = iy - 64.0 * floor(iy / 64.0);
    let cellTone = hash21(vec2f(ixw + 0.13, iyw + 0.57));
    // Plate shading: face lit toward the centre, shadowed toward the border
    // (pressed metal), per-cell tone shimmer on the checker knob, seams on
    // the honey borders. Flutes are gone -- the lattice is the structure.
    let bevel = smoothstep(0.0, 0.4, edge);
    lit = P_tileLevel() * (0.5 + cellTone * P_checker() * 3.0 * ringVis)
        + bevel * 0.2
        + surf * 0.24
        + v * P_tileSpectrum();
    seam = smoothstep(P_groutWidth() * 1.8, 0.0, edge) * ringVis;
  }

  var col = pal * lit * (0.35 + P_tileSat() * 0.9) * round;

  // Cover-art wall (opt-in): every wall cell papers itself with the track's
  // cover -- an album mosaic wrapped around the bore, streaming past. The art
  // rides the SAME rect cell grid whatever the material (fluteD/ringD are
  // cell-local 0..1), fitted with the shared cover machinery (crop fit, no
  // pan -- the cell is the frame), and multiplied by the wall's own light and
  // cylinder shade so it reads as PRINTED ON the wall rather than floated
  // over it. Both cell axes are flipped so the art reads right on the FLOOR
  // -- the surface the eye rests on: 1-ringD puts the image top at the far
  // edge (road-marking convention, read as it approaches) and 1-fluteD makes
  // u grow screen-right there; a tube wrap cannot also unmirror the ceiling.
  // hasCover() gates the block, so a track without art keeps the bare
  // material; the 0.92 ceiling keeps a breath of palette in the mix so the
  // mosaic still belongs to the tunnel's colour world.
  let cwall = P_coverWall();
  if (cwall > 1e-4 && hasCover()) {
    let cuv = fitUV(vec2f(1.0 - fluteD, 1.0 - ringD), coverAspect(), 1.0, 0.0, 1.0, vec2f(0.0));
    let art = coverSample(cuv).rgb;
    col = mix(col, art * (0.3 + lit * 1.4) * round, cwall * 0.92);
  }

  // Bright seams (ring + flute lines), spectrum-lit; the loudest angle's seams
  // flare near-white (a hot desaturated core reads as emitting).
  col += pal * seam * seamLevel * (0.6 + v * 1.6);
  col += vec3f(1.0, 0.98, 0.94) * seam * pk * pk * seamLevel * 1.4;

  // Beat junctions (opt-in): side-bore mouths cut into the wall at fixed
  // TRAVEL stations -- features of the tube like the rings themselves, so a
  // parked camera holds a junction perfectly still and flying makes it race
  // past; no event state accumulates (determinism law). Each station hashes
  // its own angle around the wall; the mouth is a soft hole where the wall
  // light falls away into the side bore, with a rim that catches the palette
  // and a beat flash (grid-locked kickP) that strobes the whole junction as
  // it passes -- a lit platform whipping by. Sits BEFORE the fog on purpose:
  // a junction emerges from the haze ahead exactly like the wall it is cut
  // into.
  let jAmt = P_junction();
  if (jAmt > 1e-4) {
    let jF = travel * 0.3;
    let jI = floor(jF);
    // Station index wraps mod 128 before hashing: hash11 is sin-based and
    // f32 sin degrades on huge phases (grain()'s fract(u.time) precedent).
    let jW = jI - 128.0 * floor(jI / 128.0);
    let jD = fract(jF);
    let jAng = hash11(jW + 0.37) * TAU;
    // Angular distance to the station's side in half-turns (0 = centred on
    // the mouth, 1 = the opposite wall), continuous across the angle wrap.
    let dAng = abs(fract((aTwist - jAng) / TAU + 0.5) * 2.0 - 1.0);
    let mouthA = smoothstep(0.22, 0.1, dAng);
    let mouthD = smoothstep(0.26, 0.13, abs(jD - 0.5));
    let mouth = mouthA * mouthD;
    let jRim = mouth * (1.0 - mouth) * 4.0;
    col = mix(col, pal * 0.02, mouth * jAmt * 0.85);
    col += mix(pal, vec3f(1.0), 0.35) * jRim * jAmt * (0.3 + kickP * 1.3) * (0.5 + v);
    col += pal * mouth * kickP * jAmt * 0.9;
  }

  // Depth cue: near (frame edge) bright, far (centre) recedes into haze. This
  // is what turns a flat disc into a tube you are flying INTO.
  let near = smoothstep(P_fogNear() * 0.4, 0.6, r);
  let far = 1.0 - exp(-depth * P_fogFar() * 0.35);
  col *= near;
  col = mix(col, pal * 0.05, clamp(far, 0.0, 0.9));

  // Travelling beat ring, launched at the viewer and receding to the core.
  var pt = 1.0 - u.driveBeat;
  var amp = u.driveBeat;
  if (u.bpm > 0.5) {
    pt = u.beatPhase;
    amp = max(exp(-u.beatPhase * 3.0) - 0.05, 0.0) / 0.95;
  }
  if (amp > 0.01) {
    let ringR = mix(0.62, 0.05, pt);
    col += mix(pal, vec3f(1.0), 0.5) * exp(-abs(r - ringR) * P_pulseWidth()) * amp * P_beatPulse() * 1.6;
  }

  // Hot vanishing core: the bright far point you are flying toward.
  col += mix(pal, vec3f(1.0), 0.6) * exp(-r * 14.0)
       * (P_centerGlow() + u.drive * 0.5 + kickP * 0.4);

  // Whole-wall beat flash: a brief global lift on each grid beat (kickP is
  // grid-locked with a flux fallback), stacked on top of the travelling ring
  // and hot core — VJ punch that still reads on busy, spectrum-lit walls.
  // Pulse gates it, and the response saturates: defaults live in softLimit's
  // identity region (0.15 * pulse 2 = 0.3, knee 0.54) so nothing changes out
  // of the box, but Beat flash maxed at pulse 200% lifts +75% instead of
  // +120% — a flash, not a full-frame strobe.
  col *= 1.0 + kickP * softLimit(P_beatBright() * u.pulse, 0.75);

  col *= vignette(uv, P_vignette());
  col = tonemap(col * 1.25);
  col += grain(uv, 0.012);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
