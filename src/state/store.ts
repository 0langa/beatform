import { create } from "zustand";
import type { PlaybackState, SyncSettings } from "../audio/types";
import { DEFAULT_SYNC, sanitizeSync } from "../audio/types";
import { buildExportOptions } from "../export/buildExportOptions";
import { readTrackMeta } from "../audio/trackMeta";
import { pcmFromAudioBuffer } from "../audio/offlineSource";
import { wavFromPcm } from "../audio/dsp/wav";
import {
  expandJobs,
  isRunComplete,
  newBatchId,
  retryFailed,
  safeName,
  takenPaths,
  type BatchRun,
  type BatchTrack,
} from "./batch";
import { runBatch } from "./batchRunner";
import type { FormatPreset } from "../export/buildExportOptions";
import {
  CODEC_LABELS,
  probeCodecs,
  type CodecSupport,
  type VideoCodecId,
} from "../export/codecProbe";
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
import {
  customPresets,
  newCustomPresetId,
  parseCustomPreset,
  registerCustomPreset,
  serializeCustomPreset,
  ShaderParseError,
  unregisterCustomPreset,
  validCustomPreset,
} from "../render/presets/custom";
import { WebGPURenderer } from "../render/webgpuRenderer";
import {
  analyzeStem,
  MAX_STEMS,
  STEM_SLOTS,
  stemValuesAt,
  type StemEntry,
  type StemSlot,
} from "../audio/stems";
import { allParams, defaultParams } from "../render/types";
import { stemRoutesFor } from "./stemRouting";
import { presetById, presets } from "../render/presets";
import { exportVideo } from "../export/videoExporter";
import { APP_VERSION } from "../version";
import { getAnalyzer, getEngine, getRenderer, initServices, remeasure } from "./services";
import { analyzeTrack } from "../audio/analysis/trackAnalysis";
import type { BeatGrid } from "../audio/analysis/beatGrid";
import type { KeyEstimate } from "../audio/analysis/keyDetect";
import { newRouteId, type ModRoute, type ModSource } from "./modMatrix";
import { clearHistory, historyDepths, popRedo, popUndo, pushHistory } from "./history";
import type { Timeline } from "./timeline";
import { LyricParseError, parseLyrics, type LyricLine, type LyricStyle } from "./lyrics";
import { autoArrangeScenes, overviewEnergy } from "./autoArrange";
import {
  composeOverlayFrame,
  hasDynamics,
  overlayFrameKeyAt,
  sameOverlayFrame,
  type OverlayDynamics,
  type OverlayFrameKey,
} from "../render/dynamicOverlay";
import { audiogramActive, type AudiogramSettings } from "./audiogram";
import type { MotionSettings, PostSettings } from "../render/types";
import {
  downloadBlob,
  isTauri,
  openImageFile,
  openVideoFile,
  openTextFile,
  pickFolder,
  pickSavePath,
  proresAbort,
  animBegin,
  proresBegin,
  proresFinish,
  proresSetAudio,
  proresWrite,
  readBinaryFromPath,
  saveTextFile,
  scanAudioLibrary,
  startLoopback,
  stopLoopback,
  writeAutosave,
  type LibraryTrack,
} from "./platform";
import {
  defaultImageLayer,
  defaultTextLayer,
  pruneBitmapCache,
  rasterizeOverlay,
  type ImageLayer,
  type OverlayAsset,
  type OverlayLayer,
  type OverlayMeta,
  type TextLayer,
} from "../render/overlay";
import {
  parseProject,
  PROJECT_EXTENSION,
  ProjectParseError,
  serializeProject,
  type Aspect,
  type ProjectDocument,
} from "./project";
import { parseTheme, serializeTheme, ThemeParseError, type ThemeMeta } from "./themes";
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
  saveStoredMidiBindings,
} from "./persistence";
import { crossedBoundary, hasFutureBoundary, type QuantizeMode } from "./quantize";
import {
  applyMidiMessage,
  bindingId,
  learnBinding,
  upsertBinding,
  type MidiBinding,
  type MidiLearn,
} from "./midi";
import { startMidi, type MidiHandle } from "./midiInput";

export const RESOLUTIONS = [
  { label: "720p (1280×720)", w: 1280, h: 720, aspect: "16:9" },
  { label: "1080p (1920×1080)", w: 1920, h: 1080, aspect: "16:9" },
  { label: "1440p (2560×1440)", w: 2560, h: 1440, aspect: "16:9" },
  { label: "4K (3840×2160)", w: 3840, h: 2160, aspect: "16:9" },
  { label: "Square (1080×1080)", w: 1080, h: 1080, aspect: "1:1" },
  { label: "Vertical (1080×1920)", w: 1080, h: 1920, aspect: "9:16" },
  { label: "Vertical 4K (2160×3840)", w: 2160, h: 3840, aspect: "9:16" },
] as const;

/** Resolution indices offered for a frame aspect ("free" offers all). */
export function resolutionsForAspect(aspect: Aspect): number[] {
  const all = RESOLUTIONS.map((_, i) => i);
  if (aspect === "free") return all;
  return all.filter((i) => RESOLUTIONS[i].aspect === aspect);
}

/**
 * resIdx if it is valid for the aspect, else the aspect's preferred default.
 * Every path that changes aspect OR resIdx-out-from-under-the-aspect must go
 * through this (setAspect, store init, applyDocument) — otherwise the export
 * Resolution select renders blank and the export contradicts the frame.
 */
export function reconciledResIdx(aspect: Aspect, resIdx: number): number {
  const allowed = resolutionsForAspect(aspect);
  return allowed.includes(resIdx) ? resIdx : allowed[allowed.length > 1 ? 1 : 0];
}

export function autoBitrateMbps(w: number, h: number, fps: number): number {
  return Math.min(60, Math.max(2, Math.round((w * h * fps * 0.09) / 1e6)));
}

export interface ExportProgress {
  done: number;
  total: number;
  /** Encode speed in frames/s, measured over the run; null until known. */
  speed: number | null;
}

