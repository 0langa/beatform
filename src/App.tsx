import { useEffect, useRef } from "react";
import { demos } from "./audio/demoTrack";
import { BG_TRANSPARENT, DEFAULT_POST } from "./render/types";
import { presets, presetById } from "./render/presets";
import { exportVideo } from "./export/videoExporter";
import { CODEC_LABELS, type VideoCodecId } from "./export/codecProbe";
import { APP_VERSION } from "./version";

const CODEC_IDS: readonly VideoCodecId[] = ["h264", "hevc", "av1"];
import { getEngine } from "./state/services";
import { rasterizeOverlay } from "./render/overlay";
import { BatchPanel } from "./ui/BatchPanel";
import { expandJobs } from "./state/batch";
import { runBatch } from "./state/batchRunner";
// Used only by the dev-only E2E hooks below; both modules already ship as part
// of the audio engine and exporter, so this costs the bundle nothing.
import { integratedLufs } from "./audio/dsp/lufs";
import { truePeakDbfs } from "./audio/dsp/truepeak";
import {
  autoBitrateMbps,
  LOUDNESS_PRESETS,
  RESOLUTIONS,
  resolutionsForAspect,
  useVizStore,
} from "./state/store";
import { PlayerBar } from "./ui/PlayerBar";
import { LibraryPanel } from "./ui/LibraryPanel";
import { isTauri } from "./state/platform";
import { TimelinePanel } from "./ui/TimelinePanel";
import { PresetStrip } from "./ui/PresetStrip";
import { ParamsPanel } from "./ui/ParamsPanel";
import { EmptyState } from "./ui/EmptyState";
import { Slider } from "./ui/Slider";
import {
  IconBatch,
  IconExport,
  IconFolder,
  IconFullscreen,
  IconHelp,
  IconBroadcast,
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
  ["Ctrl+Z / Ctrl+Y", "Undo / redo"],
  ["T", "Timeline panel"],
  ["B", "Batch render"],
  ["Q", "Music library"],
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
  const aspect = useVizStore((s) => s.aspect);
  const lufs = useVizStore((s) => s.lufs);
  const beatGrid = useVizStore((s) => s.beatGrid);
  const trackKey = useVizStore((s) => s.trackKey);
  const activeMods = useVizStore((s) => s.activeMods);
  const smoothSpectrum = useVizStore((s) => s.smoothSpectrum);
  const post = useVizStore((s) => s.post);
  const motion = useVizStore((s) => s.motion);
  const sections = useVizStore((s) => s.sections);
  const timeline = useVizStore((s) => s.timeline);
  const showTimeline = useVizStore((s) => s.showTimeline);
  const waveformOverview = useVizStore((s) => s.waveformOverview);
  const exportSettings = useVizStore((s) => s.exportSettings);
  const exporting = useVizStore((s) => s.exporting);
  const exportError = useVizStore((s) => s.exportError);
  const exportDone = useVizStore((s) => s.exportDone);
  const batch = useVizStore((s) => s.batch);
  const batchStatus = useVizStore((s) => s.batchStatus);
  const batchScanning = useVizStore((s) => s.batchScanning);
  const codecSupport = useVizStore((s) => s.codecSupport);
  const codecChoices = CODEC_IDS.filter((c) => codecSupport?.[c]);
  const showLibrary = useVizStore((s) => s.showLibrary);
  const library = useVizStore((s) => s.library);
  const libraryScanning = useVizStore((s) => s.libraryScanning);
  const libraryActivePath = useVizStore((s) => s.libraryActivePath);
  const libraryAutoAdvance = useVizStore((s) => s.libraryAutoAdvance);
  const liveInputActive = useVizStore((s) => s.liveInputActive);
  const showBatch = useVizStore((s) => s.showBatch);

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
        } else if (e.key === "z" || e.key === "Z") {
          e.preventDefault();
          if (e.shiftKey) s.redo();
          else s.undo();
        } else if (e.key === "y" || e.key === "Y") {
          e.preventDefault();
          s.redo();
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
        case "t":
        case "T":
          s.setShowTimeline(!s.showTimeline);
          break;
        case "b":
        case "B":
          // Same guard the ✕, Escape and the backdrop enforce: a running queue
          // must not be dismissable behind the user's back.
          if (!(s.showBatch && s.batchStatus === "running")) s.setShowBatch(!s.showBatch);
          break;
        case "q":
        case "Q":
          s.setShowLibrary(!s.showLibrary);
          break;
        case "Escape":
          s.setShowHelp(false);
          if (!s.exporting) s.setShowExport(false);
          // Never let Escape dismiss a running queue out from under itself.
          if (s.batchStatus !== "running") s.setShowBatch(false);
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
    // The live audio engine, for E2E probes (module import from the console
    // would get a DIFFERENT instance — "services not initialized").
    (window as unknown as { __engine: unknown }).__engine = getEngine();
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
      opts: Partial<{
        width: number;
        height: number;
        fps: number;
        withOverlay: boolean;
        canvasLoop: { start: number; duration: number };
        post: import("./render/types").PostSettings;
        /** Video codec — mirrors store.runExport's ExportSettings.codec. */
        codec: VideoCodecId;
        /** Render a PNG sequence instead of MP4; frames are counted, not written. */
        png: boolean;
        /** Normalize the exported audio (audio lane only). */
        loudness: import("./export/exportCore").LoudnessJob;
        /**
         * Decode the finished MP4 and re-measure it, so normalization is
         * verified end-to-end through the encoder rather than trusting the
         * limiter's own arithmetic.
         */
        verifyAudio: boolean;
      }> = {},
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
      // PNG probe: collect frame sizes instead of writing files (no desktop fs
      // in a browser); lets the harness verify the sequence path end-to-end.
      const pngFrames: number[] = [];
      const result = await exportVideo(buf, {
        onPngFrame: opts.png
          ? (data, index) => {
              pngFrames.push(data.length);
              // Keep frame 0 around so tooling can decode + inspect it.
              if (index === 0) {
                (window as unknown as { __lastPngFrame: Blob }).__lastPngFrame = new Blob(
                  [data.slice()],
                  { type: "image/png" },
                );
              }
            }
          : undefined,
        width: w,
        height: h,
        fps: opts.fps ?? 30,
        bitrate: 1_000_000,
        codec: opts.codec,
        presetId: s.presetId,
        params: s.activeParams,
        bg: s.bg,
        sync: s.sync,
        overlay,
        segment: opts.canvasLoop,
        loopCrossfadeSec: opts.canvasLoop ? 0.5 : undefined,
        beatGrid: s.beatGrid ?? undefined,
        mods: s.activeMods,
        smoothSpectrum: s.smoothSpectrum,
        // Merge onto DEFAULT_POST. A partial post object is a trap: `exposure`
        // is a MULTIPLY (1 = neutral), so omitting it lands 0 in the uniform
        // and every frame renders solid black — which silently turned a whole
        // regression baseline into hashes of black frames.
        post: opts.post ? { ...DEFAULT_POST, ...opts.post } : s.post,
        motion: s.motion,
        coverArt: s.coverArt ?? undefined,
        bgImage:
          s.bg.mode === 3 && s.bg.image && s.assets[s.bg.image.assetId]
            ? {
                dataUrl: s.assets[s.bg.image.assetId].dataUrl,
                dim: s.bg.image.dim,
                blur: s.bg.image.blur,
              }
            : undefined,
        timeline: s.timeline.enabled ? s.timeline : undefined,
        paramsByPreset: s.paramsByPreset,
        modsByPreset: s.modsByPreset,
        loudness: opts.loudness,
      });
      // Decode what we actually wrote and measure it. AAC is lossy, so this is
      // the honest number a delivery target would see — not what we intended.
      let measured: { lufs: number; truePeakDb: number } | undefined;
      if (opts.verifyAudio && result.blob) {
        const ac = new AudioContext();
        try {
          const decoded = await ac.decodeAudioData(await result.blob.arrayBuffer());
          const chans = Array.from({ length: decoded.numberOfChannels }, (_, i) =>
            decoded.getChannelData(i),
          );
          measured = {
            lufs: integratedLufs(chans, decoded.sampleRate),
            truePeakDb: truePeakDbfs(chans),
          };
        } finally {
          await ac.close();
        }
      }
      const info = {
        bytes: result.bytes,
        ms: Math.round(performance.now() - t0),
        audioCodec: result.audioCodec,
        seconds: result.seconds,
        ...(result.loudness ? { loudness: result.loudness } : {}),
        ...(measured ? { measured } : {}),
        ...(opts.png ? { pngFrames: pngFrames.length, pngBytes: pngFrames } : {}),
      };
      (window as unknown as { __lastExport: unknown }).__lastExport = info;
      (window as unknown as { __lastExportBlob: Blob | undefined }).__lastExportBlob = result.blob;
      return info;
    };

    // Drives the REAL batch runner without a filesystem: jobs render to blobs
    // instead of streaming to disk, so the loop (per-track decode + analysis,
    // per-job isolation, abort, ordering) can be exercised in browser dev.
    (window as unknown as { __runBatch: unknown }).__runBatch = async (
      files: File[],
      opts: { width?: number; height?: number; fps?: number; failOn?: number } = {},
    ) => {
      // Start clean: addBatchTracks appends (as it should for the real UI),
      // which would silently carry tracks over between probe runs.
      for (const t of store().batch?.tracks ?? []) store().removeBatchTrack(t.id);
      await store().addBatchTracks(files);
      // Re-read AFTER the await: store() is a snapshot and zustand replaces the
      // state object on set, so the pre-await one never sees the new tracks.
      const s = store();
      const tracks = s.batch?.tracks ?? [];
      const fmt = {
        id: "probe",
        label: "probe",
        w: opts.width ?? 192,
        h: opts.height ?? 108,
        fps: opts.fps ?? 30,
        mbps: 1,
        format: "mp4" as const,
      };
      const run = {
        doc: {
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
        },
        tracks,
        formats: [fmt],
        outDir: "/probe",
        startedAt: performance.now(),
        jobs: [],
      } as unknown as import("./state/batch").BatchRun;
      run.jobs = expandJobs(run.tracks, run.formats, run.outDir);

      const events: string[] = [];
      const statuses: Record<string, unknown> = {};
      let n = 0;
      await runBatch(run, {
        streamPathFor: () => undefined, // blob mode: no fs needed
        onJobStart: (id) => {
          events.push(`start:${id}`);
          // Simulate a mid-run failure to prove isolation, if asked.
          if (opts.failOn != null && n === opts.failOn) throw new Error("probe: injected");
          n++;
        },
        onJobUpdate: (id, st) => {
          statuses[id] = st;
          if (st.k !== "running") events.push(`${st.k}:${id}`);
        },
        shouldStop: () => false,
      });
      return {
        jobs: run.jobs.map((j) => ({
          out: j.outPath,
          status: statuses[j.id] ?? j.status,
        })),
        events,
      };
    };
  }, [store]);

  const canvasMode = exportSettings.mode === "canvas";
  const res = canvasMode ? { w: 1080, h: 1920 } : RESOLUTIONS[exportSettings.resIdx];
  const effFps = canvasMode ? 30 : exportSettings.fps;
  const effectiveMbps = exportSettings.autoRate
    ? autoBitrateMbps(res.w, res.h, effFps)
    : exportSettings.manualMbps;
  const canvasMaxStart = Math.max(0, playback.duration - exportSettings.canvasDuration);
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
        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;
        // Templates import by drag, from anywhere (Explorer, a GitHub
        // download, Discord) — the whole ecosystem loop in one gesture.
        const theme = files.find((f) => f.name.toLowerCase().endsWith(".avtheme"));
        if (theme) {
          void theme.text().then((t) => store().importThemeText(t));
          return;
        }
        // With the batch panel open, dropped tracks QUEUE — the panel says
        // "drop in a folder of tracks", and replacing the live track with
        // files[0] while ignoring the rest betrayed exactly that promise.
        if (store().showBatch) {
          void store().addBatchTracks(files);
        } else {
          void store().loadFile(files[0]);
        }
      }}
    >
      <div className="stage">
        <canvas
          ref={canvasRef}
          className={`viz-canvas ${bg.mode === BG_TRANSPARENT ? "transparent" : ""} ${
            aspect !== "free" ? "fixed-aspect" : ""
          }`}
          style={
            aspect !== "free"
              ? ({
                  "--ar": aspect === "16:9" ? "1.77778" : aspect === "9:16" ? "0.5625" : "1",
                } as React.CSSProperties)
              : undefined
          }
          onClick={() => playback.trackName && void store().togglePlay()}
          onDoubleClick={toggleFullscreen}
        />
      </div>

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
          <span>{showBatch ? "Drop to add to the batch queue" : "Drop to play"}</span>
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
            disabled={!playback.trackName || batchStatus === "running"}
            title={
              batchStatus === "running"
                ? "Batch render in progress"
                : playback.trackName
                  ? "Export MP4 video"
                  : "Load a track first"
            }
            onClick={() => store().setShowExport(true)}
          >
            <IconExport size={16} />
            Export
          </button>
          <button
            className={`icon-btn ${showBatch ? "active" : ""}`}
            title="Batch render — one video per track (B)"
            disabled={showBatch && batchStatus === "running"}
            onClick={() => store().setShowBatch(!showBatch)}
          >
            <IconBatch size={18} />
          </button>
          <button
            className={`icon-btn ${showLibrary ? "active" : ""}`}
            title="Music library (Q)"
            onClick={() => store().setShowLibrary(!showLibrary)}
          >
            <IconMusic size={18} />
          </button>
          <button
            className={`icon-btn ${liveInputActive ? "active live-pulse" : ""}`}
            title={
              liveInputActive
                ? "Stop listening to system audio"
                : "Visualize system audio — whatever this PC is playing"
            }
            disabled={!!exporting || batchStatus === "running"}
            onClick={() => void store().toggleLiveInput()}
          >
            <IconBroadcast size={18} />
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

      {showLibrary && (
        <LibraryPanel
          library={library}
          scanning={libraryScanning}
          activePath={libraryActivePath}
          autoAdvance={libraryAutoAdvance}
          desktop={isTauri()}
          onPickFolder={() => void store().pickLibraryFolder()}
          onPlay={(path) => void store().playLibraryTrack(path)}
          onAutoAdvance={(v) => store().setLibraryAutoAdvance(v)}
          onClose={() => store().setShowLibrary(false)}
        />
      )}

      {showPanel && (
        <ParamsPanel
          preset={preset}
          params={params}
          onParam={(k, v) => store().setParam(k, v)}
          onApplyStyle={(values) => store().applyStyle(values)}
          onReset={() => store().resetParams()}
          bg={bg}
          onBg={(next) => store().setBg(next)}
          onPickBackgroundImage={() => void store().pickBackgroundImage()}
          onUseAlbumArtBackground={() => store().useAlbumArtBackground()}
          sync={sync}
          onSync={(next) => store().setSync(next)}
          rendererKind={rendererKind}
          onClose={() => store().setShowPanel(false)}
          aspect={aspect}
          onAspect={(a) => store().setAspect(a)}
          lufs={lufs}
          bpm={beatGrid ? beatGrid.bpm : null}
          keyName={trackKey ? trackKey.name : null}
          userPresets={userPresets.filter((p) => p.presetId === presetId)}
          onApplyTheme={(document, name) => store().applyTheme(document, name)}
          onExportTheme={(meta) => void store().exportCurrentTheme(meta)}
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
          smoothSpectrum={smoothSpectrum}
          onSmoothSpectrum={(v) => store().setSmoothSpectrum(v)}
          post={post}
          onPost={(patch) => store().setPost(patch)}
          motion={motion}
          onMotion={(patch) => store().setMotion(patch)}
          mods={activeMods}
          onAddMod={(source, param) => store().addModRoute(source, param)}
          onUpdateMod={(id, patch) => store().updateModRoute(id, patch)}
          onRemoveMod={(id) => store().removeModRoute(id)}
        />
      )}

      {showTimeline && (
        <TimelinePanel
          timeline={timeline}
          duration={playback.duration}
          time={playback.time}
          beatGrid={beatGrid}
          sections={sections}
          waveform={waveformOverview}
          activePreset={preset}
          presets={[...presets]}
          activeParams={params}
          onChange={(tl) => store().setTimeline(tl)}
          onSeek={(t) => store().seekEnd(t)}
          onClose={() => store().setShowTimeline(false)}
        />
      )}

      <PlayerBar
        playback={playback}
        sections={sections}
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
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            onClick={(e) => e.stopPropagation()}
          >
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
            <div className="about-line">Beatform v{APP_VERSION}</div>
          </div>
        </div>
      )}

      {showBatch && (
        <BatchPanel
          run={batch}
          status={batchStatus}
          scanning={batchScanning}
          overlayLayers={overlayLayers}
          aspect={aspect}
          formatLabel={RESOLUTIONS[exportSettings.resIdx].label}
          onAddTracks={(files) => void store().addBatchTracks(files)}
          onRemoveTrack={(id) => store().removeBatchTrack(id)}
          onRetitle={(id, title) => store().setBatchTrackMeta(id, { title })}
          onStart={() => void store().startBatch()}
          onSkipJob={() => store().skipCurrentBatchJob()}
          onCancel={() => store().cancelBatch()}
          onRetryFailed={() => void store().retryFailedBatch()}
          onNewBatch={() => store().dismissBatch()}
          onClose={() => store().setShowBatch(false)}
        />
      )}

      {showExport && (
        <div className="modal-backdrop" onClick={() => !exporting && store().setShowExport(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Export video"
            onClick={(e) => e.stopPropagation()}
          >
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

            <div className="field">
              <span>Type</span>
              <div className="segmented">
                <button
                  className={`segment ${!canvasMode ? "active" : ""}`}
                  disabled={!!exporting}
                  title="Export the whole track as a video"
                  onClick={() => store().setExportSettings({ mode: "video" })}
                >
                  Video
                </button>
                <button
                  className={`segment ${canvasMode ? "active" : ""}`}
                  disabled={!!exporting}
                  title="3-8 s seamless loop at 1080×1920 — Spotify Canvas spec"
                  onClick={() => store().setExportSettings({ mode: "canvas" })}
                >
                  Canvas loop
                </button>
              </div>
            </div>

            <div className="field">
              <span>Format</span>
              <div className="segmented">
                <button
                  className={`segment ${exportSettings.format === "mp4" ? "active" : ""}`}
                  disabled={!!exporting}
                  title="One .mp4 file: H.264/HEVC/AV1 video + audio"
                  onClick={() => store().setExportSettings({ format: "mp4" })}
                >
                  MP4
                </button>
                <button
                  className={`segment ${exportSettings.format === "png" ? "active" : ""}`}
                  disabled={!!exporting}
                  title="A folder of numbered PNG frames — keeps transparency (set Background to Transparent). No audio; for editors."
                  onClick={() => store().setExportSettings({ format: "png" })}
                >
                  PNG frames
                </button>
                {isTauri() && (
                  <button
                    className={`segment ${exportSettings.format === "prores" ? "active" : ""}`}
                    disabled={!!exporting}
                    title="One .mov file: ProRes 4444 with alpha + PCM audio — drops straight into Premiere/Resolve/After Effects"
                    onClick={() => store().setExportSettings({ format: "prores" })}
                  >
                    ProRes
                  </button>
                )}
              </div>
            </div>

            {exportSettings.format === "png" && (
              <p className="section-hint">
                Writes numbered PNG frames into a folder you pick — no audio track. Set Background
                to <strong>Transparent</strong> to keep alpha for compositing.
              </p>
            )}

            {exportSettings.format === "prores" && (
              <p className="section-hint">
                ProRes 4444 (.mov) with alpha + untouched PCM audio — the editorial mezzanine. Set
                Background to <strong>Transparent</strong> to keep alpha. Encoded by the bundled
                ffmpeg (LGPL). Files are large by design.
              </p>
            )}

            {exportSettings.format === "mp4" && (
              <label className="field">
                <span>Loudness</span>
                <select
                  className="select"
                  value={exportSettings.loudnessTarget ?? ""}
                  disabled={!!exporting}
                  title="Match the exported audio to a loudness standard. Affects audio only — the visuals stay exactly as previewed."
                  onChange={(e) =>
                    store().setExportSettings({
                      loudnessTarget: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                >
                  <option value="">Off — keep original level</option>
                  {LOUDNESS_PRESETS.map((p) => (
                    <option key={p.lufs} value={p.lufs}>
                      {p.label} LUFS — {p.hint}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {exportSettings.format === "mp4" && exportSettings.loudnessTarget != null && (
              <p className="section-hint">
                Measures the track and matches it to {exportSettings.loudnessTarget} LUFS, holding
                peaks under {exportSettings.truePeakDb} dBTP so nothing clips when a streaming
                service re-encodes it. Audio only — the visuals are unchanged. Already-loud tracks
                can land a little under target: the peak ceiling wins, and holding it costs
                loudness.
              </p>
            )}

            {!canvasMode && (
              <label className="field">
                <span>Resolution</span>
                <select
                  className="select"
                  value={exportSettings.resIdx}
                  disabled={!!exporting}
                  onChange={(e) => store().setExportSettings({ resIdx: Number(e.target.value) })}
                >
                  {resolutionsForAspect(aspect).map((i) => (
                    <option key={RESOLUTIONS[i].label} value={i}>
                      {RESOLUTIONS[i].label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {!canvasMode && exportSettings.format === "mp4" && codecChoices.length > 1 && (
              <label className="field">
                <span>Codec</span>
                <select
                  className="select"
                  value={exportSettings.codec}
                  disabled={!!exporting}
                  title="Encode format. Pixels are identical — this only changes file size and player compatibility."
                  onChange={(e) =>
                    store().setExportSettings({ codec: e.target.value as VideoCodecId })
                  }
                >
                  {codecChoices.map((c) => (
                    <option key={c} value={c}>
                      {CODEC_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {!canvasMode && (
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
            )}

            {canvasMode && (
              <>
                <label className="field">
                  <span>Loop length</span>
                  <select
                    className="select"
                    value={exportSettings.canvasDuration}
                    disabled={!!exporting}
                    onChange={(e) =>
                      store().setExportSettings({ canvasDuration: Number(e.target.value) })
                    }
                  >
                    {[3, 4, 5, 6, 7, 8].map((d) => (
                      <option key={d} value={d}>
                        {d} s
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field">
                  {/* Show the CLAMPED value — the label must match what the
                      slider shows and what the export actually uses. */}
                  <span>
                    Starts at {Math.min(exportSettings.canvasStart, canvasMaxStart).toFixed(1)} s
                  </span>
                  <Slider
                    min={0}
                    max={Math.max(0.1, canvasMaxStart)}
                    step={0.1}
                    value={Math.min(exportSettings.canvasStart, canvasMaxStart)}
                    disabled={!!exporting}
                    onChange={(v) => store().setExportSettings({ canvasStart: v })}
                  />
                </div>
                <p className="section-hint">
                  1080×1920 (9:16) at 30 fps. The last half second crossfades into the first — the
                  loop point is seamless. Spotify Canvas accepts 3-8 s.
                </p>
              </>
            )}

            {exportSettings.format === "mp4" && (
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
            )}

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
                Export {res.w}×{res.h} @ {effFps} fps
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
