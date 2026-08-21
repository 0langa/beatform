import { create } from "zustand";
import type { PlaybackState, SyncSettings } from "../audio/types";
import { DEFAULT_SYNC, sanitizeSync } from "../audio/types";
import { readTrackMeta } from "../audio/trackMeta";
import { type BatchRun } from "./batch";
import { type CodecSupport } from "../export/codecProbe";
import { demos } from "../audio/demoTrack";
import {
  BG_IMAGE,
  BG_VIDEO,
  type BgSettings,
  type ParamValues,
  type PresetDef,
} from "../render/types";
import {
  decodeVideoBgFrames,
  disposeVideoBgFrames,
  videoBgFrameIndex,
  type VideoBgFrames,
} from "../render/videoBg";
import { bakeBackgroundBitmap } from "../render/bgImage";
import { renderPresetThumbnails } from "../render/thumbnails";
import { mergeEmbeddedDefs, registerCustomPreset } from "../render/presets/custom";
import { WebGPURenderer } from "../render/webgpuRenderer";
import { stemValuesAt, type StemEntry, type StemSlot } from "../audio/stems";
import { defaultParams } from "../render/types";
import { presetById, presets } from "../render/presets";
import { extractCoverPalette, type CoverPalette } from "./coverPalette";
import { APP_VERSION } from "../version";
import {
  getAnalyzer,
  getEngine,
  getRenderer,
  initServices,
  peekAnalyzer,
  remeasure,
} from "./services";
import { vocalSpansFromLyrics } from "../audio/vocalPresence";
import { analyzeTrack } from "../audio/analysis/trackAnalysis";
import type { BeatGrid } from "../audio/analysis/beatGrid";
import type { KeyEstimate } from "../audio/analysis/keyDetect";
import { type ModRoute, type ModSource } from "./modMatrix";
import { historyDepths, pushHistory } from "./history";
import { deriveTimelineEnabled, type Timeline } from "./timeline";
import { type LyricLine, type LyricStyle } from "./lyrics";
import { IDLE_LYRICS_GEN, type LyricsGenState, type LyricsTier } from "./lyricsGen";
import { autoArrangeScenes, overviewEnergy } from "./autoArrange";
import {
  composeOverlayFrame,
  hasDynamics,
  overlayFrameKeyAt,
  sameOverlayFrame,
  type OverlayDynamics,
} from "../render/dynamicOverlay";
import {
  composeLyricPlate,
  lyricPlateKeyAt,
  NULL_PLATE_KEY,
  samePlateKey,
  type LyricPlateKey,
} from "../render/lyricPlate";
import { audiogramActive, type AudiogramSettings } from "./audiogram";
import type { MotionSettings, PostSettings } from "../render/types";
import {
  askConfirm,
  isTauri,
  openImageFile,
  openVideoFile,
  openTextFile,
  readBinaryFromPath,
  saveTextFile,
  startLoopback,
  stopLoopback,
  writeAutosave,
  type LibraryTrack,
} from "./platform";
import {
  pruneBitmapCache,
  rasterizeOverlay,
  type ImageLayer,
  type OverlayAsset,
  type OverlayLayer,
  type OverlayMeta,
  type TextLayer,
} from "../render/overlay";
import {
  serializeProject,
  validMotion,
  validPost,
  type Aspect,
  type ProjectDocument,
} from "./project";
import { type ThemeMeta } from "./themes";
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
  loadStoredPost,
  loadStoredMotion,
  loadStoredTimeline,
  loadStoredBuilderStack,
  saveStoredBuilderStack,
  saveStoredMods,
  saveStoredPost,
  saveStoredMotion,
  saveStoredTimeline,
  loadStoredOverlay,
  loadStoredPanelOpen,
  loadStoredParams,
  loadCustomPresets,
  saveCustomPresets,
  loadStoredPresetId,
  loadStoredSync,
  loadStoredVolume,
  saveStoredAspect,
  saveStoredBg,
  loadStoredBgByPreset,
  saveStoredBgByPreset,
  loadStoredCenterImages,
  saveStoredCenterImages,
  saveStoredOverlay,
  saveStoredPanelOpen,
  saveStoredParams,
  saveStoredPresetId,
  saveStoredSync,
  saveStoredVolume,
  loadStoredLyricStyle,
  saveStoredLyricStyle,
  loadStoredAudiogram,
  saveStoredAudiogram,
  loadStoredQuantize,
  saveStoredQuantize,
  loadStoredMidiBindings,
  loadStoredExportSettings,
  loadStoredSmoothSpectrum,
  saveStoredSmoothSpectrum,
  markSessionDirty,
  setAutosaveFlushOnPagehide,
  setWriteFailureNotifier,
} from "./persistence";
import { getPrefs, setPrefs } from "./prefs";
import { selectBgPerMode, selectEffectiveBg } from "./selectors";
import { defaultPresetOrder, orderedPresets, reconcilePresetOrder } from "./presetOrder";
import { decodeAudioLenient } from "../audio/decodeLenient";
import {
  applyVirtualValues,
  BUILDER2_ID,
  builderStackValues,
  defaultBuilderStack,
  isBuilderVirtualKey,
  packBuilderParams,
  rebuildBuilder2,
  type BuilderStack,
} from "../render/builder2";
import { crossedBoundary, hasFutureBoundary, type QuantizeMode } from "./quantize";
import { type MidiBinding, type MidiLearn } from "./midi";
import type { SliceCtx } from "./slices/ctx";
import { NULL_FRAME_KEY, shared } from "./slices/shared";
import {
  buildPerformAssets,
  buildPerformLive,
  buildPerformScene,
  performActions,
  performAssetsSig,
  performLiveSig,
  performSceneSig,
  sameSig,
  type PerformMonitorInfo,
} from "./slices/performActions";
import {
  initPerformPublisher,
  notePerformWindowClosed,
  performMirrorActive,
  publishPerformAssets,
  publishPerformLive,
  publishPerformScene,
  publishPerformState,
} from "./performBridge";
import { batchActions } from "./slices/batchActions";
import { builderActions } from "./slices/builderActions";
import { customShaderActions } from "./slices/customShaderActions";
import { exportActions } from "./slices/exportActions";
import { libraryActions } from "./slices/libraryActions";
import { lyricsAudiogramActions } from "./slices/lyricsAudiogramActions";
import { lyricsEditActions } from "./slices/lyricsEditActions";
import { lyricsGenActions } from "./slices/lyricsGenActions";
import { midiActions } from "./slices/midiActions";
import { overlayActions } from "./slices/overlayActions";
import { galleryActions } from "./slices/galleryActions";
import type { GalleryEntry, GalleryEntryType } from "./gallery";
import { projectIOActions } from "./slices/projectIOActions";
import { stemsModsActions } from "./slices/stemsModsActions";

// Export config (resolutions, bitrate, ExportSettings) lives in a leaf module
// so slice factories can import it without a value cycle through this store.
// Re-exported here so "./store" keeps its frozen public surface.
import { reconciledResIdx, type ExportProgress, type ExportSettings } from "./exportConfig";
export {
  RESOLUTIONS,
  resolutionsForAspect,
  reconciledResIdx,
  autoBitrateMbps,
  LOUDNESS_PRESETS,
  SIMPLIFIED_EXPORT_REASON,
} from "./exportConfig";
export type { ExportProgress, ExportSettings } from "./exportConfig";
export type { PerformMonitorInfo } from "./slices/performActions";

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
  /** Per-mode background overrides — an entry wins over `bg` for that mode. */
  bgByPreset: Record<string, BgSettings>;
  /** Per-mode center-image overrides (asset id) for cover-drawing modes. */
  centerImageByPreset: Record<string, string>;
  overlayLayers: OverlayLayer[];
  assets: Record<string, OverlayAsset>;
  aspect: Aspect;
  modsByPreset: Record<string, ModRoute[]>;
  /** Spline-connected spectrum sampling (no hard bin corners), all visuals. */
  smoothSpectrum: boolean;
  timeline: Timeline;
  /** Builder layer stack (renders when presetId === "builder2"). */
  builderStack: BuilderStack;
  post: PostSettings;
  motion: MotionSettings;
}

/** Session/UI state: ephemeral, never saved into projects. */
interface SessionSlice {
  /** Resolved params of the active preset (defaults + overrides). The frame
   * loop reads this via getState() every frame — keep it precomputed. */
  activeParams: ParamValues;
  /** Routes of the active preset — same precompute reasoning. */
  activeMods: ModRoute[];
  sync: SyncSettings;
  /** Current output-device analysis rate; session-only, for honest UI math. */
  analysisSampleRate: number;
  playback: PlaybackState;
  volume: number;
  muted: boolean;
  seeking: boolean;
  rendererKind: string;
  /**
   * True while the Canvas2D fallback is driving the canvas (audit F1).
   *
   * The fallback draws ONE look — spectrum bars — and its setPreset/setMotion/
   * setBuilderParams/setTransitionPreset/setPost are empty stubs, so every
   * mode chip, the Motion masters, Builder, the shader editor, scene
   * transitions, post-processing and video backgrounds are accepted and
   * discarded. Derived once here on every renderer swap and threaded to the
   * panels as a single flag, so "can this backend honour that control?" has
   * one answer instead of a `rendererKind === "canvas2d"` string test copied
   * into every surface that needs to ask.
   */
  simplifiedRenderer: boolean;
  /** What the renderer swap wants the user to know, in their language — the
   * fallback explanation, or the "restart to recover" after a failed GPU
   * reset. Persistent (it feeds the banner), not a 4-second toast: the
   * condition it describes lasts the whole session. */
  rendererWarning: string | null;
  /** The user closed the simplified-renderer banner. Session-only, and reset
   * whenever a hardware renderer comes back, so a LATER fallback is announced
   * again rather than inheriting an old dismissal. */
  simplifiedNoticeDismissed: boolean;
  chromeIdle: boolean;
  /** Stage mode: chrome-free full-bleed output for live performance / capture /
   * projecting. Drive visuals via keys/MIDI; Esc exits. */
  stageMode: boolean;
  /** Instant black-out over the visual (VJ cut), only meaningful in stage mode. */
  blackout: boolean;
  dragOver: boolean;
  showPanel: boolean;
  showHelp: boolean;
  /** In-app user guide dialog (v2.46). */
  showGuide: boolean;
  /** App-settings dialog (Ctrl+,). */
  showSettings: boolean;
  showExport: boolean;
  error: string | null;
  /** Transient positive feedback (project saved, preset imported, …). */
  notice: string | null;
  /**
   * Owner ruling D (final round): the desktop boot recovery message
   * ("Recovered your work from the last session") is its own PERSISTENT
   * flag, not the transient `notice` — it must linger until the user
   * dismisses it, not auto-fade on flashNotice's 4s timer, matching the
   * same transient-vs-persistent split this app already draws for
   * `error`/`simplifiedRenderer` (the corrupt-quarantine toast, C2(c), is
   * the precedent this reuses: a session-only boolean, an explicit dismiss
   * action, no timer). Set TRUE only by `bootDesktopDocument`
   * (projectIOActions.ts) on the recovering branch. Set back to FALSE by
   * `dismissRecoveredNotice` (the user's own click) and, since the final
   * review round, unconditionally by every `applyDocument` call (see that
   * action's own comment) — it describes the document that was just
   * replaced, by definition, so a fresh document of any kind (new, open,
   * undo, redo, theme) invalidates it same as an explicit dismiss would.
   */
  recoveredNotice: boolean;
  /**
   * D1 fix (E2-D1), part (b) — QUARANTINE-ASIDE ON REFUSAL. Set by
   * `bootDesktopDocument` (projectIOActions.ts) when its anti-clobber guard
   * refuses to apply a document that parsed fine — not the corrupt-file
   * case, which uses `error` — because the in-memory document already
   * moved on. Holds the human-readable message (naming the quarantined
   * filename the user can go find in AppData), not a boolean: unlike
   * `recoveredNotice`'s fixed sentence, this describes a specific file the
   * UI cannot hardcode. `null` when there is nothing to show.
   *
   * Deliberately NOT auto-cleared by `applyDocument` the way `recoveredNotice`
   * is — that field describes the document just replaced, by definition
   * stale the instant a fresh one lands; this one describes an ARCHIVAL
   * EVENT (a file was set aside at a specific path) that stays exactly as
   * true no matter how many further edits the session makes. Same
   * persistent/dismissible shape as `recoveredNotice` otherwise (owner
   * ruling D): no timer, cleared only by `dismissSupersededNotice`.
   */
  supersededNotice: string | null;
  /**
   * Owner ruling E (final round): true ONLY on desktop, ONLY for the first
   * paint — hides the measured ~423ms window (I2, device smoke) between the
   * synchronous localStorage-sourced fallback rendering and the autosave
   * swap landing. Computed once, synchronously, from `isTauri()` at store
   * creation (the SAME module-scope timing every other document-boot field
   * already uses) so it is correct from the very first render — nothing
   * async decides its STARTING value, only App.tsx's boot effect decides
   * when to drop it (`hideBootVeil`), via whichever comes first: the boot
   * promise settling or a hard-capped setTimeout independent of it. Always
   * `false` in the browser build, and never set back to `true` once
   * cleared — this is a one-time boot affordance, not a toggle.
   */
  bootVeilVisible: boolean;
  userPresets: UserPreset[];
  /** Gallery (public curated registry) browser state — session-only. */
  galleryStatus: "idle" | "loading" | "ready" | "error";
  galleryError: string | null;
  galleryEntries: GalleryEntry[];
  /** entry id -> verified blob: URL for the preview image. */
  galleryPreviews: Record<string, string>;
  /** entry id currently downloading/installing, else null. */
  galleryBusy: string | null;
  /** Look entry id -> the user-preset id its install created (A1). "✓ Added"
   * holds only while that preset still EXISTS in My Looks — the dialog
   * re-checks against userPresets, so deleting the look reverts the card to
   * "+ Add look" instead of trusting a stale record. Themes never enter. */
  galleryInstalled: Record<string, string>;
  /** Theme entry id that just applied — transient (~2.5 s) "Applied ✓"
   * feedback (A1). Applying a theme is legitimately repeatable, so themes get
   * no persistent installed state at all. */
  galleryApplied: string | null;
  /** Filter the Gallery dialog opens pre-armed to (A3 deep links). */
  galleryOpenFilter: "all" | GalleryEntryType;
  /** Gallery dialog visibility (top-bar surface). */
  showGallery: boolean;
  /** Track metadata for {title}/{artist} overlay templates. */
  trackMeta: OverlayMeta;
  /** Cover art extracted from the loaded file's tags (session-only). */
  coverArt: string | null;
  /** Dominant color of the current cover art (null = none/grayscale). Feeds
   * "match cover colors" toggles; session-only, never serialized. */
  coverPalette: CoverPalette | null;
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
  /**
   * Whole-lane-review fix I1: a monotonic counter bumped on every
   * `applyDocument` call (undo/redo/open/theme-apply/new-project/boot),
   * regardless of what `undoDepth` does. `undoDepth` alone cannot guard
   * `bootDesktopDocument`'s async read against a manual project open racing
   * it: `openProject`/`openProjectText` both FORCE `undoDepth` to 0 (same
   * value a fresh boot already has), so a drag-dropped .bfproj landing
   * during the read window was invisible to that check. `docEpoch` is
   * strictly increasing and touched by every document-replacing path, so
   * boot snapshotting it before the read and comparing after catches this
   * class the undoDepth guard structurally cannot.
   */
  docEpoch: number;
  exportSettings: ExportSettings;
  exporting: ExportProgress | null;
  /** Reactive mirror of shared.exportStarting (E2-U5): true from the moment
   *  runExport claims the re-entrancy slot until either `exporting` takes
   *  over (encoding has actually begun) or the call bails out early — the
   *  native save dialog, the disk pre-flight and its own confirm all run in
   *  this window, well before `exporting` itself is set. ExportDialog gates
   *  its dismissal on this OR `exporting`; nothing else should need it. */
  exportPreparing: boolean;
  exportError: string | null;
  exportDone: string | null;
  /** The machine-readable counterpart to `exportDone`: the same save path or
   * PNG-sequence folder that sentence interpolates into prose, or null when
   * there is nothing to reveal (a browser download, or no export yet). Feeds
   * "Show in folder"; cleared everywhere `exportDone` is. */
  exportDonePath: string | null;
  /** What the hardware can encode; null until the probe runs (panel open). */
  codecSupport: CodecSupport | null;
  /** Batch render: setup + in-flight run. Null until the panel is opened. */
  batch: BatchRun | null;
  batchStatus: "idle" | "running" | "done";
  /** Batch refusal messages, rendered INSIDE the batch panel (SS-3) — they
   * used to land in exportError, which only ExportDialog shows, so a blocked
   * Start looked like a dead click. */
  batchError: string | null;
  /** Files still being tag-scanned by addBatchTracks (0 = not scanning). The
   * scan takes seconds per file and the panel must not look dead meanwhile. */
  batchScanning: number;
  showBatch: boolean;
  // --- music library sidebar (desktop) ---
  showLibrary: boolean;
  /** Scanned folder + its tracks. Null until a folder is picked. */
  library: { dir: string; tracks: LibraryTrack[] } | null;
  libraryScanning: boolean;
  /** Path of the library track currently loaded (null = loaded another way). */
  libraryActivePath: string | null;
  /** Play the next library track when the current one ends. */
  libraryAutoAdvance: boolean;
  /** Beat-quantized preset takeover: a hotkey/chip switch lands on the next
   * beat/bar boundary instead of instantly. Live performance only — never
   * affects export. Persisted across sessions. */
  switchQuantize: QuantizeMode;
  /** A preset switch waiting for the next quantize boundary (null = none). */
  pendingPresetId: string | null;
  /** Web MIDI on (access granted + listening). Live performance only. */
  midiEnabled: boolean;
  /** Names of connected MIDI inputs (updates on hot-plug). */
  midiDevices: string[];
  /** CC→param / note→preset bindings (persisted). */
  midiBindings: MidiBinding[];
  /** What "MIDI learn" is armed for, if anything. */
  midiLearn: MidiLearn | null;
  /** Analysers fed by live system audio (WASAPI loopback) instead of a track. */
  liveInputActive: boolean;
  /** presetId -> PNG data URL, generated lazily after first paint. */
  presetThumbs: Record<string, string> | null;
  /**
   * Built-in preset ids in the order the strip shows them — chrome only.
   * Reconciled against the live registry at boot, so it is always exactly the
   * ids this build has. Nothing downstream of the renderer reads it: display
   * order cannot reach a frame.
   */
  presetOrder: string[];
  /** Imported stems (analysis-only, session-scoped like the track). */
  stems: StemEntry[];
  /** User-authored WGSL presets (mirrors the runtime registry). */
  customDefs: PresetDef[];
  showShaderEditor: boolean;
  /** Stem currently being analyzed (its file name), null when idle. */
  stemAnalyzing: string | null;
  /** Timed lyrics (parsed .lrc/.srt) — session-scoped like stems. */
  lyrics: LyricLine[] | null;
  /** Source file name of the loaded lyrics, for the UI. */
  lyricFileName: string | null;
  /** Local automatic lyrics (FEAT-004): model manager + generation job UI
   * state. Session-only; the finished LRC lands in `lyrics` via the same
   * loadLyricsText path as an import. */
  lyricsGen: LyricsGenState;
  /** Correction editor's local undo/redo depths (stacks live in the slice
   * module — lyrics are session state, so the document history can't carry
   * them; see lyricsEditActions). */
  lyricsEditUndoDepth: number;
  lyricsEditRedoDepth: number;
  /** A per-line re-alignment sidecar run in flight (null = none). */
  lyricsRealign: { index: number } | null;
  /** How lyric lines render (position/size/color/fade); persisted. */
  lyricStyle: LyricStyle;
  /** Audiogram overlay elements (progress bar / time / waveform); persisted. */
  audiogram: AudiogramSettings;
  /** A video background is decoding (spinner in the bg controls). */
  videoBgLoading: boolean;
  /** FEAT-009: the second-display performance window exists (Rust-owned;
   * flips on the perform:opened/closed lifecycle events). */
  performOpen: boolean;
  /** Monitor list for the drawer's picker; re-enumerated on drawer open. */
  performMonitors: PerformMonitorInfo[];
  /** P-4: the Perform drawer (operator console) is visible. */
  showPerform: boolean;
}

