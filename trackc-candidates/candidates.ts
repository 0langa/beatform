import {
  BG_PRESET,
  BG_SOLID,
  DEFAULT_MOTION,
  DEFAULT_POST,
  type BgSettings,
  type MotionSettings,
  type ParamValues,
  type PostSettings,
} from "../src/render/types";
import { DEFAULT_LYRIC_STYLE, type LyricStyle } from "../src/state/lyrics";
import { DEFAULT_AUDIOGRAM, type AudiogramSettings } from "../src/state/audiogram";
import { defaultBuilderStack } from "../src/render/builder2";
import type { Aspect, ProjectDocument } from "../src/state/project";
import type { ThemeMeta } from "../src/state/themes";
import type { SyncSettings } from "../src/audio/types";
import type { ModRoute } from "../src/state/modMatrix";
import type { Timeline } from "../src/state/timeline";
import type { OverlayLayer } from "../src/render/overlay";

/**
 * Track C1 — flagship theme CANDIDATES. Not a registry, not a factory pack:
 * this file exists on the `c1-themes` branch so the owner can look at five
 * finished productions, see the evidence stills beside them, and approve or
 * veto each one individually (BACKLOG C4). Nothing here is imported by the
 * app.
 *
 * Authored as typed data for the same reason `src/state/factoryThemes.ts` is:
 * the compiler checks every field against the real document schema, and the
 * `.bftheme` files shipped next to this module are emitted from it through
 * the app's own `serializeTheme()`. See `.superpowers/c1-lane-log.md`.
 *
 * What separates these from the two gallery flagships they would replace:
 * `deep-current` and `sunset-circuit` are each a LOOK promoted to a document
 * — params plus a smoothed spectrum, default post, no modulation at all, no
 * overlay, no background, no timeline. Every candidate below commits to the
 * modulation matrix in its v2 form (per-route response curves and
 * attack/release lag, tempo-locked LFOs, the section-boundary pulse), to a
 * post chain, to the motion masters, and to at least one document-level
 * surface the shipped content has never touched.
 *
 * Rules each entry follows, inherited from the factory pack because the
 * round-trip test depends on them:
 *  - Deterministic: plain serializable data. Route, layer, scene and keyframe
 *    ids are derived from the slug, never from `Date.now()` or `Math.random()`
 *    — a keyframe without an explicit id gets a RANDOM one backfilled by
 *    `validTimeline`, which would make the round-trip assertion meaningless.
 *  - Canonical: the authored document already equals what `validateDocument()`
 *    produces from it, so apply -> export -> re-import is a fixed point.
 *  - Headroom: every modulated param is authored below the ceiling its routes
 *    can push it to, so a drop brightens instead of clipping flat.
 *  - No muted routes. Mute is an A/B authoring tool; shipping one would ship a
 *    control the user has to discover before the theme works.
 */

export interface ThemeCandidate {
  /** Proposed gallery id — kebab-case, matches the registry's ID_RE. */
  slug: string;
  meta: ThemeMeta;
  document: ProjectDocument;
}

type ModSpec = Omit<ModRoute, "id">;

interface CandidateSpec {
  slug: string;
  name: string;
  description: string;
  bpmHint?: [number, number];
  preset: string;
  params?: ParamValues;
  sync?: SyncSettings;
  post?: Partial<PostSettings>;
  motion?: Partial<MotionSettings>;
  mods?: ModSpec[];
  bg?: BgSettings;
  aspect?: Aspect;
  timeline?: Timeline;
  lyricStyle?: Partial<LyricStyle>;
  audiogram?: Partial<AudiogramSettings>;
  overlayLayers?: OverlayLayer[];
  smoothSpectrum?: boolean;
}

const BY = "Beatform";
const LICENSE = "CC0-1.0";

