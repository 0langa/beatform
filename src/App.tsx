import { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine } from "./audio/engine";
import { RealtimeAnalyzer } from "./audio/realtimeSource";
import { demos } from "./audio/demoTrack";
import { DEFAULT_SYNC } from "./audio/types";
import type { PlaybackState, SyncSettings } from "./audio/types";
import { Canvas2DRenderer } from "./render/canvas2dRenderer";
import { WebGPURenderer } from "./render/webgpuRenderer";
import {
  BG_PRESET,
  BG_TRANSPARENT,
  defaultParams,
  type BgSettings,
  type ParamValues,
  type Renderer,
} from "./render/types";
import { presets, presetById } from "./render/presets";
import { exportVideo, saveBlob } from "./export/videoExporter";
import { PlayerBar } from "./ui/PlayerBar";
import { PresetStrip } from "./ui/PresetStrip";
import { ParamsPanel } from "./ui/ParamsPanel";
import { EmptyState } from "./ui/EmptyState";
import { Slider } from "./ui/Slider";
import {
  IconExport,
  IconFolder,
  IconFullscreen,
  IconHelp,
  IconMusic,
  IconSettings,
} from "./ui/Icons";
import "./App.css";

const APP_VERSION = "1.1.0";

const LS_PRESET = "viz.activePreset";
const LS_PARAMS = "viz.params.v1";
const LS_BG = "viz.bg.v1";
const LS_VOLUME = "viz.volume";
const LS_SYNC = "viz.sync.v1";

function loadStoredSync(): Record<string, SyncSettings> {
  try {
    return JSON.parse(localStorage.getItem(LS_SYNC) ?? "{}");
  } catch {
    return {};
  }
}

const RESOLUTIONS = [
  { label: "720p (1280×720)", w: 1280, h: 720 },
  { label: "1080p (1920×1080)", w: 1920, h: 1080 },
  { label: "1440p (2560×1440)", w: 2560, h: 1440 },
  { label: "4K (3840×2160)", w: 3840, h: 2160 },
  { label: "Square (1080×1080)", w: 1080, h: 1080 },
  { label: "Vertical (1080×1920)", w: 1080, h: 1920 },
];

const SHORTCUTS: Array<[string, string]> = [
  ["Space", "Play / pause"],
  ["← / →", "Seek 5 s"],
  ["↑ / ↓", "Volume"],
  ["M", "Mute"],
  ["L", "Loop"],
  ["[ / ]", "Previous / next preset"],
  ["G", "Settings panel"],
  ["F", "Fullscreen"],
];

function autoBitrateMbps(w: number, h: number, fps: number): number {
  return Math.min(60, Math.max(2, Math.round((w * h * fps * 0.09) / 1e6)));
}

function loadStoredParams(): Record<string, ParamValues> {
  try {
    return JSON.parse(localStorage.getItem(LS_PARAMS) ?? "{}");
  } catch {
    return {};
  }
}

function loadStoredBg(): BgSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_BG) ?? "");
    if (raw && typeof raw.mode === "number" && Array.isArray(raw.color)) return raw;
  } catch {
    // fall through
  }
  return { mode: BG_PRESET, color: [0, 0, 0] };
}

interface ExportProgress {
  done: number;
  total: number;
  startedAt: number;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const rendererRef = useRef<Renderer | null>(null);

  const [presetId, setPresetId] = useState<string>(
    () => localStorage.getItem(LS_PRESET) ?? presets[0].id,
  );
  const preset = presetById(presetId);
  const presetIdRef = useRef(presetId);
  const paramsByPresetRef = useRef<Record<string, ParamValues>>(loadStoredParams());
  const activeParamsRef = useRef<ParamValues>({
    ...defaultParams(preset),
    ...paramsByPresetRef.current[preset.id],
  });
  const [params, setParams] = useState<ParamValues>(activeParamsRef.current);

  const [bg, setBg] = useState<BgSettings>(loadStoredBg);
  const bgRef = useRef(bg);

  const syncByPresetRef = useRef<Record<string, SyncSettings>>(loadStoredSync());
  const [sync, setSyncState] = useState<SyncSettings>(
    () => syncByPresetRef.current[presetId] ?? { ...DEFAULT_SYNC },
  );
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const analyzerRef = useRef<RealtimeAnalyzer | null>(null);

