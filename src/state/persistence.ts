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
import { DEFAULT_LYRIC_STYLE, isLyricAnim, type LyricStyle } from "./lyrics";
import { DEFAULT_AUDIOGRAM, type AudiogramSettings } from "./audiogram";
import { isQuantizeMode, type QuantizeMode } from "./quantize";
import { validMidiBindings, type MidiBinding } from "./midi";

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

/**
 * Trailing-debounced writes for the settings that change on a slider drag
 * (params/post/motion/sync/mods). setParam is wired straight to the slider, so
 * a drag would otherwise run JSON.stringify + a synchronous localStorage write
 * dozens of times a second on the same thread as the 60fps render loop. We
 * coalesce to one write per key ~200ms after the last change, and flush on tab
 * hide so the final edit is never lost. On desktop the autosave .avproj is the
 * crash-recovery copy (it also survives the localStorage quota, which multi-MB
 * image/video assets can exceed); this cache is just "last session".
 */
const pendingWrites = new Map<string, () => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingWrites(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  runPendingWrites();
}

/**
 * Run every queued write, isolating failures. A QuotaExceededError thrown by
 * one writer used to escape the loop, which skipped `pendingWrites.clear()` —
 * so the failing key retried forever AND every write queued behind it (post,
 * motion, mods, sync) was silently never persisted. Each write now fails on
 * its own; the queue always drains.
 */
function runPendingWrites(): void {
  for (const [key, write] of pendingWrites) {
    try {
      write();
    } catch (e) {
      // Storage full or blocked: this setting stays session-only rather than
      // poisoning everyone else's persistence.
      console.warn(`[persistence] write failed for ${key}`, e);
    }
  }
  pendingWrites.clear();
}

function scheduleWrite(key: string, write: () => void): void {
  pendingWrites.set(key, write); // latest value per key wins
  if (flushTimer === null) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      runPendingWrites();
    }, 200);
  }
}

/**
 * Clean-exit marker, used to decide whether the autosave on disk represents a
 * CRASH (offer recovery) or an ordinary quit (say nothing). Set to "0" the
 * moment the document changes and back to "1" only on `pagehide` — a hard kill
 * or a power loss never runs that handler, so the "0" survives to the next
 * boot. localStorage writes are synchronous, so the marker is durable the
 * instant it is set.
 *
 * Deliberately NOT flipped on `visibilitychange`: minimizing the window is not
 * an exit, and treating it as one would hide a genuine crash.
 */
const LS_CLEAN_EXIT = "viz.cleanExit";

/**
 * Captured ONCE at module load, before any of this session's own writes. The
 * boot sequence dirties the marker almost immediately (applyDocument →
 * scheduleAutosave), so reading it later would always say "clean".
 */
const previousExitWasClean = (() => {
  try {
    // A first-ever launch has no marker and no autosave file either, so
    // treating "missing" as clean costs nothing and avoids a spurious prompt.
    return localStorage.getItem(LS_CLEAN_EXIT) !== "0";
  } catch {
    return true;
  }
})();

export function wasPreviousExitClean(): boolean {
  return previousExitWasClean;
}

export function markSessionDirty(): void {
  try {
    localStorage.setItem(LS_CLEAN_EXIT, "0");
  } catch {
    // Storage full/blocked: recovery just degrades to "never offered".
  }
}

function markCleanExit(): void {
  try {
    localStorage.setItem(LS_CLEAN_EXIT, "1");
  } catch {
    // See above.
  }
}

if (typeof window !== "undefined") {
  // A closing/backgrounded tab must not drop the last debounced edit.
  window.addEventListener("pagehide", () => {
    flushPendingWrites();
    markCleanExit();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPendingWrites();
  });
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
  scheduleWrite(LS_PARAMS, () => localStorage.setItem(LS_PARAMS, JSON.stringify(params)));
}

export function loadStoredSync(): Record<string, SyncSettings> {
  return validSyncByPreset(readJson(LS_SYNC, {}));
}

export function saveStoredSync(sync: Record<string, SyncSettings>): void {
  scheduleWrite(LS_SYNC, () => localStorage.setItem(LS_SYNC, JSON.stringify(sync)));
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
): boolean {
  // Best-effort: image assets are multi-MB data URLs and can blow the
  // localStorage quota. A failed persist must not throw out of the store
  // action — the layer would exist in state but never draw (the trailing
  // refreshOverlay() call would be skipped). Callers that persist REFERENCES
  // to these assets (the image background) must check the return value: a
  // reference saved against an asset that wasn't boots into a black bg.
  try {
    localStorage.setItem(LS_OVERLAY, JSON.stringify({ layers, assets }));
    return true;
  } catch (e) {
    console.warn("[persist] overlay too large for localStorage; session-only", e);
    return false;
  }
}

const LS_CUSTOM_PRESETS = "viz.customPresets.v1";

