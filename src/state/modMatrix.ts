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
 *
 * v2 (P-16): a route may additionally carry a response curve and an
 * attack/release lag. All three fields are OPTIONAL AND ADDITIVE — a route
 * without them resolves bit-identically to the v1 rule above, old documents
 * load unchanged, and an old app's validator strips the unknown fields (the
 * route degrades to linear/instant instead of breaking).
 */
export interface ModRoute {
  id: string;
  source: ModSource;
  /** Target param key of the active preset. */
  param: string;
  /** -1..1 — fraction of the param's range added at feature value 1. */
  amount: number;
  /**
   * Response curve applied to the RAW 0..1 source value BEFORE amount
   * (absent = "linear" = untouched, the v1 behavior). Exact math is forever —
   * see shapedValue(): exp = v², smooth = smoothstep(v) = v²(3−2v), both over
   * the input clamped to 0..1.
   */
  curve?: ModCurve;
  /**
   * Rise / fall lag in SECONDS (absent or 0 = instant = v1 behavior).
   * Attack applies while the curved source is above the smoothed value,
   * release while below — exponential smoothing with the frame-rate-
   * independent form `alpha = 1 − exp(−dt/τ)`, dt = track-time delta.
   * Needs a caller-owned ModEvalState to take effect; without one the route
   * evaluates instantly (pure fallback). Validator clamps to 0..10 s.
   */
  attack?: number;
  release?: number;
  /**
   * When true, applyMods/applyPostMods skip this route entirely — as if it
   * were not in the array at all. Absent or false = active, the v1
   * behavior. OPTIONAL AND ADDITIVE like curve/attack/release: absent on
   * every v1 route, and validModRoutes OMITS it unless typeof is exactly
   * boolean. See applyMods' mute skip (H12) for what this does to a
   * route's lag memo and its published meter value.
   */
  muted?: boolean;
}

/** Per-route source shaping. "linear" behaves exactly like an absent curve. */
export type ModCurve = "linear" | "exp" | "smooth";

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
  // P-15 fuel. Both are 0..1 like every other source: `vocal` is the
  // lyric-derived sung-presence envelope (distinct from `voice`, the DSP
  // band energy), `sectionPulse` fires on each detected section boundary.
  | "vocal"
  | "sectionPulse"
  // Stem sources: envelope timelines of imported sidecar tracks, sampled at
  // track time ("stem1:kick"). Valid ids are produced by src/audio/stems.ts.
  | `stem${1 | 2 | 3 | 4}:${"energy" | "bass" | "mid" | "treble" | "kick" | "snare" | "hat"}`
  // Tempo-locked LFO sources ("lfo:sine:1"): pure functions of ABSOLUTE track
  // time and the tempo — zero state, seek-stable by construction. "Tempo",
  // not "beat": the only grid input is `bpm`, so the cycle length follows the
  // tempo but the phase is not aligned to the grid's first beat. See
  // lfoValue().
  | `lfo:${LfoWave}:${"0.25" | "0.5" | "1" | "2" | "4" | "8"}`;

export type LfoWave = "sine" | "saw" | "square";

/** Stem-source ids ("stem1:kick"). Kept in lockstep with stems.ts keys. */
const STEM_SOURCE_RE = /^stem[1-4]:(energy|bass|mid|treble|kick|snare|hat)$/;

/**
 * LFO id grammar — PERSISTED FOREVER: `lfo:<wave>:<rate>` with wave ∈
 * {sine, saw, square} and rate ∈ {0.25, 0.5, 1, 2, 4, 8} BEATS PER CYCLE,
 * spelled exactly as JS number-to-string (no trailing zeros, "0.25" not
 * ".25"). Growing either axis is additive; never respell existing ids.
 */
const LFO_SOURCE_RE = /^lfo:(sine|saw|square):(0\.25|0\.5|1|2|4|8)$/;

const LFO_WAVES: readonly LfoWave[] = ["sine", "saw", "square"];
const LFO_RATES: readonly number[] = [0.25, 0.5, 1, 2, 4, 8];

/** id -> parsed wave/rate, built once so the per-frame path never parses. */
const LFO_PARSED = new Map<string, { wave: LfoWave; rate: number }>();
for (const wave of LFO_WAVES) {
  for (const rate of LFO_RATES) {
    LFO_PARSED.set(`lfo:${wave}:${rate}`, { wave, rate });
  }
}

