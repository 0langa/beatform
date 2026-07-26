import type { AudioFeatures } from "../audio/types";

/**
 * Preset = one visual. Declares its tweakable parameters as a schema so the
 * UI can auto-generate controls and presets stay serializable (JSON in/out) —
 * this is the extension point for future visual customization.
 *
 * EVERY param is one f32, always. `control` picks the WIDGET, never the
 * storage: a toggle stores 0/1, an enum stores its option's number, a hue
 * stores degrees. That is not a style choice — the params buffer packs
 * `params[key] ?? default` at the spec's ABI index (see presetPrefix), saved
 * projects are `Record<string, number>`, and the modulation/MIDI/automation
 * paths clamp against min..max. A control type that needed a second float
 * would break all four at once.
 *
 * Consequence for migrations: changing a param's `control` NEVER changes a
 * saved value. A 0/1 slider that becomes a toggle reads the same 0/1 back.
 */
interface ParamSpecBase {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** One-line, user-facing: what turning this knob visibly does. */
  hint?: string;
  /**
   * Which panel group this knob belongs to — see PARAM_GROUPS (or the
   * preset's own `groups`). This is the ONE place a param's placement is
   * declared: the settings panel never carries a list of keys, so a new
   * param lands in the right group by declaring it here and nowhere else.
   * Absent = the catch-all "More" group, so a param can never go missing.
   */
  group?: string;
  /**
   * Sort weight inside the group; lower sorts first, ties fall back to
   * declaration order. Only needed to pull one knob to the top of its group —
   * authoring order already reads as intent for everything else.
   */
  order?: number;
}

/** One choice of an `enum` param. `value` is the number actually stored. */
export interface ParamOption {
  value: number;
  label: string;
  /** Optional per-option explanation, shown in the row's title. */
  hint?: string;
}

/** A continuous number: the default, and what every param was before v2.53. */
export interface SliderParamSpec extends ParamSpecBase {
  control?: "slider";
}

/**
 * A boolean. Typed to 0/1/step-1 so a "toggle" that could hold 0.5 is a
 * compile error rather than a switch that silently reads back as off.
 */
export interface ToggleParamSpec extends Omit<ParamSpecBase, "min" | "max" | "step"> {
  control: "toggle";
  min: 0;
  max: 1;
  step: 1;
  default: 0 | 1;
}

/**
 * A small set of named choices. Renders as a dropdown, because a slider over
 * "1..12 segments" or "0..2 image fit" makes the user hunt for values that
 * have names — the exact clutter this control exists to remove.
 */
export interface EnumParamSpec extends ParamSpecBase {
  control: "enum";
  options: ParamOption[];
}

/** A position on the colour wheel (degrees). Rainbow track, same f32. */
export interface HueParamSpec extends ParamSpecBase {
  control: "hue";
}

/** A direction in degrees. Gets a draggable dial next to its slider. */
export interface AngleParamSpec extends ParamSpecBase {
  control: "angle";
}

export type ParamSpec =
  SliderParamSpec | ToggleParamSpec | EnumParamSpec | HueParamSpec | AngleParamSpec;

/** The resolved widget kind — `control` with the slider default filled in. */
export type ParamControl = NonNullable<ParamSpec["control"]>;

/**
 * A group of related knobs inside one visual's settings.
 *
 * `rank` — not array position — is what orders the panel. Ranks are spaced by
 * 10 so a preset can slot its own group between two shared ones (Builder does
 * exactly that for its per-layer groups) without renumbering anything, and so
 * the order stays deterministic when groups arrive from two sources.
 */
export interface ParamGroupDef {
  id: string;
  label: string;
  hint?: string;
  rank: number;
}

/**
 * The shared vocabulary every visual sorts its knobs into. Ordered the way a
 * user builds a look: pick the form, colour it, make it move, make it react,
 * light it, then the trimmings.
 *
 * Adding a visual setting later means picking one of these ids — no panel
 * edit, no list to keep in sync. Adding a NEW axis means one entry here.
 */
export const PARAM_GROUPS: ParamGroupDef[] = [
  { id: "shape", label: "Shape", hint: "Size, count and layout of what is drawn", rank: 10 },
  { id: "color", label: "Color", hint: "Hue, spread and saturation", rank: 20 },
  { id: "motion", label: "Motion", hint: "Speed, spin and drift of this visual", rank: 30 },
  { id: "reaction", label: "Reaction", hint: "How hard the audio moves it", rank: 40 },
  { id: "glow", label: "Glow", hint: "Brightness, bloom and highlights", rank: 50 },
  { id: "image", label: "Image", hint: "Cover art drawn inside the visual", rank: 60 },
  { id: "camera", label: "Camera", hint: "Where the 3D camera sits and looks", rank: 70 },
  {
    id: "backdrop",
    label: "Backdrop",
    hint: "Behind and around it — wash, fog, vignette",
    rank: 80,
  },
];

