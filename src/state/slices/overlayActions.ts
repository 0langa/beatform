import {
  defaultImageLayer,
  defaultTextLayer,
  pruneBitmapCache,
  type OverlayAsset,
  type OverlayLayer,
} from "../../render/overlay";
import { openImageFile } from "../platform";
import { saveStoredOverlay } from "../persistence";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";

export function overlayActions(set: SetFn, get: GetFn, ctx: SliceCtx) {
  return {
    addTextLayer() {
      ctx.record("layer-add");
      const overlayLayers = [...get().overlayLayers, defaultTextLayer()];
      set({ overlayLayers });
      saveStoredOverlay(overlayLayers, get().assets);
      get().refreshOverlay();
    },

    async addImageLayer() {
      try {
        const picked = await openImageFile();
        if (!picked) return;
        ctx.record("layer-add");
        const asset: OverlayAsset = {
          id: `as-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          name: picked.name,
          dataUrl: picked.dataUrl,
        };
        const assets = { ...get().assets, [asset.id]: asset };
        const overlayLayers = [...get().overlayLayers, defaultImageLayer(asset.id)];
        set({ assets, overlayLayers });
        saveStoredOverlay(overlayLayers, assets);
        get().refreshOverlay();
      } catch (e) {
        set({ error: `Could not add image: ${(e as Error).message}` });
      }
    },

    addAlbumArtLayer() {
      const cover = get().coverArt;
      if (!cover) {
        // Validate BEFORE recording: a junk history entry whose undo visibly
        // does nothing ("Undone" flashes, nothing changes) erodes trust.
        set({ error: "The loaded track has no embedded cover art" });
        return;
      }
      ctx.record("layer-add");
      const asset: OverlayAsset = {
        id: `as-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: "Album art",
        dataUrl: cover,
      };
      const assets = { ...get().assets, [asset.id]: asset };
      const layer = { ...defaultImageLayer(asset.id), anchor: "cc" as const, size: 0.4 };
      const overlayLayers = [...get().overlayLayers, layer];
      set({ assets, overlayLayers });
      saveStoredOverlay(overlayLayers, assets);
      get().refreshOverlay();
    },

    updateOverlayLayer(id, patch) {
      ctx.record(`layer:${id}:${Object.keys(patch).join(",")}`);
      const overlayLayers = get().overlayLayers.map((l) =>
        l.id === id ? ({ ...l, ...patch } as OverlayLayer) : l,
      );
      set({ overlayLayers });
      saveStoredOverlay(overlayLayers, get().assets);
      get().refreshOverlay();
    },

    removeOverlayLayer(id) {
      ctx.record("layer-remove");
      const removed = get().overlayLayers.find((l) => l.id === id);
      const overlayLayers = get().overlayLayers.filter((l) => l.id !== id);
      // Drop the asset too if no other layer references it
      let assets = get().assets;
      if (removed?.type === "image") {
        const stillUsed = overlayLayers.some(
          (l) => l.type === "image" && l.assetId === removed.assetId,
        );
        if (!stillUsed) {
          assets = { ...assets };
          delete assets[removed.assetId];
          pruneBitmapCache(new Set(Object.keys(assets)));
        }
      }
      set({ overlayLayers, assets });
      saveStoredOverlay(overlayLayers, assets);
      get().refreshOverlay();
    },
  } satisfies Partial<VizState>;
}
