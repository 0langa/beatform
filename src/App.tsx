import { useCallback, useEffect, useMemo, useRef } from "react";
import { demos } from "./audio/demoTrack";
import { BG_TRANSPARENT, DEFAULT_POST } from "./render/types";
import { presets, presetById } from "./render/presets";
import { exportVideo } from "./export/videoExporter";
import { CODEC_LABELS, type VideoCodecId } from "./export/codecProbe";
import { APP_VERSION } from "./version";

const CODEC_IDS: readonly VideoCodecId[] = ["h264", "hevc", "av1", "vp9a"];
import { getEngine } from "./state/services";
import { rasterizeOverlay } from "./render/overlay";
import { BatchPanel, type BatchPanelProps } from "./ui/BatchPanel";
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
import { PlayerBar, type PlayerBarProps } from "./ui/PlayerBar";
import { LibraryPanel, type LibraryPanelProps } from "./ui/LibraryPanel";
import { isTauri } from "./state/platform";
import { midiSupported } from "./state/midiInput";
import { audiogramActive } from "./state/audiogram";
import { TimelinePanel, type TimelinePanelProps } from "./ui/TimelinePanel";
import { PresetStrip } from "./ui/PresetStrip";
import { ShaderEditor, type ShaderEditorProps } from "./ui/ShaderEditor";
import { ParamsPanel, type ParamsPanelProps } from "./ui/ParamsPanel";
import { EmptyState } from "./ui/EmptyState";
import { Slider } from "./ui/Slider";
import { Switch } from "./ui/Switch";
import { useFocusTrap } from "./ui/useFocusTrap";
import {
  IconBatch,
  IconClose,
  IconExport,
  IconFolder,
  IconFullscreen,
  IconHelp,
  IconBroadcast,
  IconMusic,
  IconSettings,
  IconStage,
} from "./ui/Icons";
import "./App.css";

const MIDI_SUPPORTED = midiSupported();

/** Input types that are real text entry — these swallow every shortcut. A
 * range/color/checkbox/file input is NOT text entry and must not block Ctrl+Z. */
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "password", "number", "tel"]);

/** Keys a focused form control handles natively (slider stepping, select
 * navigation) — the global shortcuts must not double-handle them. */
const NATIVE_CONTROL_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  " ",
]);

const SHORTCUTS: Array<[string, string]> = [
  ["Space", "Play / pause"],
  ["← / →", "Seek 5 s"],
  ["↑ / ↓", "Volume"],
  ["M", "Mute"],
  ["L", "Loop"],
  ["[ / ]", "Previous / next preset"],
  ["1 – 9", "Jump to mode (beat-quantized when Live › Quantize is on)"],
  ["\\", "Stage mode (chrome-free output) · . blackout · Esc exits"],
  ["G", "Settings panel"],
  ["F", "Fullscreen"],
  ["Ctrl+S", "Save project"],
  ["Ctrl+O", "Open project"],
  ["Ctrl+Z / Ctrl+Y", "Undo / redo"],
  ["T", "Timeline panel"],
  ["B", "Batch render"],
  ["Q", "Music library"],
  ["?", "This shortcut list"],
];

/**
 * FNV-1a over raw PNG bytes — a content fingerprint for the export harness.
 * Not cryptographic; it only has to make "these two frames differ" cheap to
 * see across thousands of frames.
 */