/**
 * Where a param with an unknown (or missing) `group` goes. Deliberately a real
 * group and not a silent drop: an un-grouped knob still has to be reachable,
 * and landing in a visibly-named bucket is what makes the omission obvious.
 */
export const FALLBACK_GROUP: ParamGroupDef = {
  id: "more",
  label: "More",
  hint: "Knobs that have not been sorted into a group yet",
  rank: 900,
};

/** A factory look for a preset: named partial parameter override. */
export interface StyleDef {
  id: string;
  name: string;
  /** Keys not listed fall back to spec defaults. */
  values: Partial<ParamValues>;
}

export interface PresetDef {
  id: string;
  name: string;
  /** One-line description of the visual mode, shown in the settings panel. */
  description?: string;
  /** Factory looks — applied as defaults + values. First entry ≙ defaults. */
  styles?: StyleDef[];
  /**
   * Extra (or re-ranked) parameter groups for THIS visual, merged over
   * PARAM_GROUPS by id. Builder uses it to give each of its seven layers a
   * group of its own — sorting those by "Color / Motion / Glow" would scatter
   * one layer's knobs across the whole panel.
   */
  groups?: ParamGroupDef[];
  params: ParamSpec[];
  /**
   * Expert knobs: every internal constant worth touching. Rendered collapsed
   * in the UI; same ParamValues store, same shader ABI as `params`.
   */
  advanced?: ParamSpec[];
  /**
   * WGSL fragment body. Receives:
   *   uv (0..1), features uniforms, bins/peaks/waveform storage arrays.
   * Each param spec (main + advanced) is exposed as a generated accessor
   * `P_<key>()` — use those, not raw indices.
   * Must define: fn preset(uv: vec2f) -> vec4f
   *
   * Particle presets (see `particles`) still declare `wgsl`, but it is unused —
   * the renderer drives a built-in compute + instanced-draw path instead.
   */
  wgsl: string;
  /**
   * Marks a GPU compute-particle preset. The renderer runs a fixed-timestep
   * particle simulation (curl-noise flow + audio forces) and draws the
   * particles additively, bypassing the fragment `wgsl` path. Params (main +
   * advanced) drive the sim in ABI order — see PARTICLE_PARAM_KEYS in the
   * renderer. Deterministic: seeded init, fixed sim rate keyed to track time,
   * no RNG — so exports are bit-reproducible and preview tracks them closely.
   */
  particles?: ParticleSpec;
  /**
   * Marks a 3D preset: the renderer draws a depth-tested, instanced mesh grid
   * through a perspective camera (bypassing the fragment `wgsl` path). Bar
   * heights follow the spectrum; camera params (orbit/pitch/distance/fov) are
   * regular params so they are keyframeable via automation + modulation.
   */
  mesh3d?: Mesh3DSpec;
}

export interface ParticleSpec {
  /** Simulated + drawable particle count (GPU instances). */
  count: number;
}

export interface Mesh3DSpec {
  /** Grid is `grid` x `grid` instanced columns (grid² draw instances). */
  grid: number;
}

export type ParamValues = Record<string, number>;

/** Main + advanced specs in ABI order (buffer packing = accessor indices).
 * Memoized per preset object — this runs in the per-frame render + modulation
 * paths, and preset defs are stable (custom-preset edits mint a new object, so
 * the WeakMap naturally re-caches). */
const allParamsCache = new WeakMap<PresetDef, ParamSpec[]>();
export function allParams(preset: PresetDef): ParamSpec[] {
  let merged = allParamsCache.get(preset);
  if (!merged) {
    merged = preset.advanced ? [...preset.params, ...preset.advanced] : preset.params;
    allParamsCache.set(preset, merged);
  }
  return merged;
}

/** key -> spec map for a preset, memoized. Lets the per-frame modulation path
 * resolve a route's target by key in O(1) instead of scanning every param. */
const paramMapCache = new WeakMap<PresetDef, Map<string, ParamSpec>>();
export function paramSpecMap(preset: PresetDef): Map<string, ParamSpec> {
  let map = paramMapCache.get(preset);
  if (!map) {
    map = new Map(allParams(preset).map((p) => [p.key, p]));
    paramMapCache.set(preset, map);
  }
  return map;
}

