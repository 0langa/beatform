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
    { id: "ember", name: "Ember", values: {} },
    {
      id: "cyber",
      name: "Cyber Grid",
      values: { hue: 190, hueSpread: 40, spokes: 16, beatPulse: 0.85 },
    },
    { id: "deepsea", name: "Deep Sea", values: { hue: 220, speed: 0.1, beatPulse: 0.45 } },
    {
      id: "inferno",
      name: "Inferno",
      values: { hue: 0, hueSpread: 30, speed: 0.3, beatPulse: 0.9 },
    },
    {
      id: "hyper",
      name: "Hyperdrive",
      values: {
        hue: 265,
        hueSpread: 80,
        speed: 0.55,
        rings: 11,
        spokes: 20,
        twist: 1.8,
        beatSpeed: 0.22,
        beatPulse: 0.9,
        fogFar: 1.0,
      },
    },
    {
      id: "pearl",
      name: "Pearl",
      values: {
        hue: 210,
        hueSpread: 15,
        tileSat: 0.15,
        checker: 0.12,
        groutLevel: 0.3,
        centerGlow: 0.35,
        beatPulse: 0.5,
        tileLevel: 0.14,
      },
    },
  ],
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 15, hint: "Base tunnel color" },
    {
      key: "hueSpread",
      label: "Hue spread",
      min: 0,
      max: 240,
      step: 1,
      default: 70,
      hint: "Color variation between ring rows",
    },
    {
      key: "speed",
      label: "Speed",
      min: 0.05,
      max: 1,
      step: 0.05,
      default: 0.15,
      hint: "Base flight speed into the tunnel",
    },
    {
      key: "rings",
      label: "Ring density",
      min: 3,
      max: 14,
      step: 0.5,
      default: 7,
      hint: "How many tile rows are visible in the depth",
    },
    {
      key: "spokes",
      label: "Spokes",
      min: 4,
      max: 24,
      step: 2,
      default: 12,
      hint: "Tile columns around the tunnel wall",
    },
    {
      key: "beatPulse",
      label: "Beat pulse",
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
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.35,
      hint: "Minimum speed even in silence",
    },
    {
      key: "cruiseEnergy",
      label: "Cruise energy",
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.9,
      hint: "How much track loudness raises speed",
    },
    {
      key: "beatSpeed",
      label: "Beat speed kick",
      min: 0,
      max: 0.5,
      step: 0.02,
      default: 0.08,
      hint: "Brief acceleration on each beat",
    },
    {
      key: "tileLevel",
      label: "Tile level",
      min: 0,
      max: 0.4,
      step: 0.01,
      default: 0.1,
      hint: "Base tile brightness with no music",
    },
    {
      key: "tileSpectrum",
      label: "Tile spectrum",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.25,
      hint: "How strongly the spectrum lights tiles at their angle",
    },
    {
      key: "pulseWidth",
      label: "Pulse width",
      min: 2,
      max: 20,
      step: 0.5,
      default: 9,
      hint: "Thickness of the traveling beat ring (higher = tighter)",
    },
    {
      key: "tileSat",
      label: "Tile saturation",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.75,
      hint: "Tile color intensity",
    },
    {
      key: "checker",
      label: "Checker contrast",
      min: 0,
      max: 0.3,
      step: 0.01,
      default: 0.06,
      hint: "Brightness difference of alternating tiles",
    },
    {
      key: "groutWidth",
      label: "Grout width",
      min: 0.01,
      max: 0.2,
      step: 0.005,
      default: 0.055,
      hint: "Thickness of the lines between tiles",
    },
    {
      key: "groutLevel",
      label: "Grout level",
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.1,
      hint: "Grout line brightness between beats",
    },
    {
      key: "fogNear",
      label: "Fog near",
      min: 0.005,
      max: 0.1,
      step: 0.005,
      default: 0.012,
      hint: "How close to the center tiles fade into darkness",
    },
    {
      key: "fogFar",
      label: "Fog reach",
      min: 0.3,
      max: 0.95,
      step: 0.05,
      default: 0.7,
      hint: "Where the tunnel starts fading toward the screen edges",
    },
    {
      key: "centerGlow",
      label: "Center glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.2,
      hint: "Glow at the tunnel's vanishing point",
    },
    {
      key: "vignette",
      label: "Vignette",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.3,
      hint: "Darkening toward the screen corners",
    },
    {
      key: "mirror",
      label: "Club mirror",
      min: 1,
      max: 12,
      step: 1,
      default: 1,
      hint: "Fold the tunnel into mirrored wedges — 1 is off, 2 mirrors left/right, higher makes a kaleidoscope",
    },
    {
      key: "twist",
      label: "Corkscrew",
      min: 0,
      max: 3,
      step: 0.05,
      default: 0.8,
      hint: "Spirals the flutes down the tube like a waterslide auger",
    },
    {
      key: "roundness",
      label: "Roundness",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.6,
      hint: "Cylinder shading — a lit and a shadowed side so the wall reads as curved, not flat",
    },
    {
      key: "surfaceWarp",
      label: "Surface texture",
      min: 0,
      max: 3,
      step: 0.05,
      default: 1.2,
      hint: "Worn/wet surface detail on the tube wall",
    },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  // Club mirror folds the tube into radial wedges. 1 = off.
  var p = kaleido(centered(uv), P_mirror());
  let r = max(length(p), 2e-3);
  let a = atan2(p.y, p.x);

  // Forward speed: a cruising floor plus the sync envelope, kicked on beats.
  let kickP = max(u.driveBeat, gridPulse(6.0));
  let spd = P_speed() * (P_cruiseFloor() + u.drive * P_cruiseEnergy())
          * (1.0 + kickP * P_beatSpeed() * u.pulse);

  // Depth. 1/r is the pinhole distance down the axis of a cylinder: the centre
  // of the frame (r -> 0) is infinitely far, the frame edge is the near mouth
  // of the tube. Adding time streams every wall feature from the vanishing
  // point OUTWARD toward the viewer -- the actual motion of flying down a
  // pipe, not a texture being zoomed.
  let depth = 1.0 / r;
  let travel = depth + u.time * spd * 2.2;
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

  col *= vignette(uv, P_vignette());
  col = tonemap(col * 1.25);
  col += grain(uv, 0.012);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
