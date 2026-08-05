import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { demos } from "./audio/demoTrack";
import { BG_TRANSPARENT } from "./render/types";
import { presetById } from "./render/presets";
import { orderedPresets } from "./state/presetOrder";
import { APP_VERSION } from "./version";
import { BatchPanel, type BatchPanelProps } from "./ui/BatchPanel";
import { RESOLUTIONS, useVizStore } from "./state/store";
import { installDevHooks } from "./devHooks";
import { getPrefs, setPrefs, subscribePrefs } from "./state/prefs";
import { PlayerBar, type PlayerBarProps } from "./ui/PlayerBar";
import { LibraryPanel, type LibraryPanelProps } from "./ui/LibraryPanel";
import { askConfirm, isTauri } from "./state/platform";
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  relaunchApp,
  type UpdatePhase,
} from "./state/updater";
import { midiSupported } from "./state/midiInput";
import { TimelinePanel, type TimelinePanelProps } from "./ui/TimelinePanel";
import { PresetStrip } from "./ui/PresetStrip";
import { ShaderEditor, type ShaderEditorProps } from "./ui/ShaderEditor";
import { ShadertoyImport, type ShadertoyImportProps } from "./ui/ShadertoyImport";
import { ParamsPanel, type ParamsPanelProps } from "./ui/ParamsPanel";
import { EmptyState } from "./ui/EmptyState";
import { useFocusTrap } from "./ui/useFocusTrap";
import { useAppShortcuts, toggleFullscreen } from "./ui/useAppShortcuts";
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

const MIDI_SUPPORTED = midiSupported();

