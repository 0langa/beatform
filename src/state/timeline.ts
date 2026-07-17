import type { BgSettings, ParamValues } from "../render/types";
import { presets } from "../render/presets";
import { customPresetById } from "../render/presets/custom";
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
  t: number;
  value: number;
  curve: "linear" | "hold" | "smooth";
}

export interface AutomationLane {
  /** Target param key (of whatever preset is active at that time). */
  param: string;
  /** Sorted ascending by t; evaluator tolerates unsorted input defensively. */
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

export function newSceneId(): string {
  return `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

/** Value of one lane at time t (first/last keyframe values pad the ends). */
export function laneValue(lane: AutomationLane, t: number): number | null {
  const ks = lane.keyframes;
  if (ks.length === 0) return null;
  if (t <= ks[0].t) return ks[0].value;
  if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].value;
  // Binary search: last keyframe with t_k <= t
  let lo = 0;
  let hi = ks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ks[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return interpolate(ks[lo], ks[lo + 1], t);
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

  const automation: ParamValues = {};
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
        (presets.some((p) => p.id === s.presetId) || customPresetById(s.presetId) !== undefined) &&
        typeof s.start === "number" &&
        Number.isFinite(s.start) &&
        s.start >= 0
      ) {
        const params: ParamValues = {};
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
