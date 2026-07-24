import { create } from "zustand";
import type { PlaybackState, SyncSettings } from "../audio/types";
import { DEFAULT_SYNC, sanitizeSync } from "../audio/types";
import { readTrackMeta } from "../audio/trackMeta";
import { type BatchRun } from "./batch";
import { type CodecSupport } from "../export/codecProbe";
import { demos } from "../audio/demoTrack";
import {
  BG_IMAGE,
  BG_VIDEO,
  type BgSettings,
  type ParamValues,
  type PresetDef,
} from "../render/types";
import {
  decodeVideoBgFrames,
  disposeVideoBgFrames,
  videoBgFrameIndex,
  type VideoBgFrames,
} from "../render/videoBg";
import { bakeBackgroundBitmap } from "../render/bgImage";
import { renderPresetThumbnails } from "../render/thumbnails";
import { registerCustomPreset } from "../render/presets/custom";
import { WebGPURenderer } from "../render/webgpuRenderer";
import { stemValuesAt, type StemEntry, type StemSlot } from "../audio/stems";
import { defaultParams } from "../render/types";
import { presetById, presets } from "../render/presets";
import { APP_VERSION } from "../version";
import { getAnalyzer, getEngine, getRenderer, initServices, remeasure } from "./services";
import { analyzeTrack } from "../audio/analysis/trackAnalysis";
import type { BeatGrid } from "../audio/analysis/beatGrid";
import type { KeyEstimate } from "../audio/analysis/keyDetect";
import { type ModRoute, type ModSource } from "./modMatrix";
import { historyDepths, pushHistory } from "./history";
import type { Timeline } from "./timeline";
import { type LyricLine, type LyricStyle } from "./lyrics";
import { autoArrangeScenes, overviewEnergy } from "./autoArrange";
import {
  composeOverlayFrame,
  hasDynamics,
  overlayFrameKeyAt,
  sameOverlayFrame,
  type OverlayDynamics,
} from "../render/dynamicOverlay";
import { audiogramActive, type AudiogramSettings } from "./audiogram";
import type { MotionSettings, PostSettings } from "../render/types";
import {
  isTauri,
  openImageFile,
  openVideoFile,
  openTextFile,
  readBinaryFromPath,
  saveTextFile,
  startLoopback,
  stopLoopback,
  writeAutosave,
  type LibraryTrack,
} from "./platform";
import {
  pruneBitmapCache,
  rasterizeOverlay,
  type ImageLayer,
  type OverlayAsset,
  type OverlayLayer,
  type OverlayMeta,
  type TextLayer,
} from "../render/overlay";
import { serializeProject, type Aspect, type ProjectDocument } from "./project";
import { type ThemeMeta } from "./themes";
import {
  loadUserPresets,
  newUserPresetId,
  parseUserPreset,
  saveUserPresets,
  serializeUserPreset,
  USER_PRESET_EXTENSION,
  UserPresetParseError,
  type UserPreset,
} from "./userPresets";
import {
  loadStoredAspect,
  loadStoredBg,
  loadStoredMods,
  loadStoredPost,
  loadStoredMotion,
  loadStoredTimeline,
  loadStoredBuilderStack,
  saveStoredBuilderStack,
  saveStoredMods,
  saveStoredPost,
  saveStoredMotion,
  saveStoredTimeline,
  loadStoredOverlay,
  loadStoredPanelOpen,
  loadStoredParams,
  loadCustomPresets,
  saveCustomPresets,
  loadStoredPresetId,
  loadStoredSync,
  loadStoredVolume,
  saveStoredAspect,
  saveStoredBg,
  saveStoredOverlay,
  saveStoredPanelOpen,
  saveStoredParams,
  saveStoredPresetId,
  saveStoredSync,
  saveStoredVolume,
  loadStoredLyricStyle,
  saveStoredLyricStyle,
  loadStoredAudiogram,
  saveStoredAudiogram,
  loadStoredQuantize,
  saveStoredQuantize,
  loadStoredMidiBindings,
  loadStoredExportSettings,
  markSessionDirty,
} from "./persistence";
import { getPrefs, setPrefs } from "./prefs";
import { decodeAudioLenient } from "../audio/decodeLenient";
import {
  BUILDER2_ID,
  packBuilderParams,
  rebuildBuilder2,
  type BuilderStack,
} from "../render/builder2";
import { crossedBoundary, hasFutureBoundary, type QuantizeMode } from "./quantize";
import { type MidiBinding, type MidiLearn } from "./midi";
import type { SliceCtx } from "./slices/ctx";
import { NULL_FRAME_KEY, shared } from "./slices/shared";
import { batchActions } from "./slices/batchActions";
import { builderActions } from "./slices/builderActions";
import { customShaderActions } from "./slices/customShaderActions";
import { exportActions } from "./slices/exportActions";
import { libraryActions } from "./slices/libraryActions";
import { lyricsAudiogramActions } from "./slices/lyricsAudiogramActions";
import { midiActions } from "./slices/midiActions";
import { overlayActions } from "./slices/overlayActions";
import { projectIOActions } from "./slices/projectIOActions";
import { stemsModsActions } from "./slices/stemsModsActions";

// Export config (resolutions, bitrate, ExportSettings) lives in a leaf module
// so slice factories can import it without a value cycle through this store.
// Re-exported here so "./store" keeps its frozen public surface.
import { reconciledResIdx, type ExportProgress, type ExportSettings } from "./exportConfig";
export {
  RESOLUTIONS,
  resolutionsForAspect,
  reconciledResIdx,
  autoBitrateMbps,
  LOUDNESS_PRESETS,
} from "./exportConfig";
export type { ExportProgress, ExportSettings } from "./exportConfig";

/**
 * Document state: everything that describes *the user's work* — serializable,
 * and the payload of project files. Mutate only through document actions so a
 * future history middleware can capture undo/redo at one choke point.
 */
interface DocumentSlice {
  presetId: string;
  /** Per-preset parameter overrides (only presets the user touched). */
  paramsByPreset: Record<string, ParamValues>;
  syncByPreset: Record<string, SyncSettings>;
  bg: BgSettings;
  overlayLayers: OverlayLayer[];
  assets: Record<string, OverlayAsset>;
  aspect: Aspect;
  modsByPreset: Record<string, ModRoute[]>;
  /** Spline-connected spectrum sampling (no hard bin corners), all visuals. */
  smoothSpectrum: boolean;
  timeline: Timeline;
  /** Builder Studio layer stack (renders when presetId === "builder2"). */
  builderStack: BuilderStack;
  post: PostSettings;
  motion: MotionSettings;
}

