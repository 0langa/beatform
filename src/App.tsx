import { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine } from "./audio/engine";
import { RealtimeAnalyzer } from "./audio/realtimeSource";
import { demos } from "./audio/demoTrack";
import type { PlaybackState } from "./audio/types";
import { Canvas2DRenderer } from "./render/canvas2dRenderer";
import { WebGPURenderer } from "./render/webgpuRenderer";
import { defaultParams, type ParamValues, type Renderer } from "./render/types";
import { presets, presetById } from "./render/presets";
import "./App.css";

const LS_PRESET = "viz.activePreset";
const LS_PARAMS = "viz.params.v1";

function loadStoredParams(): Record<string, ParamValues> {
  try {
    return JSON.parse(localStorage.getItem(LS_PARAMS) ?? "{}");
  } catch {
    return {};
  }
}

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const rendererRef = useRef<Renderer | null>(null);

  const [presetId, setPresetId] = useState<string>(
    () => localStorage.getItem(LS_PRESET) ?? presets[0].id,
  );
  const preset = presetById(presetId);
  const paramsByPresetRef = useRef<Record<string, ParamValues>>(loadStoredParams());
  const activeParamsRef = useRef<ParamValues>({
    ...defaultParams(preset),
    ...paramsByPresetRef.current[preset.id],
  });
  const [params, setParams] = useState<ParamValues>(activeParamsRef.current);

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
        // the browser to ~1fps) so captures and background use stay live
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
      <canvas ref={canvasRef} className="viz-canvas" />

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
        </div>
      )}
    </div>
  );
}
