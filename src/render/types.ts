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
}

export interface PresetDef {
  id: string;
  name: string;
  params: ParamSpec[];
  /**
   * WGSL fragment body. Receives:
   *   uv (0..1), features uniforms, bins/peaks storage arrays, params array
   * Must define: fn preset(uv: vec2f) -> vec4f
   */
  wgsl: string;
}

export type ParamValues = Record<string, number>;

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
  dispose(): void;
}

export function defaultParams(preset: PresetDef): ParamValues {
  const out: ParamValues = {};
  for (const p of preset.params) out[p.key] = p.default;
  return out;
}
