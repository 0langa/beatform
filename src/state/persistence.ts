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
import { validBgByPreset, validCenterImages } from "./project";
import { migratePresetIdKeys, migrateTimelinePresetIds, PROJECT_VERSION } from "./project";
import { canonicalPresetId } from "../render/presets";
import { validModsByPreset, type ModRoute } from "./modMatrix";
import { validPost, validMotion } from "./project";
import type { MotionSettings, PostSettings, PresetDef } from "../render/types";
import { validCustomPreset } from "../render/presets/custom";
import { validTimeline, type Timeline } from "./timeline";
import { validLyricStyle, type LyricStyle } from "./lyrics";
import { validAudiogram, type AudiogramSettings } from "./audiogram";
import type { QuantizeMode } from "./quantize";
import { getPrefs, setPrefs } from "./prefs";
import { defaultBuilderStack, validBuilderStack, type BuilderStack } from "../render/builder2";
import { validMidiBindings, type MidiBinding } from "./midi";
import type { ExportSettings } from "./store";

/**
 * localStorage persistence for the current session. Keys and formats are the
 * pre-store ones, so existing installs keep their settings. This layer gets
 * superseded by project files (.bfproj); it will remain as the "last session"
 * cache.
 */
const LS_PRESET = "viz.activePreset";
const LS_PARAMS = "viz.params.v1";
const LS_BG = "viz.bg.v1";
const LS_BG_BY_PRESET = "viz.bgByPreset.v1";
const LS_CENTER_IMAGES = "viz.centerImages.v1";
const LS_SYNC = "viz.sync.v1";
/** See the cachedDocSchema block below — the read/stamp pair cannot live up
 * here, because safeSetItem's failure path touches module `let`s declared
 * further down and would hit their TDZ. */
const LS_DOC_SCHEMA = "viz.docSchema.v1";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/**
 * Quota-safe write chokepoint: every localStorage.setItem in the state layer
 * goes through here. Multi-MB asset sessions leave the origin near quota,
 * where ANY small synchronous write throws QuotaExceededError — from inside a
 * store action, after set() but before the renderer re-sync that follows, so
 * state and pixels diverge and nothing surfaces (the app's only global net is
 * `unhandledrejection`, which never sees a synchronous throw). A failed write
 * degrades to session-only: console.warn per key, plus ONE throttled
 * user-facing notice so a full store is announced instead of silently eating
 * every subsequent change. The clean-exit marker (markSessionDirty /
 * markCleanExit) keeps its own silent try/catch — blocked storage at boot
 * must not greet the user with an error toast over a crash-recovery hint.
 */
let notifyWriteFailure: ((message: string) => void) | null = null;
let lastWriteFailureNoticeAt = -Infinity;
const WRITE_FAILURE_NOTICE_MS = 30_000;

/** Wire the user-facing surface for failed writes (the store's error toast).
 * Injected by the store at module init — this layer cannot import the store
 * without a cycle. */
export function setWriteFailureNotifier(fn: (message: string) => void): void {
  notifyWriteFailure = fn;
}

export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn(`[persistence] write failed for ${key}`, e);
    const now = Date.now();
    if (notifyWriteFailure && now - lastWriteFailureNoticeAt >= WRITE_FAILURE_NOTICE_MS) {
      lastWriteFailureNoticeAt = now;
      notifyWriteFailure(
        "Storage full — latest change couldn't be cached; export or save your project",
      );
    }
    return false;
  }
}

