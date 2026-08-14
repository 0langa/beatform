import { presetById } from "../render/presets";
import type { BgSettings, PresetDef } from "../render/types";

/**
 * Shared, allocation-free store selectors.
 *
 * Two jobs:
 *
 * 1. **One definition per derived rule.** The per-mode background expression
 *    `bgByPreset[presetId] ?? bg` used to be copy-pasted into five live call
 *    sites (App, the store's effBg, the render loop's getFrameInput, the
 *    video-bg frame branch, buildExportOptions). One copy drifted from the
 *    others and that was defect BG1: the render loop re-applied the GLOBAL
 *    background every frame, so a per-mode override rendered in exports but
 *    was invisible live, within ~16 ms of every correct apply. A rule with
 *    one implementation cannot diverge from itself.
 *
 * 2. **Safe to hand straight to `useVizStore`.** zustand v5 passes the
 *    selector to `useSyncExternalStore` with no equality function, so a
 *    selector that ALLOCATES (object literal, array literal, spread,
 *    `.filter`/`.map`/`.slice`) returns a fresh reference on every store
 *    notification and is "Maximum update depth exceeded" ON MOUNT — a white
 *    screen, not a slow render. Every function here returns a primitive,
 *    `null`, or a reference the store (or a module registry) already owns.
 *    An eslint `no-restricted-syntax` rule blocks the allocating shapes at
 *    author time; these selectors are the sanctioned way to share the
 *    derivations that would otherwise tempt one.
 *
 * Parameters are typed STRUCTURALLY, never as `VizState`: `buildExportOptions`
 * holds a `ProjectDocument`, not the store, and must resolve the background by
 * the identical rule. For the same reason this module imports nothing from
 * `store.ts` — not even a type — so there is no cycle and no risk of dragging
 * the store into the export worker's graph.
 */

/** The background that should actually render right now: the active mode's
 * override if one exists, else the global bg. THE one definition (BG1). */
export function selectEffectiveBg(s: {
  bg: BgSettings;
  bgByPreset: Record<string, BgSettings>;
  presetId: string;
}): BgSettings {
  return s.bgByPreset[s.presetId] ?? s.bg;
}

/** Does the active mode carry its own background override? The existence
 * question, not the resolution — writes go to the override when this is true
 * and to the global bg when it is false. */
export function selectBgPerMode(s: {
  bgByPreset: Record<string, unknown>;
  presetId: string;
}): boolean {
  return !!s.bgByPreset[s.presetId];
}

/** Resolved def of the active mode.
 *
 * Safe inside a zustand selector: every branch of `presetById` returns an
 * EXISTING reference — `currentBuilder2Def()` hands back a module-level var,
 * the built-in and custom lookups are `Map.get`, and the fallback is
 * `presets[0]` — so `Object.is` holds between notifications.
 *
 * It must also be called INSIDE the selector rather than once in the caller:
 * `registerCustomPreset` and `rebuildBuilder2` write their module registries
 * BEFORE the `set()` that notifies subscribers, so resolving at selector time
 * is what picks up a custom-shader re-save under the same id. Resolving
 * outside re-introduces the stale param-schema bug. */
export function selectPreset(s: { presetId: string }): PresetDef {
  return presetById(s.presetId);
}

/** Display name of the active mode's center-image override, or null when the
 * mode falls back to the track's cover art. An asset that lost its name still
 * reads as an override, hence the literal fallback. */
export function selectCenterImageName(s: {
  centerImageByPreset: Record<string, string>;
  presetId: string;
  assets: Record<string, { name?: string }>;
}): string | null {
  const id = s.centerImageByPreset[s.presetId];
  return id ? (s.assets[id]?.name ?? "Custom image") : null;
}

/** Is cover art available for the modes that sample it? */
export function selectHasCoverArt(s: { coverArt: unknown }): boolean {
  return !!s.coverArt;
}

/** Detected tempo, or null before analysis lands, or when the track has no
 * usable pulse. `beatTimes.length < 2` is the same "no grid" predicate
 * `gridPhase` (audio/analysis/beatGrid.ts) already lives by: a silent or
 * DC-offset track can still make `estimateTempo` pick a best-scoring lag (an
 * all-zero autocorrelation "wins" at the tempo-range boundary, ~200.9 BPM),
 * but the DP beat tracker then finds no positive-score transition, so fewer
 * than two beats land in `beatTimes`. A claimed tempo with nothing to grid is
 * not a claim worth showing. */
export function selectBpm(s: {
  beatGrid: { bpm: number; beatTimes: { length: number } } | null;
}): number | null {
  return s.beatGrid && s.beatGrid.beatTimes.length >= 2 ? s.beatGrid.bpm : null;
}

/** Detected key display name, or null before analysis / for atonal tracks. */
export function selectKeyName(s: { trackKey: { name: string } | null }): string | null {
  return s.trackKey?.name ?? null;
}