/** Keys that live in `advanced` — the expert tier. Memoized per preset def. */
const advancedKeyCache = new WeakMap<PresetDef, Set<string>>();
export function advancedKeys(preset: PresetDef): Set<string> {
  let set = advancedKeyCache.get(preset);
  if (!set) {
    set = new Set((preset.advanced ?? []).map((p) => p.key));
    advancedKeyCache.set(preset, set);
  }
  return set;
}

/** Every group this preset can place a param into, keyed by id. */
const groupDefCache = new WeakMap<PresetDef, Map<string, ParamGroupDef>>();
export function presetGroups(preset: PresetDef): Map<string, ParamGroupDef> {
  let map = groupDefCache.get(preset);
  if (!map) {
    map = new Map(PARAM_GROUPS.map((g) => [g.id, g]));
    // Preset-declared groups win on id collision, so a visual can re-rank or
    // re-label a shared group without forking the registry.
    for (const g of preset.groups ?? []) map.set(g.id, g);
    groupDefCache.set(preset, map);
  }
  return map;
}

/** One group with the params that landed in it, ready to render. */
export interface ParamGroupView {
  group: ParamGroupDef;
  params: ParamSpec[];
}

/**
 * Sort `specs` into their declared groups, deterministically.
 *
 * The order is intentional at every level and never "whatever the array said":
 *  1. groups by their declared `rank`, ties broken by id so two groups sharing
 *     a rank can never swap places between renders;
 *  2. params by their declared `order` (default 0);
 *  3. ties by ABI index — authoring order WITHIN one group, which is the one
 *     place source order is meaningful (authors write related knobs together).
 *
 * `specs` is whatever the panel wants shown (a tier filter, a search hit list),
 * so the same rules apply to the essentials view, the full view and search.
 * Empty groups are dropped — a group only exists where params opted into it.
 */
export function groupParams(preset: PresetDef, specs: ParamSpec[]): ParamGroupView[] {
  const defs = presetGroups(preset);
  const abi = new Map(allParams(preset).map((p, i) => [p.key, i]));
  const buckets = new Map<string, ParamSpec[]>();
  for (const spec of specs) {
    const id = spec.group && defs.has(spec.group) ? spec.group : FALLBACK_GROUP.id;
    const bucket = buckets.get(id);
    if (bucket) bucket.push(spec);
    else buckets.set(id, [spec]);
  }
  const out: ParamGroupView[] = [];
  for (const [id, params] of buckets) {
    params.sort(
      (a, b) =>
        (a.order ?? 0) - (b.order ?? 0) ||
        (abi.get(a.key) ?? 0) - (abi.get(b.key) ?? 0) ||
        a.key.localeCompare(b.key),
    );
    out.push({ group: defs.get(id) ?? FALLBACK_GROUP, params });
  }
  out.sort((a, b) => a.group.rank - b.group.rank || a.group.id.localeCompare(b.group.id));
  return out;
}

/**
 * The searchable text of one param: everything a user might type looking for
 * it — its label, its hint, its key (power users know these from the WGSL
 * ABI) and, for an enum, the names of its choices.
 */
export function paramSearchText(spec: ParamSpec): string {
  const options = spec.control === "enum" ? spec.options.map((o) => o.label).join(" ") : "";
  return `${spec.label} ${spec.hint ?? ""} ${spec.key} ${options}`.toLowerCase();
}

/**
 * Which global Motion/Sync masters actually change a given mode. The masters
 * (Rotation→u.spin, Pulse→u.pulse, Detail→u.detail, Spectrum-smooth→binAt/
 * peakAt spline) are shared uniforms, but most modes read only some of them —
 * showing an inert "Rotation" slider on a mode that can't rotate reads as
 * broken. Derived from the fragment shader by default; the compute/mesh presets
 * read the masters CPU-side in the renderer, so they're declared explicitly.
 */
export interface MotionCaps {
  rotation: boolean;
  pulse: boolean;
  detail: boolean;
  spectrumSmooth: boolean;
}

/** particle-flow / spectrum-scape drive the masters from webgpuRenderer.ts
 * (not the fragment `wgsl`), so their caps can't be scanned — keep in sync with
 * the renderer's motion multiplies. */
const CPU_MOTION_CAPS: Record<string, Partial<MotionCaps>> = {
  "particle-flow": { rotation: true, pulse: true, detail: true },
  "spectrum-scape": { rotation: true, pulse: true },
};

