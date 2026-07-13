import { create } from "zustand";
import type { PlaybackState, SyncSettings } from "../audio/types";
import { DEFAULT_SYNC } from "../audio/types";
import { demos } from "../audio/demoTrack";
import type { BgSettings, ParamValues } from "../render/types";
import { defaultParams } from "../render/types";
import { presetById, presets } from "../render/presets";
import { exportVideo, saveBlob } from "../export/videoExporter";
import { getAnalyzer, getEngine, getRenderer, initServices } from "./services";
import {
  loadStoredBg,
  loadStoredPanelOpen,
  loadStoredParams,
  loadStoredPresetId,
  loadStoredSync,
  loadStoredVolume,
  saveStoredBg,
  saveStoredPanelOpen,
  saveStoredParams,
  saveStoredPresetId,
  saveStoredSync,
  saveStoredVolume,
} from "./persistence";

export const RESOLUTIONS = [
  { label: "720p (1280×720)", w: 1280, h: 720 },
  { label: "1080p (1920×1080)", w: 1920, h: 1080 },
  { label: "1440p (2560×1440)", w: 2560, h: 1440 },
  { label: "4K (3840×2160)", w: 3840, h: 2160 },
  { label: "Square (1080×1080)", w: 1080, h: 1080 },
  { label: "Vertical (1080×1920)", w: 1080, h: 1920 },
];

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
}

/** Session/UI state: ephemeral, never saved into projects. */
interface SessionSlice {
  /** Resolved params of the active preset (defaults + overrides). The frame
   * loop reads this via getState() every frame — keep it precomputed. */
  activeParams: ParamValues;
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
}

export type VizState = DocumentSlice & SessionSlice & Actions;

// Non-serializable ephemera live outside the state object.
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let exportAbort: AbortController | null = null;
let exportStartedAt = 0;

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

export const useVizStore = create<VizState>((set, get) => ({
  // --- document ---
  presetId: initialPresetId,
  paramsByPreset: initialParams,
  syncByPreset: initialSync,
  bg: loadStoredBg(),

  // --- session ---
  activeParams: resolveParams(initialPresetId, initialParams),
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
  exportSettings: { resIdx: 1, fps: 60, autoRate: true, manualMbps: 12 },
  exporting: null,
  exportError: null,
  exportDone: null,

  // --- actions ---
  initApp(canvas) {
    const dispose = initServices(canvas, {
      getPreset: () => presetById(get().presetId),
      getParams: () => get().activeParams,
      getBackground: () => get().bg,
      getSync: () => get().sync,
      isSeeking: () => get().seeking,
      onPlayback: (playback) => set({ playback }),
      onRendererChanged: (kind, warning) => set({ rendererKind: kind, error: warning }),
    });
    getEngine().setVolume(get().muted ? 0 : get().volume);
    get().pokeChrome();
    return () => {
      clearTimeout(idleTimer);
      dispose();
    };
  },

  switchPreset(id) {
    const next = presetById(id);
    const state = get();
    const activeParams = resolveParams(next.id, state.paramsByPreset);
    const sync = state.syncByPreset[next.id] ?? { ...DEFAULT_SYNC };
    set({ presetId: next.id, activeParams, sync });
    saveStoredPresetId(next.id);
    getRenderer()?.setPreset(next);
    getAnalyzer().setSync(sync);
  },

  stepPreset(delta) {
    const i = presets.findIndex((p) => p.id === get().presetId);
    get().switchPreset(presets[(i + delta + presets.length) % presets.length].id);
  },

  setParam(key, value) {
    const state = get();
    const activeParams = { ...state.activeParams, [key]: value };
    const paramsByPreset = { ...state.paramsByPreset, [state.presetId]: activeParams };
    set({ activeParams, paramsByPreset });
    saveStoredParams(paramsByPreset);
  },

  applyStyle(values) {
    const state = get();
    // Style values are Partial — the defaults spread guarantees every key
    const activeParams = { ...defaultParams(presetById(state.presetId)), ...values } as ParamValues;
    const paramsByPreset = { ...state.paramsByPreset, [state.presetId]: activeParams };
    set({ activeParams, paramsByPreset });
    saveStoredParams(paramsByPreset);
  },

  resetParams() {
    const state = get();
    const paramsByPreset = { ...state.paramsByPreset };
    delete paramsByPreset[state.presetId];
    set({ activeParams: defaultParams(presetById(state.presetId)), paramsByPreset });
    saveStoredParams(paramsByPreset);
  },

  setBg(bg) {
    set({ bg });
    saveStoredBg(bg);
    getRenderer()?.setBackground(bg);
  },

  setSync(sync) {
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
    const { resIdx, fps, autoRate, manualMbps } = get().exportSettings;
    const res = RESOLUTIONS[resIdx];
    const mbps = autoRate ? autoBitrateMbps(res.w, res.h, fps) : manualMbps;
    const ac = new AbortController();
    exportAbort = ac;
    exportStartedAt = performance.now();
    set({
      exportError: null,
      exportDone: null,
      exporting: { done: 0, total: 1, speed: null },
    });
    try {
      const result = await exportVideo(buf, {
        width: res.w,
        height: res.h,
        fps,
        bitrate: mbps * 1e6,
        preset: presetById(get().presetId),
        params: get().activeParams,
        bg: get().bg,
        sync: get().sync,
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
      const name = (engine.state.trackName ?? "visualization")
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(/[^\w\- ]+/g, "")
        .trim();
      saveBlob(result.blob, `${name || "visualization"}.mp4`);
      set({
        exportDone: `${(result.blob.size / 1e6).toFixed(1)} MB MP4 (H.264 + ${result.audioCodec.toUpperCase()}) saved`,
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
}));

/** True while an export is running — guards Escape-to-close and modal close. */
export function isExporting(): boolean {
  return useVizStore.getState().exporting !== null;
}