const LFO_WAVE_LABEL: Record<LfoWave, string> = { sine: "Sine", saw: "Saw", square: "Square" };
const LFO_RATE_LABEL = new Map<number, string>([
  [0.25, "¼ beat"],
  [0.5, "½ beat"],
  [1, "1 beat"],
  [2, "2 beats"],
  [4, "4 beats"],
  [8, "8 beats"],
]);

/** LFO dropdown entries, one optgroup's worth — sibling of MOD_SOURCES. */
export const LFO_SOURCES: Array<{ id: ModSource; label: string }> = [...LFO_PARSED.keys()].map(
  (id) => {
    const p = LFO_PARSED.get(id)!;
    return {
      id: id as ModSource,
      label: `${LFO_WAVE_LABEL[p.wave]} · ${LFO_RATE_LABEL.get(p.rate)}`,
    };
  },
);

/**
 * Tempo-locked LFO value, 0..1 — a PURE function of (absolute track time,
 * tempo):
 *   t       = time + (timeOrigin ?? 0)   — see below
 *   beatPos = t × bpm / 60            (bpm === 0 → beatPos = t × 2,
 *                                      i.e. a 120-BPM-equivalent fallback)
 *   phase   = fract(beatPos / rate)   (rate = beats per cycle)
 *   sine    = 0.5 − 0.5·cos(2π·phase)   — starts at 0, peaks mid-cycle
 *   saw     = phase                      — ramp 0 → 1
 *   square  = phase < 0.5 ? 1 : 0        — high half first
 * Deterministic and seek-stable by construction; no state anywhere.
 *
 * "Tempo-locked", not "beat-locked": `bpm` is the only grid input, so a
 * cycle lasts `rate` beats but its phase is anchored to track time zero, not
 * to the beat grid's first beat.
 *
 * E2-R1 — why the anchor is ABSOLUTE track time: `features.time` is CLIP
 * time in a segment export (the audio is sliced so the clip starts at 0),
 * while the preview plays the same music at its real track time. Anchoring
 * on `features.time` alone therefore moved the LFO's origin and nothing
 * else's: at 120 BPM with `lfo:sine:8` and a segment starting at 137 s the
 * preview sat at phase 0.25 and the export's first frame at phase 0 — half
 * the range, for the whole clip. Same divergence class as F4a.
 * `timeOrigin` is the clip's origin in track time; it is absent on the live
 * path and 0 for a full-track export, so `?? 0` leaves both bit-identical to
 * the pre-E2-R1 arithmetic.
 */
function lfoValue(wave: LfoWave, rate: number, features: AudioFeatures): number {
  const t = features.time + (features.timeOrigin ?? 0);
  const beatPos = features.bpm > 0 ? (t * features.bpm) / 60 : t * 2;
  const cycles = beatPos / rate;
  const phase = cycles - Math.floor(cycles);
  if (wave === "sine") return 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
  if (wave === "saw") return phase;
  return phase < 0.5 ? 1 : 0;
}

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
  { id: "vocal", label: "Vocals (lyrics)" },
  { id: "sectionPulse", label: "Section change" },
  { id: "rms", label: "Loudness" },
  { id: "energy", label: "Energy" },
  { id: "width", label: "Stereo width" },
  { id: "beatPhase", label: "Beat phase" },
  { id: "barPhase", label: "Bar phase" },
];

const SOURCE_IDS = new Set<string>(MOD_SOURCES.map((s) => s.id));

function isValidSource(v: string): boolean {
  return SOURCE_IDS.has(v) || STEM_SOURCE_RE.test(v) || LFO_SOURCE_RE.test(v);
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
  if (source.startsWith("lfo:")) {
    const p = LFO_PARSED.get(source);
    return p ? lfoValue(p.wave, p.rate, features) : 0;
  }
  // `?? 0`, not a bare cast: the P-15 fields are optional on AudioFeatures
  // (hand-built frames in tests and older callers may omit them), and an
  // undefined here would poison the route arithmetic into NaN for the rest
  // of the frame. A missing feature reads as "no signal", like an unloaded
  // stem does.
  return (features[source as keyof AudioFeatures & ModSource] as number | undefined) ?? 0;
}

/**
 * Caller-owned smoothing memory for routes with attack/release. applyMods /
 * applyPostMods stay pure functions OF this state: the live loop owns one for
 * the preview, the export worker creates a FRESH one per run and walks frames
 * sequentially — so every export of the same document is bit-identical, and
 * the preview matches within the rate-independence of the EMA form (routes
 * without lag stay EXACTLY bit-equal on both paths). Entries are allocated
 * once per route and mutated in place — no per-frame Map churn.
 */
