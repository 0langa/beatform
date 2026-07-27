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
    // Tunnel — the defaults — a spectrum ring streaming outward.
    { id: "tunnel", name: "Tunnel", values: {} },
    // Rose Window — 8-fold fold of a 6-lobed ring, slow zoom, long decay: a rose window.
    // Brightness is 0.55, not the 0.8 this style shipped with, and that is a
    // consequence of the fold's spectrum fix rather than a taste change. Each
    // wedge now sweeps the WHOLE spectrum instead of six mid bins, so the ring's
    // own brightness term (0.5 + spec) sees the bass for the first time — and at
    // this style's 0.97 trail length the accumulator holds the extra energy.
    // Measured through the export path over 12 s of track from t=55 at 30 fps,
    // on a -3.0 LUFS master: keeping 0.8 took the mean frame luminance from
    // 0.429 to 0.513 and DOUBLED the clipped-to-white area, 10.9% to 20.8%.
    // 0.55 lands 0.438 / 12.9% there, and 0.328 / 5.4% against the old
    // 0.345 / 5.3% on a -17.3 LUFS one. So the authored exposure survives on
    // both a loud and a quiet track and the only thing that changed about this
    // style is WHAT it reacts to. Stained glass wants saturated colour, not a
    // frame that is a fifth blown white.
    {
      id: "roseWindow",
      name: "Rose Window",
      values: {
        hue: 268,
        mirror: 8,
        sides: 6,
        beatStar: 0.6,
        zoom: 0.12,
        decay: 0.97,
        swirl: 0.06,
        radius: 0.3,
        thick: 0.02,
        react: 0.14,
        inject: 0.55,
        echoHue: 0.22,
        hueSpin: 0.4,
        hueDrift: 0.06,
        kickFlash: 0.28,
        flowSwirl: 0.1,
        beatZoom: 0.2,
        vignette: 0.4,
      },
    },
    // Vortex — swirl dominant, echoes rotate as they age — a whirlpool.
    {
      id: "vortex",
      name: "Vortex",
      values: {
        hue: 195,
        swirl: 0.86,
        flowSwirl: 0.7,
        zoom: 0.34,
        decay: 0.9,
        hueSpin: 0.6,
        echoHue: 0.34,
        radius: 0.2,
        thick: 0.02,
        react: 0.32,
        inject: 1.15,
        beatZoom: 0.5,
        kickFlash: 0.6,
        vignette: 0.35,
      },
    },
    // Supernova — max zoom and beat zoom on a small 5-point star: an explosion per beat.
    {
      id: "supernova",
      name: "Supernova",
      values: {
        hue: 22,
        zoom: 0.9,
        beatZoom: 0.8,
        decay: 0.87,
        swirl: 0.05,
        radius: 0.12,
        thick: 0.045,
        react: 0.44,
        inject: 1.5,
        kickFlash: 0.94,
        sides: 5,
        beatStar: 0.9,
        hueDrift: 0.5,
        echoHue: 0.12,
        flowSwirl: 0.2,
        vignette: 0.25,
      },
    },
    // Glacier — editorial. Hairline ring, almost no zoom, longest decay — a still halo.
    {
      id: "glacier",
      name: "Glacier",
      values: {
        hue: 190,
        decay: 0.98,
        zoom: 0.06,
        swirl: 0.02,
        radius: 0.3,
        thick: 0.005,
        react: 0.1,
        inject: 0.6,
        beatZoom: 0.06,
        flowSwirl: 0.02,
        hueSpin: 0.06,
        hueDrift: 0.02,
        kickFlash: 0.16,
        echoHue: 0.04,
        beatStar: 0,
        vignette: 0.5,
      },
    },
    // Magnetar — counter-rotating swirl with a 3-lobe beat star.
    {
      id: "magnetar",
      name: "Magnetar",
      values: {
        hue: 318,
        swirl: -0.72,
        flowSwirl: 0.6,
        zoom: 0.46,
        decay: 0.91,
        radius: 0.17,
        thick: 0.025,
        react: 0.3,
        inject: 1.2,
        beatZoom: 0.62,
        hueSpin: 0.34,
        echoHue: 0.3,
        sides: 3,
        beatStar: 0.66,
        kickFlash: 0.7,
      },
    },
    // Smoke — thickest ring, low zoom, no swirl: slow plumes instead of streaks.
    {
      id: "smoke",
      name: "Smoke",
      values: {
        hue: 30,
        decay: 0.96,
        zoom: 0.14,
        swirl: 0.04,
        radius: 0.14,
        thick: 0.1,
        react: 0.42,
        inject: 0.7,
        beatZoom: 0.24,
        flowSwirl: 0.12,
        hueSpin: 0.1,
        hueDrift: 0.06,
        kickFlash: 0.2,
        echoHue: 0.08,
        vignette: 0.5,
      },
    },
    // Prism — echo hue drift at max — every generation rotates colour into a rainbow tunnel.
    {
      id: "prism",
      name: "Prism",
      values: {
        hue: 210,
        mirror: 4,
        echoHue: 0.9,
        hueSpin: 0.8,
        hueDrift: 0.5,
        zoom: 0.5,
        decay: 0.93,
        swirl: 0.3,
        radius: 0.24,
        thick: 0.02,
        react: 0.24,
        kickFlash: 0.4,
        sides: 4,
        beatStar: 0.5,
        vignette: 0.35,
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
      hint: "Base color",
    },
    {
      key: "decay",
      label: "Trail length",
      group: "motion",
      min: 0.6,
      max: 0.99,
      step: 0.01,
      default: 0.92,
      hint: "How long echoes linger — higher leaves longer trails",
    },
    {
      key: "zoom",
      label: "Zoom",
      group: "motion",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.4,
      hint: "How fast echoes stream outward each frame",
    },
    {
      key: "swirl",
      label: "Swirl",
      group: "motion",
      min: -1,
      max: 1,
      step: 0.01,
      default: 0.2,
      hint: "Rotation of the trails — negative spins the other way",
    },
    {
      key: "radius",
      label: "Ring size",
      group: "shape",
      min: 0.05,
      max: 0.6,
      step: 0.01,
      default: 0.22,
      hint: "Base radius of the injected spectrum ring",
    },
    {
      key: "react",
      label: "Reactivity",
      group: "reaction",
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.25,
      hint: "How much the spectrum pushes the ring outward",
    },
    {
      key: "inject",
      label: "Brightness",
      group: "glow",
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
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.4,
      hint: "Extra outward burst on every beat",
    },
    {
      key: "flowSwirl",
      label: "Flow swirl",
      group: "motion",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.3,
      hint: "Loudness adds extra rotation to the trails",
    },
    {
      key: "thick",
      label: "Ring thickness",
      group: "shape",
      min: 0.005,
      max: 0.1,
      step: 0.005,
      default: 0.03,
      hint: "Thickness of the injected ring",
    },
    {
      key: "hueSpin",
      label: "Hue spin",
      group: "color",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.2,
      hint: "Color rotation around the ring",
    },
    {
      key: "hueDrift",
      label: "Hue drift",
      group: "color",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.3,
      hint: "Color drift over time",
    },
    {
      key: "kickFlash",
      label: "Kick flash",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.5,
      hint: "Bright core burst on kick hits",
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
      hint: "Fold the trails into mirrored wedges around the center — 1 is off, 2 mirrors left/right, higher makes a kaleidoscope",
    },
    {
      key: "echoHue",
      label: "Echo hue drift",
      group: "color",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0,
      hint: "Each echo rotates its color as it ages, turning the tunnel into a gradient of hues from the fresh center outward",
    },
    {
      key: "sides",
      label: "Ring shape",
      group: "shape",
      control: "enum",
      options: [
        { value: 0, label: "Round" },
        { value: 1, label: "1 lobe" },
        { value: 2, label: "2 lobes" },
        { value: 3, label: "3 lobes" },
        { value: 4, label: "4 lobes" },
        { value: 5, label: "5 lobes" },
        { value: 6, label: "6 lobes" },
        { value: 7, label: "7 lobes" },
        { value: 8, label: "8 lobes" },
      ],
      min: 0,
      max: 8,
      step: 1,
      default: 0,
      hint: "Morph the injected ring into an N-lobed polygon or star — 0 is a smooth circle",
    },
    {
      key: "beatStar",
      label: "Beat bloom",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.4,
      hint: "The ring's lobes punch outward into a star on every beat (needs Ring shape above 0)",
    },
  ],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  var c = centered(uv);              // aspect-corrected, centered at 0
  let mirrorN = P_mirror();
  c = kaleido(c, mirrorN);           // fold once; feedback re-samples the same fold every frame
  let rad = length(c);
  let ang = atan2(c.y, c.x);

  // --- Feedback: inverse-warp the current coord back into the previous
  // frame (zoom + swirl), sample it and decay. zoom>1 pulls content from
  // nearer the center, so last frame's image grows outward = a tunnel. ---
  // The whole feedback transform is per-RENDERED-FRAME, so it has to be scaled
  // by dt like the decay below — otherwise a 30 fps export advects the trail
  // half as many times as a 60 fps preview and the streaks are half as long.
  // At 60 fps this factor is 1.0, so the tuned look is unchanged there.
  // The zoom COMPOUNDS — each frame multiplies the sampled coordinate — so N
  // frames of x*(1+k) is (1+k)^N, not 1+k*N. The linear form under-advected by
  // ~2.6% of a second's travel at 30 fps against a 60 Hz preview; raising the
  // per-frame factor to the fpsComp power is the exact per-second equivalent,
  // the same reasoning as the decay's pow() below. The swirl stays linear
  // because it is an ANGLE, and rotations compose by adding angles.
  let fpsComp = u.dt * 60.0;
  let zoom = pow(1.0 + P_zoom() * 0.06 + u.driveBeat * P_beatZoom() * 0.12 * u.pulse, fpsComp);
  let swirl = (P_swirl() * 0.15 + u.drive * P_flowSwirl() * 0.1) * u.spin * fpsComp;
  let w = rot2(swirl) * (c / zoom);
  let puv = vec2f(w.x / u.aspect + 0.5, w.y + 0.5);

  // --- Frame-rate normalisation, part 2: what is ADDED to the loop ---
  // The per-second decay below is only half of the law. This preset
  // ACCUMULATES, so its steady state is injection / (1 - loopGain): scaling
  // the decay per second while the injection stays per RENDERED frame does not
  // remove the frame-rate dependence, it moves it into the LEVEL. Measured
  // through the real export path at matched track times, the shipped Supernova
  // style came out at 0.64x the 60 Hz mean luminance at 30 fps and 1.35x at
  // 120 fps — one picture, three exposures, which is preview-equals-export
  // broken by the frame rate alone. (Glacier looked milder, 0.91x, only
  // because 18% of its pixels are already clipped white; dropped below the
  // clip its own numbers are 0.70x / 1.32x.)
  //
  // The per-frame loop gain is decay * VIGNETTE, not decay. This frame's
  // output IS next frame's feedbackSample(), and the col *= vg at the bottom
  // lands on the fed-back value too, so the vignette compounds exactly like
  // the decay does — and at Glacier's 0.98 trail against a 0.5 vignette it is
  // the DOMINANT term: in a 1-D model of this recurrence the vignette alone
  // left the trail's far end 2.4x brighter at 30 fps than at 60. So it gets
  // the same per-second treatment: vgFade on the feedback line plus the
  // unchanged multiply at the bottom together make it vg^fpsComp, while a
  // FRESH source still only ever takes the one vg it should.
  //
  // deposit is the geometric sum of that loop gain over one frame interval,
  // (1 - L^fpsComp) / (1 - L) — the zero-order-hold equivalent, i.e. exactly
  // what makes one 30 fps frame deposit what the two 60 Hz frames it stands in
  // for would have deposited AND decayed between (1 + L). Both sources take
  // it: the kick core reads like an impulse, but u.kick is a multi-frame
  // envelope sampled at TRACK time rather than a one-frame spike, so it wants
  // the same per-second deposit the ring does — and one shared factor keeps
  // ring and core in the authored balance at every rate instead of letting
  // them drift several percent apart.
  //
  // 60 fps is the rate every style was authored at, and an export at it has to
  // stay BIT-identical to what shipped — so both terms take the literal 1.0
  // there rather than trusting the hardware to hand it back. u.dt * 60.0 is
  // exactly 1.0 at 60 fps in f32 (measured, and the exponents are written
  // 'fpsComp - 1.0' so that lands on exactly 0.0), and pow(x, 0.0) does come
  // back as exactly 1.0 — but the DIVISION does not: GPUs lower f32 divide to
  // a reciprocal approximation, and (1 - L) / (1 - L) was measured missing 1.0
  // by an ulp on 18% of the frame here. In a feedback accumulator that ulp
  // compounds until it crosses an 8-bit boundary: 74 frames of a 600-frame
  // 60 fps export came out different before this select existed. The select
  // also keeps the no-op independent of any driver's pow/divide rounding.
  let vg = vignette(uv, P_vignette());
  // min(): 1.0 - loopGain is a divisor. Trail length stops at 0.99 and the
  // vignette at 1.0, so nothing reachable through the sliders or the mod
  // matrix (which clamps to the same spec) comes near — this only stops a
  // hand-edited project carrying decay 1.0 from dividing by zero.
  let loopGain = min(P_decay() * vg, 0.999);
  let authored = fpsComp == 1.0;
  let vgFade = select(pow(vg, fpsComp - 1.0), 1.0, authored);
  let deposit = select((1.0 - loopGain * pow(loopGain, fpsComp - 1.0)) / (1.0 - loopGain), 1.0, authored);

  // Decay expressed PER SECOND, not per rendered frame. P_decay() remains the
  // per-frame factor at 60 fps (so the tuned look is unchanged there), but at
  // 30 fps the exponent doubles and the trail fades over the same amount of
  // TRACK time. Previously a 30 fps export held trails roughly twice as long
  // as the preview, and a 144 Hz display diverged the other way. The trailing
  // vgFade is the vignette's share of the same per-second loop gain.
  var col = feedbackSample(puv).rgb * pow(P_decay(), u.dt * 60.0) * vgFade;

  // Per-generation hue drift: rotate the fed-back color a little each frame
  // about the grey (luminance) axis via Rodrigues rotation, then rescale the
  // result back to the luminance it had BEFORE the rotation. The rotation on
  // its own does NOT hold the energy budget: rotating a saturated color swings
  // one channel negative, and the max(col, 0) that has to follow (a displayable
  // color cannot be negative) clamps it back up — measured at roughly 2.3x the
  // brightness plain decay would have left after a few generations, which is
  // exactly the white-out a feedback accumulator cannot survive. Renormalising
  // makes the step purely CHROMATIC: luminance out == luminance in, so the
  // tunnel's brightness stays governed by decay alone at every setting. The
  // oldest echoes have been rotated the most, so the tunnel becomes a gradient
  // of hues from the fresh center outward. Scaled by fpsComp so drift-per-
  // second matches at 30 / 60 / 144 fps.
  if (P_echoHue() > 0.001) {
    let ha = P_echoHue() * 0.5 * fpsComp;
    let ax = vec3f(0.5773502691896);
    let ca = cos(ha);
    let sa = sin(ha);
    let lw = vec3f(0.2126, 0.7152, 0.0722);
    let l0 = dot(col, lw);
    col = col * ca + cross(ax, col) * sa + ax * dot(ax, col) * (1.0 - ca);
    col = max(col, vec3f(0.0));
    col *= l0 / max(dot(col, lw), 1e-5);
  }

  // --- Inject a fresh audio-driven source over the trails ---
  // Spectrum ring: its radius per angle rides the spectrum + bass.
  //
  // ANGLE -> SPECTRUM INDEX, and the club mirror changes which mapping is
  // right. ang is read off the coordinate AFTER kaleido() folded it, and the
  // fold does not preserve the angle's RANGE: it collapses the whole circle
  // onto one wedge — [-pi/2, pi/2] at Club mirror 2 (a plain left/right
  // mirror), [0, pi/N] at N >= 3 wedges. Pushing that folded angle through the
  // unfolded formula, fract(ang / TAU + 0.5), therefore addresses a SLICE of
  // the spectrum and nothing outside it: [0.25, 0.75] at mirror 2, and
  // [0.5, 0.5 + 1/(2N)] at N >= 3 — 12.5% of the bins at the shipped Prism (4)
  // and 6.25% at the shipped Rose Window (8). Those two styles reacted to a
  // narrow mid-band and could not see bass or treble at all: a music
  // visualiser not visualising the music. The mode shipped that way.
  //
  // So the FOLDED case rescales the wedge kaleido() actually leaves reachable
  // onto the whole spectrum, and every wedge carries one complete bass-to-
  // treble sweep — which is what a kaleidoscope OF a spectrum should be.
  //
  // That mapping is seam-free by construction, which the unfolded one is not.
  // The fold is a mirror, so the folded angle runs 0 -> span -> 0 -> span as
  // you travel round the circle: a triangle wave, hence bass meeting bass at
  // one wedge edge and treble meeting treble at the next. It is the same
  // mirrored sweep radialBurst, bassCircle and tunnelRings write as
  // abs(seg * 2 - 1), and it is why seamK is forced to 1 whenever the coord is
  // folded. That is not a new judgement about mirrored wedges — it is exactly
  // what seamK ALREADY evaluated to at every mirror >= 2, because the old
  // sliced window never came within 0.25 of either end of the spectrum and the
  // crossfade below could not engage there even in principle. Leaving it live
  // under the full-range mapping WOULD engage it, and it would blend each
  // wedge's bass end into its treble end over 18% of the wedge — deleting most
  // of the dynamics this mapping exists to restore, at the very ends where the
  // music lives. So the crossfade stays exactly where it was earned: mirror 1.
  //
  // --- Club mirror 1 (the default, and six of the eight styles) ---
  // Angle maps onto the spectrum LINEARLY — one trip around the ring sweeps
  // bin 0 to bin N-1 exactly once — so the two ENDS of the spectrum meet at
  // ang = pi (screen left), where treble butts straight against bass. Those
  // two are almost never alike, and the step lands in every term the ring is
  // built from: its radius (spec * Reactivity), its brightness (0.5 + spec)
  // and the peak-hold crown (pk). A plain preset would show that as a small
  // notch; this one ADVECTS it outward every frame, so the step is redrawn
  // into the same growing wedge over and over and reads as one clean straight
  // CUT across the whole picture. It is the mode's oldest artifact.
  //
  // Sync -> Rounding makes it worse rather than better. The box blur behind
  // that slider (featurePipeline) clamps at the bin array's ends, exactly as
  // binAt()'s Catmull-Rom does here, so turning it up melts every spike in the
  // spectrum EXCEPT the joint — the seam is the one hard edge left standing,
  // and the smoother everything around it gets the more it stands out.
  //
  // The fix is an angular crossfade: across a narrow arc either side of the
  // wrap, both ends blend to the SAME value — the mean of the two — so the
  // ring closes on itself continuously. smoothstep rather than a linear ramp,
  // because a linear one only trades the step for a KINK where the blend meets
  // the raw spectrum: a visible crease at two angles instead of a cut at one.
  //
  // Arc width is the whole judgement, and it was picked from rendered frames,
  // not from arithmetic — the value is a half-width, so it costs twice itself.
  // 0.03 (a 22 degree total arc) still reads as a defect: the step becomes a
  // ramp steep enough to look deliberate, a bright hook on Glacier's hairline
  // and a hard inner wall on Smoke. 0.20 puts 40% of the circle under
  // interpolation and visibly flattens the ring's whole left side into a plain
  // curve. 0.09 — 65 degrees total — lands the treble-to-bass climb at about
  // the angular slope the ring already has elsewhere, so it reads as part of
  // the sweep rather than as a feature; measured across Tunnel / Glacier /
  // Vortex / Smoke on a -3 LUFS and a -17 LUFS track at Rounding 100%, the
  // largest angular gradient in the frame no longer sits at pi at all.
  //
  // Mirroring the sweep would remove the seam by construction here too, but at
  // mirror 1 it would also make the ring bilaterally symmetric, which is not
  // what the unfolded mode is. (At mirror >= 2 the picture is symmetric because
  // the owner asked for it, which is precisely why the fold above can take the
  // mirrored sweep for free and drop the crossfade.)
  //
  // foldLo / foldSpan are the range kaleido() leaves ang in, keyed off the
  // same two thresholds kaleido() itself branches on — 1.5 (fold at all) and
  // 2.5 (radial wedges rather than a plain left/right mirror). Reading them off
  // the mirror count rather than off the frame is what keeps this exact: the
  // wedge is a property of the fold, not something to be measured.
  let folded = mirrorN >= 1.5;
  let foldLo = select(TAU * -0.25, 0.0, mirrorN >= 2.5);
  let foldSpan = select(TAU * 0.5, TAU * 0.5 / mirrorN, mirrorN >= 2.5);
  let specX = select(fract(ang / TAU + 0.5), clamp((ang - foldLo) / foldSpan, 0.0, 1.0), folded);
  // Distance to the joint, in spectrum-domain units — zero at the wrap from
  // BOTH sides, so one weight serves the two halves of the crossfade. Off (1 =
  // no blend) when the coord is folded, where there is no joint to close.
  let seamK = select(smoothstep(0.0, 0.09, min(specX, 1.0 - specX)), 1.0, folded);
  let spec = mix((binAt(0.0) + binAt(1.0)) * 0.5, binAt(specX), seamK);
  // Frame-safety: the FRESH ring is the source the feedback zoom streams
  // outward from — inject it on-screen (r<=0.45), or a loud/bright master at
  // high Ring size + Reactivity puts the whole source off-frame and the tunnel
  // has nothing to echo. The trails still extend past this via feedback.
  // Ring shape: morph the smooth circle into an N-lobed polygon/star. On each
  // beat (grid-locked when a tempo grid exists) the lobes punch outward — a
  // beat-stamped shape the feedback zoom then streams down the tunnel as an
  // expanding star. This modulates only the ring's RADIUS per angle (a
  // radial/beat response, never an angle offset, so the monotonic law holds)
  // and reuses the SAME band energy as the plain ring, adding no net energy to
  // the accumulator. Sides is a shape count (static orientation) — not scaled
  // by the Rotation master.
  var shape = 1.0;
  if (P_sides() > 0.5) {
    let beatP = max(u.driveBeat, gridPulse(7.0));
    let lobe = cos(P_sides() * ang);
    // Soft-limited, never min(): the Pulse master runs to 200%, so at full Beat
    // bloom the raw lobe depth reaches 1.11 and the notches between lobes would
    // drive the ring radius NEGATIVE — the ring collapsing inward on every beat,
    // precisely when it should read loudest. Compressing against 0.9 leaves the
    // deepest notch at ~0.11x the radius, and every shipped style sits under the
    // 0.648 knee, so their stars are bit-identical.
    let star = softLimit(0.11 + P_beatStar() * beatP * u.pulse * 0.5, 0.9);
    shape = 1.0 + star * lobe;
  }
  let ringR = softLimit((P_radius() + spec * P_react() * (0.6 + u.bass * 0.8)) * shape, frameCircle());
  let band = smoothstep(P_thick() + 0.02, 0.0, abs(rad - ringR));
  // Cosine palette instead of a raw hsl2rgb hue rotated by angle and drifted
  // by time: a continuously sweeping HSL hue walks through its desaturated
  // middle and comes out muddy olive/brown. Hue spin/drift now phase a
  // cosPalette cosine gradient instead — same two knobs, stays saturated.
  // (The classic basis runs its rainbow opposite HSL, hence "1.0 - hue/360" —
  // see the identical note in starfield.ts.)
  let hueT = 1.0 - P_hue() / 360.0;
  // The angular hue term wraps at the SAME joint the spectrum does, and it is
  // its own seam: ang / TAU steps a full -1 at ang = pi, so the palette phase
  // jumps by Hue spin there. cosPalette has period 1, so only an exact 1.0
  // spin would come back continuous — every shipped value leaves a hard COLOUR
  // edge along the very line the geometry seam used to sit on. It is a
  // genuinely separate mechanism, and with the spectrum crossfade in and Hue
  // spin forced to 0 the largest angular gradient in the frame moves off pi
  // and falls to the 99th percentile; put the default 0.2 back and pi returns
  // as an 8x outlier. Fixing only the geometry would have left the owner the
  // same straight edge in the same place, drawn in colour instead of radius.
  //
  // So: same crossfade, same weight. Across the arc the phase eases to the
  // average of the two ends (half a spin) instead of stepping to it, which
  // reverses the palette gently over ~18% of the ring rather than cutting it.
  // The trailing subtraction keeps the phase ORIGIN where it was — without it
  // every style's colours would rotate by half a spin, which is a look change,
  // not a seam fix. Written through specX rather than ang / TAU so it shares
  // the one wrap coordinate; the two agree to an ulp away from the arc.
  //
  // Riding specX also means the hue inherits the folded mapping for free, and
  // it was starved by exactly the same arithmetic: a wedge that could only
  // reach 6.25% of the spectrum could only reach 6.25% of a Hue spin, so Rose
  // Window's wedges came out one flat colour apiece. Each wedge now carries the
  // whole spin, and it closes continuously at the wedge edges for the same
  // mirror reason the spectrum does (seamK is 1 there, so this is the raw
  // specX * spin ramp, reflected).
  let spin = P_hueSpin();
  let ringT = fract(hueT + mix(spin * 0.5, specX * spin, seamK) - spin * 0.5
    + u.time * P_hueDrift() * (30.0 / 360.0));
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
  // Same specX and same crossfade as the ring's own spectrum above — peaks[]
  // wraps at the same joint, and a crown that jumped from treble-peak to
  // bass-peak would leave a colour seam along the exact angle the geometry no
  // longer has one. It was starved by the same slice too: at mirror 8 the crown
  // could only ever address a 6-bin window of the 96, all of it mid, so it
  // never once lit on a kick.
  let pk = mix((peakAt(0.0) + peakAt(1.0)) * 0.5, peakAt(specX), seamK);
  let ringPal = cosPalette(ringT, vec3f(0.5), vec3f(0.5), vec3f(1.0), vec3f(0.0, 0.33, 0.67));
  let ringHot = mix(ringPal, vec3f(1.0, 0.98, 0.95), pk * pk * 0.7);
  col += ringHot * band * (0.5 + spec) * P_inject() * deposit;

  // Kick core: a bright central burst on kick hits, desaturating toward
  // white for a hot-flash look (bounded — see the note above; no push past
  // 1.0 here since this, too, feeds back into next frame's accumulator).
  let corePal = mix(
    cosPalette(hueT + 0.11, vec3f(0.5), vec3f(0.5), vec3f(1.0), vec3f(0.0, 0.33, 0.67)),
    vec3f(1.0),
    0.55
  );
  col += corePal * smoothstep(P_radius() * 0.7, 0.0, rad) * u.kick * P_kickFlash() * deposit;

  // No tonemap() here: with a feedback accumulator, tonemap's own output
  // feeds back in as next frame's input and compounds — measured to slowly
  // ratchet the whole tunnel up to a flat white/gray wash over a few seconds
  // instead of settling. vignette (a bounded <=1 multiply) and grain (a tiny
  // bounded dither) cannot run away like that and stay. The vignette DOES
  // compound though, which is why it is hoisted into the loop-gain block
  // above and carries a per-second exponent rather than being a plain
  // finishing multiply.
  col *= vg;
  // Grain lands in the accumulator too, but its amplitude is deliberately
  // left per-frame: scaling a DITHER by deposit would nearly double its
  // visible size at 30 fps to fix a floor that is +-0.006 and zero-mean.
  // The residue is a fractionally different noise floor in near-black areas
  // across frame rates, two orders below the injection error fixed above.
  col += grain(uv, 0.012);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
