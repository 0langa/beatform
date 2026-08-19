import { isTauri } from "../platform";
import { getPrefs, setPrefs } from "../prefs";
import { publishPerformLive } from "../performBridge";
import { selectEffectiveBg } from "../selectors";
import { BG_IMAGE, BG_VIDEO } from "../../render/types";
import type { OverlayAsset } from "../../render/overlay";
import type { PerformAssetsMsg, PerformLiveMsg, PerformSceneMsg } from "../performBridge";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";

/**
 * FEAT-009 — operator-side actions for the performance window: open/close/
 * re-place the Rust-owned second window, enumerate monitors for the
 * drawer's picker, and the output-HUD toggle. The mirror DATA path lives in
 * performBridge.ts + the store-bottom subscription (store.ts); these
 * actions only manage lifecycle and preferences.
 */

/** Mirror of the Rust `PerformMonitor` payload (perform_window.rs). */
export interface PerformMonitorInfo {
  index: number;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
  primary: boolean;
}

/** A monitor's picker label: position-independent, human-sized. */
export function monitorLabel(m: PerformMonitorInfo): string {
  const size = `${m.width}×${m.height}`;
  return `Display ${m.index + 1} — ${size}${m.primary ? " (primary)" : ""}`;
}

// ---------------------------------------------------------------------
// The three state-tier builders the publisher serves (performBridge's
// providers). Pure functions of the store state (+ prefs for the HUD flag),
// exported for direct unit testing.
// ---------------------------------------------------------------------

export function buildPerformLive(s: VizState): Omit<PerformLiveMsg, "type"> {
  return {
    blackout: s.blackout,
    hud: getPrefs().performHud,
    aspect: s.aspect,
    motion: s.motion,
    smoothSpectrum: s.smoothSpectrum,
  };
}

export function buildPerformScene(s: VizState): Omit<PerformSceneMsg, "type"> {
  const bg = selectEffectiveBg(s);
  return {
    customDefs: s.customDefs,
    builderStack: s.builderStack,
    bgImageParams:
      bg.mode === BG_IMAGE && bg.image ? { blur: bg.image.blur, dim: bg.image.dim } : null,
    bgVideoParams:
      bg.mode === BG_VIDEO && bg.video ? { blur: bg.video.blur, dim: bg.video.dim } : null,
    overlay: { layers: s.overlayLayers, meta: s.trackMeta },
    lyrics: s.lyrics ? { lines: s.lyrics, style: s.lyricStyle } : null,
    audiogram: s.audiogram,
    waveformOverview: s.waveformOverview,
  };
}

export function buildPerformAssets(s: VizState): Omit<PerformAssetsMsg, "type"> {
  const bg = selectEffectiveBg(s);
  const overlayAssets: Record<string, OverlayAsset> = {};
  for (const l of s.overlayLayers) {
    if (l.type === "image") {
      const a = s.assets[l.assetId];
      if (a) overlayAssets[l.assetId] = a;
    }
  }
  // Same resolution rule as the primary's applyCoverArt: a per-mode center
  // image override wins over the track's embedded art.
  const overrideId = s.centerImageByPreset[s.presetId];
  return {
    coverUrl: (overrideId ? s.assets[overrideId]?.dataUrl : undefined) ?? s.coverArt,
    bgImageUrl:
      bg.mode === BG_IMAGE && bg.image ? (s.assets[bg.image.assetId]?.dataUrl ?? null) : null,
    bgVideoUrl:
      bg.mode === BG_VIDEO && bg.video ? (s.assets[bg.video.assetId]?.dataUrl ?? null) : null,
    overlayAssets,
  };
}

/** Change signatures for the store-bottom diff subscription — one array per
 * tier; a tier republishes when any slot differs (===). Slots are the
 * IDENTITIES the corresponding builder reads, so the two cannot drift
 * without a test catching the builder change. */
export function performLiveSig(s: VizState): unknown[] {
  return [s.blackout, getPrefs().performHud, s.aspect, s.motion, s.smoothSpectrum];
}

export function performSceneSig(s: VizState): unknown[] {
  return [
    s.customDefs,
    s.builderStack,
    selectEffectiveBg(s),
    s.overlayLayers,
    s.trackMeta,
    s.lyrics,
    s.lyricStyle,
    s.audiogram,
    s.waveformOverview,
  ];
}

