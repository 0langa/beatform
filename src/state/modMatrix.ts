import type { AudioFeatures } from "../audio/types";
import type { PostSettings, PresetDef } from "../render/types";
import { POST_MOD_TARGETS, paramSpecMap, type ParamValues } from "../render/types";

/**
 * Modulation matrix: route any audio feature to any numeric parameter of the
 * active visual. Routes are part of the document (saved per preset in
 * projects); evaluation is a pure function applied identically per frame in
 * the live loop and in the export loop — WYSIWYG holds.
 *
 * amount is -1..1 and scales against the target's spec range: +1 adds the
 * full range at feature=1, -0.5 subtracts half of it, etc. Results clamp to
 * the spec range.
 */
export interface ModRoute {
  id: string;
  source: ModSource;
  /** Target param key of the active preset. */
  param: string;
  /** -1..1 — fraction of the param's range added at feature value 1. */
  amount: number;
}

export type ModSource =
  | "drive"
  | "driveBeat"
  | "rms"
  | "energy"
  | "bass"
  | "mid"
  | "treble"
  | "voice"
  | "kick"
  | "snare"
  | "hat"
  | "width"
  | "beatPhase"
  | "barPhase"
  // Stem sources: envelope timelines of imported sidecar tracks, sampled at
  // track time ("stem1:kick"). Valid ids are produced by src/audio/stems.ts.
  | `stem${1 | 2 | 3 | 4}:${"energy" | "bass" | "mid" | "treble" | "kick" | "snare" | "hat"}`;

/** Stem-source ids ("stem1:kick"). Kept in lockstep with stems.ts keys. */
const STEM_SOURCE_RE = /^stem[1-4]:(energy|bass|mid|treble|kick|snare|hat)$/;

export const MOD_SOURCES: Array<{ id: ModSource; label: string }> = [
  { id: "drive", label: "Drive" },
  { id: "driveBeat", label: "Drive pulse" },
  { id: "kick", label: "Kick" },
  { id: "snare", label: "Snare" },
  { id: "hat", label: "Hats" },
  { id: "bass", label: "Bass" },
  { id: "mid", label: "Mids" },
  { id: "treble", label: "Treble" },
  { id: "voice", label: "Voice" },
  { id: "rms", label: "Loudness" },
  { id: "energy", label: "Energy" },
  { id: "width", label: "Stereo width" },
  { id: "beatPhase", label: "Beat phase" },
  { id: "barPhase", label: "Bar phase" },
];

const SOURCE_IDS = new Set<string>(MOD_SOURCES.map((s) => s.id));

function isValidSource(v: string): boolean {
  return SOURCE_IDS.has(v) || STEM_SOURCE_RE.test(v);
}

export function newRouteId(): string {
  return `mr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sourceValue(
  features: AudioFeatures,
  source: ModSource,
  stems?: Record<string, number>,
): number {
  if (source.startsWith("stem")) return stems?.[source] ?? 0;
  return features[source as keyof AudioFeatures & ModSource] as number;
}

/**
 * Apply routes over base params. Pure; returns base UNCHANGED (same object)
 * when no route actually drives a param of this preset, so the per-frame hot
 * path stays allocation-free in the common case.
 */
export function applyMods(
  preset: PresetDef,
  base: ParamValues,
  routes: ModRoute[],
  features: AudioFeatures,
  /** Per-frame stem envelope values ("stem1:kick" -> 0..1); a route to a
   * stem that isn't loaded reads 0 — silently inert, never an error. */
  stems?: Record<string, number>,
): ParamValues {
  if (routes.length === 0) return base;
  const specs = paramSpecMap(preset);
  // Lazy, like applyPostMods: a non-empty route list is NOT the same as a route
  // that changes anything. A project whose routes all target `post:*` (or a
  // preset the user has since switched away from) reaches this with routes to
  // spend and nothing to spend them on — and the eager `{ ...base }` cloned the
  // param object every frame, in BOTH render loops, for zero effect. Returning
  // `base` by identity also lets callers skip a redundant uniform upload.
  let out: ParamValues | null = null;
  for (const route of routes) {
    const spec = specs.get(route.param);
    if (!spec) continue; // route to a param this preset doesn't have — skip
    if (!out) out = { ...base };
    const value = sourceValue(features, route.source, stems);
    const range = spec.max - spec.min;
    const next = (out[route.param] ?? spec.default) + value * route.amount * range;
    out[route.param] = Math.min(spec.max, Math.max(spec.min, next));
  }
  return out ?? base;
}

/**
 * Post-processing targets are namespaced ("post:chromatic") inside the SAME
 * `param` field rather than given their own route type: every existing route
 * keeps validating unchanged, and a project written by an older build still
 * loads. A preset param can never collide because preset keys are bare
 * identifiers.
 */
export const POST_TARGET_PREFIX = "post:";

const POST_SPECS = new Map(POST_MOD_TARGETS.map((s) => [s.key, s]));

/** The PostSettings key a route drives, or null when it targets a preset param. */
export function postTargetKey(param: string): string | null {
  if (!param.startsWith(POST_TARGET_PREFIX)) return null;
  const key = param.slice(POST_TARGET_PREFIX.length);
  return POST_SPECS.has(key) ? key : null;
}

/**
 * Apply post-targeted routes over the document's post settings. Pure, and
 * returns `base` UNCHANGED (same object) when no route targets post — the
 * caller uses that identity to skip a redundant GPU upload on the per-frame
 * path, so projects without post modulation cost exactly nothing.
 */
export function applyPostMods(
  base: PostSettings,
  routes: ModRoute[],
  features: AudioFeatures,
  stems?: Record<string, number>,
): PostSettings {
  let out: PostSettings | null = null;
  for (const route of routes) {
    const key = postTargetKey(route.param);
    if (!key) continue;
    const spec = POST_SPECS.get(key)!;
    if (!out) out = { ...base };
    const current = (out as unknown as Record<string, number>)[key] ?? spec.default;
    const value = sourceValue(features, route.source, stems);
    const next = current + value * route.amount * (spec.max - spec.min);
    (out as unknown as Record<string, number>)[key] = Math.min(spec.max, Math.max(spec.min, next));
  }
  return out ?? base;
}

/** Validate an unknown blob into clean routes (project files, localStorage). */
export function validModRoutes(v: unknown): ModRoute[] {
  if (!Array.isArray(v)) return [];
  const out: ModRoute[] = [];
  for (const raw of v) {
    const r = raw as Partial<ModRoute>;
    if (
      typeof r === "object" &&
      r !== null &&
      typeof r.id === "string" &&
      typeof r.source === "string" &&
      isValidSource(r.source) &&
      typeof r.param === "string" &&
      r.param.length > 0 &&
      typeof r.amount === "number" &&
      Number.isFinite(r.amount)
    ) {
      out.push({
        id: r.id,
        source: r.source as ModSource,
        param: r.param.slice(0, 64),
        amount: Math.min(1, Math.max(-1, r.amount)),
      });
    }
  }
  return out;
}

export function validModsByPreset(v: unknown): Record<string, ModRoute[]> {
  if (typeof v !== "object" || v === null) return {};
  // Object.create(null): a document carrying a __proto__ key must not set
  // the result's prototype (same hardening as every other validator — this
  // was the one L14 missed).
  const out: Record<string, ModRoute[]> = Object.create(null);
  for (const [presetId, routes] of Object.entries(v)) {
    const clean = validModRoutes(routes);
    if (clean.length > 0) out[presetId] = clean;
  }
  return out;
}