interface Actions {
  initApp(canvas: HTMLCanvasElement): () => void;
  switchPreset(id: string): void;
  stepPreset(delta: number): void;
  /** Switch to a preset, honoring the beat-quantize mode: instant when off /
   * paused / unanalyzed, otherwise queued until the next beat/bar boundary. */
  queuePreset(id: string): void;
  /** Rewrite the strip's display order (persisted). Reconciled on the way in,
   * so a caller can hand over a stale or partial list without breaking it. */
  setPresetOrder(ids: readonly string[]): void;
  /** Back to the shipped order, and forget the customisation. */
  resetPresetOrder(): void;
  setSwitchQuantize(mode: QuantizeMode): void;
  /** Request Web MIDI access and start listening (user-gesture initiated). */
  enableMidi(): Promise<void>;
  disableMidi(): void;
  /** Feed one raw MIDI packet through learn/apply (also the adapter's sink). */
  handleMidiMessage(data: ArrayLike<number>): void;
  setMidiLearn(learn: MidiLearn | null): void;
  removeMidiBinding(id: string): void;
  setParam(key: string, value: number): void;
  applyStyle(values: Partial<ParamValues>): void;
  resetParams(): void;
  setBg(bg: BgSettings): void;
  /** Toggle a per-mode background override for the ACTIVE mode: on copies the
   * current effective bg into the override; off deletes it (global wins). */
  setBgPerMode(on: boolean): void;
  /** Pick a custom center image for the active mode (replaces cover art). */
  pickCenterImage(): Promise<void>;
  /** Back to the track's cover art for the active mode. */
  clearCenterImage(): void;
  /** Pick an image file as the background (switches bg.mode to image). */
  pickBackgroundImage(): Promise<void>;
  /** Pick a local video for the background (desktop; decodes a capped loop). */
  pickVideoBackground(): Promise<void>;
  /** Use the loaded track's cover art as the background. */
  useAlbumArtBackground(): void;
  setAspect(aspect: Aspect): void;
  setSmoothSpectrum(v: boolean): void;
  /**
   * `historyKey` (P-5) lets callers scope gesture-grouping tighter than the
   * default `"timeline"` — e.g. per-scene, per-field keys so dragging scene
   * A then scene B doesn't collapse into one undo entry, matching how
   * `setParam` groups per `` `param:${key}` ``. Omit it for the old
   * behavior; every pre-P-5 call site and test keeps working unchanged.
   */
  setTimeline(timeline: Timeline, historyKey?: string): void;
  /** Replace the Builder stack (undoable; recompiles only on structural change). */
  setBuilderStack(stack: BuilderStack): void;
  /** Save the current Builder stack as a shareable .bfbuilder file. */
  exportBuilderStack(): Promise<void>;
  /** Parse + apply a .bfbuilder file's text (import). */
  importBuilderStackText(text: string): void;
  setShowTimeline(v: boolean): void;
  setPost(patch: Partial<PostSettings>): void;
  setMotion(patch: Partial<MotionSettings>): void;
  setSync(sync: SyncSettings): void;
  loadFile(file: File): Promise<void>;
  loadDemo(id: string): Promise<void>;
  setShowLibrary(open: boolean): void;
  /** Apply a theme's document (factory pack or parsed .bftheme). */
  applyTheme(document: ProjectDocument, name: string): void;
  /** Parse + apply a .bftheme file's text (drag-import). */
  importThemeText(contents: string): void;
  /** Save the current setup as a shareable .bftheme file. */
  exportCurrentTheme(meta: ThemeMeta): Promise<void>;
  /** Show/hide the Gallery dialog; first open loads the registry. An
   * explicit `filter` opens it pre-filtered (A3 deep links); a plain open
   * starts at All. */
  setShowGallery(v: boolean, filter?: GalleryEntryType): void;
  /** Load (or refresh) the Gallery registry + verified previews. */
  openGallery(): Promise<void>;
  /** Download, verify, parse and install/apply one Gallery entry. */
  installGalleryEntry(id: string): Promise<void>;
  toggleLiveInput(): Promise<void>;
  /** Kick off (once) the lazy thumbnail render for the preset strip. */
  loadPresetThumbnails(): void;
  /** Import a stem file (analysis-only mod source). Max 4. */
  addStem(file: File): Promise<void>;
  setShowShaderEditor(open: boolean): void;
  /** Shadertoy GLSL import dialog (FEAT-001). `editId` = re-editing an
   * existing imported visual's GLSL; null = fresh import. */
  showShadertoyImport: boolean;
  shadertoyImportEditId: string | null;
  openShadertoyImport(editId?: string): void;
  closeShadertoyImport(): void;
  /** Transpile pasted Shadertoy GLSL (Rust/naga), device-check the module,
   * register + persist + switch. [] = success, else display-ready errors.
   * `signal` (whole-lane review, CRITICAL on top of E2-U4): aborted by the
   * caller's own timeout if neither the transpile nor the compile check
   * ever settles — checked at the next resumption point so a LATE
   * resolution skips applying rather than switching the live visual out
   * from under a caller that already gave up and told the user it failed. */
  importShadertoyGlsl(
    glsl: string,
    meta: { name: string; author?: string; source?: string; license?: string },
    editId: string | null,
    signal?: AbortSignal,
  ): Promise<string[]>;
  /** Compile-check a custom preset; [] = clean, else error strings. */
  checkCustomPreset(def: PresetDef): Promise<string[]>;
  /** Compile-check, register, persist and switch to a custom preset.
   * `signal`: see importShadertoyGlsl's doc comment — same contract. */
  saveCustomPreset(def: PresetDef, signal?: AbortSignal): Promise<string[]>;
  deleteCustomPreset(id: string): void;
  exportCustomPreset(id: string): Promise<void>;
  importCustomPresetText(contents: string): Promise<void>;
  removeStem(slot: StemSlot): void;
  /** One-click: wire this stem's bands to sensible knobs of the active visual. */
  autoRouteStem(slot: StemSlot): void;
  /** Import timed lyrics (.lrc/.srt contents) — karaoke overlay. */
  loadLyricsText(fileName: string, contents: string): void;
  clearLyrics(): void;
  /** Guarded clear (E2-U3): clears only if `lyricFileName` still matches
   *  `expectedFileName`, else flashes a notice and no-ops. The UI's own
   *  confirm dialog snapshots `lyricFileName` BEFORE awaiting the user's
   *  answer and passes that snapshot here — a background generation can
   *  complete and silently replace lyrics/lyricFileName while the confirm
   *  was open, and clearing unconditionally at that point would delete
   *  content the confirm never asked about. Returns whether it cleared. */
  clearLyricsIfUnchanged(expectedFileName: string | null): boolean;
  /** Refresh lyrics model manifest state + (once) the DirectML probe. */
  refreshLyricsGen(): Promise<void>;
  /** Download the missing models of a tier (resume + SHA-256 in Rust). */
  downloadLyricsTier(tier: LyricsTier): Promise<void>;
  cancelLyricsDownload(): void;
  /** Run the local pipeline on the loaded track; lines land via
   * loadLyricsText exactly like an imported .lrc. */
  generateLyrics(tier: LyricsTier, language: string): Promise<void>;
  cancelLyricsGenerate(): void;
  // --- lyrics correction editor (FEAT-004 phase 4) ---
  /** Replace line i's text (word timings follow; see lyricsEdit.setLineText). */
  editLyricLineText(i: number, text: string): void;
  /** Move line i's start (clamped between neighbours; words travel with it). */
  setLyricLineTime(i: number, t: number): void;
  nudgeLyricLine(i: number, deltaSec: number): void;
  /** Split line i at a caret position in its text. */
  splitLyricLine(i: number, charPos: number): void;
  mergeLyricLineWithNext(i: number): void;
  /** Insert an empty line after i (-1 = before the first line). */
  insertLyricLineAfter(i: number): void;
  deleteLyricLine(i: number): void;
  editLyricWord(i: number, k: number, text: string): void;
  setLyricWordTime(i: number, k: number, t: number): void;
  nudgeLyricWord(i: number, k: number, deltaSec: number): void;
  /** Spread line i's words evenly across its window. */
  redistributeLyricWords(i: number): void;
  undoLyricsEdit(): void;
  redoLyricsEdit(): void;
  resetLyricsEditHistory(): void;
  /** Attach generation-result confidence to the parsed lines (session-only). */
  applyLyricsConfidence(details: import("./lyricsGen").LineDetail[]): void;
  /** Save the current (edited) lines as an .lrc via the save dialog. */
  exportLyricsLrc(): Promise<void>;
  /** Re-run forced alignment for one line against the loaded track. */
  realignLyricLine(i: number): Promise<void>;
  setLyricStyle(patch: Partial<LyricStyle>): void;
  /** Toggle/adjust the audiogram overlay elements. */
  setAudiogram(patch: Partial<AudiogramSettings>): void;
  /** One click: detected sections -> energy-ranked timeline scenes. */
  autoArrangeTimeline(): void;
  pickLibraryFolder(): Promise<void>;
  playLibraryTrack(path: string): Promise<void>;
  /** Auto-advance hook — called by the engine's natural-end callback. */
  advanceLibrary(): Promise<void>;
  setLibraryAutoAdvance(v: boolean): void;
  togglePlay(): Promise<void>;
  seekStart(): void;
  seekEnd(time: number): void;
  seekBy(delta: number): void;
  toggleLoop(): void;
  /** Set session-only A/B markers at an explicit time, or the live playhead. */
  setLoopStart(time?: number): void;
  setLoopEnd(time?: number): void;
  clearLoopRegion(): void;
  applyVolume(volume: number, muted: boolean): void;
  pokeChrome(): void;
  setDragOver(v: boolean): void;
  setShowPanel(v: boolean | ((prev: boolean) => boolean)): void;
  setShowHelp(v: boolean): void;
  setShowGuide(v: boolean): void;
  setShowSettings(v: boolean): void;
  /** Dismiss the error toast — real errors have no timer, so a stale one would
   * otherwise sit over the whole session, including Stage mode. (The degraded-
   * renderer message that first motivated this now has its own persistent,
   * separately dismissible banner — see simplifiedRenderer.) */
  clearError(): void;
  /** Close the simplified-renderer banner. Dismissible so it is not a dead
   * end, but never auto-expiring — the controls it explains stay disabled. */
  dismissSimplifiedNotice(): void;
  /** Owner ruling D: close the persistent boot-recovery notice — see
   * `recoveredNotice`'s own doc comment. */
  dismissRecoveredNotice(): void;
  /** D1 fix, part (b): close the persistent superseded-file notice — see
   * `supersededNotice`'s own doc comment for why it is not auto-cleared by
   * `applyDocument` the way `recoveredNotice` is. */
  dismissSupersededNotice(): void;
  /** Owner ruling E: drop the boot veil — see `bootVeilVisible`'s own doc
   * comment. Idempotent (App.tsx calls this from two independent triggers,
   * whichever fires first); a no-op once already false. */
  hideBootVeil(): void;
  setStageMode(v: boolean): void;
  setBlackout(v: boolean): void;
  /** P-4: toggle the Perform drawer (operator console). Opening re-queries
   * the monitor list for the second-display picker. */
  setShowPerform(v: boolean): void;
  /** FEAT-009: enumerate displays for the drawer's picker (desktop only). */
  refreshPerformMonitors(): Promise<void>;
  /** Open (or re-place) the performance window per the stored monitor/
   * fullscreen prefs. The `performOpen` flag flips via the Rust lifecycle
   * event, not here — the window is the source of truth. */
  openPerformWindow(): Promise<void>;
  closePerformWindow(): Promise<void>;
  /** Persist + apply fullscreen for the performance window. */
  setPerformFullscreen(v: boolean): Promise<void>;
  /** Persist the target monitor (null = auto) and move an open window. */
  setPerformMonitor(index: number | null): Promise<void>;
  /** Output HUD (preset-name flash) on the performance window. */
  setPerformHud(v: boolean): void;
  setShowExport(v: boolean): void;
  setExportSettings(patch: Partial<ExportSettings>): void;
  runExport(): Promise<void>;
  cancelExport(): void;
  setShowBatch(open: boolean): void;
  addBatchTracks(files: File[]): Promise<void>;
  removeBatchTrack(id: string): void;
  setBatchTrackMeta(id: string, meta: Partial<OverlayMeta>): void;
  startBatch(): Promise<void>;
  skipCurrentBatchJob(): void;
  cancelBatch(): void;
  retryFailedBatch(): Promise<void>;
  dismissBatch(): void;
  setError(message: string | null): void;
  /** Reset the document to a clean default state (undoable). */
  newProject(): void;
  saveProject(): Promise<void>;
  openProject(): Promise<void>;
  /** Open a project from already-read text (the drag-drop path). */
  openProjectText(name: string, contents: string): void;
  /**
   * `alreadyOnDisk`: whole-lane-review fix M2. Set by `bootDesktopDocument`
   * when the document it is applying is byte-for-byte what was just READ
   * from the autosave file — every other caller (undo/redo/open/theme/new)
   * is applying a document that is NOT yet on disk and must keep the normal
   * scheduleAutosave() behavior. Without this, every desktop boot dirtied
   * the clean-exit marker and queued an identical rewrite before the user
   * touched anything — a hard kill in that window reported a false "crashed
   * last time" on the NEXT boot even though nothing was ever at risk.
   *
   * `fromHistory`: E2-D2. Set ONLY by undo()/redo() (projectIOActions.ts).
   * Threaded through to mergeEmbeddedDefs (custom.ts) to bypass S1's "keep
   * the local edit" protection — see that function's own comment for why a
   * history-apply is exempt while every other caller (project open, theme
   * apply, new-project, boot) is not.
   */
  applyDocument(
    doc: ProjectDocument,
    opts?: { alreadyOnDisk?: boolean; fromHistory?: boolean },
  ): void;
  /**
   * P-11: the desktop boot chokepoint — see projectIOActions.ts's own doc
   * comment and .superpowers/p11-lane-log.md for the full design.
   *
   * Final review round, item 2: returns `null` SYNCHRONOUSLY, not a
   * Promise, when this particular call is not the owner (isTauri() false,
   * or the reentrancy guard finds a boot already in flight — React
   * StrictMode's dev-only double-invoke is the case that matters here).
   * `null` rather than a fast-resolving `Promise<void>` is deliberate: the
   * caller (App.tsx's boot-veil effect) needs to know ownership at the
   * SAME moment it decides whether to arm the veil's race at all, and by
   * the time any promise — however fast — resolved, it would already be
   * too late to matter. A non-owner call touches nothing and returns
   * immediately; only the owner's call does any work or ever resolves
   * once real work (read/parse/apply) has actually happened.
   */
  bootDesktopDocument(): Promise<void> | null;
  /** Whole-lane-review fix C1: an immediate (non-debounced), awaited write
   * of the current document to the autosave file — bypasses and cancels
   * scheduleAutosave's pending timers. Used by the Tauri close-requested
   * handler (awaited, so the window does not actually close until this
   * settles) and best-effort from the pagehide handler (fire-and-forget —
   * pagehide cannot reliably await async work). A no-op in the browser
   * build. */
  flushAutosave(): Promise<void>;
  undo(): void;
  redo(): void;
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
  /** Move one of `paramKey`'s routes within its own stack (H12). Indices are
   *  positions inside that param's routes, matching a ModulationPage card's
   *  own list — see reorderRoutes (modMatrix.ts) for the exact contract. */
  reorderModRoutes(paramKey: string, fromIndex: number, toIndex: number): void;
  /** Bulk-remove every route whose source matches (H13). Destructive + bulk —
   *  the UI asks first (ModulationPage's clearSourceGuarded); this action
   *  itself stays prompt-free, same UI-level-guard split as
   *  deleteLook/clearLyricsGuarded (ParamsPanel.tsx). */
  clearModRoutesForSource(source: ModSource): void;
  /** Bulk-set `amount` on every route targeting `param` — the stacked card's
   *  "All" depth control (H13). Not destructive, no confirm. */
  setModRouteAmountsForParam(param: string, amount: number): void;
  /** Add a curated route recipe's routes to the active visual (P-7 chips). */
  applyModRouteRecipe(id: string): void;
  /** Re-rasterize the overlay at the live canvas size (debounced). */
  refreshOverlay(): void;
  /** Run the offline analysis pass (beat grid) on the loaded track. */
  analyzeCurrentTrack(): void;
  /**
   * Resolves once the in-flight `analyzeCurrentTrack` has written its result
   * into the store — or immediately when nothing is analysing.
   *
   * `analyzing` says a change is COMING; this is how another action group
   * waits for it. Without it, anything that reads `beatGrid`/`sections` right
   * after a load silently reads the pre-analysis `null` (E2-R2: an export
   * fired in that window rendered with no grid at all while the preview a
   * moment later had one — 120/120 frames differed).
   *
   * Never rejects and carries no bound of its own: `analyzeTrack`'s promise
   * cannot be cancelled or timed out from here (batchRunner.ts:90-108 says the
   * same thing about the same promise), so the WAIT is the caller's policy —
   * it owns the timeout and the abort signal.
   */
  awaitAnalysis(): Promise<void>;
}

