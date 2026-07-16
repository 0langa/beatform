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
import { probeCodecs, type CodecSupport, type VideoCodecId } from "../export/codecProbe";
import { demos } from "../audio/demoTrack";
import type { BgSettings, ParamValues } from "../render/types";
import { defaultParams } from "../render/types";
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
import type { MotionSettings, PostSettings } from "../render/types";
import {
  downloadBlob,
  isTauri,
  openImageFile,
  openTextFile,
  pickFolder,
  pickSavePath,
  proresAbort,
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
} from "./persistence";

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
   */
  format: "mp4" | "png" | "prores";
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
  /** Analysers fed by live system audio (WASAPI loopback) instead of a track. */
  liveInputActive: boolean;
}

interface Actions {
  initApp(canvas: HTMLCanvasElement): () => void;
  switchPreset(id: string): void;
  stepPreset(delta: number): void;
  setParam(key: string, value: number): void;
  applyStyle(values: Partial<ParamValues>): void;
  resetParams(): void;
  setBg(bg: BgSettings): void;
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
/** Monotonic token: only the newest raster result gets applied. */
let overlayToken = 0;
/** Latest analysis job id — stale results are dropped. */
let analysisId = 0;
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;

function resolveParams(presetId: string, overrides: Record<string, ParamValues>): ParamValues {
  const preset = presetById(presetId);
  return { ...defaultParams(preset), ...overrides[preset.id] };
}

const initialPresetId = (() => {
  const stored = loadStoredPresetId();
  return stored && presets.some((p) => p.id === stored) ? stored : presets[0].id;
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
    bg: loadStoredBg(),
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
    liveInputActive: false,
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
          get().refreshOverlay(); // new renderer starts without an overlay bound
        },
        onResize: () => get().refreshOverlay(),
        onMeter: (lufs, stereoWidth) => set({ lufs, stereoWidth }),
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
      set({ presetId: next.id, activeParams, activeMods, sync });
      saveStoredPresetId(next.id);
      getRenderer()?.setPreset(next);
      getAnalyzer().setSync(sync);
    },

    stepPreset(delta) {
      const i = presets.findIndex((p) => p.id === get().presetId);
      get().switchPreset(presets[(i + delta + presets.length) % presets.length].id);
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
        set({ trackMeta: meta, coverArt });
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
        set({ trackMeta: { title: demo.name, artist: "" }, coverArt: null });
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
        // presets fall back to onset pulses without one.
        getAnalyzer().setBeatGrid(null);
        set({
          liveInputActive: true,
          beatGrid: null,
          trackKey: null,
          sections: [],
          libraryActivePath: null,
          error: null,
        });
        flashNotice(`Listening to ${info.device}`);
      } catch (e) {
        engine.stopLiveInput();
        set({ error: `System-audio capture failed: ${(e as Error).message}` });
      }
    },

    setShowLibrary(open) {
      set({ showLibrary: open });
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
      try {
        // Bytes -> File -> the ordinary loadFile path: decode, tags, cover
        // art, beat-grid analysis and generation guards all come for free.
        const bytes = await readBinaryFromPath(path);
        const file = new File([bytes as BlobPart], entry.fileName);
        await get().loadFile(file);
        // Mark active only if this load actually won (loadFile is
        // generation-guarded and returns silently when superseded).
        if (getEngine().state.trackName === entry.fileName) {
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
        set({ trackMeta: meta, coverArt, libraryActivePath: next.path, error: null });
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
          [{ name: "Audio Visualizer template", extensions: ["avtheme"] }],
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
      set({ exportSettings: { ...get().exportSettings, ...patch } });
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
      const fileName = `${baseName}${proresMode ? ".mov" : ".mp4"}`;
      // Desktop: pick the destination BEFORE rendering — a cancelled dialog
      // after a long 4K render would throw the work away.
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
              : [{ name: "MP4 video", extensions: ["mp4"] }],
          );
          if (!savePath) {
            exportStarting = false;
            return;
          }
        }
      } else if (pngMode || proresMode) {
        set({
          exportError: pngMode
            ? "PNG sequence export needs the desktop app (it writes a folder)"
            : "ProRes export needs the desktop app (it runs the bundled ffmpeg)",
        });
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
      const proresFail: { err: Error | null } = { err: null };
      try {
        if (proresMode && savePath) {
          // Original (un-normalized) audio: a mezzanine keeps source levels.
          await proresSetAudio(wavFromPcm(pcmFromAudioBuffer(buf)));
          await proresBegin(fps, savePath);
        }
        // Same rasterizer as the live view, at export resolution — WYSIWYG
        const overlay =
          (await rasterizeOverlay(
            get().overlayLayers,
            get().assets,
            res.w,
            res.h,
            get().trackMeta,
          )) ?? undefined;
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
            },
            overlay,
            {
              // Desktop: stream straight to the picked file (flat memory);
              // browser dev falls back to an in-memory blob + download.
              // ProRes renders PNG frames into the sidecar instead.
              streamToPath: proresMode ? undefined : (savePath ?? undefined),
              pngDir: pngDir ?? undefined,
              onPngFrame: proresMode
                ? (data) => {
                    proresChain = proresChain
                      .then(() => proresWrite(data))
                      .catch((e: Error) => {
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
        if (proresMode) {
          // All frames rendered — drain the pipe, close it, wait for ffmpeg.
          await proresChain;
          if (proresFail.err) throw proresFail.err;
          await proresFinish();
          set({ exportDone: `ProRes 4444 MOV (PCM audio) saved to ${savePath}` });
        } else {
          if (result.blob) downloadBlob(result.blob, fileName);
          set({
            exportDone: pngDir
              ? `${(result.bytes / 1e6).toFixed(1)} MB PNG sequence saved to ${pngDir}`
              : `${(result.bytes / 1e6).toFixed(1)} MB MP4 (H.264 + ${result.audioCodec.toUpperCase()}) saved${savePath ? ` to ${savePath}` : ""}`,
          });
        }
      } catch (e) {
        if (proresMode) await proresAbort().catch(() => undefined);
        if ((e as Error).name !== "AbortError") {
          set({ exportError: proresFail.err ? proresFail.err.message : (e as Error).message });
        }
      } finally {
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
      if (get().batchStatus === "running") return;
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
        jobs: [],
      };
      // Never overwrite a video an earlier (stopped) run already finished into
      // this folder: those names are spoken for.
      const alreadyDone = get().batch ? takenPaths(get().batch!) : new Set<string>();
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
      const again = retryFailed(b, Date.now());
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
          [{ name: "Audio Visualizer project", extensions: [PROJECT_EXTENSION] }],
        );
        if (saved) flashNotice(`Project saved${isTauri() ? ` to ${saved}` : ""}`);
      } catch (e) {
        set({ error: `Could not save project: ${(e as Error).message}` });
      }
    },

    async openProject() {
      try {
        const picked = await openTextFile([
          { name: "Audio Visualizer project", extensions: [PROJECT_EXTENSION] },
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
          [{ name: "Audio Visualizer look", extensions: [USER_PRESET_EXTENSION] }],
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
          if (token === overlayToken) {
            getRenderer()?.setOverlay(bitmap); // takes ownership (closes it)
          } else {
            bitmap?.close(); // superseded by a newer raster — release it
          }
        } catch (e) {
          console.error("[overlay]", e);
        }
      }, 60);
    },

    async importUserPreset() {
      try {
        const picked = await openTextFile([
          { name: "Audio Visualizer look", extensions: [USER_PRESET_EXTENSION] },
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