export interface ModEvalState {
  routes: Map<string, { value: number; time: number }>;
}

export function createModEvalState(): ModEvalState {
  return { routes: new Map() };
}

/** Validator bound for attack/release, seconds. */
export const MOD_LAG_MAX_SEC = 10;

/**
 * Discontinuity threshold for the lag state: a track-time step that is
 * backwards (seek back, loop wrap, track change) or larger than this snaps
 * the smoothed value to the current target instead of gliding across the
 * jump. Forward steps up to 1 s keep smoothing — dropped frames must not
 * reset an envelope mid-swell.
 */
const LAG_SNAP_SEC = 1;

/** Curve stage — see ModRoute.curve for the exact (forever) math. Linear or
 * absent returns the raw value UNTOUCHED, preserving v1 bit-identity; the
 * shaped curves clamp to 0..1 first so a hypothetical out-of-range source
 * still lands in-range. */
export function shapedValue(curve: ModCurve | undefined, raw: number): number {
  if (curve === "exp") {
    const c = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    return c * c;
  }
  if (curve === "smooth") {
    const c = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    return c * c * (3 - 2 * c);
  }
  return raw;
}

/**
 * Full v2 source resolution for one route: raw source → curve → lag.
 * Lag rules (forever):
 *  - no state, or attack and release both absent/0 → instant (v1 path);
 *  - first evaluation of a route → snap to the curved target;
 *  - dt = features.time − last evaluation's time (TRACK time, never wall
 *    clock); dt === 0 → hold the smoothed value (paused preview frames);
 *  - dt < 0 or dt > 1 s → snap to the curved target (seek/loop/track change);
 *  - otherwise τ = attack when rising, release when falling; τ ≤ 0 → snap;
 *    value += (target − value) · (1 − exp(−dt/τ)).
 */
function routeValue(
  route: ModRoute,
  features: AudioFeatures,
  stems: Record<string, number> | undefined,
  state: ModEvalState | undefined,
): number {
  const target = shapedValue(route.curve, sourceValue(features, route.source, stems));
  const attack = route.attack ?? 0;
  const release = route.release ?? 0;
  if (!state || (attack <= 0 && release <= 0)) return target;
  const now = features.time;
  let memo = state.routes.get(route.id);
  if (!memo) {
    memo = { value: target, time: now };
    state.routes.set(route.id, memo);
    return target;
  }
  const dt = now - memo.time;
  memo.time = now;
  if (dt === 0) return memo.value;
  const tau = target > memo.value ? attack : release;
  if (dt < 0 || dt > LAG_SNAP_SEC || tau <= 0) {
    memo.value = target;
    return target;
  }
  memo.value += (target - memo.value) * (1 - Math.exp(-dt / tau));
  return memo.value;
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
  /** Lag memory for routes with attack/release (P-16). Optional — omitted,
   * such routes evaluate instantly; the function itself stays pure. */
  state?: ModEvalState,
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
    // H12: a muted route is inert, exactly as if it were absent from the
    // array — checked BEFORE the lazy clone (like the mod:"off" skip below)
    // so an all-muted route list keeps the identity fast path callers rely
    // on to skip a GPU upload. routeValue() is never called for it, so a lag
    // memo it already owns (attack/release, P-16) simply stops advancing —
    // it neither resets nor updates while muted. services.ts's per-route
    // publisher (getLiveRouteValues) is NOT special-cased for mute: it keeps
    // copying whatever modEval.routes holds for the id (that frozen memo, or
    // nothing yet if the route has always been muted, in which case it falls
    // back to the instant source-through-curve value like any unlagged
    // route). So a muted route's meter can show a stale or live-instant
    // number instead of "off" — accepted, because the mute toggle's own UI
    // (reduced opacity on the whole row, ModulationPage.tsx) is what tells
    // the user this route does nothing right now, not the meter. On unmute,
    // the large elapsed dt hits routeValue's own seek/loop snap branch, so
    // it resumes with a snap rather than gliding in from a stale value.
    if (route.muted === true) continue;
    const spec = specs.get(route.param);
    if (!spec) continue; // route to a param this preset doesn't have — skip
    // mod:"off" (RP-2): not a modulation target. The target lists no longer
    // offer such params, and a route that still names one (an old document)
    // is inert rather than a strobing toggle. Checked BEFORE the lazy clone
    // so a document whose routes are all inert keeps the identity fast path.
    if (spec.mod === "off") continue;
    if (!out) out = { ...base };
    const value = routeValue(route, features, stems, state);
    const range = spec.max - spec.min;
    let next = (out[route.param] ?? spec.default) + value * route.amount * range;
    // mod:"snap" (RP-2): counts and segment enums quantize to whole numbers,
    // so a modulated Club mirror steps 3 -> 4 instead of rendering 3.7
    // segments. Runs here, in the one apply chokepoint, so live and export
    // resolve identical values by construction.
    if (spec.mod === "snap") next = Math.round(next);
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
  /** Same lag memory as applyMods — a route targets EITHER a preset param or
   * a post key, never both, so one shared state advances each route exactly
   * once per frame across the two calls. */
  state?: ModEvalState,
): PostSettings {
  let out: PostSettings | null = null;
  for (const route of routes) {
    // H12: see applyMods' mute skip for the full rationale (lag memo
    // freeze, the publisher deliberately not special-cased). Checked first
    // so an all-muted post route list also keeps the identity fast path.
    if (route.muted === true) continue;
    const key = postTargetKey(route.param);
    if (!key) continue;
    const spec = POST_SPECS.get(key)!;
    if (!out) out = { ...base };
    const current = (out as unknown as Record<string, number>)[key] ?? spec.default;
    const value = routeValue(route, features, stems, state);
    const next = current + value * route.amount * (spec.max - spec.min);
    (out as unknown as Record<string, number>)[key] = Math.min(spec.max, Math.max(spec.min, next));
  }
  return out ?? base;
}