export function performAssetsSig(s: VizState): unknown[] {
  const bg = selectEffectiveBg(s);
  const overrideId = s.centerImageByPreset[s.presetId];
  let imageLayerIds = "";
  for (const l of s.overlayLayers) if (l.type === "image") imageLayerIds += `${l.assetId},`;
  return [
    (overrideId ? s.assets[overrideId]?.dataUrl : undefined) ?? s.coverArt,
    bg.mode === BG_IMAGE && bg.image ? (s.assets[bg.image.assetId]?.dataUrl ?? null) : null,
    bg.mode === BG_VIDEO && bg.video ? (s.assets[bg.video.assetId]?.dataUrl ?? null) : null,
    imageLayerIds,
    s.assets,
  ];
}

export function sameSig(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function invokePerform<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Double-open dedupe (review F3): a queued double-click (or D + drawer
 * button) fires openPerformWindow twice before the first invoke settles.
 * The Rust side tolerates the duplicate-label race too (perform_open adopts
 * the winner's window); this guard just stops the second IPC round-trip
 * from ever leaving. Module state, same idiom as galleryActions' timers. */
let openInFlight = false;

export function performActions(set: SetFn, get: GetFn, _ctx: SliceCtx) {
  return {
    setShowPerform(v: boolean) {
      set({ showPerform: v });
      // The picker re-enumerates on every drawer open — that re-query plus
      // the Rust-side clamp at open time IS the monitor-hotplug story.
      if (v) void get().refreshPerformMonitors();
    },

    async refreshPerformMonitors() {
      if (!isTauri()) return;
      try {
        const monitors = await invokePerform<PerformMonitorInfo[]>("perform_monitors");
        set({ performMonitors: monitors });
        // A stored index past the current monitor count means the setup
        // shrank since it was saved — surface "Auto" rather than a lie.
        if ((getPrefs().performMonitor ?? 0) >= monitors.length) {
          setPrefs({ performMonitor: null });
        }
      } catch (e) {
        console.warn("[perform] monitor enumeration failed", e);
        set({ performMonitors: [] });
      }
    },

    async openPerformWindow() {
      if (!isTauri()) {
        set({
          error:
            "The performance window needs the desktop app — in the browser build, open a second tab at /?perform=1 instead.",
        });
        return;
      }
      if (openInFlight) return;
      openInFlight = true;
      try {
        const prefs = getPrefs();
        await invokePerform("perform_open", {
          monitor: prefs.performMonitor,
          fullscreen: prefs.performFullscreen,
        });
        // performOpen flips via the `perform:opened` lifecycle event
        // (initApp's listener) — the Rust window is the source of truth.
      } catch (e) {
        set({ error: `Could not open the performance window: ${String(e)}` });
      } finally {
        openInFlight = false;
      }
    },

    async closePerformWindow() {
      if (!isTauri()) return;
      try {
        await invokePerform("perform_close");
      } catch (e) {
        console.warn("[perform] close failed", e);
      }
    },

    async setPerformFullscreen(v: boolean) {
      setPrefs({ performFullscreen: v });
      if (!isTauri() || !get().performOpen) return;
      try {
        await invokePerform("perform_set_fullscreen", { fullscreen: v });
      } catch (e) {
        console.warn("[perform] fullscreen change failed", e);
      }
    },

    async setPerformMonitor(index: number | null) {
      setPrefs({ performMonitor: index });
      if (!isTauri() || !get().performOpen) return;
      // Re-place the open window: perform_open is idempotent and moves it.
      try {
        await invokePerform("perform_open", {
          monitor: index,
          fullscreen: getPrefs().performFullscreen,
        });
      } catch (e) {
        set({ error: `Could not move the performance window: ${String(e)}` });
      }
    },

    setPerformHud(v: boolean) {
      // Prefs, not document state — an output-HUD taste is a property of
      // the rig, and nothing here may touch the project schema. The store
      // subscription cannot see a prefs write, so publish explicitly; the
      // drawer re-renders through its own prefs subscription.
      setPrefs({ performHud: v });
      publishPerformLive();
    },
  };
}
