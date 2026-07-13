import type { SyncSettings } from "../audio/types";
import type { BgSettings, ParamValues } from "../render/types";
import { BG_PRESET } from "../render/types";
import type { OverlayAsset, OverlayLayer } from "../render/overlay";
import { validAspect, validAssets, validLayers, type Aspect } from "./project";
import { validModsByPreset, type ModRoute } from "./modMatrix";
import { validTimeline, type Timeline } from "./timeline";

/**
 * localStorage persistence for the current session. Keys and formats are the
 * pre-store ones, so existing installs keep their settings. This layer gets
 * superseded by project files (.avproj); it will remain as the "last session"
 * cache.
 */
const LS_PRESET = "viz.activePreset";
const LS_PARAMS = "viz.params.v1";
const LS_BG = "viz.bg.v1";
const LS_VOLUME = "viz.volume";
const LS_SYNC = "viz.sync.v1";
const LS_PANEL = "viz.panelOpen";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function loadStoredPresetId(): string | null {
  return localStorage.getItem(LS_PRESET);
}

export function saveStoredPresetId(id: string): void {
  localStorage.setItem(LS_PRESET, id);
}

export function loadStoredParams(): Record<string, ParamValues> {
  return readJson(LS_PARAMS, {});
}

export function saveStoredParams(params: Record<string, ParamValues>): void {
  localStorage.setItem(LS_PARAMS, JSON.stringify(params));
}

export function loadStoredSync(): Record<string, SyncSettings> {
  return readJson(LS_SYNC, {});
}

export function saveStoredSync(sync: Record<string, SyncSettings>): void {
  localStorage.setItem(LS_SYNC, JSON.stringify(sync));
}

export function loadStoredBg(): BgSettings {
  const raw = readJson<BgSettings | null>(LS_BG, null);
  if (raw && typeof raw.mode === "number" && Array.isArray(raw.color)) return raw;
  return { mode: BG_PRESET, color: [0, 0, 0] };
}

export function saveStoredBg(bg: BgSettings): void {
  localStorage.setItem(LS_BG, JSON.stringify(bg));
}

export function loadStoredVolume(): number {
  const raw = localStorage.getItem(LS_VOLUME);
  const v = Number(raw);
  return raw !== null && Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1;
}

export function saveStoredVolume(v: number): void {
  localStorage.setItem(LS_VOLUME, String(v));
}

const LS_OVERLAY = "viz.overlay.v1";

export interface StoredOverlay {
  layers: OverlayLayer[];
  assets: Record<string, OverlayAsset>;
}

export function loadStoredOverlay(): StoredOverlay {
  const raw = readJson<{ layers?: unknown; assets?: unknown } | null>(LS_OVERLAY, null);
  const assets = validAssets(raw?.assets);
  return { layers: validLayers(raw?.layers, assets), assets };
}

export function saveStoredOverlay(
  layers: OverlayLayer[],
  assets: Record<string, OverlayAsset>,
): void {
  localStorage.setItem(LS_OVERLAY, JSON.stringify({ layers, assets }));
}

const LS_ASPECT = "viz.aspect.v1";
const LS_MODS = "viz.mods.v1";
const LS_TIMELINE = "viz.timeline.v1";

export function loadStoredTimeline(): Timeline {
  return validTimeline(readJson(LS_TIMELINE, null));
}

export function saveStoredTimeline(timeline: Timeline): void {
  localStorage.setItem(LS_TIMELINE, JSON.stringify(timeline));
}

export function loadStoredMods(): Record<string, ModRoute[]> {
  return validModsByPreset(readJson(LS_MODS, {}));
}

export function saveStoredMods(mods: Record<string, ModRoute[]>): void {
  localStorage.setItem(LS_MODS, JSON.stringify(mods));
}

export function loadStoredAspect(): Aspect {
  return validAspect(localStorage.getItem(LS_ASPECT));
}

export function saveStoredAspect(aspect: Aspect): void {
  localStorage.setItem(LS_ASPECT, aspect);
}

export function loadStoredPanelOpen(): boolean {
  return localStorage.getItem(LS_PANEL) === "1";
}

export function saveStoredPanelOpen(open: boolean): void {
  localStorage.setItem(LS_PANEL, open ? "1" : "0");
}