export function presetMasters(preset: PresetDef): MotionCaps {
  // Match on comment-STRIPPED source: a `u.spin` mentioned only in a `//` or
  // `/* */` comment must not switch on a UI master the shader never reads
  // (same stringly-typed hazard usesFeedback was hardened against). WGSL has no
  // string literals, so stripping both comment forms is sufficient.
  const w = preset.wgsl.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const cpu = CPU_MOTION_CAPS[preset.id] ?? {};
  return {
    rotation: cpu.rotation ?? w.includes("u.spin"),
    pulse: cpu.pulse ?? w.includes("u.pulse"),
    detail: cpu.detail ?? w.includes("u.detail"),
    // The spectrum spline is applied inside binAt/peakAt, so any mode sampling
    // the spectrum honors it; modes that don't (orbs, fields) do not.
    spectrumSmooth: cpu.spectrumSmooth ?? (w.includes("binAt") || w.includes("peakAt")),
  };
}

/**
 * Background modes, composited centrally after the preset runs:
 *  - preset: the preset's own animated background (as authored)
 *  - solid: user color replaces everything behind the visualization
 *    (luma-keyed "over" composite — includes chroma green/magenta workflows)
 *  - transparent: luma-derived alpha; live preview shows checkerboard.
 *    H.264/MP4 cannot store alpha, so exports composite over black.
 *  - image: a user image (or the track's album art) behind the visualization,
 *    framed by BgFit (cover by default), with blur/dim baked once on the CPU
 *    (deterministic).
 */
export type BgMode = 0 | 1 | 2 | 3 | 4;
export const BG_PRESET: BgMode = 0;
export const BG_SOLID: BgMode = 1;
export const BG_TRANSPARENT: BgMode = 2;
export const BG_IMAGE: BgMode = 3;
export const BG_VIDEO: BgMode = 4;

/**
 * How a background image/video is framed — CSS object-fit, applied in the
 * shader by fitUV() (the same helper the centre-image slot uses).
 *
 * Every field is OPTIONAL and its absence means the neutral value, which is
 * exactly the cover-fit the composite pass hardcoded before these existed: a
 * project saved without them renders identically, so the schema version does
 * not move (same treatment as SyncSettings' shapeMerge/contrast).
 */
export interface BgFit {
  /** 0 = cover (fill the frame, crop the overflow), 1 = contain (whole image,
   * letterboxed in the background COLOUR), 2 = stretch (ignore aspect). */
  fit?: number;
  /** Magnification about the frame centre, 0.25..4 (1 = as fitted). */
  zoom?: number;
  /** Pan in frame widths, -1..1 (0 = centred). */
  offsetX?: number;
  /** Pan in frame heights, -1..1 (0 = centred). */
  offsetY?: number;
}

/** Image-background settings: which document asset, the baked look, and the fit. */
export interface BgImage extends BgFit {
  /** Key into the document's assets map (same store as overlay images). */
  assetId: string;
  /** Black overlay strength 0..0.9 — keeps the visualization readable. */
  dim: number;
  /** Gaussian blur radius in source pixels, 0..60. */
  blur: number;
}

/** Video-background settings: which document asset + the baked look. Frames
 * are decoded from the asset at load; the shader fits them like an image. */
export interface BgVideo extends BgFit {
  assetId: string;
  dim: number;
  blur: number;
}

export interface BgSettings {
  mode: BgMode;
  /** 0..1 rgb, used by solid mode */
  color: [number, number, number];
  /** Present when mode is image (kept while switching modes, for undo). */
  image?: BgImage;
  /** Present when mode is video (kept while switching modes, for undo). */
  video?: BgVideo;
}

/** Post-processing settings — all-neutral defaults render identically to raw. */
export interface PostSettings {
  /** Bloom intensity 0..1 (0 = off). */
  bloom: number;
  /** Luma above this blooms (0.6..1.4). */
  bloomThreshold: number;
  /** Linear exposure multiply before tonemap (1 = neutral). */
  exposure: number;
  /** ACES filmic tonemap on/off. */
  tonemap: boolean;
  /** Corner darkening 0..1. */
  vignette: number;
  /** Film grain 0..~0.3 (deterministic — seeded from track time). */
  grain: number;
  /** Chromatic aberration 0..1 (RGB split toward the edges). */
  chromatic: number;
}
/**
 * The post-processing knobs the modulation matrix can drive, as ordinary
 * ParamSpecs so routing/clamping reuses exactly the preset-param machinery.
 * `tonemap` is absent on purpose: it is a boolean, and a continuously
 * modulated on/off would strobe.
 *
 * Ranges mirror the panel's own sliders — the two must agree, or a modulated
 * value could sit outside what the user can dial by hand.
 */
