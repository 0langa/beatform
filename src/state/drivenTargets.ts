import type { PresetDef } from "../render/types";
import { paramSpecMap } from "../render/types";
import type { AutomationLane } from "./timeline";
import type { ModRoute } from "./modMatrix";

/**
 * Which knobs of the active visual are being moved by something OTHER than the
 * slider itself — the input to the Mode page's `driven` mark (P-1 stage 3).
 *
 * WHY IT EXISTS: modulation is non-destructive. A route to "Bloom" never writes
 * the document, so the Bloom slider sits exactly where you left it while the
 * render does something else entirely. Before this, the only place that fact
 * appeared was the Modulation page — a different page from the one where you
 * edit the knob.
 *
 * WHY IT IS ITS OWN MODULE: it is a pure function of (preset, routes, lanes),
 * it must agree with `applyMods` and `resolveActiveFrame` exactly, and it is
 * consumed by a component that is not store-aware. Keeping it out of the UI is
 * what lets `drivenTargets.test.ts` assert both agreements directly, against
 * the real engine functions.
 *
 * NAMED "driven", NOT "modulated": timeline automation lanes drive the same
 * param keys just as invisibly and want the identical mark, so H11 widened
 * this function instead of renaming anything across CSS, markup and tests.
 * MIDI CC is deliberately NOT in scope: it writes through `setParam`, so the
 * slider physically moves and is already self-describing.
 */

/** One shared empty result, so the common "nothing driven" case allocates
 *  nothing and a `useMemo` over it stays referentially stable across
 *  re-derivations. */
const NONE: ReadonlySet<string> = new Set<string>();

const NO_LANES: readonly AutomationLane[] = [];

/**
 * The timeline facts that decide whether a lane reaches a param. Structural, so
 * the document's whole `Timeline` satisfies it — and so `enabled` cannot be
 * forgotten by a caller that remembers `lanes` (the two travel together or not
 * at all, which is exactly the shape of the rule in `evalTimeline`).
 */
export interface DrivenTimeline {
  enabled: boolean;
  lanes: readonly AutomationLane[];
}

/** Default third argument: the mods-only reading, unchanged. */
const NO_TIMELINE: DrivenTimeline = { enabled: false, lanes: NO_LANES };

/**
 * Param keys of this preset that `applyMods` or an automation lane will
 * ACTUALLY move.
 *
 * TWO DRIVERS, TWO DIFFERENT SETS OF INERT RULES — that asymmetry is the whole
 * subtlety of this function, and it is not a bug in either engine:
 *
 * MODULATION (`applyMods`, modMatrix.ts) skips a route when it is `muted`
 * (H12), when there is no spec for the key, and when `spec.mod === "off"` —
 * the three `continue`s at the top of its route loop. `post:` routes fall
 * out through the "no spec" one of those and not a special case of their
 * own: post targets are namespaced keys ("post:chromatic") that no preset
 * declares, so `paramSpecMap` never has them. They are applied by
 * `applyPostMods` against PostSettings, never reach ParamGroups, and
 * marking them is the Scene page's job.
 *
 * AUTOMATION (`evalTimeline` + `resolveActiveFrame`) skips a lane when the
 * timeline's master switch is off (evalTimeline's first line returns an empty
 * `automation` map) and when the lane has no keyframes (`laneValue` returns
 * null). It does NOT consult `spec.mod`: frameResolve spreads `automation` over
 * the resolved params wholesale, so a lane on a `mod: "off"` knob like `mirror`
 * genuinely moves it — and TimelinePanel offers every param of the active
 * preset as a lane target, `mod: "off"` included. Claiming otherwise would hide
 * a real driver, which is the same defect class as claiming a false one.
 * Automation is time-independent for this purpose: `laneValue` pads both ends
 * with the first/last keyframe, so an enabled lane with one keyframe overrides
 * its param at EVERY t.
 *
 * The spec lookup is the one rule both share, and for automation it is a
 * statement about the mark rather than about the renderer: frameResolve will
 * happily carry `automation["knobOfSomeOtherMode"]` in the params record, but
 * no uniform and no row is keyed by it here, so there is nothing to mark.
 *
 * A badge that claims a knob is driven while the renderer provably skips it is
 * worse than no badge, so these must not drift: any new inert rule in
 * `applyMods`, `evalTimeline` or `resolveActiveFrame` belongs here too.
 */
export function drivenParamKeys(
  preset: PresetDef,
  mods: readonly ModRoute[],
  timeline: DrivenTimeline = NO_TIMELINE,
): ReadonlySet<string> {
  const lanes = timeline.enabled ? timeline.lanes : NO_LANES;
  if (mods.length === 0 && lanes.length === 0) return NONE;
  const specs = paramSpecMap(preset);
  // Lazy, like applyMods' own `out`: a non-empty route or lane list is not the
  // same as one that moves something HERE. A project whose routes all target
  // post, or whose lanes belong to a mode the user has since switched away
  // from, allocates nothing.
  let out: Set<string> | null = null;
  for (const route of mods) {
    // H12: applyMods skips a muted route entirely — it drives nothing, so
    // neither does the mark. Mirrors the mod:"off" skip right below it.
    if (route.muted === true) continue;
    const spec = specs.get(route.param);
    if (!spec) continue;
    if (spec.mod === "off") continue;
    (out ??= new Set<string>()).add(route.param);
  }
  for (const lane of lanes) {
    if (lane.keyframes.length === 0) continue;
    if (!specs.has(lane.param)) continue;
    (out ??= new Set<string>()).add(lane.param);
  }
  return out ?? NONE;
}
