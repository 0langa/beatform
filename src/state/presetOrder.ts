import { BUILDER2_ID } from "../render/builder2";
import { canonicalPresetId, presets } from "../render/presets";
import type { PresetDef } from "../render/types";

/**
 * Display order of the mode strip.
 *
 * Deliberately a SEPARATE concept from the registry array in
 * render/presets/index.ts. The strip used to render that array verbatim, so
 * its order was "whichever week the mode was written" and — worse — appending
 * a preset to the registry silently moved nothing but adding one in the middle
 * would have reshuffled the strip for everyone. Order now lives here as an
 * explicit list of ids; the registry stays a set of definitions whose array
 * position means nothing to the user.
 *
 * Nothing in this file is read by the renderer, the export path or the project
 * document. Display order is a preference about the CHROME — live preview and
 * offline export render identically whatever the strip looks like.
 */

/**
 * The shipped order, chosen by feel (loud/obvious modes first, ambient and
 * niche ones later) rather than by implementation date.
 */
export const DEFAULT_PRESET_ORDER: readonly string[] = [
  "spectrum-bars",
  "radial-burst",
  "echo-trails",
  "bass-circle",
  "led-matrix",
  "spectro-falls",
  "tunnel-rings",
  "oscilloscope",
  "nebula",
  "metaballs",
  "particle-flow",
  "aurora",
  "voice-orb",
  "spectrum-scape",
  "synthwave",
  "particles",
  BUILDER2_ID,
];

/**
 * The chip that stays last. Builder is a studio for building your own look,
 * not a mode alongside the others, and it reads as the end of the list — so a
 * preset that no list mentions lands immediately BEFORE it rather than after.
 *
 * This one rule answers both open questions at once: where an id missing from
 * DEFAULT_PRESET_ORDER goes (a mode shipped without touching the list above),
 * and where a mode added by an app UPDATE goes in a user's saved order. In
 * both cases the answer is "at the end of the real modes", which is visible
 * and reachable — never dropped, never buried.
 */
const TRAILING_ID = BUILDER2_ID;

/** Every id the strip can show, in registry order. */
export function stripPresetIds(): string[] {
  return presets.map((p) => p.id);
}

/**
 * Turn a stored/candidate order into one that is exactly the available ids,
 * each once, in a sane sequence.
 *
 * This is the load-bearing part of "my order survives an update":
 *  - ids that no longer exist are dropped (a preset was removed),
 *  - ids the order never heard of are APPENDED, not dropped — a mode added by
 *    an update must never become unreachable because the user customised
 *    their strip on an older build,
 *  - anything that is not a list of strings (corrupt localStorage, a
 *    hand-edited blob, a value from a future schema) falls back to the
 *    default order instead of throwing or rendering an empty strip.
 *
 * Idempotent: reconciling an already-reconciled order returns it unchanged.
 */
export function reconcilePresetOrder(
  stored: unknown,
  available: readonly string[] = stripPresetIds(),
): string[] {
  const known = new Set(available);
  const kept: string[] = [];
  const seen = new Set<string>();
  const take = (src: readonly unknown[]) => {
    for (const raw of src) {
      // Non-strings and duplicates are skipped rather than treated as
      // corruption: one bad entry should not cost the user the whole order.
      if (typeof raw !== "string") continue;
      // A RENAMED id (v13: "starfield" -> "particles") is the user's own
      // customised position for that mode, not corruption — map it in place
      // so the strip keeps their order instead of appending the mode at the
      // end as if an update had just added it.
      const id = canonicalPresetId(raw);
      if (!known.has(id) || seen.has(id)) continue;
      seen.add(id);
      kept.push(id);
    }
  };
  take(Array.isArray(stored) ? stored : []);
  // Nothing usable survived — not an array at all, or every id in it is gone.
  // The shipped order is the honest answer there, not an empty strip.
  if (kept.length === 0) take(DEFAULT_PRESET_ORDER);

  // New ids arrive in the order the DEFAULT list wants them, so an update that
  // adds three modes at once inserts them in a considered sequence rather than
  // in whatever order the registry array happens to list them.
  const rank = (id: string) => {
    const i = DEFAULT_PRESET_ORDER.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const added = available.filter((id) => !seen.has(id)).sort((a, b) => rank(a) - rank(b));
  if (added.length === 0) return kept;

  const at = kept.indexOf(TRAILING_ID);
  if (at === -1) return [...kept, ...added];
  return [...kept.slice(0, at), ...added, ...kept.slice(at)];
}

/** The shipped order, resolved against the presets this build actually has. */
export function defaultPresetOrder(available: readonly string[] = stripPresetIds()): string[] {
  return reconcilePresetOrder(DEFAULT_PRESET_ORDER, available);
}

/** True when `order` is the shipped one — i.e. Reset would change nothing. */
export function isDefaultPresetOrder(
  order: readonly string[],
  available: readonly string[] = stripPresetIds(),
): boolean {
  const def = defaultPresetOrder(available);
  return order.length === def.length && order.every((id, i) => id === def[i]);
}

/** `list` with the item at `from` moved to `to`. Out-of-range is a no-op copy. */
export function movePresetOrder(list: readonly string[], from: number, to: number): string[] {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

/**
 * The strip's actual contents: built-in modes in the user's order, then the
 * user's own WGSL presets. Custom presets deliberately keep appending at the
 * end — they come and go at runtime, and an order that had to be rewritten
 * every time a shader is saved or deleted is a persistence bug waiting to
 * happen. (Ordering them too is the obvious next step if it is ever asked
 * for: reconcile already takes the available-id list as a parameter.)
 */
export function orderedPresets(
  order: readonly string[],
  customDefs: readonly PresetDef[],
): PresetDef[] {
  const byId = new Map(presets.map((p) => [p.id, p]));
  const out: PresetDef[] = [];
  for (const id of order) {
    const def = byId.get(id);
    if (def) out.push(def);
  }
  return [...out, ...customDefs];
}
