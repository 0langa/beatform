import type { SyncSettings } from "../audio/types";
import type { BgSettings, ParamValues } from "../render/types";
import type { OverlayAsset, OverlayLayer } from "../render/overlay";
import {
  validAspect,
  validAssets,
  validBg,
  validLayers,
  validParamsByPreset,
  validSyncByPreset,
  type Aspect,
} from "./project";
import { validModsByPreset, type ModRoute } from "./modMatrix";
import { validPost, validMotion } from "./project";
import type { MotionSettings, PostSettings, PresetDef } from "../render/types";
import { validCustomPreset } from "../render/presets/custom";
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
  // Validate like the .avproj path: a corrupt/format-shifted cache must not
  // put a non-finite value into a Float32 uniform (NaN corrupts the visual).
  return validParamsByPreset(readJson(LS_PARAMS, {}));
}

export function saveStoredParams(params: Record<string, ParamValues>): void {
  localStorage.setItem(LS_PARAMS, JSON.stringify(params));
}

export function loadStoredSync(): Record<string, SyncSettings> {
  return validSyncByPreset(readJson(LS_SYNC, {}));
}

export function saveStoredSync(sync: Record<string, SyncSettings>): void {
  localStorage.setItem(LS_SYNC, JSON.stringify(sync));
}

export function loadStoredBg(): BgSettings {
  // validBg checks color length/finiteness and clamps — a length-1 or
  // string-element cached color would otherwise write NaN into the uniform.
  return validBg(readJson<unknown>(LS_BG, null));
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
  // Best-effort: image assets are multi-MB data URLs and can blow the
  // localStorage quota. A failed persist must not throw out of the store
  // action — the layer would exist in state but never draw (the trailing
  // refreshOverlay() call would be skipped).
  try {
    localStorage.setItem(LS_OVERLAY, JSON.stringify({ layers, assets }));
  } catch (e) {
    console.warn("[persist] overlay too large for localStorage; session-only", e);
  }
}

const LS_CUSTOM_PRESETS = "viz.customPresets.v1";

/** Load user-authored WGSL presets (whitelist-validated). */
export function loadCustomPresets(): PresetDef[] {
  const raw = readJson<unknown>(LS_CUSTOM_PRESETS, null);
  if (!Array.isArray(raw)) return [];
  return raw.map(validCustomPreset).filter((d): d is PresetDef => d !== null);
}

export function saveCustomPresets(defs: PresetDef[]): void {
  try {
    localStorage.setItem(LS_CUSTOM_PRESETS, JSON.stringify(defs));
  } catch (e) {
    console.warn("[persist] custom presets too large for localStorage", e);
  }
}

const LS_ASPECT = "viz.aspect.v1";
const LS_POST = "viz.post.v1";

export function loadStoredPost(): PostSettings {
  return validPost(readJson(LS_POST, null));
}

export function saveStoredPost(post: PostSettings): void {
  localStorage.setItem(LS_POST, JSON.stringify(post));
}
const LS_MOTION = "viz.motion.v1";

export function loadStoredMotion(): MotionSettings {
  return validMotion(readJson(LS_MOTION, null));
}

export function saveStoredMotion(motion: MotionSettings): void {
  localStorage.setItem(LS_MOTION, JSON.stringify(motion));
}
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
