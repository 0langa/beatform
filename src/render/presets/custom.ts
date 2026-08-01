import type { ParamSpec, PresetDef, ShadertoySpec } from "../types";

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

/**
 * Whitelist-validate an untrusted shadertoy marker. Null = reject (which
 * rejects the whole def — a shadertoy def without its GLSL source cannot be
 * re-edited or attributed, so it must not survive validation).
 */
function validShadertoySpec(v: unknown): ShadertoySpec | null {
  const s = v as Partial<ShadertoySpec>;
  if (typeof s !== "object" || s === null) return null;
  if (typeof s.glsl !== "string" || s.glsl.length === 0 || s.glsl.length > MAX_WGSL_BYTES)
    return null;
  const opt = (x: unknown, max: number) =>
    typeof x === "string" && x.trim() ? x.slice(0, max) : undefined;
  return {
    glsl: s.glsl,
    ...(opt(s.author, 80) ? { author: opt(s.author, 80) } : {}),
    ...(opt(s.source, 200) ? { source: opt(s.source, 200) } : {}),
    ...(opt(s.license, 80) ? { license: opt(s.license, 80) } : {}),
  };
}

/** Whitelist-validate an untrusted custom-preset blob. Null = reject. */
export function validCustomPreset(v: unknown): PresetDef | null {
  const d = v as Partial<PresetDef>;
  if (typeof d !== "object" || d === null) return null;
  if (typeof d.id !== "string" || !CUSTOM_ID_RE.test(d.id)) return null;
  if (typeof d.name !== "string" || d.name.trim().length === 0) return null;
  if (typeof d.wgsl !== "string" || d.wgsl.length > MAX_WGSL_BYTES) return null;
  // Two shapes share the registry: snippet presets define `fn preset(...)`;
  // imported Shadertoy defs carry a complete transpiled module whose entry is
  // `@fragment fn main` plus the compat uniform block, and MUST carry their
  // original GLSL (validated below).
  const shadertoy = d.shadertoy !== undefined ? validShadertoySpec(d.shadertoy) : null;
  if (d.shadertoy !== undefined && !shadertoy) return null;
  if (shadertoy) {
    if (!/@fragment\s/.test(d.wgsl) || !/fn\s+main\s*\(/.test(d.wgsl)) return null;
    if (!d.wgsl.includes("BeatformShadertoyUniforms")) return null;
  } else if (!/fn\s+preset\s*\(/.test(d.wgsl)) return null;
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
    ...(shadertoy ? { shadertoy } : {}),
  };
}

// --- .avshader file format (share a custom visual as one JSON file) ---

/**
 * v1: snippet presets. v2: adds imported Shadertoy defs (`shadertoy` marker +
 * full-module `wgsl`). Files stay at the OLDEST version that can represent
 * them — a plain snippet still writes v1, so older apps keep reading it; only
 * shadertoy defs write v2, which older apps refuse with their existing
 * "newer app version" message instead of misreading the module as a snippet.
 */
export const SHADER_FILE_VERSION = 2;

export function serializeCustomPreset(def: PresetDef, appVersion: string): string {
  const schemaVersion = def.shadertoy ? 2 : 1;
  return JSON.stringify({ kind: "avshader", schemaVersion, appVersion, preset: def }, null, 2);
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

/** Two defs are "the same shader" when everything render- or UI-affecting
 * matches. Used by the project-open merge below. */
export function sameCustomDef(a: PresetDef, b: PresetDef): boolean {
  return (
    a.wgsl === b.wgsl &&
    a.name === b.name &&
    JSON.stringify(a.params) === JSON.stringify(b.params) &&
    JSON.stringify(a.advanced ?? []) === JSON.stringify(b.advanced ?? []) &&
    JSON.stringify(a.shadertoy ?? null) === JSON.stringify(b.shadertoy ?? null)
  );
}

/**
 * Merge a document's embedded custom defs into the local library WITHOUT
 * data loss (audit S1): a same-id local def whose content DIFFERS from the
 * embedded copy is kept — the realistic collision is your own shader edited
 * after the project was saved, where the embedded copy is the OLDER one and
 * silently persisting it destroyed the newer edit with no undo (openProject
 * clears history first). Identical copies and brand-new ids import as
 * before. Returns the merged library, the defs that should be (re)registered
 * and the names of local defs that were protected.
 */
export function mergeEmbeddedDefs(
  local: PresetDef[],
  embedded: PresetDef[],
): { merged: PresetDef[]; register: PresetDef[]; kept: string[] } {
  const byId = new Map(local.map((d) => [d.id, d]));
  const register: PresetDef[] = [];
  const kept: string[] = [];
  for (const def of embedded) {
    const mine = byId.get(def.id);
    if (mine && !sameCustomDef(mine, def)) kept.push(mine.name);
    else register.push(def);
  }
  const ids = new Set(register.map((d) => d.id));
  return { merged: [...local.filter((d) => !ids.has(d.id)), ...register], register, kept };
}