function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

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
  const pendingPresetId = useVizStore((s) => s.pendingPresetId);
  const switchQuantize = useVizStore((s) => s.switchQuantize);
  const midiEnabled = useVizStore((s) => s.midiEnabled);
  const midiDevices = useVizStore((s) => s.midiDevices);
  const midiBindings = useVizStore((s) => s.midiBindings);
  const midiLearn = useVizStore((s) => s.midiLearn);
  const preset = presetById(presetId);
  const params = useVizStore((s) => s.activeParams);
  const bg = useVizStore((s) => s.bg);
  const sync = useVizStore((s) => s.sync);
  const playback = useVizStore((s) => s.playback);
  const volume = useVizStore((s) => s.volume);
  const muted = useVizStore((s) => s.muted);
  const rendererKind = useVizStore((s) => s.rendererKind);
  const chromeIdle = useVizStore((s) => s.chromeIdle);
  const stageMode = useVizStore((s) => s.stageMode);
  const blackout = useVizStore((s) => s.blackout);
  const dragOver = useVizStore((s) => s.dragOver);
  const showPanel = useVizStore((s) => s.showPanel);
  const showHelp = useVizStore((s) => s.showHelp);
  const showExport = useVizStore((s) => s.showExport);
  const error = useVizStore((s) => s.error);
  const notice = useVizStore((s) => s.notice);
  const recoveredDoc = useVizStore((s) => s.recoveredDoc);
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
  const presetThumbs = useVizStore((s) => s.presetThumbs);
  const stems = useVizStore((s) => s.stems);
  const stemAnalyzing = useVizStore((s) => s.stemAnalyzing);
  const lyricFileName = useVizStore((s) => s.lyricFileName);
  const lyricStyle = useVizStore((s) => s.lyricStyle);
  const audiogram = useVizStore((s) => s.audiogram);
  const videoBgLoading = useVizStore((s) => s.videoBgLoading);
  const showBatch = useVizStore((s) => s.showBatch);
  const customDefs = useVizStore((s) => s.customDefs);
  const showShaderEditor = useVizStore((s) => s.showShaderEditor);
  const allPresets = useMemo(() => [...presets, ...customDefs], [customDefs]);

  const store = useVizStore.getState; // stable accessor for actions/handlers

  // Stable handlers for the always-mounted PresetStrip so it can stay memoized
  // across playback ticks (store.getState is itself stable). Clicking a mode
  // goes through queuePreset so it obeys the beat-quantize takeover.
  const switchPreset = useCallback((id: string) => store().queuePreset(id), [store]);
  const openShaderEditor = useCallback(() => store().setShowShaderEditor(true), [store]);

  // Focus trap + initial focus + focus restore for the two modals owned
  // directly by App (Help, Export) — BatchPanel and ShaderEditor manage their
  // own (H17: "aria-modal on four dialogs with no focus trap, no initial
  // focus, no focus restore").
  const helpDialogRef = useFocusTrap(showHelp);
  const exportDialogRef = useFocusTrap(showExport);

  // Stable callback props for the six memoized panels below (H13): memo()
  // does nothing if a component receives a FRESH function reference every
  // render, so every callback these panels take is created once here
  // instead of as an inline arrow in JSX. Nearly all of them just forward
  // to a store action through the stable `store` accessor, so `[store]` is
  // the only real dependency — the one exception (toggleMute) is called
  // out where it happens.

  // LibraryPanel
  const libraryPickFolder: LibraryPanelProps["onPickFolder"] = useCallback(
    () => void store().pickLibraryFolder(),
    [store],
  );
  const libraryPlay: LibraryPanelProps["onPlay"] = useCallback(
    (path) => void store().playLibraryTrack(path),
    [store],
  );
  const setLibraryAutoAdvance: LibraryPanelProps["onAutoAdvance"] = useCallback(
    (v) => store().setLibraryAutoAdvance(v),
    [store],
  );
  const closeLibrary: LibraryPanelProps["onClose"] = useCallback(
    () => store().setShowLibrary(false),
    [store],
  );

  // ParamsPanel
  const setParam: ParamsPanelProps["onParam"] = useCallback(
    (k, v) => store().setParam(k, v),
    [store],
  );
  const applyStyleCb: ParamsPanelProps["onApplyStyle"] = useCallback(
    (values) => store().applyStyle(values),
    [store],
  );
  const resetParams: ParamsPanelProps["onReset"] = useCallback(
    () => store().resetParams(),
    [store],
  );
  const setBg: ParamsPanelProps["onBg"] = useCallback((next) => store().setBg(next), [store]);
  const pickBackgroundImage: ParamsPanelProps["onPickBackgroundImage"] = useCallback(
    () => void store().pickBackgroundImage(),
    [store],
  );
  const applyAlbumArtBackground: ParamsPanelProps["onUseAlbumArtBackground"] = useCallback(
    () => store().useAlbumArtBackground(),
    [store],
  );
  const pickVideoBackground: ParamsPanelProps["onPickVideoBackground"] = useCallback(
    () => void store().pickVideoBackground(),
    [store],
  );
  const setSync: ParamsPanelProps["onSync"] = useCallback((next) => store().setSync(next), [store]);
  const closeParams: ParamsPanelProps["onClose"] = useCallback(
    () => store().setShowPanel(false),
    [store],
  );
  const setAspect: ParamsPanelProps["onAspect"] = useCallback((a) => store().setAspect(a), [store]);
  const applyTheme: ParamsPanelProps["onApplyTheme"] = useCallback(
    (document, name) => store().applyTheme(document, name),
    [store],
  );
  const exportTheme: ParamsPanelProps["onExportTheme"] = useCallback(
    (meta) => void store().exportCurrentTheme(meta),
    [store],
  );
  const saveUserPreset: ParamsPanelProps["onSaveUserPreset"] = useCallback(
    (name) => store().saveUserPreset(name),
    [store],
  );
  const applyUserPreset: ParamsPanelProps["onApplyUserPreset"] = useCallback(
    (id) => store().applyUserPreset(id),
    [store],
  );
  const deleteUserPreset: ParamsPanelProps["onDeleteUserPreset"] = useCallback(
    (id) => store().deleteUserPreset(id),
    [store],
  );
  const exportUserPreset: ParamsPanelProps["onExportUserPreset"] = useCallback(
    (id) => void store().exportUserPreset(id),
    [store],
  );
  const importUserPreset: ParamsPanelProps["onImportUserPreset"] = useCallback(
    () => void store().importUserPreset(),
    [store],
  );
  const addTextLayer: ParamsPanelProps["onAddTextLayer"] = useCallback(
    () => store().addTextLayer(),
    [store],
  );
  const addImageLayer: ParamsPanelProps["onAddImageLayer"] = useCallback(
    () => void store().addImageLayer(),
    [store],
  );
  const addAlbumArtLayer: ParamsPanelProps["onAddAlbumArtLayer"] = useCallback(
    () => store().addAlbumArtLayer(),
    [store],
  );
  const updateLayer: ParamsPanelProps["onUpdateLayer"] = useCallback(
    (id, patch) => store().updateOverlayLayer(id, patch),
    [store],
  );
  const removeLayer: ParamsPanelProps["onRemoveLayer"] = useCallback(
    (id) => store().removeOverlayLayer(id),
    [store],
  );
  const setSmoothSpectrum: ParamsPanelProps["onSmoothSpectrum"] = useCallback(
    (v) => store().setSmoothSpectrum(v),
    [store],
  );
  const setPost: ParamsPanelProps["onPost"] = useCallback(
    (patch) => store().setPost(patch),
    [store],
  );
  const setMotion: ParamsPanelProps["onMotion"] = useCallback(
    (patch) => store().setMotion(patch),
    [store],
  );
  const setSwitchQuantize: ParamsPanelProps["onSwitchQuantize"] = useCallback(
    (m) => store().setSwitchQuantize(m),
    [store],
  );
  const enableMidi: ParamsPanelProps["onEnableMidi"] = useCallback(
    () => void store().enableMidi(),
    [store],
  );
  const disableMidi: ParamsPanelProps["onDisableMidi"] = useCallback(
    () => store().disableMidi(),
    [store],
  );
  const setMidiLearn: ParamsPanelProps["onMidiLearn"] = useCallback(
    (l) => store().setMidiLearn(l),
    [store],
  );
  const removeMidiBinding: ParamsPanelProps["onRemoveMidiBinding"] = useCallback(
    (id) => store().removeMidiBinding(id),
    [store],
  );
  const addStem: ParamsPanelProps["onAddStem"] = useCallback(
    (f) => void store().addStem(f),
    [store],
  );
  const removeStem: ParamsPanelProps["onRemoveStem"] = useCallback(
    (slot) => store().removeStem(slot),
    [store],
  );
  const autoRouteStem: ParamsPanelProps["onAutoRouteStem"] = useCallback(
    (slot) => store().autoRouteStem(slot),
    [store],
  );
  const addMod: ParamsPanelProps["onAddMod"] = useCallback(
    (source, param) => store().addModRoute(source, param),
    [store],
  );
  const updateMod: ParamsPanelProps["onUpdateMod"] = useCallback(
    (id, patch) => store().updateModRoute(id, patch),
    [store],
  );
  const removeMod: ParamsPanelProps["onRemoveMod"] = useCallback(
    (id) => store().removeModRoute(id),
    [store],
  );
  const importLyrics: ParamsPanelProps["onImportLyrics"] = useCallback(
    (f) => void f.text().then((t) => store().loadLyricsText(f.name, t)),
    [store],
  );
  const clearLyrics: ParamsPanelProps["onClearLyrics"] = useCallback(
    () => store().clearLyrics(),
    [store],
  );
  const setLyricStyle: ParamsPanelProps["onLyricStyle"] = useCallback(
    (patch) => store().setLyricStyle(patch),
    [store],
  );
  const setAudiogram: ParamsPanelProps["onAudiogram"] = useCallback(
    (patch) => store().setAudiogram(patch),
    [store],
  );

  // TimelinePanel
  const autoArrangeTimeline: TimelinePanelProps["onAutoArrange"] = useCallback(
    () => store().autoArrangeTimeline(),
    [store],
  );
  const setTimelineData: TimelinePanelProps["onChange"] = useCallback(
    (tl) => store().setTimeline(tl),
    [store],
  );
  const timelineSeek: TimelinePanelProps["onSeek"] = useCallback(
    (t) => store().seekEnd(t),
    [store],
  );
  const closeTimeline: TimelinePanelProps["onClose"] = useCallback(
    () => store().setShowTimeline(false),
    [store],
  );

  // PlayerBar
  const togglePlay: PlayerBarProps["onTogglePlay"] = useCallback(
    () => void store().togglePlay(),
    [store],
  );
  const seekStart: PlayerBarProps["onSeekStart"] = useCallback(() => store().seekStart(), [store]);
  const seekEnd: PlayerBarProps["onSeekEnd"] = useCallback((t) => store().seekEnd(t), [store]);
  const toggleLoop: PlayerBarProps["onToggleLoop"] = useCallback(
    () => store().toggleLoop(),
    [store],
  );
  const setVolume: PlayerBarProps["onVolume"] = useCallback(
    (v) => store().applyVolume(v, false),
    [store],
  );
  // Reads volume/muted fresh off the store snapshot at call time rather than
  // closing over the render-scope `volume`/`muted` selector values above, so
  // this stays keyed on [store] alone — including volume/muted in the deps
  // would recreate the callback (and re-render PlayerBar) on every volume
  // change, exactly the reconciliation this fix is meant to remove.
  const toggleMute: PlayerBarProps["onToggleMute"] = useCallback(() => {
    const s = store();
    s.applyVolume(s.volume, !s.muted);
  }, [store]);

  // ShaderEditor
  const saveCustomPreset: ShaderEditorProps["onSave"] = useCallback(
    (def) => store().saveCustomPreset(def),
    [store],
  );
  const deleteCustomPreset: ShaderEditorProps["onDelete"] = useCallback(
    (id) => store().deleteCustomPreset(id),
    [store],
  );
  const exportCustomPreset: ShaderEditorProps["onExport"] = useCallback(
    (id) => void store().exportCustomPreset(id),
    [store],
  );
  const importCustomPresetFile: ShaderEditorProps["onImportFile"] = useCallback(
    (f) => void f.text().then((t) => store().importCustomPresetText(t)),
    [store],
  );
  const closeShaderEditor: ShaderEditorProps["onClose"] = useCallback(
    () => store().setShowShaderEditor(false),
    [store],
  );

  // BatchPanel
  const addBatchTracks: BatchPanelProps["onAddTracks"] = useCallback(
    (files) => void store().addBatchTracks(files),
    [store],
  );
  const removeBatchTrack: BatchPanelProps["onRemoveTrack"] = useCallback(
    (id) => store().removeBatchTrack(id),
    [store],
  );
  const retitleBatchTrack: BatchPanelProps["onRetitle"] = useCallback(
    (id, title) => store().setBatchTrackMeta(id, { title }),
    [store],
  );
  const startBatch: BatchPanelProps["onStart"] = useCallback(
    () => void store().startBatch(),
    [store],
  );
  const skipBatchJob: BatchPanelProps["onSkipJob"] = useCallback(
    () => store().skipCurrentBatchJob(),
    [store],
  );
  const cancelBatch: BatchPanelProps["onCancel"] = useCallback(
    () => store().cancelBatch(),
    [store],
  );
  const retryFailedBatch: BatchPanelProps["onRetryFailed"] = useCallback(
    () => void store().retryFailedBatch(),
    [store],
  );
  const newBatch: BatchPanelProps["onNewBatch"] = useCallback(
    () => store().dismissBatch(),
    [store],
  );
  const closeBatch: BatchPanelProps["onClose"] = useCallback(
    () => store().setShowBatch(false),
    [store],
  );

  // One-time init: engine, renderer (with GPU-loss recovery), frame loop
  useEffect(() => {
    return store().initApp(canvasRef.current!);
  }, [store]);

  // Re-arm the chrome idle timer when playback starts (e.g. via keyboard)
  useEffect(() => {
    if (playback.playing) store().pokeChrome();
  }, [playback.playing, store]);

  // Did the last session end in a crash? Offer its autosave back. Runs once,
  // after the app has booted into its normal state — recovery is an offer, not
  // an interruption.
  useEffect(() => {
    void store().checkAutosaveRecovery();
  }, [store]);

  // Preset thumbnails render lazily on idle — startup paint stays instant.
  // Cleanup cancels whichever timer was armed: under StrictMode's dev-only
  // mount→cleanup→remount, the FIRST mount's callback is cancelled before it
  // ever fires, so only the second (real) mount's callback runs — without
  // this, both survived and every preset thumbnail was GPU-rendered twice.
  useEffect(() => {
    const kick = () => store().loadPresetThumbnails();
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (w.requestIdleCallback) {
      const handle = w.requestIdleCallback(kick);
      return () => w.cancelIdleCallback?.(handle);
    }
    const timer = setTimeout(kick, 1200);
    return () => clearTimeout(timer);
  }, [store]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? "";
      const inputType = (el as HTMLInputElement | null)?.type ?? "";
      // Genuine text entry swallows everything, so typing never fires a
      // shortcut and the field keeps its own native undo.
      const isTextEntry =
        tag === "TEXTAREA" ||
        el?.isContentEditable === true ||
        (tag === "INPUT" && TEXT_INPUT_TYPES.has(inputType));
      if (isTextEntry) return;

      const s = store();
      // Ctrl/Cmd shortcuts run from anywhere else — including a focused slider
      // or select, which is exactly the moment a user reaches for undo/save.
      // (This branch used to sit BELOW a blanket INPUT/SELECT/TEXTAREA guard,
      // so touching any slider silently killed Ctrl+Z/Y/S/O until focus moved.)
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
      // Plain-key shortcuts: a focused slider/checkbox owns its navigation
      // keys, and a focused <select> owns letters too (they jump options).
      // Everything else (G, T, B, Q, F, \, [, ], digits…) still works.
      if ((tag === "INPUT" || tag === "SELECT") && NATIVE_CONTROL_KEYS.has(e.key)) return;
      if (tag === "SELECT") return;
      // Number keys 1-9 jump to a mode by position, beat-quantized when the
      // Quantize control is on (the switch lands on the next beat/bar).
      if (e.key >= "1" && e.key <= "9") {
        const all = [...presets, ...s.customDefs];
        const target = all[Number(e.key) - 1];
        if (target) s.queuePreset(target.id);
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
        case "?":
          // README + docs/guide.md both tell users to press ? for shortcuts.
          s.setShowHelp(!s.showHelp);
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
        case "\\":
          s.setStageMode(!s.stageMode);
          break;
        case ".":
          if (s.stageMode) s.setBlackout(!s.blackout);
          break;
        case "Escape":
          s.setShowHelp(false);
          if (!s.exporting) s.setShowExport(false);
          // Never let Escape dismiss a running queue out from under itself.
          if (s.batchStatus !== "running") s.setShowBatch(false);
          if (s.stageMode) s.setStageMode(false);
          // The shader editor is intentionally NOT touched here (L12): it
          // holds unsaved WGSL, so it handles its own Escape locally (with a
          // confirm-before-discard gate) and stops the key event from
          // reaching this handler — see ShaderEditor.tsx's onKeyDown.
          s.setShowPanel(false);
          s.setShowLibrary(false);
          s.setShowTimeline(false);
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
      // A per-frame content hash, not just frame 0. Anything that ACCUMULATES
      // across frames (the particle sim, feedback trails) is identical on frame
      // 0 no matter how badly it diverges later, so a frame-0-only baseline
      // silently passes the exact regressions it exists to catch.
      const pngHashes: string[] = [];
      const result = await exportVideo(buf, {
        onPngFrame: opts.png
          ? (data, index) => {
              pngFrames.push(data.length);
              pngHashes.push(fnv1a(data));
              // Keep frame 0 around so tooling can decode + inspect it.
              if (index === 0) {
                (window as unknown as { __lastPngFrame: Blob }).__lastPngFrame = new Blob(
                  [data.slice()],
                  { type: "image/png" },
                );
              }
              // ...and the FINAL frame, which is the only useful one for
              // anything that accumulates. Frame 0 of the particle sim is the
              // initial seeded disc (uniform noise) and frame 0 of a feedback
              // preset has no trail at all, so a frame-0-only probe makes
              // those two look broken when they are working perfectly.
              (window as unknown as { __lastPngFrameEnd: Blob }).__lastPngFrameEnd = new Blob(
                [data.slice()],
                { type: "image/png" },
              );
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
        stems: s.stems,
        lyrics:
          s.lyrics && s.lyricStyle.enabled ? { lines: s.lyrics, style: s.lyricStyle } : undefined,
        audiogram: audiogramActive(s.audiogram)
          ? { settings: s.audiogram, waveform: s.waveformOverview }
          : undefined,
        customPresets: s.customDefs,
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
        bgVideo:
          s.bg.mode === 4 && s.bg.video && s.assets[s.bg.video.assetId]
            ? { dataUrl: s.assets[s.bg.video.assetId].dataUrl, dim: s.bg.video.dim }
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
        ...(opts.png ? { pngFrames: pngFrames.length, pngBytes: pngFrames, pngHashes } : {}),
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
      className={`app ${dragOver ? "drag-over" : ""} ${idle ? "idle" : ""} ${stageMode ? "stage-mode" : ""}`}
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
        // Shaders and templates import by drag, from anywhere.
        const shader = files.find((f) => f.name.toLowerCase().endsWith(".avshader"));
        if (shader) {
          void shader.text().then((t) => store().importCustomPresetText(t));
          return;
        }
        // Templates import by drag, from anywhere (Explorer, a GitHub
        // download, Discord) — the whole ecosystem loop in one gesture.
        const theme = files.find((f) => f.name.toLowerCase().endsWith(".avtheme"));
        if (theme) {
          void theme.text().then((t) => store().importThemeText(t));
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
          aria-label={
            playback.trackName ? `${preset.name} audio visualization` : "Audio visualization"
          }
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
            aria-label="Batch render"
            aria-pressed={showBatch}
            disabled={showBatch && batchStatus === "running"}
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
            disabled={!!exporting || batchStatus === "running"}
            onClick={() => void store().toggleLiveInput()}
          >
            <IconBroadcast size={18} />
          </button>
          <button
            className={`icon-btn ${stageMode ? "active" : ""}`}
            title="Stage mode — chrome-free output for performance/capture (\\)"
            aria-label="Stage mode"
            aria-pressed={stageMode}
            onClick={() => store().setStageMode(!stageMode)}
          >
            <IconStage size={18} />
          </button>
          <button
            className={`icon-btn ${showPanel ? "active" : ""}`}
            title="Visual settings (G)"
            aria-label="Visual settings"
            aria-pressed={showPanel}
            onClick={() => store().setShowPanel((v) => !v)}
          >
            <IconSettings size={18} />
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

      <PresetStrip
        presets={allPresets}
        activeId={presetId}
        pendingId={pendingPresetId}
        thumbs={presetThumbs}
        onSwitch={switchPreset}
        onNewVisual={openShaderEditor}
      />

      {showLibrary && (
        <LibraryPanel
          library={library}
          scanning={libraryScanning}
          activePath={libraryActivePath}
          autoAdvance={libraryAutoAdvance}
          desktop={isTauri()}
          onPickFolder={libraryPickFolder}
          onPlay={libraryPlay}
          onAutoAdvance={setLibraryAutoAdvance}
          onClose={closeLibrary}
        />
      )}

      {showPanel && (
        <ParamsPanel
          preset={preset}
          params={params}
          onParam={setParam}
          onApplyStyle={applyStyleCb}
          onReset={resetParams}
          bg={bg}
          onBg={setBg}
          onPickBackgroundImage={pickBackgroundImage}
          onUseAlbumArtBackground={applyAlbumArtBackground}
          onPickVideoBackground={pickVideoBackground}
          videoBgLoading={videoBgLoading}
          showVideoBg={isTauri()}
          sync={sync}
          onSync={setSync}
          rendererKind={rendererKind}
          onClose={closeParams}
          aspect={aspect}
          onAspect={setAspect}
          lufs={lufs}
          bpm={beatGrid ? beatGrid.bpm : null}
          keyName={trackKey ? trackKey.name : null}
          userPresets={userPresets.filter((p) => p.presetId === presetId)}
          onApplyTheme={applyTheme}
          onExportTheme={exportTheme}
          onSaveUserPreset={saveUserPreset}
          onApplyUserPreset={applyUserPreset}
          onDeleteUserPreset={deleteUserPreset}
          onExportUserPreset={exportUserPreset}
          onImportUserPreset={importUserPreset}
          overlayLayers={overlayLayers}
          assets={assets}
          hasCoverArt={!!coverArt}
          onAddTextLayer={addTextLayer}
          onAddImageLayer={addImageLayer}
          onAddAlbumArtLayer={addAlbumArtLayer}
          onUpdateLayer={updateLayer}
          onRemoveLayer={removeLayer}
          smoothSpectrum={smoothSpectrum}
          onSmoothSpectrum={setSmoothSpectrum}
          post={post}
          onPost={setPost}
          motion={motion}
          onMotion={setMotion}
          switchQuantize={switchQuantize}
          onSwitchQuantize={setSwitchQuantize}
          midiSupported={MIDI_SUPPORTED}
          midiEnabled={midiEnabled}
          midiDevices={midiDevices}
          midiBindings={midiBindings}
          midiLearn={midiLearn}
          onEnableMidi={enableMidi}
          onDisableMidi={disableMidi}
          onMidiLearn={setMidiLearn}
          onRemoveMidiBinding={removeMidiBinding}
          mods={activeMods}
          stems={stems}
          stemAnalyzing={stemAnalyzing}
          onAddStem={addStem}
          onRemoveStem={removeStem}
          onAutoRouteStem={autoRouteStem}
          onAddMod={addMod}
          onUpdateMod={updateMod}
          onRemoveMod={removeMod}
          lyricFileName={lyricFileName}
          lyricStyle={lyricStyle}
          onImportLyrics={importLyrics}
          onClearLyrics={clearLyrics}
          onLyricStyle={setLyricStyle}
          audiogram={audiogram}
          onAudiogram={setAudiogram}
        />
      )}

      {showTimeline && (
        <TimelinePanel
          timeline={timeline}
          onAutoArrange={autoArrangeTimeline}
          duration={playback.duration}
          time={playback.time}
          beatGrid={beatGrid}
          sections={sections}
          waveform={waveformOverview}
          activePreset={preset}
          presets={allPresets}
          activeParams={params}
          onChange={setTimelineData}
          onSeek={timelineSeek}
          onClose={closeTimeline}
        />
      )}

      <PlayerBar
        playback={playback}
        sections={sections}
        volume={volume}
        muted={muted}
        onTogglePlay={togglePlay}
        onSeekStart={seekStart}
        onSeekEnd={seekEnd}
        onToggleLoop={toggleLoop}
        onVolume={setVolume}
        onToggleMute={toggleMute}
      />

      {/* role=alert so a screen reader is actually told; dismissible so a
          sticky message (notably the degraded-but-working "WebGPU
          unavailable") isn't a dead end that sits over Stage mode all
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
      {recoveredDoc && (
        <div className="toast recovery-toast" role="alert">
          <span className="toast-text">
            Beatform closed unexpectedly last time. Restore your unsaved work?
          </span>
          <button className="btn-mini" onClick={() => store().restoreAutosave()}>
            Restore
          </button>
          <button className="btn-mini ghost" onClick={() => store().dismissAutosave()}>
            Discard
          </button>
        </div>
      )}

      {showShaderEditor && (
        <ShaderEditor
          customDefs={customDefs}
          onSave={saveCustomPreset}
          onDelete={deleteCustomPreset}
          onExport={exportCustomPreset}
          onImportFile={importCustomPresetFile}
          onClose={closeShaderEditor}
        />
      )}

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
          onAddTracks={addBatchTracks}
          onRemoveTrack={removeBatchTrack}
          onRetitle={retitleBatchTrack}
          onStart={startBatch}
          onSkipJob={skipBatchJob}
          onCancel={cancelBatch}
          onRetryFailed={retryFailedBatch}
          onNewBatch={newBatch}
          onClose={closeBatch}
        />
      )}

      {showExport && (
        <div className="modal-backdrop" onClick={() => !exporting && store().setShowExport(false)}>
          <div
            ref={exportDialogRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Export video"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <span className="panel-heading">Export video</span>
              <button
                className="icon-btn subtle"
                disabled={!!exporting}
                aria-label="Close"
                title={exporting ? "Export in progress…" : "Close"}
                onClick={() => store().setShowExport(false)}
              >
                <IconClose size={16} />
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
                  title="One video file with audio: H.264/HEVC/AV1 (.mp4) or VP9 with alpha (.webm)"
                  onClick={() => store().setExportSettings({ format: "mp4" })}
                >
                  MP4
                </button>
                <button
                  className={`segment ${exportSettings.format === "png" ? "active" : ""}`}
                  disabled={!!exporting || canvasMode}
                  title={
                    canvasMode
                      ? "Not available for Canvas loops (they upload as MP4)"
                      : "A folder of numbered PNG frames — keeps transparency (set Background to Transparent). No audio; for editors."
                  }
                  onClick={() => store().setExportSettings({ format: "png" })}
                >
                  PNG frames
                </button>
                {isTauri() && (
                  <button
                    className={`segment ${exportSettings.format === "prores" ? "active" : ""}`}
                    disabled={!!exporting || canvasMode}
                    title={
                      canvasMode
                        ? "Not available for Canvas loops (they upload as MP4)"
                        : "One .mov file: ProRes 4444 with alpha + PCM audio — drops straight into Premiere/Resolve/After Effects"
                    }
                    onClick={() => store().setExportSettings({ format: "prores" })}
                  >
                    ProRes
                  </button>
                )}
                {isTauri() && (
                  <button
                    className={`segment ${exportSettings.format === "gif" ? "active" : ""}`}
                    disabled={!!exporting}
                    title="Animated .gif loop — no audio; pairs with Canvas loop mode for a seamless loop"
                    onClick={() => store().setExportSettings({ format: "gif" })}
                  >
                    GIF
                  </button>
                )}
                {isTauri() && (
                  <button
                    className={`segment ${exportSettings.format === "webp" ? "active" : ""}`}
                    disabled={!!exporting}
                    title="Animated .webp loop — much smaller than GIF, keeps alpha; no audio"
                    onClick={() => store().setExportSettings({ format: "webp" })}
                  >
                    WebP
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

            {(exportSettings.format === "gif" || exportSettings.format === "webp") && (
              <p className="section-hint">
                Animated {exportSettings.format === "gif" ? "GIF" : "WebP"} — no audio. Best with{" "}
                <strong>Canvas loop</strong> mode (seamless loop) and a modest resolution;
                full-track animations get very large.
                {exportSettings.format === "webp" &&
                  " WebP keeps alpha — set Background to Transparent for a transparent loop."}
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
                  title="Encode format. Pixels are identical — this only changes file size and player compatibility. VP9 + alpha writes a transparent .webm (set Background to Transparent)."
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

            {!canvasMode && exportSettings.format === "mp4" && exportSettings.codec === "vp9a" && (
              <p className="section-hint">
                VP9 + alpha writes a transparent <strong>.webm</strong> — for OBS overlays, web
                embeds, and players that honor WebM transparency. Set Background to{" "}
                <strong>Transparent</strong>; an opaque background just encodes a solid alpha.
              </p>
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
                  <span className="inline">
                    <Switch
                      checked={exportSettings.autoRate}
                      disabled={!!exporting}
                      onChange={(autoRate) => store().setExportSettings({ autoRate })}
                      label="Automatic bitrate"
                    />
                    Auto
                  </span>
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
              {bg.mode === BG_TRANSPARENT &&
                exportSettings.format === "mp4" &&
                exportSettings.codec !== "vp9a" &&
                " Transparent background becomes black in MP4 — PNG frames, ProRes, WebP and VP9+alpha keep it."}
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
