import { create } from "zustand";
import type { PlaybackState, SyncSettings } from "../audio/types";
import { DEFAULT_SYNC } from "../audio/types";
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
import type { Scene, Timeline } from "./timeline";
import {
  bytesToDataUrl,
  downloadBlob,
  isTauri,
  openImageFile,
  openTextFile,
  pickSavePath,
  saveTextFile,
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
  loadStoredTimeline,
  saveStoredMods,
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
  /** "video" = whole track; "canvas" = 3-8 s seamless loop (Spotify Canvas). */
  mode: "video" | "canvas";
  canvasStart: number;
  canvasDuration: number;
}

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
  setSync(sync: SyncSettings): void;
  loadFile(file: File): Promise<void>;
  loadDemo(id: string): Promise<void>;
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
  setError(message: string | null): void;
  saveProject(): Promise<void>;
  openProject(): Promise<void>;
  applyDocument(doc: ProjectDocument): void;
  undo(): void;
  redo(): void;
  /** Playback crossed into a scene — switch visuals WITHOUT recording history. */
  applyScene(scene: Scene): void;
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
let exportStartedAt = 0;
/** Live canvas — overlay rasters at its pixel size. Set by initApp. */
let liveCanvas: HTMLCanvasElement | null = null;
let overlayTimer: ReturnType<typeof setTimeout> | undefined;
/** Monotonic token: only the newest raster result gets applied. */
let overlayToken = 0;
/** Latest analysis job id — stale results are dropped. */
let analysisId = 0;

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