/**
 * Move one of `paramKey`'s routes from `fromIndex` to `toIndex`, where both
 * indices are positions within JUST that param's own routes (a
 * ModulationPage card's own list), not into `routes` itself. Every route of
 * a DIFFERENT param keeps its exact index in the full array —
 * applyMods/applyPostMods sum per param, so only the relative order of
 * routes sharing one param is ever observable, and this is the one place
 * that order changes (H12).
 *
 * Returns `routes` BY IDENTITY, not a copy, when the indices are equal or
 * out of range, so a rejected call costs nothing — the same convention
 * applyMods/applyPostMods use to skip a redundant clone.
 */
export function reorderRoutes(
  routes: ModRoute[],
  paramKey: string,
  fromIndex: number,
  toIndex: number,
): ModRoute[] {
  const positions: number[] = [];
  const subset: ModRoute[] = [];
  routes.forEach((r, i) => {
    if (r.param === paramKey) {
      positions.push(i);
      subset.push(r);
    }
  });
  if (
    fromIndex < 0 ||
    fromIndex >= subset.length ||
    toIndex < 0 ||
    toIndex >= subset.length ||
    fromIndex === toIndex
  ) {
    return routes;
  }
  const [moved] = subset.splice(fromIndex, 1);
  subset.splice(toIndex, 0, moved);
  const out = routes.slice();
  positions.forEach((pos, i) => (out[pos] = subset[i]));
  return out;
}

const MOD_CURVES = new Set<string>(["linear", "exp", "smooth"]);

/** attack/release: finite number clamped to 0..MOD_LAG_MAX_SEC, else absent. */
function validLagSec(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n)
    ? Math.min(MOD_LAG_MAX_SEC, Math.max(0, n))
    : undefined;
}

/** Validate an unknown blob into clean routes (project files, localStorage).
 * The v2 fields (curve/attack/release) are carried only when valid and are
 * OMITTED — not defaulted — otherwise, so a v1-shaped route round-trips with
 * exactly its v1 keys. */
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
      const curve =
        typeof r.curve === "string" && MOD_CURVES.has(r.curve) ? (r.curve as ModCurve) : undefined;
      const attack = validLagSec(r.attack);
      const release = validLagSec(r.release);
      const muted = typeof r.muted === "boolean" ? r.muted : undefined;
      out.push({
        id: r.id,
        source: r.source as ModSource,
        param: r.param.slice(0, 64),
        amount: Math.min(1, Math.max(-1, r.amount)),
        ...(curve !== undefined ? { curve } : {}),
        ...(attack !== undefined ? { attack } : {}),
        ...(release !== undefined ? { release } : {}),
        ...(muted !== undefined ? { muted } : {}),
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
