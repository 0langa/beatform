import {
  BG_PRESET,
  BG_SOLID,
  DEFAULT_MOTION,
  DEFAULT_POST,
  type BgSettings,
  type MotionSettings,
  type ParamValues,
  type PostSettings,
} from "../render/types";
import { DEFAULT_LYRIC_STYLE, type LyricStyle } from "./lyrics";
import { DEFAULT_AUDIOGRAM, type AudiogramSettings } from "./audiogram";
import { defaultBuilderStack, type BuilderLayer } from "../render/builder2";
import type { Aspect, ProjectDocument } from "./project";
import type { ThemeMeta } from "./themes";
import type { SyncSettings } from "../audio/types";
import type { ModRoute } from "./modMatrix";
import type { Timeline } from "./timeline";
import type { OverlayLayer } from "../render/overlay";

/**
 * Factory theme packs — curated, genre-shaped starting points shipped
 * with the app. Authored as TYPED data (not JSON files) so the compiler
 * checks every field against the real document schema; exporting one writes
 * the same .bftheme file a community theme uses. Params are partial:
 * anything unspecified resolves to the preset's defaults at apply time,
 * exactly like a saved project.
 *
 * A theme is a COMPOSITION, not a recolour. Each one commits to all of:
 * visual + params, the sync feel that drives it, the post chain, the motion
 * masters, and — the piece the first generation of themes never used —
 * modulation routes, so the look breathes with the track instead of sitting
 * still. Several also carry the document-level features a "complete look"
 * really needs: frame aspect, background mode, timeline automation, an
 * audiogram, a lyric style, an overlay lockup.
 *
 * Rules every entry follows:
 *  - Deterministic: plain serializable data only. Route and layer ids are
 *    derived from the theme's slug (below), never Date.now()/random, so
 *    applying the same theme produces the same project document every
 *    launch — which is what makes the round-trip test meaningful.
 *  - Canonical: the authored document must already equal what
 *    validateDocument() would produce, so apply -> export -> re-import is a
 *    fixed point. factoryThemes.test.ts asserts exactly that.
 *  - Headroom: these are starting points. Nothing is pinned to a spec
 *    extreme, so the user's first slider drag has somewhere to go.
 */

export interface FactoryTheme {
  meta: ThemeMeta;
  document: ProjectDocument;
}

/** A modulation route without its id — the builder derives a stable one. */
type ModSpec = Omit<ModRoute, "id">;
/** A Builder layer without its id — same reason. */
type LayerSpec = Omit<BuilderLayer, "id">;

interface ThemeSpec {
  /** Stable, kebab-case. Seeds every generated id in the document. */
  slug: string;
  name: string;
  description: string;
  bpmHint?: [number, number];
  preset: string;
  /** Partial: unlisted keys resolve to the preset's own defaults. */
  params?: ParamValues;
  sync?: SyncSettings;
  /** Merged over DEFAULT_POST — list only what the look actually needs. */
  post?: Partial<PostSettings>;
  motion?: Partial<MotionSettings>;
  mods?: ModSpec[];
  bg?: BgSettings;
  aspect?: Aspect;
  timeline?: Timeline;
  lyricStyle?: Partial<LyricStyle>;
  audiogram?: Partial<AudiogramSettings>;
  overlayLayers?: OverlayLayer[];
  builderStack?: LayerSpec[];
}

const BY = "Beatform factory pack";
const LICENSE = "CC0-1.0";