export const POST_MOD_TARGETS: ParamSpec[] = [
  { key: "exposure", label: "Exposure", min: 0.2, max: 3, step: 0.01, default: 1 },
  { key: "bloom", label: "Bloom", min: 0, max: 1, step: 0.01, default: 0 },
  { key: "bloomThreshold", label: "Bloom threshold", min: 0.4, max: 1.6, step: 0.01, default: 1 },
  { key: "vignette", label: "Vignette", min: 0, max: 1, step: 0.01, default: 0 },
  { key: "chromatic", label: "Chromatic", min: 0, max: 1, step: 0.01, default: 0 },
  { key: "grain", label: "Film grain", min: 0, max: 0.5, step: 0.01, default: 0 },
];

export const DEFAULT_POST: PostSettings = {
  bloom: 0,
  bloomThreshold: 1,
  exposure: 1,
  tonemap: false,
  vignette: 0,
  grain: 0,
  chromatic: 0,
};

/**
 * Global motion/detail masters — apply across every mode that uses them, so a
 * user can dial rotation, pulsing and element count from one place. Defaults
 * are all-neutral (1) so presets render exactly as authored.
 */
export interface MotionSettings {
  /** Rotation strength: multiplies every preset's spin. 0 = perfectly still, 1 = as authored, up to 2. */
  rotation: number;
  /** Pulse strength: multiplies every beat/bass-driven scale + zoom. 0 = no pumping, 1 = as authored. */
  pulse: number;
  /** Element count (bars/points/segments): 0..1, mapped to each preset's own range; 1 = as authored. */
  detail: number;
  /** Spatial spectrum smoothing 0..1: blends the raw bins toward a spline (0 = hard bins, 1 = full curve). */
  spectrumSmooth: number;
}
export const DEFAULT_MOTION: MotionSettings = {
  rotation: 1,
  pulse: 1,
  detail: 1,
  spectrumSmooth: 0,
};

/** Crossfade input: the outgoing setup's params and the 0..1 blend. */
export interface TransitionState {
  params: ParamValues;
  mix: number;
  /** Transition style index (see TRANSITION_KINDS); 0 = crossfade. */
  kind?: number;
}

export interface Renderer {
  readonly kind: "webgpu" | "canvas2d";
  render(
    features: AudioFeatures,
    time: number,
    params: ParamValues,
    transition?: TransitionState,
  ): void;
  /** Outgoing preset for crossfades (compiled+cached); null clears. */
  setTransitionPreset(preset: PresetDef | null): void;
  resize(width: number, height: number, dpr: number): void;
  setPreset(preset: PresetDef): void;
  setBackground(bg: BgSettings): void;
  /**
   * Overlay layer (text/logo/album art), premultiplied alpha, composited
   * source-over on top of preset + background. null clears it. The bitmap is
   * rasterized by the host at output resolution; renderers only display it.
   */
  setOverlay(source: ImageBitmap | null): void;
  /**
   * The track's embedded cover art, for presets that sample it (coverSample()).
   * null clears it, making hasCover() false.
   */
  setCoverArt(source: ImageBitmap | null): void;
  /** Upload the Builder Studio per-layer parameter block (builder2.ts). */
  setBuilderParams(data: Float32Array): void;
  /**
   * Baked background image (blur/dim already applied), fitted behind the
   * visualization per bg.image's BgFit when bg.mode is image. Takes ownership;
   * null clears it.
   */
  setBackgroundImage(source: ImageBitmap | null): void;
  /** Upload one video-background frame (bg.mode 4). Reuses the texture; does
   * not close the source (frames are owned by the caller's decoded loop). */
  updateBackgroundVideoFrame(source: ImageBitmap): void;
  /** Global smooth-spectrum toggle: spline-connected bins, no hard corners. */
  setSmoothSpectrum(v: boolean): void;
  /** Global motion masters (rotation / pulse / detail), applied across modes. */
  setMotion(motion: MotionSettings): void;
  /** Post-processing chain (bloom, tonemap, vignette, grain, chromatic). */
  setPost(post: PostSettings): void;
  dispose(): void;
}

export function defaultParams(preset: PresetDef): ParamValues {
  const out: ParamValues = {};
  for (const p of allParams(preset)) out[p.key] = p.default;
  return out;
}

/**
 * Resolve one param's live value, falling back to the preset's OWN
 * ParamSpec.default — never a hardcoded literal — when it's absent from
 * `params`. For render paths that read named params directly off the CPU
 * side (mesh3d, e.g.) instead of through the generated P_<key>() accessors
 * over the GPU params buffer, so a renderer-side fallback can't silently
 * drift from the spec that actually defines it (see M19).
 */
export function paramOr(preset: PresetDef, params: ParamValues, key: string): number {
  return params[key] ?? paramSpecMap(preset).get(key)?.default ?? 0;
}