/**
 * Document-schema stamp for the session cache — INSURANCE FOR THE NEXT
 * semantics change, read by nothing in this release.
 *
 * WHAT IT MEANS, exactly: `cachedDocSchema` is the PROJECT_VERSION of the app
 * that last WROTE this cache. It is NOT a statement about the semantics of the
 * values in it, and it must never be read as one.
 *
 * `null` means UNKNOWN PROVENANCE — never migrate. v14 (the nebula-saturation
 * change) shipped in 2.75.0 with no stamp at all, so an unstamped
 * `viz.params.v1` may hold pre-v14 values (which would need /0.75) or values
 * the user has since re-tuned by hand (which must not be touched), and nothing
 * on disk separates the two: the same stored 1.0 is a pre-v14 ceiling and a
 * post-v14 neutral. Retro-migrating that cohort would turn a 21% desaturation
 * into a 33% OVERsaturation, so v14 is deliberately NOT migrated here.
 *
 * Its only legitimate use is a migration shipped in the SAME release as the
 * schema bump that needs it, reading `cachedDocSchema < N` before this
 * module's own stamp refreshes the key.
 *
 * ORDER IS THE ENTIRE POINT: the read is captured at module load, BEFORE the
 * stamp overwrites it. A future migration that reads a stamp it has already
 * overwritten is worthless. Module scope (like prefs.ts) because it must
 * complete before any applyDocument can rewrite the cache keys.
 *
 * Placed here rather than beside the other LS_ constants on purpose:
 * safeSetItem's failure path reads `notifyWriteFailure` /
 * `lastWriteFailureNoticeAt`, so calling it above their declarations would
 * throw on TDZ the first time a write failed.
 *
 * FAILURE BEHAVIOUR: safeSetItem returns false rather than throwing.
 * stampDocSchema() returns that false; no caller checks it, nothing retries,
 * nothing is gated on it, nothing throws. Since nothing READS the stamp this
 * release, a failed write cannot cause wrong behaviour — only a skipped future
 * migration on that install, which is exactly today's situation. Next boot
 * tries again.
 */
export const cachedDocSchema: number | null = (() => {
  try {
    const raw = localStorage.getItem(LS_DOC_SCHEMA);
    const n = raw === null ? NaN : Number.parseInt(raw, 10);
    return Number.isInteger(n) ? n : null;
  } catch {
    // Blocked storage reads as "unknown provenance", same as absent.
    return null;
  }
})();

export function stampDocSchema(): boolean {
  return safeSetItem(LS_DOC_SCHEMA, String(PROJECT_VERSION));
}

// ONCE, at module scope, immediately AFTER the read above — never before.
stampDocSchema();

/**
 * Trailing-debounced writes for the settings that change on a slider drag
 * (params/post/motion/sync/mods). setParam is wired straight to the slider, so
 * a drag would otherwise run JSON.stringify + a synchronous localStorage write
 * dozens of times a second on the same thread as the 60fps render loop. We
 * coalesce to one write per key ~200ms after the last change, and flush on tab
 * hide so the final edit is never lost. On desktop the autosave .bfproj is the
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

/* Every loader below that reads persisted preset ids maps them through
 * canonicalPresetId / migratePresetIdKeys first (v13 rename, "starfield" ->
 * "particles"): this cache outlives app updates, and an unmapped legacy key
 * would silently boot the mode at its defaults. */

export function loadStoredPresetId(): string | null {
  const id = localStorage.getItem(LS_PRESET);
  return id === null ? null : canonicalPresetId(id);
}

export function saveStoredPresetId(id: string): void {
  safeSetItem(LS_PRESET, id);
}

export function loadStoredParams(): Record<string, ParamValues> {
  // Validate like the .bfproj path: a corrupt/format-shifted cache must not
  // put a non-finite value into a Float32 uniform (NaN corrupts the visual).
  //
  // NOT applied here: the v14 nebula-saturation remap that parseProject and
  // parseTheme run. A CHOSEN gap, not an oversight — this cache carries no
  // schema stamp from before 2.75.0, so a stored nebula saturation could be
  // pre-v14 or a post-v14 re-tune and nothing distinguishes them. See the
  // cachedDocSchema block above for the full reasoning and the forward-only
  // stamp that makes the NEXT semantics change migratable.
  return validParamsByPreset(migratePresetIdKeys(readJson(LS_PARAMS, {})));
}

export function saveStoredParams(params: Record<string, ParamValues>): void {
  scheduleWrite(LS_PARAMS, () => safeSetItem(LS_PARAMS, JSON.stringify(params)));
}

export function loadStoredSync(): Record<string, SyncSettings> {
  return validSyncByPreset(migratePresetIdKeys(readJson(LS_SYNC, {})));
}

export function saveStoredSync(sync: Record<string, SyncSettings>): void {
  scheduleWrite(LS_SYNC, () => safeSetItem(LS_SYNC, JSON.stringify(sync)));
}

export function loadStoredBg(): BgSettings {
  // validBg checks color length/finiteness and clamps — a length-1 or
  // string-element cached color would otherwise write NaN into the uniform.
  return validBg(readJson<unknown>(LS_BG, null));
}

export function saveStoredBg(bg: BgSettings): void {
  safeSetItem(LS_BG, JSON.stringify(bg));
}

