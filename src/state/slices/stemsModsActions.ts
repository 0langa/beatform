import { pcmFromAudioBuffer } from "../../audio/offlineSource";
import { decodeAudioLenient } from "../../audio/decodeLenient";
import { analyzeStem, MAX_STEMS, STEM_SLOTS } from "../../audio/stems";
import { allParams } from "../../render/types";
import { presetById } from "../../render/presets";
import { newRouteId, type ModRoute, type ModSource } from "../modMatrix";
import { saveStoredMods } from "../persistence";
import { getEngine } from "../services";
import { stemRoutesFor } from "../stemRouting";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";
import { shared } from "./shared";

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

    addModRoute(source: ModSource, param: string) {
      ctx.record("mod-add");
      const s = get();
      const route: ModRoute = { id: newRouteId(), source, param, amount: 0.5 };
      const activeMods = [...s.activeMods, route];
      const modsByPreset = { ...s.modsByPreset, [s.presetId]: activeMods };
      set({ activeMods, modsByPreset });
      saveStoredMods(modsByPreset);
    },

    updateModRoute(id, patch) {
      ctx.record(`mod:${id}:${Object.keys(patch).join(",")}`);
      const s = get();
      const activeMods = s.activeMods.map((r) => (r.id === id ? { ...r, ...patch } : r));
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
  } satisfies Partial<VizState>;
}