export interface ExportSettings {
  resIdx: number;
  fps: number;
  autoRate: boolean;
  manualMbps: number;
  /** Video codec — offered only when the hardware probe confirms support. */
  codec: VideoCodecId;
  /** "video" = whole track; "canvas" = 3-8 s seamless loop (Spotify Canvas). */
  mode: "video" | "canvas";
  canvasStart: number;
  canvasDuration: number;
  /**
   * "mp4" = H.264 + audio in one file. "png" = PNG image sequence into a
   * folder, keeping alpha when the background is Transparent (for editors).
   * "prores" = ProRes 4444 .mov via the ffmpeg sidecar. "gif"/"webp" =
   * animated loop files via the same sidecar (no audio; pair with Canvas
   * loop mode for seamless loops).
   */
  format: "mp4" | "png" | "prores" | "gif" | "webp";
  /**
   * Integrated-loudness target for the exported audio (LUFS), or null to leave
   * the track at its own level. Off by default — silently changing someone's
   * master is not a default. Audio-only; the visuals never move.
   */
  loudnessTarget: number | null;
  /** True-peak ceiling the limiter holds when normalizing (dBTP). */
  truePeakDb: number;
}

/** Loudness targets people actually deliver to. */
export const LOUDNESS_PRESETS: { label: string; hint: string; lufs: number }[] = [
  { label: "-14", hint: "Streaming (Spotify, YouTube, Apple Music)", lufs: -14 },
  { label: "-16", hint: "Podcasts, spoken word", lufs: -16 },
  { label: "-23", hint: "EBU R128 broadcast", lufs: -23 },
];

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
  dragOver: boolean;
  showPanel: boolean;
  showHelp: boolean;
  showExport: boolean;
  error: string | null;
  /** Transient positive feedback (project saved, preset imported, …). */
  notice: string | null;
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

// Non-serializable ephemera live outside the state object.
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let exportAbort: AbortController | null = null;
/** Stops the whole batch; separate from the per-job controller so that
 * skipping one job never ends the night. */
let batchAbort: AbortController | null = null;
/** Claimed synchronously by startBatch, before the folder dialog awaits. */
let batchStarting = false;
/** Synchronous claim for runExport — set before its dialog awaits, so a
 * double-click cannot launch two exports sharing one abort controller. */
let exportStarting = false;
let exportStartedAt = 0;
/** Monotonic track-load counter: a slow decode/tag-scan must not write its
 * metadata (or trigger analysis) over a newer load's. */
let trackLoadGen = 0;
/** Next library track, read + decoded ahead of time while the current one
 * plays, so auto-advance is near-gapless instead of paying disk + decode. */
let libraryPrefetch: { path: string; file: File; buffer: AudioBuffer } | null = null;
/** Live canvas — overlay rasters at its pixel size. Set by initApp. */
let liveCanvas: HTMLCanvasElement | null = null;
let overlayTimer: ReturnType<typeof setTimeout> | undefined;
/** Static overlay bitmap RETAINED while lyrics are active: the compositor
 * redraws base+line on every line/fade-step change, so the renderer only
 * ever receives composed copies (it closes what it's handed). */
