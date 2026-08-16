import { pcmFromAudioBuffer } from "../../audio/offlineSource";
import { decodeAudioLenient } from "../../audio/decodeLenient";
import { analyzeStem, MAX_STEMS, STEM_SLOTS } from "../../audio/stems";
import { allParams, isModTarget, paramSpecMap, type PresetDef } from "../../render/types";
import { presetById } from "../../render/presets";
import {
  newRouteId,
  postTargetKey,
  reorderRoutes,
  validModRoutes,
  type ModRoute,
  type ModSource,
} from "../modMatrix";
import { MOD_ROUTE_RECIPES, recipeRoutes } from "../modRoutePresets";
import { saveStoredMods } from "../persistence";
import { getEngine } from "../services";
import { stemRoutesFor } from "../stemRouting";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";
import { shared } from "./shared";

/**
 * Is `param` something a route may actually drive on this visual? The SAME
 * question the Modulation create picker answers when it builds its option
 * list — `allParams` filtered by `isModTarget`, plus the namespaced `post:`
 * targets — asked here against the memoized key map rather than rebuilt from
 * a literal list, so a re-tiered knob or a new post target can never leave the
 * two disagreeing. Mirrors `resolveTarget` in modRoutePresets.ts, the recipe
 * side of the same question.
 */
function isRoutableTarget(preset: PresetDef, param: string): boolean {
  if (postTargetKey(param) !== null) return true;
  const spec = paramSpecMap(preset).get(param);
  return spec !== undefined && isModTarget(spec);
}

