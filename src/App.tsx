import { useEffect, useRef } from "react";
import { demos } from "./audio/demoTrack";
import { BG_TRANSPARENT } from "./render/types";
import { presets, presetById } from "./render/presets";
import { exportVideo } from "./export/videoExporter";
import { APP_VERSION } from "./version";
import { getEngine } from "./state/services";
import { rasterizeOverlay } from "./render/overlay";
import { autoBitrateMbps, RESOLUTIONS, useVizStore } from "./state/store";
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

const SHORTCUTS: Array<[string, string]> = [
  ["Space", "Play / pause"],
  ["← / →", "Seek 5 s"],
  ["↑ / ↓", "Volume"],
  ["M", "Mute"],
  ["L", "Loop"],
  ["[ / ]", "Previous / next preset"],
  ["G", "Settings panel"],
  ["F", "Fullscreen"],
  ["Ctrl+S", "Save project"],
  ["Ctrl+O", "Open project"],
];

function toggleFullscreen(): void {
  // Rejections are expected where the Fullscreen API is policy-blocked
  // (embedded webviews) — treat as a no-op, not an error.
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => undefined);
  } else {
    document.documentElement.requestFullscreen().catch(() => undefined);
  }
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const presetId = useVizStore((s) => s.presetId);
  const preset = presetById(presetId);
  const params = useVizStore((s) => s.activeParams);
  const bg = useVizStore((s) => s.bg);
  const sync = useVizStore((s) => s.sync);
  const playback = useVizStore((s) => s.playback);
  const volume = useVizStore((s) => s.volume);
  const muted = useVizStore((s) => s.muted);
  const rendererKind = useVizStore((s) => s.rendererKind);
  const chromeIdle = useVizStore((s) => s.chromeIdle);
  const dragOver = useVizStore((s) => s.dragOver);
  const showPanel = useVizStore((s) => s.showPanel);
  const showHelp = useVizStore((s) => s.showHelp);
  const showExport = useVizStore((s) => s.showExport);
  const error = useVizStore((s) => s.error);
  const notice = useVizStore((s) => s.notice);
  const userPresets = useVizStore((s) => s.userPresets);
  const overlayLayers = useVizStore((s) => s.overlayLayers);
  const assets = useVizStore((s) => s.assets);
  const coverArt = useVizStore((s) => s.coverArt);
  const exportSettings = useVizStore((s) => s.exportSettings);
  const exporting = useVizStore((s) => s.exporting);
  const exportError = useVizStore((s) => s.exportError);
  const exportDone = useVizStore((s) => s.exportDone);

  const store = useVizStore.getState; // stable accessor for actions/handlers

  // One-time init: engine, renderer (with GPU-loss recovery), frame loop
  useEffect(() => {
    return store().initApp(canvasRef.current!);
  }, [store]);

  // Re-arm the chrome idle timer when playback starts (e.g. via keyboard)
  useEffect(() => {
    if (playback.playing) store().pokeChrome();
  }, [playback.playing, store]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const s = store();
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "s" || e.key === "S") {
          e.preventDefault();
          void s.saveProject();
        } else if (e.key === "o" || e.key === "O") {
          e.preventDefault();
          void s.openProject();
        }
        return;
      }
      switch (e.key) {
        case " ":
          e.preventDefault();
          void s.togglePlay();
          break;
        case "ArrowLeft":
          s.seekBy(-5);
          break;
        case "ArrowRight":
          s.seekBy(5);
          break;
        case "ArrowUp":
          e.preventDefault();
          s.applyVolume(Math.min(1, s.volume + 0.05), false);
          break;
        case "ArrowDown":
          e.preventDefault();
          s.applyVolume(Math.max(0, s.volume - 0.05), false);
          break;
        case "m":
        case "M":
          s.applyVolume(s.volume, !s.muted);
          break;
        case "l":
        case "L":
          s.toggleLoop();
          break;
        case "[":
          s.stepPreset(-1);
          break;
        case "]":
          s.stepPreset(1);
          break;
        case "g":
        case "G":
          s.setShowPanel((v) => !v);
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "Escape":
          s.setShowHelp(false);
          if (!s.exporting) s.setShowExport(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  // Surface anything that slipped past local error handling
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      console.error("[unhandled]", e.reason);
      store().setError(`Unexpected error: ${e.reason?.message ?? String(e.reason)}`);
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, [store]);

  // Dev-only E2E hooks: file loading + tiny export from the test driver
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // The app's store instance (HMR-safe), for state assertions in E2E runs
    (window as unknown as { __store: unknown }).__store = useVizStore;
    (window as unknown as { __loadFile: unknown }).__loadFile = async (
      url: string,
      name: string,
    ) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
      const buf = await r.arrayBuffer();
      await store().loadFile(new File([buf], name));
      return getEngine().state;
    };
    (window as unknown as { __runExport: unknown }).__runExport = async (
      opts: Partial<{ width: number; height: number; fps: number; withOverlay: boolean }> = {},
    ) => {
      const buf = getEngine().audioBuffer;
      if (!buf) throw new Error("no track loaded");
      const s = store();
      const w = opts.width ?? 320;
      const h = opts.height ?? 180;
      // Overlay: the document's real layers (mirrors store.runExport), or a
      // synthetic test box when withOverlay is forced.
      let overlay: ImageBitmap | undefined;
      if (opts.withOverlay) {
        const oc = new OffscreenCanvas(w, h);
        const c2d = oc.getContext("2d")!;
        c2d.fillStyle = "rgba(255,40,40,0.9)";
        c2d.fillRect(w * 0.25, h * 0.4, w * 0.5, h * 0.2);
        overlay = oc.transferToImageBitmap();
      } else {
        overlay =
          (await rasterizeOverlay(s.overlayLayers, s.assets, w, h, s.trackMeta)) ?? undefined;
      }
      const t0 = performance.now();
      const result = await exportVideo(buf, {
        width: w,
        height: h,
        fps: opts.fps ?? 30,
        bitrate: 1_000_000,
        presetId: s.presetId,
        params: s.activeParams,
        bg: s.bg,
        sync: s.sync,
        overlay,
      });
      const info = {
        bytes: result.bytes,
        ms: Math.round(performance.now() - t0),
        audioCodec: result.audioCodec,
        seconds: result.seconds,
      };
      (window as unknown as { __lastExport: unknown }).__lastExport = info;
      (window as unknown as { __lastExportBlob: Blob | undefined }).__lastExportBlob = result.blob;
      return info;
    };
  }, [store]);

  const res = RESOLUTIONS[exportSettings.resIdx];
  const effectiveMbps = exportSettings.autoRate
    ? autoBitrateMbps(res.w, res.h, exportSettings.fps)
    : exportSettings.manualMbps;
  const exportPct = exporting
    ? Math.round((exporting.done / Math.max(1, exporting.total)) * 100)
    : 0;
  const exportSpeed = exporting?.speed != null ? exporting.speed.toFixed(0) : null;

  const idle = chromeIdle && playback.playing && !showExport && !showHelp;

  return (
    <div
      className={`app ${dragOver ? "drag-over" : ""} ${idle ? "idle" : ""}`}
      onMouseMove={() => store().pokeChrome()}
      onPointerDown={() => store().pokeChrome()}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepthRef.current++;
        store().setDragOver(true);
      }}
      onDragLeave={() => {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) store().setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepthRef.current = 0;
        store().setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) void store().loadFile(file);
      }}
    >
      <canvas
        ref={canvasRef}
        className={`viz-canvas ${bg.mode === BG_TRANSPARENT ? "transparent" : ""}`}
        onClick={() => playback.trackName && void store().togglePlay()}
        onDoubleClick={toggleFullscreen}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.flac,.wav,.ogg,.m4a"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void store().loadFile(f);
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
          onDemo={(id) => void store().loadDemo(id)}
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
                <button
                  key={d.id}
                  className="menu-item"
                  onClick={() => void store().loadDemo(d.id)}
                >
                  {d.name}
                </button>
              ))}
            </div>
          </div>
          <div className="menu-wrap">
            <button className="ghost-btn" title="Save or load the whole setup as a file">
              <IconSettings size={16} />
              Project
            </button>
            <div className="menu">
              <button className="menu-item" onClick={() => void store().saveProject()}>
                Save project… <kbd className="menu-kbd">Ctrl+S</kbd>
              </button>
              <button className="menu-item" onClick={() => void store().openProject()}>
                Open project… <kbd className="menu-kbd">Ctrl+O</kbd>
              </button>
            </div>
          </div>
        </div>
        <div className="top-right">
          <button
            className="ghost-btn accent"
            disabled={!playback.trackName}
            title={playback.trackName ? "Export MP4 video" : "Load a track first"}
            onClick={() => store().setShowExport(true)}
          >
            <IconExport size={16} />
            Export
          </button>
          <button
            className={`icon-btn ${showPanel ? "active" : ""}`}
            title="Visual settings (G)"
            onClick={() => store().setShowPanel((v) => !v)}
          >
            <IconSettings size={18} />
          </button>
          <button
            className="icon-btn"
            title="Keyboard shortcuts"
            onClick={() => store().setShowHelp(!showHelp)}
          >
            <IconHelp size={18} />
          </button>
          <button className="icon-btn" title="Fullscreen (F)" onClick={toggleFullscreen}>
            <IconFullscreen size={18} />
          </button>
        </div>
      </header>

      <PresetStrip
        presets={presets}
        activeId={presetId}
        onSwitch={(id) => store().switchPreset(id)}
      />

      {showPanel && (
        <ParamsPanel
          preset={preset}
          params={params}
          onParam={(k, v) => store().setParam(k, v)}
          onApplyStyle={(values) => store().applyStyle(values)}
          onReset={() => store().resetParams()}
          bg={bg}
          onBg={(next) => store().setBg(next)}
          sync={sync}
          onSync={(next) => store().setSync(next)}
          rendererKind={rendererKind}
          onClose={() => store().setShowPanel(false)}
          userPresets={userPresets.filter((p) => p.presetId === presetId)}
          onSaveUserPreset={(name) => store().saveUserPreset(name)}
          onApplyUserPreset={(id) => store().applyUserPreset(id)}
          onDeleteUserPreset={(id) => store().deleteUserPreset(id)}
          onExportUserPreset={(id) => void store().exportUserPreset(id)}
          onImportUserPreset={() => void store().importUserPreset()}
          overlayLayers={overlayLayers}
          assets={assets}
          hasCoverArt={!!coverArt}
          onAddTextLayer={() => store().addTextLayer()}
          onAddImageLayer={() => void store().addImageLayer()}
          onAddAlbumArtLayer={() => store().addAlbumArtLayer()}
          onUpdateLayer={(id, patch) => store().updateOverlayLayer(id, patch)}
          onRemoveLayer={(id) => store().removeOverlayLayer(id)}
        />
      )}

      <PlayerBar
        playback={playback}
        volume={volume}
        muted={muted}
        onTogglePlay={() => void store().togglePlay()}
        onSeekStart={() => store().seekStart()}
        onSeekEnd={(t) => store().seekEnd(t)}
        onToggleLoop={() => store().toggleLoop()}
        onVolume={(v) => store().applyVolume(v, false)}
        onToggleMute={() => store().applyVolume(volume, !muted)}
      />

      {error && <div className="toast error-toast">{error}</div>}
      {notice && !error && <div className="toast notice-toast">{notice}</div>}

      {showHelp && (
        <div className="modal-backdrop" onClick={() => store().setShowHelp(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <span className="panel-heading">Keyboard shortcuts</span>
              <button className="icon-btn subtle" onClick={() => store().setShowHelp(false)}>
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
        <div className="modal-backdrop" onClick={() => !exporting && store().setShowExport(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <span className="panel-heading">Export video</span>
              <button
                className="icon-btn subtle"
                disabled={!!exporting}
                onClick={() => store().setShowExport(false)}
              >
                ✕
              </button>
            </div>

            <label className="field">
              <span>Resolution</span>
              <select
                className="select"
                value={exportSettings.resIdx}
                disabled={!!exporting}
                onChange={(e) => store().setExportSettings({ resIdx: Number(e.target.value) })}
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
                value={exportSettings.fps}
                disabled={!!exporting}
                onChange={(e) => store().setExportSettings({ fps: Number(e.target.value) })}
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
                    checked={exportSettings.autoRate}
                    disabled={!!exporting}
                    onChange={(e) => store().setExportSettings({ autoRate: e.target.checked })}
                  />
                  Auto
                </label>
                {!exportSettings.autoRate && (
                  <Slider
                    min={2}
                    max={60}
                    step={1}
                    value={exportSettings.manualMbps}
                    disabled={!!exporting}
                    onChange={(v) => store().setExportSettings({ manualMbps: v })}
                  />
                )}
                <span className="row-value">{effectiveMbps} Mbps</span>
              </div>
            </div>

            <p className="section-hint">
              Renders the current preset, parameters and background — what you see live is what you
              get. Sync is sample-exact.
              {bg.mode === BG_TRANSPARENT && " Transparent background becomes black in MP4."}
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
                  <button className="text-btn danger" onClick={() => store().cancelExport()}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button className="btn-primary wide" onClick={() => void store().runExport()}>
                <IconExport size={16} />
                Export {res.w}×{res.h} @ {exportSettings.fps} fps
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