/** Session/UI state: ephemeral, never saved into projects. */
interface SessionSlice {
  /** Resolved params of the active preset (defaults + overrides). The frame
   * loop reads this via getState() every frame — keep it precomputed. */
  activeParams: ParamValues;
  /** Routes of the active preset — same precompute reasoning. */
  activeMods: ModRoute[];
  sync: SyncSettings;
  playback: PlaybackState;
  volume: number;
  muted: boolean;
  seeking: boolean;
  rendererKind: string;
  chromeIdle: boolean;
  /** Stage mode: chrome-free full-bleed output for live performance / capture /
   * projecting. Drive visuals via keys/MIDI; Esc exits. */
  stageMode: boolean;
  /** Instant black-out over the visual (VJ cut), only meaningful in stage mode. */
  blackout: boolean;
  dragOver: boolean;
  showPanel: boolean;
  showHelp: boolean;
  /** App-settings dialog (Ctrl+,). */
  showSettings: boolean;
  showExport: boolean;
  error: string | null;
  /** Transient positive feedback (project saved, preset imported, …). */
  notice: string | null;
  /**
   * Work recovered from a previous session that ended without a clean exit.
   * Non-null puts a Restore/Discard bar on screen; the document is NOT applied
   * until the user says so, because silently replacing what they just booted
   * into would be its own kind of data loss.
   */
  recoveredDoc: ProjectDocument | null;
  userPresets: UserPreset[];
  /** Track metadata for {title}/{artist} overlay templates. */
  trackMeta: OverlayMeta;
  /** Cover art extracted from the loaded file's tags (session-only). */
  coverArt: string | null;
  /** Momentary loudness readout (LUFS), null before playback. */
  lufs: number | null;
  /** Smoothed stereo width readout 0..1. */
  stereoWidth: number;
  /** Track beat grid; null before analysis lands. */
  beatGrid: BeatGrid | null;
  /** Detected musical key; null before analysis / for atonal tracks. */
  trackKey: KeyEstimate | null;
  /** Section boundaries (seconds) — seek-bar markers, future scene seeds. */
  sections: number[];
  /** Downsampled |peak| envelope of the loaded track (timeline overview). */
  waveformOverview: Float32Array | null;
  showTimeline: boolean;
  analyzing: boolean;
  undoDepth: number;
  redoDepth: number;
  exportSettings: ExportSettings;
  exporting: ExportProgress | null;
  exportError: string | null;
  exportDone: string | null;
  /** What the hardware can encode; null until the probe runs (panel open). */
  codecSupport: CodecSupport | null;
  /** Batch render: setup + in-flight run. Null until the panel is opened. */
  batch: BatchRun | null;
  batchStatus: "idle" | "running" | "done";
  /** Files still being tag-scanned by addBatchTracks (0 = not scanning). The
   * scan takes seconds per file and the panel must not look dead meanwhile. */
  batchScanning: number;
  showBatch: boolean;
  // --- music library sidebar (desktop) ---
  showLibrary: boolean;
  /** Scanned folder + its tracks. Null until a folder is picked. */
  library: { dir: string; tracks: LibraryTrack[] } | null;
  libraryScanning: boolean;
  /** Path of the library track currently loaded (null = loaded another way). */
  libraryActivePath: string | null;
  /** Play the next library track when the current one ends. */
  libraryAutoAdvance: boolean;
  /** Beat-quantized preset takeover: a hotkey/chip switch lands on the next
   * beat/bar boundary instead of instantly. Live performance only — never
   * affects export. Persisted across sessions. */
  switchQuantize: QuantizeMode;
  /** A preset switch waiting for the next quantize boundary (null = none). */
  pendingPresetId: string | null;
  /** Web MIDI on (access granted + listening). Live performance only. */
  midiEnabled: boolean;
  /** Names of connected MIDI inputs (updates on hot-plug). */
  midiDevices: string[];
  /** CC→param / note→preset bindings (persisted). */
  midiBindings: MidiBinding[];
  /** What "MIDI learn" is armed for, if anything. */
  midiLearn: MidiLearn | null;
  /** Analysers fed by live system audio (WASAPI loopback) instead of a track. */
  liveInputActive: boolean;
  /** presetId -> PNG data URL, generated lazily after first paint. */
  presetThumbs: Record<string, string> | null;
  /** Imported stems (analysis-only, session-scoped like the track). */
  stems: StemEntry[];
  /** User-authored WGSL presets (mirrors the runtime registry). */
  customDefs: PresetDef[];
  showShaderEditor: boolean;
  /** Stem currently being analyzed (its file name), null when idle. */
  stemAnalyzing: string | null;
  /** Timed lyrics (parsed .lrc/.srt) — session-scoped like stems. */
  lyrics: LyricLine[] | null;
  /** Source file name of the loaded lyrics, for the UI. */
  lyricFileName: string | null;
  /** How lyric lines render (position/size/color/fade); persisted. */
  lyricStyle: LyricStyle;
  /** Audiogram overlay elements (progress bar / time / waveform); persisted. */
  audiogram: AudiogramSettings;
  /** A video background is decoding (spinner in the bg controls). */
  videoBgLoading: boolean;
}

interface Actions {
  initApp(canvas: HTMLCanvasElement): () => void;
  switchPreset(id: string): void;
  stepPreset(delta: number): void;
  /** Switch to a preset, honoring the beat-quantize mode: instant when off /
   * paused / unanalyzed, otherwise queued until the next beat/bar boundary. */
  queuePreset(id: string): void;
  setSwitchQuantize(mode: QuantizeMode): void;
  /** Request Web MIDI access and start listening (user-gesture initiated). */
  enableMidi(): Promise<void>;
  disableMidi(): void;
  /** Feed one raw MIDI packet through learn/apply (also the adapter's sink). */
  handleMidiMessage(data: ArrayLike<number>): void;
  setMidiLearn(learn: MidiLearn | null): void;
  removeMidiBinding(id: string): void;
  setParam(key: string, value: number): void;
  applyStyle(values: Partial<ParamValues>): void;
  resetParams(): void;
  setBg(bg: BgSettings): void;
  /** Pick an image file as the background (switches bg.mode to image). */
  pickBackgroundImage(): Promise<void>;
  /** Pick a local video for the background (desktop; decodes a capped loop). */
  pickVideoBackground(): Promise<void>;
  /** Use the loaded track's cover art as the background. */
  useAlbumArtBackground(): void;
  setAspect(aspect: Aspect): void;
  setSmoothSpectrum(v: boolean): void;
  setTimeline(timeline: Timeline): void;
  /** Replace the Builder Studio stack (undoable; recompiles only on structural change). */
  setBuilderStack(stack: BuilderStack): void;
  /** Save the current Builder Studio stack as a shareable .avbuilder file. */
  exportBuilderStack(): Promise<void>;
  /** Parse + apply an .avbuilder file's text (import). */
  importBuilderStackText(text: string): void;
  setShowTimeline(v: boolean): void;
  setPost(patch: Partial<PostSettings>): void;
  setMotion(patch: Partial<MotionSettings>): void;
  setSync(sync: SyncSettings): void;
  loadFile(file: File): Promise<void>;
  loadDemo(id: string): Promise<void>;
  setShowLibrary(open: boolean): void;
  /** Apply a template's document (factory pack or parsed .avtheme). */
  applyTheme(document: ProjectDocument, name: string): void;
  /** Parse + apply an .avtheme file's text (drag-import). */
  importThemeText(contents: string): void;
  /** Save the current setup as a shareable .avtheme file. */
  exportCurrentTheme(meta: ThemeMeta): Promise<void>;
  toggleLiveInput(): Promise<void>;
  /** Kick off (once) the lazy thumbnail render for the preset strip. */
  loadPresetThumbnails(): void;
  /** Import a stem file (analysis-only mod source). Max 4. */
  addStem(file: File): Promise<void>;
  setShowShaderEditor(open: boolean): void;
  /** Compile-check a custom preset; [] = clean, else error strings. */
  checkCustomPreset(def: PresetDef): Promise<string[]>;
  /** Compile-check, register, persist and switch to a custom preset. */
  saveCustomPreset(def: PresetDef): Promise<string[]>;
  deleteCustomPreset(id: string): void;
  exportCustomPreset(id: string): Promise<void>;
  importCustomPresetText(contents: string): Promise<void>;
  removeStem(slot: StemSlot): void;
  /** One-click: wire this stem's bands to sensible knobs of the active visual. */
  autoRouteStem(slot: StemSlot): void;
  /** Import timed lyrics (.lrc/.srt contents) — karaoke overlay. */
  loadLyricsText(fileName: string, contents: string): void;
  clearLyrics(): void;
  setLyricStyle(patch: Partial<LyricStyle>): void;
  /** Toggle/adjust the audiogram overlay elements. */
  setAudiogram(patch: Partial<AudiogramSettings>): void;
  /** One click: detected sections -> energy-ranked timeline scenes. */
  autoArrangeTimeline(): void;
  pickLibraryFolder(): Promise<void>;
  playLibraryTrack(path: string): Promise<void>;
  /** Auto-advance hook — called by the engine's natural-end callback. */
  advanceLibrary(): Promise<void>;
  setLibraryAutoAdvance(v: boolean): void;
  togglePlay(): Promise<void>;
  seekStart(): void;
  seekEnd(time: number): void;
  seekBy(delta: number): void;
  toggleLoop(): void;
  applyVolume(volume: number, muted: boolean): void;
  pokeChrome(): void;
  setDragOver(v: boolean): void;
  setShowPanel(v: boolean | ((prev: boolean) => boolean)): void;
  setShowHelp(v: boolean): void;
  setShowSettings(v: boolean): void;
  /** Dismiss the error toast — real errors have no timer, so a stale one would
   * otherwise sit over the whole session, including Stage mode. (The degraded-
   * renderer message that first motivated this now uses the notice channel.) */
  clearError(): void;
  setStageMode(v: boolean): void;
  setBlackout(v: boolean): void;
  setShowExport(v: boolean): void;
  setExportSettings(patch: Partial<ExportSettings>): void;
  runExport(): Promise<void>;
  cancelExport(): void;
  setShowBatch(open: boolean): void;
  addBatchTracks(files: File[]): Promise<void>;
  removeBatchTrack(id: string): void;
  setBatchTrackMeta(id: string, meta: Partial<OverlayMeta>): void;
  startBatch(): Promise<void>;
  skipCurrentBatchJob(): void;
  cancelBatch(): void;
  retryFailedBatch(): Promise<void>;
  dismissBatch(): void;
  setError(message: string | null): void;
  saveProject(): Promise<void>;
  openProject(): Promise<void>;
  applyDocument(doc: ProjectDocument): void;
  checkAutosaveRecovery(): Promise<void>;
  restoreAutosave(): void;
  dismissAutosave(): void;
  undo(): void;
  redo(): void;
  saveUserPreset(name: string): void;
  applyUserPreset(id: string): void;
  deleteUserPreset(id: string): void;
  exportUserPreset(id: string): Promise<void>;
  importUserPreset(): Promise<void>;
  addTextLayer(): void;
  addImageLayer(): Promise<void>;
  addAlbumArtLayer(): void;
  updateOverlayLayer(id: string, patch: Partial<TextLayer> | Partial<ImageLayer>): void;
  removeOverlayLayer(id: string): void;
  addModRoute(source: ModSource, param: string): void;
  updateModRoute(id: string, patch: Partial<ModRoute>): void;
  removeModRoute(id: string): void;
  /** Re-rasterize the overlay at the live canvas size (debounced). */
  refreshOverlay(): void;
  /** Run the offline analysis pass (beat grid) on the loaded track. */
  analyzeCurrentTrack(): void;
}