let overlayBase: ImageBitmap | null = null;
/** Decoded video-background loop; the frame tick uploads the frame for t. */
let videoBgFrames: VideoBgFrames | null = null;
const NULL_FRAME_KEY: OverlayFrameKey = {
  lyricIdx: -2,
  lyricAlphaQ: -1,
  progressPx: -2,
  clockSec: -2,
};
let lastFrameKey: OverlayFrameKey = NULL_FRAME_KEY;
// Previous frame's track time, for beat-quantized switch takeover. Live-only.
let lastQuantizeTick = -1;
// Active Web MIDI listener handle (null = off). Session-only.
let midiHandle: MidiHandle | null = null;
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
/** Orders library clicks by CLICK time, not disk-read completion. */
let libraryClickGen = 0;
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
      libraryPrefetch = null;
      return;
    }
    const next = s.library.tracks[i + 1];
    if (libraryPrefetch?.path === next.path) return;
    libraryPrefetch = null;
    try {
      const bytes = await readBinaryFromPath(next.path);
      const file = new File([bytes as BlobPart], next.fileName);
      const buffer = await getEngine().ctx.decodeAudioData(await file.arrayBuffer());
      // Only keep it if the user is still on the track we prefetched FOR.
      if (get().library?.tracks[i + 1]?.path === next.path) {
        libraryPrefetch = { path: next.path, file, buffer };
      }
    } catch {
      libraryPrefetch = null; // advance falls back to the plain load path
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
  const applyBgImage = () => {
    const token = ++bgImageToken;
    const { bg, assets } = get();
    const asset = bg.mode === BG_IMAGE && bg.image ? assets[bg.image.assetId] : undefined;
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
    const token = ++videoBgToken;
    const { bg, assets } = get();
    const asset = bg.mode === BG_VIDEO && bg.video ? assets[bg.video.assetId] : undefined;
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
        set({
          videoBgLoading: false,
          error: `Could not load video background: ${(e as Error).message}`,
        });
      });
  };

  /** Crash-safe project autosave (desktop), debounced past edit bursts. */
  const scheduleAutosave = () => {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      void writeAutosave(serializeProject(docOf(get()), APP_VERSION)).catch((e) =>
        console.error("[autosave]", e),
      );
    }, 5000);
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
    dragOver: false,
    showPanel: loadStoredPanelOpen(),
    showHelp: false,
    showExport: false,
    error: null,
    notice: null,
    userPresets: loadUserPresets(),
    trackMeta: { title: "", artist: "" },
    coverArt: null,
    lufs: null,
    stereoWidth: 0,
    beatGrid: null,
    trackKey: null,
    sections: [],
    waveformOverview: null,
    showTimeline: localStorage.getItem("viz.timelineOpen") === "1",
    analyzing: false,
    undoDepth: 0,
    redoDepth: 0,
    exportSettings: {
      // The aspect persists across launches; the resolution must match it or
      // the export select renders blank and exports the wrong shape.
      resIdx: reconciledResIdx(loadStoredAspect(), 1),
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
    },
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
          set({ rendererKind: kind, error: warning });
          getRenderer()?.setSmoothSpectrum(get().smoothSpectrum);
          getRenderer()?.setPost(get().post);
          getRenderer()?.setMotion(get().motion);
          applyCoverArt(); // new renderer starts without a cover bound
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
          if (sameOverlayFrame(key, lastFrameKey)) return;
          lastFrameKey = key;
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
      get().switchPreset(all[(i + delta + all.length) % all.length].id);
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

    async enableMidi() {
      if (get().midiEnabled || midiHandle) return;
      const handle = await startMidi(
        (data) => get().handleMidiMessage(data),
        (names) => set({ midiDevices: names }),
      );
      if (!handle) {
        flashNotice("MIDI isn't available here (needs a Chromium-based build)");
        return;
      }
      midiHandle = handle;
      set({ midiEnabled: true });
    },

    disableMidi() {
      midiHandle?.stop();
      midiHandle = null;
      set({ midiEnabled: false, midiDevices: [], midiLearn: null });
    },

    handleMidiMessage(data) {
      const s = get();
      // Learn mode: the first matching message becomes a binding, and is NOT
      // also applied (so wiggling the control to learn it doesn't fire it).
      if (s.midiLearn) {
        const b = learnBinding(s.midiLearn, data);
        if (b) {
          const midiBindings = upsertBinding(s.midiBindings, b);
          set({ midiBindings, midiLearn: null });
          saveStoredMidiBindings(midiBindings);
        }
        return;
      }
      const action = applyMidiMessage(s.midiBindings, data);
      if (!action) return;
      if (action.type === "param") {
        // A binding can outlive a mode switch — only drive a param the active
        // preset actually has, and clamp to its range.
        const spec = allParams(presetById(s.presetId)).find((p) => p.key === action.key);
        if (spec) get().setParam(action.key, Math.min(spec.max, Math.max(spec.min, action.value)));
      } else {
        get().queuePreset(action.id); // inherits the beat-quantize takeover
      }
    },

    setMidiLearn(learn) {
      set({ midiLearn: learn });
    },

    removeMidiBinding(id) {
      const midiBindings = get().midiBindings.filter((b) => bindingId(b) !== id);
      set({ midiBindings });
      saveStoredMidiBindings(midiBindings);
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
      record("bg");
      set({ bg });
      saveStoredBg(bg);
      getRenderer()?.setBackground(bg);
      applyBgImage();
      applyVideoBg();
    },

    async pickBackgroundImage() {
      const img = await openImageFile();
      if (!img) return;
      record("bg");
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
      const prevId = prev.image?.assetId;
      if (prevId && !get().overlayLayers.some((l) => "assetId" in l && l.assetId === prevId)) {
        delete assets[prevId];
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
      record("bg");
      const asset: OverlayAsset = {
        id: `as-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: vid.name,
        dataUrl: vid.dataUrl,
      };
      const assets = { ...get().assets, [asset.id]: asset };
      const prev = get().bg;
      // Orphan-GC the previous video/image asset (same as pickBackgroundImage).
      const prevId = prev.video?.assetId ?? prev.image?.assetId;
      if (prevId && !get().overlayLayers.some((l) => "assetId" in l && l.assetId === prevId)) {
        delete assets[prevId];
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
      record("bg");
      const asset: OverlayAsset = {
        id: `as-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: "Album art",
        dataUrl: cover,
      };
      const assets = { ...get().assets, [asset.id]: asset };
      const prev = get().bg;
      // Same orphan-GC as pickBackgroundImage.
      const prevId = prev.image?.assetId;
      if (prevId && !get().overlayLayers.some((l) => "assetId" in l && l.assetId === prevId)) {
        delete assets[prevId];
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
      localStorage.setItem("viz.timelineOpen", v ? "1" : "0");
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
      const gen = ++trackLoadGen;
      try {
        // A direct load (drop, file picker) leaves the library: clear the
        // active marker so auto-advance stops. playLibraryTrack re-sets it.
        set({ error: null, libraryActivePath: null });
        await getEngine().loadFile(file);
        if (gen !== trackLoadGen) return;
        await getEngine().play();
        // Tag metadata (title/artist/cover) — best effort, never blocks
        // playback, so no duration scan here. Shared with the batch queue.
        const { meta, coverArt } = await readTrackMeta(file, file.name);
        if (gen !== trackLoadGen) return;
        // Stems are per-track: envelopes analyzed against the old track have
        // no time relationship to the new one, so carrying them over would
        // modulate the new track with the old track's rhythm.
        set({ trackMeta: meta, coverArt, stems: [], lyrics: null, lyricFileName: null });
        applyCoverArt();
        get().refreshOverlay();
        get().analyzeCurrentTrack();
      } catch (e) {
        if (gen !== trackLoadGen) return;
        set({ error: `Could not decode "${file.name}" (${(e as Error).message})` });
      }
    },

    async loadDemo(id) {
      if (get().liveInputActive) await get().toggleLiveInput();
      const gen = ++trackLoadGen;
      try {
        set({ error: null });
        const demo = demos.find((d) => d.id === id);
        if (!demo) return;
        const engine = getEngine();
        const buf = await demo.render(engine.ctx.sampleRate);
        if (gen !== trackLoadGen) return;
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
        if (gen !== trackLoadGen) return;
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

    setShowLibrary(open) {
      set({ showLibrary: open });
    },

    loadPresetThumbnails() {
      if (get().presetThumbs) return;
      void renderPresetThumbnails().then((presetThumbs) => {
        if (Object.keys(presetThumbs).length > 0) set({ presetThumbs });
      });
    },

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
      const gen = trackLoadGen;
      try {
        // Decode on the ENGINE's context: a fresh OfflineAudioContext would
        // resample and shift every FFT bin (the batch learned this once).
        const buf = await getEngine().ctx.decodeAudioData(await file.arrayBuffer());
        const analysis = await analyzeStem(pcmFromAudioBuffer(buf), file.name);
        if (gen !== trackLoadGen) return;
        set({ stems: [...get().stems, { slot, analysis }] });
        flashNotice(`Stem "${analysis.name}" ready — route it in Modulation`);
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
        flashNotice("This visual has no knobs that map to stem bands");
        return;
      }
      record("mod-add");
      const activeMods = [...kept, ...added];
      const modsByPreset = { ...s.modsByPreset, [s.presetId]: activeMods };
      set({ activeMods, modsByPreset });
      saveStoredMods(modsByPreset);
      flashNotice(`Wired ${added.length} routes from the stem — tweak amounts in Modulation`);
    },

    setShowShaderEditor(open) {
      set({ showShaderEditor: open });
    },

    async checkCustomPreset(def) {
      const r = getRenderer();
      if (!(r instanceof WebGPURenderer)) {
        return ["Custom presets need the WebGPU renderer (Canvas2D fallback active)"];
      }
      return r.compilePresetCheck(def);
    },

    async saveCustomPreset(defIn) {
      const def = validCustomPreset(defIn);
      if (!def) return ["Preset failed validation (id/name/params/wgsl shape)"];
      const errors = await get().checkCustomPreset(def);
      if (errors.length > 0) return errors;
      registerCustomPreset(def);
      const customDefs = [...get().customDefs.filter((d) => d.id !== def.id), def];
      set({ customDefs });
      // Quota failure must not hide behind a success toast — the shader would
      // exist this session and silently vanish on restart.
      const persisted = saveCustomPresets(customDefs);
      get().switchPreset(def.id);
      flashNotice(
        persisted
          ? `Custom visual "${def.name}" saved`
          : `"${def.name}" is active but too large to remember — export it as .avshader to keep it`,
      );
      return [];
    },

    deleteCustomPreset(id) {
      unregisterCustomPreset(id);
      const customDefs = get().customDefs.filter((d) => d.id !== id);
      set({ customDefs });
      saveCustomPresets(customDefs);
      // Never leave the app pointing at a deleted visual.
      if (get().presetId === id) get().switchPreset(presets[0].id);
      // Timeline scenes too: a scene keeping the dead id would silently
      // render the default visual live AND in exports (and the next reload's
      // validTimeline would drop the scene outright).
      const tl = get().timeline;
      if (tl.scenes.some((s) => s.presetId === id)) {
        const repaired = {
          ...tl,
          scenes: tl.scenes.map((s) =>
            s.presetId === id ? { ...s, presetId: get().presetId } : s,
          ),
        };
        set({ timeline: repaired });
        saveStoredTimeline(repaired);
        flashNotice("Timeline scenes using the deleted visual now use the active one");
      }
    },

    async exportCustomPreset(id) {
      const def =
        get().customDefs.find((d) => d.id === id) ?? customPresets().find((d) => d.id === id);
      if (!def) return;
      try {
        const path = await saveTextFile(
          `${safeName(def.name)}.avshader`,
          serializeCustomPreset(def, APP_VERSION),
          [{ name: "Beatform shader", extensions: ["avshader"] }],
        );
        if (path) flashNotice(`Shader "${def.name}" saved — share the file anywhere`);
      } catch (e) {
        set({ error: `Could not save shader: ${(e as Error).message}` });
      }
    },

    async importCustomPresetText(contents) {
      try {
        const imported = parseCustomPreset(contents);
        // Mint a fresh id — an import must never silently overwrite an
        // existing custom visual that happens to share an id.
        const def: PresetDef = { ...imported, id: newCustomPresetId() };
        const errors = await get().saveCustomPreset(def);
        if (errors.length > 0) {
          set({ error: `Shader failed to compile: ${errors[0]}` });
        }
      } catch (e) {
        set({
          error:
            e instanceof ShaderParseError
              ? `Could not import shader: ${e.message}`
              : `Could not import shader: ${(e as Error).message}`,
        });
      }
    },

    loadLyricsText(fileName, contents) {
      try {
        const lyrics = parseLyrics(fileName, contents);
        set({ lyrics, lyricFileName: fileName, error: null });
        lastFrameKey = NULL_FRAME_KEY; // force the first recompose
        get().refreshOverlay();
        flashNotice(`Lyrics loaded — ${lyrics.length} lines from ${fileName}`);
      } catch (e) {
        set({
          error:
            e instanceof LyricParseError
              ? e.message
              : `Could not read lyrics: ${(e as Error).message}`,
        });
      }
    },

    clearLyrics() {
      set({ lyrics: null, lyricFileName: null });
      get().refreshOverlay();
    },

    setLyricStyle(patch) {
      const lyricStyle = { ...get().lyricStyle, ...patch };
      set({ lyricStyle });
      saveStoredLyricStyle(lyricStyle);
      lastFrameKey = NULL_FRAME_KEY;
      get().refreshOverlay();
    },

    setAudiogram(patch) {
      const audiogram = { ...get().audiogram, ...patch };
      set({ audiogram });
      saveStoredAudiogram(audiogram);
      lastFrameKey = NULL_FRAME_KEY;
      get().refreshOverlay();
    },

    async pickLibraryFolder() {
      if (!isTauri()) {
        set({ error: "The music library needs the desktop app (it scans a folder)" });
        return;
      }
      const dir = await pickFolder("Choose your music folder");
      if (!dir) return;
      set({ libraryScanning: true });
      try {
        const tracks = await scanAudioLibrary(dir);
        set({ library: { dir, tracks } });
        libraryPrefetch = null;
        if (tracks.length === 0) flashNotice("No audio files found in that folder");
      } catch (e) {
        set({ error: `Library scan failed: ${(e as Error).message}` });
      } finally {
        set({ libraryScanning: false });
      }
    },

    async playLibraryTrack(path) {
      const entry = get().library?.tracks.find((t) => t.path === path);
      if (!entry) return;
      // Claim the click BEFORE the disk read: without this, ordering was
      // decided by read completion — a slow first click could beat a fast
      // second one because loadFile's own generation was claimed too late.
      const click = ++libraryClickGen;
      try {
        // Bytes -> File -> the ordinary loadFile path: decode, tags, cover
        // art, beat-grid analysis and generation guards all come for free.
        const bytes = await readBinaryFromPath(path);
        if (click !== libraryClickGen) return; // a later click superseded us
        const tgBefore = trackLoadGen;
        const file = new File([bytes as BlobPart], entry.fileName);
        await get().loadFile(file);
        // Mark active only if OUR load won: loadFile claims tgBefore+1
        // synchronously, so any other claim since means we were superseded.
        // (Comparing trackName to fileName here mismarked duplicates — two
        // library entries can share a basename across subfolders.)
        if (trackLoadGen === tgBefore + 1) {
          set({ libraryActivePath: path });
          void prefetchNextLibraryTrack();
        }
      } catch (e) {
        set({ error: `Could not read "${entry.fileName}" (${(e as Error).message})` });
      }
    },

    async advanceLibrary() {
      const s = get();
      if (!s.libraryAutoAdvance || !s.library || !s.libraryActivePath) return;
      const i = s.library.tracks.findIndex((t) => t.path === s.libraryActivePath);
      if (i < 0 || i + 1 >= s.library.tracks.length) return; // end: stop
      const next = s.library.tracks[i + 1];
      const pre = libraryPrefetch;
      if (pre && pre.path === next.path) {
        // Near-gapless: disk read + decode already happened during playback.
        const gen = ++trackLoadGen;
        const engine = getEngine();
        engine.loadBuffer(pre.buffer, pre.file.name);
        await engine.play();
        const { meta, coverArt } = await readTrackMeta(pre.file, pre.file.name);
        if (gen !== trackLoadGen) return;
        set({
          trackMeta: meta,
          coverArt,
          stems: [],
          lyrics: null,
          lyricFileName: null,
          libraryActivePath: next.path,
          error: null,
        });
        applyCoverArt();
        get().refreshOverlay();
        get().analyzeCurrentTrack();
        void prefetchNextLibraryTrack();
      } else {
        await get().playLibraryTrack(next.path);
      }
    },

    setLibraryAutoAdvance(v) {
      set({ libraryAutoAdvance: v });
    },

    applyTheme(document, name) {
      // ONE history entry: Ctrl+Z restores the entire previous setup.
      record("theme");
      get().applyDocument(document);
      flashNotice(`Template "${name}" applied`);
    },

    importThemeText(contents) {
      try {
        const { meta, document } = parseTheme(contents);
        get().applyTheme(document, meta.name);
        if (meta.author !== "unknown") flashNotice(`"${meta.name}" by ${meta.author} applied`);
      } catch (e) {
        set({
          error:
            e instanceof ThemeParseError
              ? `Could not import template: ${e.message}`
              : `Could not import template: ${(e as Error).message}`,
        });
      }
    },

    async exportCurrentTheme(meta) {
      try {
        const path = await saveTextFile(
          `${safeName(meta.name)}.avtheme`,
          serializeTheme(docOf(get()), meta, APP_VERSION),
          [{ name: "Beatform template", extensions: ["avtheme"] }],
        );
        if (path) flashNotice(`Template "${meta.name}" saved — share the file anywhere`);
      } catch (e) {
        set({ error: `Could not save template: ${(e as Error).message}` });
      }
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

    setShowHelp(showHelp) {
      set({ showHelp });
    },

    setShowExport(showExport) {
      set({ showExport });
      // Probe codec support the first time the panel opens — the result is
      // hardware-fixed for the session, and the select renders from it.
      if (showExport && !get().codecSupport) {
        void probeCodecs().then((codecSupport) => {
          set({ codecSupport });
          // A previously chosen codec can be unsupported (settings survive
          // the probe in dev hot-reload scenarios) — snap back to H.264.
          if (!codecSupport[get().exportSettings.codec]) {
            get().setExportSettings({ codec: "h264" });
          }
        });
      }
    },

    setExportSettings(patch) {
      const next = { ...get().exportSettings, ...patch };
      // Canvas loops upload as videos — PNG/ProRes make no sense there, and
      // leaving them selected silently exported an MP4 while the panel still
      // said PNG. Coerce so the UI always tells the truth.
      if (next.mode === "canvas" && (next.format === "png" || next.format === "prores")) {
        next.format = "mp4";
      }
      set({ exportSettings: next });
    },

    async runExport() {
      const engine = getEngine();
      const buf = engine.audioBuffer;
      if (!buf) return;
      // Re-entrancy guard. The UI hides the Export button while `exporting` is
      // set, but that is not a guarantee: a batch clears `exporting` between
      // jobs while it decodes the next track, and a second export starting
      // there would overwrite the shared abort controller and break cancel for
      // the run that is already going.
      if (get().exporting || get().batchStatus === "running" || exportStarting) return;
      // `exporting` is only set AFTER the native save dialog below — claim the
      // slot synchronously so a double-click cannot pass the guard twice and
      // clobber the shared abort controller (same hole startBatch had).
      exportStarting = true;
      const settings = get().exportSettings;
      const canvasMode = settings.mode === "canvas";
      // Canvas loops are fixed to the Spotify spec: 9:16, 30 fps, 3-8 s
      const res = canvasMode ? { w: 1080, h: 1920 } : RESOLUTIONS[settings.resIdx];
      const fps = canvasMode ? 30 : settings.fps;
      const mbps = settings.autoRate ? autoBitrateMbps(res.w, res.h, fps) : settings.manualMbps;
      const segment = canvasMode
        ? {
            start: Math.max(
              0,
              Math.min(settings.canvasStart, buf.duration - settings.canvasDuration),
            ),
            duration: Math.min(settings.canvasDuration, buf.duration),
          }
        : undefined;
      // Same filename rules as the batch queue — the old \w-based sanitizer
      // silently destroyed every non-ASCII title ("夜に駆ける" -> "").
      const baseName = `${safeName(engine.state.trackName ?? "visualization")}${canvasMode ? "-canvas" : ""}`;
      const pngMode = settings.format === "png" && !canvasMode;
      // ProRes goes through the ffmpeg sidecar; canvas loops stay MP4.
      const proresMode = settings.format === "prores" && !canvasMode;
      // GIF/WebP loops go through the same sidecar — allowed in canvas mode
      // too (a seamless 3-8 s loop is the format's whole point).
      const animFormat =
        settings.format === "gif" || settings.format === "webp" ? settings.format : null;
      // VP9+alpha muxes into WebM (canvas loops force H.264, so never there).
      const webmMode = settings.format === "mp4" && settings.codec === "vp9a" && !canvasMode;
      const ext = proresMode ? ".mov" : animFormat ? `.${animFormat}` : webmMode ? ".webm" : ".mp4";
      const fileName = `${baseName}${ext}`;
      // Desktop: pick the destination BEFORE rendering — a cancelled dialog
      // after a long 4K render would throw the work away.
      // The dialog is also a window where a new track can land (loadFile has
      // no export guard, deliberately): `buf` above is the OLD track, while
      // everything read after the dialog (meta, grid, stems, cover) would be
      // the NEW one — a mixed-track export. Detect and bail instead.
      const genAtStart = trackLoadGen;
      let savePath: string | null = null;
      let pngDir: string | null = null;
      if (isTauri()) {
        if (pngMode) {
          const dir = await pickFolder("Choose a folder for the PNG sequence");
          if (!dir) {
            exportStarting = false;
            return;
          }
          // Keep each run in its own subfolder so sequences never interleave.
          pngDir = `${dir}/${baseName}_frames`;
        } else {
          savePath = await pickSavePath(
            fileName,
            proresMode
              ? [{ name: "QuickTime (ProRes)", extensions: ["mov"] }]
              : animFormat
                ? [
                    {
                      name: animFormat === "gif" ? "GIF animation" : "WebP animation",
                      extensions: [animFormat],
                    },
                  ]
                : webmMode
                  ? [{ name: "WebM video", extensions: ["webm"] }]
                  : [{ name: "MP4 video", extensions: ["mp4"] }],
          );
          if (!savePath) {
            exportStarting = false;
            return;
          }
        }
      } else if (pngMode || proresMode || animFormat) {
        set({
          exportError: pngMode
            ? "PNG sequence export needs the desktop app (it writes a folder)"
            : animFormat
              ? "GIF/WebP export needs the desktop app (it runs the bundled ffmpeg)"
              : "ProRes export needs the desktop app (it runs the bundled ffmpeg)",
        });
        exportStarting = false;
        return;
      }
      if (genAtStart !== trackLoadGen) {
        set({ exportError: "The track changed while the save dialog was open — export cancelled" });
        exportStarting = false;
        return;
      }
      const ac = new AbortController();
      exportAbort = ac;
      exportStartedAt = performance.now();
      set({
        exportError: null,
        exportDone: null,
        exporting: { done: 0, total: 1, speed: null },
      });
      // ProRes: frames stream to the ffmpeg sidecar as they render; writes
      // are chained so ordering is exact, and a dead sidecar aborts the
      // render instead of piling frames into a rejected promise.
      let proresChain = Promise.resolve();
      // Object holder: assignments happen inside callbacks, which TS's flow
      // analysis can't see on a plain let (it narrows the reads to null).
      // `unknown`, not Error: Tauri command rejections are raw strings.
      const proresFail: { err: unknown } = { err: null };
      // GIF/WebP share the ProRes frame pipe (one sidecar session at a time).
      const sidecarMode = proresMode || !!animFormat;
      // Tauri invoke() rejects with the Rust command's raw STRING, not an
      // Error — reading .message off it yields undefined, which is what the
      // export error toast used to show for every sidecar failure.
      const errText = (x: unknown): string =>
        x instanceof Error ? x.message : typeof x === "string" ? x : String(x);
      // Hoisted so the finally can close it even when exportVideo throws (e.g.
      // WebGPU init fails) — the batch runner already closes its overlay; this
      // path leaked the rasterized ImageBitmap on the error path.
      let overlayBitmap: ImageBitmap | undefined;
      try {
        if (proresMode && savePath) {
          // Original (un-normalized) audio: a mezzanine keeps source levels.
          await proresSetAudio(wavFromPcm(pcmFromAudioBuffer(buf)));
          await proresBegin(fps, savePath);
        } else if (animFormat && savePath) {
          await animBegin(animFormat, fps, savePath);
        }
        // Same rasterizer as the live view, at export resolution — WYSIWYG
        overlayBitmap =
          (await rasterizeOverlay(
            get().overlayLayers,
            get().assets,
            res.w,
            res.h,
            get().trackMeta,
          )) ?? undefined;
        const overlay = overlayBitmap;
        // Everything the document contributes is resolved by the shared
        // builder, so the batch runner and this path cannot drift apart.
        const result = await exportVideo(
          buf,
          buildExportOptions(
            docOf(get()),
            {
              id: "live",
              label: "Export",
              w: res.w,
              h: res.h,
              fps,
              mbps,
              format: "mp4",
              // Canvas loops stay H.264 — they are for upload to platforms
              // whose ingest is pickiest about codecs.
              codec: canvasMode ? "h264" : settings.codec,
            },
            {
              name: engine.state.trackName ?? "visualization",
              meta: get().trackMeta,
              coverArt: get().coverArt,
              beatGrid: get().beatGrid,
              stems: get().stems,
              lyrics:
                get().lyrics && get().lyricStyle.enabled
                  ? { lines: get().lyrics!, style: get().lyricStyle }
                  : undefined,
              audiogram: audiogramActive(get().audiogram)
                ? { settings: get().audiogram, waveform: get().waveformOverview }
                : undefined,
              customPresets: get().customDefs,
            },
            overlay,
            {
              // Desktop: stream straight to the picked file (flat memory);
              // browser dev falls back to an in-memory blob + download.
              // ProRes renders PNG frames into the sidecar instead.
              streamToPath: sidecarMode ? undefined : (savePath ?? undefined),
              pngDir: pngDir ?? undefined,
              onPngFrame: sidecarMode
                ? (data) => {
                    proresChain = proresChain
                      .then(() => proresWrite(data))
                      .catch((e: unknown) => {
                        proresFail.err ??= e;
                        ac.abort(); // stop rendering — ffmpeg is gone
                      });
                  }
                : undefined,
              segment,
              loopCrossfadeSec: canvasMode ? 0.5 : undefined,
              // Only MP4 normalizes: PNG carries no audio, and a ProRes
              // mezzanine deliberately keeps the source levels.
              loudness:
                settings.loudnessTarget != null && settings.format === "mp4"
                  ? { targetLufs: settings.loudnessTarget, truePeakDb: settings.truePeakDb }
                  : undefined,
              signal: ac.signal,
              onProgress: (done, total) => {
                const elapsed = (performance.now() - exportStartedAt) / 1000;
                set({
                  exporting: {
                    done,
                    total,
                    speed: done > 0 && elapsed > 0 ? done / elapsed : null,
                  },
                });
              },
            },
          ),
        );
        if (sidecarMode) {
          // All frames rendered — drain the pipe, close it, wait for ffmpeg.
          await proresChain;
          if (proresFail.err != null) throw proresFail.err;
          await proresFinish();
          set({
            exportDone: proresMode
              ? `ProRes 4444 MOV (PCM audio) saved to ${savePath}`
              : `${animFormat === "gif" ? "GIF" : "WebP"} loop saved to ${savePath}`,
          });
        } else {
          if (result.blob) downloadBlob(result.blob, fileName);
          set({
            exportDone: pngDir
              ? `${(result.bytes / 1e6).toFixed(1)} MB PNG sequence saved to ${pngDir}`
              : `${(result.bytes / 1e6).toFixed(1)} MB ${
                  webmMode
                    ? "WebM (VP9 + alpha"
                    : `MP4 (${CODEC_LABELS[canvasMode ? "h264" : settings.codec].split(" ")[0]}`
                } + ${result.audioCodec.toUpperCase()}) saved${savePath ? ` to ${savePath}` : ""}`,
          });
        }
      } catch (e) {
        if (sidecarMode) await proresAbort().catch(() => undefined);
        // A dead sidecar aborts the render, so the surfaced error arrives
        // wearing an AbortError coat — check the sidecar failure FIRST or a
        // mid-render ffmpeg death reads as a user cancel and shows nothing.
        if (proresFail.err != null) {
          set({ exportError: errText(proresFail.err) });
        } else if ((e as Error)?.name !== "AbortError") {
          set({ exportError: errText(e) });
        }
      } finally {
        overlayBitmap?.close();
        set({ exporting: null });
        exportAbort = null;
        exportStarting = false;
      }
    },

    cancelExport() {
      exportAbort?.abort();
    },

    setShowBatch(open) {
      set({ showBatch: open });
    },

    async addBatchTracks(files) {
      // Guard BOTH ends. Reading tags takes seconds per file (a VBR scan), and
      // a run can start inside that window — writing a pre-await snapshot then
      // would blank the live run's jobs and flip batchStatus back to "idle",
      // which in turn defeats every other guard in this file.
      if (get().batchStatus === "running") {
        // The drop overlay invites exactly this — say why nothing happened.
        flashNotice("Batch is running — add tracks after it finishes");
        return;
      }
      // Reading each file's own tags IS the feature: no spreadsheet, no data
      // source, no manual titling. duration:true here (and only here) — the
      // queue needs it for its estimate and pays the VBR scan cost off the
      // interactive path.
      const added: BatchTrack[] = [];
      try {
        set({ batchScanning: files.length });
        for (const file of files) {
          const { meta, fromTags, coverArt, duration } = await readTrackMeta(file, file.name, {
            duration: true,
          });
          added.push({ id: newBatchId(), file, meta, metaFromTags: fromTags, coverArt, duration });
          set({ batchScanning: files.length - added.length });
        }
      } finally {
        set({ batchScanning: 0 });
      }
      // Re-read after the awaits, and bail if a run began while we scanned.
      if (get().batchStatus === "running") return;
      const cur = get().batch;
      set({
        batch: {
          doc: docOf(get()),
          formats: cur?.formats ?? [],
          outDir: cur?.outDir ?? "",
          startedAt: 0,
          tracks: [...(cur?.tracks ?? []), ...added],
          // KEEP the previous run's job records: takenPaths() reads them so a
          // later Start into the same folder never overwrites a video an
          // earlier run already finished. Wiping them here re-armed exactly
          // that overwrite.
          jobs: cur?.jobs ?? [],
        },
        batchStatus: "idle",
      });
    },

    removeBatchTrack(id) {
      const b = get().batch;
      if (!b || get().batchStatus === "running") return;
      set({ batch: { ...b, tracks: b.tracks.filter((t) => t.id !== id) } });
    },

    setBatchTrackMeta(id, meta) {
      const b = get().batch;
      if (!b) return;
      set({
        batch: {
          ...b,
          tracks: b.tracks.map((t) => (t.id === id ? { ...t, meta: { ...t.meta, ...meta } } : t)),
        },
      });
    },

    async startBatch() {
      const b = get().batch;
      if (!b || b.tracks.length === 0 || get().batchStatus === "running" || batchStarting) return;
      // Symmetric to runExport's batch check: two renders at once would fight
      // over the GPU and the shared progress/abort state (concurrency is 1 by
      // design — each export builds its own device + encoder session).
      if (get().exporting || exportStarting) {
        set({ exportError: "Finish (or cancel) the running export before starting a batch" });
        return;
      }
      if (!isTauri()) {
        set({ exportError: "Batch render needs the desktop app (it writes files to a folder)" });
        return;
      }
      // batchStatus does not become "running" until after the folder dialog, so
      // a double-click on Start would otherwise pass this guard twice and launch
      // two runs writing to the same paths. Claim the slot synchronously.
      batchStarting = true;
      let outDir: string | null = null;
      try {
        outDir = await pickFolder("Choose a folder for the rendered videos");
      } finally {
        if (!outDir) batchStarting = false;
      }
      if (!outDir) return;

      // The format the export panel is currently set to — one output shape in
      // this version; the model already fans out to several.
      const settings = get().exportSettings;
      const res = RESOLUTIONS[settings.resIdx];
      const fmt: FormatPreset = {
        id: "primary",
        label: res.label,
        w: res.w,
        h: res.h,
        fps: settings.fps,
        mbps: settings.autoRate ? autoBitrateMbps(res.w, res.h, settings.fps) : settings.manualMbps,
        format: "mp4",
        codec: settings.codec,
      };

      // Re-read after the folder dialog: a tag scan (addBatchTracks) may have
      // committed more tracks while it was open, and freezing the pre-dialog
      // snapshot would silently drop them from the run AND the panel.
      const tracks = get().batch?.tracks ?? b.tracks;
      if (tracks.length === 0) {
        batchStarting = false;
        return;
      }
      // Freeze the template NOW: the run renders what it started with, not
      // whatever gets edited at 2am. Also makes a retry reproduce the original.
      const run: BatchRun = {
        doc: docOf(get()),
        tracks,
        formats: [fmt],
        outDir,
        // Date.now, not performance.now: the panel's countdown ticks on Date.now
        // and prints a finish time, and mixing the two epochs makes elapsed
        // (and therefore every ETA) meaningless.
        startedAt: Date.now(),
        // Freeze the loudness target with the doc — the batch must deliver what
        // the export panel promises, not silently encode at source level.
        loudness:
          settings.loudnessTarget != null
            ? { targetLufs: settings.loudnessTarget, truePeakDb: settings.truePeakDb }
            : undefined,
        // The frozen doc only carries a custom preset's ID — the defs must
        // ride along or the export worker's empty registry silently renders
        // the default visual for every job.
        customPresets: get().customDefs,
        jobs: [],
      };
      // Never overwrite a video an earlier run already finished into this
      // folder. The previous run OBJECT only remembers one run back (and dies
      // with the session), so the disk itself is the authority: every file
      // already in the folder is a spoken-for name.
      const alreadyDone = get().batch ? takenPaths(get().batch!) : new Set<string>();
      for (const n of await fileNamesInDir(outDir)) alreadyDone.add(n);
      run.jobs = expandJobs(run.tracks, run.formats, outDir, alreadyDone);

      const ac = new AbortController();
      batchAbort = ac;
      set({ batch: run, batchStatus: "running", exportError: null });
      try {
        await runBatch(run, {
          onJobStart: (_id, jobAc) => {
            // Reuse the single-export controller so the existing Cancel path
            // means "skip this job" for free.
            exportAbort = jobAc;
          },
          onJobUpdate: (id, status) => {
            const cur = get().batch;
            if (!cur) return;
            const jobs = cur.jobs.map((j) => (j.id === id ? { ...j, status } : j));
            set({ batch: { ...cur, jobs } });
            // Mirror into `exporting` so the rest of the app already knows a
            // render is in flight: the Export button is conditionally rendered
            // on !exporting, and runExport has no re-entrancy guard, so
            // without this a click mid-batch would start a second export and
            // clobber the shared abort controller.
            set({
              exporting:
                status.k === "running"
                  ? { done: status.done, total: Math.max(1, status.total), speed: status.fps }
                  : null,
            });
          },
          shouldStop: () => ac.signal.aborted,
        });
      } finally {
        exportAbort = null;
        batchAbort = null;
        batchStarting = false;
        const cur = get().batch;
        set({
          exporting: null,
          batchStatus: cur && isRunComplete(cur) ? "done" : "idle",
        });
      }
    },

    dismissBatch() {
      if (get().batchStatus === "running") return;
      set({ batch: null, batchStatus: "idle" });
    },

    skipCurrentBatchJob() {
      // Aborts only the in-flight job; the loop moves to the next one.
      exportAbort?.abort();
    },

    cancelBatch() {
      batchAbort?.abort();
      exportAbort?.abort();
    },

    async retryFailedBatch() {
      const b = get().batch;
      if (!b || get().batchStatus === "running") return;
      // Same single-render rule as startBatch: never race a running export.
      if (get().exporting || exportStarting) {
        set({ exportError: "Finish (or cancel) the running export before retrying the batch" });
        return;
      }
      // Retry names must also avoid files OTHER runs left in this folder —
      // the run object only knows its own; the disk knows them all.
      const again = retryFailed(b, Date.now(), await fileNamesInDir(b.outDir));
      if (again.jobs.length === 0) return;
      const ac = new AbortController();
      batchAbort = ac;
      set({ batch: again, batchStatus: "running", exportError: null });
      try {
        await runBatch(again, {
          onJobStart: (_id, jobAc) => {
            exportAbort = jobAc;
          },
          onJobUpdate: (id, status) => {
            const cur = get().batch;
            if (!cur) return;
            set({
              batch: { ...cur, jobs: cur.jobs.map((j) => (j.id === id ? { ...j, status } : j)) },
              exporting:
                status.k === "running"
                  ? { done: status.done, total: Math.max(1, status.total), speed: status.fps }
                  : null,
            });
          },
          shouldStop: () => ac.signal.aborted,
        });
      } finally {
        exportAbort = null;
        batchAbort = null;
        const cur = get().batch;
        set({ exporting: null, batchStatus: cur && isRunComplete(cur) ? "done" : "idle" });
      }
    },

    setError(error) {
      set({ error });
    },

    undo() {
      const snapshot = popUndo(docOf(get()));
      if (snapshot) {
        get().applyDocument(snapshot);
        flashNotice("Undone");
      }
      const d = historyDepths();
      set({ undoDepth: d.undo, redoDepth: d.redo });
    },

    redo() {
      const snapshot = popRedo(docOf(get()));
      if (snapshot) {
        get().applyDocument(snapshot);
        flashNotice("Redone");
      }
      const d = historyDepths();
      set({ undoDepth: d.undo, redoDepth: d.redo });
    },

    async saveProject() {
      const s = get();
      const doc: ProjectDocument = {
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
      };
      try {
        const saved = await saveTextFile(
          `visualization.${PROJECT_EXTENSION}`,
          serializeProject(doc, APP_VERSION),
          [{ name: "Beatform project", extensions: [PROJECT_EXTENSION] }],
        );
        if (saved) flashNotice(`Project saved${isTauri() ? ` to ${saved}` : ""}`);
      } catch (e) {
        set({ error: `Could not save project: ${(e as Error).message}` });
      }
    },

    async openProject() {
      try {
        const picked = await openTextFile([
          { name: "Beatform project", extensions: [PROJECT_EXTENSION] },
        ]);
        if (!picked) return;
        // Parse BEFORE clearing history: a corrupt file must not cost the
        // session's undo stack when nothing gets loaded.
        const doc = parseProject(picked.contents);
        clearHistory();
        get().applyDocument(doc);
        set({ undoDepth: 0, redoDepth: 0 });
        flashNotice(`Project "${picked.name}" loaded`);
      } catch (e) {
        set({
          error:
            e instanceof ProjectParseError
              ? `Could not open project: ${e.message}`
              : `Could not open project: ${(e as Error).message}`,
        });
      }
    },

    applyDocument(doc) {
      const preset = presetById(doc.presetId);
      const activeParams = resolveParams(preset.id, doc.paramsByPreset);
      const sync = sanitizeSync(doc.syncByPreset[preset.id] ?? { ...DEFAULT_SYNC });
      set({
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

    addTextLayer() {
      record("layer-add");
      const overlayLayers = [...get().overlayLayers, defaultTextLayer()];
      set({ overlayLayers });
      saveStoredOverlay(overlayLayers, get().assets);
      get().refreshOverlay();
    },

    async addImageLayer() {
      try {
        const picked = await openImageFile();
        if (!picked) return;
        record("layer-add");
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
      record("layer-add");
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
      record(`layer:${id}:${Object.keys(patch).join(",")}`);
      const overlayLayers = get().overlayLayers.map((l) =>
        l.id === id ? ({ ...l, ...patch } as OverlayLayer) : l,
      );
      set({ overlayLayers });
      saveStoredOverlay(overlayLayers, get().assets);
      get().refreshOverlay();
    },

    removeOverlayLayer(id) {
      record("layer-remove");
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

    addModRoute(source, param) {
      record("mod-add");
      const s = get();
      const route: ModRoute = { id: newRouteId(), source, param, amount: 0.5 };
      const activeMods = [...s.activeMods, route];
      const modsByPreset = { ...s.modsByPreset, [s.presetId]: activeMods };
      set({ activeMods, modsByPreset });
      saveStoredMods(modsByPreset);
    },

    updateModRoute(id, patch) {
      record(`mod:${id}:${Object.keys(patch).join(",")}`);
      const s = get();
      const activeMods = s.activeMods.map((r) => (r.id === id ? { ...r, ...patch } : r));
      const modsByPreset = { ...s.modsByPreset, [s.presetId]: activeMods };
      set({ activeMods, modsByPreset });
      saveStoredMods(modsByPreset);
    },

    removeModRoute(id) {
      record("mod-remove");
      const s = get();
      const activeMods = s.activeMods.filter((r) => r.id !== id);
      const modsByPreset = { ...s.modsByPreset };
      if (activeMods.length > 0) modsByPreset[s.presetId] = activeMods;
      else delete modsByPreset[s.presetId];
      set({ activeMods, modsByPreset });
      saveStoredMods(modsByPreset);
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
            lastFrameKey = overlayFrameKeyAt(dyn, t, canvas.width);
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