export function stemsModsActions(set: SetFn, get: GetFn, ctx: SliceCtx) {
  return {
    async addStem(file) {
      const s = get();
      if (s.stems.length >= MAX_STEMS) {
        set({ error: `Up to ${MAX_STEMS} stems — remove one first` });
        return;
      }
      if (s.stemAnalyzing) return; // one analysis at a time
      const slot = STEM_SLOTS.find((sl) => !s.stems.some((e) => e.slot === sl));
      if (!slot) return;
      set({ stemAnalyzing: file.name, error: null });
      // Stems are per-track: if a new track lands while this stem is still
      // decoding/analyzing, the result belongs to the OLD track — drop it
      // instead of re-adding it after loadFile just cleared the list.
      const gen = shared.trackLoadGen;
      try {
        // Decode on the ENGINE's context: a fresh OfflineAudioContext would
        // resample and shift every FFT bin (the batch learned this once).
        const buf = await decodeAudioLenient(getEngine().ctx, await file.arrayBuffer());
        const analysis = await analyzeStem(pcmFromAudioBuffer(buf), file.name);
        if (gen !== shared.trackLoadGen) return;
        set({ stems: [...get().stems, { slot, analysis }] });
        ctx.flashNotice(`Stem "${analysis.name}" ready — route it in Modulation`);
      } catch (e) {
        set({ error: `Could not analyze stem "${file.name}" (${(e as Error).message})` });
      } finally {
        set({ stemAnalyzing: null });
      }
    },

    removeStem(slot) {
      set({ stems: get().stems.filter((e) => e.slot !== slot) });
    },

    autoRouteStem(slot) {
      const s = get();
      if (!s.stems.some((e) => e.slot === slot)) return;
      // Replace any existing routes for THIS stem (re-clicking re-wires it),
      // keep routes for other sources, and don't fight over knobs already
      // targeted by surviving routes.
      const kept = s.activeMods.filter((r) => !r.source.startsWith(`${slot}:`));
      const taken = new Set(kept.map((r) => r.param));
      const added = stemRoutesFor(slot, allParams(presetById(s.presetId)), newRouteId, taken);
      if (added.length === 0) {
        ctx.flashNotice("This visual has no knobs that map to stem bands");
        return;
      }
      ctx.record("mod-add");
      const activeMods = [...kept, ...added];
      const modsByPreset = { ...s.modsByPreset, [s.presetId]: activeMods };
      set({ activeMods, modsByPreset });
      saveStoredMods(modsByPreset);
      ctx.flashNotice(`Wired ${added.length} routes from the stem — tweak amounts in Modulation`);
    },

    applyModRouteRecipe(recipeId: string) {
      const recipe = MOD_ROUTE_RECIPES.find((r) => r.id === recipeId);
      if (!recipe) return;
      const s = get();
      const added = recipeRoutes(recipe, presetById(s.presetId), s.activeMods, newRouteId);
      if (added.length === 0) {
        ctx.flashNotice("Already routed — tweak the existing route's amount instead");
        return;
      }
      ctx.record("mod-add");
      const activeMods = [...s.activeMods, ...added];
      const modsByPreset = { ...s.modsByPreset, [s.presetId]: activeMods };
      set({ activeMods, modsByPreset });
      saveStoredMods(modsByPreset);
    },

    addModRoute(source: ModSource, param: string) {
      const s = get();
      // H10 — both guards belong to the ACTION, not only to the picker that
      // renders them unreachable. This is a public store action; the create
      // picker is merely today's caller, and both failure modes are silent.
      // A route on `""` or on a param this visual has no modulatable spec for
      // looks added and survives the session, then either vanishes from the
      // saved file when validModRoutes reads it back or sits inert forever;
      // a repeat (source, param) stacks a second route that COMPOUNDS on one
      // knob. Recording only after the guards keeps a rejected call off the
      // undo stack.
      if (!isRoutableTarget(presetById(s.presetId), param)) return;
      if (s.activeMods.some((r) => r.source === source && r.param === param)) return;
      ctx.record("mod-add");
      const route: ModRoute = { id: newRouteId(), source, param, amount: 0.5 };
      const activeMods = [...s.activeMods, route];
      const modsByPreset = { ...s.modsByPreset, [s.presetId]: activeMods };
      set({ activeMods, modsByPreset });
      saveStoredMods(modsByPreset);
    },

    updateModRoute(id, patch) {
      ctx.record(`mod:${id}:${Object.keys(patch).join(",")}`);
      const s = get();
      // E2(b): `patch` is `Partial<ModRoute>` at compile time only — a
      // hostile/malformed patch (this is a public store action) used to
      // merge straight in with `{ ...r, ...patch }`, no validation, so a
      // non-finite amount/attack/release, an unrecognized curve, or a
      // hostile `source` could all land in `activeMods`/`modsByPreset`
      // un-checked. `validModRoutes` is the SAME validator every project/
      // theme/localStorage load already runs a route through — reusing it
      // here (on the merged candidate, not the bare patch) means a route
      // this store holds live is held to exactly the same shape a freshly
      // loaded one would be, whichever path it arrived by. Falls back to
      // the pre-patch route `r` (rejecting the whole patch) only in the
      // rare case id/source/param/amount themselves become invalid — the
      // same "unknown/garbage source" the validator already drops on load.
      const activeMods = s.activeMods.map((r) => {
        if (r.id !== id) return r;
        const [validated] = validModRoutes([{ ...r, ...patch }]);
        return validated ?? r;
      });
      const modsByPreset = { ...s.modsByPreset, [s.presetId]: activeMods };
      set({ activeMods, modsByPreset });
      saveStoredMods(modsByPreset);
    },

    removeModRoute(id) {
      ctx.record("mod-remove");
      const s = get();
      const activeMods = s.activeMods.filter((r) => r.id !== id);
      const modsByPreset = { ...s.modsByPreset };
      if (activeMods.length > 0) modsByPreset[s.presetId] = activeMods;
      else delete modsByPreset[s.presetId];
      set({ activeMods, modsByPreset });
      saveStoredMods(modsByPreset);
    },

    reorderModRoutes(paramKey, fromIndex, toIndex) {
      const s = get();
      const activeMods = reorderRoutes(s.activeMods, paramKey, fromIndex, toIndex);
      // Out of range or a no-op move: reorderRoutes hands back `activeMods`
      // BY IDENTITY for that, and a rejected call is not an edit — recording
      // it would put a no-op on the undo stack (same guard as addModRoute).
      if (activeMods === s.activeMods) return;
      // Per-card (M1): a bare "mod-reorder" key let a ▲▼ click on one card
      // and another ▲▼ click on a DIFFERENT card, fired within the 800ms
      // window, collapse into one undo entry. Keying on paramKey scopes the
      // grouping to one card, same idiom as updateModRoute's per-route key
      // and setModRouteAmountsForParam's per-param key below.
      ctx.record(`mod-reorder:${paramKey}`);
      const modsByPreset = { ...s.modsByPreset, [s.presetId]: activeMods };
      set({ activeMods, modsByPreset });
      saveStoredMods(modsByPreset);
    },

    // H13 — two bulk Modulation actions, two different undo shapes (C1).
    // clearModRoutesForSource is discrete and destructive: it keeps the
    // UNGROUPABLE (history.ts) "mod-bulk" key, exactly like "mod-add", so
    // two clears fired back to back stay two undo entries, never collapsing
    // into one that silently drops the first removal.
    //
    // setModRouteAmountsForParam instead drives a continuous <input
    // type="range"> (own comment below) — it records a GROUPABLE per-param
    // "mod-bulk-depth:<param>" key, so one drag's many onChange calls group
    // to one entry the same way updateModRoute's own per-route key already
    // groups a Depth-slider drag. The two actions' keys can never collide —
    // UNGROUPABLE membership keeps repeat clears apart, the disjoint key
    // prefix keeps a clear and a depth-set apart, and the per-param suffix
    // keeps two different cards' depth-sets apart.

    /**
     * Remove every route whose source matches. Destructive + bulk: the UI
     * asks first (ModulationPage's clearSourceGuarded calls askConfirm, then
     * this) — this action itself is deliberately prompt-free, the same
     * UI-level-guard split ParamsPanel.tsx uses for deleteLook/
     * clearLyricsGuarded, so a test (or any future non-UI caller) can invoke
     * it directly with no dialog in the way.
     *
     * Muted routes are removed too: mute only skips a route in applyMods, it
     * does not change what source the route matches, and "clear every route
     * driven by X" is the promise on the button regardless of mute state.
     */
    clearModRoutesForSource(source) {
      const s = get();
      const activeMods = s.activeMods.filter((r) => r.source !== source);
      if (activeMods.length === s.activeMods.length) return; // nothing matched
      ctx.record("mod-bulk");
      const modsByPreset = { ...s.modsByPreset };
      if (activeMods.length > 0) modsByPreset[s.presetId] = activeMods;
      else delete modsByPreset[s.presetId];
      set({ activeMods, modsByPreset });
      saveStoredMods(modsByPreset);
    },

    /**
     * Set `amount` on every route targeting `param` — the stacked card's
     * "All" depth row (H13). NOT destructive (every value stays a slider
     * drag away from where it started), so no confirm.
     *
     * Muted routes are included: amount is independent of mute state, same
     * as each route's own Depth slider (updateModRoute) already treats a
     * muted route's amount as live, just not currently applied.
     */
    setModRouteAmountsForParam(param, amount) {
      const s = get();
      if (!s.activeMods.some((r) => r.param === param)) return; // nothing to set
      // GROUPABLE, per-param (C1): the card's "All" depth row is a
      // continuous slider, not a discrete action, so unlike
      // clearModRoutesForSource above it must NOT be UNGROUPABLE — a drag's
      // stream of onChange calls needs to group to one undo entry, the same
      // as any other slider. Scoping the key to `param` keeps that grouping
      // from ever reaching across two different cards.
      ctx.record(`mod-bulk-depth:${param}`);
      const activeMods = s.activeMods.map((r) => (r.param === param ? { ...r, amount } : r));
      const modsByPreset = { ...s.modsByPreset, [s.presetId]: activeMods };
      set({ activeMods, modsByPreset });
      saveStoredMods(modsByPreset);
    },
  } satisfies Partial<VizState>;
}
