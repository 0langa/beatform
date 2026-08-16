import type { BgSettings, ParamValues } from "../render/types";
import { knownPresetId } from "../render/presets";
import { validBg } from "./project";

/**
 * Timeline: arrange the visual over the track. Two independent mechanisms:
 *
 *  - SCENES: which visual mode (+ optional param/background override) is
 *    active from a start time onward. The scene whose start is the latest
 *    one <= t wins; before the first scene the document's base setup runs.
 *  - AUTOMATION LANES: keyframed values for individual params of the active
 *    setup, interpolated at frame time (hold / linear / smooth curves).
 *
 * Evaluation is a pure function of (timeline, t) — evaluated identically in
 * the live loop and the export loop, so what you arrange is what renders.
 * Layering per frame: base params → scene override → automation → mod matrix.
 */
export interface Keyframe {
  /** Stable identity for React reconciliation, independent of array
   * position. `t`/`value` are exactly the fields a drag or an arrow-key
   * nudge mutates, and the editor re-sorts the array by `t` right after
   * (TimelinePanel's endDrag/nudgeKeyframe) — an index-based key would
   * reattach a dragged/nudged DOM node (and its focus) to whichever
   * keyframe the re-sort left sitting at that index once two keyframes
   * cross. Optional: schema v8 project files predate this field, so it must
   * keep loading files that lack it — validTimeline backfills a fresh id
   * for any keyframe that arrives without one. */
  id?: string;
  t: number;
  value: number;
  curve: "linear" | "hold" | "smooth";
}

export interface AutomationLane {
  /** Target param key (of whatever preset is active at that time). */
  param: string;
  /** Normally sorted ascending by t, but that is NOT a precondition: the
   * editor moves a dragged keyframe in place and only re-sorts on release,
   * so the live loop reads unsorted arrays. `laneValue` resolves by time and
   * returns what the sorted array would, order regardless. */
  keyframes: Keyframe[];
}

/** Transition styles for a scene's incoming fade. Index is the WGSL blend
 * `kind` — order is ABI, append only. */
export const TRANSITION_KINDS = [
  "crossfade",
  "wipe",
  "wipeup",
  "iris",
  "zoom",
  "glitch",
  "cut",
] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];

/** WGSL kind index for a transition name (0 = crossfade fallback). */
export function transitionIndex(kind: TransitionKind | undefined): number {
  const i = kind ? TRANSITION_KINDS.indexOf(kind) : 0;
  return i < 0 ? 0 : i;
}

export interface Scene {
  id: string;
  name: string;
  presetId: string;
  /** Seconds — the scene runs from here until the next scene's start. */
  start: number;
  /** Crossfade from the previous setup over this many seconds (0 = cut). */
  fadeSec?: number;
  /** How the incoming fade renders (default crossfade). */
  transition?: TransitionKind;
  /** Sparse param overrides on top of the document's per-preset params. */
  params?: ParamValues;
  bg?: BgSettings;
}

export interface Timeline {
  enabled: boolean;
  scenes: Scene[];
  lanes: AutomationLane[];
}

export const EMPTY_TIMELINE: Timeline = { enabled: false, scenes: [], lanes: [] };

/**
 * P-5: the toolbar's manual "Enabled" toggle is gone — a timeline with
 * scenes or lanes on it IS enabled, empty means off. This is the one
 * formula every WRITE site (store.ts's `setTimeline` and
 * `autoArrangeTimeline`) uses to compute the persisted `enabled` field from
 * here on, ignoring whatever the caller passed for it.
 *
 * Deliberately NOT used on load. `validTimeline`'s existing
 * `raw.enabled === true && (scenes.length > 0 || lanes.length > 0)` stays as
 * it is: an AND can only narrow a stray `true` to `false`, never resurrect an
 * explicit `false`, so a legacy document that was manually paused with
 * scenes still on it (`enabled: false`, non-empty `scenes`) keeps loading
 * paused — exactly what it meant before this function existed. This
 * function only governs what a fresh EDIT writes, never what a LOAD reads.
 *
 * E2(b): `setTimeline`'s own `timeline: Timeline` parameter is, like every
 * store action argument, a compile-time-only promise — neither WRITE site
 * validates its `scenes`/`lanes` before calling here, so a caller handing a
 * `Timeline`-shaped-but-incomplete object (missing `scenes`/`lanes`, or the
 * wrong type) used to crash here reading `.length` off `undefined` rather
 * than degrading to "empty". `Array.isArray` is a no-op for every real
 * `Timeline` (both fields are always real arrays by construction on every
 * path that actually builds one), so this changes nothing for a well-formed
 * caller and only guards the malformed one.
 */
export function deriveTimelineEnabled(timeline: Pick<Timeline, "scenes" | "lanes">): boolean {
  return (
    (Array.isArray(timeline.scenes) && timeline.scenes.length > 0) ||
    (Array.isArray(timeline.lanes) && timeline.lanes.length > 0)
  );
}