function theme(spec: ThemeSpec): FactoryTheme {
  const mods: ModRoute[] = (spec.mods ?? []).map((m, i) => ({ id: `${spec.slug}-m${i}`, ...m }));
  const layers: BuilderLayer[] | undefined = spec.builderStack?.map((l, i) => ({
    id: `${spec.slug}-l${i}`,
    ...l,
  }));
  return {
    meta: {
      name: spec.name,
      author: BY,
      license: LICENSE,
      description: spec.description,
      ...(spec.bpmHint ? { bpmHint: spec.bpmHint } : {}),
    },
    document: {
      presetId: spec.preset,
      // Keyed by the theme's own preset: switching modes after applying
      // leaves the other modes at their defaults, which is what a user
      // exploring from a theme expects.
      paramsByPreset: spec.params ? { [spec.preset]: spec.params } : {},
      syncByPreset: spec.sync ? { [spec.preset]: spec.sync } : {},
      bgByPreset: {},
      centerImageByPreset: {},
      bg: spec.bg ?? { mode: BG_PRESET, color: [0, 0, 0] },
      overlayLayers: spec.overlayLayers ?? [],
      assets: {},
      aspect: spec.aspect ?? "16:9",
      modsByPreset: mods.length > 0 ? { [spec.preset]: mods } : {},
      smoothSpectrum: false,
      timeline: spec.timeline ?? { enabled: false, scenes: [], lanes: [] },
      post: { ...DEFAULT_POST, ...spec.post },
      motion: { ...DEFAULT_MOTION, ...spec.motion },
      lyricStyle: { ...DEFAULT_LYRIC_STYLE, ...spec.lyricStyle },
      audiogram: { ...DEFAULT_AUDIOGRAM, ...spec.audiogram },
      customDefs: [],
      builderStack: layers ? { layers } : defaultBuilderStack(),
    },
  };
}

/** Title/artist lockup for the release-post theme. Uses the {title} /
 * {artist} tokens so it fills itself from the loaded track's tags — and
 * renders nothing at all until one is loaded (empty text is skipped). */
const releaseLockup = (slug: string): OverlayLayer[] => [
  {
    id: `${slug}-t0`,
    type: "text",
    text: "{title}",
    font: "Arial",
    weight: 800,
    size: 0.05,
    color: [1, 1, 1],
    opacity: 1,
    letterSpacing: 0.12,
    anchor: "bc",
    offset: [0, -0.1],
    glow: 0.3,
    uppercase: true,
  },
  {
    id: `${slug}-t1`,
    type: "text",
    text: "{artist}",
    font: "Arial",
    weight: 400,
    size: 0.026,
    color: [1, 1, 1],
    opacity: 0.72,
    letterSpacing: 0.3,
    anchor: "bc",
    offset: [0, -0.05],
    glow: 0.15,
    uppercase: true,
  },
];

