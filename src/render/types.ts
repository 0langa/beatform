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

export interface Renderer {
  readonly kind: "webgpu" | "canvas2d";
  render(features: AudioFeatures, time: number, params: ParamValues): void;
  resize(width: number, height: number, dpr: number): void;
  setPreset(preset: PresetDef): void;
  dispose(): void;
}

export function defaultParams(preset: PresetDef): ParamValues {
  const out: ParamValues = {};
  for (const p of preset.params) out[p.key] = p.default;
  return out;
}