export function newSceneId(): string {
  return `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newKeyframeId(): string {
  return `kf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface TimelineFrame {
  /** null = before the first scene / no scenes → document base setup. */
  scene: Scene | null;
  /** During a crossfade: the setup being faded FROM (null otherwise). */
  prevScene: Scene | null;
  /** 0..1 blend toward `scene` (1 = fully arrived; no fade → always 1). */
  mix: number;
  /** WGSL blend kind for the active crossfade (0 when not fading). */
  transitionKind: number;
  /** Automation values at t, by param key. */
  automation: ParamValues;
}

function interpolate(k0: Keyframe, k1: Keyframe, t: number): number {
  if (k0.curve === "hold") return k0.value;
  const span = Math.max(1e-9, k1.t - k0.t);
  let f = Math.min(1, Math.max(0, (t - k0.t) / span));
  if (k0.curve === "smooth") f = f * f * (3 - 2 * f);
  return k0.value + (k1.value - k0.value) * f;
}

/**
 * Value of one lane at time t (first/last keyframe values pad the ends).
 *
 * Resolved by TIME, never by array position — the array order is an input the
 * evaluator does not control. Every STORED lane is sorted (validTimeline sorts
 * on load, and the editor re-sorts on pointer release / nudge / add), but
 * TimelinePanel deliberately moves a dragged keyframe IN PLACE so `drag.index`
 * survives it crossing a neighbour, and `setTimeline` publishes that array to
 * the store on every pointermove. So for the length of any drag that crosses a
 * neighbour the render loop reads an out-of-order lane, which the binary search
 * this replaced could not handle: it bracketed the wrong pair, and its
 * `t >= ks[last].t` end-pad tested whatever keyframe happened to sit LAST IN
 * THE ARRAY rather than last in time — so the lane flat-lined on that value for
 * the whole tail of the track while the user dragged, and the preview they were
 * dragging against lied. One pass, no allocation, and provably identical on
 * sorted input: `first`/`last`/`lo`/`hi` below are the sorted-order positions
 * 0, n-1, "last at or before t" and its successor, tie-broken exactly the way a
 * stable sort by `t` would order them.
 */
export function laneValue(lane: AutomationLane, t: number): number | null {
  const ks = lane.keyframes;
  if (ks.length === 0) return null;
  let first = 0; // min t, earliest index on a tie  -> sorted position 0
  let last = 0; // max t, latest index on a tie    -> sorted position n-1
  let lo = -1; // greatest t <= t, latest index on a tie
  let hi = -1; // least t > t, earliest index on a tie
  for (let i = 0; i < ks.length; i++) {
    const kt = ks[i].t;
    if (kt < ks[first].t) first = i;
    if (kt >= ks[last].t) last = i;
    if (kt <= t) {
      if (lo < 0 || kt >= ks[lo].t) lo = i;
    } else if (hi < 0 || kt < ks[hi].t) hi = i;
  }
  if (t <= ks[first].t) return ks[first].value;
  if (t >= ks[last].t) return ks[last].value;
  // Both exist here FOR ANY FINITE t: ks[first].t < t puts `first` in the lo
  // set, and ks[last].t > t puts `last` in the hi set — proven by the two
  // early returns just above having both already failed. A NaN t (nothing
  // upstream of this function — resolveActiveFrame's `t` — guarantees a
  // finite one) fails EVERY comparison above, including both of those early
  // returns, so `lo`/`hi` can reach here still at their initial -1 and
  // `interpolate(ks[-1], ...)` threw reading `.curve` off `undefined` — a
  // white-screen crash on the render loop, not merely a wrong value. Hold
  // the first keyframe instead, the same degrade `t <= ks[first].t` already
  // uses for "before the timeline".
  if (lo < 0 || hi < 0) return ks[first].value;
  return interpolate(ks[lo], ks[hi], t);
}

/** Evaluate the whole timeline at time t. Pure and allocation-light. */
export function evalTimeline(timeline: Timeline, t: number): TimelineFrame {
  if (!timeline.enabled)
    return { scene: null, prevScene: null, mix: 1, transitionKind: 0, automation: {} };

  // Order-independent: the active scene is the latest one starting at or
  // before t; prev is the latest one strictly before the active scene's
  // start. Scanning by time (not array order) means an unsorted scenes[]
  // (append-on-add, or a scene dragged past a neighbour) still resolves the
  // right crossfade source — and matches what the editor draws.
  let scene: Scene | null = null;
  for (const s of timeline.scenes) {
    if (s.start <= t && (scene === null || s.start > scene.start)) scene = s;
  }
  let prev: Scene | null = null;
  if (scene) {
    for (const s of timeline.scenes) {
      if (s.start < scene.start && (prev === null || s.start > prev.start)) prev = s;
    }
  }

  // Crossfade window right after the active scene's start. Only between two
  // real scenes — the first scene hard-cuts from the base setup.
  let prevScene: Scene | null = null;
  let mix = 1;
  let transitionKind = 0;
  const fade = scene?.fadeSec ?? 0;
  if (scene && prev && fade > 0 && t < scene.start + fade) {
    const f = Math.min(1, Math.max(0, (t - scene.start) / fade));
    // A hard cut ("cut") wants a LINEAR progress so the midpoint lands at
    // exactly fade/2; the geometric transitions read better eased.
    transitionKind = transitionIndex(scene.transition);
    mix = scene.transition === "cut" ? f : f * f * (3 - 2 * f);
    prevScene = prev;
  }

  // Object.create(null), not {}: every other validator/param map in the app
  // moved off the Object prototype so a lane or scene param named "constructor"
  // or "__proto__" cannot read (or assign through to) a prototype member. Inert
  // here today because consumers only spread and Object.keys it — the point is
  // that the map is untrusted-keyed and the next consumer won't be careful.
  const automation: ParamValues = Object.create(null) as ParamValues;
  for (const lane of timeline.lanes) {
    const v = laneValue(lane, t);
    if (v !== null) automation[lane.param] = v;
  }
  return { scene, prevScene, mix, transitionKind, automation };
}

/** Validation for project files / storage. */
export function validTimeline(v: unknown): Timeline {
  if (typeof v !== "object" || v === null) return { ...EMPTY_TIMELINE };
  const raw = v as Partial<Timeline>;
  const scenes: Scene[] = [];
  if (Array.isArray(raw.scenes)) {
    for (const s of raw.scenes as Array<Partial<Scene>>) {
      if (
        typeof s === "object" &&
        s !== null &&
        typeof s.id === "string" &&
        typeof s.presetId === "string" &&
        // Registered custom visuals are first-class scene presets — checking
        // only the built-ins silently DELETED custom scenes on every reload
        // (boot registers customs before initial state precisely so stored
        // ids validate; validPresetId in project.ts got this right).
        knownPresetId(s.presetId) &&
        typeof s.start === "number" &&
        Number.isFinite(s.start) &&
        s.start >= 0
      ) {
        // Object.create(null) — the keys come straight off an untrusted file.
        const params: ParamValues = Object.create(null) as ParamValues;
        if (typeof s.params === "object" && s.params !== null) {
          for (const [k, val] of Object.entries(s.params)) {
            if (typeof val === "number" && Number.isFinite(val)) params[k] = val;
          }
        }
        scenes.push({
          id: s.id,
          name: typeof s.name === "string" ? s.name.slice(0, 60) : "Scene",
          presetId: s.presetId,
          start: s.start,
          fadeSec:
            typeof s.fadeSec === "number" && Number.isFinite(s.fadeSec) && s.fadeSec > 0
              ? Math.min(8, s.fadeSec)
              : undefined,
          transition:
            typeof s.transition === "string" &&
            (TRANSITION_KINDS as readonly string[]).includes(s.transition)
              ? (s.transition as TransitionKind)
              : undefined,
          params: Object.keys(params).length > 0 ? params : undefined,
          bg: s.bg ? validBg(s.bg) : undefined,
        });
      }
    }
  }
  scenes.sort((a, b) => a.start - b.start);

  const lanes: AutomationLane[] = [];
  if (Array.isArray(raw.lanes)) {
    for (const l of raw.lanes as Array<Partial<AutomationLane>>) {
      if (typeof l !== "object" || l === null || typeof l.param !== "string" || !l.param) continue;
      const keyframes: Keyframe[] = [];
      if (Array.isArray(l.keyframes)) {
        for (const k of l.keyframes as Array<Partial<Keyframe>>) {
          if (
            typeof k === "object" &&
            k !== null &&
            typeof k.t === "number" &&
            Number.isFinite(k.t) &&
            k.t >= 0 &&
            typeof k.value === "number" &&
            Number.isFinite(k.value)
          ) {
            keyframes.push({
              // Preserve an id already on disk (a file saved by this fixed
              // build); backfill one for anything older — every pre-existing
              // schema v8 project predates this field.
              id: typeof k.id === "string" && k.id ? k.id : newKeyframeId(),
              t: k.t,
              value: k.value,
              curve: k.curve === "hold" || k.curve === "smooth" ? k.curve : "linear",
            });
          }
        }
      }
      if (keyframes.length > 0) {
        keyframes.sort((a, b) => a.t - b.t);
        lanes.push({ param: l.param.slice(0, 64), keyframes });
      }
    }
  }

  return {
    enabled: raw.enabled === true && (scenes.length > 0 || lanes.length > 0),
    scenes,
    lanes,
  };
}