function candidate(spec: CandidateSpec): ThemeCandidate {
  const mods: ModRoute[] = (spec.mods ?? []).map((m, i) => ({ id: `${spec.slug}-m${i}`, ...m }));
  return {
    slug: spec.slug,
    meta: {
      name: spec.name,
      author: BY,
      license: LICENSE,
      description: spec.description,
      ...(spec.bpmHint ? { bpmHint: spec.bpmHint } : {}),
    },
    document: {
      presetId: spec.preset,
      paramsByPreset: spec.params ? { [spec.preset]: spec.params } : {},
      syncByPreset: spec.sync ? { [spec.preset]: spec.sync } : {},
      bgByPreset: {},
      centerImageByPreset: {},
      bg: spec.bg ?? { mode: BG_PRESET, color: [0, 0, 0] },
      overlayLayers: spec.overlayLayers ?? [],
      assets: {},
      aspect: spec.aspect ?? "16:9",
      modsByPreset: mods.length > 0 ? { [spec.preset]: mods } : {},
      smoothSpectrum: spec.smoothSpectrum === true,
      timeline: spec.timeline ?? { enabled: false, scenes: [], lanes: [] },
      post: { ...DEFAULT_POST, ...spec.post },
      motion: { ...DEFAULT_MOTION, ...spec.motion },
      lyricStyle: { ...DEFAULT_LYRIC_STYLE, ...spec.lyricStyle },
      audiogram: { ...DEFAULT_AUDIOGRAM, ...spec.audiogram },
      customDefs: [],
      builderStack: defaultBuilderStack(),
    },
  };
}

/** Cold Open's lockup: a broadcast kicker, the title, the artist. `{title}`
 * and `{artist}` fill themselves from the loaded track's tags and render
 * nothing at all until one is loaded, so the frame is never a placeholder. */
const coldOpenLockup = (slug: string): OverlayLayer[] => [
  {
    id: `${slug}-t0`,
    type: "text",
    text: "Now playing",
    font: "Arial",
    weight: 600,
    size: 0.018,
    color: [1, 1, 1],
    opacity: 0.5,
    letterSpacing: 0.42,
    anchor: "tl",
    offset: [0.062, 0.09],
    glow: 0.1,
    uppercase: true,
  },
  {
    id: `${slug}-t1`,
    type: "text",
    text: "{title}",
    font: "Arial",
    weight: 800,
    size: 0.062,
    color: [1, 1, 1],
    opacity: 1,
    letterSpacing: 0.01,
    anchor: "bl",
    offset: [0.06, -0.135],
    glow: 0.22,
    uppercase: true,
  },
  {
    id: `${slug}-t2`,
    type: "text",
    text: "{artist}",
    font: "Arial",
    weight: 400,
    size: 0.024,
    color: [1, 0.86, 0.7],
    opacity: 0.68,
    letterSpacing: 0.3,
    anchor: "bl",
    offset: [0.062, -0.085],
    glow: 0.1,
    uppercase: true,
  },
];