export const FACTORY_THEMES: FactoryTheme[] = [
  /* The default release visual: the artwork IS the centrepiece. coverHue
   * repaints the whole scene from the cover's palette on every track load, so
   * one theme gives every single a different, matching look. */
  theme({
    slug: "cover-story",
    name: "Cover Story",
    description:
      "Your artwork as the centrepiece: the ring repaints itself from the cover's own colours, the bloom breathes on the kick, and the title/artist set themselves from the track's tags.",
    bpmHint: [80, 160],
    preset: "bass-circle",
    params: {
      hue: 285,
      hueSpread: 70,
      radius: 0.2,
      pump: 0.26,
      beatPump: 0.22,
      barLen: 0.16,
      barGlow: 0.35,
      gap: 0.03,
      symmetry: 2,
      rimBright: 0.6,
      particles: 1.1,
      partDensity: 6,
      partFill: 0.4,
      partFloat: 0.45,
      beatBurst: 1,
      cover: 1,
      coverHue: 1,
      coverMix: 0.95,
      coverBright: 0.7,
      vignette: 0.5,
    },
    sync: { mode: "kick", smooth: 0.35, attack: 0.04, release: 0.55 },
    post: { exposure: 1, bloom: 0.2, bloomThreshold: 1.02, tonemap: true, vignette: 0.32 },
    motion: { pulse: 1.1, spectrumSmooth: 0.25 },
    mods: [
      { source: "kick", param: "post:bloom", amount: 0.18 },
      { source: "driveBeat", param: "post:exposure", amount: 0.05 },
      { source: "bass", param: "rimBright", amount: 0.15 },
      { source: "energy", param: "hueSpread", amount: 0.1 },
    ],
    overlayLayers: releaseLockup("cover-story"),
  }),

  /* Big-room: everything accelerates together. Kick buys speed AND bloom, so
   * a drop reads as the tunnel physically lurching forward rather than just
   * getting brighter. */
  theme({
    slug: "hyperlane",
    name: "Hyperlane",
    description:
      "Corkscrew tunnel at cruising speed. Every kick buys a burst of acceleration and a bloom flare; the treble splits the light at the edges. Festival-scale.",
    bpmHint: [124, 155],
    preset: "tunnel-rings",
    params: {
      hue: 120,
      hueSpread: 110,
      speed: 0.45,
      rings: 10,
      spokes: 18,
      beatPulse: 0.9,
      beatSpeed: 0.2,
      beatBright: 0.25,
      twist: 1.6,
      roundness: 0.75,
      surfaceWarp: 1.6,
      tileSat: 0.9,
      tileSpectrum: 0.5,
      groutLevel: 0.22,
      checker: 0.14,
      pulseWidth: 11,
      centerGlow: 0.12,
      fogFar: 0.9,
      vignette: 0.4,
    },
    sync: { mode: "kick", smooth: 0.25, attack: 0.02, release: 0.45 },
    post: {
      exposure: 0.95,
      bloom: 0.28,
      bloomThreshold: 1.05,
      tonemap: true,
      vignette: 0.3,
      chromatic: 0.06,
    },
    motion: { rotation: 1.2, pulse: 1.2 },
    mods: [
      { source: "kick", param: "beatSpeed", amount: 0.35 },
      { source: "kick", param: "post:bloom", amount: 0.22 },
      { source: "bass", param: "speed", amount: 0.2 },
      { source: "treble", param: "post:chromatic", amount: 0.08 },
    ],
  }),

  /* Retro, but the modern kind: grain + chromatic doing the VHS work in the
   * post chain instead of faking it in the shader, so the user can dial the
   * whole "era" from one place. */
  theme({
    slug: "chrome-sunset",
    name: "Chrome Sunset",
    description:
      "Neon grid racing a scanline sun, beat-locked so the lines cross on the downbeat. Tape grain and RGB fringing ride the treble. Synthwave, driving.",
    bpmHint: [85, 128],
    preset: "synthwave",
    params: {
      hue: 348,
      gridHue: 292,
      sunR: 0.32,
      sunY: 0.28,
      sunRays: 0.12,
      scan: 0.7,
      mountains: 0.55,
      stars: 1,
      starDensity: 0.4,
      react: 1.1,
      beatPulse: 0.7,
      speed: 1.1,
      gridGlow: 1.15,
      gridScale: 0.65,
      gridLock: 1,
      fog: 1,
      vignette: 0.35,
    },
    sync: { mode: "kick", smooth: 0.3, attack: 0.03, release: 0.5 },
    post: {
      exposure: 1,
      bloom: 0.32,
      bloomThreshold: 0.9,
      tonemap: true,
      chromatic: 0.14,
      grain: 0.06,
      vignette: 0.25,
    },
    motion: { pulse: 1.1 },
    mods: [
      { source: "kick", param: "post:bloom", amount: 0.18 },
      { source: "bass", param: "gridGlow", amount: 0.2 },
      { source: "treble", param: "post:chromatic", amount: 0.1 },
      { source: "energy", param: "speed", amount: 0.1 },
    ],
  }),

  /* The 120k-particle sim, tuned as weather rather than fireworks: bass owns
   * the current, kicks own the scatter. Two different physical handles on the
   * same field is what makes it read as a real fluid. */
  theme({
    slug: "ion-storm",
    name: "Ion Storm",
    description:
      "A hundred thousand embers swept through a curl-noise current. Bass drives the stream, kicks blow it apart, hats dust the frame with grain. Heavy, organic, GPU-hungry.",
    bpmHint: [100, 150],
    preset: "particle-flow",
    params: {
      hue: 18,
      hueSpread: 40,
      flowStrength: 0.7,
      swirl: 0.9,
      flowScale: 1.1,
      damping: 0.965,
      gravity: 0.5,
      audioFlow: 1.8,
      beatBurst: 1.6,
      size: 0.007,
      sizePulse: 0.7,
      brightness: 0.35,
      density: 0.4,
      speedColor: 0,
      sat: 0.9,
      spawnRadius: 0.12,
    },
    sync: { mode: "kick", smooth: 0.3, attack: 0.03, release: 0.5 },
    post: { exposure: 0.9, bloom: 0.3, bloomThreshold: 1.05, tonemap: true, vignette: 0.5 },
    mods: [
      { source: "kick", param: "beatBurst", amount: 0.3 },
      { source: "bass", param: "flowStrength", amount: 0.25 },
      { source: "driveBeat", param: "post:bloom", amount: 0.2 },
      { source: "hat", param: "post:grain", amount: 0.06 },
    ],
  }),

  /* The timeline theme. A camera move is the one thing modulation cannot
   * do — it has to be scripted against track time, not audio — so this is
   * where automation lanes earn their place instead of being a demo.
   *
   * Tuned against the mesh3d shader's own arithmetic rather than by taste,
   * because three of its knobs are traps on a loud master:
   *
   *  - The "hot top" term is `smoothstep(0.55, 1, h / (heightScale * 0.6))`,
   *    and `h` is proportional to heightScale — so the wash-out is INDEPENDENT
   *    of Height. Raising Glow is what blows it out (it multiplies
   *    heightScale), which is why this sits at 0.1 with Light near the top of
   *    its range instead: the key light carries the form, self-illumination
   *    only tips the tallest towers over.
   *  - The fragment tone-maps to [0,1] before the post chain ever sees it, so
   *    a bloom threshold at or above 1 can NEVER fire on this mode. The old
   *    1.1 shipped a dead bloom and a dead driveBeat->bloom route; 0.85 is
   *    inside what the mesh can emit, so the hot core reads as light instead
   *    of as blown paper.
   *  - Contrast is display GAMMA (0.5 = neutral, higher = steeper), so a high
   *    value thins the spectrum toward its peaks. 0.92 is what keeps the outer
   *    rings below the hot threshold and coloured.
   *
   * Framing follows from that: the grid is spread (spacing 1) with thin
   * columns so the streets stay black, and the camera holds far enough back
   * that the lit downtown is one element in the frame with sky around it. */
  theme({
    slug: "skyline",
    name: "Skyline",
    description:
      "A spectrum city under a scripted camera: the first 20 seconds drop from a high establishing shot to a low pass over the towers, then hold. The move lives on the Timeline — delete the two lanes to fly it yourself.",
    bpmHint: [110, 132],
    preset: "spectrum-scape",
    params: {
      hue: 75,
      hueRange: 85,
      heightScale: 10,
      // Both camera keys sit at the END of the scripted move, so deleting the
      // lanes leaves the shot the theme holds on rather than snapping.
      camPitch: 30,
      camDist: 25.5,
      camSpin: 6,
      camYaw: 30,
      emissive: 0.1,
      fov: 50,
      light: 1.35,
      barWidth: 0.36,
      spacing: 1,
      targetY: 2.4,
    },
    sync: { mode: "kick", smooth: 0.4, attack: 0.05, release: 0.55, contrast: 0.92 },
    post: { exposure: 0.95, bloom: 0.5, bloomThreshold: 0.85, tonemap: true, vignette: 0.5 },
    timeline: {
      enabled: true,
      scenes: [],
      lanes: [
        {
          param: "camDist",
          keyframes: [
            { id: "skyline-k0", t: 0, value: 29.5, curve: "smooth" },
            { id: "skyline-k1", t: 10, value: 27.5, curve: "smooth" },
            { id: "skyline-k2", t: 20, value: 25.5, curve: "smooth" },
          ],
        },
        {
          param: "camPitch",
          keyframes: [
            { id: "skyline-k3", t: 0, value: 68, curve: "smooth" },
            { id: "skyline-k4", t: 10, value: 48, curve: "smooth" },
            { id: "skyline-k5", t: 20, value: 30, curve: "smooth" },
          ],
        },
      ],
    },
    mods: [
      // Glow used to multiply heightScale inside the shader, so this was cut
      // to a tenth of the old 0.2 to stop the whole downtown crossing the
      // tone-map knee. That coupling is gone (mesh3d normalises the emissive
      // term against Height now), but the small amount is still the right
      // shape for this look: enough to tip the towers on a kick, no more.
      { source: "kick", param: "emissive", amount: 0.05 },
      { source: "bass", param: "heightScale", amount: 0.07 },
      { source: "driveBeat", param: "post:bloom", amount: 0.15 },
    ],
  }),

  /* Feedback trails accumulate, so this look is defined by what each frame
   * ADDS. Kick drives the zoom burst (spatial) and the bloom (tonal) at once;
   * energy slowly rotates the hue of the older echoes behind them. */
  theme({
    slug: "event-horizon",
    name: "Event Horizon",
    description:
      "A star-lobed ring falling into itself, every frame echoing the last. Kicks punch the tunnel outward, older echoes drift through the spectrum behind it. For psytrance, DnB and hard techno.",
    bpmHint: [140, 180],
    preset: "echo-trails",
    params: {
      hue: 300,
      decay: 0.9,
      zoom: 0.42,
      swirl: -0.35,
      radius: 0.16,
      react: 0.3,
      inject: 0.7,
      thick: 0.02,
      beatZoom: 0.45,
      flowSwirl: 0.45,
      hueSpin: 0.35,
      hueDrift: 0.18,
      kickFlash: 0.5,
      echoHue: 0.3,
      sides: 6,
      beatStar: 0.6,
      vignette: 0.4,
    },
    sync: { mode: "kick", smooth: 0.22, attack: 0.02, release: 0.4 },
    post: {
      exposure: 1,
      bloom: 0.35,
      bloomThreshold: 0.9,
      tonemap: true,
      vignette: 0.3,
      chromatic: 0.08,
    },
    motion: { rotation: 1.2, pulse: 1.2 },
    mods: [
      { source: "kick", param: "beatZoom", amount: 0.3 },
      { source: "kick", param: "post:bloom", amount: 0.2 },
      { source: "treble", param: "swirl", amount: 0.12 },
      { source: "energy", param: "echoHue", amount: 0.15 },
    ],
  }),

  /* The only route in the pack driven by STEREO WIDTH: a wide, spacious mix
   * literally splits the light. It is the kind of thing that makes a
   * well-produced track look different from a mono bounce. */
  theme({
    slug: "liquid-chrome",
    name: "Liquid Chrome",
    description:
      "Mercury blobs under a slow key light — they fuse tighter as the bass lands, and the wider your mix, the further the colour fringes separate. Deep house, dub techno, ambient.",
    bpmHint: [110, 128],
    preset: "metaballs",
    params: {
      hue: 115,
      hueField: 8,
      count: 4,
      size: 0.1,
      speed: 0.22,
      glow: 0.35,
      threshold: 0.88,
      gloss: 0.35,
      lightAngle: 130,
      orbitX: 0.28,
      orbitY: 0.24,
      radiusFloor: 0.45,
      energyGrow: 0.4,
      radiusBand: 0.5,
      beatSwell: 0.28,
      innerGrad: 0.28,
      squash: 0.12,
      bgLevel: 0.02,
      vignette: 0.6,
    },
    sync: { mode: "bass", smooth: 0.45, attack: 0.15, release: 0.6 },
    post: {
      exposure: 1,
      bloom: 0.14,
      bloomThreshold: 1.05,
      tonemap: true,
      vignette: 0.35,
      chromatic: 0.05,
    },
    motion: { pulse: 1.1 },
    mods: [
      { source: "width", param: "post:chromatic", amount: 0.12 },
      { source: "bass", param: "threshold", amount: -0.12 },
      { source: "kick", param: "post:exposure", amount: 0.04 },
      { source: "energy", param: "gloss", amount: 0.1 },
    ],
  }),

  /* Hardware, not neon: panel variance, phosphor ghosting and scanlines make
   * it read as an assembled wall. The slow hue-shift on `energy` keeps a
   * 7-minute techno cut from looking like a still image. */
  theme({
    slug: "signal-wall",
    name: "Signal Wall",
    description:
      "A full-colour LED video wall with real hardware grit — per-diode variance, phosphor trails, scanlines, a border that flashes on the beat. The whole panel drifts slowly through the spectrum as the track builds.",
    bpmHint: [125, 145],
    preset: "led-matrix",
    params: {
      cols: 56,
      rows: 28,
      gap: 0.14,
      rounded: 0,
      dim: 0.18,
      spectrumColor: 0.85,
      litLevel: 0.4,
      hotBoost: 0.14,
      beatBoost: 0.16,
      ghost: 0.3,
      bassGlow: 0.1,
      beatFlash: 0.35,
      peakBright: 0.8,
      bloom: 0.6,
      scanline: 0.2,
      flicker: 0.08,
      panelVariance: 0.55,
      vignette: 0.6,
    },
    sync: { mode: "kick", smooth: 0.28, attack: 0.02, release: 0.4, shapeRound: 0.15 },
    post: {
      exposure: 0.95,
      bloom: 0.18,
      bloomThreshold: 1.05,
      tonemap: true,
      vignette: 0.5,
      chromatic: 0.04,
      grain: 0.03,
    },
    mods: [
      { source: "kick", param: "post:bloom", amount: 0.15 },
      { source: "bass", param: "bassGlow", amount: 0.25 },
      { source: "hat", param: "post:grain", amount: 0.08 },
      { source: "energy", param: "hueShift", amount: 0.08 },
    ],
  }),

  /* Long-form ambient: nothing here is allowed to snap. Every route is fed by
   * a SMOOTH source (energy/bass/rms), never an onset pulse, and the sync
   * envelope is slow on both edges — this is the anti-strobe theme. */
  theme({
    slug: "polar-night",
    name: "Polar Night",
    description:
      "Aurora curtains mirrored on the ice under a full starfield. Everything is driven by slow envelopes rather than beats — nothing here strobes. Built for drones, pads and long fades.",
    bpmHint: [50, 95],
    preset: "aurora",
    params: {
      hue: 168,
      hueStep: 55,
      hueSpread: 75,
      bright: 0.26,
      sat: 0.9,
      react: 0.3,
      flow: 0.45,
      thick: 0.05,
      baseY: 0.42,
      layers: 3,
      specAmt: 0.7,
      bassSwell: 0.2,
      drift: 0.12,
      wave: 0.9,
      rays: 0.3,
      beatPulse: 0.2,
      reflect: 0.4,
      horizon: 0.9,
      reflectFade: 5,
      stars: 1,
      bgGlow: 0.12,
    },
    sync: { mode: "energy", smooth: 0.82, attack: 0.5, release: 0.85 },
    post: {
      exposure: 0.8,
      bloom: 0.15,
      bloomThreshold: 1.15,
      tonemap: true,
      vignette: 0.35,
      grain: 0.04,
    },
    motion: { pulse: 0.7 },
    mods: [
      { source: "energy", param: "post:bloom", amount: 0.15 },
      { source: "bass", param: "bright", amount: 0.12 },
      { source: "rms", param: "bgGlow", amount: 0.15 },
    ],
  }),

  /* The restraint entry. Flat ink background, desaturated hairlines, no glow
   * bloat, one nearly-invisible route. Proof that the pack is a range and not
   * a contest — and the one to reach for behind a talking head or a title
   * card, where the visual must not win. */
  theme({
    slug: "editorial-ink",
    name: "Editorial Ink",
    description:
      "Wide, near-monochrome hairlines with floating peak caps on flat ink. No strobe, no bloom wash — just a single breath of exposure with the loudness. For acoustic, jazz, classical, and anything that has to sit behind text.",
    preset: "spectrum-bars",
    params: {
      hue: 205,
      hueSpread: 0,
      glow: 0.14,
      glowReach: 6,
      barGap: 0.5,
      barHeight: 0.7,
      barSat: 0.14,
      barLift: 0.5,
      capBright: 1.25,
      peaks: 1,
      mirror: 0,
      beatZoom: 0,
      bgLevel: 0,
      bgBassGlow: 0.012,
      beatFlash: 0,
      beatBright: 0.02,
      vignette: 0.35,
    },
    sync: { mode: "energy", smooth: 0.55, shapeRound: 0.3, contrast: 0.32 },
    // Solid ink instead of the preset's own wash: the composite keys on luma,
    // so a near-black fill flattens the backdrop without touching the bars.
    bg: { mode: BG_SOLID, color: [0.055, 0.06, 0.075] },
    post: {
      exposure: 1,
      bloom: 0.1,
      bloomThreshold: 1.1,
      tonemap: true,
      vignette: 0.2,
      grain: 0.05,
    },
    motion: { pulse: 0.5, detail: 0.55 },
    mods: [
      { source: "rms", param: "post:exposure", amount: 0.03 },
      { source: "energy", param: "barHeight", amount: 0.08 },
    ],
  }),

  /* Voice, not music: square frame, speech-band sync, and the audiogram
   * elements switched on — progress bar, clock, waveform strip. The one
   * theme that is a finished deliverable rather than a backdrop. */
  theme({
    slug: "on-air",
    name: "On Air",
    description:
      "A square podcast clip, finished: a warm orb that breathes with speech over a progress bar, an elapsed/total clock and a waveform strip. Speech-band sync, so background music barely moves it.",
    preset: "voice-orb",
    aspect: "1:1",
    params: {
      hue: 18,
      size: 0.11,
      response: 0.55,
      wobble: 0.4,
      ring: 1,
      ringDist: 1.55,
      ringWave: 0.035,
      sparkle: 0.3,
      voiceFocus: 0.85,
      rmsBlend: 0.45,
      growth: 0.35,
      coreGlow: 0.1,
      texture: 0.25,
      breathGlow: 0.2,
      rimGlow: 0.3,
      flare: 0.15,
      bgLevel: 0.03,
      vignette: 0.5,
    },
    sync: { mode: "voice", smooth: 0.55, attack: 0.15, release: 0.6 },
    bg: { mode: BG_SOLID, color: [0.05, 0.04, 0.038] },
    post: {
      exposure: 0.95,
      bloom: 0.16,
      bloomThreshold: 1.02,
      tonemap: true,
      vignette: 0.3,
      grain: 0.03,
    },
    motion: { pulse: 0.9 },
    audiogram: {
      progressBar: true,
      timeReadout: true,
      waveformStrip: true,
      color: "#ff8a3d",
    },
    mods: [
      { source: "voice", param: "post:bloom", amount: 0.12 },
      { source: "voice", param: "rimGlow", amount: 0.2 },
    ],
  }),

  /* Short-form vertical — the aspect nothing in the old pack covered. Framed
   * for a phone (tall core, deep vignette, progress bar), and the lyric style
   * is pre-dressed so dropping an .lrc on it produces a finished lyric reel. */
  theme({
    slug: "pocket-rave",
    name: "Pocket Rave",
    description:
      "Vertical 9:16 for Reels, Shorts and Canvas: a three-fold spectrum burst around your cover art, with a progress bar and lyrics already styled — drop an .lrc on it and it is a finished lyric video.",
    bpmHint: [90, 150],
    preset: "radial-burst",
    aspect: "9:16",
    params: {
      hue: 300,
      hueSpread: 50,
      innerRadius: 0.13,
      symmetry: 2,
      rotSpeed: 0.1,
      glow: 0.2,
      peaks: 0,
      cover: 1,
      barLen: 0.1,
      ringBreathe: 0.12,
      coreBeat: 0.1,
      coreBright: 0.3,
      beatBloom: 0.08,
      rimBright: 0.5,
      coverMix: 0.95,
      coverBright: 0.7,
      vignette: 0.6,
    },
    sync: { mode: "kick", smooth: 0.3, attack: 0.03, release: 0.5 },
    post: { exposure: 1, bloom: 0.2, bloomThreshold: 1.05, tonemap: true, vignette: 0.3 },
    motion: { pulse: 1.1 },
    lyricStyle: { size: 1.15, fadeSec: 0.22, anim: "slide" },
    audiogram: { progressBar: true, color: "#e85cff" },
    mods: [
      { source: "kick", param: "post:bloom", amount: 0.2 },
      { source: "bass", param: "innerRadius", amount: 0.12 },
      { source: "energy", param: "hueSpread", amount: 0.1 },
    ],
  }),

  /* Builder, pre-assembled. Six blended layers show what the
   * compositor is for — and because a Builder stack exposes no preset params,
   * its modulation necessarily targets the POST chain, which is the clearest
   * demonstration in the pack that post: routes are first-class. */
  theme({
    slug: "assembly",
    name: "Assembly",
    description:
      "Six Builder layers stacked and blended: wash, drifting bokeh, a waveform circle, a radial spectrum, beat rings and a low bar floor. Open Builder and pull it apart — every layer is editable.",
    bpmHint: [100, 140],
    preset: "builder2",
    sync: { mode: "kick", smooth: 0.35, attack: 0.05, release: 0.5 },
    post: { exposure: 1, bloom: 0.45, bloomThreshold: 0.8, tonemap: true, vignette: 0.2 },
    motion: { detail: 0.8 },
    builderStack: [
      {
        type: "wash",
        enabled: true,
        opacity: 1,
        blend: "normal",
        hue: 250,
        hueSpread: 60,
        params: { glow: 0.55, flash: 0.2 },
      },
      {
        type: "stars",
        enabled: true,
        opacity: 0.75,
        blend: "add",
        hue: 210,
        hueSpread: 120,
        params: { density: 12, speed: 0.4, streak: 0.5 },
      },
      {
        type: "bars",
        enabled: true,
        opacity: 0.5,
        blend: "add",
        hue: 265,
        hueSpread: 90,
        params: { height: 0.22, gap: 0.35, glow: 0.4, peaks: 0 },
      },
      {
        type: "radial",
        enabled: true,
        opacity: 0.9,
        blend: "add",
        hue: 285,
        hueSpread: 90,
        params: { inner: 0.2, len: 0.24, sym: 3 },
      },
      {
        type: "wavecircle",
        enabled: true,
        opacity: 0.85,
        blend: "screen",
        hue: 190,
        hueSpread: 40,
        params: { radius: 0.15, amp: 0.07 },
      },
      {
        type: "rings",
        enabled: true,
        opacity: 0.7,
        blend: "add",
        hue: 320,
        hueSpread: 90,
        params: { start: 0.08, end: 0.55, sharp: 0.65, bright: 0.9 },
      },
      {
        type: "vignette",
        enabled: true,
        opacity: 1,
        blend: "normal",
        hue: 210,
        hueSpread: 90,
        params: { amount: 0.7 },
      },
    ],
    mods: [
      { source: "kick", param: "post:bloom", amount: 0.2 },
      { source: "energy", param: "post:exposure", amount: 0.04 },
    ],
  }),
];
