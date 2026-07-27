import type { PresetDef } from "../types";

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
      key: "speed",
      label: "Speed",
      group: "motion",
      min: 0.05,
      max: 1,
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
      key: "beatPulse",
      label: "Beat pulse",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.7,
      hint: "Each beat sends a ring of light flying into the tunnel",
    },
  ],
  advanced: [
    {
      key: "cruiseFloor",
      label: "Cruise floor",
      group: "motion",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.35,
      hint: "Minimum speed even in silence",
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
      step: 0.02,
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
      step: 0.02,
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
      step: 0.005,
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
      key: "centerGlow",
      label: "Center glow",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.2,
      hint: "Glow at the tunnel's vanishing point",
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
      step: 0.02,
      default: 0.15,
      hint: "Whole tunnel wall brightens on each beat, on top of the travelling ring",
    },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  // Club mirror folds the tube into radial wedges. 1 = off.
  var p = kaleido(centered(uv), P_mirror());
  let r = max(length(p), 2e-3);
  let a = atan2(p.y, p.x);

  // Beat kick, tempo-grid locked with a flux fallback.
  let kickP = max(u.driveBeat, gridPulse(6.0));

  // Depth. 1/r is the pinhole distance down the axis of a cylinder: the centre
  // of the frame (r -> 0) is infinitely far, the frame edge is the near mouth
  // of the tube. Adding time streams every wall feature from the vanishing
  // point OUTWARD toward the viewer -- the actual motion of flying down a
  // pipe, not a texture being zoomed.
  let depth = 1.0 / r;
  // What multiplies u.time is PARAMS-ONLY. Folding u.drive/kickP into the speed
  // made travel = t*v(t) instead of the integral of v, so every change in
  // loudness snapped the whole wall forward or back by t*(speed change): fine
  // in the first seconds, a hard stutter/strobe after ~30 s of track. Loudness
  // and beats are now BOUNDED additive travel offsets — they still shove you
  // down the pipe, but the ring pattern can never be re-seeded mid-track.
  let travel = depth + u.time * P_speed() * P_cruiseFloor() * 2.2
             + u.drive * P_cruiseEnergy() * 0.3
             + kickP * P_beatSpeed() * u.pulse;
  // Corkscrew: flutes spiral with depth like a waterslide auger.
  let aTwist = a + travel * P_twist() * 0.15;

  // Spectrum around the circumference, keyed to the true screen angle so it
  // sits where the ear expects regardless of the corkscrew.
  let xs = abs(fract(a / TAU + 0.5) * 2.0 - 1.0);
  let v = binAt(xs);
  let pk = peakAt(xs);

  // Cosine palette by depth -- consecutive rings are related, saturated
  // colours instead of a drifting hue (a drifting hue is how this went muddy).
  let t = fract(travel * 0.05 + P_hue() / 360.0);
  let spread = max(P_hueSpread() / 360.0, 0.08);
  let pal = cosPalette(t, vec3f(0.5), vec3f(0.5), vec3f(1.0) * spread, vec3f(0.0, 0.33, 0.67));

  // Circular rings stacked in depth, rushing outward past the viewer. Thin
  // BRIGHT bands on a dark wall (high contrast) read as pipe segments flying
  // by -- the previous version summed everything to a flat wash.
  let ringF = travel * P_rings() * 0.35;
  let ringD = fract(ringF);
  let ringLine = smoothstep(P_groutWidth() * 1.6, 0.0, min(ringD, 1.0 - ringD));
  let ringParity = f32(i32(floor(ringF)) & 1);

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
  var lit = P_tileLevel() * (0.55 + ringParity * P_checker())
          + fluteShade * 0.22
          + surf * 0.3
          + v * P_tileSpectrum();
  var col = pal * lit * (0.35 + P_tileSat() * 0.9) * round;

  // Bright seams (ring + flute lines), spectrum-lit; the loudest angle's seams
  // flare near-white (a hot desaturated core reads as emitting).
  let seam = max(ringLine, fluteLine);
  col += pal * seam * P_groutLevel() * (0.6 + v * 1.6);
  col += vec3f(1.0, 0.98, 0.94) * seam * pk * pk * P_groutLevel() * 1.4;

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
  col *= 1.0 + kickP * P_beatBright() * u.pulse;

  col *= vignette(uv, P_vignette());
  col = tonemap(col * 1.25);
  col += grain(uv, 0.012);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
