import type { PresetDef } from "../types";
import { WGSL_COLOR_CONTROLS } from "../wgslLib";

/**
 * GATEFOLD — the artwork as the composition (P-19 roster entry 3).
 *
 * VISUAL IDENTITY. The track's cover art IS the picture, not a garnish inside
 * one. The art stands framed on a lit stage: it breathes with the slow energy,
 * pumps on the kick, and the room around it is lit BY it — the wash behind the
 * frame samples the artwork's own corners, so a blue sleeve throws blue light
 * and a sunset sleeve makes the room glow amber. Under the frame the floor
 * mirrors the art back with a bass-lit waterline shimmer; along the bottom the
 * spectrum runs as a skirt of bars; on the beat the frame's rim light answers
 * the kick the way the room answers the song.
 *
 * THE ART PATH. The cover arrives through the renderer's existing cover-art
 * binding (coverSample()/hasCover()/coverAspect() — the exact surface Bass
 * Circle and Radial Burst already sample; no new ABI). Framing goes through
 * the shared fitUV() with the standard cover fit/zoom/pan quartet, and the
 * letterbox a "Fit" leaves is painted as a MAT BOARD, never a hole. Every
 * art-derived RGB routes through presetRgb (the led-matrix/lyric-stage
 * desaturation idiom), so the whole-visual saturation contract holds: 0 is a
 * true grayscale print, not a gray room around a full-colour sleeve.
 *
 * NEVER A BLANK CANVAS. A track with no artwork gets THE GENERATED SLEEVE: a
 * pure-math abstract cover — duotone field, a low sun disc breathing with the
 * drive, strata riding bass/mid/treble — composed inside the same box, so the
 * frame, reflection, wash and skirt machinery is identical with and without
 * art. It is precisely what the GPU matrix and the strip thumbnail render
 * (no cover is ever bound there), so the blessed baselines pin the degrade.
 * The "Match cover colors" toggle (the store's coverHue contract) retunes
 * Hue/Hue spread from the real art's dominant colour whenever a track loads.
 *
 * DETERMINISM. A pure function of (features, time, params, cover texture): no
 * feedback, no wall clock, no Math.random. Beat terms ride driveBeat/gridPulse,
 * the sway and waterline ride TRACK time, and the wash is sampled from the
 * texture in-shader — no CPU analysis sits on the render path, so preview and
 * export resolve identical frames by construction.
 */