export type VizState = DocumentSlice & SessionSlice & Actions;

// Non-serializable ephemera live outside the state object. Cross-group state
// (trackLoadGen, exportAbort/exportStarting, lastFrameKey, libraryPrefetch,
// midiHandle) and NULL_FRAME_KEY moved to slices/shared.ts; per-group ephemera
// (batchAbort/batchStarting, exportStartedAt, libraryClickGen) live in their
// own slice files. What remains here is owned by the store core.
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let autosaveFailureShown = false;
/** Live canvas — overlay rasters at its pixel size. Set by initApp. */
let liveCanvas: HTMLCanvasElement | null = null;
let overlayTimer: ReturnType<typeof setTimeout> | undefined;
/** Static overlay bitmap RETAINED while lyrics are active: the compositor
 * redraws base+line on every line/fade-step change, so the renderer only
 * ever receives composed copies (it closes what it's handed). */
let overlayBase: ImageBitmap | null = null;
/** Decoded video-background loop; the frame tick uploads the frame for t. */
let videoBgFrames: VideoBgFrames | null = null;
// Previous frame's track time, for beat-quantized switch takeover. Live-only.
let lastQuantizeTick = -1;
let overlayComposeToken = 0;
/** Lyric plate (Lyric Stage's text input): last uploaded key + raster token.
 * Its own memo pair, not shared.lastFrameKey's — the plate is ungated on the
 * caption toggle and keys on its own grid (lyricPlate.ts). */
let lastPlateKey: LyricPlateKey = NULL_PLATE_KEY;
let plateToken = 0;
/** Forget the uploaded plate and clear it off the renderer. The next frame
 * tick recomposes from whatever lines then exist — one function for every
 * "the plate I uploaded no longer describes the document" moment (lyrics
 * identity change, renderer rebuild). */
function resetLyricPlate(): void {
  lastPlateKey = NULL_PLATE_KEY;
  plateToken++;
  getRenderer()?.setLyricPlate(null);
}

/** The per-frame overlay layers (lyrics + audiogram) assembled from state —
 * the SAME shape the export job carries, so live and export compose alike. */
function overlayDynamics(s: VizState): OverlayDynamics {
  return {
    lyrics: s.lyrics ? { lines: s.lyrics, style: s.lyricStyle } : undefined,
    audiogram: audiogramActive(s.audiogram)
      ? { settings: s.audiogram, duration: getEngine().duration, waveform: s.waveformOverview }
      : undefined,
  };
}
/** Monotonic token: only the newest raster result gets applied. */
let overlayToken = 0;
/** Latest analysis job id — stale results are dropped. */
let analysisId = 0;
/**
 * The outstanding analysis, as a promise that settles AFTER the store has been
 * written — not the raw `analyzeTrack` promise, which resolves one tick earlier
 * and would let a waiter read the state it is waiting for before it exists.
 * Read only through `awaitAnalysis()`.
 *
 * Since E3c it is opened by `invalidateAnalysis()`, at the moment the NEW audio
 * reaches the engine — which is several awaits BEFORE the job that fills it
 * exists. That is the point: `analyzing` and this promise have to become true
 * together, or `awaitAnalysis()` would hand a waiter the PREVIOUS track's
 * already-resolved promise and it would sail straight through onto the nulls
 * the invalidation just wrote (E3b's bug, in E3b's own window).
 */
let analysisSettled: Promise<void> | null = null;
/** Resolves `analysisSettled`. Non-null exactly while an analysis is
 * outstanding — i.e. while `analyzing` is this module's to clear. */
let releaseAnalysis: (() => void) | null = null;
/**
 * The id of an invalidation that no analysis job has claimed yet: the state is
 * void and `analyzing` is true, but nothing is computing.
 *
 * It is the predicate for "the gate is closed and nothing will open it", which
 * is what every load-path exit needs to know. Non-null means the only job that
 * could have filled this hole was never started, so the exiting load must clear
 * the flag; null means a job is running (or none is outstanding) and clearing
 * would re-open E3b's null-grid window on a track that is still analysing.
 */
let unclaimedAnalysisId: number | null = null;
/** toggleLiveInput spans two real awaits (worklet + Rust spawn); this stops a
 * second click from running a second start path whose failure cleanup would
 * tear down the first click's worklet. */
let liveToggling = false;
/** Trailing timer: reset on every scheduleAutosave() call, fires
 * autosaveIntervalSec after the LAST edit (the "quiet period" write). */
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * Whole-lane-review fix C1: the max-latency ceiling. Set ONCE per burst
 * (only when undefined — never reset by a later scheduleAutosave() call
 * the way autosaveTimer is), so it fires autosaveIntervalSec after the
 * FIRST edit of a burst regardless of how many more edits keep pushing
 * `autosaveTimer` out. Without this, `autosaveTimer` alone is a PURE
 * trailing debounce with no cap: continuous editing (a long slider drag —
 * one record() per pointermove) keeps resetting it forever, so the on-disk
 * autosave's staleness was bounded only by "how long until the user
 * pauses," not by the configured interval at all. Cleared (both timers)
 * the moment a write actually starts.
 */
let autosaveMaxTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Second whole-lane-review round, item 2: `initApp`'s onCloseRequested
 * handler awaits `flushAutosave()` with no deadline of its own — a
 * genuinely hung write (a cloud-synced AppData folder can stall a file
 * operation for real on Windows) would leave the window permanently
 * unclosable. Long enough for an ordinary write, short enough that a
 * stall doesn't read as a frozen app. On timeout the handler proceeds to
 * destroy() anyway: writeAutosave's atomic tmp+rename (see platform.ts)
 * means abandoning the wait can never leave a TORN file on disk, only one
 * a few seconds staler than ideal — an intact old copy beats an
 * unclosable app.
 */
const CLOSE_FLUSH_TIMEOUT_MS = 4000;

/**
 * R2-09: how long a CONFIRMED close waits for a cancelled export's teardown —
 * the stream writer's `.partial` discard, the sidecar's `prores_abort` — to
 * finish before proceeding to the ordinary flush+destroy anyway. The teardown
 * is a couple of file removes and a process kill, so this is generous; the
 * bound exists for exactly the reason CLOSE_FLUSH_TIMEOUT_MS does — a wedged
 * teardown must never make the window unclosable. lib.rs's Destroyed hook
 * backstops the SIDECAR lanes only (it kills ffmpeg and removes ITS partial
 * output); a stream-lane `.partial` whose discard outlives this bound simply
 * survives on disk until the next export to the same target reuses the name.
 */
const EXPORT_TEARDOWN_TIMEOUT_MS = 2000;

/**
 * D1 fix (E2-D1) — GATE AUTOSAVE ON BOOT SETTLEMENT.
 *
 * The boot veil's hard cap (App.tsx's BOOT_VEIL_CAP_MS) can legitimately
 * drop while `bootDesktopDocument`'s read is still in flight — a large
 * embedded background asset or a slow disk make a >500ms read a real case,
 * not a hypothetical one (that function's own comment). The user is then
 * looking at a fully interactive app whose document is the potentially
 * ancient localStorage-sourced seed. Before this fix, an edit in that
 * window armed `scheduleAutosave`; when the real read landed a moment
 * later, the anti-clobber guard in `bootDesktopDocument` correctly refused
 * to apply it over the fresh edit, but the armed autosave then went on to
 * serialize the stale-base document straight over the newer file the guard
 * had just refused to touch — a *legitimately successful* write of the
 * wrong content, no error, no quarantine, nothing to notice. See
 * .superpowers-repro/e2-deepstate-findings.md (E2-D1) for the full trace,
 * including the no-edit variant (closing the window mid-read has the same
 * effect via `flushAutosave`, with no edit needed at all).
 *
 * The fix: every write-back through `runScheduledAutosaveWrite`
 * (`flushAutosave` funnels through the same function) waits for the boot
 * read to settle FIRST, so `docOf(get())` is only ever serialized AFTER
 * `bootDesktopDocument`'s guard — and the quarantine-aside it now performs
 * on refusal, see `quarantineSupersededAutosave` in platform.ts — has
 * already run. Combined with that quarantine, this closes BOTH repro paths
 * and restores the M2 `alreadyOnDisk` invariant ("these bytes are already
 * the file") for the no-edit case, where a premature write would otherwise
 * make that claim false the instant the read resolves.
 *
 * `bootSettled` starts PRE-RESOLVED: most of this app's lifetime — every
 * browser-build session, and any desktop session outside its own one-time
 * boot read — has no outstanding boot to wait for, and a write that will
 * never be raced by one must not pay any latency for this at all;
 * `awaitBootSettled` resolves on the very next microtask in that case,
 * never touching the bounded timeout below. Only `bootDesktopDocument`'s
 * owning call (via `ctx.beginBootRead`/`ctx.endBootRead`, symmetric with
 * that function's own `bootStarted` reentrancy flag — see ctx.ts's own
 * comment) ever installs a genuinely pending promise here, for the exact
 * span of its own read + guard + quarantine-aside.
 */
let bootSettled: Promise<void> = Promise.resolve();
let resolveBootSettled: (() => void) | null = null;

const beginBootRead = (): void => {
  bootSettled = new Promise<void>((resolve) => {
    resolveBootSettled = resolve;
  });
};

const endBootRead = (): void => {
  resolveBootSettled?.();
  resolveBootSettled = null;
};

/**
 * Bounded wait, sharing `CLOSE_FLUSH_TIMEOUT_MS`'s mold and its literal
 * value on purpose: both express the identical judgment call ("how long is
 * it reasonable to make the user wait before proceeding with whatever
 * we've got"), and a hung boot read must never be able to dam an autosave
 * write — or the close-flush that awaits one — forever. `Promise.race`
 * against a fresh per-call timeout, not a single shared timer: this must
 * be safe to call from many places (every debounced write, every
 * `flushAutosave`) without callers coordinating a timer between them.
 *
 * C1 fix (review round) — resolves to a DISCRIMINANT, not `void`. The
 * first version of this resolved to nothing at all, and
 * `runScheduledAutosaveWrite` proceeded to write UNCONDITIONALLY once this
 * settled either way — which meant a read slower than the bound produced
 * the exact E2-D1 bug this whole mechanism exists to prevent, just moved
 * one layer down: `docOf(get())` still reflects whatever `bootDesktopDocument`'s
 * guard hasn't had a chance to examine yet (the stale seed, plus any edit
 * that landed in the window), and writing it discards the real autosave
 * file's content just as surely as having no gate at all — with the added
 * insult that the eventual quarantine-aside then archives THAT premature
 * write instead of the true newer document. Callers MUST branch on the
 * result; see `runScheduledAutosaveWrite`'s own comment for the one place
 * that does.
 *
 * Residual, deliberately accepted overlap with the close handler's OWN
 * `CLOSE_FLUSH_TIMEOUT_MS` race (store.ts's `onCloseRequested` installer):
 * in the pathological case of a read that is BOTH hung AND being awaited
 * by a close, this bound can spend the entire close-flush budget just
 * waiting for boot before a write is even attempted, so the outer race may
 * move on before one lands. That is not a new risk — the outer race
 * already documents abandoning a slow write as acceptable ("an intact old
 * copy beats an unclosable app") — only a new *reason* the same
 * already-accepted budget might be spent, and per the fix above it now
 * trades "abandon a slow write" for "abandon a write we correctly declined
 * to attempt," which is strictly safer, not worse.
 */
const awaitBootSettled = (): Promise<"settled" | "timeout"> =>
  Promise.race([
    bootSettled.then((): "settled" => "settled"),
    new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), CLOSE_FLUSH_TIMEOUT_MS),
    ),
  ]);

function resolveParams(presetId: string, overrides: Record<string, ParamValues>): ParamValues {
  const preset = presetById(presetId);
  return { ...defaultParams(preset), ...overrides[preset.id] };
}

// Custom WGSL presets must be registered before anything resolves preset
// ids (initial state, validators) — otherwise a stored custom id would fall
// back to the default mode on every launch.
const initialCustomDefs = loadCustomPresets();
for (const def of initialCustomDefs) registerCustomPreset(def);

const initialPresetId = (() => {
  const stored = loadStoredPresetId();
  return stored &&
    (presets.some((p) => p.id === stored) || initialCustomDefs.some((d) => d.id === stored))
    ? stored
    : presets[0].id;
})();
const initialParams = loadStoredParams();
// Builder bridge (RP-20): the stack is the single persisted truth for Builder
// values. Regenerate the builder2 def for the STORED structure (presetById
// resolves through it) and rewrite the virtual-param mirror from the stack,
// so a stale persisted mirror can never win over the stack it shadows.
const initialBuilderStack = loadStoredBuilderStack();
rebuildBuilder2(initialBuilderStack);
initialParams[BUILDER2_ID] = builderStackValues(initialBuilderStack);
const initialSync = loadStoredSync();
const initialOverlay = loadStoredOverlay();
const initialMods = loadStoredMods();