  const [playback, setPlayback] = useState<PlaybackState>({
    playing: false,
    time: 0,
    duration: 0,
    trackName: null,
    loop: false,
  });
  const [rendererKind, setRendererKind] = useState<string>("…");
  const [dragOver, setDragOver] = useState(false);
  const [showPanel, setShowPanelState] = useState(
    () => localStorage.getItem("viz.panelOpen") === "1",
  );
  const setShowPanel = useCallback((v: boolean | ((p: boolean) => boolean)) => {
    setShowPanelState((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      localStorage.setItem("viz.panelOpen", next ? "1" : "0");
      return next;
    });
  }, []);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(() => {
    const v = Number(localStorage.getItem(LS_VOLUME));
    return Number.isFinite(v) && v >= 0 && v <= 1 && localStorage.getItem(LS_VOLUME) !== null
      ? v
      : 1;
  });
  const [muted, setMuted] = useState(false);
  const volumeRef = useRef({ volume: 1, muted: false });
  volumeRef.current.volume = volume;
  volumeRef.current.muted = muted;
  const seekingRef = useRef(false);
  const dragDepthRef = useRef(0);

  // Chrome auto-hide (video-player style)
  const [chromeIdle, setChromeIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const playingRef = useRef(false);
  playingRef.current = playback.playing;

  // Export dialog state
  const [showExport, setShowExport] = useState(false);
  const [resIdx, setResIdx] = useState(1);
  const [fps, setFps] = useState(60);
  const [autoRate, setAutoRate] = useState(true);
  const [manualMbps, setManualMbps] = useState(12);
  const [exporting, setExporting] = useState<ExportProgress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDone, setExportDone] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const exportOpenRef = useRef(false);
  exportOpenRef.current = showExport;