export const gatefold: PresetDef = {
  id: "gatefold",
  name: "Gatefold",
  description:
    "The artwork is the show: the track's cover stands framed on a lit stage — the room glows in the art's own colors, the floor mirrors it back, a spectrum skirt runs below, and the frame pumps with the kick. No artwork? A generated abstract sleeve takes the stage instead.",
  styles: [
    // Gatefold — the defaults: the framed art over its reflection, the
    // room lit in the sleeve's own colors, the spectrum as a low skirt.
    { id: "fold", name: "Gatefold", values: {} },
    // Museum — editorial. Whole art letterboxed on a mat, gilded frame, warm
    // low light, almost still: the white-glove hang.
    {
      id: "museum",
      name: "Museum",
      values: {
        artSize: 1.15,
        reflection: 0.2,
        hue: 42,
        hueSpread: 15,
        drift: 0.1,
        breathe: 0.15,
        beatZoom: 0.1,
        flare: 0.1,
        glow: 0.3,
        skirt: 0.1,
        wash: 0.35,
        border: 0.7,
        coverFit: 1,
        roomLevel: 0.06,
        vignette: 0.55,
      },
    },
    // Echo Room — the Backdrop composition: the art blown up soft behind its
    // own sharp copy, deep drift and heavy wash. The dream-pop look.
    {
      id: "echoRoom",
      name: "Echo Room",
      values: {
        layout: 1,
        drift: 0.6,
        breathe: 0.7,
        beatZoom: 0.5,
        glow: 0.9,
        wash: 0.8,
        reflection: 0.25,
        hue: 198,
        hueSpread: 70,
        skirt: 0.2,
        grain: 0.4,
        flare: 0.35,
        roomLevel: 0.03,
        vignette: 0.5,
      },
    },
    // Poster — full bleed: the art edge to edge, a tall spectrum skirt over
    // the scrim, hard beat zoom. The gig-poster chip.
    {
      id: "poster",
      name: "Poster",
      values: {
        layout: 2,
        beatZoom: 0.65,
        flare: 0.45,
        skirt: 0.7,
        grain: 0.5,
        glow: 0.2,
        hue: 12,
        hueSpread: 60,
        drift: 0.1,
        breathe: 0.2,
        border: 0,
        wash: 0,
        vignette: 0.3,
      },
    },
    // Neon Sleeve — the VJ chip: hot magenta room, heavy rim glow, tall
    // skirt, everything pumping.
    {
      id: "neonSleeve",
      name: "Neon Sleeve",
      values: {
        artSize: 0.9,
        hue: 315,
        hueSpread: 130,
        glow: 1.3,
        skirt: 0.8,
        flare: 0.6,
        beatZoom: 0.7,
        border: 0.5,
        reflection: 0.65,
        breathe: 0.55,
        grain: 0.15,
        roomLevel: 0.03,
        vignette: 0.5,
      },
    },
    // Zine — print on newsprint: full bleed stretched, colour pulled almost
    // out, heavy grain, nearly still. The photocopier chip.
    {
      id: "zine",
      name: "Zine",
      values: {
        layout: 2,
        coverFit: 2,
        saturation: 0.25,
        lightness: 1.1,
        grain: 0.9,
        skirt: 0.15,
        flare: 0.05,
        beatZoom: 0.1,
        drift: 0,
        hue: 40,
        hueSpread: 0,
        glow: 0.1,
        vignette: 0.2,
      },
    },
  ],
  params: [
    {
      key: "layout",
      label: "Composition",
      group: "shape",
      control: "enum",
      // A structural switch: modulating it would recompose the whole frame
      // every tick (the led-matrix Display rule).
      mod: "off",
      options: [
        {
          value: 0,
          label: "Gallery",
          hint: "The art framed on a lit stage, mirrored in the floor",
        },
        {
          value: 1,
          label: "Backdrop",
          hint: "A soft giant blow-up of the art behind its own sharp copy",
        },
        {
          value: 2,
          label: "Full bleed",
          hint: "The art edge to edge, treatments composited over it",
        },
      ],
      min: 0,
      max: 2,
      step: 1,
      default: 0,
      hint: "How the artwork holds the frame",
    },
    {
      key: "artSize",
      label: "Art size",
      group: "shape",
      min: 0.5,
      max: 1.5,
      step: 0.05,
      default: 1,
      hint: "Scale of the framed artwork (Full bleed always fills the frame)",
    },
    {
      key: "reflection",
      label: "Reflection",
      group: "shape",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.45,
      hint: "The floor mirrors the art below the frame, with a bass-lit waterline shimmer",
    },
    {
      key: "hue",
      label: "Hue",
      group: "color",
      control: "hue",
      min: 0,
      max: 360,
      step: 1,
      default: 230,
      hint: "The room's base color — floor, frame, skirt and the generated sleeve sit here",
    },
    {
      key: "hueSpread",
      label: "Hue spread",
      group: "color",
      min: -180,
      max: 180,
      step: 5,
      default: 40,
      hint: "How far around the wheel the skirt and the sleeve's second color travel",
    },
    {
      key: "saturation",
      label: "Saturation",
      group: "color",
      min: 0,
      max: 2,
      step: 0.01,
      default: 1,
      hint: "Overall color intensity (1 = as designed, 0 = grayscale — the artwork included)",
    },
    {
      key: "lightness",
      label: "Lightness",
      group: "color",
      min: 0,
      max: 2,
      step: 0.01,
      default: 1,
      hint: "Overall brightness of every color (1 = as designed)",
    },
    {
      key: "drift",
      label: "Drift",
      group: "motion",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.25,
      hint: "Slow float of the room and backdrop — the framed art itself stays planted",
    },
    {
      key: "breathe",
      label: "Breathe",
      group: "motion",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.4,
      hint: "The art swells and settles with the track's slow energy",
    },
    {
      key: "beatZoom",
      label: "Beat zoom",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.35,
      hint: "The art pumps on the beat — the backdrop shifts against it for parallax",
    },
    {
      key: "flare",
      label: "Beat flare",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.25,
      hint: "A room-wide flash of light on the beat, brightest at the floor",
    },
    {
      key: "glow",
      label: "Rim light",
      group: "glow",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0.6,
      hint: "Light spilling from behind the frame, in the artwork's own colors",
    },
    {
      key: "skirt",
      label: "Skirt",
      group: "backdrop",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.35,
      hint: "The spectrum as a run of bars along the bottom of the frame",
    },
    {
      key: "wash",
      label: "Room wash",
      group: "backdrop",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.55,
      hint: "The room lit by the artwork's own sampled colors, breathing with the bass (Gallery and Backdrop)",
    },
    {
      key: "cover",
      label: "Cover art",
      group: "image",
      control: "toggle",
      mod: "off",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      hint: "Show the track's artwork (off, or no art on the track: the generated sleeve takes the stage)",
    },
    {
      key: "coverHue",
      label: "Match cover colors",
      group: "image",
      control: "toggle",
      mod: "off",
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      hint: "Analyze the cover art and set Hue + Hue spread to match it — reapplies automatically whenever a track with cover art loads",
    },
  ],
  advanced: [
    {
      key: "border",
      label: "Frame line",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.25,
      hint: "The thin lit frame around the art (Gallery and Backdrop)",
    },
    {
      key: "coverFit",
      label: "Image fit",
      group: "image",
      control: "enum",
      mod: "off",
      options: [
        {
          value: 0,
          label: "Fill",
          hint: "Cover the whole slot; whatever does not fit is cropped off",
        },
        { value: 1, label: "Fit", hint: "Show all of it, letterboxed on a mat" },
        { value: 2, label: "Stretch", hint: "Squash it to fill the slot exactly" },
      ],
      min: 0,
      max: 2,
      step: 1,
      default: 0,
      hint: "Fill (crops to the frame) / Fit (whole image on a mat) / Stretch (distorts to fill)",
    },
    {
      key: "coverZoom",
      label: "Image zoom",
      group: "image",
      min: 0.25,
      max: 3,
      step: 0.01,
      default: 1,
      hint: "Scale the image inside its frame — zoom in on the part you want",
    },
    {
      key: "coverX",
      label: "Image X",
      group: "image",
      min: -0.5,
      max: 0.5,
      step: 0.005,
      default: 0,
      hint: "Slide the image sideways inside its frame",
    },
    {
      key: "coverY",
      label: "Image Y",
      group: "image",
      min: -0.5,
      max: 0.5,
      step: 0.005,
      default: 0,
      hint: "Slide the image up or down inside its frame",
    },
    {
      key: "roomLevel",
      label: "Floor glow",
      group: "backdrop",
      min: 0,
      max: 0.2,
      step: 0.005,
      default: 0.045,
      hint: "Brightness of the empty room — silence is a lit surface here, never a hole",
    },
    {
      key: "grain",
      label: "Print grain",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.3,
      hint: "Film grain over the whole print, livelier when the energy is",
    },
    {
      key: "reflectFade",
      label: "Reflection reach",
      group: "shape",
      min: 0.1,
      max: 1,
      step: 0.05,
      default: 0.5,
      hint: "How far down the floor the mirrored art survives before it sinks",
    },
    {
      key: "emblem",
      label: "Sleeve emblem",
      group: "shape",
      min: 0,
      max: 1,
      step: 0.05,
      default: 1,
      hint: "Presence of the generated sleeve's sun-and-strata artwork when no cover is shown",
    },
    {
      key: "vignette",
      label: "Vignette",
      group: "backdrop",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.4,
      hint: "Corner darkening around the room",
    },
  ],
  wgsl: /* wgsl */ `
${WGSL_COLOR_CONTROLS}

/** Authored-RGB counterpart of presetColor, for the artwork itself: the
 * led-matrix/lyric-stage desaturation-mix idiom, so saturation 0 collapses
 * the cover to its own luminance instead of leaving a full-colour sleeve
 * standing in a grayscale room. */
fn presetRgb(rgb: vec3f) -> vec3f {
  let gray = vec3f(dot(rgb, vec3f(0.2126, 0.7152, 0.0722)));
  let saturation = P_saturation();
  var adjusted = mix(gray, rgb, saturation);
  if (saturation > 1.0) {
    adjusted = rgb + (rgb - gray) * (saturation - 1.0);
  }
  let lightness = P_lightness();
  if (lightness <= 1.0) { return adjusted * lightness; }
  return min(adjusted * lightness, vec3f(1.0));
}

/**
 * THE GENERATED SLEEVE — the no-artwork degrade. A designed abstract cover,
 * not a placeholder fill: a duotone field falling toward the floor, a low sun
 * disc that breathes with the drive, and three strata riding bass/mid/treble.
 * Pure math of (uv, features, params), composed in the SAME box the real art
 * uses, so every treatment around it (frame, reflection, wash, skirt) is
 * identical with and without a cover — and it is exactly what the GPU matrix
 * and the strip thumbnail pin, since neither ever binds art.
 */
fn sleeveArt(buv: vec2f, boxAspect: f32) -> vec3f {
  // Square-true coordinates: x scaled by the box aspect so the disc stays a
  // disc when the sleeve fills a 16:9 frame (Full bleed).
  let q = vec2f((buv.x - 0.5) * boxAspect, buv.y - 0.5);
  // Duotone field: the base hue high, the spread hue sinking to the floor.
  let g = clamp(0.5 + q.x * 0.35 + q.y * 1.1, 0.0, 1.0);
  var art = mix(
    presetColor(P_hue(), 0.62, 0.34),
    presetColor(P_hue() + P_hueSpread(), 0.55, 0.10),
    g,
  );
  let emblem = P_emblem();
  if (emblem > 0.001) {
    // The sun: a low disc breathing with the drive, haloed so it reads as
    // lit. Its centre sits in the upper third, publishing's favourite spot.
    let d = length(q - vec2f(0.0, -0.16));
    let radius = 0.16 + u.drive * 0.02;
    let disc = smoothstep(0.008, -0.008, d - radius);
    let sunCol = presetColor(P_hue() + P_hueSpread() * 0.55, 0.75, 0.62);
    art = mix(art, sunCol, disc * emblem);
    art += sunCol * exp(-max(d - radius, 0.0) * 14.0) * 0.35 * emblem;
    // Strata: three horizon bands under the sun, one per spectral region —
    // the sleeve's own band response (bass nearest the floor reads loudest).
    let bandE = array<f32, 3>(u.treble, u.mid, u.bass);
    for (var k = 0; k < 3; k++) {
      let cy = 0.12 + f32(k) * 0.11;
      let band = smoothstep(0.030, 0.024, abs(q.y - cy));
      art += presetColor(P_hue() + P_hueSpread() * (0.3 + f32(k) * 0.25), 0.6, 0.30)
           * band * (0.25 + 0.75 * bandE[k]) * emblem;
    }
  }
  return art;
}

/**
 * The artwork at one box position: the real cover through the shared fitUV
 * (fit/zoom/pan quartet, letterbox painted as a mat board — never a hole),
 * or the generated sleeve when no art is shown. The ONE gate for "is there
 * art", so every consumer — box, blur, reflection, wash — degrades together.
 */
fn artAt(buv: vec2f, boxAspect: f32) -> vec3f {
  if (P_cover() > 0.5 && hasCover()) {
    let cuv = fitUV(buv, coverAspect(), boxAspect, P_coverFit(), P_coverZoom(),
                    vec2f(P_coverX(), P_coverY()));
    if (inBox(cuv)) {
      return presetRgb(coverSample(cuv).rgb);
    }
    // The mat: a deep tint of the room hue behind a letterboxed fit.
    return presetColor(P_hue(), 0.3, 0.075);
  }
  return sleeveArt(buv, boxAspect);
}

/** The light the room borrows from the art: four fixed quadrant taps,
 * averaged. Sampled from the artwork ITSELF (through artAt, so the sleeve
 * lights the room the same way) — the palette extraction lives in-shader,
 * deterministic, with no CPU analysis on the render path. */
fn washColor() -> vec3f {
  return (artAt(vec2f(0.3, 0.3), 1.0) + artAt(vec2f(0.7, 0.3), 1.0)
        + artAt(vec2f(0.3, 0.7), 1.0) + artAt(vec2f(0.7, 0.7), 1.0)) * 0.25;
}

/** The Backdrop composition's soft blow-up: a nine-tap ring average — an
 * echo of the art, not a true gaussian; the dim and the wash over it carry
 * the rest of the softness. */
fn artBlur(buv: vec2f, boxAspect: f32) -> vec3f {
  var acc = artAt(buv, boxAspect) * 0.2;
  for (var k = 0; k < 8; k++) {
    let a = f32(k) * 0.7853981634; // TAU / 8
    acc += artAt(buv + vec2f(cos(a), sin(a)) * 0.045, boxAspect) * 0.1;
  }
  return acc;
}

fn preset(uv: vec2f) -> vec4f {
  let beat = max(u.driveBeat, gridPulse(7.0));
  // The kick lands in the ART: the frame scales on the beat (Pulse-gated),
  // and swells slowly with the energy envelope on top.
  let pump = 1.0 + beat * P_beatZoom() * 0.045 * u.pulse;
  let swell = 1.0 + (u.energy - 0.5) * P_breathe() * 0.06;
  // Slow room sway — backdrop only (a swaying frame reads as broken), riding
  // the energy envelope and the Rotation master, from TRACK time.
  let sway = vec2f(sin(u.time * 0.31), cos(u.time * 0.23))
           * 0.025 * P_drift() * (0.35 + 0.65 * u.energy) * u.spin;
  let washRgb = washColor();
  let comp = P_layout();

  // The frame's box, in centered space (y down, like the texture's v — the
  // Bass Circle rule: no flip, or the cover hangs upside down). Square: album
  // sleeves are square, and a non-square image resolves through the user fit.
  let p = centered(uv);
  let boxC = vec2f(0.0, -0.035);
  let half = 0.30 * P_artSize() * pump * swell;
  let buv = (p - boxC) / (2.0 * half) + vec2f(0.5);
  let cd = max(abs(p.x - boxC.x), abs(p.y - boxC.y)) - half;

  var col = vec3f(0.0);
  if (comp > 1.5) {
    // FULL BLEED: the art is the frame. The beat zoom pumps the whole crop
    // about the centre; drift pans it; a scrim grades the floor down so the
    // skirt and the flare have dark to read against.
    let fb = (uv - vec2f(0.5)) / (pump * swell) + vec2f(0.5) + sway * 0.5;
    col = artAt(fb, u.aspect);
    col *= 1.0 - smoothstep(0.45, 1.0, uv.y) * 0.5;
  } else {
    if (comp > 0.5) {
      // BACKDROP: the art blown up soft behind itself. The blur field drifts
      // WITH the sway while the sharp frame stays planted — and the beat
      // zoom shifts it against the frame, which is what makes the pump read
      // as parallax rather than scale.
      let bb = (uv - vec2f(0.5)) * 0.92 + vec2f(0.5)
             + sway * 0.6 + vec2f(0.0, (pump - 1.0) * 0.35);
      col = artBlur(bb, u.aspect) * (0.22 + 0.10 * u.energy);
    } else {
      // GALLERY: the room. A lit floor graded toward the bottom, never a
      // hole, swaying gently with the track.
      col = presetColor(P_hue(), 0.45,
                        P_roomLevel() * (0.55 + 0.9 * (uv.y + sway.y * 2.0)));
    }
    // The wash: the room lit by the artwork's own colors, falling off with
    // distance from the frame and breathing with the bass.
    col += washRgb * exp(-max(cd, 0.0) * 2.4) * P_wash()
         * (0.42 + 0.32 * u.bass + 0.26 * beat * u.pulse);
  }

  // The skirt: the spectrum as a run of bars along the bottom edge. binAt
  // keeps it on the shared Spectrum-smooth master; Detail thins the columns.
  if (P_skirt() > 0.001) {
    let cols = max(floor(64.0 * mix(0.4, 1.0, u.detail)), 8.0);
    let cx = (floor(uv.x * cols) + 0.5) / cols;
    let fx = fract(uv.x * cols);
    let gapMask = smoothstep(0.0, 0.10, fx) * smoothstep(1.0, 0.90, fx);
    let lv = binAt(cx);
    let ht = lv * 0.26 * P_skirt();
    let inSkirt = smoothstep(1.0 - ht - 0.006, 1.0 - ht + 0.006, uv.y);
    col += presetColor(P_hue() + cx * P_hueSpread(), 0.75, 0.42)
         * inSkirt * gapMask * (0.4 + 0.6 * lv) * P_skirt();
  }

  if (comp < 1.5) {
    // The reflection: the floor mirrors the art below the frame, sinking
    // with distance (Reflection reach) — the waterline shimmers sideways
    // with the bass, from track time.
    if (P_reflection() > 0.001 && buv.y > 1.0 && buv.y < 2.0
        && buv.x > 0.0 && buv.x < 1.0) {
      let sink = (buv.y - 1.0) / max(P_reflectFade(), 0.1);
      let fade = max(1.0 - sink, 0.0);
      let shimmer = sin(buv.y * 34.0 + u.time * 1.4) * 0.006 * u.bass;
      let rart = artAt(vec2f(buv.x + shimmer, 2.0 - buv.y), 1.0);
      col = mix(col, rart * 0.55, fade * fade * P_reflection() * 0.8);
    }

    // Rim light: the artwork's own light spilling from behind the frame,
    // answering the kick.
    col += washRgb * exp(-max(cd, 0.0) * 7.0) * P_glow()
         * 0.5 * (0.55 + 0.45 * beat * u.pulse) * step(0.0, cd);

    // The art itself, soft-edged into the room, then the thin lit frame
    // line just outside it.
    let boxMask = smoothstep(0.003, -0.003, cd);
    col = mix(col, artAt(buv, 1.0), boxMask);
    let line = smoothstep(0.006, 0.002, abs(cd - 0.004));
    col += presetColor(P_hue(), 0.2, 0.85) * line * P_border();
  }

  // Beat flare: the room's own light answering the kick, brightest at the
  // floor so it reads as house lights rather than a screen flash.
  col += presetColor(P_hue() + P_hueSpread() * 0.5, 0.45, 0.5)
       * beat * P_flare() * 0.16 * u.pulse * (1.3 - uv.y);

  col *= vignette(uv, P_vignette());
  col = tonemap(col * 1.05);
  // Print grain: energy-live film grain over the whole frame, never zero —
  // the same floor dither every mode in the roster carries.
  col += grain(uv, 0.006 + P_grain() * 0.05 * (0.35 + 0.65 * u.energy));
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`,
};
