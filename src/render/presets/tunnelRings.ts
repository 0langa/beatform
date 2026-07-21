import type { PresetDef } from "../types";

/**
 * Structured tunnel: the wall is a grid of spoke x ring tiles (checkerboard
 * shaded) so depth motion is readable. The spectrum lights tiles at their
 * angle, beats flash the grout lines and kick the speed — the sync is
 * explicit, not ambient.
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
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  var p = centered(uv);
  // Club mirror: fold the wall into radial wedges. 1 = off.
  p = kaleido(p, P_mirror());
  let r = length(p) + 1e-3;
  let a = atan2(p.y, p.x);

  // --- Perspective ---------------------------------------------------------
  // z = k/r is the actual pinhole mapping for a cylinder viewed down its
  // axis: r -> 0 is infinitely far away. Everything else keys off THIS, so
  // the tunnel reads as depth rather than as a dartboard.
  let kickP = max(u.driveBeat, gridPulse(6.0));
  let spd = P_speed() * (P_cruiseFloor() + u.drive * P_cruiseEnergy())
          * (1.0 + kickP * P_beatSpeed() * u.pulse);
  let depth = 0.30 / r;                 // 0 at the rim, large toward centre
  let z = depth + u.time * spd * 5.0;

  // Tile grid in (depth, angle). Because z is 1/r, rows automatically
  // compress toward the vanishing point — the texture-density cue that sells
  // perspective. Row height is scaled so the compression stays legible.
  let zq = z * P_rings() * 0.62;
  let ang = fract(a / TAU + 0.5);
  let aq = ang * P_spokes();
  let cellZ = floor(zq);
  let fz = fract(zq);
  let fa = fract(aq);

  // Spectrum at this angle (mirrored so the wrap is seamless).
  let xs = abs(ang * 2.0 - 1.0);
  let v = binAt(xs);
  let pk = peakAt(xs);

  // --- Colour --------------------------------------------------------------
  // Cosine palette rather than an hsl hue that drifts by hueSpread: the old
  // version walked orange -> olive -> brown through the desaturated middle of
  // HSL, which is exactly the mud this preset was criticised for. A cosine
  // ramp stays saturated across its whole range. Phase is driven by the row,
  // so consecutive rows are related colours instead of random ones.
  let t = fract(cellZ * 0.11 + P_hue() / 360.0);
  let spread = P_hueSpread() / 360.0;
  let pal = cosPalette(
    t,
    vec3f(0.5),
    vec3f(0.5),
    vec3f(1.0, 1.0, 1.0) * max(spread, 0.08),
    vec3f(0.00, 0.33, 0.67)
  );

  // Tile brightness: quiet base, spectrum on top, and a per-row shimmer that
  // replaces the old hard checkerboard (which read as a flat dartboard).
  let odd = f32(i32(cellZ) & 1);
  let shimmer = 0.5 + 0.5 * sin(cellZ * 1.7 + u.time * 0.6);
  // Alternating row lift keeps consecutive rows distinguishable; without it
  // the bands blur together and the tunnel stops reading as motion.
  var lit = P_tileLevel() * (0.55 + odd * 0.45) + v * P_tileSpectrum()
          + shimmer * P_checker() * 0.5;
  var tile = pal * lit * (0.35 + P_tileSat() * 0.9);

  // Grout: thin bright seams. Width shrinks with depth so distant seams stay
  // hairlines instead of smearing into a grey wash.
  let gw = P_groutWidth() * clamp(r * 2.2, 0.25, 1.6);
  let lz = smoothstep(gw, 0.0, min(fz, 1.0 - fz));
  let la = smoothstep(gw * 1.4, 0.0, min(fa, 1.0 - fa));
  let line = max(lz, la);
  tile += pal * line * P_groutLevel() * (0.6 + v * 1.4);

  // Peak-hold crown: the loudest angles get a near-white filament. A hot,
  // desaturated core is what makes a bright thing read as EMITTING rather
  // than merely being light-coloured.
  tile += vec3f(1.0, 0.98, 0.94) * line * pk * pk * P_groutLevel() * 1.2;

  // --- Depth cues ----------------------------------------------------------
  // Atmospheric attenuation: brightness falls off with distance into the
  // tunnel, so the vanishing point recedes instead of glowing at us. This is
  // the single biggest reason the old version looked flat.
  let fog = exp(-depth * P_fogFar() * 0.55);
  let rim = smoothstep(P_fogNear() * 0.5, P_fogNear() * 0.5 + 0.25, r);
  var col = tile * fog * rim;

  // Travelling beat ring, launched at the viewer and running to the horizon.
  var pt = 1.0 - u.driveBeat;
  var amp = u.driveBeat;
  if (u.bpm > 0.5) {
    pt = u.beatPhase;
    amp = max(exp(-u.beatPhase * 3.0) - 0.05, 0.0) / 0.95;
  }
  if (amp > 0.01) {
    let pulseR = mix(0.72, 0.04, pt);
    let pulse = exp(-abs(r - pulseR) * P_pulseWidth()) * amp * P_beatPulse();
    col += mix(pal, vec3f(1.0), 0.45) * pulse * 1.6;
  }

  // Vanishing-point core: small, hot, and gated on the envelope so it pumps.
  col += mix(pal, vec3f(1.0), 0.6) * exp(-r * 16.0)
       * (P_centerGlow() * 0.8 + u.drive * 0.5 + kickP * 0.35);

  // --- Finishing -----------------------------------------------------------
  col *= vignette(uv, P_vignette());
  col = tonemap(col * 1.15);
  col += grain(uv, 0.012);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