const SHORTCUTS: Array<[string, string]> = [
  ["Space", "Play / pause"],
  ["← / →", "Seek 5 s"],
  ["↑ / ↓", "Volume"],
  ["M", "Mute"],
  ["L", "Loop whole track / selected A-B region"],
  ["I / O", "Set A / B loop markers at playhead"],
  ["P / N", "Previous / next preset (also [ / ])"],
  ["1 – 9", "Jump to mode (beat-quantized when Live › Quantize is on)"],
  ["S", "Stage mode (chrome-free output) · 0 blackout · Esc exits (also \\ and .)"],
  ["G", "Settings panel"],
  ["F", "Fullscreen"],
  ["Ctrl+S", "Save project"],
  ["Ctrl+O", "Open project"],
  ["Ctrl+Z / Ctrl+Y", "Undo / redo"],
  ["T", "Timeline panel"],
  ["B", "Batch render"],
  ["Q", "Music library"],
  ["Ctrl+,", "App settings"],
  ["H or ?", "This shortcut list"],
];

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
  const bg = useVizStore((s) => s.bgByPreset[s.presetId] ?? s.bg);
  const bgPerMode = useVizStore((s) => !!s.bgByPreset[s.presetId]);
  const centerImageName = useVizStore((s) => {
    const id = s.centerImageByPreset[s.presetId];
    return id ? (s.assets[id]?.name ?? "Custom image") : null;
  });
  const sync = useVizStore((s) => s.sync);
  const analysisSampleRate = useVizStore((s) => s.analysisSampleRate);
  const playback = useVizStore((s) => s.playback);
  const volume = useVizStore((s) => s.volume);
  const muted = useVizStore((s) => s.muted);
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
  const batch = useVizStore((s) => s.batch);
  const batchStatus = useVizStore((s) => s.batchStatus);
  const batchScanning = useVizStore((s) => s.batchScanning);
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
  const builderStack = useVizStore((s) => s.builderStack);
  const videoBgLoading = useVizStore((s) => s.videoBgLoading);
  const showBatch = useVizStore((s) => s.showBatch);
  const customDefs = useVizStore((s) => s.customDefs);
  const showShaderEditor = useVizStore((s) => s.showShaderEditor);
  const showShadertoyImport = useVizStore((s) => s.showShadertoyImport);
  const shadertoyImportEditId = useVizStore((s) => s.shadertoyImportEditId);
  const presetOrder = useVizStore((s) => s.presetOrder);
  const allPresets = useMemo(
    () => orderedPresets(presetOrder, customDefs),
    [presetOrder, customDefs],
  );

  const store = useVizStore.getState; // stable accessor for actions/handlers

  // App prefs, read reactively: prefs are module state (not the store), and
  // the render loop reads them fresh via getPrefs() — but the perf overlay
  // mount/config must RE-RENDER on change, so App subscribes through the
  // prefs emitter. setPrefs replaces the whole object, so getPrefs is a
  // valid useSyncExternalStore snapshot.
  const appPrefs = useSyncExternalStore(subscribePrefs, getPrefs);

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

  // Resizable settings/library panel width (v2.40 layout system). The value
  // drives the `--panel-w` CSS variable on the app root; every offset that
  // depends on it derives via calc() in App.css. Persisted per install.
  const [panelW, setPanelW] = useState(() => getPrefs().panelWidth);
  const startPanelResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let latest = 0;
    const onMove = (ev: PointerEvent) => {
      // Panel hugs the right edge: width = distance from pointer to gutter.
      latest = Math.min(440, Math.max(240, window.innerWidth - ev.clientX - 14));
      setPanelW(latest);
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      if (latest > 0) setPrefs({ panelWidth: latest });
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    // pointercancel (audit U7): a cancelled gesture (window drag-out, pen
    // palm rejection) used to leak both listeners and skip the persist.
    el.addEventListener("pointercancel", onUp);
  }, []);

  // Auto-updater (desktop): silent check shortly after boot; manual check +
  // install live in the Help modal. Local state on purpose — this is UI
  // phase, not document/session state (it moves to the Settings page later).
  const [update, setUpdate] = useState<UpdatePhase>({ state: "idle" });
  // Startup-found updates open a one-per-boot prompt; manual checks report
  // inside the Settings dialog instead, so the two flows never fight.
  const [updatePromptOpen, setUpdatePromptOpen] = useState(false);
  const runUpdateCheck = useCallback(async (manual: boolean) => {
    setUpdate({ state: "checking" });
    try {
      const found = await checkForUpdate();
      setUpdate(found ? { state: "available", ...found } : { state: "none" });
      if (found && !manual) setUpdatePromptOpen(true);
    } catch (e) {
      // Offline at boot is normal — only a MANUAL check reports the failure.
      setUpdate(manual ? { state: "error", message: (e as Error).message } : { state: "idle" });
    }
  }, []);
  const installUpdate = useCallback(async () => {
    const version = update.state === "available" ? update.version : "";
    setUpdate({ state: "downloading", received: 0, total: null });
    try {
      await downloadAndInstallUpdate((received, total) =>
        setUpdate({ state: "downloading", received, total }),
      );
      setUpdate({ state: "ready", version });
    } catch (e) {
      setUpdate({ state: "error", message: (e as Error).message });
    }
  }, [update]);
  useEffect(() => {
    if (!isTauri() || !getPrefs().updateAutoCheck) return;
    const t = setTimeout(() => void runUpdateCheck(false), 5000);
    return () => clearTimeout(t);
  }, [runUpdateCheck]);

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
  const clearLyrics: ParamsPanelProps["onClearLyrics"] = useCallback(async () => {
    // Destructive clear-all: with the correction editor, loaded lyrics can
    // carry real editing work — never drop them on a stray click. UI-level
    // confirm so the programmatic action (E2E, generate-replace flow, which
    // asks its own question) stays prompt-free.
    const s = store();
    const n = s.lyrics?.length ?? 0;
    if (n > 0) {
      const ok = await askConfirm(
        `Remove the loaded lyrics (${n} line${n === 1 ? "" : "s"})? Unsaved edits are lost.`,
        "Remove lyrics",
      );
      if (!ok) return;
    }
    s.clearLyrics();
  }, [store]);
  const setLyricStyle: ParamsPanelProps["onLyricStyle"] = useCallback(
    (patch) => store().setLyricStyle(patch),
    [store],
  );
  const setAudiogram: ParamsPanelProps["onAudiogram"] = useCallback(
    (patch) => store().setAudiogram(patch),
    [store],
  );
  const setBuilderStack: ParamsPanelProps["onBuilderStack"] = useCallback(
    (stack) => store().setBuilderStack(stack),
    [store],
  );
  const exportBuilderStack: ParamsPanelProps["onBuilderExport"] = useCallback(
    () => void store().exportBuilderStack(),
    [store],
  );
  const importBuilderStack: ParamsPanelProps["onBuilderImport"] = useCallback(
    (f) => void f.text().then((t) => store().importBuilderStackText(t)),
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
  const setLoopStart: PlayerBarProps["onSetLoopStart"] = useCallback(
    (t) => store().setLoopStart(t),
    [store],
  );
  const setLoopEnd: PlayerBarProps["onSetLoopEnd"] = useCallback(
    (t) => store().setLoopEnd(t),
    [store],
  );
  const clearLoopRegion: PlayerBarProps["onClearLoopRegion"] = useCallback(
    () => store().clearLoopRegion(),
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
  const openShadertoyImport: ShaderEditorProps["onOpenShadertoy"] = useCallback(
    (id) => store().openShadertoyImport(id ?? undefined),
    [store],
  );
  const importShadertoy: ShadertoyImportProps["onImport"] = useCallback(
    (glsl, meta) => store().importShadertoyGlsl(glsl, meta, store().shadertoyImportEditId),
    [store],
  );
  const closeShadertoyImport: ShadertoyImportProps["onClose"] = useCallback(
    () => store().closeShadertoyImport(),
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
  // exercised and visually verified in the browser harness.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__setUpdatePhase = (
      phase: UpdatePhase,
      open = true,
    ) => {
      setUpdate(phase);
      setUpdatePromptOpen(open);
    };
  }, []);

  // One sentence for every Export/Batch entry point in the shell, so the
  // top-bar tooltips, the dialog and the store guard all give the same reason
  // (F2). Null on the normal path — nothing below changes there.
  const exportBlocked = simplifiedRenderer
    ? "Video export needs hardware rendering (WebGPU), which isn't available on this system"
    : null;

  // Idle-hide only when nothing interactive is open (audit U6): the params
  // panel, library, guide and settings are .chrome too, so holding the
  // pointer still while READING one used to fade it out under the cursor.
  const idle =
    chromeIdle &&
    playback.playing &&
    !showExport &&
    !showHelp &&
    !showGuide &&
    !showSettings &&
    !showPanel &&
    !showLibrary;

  return (
    <div
      className={`app ${dragOver ? "drag-over" : ""} ${idle ? "idle" : ""} ${stageMode ? "stage-mode" : ""}`}
      style={{ "--panel-w": `${panelW}px` } as React.CSSProperties}
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
        // Shaders and templates import by drag, from anywhere.
        const shader = files.find((f) => f.name.toLowerCase().endsWith(".bfshader"));
        if (shader) {
          void shader.text().then((t) => store().importCustomPresetText(t));
          return;
        }
        // Templates import by drag, from anywhere (Explorer, a GitHub
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
            disabled={!playback.trackName || batchStatus === "running" || !!exportBlocked}
            title={
              exportBlocked ??
              (batchStatus === "running"
                ? "Batch render in progress"
                : playback.trackName
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
            disabled={!!exporting || batchStatus === "running"}
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
            className={`icon-btn ${showSettings ? "active" : ""}`}
            title="App settings — autosave, performance, updates (Ctrl+,)"
            aria-label="App settings"
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

      <PresetStrip
        presets={allPresets}
        activeId={presetId}
        pendingId={pendingPresetId}
        thumbs={presetThumbs}
        onSwitch={switchPreset}
        onNewVisual={openShaderEditor}
        newVisualDisabledReason={
          simplifiedRenderer
            ? "The shader editor needs hardware rendering (WebGPU), which isn't available on this system"
            : undefined
        }
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
        <div
          className="panel-resize-handle chrome"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the settings panel"
          title="Drag to resize the panel"
          onPointerDown={startPanelResize}
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
          bgPerMode={bgPerMode}
          onBgPerMode={(v) => store().setBgPerMode(v)}
          centerImageName={centerImageName}
          onPickCenterImage={() => void store().pickCenterImage()}
          onClearCenterImage={() => store().clearCenterImage()}
          onPickBackgroundImage={pickBackgroundImage}
          onUseAlbumArtBackground={applyAlbumArtBackground}
          onPickVideoBackground={pickVideoBackground}
          videoBgLoading={videoBgLoading}
          showVideoBg={isTauri()}
          sync={sync}
          analysisSampleRate={analysisSampleRate}
          onSync={setSync}
          rendererKind={rendererKind}
          simplifiedRenderer={simplifiedRenderer}
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
          builderStack={builderStack}
          onBuilderStack={setBuilderStack}
          onBuilderExport={exportBuilderStack}
          onBuilderImport={importBuilderStack}
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
          simplifiedRenderer={simplifiedRenderer}
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
        onSetLoopStart={setLoopStart}
        onSetLoopEnd={setLoopEnd}
        onClearLoopRegion={clearLoopRegion}
        onVolume={setVolume}
        onToggleMute={toggleMute}
      />

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
                Builder Studio, the shader editor, scene transitions and video backgrounds are
                switched off. Video export and batch render are disabled — your project is unharmed
                and renders in full on a system with hardware rendering.
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
      </div>

      {showShaderEditor && (
        <ShaderEditor
          customDefs={customDefs}
          onSave={saveCustomPreset}
          onDelete={deleteCustomPreset}
          onExport={exportCustomPreset}
          onImportFile={importCustomPresetFile}
          onOpenShadertoy={openShadertoyImport}
          onClose={closeShaderEditor}
        />
      )}

      {showShadertoyImport && (
        <ShadertoyImport
          editDef={customDefs.find((d) => d.id === shadertoyImportEditId) ?? null}
          onImport={importShadertoy}
          onClose={closeShadertoyImport}
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
                title="App settings — autosave, performance, updates (Ctrl+,)"
                onClick={() => {
                  store().setShowHelp(false);
                  store().setShowSettings(true);
                }}
              >
                App settings…
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
          onDismiss={() => setUpdatePromptOpen(false)}
        />
      )}

      {showBatch && (
        <BatchPanel
          run={batch}
          status={batchStatus}
          scanning={batchScanning}
          overlayLayers={overlayLayers}
          aspect={aspect}
          formatLabel={RESOLUTIONS[exportSettings.resIdx].label}
          simplifiedRenderer={simplifiedRenderer}
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

      {showGuide && <GuideDialog onClose={() => store().setShowGuide(false)} />}
      {showExport && <ExportDialog />}
      {showSettings && (
        <SettingsDialog
          update={update}
          onCheckUpdate={() => void runUpdateCheck(true)}
          onInstallUpdate={() => void installUpdate()}
          onRelaunch={() => void relaunchApp()}
        />
      )}
    </div>
  );
}
