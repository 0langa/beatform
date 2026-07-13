import type { BgSettings, ParamValues } from "../render/types";
import { presets } from "../render/presets";
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

export interface Scene {
  id: string;
  name: string;
  presetId: string;
  /** Seconds — the scene runs from here until the next scene's start. */
  start: number;
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
  if (!timeline.enabled) return { scene: null, automation: {} };

  let scene: Scene | null = null;
  for (const s of timeline.scenes) {
    if (s.start <= t && (scene === null || s.start >= scene.start)) scene = s;
  }

  const automation: ParamValues = {};
  for (const lane of timeline.lanes) {
    const v = laneValue(lane, t);
    if (v !== null) automation[lane.param] = v;
  }
  return { scene, automation };
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
        presets.some((p) => p.id === s.presetId) &&
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