export type VizState = DocumentSlice & SessionSlice & Actions;

// Non-serializable ephemera live outside the state object. Cross-group state
// (trackLoadGen, exportAbort/exportStarting, lastFrameKey, libraryPrefetch,
// midiHandle) and NULL_FRAME_KEY moved to slices/shared.ts; per-group ephemera
// (batchAbort/batchStarting, exportStartedAt, libraryClickGen) live in their
// own slice files. What remains here is owned by the store core.
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let autosaveFailureShown = false;
/** Live canvas — overlay rasters at its pixel size. Set by initApp. */
let liveCanvas: HTMLCanvasElement | null = null;
let overlayTimer: ReturnType<typeof setTimeout> | undefined;
/** Static overlay bitmap RETAINED while lyrics are active: the compositor
 * redraws base+line on every line/fade-step change, so the renderer only
 * ever receives composed copies (it closes what it's handed). */
let overlayBase: ImageBitmap | null = null;
/** Decoded video-background loop; the frame tick uploads the frame for t. */
let videoBgFrames: VideoBgFrames | null = null;
// Previous frame's track time, for beat-quantized switch takeover. Live-only.
let lastQuantizeTick = -1;
let overlayComposeToken = 0;

/** The per-frame overlay layers (lyrics + audiogram) assembled from state —
 * the SAME shape the export job carries, so live and export compose alike. */
function overlayDynamics(s: VizState): OverlayDynamics {
  return {
    lyrics: s.lyrics ? { lines: s.lyrics, style: s.lyricStyle } : undefined,
    audiogram: audiogramActive(s.audiogram)
      ? { settings: s.audiogram, duration: getEngine().duration, waveform: s.waveformOverview }
      : undefined,
  };
}
/** Monotonic token: only the newest raster result gets applied. */
let overlayToken = 0;
/** Latest analysis job id — stale results are dropped. */
let analysisId = 0;
/** toggleLiveInput spans two real awaits (worklet + Rust spawn); this stops a
 * second click from running a second start path whose failure cleanup would
 * tear down the first click's worklet. */
let liveToggling = false;
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;

function resolveParams(presetId: string, overrides: Record<string, ParamValues>): ParamValues {
  const preset = presetById(presetId);
  return { ...defaultParams(preset), ...overrides[preset.id] };
}

// Custom WGSL presets must be registered before anything resolves preset
// ids (initial state, validators) — otherwise a stored custom id would fall
// back to the default mode on every launch.
const initialCustomDefs = loadCustomPresets();
for (const def of initialCustomDefs) registerCustomPreset(def);

const initialPresetId = (() => {
  const stored = loadStoredPresetId();
  return stored &&
    (presets.some((p) => p.id === stored) || initialCustomDefs.some((d) => d.id === stored))
    ? stored
    : presets[0].id;
})();
const initialParams = loadStoredParams();
const initialSync = loadStoredSync();
const initialOverlay = loadStoredOverlay();
const initialMods = loadStoredMods();

