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
      max: 2,
      step: 0.05,
      default: 0.7,
      hint: "Where the tunnel fades at the screen edges",
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
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  let p = centered(uv);
  let r = length(p) + 1e-3;
  let a = atan2(p.y, p.x);

  // Depth: cruise on the slow envelope, brief kick on beats (metronome-true
  // when the track has a grid; flux-only when it doesn't)
  let kickP = max(u.driveBeat, gridPulse(6.0));
  let spd = P_speed() * (P_cruiseFloor() + u.drive * P_cruiseEnergy())
          * (1.0 + kickP * P_beatSpeed() * u.pulse);
  let z = 0.30 / r + u.time * spd * 5.0;

  // Tile grid in (depth, angle)
  let zq = z * P_rings() * 0.22;
  let ang = fract(a / TAU + 0.5);
  let aq = ang * P_spokes();
  let cellZ = floor(zq);
  let cellA = floor(aq);
  let fz = fract(zq);
  let fa = fract(aq);

  // Spectrum at this angle (mirrored for seamless wrap)
  let xs = abs(ang * 2.0 - 1.0);
  let v = binAt(xs);

  // Checkerboard shade so rows visibly march toward the viewer
  let checker = f32((i32(cellZ) + i32(cellA)) % 2);

  // Tile color: smooth hue gradient along the depth (hashed rows read as
  // random); brightness = calm base + moderate spectrum + energy breathing
  let rowHue = P_hue() + (0.5 + 0.5 * sin(cellZ * 0.4)) * P_hueSpread();
  let tileL = P_tileLevel() + v * P_tileSpectrum() + checker * P_checker()
            + u.drive * 0.1;
  var tile = hsl2rgb(rowHue, P_tileSat(), tileL);

  // Constant subtle grout lines (no strobe)
  let lz = smoothstep(P_groutWidth(), 0.0, min(fz, 1.0 - fz));
  let la = smoothstep(P_groutWidth() * 1.4, 0.0, min(fa, 1.0 - fa));
  let line = max(lz, la);
  tile = mix(tile, hsl2rgb(rowHue + 30.0, 0.5, 0.75), line * P_groutLevel());

  // Beat pulse: one ring of light per beat, traveling from the viewer into
  // the depth. With a beat grid it rides beatPhase — launched ON the beat,
  // arriving as the next one lands, a perfectly periodic train. Without a
  // grid it follows the flux pulse's decay, as before.
  var pt = 1.0 - u.driveBeat; // ring travel 0 (launch) -> 1 (gone)
  var amp = u.driveBeat;
  if (u.bpm > 0.5) {
    pt = u.beatPhase;
    amp = max(exp(-u.beatPhase * 3.0) - 0.05, 0.0) / 0.95;
  }
  if (amp > 0.01) {
    let pulseR = mix(0.72, 0.04, pt);
    let pulse = exp(-abs(r - pulseR) * P_pulseWidth()) * amp * P_beatPulse();
    tile += hsl2rgb(rowHue + 40.0, 0.6, 0.55) * pulse;
  }

  // Distance fog + center hole
  let fog = smoothstep(P_fogNear(), 0.22, r) * (1.0 - smoothstep(P_fogFar(), 1.25, r));
  var col = hsl2rgb(P_hue() + 60.0, 0.5, 0.025);
  col += tile * fog;

  // Center glow breathes with the envelope, flashes softly on beat
  col += hsl2rgb(P_hue(), 0.8, 0.5) * exp(-r * 10.0)
       * (P_centerGlow() + u.drive * 0.7 + u.driveBeat * 0.3);

  col *= 1.0 - r * r * P_vignette();
  return vec4f(col, 1.0);
}
`,
};