/** "Artist - Title.mp3" → meta; otherwise the basename becomes the title. */
function metaFromFilename(name: string): OverlayMeta {
  const base = name.replace(/\.[a-z0-9]+$/i, "").trim();
  const dash = base.indexOf(" - ");
  if (dash > 0) {
    return { artist: base.slice(0, dash).trim(), title: base.slice(dash + 3).trim() };
  }
  return { title: base, artist: "" };
}

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
  });

  /** Record the current document before a mutation (gesture-grouped). */
  const record = (key: string) => {
    pushHistory(docOf(get()), key);
    const d = historyDepths();
    set({ undoDepth: d.undo, redoDepth: d.redo });
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
      resIdx: 1,
      fps: 60,
      autoRate: true,
      manualMbps: 12,
      mode: "video" as const,
      canvasStart: 0,
      canvasDuration: 6,
    },
    exporting: null,
    exportError: null,
    exportDone: null,

    // --- actions ---
    initApp(canvas) {
      liveCanvas = canvas;
      const dispose = initServices(canvas, {
        getPreset: () => presetById(get().presetId),
        getParams: () => get().activeParams,
        getMods: () => get().activeMods,
        getTimeline: () => get().timeline,
        onSceneChange: (scene) => get().applyScene(scene),
        getBackground: () => get().bg,
        getSync: () => get().sync,
        isSeeking: () => get().seeking,
        onPlayback: (playback) => set({ playback }),
        onRendererChanged: (kind, warning) => {
          set({ rendererKind: kind, error: warning });
          getRenderer()?.setSmoothSpectrum(get().smoothSpectrum);
          get().refreshOverlay(); // new renderer starts without an overlay bound
        },
        onResize: () => get().refreshOverlay(),
        onMeter: (lufs, stereoWidth) => set({ lufs, stereoWidth }),
      });
      getEngine().setVolume(get().muted ? 0 : get().volume);
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

    applyScene(scene) {
      const next = presetById(scene.presetId);
      const state = get();
      if (state.presetId === next.id) return;
      const activeParams = resolveParams(next.id, state.paramsByPreset);
      const sync = state.syncByPreset[next.id] ?? { ...DEFAULT_SYNC };
      const activeMods = state.modsByPreset[next.id] ?? [];
      set({ presetId: next.id, activeParams, activeMods, sync });
      getRenderer()?.setPreset(next);
      if (scene.bg) getRenderer()?.setBackground(scene.bg);
      getAnalyzer().setSync(sync);
    },

    setAspect(aspect) {
      record("aspect");
      set({ aspect });
      saveStoredAspect(aspect);
      // Keep the export resolution consistent with the frame
      const allowed = resolutionsForAspect(aspect);
      if (!allowed.includes(get().exportSettings.resIdx)) {
        get().setExportSettings({ resIdx: allowed[allowed.length > 1 ? 1 : 0] });
      }
      // Re-measure after the CSS class lands (don't wait for ResizeObserver;
      // it never fires in hidden tabs). The measure also refreshes overlays.
      setTimeout(remeasure, 50);
    },

    setSync(sync) {
      record("sync");
      const state = get();
      const syncByPreset = { ...state.syncByPreset, [state.presetId]: sync };
      set({ sync, syncByPreset });
      saveStoredSync(syncByPreset);
      getAnalyzer().setSync(sync);
    },

    async loadFile(file) {
      try {
        set({ error: null });
        await getEngine().loadFile(file);
        await getEngine().play();
        // Tag metadata (title/artist/cover) — best effort, never blocks playback
        let meta = metaFromFilename(file.name);
        let coverArt: string | null = null;
        try {
          const mm = await import("music-metadata");
          const tags = await mm.parseBlob(file, { duration: false });
          meta = {
            title: tags.common.title?.trim() || meta.title,
            artist: tags.common.artist?.trim() || meta.artist,
          };
          const pic = tags.common.picture?.[0];
          if (pic) coverArt = bytesToDataUrl(pic.data, pic.format || "image/jpeg");
        } catch {
          // unreadable tags — filename fallback stands
        }
        set({ trackMeta: meta, coverArt });
        get().refreshOverlay();
        get().analyzeCurrentTrack();
      } catch (e) {
        set({ error: `Could not decode "${file.name}" (${(e as Error).message})` });
      }
    },

    async loadDemo(id) {
      try {
        set({ error: null });
        const demo = demos.find((d) => d.id === id);
        if (!demo) return;
        const engine = getEngine();
        const buf = await demo.render(engine.ctx.sampleRate);
        engine.loadBuffer(buf, `Demo: ${demo.name}`);
        await engine.play();
        set({ trackMeta: { title: demo.name, artist: "" }, coverArt: null });
        get().refreshOverlay();
        get().analyzeCurrentTrack();
      } catch (e) {
        set({ error: `Demo failed: ${(e as Error).message}` });
      }
    },

    async togglePlay() {
      const engine = getEngine();
      if (engine.playing) engine.pause();
      else await engine.play();
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
    },

    setExportSettings(patch) {
      set({ exportSettings: { ...get().exportSettings, ...patch } });
    },

    async runExport() {
      const engine = getEngine();
      const buf = engine.audioBuffer;
      if (!buf) return;
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
      const trackName = (engine.state.trackName ?? "visualization")
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(/[^\w\- ]+/g, "")
        .trim();
      const fileName = `${trackName || "visualization"}${canvasMode ? "-canvas" : ""}.mp4`;
      // Desktop: pick the destination BEFORE rendering — a cancelled dialog
      // after a long 4K render would throw the work away.
      let savePath: string | null = null;
      if (isTauri()) {
        savePath = await pickSavePath(fileName, [{ name: "MP4 video", extensions: ["mp4"] }]);
        if (!savePath) return;
      }
      const ac = new AbortController();
      exportAbort = ac;
      exportStartedAt = performance.now();
      set({
        exportError: null,
        exportDone: null,
        exporting: { done: 0, total: 1, speed: null },
      });
      try {
        // Same rasterizer as the live view, at export resolution — WYSIWYG
        const overlay =
          (await rasterizeOverlay(
            get().overlayLayers,
            get().assets,
            res.w,
            res.h,
            get().trackMeta,
          )) ?? undefined;
        const result = await exportVideo(buf, {
          width: res.w,
          height: res.h,
          fps,
          bitrate: mbps * 1e6,
          presetId: get().presetId,
          params: get().activeParams,
          bg: get().bg,
          sync: get().sync,
          overlay,
          segment,
          loopCrossfadeSec: canvasMode ? 0.5 : undefined,
          beatGrid: get().beatGrid ?? undefined,
          mods: get().activeMods,
          smoothSpectrum: get().smoothSpectrum,
          timeline: get().timeline.enabled ? get().timeline : undefined,
          // Desktop: stream straight to the picked file (flat memory);
          // browser dev falls back to an in-memory blob + download.
          streamToPath: savePath ?? undefined,
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
        });
        if (result.blob) downloadBlob(result.blob, fileName);
        set({
          exportDone: `${(result.bytes / 1e6).toFixed(1)} MB MP4 (H.264 + ${result.audioCodec.toUpperCase()}) saved${savePath ? ` to ${savePath}` : ""}`,
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          set({ exportError: (e as Error).message });
        }
      } finally {
        set({ exporting: null });
        exportAbort = null;
      }
    },

    cancelExport() {
      exportAbort?.abort();
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
        clearHistory();
        get().applyDocument(parseProject(picked.contents));
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
      const sync = doc.syncByPreset[preset.id] ?? { ...DEFAULT_SYNC };
      set({
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
      pruneBitmapCache(new Set(Object.keys(doc.assets)));
      getRenderer()?.setPreset(preset);
      getRenderer()?.setBackground(doc.bg);
      getAnalyzer().setSync(sync);
      get().refreshOverlay();
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
      record("look");
      const s = get();
      const preset = s.userPresets.find((p) => p.id === id);
      if (!preset) return;
      if (preset.presetId !== s.presetId) get().switchPreset(preset.presetId);
      const state = get();
      const activeParams = {
        ...defaultParams(presetById(state.presetId)),
        ...preset.params,
      };
      const paramsByPreset = { ...state.paramsByPreset, [state.presetId]: activeParams };
      set({ activeParams, paramsByPreset });
      saveStoredParams(paramsByPreset);
      if (preset.sync) get().setSync({ ...preset.sync });
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
      record("layer-add");
      const cover = get().coverArt;
      if (!cover) {
        set({ error: "The loaded track has no embedded cover art" });
        return;
      }
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
          if (token === overlayToken) getRenderer()?.setOverlay(bitmap);
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
  return useVizStore.getState().exporting !== null;
}
