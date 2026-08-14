import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { demos } from "./audio/demoTrack";
import { BG_TRANSPARENT } from "./render/types";
import { presetById } from "./render/presets";
import { APP_VERSION } from "./version";
import { BatchPanel } from "./ui/BatchPanel";
import { SIMPLIFIED_EXPORT_REASON, useVizStore } from "./state/store";
import { selectEffectiveBg } from "./state/selectors";
import { installDevHooks } from "./devHooks";
import { getPrefs, setPrefs, subscribePrefs } from "./state/prefs";
import { PlayerBar } from "./ui/PlayerBar";
import { LibraryPanel } from "./ui/LibraryPanel";
import {
  dismissUpdatePrompt,
  getUpdatePhase,
  installUpdate,
  isUpdatePromptOpen,
  relaunchApp,
  scheduleStartupUpdateCheck,
  setUpdatePhase,
  subscribeUpdate,
} from "./state/updater";
import { TimelinePanel } from "./ui/TimelinePanel";
import { PresetStrip } from "./ui/PresetStrip";
import { ShaderEditor } from "./ui/ShaderEditor";
import { DockResizeHandle } from "./ui/DockResizeHandle";
import { ShadertoyImport } from "./ui/ShadertoyImport";
import { ParamsPanel } from "./ui/ParamsPanel";
import { EmptyState } from "./ui/EmptyState";
import { useFocusTrap } from "./ui/useFocusTrap";
import { useAppShortcuts, toggleFullscreen, groupShortcutRows } from "./ui/useAppShortcuts";
import { ExportDialog } from "./ui/ExportDialog";
import { SettingsDialog } from "./ui/SettingsDialog";
import { GalleryDialog } from "./ui/GalleryDialog";
import { PerfOverlay } from "./ui/PerfOverlay";
import { UpdatePrompt } from "./ui/UpdatePrompt";
import { GuideDialog } from "./ui/GuideDialog";
import {
  IconBatch,
  IconClose,
  IconExport,
  IconFolder,
  IconFullscreen,
  IconGallery,
  IconGear,
  IconHelp,
  IconBroadcast,
  IconMusic,
  IconSettings,
  IconStage,
} from "./ui/Icons";
import "./App.css";

/**
 * The Visuals dock's DockResizeHandle onCommit — pulled out of the JSX and
 * exported (whole-lane review, IMPORTANT on top of E2-U1) so it is a real,
 * independently-testable unit rather than an inline closure only a full
 * `<App />` mount could exercise. Takes its setters as parameters instead
 * of closing over component state, so a test can call the ACTUAL function
 * App.tsx uses with its own local state/spies, rather than a hand-written
 * copy of the logic that would go on passing even if this one regressed.
 *
 * Order matters: `setVisualsDragW(null)` must run BEFORE (or otherwise
 * unconditionally alongside) the commit, not be skipped — the pre-P-1
 * two-value split's own onUp always cleared it here first. Left out (as
 * the initial DockResizeHandle extraction did), visualsDragW stays pinned
 * at the last dragged pixel value; --visuals-w-drag and aria-valuenow both
 * read `visualsDragW ?? visualsW`, so a LATER action that sets visualsW
 * WITHOUT touching visualsDragW (visualsResizeKey, the keyboard path,
 * being the one that actually reaches this) leaves the dock's own box
 * silently stuck showing the stale dragged width forever.
 */
export function commitVisualsWidth(
  v: number,
  setVisualsDragW: (value: number | null) => void,
  setVisualsW: (value: number) => void,
  persist: (value: number) => void,
): void {
  setVisualsDragW(null);
  // … and the canvas commits ONCE. Persisting is release-only for the same
  // reason: subscribePrefs(() => measure()) turns every prefs write into a
  // full re-measure, so a per-move persist would run a second resize storm
  // alongside the first.
  setVisualsW(v);
  persist(v);
}

