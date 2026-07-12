import { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine } from "./audio/engine";
import { RealtimeAnalyzer } from "./audio/realtimeSource";
import { demos } from "./audio/demoTrack";
import type { PlaybackState } from "./audio/types";
import { Canvas2DRenderer } from "./render/canvas2dRenderer";
import { WebGPURenderer } from "./render/webgpuRenderer";
import {
  BG_PRESET,
  BG_SOLID,
  BG_TRANSPARENT,
  defaultParams,
  type BgMode,
  type BgSettings,
  type ParamValues,
  type Renderer,
} from "./render/types";
import { presets, presetById } from "./render/presets";
import { exportVideo, saveBlob } from "./export/videoExporter";
import "./App.css";

const LS_PRESET = "viz.activePreset";
const LS_PARAMS = "viz.params.v1";
const LS_BG = "viz.bg.v1";

const RESOLUTIONS = [
  { label: "720p (1280×720)", w: 1280, h: 720 },
  { label: "1080p (1920×1080)", w: 1920, h: 1080 },
  { label: "1440p (2560×1440)", w: 2560, h: 1440 },
  { label: "4K (3840×2160)", w: 3840, h: 2160 },
  { label: "Square (1080×1080)", w: 1080, h: 1080 },
  { label: "Vertical (1080×1920)", w: 1080, h: 1920 },
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

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface ExportProgress {
  done: number;
  total: number;
  startedAt: number;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

  const [playback, setPlayback] = useState<PlaybackState>({
    playing: false,
    time: 0,
    duration: 0,
    trackName: null,
    loop: false,
  });
  const [rendererKind, setRendererKind] = useState<string>("…");
  const [dragOver, setDragOver] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seekingRef = useRef(false);

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

  // One-time init: engine, renderer, frame loop
  useEffect(() => {
    const engine = new AudioEngine();
    engineRef.current = engine;
    engine.onStateChange = (s) => {
      if (!seekingRef.current) setPlayback(s);
    };
    const analyzer = new RealtimeAnalyzer(engine);
    const canvas = canvasRef.current!;
    let disposed = false;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    let stopFallback: (() => void) | undefined;

    (async () => {
      let renderer: Renderer;
      try {
        renderer = await WebGPURenderer.create(canvas);
      } catch {
        renderer = new Canvas2DRenderer(canvas);
      }
      if (disposed) {
        renderer.dispose();
        return;
      }
      renderer.setPreset(presetById(localStorage.getItem(LS_PRESET) ?? presets[0].id));
      renderer.setBackground(bgRef.current);
      rendererRef.current = renderer;
      setRendererKind(renderer.kind);

      ro = new ResizeObserver(() => {
        const r = canvas.getBoundingClientRect();
        renderer.resize(r.width, r.height, window.devicePixelRatio);
      });
      ro.observe(canvas);
      const r = canvas.getBoundingClientRect();
      renderer.resize(r.width, r.height, window.devicePixelRatio);

      let lastUiUpdate = 0;
      let fallback: ReturnType<typeof setTimeout> | undefined;
      const loop = (tMs: number) => {
        if (disposed) return;
        clearTimeout(fallback);
        const t = tMs / 1000;
        const features = analyzer.update(t);
        renderer.render(features, t, activeParamsRef.current);
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
    };
  }, []);

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

  const updateBg = useCallback((next: BgSettings) => {
    setBg(next);
    bgRef.current = next;
    rendererRef.current?.setBackground(next);
    localStorage.setItem(LS_BG, JSON.stringify(next));
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
    const demo = demos.find((d) => d.id === id);
    if (!demo) return;
    const engine = engineRef.current!;
    const buf = await demo.render(engine.ctx.sampleRate);
    engine.loadBuffer(buf, `Demo: ${demo.name}`);
    await engine.play();
  }, []);

  const togglePlay = useCallback(async () => {
    const engine = engineRef.current!;
    if (engine.playing) engine.pause();
    else await engine.play();
  }, []);

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

  // Dev-only E2E hook: run a tiny export from the console/test driver
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

  return (
    <div
      className={`app ${dragOver ? "drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <canvas
        ref={canvasRef}
        className={`viz-canvas ${bg.mode === BG_TRANSPARENT ? "transparent" : ""}`}
      />

      <div className="hud top-left">
        <div className="row">
          <label className="btn">
            Open file
            <input
              type="file"
              accept="audio/*,.mp3,.flac,.wav,.ogg,.m4a"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadFile(f);
                e.target.value = "";
              }}
            />
          </label>
          <select
            className="preset-select demo-select"
            value=""
            title="Load a synthesized demo track"
            onChange={(e) => {
              if (e.target.value) void loadDemo(e.target.value);
            }}
          >
            <option value="" disabled>
              Demo track…
            </option>
            {demos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button
            className="btn"
            disabled={!playback.trackName}
            title={playback.trackName ? "Export MP4" : "Load a track first"}
            onClick={() => setShowExport(true)}
          >
            Export
          </button>
          <button className="btn" onClick={() => setShowPanel((v) => !v)}>
            {showPanel ? "Hide params" : "Params"}
          </button>
        </div>

        <div className="row">
          <select
            className="preset-select"
            value={presetId}
            onChange={(e) => switchPreset(e.target.value)}
            title="Visual preset"
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="btn"
            title="Previous preset"
            onClick={() => {
              const i = presets.findIndex((p) => p.id === presetId);
              switchPreset(presets[(i - 1 + presets.length) % presets.length].id);
            }}
          >
            ◀
          </button>
          <button
            className="btn"
            title="Next preset"
            onClick={() => {
              const i = presets.findIndex((p) => p.id === presetId);
              switchPreset(presets[(i + 1) % presets.length].id);
            }}
          >
            ▶
          </button>
        </div>

        <div className="row transport">
          <button
            className="btn play"
            disabled={!playback.trackName}
            onClick={() => void togglePlay()}
          >
            {playback.playing ? "❚❚" : "▶"}
          </button>
          <span className="time">{fmt(playback.time)}</span>
          <input
            type="range"
            min={0}
            max={playback.duration || 1}
            step={0.01}
            value={playback.time}
            disabled={!playback.trackName}
            onPointerDown={() => (seekingRef.current = true)}
            onPointerUp={() => (seekingRef.current = false)}
            onChange={(e) => {
              const t = Number(e.target.value);
              setPlayback((p) => ({ ...p, time: t }));
              engineRef.current!.seek(t);
            }}
          />
          <span className="time">{fmt(playback.duration)}</span>
          <button
            className={`btn loop ${playback.loop ? "toggled" : ""}`}
            title={playback.loop ? "Loop on" : "Loop off"}
            onClick={() => {
              const engine = engineRef.current!;
              engine.loop = !engine.loop;
            }}
          >
            ⟳
          </button>
          <input
            className="volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            defaultValue={1}
            title="Volume"
            onChange={(e) => engineRef.current!.setVolume(Number(e.target.value))}
          />
        </div>

        <div className="track-line">
          <span className="badge">{rendererKind}</span>
          <span className="track-name">
            {playback.trackName ?? "Drop an audio file anywhere"}
          </span>
        </div>
        {error && <div className="error">{error}</div>}
      </div>

      {showPanel && (
        <div className="hud panel">
          <div className="panel-head">
            <span className="panel-title">{preset.name}</span>
            <button className="btn small" onClick={resetParams} title="Reset to defaults">
              Reset
            </button>
          </div>
          {preset.params.map((p) => (
            <label key={p.key} className="param">
              <span>{p.label}</span>
              <input
                type="range"
                min={p.min}
                max={p.max}
                step={p.step}
                value={params[p.key] ?? p.default}
                onChange={(e) => setParam(p.key, Number(e.target.value))}
              />
              <span className="param-value">
                {(params[p.key] ?? p.default).toFixed(p.step < 1 ? 2 : 0)}
              </span>
            </label>
          ))}

          <div className="panel-head bg-head">
            <span className="panel-title">Background</span>
          </div>
          <div className="bg-row">
            <select
              className="preset-select"
              value={bg.mode}
              onChange={(e) =>
                updateBg({ ...bg, mode: Number(e.target.value) as BgMode })
              }
            >
              <option value={BG_PRESET}>Preset (animated)</option>
              <option value={BG_SOLID}>Solid color</option>
              <option value={BG_TRANSPARENT}>Transparent</option>
            </select>
            {bg.mode === BG_SOLID && (
              <input
                type="color"
                className="bg-color"
                value={rgbToHex(bg.color)}
                onChange={(e) => updateBg({ ...bg, color: hexToRgb(e.target.value) })}
                title="Background color"
              />
            )}
          </div>
          {bg.mode === BG_SOLID && (
            <div className="bg-swatches">
              {["#000000", "#ffffff", "#00b140", "#ff00ff"].map((hex) => (
                <button
                  key={hex}
                  className="swatch"
                  style={{ background: hex }}
                  title={hex}
                  onClick={() => updateBg({ ...bg, color: hexToRgb(hex) })}
                />
              ))}
            </div>
          )}
          {bg.mode === BG_TRANSPARENT && (
            <div className="hint">
              MP4 exports have no alpha channel — transparent renders over
              black. For editor keying, use Solid green/magenta.
            </div>
          )}
        </div>
      )}

      {showExport && (
        <div className="modal-backdrop" onClick={() => !exporting && setShowExport(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-head">
              <span className="panel-title">Export MP4</span>
              <button
                className="btn small"
                disabled={!!exporting}
                onClick={() => setShowExport(false)}
              >
                ✕
              </button>
            </div>

            <label className="field">
              <span>Resolution</span>
              <select
                className="preset-select"
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
                className="preset-select"
                value={fps}
                disabled={!!exporting}
                onChange={(e) => setFps(Number(e.target.value))}
              >
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </label>

            <label className="field">
              <span>Bitrate</span>
              <span className="bitrate-controls">
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
                  <input
                    type="range"
                    min={2}
                    max={60}
                    step={1}
                    value={manualMbps}
                    disabled={!!exporting}
                    onChange={(e) => setManualMbps(Number(e.target.value))}
                  />
                )}
                <span className="param-value">{effectiveMbps} Mbps</span>
              </span>
            </label>

            <div className="hint">
              Uses the current preset, parameters and background — what you
              see live is what renders. Sync is sample-exact (offline render).
              {bg.mode === BG_TRANSPARENT &&
                " Transparent background renders over black in MP4."}
            </div>

            {exporting ? (
              <>
                <div className="progress">
                  <div className="progress-fill" style={{ width: `${exportPct}%` }} />
                </div>
                <div className="export-status">
                  {exportPct}% — frame {exporting.done}/{exporting.total}
                  {exportSpeed ? ` (${exportSpeed} fps)` : ""}
                  <button
                    className="btn small danger"
                    onClick={() => abortRef.current?.abort()}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button className="btn primary" onClick={() => void runExport()}>
                Export {res.w}×{res.h} @ {fps} fps
              </button>
            )}
            {exportError && <div className="error">{exportError}</div>}
            {exportDone && <div className="success">{exportDone}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
