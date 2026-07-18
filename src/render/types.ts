import type { AudioFeatures } from "../audio/types";

/**
 * Preset = one visual. Declares its tweakable parameters as a schema so the
 * UI can auto-generate controls and presets stay serializable (JSON in/out) —
 * this is the extension point for future visual customization.
 */
export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** One-line, user-facing: what turning this knob visibly does. */
  hint?: string;
}

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
  const w = preset.wgsl;
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
 *    cover-fit, with blur/dim baked once on the CPU (deterministic).
 */
export type BgMode = 0 | 1 | 2 | 3 | 4;
export const BG_PRESET: BgMode = 0;
export const BG_SOLID: BgMode = 1;
export const BG_TRANSPARENT: BgMode = 2;
export const BG_IMAGE: BgMode = 3;
export const BG_VIDEO: BgMode = 4;

/** Image-background settings: which document asset, and the baked look. */
export interface BgImage {
  /** Key into the document's assets map (same store as overlay images). */
  assetId: string;
  /** Black overlay strength 0..0.9 — keeps the visualization readable. */
  dim: number;
  /** Gaussian blur radius in source pixels, 0..60. */
  blur: number;
}

/** Video-background settings: which document asset + the baked look. Frames
 * are decoded from the asset at load; the shader cover-fits like an image. */
export interface BgVideo {
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
  /**
   * Baked background image (blur/dim already applied), cover-fit behind the
   * visualization when bg.mode is image. Takes ownership; null clears it.
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