export const useVizStore = create<VizState>((set, get) => {
  const flashNotice = (notice: string) => {
    set({ notice });
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => set({ notice: null }), 4000);
  };

  /** The custom defs this document actually references (active preset +
   * timeline scenes) — what travels in the .avproj so it renders identically
   * elsewhere. Deliberately NOT the whole library: unreferenced defs would
   * bloat every save and every history snapshot for no portability gain. */
  const referencedCustomDefs = (s: VizState): PresetDef[] => {
    const ids = new Set<string>([s.presetId]);
    for (const scene of s.timeline.scenes) ids.add(scene.presetId);
    return s.customDefs.filter((d) => ids.has(d.id));
  };

  /** Current document slice as a ProjectDocument (history + save share it). */
  const docOf = (s: VizState): ProjectDocument => ({
    presetId: s.presetId,
    paramsByPreset: s.paramsByPreset,
    syncByPreset: s.syncByPreset,
    bg: s.bg,
    overlayLayers: s.overlayLayers,
    assets: s.assets,
    aspect: s.aspect,
    modsByPreset: s.modsByPreset,
    smoothSpectrum: s.smoothSpectrum,
    timeline: s.timeline,
    post: s.post,
    motion: s.motion,
    lyricStyle: s.lyricStyle,
    audiogram: s.audiogram,
    customDefs: referencedCustomDefs(s),
    builderStack: s.builderStack,
  });

  /** Record the current document before a mutation (gesture-grouped). */
  /** While true, record() is a no-op — used to make compound actions one
   * undo step instead of one per inner action. */
  let recordSuspended = false;

  const record = (key: string) => {
    if (recordSuspended) return;
    pushHistory(docOf(get()), key);
    const d = historyDepths();
    set({ undoDepth: d.undo, redoDepth: d.redo });
    scheduleAutosave();
  };

  /** Record ONE history entry for `key`, then run `fn` with inner record()
   * calls suppressed — a compound action must cost exactly one Ctrl+Z. */
  const asOneGesture = (key: string, fn: () => void) => {
    record(key);
    recordSuspended = true;
    try {
      fn();
    } finally {
      recordSuspended = false;
    }
  };

  /**
   * Decode the track's cover art and hand it to the renderer so presets can
   * sample it (coverSample()/hasCover()). Race-guarded: a decode that finishes
   * after the track changed is dropped instead of overwriting the new cover.
   */
  const applyCoverArt = () => {
    const cover = get().coverArt;
    if (!cover) {
      getRenderer()?.setCoverArt(null);
      return;
    }
    void fetch(cover)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b))
      .then((bmp) => {
        if (get().coverArt === cover) getRenderer()?.setCoverArt(bmp);
        else bmp.close();
      })
      .catch(() => {
        // Same race guard as success: a stale decode failure (slow corrupt
        // art from the PREVIOUS track) must not wipe the current track's cover
        if (get().coverArt === cover) getRenderer()?.setCoverArt(null);
      });
  };

  /** Read + decode the NEXT library track while the current one plays, so
   * auto-advance swaps buffers instead of paying disk + decode at the gap.
   * Decodes on the engine's own context — a fresh OfflineAudioContext would
   * resample and shift every FFT bin (the batch learned this the hard way). */
  /** Lower-cased file names already present in a folder (desktop). Batch runs
   * treat those as reserved so no run — this one, a retry, or one from a past
   * session — ever overwrites a finished video. Errors degrade to "none". */
  const fileNamesInDir = async (dir: string): Promise<Set<string>> => {
    if (!isTauri()) return new Set();
    try {
      const { readDir } = await import("@tauri-apps/plugin-fs");
      return new Set(
        (await readDir(dir)).filter((e) => !e.isDirectory).map((e) => e.name.toLowerCase()),
      );
    } catch {
      return new Set();
    }
  };

  const prefetchNextLibraryTrack = async () => {
    const s = get();
    if (!s.library || !s.libraryActivePath) return;
    const i = s.library.tracks.findIndex((t) => t.path === s.libraryActivePath);
    if (i < 0 || i + 1 >= s.library.tracks.length) {
      shared.libraryPrefetch = null;
      return;
    }
    const next = s.library.tracks[i + 1];
    if (shared.libraryPrefetch?.path === next.path) return;
    shared.libraryPrefetch = null;
    try {
      const bytes = await readBinaryFromPath(next.path);
      const file = new File([bytes as BlobPart], next.fileName);
      const buffer = await decodeAudioLenient(getEngine().ctx, await file.arrayBuffer());
      // Only keep it if the user is still on the track we prefetched FOR.
      if (get().library?.tracks[i + 1]?.path === next.path) {
        shared.libraryPrefetch = { path: next.path, file, buffer };
      }
    } catch {
      shared.libraryPrefetch = null; // advance falls back to the plain load path
    }
  };

  /**
   * Bake + hand the image background to the renderer (or clear it). Token-
   * guarded like applyCoverArt: a slow bake finishing after the bg changed
   * again must not overwrite the newer image.
   */
  let bgImageToken = 0;
  // Decoded video-background loop (non-serializable, lives outside state).
  let videoBgToken = 0;
  /**
   * What each background is currently baked/decoded FROM. `setBg` runs on every
   * slider `onChange`, so a one-second Dim/Blur drag used to launch dozens of
   * concurrent full bakes (and, for video, full mediabunny decodes of up to 240
   * frames). The token guard discarded the results but all the work still ran.
   * Skipping when the inputs are unchanged is what actually stops it.
   * Cleared on renderer change, since a fresh renderer holds no bitmap.
   */
  let bgImageKey = "";
  let videoBgKey = "";
  const invalidateBgCaches = () => {
    bgImageKey = "";
    videoBgKey = "";
  };
  const applyBgImage = () => {
    const { bg, assets } = get();
    const asset = bg.mode === BG_IMAGE && bg.image ? assets[bg.image.assetId] : undefined;
    const key = asset && bg.image ? `${bg.image.assetId}|${bg.image.dim}|${bg.image.blur}` : "";
    if (key === bgImageKey) return; // nothing that affects the bake changed
    bgImageKey = key;
    const token = ++bgImageToken;
    if (!asset || !bg.image) {
      getRenderer()?.setBackgroundImage(null);
      return;
    }
    void bakeBackgroundBitmap(asset.dataUrl, bg.image.blur, bg.image.dim)
      .then((bmp) => {
        if (token === bgImageToken) getRenderer()?.setBackgroundImage(bmp);
        else bmp.close();
      })
      .catch(() => {
        if (token === bgImageToken) getRenderer()?.setBackgroundImage(null);
      });
  };

  /**
   * Decode (or clear) the video-background loop for the current bg. Token-
   * guarded like applyBgImage: a slow decode finishing after the bg changed
   * again must not install stale frames. The per-frame upload happens in the
   * frame tick; this only owns the decoded array's lifecycle.
   */
  const applyVideoBg = () => {
    const { bg, assets } = get();
    const asset = bg.mode === BG_VIDEO && bg.video ? assets[bg.video.assetId] : undefined;
    // See bgImageKey: without this a Dim/Blur drag re-decoded the whole clip
    // on every pointer move.
    const key = asset && bg.video ? `${bg.video.assetId}|${bg.video.dim}|${bg.video.blur}` : "";
    if (key === videoBgKey) return;
    videoBgKey = key;
    const token = ++videoBgToken;
    if (!asset || !bg.video) {
      disposeVideoBgFrames(videoBgFrames);
      videoBgFrames = null;
      // Leaving video mode: clear bgTex so a stale last frame doesn't linger.
      if (bg.mode !== BG_VIDEO) getRenderer()?.setBackgroundImage(null);
      set({ videoBgLoading: false });
      return;
    }
    set({ videoBgLoading: true });
    void fetch(asset.dataUrl)
      .then((r) => r.blob())
      .then((blob) => decodeVideoBgFrames(blob, bg.video!.dim, bg.video!.blur))
      .then((decoded) => {
        if (token !== videoBgToken) {
          disposeVideoBgFrames(decoded);
          return;
        }
        disposeVideoBgFrames(videoBgFrames);
        videoBgFrames = decoded;
        set({ videoBgLoading: false });
      })
      .catch((e) => {
        if (token !== videoBgToken) return;
        disposeVideoBgFrames(videoBgFrames);
        videoBgFrames = null;
        // Clear bgTex so mode 4 doesn't keep compositing the last uploaded
        // frame frozen forever — a broken video degrades to an empty bg.
        getRenderer()?.setBackgroundImage(null);
        // A codec mediabunny can't decode (e.g. old MPEG-4 Part 2 in an
        // .mp4 shell) surfaces as a bare "Assertion failed" — translate.
        const msg = (e as Error).message ?? String(e);
        const friendly = /assertion|unsupported|no decoder|codec/i.test(msg)
          ? "this clip's video codec isn't supported — re-encode it as H.264 or VP9 and try again"
          : msg;
        set({
          videoBgLoading: false,
          error: `Could not load video background: ${friendly}`,
        });
      });
  };

  /** Crash-safe project autosave (desktop), debounced past edit bursts. */
  const scheduleAutosave = () => {
    // Mark the session dirty IMMEDIATELY, not when the debounced write lands:
    // a crash inside those 5 s is exactly the case recovery exists for, and the
    // previous autosave on disk is then the newest copy of the work.
    markSessionDirty();
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      void writeAutosave(serializeProject(docOf(get()), APP_VERSION)).catch((e) => {
        console.error("[autosave]", e);
        // Surface ONCE per session: a failing autosave means crash recovery
        // silently cannot work — exactly the failure that went unnoticed from
        // the feature's birth until the first hardware test (the $APPDATA
        // write scope was never granted).
        if (!autosaveFailureShown) {
          autosaveFailureShown = true;
          set({
            error: `Autosave is failing — crash recovery is unavailable (${(e as Error).message ?? e})`,
          });
        }
      });
    }, getPrefs().autosaveIntervalSec * 1000);
  };

  // The shared closure surface handed to every slice factory.
  const ctx: SliceCtx = {
    docOf,
    referencedCustomDefs,
    record,
    asOneGesture,
    flashNotice,
    applyCoverArt,
    applyBgImage,
    applyVideoBg,
    scheduleAutosave,
    fileNamesInDir,
    prefetchNextLibraryTrack,
  };

  return {
    // --- document ---
    presetId: initialPresetId,
    paramsByPreset: initialParams,
    syncByPreset: initialSync,
    // Belt for the quota split-brain: a stored image bg whose asset never made
    // it into storage (multi-MB data URLs can fail to persist) must not boot
    // the app into a black background — degrade to the preset background.
    bg: (() => {
      const bg = loadStoredBg();
      const imageMissing =
        bg.mode === BG_IMAGE && (!bg.image || !initialOverlay.assets[bg.image.assetId]);
      const videoMissing =
        bg.mode === BG_VIDEO && (!bg.video || !initialOverlay.assets[bg.video.assetId]);
      return imageMissing || videoMissing ? { ...bg, mode: 0 } : bg;
    })(),
    overlayLayers: initialOverlay.layers,
    assets: initialOverlay.assets,
    aspect: loadStoredAspect(),
    modsByPreset: initialMods,
    smoothSpectrum: localStorage.getItem("viz.smoothSpectrum") === "1",
    timeline: loadStoredTimeline(),
    builderStack: loadStoredBuilderStack(),
    post: loadStoredPost(),
    motion: loadStoredMotion(),

    // --- session ---
    activeParams: resolveParams(initialPresetId, initialParams),
    activeMods: initialMods[initialPresetId] ?? [],
    sync: initialSync[initialPresetId] ?? { ...DEFAULT_SYNC },
    playback: { playing: false, time: 0, duration: 0, trackName: null, loop: false },
    volume: loadStoredVolume(),
    muted: false,
    seeking: false,
    rendererKind: "…",
    chromeIdle: false,
    stageMode: false,
    blackout: false,
    dragOver: false,
    showPanel: loadStoredPanelOpen(),
    showHelp: false,
    showSettings: false,
    showExport: false,
    error: null,
    notice: null,
    recoveredDoc: null,
    userPresets: loadUserPresets(),
    trackMeta: { title: "", artist: "" },
    coverArt: null,
    lufs: null,
    stereoWidth: 0,
    beatGrid: null,
    trackKey: null,
    sections: [],
    waveformOverview: null,
    showTimeline: getPrefs().timelineOpen,
    analyzing: false,
    undoDepth: 0,
    redoDepth: 0,
    exportSettings: (() => {
      const stored = loadStoredExportSettings();
      // Sidecar/PNG formats need the desktop; a persisted one loading in the
      // browser dev build would render a dead Export dialog.
      if (!isTauri() && stored.format && stored.format !== "mp4") delete stored.format;
      return {
        codec: "h264" as const,
        fps: 60,
        autoRate: true,
        manualMbps: 12,
        mode: "video" as const,
        canvasStart: 0,
        canvasDuration: 6,
        format: "mp4" as const,
        loudnessTarget: null,
        truePeakDb: -1,
        ...stored,
        // The aspect persists across launches; the resolution must match it or
        // the export select renders blank and exports the wrong shape.
        resIdx: reconciledResIdx(loadStoredAspect(), stored.resIdx ?? 1),
      };
    })(),
    batch: null,
    batchStatus: "idle" as const,
    batchScanning: 0,
    codecSupport: null,
    showLibrary: false,
    library: null,
    libraryScanning: false,
    libraryActivePath: null,
    libraryAutoAdvance: true,
    switchQuantize: loadStoredQuantize(),
    pendingPresetId: null,
    midiEnabled: false,
    midiDevices: [],
    midiBindings: loadStoredMidiBindings(),
    midiLearn: null,
    liveInputActive: false,
    presetThumbs: null,
    stems: [],
    stemAnalyzing: null,
    lyrics: null,
    lyricFileName: null,
    lyricStyle: loadStoredLyricStyle(),
    audiogram: loadStoredAudiogram(),
    videoBgLoading: false,
    customDefs: initialCustomDefs,
    showShaderEditor: false,
    showBatch: false,
    exporting: null,
    exportError: null,
    exportDone: null,

    // --- actions ---
    // Per-domain action groups (behavior-identical to the inline versions they
    // replaced); see src/state/slices/. The playback/track-loading/preset/init
    // core and the document core (applyDocument) stay below.
    ...exportActions(set, get, ctx),
    ...batchActions(set, get, ctx),
    ...builderActions(set, get, ctx),
    ...libraryActions(set, get, ctx),
    ...customShaderActions(set, get, ctx),
    ...lyricsAudiogramActions(set, get, ctx),
    ...overlayActions(set, get, ctx),
    ...stemsModsActions(set, get, ctx),
    ...midiActions(set, get, ctx),
    ...projectIOActions(set, get, ctx),

    initApp(canvas) {
      liveCanvas = canvas;
      const dispose = initServices(canvas, {
        getPreset: () => presetById(get().presetId),
        getFrameInput: () => {
          const s = get();
          return {
            timeline: s.timeline,
            basePresetId: s.presetId,
            baseParams: s.activeParams,
            baseMods: s.activeMods,
            baseBg: s.bg,
            paramsByPreset: s.paramsByPreset,
            modsByPreset: s.modsByPreset,
          };
        },
        getBackground: () => get().bg,
        getSync: () => get().sync,
        isSeeking: () => get().seeking,
        onPlayback: (playback) => set({ playback }),
        onRendererChanged: (kind, warning) => {
          set({ rendererKind: kind });
          // A degraded renderer (Canvas2D fallback) is WORKING, not failed, so
          // surface it as an auto-clearing notice — never the persistent red
          // error toast, which used to sit over the whole session incl. Stage.
          if (warning) flashNotice(warning);
          getRenderer()?.setSmoothSpectrum(get().smoothSpectrum);
          getRenderer()?.setPost(get().post);
          getRenderer()?.setMotion(get().motion);
          // Builder Studio: a fresh renderer's layer-param buffer is zeroed —
          // every layer would render at opacity 0 until the first stack edit.
          rebuildBuilder2(get().builderStack);
          getRenderer()?.setBuilderParams(packBuilderParams(get().builderStack));
          applyCoverArt(); // new renderer starts without a cover bound
          invalidateBgCaches(); // a fresh renderer holds no bitmap/frames
          applyBgImage(); // ...and without a background image
          applyVideoBg(); // ...and without video frames (re-decode for it)
          get().refreshOverlay(); // new renderer starts without an overlay bound
        },
        onResize: () => get().refreshOverlay(),
        onMeter: (lufs, stereoWidth) => set({ lufs, stereoWidth }),
        getStemValues: (t) => stemValuesAt(get().stems, t),
        onFrameTick: (t) => {
          const s = get();
          // Beat-quantized takeover: fire the queued switch the moment the track
          // crosses the chosen boundary. Live-only — export never runs this loop.
          if (s.pendingPresetId && s.beatGrid) {
            if (crossedBoundary(s.beatGrid.beatTimes, lastQuantizeTick, t, s.switchQuantize)) {
              const target = s.pendingPresetId;
              set({ pendingPresetId: null });
              get().switchPreset(target);
            }
          }
          lastQuantizeTick = t;
          // Video background: upload the frame for THIS track time (pure index
          // → deterministic, matches the export). A GPU renderer only.
          if (videoBgFrames && s.bg.mode === BG_VIDEO) {
            const r = getRenderer();
            if (r instanceof WebGPURenderer) {
              const i = videoBgFrameIndex(videoBgFrames.frames.length, videoBgFrames.fps, t);
              r.updateBackgroundVideoFrame(videoBgFrames.frames[i]);
            }
          }
          const dyn = overlayDynamics(s);
          if (!hasDynamics(dyn)) return;
          const canvas = liveCanvas;
          if (!canvas) return;
          const key = overlayFrameKeyAt(dyn, t, canvas.width);
          if (sameOverlayFrame(key, shared.lastFrameKey)) return;
          shared.lastFrameKey = key;
          // Token pair: superseded composes AND full overlay re-rasters both
          // invalidate this frame's composition.
          const token = ++overlayComposeToken;
          const oTok = overlayToken;
          void composeOverlayFrame(overlayBase, dyn, t, canvas.width, canvas.height)
            .then((bmp) => {
              if (token === overlayComposeToken && oTok === overlayToken) {
                getRenderer()?.setOverlay(bmp);
              } else {
                bmp.close();
              }
            })
            .catch(() => undefined);
        },
      });
      getEngine().setVolume(get().muted ? 0 : get().volume);
      // Library auto-advance: when a library track finishes naturally, play
      // the next one (the action checks the toggle + current-track membership).
      getEngine().onEnded = () => void get().advanceLibrary();
      get().pokeChrome();
      return () => {
        clearTimeout(idleTimer);
        clearTimeout(overlayTimer);
        liveCanvas = null;
        dispose();
        // The rest of teardown: services.dispose() above only owns the
        // engine/analyzer/renderer/loop. Everything the STORE itself
        // retained outside React state was left dangling here — a stale
        // ImageBitmap, up to 240 decoded video-bg frames (~220 MB), a live
        // MIDI listener, a 5s autosave timer that fires after teardown and
        // writes to disk, and a prefetched AudioBuffer for the session.
        clearTimeout(autosaveTimer);
        overlayBase?.close();
        overlayBase = null;
        disposeVideoBgFrames(videoBgFrames);
        videoBgFrames = null;
        shared.midiHandle?.stop();
        shared.midiHandle = null;
        shared.libraryPrefetch = null;
      };
    },

    switchPreset(id) {
      record("preset");
      const next = presetById(id);
      const state = get();
      const activeParams = resolveParams(next.id, state.paramsByPreset);
      const sync = state.syncByPreset[next.id] ?? { ...DEFAULT_SYNC };
      const activeMods = state.modsByPreset[next.id] ?? [];
      // Any concrete switch supersedes a queued one.
      set({
        presetId: next.id,
        activeParams,
        activeMods,
        sync,
        ...(state.pendingPresetId ? { pendingPresetId: null } : {}),
      });
      saveStoredPresetId(next.id);
      getRenderer()?.setPreset(next);
      getAnalyzer().setSync(sync);
    },

    stepPreset(delta) {
      const all = [...presets, ...get().customDefs];
      const i = all.findIndex((p) => p.id === get().presetId);
      // Through queuePreset, not switchPreset: [ and ] are live-performance
      // controls exactly like the number keys, and it was inconsistent for
      // 1-9 to honour beat-quantize while the step keys jumped instantly.
      get().queuePreset(all[(i + delta + all.length) % all.length].id);
    },

    queuePreset(id) {
      const s = get();
      // Targeting the current mode cancels any pending queue and does nothing.
      if (id === s.presetId) {
        if (s.pendingPresetId) set({ pendingPresetId: null });
        return;
      }
      // Re-queuing the already-pending target cancels it (toggle off).
      if (id === s.pendingPresetId) {
        set({ pendingPresetId: null });
        return;
      }
      const grid = s.beatGrid;
      // Instant when quantize is off, playback is stopped, or there is no future
      // boundary to land on (unanalyzed track, or past the last beat) — queuing
      // then would hang forever.
      if (
        s.switchQuantize === "off" ||
        !s.playback.playing ||
        !grid ||
        !hasFutureBoundary(grid.beatTimes, getEngine().currentTime, s.switchQuantize)
      ) {
        if (s.pendingPresetId) set({ pendingPresetId: null });
        get().switchPreset(id);
        return;
      }
      set({ pendingPresetId: id });
    },

    setSwitchQuantize(mode) {
      set({ switchQuantize: mode, pendingPresetId: null });
      saveStoredQuantize(mode);
    },

    setParam(key, value) {
      record(`param:${key}`);
      const state = get();
      const activeParams = { ...state.activeParams, [key]: value };
      const paramsByPreset = { ...state.paramsByPreset, [state.presetId]: activeParams };
      set({ activeParams, paramsByPreset });
      saveStoredParams(paramsByPreset);
    },

    applyStyle(values) {
      record("style");
      const state = get();
      // Style values are Partial — the defaults spread guarantees every key
      const activeParams = {
        ...defaultParams(presetById(state.presetId)),
        ...values,
      } as ParamValues;
      const paramsByPreset = { ...state.paramsByPreset, [state.presetId]: activeParams };
      set({ activeParams, paramsByPreset });
      saveStoredParams(paramsByPreset);
    },

    resetParams() {
      record("reset");
      const state = get();
      const paramsByPreset = { ...state.paramsByPreset };
      delete paramsByPreset[state.presetId];
      set({ activeParams: defaultParams(presetById(state.presetId)), paramsByPreset });
      saveStoredParams(paramsByPreset);
    },

    setBg(bg) {
      // A background MODE switch (Preset/Solid/Transparent) is a discrete action
      // that must undo on its own; a colour/dim/blur drag routed through setBg is
      // a gesture that should collapse into one entry. "bg-mode" is in history's
      // UNGROUPABLE set and "bg" is not, so key by whether the mode changed —
      // without this, toggling mode right after a colour drag folds both into a
      // single undo.
      record(get().bg.mode !== bg.mode ? "bg-mode" : "bg");
      set({ bg });
      saveStoredBg(bg);
      getRenderer()?.setBackground(bg);
      applyBgImage();
      applyVideoBg();
    },

    async pickBackgroundImage() {
      let img: { name: string; dataUrl: string } | null;
      try {
        img = await openImageFile();
      } catch (e) {
        set({ error: `Could not open image: ${(e as Error).message}` });
        return;
      }
      if (!img) return;
      record("bg-mode"); // picking an image always switches mode -> discrete undo
      const asset: OverlayAsset = {
        id: `as-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: img.name,
        dataUrl: img.dataUrl,
      };
      const assets = { ...get().assets, [asset.id]: asset };
      const prev = get().bg;
      // Replacing the image orphans the old asset — a multi-MB data URL that
      // would otherwise ride along in state, autosave, .avproj and storage
      // forever. Drop it unless an overlay layer still uses it.
      // Both sub-objects, not just the image: switching video -> image left the
      // (tens-of-MB) video asset orphaned in state, autosave, .avproj and
      // localStorage forever — exactly what this GC exists to prevent.
      for (const prevId of [prev.image?.assetId, prev.video?.assetId]) {
        if (prevId && !get().overlayLayers.some((l) => "assetId" in l && l.assetId === prevId)) {
          delete assets[prevId];
        }
      }
      const bg: BgSettings = {
        ...prev,
        mode: BG_IMAGE,
        image: { assetId: asset.id, dim: prev.image?.dim ?? 0.25, blur: prev.image?.blur ?? 0 },
      };
      set({ assets, bg });
      // Persist the bg REFERENCE only if the asset itself persisted — a saved
      // mode-3 bg pointing at an asset that hit the quota boots into black.
      if (saveStoredOverlay(get().overlayLayers, assets)) saveStoredBg(bg);
      else flashNotice("Image too large to remember — background is session-only");
      getRenderer()?.setBackground(bg);
      applyBgImage();
      applyVideoBg(); // switching away from a video bg: release its decoded loop
    },

    async pickVideoBackground() {
      if (!isTauri()) {
        set({ error: "Video backgrounds need the desktop app" });
        return;
      }
      let vid: { name: string; dataUrl: string } | null;
      try {
        vid = await openVideoFile();
      } catch (e) {
        set({ error: `Could not open video: ${(e as Error).message}` });
        return;
      }
      if (!vid) return;
      record("bg-mode"); // picking a video always switches mode -> discrete undo
      const asset: OverlayAsset = {
        id: `as-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: vid.name,
        dataUrl: vid.dataUrl,
      };
      const assets = { ...get().assets, [asset.id]: asset };
      const prev = get().bg;
      // Orphan-GC BOTH the previous image and video asset, not just one: with an
      // image bg and a video bg both set, `video ?? image` freed only one and the
      // other (tens of MB) leaked in state, autosave, .avproj and localStorage
      // forever — matching pickBackgroundImage / useAlbumArtBackground.
      for (const prevId of [prev.image?.assetId, prev.video?.assetId]) {
        if (prevId && !get().overlayLayers.some((l) => "assetId" in l && l.assetId === prevId)) {
          delete assets[prevId];
        }
      }
      const bg: BgSettings = {
        ...prev,
        mode: BG_VIDEO,
        video: { assetId: asset.id, dim: prev.video?.dim ?? 0.35, blur: 0 },
      };
      set({ assets, bg });
      // A video's data URL is large; keep it session-only if it won't persist
      // (localStorage), but the project-file / autosave path still embeds it.
      if (saveStoredOverlay(get().overlayLayers, assets)) saveStoredBg(bg);
      else flashNotice("Video kept for this session — save a project to keep it");
      getRenderer()?.setBackground(bg);
      applyVideoBg();
    },

    useAlbumArtBackground() {
      const cover = get().coverArt;
      if (!cover) {
        set({ error: "The loaded track has no embedded cover art" });
        return;
      }
      record("bg-mode"); // switching to album-art bg is a mode change -> discrete undo
      const asset: OverlayAsset = {
        id: `as-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: "Album art",
        dataUrl: cover,
      };
      const assets = { ...get().assets, [asset.id]: asset };
      const prev = get().bg;
      // Same orphan-GC as pickBackgroundImage.
      // Both sub-objects, not just the image: switching video -> image left the
      // (tens-of-MB) video asset orphaned in state, autosave, .avproj and
      // localStorage forever — exactly what this GC exists to prevent.
      for (const prevId of [prev.image?.assetId, prev.video?.assetId]) {
        if (prevId && !get().overlayLayers.some((l) => "assetId" in l && l.assetId === prevId)) {
          delete assets[prevId];
        }
      }
      const bg: BgSettings = {
        ...prev,
        mode: BG_IMAGE,
        // Album art behind a visualizer usually wants softening by default
        image: { assetId: asset.id, dim: prev.image?.dim ?? 0.35, blur: prev.image?.blur ?? 18 },
      };
      set({ assets, bg });
      if (saveStoredOverlay(get().overlayLayers, assets)) saveStoredBg(bg);
      else flashNotice("Cover too large to remember — background is session-only");
      getRenderer()?.setBackground(bg);
      applyBgImage();
      applyVideoBg(); // switching away from a video bg: release its decoded loop
    },

    setSmoothSpectrum(v) {
      record("smooth");
      set({ smoothSpectrum: v });
      localStorage.setItem("viz.smoothSpectrum", v ? "1" : "0");
      getRenderer()?.setSmoothSpectrum(v);
    },

    setBuilderStack(stack) {
      record("builder2");
      const builderStack = stack;
      set({ builderStack });
      saveStoredBuilderStack(builderStack);
      const def = rebuildBuilder2(builderStack);
      getRenderer()?.setBuilderParams(packBuilderParams(builderStack));
      // Structural edits produce a NEW def object; installing it recompiles
      // (cached by structure). Value-only edits keep the object, so this is
      // a no-op for the pipeline and the buffer write above does the work.
      if (get().presetId === BUILDER2_ID) getRenderer()?.setPreset(def);
    },

    setTimeline(timeline) {
      record("timeline");
      set({ timeline });
      saveStoredTimeline(timeline);
    },

    autoArrangeTimeline() {
      const s = get();
      const buf = getEngine().audioBuffer;
      if (!buf) {
        set({ error: "Load a track first — auto-arrange reads its detected sections" });
        return;
      }
      if (s.sections.length === 0 || !s.waveformOverview) {
        flashNotice(
          s.analyzing
            ? "Still analyzing the track — try again in a moment"
            : "No sections detected in this track",
        );
        return;
      }
      record("timeline");
      const scenes = autoArrangeScenes(
        s.sections,
        buf.duration,
        overviewEnergy(s.waveformOverview, buf.duration),
      );
      const timeline = { ...s.timeline, enabled: true, scenes };
      set({ timeline, showTimeline: true });
      saveStoredTimeline(timeline);
      flashNotice(`Arranged ${scenes.length} scenes from the song's sections — one Ctrl+Z undoes`);
    },

    setShowTimeline(v) {
      set({ showTimeline: v });
      setPrefs({ timelineOpen: v });
    },

    setPost(patch) {
      record("post");
      const post = { ...get().post, ...patch };
      set({ post });
      saveStoredPost(post);
      getRenderer()?.setPost(post);
    },

    setMotion(patch) {
      record("motion");
      const motion = { ...get().motion, ...patch };
      set({ motion });
      saveStoredMotion(motion);
      getRenderer()?.setMotion(motion);
    },

    setAspect(aspect) {
      record("aspect");
      set({ aspect });
      saveStoredAspect(aspect);
      // Keep the export resolution consistent with the frame
      const resIdx = reconciledResIdx(aspect, get().exportSettings.resIdx);
      if (resIdx !== get().exportSettings.resIdx) {
        get().setExportSettings({ resIdx });
      }
      // Re-measure after the CSS class lands (don't wait for ResizeObserver;
      // it never fires in hidden tabs). The measure also refreshes overlays.
      setTimeout(remeasure, 50);
    },

    setSync(syncIn) {
      // Coerce here too, not just in the pipeline: imported presets/projects
      // route through this action, and the UI reads `sync` back for sliders.
      const sync = sanitizeSync(syncIn);
      record("sync");
      const state = get();
      const syncByPreset = { ...state.syncByPreset, [state.presetId]: sync };
      set({ sync, syncByPreset });
      saveStoredSync(syncByPreset);
      getAnalyzer().setSync(sync);
    },

    async loadFile(file) {
      // Loading a track leaves live mode (and stops the Rust-side capture —
      // the engine alone cannot, so this MUST route through the toggle).
      if (get().liveInputActive) await get().toggleLiveInput();
      // Guard BOTH ends: decode + tag scan take seconds, and a second drop in
      // that window used to let whichever finished LAST own the metadata,
      // cover art and beat grid (baked into exports). Only the newest wins.
      const gen = ++shared.trackLoadGen;
      try {
        // A direct load (drop, file picker) leaves the library: clear the
        // active marker so auto-advance stops. playLibraryTrack re-sets it.
        set({ error: null, libraryActivePath: null });
        await getEngine().loadFile(file);
        if (gen !== shared.trackLoadGen) return;
        await getEngine().play();
        // Tag metadata (title/artist/cover) — best effort, never blocks
        // playback, so no duration scan here. Shared with the batch queue.
        const { meta, coverArt } = await readTrackMeta(file, file.name);
        if (gen !== shared.trackLoadGen) return;
        // Stems are per-track: envelopes analyzed against the old track have
        // no time relationship to the new one, so carrying them over would
        // modulate the new track with the old track's rhythm.
        set({ trackMeta: meta, coverArt, stems: [], lyrics: null, lyricFileName: null });
        applyCoverArt();
        get().refreshOverlay();
        get().analyzeCurrentTrack();
      } catch (e) {
        if (gen !== shared.trackLoadGen) return;
        set({ error: `Could not decode "${file.name}" (${(e as Error).message})` });
      }
    },

    async loadDemo(id) {
      if (get().liveInputActive) await get().toggleLiveInput();
      const gen = ++shared.trackLoadGen;
      try {
        set({ error: null });
        const demo = demos.find((d) => d.id === id);
        if (!demo) return;
        const engine = getEngine();
        const buf = await demo.render(engine.ctx.sampleRate);
        if (gen !== shared.trackLoadGen) return;
        engine.loadBuffer(buf, `Demo: ${demo.name}`);
        await engine.play();
        set({
          trackMeta: { title: demo.name, artist: "" },
          coverArt: null,
          stems: [],
          lyrics: null,
          lyricFileName: null,
        });
        applyCoverArt();
        get().refreshOverlay();
        get().analyzeCurrentTrack();
      } catch (e) {
        if (gen !== shared.trackLoadGen) return;
        set({ error: `Demo failed: ${(e as Error).message}` });
      }
    },

    async togglePlay() {
      // In live mode, "pause" means "stop listening to system audio".
      if (get().liveInputActive) {
        await get().toggleLiveInput();
        return;
      }
      const engine = getEngine();
      if (engine.playing) engine.pause();
      else await engine.play();
    },

    async toggleLiveInput() {
      if (liveToggling) return;
      liveToggling = true;
      try {
        const engine = getEngine();
        if (get().liveInputActive) {
          await stopLoopback().catch(() => undefined);
          engine.stopLiveInput();
          set({ liveInputActive: false });
          return;
        }
        if (!isTauri()) {
          set({ error: "System-audio capture needs the desktop app" });
          return;
        }
        try {
          const push = await engine.startLiveInput();
          const info = await startLoopback(push);
          if (info.sampleRate !== engine.ctx.sampleRate) {
            // Same default device on both ends makes this near-impossible, but
            // feeding mismatched rates would pitch-shift every feature.
            await stopLoopback().catch(() => undefined);
            engine.stopLiveInput();
            set({
              error: `System audio runs at ${info.sampleRate} Hz, the visualizer at ${engine.ctx.sampleRate} Hz — match them in Windows sound settings`,
            });
            return;
          }
          // The previous track's beat grid must not pulse over live audio;
          // presets fall back to onset pulses without one. Superseding
          // analysisId also cancels an IN-FLIGHT analysis — without that, a
          // grid computed for the dead track lands a few seconds into live
          // mode and pulses over unrelated audio.
          analysisId++;
          getAnalyzer().setBeatGrid(null);
          set({
            liveInputActive: true,
            beatGrid: null,
            trackKey: null,
            sections: [],
            analyzing: false,
            libraryActivePath: null,
            error: null,
          });
          flashNotice(`Listening to ${info.device}`);
        } catch (e) {
          // Clear the Rust side too: a half-started (or orphaned) capture
          // would wedge every future toggle on "already running".
          await stopLoopback().catch(() => undefined);
          engine.stopLiveInput();
          set({ error: `System-audio capture failed: ${(e as Error).message}` });
        }
      } finally {
        liveToggling = false;
      }
    },

    loadPresetThumbnails() {
      if (get().presetThumbs) return;
      void renderPresetThumbnails().then((presetThumbs) => {
        if (Object.keys(presetThumbs).length > 0) set({ presetThumbs });
      });
    },

    seekStart() {
      set({ seeking: true });
    },

    seekEnd(time) {
      set({ seeking: false });
      getEngine().seek(time);
    },

    seekBy(delta) {
      const engine = getEngine();
      engine.seek(engine.currentTime + delta);
    },

    toggleLoop() {
      const engine = getEngine();
      engine.loop = !engine.loop;
    },

    applyVolume(volume, muted) {
      set({ volume, muted });
      getEngine().setVolume(muted ? 0 : volume);
      saveStoredVolume(volume);
    },

    pokeChrome() {
      if (get().chromeIdle) set({ chromeIdle: false });
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const s = get();
        if (s.playback.playing && !s.showExport) set({ chromeIdle: true });
      }, 3000);
    },

    setDragOver(dragOver) {
      if (get().dragOver !== dragOver) set({ dragOver });
    },

    setShowPanel(v) {
      const next = typeof v === "function" ? v(get().showPanel) : v;
      set({ showPanel: next });
      saveStoredPanelOpen(next);
    },

    setShowSettings(showSettings) {
      set({ showSettings });
    },

    setShowHelp(showHelp) {
      set({ showHelp });
    },

    clearError() {
      set({ error: null });
    },

    setStageMode(stageMode) {
      // Entering stage closes panels for a clean output; leaving clears blackout.
      if (stageMode) set({ stageMode, showPanel: false, showTimeline: false, showHelp: false });
      else set({ stageMode, blackout: false });
    },

    setBlackout(blackout) {
      set({ blackout });
    },

    setError(error) {
      set({ error });
    },

    applyDocument(doc) {
      // Embedded custom defs merge into the session library (replace-by-id):
      // project open brings the visuals it references, and undo after
      // deleteCustomPreset restores the def alongside the document that
      // referenced it. Registration is idempotent.
      let customDefs = get().customDefs;
      if (doc.customDefs.length > 0) {
        const incoming = new Set(doc.customDefs.map((d) => d.id));
        customDefs = [...customDefs.filter((d) => !incoming.has(d.id)), ...doc.customDefs];
        for (const def of doc.customDefs) registerCustomPreset(def);
        saveCustomPresets(customDefs);
      }
      const preset = presetById(doc.presetId);
      const activeParams = resolveParams(preset.id, doc.paramsByPreset);
      const sync = sanitizeSync(doc.syncByPreset[preset.id] ?? { ...DEFAULT_SYNC });
      set({
        customDefs,
        lyricStyle: doc.lyricStyle,
        audiogram: doc.audiogram,
        builderStack: doc.builderStack,
        // Keep the export resolution consistent with the incoming aspect
        // (covers project-open AND undo/redo of aspect changes).
        exportSettings: {
          ...get().exportSettings,
          resIdx: reconciledResIdx(doc.aspect, get().exportSettings.resIdx),
        },
        presetId: preset.id,
        paramsByPreset: doc.paramsByPreset,
        syncByPreset: doc.syncByPreset,
        bg: doc.bg,
        overlayLayers: doc.overlayLayers,
        assets: doc.assets,
        aspect: doc.aspect,
        modsByPreset: doc.modsByPreset,
        smoothSpectrum: doc.smoothSpectrum,
        timeline: doc.timeline,
        post: doc.post,
        motion: doc.motion,
        activeParams,
        activeMods: doc.modsByPreset[preset.id] ?? [],
        sync,
      });
      saveStoredPresetId(preset.id);
      saveStoredParams(doc.paramsByPreset);
      saveStoredSync(doc.syncByPreset);
      saveStoredBg(doc.bg);
      saveStoredOverlay(doc.overlayLayers, doc.assets);
      saveStoredAspect(doc.aspect);
      saveStoredMods(doc.modsByPreset);
      saveStoredTimeline(doc.timeline);
      localStorage.setItem("viz.smoothSpectrum", doc.smoothSpectrum ? "1" : "0");
      getRenderer()?.setSmoothSpectrum(doc.smoothSpectrum);
      saveStoredPost(doc.post);
      getRenderer()?.setPost(doc.post);
      saveStoredMotion(doc.motion);
      getRenderer()?.setMotion(doc.motion);
      saveStoredLyricStyle(doc.lyricStyle);
      saveStoredAudiogram(doc.audiogram);
      saveStoredBuilderStack(doc.builderStack);
      // Builder Studio: regenerate the def (identity changes only on
      // structural difference) and re-upload the value block. setPreset
      // below picks up the new def when builder2 is the active preset.
      rebuildBuilder2(doc.builderStack);
      getRenderer()?.setBuilderParams(packBuilderParams(doc.builderStack));
      // Lyric style / audiogram feed the frame-keyed dynamic overlay — force
      // a recompose so undo/open shows the incoming style immediately.
      shared.lastFrameKey = NULL_FRAME_KEY;
      pruneBitmapCache(new Set(Object.keys(doc.assets)));
      getRenderer()?.setPreset(preset);
      getRenderer()?.setBackground(doc.bg);
      applyBgImage();
      applyVideoBg(); // restore/clear a video background on open/theme/undo
      getAnalyzer().setSync(sync);
      get().refreshOverlay();
      // Covers undo/redo/project-open: without this the autosave file kept
      // the PRE-undo document until the next ordinary edit.
      scheduleAutosave();
    },

    saveUserPreset(name) {
      const s = get();
      const trimmed = name.trim();
      if (!trimmed) return;
      const preset: UserPreset = {
        id: newUserPresetId(),
        name: trimmed,
        presetId: s.presetId,
        params: { ...s.activeParams },
        sync: { ...s.sync },
        createdAt: new Date().toISOString(),
      };
      const userPresets = [preset, ...s.userPresets];
      set({ userPresets });
      saveUserPresets(userPresets);
      flashNotice(`Look "${trimmed}" saved`);
    },

    applyUserPreset(id) {
      const s = get();
      const preset = s.userPresets.find((p) => p.id === id);
      if (!preset) return; // nothing applied -> nothing recorded
      // One gesture: switchPreset + params + setSync used to push up to three
      // history entries, so one Ctrl+Z stepped through half-applied states.
      asOneGesture("look", () => {
        if (preset.presetId !== get().presetId) get().switchPreset(preset.presetId);
        const state = get();
        const activeParams = {
          ...defaultParams(presetById(state.presetId)),
          ...preset.params,
        };
        const paramsByPreset = { ...state.paramsByPreset, [state.presetId]: activeParams };
        set({ activeParams, paramsByPreset });
        saveStoredParams(paramsByPreset);
        if (preset.sync) get().setSync({ ...preset.sync });
      });
    },

    deleteUserPreset(id) {
      const userPresets = get().userPresets.filter((p) => p.id !== id);
      set({ userPresets });
      saveUserPresets(userPresets);
    },

    async exportUserPreset(id) {
      const preset = get().userPresets.find((p) => p.id === id);
      if (!preset) return;
      const safe = preset.name.replace(/[^\w\- ]+/g, "").trim() || "look";
      try {
        const saved = await saveTextFile(
          `${safe}.${USER_PRESET_EXTENSION}`,
          serializeUserPreset(preset),
          [{ name: "Beatform look", extensions: [USER_PRESET_EXTENSION] }],
        );
        if (saved) flashNotice(`Look exported${isTauri() ? ` to ${saved}` : ""}`);
      } catch (e) {
        set({ error: `Could not export look: ${(e as Error).message}` });
      }
    },

    analyzeCurrentTrack() {
      const buf = getEngine().audioBuffer;
      if (!buf) return;
      // Peak-envelope overview for the timeline (cheap; ~4k buckets)
      {
        const data = buf.getChannelData(0);
        const buckets = 4096;
        const overview = new Float32Array(buckets);
        const per = Math.max(1, Math.floor(data.length / buckets));
        for (let b = 0; b < buckets; b++) {
          let peak = 0;
          const base = b * per;
          for (let i = 0; i < per && base + i < data.length; i++) {
            const v = Math.abs(data[base + i]);
            if (v > peak) peak = v;
          }
          overview[b] = peak;
        }
        set({ waveformOverview: overview });
      }
      const id = ++analysisId;
      set({ beatGrid: null, trackKey: null, sections: [], analyzing: true });
      getAnalyzer().setBeatGrid(null);
      const { result } = analyzeTrack(buf);
      void result.then(({ grid, key, sections }) => {
        if (id !== analysisId) return; // a newer track superseded this job
        set({ beatGrid: grid, trackKey: key, sections, analyzing: false });
        getAnalyzer().setBeatGrid(grid);
      });
    },

    refreshOverlay() {
      // Debounced (resize storms) + token-guarded (async raster races)
      clearTimeout(overlayTimer);
      overlayTimer = setTimeout(async () => {
        const token = ++overlayToken;
        const canvas = liveCanvas;
        if (!canvas) return;
        try {
          const bitmap = await rasterizeOverlay(
            get().overlayLayers,
            get().assets,
            canvas.width,
            canvas.height,
            get().trackMeta,
          );
          if (token !== overlayToken) {
            bitmap?.close(); // superseded by a newer raster — release it
            return;
          }
          const s = get();
          const dyn = overlayDynamics(s);
          if (hasDynamics(dyn)) {
            // Dynamic layers (lyrics/audiogram) ride on top of the static
            // overlay: retain the base and hand the renderer a composed copy
            // (it closes what it's given). The next tick swaps in fresh copies.
            overlayBase?.close();
            overlayBase = bitmap;
            const t = getEngine().currentTime;
            shared.lastFrameKey = overlayFrameKeyAt(dyn, t, canvas.width);
            const composed = await composeOverlayFrame(
              overlayBase,
              dyn,
              t,
              canvas.width,
              canvas.height,
            );
            if (token === overlayToken) getRenderer()?.setOverlay(composed);
            else composed.close();
          } else {
            overlayBase?.close();
            overlayBase = null;
            getRenderer()?.setOverlay(bitmap); // takes ownership (closes it)
          }
        } catch (e) {
          console.error("[overlay]", e);
        }
      }, 60);
    },

    async importUserPreset() {
      try {
        const picked = await openTextFile([
          { name: "Beatform look", extensions: [USER_PRESET_EXTENSION] },
        ]);
        if (!picked) return;
        const preset = parseUserPreset(picked.contents);
        const userPresets = [preset, ...get().userPresets];
        set({ userPresets });
        saveUserPresets(userPresets);
        get().applyUserPreset(preset.id);
        flashNotice(`Look "${preset.name}" imported`);
      } catch (e) {
        set({
          error:
            e instanceof UserPresetParseError
              ? `Could not import look: ${e.message}`
              : `Could not import look: ${(e as Error).message}`,
        });
      }
    },
  };
});

/** True while an export is running — guards Escape-to-close and modal close. */
export function isExporting(): boolean {
  const s = useVizStore.getState();
  // batchStatus matters on its own: `exporting` goes null between jobs while
  // the next track decodes, and a batch is still very much exporting there.
  return s.exporting !== null || s.batchStatus === "running";
}