/** Per-mode background overrides. Validated against the (already loaded)
 * asset map so a quota-orphaned image/video entry degrades instead of
 * booting a mode into a black background. */
export function loadStoredBgByPreset(
  assets: Record<string, OverlayAsset>,
): Record<string, BgSettings> {
  return validBgByPreset(migratePresetIdKeys(readJson(LS_BG_BY_PRESET, {})), assets);
}

export function saveStoredBgByPreset(v: Record<string, BgSettings>): void {
  scheduleWrite(LS_BG_BY_PRESET, () => safeSetItem(LS_BG_BY_PRESET, JSON.stringify(v)));
}

/** Per-mode center-image overrides (presetId -> asset id). */
export function loadStoredCenterImages(
  assets: Record<string, OverlayAsset>,
): Record<string, string> {
  return validCenterImages(migratePresetIdKeys(readJson(LS_CENTER_IMAGES, {})), assets);
}

export function saveStoredCenterImages(v: Record<string, string>): void {
  scheduleWrite(LS_CENTER_IMAGES, () => safeSetItem(LS_CENTER_IMAGES, JSON.stringify(v)));
}

export function loadStoredVolume(): number {
  return getPrefs().volume;
}

export function saveStoredVolume(v: number): void {
  setPrefs({ volume: v });
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
  return safeSetItem(LS_OVERLAY, JSON.stringify({ layers, assets }));
}

const LS_CUSTOM_PRESETS = "viz.customPresets.v1";

/** Load user-authored WGSL presets (whitelist-validated). */
export function loadCustomPresets(): PresetDef[] {
  const raw = readJson<unknown>(LS_CUSTOM_PRESETS, null);
  if (!Array.isArray(raw)) return [];
  return raw.map(validCustomPreset).filter((d): d is PresetDef => d !== null);
}

export function saveCustomPresets(defs: PresetDef[]): boolean {
  return safeSetItem(LS_CUSTOM_PRESETS, JSON.stringify(defs));
}

const LS_LYRIC_STYLE = "viz.lyricStyle.v1";

export function loadStoredLyricStyle(): LyricStyle {
  return validLyricStyle(readJson<unknown>(LS_LYRIC_STYLE, null));
}

export function saveStoredLyricStyle(style: LyricStyle): void {
  safeSetItem(LS_LYRIC_STYLE, JSON.stringify(style));
}

const LS_AUDIOGRAM = "viz.audiogram.v1";

export function loadStoredAudiogram(): AudiogramSettings {
  return validAudiogram(readJson<unknown>(LS_AUDIOGRAM, null));
}

export function saveStoredAudiogram(a: AudiogramSettings): void {
  safeSetItem(LS_AUDIOGRAM, JSON.stringify(a));
}

const LS_EXPORT = "viz.exportSettings.v1";

/** Export-dialog settings survive relaunch (they were session-only, so every
 * launch reset resolution/codec/fps/format — a daily paper cut). Returns a
 * validated PARTIAL: the store merges it over its defaults, so a malformed or
 * stale field falls back individually instead of rejecting the whole blob. */
export function loadStoredExportSettings(): Partial<ExportSettings> {
  const raw = readJson<Partial<ExportSettings> | null>(LS_EXPORT, null);
  if (typeof raw !== "object" || raw === null) return {};
  const out: Partial<ExportSettings> = {};
  const num = (v: unknown, lo: number, hi: number): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;
  if (typeof raw.resIdx === "number" && Number.isInteger(raw.resIdx) && raw.resIdx >= 0) {
    out.resIdx = raw.resIdx; // reconciledResIdx clamps against the aspect's list
  }
  if (raw.fps === 30 || raw.fps === 60) out.fps = raw.fps;
  if (typeof raw.autoRate === "boolean") out.autoRate = raw.autoRate;
  const mbps = num(raw.manualMbps, 1, 100);
  if (mbps !== undefined) out.manualMbps = mbps;
  if (raw.codec === "h264" || raw.codec === "hevc" || raw.codec === "av1" || raw.codec === "vp9a") {
    out.codec = raw.codec; // the boot-time support probe degrades unsupported ones
  }
  if (raw.mode === "video" || raw.mode === "canvas") out.mode = raw.mode;
  const cs = num(raw.canvasStart, 0, 36000);
  if (cs !== undefined) out.canvasStart = cs;
  const cd = num(raw.canvasDuration, 3, 8);
  if (cd !== undefined) out.canvasDuration = cd;
  if (
    raw.format === "mp4" ||
    raw.format === "png" ||
    raw.format === "prores" ||
    raw.format === "av1-10" ||
    raw.format === "gif" ||
    raw.format === "webp"
  ) {
    out.format = raw.format;
  }
  if (raw.loudnessTarget === null) out.loudnessTarget = null;
  else {
    const lt = num(raw.loudnessTarget, -36, -6);
    if (lt !== undefined) out.loudnessTarget = lt;
  }
  const tp = num(raw.truePeakDb, -6, 0);
  if (tp !== undefined) out.truePeakDb = tp;
  return out;
}

