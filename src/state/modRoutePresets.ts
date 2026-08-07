import { allParams, isModTarget, paramSpecMap, type PresetDef } from "../render/types";
import {
  POST_TARGET_PREFIX,
  postTargetKey,
  type ModCurve,
  type ModRoute,
  type ModSource,
} from "./modMatrix";

/**
 * Route recipes (P-7): a small curated set of one-or-two-route modulation
 * presets, surfaced as copyable chips in the Modulation section. Clicking a
 * chip ADDS ordinary ModRoutes to the active visual's route list — nothing
 * about the recipe itself is persisted, only the routes it minted, so a
 * recipe can evolve without a migration. Recipe IDs are still forever (they
 * appear in undo labels and future UI deep links); never rename one.
 */
export interface ModRouteRecipe {
  id: string;
  /** Chip label. */
  name: string;
  /** Chip tooltip — what it does, in user words. */
  hint: string;
  routes: ModRouteSpec[];
}

/** One route of a recipe, with its target expressed as a PREFERENCE list. */
export interface ModRouteSpec {
  source: ModSource;
  /**
   * Ordered param-key preferences. "post:*" entries are always available
   * (post targets exist on every visual); bare keys win only when the active
   * preset has that param AND allows modulation on it. No match → the
   * preset's first modulatable param, so a recipe never lands on nothing.
   */
  paramPrefs: string[];
  amount: number;
  curve?: ModCurve;
  attack?: number;
  release?: number;
}

export const MOD_ROUTE_RECIPES: ModRouteRecipe[] = [
  {
    id: "kick-punch",
    name: "Kick punch",
    hint: "Kick slams the size/zoom knob (exp curve, snappy release) and pops the exposure",
    routes: [
      {
        source: "kick",
        paramPrefs: ["zoom", "size", "radius", "scale", "amp"],
        amount: 0.6,
        curve: "exp",
        release: 0.12,
      },
      {
        source: "kick",
        paramPrefs: ["post:exposure"],
        amount: 0.12,
        curve: "exp",
        release: 0.1,
      },
    ],
  },
  {
    id: "bass-swell",
    name: "Bass swell",
    hint: "Bass swells the glow — eased curve, slow rise, slower fall",
    routes: [
      {
        source: "bass",
        paramPrefs: ["glow", "bright", "intensity"],
        amount: 0.5,
        curve: "smooth",
        attack: 0.08,
        release: 0.35,
      },
    ],
  },
  {
    id: "beat-sway",
    name: "Beat sway",
    hint: "A gentle 4-beat sine LFO rocks the motion knob",
    routes: [{ source: "lfo:sine:4", paramPrefs: ["spin", "speed", "drift"], amount: 0.25 }],
  },
  {
    id: "bar-sweep",
    name: "Bar sweep",
    hint: "A 4-beat saw LFO sweeps the hue once per bar",
    routes: [{ source: "lfo:saw:4", paramPrefs: ["hue"], amount: 0.5 }],
  },
  {
    id: "drop-brightness",
    name: "Drop brightness",
    hint: "Track energy drives bloom with an exp curve — quiet parts stay clean, drops light up",
    routes: [{ source: "energy", paramPrefs: ["post:bloom"], amount: 0.6, curve: "exp" }],
  },
  {
    id: "hat-sparkle",
    name: "Hat sparkle",
    hint: "Hi-hats flicker a touch of chromatic aberration",
    routes: [{ source: "hat", paramPrefs: ["post:chromatic"], amount: 0.2, release: 0.06 }],
  },
];

/** Resolve one spec's target for a preset — see ModRouteSpec.paramPrefs. */
function resolveTarget(preset: PresetDef, prefs: string[]): string | null {
  const specs = paramSpecMap(preset);
  for (const key of prefs) {
    if (key.startsWith(POST_TARGET_PREFIX)) {
      if (postTargetKey(key)) return key;
      continue;
    }
    const spec = specs.get(key);
    if (spec && isModTarget(spec)) return key;
  }
  const first = allParams(preset).find(isModTarget);
  return first ? first.key : null;
}

/**
 * Materialize a recipe against the active preset. Skips a route whose exact
 * (source, param) pair already exists — clicking a chip twice must not stack
 * a second identical amount — and skips specs with no resolvable target.
 * Returns plain ModRoutes ready to append to the active list.
 */
export function recipeRoutes(
  recipe: ModRouteRecipe,
  preset: PresetDef,
  existing: ModRoute[],
  newId: () => string,
): ModRoute[] {
  const out: ModRoute[] = [];
  for (const spec of recipe.routes) {
    const param = resolveTarget(preset, spec.paramPrefs);
    if (!param) continue;
    const dupe =
      existing.some((r) => r.source === spec.source && r.param === param) ||
      out.some((r) => r.source === spec.source && r.param === param);
    if (dupe) continue;
    out.push({
      id: newId(),
      source: spec.source,
      param,
      amount: spec.amount,
      ...(spec.curve !== undefined ? { curve: spec.curve } : {}),
      ...(spec.attack !== undefined ? { attack: spec.attack } : {}),
      ...(spec.release !== undefined ? { release: spec.release } : {}),
    });
  }
  return out;
}
