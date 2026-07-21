import type { PresetDef } from "../types";

/**
 * Echo Trails — the first feedback preset. A fresh audio-driven source (a
 * spectrum ring + kick core) is injected each frame over the *previous*
 * frame, which is zoomed, swirled and decayed via feedbackSample(). The result
 * is an infinite tunnel of echoes that stream outward with the music.
 *
 * Visual-review fixes (docs/VISUAL-DESIGN.md):
 *   - the ring's color used to be a raw hsl2rgb hue rotated by angle (Hue
 *     spin) and drifted by time (Hue drift) — a continuously sweeping HSL hue
 *     walks through its desaturated middle and comes out muddy olive/brown
 *     (section 1). Same two knobs now phase a cosPalette cosine gradient
 *     instead, which stays saturated across the whole sweep;
 *   - the kick flash and ring peak were plain mid-lightness hsl2rgb, so nothing
 *     ever read as truly *emitting*. Both now desaturate toward white and push
 *     past 1.0, with tonemap() as the final color step to roll that off
 *     smoothly instead of clipping each channel independently;
 *   - added the finishing kit every other preset in this file uses: vignette,
 *     tonemap, grain;
 *   - added a club-mirror `mirror` param (kaleido) — the feedback zoom/swirl
 *     re-samples the SAME folded coordinate every frame, so the kaleidoscope
 *     stays coherent across accumulating trails instead of smearing.
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
      hint: "Fold the trails into mirrored wedges around the center — 1 is off, 2 mirrors left/right, higher makes a kaleidoscope",
    },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  var c = centered(uv);              // aspect-corrected, centered at 0
  c = kaleido(c, P_mirror());        // fold once; feedback re-samples the same fold every frame
  let rad = length(c);
  let ang = atan2(c.y, c.x);

  // --- Feedback: inverse-warp the current coord back into the previous
  // frame (zoom + swirl), sample it and decay. zoom>1 pulls content from
  // nearer the center, so last frame's image grows outward = a tunnel. ---
  // The whole feedback transform is per-RENDERED-FRAME, so it has to be scaled
  // by dt like the decay below — otherwise a 30 fps export advects the trail
  // half as many times as a 60 fps preview and the streaks are half as long.
  // At 60 fps this factor is 1.0, so the tuned look is unchanged there.
  let fpsComp = u.dt * 60.0;
  let zoom = 1.0 + (P_zoom() * 0.06 + u.driveBeat * P_beatZoom() * 0.12 * u.pulse) * fpsComp;
  let swirl = (P_swirl() * 0.15 + u.drive * P_flowSwirl() * 0.1) * u.spin * fpsComp;
  let w = rot2(swirl) * (c / zoom);
  let puv = vec2f(w.x / u.aspect + 0.5, w.y + 0.5);
  // Decay expressed PER SECOND, not per rendered frame. P_decay() remains the
  // per-frame factor at 60 fps (so the tuned look is unchanged there), but at
  // 30 fps the exponent doubles and the trail fades over the same amount of
  // TRACK time. Previously a 30 fps export held trails roughly twice as long
  // as the preview, and a 144 Hz display diverged the other way.
  var col = feedbackSample(puv).rgb * pow(P_decay(), u.dt * 60.0);

  // --- Inject a fresh audio-driven source over the trails ---
  // Spectrum ring: its radius per angle rides the spectrum + bass.
  let spec = binAt(fract(ang / TAU + 0.5));
  // Frame-safety: the FRESH ring is the source the feedback zoom streams
  // outward from — inject it on-screen (r<=0.45), or a loud/bright master at
  // high Ring size + Reactivity puts the whole source off-frame and the tunnel
  // has nothing to echo. The trails still extend past this via feedback.
  let ringR = min(P_radius() + spec * P_react() * (0.6 + u.bass * 0.8), 0.45);
  let band = smoothstep(P_thick() + 0.02, 0.0, abs(rad - ringR));
  // Cosine palette instead of a raw hsl2rgb hue rotated by angle and drifted
  // by time: a continuously sweeping HSL hue walks through its desaturated
  // middle and comes out muddy olive/brown. Hue spin/drift now phase a
  // cosPalette cosine gradient instead — same two knobs, stays saturated.
  // (The classic basis runs its rainbow opposite HSL, hence "1.0 - hue/360" —
  // see the identical note in starfield.ts.)
  let hueT = 1.0 - P_hue() / 360.0;
  let ringT = fract(hueT + ang / TAU * P_hueSpin() + u.time * P_hueDrift() * (30.0 / 360.0));
  // Peak-hold crown: the loudest angle on the ring desaturates toward white
  // instead of just being light-colored — a hot core reads as EMITTING. This
  // recolors the ring rather than adding a second term on top of it: this
  // preset is a feedback ACCUMULATOR (every frame's output becomes next
  // frame's input), so anything added here compounds indefinitely instead of
  // settling — a second full-brightness layer, or pushing color past 1.0 for
  // tonemap() to roll off (the usual move for a hot core elsewhere in this
  // kit), was measured to wash the whole tunnel out to flat white/gray within
  // a few seconds. Recoloring keeps the injected energy budget identical to
  // the original ring term — bounded and provably as stable as before.
  let pk = peakAt(fract(ang / TAU + 0.5));
  let ringPal = cosPalette(ringT, vec3f(0.5), vec3f(0.5), vec3f(1.0), vec3f(0.0, 0.33, 0.67));
  let ringHot = mix(ringPal, vec3f(1.0, 0.98, 0.95), pk * pk * 0.7);
  col += ringHot * band * (0.5 + spec) * P_inject();

  // Kick core: a bright central burst on kick hits, desaturating toward
  // white for a hot-flash look (bounded — see the note above; no push past
  // 1.0 here since this, too, feeds back into next frame's accumulator).
  let corePal = mix(
    cosPalette(hueT + 0.11, vec3f(0.5), vec3f(0.5), vec3f(1.0), vec3f(0.0, 0.33, 0.67)),
    vec3f(1.0),
    0.55
  );
  col += corePal * smoothstep(P_radius() * 0.7, 0.0, rad) * u.kick * P_kickFlash();

  // No tonemap() here: with a feedback accumulator, tonemap's own output
  // feeds back in as next frame's input and compounds — measured to slowly
  // ratchet the whole tunnel up to a flat white/gray wash over a few seconds
  // instead of settling. vignette (a bounded <=1 multiply) and grain (a tiny
  // bounded dither) are stable either way and stay.
  col *= vignette(uv, P_vignette());
  col += grain(uv, 0.012);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