export function saveStoredExportSettings(s: ExportSettings): void {
  safeSetItem(LS_EXPORT, JSON.stringify(s));
}

const LS_ASPECT = "viz.aspect.v1";
const LS_POST = "viz.post.v1";

export function loadStoredPost(): PostSettings {
  return validPost(readJson(LS_POST, null));
}

export function saveStoredPost(post: PostSettings): void {
  scheduleWrite(LS_POST, () => safeSetItem(LS_POST, JSON.stringify(post)));
}
const LS_MOTION = "viz.motion.v1";

export function loadStoredMotion(): MotionSettings {
  return validMotion(readJson(LS_MOTION, null));
}

export function saveStoredMotion(motion: MotionSettings): void {
  scheduleWrite(LS_MOTION, () => safeSetItem(LS_MOTION, JSON.stringify(motion)));
}
const LS_MODS = "viz.mods.v1";
const LS_BUILDER = "viz.builderStack.v1";
const LS_TIMELINE = "viz.timeline.v1";

export function loadStoredBuilderStack(): BuilderStack {
  const raw = readJson<unknown>(LS_BUILDER, null);
  return raw === null ? defaultBuilderStack() : validBuilderStack(raw);
}

export function saveStoredBuilderStack(stack: BuilderStack): void {
  scheduleWrite(LS_BUILDER, () => safeSetItem(LS_BUILDER, JSON.stringify(stack)));
}

export function loadStoredTimeline(): Timeline {
  return validTimeline(migrateTimelinePresetIds(readJson(LS_TIMELINE, null)));
}

export function saveStoredTimeline(timeline: Timeline): void {
  safeSetItem(LS_TIMELINE, JSON.stringify(timeline));
}

export function loadStoredMods(): Record<string, ModRoute[]> {
  return validModsByPreset(migratePresetIdKeys(readJson(LS_MODS, {})));
}

export function saveStoredMods(mods: Record<string, ModRoute[]>): void {
  scheduleWrite(LS_MODS, () => safeSetItem(LS_MODS, JSON.stringify(mods)));
}

export function loadStoredAspect(): Aspect {
  return validAspect(localStorage.getItem(LS_ASPECT));
}

export function saveStoredAspect(aspect: Aspect): void {
  safeSetItem(LS_ASPECT, aspect);
}

/** Key predates the persistence layer (no .v1 suffix) — existing installs
 * keep their setting. */
const LS_SMOOTH_SPECTRUM = "viz.smoothSpectrum";

export function loadStoredSmoothSpectrum(): boolean {
  return localStorage.getItem(LS_SMOOTH_SPECTRUM) === "1";
}

export function saveStoredSmoothSpectrum(v: boolean): void {
  safeSetItem(LS_SMOOTH_SPECTRUM, v ? "1" : "0");
}

const LS_MIDI = "viz.midiBindings.v1";

export function loadStoredMidiBindings(): MidiBinding[] {
  return validMidiBindings(readJson<unknown>(LS_MIDI, null));
}

export function saveStoredMidiBindings(bindings: MidiBinding[]): void {
  safeSetItem(LS_MIDI, JSON.stringify(bindings));
}

export function loadStoredQuantize(): QuantizeMode {
  return getPrefs().switchQuantize;
}

export function saveStoredQuantize(mode: QuantizeMode): void {
  setPrefs({ switchQuantize: mode });
}

export function loadStoredPanelOpen(): boolean {
  return getPrefs().panelOpen;
}

export function saveStoredPanelOpen(open: boolean): void {
  setPrefs({ panelOpen: open });
}
