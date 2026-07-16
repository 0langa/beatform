import type { ParamSpec, PresetDef } from "../types";

/**
 * Custom presets — the WGSL SDK's runtime registry. A custom preset is the
 * same PresetDef shape the built-ins use (param schema + a WGSL fragment
 * defining `fn preset(uv: vec2f) -> vec4f`), created in the in-app editor,
 * persisted in localStorage, and registered here so presetById() resolves it
 * everywhere: the strip, projects, the timeline, and exports (jobs carry the
 * defs across the worker boundary and re-register there).
 *
 * Safety model: WGSL is inherently sandboxed by WebGPU — no I/O, no imports,
 * pure math over the bound ABI. The compile check (getCompilationInfo)
 * happens before a def is ever registered; a shader that hangs the GPU hits
 * the existing device-loss recovery. Untrusted defs (localStorage, imported
 * files) pass through validCustomPreset, which whitelists shapes rather than
 * sanitizing strings.
 */

export const CUSTOM_ID_RE = /^custom-[a-z0-9][a-z0-9-]{0,39}$/;
const PARAM_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,30}$/;
/** Hard cap from the renderer's params storage buffer (MAX_PARAMS lanes). */
const MAX_TOTAL_PARAMS = 48;
const MAX_WGSL_BYTES = 50_000;

const registry = new Map<string, PresetDef>();

export function registerCustomPreset(def: PresetDef): void {
  registry.set(def.id, def);
}

export function unregisterCustomPreset(id: string): void {
  registry.delete(id);
}

export function customPresetById(id: string): PresetDef | undefined {
  return registry.get(id);
}

export function customPresets(): PresetDef[] {
  return [...registry.values()];
}

export function newCustomPresetId(): string {
  return `custom-${Date.now().toString(36)}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, "0")}`;
}

function validParamSpec(v: unknown): ParamSpec | null {
  const p = v as Partial<ParamSpec>;
  if (typeof p !== "object" || p === null) return null;
  if (typeof p.key !== "string" || !PARAM_KEY_RE.test(p.key)) return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const min = n(p.min);
  const max = n(p.max);
  const step = n(p.step);
  const def = n(p.default);
  if (min === null || max === null || step === null || def === null) return null;
  if (!(max > min) || !(step > 0)) return null;
  return {
    key: p.key,
    label: typeof p.label === "string" && p.label.trim() ? p.label.slice(0, 40) : p.key,
    min,
    max,
    step,
    default: Math.min(max, Math.max(min, def)),
    ...(typeof p.hint === "string" && p.hint.trim() ? { hint: p.hint.slice(0, 200) } : {}),
  };
}

/** Whitelist-validate an untrusted custom-preset blob. Null = reject. */
export function validCustomPreset(v: unknown): PresetDef | null {
  const d = v as Partial<PresetDef>;
  if (typeof d !== "object" || d === null) return null;
  if (typeof d.id !== "string" || !CUSTOM_ID_RE.test(d.id)) return null;
  if (typeof d.name !== "string" || d.name.trim().length === 0) return null;
  if (typeof d.wgsl !== "string" || d.wgsl.length > MAX_WGSL_BYTES) return null;
  if (!/fn\s+preset\s*\(/.test(d.wgsl)) return null;
  const params = Array.isArray(d.params)
    ? (d.params.map(validParamSpec).filter(Boolean) as ParamSpec[])
    : [];
  const advanced = Array.isArray(d.advanced)
    ? (d.advanced.map(validParamSpec).filter(Boolean) as ParamSpec[])
    : [];
  if (params.length + advanced.length > MAX_TOTAL_PARAMS) return null;
  // No duplicate keys — accessor generation would collide.
  const keys = [...params, ...advanced].map((p) => p.key);
  if (new Set(keys).size !== keys.length) return null;
  return {
    id: d.id,
    name: d.name.trim().slice(0, 40),
    ...(typeof d.description === "string" && d.description.trim()
      ? { description: d.description.slice(0, 200) }
      : {}),
    params,
    ...(advanced.length ? { advanced } : {}),
    wgsl: d.wgsl,
  };
}

// --- .avshader file format (share a custom visual as one JSON file) ---

export const SHADER_FILE_VERSION = 1;

export function serializeCustomPreset(def: PresetDef, appVersion: string): string {
  return JSON.stringify(
    { kind: "avshader", schemaVersion: SHADER_FILE_VERSION, appVersion, preset: def },
    null,
    2,
  );
}

export class ShaderParseError extends Error {}

export function parseCustomPreset(json: string): PresetDef {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ShaderParseError("Not a valid JSON file");
  }
  const f = raw as {
    kind?: string;
    schemaVersion?: number;
    preset?: unknown;
  };
  if (typeof f !== "object" || f === null || f.kind !== "avshader") {
    throw new ShaderParseError("Not an .avshader file");
  }
  if (typeof f.schemaVersion !== "number" || f.schemaVersion > SHADER_FILE_VERSION) {
    throw new ShaderParseError("Shader file from a newer app version; update the app");
  }
  const def = validCustomPreset(f.preset);
  if (!def) throw new ShaderParseError("Shader file failed validation");
  return def;
}

/** The starting point the editor opens with. */
export const NEW_SHADER_TEMPLATE = `fn preset(uv: vec2f) -> vec4f {
  // Your visual. uv is 0..1; see the docs for the full ABI:
  // binAt(x)/peakAt(x) spectrum, waveAt(x) waveform, u.drive / u.driveBeat
  // sync signals, gridPulse(k) tempo pulses, hsl2rgb / fbm / centered ...
  let p = centered(uv);
  let r = length(p);
  let v = binAt(clamp(r * 1.6, 0.0, 1.0));
  let pulse = max(u.driveBeat, gridPulse(7.0));
  var col = hsl2rgb(P_hue() + r * 120.0, 0.85, v * 0.55);
  col += hsl2rgb(P_hue(), 0.9, 0.5) * exp(-r * 6.0) * (0.2 + pulse * 0.5);
  col *= 1.0 - r * r * 0.6;
  return vec4f(col, 1.0);
}`;