/**
 * Keyboard resize for the two drag handles (P-1 §4). Arrows move the
 * SEPARATOR — ARIA's window-splitter semantics — so the same keypress grows
 * the left-hand Library and the right-hand Visuals in opposite directions;
 * `sign` carries that. Home/End take the pane the handle controls to its
 * minimum/maximum.
 *
 * Pointer-only was tolerable while Visuals was an overlay nicety; it is
 * a real gap now that this is the control sizing a permanent workspace.
 * Returns null for keys it does not own, so the handler can bail without
 * swallowing Tab or Escape.
 */
export function resizeKeyValue(
  e: React.KeyboardEvent<HTMLDivElement>,
  current: number,
  lo: number,
  hi: number,
  /** +1 when moving the separator RIGHT widens the pane (Library), -1 when it
   *  narrows it (the right-hand Visuals dock). */
  sign: 1 | -1,
): number | null {
  const step = (e.shiftKey ? 48 : 16) * sign;
  let next: number;
  if (e.key === "ArrowRight") next = current + step;
  else if (e.key === "ArrowLeft") next = current - step;
  else if (e.key === "Home") next = lo;
  else if (e.key === "End") next = hi;
  else return null;
  e.preventDefault();
  return Math.min(hi, Math.max(lo, next));
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const presetId = useVizStore((s) => s.presetId);
  const preset = presetById(presetId);
  const bg = useVizStore(selectEffectiveBg);
  /**
   * PRIMITIVES off `playback`, not the object (P-12 wave 2). App reads exactly
   * these two fields, and `playback` is rewritten four times a second for the
   * whole of playback — subscribing it re-rendered the top bar, the toast
   * stack and every dialog gate at 4 Hz to change nothing. The clock lives in
   * <PlayerBar /> and the playhead in <TimelinePanel />, which subscribe the
   * moving fields themselves.
   */
  const playing = useVizStore((s) => s.playback.playing);
  const trackName = useVizStore((s) => s.playback.trackName);
  const rendererKind = useVizStore((s) => s.rendererKind);
  const simplifiedRenderer = useVizStore((s) => s.simplifiedRenderer);
  const rendererWarning = useVizStore((s) => s.rendererWarning);
  const simplifiedNoticeDismissed = useVizStore((s) => s.simplifiedNoticeDismissed);
  const chromeIdle = useVizStore((s) => s.chromeIdle);
  const stageMode = useVizStore((s) => s.stageMode);
  const blackout = useVizStore((s) => s.blackout);
  const dragOver = useVizStore((s) => s.dragOver);
  const showPanel = useVizStore((s) => s.showPanel);
  const showHelp = useVizStore((s) => s.showHelp);
  const showGuide = useVizStore((s) => s.showGuide);
  const showSettings = useVizStore((s) => s.showSettings);
  const showGallery = useVizStore((s) => s.showGallery);
  const showExport = useVizStore((s) => s.showExport);
  const error = useVizStore((s) => s.error);
  const notice = useVizStore((s) => s.notice);
  const aspect = useVizStore((s) => s.aspect);
  const showTimeline = useVizStore((s) => s.showTimeline);
  /** A BOOLEAN, not the progress object: `exporting` is rewritten once per
   * encoded frame, and all App asks is whether one is running. */
  const exporting = useVizStore((s) => !!s.exporting);
  const batchStatus = useVizStore((s) => s.batchStatus);
  const showLibrary = useVizStore((s) => s.showLibrary);
  const liveInputActive = useVizStore((s) => s.liveInputActive);
  const showBatch = useVizStore((s) => s.showBatch);
  const showShaderEditor = useVizStore((s) => s.showShaderEditor);
  const showShadertoyImport = useVizStore((s) => s.showShadertoyImport);

  const store = useVizStore.getState; // stable accessor for actions/handlers

  // App prefs, read reactively: prefs are module state (not the store), and
  // the render loop reads them fresh via getPrefs() — but the perf overlay
  // mount/config must RE-RENDER on change, so App subscribes through the
  // prefs emitter. setPrefs replaces the whole object, so getPrefs is a
  // valid useSyncExternalStore snapshot.
  const appPrefs = useSyncExternalStore(subscribePrefs, getPrefs);

  // Focus trap + initial focus + focus restore for the two modals owned
  // directly by App (Help, Export) — BatchPanel and ShaderEditor manage their
  // own (H17: "aria-modal on four dialogs with no focus trap, no initial
  // focus, no focus restore").
  const helpDialogRef = useFocusTrap(showHelp);

  // Library panel width (v2.40 layout system). The value drives the
  // `--panel-w` CSS variable on the app root; every offset that depends on it
  // derives via calc() in App.css. Persisted per install.
  //
  // Since P-1, `--panel-w` sizes the LIBRARY ONLY: Visuals is a dock
  // with its own `visualsWidth` pref, a sibling field rather than a
  // reinterpretation of this one — reusing `panelWidth` would have handed
  // every existing user a 280px dock on first launch.
  const [panelW, setPanelW] = useState(() => getPrefs().panelWidth);
  // Pointer-capture drag + capture-phase Escape-cancel (E2-U1) now lives in
  // DockResizeHandle, shared with the Visuals handle below — see its own
  // doc comment for why (ModulationPage's startRouteDrag idiom, and why it
  // has to be a real mountable unit rather than inline here).
  const libraryResizeKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const next = resizeKeyValue(e, panelW, 240, 440, 1);
      if (next === null || next === panelW) return;
      setPanelW(next);
      setPrefs({ panelWidth: next });
    },
    [panelW],
  );

  // Visuals dock width. TWO values on purpose (P-1):
  //   visualsW      -> --visuals-w-set  -> the canvas column and all chrome
  //   visualsDragW  -> --visuals-w-drag -> the dock element and its handle
  // They are the same number except while the handle is being dragged. A
  // single committed width would push the `.stage` box on every pointermove,
  // and the ResizeObserver behind it destroys and recreates EVERY render
  // target at full DPR (fade, feedback, deep, post) with feedbackClearPending
  // set — i.e. feedback trails strobing to black ~60 times a second. So the
  // dock tracks the pointer and the canvas commits exactly once, on pointerup.
  const [visualsW, setVisualsW] = useState(() => getPrefs().visualsWidth);
  const [visualsDragW, setVisualsDragW] = useState<number | null>(null);
  // Pointer-capture drag + capture-phase Escape-cancel (E2-U1) lives in
  // DockResizeHandle (shared with the Library handle above). Cancelling
  // here just clears visualsDragW back to null — visualsW (the committed
  // value the canvas actually uses) never changes mid-drag in the first
  // place, so there is nothing else to revert.
  const visualsResizeKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // No drag state: one keypress is one resize, not sixty a second, so this
      // commits and persists immediately.
      const next = resizeKeyValue(e, visualsW, 380, 760, -1);
      if (next === null || next === visualsW) return;
      setVisualsW(next);
      setPrefs({ visualsWidth: next });
    },
    [visualsW],
  );

  // Auto-updater (desktop): silent check shortly after boot; the manual check
  // and both install buttons live in Preferences › Updates and the startup
  // prompt. The machine itself is state/updater.ts (G5) — App only renders
  // it. Two snapshots rather than one object: the getters must return stable
  // references or useSyncExternalStore loops, and a download progress tick
  // must not re-render whoever only asks whether the prompt is mounted.
  const update = useSyncExternalStore(subscribeUpdate, getUpdatePhase);
  const updatePromptOpen = useSyncExternalStore(subscribeUpdate, isUpdatePromptOpen);
  useEffect(() => scheduleStartupUpdateCheck(), []);

  // The block of ~36 `useCallback` forwarders that used to sit here is gone
  // (P-12 wave 2). Every panel below reads the store itself and calls actions
  // at the click site, so there is no prop identity left for App to hold
  // still, and no memo() left that would have depended on it. What App still
  // owns is the MOUNT GATES (`{showX && <X />}`): moving one inside its panel
  // would keep that panel mounted forever and persist its local UI state —
  // TimelinePanel's zoom and scene selection, ShaderEditor's whole draft —
  // across a close and reopen, which is a behaviour change, not a refactor.

  // One-time init: engine, renderer (with GPU-loss recovery), frame loop
  useEffect(() => {
    return store().initApp(canvasRef.current!);
  }, [store]);

  // Re-arm the chrome idle timer when playback starts (e.g. via keyboard)
  useEffect(() => {
    if (playing) store().pokeChrome();
  }, [playing, store]);

  // P-11: desktop boot prefers the autosave .bfproj over the localStorage
  // cache already on screen (isTauri()-gated inside the action; a no-op in
  // the browser build). Runs once, after the app has booted into its normal
  // (localStorage-sourced) state — that state is now just the fallback.
  useEffect(() => {
    void store().bootDesktopDocument();
  }, [store]);

  // Preset thumbnails (P-3). The GENERATION is what became eager, not the
  // start of it: the run publishes its first ten chips as soon as they exist
  // instead of holding all sixteen back until the last PNG is encoded, and it
  // walks the strip's own order so those ten are the ten on screen
  // (render/thumbnails.ts owns both rules).
  //
  // The START stays deferred, and on the app's OWN renderer rather than on a
  // timer. Thumbnails render on a SECOND WebGPU device that competes with the
  // live render loop for one GPU, so what must not be undercut is the app's
  // first frames — and `rendererKind` settling to "webgpu" is exactly the
  // moment the app's device exists and its loop is running. Waiting on it also
  // means the Canvas2D fallback no longer makes a doomed adapter request and
  // logs a warning for thumbnails it can never draw, and that a device-loss
  // rebuild re-arms a run that died with the old device.
  //
  // Deliberately NOT gated on animation frames: rAF does not fire at all while
  // the window is hidden, so a shell launched minimized (or occluded at boot)
  // would sit with text chips until someone looked at it.
  //
  // The idle callback then carries a 300 ms DEADLINE. Plain
  // `requestIdleCallback` — what this replaces — can be starved indefinitely
  // by that same render loop, and its no-rIC fallback was a flat 1200 ms.
  //
  // The store action owns the render and the publishing; this effect owns
  // only WHEN to start it, because "a WebGPU device exists" is a
  // component-lifecycle fact and the store has no business watching for it.
  // Cleanup cancels whatever is armed — under StrictMode's dev-only
  // mount→cleanup→remount the first mount's callback never fires.
  useEffect(() => {
    if (rendererKind !== "webgpu") return;
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let cancelled = false;
    let idleHandle: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const kick = () => {
      if (cancelled) return;
      store().loadPresetThumbnails();
    };
    if (w.requestIdleCallback) idleHandle = w.requestIdleCallback(kick, { timeout: 300 });
    else timer = setTimeout(kick, 300);
    return () => {
      cancelled = true;
      if (idleHandle !== null) w.cancelIdleCallback?.(idleHandle);
      if (timer !== null) clearTimeout(timer);
    };
  }, [rendererKind, store]);

  // Keyboard shortcuts — the whole global key map lives in useAppShortcuts.
  useAppShortcuts(store);

  // Surface anything that slipped past local error handling
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      console.error("[unhandled]", e.reason);
      store().setError(`Unexpected error: ${e.reason?.message ?? String(e.reason)}`);
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, [store]);

  // DEV or explicit local test-build E2E hooks. Ordinary production builds
  // leave VITE_E2E_HOOKS unset and expose nothing.
  useEffect(() => {
    if (import.meta.env.DEV || import.meta.env.VITE_E2E_HOOKS === "1") installDevHooks(store);
  }, [store]);

  // Dev-only: drive the update prompt with a synthetic phase so the dialog
  // (which otherwise needs an installed build plus a newer release) can be
  // exercised and visually verified in the browser harness. Same signature as
  // before G5 — it just points at the machine's own entry point now, so it
  // drives Preferences › Updates as well as the prompt.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__setUpdatePhase = setUpdatePhase;
  }, []);

  // One sentence for every Export/Batch entry point in the shell, so the
  // top-bar tooltips, the dialog and the store guard all give the same reason
  // (F2). The sentence itself is NOT written here (G7): a second literal is
  // how the button and the dialog it opens ended up wording the same refusal
  // differently. Null on the normal path — nothing below changes there.
  const exportBlocked = simplifiedRenderer ? SIMPLIFIED_EXPORT_REASON : null;

  // Idle-hide only when nothing interactive is open (audit U6): the library,
  // guide and settings are .chrome too, so holding the pointer still while
  // READING one used to fade it out under the cursor.
  //
  // `!showPanel` is deliberately NOT in this chain since P-1. The Visuals is
  // a persistent dock, so keeping it here would disable idle-hide — and
  // cursor-hide — for the entire app, forever, for anyone who works with it
  // open. The dock instead opts out of the fade itself (App.css,
  // `.app.idle .params-panel`), which is what lets the bars still fade around it.
  const idle =
    chromeIdle &&
    playing &&
    !showExport &&
    !showHelp &&
    !showGuide &&
    !showSettings &&
    !showLibrary;

  return (
    <div
      className={`app ${dragOver ? "drag-over" : ""} ${idle ? "idle" : ""} ${stageMode ? "stage-mode" : ""}`}
      style={
        {
          "--panel-w": `${panelW}px`,
          "--visuals-w-set": showPanel ? `${visualsW}px` : "0px",
          "--visuals-w-drag": showPanel ? `${visualsDragW ?? visualsW}px` : "0px",
        } as React.CSSProperties
      }
      onMouseMove={() => store().pokeChrome()}
      onPointerDown={() => store().pokeChrome()}
      // Keyboard focus (Tab) fires no pointer event, so without this a keyboard
      // user tabbing during playback lands on idle-hidden chrome. onFocus
      // bubbles (focusin), so focusing any control wakes the chrome.
      onFocus={() => store().pokeChrome()}
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
        // Shaders and themes import by drag, from anywhere.
        const shader = files.find((f) => f.name.toLowerCase().endsWith(".bfshader"));
        if (shader) {
          void shader.text().then((t) => store().importCustomPresetText(t));
          return;
        }
        // Themes import by drag, from anywhere (Explorer, a GitHub
        // download, Discord) — the whole ecosystem loop in one gesture.
        const theme = files.find((f) => f.name.toLowerCase().endsWith(".bftheme"));
        if (theme) {
          void theme.text().then((t) => store().importThemeText(t));
          return;
        }
        // Projects open by drag too. Without this the file fell through to
        // loadFile() below and the AUDIO decoder rejected it with "Unable to
        // decode audio data" — invisible until v2.49.0 made drops arrive at
        // all on Windows.
        const project = files.find((f) => f.name.toLowerCase().endsWith(".bfproj"));
        if (project) {
          void project.text().then((t) => store().openProjectText(project.name, t));
          return;
        }
        // Timed lyrics: drop an .lrc/.srt alone (attaches to the current
        // track) or together with an audio file (applied AFTER the track
        // loads — loading clears per-track lyrics, so order matters).
        const lyricFile = files.find((f) => /\.(lrc|srt)$/i.test(f.name));
        const rest = lyricFile ? files.filter((f) => f !== lyricFile) : files;
        const applyLyrics = lyricFile
          ? () => lyricFile.text().then((t) => store().loadLyricsText(lyricFile.name, t))
          : null;
        if (rest.length === 0) {
          if (applyLyrics) void applyLyrics();
          return;
        }
        // With the batch panel open, dropped tracks QUEUE — the panel says
        // "drop in a folder of tracks", and replacing the live track with
        // files[0] while ignoring the rest betrayed exactly that promise.
        if (store().showBatch) {
          void store().addBatchTracks(rest);
          if (applyLyrics) void applyLyrics();
        } else {
          void store()
            .loadFile(rest[0])
            .then(() => applyLyrics?.());
        }
      }}
    >
      <div className="stage">
        <canvas
          ref={canvasRef}
          // H17: the canvas is the entire product surface and previously had
          // no role/label at all, making it invisible to assistive tech. It's
          // a display, not a control — the real play/pause and fullscreen
          // affordances are the PlayerBar/top-bar buttons — so role="img"
          // plus a preset-aware label, not a button/application role.
          role="img"
          aria-label={trackName ? `${preset.name} audio visualization` : "Audio visualization"}
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
          onClick={() => trackName && void store().togglePlay()}
          onDoubleClick={toggleFullscreen}
        />
      </div>
      {appPrefs.perfOverlay && (
        <PerfOverlay
          corner={appPrefs.perfOverlayCorner}
          size={appPrefs.perfOverlaySize}
          color={appPrefs.perfOverlayColor}
          show={appPrefs.perfOverlayStats}
          rendererKind={rendererKind}
        />
      )}
      {stageMode && blackout && <div className="blackout-overlay" />}
      {/* Keyed by presetId so it re-mounts and replays the fade on each switch
          — the CSS animation ends hidden, so no timer/state is needed. */}
      {stageMode && !blackout && (
        <div className="stage-hud" key={presetId}>
          {preset.name}
        </div>
      )}

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
          <span>{showBatch ? "Drop to add to the batch queue" : "Drop to load"}</span>
        </div>
      )}

      {!trackName && !dragOver && (
        <EmptyState
          demos={demos}
          onOpenFile={() => fileInputRef.current?.click()}
          onDemo={(id) => void store().loadDemo(id)}
          onGallery={() => store().setShowGallery(true)}
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
              <button
                className="menu-item"
                title="Reset everything to a clean default project (Ctrl+Z undoes it)"
                onClick={() => store().newProject()}
              >
                New project
              </button>
              <button className="menu-item" onClick={() => void store().saveProject()}>
                Save project… <kbd className="menu-kbd">Ctrl+S</kbd>
              </button>
              <button className="menu-item" onClick={() => void store().openProject()}>
                Open project… <kbd className="menu-kbd">Ctrl+O</kbd>
              </button>
            </div>
          </div>
          <button
            className="ghost-btn"
            title="Browse community looks and themes"
            onClick={() => store().setShowGallery(true)}
          >
            <IconGallery size={16} />
            Gallery
          </button>
        </div>
        <div className="top-right">
          <button
            className="ghost-btn accent"
            disabled={!trackName || batchStatus === "running" || !!exportBlocked}
            title={
              exportBlocked ??
              (batchStatus === "running"
                ? "Batch render in progress"
                : trackName
                  ? "Export MP4 video"
                  : "Load a track first")
            }
            onClick={() => store().setShowExport(true)}
          >
            <IconExport size={16} />
            Export
          </button>
          <button
            className={`icon-btn ${showBatch ? "active" : ""}`}
            title={exportBlocked ?? "Batch render — one video per track (B)"}
            aria-label="Batch render"
            aria-pressed={showBatch}
            // Closing an OPEN panel must stay possible even when blocked, or a
            // mid-session fallback (GPU reset) would strand it on screen.
            disabled={(showBatch && batchStatus === "running") || (!!exportBlocked && !showBatch)}
            onClick={() => store().setShowBatch(!showBatch)}
          >
            <IconBatch size={18} />
          </button>
          <button
            className={`icon-btn ${showLibrary ? "active" : ""}`}
            title="Music library (Q)"
            aria-label="Music library"
            aria-pressed={showLibrary}
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
            aria-label="Visualize system audio"
            aria-pressed={liveInputActive}
            disabled={exporting || batchStatus === "running"}
            onClick={() => void store().toggleLiveInput()}
          >
            <IconBroadcast size={18} />
          </button>
          <button
            className={`icon-btn ${stageMode ? "active" : ""}`}
            title="Stage mode — chrome-free output for performance/capture (S)"
            aria-label="Stage mode"
            aria-pressed={stageMode}
            onClick={() => store().setStageMode(!stageMode)}
          >
            <IconStage size={18} />
          </button>
          {/* Labelled, not a bare glyph: it now toggles a persistent dock that
              takes real estate away from the visual, and `.ghost-btn` is the
              established labelled-button idiom. Same slot, so the other eight
              buttons keep their positions. */}
          <button
            className={`ghost-btn ${showPanel ? "active" : ""}`}
            title="Visuals — every control for the current visual (G)"
            aria-pressed={showPanel}
            onClick={() => store().setShowPanel((v) => !v)}
          >
            <IconSettings size={16} />
            Visuals
          </button>
          <button
            className={`icon-btn ${showSettings ? "active" : ""}`}
            title="Preferences — autosave, performance, updates (Ctrl+,)"
            aria-label="Preferences"
            aria-pressed={showSettings}
            onClick={() => store().setShowSettings(!showSettings)}
          >
            <IconGear size={18} />
          </button>
          <button
            className="icon-btn"
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            onClick={() => store().setShowHelp(!showHelp)}
          >
            <IconHelp size={18} />
          </button>
          <button
            className="icon-btn"
            title="Fullscreen (F)"
            aria-label="Toggle fullscreen"
            onClick={toggleFullscreen}
          >
            <IconFullscreen size={18} />
          </button>
        </div>
      </header>

      <PresetStrip />

      {showLibrary && <LibraryPanel />}

      {/* The Library's own grip. Until P-1 the single resize handle mounted
          only alongside Visuals, so opening the Library on its own left
          it unresizable — splitting the two widths is what exposes that. */}
      {showLibrary && (
        <DockResizeHandle
          className="panel-resize-handle library-resize-handle chrome"
          ariaLabel="Resize the library"
          title="Drag to resize the library"
          value={panelW}
          ariaValueNow={panelW}
          min={240}
          max={440}
          // Library hugs the LEFT edge: width = pointer distance past the gutter.
          compute={(ev) => Math.min(440, Math.max(240, ev.clientX - 14))}
          onDrag={setPanelW}
          onCommit={(v) => setPrefs({ panelWidth: v })}
          onCancel={setPanelW}
          onKeyDown={libraryResizeKey}
        />
      )}

      {showPanel && (
        <DockResizeHandle
          className="panel-resize-handle chrome"
          ariaLabel="Resize Visuals"
          title="Drag to resize Visuals"
          value={visualsW}
          ariaValueNow={visualsDragW ?? visualsW}
          min={380}
          max={760}
          // The dock is flush to the right edge — no gutter term, unlike the Library.
          compute={(ev) => Math.min(760, Math.max(380, window.innerWidth - ev.clientX))}
          onDrag={setVisualsDragW}
          onCommit={(v) =>
            commitVisualsWidth(v, setVisualsDragW, setVisualsW, (w) =>
              setPrefs({ visualsWidth: w }),
            )
          }
          onCancel={() => setVisualsDragW(null)}
          onKeyDown={visualsResizeKey}
        />
      )}
      {showPanel && <ParamsPanel />}

      {showTimeline && <TimelinePanel />}

      <PlayerBar />

      {/* A column, not three absolutely-positioned siblings at the same
          bottom offset: recovery + error could already co-occur and drew on
          top of each other, and the persistent fallback banner below would
          have made that a three-way pile-up. With one toast the geometry is
          byte-identical to what the single .toast rule produced. */}
      <div className="toast-stack">
        {/* The one banner that never expires. The Canvas2D fallback used to
            announce itself as a 4-second notice while the whole UI went on
            offering 16 modes, post, Motion, Builder and Export that it
            silently discards (audit F1). It lasts as long as the condition
            does, and dismissing it is the user's call, not a timer's. */}
        {simplifiedRenderer && !simplifiedNoticeDismissed && (
          <div className="toast fallback-toast" role="alert">
            <div className="toast-body">
              <strong className="toast-title">Hardware rendering unavailable</strong>
              <span className="toast-text">
                {rendererWarning ??
                  "WebGPU is unavailable on this system, so Beatform is drawing a simplified preview."}{" "}
                Every visual mode draws the same spectrum bars; post-processing, the Motion masters,
                Builder, the shader editor, scene transitions and video backgrounds are switched
                off. Video export and batch render are disabled — your project is unharmed and
                renders in full on a system with hardware rendering.
              </span>
            </div>
            <button
              className="chip-x"
              aria-label="Dismiss the simplified rendering notice"
              title="Dismiss — the affected controls stay disabled"
              onClick={() => store().dismissSimplifiedNotice()}
            >
              <IconClose size={13} />
            </button>
          </div>
        )}
        {/* role=alert so a screen reader is actually told; dismissible so a
            sticky message isn't a dead end that sits over Stage mode all
            session; selectable so the text can be copied into a bug report. */}
        {error && (
          <div className="toast error-toast" role="alert">
            <span className="toast-text">{error}</span>
            <button
              className="chip-x"
              aria-label="Dismiss error"
              title="Dismiss"
              onClick={() => store().clearError()}
            >
              <IconClose size={13} />
            </button>
          </div>
        )}
        {notice && !error && (
          <div className="toast notice-toast" role="status">
            <span className="toast-text">{notice}</span>
          </div>
        )}
      </div>

      {showShaderEditor && <ShaderEditor />}

      {showShadertoyImport && <ShadertoyImport />}

      {showHelp && (
        <div className="modal-backdrop" onClick={() => store().setShowHelp(false)}>
          <div
            ref={helpDialogRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <span className="panel-heading">Keyboard shortcuts</span>
              <button
                className="icon-btn subtle"
                aria-label="Close"
                onClick={() => store().setShowHelp(false)}
              >
                <IconClose size={16} />
              </button>
            </div>
            <div className="shortcut-list">
              {groupShortcutRows().map(({ group, rows }) => (
                <Fragment key={group}>
                  <div className="shortcut-group-heading">{group}</div>
                  {rows.map((row) => (
                    <div key={row.keys.join("+")} className="shortcut-row">
                      <span className="shortcut-keys">
                        {row.keys.flatMap((k, i) =>
                          i === 0 ? [<kbd key={k}>{k}</kbd>] : [" / ", <kbd key={k}>{k}</kbd>],
                        )}
                      </span>
                      <span>
                        {row.action}
                        {row.note ? ` (${row.note})` : ""}
                      </span>
                    </div>
                  ))}
                </Fragment>
              ))}
              {/* Not literal-key-driven, so SHORTCUT_SHEET carries no row for
                  it (useAppShortcuts.test.tsx's coverage test deliberately
                  excludes Escape — "the universal dismiss cascade, documented
                  in prose, not a binding a user learns"): stays hand-written,
                  trailing the sheet-driven rows above. */}
              <div className="shortcut-group-heading">Always available</div>
              <div className="shortcut-row">
                <span className="shortcut-keys">
                  <kbd>Esc</kbd>
                </span>
                <span>
                  Close dialogs and panels, or exit Stage mode (while typing, just cancels the
                  field)
                </span>
              </div>
            </div>
            <div className="about-line">Beatform v{APP_VERSION}</div>
            <div className="update-line">
              <button
                className="ghost-btn accent"
                title="Open the full in-app user guide"
                onClick={() => {
                  store().setShowHelp(false);
                  store().setShowGuide(true);
                }}
              >
                User guide…
              </button>
              <button
                className="ghost-btn"
                title="Preferences — autosave, performance, updates (Ctrl+,)"
                onClick={() => {
                  store().setShowHelp(false);
                  store().setShowSettings(true);
                }}
              >
                Preferences…
              </button>
            </div>
          </div>
        </div>
      )}

      {showGallery && <GalleryDialog />}

      {updatePromptOpen && (
        <UpdatePrompt
          update={update}
          onInstall={() => void installUpdate()}
          onRelaunch={() => void relaunchApp()}
          onDismiss={dismissUpdatePrompt}
        />
      )}

      {showBatch && <BatchPanel />}

      {showGuide && <GuideDialog onClose={() => store().setShowGuide(false)} />}
      {showExport && <ExportDialog />}
      {showSettings && <SettingsDialog />}
    </div>
  );
}
