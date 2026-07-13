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
   */
  wgsl: string;
}

export type ParamValues = Record<string, number>;

/** Main + advanced specs in ABI order (buffer packing = accessor indices). */
export function allParams(preset: PresetDef): ParamSpec[] {
  return preset.advanced ? [...preset.params, ...preset.advanced] : preset.params;
}

/**
 * Background modes, composited centrally after the preset runs:
 *  - preset: the preset's own animated background (as authored)
 *  - solid: user color replaces everything behind the visualization
 *    (luma-keyed "over" composite — includes chroma green/magenta workflows)
 *  - transparent: luma-derived alpha; live preview shows checkerboard.
 *    H.264/MP4 cannot store alpha, so exports composite over black.
 */
export type BgMode = 0 | 1 | 2;
export const BG_PRESET: BgMode = 0;
export const BG_SOLID: BgMode = 1;
export const BG_TRANSPARENT: BgMode = 2;

export interface BgSettings {
  mode: BgMode;
  /** 0..1 rgb, used by solid mode */
  color: [number, number, number];
}

export interface Renderer {
  readonly kind: "webgpu" | "canvas2d";
  render(features: AudioFeatures, time: number, params: ParamValues): void;
  resize(width: number, height: number, dpr: number): void;
  setPreset(preset: PresetDef): void;
  setBackground(bg: BgSettings): void;
  /**
   * Overlay layer (text/logo/album art), premultiplied alpha, composited
   * source-over on top of preset + background. null clears it. The bitmap is
   * rasterized by the host at output resolution; renderers only display it.
   */
  setOverlay(source: ImageBitmap | null): void;
  dispose(): void;
}

export function defaultParams(preset: PresetDef): ParamValues {
  const out: ParamValues = {};
  for (const p of allParams(preset)) out[p.key] = p.default;
  return out;
}
