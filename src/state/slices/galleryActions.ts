import {
  entryGate,
  fetchEntryContent,
  fetchEntryPreview,
  fetchRegistry,
  GalleryError,
  installedLookState,
  validGalleryInstalled,
  type GalleryInstallRecord,
} from "../gallery";
import { FACTORY_GALLERY_ENTRIES } from "../factoryThemes";
import { safeSetItem } from "../persistence";
import { parseTheme, ThemeParseError } from "../themes";
import {
  parseUserPreset,
  saveUserPresets,
  UserPresetParseError,
  type UserPreset,
} from "../userPresets";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";

/**
 * HD-13: the gallery install record (entry id -> which preset the install
 * created, and the registry digest of what was installed) is persisted as a
 * sibling of `viz.userPresets.v1`. It has to survive a restart to be worth
 * anything: an upstream update arrives days later, not in the session that
 * installed the look — and without it the Gallery forgot every install on
 * relaunch, so "+ Add look" happily stacked a second copy into My Looks.
 * Validated at boot like the looks list (see validGalleryInstalled). Never
 * pruned on delete: a record whose preset is gone reads as `absent` anyway
 * and is overwritten by the next install of that entry.
 */
const LS_GALLERY_INSTALLED = "viz.galleryInstalled.v1";

export function loadGalleryInstalled(): Record<string, GalleryInstallRecord> {
  try {
    return validGalleryInstalled(JSON.parse(localStorage.getItem(LS_GALLERY_INSTALLED) ?? "{}"));
  } catch {
    return {};
  }
}

function saveGalleryInstalled(map: Record<string, GalleryInstallRecord>): void {
  safeSetItem(LS_GALLERY_INSTALLED, JSON.stringify(map));
}

