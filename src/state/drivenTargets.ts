import type { PresetDef } from "../render/types";
import { paramSpecMap } from "../render/types";
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
 * WHY IT IS ITS OWN MODULE: it is a pure function of (preset, routes), it must
 * agree with `applyMods` exactly, and it is consumed by a component that is not
 * store-aware. Keeping it out of the UI is what lets `drivenTargets.test.ts`
 * assert the agreement directly.
 *
 * NAMED "driven", NOT "modulated": timeline automation lanes (timeline.ts,
 * applied in frameResolve.ts) drive the same param keys just as invisibly and
 * want the identical mark — extending this function is then purely additive
 * instead of a rename across CSS, markup and tests. MIDI CC is deliberately NOT
 * in scope: it writes through `setParam`, so the slider physically moves and is
 * already self-describing.
 */

/** One shared empty result, so the common "no routes" case allocates nothing
 *  and a `useMemo` over it stays referentially stable across re-derivations. */
const NONE: ReadonlySet<string> = new Set<string>();

/**
 * Param keys `applyMods` will ACTUALLY move on this preset.
 *
 * Filtered by the same two inert rules `applyMods` uses — no spec for the key,
 * and `spec.mod === "off"` (modMatrix.ts, the two `continue`s at the top of its
 * route loop). A badge that claims a knob is driven while the renderer provably
 * skips the route is worse than no badge, so the two must not drift: any third
 * inert rule added to `applyMods` belongs here too.
 *
 * `post:` routes fall out through the FIRST of those rules and not a special
 * case of their own: post targets are namespaced keys ("post:chromatic") that no
 * preset declares, so `paramSpecMap` never has them. They are applied by
 * `applyPostMods` against PostSettings, never reach ParamGroups, and marking
 * them is the Scene page's job.
 */
export function drivenParamKeys(preset: PresetDef, mods: readonly ModRoute[]): ReadonlySet<string> {
  if (mods.length === 0) return NONE;
  const specs = paramSpecMap(preset);
  // Lazy, like applyMods' own `out`: a non-empty route list is not the same as
  // a route that moves something here. A project whose routes all target post,
  // or a preset the user has since switched away from, allocates nothing.
  let out: Set<string> | null = null;
  for (const route of mods) {
    const spec = specs.get(route.param);
    if (!spec) continue;
    if (spec.mod === "off") continue;
    (out ??= new Set<string>()).add(route.param);
  }
  return out ?? NONE;
}
