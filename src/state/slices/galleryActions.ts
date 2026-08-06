import {
  entryGate,
  fetchEntryContent,
  fetchEntryPreview,
  fetchRegistry,
  GalleryError,
} from "../gallery";
import { parseTheme, ThemeParseError } from "../themes";
import { parseUserPreset, saveUserPresets, UserPresetParseError } from "../userPresets";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";

/** How long the theme card says "Applied ✓" before reverting (A1). */
const APPLIED_FLASH_MS = 2500;
let appliedTimer: ReturnType<typeof setTimeout> | undefined;

export function galleryActions(set: SetFn, get: GetFn, ctx: SliceCtx) {
  return {
    setShowGallery(v, filter) {
      // A3: deep links open the dialog pre-filtered; a plain open starts at
      // All (the dialog reads galleryOpenFilter once, on mount).
      set(v ? { showGallery: true, galleryOpenFilter: filter ?? "all" } : { showGallery: false });
      // Opening the dialog IS the explicit user action that loads the
      // registry — but only the first time; a reopen shows what's there.
      if (v && get().galleryStatus === "idle") void get().openGallery();
    },

    async openGallery() {
      if (get().galleryStatus === "loading") return;
      // A refresh replaces the whole entry set — the old verified previews'
      // blob URLs die with it or they leak for the session.
      for (const url of Object.values(get().galleryPreviews)) URL.revokeObjectURL(url);
      set({
        galleryStatus: "loading",
        galleryError: null,
        galleryEntries: [],
        galleryPreviews: {},
      });
      let entries;
      try {
        entries = await fetchRegistry();
      } catch (e) {
        set({
          galleryStatus: "error",
          galleryError: e instanceof GalleryError ? e.message : (e as Error).message,
        });
        return;
      }
      set({ galleryStatus: "ready", galleryEntries: entries });
      // Previews trail in one by one, each hash-verified before it may
      // render. A failed preview is non-fatal — the card shows without an
      // image. Bail out if another refresh replaced the entry set meanwhile.
      for (const entry of entries) {
        let url: string | null;
        try {
          url = await fetchEntryPreview(entry);
        } catch {
          continue;
        }
        if (url === null) continue;
        if (get().galleryEntries !== entries) {
          URL.revokeObjectURL(url);
          return;
        }
        set({ galleryPreviews: { ...get().galleryPreviews, [entry.id]: url } });
      }
    },

    async installGalleryEntry(id) {
      const entry = get().galleryEntries.find((e) => e.id === id);
      if (!entry || get().galleryBusy !== null) return;
      // A1: an installed look that still exists is DONE — the card's button is
      // disabled, and this guard backs it so a stray double-activation can
      // never stack a duplicate into My Looks (the owner-repro bug).
      const installedId = get().galleryInstalled[id];
      if (
        entry.type === "look" &&
        installedId !== undefined &&
        get().userPresets.some((p) => p.id === installedId)
      ) {
        return;
      }
      const gate = entryGate(entry);
      if (gate !== null) {
        set({ error: gate });
        return;
      }
      set({ galleryBusy: id });
      try {
        // fetchEntryContent enforces host allowlist, exact size and SHA-256
        // BEFORE this text exists; the parsers below are the same validators
        // the drag-import paths run. Nothing persists until they pass.
        const text = await fetchEntryContent(entry);
        if (entry.type === "look") {
          const preset = parseUserPreset(text);
          const userPresets = [preset, ...get().userPresets];
          set({ userPresets });
          saveUserPresets(userPresets);
          get().applyUserPreset(preset.id);
          // Record WHICH user preset this install created: "✓ Added" is only
          // honest while that preset survives, so the dialog checks the id
          // against userPresets — deleting the look reverts the button (A1).
          set({ galleryInstalled: { ...get().galleryInstalled, [id]: preset.id } });
          ctx.flashNotice(`"${entry.name}" by ${entry.author.name} added to My Looks`);
        } else {
          const { document } = parseTheme(text);
          get().applyTheme(document, entry.name);
          // Transient confirmation only — a theme is re-appliable by design
          // (New Project made a persistent "Added" an obvious lie).
          set({ galleryApplied: id });
          clearTimeout(appliedTimer);
          appliedTimer = setTimeout(() => {
            if (get().galleryApplied === id) set({ galleryApplied: null });
          }, APPLIED_FLASH_MS);
          ctx.flashNotice(`"${entry.name}" by ${entry.author.name} applied`);
        }
      } catch (e) {
        const msg =
          e instanceof GalleryError ||
          e instanceof UserPresetParseError ||
          e instanceof ThemeParseError
            ? e.message
            : (e as Error).message;
        set({ error: `Could not install "${entry.name}": ${msg}` });
      } finally {
        set({ galleryBusy: null });
      }
    },
  } satisfies Partial<VizState>;
}