/** How long the theme card says "Applied ✓" before reverting (A1). */
const APPLIED_FLASH_MS = 2500;
let appliedTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * P-6 review Important 1: GalleryDialog deliberately exempts a built-in
 * Apply from the "one remote install at a time" busy lock (`galleryBusy`) —
 * a built-in never fetches, so there is nothing in flight to guard against
 * (see that file's own comment on `disabled`). That means a slow REMOTE
 * install can still be awaiting its download/verify when the user clicks a
 * built-in's Apply — and the remote branch used to call
 * applyTheme/applyUserPreset unconditionally once it finished, with no way
 * to know a later, more deliberate action had already superseded it.
 *
 * This is a monotonic "latest user action" claim, bumped by EVERY
 * apply-triggering action: a built-in Apply (synchronous, bumps then
 * applies immediately) and the START of a remote install (bumps and
 * captures its own value into `myToken` before the `await` below). The
 * remote branch compares its captured value against the CURRENT one right
 * before its own final apply — if anything bumped the token in between,
 * this install lost the race and must not apply. Module-scoped like
 * `appliedTimer` above: pure internal bookkeeping, not something any UI
 * reads.
 */
let latestUserActionToken = 0;

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
      // P-6: a built-in never fetches, so it skips every step below that
      // exists to make a REMOTE download safe (size cap, SHA-256, the
      // `galleryBusy` "one install at a time" guard) — there is nothing in
      // flight to guard against. Checked first so an id that somehow
      // collided with a remote entry's would resolve to the offline,
      // always-available copy rather than start a network fetch the user
      // did not expect from what reads as a bundled card.
      const builtin = FACTORY_GALLERY_ENTRIES.find((e) => e.id === id);
      if (builtin) {
        // P-6 review Important 1: claim the token BEFORE applying — this is
        // itself a "latest user action" that must be able to invalidate a
        // remote install already in flight (see the remote branch below).
        latestUserActionToken++;
        get().applyTheme(builtin.document, builtin.name);
        // Transient confirmation only, exactly like a remote theme (A1) —
        // and NOT galleryInstalled: that map exists so a LOOK's "✓ Added"
        // can track whether the user preset its install created still
        // exists. A built-in creates nothing to track; applying is
        // idempotent and repeatable, so it gets the same galleryApplied
        // flash a remote theme gets and never touches galleryInstalled.
        set({ galleryApplied: id });
        clearTimeout(appliedTimer);
        appliedTimer = setTimeout(() => {
          if (get().galleryApplied === id) set({ galleryApplied: null });
        }, APPLIED_FLASH_MS);
        ctx.flashNotice(`"${builtin.name}" applied`);
        return;
      }
      const entry = get().galleryEntries.find((e) => e.id === id);
      if (!entry || get().galleryBusy !== null) return;
      // A1 + HD-13: an installed look whose content the registry still
      // carries is DONE — the card's button is disabled, and this guard backs
      // it so a stray double-activation can never stack a duplicate into My
      // Looks (the owner-repro bug). An OUTDATED one (registry digest moved
      // since the install) falls through: its install REPLACES the old copy
      // below instead of adding a second one.
      if (installedLookState(entry, get().galleryInstalled, get().userPresets) === "current") {
        return;
      }
      const gate = entryGate(entry);
      if (gate !== null) {
        set({ error: gate });
        return;
      }
      set({ galleryBusy: id });
      // P-6 review Important 1: claim the token for the FULL duration of
      // this install, from the moment the user asked for it — not when the
      // (slow, network-bound) download eventually resolves. Compared
      // against the current value just before the final apply below.
      const myToken = ++latestUserActionToken;
      try {
        // fetchEntryContent enforces host allowlist, exact size and SHA-256
        // BEFORE this text exists; the parsers below are the same validators
        // the drag-import paths run. Nothing persists until they pass.
        const text = await fetchEntryContent(entry);
        if (entry.type === "look") {
          const fresh = parseUserPreset(text);
          // HD-13: re-read AFTER the await — the user may have deleted the
          // look while this downloaded. If the copy this entry created is
          // still in My Looks, install OVER it: same id, same slot, so the
          // look stays where it was and anything holding its id (the active
          // look, its chip) follows the new content. Otherwise the content
          // lands as a fresh copy, exactly as a first install does.
          const prior = get().galleryInstalled[id];
          const replaceId =
            prior !== undefined && get().userPresets.some((p) => p.id === prior.presetId)
              ? prior.presetId
              : null;
          const preset: UserPreset = replaceId === null ? fresh : { ...fresh, id: replaceId };
          const userPresets =
            replaceId === null
              ? [preset, ...get().userPresets]
              : get().userPresets.map((p) => (p.id === replaceId ? preset : p));
          set({ userPresets });
          saveUserPresets(userPresets);
          // Record WHICH user preset this install created and WHAT content
          // (the registry digest): "✓ Added" is only honest while that preset
          // survives, and "Already in My Looks" only while the registry still
          // carries this exact content — installedLookState checks both.
          // UNCONDITIONAL, even if the apply below is skipped as stale: the
          // content DID install into My Looks either way — only whether it
          // ALSO became the active look is in question.
          const galleryInstalled = {
            ...get().galleryInstalled,
            [id]: { presetId: preset.id, sha256: entry.sha256 },
          };
          set({ galleryInstalled });
          saveGalleryInstalled(galleryInstalled);
          if (myToken === latestUserActionToken) {
            get().applyUserPreset(preset.id);
            ctx.flashNotice(
              `"${entry.name}" by ${entry.author.name} ${replaceId === null ? "added to" : "updated in"} My Looks`,
            );
          } else {
            // A later action (another install, or a built-in Apply) won the
            // race while this download was in flight — the look is safely
            // in My Looks, but applying it now would silently overwrite
            // whatever the user has since deliberately switched to.
            ctx.flashNotice(`"${entry.name}" installed — kept your current look`);
          }
        } else {
          const { document } = parseTheme(text);
          if (myToken === latestUserActionToken) {
            get().applyTheme(document, entry.name);
            // Transient confirmation only — a theme is re-appliable by design
            // (New Project made a persistent "Added" an obvious lie).
            set({ galleryApplied: id });
            clearTimeout(appliedTimer);
            appliedTimer = setTimeout(() => {
              if (get().galleryApplied === id) set({ galleryApplied: null });
            }, APPLIED_FLASH_MS);
            ctx.flashNotice(`"${entry.name}" by ${entry.author.name} applied`);
          } else {
            // Same race as the look branch above — a theme has no persisted
            // "installed" record distinct from applying it, so a stale
            // result simply isn't applied; nothing to reconcile afterward.
            ctx.flashNotice(`"${entry.name}" installed — kept your current look`);
          }
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