/** Load user-authored WGSL presets (whitelist-validated). */
export function loadCustomPresets(): PresetDef[] {
  const raw = readJson<unknown>(LS_CUSTOM_PRESETS, null);
  if (!Array.isArray(raw)) return [];
  return raw.map(validCustomPreset).filter((d): d is PresetDef => d !== null);
}

export function saveCustomPresets(defs: PresetDef[]): boolean {
  try {
    localStorage.setItem(LS_CUSTOM_PRESETS, JSON.stringify(defs));
    return true;
  } catch (e) {
    console.warn("[persist] custom presets too large for localStorage", e);
    return false;
  }
}

const LS_LYRIC_STYLE = "viz.lyricStyle.v1";

export function loadStoredLyricStyle(): LyricStyle {
  const raw = readJson<Partial<LyricStyle> | null>(LS_LYRIC_STYLE, null);
  const d = DEFAULT_LYRIC_STYLE;
  if (typeof raw !== "object" || raw === null) return { ...d };
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : d.enabled,
    position: raw.position === "center" || raw.position === "top" ? raw.position : d.position,
    size:
      typeof raw.size === "number" && Number.isFinite(raw.size)
        ? Math.min(2, Math.max(0.5, raw.size))
        : d.size,
    color:
      typeof raw.color === "string" && /^#[0-9a-f]{3,8}$/i.test(raw.color) ? raw.color : d.color,
    fadeSec:
      typeof raw.fadeSec === "number" && Number.isFinite(raw.fadeSec)
        ? Math.min(1, Math.max(0, raw.fadeSec))
        : d.fadeSec,
    anim: isLyricAnim(raw.anim) ? raw.anim : d.anim,
  };
}

export function saveStoredLyricStyle(style: LyricStyle): void {
  localStorage.setItem(LS_LYRIC_STYLE, JSON.stringify(style));
}

const LS_AUDIOGRAM = "viz.audiogram.v1";

export function loadStoredAudiogram(): AudiogramSettings {
  const raw = readJson<Partial<AudiogramSettings> | null>(LS_AUDIOGRAM, null);
  const d = DEFAULT_AUDIOGRAM;
  if (typeof raw !== "object" || raw === null) return { ...d };
  return {
    progressBar: typeof raw.progressBar === "boolean" ? raw.progressBar : d.progressBar,
    timeReadout: typeof raw.timeReadout === "boolean" ? raw.timeReadout : d.timeReadout,
    waveformStrip: typeof raw.waveformStrip === "boolean" ? raw.waveformStrip : d.waveformStrip,
    position: raw.position === "top" ? "top" : d.position,
    color:
      typeof raw.color === "string" && /^#[0-9a-f]{3,8}$/i.test(raw.color) ? raw.color : d.color,
  };
}

export function saveStoredAudiogram(a: AudiogramSettings): void {
  localStorage.setItem(LS_AUDIOGRAM, JSON.stringify(a));
}

const LS_ASPECT = "viz.aspect.v1";
const LS_POST = "viz.post.v1";

export function loadStoredPost(): PostSettings {
  return validPost(readJson(LS_POST, null));
}

export function saveStoredPost(post: PostSettings): void {
  scheduleWrite(LS_POST, () => localStorage.setItem(LS_POST, JSON.stringify(post)));
}
const LS_MOTION = "viz.motion.v1";

export function loadStoredMotion(): MotionSettings {
  return validMotion(readJson(LS_MOTION, null));
}

export function saveStoredMotion(motion: MotionSettings): void {
  scheduleWrite(LS_MOTION, () => localStorage.setItem(LS_MOTION, JSON.stringify(motion)));
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
  scheduleWrite(LS_MODS, () => localStorage.setItem(LS_MODS, JSON.stringify(mods)));
}

export function loadStoredAspect(): Aspect {
  return validAspect(localStorage.getItem(LS_ASPECT));
}

export function saveStoredAspect(aspect: Aspect): void {
  localStorage.setItem(LS_ASPECT, aspect);
}

const LS_MIDI = "viz.midiBindings.v1";

export function loadStoredMidiBindings(): MidiBinding[] {
  return validMidiBindings(readJson<unknown>(LS_MIDI, null));
}

export function saveStoredMidiBindings(bindings: MidiBinding[]): void {
  localStorage.setItem(LS_MIDI, JSON.stringify(bindings));
}

const LS_QUANTIZE = "viz.switchQuantize.v1";

export function loadStoredQuantize(): QuantizeMode {
  const v = localStorage.getItem(LS_QUANTIZE);
  return isQuantizeMode(v) ? v : "off";
}

export function saveStoredQuantize(mode: QuantizeMode): void {
  localStorage.setItem(LS_QUANTIZE, mode);
}

export function loadStoredPanelOpen(): boolean {
  return localStorage.getItem(LS_PANEL) === "1";
}

export function saveStoredPanelOpen(open: boolean): void {
  localStorage.setItem(LS_PANEL, open ? "1" : "0");
}
