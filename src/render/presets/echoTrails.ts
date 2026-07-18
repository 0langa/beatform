import type { PresetDef } from "../types";

/**
 * Echo Trails — the first feedback preset. A fresh audio-driven source (a
 * spectrum ring + kick core) is injected each frame over the *previous*
 * frame, which is zoomed, swirled and decayed via feedbackSample(). The result
 * is an infinite tunnel of echoes that stream outward with the music.
 *
 * All motion is a pure function of the frame sequence (feedback texture +
 * uniforms) — no RNG — so live preview and export produce identical trails.
 */
export const echoTrails: PresetDef = {
  id: "echo-trails",
  name: "Echo Trails",
  description:
    "Feedback tunnel: every frame echoes the last, zoomed and decayed, so the spectrum streams outward in glowing trails.",
  styles: [
    { id: "tunnel", name: "Tunnel", values: {} },
    {
      id: "smoke",
      name: "Smoke",
      values: { decay: 0.96, zoom: 0.15, swirl: 0.05, inject: 0.7, radius: 0.14 },
    },
    {
      id: "vortex",
      name: "Vortex",
      values: { swirl: 0.7, zoom: 0.3, decay: 0.9, hueSpin: 0.5 },
    },
    {
      id: "supernova",
      name: "Supernova",
      values: { zoom: 0.85, decay: 0.88, react: 0.4, inject: 1.4, kickFlash: 0.9 },
    },
    {
      id: "glacier",
      name: "Glacier",
      values: {
        hue: 185,
        decay: 0.95,
        zoom: 0.3,
        swirl: 0.05,
        radius: 0.3,
        react: 0.15,
        inject: 0.9,
        thick: 0.02,
        hueSpin: 0.1,
        hueDrift: 0.04,
        kickFlash: 0.3,
      },
    },
    {
      id: "magnetar",
      name: "Magnetar",
      values: {
        hue: 315,
        decay: 0.9,
        zoom: 0.45,
        swirl: -0.6,
        radius: 0.18,
        beatZoom: 0.6,
        flowSwirl: 0.6,
        hueSpin: 0.3,
      },
    },
    {
      id: "absinthe",
      name: "Absinthe",
      values: {
        hue: 140,
        decay: 0.97,
        zoom: 0.1,
        swirl: 0.15,
        radius: 0.12,
        react: 0.35,
        inject: 0.6,
        thick: 0.05,
        flowSwirl: 0.2,
        hueDrift: 0.1,
        kickFlash: 0.2,
      },
    },
  ],
  params: [
    { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 200, hint: "Base color" },
    {
      key: "decay",
      label: "Trail length",
      min: 0.6,
      max: 0.99,
      step: 0.01,
      default: 0.92,
      hint: "How long echoes linger — higher leaves longer trails",
    },
    {
      key: "zoom",
      label: "Zoom",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.4,
      hint: "How fast echoes stream outward each frame",
    },
    {
      key: "swirl",
      label: "Swirl",
      min: -1,
      max: 1,
      step: 0.01,
      default: 0.2,
      hint: "Rotation of the trails — negative spins the other way",
    },
    {
      key: "radius",
      label: "Ring size",
      min: 0.05,
      max: 0.44,
      step: 0.01,
      default: 0.22,
      hint: "Base radius of the injected spectrum ring",
    },
    {
      key: "react",
      label: "Reactivity",
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.25,
      hint: "How much the spectrum pushes the ring outward",
    },
    {
      key: "inject",
      label: "Brightness",
      min: 0,
      max: 2,
      step: 0.05,
      default: 1,
      hint: "Brightness of the fresh source drawn over the trails",
    },
  ],
  advanced: [
    {
      key: "beatZoom",
      label: "Beat zoom",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.4,
      hint: "Extra outward burst on every beat",
    },
    {
      key: "flowSwirl",
      label: "Flow swirl",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.3,
      hint: "Loudness adds extra rotation to the trails",
    },
    {
      key: "thick",
      label: "Ring thickness",
      min: 0.005,
      max: 0.1,
      step: 0.005,
      default: 0.03,
      hint: "Thickness of the injected ring",
    },
    {
      key: "hueSpin",
      label: "Hue spin",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.2,
      hint: "Color rotation around the ring",
    },
    {
      key: "hueDrift",
      label: "Hue drift",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.3,
      hint: "Color drift over time",
    },
    {
      key: "kickFlash",
      label: "Kick flash",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.5,
      hint: "Bright core burst on kick hits",
    },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  let c = centered(uv);              // aspect-corrected, centered at 0
  let rad = length(c);
  let ang = atan2(c.y, c.x);

  // --- Feedback: inverse-warp the current coord back into the previous
  // frame (zoom + swirl), sample it and decay. zoom>1 pulls content from
  // nearer the center, so last frame's image grows outward = a tunnel. ---
  let zoom = 1.0 + P_zoom() * 0.06 + u.driveBeat * P_beatZoom() * 0.12 * u.pulse;
  let swirl = (P_swirl() * 0.15 + u.drive * P_flowSwirl() * 0.1) * u.spin;
  let w = rot2(swirl) * (c / zoom);
  let puv = vec2f(w.x / u.aspect + 0.5, w.y + 0.5);
  var col = feedbackSample(puv).rgb * P_decay();

  // --- Inject a fresh audio-driven source over the trails ---
  // Spectrum ring: its radius per angle rides the spectrum + bass.
  let spec = binAt(fract(ang / TAU + 0.5));
  // Frame-safety: the FRESH ring is the source the feedback zoom streams
  // outward from — inject it on-screen (r<=0.45), or a loud/bright master at
  // high Ring size + Reactivity puts the whole source off-frame and the tunnel
  // has nothing to echo. The trails still extend past this via feedback.
  let ringR = min(P_radius() + spec * P_react() * (0.6 + u.bass * 0.8), 0.45);
  let band = smoothstep(P_thick() + 0.02, 0.0, abs(rad - ringR));
  let hue = P_hue() + ang * 57.2958 * P_hueSpin() + u.time * P_hueDrift() * 30.0;
  col += hsl2rgb(hue, 0.85, 0.6) * band * (0.5 + spec) * P_inject();

  // Kick core: a bright central burst on kick hits.
  col += hsl2rgb(P_hue() + 40.0, 0.7, 0.72)
       * smoothstep(P_radius() * 0.7, 0.0, rad) * u.kick * P_kickFlash();

  return vec4f(col, 1.0);
}
`,
};