export const CANDIDATES: ThemeCandidate[] = [
  /* DARK / MINIMAL — proposed replacement for the gallery's `deep-current`.
   *
   * The incumbent is Abyssal Bloom with the spectrum smoothed and nothing
   * else. The lineage is kept deliberately (same mode, same abyss, and
   * `smoothSpectrum` still on, because that WAS the old entry's one idea) and
   * everything that makes a theme is added underneath it.
   *
   * The whole piece is built out of lag rather than hits: the bass swell
   * takes 1.4 s to let go, loudness opens the bloom over two seconds, and the
   * only beat route on the visual is a `exp`-curved whisper on the ripple, so
   * a soft kick moves nothing at all. Two tempo-locked LFOs do the breathing
   * — an 8-beat sine on the fold angle and a 4-beat sine on scale — and the
   * 8-beat SAW on the drive glow is the tide: it swells across two bars and,
   * because its release is 1.2 s, falls back gently instead of snapping at
   * the wrap. Section boundaries land the palette shift.
   */
  candidate({
    slug: "deep-current",
    name: "Deep Current",
    description:
      "Bioluminescent folds a long way under the surface. Nothing strikes: the bass swells and takes a second and a half to let go, the tide glows in over two bars, and every section change turns the water a different colour.",
    bpmHint: [60, 110],
    preset: "nebula",
    params: {
      hue: 196,
      hue2: 288,
      duo: 0.45,
      hueRange: 70,
      midHueShift: 40,
      saturation: 1.12,
      scale: 2,
      flow: 0.05,
      kaleido: 8,
      contrast: 0.42,
      warp: 2.4,
      angle: 0,
      spin: 0.35,
      depth: 0.6,
      sparkle: 0.35,
      sparkleScale: 14,
      sparkleSharp: 26,
      beatRipple: 0.28,
      rippleWidth: 22,
      rippleWarp: 0.06,
      brightFloor: 0.1,
      bassBright: 0.5,
      beatBloom: 0.1,
      driveGlow: 0.14,
      hotCore: 0.5,
      stars: 0.25,
      windStrength: 0.18,
      windAngle: 205,
      vignette: 0.6,
    },
    sync: {
      mode: "bass",
      smooth: 0.72,
      attack: 0.35,
      release: 0.8,
      shapeRound: 0.35,
      contrast: 0.42,
    },
    // Ink, not black: the composite keys on luma, so a near-black fill sinks
    // the backdrop without touching the folds themselves.
    bg: { mode: BG_SOLID, color: [0.012, 0.03, 0.046] },
    smoothSpectrum: true,
    post: {
      exposure: 0.92,
      bloom: 0.22,
      bloomThreshold: 0.86,
      tonemap: true,
      vignette: 0.34,
      grain: 0.045,
      chromatic: 0.03,
    },
    motion: { rotation: 0.75, pulse: 0.65, spectrumSmooth: 0.45 },
    mods: [
      {
        source: "bass",
        param: "bassBright",
        amount: 0.22,
        curve: "smooth",
        attack: 0.28,
        release: 1.4,
      },
      {
        source: "rms",
        param: "post:bloom",
        amount: 0.16,
        curve: "smooth",
        attack: 0.5,
        release: 2.2,
      },
      { source: "lfo:sine:8", param: "angle", amount: 0.06 },
      { source: "lfo:sine:4", param: "scale", amount: 0.05 },
      { source: "lfo:saw:8", param: "driveGlow", amount: 0.3, attack: 0.6, release: 1.2 },
      { source: "sectionPulse", param: "hue", amount: 0.06, curve: "exp", attack: 0.6, release: 6 },
      {
        source: "kick",
        param: "beatRipple",
        amount: 0.12,
        curve: "exp",
        attack: 0.01,
        release: 0.35,
      },
    ],
  }),

  /* FILM-GRADE SUBTLE — proposed replacement for the gallery's
   * `sunset-circuit`.
   *
   * The incumbent is VHS Sunrise promoted to a document. The golden-sun /
   * teal-grid pairing that gave it its identity is kept; the tape-era
   * treatment is not. This is the hour after the set rather than the set: a
   * road switched on, the sun sinking on a timeline lane over the first
   * twenty-four seconds, fog rolling in with it, and film grain doing the era
   * work in the post chain where the user can dial it from one place.
   *
   * There is no kick route anywhere in the piece. Every route is a smooth
   * curve on a slow envelope — loudness on exposure with a 1.6 s release,
   * energy on fog with three seconds — so the visual never snaps. The two
   * LFOs are the only mechanical motion: a very small 8-beat drift on the
   * sun's horizontal position, and a 4-beat breath in the sun's bands.
   *
   * Both lanes END on the value the base params hold, so deleting the
   * timeline leaves the shot the theme settles into rather than snapping to
   * something else (the rule Skyline established in the factory pack).
   */
  candidate({
    slug: "sunset-circuit",
    name: "Sunset Circuit",
    description:
      "The drive home, not the set: a low sun sinking over the first twenty-four seconds, a teal grid running out to a hazy horizon, and real film grain instead of tape hiss. Nothing in it flashes.",
    bpmHint: [90, 124],
    preset: "synthwave",
    params: {
      hue: 28,
      gridHue: 202,
      sunWarm: 1.45,
      sunR: 0.36,
      sunY: 0.26,
      sunX: -0.18,
      sunRays: 0.22,
      scan: 0.46,
      scanCount: 18,
      scanWidth: 0.62,
      scanPhase: 0,
      mountains: 0.6,
      skyline: 0.22,
      skyDensity: 0.4,
      windows: 0.18,
      roadW: 0.44,
      roadLanes: 1,
      roadGlow: 0.7,
      gridGlow: 0.75,
      gridScale: 0.85,
      gridLock: 1,
      horizonY: 0.47,
      speed: 0.55,
      react: 0.55,
      beatPulse: 0.2,
      stars: 1,
      starDensity: 0.22,
      fog: 1.15,
      vignette: 0.4,
    },
    sync: { mode: "energy", smooth: 0.68, attack: 0.4, release: 0.72, contrast: 0.45 },
    post: {
      exposure: 0.96,
      bloom: 0.24,
      bloomThreshold: 0.78,
      tonemap: true,
      vignette: 0.38,
      grain: 0.085,
      chromatic: 0.035,
    },
    motion: { pulse: 0.7, spectrumSmooth: 0.3 },
    timeline: {
      enabled: true,
      scenes: [],
      lanes: [
        {
          param: "sunY",
          keyframes: [
            { id: "sunset-circuit-k0", t: 0, value: 0.34, curve: "smooth" },
            { id: "sunset-circuit-k1", t: 24, value: 0.26, curve: "smooth" },
          ],
        },
        {
          param: "fog",
          keyframes: [
            { id: "sunset-circuit-k2", t: 0, value: 0.75, curve: "smooth" },
            { id: "sunset-circuit-k3", t: 24, value: 1.15, curve: "smooth" },
          ],
        },
      ],
    },
    mods: [
      {
        source: "rms",
        param: "post:exposure",
        amount: 0.05,
        curve: "smooth",
        attack: 0.8,
        release: 1.6,
      },
      {
        source: "bass",
        param: "gridGlow",
        amount: 0.18,
        curve: "smooth",
        attack: 0.25,
        release: 0.9,
      },
      { source: "energy", param: "fog", amount: 0.12, curve: "smooth", attack: 1.2, release: 3 },
      {
        source: "treble",
        param: "windows",
        amount: 0.2,
        curve: "smooth",
        attack: 0.15,
        release: 0.7,
      },
      { source: "lfo:sine:8", param: "sunX", amount: 0.05 },
      { source: "lfo:sine:4", param: "scanPhase", amount: 0.25 },
    ],
  }),

  /* TYPOGRAPHIC — new entry.
   *
   * The one candidate where the type is the design and the visual is the bed.
   * A single amber vector trace held inside a narrow band (`traceClamp` 0.3)
   * so the lower third stays clear for the lockup, a broadcast reticle for
   * framing, and three text layers that carry the whole composition: a wide-
   * tracked kicker top-left, the title set heavy at the bottom-left, the
   * artist under it in a warm tint at a third of the weight.
   *
   * It is also the timeline SCENE entry, and the name is the reason: the
   * first twelve seconds run a standby instrument — grid graticule, dim beam,
   * long vignette — and then a two-and-a-half second `glitch` transition
   * opens into the full look. That is a scene pair, not automation, because
   * what changes is the whole setup rather than one number. Delete the two
   * scenes to start on the open.
   *
   * `audiogram.progressBar` rides along at the frame's edge, because a
   * broadcast piece is a finished deliverable and a progress bar is the one
   * thing a clip posted to a timeline actually needs.
   */
  candidate({
    slug: "cold-open",
    name: "Cold Open",
    description:
      "A single amber trace on a broadcast reticle, with your title and artist set as a hard editorial lockup. Twelve seconds of standby, then a glitch cut into the full instrument.",
    bpmHint: [70, 130],
    preset: "oscilloscope",
    params: {
      hue: 32,
      gain: 1,
      calm: 0.62,
      glow: 0.5,
      traceBright: 1.1,
      traceClamp: 0.3,
      coreWidth: 0.003,
      fill: 0,
      mirror: 0,
      traces: 1,
      renderMode: 0,
      display: 0,
      persist: 0.3,
      agFloor: 0.35,
      agRange: 1.5,
      hueWave: 14,
      bandHue: 40,
      ghostDim: 0.35,
      graticule: 3,
      gridLevel: 0.08,
      gridBeat: 0.45,
      scanline: 0.16,
      beatLift: 0.12,
      bgLevel: 0.02,
      vignette: 0.7,
      kaleido: 1,
    },
    sync: { mode: "energy", smooth: 0.45, attack: 0.12, release: 0.5, contrast: 0.5 },
    bg: { mode: BG_SOLID, color: [0.035, 0.03, 0.026] },
    post: {
      exposure: 1,
      bloom: 0.18,
      bloomThreshold: 0.92,
      tonemap: true,
      vignette: 0.3,
      grain: 0.07,
      chromatic: 0.02,
    },
    motion: { pulse: 0.8, spectrumSmooth: 0.2 },
    overlayLayers: coldOpenLockup("cold-open"),
    // Lyrics land at the TOP: the lockup owns the bottom-left corner, and the
    // app's default bottom position would stack words on the artist line.
    lyricStyle: { position: "top", size: 0.9, fadeSec: 0.25, anim: "wipe" },
    audiogram: { progressBar: true, color: "#ffb257" },
    timeline: {
      enabled: true,
      scenes: [
        {
          id: "cold-open-s0",
          name: "Standby",
          presetId: "oscilloscope",
          start: 0,
          params: {
            graticule: 0,
            gridLevel: 0.05,
            traceBright: 0.6,
            glow: 0.28,
            persist: 0.18,
            scanline: 0.24,
            beatLift: 0.04,
            vignette: 0.85,
          },
        },
        {
          id: "cold-open-s1",
          name: "Open",
          presetId: "oscilloscope",
          start: 12,
          fadeSec: 2.5,
          transition: "glitch",
        },
      ],
      lanes: [],
    },
    mods: [
      {
        source: "voice",
        param: "traceBright",
        amount: 0.25,
        curve: "smooth",
        attack: 0.1,
        release: 0.55,
      },
      { source: "kick", param: "gridBeat", amount: 0.3, curve: "exp", attack: 0.01, release: 0.28 },
      {
        source: "treble",
        param: "glow",
        amount: 0.18,
        curve: "smooth",
        attack: 0.05,
        release: 0.4,
      },
      {
        source: "rms",
        param: "post:bloom",
        amount: 0.12,
        curve: "smooth",
        attack: 0.4,
        release: 1.2,
      },
      { source: "lfo:sine:4", param: "persist", amount: 0.18 },
      {
        source: "sectionPulse",
        param: "post:chromatic",
        amount: 0.1,
        curve: "exp",
        attack: 0.02,
        release: 1.8,
      },
    ],
  }),

  /* MAXIMAL FESTIVAL — new entry.
   *
   * Flying (`fly` on) through a wide-hued field at near-maximum density, with
   * streaks, hot cores and three parallax layers doing the scale. Everything a
   * drop touches is authored below its ceiling so the drop has somewhere to
   * go: density sits at 19 of 24, beat flash at 0.22 of 0.5, shooting stars at
   * 0.28 of 1.
   *
   * Two routes are the point of the entry. `energy -> density` with a 1.5 s
   * attack and a 3.5 s release makes the sky physically empty out through a
   * breakdown and refill through the build — arrangement, not beat. And
   * `sectionPulse -> shootingStars`, `exp`-curved with a four-second release,
   * throws a meteor shower at every section boundary and lets it die out over
   * the next bars. That route is why the theme is called what it is.
   */
  candidate({
    slug: "meteor-hour",
    name: "Meteor Hour",
    description:
      "Flying through a wide-open sky at festival scale — the field thins out through a breakdown and refills as the track builds, and every section change throws a shower that burns out over the next few bars.",
    bpmHint: [120, 160],
    preset: "particles",
    params: {
      hue: 268,
      hueVariance: 115,
      saturation: 1.15,
      lightness: 1.05,
      bandColor: 55,
      density: 19,
      size: 0.13,
      sizeVar: 0.8,
      fill: 0.84,
      layers: 3,
      clump: 0.34,
      // `constellation` is deliberately absent: its own hint scopes it to
      // drift mode, and this entry flies. Authoring it here would have shipped
      // a number that renders nothing.
      mirror: 1,
      fly: 1,
      speed: 0.85,
      direction: 90,
      parallax: 0.8,
      streak: 1.1,
      wander: 0.5,
      wanderSpeed: 0.5,
      beatDance: 0.7,
      sizePulse: 1.25,
      energyDrive: 1.3,
      beatFlash: 0.22,
      beatPop: 0.65,
      shootingStars: 0.28,
      hotCore: 0.84,
      twinkle: 0.5,
      glow: 0.6,
      brightness: 1.05,
      bgLevel: 0.03,
      vignette: 0.4,
    },
    sync: { mode: "kick", smooth: 0.22, attack: 0.02, release: 0.42 },
    post: {
      exposure: 1.02,
      bloom: 0.42,
      bloomThreshold: 0.82,
      tonemap: true,
      vignette: 0.28,
      grain: 0.02,
      chromatic: 0.07,
    },
    motion: { rotation: 1.15, pulse: 1.3, spectrumSmooth: 0.15 },
    mods: [
      {
        source: "kick",
        param: "beatFlash",
        amount: 0.3,
        curve: "exp",
        attack: 0.005,
        release: 0.18,
      },
      {
        source: "kick",
        param: "post:bloom",
        amount: 0.24,
        curve: "exp",
        attack: 0.01,
        release: 0.32,
      },
      {
        source: "bass",
        param: "speed",
        amount: 0.22,
        curve: "smooth",
        attack: 0.08,
        release: 0.55,
      },
      {
        source: "energy",
        param: "density",
        amount: 0.18,
        curve: "smooth",
        attack: 1.5,
        release: 3.5,
      },
      { source: "hat", param: "twinkle", amount: 0.25, curve: "exp", attack: 0.01, release: 0.22 },
      { source: "lfo:sine:8", param: "direction", amount: 0.05 },
      {
        source: "sectionPulse",
        param: "shootingStars",
        amount: 0.35,
        curve: "exp",
        attack: 0.05,
        release: 4,
      },
    ],
  }),

  /* RHYTHMIC / GEOMETRIC — new entry.
   *
   * The Tunnel's wireframe material (`material` 2), which no shipped content
   * has ever selected, in a near-square shaft: `roundness` 0.15, `twist` 0.3,
   * `surfaceWarp` 0.25, junctions lit at the intersections, 4-fold mirror.
   * Architecture rather than a ride — the opposite end of the same mode from
   * the factory pack's Hyperlane.
   *
   * Its rhythm section is three routes nothing else in the product uses:
   *  - a SQUARE LFO on the grid brightness, two beats high and two beats low,
   *    with 40 ms attack and 180 ms release so it lands as a mechanical swell
   *    on the grid rather than a strobe;
   *  - `barPhase` on the centre glow — a ramp that winds up across each bar
   *    and resets on the downbeat, released over a quarter second so the
   *    reset reads as a fall rather than a cut;
   *  - `sectionPulse` on `mirror`, whose spec is `mod: "snap"`: the applied
   *    value quantizes, so a section boundary steps the shaft from four-fold
   *    to six-fold symmetry and it walks back down over the next two and a
   *    half seconds. The only place in any shipped or candidate content where
   *    a snapped enum is modulated.
   */
  candidate({
    slug: "blueprint",
    name: "Blueprint",
    description:
      "A square wireframe shaft with lit junctions and four-fold symmetry — drafting-table cyan on ink. The grid pulses on a two-beat square wave, the centre winds up across each bar, and a section change steps the whole shaft to six-fold and back.",
    bpmHint: [125, 150],
    preset: "tunnel-rings",
    params: {
      hue: 196,
      hueSpread: 40,
      colorFade: 0.25,
      material: 2,
      speed: 0.3,
      rings: 12,
      spokes: 20,
      junction: 0.55,
      twist: 0.3,
      roundness: 0.15,
      surfaceWarp: 0.25,
      curve: 0.3,
      curveScale: 1.2,
      mirror: 4,
      beatPulse: 0.85,
      beatSpeed: 0.16,
      beatBright: 0.3,
      pulseWidth: 6,
      cruiseFloor: 0.4,
      cruiseEnergy: 1.05,
      centerGlow: 0.24,
      tileLevel: 0.06,
      tileSpectrum: 0.66,
      tileSat: 0.56,
      checker: 0.05,
      groutWidth: 0.03,
      groutLevel: 0.26,
      fogNear: 0.02,
      fogFar: 0.6,
      coverWall: 0,
      vignette: 0.5,
    },
    sync: {
      mode: "kick",
      smooth: 0.18,
      attack: 0.012,
      release: 0.34,
      shapeRound: 0.1,
      contrast: 0.58,
    },
    bg: { mode: BG_SOLID, color: [0.02, 0.028, 0.04] },
    post: {
      exposure: 0.98,
      bloom: 0.3,
      bloomThreshold: 0.88,
      tonemap: true,
      vignette: 0.34,
      grain: 0.03,
      chromatic: 0.05,
    },
    motion: { rotation: 0.9, pulse: 1.15 },
    mods: [
      {
        source: "kick",
        param: "beatBright",
        amount: 0.28,
        curve: "exp",
        attack: 0.005,
        release: 0.16,
      },
      { source: "lfo:square:4", param: "groutLevel", amount: 0.18, attack: 0.04, release: 0.18 },
      {
        source: "barPhase",
        param: "centerGlow",
        amount: 0.2,
        curve: "smooth",
        attack: 0.02,
        release: 0.25,
      },
      {
        source: "bass",
        param: "pulseWidth",
        amount: -0.18,
        curve: "smooth",
        attack: 0.1,
        release: 0.6,
      },
      {
        source: "energy",
        param: "speed",
        amount: 0.14,
        curve: "smooth",
        attack: 0.6,
        release: 1.8,
      },
      {
        source: "snare",
        param: "post:chromatic",
        amount: 0.07,
        curve: "exp",
        attack: 0.01,
        release: 0.22,
      },
      {
        source: "sectionPulse",
        param: "mirror",
        amount: 0.2,
        curve: "exp",
        attack: 0.05,
        release: 2.5,
      },
    ],
  }),
];