export const useVizStore = create<VizState>((set, get) => {
  const flashNotice = (notice: string) => {
    set({ notice });
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => set({ notice: null }), 4000);
  };

  /** The custom defs this document actually references (active preset +
   * timeline scenes) — what travels in the .bfproj so it renders identically
   * elsewhere. Deliberately NOT the whole library: unreferenced defs would
   * bloat every save and every history snapshot for no portability gain. */
  const referencedCustomDefs = (s: VizState): PresetDef[] => {
    const ids = new Set<string>([s.presetId]);
    for (const scene of s.timeline.scenes) ids.add(scene.presetId);
    return s.customDefs.filter((d) => ids.has(d.id));
  };

  /** Current document slice as a ProjectDocument (history + save share it). */
  const docOf = (s: VizState): ProjectDocument => ({
    presetId: s.presetId,
    paramsByPreset: s.paramsByPreset,
    syncByPreset: s.syncByPreset,
    bg: s.bg,
    bgByPreset: s.bgByPreset,
    centerImageByPreset: s.centerImageByPreset,
    overlayLayers: s.overlayLayers,
    assets: s.assets,
    aspect: s.aspect,
    modsByPreset: s.modsByPreset,
    smoothSpectrum: s.smoothSpectrum,
    timeline: s.timeline,
    post: s.post,
    motion: s.motion,
    lyricStyle: s.lyricStyle,
    audiogram: s.audiogram,
    customDefs: referencedCustomDefs(s),
    builderStack: s.builderStack,
  });

  /** Record the current document before a mutation (gesture-grouped). */
  /** While true, record() is a no-op — used to make compound actions one
   * undo step instead of one per inner action. */
  let recordSuspended = false;

  const record = (key: string) => {
    if (recordSuspended) return;
    pushHistory(docOf(get()), key);
    const d = historyDepths();
    set({ undoDepth: d.undo, redoDepth: d.redo });
    scheduleAutosave();
  };

  /** Record ONE history entry for `key`, then run `fn` with inner record()
   * calls suppressed — a compound action must cost exactly one Ctrl+Z. */
  const asOneGesture = (key: string, fn: () => void) => {
    record(key);
    recordSuspended = true;
    try {
      fn();
    } finally {
      recordSuspended = false;
    }
  };

  /**
   * Decode the track's cover art and hand it to the renderer so presets can
   * sample it (coverSample()/hasCover()). Race-guarded: a decode that finishes
   * after the track changed is dropped instead of overwriting the new cover.
   */
  /** Set Hue/Hue spread from the analyzed cover — only when the active
   * preset opts in (has a coverHue param) AND the user turned it on. One
   * history entry for the pair; a no-op without a usable palette. */
  const maybeApplyCoverPalette = (recordHistory = false) => {
    const state = get();
    const pal = state.coverPalette;
    if (!pal) return;
    const def = presetById(state.presetId);
    if (!def.params.some((p) => p.key === "coverHue")) return;
    if ((state.activeParams.coverHue ?? 0) < 0.5) return;
    if (state.activeParams.hue === pal.hue && state.activeParams.hueSpread === pal.spread) return;
    // Only a USER interaction (flipping the toggle) records an undo entry —
    // the automatic re-apply on track/cover/project load used to push a
    // spurious step, so opening a project immediately dirtied its history
    // (audit R2).
    if (recordHistory) record("cover-palette");
    recordSuspended = true;
    try {
      const activeParams = { ...state.activeParams, hue: pal.hue, hueSpread: pal.spread };
      const paramsByPreset = { ...state.paramsByPreset, [state.presetId]: activeParams };
      set({ activeParams, paramsByPreset });
      saveStoredParams(paramsByPreset);
    } finally {
      recordSuspended = false;
    }
  };

  const applyCoverArt = () => {
    const s = get();
    // A custom center image (per mode) replaces the track's embedded cover
    // as THE art the shader samples — and as the palette source, so "match
    // cover colors" matches what is actually on screen.
    const overrideId = s.centerImageByPreset[s.presetId];
    const cover = (overrideId ? s.assets[overrideId]?.dataUrl : undefined) ?? s.coverArt;
    if (!cover) {
      set({ coverPalette: null });
      getRenderer()?.setCoverArt(null);
      return;
    }
    void fetch(cover)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b))
      .then((bmp) => {
        const now = get();
        const nowResolved =
          (now.centerImageByPreset[now.presetId]
            ? now.assets[now.centerImageByPreset[now.presetId]]?.dataUrl
            : undefined) ?? now.coverArt;
        if (nowResolved === cover) {
          // Palette BEFORE the renderer takes the bitmap (ownership transfer
          // closes it) — extraction only reads pixels via drawImage.
          set({ coverPalette: extractCoverPalette(bmp) });
          maybeApplyCoverPalette();
          getRenderer()?.setCoverArt(bmp);
        } else bmp.close();
      })
      .catch(() => {
        // Same race guard as success: a stale decode failure (slow corrupt
        // art from the PREVIOUS track) must not wipe the current track's cover
        const now = get();
        const nowResolved =
          (now.centerImageByPreset[now.presetId]
            ? now.assets[now.centerImageByPreset[now.presetId]]?.dataUrl
            : undefined) ?? now.coverArt;
        if (nowResolved === cover) {
          set({ coverPalette: null });
          getRenderer()?.setCoverArt(null);
        }
      });
  };

  /** Read + decode the NEXT library track while the current one plays, so
   * auto-advance swaps buffers instead of paying disk + decode at the gap.
   * Decodes on the engine's own context — a fresh OfflineAudioContext would
   * resample and shift every FFT bin (the batch learned this the hard way). */
  /** Lower-cased file names already present in a folder (desktop). Batch runs
   * treat those as reserved so no run — this one, a retry, or one from a past
   * session — ever overwrites a finished video. Errors degrade to "none". */
  const fileNamesInDir = async (dir: string): Promise<Set<string>> => {
    if (!isTauri()) return new Set();
    try {
      const { readDir } = await import("@tauri-apps/plugin-fs");
      return new Set(
        (await readDir(dir)).filter((e) => !e.isDirectory).map((e) => e.name.toLowerCase()),
      );
    } catch {
      return new Set();
    }
  };

  const prefetchNextLibraryTrack = async () => {
    const s = get();
    if (!s.library || !s.libraryActivePath) return;
    const i = s.library.tracks.findIndex((t) => t.path === s.libraryActivePath);
    if (i < 0 || i + 1 >= s.library.tracks.length) {
      shared.libraryPrefetch = null;
      return;
    }
    const next = s.library.tracks[i + 1];
    if (shared.libraryPrefetch?.path === next.path) return;
    shared.libraryPrefetch = null;
    try {
      const bytes = await readBinaryFromPath(next.path);
      const file = new File([bytes as BlobPart], next.fileName);
      const buffer = await decodeAudioLenient(getEngine().ctx, await file.arrayBuffer());
      // Only keep it if the user is still on the track we prefetched FOR.
      if (get().library?.tracks[i + 1]?.path === next.path) {
        shared.libraryPrefetch = { path: next.path, file, buffer };
      }
    } catch {
      shared.libraryPrefetch = null; // advance falls back to the plain load path
    }
  };

  /**
   * Bake + hand the image background to the renderer (or clear it). Token-
   * guarded like applyCoverArt: a slow bake finishing after the bg changed
   * again must not overwrite the newer image.
   */
  let bgImageToken = 0;
  // Decoded video-background loop (non-serializable, lives outside state).
  let videoBgToken = 0;
  /**
   * What each background is currently baked/decoded FROM. `setBg` runs on every
   * slider `onChange`, so a one-second Dim/Blur drag used to launch dozens of
   * concurrent full bakes (and, for video, full mediabunny decodes of up to 240
   * frames). The token guard discarded the results but all the work still ran.
   * Skipping when the inputs are unchanged is what actually stops it.
   * Cleared on renderer change, since a fresh renderer holds no bitmap.
   */
  let bgImageKey = "";
  let videoBgKey = "";
  const invalidateBgCaches = () => {
    bgImageKey = "";
    videoBgKey = "";
  };
  /** The background that should actually render right now: the active
   * mode's override if one exists, else the global bg. EVERY renderer-apply
   * and persistence-of-pixels path goes through this. The rule itself lives
   * in selectors.ts — the panel, the render loop and the export builder all
   * resolve it with the same function (BG1). */
  const effBg = (): BgSettings => selectEffectiveBg(get());

  /** Is an asset still referenced by anything other than the caller? Checked
   * before orphan-GC: overlay layers, the global bg, every per-mode bg
   * override, and every center image can hold a reference. */
  const assetInUse = (id: string): boolean => {
    const s = get();
    if (s.overlayLayers.some((l) => "assetId" in l && l.assetId === id)) return true;
    for (const b of [s.bg, ...Object.values(s.bgByPreset)]) {
      if (b.image?.assetId === id || b.video?.assetId === id) return true;
    }
    return Object.values(s.centerImageByPreset).includes(id);
  };

  /** Write a new background to wherever the active mode's edits belong —
   * the mode's override when one exists, the global bg otherwise — then
   * persist and hand the effective result to the renderer. */
  const commitBg = (next: BgSettings) => {
    const s = get();
    if (selectBgPerMode(s)) {
      const bgByPreset = { ...s.bgByPreset, [s.presetId]: next };
      set({ bgByPreset });
      saveStoredBgByPreset(bgByPreset);
    } else {
      set({ bg: next });
      saveStoredBg(next);
    }
    getRenderer()?.setBackground(effBg());
    applyBgImage();
    applyVideoBg();
  };

  const applyBgImage = () => {
    const { assets } = get();
    const bg = effBg();
    const asset = bg.mode === BG_IMAGE && bg.image ? assets[bg.image.assetId] : undefined;
    const key = asset && bg.image ? `${bg.image.assetId}|${bg.image.dim}|${bg.image.blur}` : "";
    if (key === bgImageKey) return; // nothing that affects the bake changed
    bgImageKey = key;
    const token = ++bgImageToken;
    if (!asset || !bg.image) {
      getRenderer()?.setBackgroundImage(null);
      return;
    }
    void bakeBackgroundBitmap(asset.dataUrl, bg.image.blur, bg.image.dim)
      .then((bmp) => {
        if (token === bgImageToken) getRenderer()?.setBackgroundImage(bmp);
        else bmp.close();
      })
      .catch(() => {
        if (token === bgImageToken) getRenderer()?.setBackgroundImage(null);
      });
  };

  /**
   * Decode (or clear) the video-background loop for the current bg. Token-
   * guarded like applyBgImage: a slow decode finishing after the bg changed
   * again must not install stale frames. The per-frame upload happens in the
   * frame tick; this only owns the decoded array's lifecycle.
   */
  const applyVideoBg = () => {
    const { assets } = get();
    const bg = effBg();
    const asset = bg.mode === BG_VIDEO && bg.video ? assets[bg.video.assetId] : undefined;
    // See bgImageKey: without this a Dim/Blur drag re-decoded the whole clip
    // on every pointer move.
    const key = asset && bg.video ? `${bg.video.assetId}|${bg.video.dim}|${bg.video.blur}` : "";
    if (key === videoBgKey) return;
    videoBgKey = key;
    const token = ++videoBgToken;
    if (!asset || !bg.video) {
      disposeVideoBgFrames(videoBgFrames);
      videoBgFrames = null;
      // Leaving video mode: clear bgTex so a stale last frame doesn't linger.
      if (bg.mode !== BG_VIDEO) getRenderer()?.setBackgroundImage(null);
      set({ videoBgLoading: false });
      return;
    }
    set({ videoBgLoading: true });
    void fetch(asset.dataUrl)
      .then((r) => r.blob())
      .then((blob) => decodeVideoBgFrames(blob, bg.video!.dim, bg.video!.blur))
      .then((decoded) => {
        if (token !== videoBgToken) {
          disposeVideoBgFrames(decoded);
          return;
        }
        disposeVideoBgFrames(videoBgFrames);
        videoBgFrames = decoded;
        set({ videoBgLoading: false });
      })
      .catch((e) => {
        if (token !== videoBgToken) return;
        disposeVideoBgFrames(videoBgFrames);
        videoBgFrames = null;
        // Clear bgTex so mode 4 doesn't keep compositing the last uploaded
        // frame frozen forever — a broken video degrades to an empty bg.
        getRenderer()?.setBackgroundImage(null);
        // A codec mediabunny can't decode (e.g. old MPEG-4 Part 2 in an
        // .mp4 shell) surfaces as a bare "Assertion failed" — translate.
        const msg = (e as Error).message ?? String(e);
        const friendly = /assertion|unsupported|no decoder|codec/i.test(msg)
          ? "this clip's video codec isn't supported — re-encode it as H.264 or VP9 and try again"
          : msg;
        set({
          videoBgLoading: false,
          error: `Could not load video background: ${friendly}`,
        });
      });
  };

  /**
   * The one place that actually performs a write, shared by the trailing
   * timer, the max-latency ceiling, and flushAutosave. Clears BOTH timers
   * first (synchronously) so a document change that arrives while this
   * write is in flight starts a fresh, correctly-anchored burst rather than
   * being silently absorbed by timers this call is about to fire anyway.
   *
   * D1 fix (E2-D1): waits for the boot read to settle (bounded —
   * `awaitBootSettled`'s own comment) BEFORE ever calling `docOf(get())`.
   * `docOf` is evaluated inside the `.then()`, i.e. AFTER that wait, so it
   * captures whatever `bootDesktopDocument`'s guard — and the
   * quarantine-aside it performs on refusal — left behind, never a
   * snapshot taken before either had a chance to run. On the ordinary path
   * (no boot outstanding) `awaitBootSettled` resolves on the next
   * microtask, so this adds no observable latency.
   *
   * C1 fix (review round) — a TIMEOUT outcome SKIPS the write entirely
   * rather than proceeding with it. Writing on a mere timeout is exactly
   * the bug this gate exists to prevent: `bootDesktopDocument`'s guard (and
   * the quarantine-aside it performs on refusal) hasn't run yet, so
   * `docOf(get())` could still be the stale localStorage seed — writing it
   * would silently discard the real autosave file's content just as
   * surely as having no gate at all, and worse, would leave the eventual
   * quarantine-aside archiving THAT premature write instead of the true
   * newer document once the read finally lands. `scheduleAutosave()` on
   * the skip path re-arms a fresh burst so the NEXT debounce/max-latency
   * cycle retries — by then boot will most likely have settled; if the
   * read is genuinely, permanently hung, this simply retries forever
   * without ever writing, which is correct: the existing on-disk file,
   * whatever it is, stays safer than a write we could never vouch for.
   * `flushAutosave`'s callers (the close handler) already treat an
   * abandoned write as acceptable via their own independent
   * `CLOSE_FLUSH_TIMEOUT_MS` race — resolving normally here rather than
   * throwing keeps that true, instead of surfacing a misleading "Autosave
   * is failing" toast for a write that was correctly declined, not failed.
   */
  const runScheduledAutosaveWrite = (): Promise<void> => {
    clearTimeout(autosaveTimer);
    clearTimeout(autosaveMaxTimer);
    autosaveTimer = undefined;
    autosaveMaxTimer = undefined;
    return awaitBootSettled()
      .then((outcome) => {
        if (outcome === "timeout") {
          console.warn(
            "[autosave] the boot read has not settled after the bound — skipping this write rather than risk stale pre-guard content; a later cycle will retry",
          );
          scheduleAutosave();
          return;
        }
        return writeAutosave(serializeProject(docOf(get()), APP_VERSION));
      })
      .catch((e) => {
        console.error("[autosave]", e);
        // Surface ONCE per session: a failing autosave means the sole
        // persisted copy silently isn't being kept up to date — exactly the
        // failure that went unnoticed from the feature's birth until the
        // first hardware test (the $APPDATA write scope was never granted).
        if (!autosaveFailureShown) {
          autosaveFailureShown = true;
          set({
            error: `Autosave is failing — your changes are not being saved (${(e as Error).message ?? e})`,
          });
        }
        throw e; // rethrown for flushAutosave's awaiters (onCloseRequested); the two setTimeout call sites below swallow it themselves — the logging above already happened
      });
  };

  /** setTimeout callback wrapper: the meaningful handling (console.error +
   * user-facing toast) already happened inside runScheduledAutosaveWrite's
   * own catch before it rethrows for flushAutosave's benefit — a bare
   * `void runScheduledAutosaveWrite()` here would otherwise surface that
   * rethrow as an unhandled promise rejection on every timer-driven write
   * failure. */
  const runScheduledAutosaveWriteFireAndForget = (): void => {
    void runScheduledAutosaveWrite().catch(() => undefined);
  };

  /**
   * Debounced-with-a-ceiling project autosave (desktop) — whole-lane-review
   * fix C1. `autosaveTimer` is the ordinary trailing debounce (fires
   * autosaveIntervalSec after the LAST edit); `autosaveMaxTimer` is set
   * ONCE per burst and is never reset, so it fires no later than
   * autosaveIntervalSec after the FIRST edit regardless of how long the
   * burst continues — the cap that a pure trailing debounce doesn't have
   * (see autosaveMaxTimer's own comment at its declaration).
   */
  const scheduleAutosave = () => {
    // Mark the session dirty IMMEDIATELY, not when the debounced write lands:
    // a crash inside this window is exactly the case recovery exists for,
    // and the previous autosave on disk is then the newest copy of the work.
    markSessionDirty();
    const intervalMs = getPrefs().autosaveIntervalSec * 1000;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(runScheduledAutosaveWriteFireAndForget, intervalMs);
    if (autosaveMaxTimer === undefined) {
      autosaveMaxTimer = setTimeout(runScheduledAutosaveWriteFireAndForget, intervalMs);
    }
  };

  /**
   * E3c — void everything derived from the PREVIOUS track's audio, and declare
   * an analysis outstanding.
   *
   * Called by every load path at the moment the NEW audio reaches the engine,
   * which is one `play()` and one tag scan BEFORE `analyzeCurrentTrack()` runs.
   * In that window the beat grid, key, sections and waveform overview are not
   * merely missing — they describe the song that just stopped — and `analyzing`
   * was false, so E3b's export gate saw nothing to wait for and rendered the
   * previous song's grid over this song's audio.
   *
   * Returns the analysis id it claimed, so the job that eventually starts can
   * check it against `analysisId` and drop its result if superseded.
   */
  const invalidateAnalysis = (): number => {
    // An invalidation no job has claimed yet IS the current one: a load path
    // invalidates and then calls analyzeCurrentTrack, and opening a second
    // barrier there would release the very waiter the first one exists to hold.
    if (unclaimedAnalysisId != null) return unclaimedAnalysisId;
    const id = ++analysisId;
    // A SUPERSEDING load frees the previous barrier's waiters rather than
    // stranding them behind a job that will never be accepted: runExport
    // re-reads `shared.trackLoadGen` the instant its wait resolves and refuses
    // the mixed-track export there (exportActions.ts:332).
    releaseAnalysis?.();
    analysisSettled = new Promise<void>((resolve) => {
      releaseAnalysis = resolve;
    });
    unclaimedAnalysisId = id;
    // waveformOverview goes too: it is the previous track's PCM drawn as a
    // picture, and the audiogram's waveform strip renders it — into the
    // preview AND into an export's overlay. A missing strip for the length of
    // a tag scan is a smaller lie than the wrong song's.
    set({
      beatGrid: null,
      trackKey: null,
      sections: [],
      waveformOverview: null,
      analyzing: true,
    });
    getAnalyzer().setBeatGrid(null);
    getAnalyzer().setSections(null);
    return id;
  };

  /**
   * Close the outstanding analysis: `analyzing` false, waiters released, with
   * `patch` (the grid, when there is one) written in the SAME set so a released
   * waiter cannot observe the flag without the result.
   */
  const settleAnalysis = (patch?: Partial<VizState>): void => {
    unclaimedAnalysisId = null;
    analysisSettled = null;
    set({ ...patch, analyzing: false });
    releaseAnalysis?.();
    releaseAnalysis = null;
  };

  /**
   * Settle an invalidation that no analysis job ever claimed — the gate is
   * closed and nothing is coming to open it.
   *
   * Every load-path exit that will not reach `analyzeCurrentTrack` calls this,
   * because `analyzing` is a GATE (E3b) and a stuck one makes every later
   * export sit out its full ANALYSIS_TIMEOUT_MS. The `unclaimed` predicate is
   * what keeps it from over-clearing: a load whose decode fails while the
   * CURRENT track is still being analysed must leave that analysis alone.
   */
  const settleUnclaimedAnalysis = (): void => {
    if (unclaimedAnalysisId == null) return;
    settleAnalysis();
  };

  // The shared closure surface handed to every slice factory.
  const ctx: SliceCtx = {
    docOf,
    referencedCustomDefs,
    record,
    asOneGesture,
    flashNotice,
    applyCoverArt,
    applyBgImage,
    applyVideoBg,
    scheduleAutosave,
    fileNamesInDir,
    prefetchNextLibraryTrack,
    invalidateAnalysis,
    settleUnclaimedAnalysis,
    beginBootRead,
    endBootRead,
  };

  return {
    // --- document ---
    presetId: initialPresetId,
    paramsByPreset: initialParams,
    syncByPreset: initialSync,
    // Belt for the quota split-brain: a stored image bg whose asset never made
    // it into storage (multi-MB data URLs can fail to persist) must not boot
    // the app into a black background — degrade to the preset background.
    bg: (() => {
      const bg = loadStoredBg();
      const imageMissing =
        bg.mode === BG_IMAGE && (!bg.image || !initialOverlay.assets[bg.image.assetId]);
      const videoMissing =
        bg.mode === BG_VIDEO && (!bg.video || !initialOverlay.assets[bg.video.assetId]);
      return imageMissing || videoMissing ? { ...bg, mode: 0 } : bg;
    })(),
    bgByPreset: loadStoredBgByPreset(initialOverlay.assets),
    centerImageByPreset: loadStoredCenterImages(initialOverlay.assets),
    overlayLayers: initialOverlay.layers,
    assets: initialOverlay.assets,
    aspect: loadStoredAspect(),
    modsByPreset: initialMods,
    smoothSpectrum: loadStoredSmoothSpectrum(),
    timeline: loadStoredTimeline(),
    builderStack: initialBuilderStack,
    post: loadStoredPost(),
    motion: loadStoredMotion(),

    // --- session ---
    activeParams: resolveParams(initialPresetId, initialParams),
    activeMods: initialMods[initialPresetId] ?? [],
    sync: initialSync[initialPresetId] ?? { ...DEFAULT_SYNC },
    playback: {
      playing: false,
      time: 0,
      duration: 0,
      trackName: null,
      loop: false,
      loopStart: null,
      loopEnd: null,
    },
    analysisSampleRate: 48000,
    volume: loadStoredVolume(),
    muted: false,
    seeking: false,
    rendererKind: "…",
    simplifiedRenderer: false,
    rendererWarning: null,
    simplifiedNoticeDismissed: false,
    chromeIdle: false,
    stageMode: false,
    blackout: false,
    dragOver: false,
    showPanel: loadStoredPanelOpen(),
    showHelp: false,
    showGuide: false,
    showSettings: false,
    showExport: false,
    error: null,
    notice: null,
    recoveredNotice: false,
    supersededNotice: null,
    bootVeilVisible: isTauri(),
    userPresets: loadUserPresets(),
    galleryStatus: "idle" as const,
    galleryError: null,
    galleryEntries: [],
    galleryPreviews: {},
    galleryBusy: null,
    galleryInstalled: {},
    galleryApplied: null,
    galleryOpenFilter: "all" as const,
    showGallery: false,
    trackMeta: { title: "", artist: "" },
    coverArt: null,
    coverPalette: null,
    lufs: null,
    stereoWidth: 0,
    beatGrid: null,
    trackKey: null,
    sections: [],
    waveformOverview: null,
    showTimeline: getPrefs().timelineOpen,
    analyzing: false,
    undoDepth: 0,
    redoDepth: 0,
    docEpoch: 0,
    exportSettings: (() => {
      const stored = loadStoredExportSettings();
      // Sidecar/PNG formats need the desktop; a persisted one loading in the
      // browser dev build would render a dead Export dialog.
      if (!isTauri() && stored.format && stored.format !== "mp4") delete stored.format;
      return {
        codec: "h264" as const,
        fps: 60,
        autoRate: true,
        manualMbps: 12,
        mode: "video" as const,
        canvasStart: 0,
        canvasDuration: 6,
        format: "mp4" as const,
        loudnessTarget: null,
        truePeakDb: -1,
        ...stored,
        // The aspect persists across launches; the resolution must match it or
        // the export select renders blank and exports the wrong shape.
        resIdx: reconciledResIdx(loadStoredAspect(), stored.resIdx ?? 1),
      };
    })(),
    batch: null,
    batchStatus: "idle" as const,
    batchError: null,
    batchScanning: 0,
    codecSupport: null,
    showLibrary: false,
    library: null,
    libraryScanning: false,
    libraryActivePath: null,
    libraryAutoAdvance: true,
    switchQuantize: loadStoredQuantize(),
    pendingPresetId: null,
    midiEnabled: false,
    midiDevices: [],
    midiBindings: loadStoredMidiBindings(),
    midiLearn: null,
    liveInputActive: false,
    presetThumbs: null,
    presetOrder: reconcilePresetOrder(getPrefs().presetOrder),
    stems: [],
    stemAnalyzing: null,
    lyrics: null,
    lyricFileName: null,
    lyricsGen: IDLE_LYRICS_GEN,
    lyricsEditUndoDepth: 0,
    lyricsEditRedoDepth: 0,
    lyricsRealign: null,
    lyricStyle: loadStoredLyricStyle(),
    audiogram: loadStoredAudiogram(),
    videoBgLoading: false,
    customDefs: initialCustomDefs,
    showShaderEditor: false,
    showShadertoyImport: false,
    shadertoyImportEditId: null,
    showBatch: false,
    exporting: null,
    exportPreparing: false,
    exportError: null,
    exportDone: null,
    exportDonePath: null,
    performOpen: false,
    performMonitors: [],
    showPerform: false,

    // --- actions ---
    // Per-domain action groups (behavior-identical to the inline versions they
    // replaced); see src/state/slices/. The playback/track-loading/preset/init
    // core and the document core (applyDocument) stay below.
    ...exportActions(set, get, ctx),
    ...batchActions(set, get, ctx),
    ...builderActions(set, get, ctx),
    ...libraryActions(set, get, ctx),
    ...customShaderActions(set, get, ctx),
    ...lyricsAudiogramActions(set, get, ctx),
    ...lyricsEditActions(set, get, ctx),
    ...lyricsGenActions(set, get, ctx),
    ...overlayActions(set, get, ctx),
    ...stemsModsActions(set, get, ctx),
    ...midiActions(set, get, ctx),
    ...projectIOActions(set, get, ctx),
    ...galleryActions(set, get, ctx),
    ...performActions(set, get, ctx),

    initApp(canvas) {
      liveCanvas = canvas;
      const dispose = initServices(canvas, {
        getPreset: () => presetById(get().presetId),
        getFrameInput: () => {
          const s = get();
          return {
            timeline: s.timeline,
            basePresetId: s.presetId,
            baseParams: s.activeParams,
            baseMods: s.activeMods,
            // Effective bg (BG1): the render loop re-applies rf.bg every
            // frame, so handing it the GLOBAL bg here silently overwrote the
            // per-mode override within ~16ms of every correct apply — the
            // override rendered in exports but was invisible live. Resolve
            // for the BASE mode with the SAME function buildExportOptions
            // calls (that shared definition is what stops the two drifting
            // again); a timeline scene's own bg still wins inside
            // frameResolve.
            baseBg: selectEffectiveBg(s),
            paramsByPreset: s.paramsByPreset,
            modsByPreset: s.modsByPreset,
          };
        },
        getBackground: () => effBg(), // BG1: paused/initial bind must match the loop
        getPost: () => get().post,
        getSync: () => get().sync,
        isSeeking: () => get().seeking,
        onPlayback: (playback) => set({ playback }),
        onAnalysisSampleRate: (analysisSampleRate) => set({ analysisSampleRate }),
        onRendererChanged: (kind, warning) => {
          const simplified = kind === "canvas2d";
          // A degraded renderer (Canvas2D fallback) is WORKING, not failed, so
          // it is neither the persistent red error toast (which used to sit
          // over the whole session incl. Stage) nor — as of F1 — a notice that
          // auto-cleared after 4 seconds while the UI went on offering 16 mode
          // chips, post-processing, Motion, Builder and Export that the
          // fallback silently discards. It gets its own channel: a persistent,
          // dismissible banner plus disabled controls that say why.
          set({
            rendererKind: kind,
            simplifiedRenderer: simplified,
            rendererWarning: warning,
            // A hardware renderer coming back (device-loss rebuild) re-arms
            // the banner, so a second fallback later is announced again.
            ...(simplified ? null : { simplifiedNoticeDismissed: false }),
          });
          getRenderer()?.setSmoothSpectrum(get().smoothSpectrum);
          getRenderer()?.setPost(get().post);
          getRenderer()?.setMotion(get().motion);
          // Builder: a fresh renderer's layer-param buffer is zeroed —
          // every layer would render at opacity 0 until the first stack edit.
          rebuildBuilder2(get().builderStack);
          getRenderer()?.setBuilderParams(packBuilderParams(get().builderStack));
          applyCoverArt(); // new renderer starts without a cover bound
          invalidateBgCaches(); // a fresh renderer holds no bitmap/frames
          applyBgImage(); // ...and without a background image
          applyVideoBg(); // ...and without video frames (re-decode for it)
          get().refreshOverlay(); // new renderer starts without an overlay bound
          resetLyricPlate(); // ...and without a lyric plate (next tick recomposes)
        },
        onResize: () => get().refreshOverlay(),
        onMeter: (lufs, stereoWidth) => set({ lufs, stereoWidth }),
        getStemValues: (t) => stemValuesAt(get().stems, t),
        onFrameTick: (t) => {
          const s = get();
          // Beat-quantized takeover: fire the queued switch the moment the track
          // crosses the chosen boundary. Live-only — export never runs this loop.
          if (s.pendingPresetId && s.beatGrid) {
            if (crossedBoundary(s.beatGrid.beatTimes, lastQuantizeTick, t, s.switchQuantize)) {
              const target = s.pendingPresetId;
              set({ pendingPresetId: null });
              get().switchPreset(target);
            }
          }
          lastQuantizeTick = t;
          // Video background: upload the frame for THIS track time (pure index
          // → deterministic, matches the export). A GPU renderer only.
          if (videoBgFrames && selectEffectiveBg(s).mode === BG_VIDEO) {
            const r = getRenderer();
            if (r instanceof WebGPURenderer) {
              const i = videoBgFrameIndex(videoBgFrames.frames.length, videoBgFrames.fps, t);
              r.updateBackgroundVideoFrame(videoBgFrames.frames[i]);
            }
          }
          // Lyric plate (Lyric Stage's text input): recompose when ITS key
          // moves — the same pure key + compose pair the export core calls
          // with the job's clip time. Runs whenever timed lyrics exist, not
          // only while the mode is active, so a timeline scene (or a beat-
          // quantized switch) lands on Lyric Stage with the words already on
          // stage; the raster is a handful of text draws on line changes and
          // 1/32 fill steps, the caption compositor's own cadence.
          if (s.lyrics && liveCanvas) {
            const lines = s.lyrics;
            const plateKey = lyricPlateKeyAt(lines, t, liveCanvas.width, liveCanvas.height);
            if (!samePlateKey(plateKey, lastPlateKey)) {
              lastPlateKey = plateKey;
              const token = ++plateToken;
              void composeLyricPlate(lines, plateKey)
                .then((bmp) => {
                  if (token === plateToken) getRenderer()?.setLyricPlate(bmp);
                  else bmp.close();
                })
                .catch(() => undefined);
            }
          }
          const dyn = overlayDynamics(s);
          if (!hasDynamics(dyn)) return;
          const canvas = liveCanvas;
          if (!canvas) return;
          const key = overlayFrameKeyAt(dyn, t, canvas.width);
          if (sameOverlayFrame(key, shared.lastFrameKey)) return;
          shared.lastFrameKey = key;
          // Token pair: superseded composes AND full overlay re-rasters both
          // invalidate this frame's composition.
          const token = ++overlayComposeToken;
          const oTok = overlayToken;
          void composeOverlayFrame(overlayBase, dyn, t, canvas.width, canvas.height)
            .then((bmp) => {
              if (token === overlayComposeToken && oTok === overlayToken) {
                getRenderer()?.setOverlay(bmp);
              } else {
                bmp.close();
              }
            })
            .catch(() => undefined);
        },
      });
      getEngine().setVolume(get().muted ? 0 : get().volume);
      // Library auto-advance: when a library track finishes naturally, play
      // the next one (the action checks the toggle + current-track membership).
      getEngine().onEnded = () => void get().advanceLibrary();
      get().pokeChrome();

      // Whole-lane-review fix C1: an OS-level quit (or the window's own
      // close button) must not lose whatever hasn't reached the trailing
      // debounce yet. `preventDefault()` holds the window open until the
      // flush settles, then this destroys it itself — the window never
      // stays open longer than the flush takes, and a failed flush still
      // lets the user out rather than hanging the app closed.
      // `closeRequestedDisposed`/`unlistenCloseRequested`: the async
      // `onCloseRequested()` install can resolve AFTER this effect has
      // already torn down (a fast remount, StrictMode's double-invoke) —
      // the disposed flag makes that late arrival unlisten itself instead
      // of leaking a listener bound to a torn-down closure.
      let closeRequestedDisposed = false;
      let unlistenCloseRequested: (() => void) | null = null;
      /** FEAT-009: perform-window lifecycle listeners (same late-arrival
       * discipline as the close handler below). */
      let performListenersDisposed = false;
      let unlistenPerform: (() => void)[] = [];
      if (isTauri()) {
        void (async () => {
          const { listen } = await import("@tauri-apps/api/event");
          const unOpened = await listen("perform:opened", () => {
            set({ performOpen: true });
          });
          const unClosed = await listen("perform:closed", () => {
            set({ performOpen: false });
            // destroy() can skip the page's own pagehide "bye" — make the
            // publisher stop regardless.
            notePerformWindowClosed();
          });
          if (performListenersDisposed) {
            unOpened();
            unClosed();
          } else {
            unlistenPerform = [unOpened, unClosed];
          }
          // A dev-server reload of THIS window can leave the performance
          // window alive and the fresh store ignorant of it — ask the Rust
          // owner (the publisher's `hi` handshake re-arms the mirror side).
          const { invoke } = await import("@tauri-apps/api/core");
          const open = await invoke<boolean>("perform_is_open");
          if (open) set({ performOpen: true });
        })().catch((e) => console.warn("[perform] lifecycle listeners failed", e));
      }
      if (isTauri()) {
        void (async () => {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const appWindow = getCurrentWindow();
          const un = await appWindow.onCloseRequested(async (event) => {
            event.preventDefault();
            // R2-09: a running export or batch is mid-write — the stream
            // lane has a `.partial` staged, a sidecar session has the
            // output file open. lib.rs's Destroyed hook would kill the
            // sidecar eventually, but silently discarding an hour of
            // rendering on a stray Alt+F4 is not a decision to make FOR
            // the user — ask first. On "keep rendering", preventDefault()
            // above has already held the window open, so returning is the
            // whole answer. On a confirmed close, cancel both lanes and
            // give the teardown a bounded moment: `exporting`/
            // `exportPreparing`/`batchStatus` clear only AFTER the abort
            // path's discard has run (exportVideo awaits writer.discard()
            // and runExport awaits proresAbort() before their finallys),
            // so polling them out IS "the partial file is gone".
            const busy = () =>
              !!get().exporting || get().exportPreparing || get().batchStatus === "running";
            if (busy()) {
              // .catch(() => true): the ACL-throw precedent is real
              // (ShaderEditor.tsx records askConfirm throwing in an
              // installed build), and an unclosable window would be the
              // worse failure — same judgment as the flush race below.
              const closeAnyway = await askConfirm(
                "An export is running — close anyway? The partial file will be removed.",
                "Export running",
              ).catch(() => true);
              if (!closeAnyway) return;
              get().cancelExport();
              get().cancelBatch();
              const teardownDeadline = Date.now() + EXPORT_TEARDOWN_TIMEOUT_MS;
              while (busy() && Date.now() < teardownDeadline) {
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
            }
            // Whole-lane-review round 2, item 2: race the flush against
            // CLOSE_FLUSH_TIMEOUT_MS rather than awaiting it unconditionally
            // — see that const's own comment. Deliberately NOT importing
            // src/ui/asyncTimeout.ts's raceTimeout for this: that file lives
            // in ui/, and no file under src/state/ imports from ui/ anywhere
            // in this codebase (state is what ui depends ON, never the
            // reverse). The shape needed here is smaller besides — no
            // AbortSignal to thread through, since flushAutosave's
            // underlying fs calls have no cancellation path to abort into
            // either (the same limit that file's own doc comment records
            // for ITS callers).
            let timedOut = false;
            const timeoutPromise = new Promise<void>((resolve) => {
              setTimeout(() => {
                timedOut = true;
                resolve();
              }, CLOSE_FLUSH_TIMEOUT_MS);
            });
            try {
              await Promise.race([get().flushAutosave(), timeoutPromise]);
              if (timedOut) {
                console.warn(
                  "[autosave] close-flush did not finish in time — closing with the last completed write",
                );
              }
            } catch (e) {
              console.error("[autosave] close-flush failed", e);
            } finally {
              await appWindow.destroy();
            }
          });
          if (closeRequestedDisposed) un();
          else unlistenCloseRequested = un;
        })().catch((e) => console.warn("[autosave] could not install the close handler", e));
      }

      return () => {
        clearTimeout(idleTimer);
        clearTimeout(overlayTimer);
        liveCanvas = null;
        dispose();
        closeRequestedDisposed = true;
        unlistenCloseRequested?.();
        performListenersDisposed = true;
        for (const un of unlistenPerform) un();
        unlistenPerform = [];
        // The rest of teardown: services.dispose() above only owns the
        // engine/analyzer/renderer/loop. Everything the STORE itself
        // retained outside React state was left dangling here — a stale
        // ImageBitmap, up to 240 decoded video-bg frames (~220 MB), a live
        // MIDI listener, an autosave timer pair that fires after teardown
        // and writes to disk, and a prefetched AudioBuffer for the session.
        clearTimeout(autosaveTimer);
        clearTimeout(autosaveMaxTimer);
        overlayBase?.close();
        overlayBase = null;
        disposeVideoBgFrames(videoBgFrames);
        videoBgFrames = null;
        shared.midiHandle?.stop();
        shared.midiHandle = null;
        shared.libraryPrefetch = null;
      };
    },

    switchPreset(id) {
      record("preset");
      const next = presetById(id);
      const state = get();
      const activeParams = resolveParams(next.id, state.paramsByPreset);
      const sync = state.syncByPreset[next.id] ?? { ...DEFAULT_SYNC };
      const activeMods = state.modsByPreset[next.id] ?? [];
      // Any concrete switch supersedes a queued one.
      set({
        presetId: next.id,
        activeParams,
        activeMods,
        sync,
        ...(state.pendingPresetId ? { pendingPresetId: null } : {}),
      });
      saveStoredPresetId(next.id);
      getRenderer()?.setPreset(next);
      getAnalyzer().setSync(sync);
      // Per-mode surfaces: the new mode may carry its own background override
      // and its own center image — swap both with the preset.
      getRenderer()?.setBackground(effBg());
      applyBgImage();
      applyVideoBg();
      applyCoverArt();
    },

    stepPreset(delta) {
      // Walks the STRIP's order, not the registry's: N/P and the ◀▶ buttons
      // are "the next chip along", and stepping in a different sequence from
      // the one on screen is the kind of thing you only notice on stage.
      const all = orderedPresets(get().presetOrder, get().customDefs);
      const i = all.findIndex((p) => p.id === get().presetId);
      // Through queuePreset, not switchPreset: [ and ] are live-performance
      // controls exactly like the number keys, and it was inconsistent for
      // 1-9 to honour beat-quantize while the step keys jumped instantly.
      get().queuePreset(all[(i + delta + all.length) % all.length].id);
    },

    setPresetOrder(ids) {
      const presetOrder = reconcilePresetOrder(ids);
      set({ presetOrder });
      // Stored as given (already reconciled) rather than as a diff from the
      // default: a plain id list is what survives an app update readably.
      setPrefs({ presetOrder });
    },

    resetPresetOrder() {
      set({ presetOrder: defaultPresetOrder() });
      // Empty, not the resolved list — "never customised" must keep meaning
      // "follow whatever order the app ships", including after a later update.
      setPrefs({ presetOrder: [] });
    },

    queuePreset(id) {
      const s = get();
      // Targeting the current mode cancels any pending queue and does nothing.
      if (id === s.presetId) {
        if (s.pendingPresetId) set({ pendingPresetId: null });
        return;
      }
      // Re-queuing the already-pending target cancels it (toggle off).
      if (id === s.pendingPresetId) {
        set({ pendingPresetId: null });
        return;
      }
      const grid = s.beatGrid;
      // Instant when quantize is off, playback is stopped, or there is no future
      // boundary to land on (unanalyzed track, or past the last beat) — queuing
      // then would hang forever.
      if (
        s.switchQuantize === "off" ||
        !s.playback.playing ||
        !grid ||
        !hasFutureBoundary(grid.beatTimes, getEngine().currentTime, s.switchQuantize)
      ) {
        if (s.pendingPresetId) set({ pendingPresetId: null });
        get().switchPreset(id);
        return;
      }
      set({ pendingPresetId: id });
    },

    setSwitchQuantize(mode) {
      set({ switchQuantize: mode, pendingPresetId: null });
      saveStoredQuantize(mode);
    },

    setParam(key, value) {
      // E2(b): `value` is typed `number` but that's compile-time only — a
      // hostile/malformed caller (this action is public store surface, not
      // an internal-only helper) can still hand a non-finite one, and
      // nothing downstream of this action clamps it: `activeParams` IS the
      // live render params (CLAUDE.md's audio->render contract), read
      // directly by the renderer. Same guard `validParamsByPreset` already
      // applies on LOAD; this is the equivalent for the live-edit path,
      // which had none. Silently ignored, not corrected to a fallback, and
      // returned BEFORE record() — same "a rejected call costs nothing,
      // doesn't reach the undo stack" precedent stemsModsActions.ts's
      // addModRoute/reorderModRoutes already establish for their own
      // guards.
      if (!Number.isFinite(value)) return;
      // Builder bridge (RP-20): while Builder is active, a virtual l<i>.* key
      // routes through the STACK — the persisted truth — and takes the normal
      // setBuilderStack path (history, persistence, mirror, pack, upload).
      // MIDI CC applies land here too, so they ride for free. A virtual key
      // that no longer resolves (stale binding after a structural edit) is
      // inert rather than a junk mirror entry.
      if (get().presetId === BUILDER2_ID && isBuilderVirtualKey(key)) {
        const routed = applyVirtualValues(get().builderStack, { [key]: value });
        if (routed.applied > 0) get().setBuilderStack(routed.stack);
        return;
      }
      record(`param:${key}`);
      const state = get();
      const activeParams = { ...state.activeParams, [key]: value };
      const paramsByPreset = { ...state.paramsByPreset, [state.presetId]: activeParams };
      set({ activeParams, paramsByPreset });
      saveStoredParams(paramsByPreset);
      // Turning "match cover colors" on applies the palette right away
      // (its own history entry — undo restores the previous colors first).
      if (key === "coverHue" && value > 0.5) maybeApplyCoverPalette(true);
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
      // Builder bridge (RP-20): "reset" for Builder means the stack itself —
      // back to the classic default layers. The mirror, history entry,
      // persistence and GPU upload all follow via setBuilderStack.
      if (get().presetId === BUILDER2_ID) {
        get().setBuilderStack(defaultBuilderStack());
        return;
      }
      record("reset");
      const state = get();
      const paramsByPreset = { ...state.paramsByPreset };
      delete paramsByPreset[state.presetId];
      set({ activeParams: defaultParams(presetById(state.presetId)), paramsByPreset });
      saveStoredParams(paramsByPreset);
    },

    setBg(bg) {
      // A background MODE switch (Preset/Solid/Transparent) is a discrete action
      // that must undo on its own; a colour/dim/blur drag routed through setBg is
      // a gesture that should collapse into one entry. "bg-mode" is in history's
      // UNGROUPABLE set and "bg" is not, so key by whether the mode changed —
      // without this, toggling mode right after a colour drag folds both into a
      // single undo.
      record(effBg().mode !== bg.mode ? "bg-mode" : "bg");
      commitBg(bg);
    },

    setBgPerMode(on) {
      const s = get();
      const has = selectBgPerMode(s);
      if (on === has) return;
      record("bg-mode");
      const bgByPreset = { ...s.bgByPreset };
      if (on) {
        // Start the override from what's on screen right now — flipping the
        // switch alone must not change a single pixel.
        bgByPreset[s.presetId] = structuredClone(selectEffectiveBg(s));
      } else {
        delete bgByPreset[s.presetId];
      }
      set({ bgByPreset });
      // Orphan-GC the dropped override's image/video asset (audit BG2): a
      // per-mode VIDEO background is a tens-of-MB data URL — without this,
      // toggling the override off left it riding in state, autosave and
      // .bfproj forever. After the set() so assetInUse sees the final refs.
      if (!on) {
        const removed = s.bgByPreset[s.presetId];
        for (const id of [removed?.image?.assetId, removed?.video?.assetId]) {
          if (id && !assetInUse(id)) {
            const pruned = { ...get().assets };
            delete pruned[id];
            set({ assets: pruned });
          }
        }
        saveStoredOverlay(get().overlayLayers, get().assets);
      }
      saveStoredBgByPreset(bgByPreset);
      getRenderer()?.setBackground(effBg());
      applyBgImage();
      applyVideoBg();
    },

    async pickCenterImage() {
      let img: { name: string; dataUrl: string } | null;
      try {
        img = await openImageFile();
      } catch (e) {
        set({ error: `Could not open image: ${(e as Error).message}` });
        return;
      }
      if (!img) return;
      record("center-image");
      const asset: OverlayAsset = {
        id: `as-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: img.name,
        dataUrl: img.dataUrl,
      };
      const s = get();
      const assets = { ...s.assets, [asset.id]: asset };
      const centerImageByPreset = { ...s.centerImageByPreset, [s.presetId]: asset.id };
      const prevId = s.centerImageByPreset[s.presetId];
      set({ assets, centerImageByPreset });
      // Orphan-GC the replaced center image unless something else holds it.
      if (prevId && !assetInUse(prevId)) {
        const pruned = { ...get().assets };
        delete pruned[prevId];
        set({ assets: pruned });
      }
      if (saveStoredOverlay(get().overlayLayers, get().assets)) {
        saveStoredCenterImages(centerImageByPreset);
      } else {
        flashNotice("Image too large to remember — center image is session-only");
      }
      applyCoverArt(); // rebind the cover texture to the new source
    },

    clearCenterImage() {
      const s = get();
      const prevId = s.centerImageByPreset[s.presetId];
      if (!prevId) return;
      record("center-image");
      const centerImageByPreset = { ...s.centerImageByPreset };
      delete centerImageByPreset[s.presetId];
      set({ centerImageByPreset });
      if (!assetInUse(prevId)) {
        const pruned = { ...get().assets };
        delete pruned[prevId];
        set({ assets: pruned });
        saveStoredOverlay(get().overlayLayers, get().assets);
      }
      saveStoredCenterImages(centerImageByPreset);
      applyCoverArt(); // back to the track's cover art
    },

    async pickBackgroundImage() {
      let img: { name: string; dataUrl: string } | null;
      try {
        img = await openImageFile();
      } catch (e) {
        set({ error: `Could not open image: ${(e as Error).message}` });
        return;
      }
      if (!img) return;
      record("bg-mode"); // picking an image always switches mode -> discrete undo
      const asset: OverlayAsset = {
        id: `as-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: img.name,
        dataUrl: img.dataUrl,
      };
      const assets = { ...get().assets, [asset.id]: asset };
      const prev = effBg();
      // Replacing the image orphans the old asset — a multi-MB data URL that
      // would otherwise ride along in state, autosave, .bfproj and storage
      // forever. Drop it unless an overlay layer still uses it.
      // Both sub-objects, not just the image: switching video -> image left the
      // (tens-of-MB) video asset orphaned in state, autosave, .bfproj and
      // localStorage forever — exactly what this GC exists to prevent.
      const bg: BgSettings = {
        ...prev,
        mode: BG_IMAGE,
        // Spread first so the framing (fit/zoom/pan) survives a swap, exactly
        // like dim/blur below: reframing is per-slot work, and losing it every
        // time you try a different picture makes the fit controls unusable.
        image: {
          ...prev.image,
          assetId: asset.id,
          dim: prev.image?.dim ?? 0.25,
          blur: prev.image?.blur ?? 0,
        },
      };
      set({ assets });
      commitBg(bg);
      // Orphan-GC AFTER the new bg is committed, so assetInUse sees the final
      // reference set (old asset may still be used by an overlay, another
      // mode's bg override, or a center image).
      for (const prevId of [prev.image?.assetId, prev.video?.assetId]) {
        if (prevId && prevId !== asset.id && !assetInUse(prevId)) {
          const pruned = { ...get().assets };
          delete pruned[prevId];
          set({ assets: pruned });
        }
      }
      // Persist the bg REFERENCE only if the asset itself persisted — a saved
      // mode-3 bg pointing at an asset that hit the quota boots into black.
      if (!saveStoredOverlay(get().overlayLayers, get().assets)) {
        flashNotice("Image too large to remember — background is session-only");
      }
    },

    async pickVideoBackground() {
      if (!isTauri()) {
        set({ error: "Video backgrounds need the desktop app" });
        return;
      }
      let vid: { name: string; dataUrl: string } | null;
      try {
        vid = await openVideoFile();
      } catch (e) {
        set({ error: `Could not open video: ${(e as Error).message}` });
        return;
      }
      if (!vid) return;
      record("bg-mode"); // picking a video always switches mode -> discrete undo
      const asset: OverlayAsset = {
        id: `as-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: vid.name,
        dataUrl: vid.dataUrl,
      };
      const assets = { ...get().assets, [asset.id]: asset };
      const prev = effBg();
      // Orphan-GC BOTH the previous image and video asset, not just one: with an
      // image bg and a video bg both set, `video ?? image` freed only one and the
      // other (tens of MB) leaked in state, autosave, .bfproj and localStorage
      // forever — matching pickBackgroundImage / useAlbumArtBackground.
      const bg: BgSettings = {
        ...prev,
        mode: BG_VIDEO,
        // Framing carries across a clip swap — see pickBackgroundImage.
        video: { ...prev.video, assetId: asset.id, dim: prev.video?.dim ?? 0.35, blur: 0 },
      };
      set({ assets });
      commitBg(bg);
      for (const prevId of [prev.image?.assetId, prev.video?.assetId]) {
        if (prevId && prevId !== asset.id && !assetInUse(prevId)) {
          const pruned = { ...get().assets };
          delete pruned[prevId];
          set({ assets: pruned });
        }
      }
      // A video's data URL is large; keep it session-only if it won't persist
      // (localStorage), but the project-file / autosave path still embeds it.
      if (!saveStoredOverlay(get().overlayLayers, get().assets)) {
        flashNotice("Video kept for this session — save a project to keep it");
      }
    },

    useAlbumArtBackground() {
      const cover = get().coverArt;
      if (!cover) {
        set({ error: "The loaded track has no embedded cover art" });
        return;
      }
      record("bg-mode"); // switching to album-art bg is a mode change -> discrete undo
      const asset: OverlayAsset = {
        id: `as-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: "Album art",
        dataUrl: cover,
      };
      const assets = { ...get().assets, [asset.id]: asset };
      const prev = effBg();
      const bg: BgSettings = {
        ...prev,
        mode: BG_IMAGE,
        // Album art behind a visualizer usually wants softening by default
        image: {
          ...prev.image,
          assetId: asset.id,
          dim: prev.image?.dim ?? 0.35,
          blur: prev.image?.blur ?? 18,
        },
      };
      set({ assets });
      commitBg(bg);
      // Same orphan-GC as pickBackgroundImage — after commit, via assetInUse.
      for (const prevId of [prev.image?.assetId, prev.video?.assetId]) {
        if (prevId && prevId !== asset.id && !assetInUse(prevId)) {
          const pruned = { ...get().assets };
          delete pruned[prevId];
          set({ assets: pruned });
        }
      }
      if (!saveStoredOverlay(get().overlayLayers, get().assets)) {
        flashNotice("Cover too large to remember — background is session-only");
      }
    },

    setSmoothSpectrum(v) {
      record("smooth");
      set({ smoothSpectrum: v });
      saveStoredSmoothSpectrum(v);
      getRenderer()?.setSmoothSpectrum(v);
    },

    setBuilderStack(stack) {
      record("builder2");
      const builderStack = stack;
      const def = rebuildBuilder2(builderStack);
      // Mirror (RP-20): every stack change rewrites the virtual-param record
      // (l<i>.* -> value) so frameResolve's baseOf(), mod routes, automation,
      // MIDI labels and saved looks all read the CURRENT stack values. The
      // stack stays the only persisted truth — the mirror is derived state
      // that happens to ride paramsByPreset, and is regenerated from the
      // stack on every load.
      const mirror = builderStackValues(builderStack);
      const paramsByPreset = { ...get().paramsByPreset, [BUILDER2_ID]: mirror };
      const active = get().presetId === BUILDER2_ID;
      set({ builderStack, paramsByPreset, ...(active ? { activeParams: mirror } : {}) });
      saveStoredBuilderStack(builderStack);
      saveStoredParams(paramsByPreset);
      getRenderer()?.setBuilderParams(packBuilderParams(builderStack));
      // Structural edits produce a NEW def object; installing it recompiles
      // (cached by structure). Value-only edits keep the object, so this is
      // a no-op for the pipeline and the buffer write above does the work.
      if (active) getRenderer()?.setPreset(def);
    },

    setTimeline(timeline, historyKey) {
      record(historyKey ?? "timeline");
      // E2(b): `scenes`/`lanes` normalized to real arrays BEFORE anything
      // stores or reads them — deriveTimelineEnabled's own Array.isArray
      // guard (see its comment) stops IT from throwing on a malformed
      // caller, but a `{ ...timeline, enabled: false }` built from one
      // still WROTE `scenes: undefined` into the document if that guard
      // were the only fix: the very next action to call record() crashed
      // in referencedCustomDefs' `for (const scene of s.timeline.scenes)`
      // reading the now-corrupted store state, nowhere near this action.
      // No-op for every real caller (TimelinePanel always hands real
      // arrays); only changes behavior for a malformed one.
      const safeTimeline: Timeline = {
        enabled: timeline.enabled,
        scenes: Array.isArray(timeline.scenes) ? timeline.scenes : [],
        lanes: Array.isArray(timeline.lanes) ? timeline.lanes : [],
      };
      // P-5: `enabled` is DERIVED here, not taken from the caller — the
      // toolbar's manual toggle is gone, so this is the one place (with
      // autoArrangeTimeline below) that decides on/off from content, for
      // every scene/lane/keyframe edit TimelinePanel makes. Load (validTimeline)
      // deliberately does NOT use this — see deriveTimelineEnabled's doc comment.
      const next = { ...safeTimeline, enabled: deriveTimelineEnabled(safeTimeline) };
      set({ timeline: next });
      saveStoredTimeline(next);
    },

    autoArrangeTimeline() {
      const s = get();
      const buf = getEngine().audioBuffer;
      if (!buf) {
        set({ error: "Load a track first — auto-arrange reads its detected sections" });
        return;
      }
      if (s.sections.length === 0 || !s.waveformOverview) {
        flashNotice(
          s.analyzing
            ? "Still analyzing the track — try again in a moment"
            : "No sections detected in this track",
        );
        return;
      }
      record("timeline");
      const scenes = autoArrangeScenes(
        s.sections,
        buf.duration,
        overviewEnergy(s.waveformOverview, buf.duration),
      );
      const arranged = { ...s.timeline, scenes };
      const timeline = { ...arranged, enabled: deriveTimelineEnabled(arranged) };
      set({ timeline, showTimeline: true });
      saveStoredTimeline(timeline);
      flashNotice(`Arranged ${scenes.length} scenes from the song's sections — one Ctrl+Z undoes`);
    },

    setShowTimeline(v) {
      set({ showTimeline: v });
      setPrefs({ timelineOpen: v });
    },

    setPost(patch) {
      record("post");
      // E2(b): `patch` is `Partial<PostSettings>` at compile time only.
      // `validPost` is the SAME validator project/theme load already runs
      // full PostSettings through (it clamps to exactly the ranges
      // POST_MOD_TARGETS' sliders already enforce, so this is a no-op for
      // every real UI patch and only ever changes behavior for a hostile
      // one) — reused here rather than duplicated, so the live-edit path
      // holds `post` to the same contract the load path always has. Matters
      // because `post` feeds `getRenderer()?.setPost(post)` two lines down:
      // a non-finite value here is a GPU uniform, not just a stored field.
      const post = validPost({ ...get().post, ...patch });
      set({ post });
      saveStoredPost(post);
      getRenderer()?.setPost(post);
    },

    setMotion(patch) {
      record("motion");
      // E2(b): same reasoning as setPost just above — validMotion already
      // matches MOTION_MASTER_SPECS' slider ranges exactly, so this is a
      // no-op for every real caller and only guards the hostile case.
      const motion = validMotion({ ...get().motion, ...patch });
      set({ motion });
      saveStoredMotion(motion);
      getRenderer()?.setMotion(motion);
    },

    setAspect(aspect) {
      record("aspect");
      set({ aspect });
      saveStoredAspect(aspect);
      // Keep the export resolution consistent with the frame
      const resIdx = reconciledResIdx(aspect, get().exportSettings.resIdx);
      if (resIdx !== get().exportSettings.resIdx) {
        get().setExportSettings({ resIdx });
      }
      // Re-measure after the CSS class lands (don't wait for ResizeObserver;
      // it never fires in hidden tabs). The measure also refreshes overlays.
      setTimeout(remeasure, 50);
    },

    setSync(syncIn) {
      // Coerce here too, not just in the pipeline: imported presets/projects
      // route through this action, and the UI reads `sync` back for sliders.
      const sync = sanitizeSync(syncIn);
      record("sync");
      const state = get();
      const syncByPreset = { ...state.syncByPreset, [state.presetId]: sync };
      set({ sync, syncByPreset });
      saveStoredSync(syncByPreset);
      getAnalyzer().setSync(sync);
    },

    async loadFile(file) {
      // Loading a track leaves live mode (and stops the Rust-side capture —
      // the engine alone cannot, so this MUST route through the toggle).
      if (get().liveInputActive) await get().toggleLiveInput();
      // Guard BOTH ends: decode + tag scan take seconds, and a second drop in
      // that window used to let whichever finished LAST own the metadata,
      // cover art and beat grid (baked into exports). Only the newest wins.
      const gen = ++shared.trackLoadGen;
      try {
        // A direct load (drop, file picker) leaves the library: clear the
        // active marker so auto-advance stops. playLibraryTrack re-sets it.
        set({ error: null, libraryActivePath: null });
        await getEngine().loadFile(file);
        if (gen !== shared.trackLoadGen) return;
        // E3c: the NEW audio is the engine's buffer as of the line above, and
        // it starts playing two lines below — so the beat grid, key, sections
        // and waveform overview still in the store are the PREVIOUS song's,
        // and an export fired here rendered that grid over this audio. Void
        // them HERE rather than at `analyzeCurrentTrack()` below, which is a
        // whole tag scan away: `analyzing` goes true with them, so E3b's gate
        // makes an export in this window WAIT for the real grid.
        invalidateAnalysis();
        // Different audio entirely: detector history, peak caps and the drive
        // envelope all describe the previous track and must not carry over.
        getAnalyzer().reset("source");
        await getEngine().play();
        // Tag metadata (title/artist/cover) — best effort, never blocks
        // playback, so no duration scan here. Shared with the batch queue.
        const { meta, coverArt } = await readTrackMeta(file, file.name);
        if (gen !== shared.trackLoadGen) return;
        // Stems are per-track: envelopes analyzed against the old track have
        // no time relationship to the new one, so carrying them over would
        // modulate the new track with the old track's rhythm.
        set({ trackMeta: meta, coverArt, stems: [], lyrics: null, lyricFileName: null });
        applyCoverArt();
        get().refreshOverlay();
        get().analyzeCurrentTrack();
      } catch (e) {
        if (gen !== shared.trackLoadGen) return;
        set({ error: `Could not decode "${file.name}" (${(e as Error).message})` });
      } finally {
        // Every exit between the invalidation above and the job that fills it:
        // an AudioContext that refuses to resume, a tag scan that throws, the
        // early return above. A no-op on the happy path (the job claimed the
        // invalidation) and on a decode that failed before any audio landed
        // (nothing to claim) — see settleUnclaimedAnalysis.
        //
        // Skipped when a NEWER load has claimed the generation: that load owns
        // the flag now. It either invalidated already (reusing this one — the
        // state is void either way) or will, and clearing here would open a
        // gap in which an export sees `analyzing: false` over null grids,
        // which is the bug E3b fixed.
        if (gen === shared.trackLoadGen) settleUnclaimedAnalysis();
      }
    },

    async loadDemo(id) {
      if (get().liveInputActive) await get().toggleLiveInput();
      const gen = ++shared.trackLoadGen;
      try {
        set({ error: null });
        const demo = demos.find((d) => d.id === id);
        if (!demo) return;
        const engine = getEngine();
        const buf = await demo.render(engine.ctx.sampleRate);
        if (gen !== shared.trackLoadGen) return;
        engine.loadBuffer(buf, `Demo: ${demo.name}`);
        // Same window, same reason as loadFile: new audio in the engine, the
        // previous track's grid still in the store (E3c).
        invalidateAnalysis();
        getAnalyzer().reset("source");
        await engine.play();
        set({
          trackMeta: { title: demo.name, artist: "" },
          coverArt: null,
          coverPalette: null,
          stems: [],
          lyrics: null,
          lyricFileName: null,
        });
        applyCoverArt();
        get().refreshOverlay();
        get().analyzeCurrentTrack();
      } catch (e) {
        if (gen !== shared.trackLoadGen) return;
        set({ error: `Demo failed: ${(e as Error).message}` });
      } finally {
        // Same contract as loadFile's: close a gate this load opened and no
        // job will close. Also covers the `!demo` early return above, which
        // exits before any audio is installed.
        if (gen === shared.trackLoadGen) settleUnclaimedAnalysis();
      }
    },

    async togglePlay() {
      // In live mode, "pause" means "stop listening to system audio".
      if (get().liveInputActive) {
        await get().toggleLiveInput();
        return;
      }
      const engine = getEngine();
      if (engine.playing) engine.pause();
      else await engine.play();
    },

    async toggleLiveInput() {
      if (liveToggling) return;
      liveToggling = true;
      try {
        const engine = getEngine();
        if (get().liveInputActive) {
          await stopLoopback().catch(() => undefined);
          engine.stopLiveInput();
          getAnalyzer().reset("source");
          set({ liveInputActive: false });
          return;
        }
        if (!isTauri()) {
          set({ error: "System-audio capture needs the desktop app" });
          return;
        }
        try {
          const push = await engine.startLiveInput();
          getAnalyzer().reset("source");
          const info = await startLoopback(push);
          if (info.sampleRate !== engine.ctx.sampleRate) {
            // Same default device on both ends makes this near-impossible, but
            // feeding mismatched rates would pitch-shift every feature.
            await stopLoopback().catch(() => undefined);
            engine.stopLiveInput();
            getAnalyzer().reset("source");
            set({
              error: `System audio runs at ${info.sampleRate} Hz, the visualizer at ${engine.ctx.sampleRate} Hz — match them in Windows Sound settings`,
            });
            return;
          }
          // The previous track's beat grid must not pulse over live audio;
          // presets fall back to onset pulses without one. Superseding
          // analysisId also cancels an IN-FLIGHT analysis — without that, a
          // grid computed for the dead track lands a few seconds into live
          // mode and pulses over unrelated audio.
          analysisId++;
          getAnalyzer().setBeatGrid(null);
          getAnalyzer().setSections(null);
          // Through settleAnalysis, not a bare `analyzing: false`: this is the
          // one place outside a load path that stops expecting a grid, and it
          // has to release the barrier and drop the unclaimed-invalidation
          // bookkeeping with it. A bare write would leave an invalidation
          // "unclaimed" forever, and the NEXT track load would then find one
          // and skip its own — reopening the E3c window it exists to close.
          settleAnalysis({
            liveInputActive: true,
            beatGrid: null,
            trackKey: null,
            sections: [],
            libraryActivePath: null,
            error: null,
          });
          flashNotice(`Listening to ${info.device}`);
        } catch (e) {
          // Clear the Rust side too: a half-started (or orphaned) capture
          // would wedge every future toggle on "already running".
          await stopLoopback().catch(() => undefined);
          engine.stopLiveInput();
          getAnalyzer().reset("source");
          set({ error: `System-audio capture failed: ${(e as Error).message}` });
        }
      } finally {
        liveToggling = false;
      }
    },

    loadPresetThumbnails() {
      if (get().presetThumbs) return;
      // Publishes PER BATCH, not once at the end. The eager slice — the ten
      // chips that fill the strip at its widest — lands the moment it exists
      // instead of waiting on the tail, and a device lost mid-run costs the
      // tail rather than everything. `order` is the user's own strip order,
      // so a reordered strip gets pictures on the modes THAT user sees first;
      // renderPresetThumbnails appends anything the order omits, so a stale
      // or hand-edited order can never cost a mode its thumbnail.
      //
      // WHEN to call this is the caller's problem, not the store's: it needs
      // a real WebGPU device to exist first, and that is a component-lifecycle
      // fact (see the scheduling comment in App.tsx).
      void renderPresetThumbnails({
        order: get().presetOrder,
        onBatch: (presetThumbs) => set({ presetThumbs }),
      });
    },

    seekStart() {
      set({ seeking: true });
    },

    seekEnd(time) {
      set({ seeking: false });
      getEngine().seek(time);
      // New position: the pipeline's previous spectrum describes a moment that
      // is no longer adjacent, and diffing across the jump fires a phantom
      // beat/kick/snare/hat on the next frame.
      getAnalyzer().reset("seek");
    },

    seekBy(delta) {
      const engine = getEngine();
      engine.seek(engine.currentTime + delta);
      getAnalyzer().reset("seek");
    },

    toggleLoop() {
      const engine = getEngine();
      engine.loop = !engine.loop;
    },

    setLoopStart(time) {
      const engine = getEngine();
      const before = engine.currentTime;
      engine.setLoopStart(time ?? before);
      if (Math.abs(engine.currentTime - before) > 0.001) getAnalyzer().reset("seek");
    },

    setLoopEnd(time) {
      const engine = getEngine();
      const before = engine.currentTime;
      engine.setLoopEnd(time ?? before);
      if (Math.abs(engine.currentTime - before) > 0.001) getAnalyzer().reset("seek");
    },

    clearLoopRegion() {
      const engine = getEngine();
      const before = engine.currentTime;
      engine.clearLoopRegion();
      if (Math.abs(engine.currentTime - before) > 0.001) getAnalyzer().reset("seek");
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

    setShowSettings(showSettings) {
      set({ showSettings });
    },

    setShowHelp(showHelp) {
      set({ showHelp });
    },

    setShowGuide(showGuide) {
      set({ showGuide });
    },

    clearError() {
      set({ error: null });
    },

    dismissSimplifiedNotice() {
      set({ simplifiedNoticeDismissed: true });
    },

    dismissRecoveredNotice() {
      set({ recoveredNotice: false });
    },

    dismissSupersededNotice() {
      set({ supersededNotice: null });
    },

    hideBootVeil() {
      set({ bootVeilVisible: false });
    },

    setStageMode(stageMode) {
      // Entering stage closes panels for a clean output; leaving clears blackout.
      //
      // The Visuals is NOT among them since P-1: stage mode suppresses the
      // dock by LAYOUT (`.app.stage-mode` zeroes --visuals-w, and
      // `.app.stage-mode .chrome { display: none }` already hid it), not by
      // closing it. The old `showPanel: false` was a raw destructive write
      // with no restore — it bypassed setShowPanel, so prefs kept the old
      // value and coming back from Stage left the dock shut. Every demo cost
      // the user their workspace.
      //
      // Do NOT "fix" that with setShowPanel(true) on exit either: that writes
      // panelOpen: true for users who never opened the dock. Layout
      // suppression is stateless, so there is nothing to restore.
      if (stageMode) set({ stageMode, showTimeline: false, showHelp: false });
      // Leaving stage clears blackout — UNLESS the performance window is
      // running (FEAT-009): blackout then belongs to the OUTPUT surface the
      // audience sees, and exiting the operator's local stage view must not
      // silently un-black the projector.
      else set({ stageMode, ...(get().performOpen ? {} : { blackout: false }) });
    },

    setBlackout(blackout) {
      set({ blackout });
    },

    setError(error) {
      set({ error });
    },

    applyDocument(doc, opts) {
      // Embedded custom defs merge into the session library (replace-by-id):
      // project open brings the visuals it references, and undo after
      // deleteCustomPreset restores the def alongside the document that
      // referenced it. Registration is idempotent.
      let customDefs = get().customDefs;
      if (doc.customDefs.length > 0) {
        // S1: never let a project's embedded (often older) copy silently
        // overwrite + persist over a local same-id shader that has since
        // been edited — the local version stays in the library AND the
        // registry, and the user is told. Identical/new defs import as
        // before, keeping registration idempotent for undo/redo.
        const { merged, register, kept } = mergeEmbeddedDefs(
          customDefs,
          doc.customDefs,
          opts?.fromHistory,
        );
        customDefs = merged;
        for (const def of register) registerCustomPreset(def);
        if (register.length > 0) saveCustomPresets(customDefs);
        if (kept.length > 0) {
          flashNotice(`Kept your newer ${kept.join(", ")} — this project embeds an older copy`);
        }
      }
      // Builder bridge (RP-20): regenerate the builder2 def for the incoming
      // stack BEFORE resolving the preset (presetById("builder2") reads the
      // current def) and rewrite the virtual mirror from the stack — the
      // stack always wins over whatever mirror the document carried.
      rebuildBuilder2(doc.builderStack);
      const paramsByPreset = {
        ...doc.paramsByPreset,
        [BUILDER2_ID]: builderStackValues(doc.builderStack),
      };
      const preset = presetById(doc.presetId);
      const activeParams = resolveParams(preset.id, paramsByPreset);
      const sync = sanitizeSync(doc.syncByPreset[preset.id] ?? { ...DEFAULT_SYNC });
      set({
        customDefs,
        lyricStyle: doc.lyricStyle,
        audiogram: doc.audiogram,
        builderStack: doc.builderStack,
        // Whole-lane-review fix I1: bumped on EVERY applyDocument call,
        // unconditionally — this is what lets bootDesktopDocument detect a
        // manual project open (or undo/redo/theme-apply/new-project) that
        // landed during its async autosave read, which undoDepth alone
        // cannot (open/newProject force undoDepth to 0, the same value a
        // fresh boot already has).
        docEpoch: get().docEpoch + 1,
        // Final review round, item 1: a standing recovery notice describes
        // the PREVIOUS document by definition — newProject()/openProject()/
        // openProjectText() all replace the document through this same
        // chokepoint (as do undo/redo/theme-apply/bootDesktopDocument
        // itself) without ever having cleared it, so recovering from a
        // crash and then starting fresh or opening something unrelated
        // left the "Recovered your work from the last session" toast
        // standing over a document it no longer describes. Cleared HERE
        // rather than in the three actions individually: one line instead
        // of three, and it correctly covers undo/redo/theme-apply too,
        // which are just as capable of making the notice stale. Order is
        // safe against bootDesktopDocument's own use of this function —
        // its `if (recovering) set({ recoveredNotice: true })` runs AFTER
        // this applyDocument call returns, so the true case is never
        // clobbered by its own boot.
        //
        // `error` has the same staleness gap by the same precedent (whole-
        // lane review found it too) and is deliberately NOT touched here:
        // unlike recoveredNotice, error carries many unrelated failure
        // messages (a save failure, a theme parse failure, ...) that are
        // not all "about the previous document" in the same tight sense,
        // there is no specific bug report driving it, and no existing
        // test pins whether callers rely on an error surviving an
        // unrelated undo/redo today — closing it blind risked a silent
        // behavior change this round did not ask for.
        recoveredNotice: false,
        // Keep the export resolution consistent with the incoming aspect
        // (covers project-open AND undo/redo of aspect changes).
        exportSettings: {
          ...get().exportSettings,
          resIdx: reconciledResIdx(doc.aspect, get().exportSettings.resIdx),
        },
        presetId: preset.id,
        paramsByPreset,
        syncByPreset: doc.syncByPreset,
        bg: doc.bg,
        bgByPreset: doc.bgByPreset,
        centerImageByPreset: doc.centerImageByPreset,
        overlayLayers: doc.overlayLayers,
        assets: doc.assets,
        aspect: doc.aspect,
        modsByPreset: doc.modsByPreset,
        smoothSpectrum: doc.smoothSpectrum,
        timeline: doc.timeline,
        post: doc.post,
        motion: doc.motion,
        activeParams,
        activeMods: doc.modsByPreset[preset.id] ?? [],
        sync,
      });
      saveStoredPresetId(preset.id);
      saveStoredParams(paramsByPreset);
      saveStoredSync(doc.syncByPreset);
      saveStoredBg(doc.bg);
      saveStoredBgByPreset(doc.bgByPreset);
      saveStoredCenterImages(doc.centerImageByPreset);
      saveStoredOverlay(doc.overlayLayers, doc.assets);
      saveStoredAspect(doc.aspect);
      saveStoredMods(doc.modsByPreset);
      saveStoredTimeline(doc.timeline);
      saveStoredSmoothSpectrum(doc.smoothSpectrum);
      getRenderer()?.setSmoothSpectrum(doc.smoothSpectrum);
      saveStoredPost(doc.post);
      getRenderer()?.setPost(doc.post);
      saveStoredMotion(doc.motion);
      getRenderer()?.setMotion(doc.motion);
      saveStoredLyricStyle(doc.lyricStyle);
      saveStoredAudiogram(doc.audiogram);
      saveStoredBuilderStack(doc.builderStack);
      // Builder: the def was already regenerated above (before param
      // resolution); re-upload the value block here. setPreset below picks up
      // the new def when builder2 is the active preset.
      getRenderer()?.setBuilderParams(packBuilderParams(doc.builderStack));
      // Lyric style / audiogram feed the frame-keyed dynamic overlay — force
      // a recompose so undo/open shows the incoming style immediately.
      shared.lastFrameKey = NULL_FRAME_KEY;
      pruneBitmapCache(new Set(Object.keys(doc.assets)));
      getRenderer()?.setPreset(preset);
      getRenderer()?.setBackground(effBg());
      applyBgImage();
      applyVideoBg(); // restore/clear a video background on open/theme/undo
      applyCoverArt(); // per-mode center image may differ in the incoming doc
      getAnalyzer().setSync(sync);
      get().refreshOverlay();
      // Covers undo/redo/project-open: without this the autosave file kept
      // the PRE-undo document until the next ordinary edit. Whole-lane-review
      // fix M2: SKIPPED when `alreadyOnDisk` — bootDesktopDocument's
      // successful-read path is applying bytes that are, by construction,
      // already sitting in the exact file scheduleAutosave would go on to
      // rewrite. Without this guard, EVERY desktop boot dirtied the
      // clean-exit marker and queued an identical rewrite before the user
      // touched anything, so a hard kill in that window falsely reported
      // "crashed last time" on the next launch even though nothing was ever
      // at risk and nothing had changed.
      if (!opts?.alreadyOnDisk) scheduleAutosave();
    },

    /** Whole-lane-review fix C1 — see this action's own VizState doc comment. */
    async flushAutosave() {
      if (!isTauri()) return;
      await runScheduledAutosaveWrite();
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
      const s = get();
      const preset = s.userPresets.find((p) => p.id === id);
      if (!preset) return; // nothing applied -> nothing recorded
      // One gesture: switchPreset + params + setSync used to push up to three
      // history entries, so one Ctrl+Z stepped through half-applied states.
      asOneGesture("look", () => {
        if (preset.presetId !== get().presetId) get().switchPreset(preset.presetId);
        if (preset.presetId === BUILDER2_ID) {
          // Builder looks captured the virtual mirror (l<i>.* values). Route
          // them back INTO the stack — the persisted truth — through the same
          // virtual-key path setParam/MIDI use; keys that don't resolve on
          // the current stack structure are dropped (a look carries values,
          // not structure). setBuilderStack rewrites the mirror from the
          // result, so activeParams follows.
          get().setBuilderStack(applyVirtualValues(get().builderStack, preset.params).stack);
        } else {
          const state = get();
          const activeParams = {
            ...defaultParams(presetById(state.presetId)),
            ...preset.params,
          };
          const paramsByPreset = { ...state.paramsByPreset, [state.presetId]: activeParams };
          set({ activeParams, paramsByPreset });
          saveStoredParams(paramsByPreset);
        }
        if (preset.sync) get().setSync({ ...preset.sync });
      });
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
          [{ name: "Beatform look", extensions: [USER_PRESET_EXTENSION] }],
        );
        if (saved) flashNotice(`Look exported${isTauri() ? ` to ${saved}` : ""}`);
      } catch (e) {
        set({ error: `Could not export look: ${(e as Error).message}` });
      }
    },

    analyzeCurrentTrack() {
      const buf = getEngine().audioBuffer;
      if (!buf) {
        // A load path may have invalidated on our behalf, and there is nothing
        // to analyse. The gate must not stay closed on a job that will never
        // exist. (Today's three callers all install audio first, so this is
        // belt — but every exit past `analyzing: true` has to be one.)
        settleUnclaimedAnalysis();
        return;
      }
      // Claim the invalidation the load path already performed at the moment
      // the audio landed (E3c) — or perform it now, for a caller that reaches
      // here without one. BEFORE the overview below: invalidation clears
      // `waveformOverview`, and doing it after would wipe the fresh one.
      const id = invalidateAnalysis();
      unclaimedAnalysisId = null; // claimed: from here a job is responsible
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
      // `analyzing` is a GATE now, not a label — runExport waits on it — so
      // every exit from here has to clear it. That includes the one exit this
      // function never had: `analyzeTrack` copies the whole PCM before it
      // returns a promise at all, so a long enough track can throw RangeError
      // synchronously. Leaving the flag true there would make every later
      // export sit out its full timeout waiting for a job that never started.
      let started: ReturnType<typeof analyzeTrack>;
      try {
        started = analyzeTrack(buf);
      } catch (e) {
        settleAnalysis();
        throw e; // same surface as before: loadFile's catch reports it
      }
      void started.result.then(
        ({ grid, key, sections }) => {
          if (id !== analysisId) return; // a newer track superseded this job
          getAnalyzer().setBeatGrid(grid);
          // Sections travel with the grid, always: features.sectionIndex /
          // sectionPulse resolve from these boundaries the same way the export
          // path resolves them from the job's copy (P-15).
          getAnalyzer().setSections(sections);
          // Grid and flag in one write, then the waiters — `awaitAnalysis`
          // promises that whoever it resolves reads the result, not the
          // instant before it.
          settleAnalysis({ beatGrid: grid, trackKey: key, sections });
        },
        // trackAnalysis resolves nulls for every failure it can SEE (worker
        // error message, failed boot, inline throw), so the only way here is a
        // structured-clone failure out of postMessage. No grid is coming —
        // stop gating on one.
        () => {
          if (id === analysisId) settleAnalysis();
        },
      );
    },

    awaitAnalysis() {
      // Gated on `analyzing` FIRST, and only then on the promise. `analyzing`
      // is the store's own statement that a grid is coming; the barrier is
      // opened and closed with it (invalidateAnalysis / settleAnalysis), so
      // the two normally agree. The flag stays the authority for the case they
      // cannot: anything that writes `analyzing: false` from outside this
      // module leaves a promise nobody will ever settle, and waiting on that
      // is how a wait becomes a hang.
      if (!get().analyzing || !analysisSettled) return Promise.resolve();
      return analysisSettled;
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
          if (token !== overlayToken) {
            bitmap?.close(); // superseded by a newer raster — release it
            return;
          }
          const s = get();
          const dyn = overlayDynamics(s);
          if (hasDynamics(dyn)) {
            // Dynamic layers (lyrics/audiogram) ride on top of the static
            // overlay: retain the base and hand the renderer a composed copy
            // (it closes what it's given). The next tick swaps in fresh copies.
            overlayBase?.close();
            overlayBase = bitmap;
            const t = getEngine().currentTime;
            shared.lastFrameKey = overlayFrameKeyAt(dyn, t, canvas.width);
            const composed = await composeOverlayFrame(
              overlayBase,
              dyn,
              t,
              canvas.width,
              canvas.height,
            );
            if (token === overlayToken) getRenderer()?.setOverlay(composed);
            else composed.close();
          } else {
            overlayBase?.close();
            overlayBase = null;
            getRenderer()?.setOverlay(bitmap); // takes ownership (closes it)
          }
        } catch (e) {
          console.error("[overlay]", e);
        }
      }, 60);
    },

    async importUserPreset() {
      try {
        const picked = await openTextFile([
          { name: "Beatform look", extensions: [USER_PRESET_EXTENSION] },
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

// A failed localStorage write (quota) surfaces as the ordinary error toast —
// throttled inside persistence so a full store announces itself once, not on
// every keystroke. Wired here because persistence cannot import the store.
setWriteFailureNotifier((message) => useVizStore.setState({ error: message }));

// Whole-lane-review fix C1: best-effort autosave flush from the SAME
// pagehide handler that already flushes localStorage — see
// setAutosaveFlushOnPagehide's own comment (persistence.ts) for why this is
// fire-and-forget rather than the primary defense (initApp's onCloseRequested
// is the awaited one). flushAutosave itself is isTauri()-gated, so this is
// inert in the browser build.
setAutosaveFlushOnPagehide(() => {
  void useVizStore
    .getState()
    .flushAutosave()
    .catch((e) => console.warn("[autosave] pagehide flush failed", e));
});

/**
 * ONE chokepoint feeding the analyzer's lyric-derived vocal presence (P-15).
 *
 * `lyrics` is written from nine places — file import, clear, two track-load
 * resets, the library loader, generation, and the correction editor's
 * edit/undo/redo/realign ops. Calling setVocalSpans at each is a rule every
 * future lyrics writer has to remember, and forgetting it is silent: the
 * feature just reads 0 forever. A subscription is the same shape as the
 * determinism-law chokepoints — one place, impossible to bypass.
 *
 * Identity comparison is exact by construction: every lyrics mutation builds
 * a NEW array (the editor is snapshot-based), so an unchanged reference means
 * unchanged lines. Spans are recomputed only on that change, never per frame.
 */
let lastLyrics: LyricLine[] | null = null;
useVizStore.subscribe((s) => {
  if (s.lyrics === lastLyrics) return;
  lastLyrics = s.lyrics;
  // peek, not get: this fires on state changes, including in tests and before
  // initServices — a missing analyzer is "nothing to feed yet", not an error.
  peekAnalyzer()?.setVocalSpans(s.lyrics ? vocalSpansFromLyrics(s.lyrics) : null);
  // The lyric plate rides the same chokepoint for the same reason: nine
  // writers, and a stale plate keeps the PREVIOUS sheet's words on stage.
  // Clear it now; the next frame tick recomposes from the new lines (or
  // leaves the stage to the mode's no-lyrics treatment).
  resetLyricPlate();
});

/** True while an export is running — guards Escape-to-close and modal close. */
export function isExporting(): boolean {
  const s = useVizStore.getState();
  // batchStatus matters on its own: `exporting` goes null between jobs while
  // the next track decodes, and a batch is still very much exporting there.
  return s.exporting !== null || s.batchStatus === "running";
}

/**
 * FEAT-009 — the mirror publisher's state side, wired at module scope like
 * the vocal-span chokepoint above and for the same reason: the fields that
 * feed the performance window are written from dozens of actions, and a
 * subscription is the one shape none of them can forget to call.
 *
 * The publisher itself no-ops until a performance surface says hello, so
 * in tests, the browser build and every session that never opens the
 * second window, this whole block costs one signature-array build per
 * store write and nothing else. Only the MAIN window evaluates this module
 * (main.tsx's entry branch), so exactly one publisher exists per app.
 */
initPerformPublisher({
  getLive: () => buildPerformLive(useVizStore.getState()),
  getScene: () => buildPerformScene(useVizStore.getState()),
  getAssets: () => buildPerformAssets(useVizStore.getState()),
});
let lastPerformSigs: { live: unknown[]; scene: unknown[]; assets: unknown[] } | null = null;
useVizStore.subscribe((s) => {
  if (!performMirrorActive()) {
    // Drop the seed so the first write after a (re)connect re-baselines —
    // the hello response already carried the full state.
    lastPerformSigs = null;
    return;
  }
  const sigs = {
    live: performLiveSig(s),
    scene: performSceneSig(s),
    assets: performAssetsSig(s),
  };
  if (lastPerformSigs) {
    // Assets first: a scene that names a new background wants its payload
    // already cached on the receiving side when it applies.
    if (!sameSig(sigs.assets, lastPerformSigs.assets)) publishPerformAssets();
    if (!sameSig(sigs.scene, lastPerformSigs.scene)) publishPerformScene();
    if (!sameSig(sigs.live, lastPerformSigs.live)) publishPerformLive();
  } else {
    // Review F1: this write is the one SEEDING the baseline while the
    // mirror is already live — and it may itself carry the change (hello's
    // full-state push predates it; the sigs below are POST-change). Seeding
    // silently swallowed exactly one write per activation: paused + idle,
    // open the output, press 0 — the operator read "Blacked out" while the
    // audience kept rendering. Push the full state instead of guessing
    // which tier moved; the receiver's appliers are keyed/idempotent, so a
    // redundant resend costs a few dedupe checks and nothing else.
    publishPerformState();
  }
  lastPerformSigs = sigs;
});