  // One-time init: engine, renderer (with GPU-loss recovery), frame loop
  useEffect(() => {
    const engine = new AudioEngine();
    engineRef.current = engine;
    engine.setVolume(volumeRef.current.muted ? 0 : volumeRef.current.volume);
    engine.onStateChange = (s) => {
      if (!seekingRef.current) setPlayback(s);
    };
    const analyzer = new RealtimeAnalyzer(engine);
    analyzer.setSync(syncRef.current);
    analyzerRef.current = analyzer;
    const canvas = canvasRef.current!;
    let disposed = false;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    let stopFallback: (() => void) | undefined;
    let gpuRetries = 0;

    const installRenderer = async () => {
      let renderer: Renderer;
      try {
        const gpu = await WebGPURenderer.create(canvas);
        gpu.onDeviceLost = () => {
          // Driver reset / TDR: rebuild the renderer once, fall back after 2
          if (disposed) return;
          rendererRef.current = null;
          gpu.dispose();
          gpuRetries++;
          void installRenderer();
        };
        renderer = gpuRetries < 2 ? gpu : new Canvas2DRenderer(canvas);
      } catch {
        renderer = new Canvas2DRenderer(canvas);
      }
      if (disposed) {
        renderer.dispose();
        return;
      }
      renderer.setPreset(presetById(presetIdRef.current));
      renderer.setBackground(bgRef.current);
      const r = canvas.getBoundingClientRect();
      renderer.resize(r.width, r.height, window.devicePixelRatio);
      rendererRef.current = renderer;
      setRendererKind(renderer.kind);
      if (renderer.kind === "canvas2d") {
        setError(
          "WebGPU unavailable — using simplified rendering (spectrum bars only). Update your graphics driver or WebView2 runtime for full visuals.",
        );
      }
    };

    (async () => {
      await installRenderer();
      if (disposed) return;

      ro = new ResizeObserver(() => {
        const r = canvas.getBoundingClientRect();
        rendererRef.current?.resize(r.width, r.height, window.devicePixelRatio);
      });
      ro.observe(canvas);

      let lastUiUpdate = 0;
      let fallback: ReturnType<typeof setTimeout> | undefined;
      const loop = (tMs: number) => {
        if (disposed) return;
        clearTimeout(fallback);
        const t = tMs / 1000;
        const features = analyzer.update(t);
        rendererRef.current?.render(features, t, activeParamsRef.current);
        // E2E probe: lets tooling confirm the render loop is alive
        (window as unknown as { __vizFrames: number }).__vizFrames =
          ((window as unknown as { __vizFrames: number }).__vizFrames ?? 0) + 1;
        // Throttled transport refresh while playing
        if (engine.playing && t - lastUiUpdate > 0.25 && !seekingRef.current) {
          lastUiUpdate = t;
          setPlayback(engine.state);
        }
        raf = requestAnimationFrame(loop);
        // rAF starves in hidden/occluded tabs; keep rendering (throttled by
        // the browser to ~1fps) so background use and captures stay live
        fallback = setTimeout(() => {
          cancelAnimationFrame(raf);
          loop(performance.now());
        }, 300);
      };
      raf = requestAnimationFrame(loop);
      stopFallback = () => clearTimeout(fallback);
    })();

    return () => {
      disposed = true;
      stopFallback?.();
      cancelAnimationFrame(raf);
      ro?.disconnect();
      rendererRef.current?.dispose();
      rendererRef.current = null;
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-hide chrome while playing and idle
  const pokeChrome = useCallback(() => {
    setChromeIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      if (playingRef.current && !exportOpenRef.current) setChromeIdle(true);
    }, 3000);
  }, []);

  useEffect(() => {
    pokeChrome();
    return () => clearTimeout(idleTimer.current);
  }, [pokeChrome]);

  // Re-arm the idle timer when playback starts (e.g. started via keyboard)
  useEffect(() => {
    if (playback.playing) pokeChrome();
  }, [playback.playing, pokeChrome]);

  const switchPreset = useCallback((id: string) => {
    const next = presetById(id);
    setPresetId(next.id);
    presetIdRef.current = next.id;
    localStorage.setItem(LS_PRESET, next.id);
    activeParamsRef.current = {
      ...defaultParams(next),
      ...paramsByPresetRef.current[next.id],
    };
    setParams(activeParamsRef.current);
    rendererRef.current?.setPreset(next);
    const nextSync = syncByPresetRef.current[next.id] ?? { ...DEFAULT_SYNC };
    setSyncState(nextSync);
    analyzerRef.current?.setSync(nextSync);
  }, []);

  const updateSync = useCallback((next: SyncSettings) => {
    setSyncState(next);
    analyzerRef.current?.setSync(next);
    syncByPresetRef.current[presetIdRef.current] = next;
    localStorage.setItem(LS_SYNC, JSON.stringify(syncByPresetRef.current));
  }, []);

  const setParam = useCallback(
    (key: string, value: number) => {
      activeParamsRef.current = { ...activeParamsRef.current, [key]: value };
      setParams(activeParamsRef.current);
      paramsByPresetRef.current[presetId] = activeParamsRef.current;
      localStorage.setItem(LS_PARAMS, JSON.stringify(paramsByPresetRef.current));
    },
    [presetId],
  );

  const resetParams = useCallback(() => {
    activeParamsRef.current = defaultParams(presetById(presetId));
    setParams(activeParamsRef.current);
    delete paramsByPresetRef.current[presetId];
    localStorage.setItem(LS_PARAMS, JSON.stringify(paramsByPresetRef.current));
  }, [presetId]);

  const applyStyle = useCallback(
    (values: Partial<ParamValues>) => {
      const next = { ...defaultParams(presetById(presetId)), ...values } as ParamValues;
      activeParamsRef.current = next;
      setParams(next);
      paramsByPresetRef.current[presetId] = next;
      localStorage.setItem(LS_PARAMS, JSON.stringify(paramsByPresetRef.current));
    },
    [presetId],
  );

  const updateBg = useCallback((next: BgSettings) => {
    setBg(next);
    bgRef.current = next;
    rendererRef.current?.setBackground(next);
    localStorage.setItem(LS_BG, JSON.stringify(next));
  }, []);

  const applyVolume = useCallback((v: number, m: boolean) => {
    volumeRef.current = { volume: v, muted: m };
    setVolume(v);
    setMuted(m);
    engineRef.current?.setVolume(m ? 0 : v);
    localStorage.setItem(LS_VOLUME, String(v));
  }, []);

  const loadFile = useCallback(async (file: File) => {
    try {
      setError(null);
      await engineRef.current!.loadFile(file);
      await engineRef.current!.play();
    } catch (e) {
      setError(`Could not decode "${file.name}" (${(e as Error).message})`);
    }
  }, []);

  const loadDemo = useCallback(async (id: string) => {
    try {
      setError(null);
      const demo = demos.find((d) => d.id === id);
      if (!demo) return;
      const engine = engineRef.current!;
      const buf = await demo.render(engine.ctx.sampleRate);
      engine.loadBuffer(buf, `Demo: ${demo.name}`);
      await engine.play();
    } catch (e) {
      setError(`Demo failed: ${(e as Error).message}`);
    }
  }, []);

  const togglePlay = useCallback(async () => {
    const engine = engineRef.current!;
    if (engine.playing) engine.pause();
    else await engine.play();
  }, []);

  const toggleFullscreen = useCallback(() => {
    // Rejections are expected where the Fullscreen API is policy-blocked
    // (embedded webviews) — treat as a no-op, not an error.
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else {
      document.documentElement.requestFullscreen().catch(() => undefined);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const engine = engineRef.current;
      if (!engine) return;
      const step = (d: number) => {
        const i = presets.findIndex((p) => p.id === presetIdRef.current);
        switchPreset(presets[(i + d + presets.length) % presets.length].id);
      };
      switch (e.key) {
        case " ":
          e.preventDefault();
          void togglePlay();
          break;
        case "ArrowLeft":
          engine.seek(engine.currentTime - 5);
          break;
        case "ArrowRight":
          engine.seek(engine.currentTime + 5);
          break;
        case "ArrowUp": {
          e.preventDefault();
          const v = Math.min(1, volumeRef.current.volume + 0.05);
          applyVolume(v, false);
          break;
        }
        case "ArrowDown": {
          e.preventDefault();
          const v = Math.max(0, volumeRef.current.volume - 0.05);
          applyVolume(v, false);
          break;
        }
        case "m":
        case "M":
          applyVolume(volumeRef.current.volume, !volumeRef.current.muted);
          break;
        case "l":
        case "L":
          engine.loop = !engine.loop;
          break;
        case "[":
          step(-1);
          break;
        case "]":
          step(1);
          break;
        case "g":
        case "G":
          setShowPanel((v) => !v);
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "Escape":
          setShowHelp(false);
          if (!abortRef.current) setShowExport(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyVolume, switchPreset, toggleFullscreen, togglePlay]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void loadFile(file);
    },
    [loadFile],
  );

  const runExport = useCallback(async () => {
    const engine = engineRef.current!;
    const buf = engine.audioBuffer;
    if (!buf) return;
    const res = RESOLUTIONS[resIdx];
    const mbps = autoRate ? autoBitrateMbps(res.w, res.h, fps) : manualMbps;
    const ac = new AbortController();
    abortRef.current = ac;
    setExportError(null);
    setExportDone(null);
    setExporting({ done: 0, total: 1, startedAt: performance.now() });
    try {
      const result = await exportVideo(buf, {
        width: res.w,
        height: res.h,
        fps,
        bitrate: mbps * 1e6,
        preset: presetById(presetIdRef.current),
        params: activeParamsRef.current,
        bg: bgRef.current,
        sync: syncRef.current,
        signal: ac.signal,
        onProgress: (done, total) =>
          setExporting((p) => (p ? { ...p, done, total } : p)),
      });
      const name = (engine.state.trackName ?? "visualization")
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(/[^\w\- ]+/g, "")
        .trim();
      saveBlob(result.blob, `${name || "visualization"}.mp4`);
      setExportDone(
        `${(result.blob.size / 1e6).toFixed(1)} MB MP4 (H.264 + ${result.audioCodec.toUpperCase()}) saved`,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setExportError((e as Error).message);
      }
    } finally {
      setExporting(null);
      abortRef.current = null;
    }
  }, [resIdx, fps, autoRate, manualMbps]);

  // Surface anything that slipped past local error handling
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      console.error("[unhandled]", e.reason);
      setError(`Unexpected error: ${e.reason?.message ?? String(e.reason)}`);
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  // Dev-only E2E hooks: file loading + tiny export from the test driver
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __loadFile: unknown }).__loadFile = async (
      url: string,
      name: string,
    ) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
      const buf = await r.arrayBuffer();
      await loadFile(new File([buf], name));
      return engineRef.current?.state;
    };
  }, [loadFile]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __runExport: unknown }).__runExport = async (
      opts: Partial<{ width: number; height: number; fps: number }> = {},
    ) => {
      const buf = engineRef.current?.audioBuffer;
      if (!buf) throw new Error("no track loaded");
      const t0 = performance.now();
      const result = await exportVideo(buf, {
        width: opts.width ?? 320,
        height: opts.height ?? 180,
        fps: opts.fps ?? 30,
        bitrate: 1_000_000,
        preset: presetById(presetIdRef.current),
        params: activeParamsRef.current,
        bg: bgRef.current,
        sync: syncRef.current,
      });
      const info = {
        bytes: result.blob.size,
        ms: Math.round(performance.now() - t0),
        audioCodec: result.audioCodec,
        seconds: result.seconds,
      };
      (window as unknown as { __lastExport: unknown }).__lastExport = info;
      (window as unknown as { __lastExportBlob: Blob }).__lastExportBlob = result.blob;
      return info;
    };
  }, []);

  const res = RESOLUTIONS[resIdx];
  const effectiveMbps = autoRate ? autoBitrateMbps(res.w, res.h, fps) : manualMbps;
  const exportPct = exporting
    ? Math.round((exporting.done / Math.max(1, exporting.total)) * 100)
    : 0;
  const exportSpeed =
    exporting && exporting.done > 0
      ? (exporting.done / ((performance.now() - exporting.startedAt) / 1000)).toFixed(0)
      : null;

  const idle = chromeIdle && playback.playing && !showExport && !showHelp;

  return (
    <div
      className={`app ${dragOver ? "drag-over" : ""} ${idle ? "idle" : ""}`}
      onMouseMove={pokeChrome}
      onPointerDown={pokeChrome}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepthRef.current++;
        setDragOver(true);
      }}
      onDragLeave={() => {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragOver(false);
      }}
      onDrop={(e) => {
        dragDepthRef.current = 0;
        onDrop(e);
      }}
    >
      <canvas
        ref={canvasRef}
        className={`viz-canvas ${bg.mode === BG_TRANSPARENT ? "transparent" : ""}`}
        onClick={() => playback.trackName && void togglePlay()}
        onDoubleClick={toggleFullscreen}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.flac,.wav,.ogg,.m4a"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadFile(f);
          e.target.value = "";
        }}
      />

      {dragOver && (
        <div className="drop-overlay">
          <IconMusic size={44} />
          <span>Drop to play</span>
        </div>
      )}

      {!playback.trackName && !dragOver && (
        <EmptyState
          demos={demos}
          onOpenFile={() => fileInputRef.current?.click()}
          onDemo={(id) => void loadDemo(id)}
        />
      )}

      <header className="chrome top-bar">
        <div className="top-left">
          <button
            className="ghost-btn"
            title="Open an audio file"
            onClick={() => fileInputRef.current?.click()}
          >
            <IconFolder size={16} />
            Open
          </button>
          <div className="menu-wrap">
            <button className="ghost-btn" title="Synthesized demo tracks">
              <IconMusic size={16} />
              Demos
            </button>
            <div className="menu">
              {demos.map((d) => (
                <button key={d.id} className="menu-item" onClick={() => void loadDemo(d.id)}>
                  {d.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="top-right">
          <button
            className="ghost-btn accent"
            disabled={!playback.trackName}
            title={playback.trackName ? "Export MP4 video" : "Load a track first"}
            onClick={() => setShowExport(true)}
          >
            <IconExport size={16} />
            Export
          </button>
          <button
            className={`icon-btn ${showPanel ? "active" : ""}`}
            title="Visual settings (G)"
            onClick={() => setShowPanel((v) => !v)}
          >
            <IconSettings size={18} />
          </button>
          <button
            className="icon-btn"
            title="Keyboard shortcuts"
            onClick={() => setShowHelp((v) => !v)}
          >
            <IconHelp size={18} />
          </button>
          <button className="icon-btn" title="Fullscreen (F)" onClick={toggleFullscreen}>
            <IconFullscreen size={18} />
          </button>
        </div>
      </header>

      <PresetStrip presets={presets} activeId={presetId} onSwitch={switchPreset} />

      {showPanel && (
        <ParamsPanel
          preset={preset}
          params={params}
          onParam={setParam}
          onApplyStyle={applyStyle}
          onReset={resetParams}
          bg={bg}
          onBg={updateBg}
          sync={sync}
          onSync={updateSync}
          rendererKind={rendererKind}
          onClose={() => setShowPanel(false)}
        />
      )}

      <PlayerBar
        playback={playback}
        volume={volume}
        muted={muted}
        onTogglePlay={() => void togglePlay()}
        onSeekStart={() => (seekingRef.current = true)}
        onSeekEnd={(t) => {
          seekingRef.current = false;
          engineRef.current!.seek(t);
        }}
        onToggleLoop={() => {
          const engine = engineRef.current!;
          engine.loop = !engine.loop;
        }}
        onVolume={(v) => applyVolume(v, false)}
        onToggleMute={() => applyVolume(volume, !muted)}
      />

      {error && <div className="toast error-toast">{error}</div>}

      {showHelp && (
        <div className="modal-backdrop" onClick={() => setShowHelp(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <span className="panel-heading">Keyboard shortcuts</span>
              <button className="icon-btn subtle" onClick={() => setShowHelp(false)}>
                ✕
              </button>
            </div>
            <div className="shortcut-list">
              {SHORTCUTS.map(([key, desc]) => (
                <div key={key} className="shortcut-row">
                  <kbd>{key}</kbd>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
            <div className="about-line">Audio Visualizer v{APP_VERSION}</div>
          </div>
        </div>
      )}

      {showExport && (
        <div className="modal-backdrop" onClick={() => !exporting && setShowExport(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <span className="panel-heading">Export video</span>
              <button
                className="icon-btn subtle"
                disabled={!!exporting}
                onClick={() => setShowExport(false)}
              >
                ✕
              </button>
            </div>

            <label className="field">
              <span>Resolution</span>
              <select
                className="select"
                value={resIdx}
                disabled={!!exporting}
                onChange={(e) => setResIdx(Number(e.target.value))}
              >
                {RESOLUTIONS.map((r, i) => (
                  <option key={r.label} value={i}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Frame rate</span>
              <select
                className="select"
                value={fps}
                disabled={!!exporting}
                onChange={(e) => setFps(Number(e.target.value))}
              >
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </label>

            <div className="field">
              <span>Bitrate</span>
              <div className="bitrate-controls">
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={autoRate}
                    disabled={!!exporting}
                    onChange={(e) => setAutoRate(e.target.checked)}
                  />
                  Auto
                </label>
                {!autoRate && (
                  <Slider
                    min={2}
                    max={60}
                    step={1}
                    value={manualMbps}
                    disabled={!!exporting}
                    onChange={setManualMbps}
                  />
                )}
                <span className="row-value">{effectiveMbps} Mbps</span>
              </div>
            </div>

            <p className="section-hint">
              Renders the current preset, parameters and background — what you
              see live is what you get. Sync is sample-exact.
              {bg.mode === BG_TRANSPARENT &&
                " Transparent background becomes black in MP4."}
            </p>

            {exporting ? (
              <>
                <div className="progress">
                  <div className="progress-fill" style={{ width: `${exportPct}%` }} />
                </div>
                <div className="export-status">
                  <span>
                    {exportPct}% — frame {exporting.done}/{exporting.total}
                    {exportSpeed ? ` · ${exportSpeed} fps` : ""}
                  </span>
                  <button className="text-btn danger" onClick={() => abortRef.current?.abort()}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button className="btn-primary wide" onClick={() => void runExport()}>
                <IconExport size={16} />
                Export {res.w}×{res.h} @ {fps} fps
              </button>
            )}
            {exportError && <div className="toast-inline error">{exportError}</div>}
            {exportDone && <div className="toast-inline success">{exportDone}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
