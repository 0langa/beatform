import { Fragment, memo, useState, type ReactNode } from "react";
import type { SpectrumResolution, SyncMode, SyncSettings } from "../audio/types";
import { MAX_FREQ, MIN_FREQ } from "../audio/featurePipeline";
import { spectrumDiagnostics } from "../audio/dsp/displaySpectrum";
import type {
  BgFit,
  BgMode,
  BgSettings,
  MotionSettings,
  ParamValues,
  PostSettings,
  PresetDef,
} from "../render/types";
import {
  BG_IMAGE,
  BG_PRESET,
  BG_SOLID,
  BG_VIDEO,
  BG_TRANSPARENT,
  DEFAULT_MOTION,
  DEFAULT_POST,
  defaultParams,
} from "../render/types";
import type { UserPreset } from "../state/userPresets";
import { ASPECTS, type Aspect, type ProjectDocument } from "../state/project";
import { FACTORY_THEMES } from "../state/factoryThemes";
import { GalleryLink } from "./GalleryDialog";
import type { ThemeMeta } from "../state/themes";
import type { ImageLayer, OverlayAsset, OverlayLayer, TextLayer } from "../render/overlay";
import { MOD_SOURCES, POST_TARGET_PREFIX, type ModRoute, type ModSource } from "../state/modMatrix";
import { MAX_STEMS, STEM_TRACK_KEYS, type StemEntry, type StemSlot } from "../audio/stems";
import { LYRIC_ANIMS, type LyricStyle } from "../state/lyrics";
import { LyricsEditPanel } from "./LyricsEditPanel";
import { LyricsGenPanel } from "./LyricsGenPanel";
import type { AudiogramSettings } from "../state/audiogram";
import {
  allParams,
  groupParams,
  paramSearchText,
  POST_MOD_TARGETS,
  presetMasters,
} from "../render/types";
import { QUANTIZE_MODES, type QuantizeMode } from "../state/quantize";
import { bindingId, type MidiBinding, type MidiLearn } from "../state/midi";
import {
  HERTZ,
  PERCENT,
  ColorRow,
  SelectRow,
  SliderField,
  SliderRow,
  Segmented,
  ToggleRow,
  CollapsibleSection,
  type ValueUnit,
} from "./kit";
import { GROUP_KEY, ParamGroups, type ParamGroupExtra } from "./ParamGroups";
import type { AppPrefs } from "../state/prefs";
import { getPrefs, setPrefs } from "../state/prefs";
import { LayersPanel } from "./LayersPanel";
import { BuilderPanel } from "./BuilderPanel";
import { BUILDER2_ID, BUILDER_LAYER_TYPES, type BuilderStack } from "../render/builder2";
import { IconClose } from "./Icons";

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

/**
 * High-edge readout. Stating unit as a scale (rather than a format function)
 * lets numeric editor read "18.05" back as 18050 Hz instead of 18 Hz.
 */
const KILOHERTZ: ValueUnit = { scale: 0.001, unit: " kHz", decimals: 1 };

const SYNC_OPTIONS: Array<{ mode: SyncMode; label: string; hint: string }> = [
  {
    mode: "kick",
    label: "Kicks",
    hint: "Follow the drums: pulses fire on kick/snare hits, motion glides with loudness",
  },
  {
    mode: "energy",
    label: "Energy",
    hint: "Follow overall loudness — the smoothest, most forgiving option",
  },
  {
    mode: "bass",
    label: "Bass",
    hint: "Follow the low end — basslines and subs drive the visuals",
  },
  {
    mode: "melody",
    label: "Melody",
    hint: "Follow the mids (~150 Hz–2 kHz) where melodies and chords live",
  },
  {
    mode: "voice",
    label: "Voice",
    hint: "Follow the vocal range (~300 Hz–3.4 kHz) — speech and singing",
  },
  { mode: "treble", label: "Treble", hint: "Follow hi-hats, cymbals and sparkle" },
  { mode: "snare", label: "Snare", hint: "Pulse on snare/clap hits (150 Hz-2.5 kHz transients)" },
  { mode: "hats", label: "Hats", hint: "Pulse on hi-hat hits (5 kHz+ transients)" },
];

const BG_OPTIONS_BASE: Array<{ mode: BgMode; label: string; hint: string }> = [
  { mode: BG_PRESET, label: "Animated", hint: "The visual's own moving background" },
  {
    mode: BG_SOLID,
    label: "Solid",
    hint: "Flat color behind the visual — pick any, or chroma green/magenta for keying",
  },
  {
    mode: BG_TRANSPARENT,
    label: "Transparent",
    hint: "See-through background (checkerboard preview); MP4 exports render it black",
  },
  {
    mode: BG_IMAGE,
    label: "Image",
    hint: "Your artwork (or the album art) behind the visualization — fill or fit, with blur and dim",
  },
];

/** Video is desktop-only (it decodes a local file), so it's appended by the
 * panel when running under Tauri. */
const BG_OPTION_VIDEO = {
  mode: BG_VIDEO,
  label: "Video",
  hint: "A short local video looped behind the visualization — deterministic, fill or fit",
};

/** CSS object-fit, in the words a musician uses. Order and values match the
 * shader's fitUV modes (0/1/2) — see BgFit. */
const BG_FIT_OPTIONS = [
  { value: 0, label: "Fill", hint: "Cover the whole frame; whatever does not fit is cropped off" },
  { value: 1, label: "Fit", hint: "Show all of it — the leftover bars take the background color" },
  { value: 2, label: "Stretch", hint: "Squash it to fill the frame exactly (distorts the shape)" },
];

/** The background color picker plus the presets a keying workflow wants.
 * Shared by Solid mode and by a FITTED image/video, whose letterbox bars the
 * shader paints with this very color (u.bgColor) — reachable from both, or
 * choosing Fit would strand the user with bars they cannot recolor. */
function BgColorRow(props: {
  value: [number, number, number];
  onChange: (color: [number, number, number]) => void;
  title: string;
}) {
  return (
    <div className="row color-row">
      <input
        type="color"
        className="bg-color"
        value={rgbToHex(props.value)}
        onChange={(e) => props.onChange(hexToRgb(e.target.value))}
        title={props.title}
      />
      {["#000000", "#ffffff", "#00b140", "#ff00ff"].map((hex) => (
        <button
          key={hex}
          className="swatch"
          style={{ background: hex }}
          title={hex === "#00b140" ? "Chroma green" : hex === "#ff00ff" ? "Chroma magenta" : hex}
          onClick={() => props.onChange(hexToRgb(hex))}
        />
      ))}
    </div>
  );
}

/**
 * Framing rows (fit / zoom / pan) for an image or video background. One
 * component for both kinds so their ranges and wording cannot drift apart,
 * and so the ranges stay in step with validBg's clamps (0.25..4, -1..1).
 *
 * Every field is read through a fallback: BgFit is optional, and a background
 * that predates it — or one just created by picking a file — carries none.
 */
function BgFitRows(props: {
  /** The noun for the hints: "image" or "video". */
  what: string;
  value: BgFit;
  onChange: (patch: BgFit) => void;
  /** The background color — only rendered for a Fit, where it is the bars. */
  color: [number, number, number];
  onColor: (color: [number, number, number]) => void;
  onHint: (hint: string | null) => void;
  /** Set when the active renderer can't frame this source at all (video on
   * the Canvas2D fallback) — disables the rows and explains itself. Images
   * ARE fitted there (see drawFittedBg), so they never pass this. */
  disabledReason?: string;
}) {
  const { value, onChange, what } = props;
  const fit = value.fit ?? 0;
  return (
    <>
      <Segmented
        value={fit}
        onChange={(next) => onChange({ fit: next })}
        onHint={props.onHint}
        ariaLabel={`Background ${what} fit`}
        disabled={!!props.disabledReason}
        options={BG_FIT_OPTIONS}
      />
      {fit === 1 && (
        <BgColorRow
          value={props.color}
          onChange={props.onColor}
          title={`Fills the bars beside the fitted ${what}`}
        />
      )}
      <SliderRow
        label="Zoom"
        hint={`Scale the ${what} inside the frame — zoom in on the part you want`}
        min={0.25}
        max={4}
        step={0.01}
        value={value.zoom ?? 1}
        onChange={(zoom) => onChange({ zoom })}
        onHint={props.onHint}
        disabledReason={props.disabledReason}
      />
      <SliderRow
        label="X"
        hint={`Slide the ${what} sideways inside the frame`}
        min={-1}
        max={1}
        step={0.005}
        value={value.offsetX ?? 0}
        onChange={(offsetX) => onChange({ offsetX })}
        onHint={props.onHint}
        disabledReason={props.disabledReason}
      />
      <SliderRow
        label="Y"
        hint={`Slide the ${what} up or down inside the frame`}
        min={-1}
        max={1}
        step={0.005}
        value={value.offsetY ?? 0}
        onChange={(offsetY) => onChange({ offsetY })}
        onHint={props.onHint}
        disabledReason={props.disabledReason}
      />
    </>
  );
}

type PostNumKey = "bloom" | "bloomThreshold" | "exposure" | "vignette" | "grain" | "chromatic";
const POST_SLIDERS: Array<{
  key: PostNumKey;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
}> = [
  {
    key: "exposure",
    label: "Exposure",
    min: 0.2,
    max: 3,
    step: 0.01,
    hint: "Overall brightness before tonemapping — 1 is neutral, higher lifts the whole image",
  },
  {
    key: "bloom",
    label: "Bloom",
    min: 0,
    max: 1,
    step: 0.01,
    hint: "Soft glow bleeding out of bright areas — the signature 'lit' look",
  },
  {
    key: "bloomThreshold",
    label: "Bloom threshold",
    min: 0.4,
    max: 1.6,
    step: 0.01,
    hint: "Only luma above this glows — lower catches more of the image, higher keeps it to highlights",
  },
  {
    key: "vignette",
    label: "Vignette",
    min: 0,
    max: 1,
    step: 0.01,
    hint: "Darkens the corners to draw the eye inward",
  },
  {
    key: "chromatic",
    label: "Chromatic",
    min: 0,
    max: 1,
    step: 0.01,
    hint: "RGB split toward the edges — a lens/analog fringe",
  },
  {
    key: "grain",
    label: "Film grain",
    min: 0,
    max: 0.5,
    step: 0.01,
    hint: "Deterministic film grain keyed to track time",
  },
];

type ParamsTab = AppPrefs["paramsTab"];

/** The five top-level tabs of the settings panel (v2.41). Each groups a set
 * of the former flat sections; the active tab persists via prefs. */
const PARAMS_TABS: Array<{ id: ParamsTab; label: string; hint: string }> = [
  { id: "visual", label: "Visual", hint: "The visual itself — looks, motion and full templates" },
  { id: "sync", label: "Sync", hint: "What the visual reacts to, and audio-to-knob modulation" },
  {
    id: "scene",
    label: "Scene",
    hint: "Background, frame shape, post-processing and overlay layers",
  },
  { id: "text", label: "Text", hint: "Timed lyrics and audiogram overlays" },
  { id: "live", label: "Live", hint: "Live-performance switch quantize and MIDI mapping" },
];

export interface ParamsPanelProps {
  preset: PresetDef;
  params: ParamValues;
  onParam: (key: string, value: number) => void;
  onApplyStyle: (values: Partial<ParamValues>) => void;
  onReset: () => void;
  bg: BgSettings;
  onBg: (bg: BgSettings) => void;
  onPickBackgroundImage: () => void;
  onUseAlbumArtBackground: () => void;
  /** True when the ACTIVE mode has its own background override. */
  bgPerMode: boolean;
  /** Toggle the per-mode background override for the active mode. */
  onBgPerMode: (on: boolean) => void;
  /** Name of the active mode's custom center image, null = track cover. */
  centerImageName: string | null;
  onPickCenterImage: () => void;
  onClearCenterImage: () => void;
  onPickVideoBackground: () => void;
  videoBgLoading: boolean;
  /** Offer the Video background option (desktop only). */
  showVideoBg: boolean;
  sync: SyncSettings;
  /** Actual AudioContext rate; analyzer-quality readout must not assume 48 kHz. */
  analysisSampleRate: number;
  onSync: (sync: SyncSettings) => void;
  rendererKind: string;
  /**
   * True while the Canvas2D fallback is drawing (audit F1). Everything this
   * panel offers that the fallback cannot honour — Post, the Motion masters,
   * Builder Studio, the Video background — is disabled and says why, instead
   * of accepting the input and quietly dropping it on the floor.
   */
  simplifiedRenderer: boolean;
  onClose: () => void;
  /** Saved user looks for THIS visual mode (already filtered by caller). */
  userPresets: UserPreset[];
  onSaveUserPreset: (name: string) => void;
  onApplyUserPreset: (id: string) => void;
  onDeleteUserPreset: (id: string) => void;
  onExportUserPreset: (id: string) => void;
  onImportUserPreset: () => void;
  /** Apply a factory template's full document. */
  onApplyTheme: (document: ProjectDocument, name: string) => void;
  /** Save the whole current setup as a shareable .bftheme file. */
  onExportTheme: (meta: ThemeMeta) => void;
  aspect: Aspect;
  onAspect: (a: Aspect) => void;
  /** Momentary loudness readout; null before playback. */
  lufs: number | null;
  /** Detected tempo; null while unanalyzed. */
  bpm: number | null;
  /** Detected key name (e.g. "A minor"); null while unanalyzed/atonal. */
  keyName: string | null;
  overlayLayers: OverlayLayer[];
  assets: Record<string, OverlayAsset>;
  hasCoverArt: boolean;
  onAddTextLayer: () => void;
  onAddImageLayer: () => void;
  onAddAlbumArtLayer: () => void;
  onUpdateLayer: (id: string, patch: Partial<TextLayer> | Partial<ImageLayer>) => void;
  onRemoveLayer: (id: string) => void;
  smoothSpectrum: boolean;
  onSmoothSpectrum: (v: boolean) => void;
  post: PostSettings;
  onPost: (patch: Partial<PostSettings>) => void;
  motion: MotionSettings;
  onMotion: (patch: Partial<MotionSettings>) => void;
  /** Beat-quantized preset takeover mode (live performance). */
  switchQuantize: QuantizeMode;
  onSwitchQuantize: (mode: QuantizeMode) => void;
  /** Web MIDI (live performance). Absent entirely where unsupported. */
  midiSupported: boolean;
  midiEnabled: boolean;
  midiDevices: string[];
  midiBindings: MidiBinding[];
  midiLearn: MidiLearn | null;
  onEnableMidi: () => void;
  onDisableMidi: () => void;
  onMidiLearn: (learn: MidiLearn | null) => void;
  onRemoveMidiBinding: (id: string) => void;
  mods: ModRoute[];
  /** Imported stems (analysis-only modulation sources). */
  stems: StemEntry[];
  stemAnalyzing: string | null;
  onAddStem: (file: File) => void;
  onRemoveStem: (slot: StemSlot) => void;
  onAutoRouteStem: (slot: StemSlot) => void;
  onAddMod: (source: ModSource, param: string) => void;
  onUpdateMod: (id: string, patch: Partial<ModRoute>) => void;
  onRemoveMod: (id: string) => void;
  /** Timed lyrics: loaded file name (null = none) + display style. */
  lyricFileName: string | null;
  lyricStyle: LyricStyle;
  onImportLyrics: (file: File) => void;
  onClearLyrics: () => void;
  onLyricStyle: (patch: Partial<LyricStyle>) => void;
  /** Audiogram overlay elements (progress bar / time / waveform strip). */
  audiogram: AudiogramSettings;
  onAudiogram: (patch: Partial<AudiogramSettings>) => void;
  /** Builder Studio layer stack (edited when preset.id === "builder2"). */
  builderStack: BuilderStack;
  onBuilderStack: (stack: BuilderStack) => void;
  onBuilderExport: () => void;
  onBuilderImport: (file: File) => void;
}

/** A settings section, mapped to a tab and given a searchable keyword blob.
 * `standalone` sections render their own `.panel-section` (LayersPanel) and
 * are not wrapped in a CollapsibleSection. */
interface SectionDef {
  /**
   * Stable identity for collapse state and React keys — NOT the title.
   * Retitling a section (Motion → Global motion) must not silently drop the
   * user's collapsed/expanded choice for it, which keying by title did. The
   * ids below are the pre-v2.53 titles verbatim so state persisted under the
   * old scheme keeps applying.
   */
  id: string;
  title: string;
  tab: ParamsTab;
  /** Lowercased title + control labels/hints, matched by the search box. */
  search: string;
  headerExtra?: ReactNode;
  body: ReactNode;
  standalone?: boolean;
}

/** Right-hand settings panel: styles, preset parameters, background.
 * Memoized (H13): App re-renders at ~4Hz alongside the 60fps render loop for
 * unrelated reasons (playback/lufs ticks), and this panel alone is 1,400+
 * lines — without memo it fully reconciled on every one of those ticks even
 * though none of ITS OWN props had changed. Requires every callback prop
 * from App.tsx to be reference-stable (see the useCallback block there); a
 * fresh arrow function per render would silently defeat this.
 *
 * v2.41: the former flat 13-section scroll is now grouped into five tabs
 * (Visual/Sync/Scene/Text/Live) with per-section collapse and a search box
 * that bypasses the tabs. Active tab + collapsed titles persist via prefs. */
export const ParamsPanel = memo(function ParamsPanel(props: ParamsPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(() => getPrefs().advancedOpen);
  const [hint, setHint] = useState<string | null>(null);
  const [savingLook, setSavingLook] = useState(false);
  const [lookName, setLookName] = useState("");
  const [savingTheme, setSavingTheme] = useState(false);
  const [themeName, setThemeName] = useState("");
  const [themeAuthor, setThemeAuthor] = useState("");
  const [midiParam, setMidiParam] = useState("");
  const [tab, setTab] = useState<ParamsTab>(() => getPrefs().paramsTab);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>(() => getPrefs().collapsedSections);
  const changeTab = (t: ParamsTab) => {
    setTab(t);
    setPrefs({ paramsTab: t });
  };
  /** Collapse state for one section or one param group. Sections pass their
   * stable `id`, groups a GROUP_KEY-prefixed one — same persisted list, no
   * chance of a group named "Post" closing the Post section. */
  const toggleCollapsed = (key: string, open: boolean) => {
    setCollapsed((prev) => {
      const next = open ? prev.filter((t) => t !== key) : [...prev, key];
      setPrefs({ collapsedSections: next });
      return next;
    });
  };
  const toggleGroup = (groupId: string, open: boolean) =>
    toggleCollapsed(GROUP_KEY + groupId, open);
  const setAdvanced = (on: boolean) => {
    setShowAdvanced(on);
    setPrefs({ advancedOpen: on });
  };
  const postChanged = (Object.keys(DEFAULT_POST) as Array<keyof PostSettings>).some(
    (k) => props.post[k] !== DEFAULT_POST[k],
  );
  const motionChanged = (Object.keys(DEFAULT_MOTION) as Array<keyof MotionSettings>).some(
    (k) => props.motion[k] !== DEFAULT_MOTION[k],
  );
  const advanced = props.preset.advanced ?? [];
  const changedCount = advanced.filter(
    (p) => (props.params[p.key] ?? p.default) !== p.default,
  ).length;
  const spectrumInfo = spectrumDiagnostics(props.sync, props.analysisSampleRate);
  const resolutionLabel = (resolution: SpectrumResolution) =>
    `${Math.round(
      spectrumDiagnostics(
        { ...props.sync, spectrumResolution: resolution },
        props.analysisSampleRate,
      ).windowMs,
    )} ms`;
  const resolutionLatency = (resolution: SpectrumResolution) =>
    `≈${Math.round(
      spectrumDiagnostics(
        { ...props.sync, spectrumResolution: resolution },
        props.analysisSampleRate,
      ).latencyMs,
    )} ms visual latency`;

  // Which global masters actually move THIS mode — used to hide inert sliders
  // (e.g. Rotation on a mode that can't spin, Detail on a non-discrete mode).
  const caps = presetMasters(props.preset);
  const showMotion = caps.rotation || caps.pulse || caps.detail;

  // One sentence, reused by every control the Canvas2D fallback cannot honour
  // (F1). `undefined` on the normal WebGPU path, which is what leaves those
  // controls with their own hints and their own enabled behaviour — the
  // fallback must cost the 99% of users nothing.
  const unavailable = props.simplifiedRenderer
    ? "Unavailable right now: hardware rendering (WebGPU) isn't available on this system, and the simplified renderer can't draw this"
    : undefined;

  // A style is "active" when current params exactly equal defaults + values
  const defaults = defaultParams(props.preset);
  const activeStyleId = (props.preset.styles ?? []).find((s) => {
    const merged = { ...defaults, ...s.values };
    return Object.keys(merged).every((k) => (props.params[k] ?? defaults[k]) === merged[k]);
  })?.id;

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  // Every word of every knob — label, hint, key and enum choices — plus the
  // names of the groups they sit in. The old blob carried labels only, so
  // searching a hint's wording ("monstercat", "letterbox") found nothing even
  // though the row was right there.
  const presetParamText = allParams(props.preset).map(paramSearchText).join(" ");
  /** Every knob of this visual, grouped — reused by the panel's own layout
   * search blob and by the Modulation/MIDI target dropdowns. */
  const paramGroupViews = groupParams(props.preset, allParams(props.preset));
  const presetGroupText = paramGroupViews.map((g) => g.group.label).join(" ");

  /** The centre-image picker belongs with the Image knobs it affects. */
  const centerImageExtras: ParamGroupExtra[] = props.preset.params.some((p) => p.key === "cover")
    ? [
        {
          group: "image",
          search: "center image cover art album artwork choose custom picture",
          node: (
            <div
              className="row center-image-row"
              title="What this mode draws in its center: the track's embedded cover art, or any image you choose"
            >
              <span className="row-label">Center image</span>
              <span className="center-image-value">
                {props.centerImageName ?? "Track cover art"}
              </span>
              <button
                className="text-btn"
                title="Choose a custom image for this mode's center"
                onClick={props.onPickCenterImage}
              >
                Choose…
              </button>
              {props.centerImageName && (
                <button
                  className="text-btn"
                  title="Back to the track's embedded cover art"
                  onClick={props.onClearCenterImage}
                >
                  ✕
                </button>
              )}
            </div>
          ),
        },
      ]
    : [];

  const sections: SectionDef[] = [
    // ---------------- Visual ----------------
    {
      id: props.preset.name,
      title: props.preset.name,
      tab: "visual",
      search:
        `${props.preset.name} ${props.preset.description ?? ""} preset style look custom save import advanced essentials reset center image cover ${presetGroupText} ${presetParamText}`.toLowerCase(),
      headerExtra: (
        <button
          className="text-btn"
          onClick={props.onReset}
          title="Back to factory defaults (all settings incl. advanced)"
        >
          Reset
        </button>
      ),
      body: (
        <>
          {props.preset.description && <p className="preset-desc">{props.preset.description}</p>}

          {(props.preset.styles?.length ?? 0) > 0 && (
            <div className="style-chips">
              {props.preset.styles!.map((s) => (
                <button
                  key={s.id}
                  className={`style-chip ${s.id === activeStyleId ? "active" : ""}`}
                  title={`Apply the "${s.name}" look`}
                  onClick={() => props.onApplyStyle(s.values)}
                >
                  {s.name}
                </button>
              ))}
              {!activeStyleId && <span className="style-custom">Custom</span>}
            </div>
          )}

          <div className="user-presets">
            {props.userPresets.length > 0 && (
              <div className="style-chips">
                {props.userPresets.map((p) => (
                  <span key={p.id} className="user-chip-wrap">
                    <button
                      className="style-chip user"
                      title={`Apply your "${p.name}" look`}
                      onClick={() => props.onApplyUserPreset(p.id)}
                    >
                      {p.name}
                    </button>
                    <button
                      className="chip-x"
                      title={`Delete "${p.name}"`}
                      aria-label={`Delete "${p.name}"`}
                      onClick={() => props.onDeleteUserPreset(p.id)}
                    >
                      ✕
                    </button>
                    <button
                      className="chip-x"
                      title={`Export "${p.name}" as .bfpreset file`}
                      aria-label={`Export "${p.name}" as .bfpreset file`}
                      onClick={() => props.onExportUserPreset(p.id)}
                    >
                      ↗
                    </button>
                  </span>
                ))}
              </div>
            )}
            {savingLook ? (
              <form
                className="save-look-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  props.onSaveUserPreset(lookName);
                  setLookName("");
                  setSavingLook(false);
                }}
              >
                <input
                  className="look-name-input"
                  autoFocus
                  placeholder="Name this look…"
                  value={lookName}
                  maxLength={32}
                  onChange={(e) => setLookName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setSavingLook(false);
                      setLookName("");
                    }
                  }}
                />
                <button type="submit" className="text-btn" disabled={!lookName.trim()}>
                  Save
                </button>
              </form>
            ) : (
              <div className="save-look-row">
                <button
                  className="text-btn"
                  title="Save the current settings as a named look for this visual"
                  onClick={() => setSavingLook(true)}
                >
                  + Save look
                </button>
                <button
                  className="text-btn"
                  title="Import a .bfpreset look file"
                  onClick={props.onImportUserPreset}
                >
                  Import…
                </button>
              </div>
            )}
          </div>

          {/* Density, not a drawer. "Advanced" used to be a second flat list
              bolted under the first; as one switch over the SAME grouped view
              it stays one mental model — every knob is always in the group it
              belongs to, you only choose how many of them you see. Search
              ignores it entirely (see ParamGroups). */}
          {advanced.length > 0 && (
            <div className="param-density">
              <Segmented
                value={showAdvanced ? 1 : 0}
                onChange={(v) => setAdvanced(v === 1)}
                onHint={setHint}
                ariaLabel="Setting detail"
                options={[
                  {
                    value: 0,
                    label: "Essentials",
                    hint: `The ${props.preset.params.length} knobs that shape this visual most`,
                  },
                  {
                    value: 1,
                    label: "All",
                    hint: `Every knob, including the ${advanced.length} expert constants`,
                  },
                ]}
              />
              {changedCount > 0 && (
                <span
                  className="advanced-count"
                  title="Expert knobs that no longer sit at their factory value"
                >
                  {changedCount} changed
                </span>
              )}
            </div>
          )}

          <ParamGroups
            preset={props.preset}
            params={props.params}
            onParam={props.onParam}
            onHint={setHint}
            showAdvanced={showAdvanced}
            query={q}
            collapsed={collapsed}
            onToggleGroup={toggleGroup}
            extras={centerImageExtras}
          />
        </>
      ),
    },
    ...(props.preset.id === BUILDER2_ID
      ? [
          {
            id: "Builder layers",
            title: "Builder layers",
            tab: "visual" as const,
            search:
              `builder layer stack compositor blend add screen opacity hue spread ${BUILDER_LAYER_TYPES.map((t) => t.label).join(" ")}`.toLowerCase(),
            standalone: true,
            body: props.simplifiedRenderer ? (
              // The whole stack compiles to WGSL, so there is nothing here the
              // fallback can render — showing the editor would invite edits
              // that change the picture not at all (F1).
              <div className="panel-section" title={unavailable}>
                <p className="section-hint">
                  Builder Studio compiles its layer stack to a GPU shader, so it needs hardware
                  rendering (WebGPU). Your saved stack is untouched and will render again on a
                  system that has it.
                </p>
              </div>
            ) : (
              <BuilderPanel
                stack={props.builderStack}
                onChange={props.onBuilderStack}
                onExport={props.onBuilderExport}
                onImport={props.onBuilderImport}
                onHint={setHint}
              />
            ),
          } satisfies SectionDef,
        ]
      : []),
    ...(showMotion
      ? [
          {
            id: "Motion",
            title: "Global motion",
            tab: "visual" as const,
            search: "motion rotation pulse detail spin global",
            headerExtra:
              motionChanged && !props.simplifiedRenderer ? (
                <button
                  className="text-btn"
                  title="Back to normal motion (100% everywhere)"
                  onClick={() => props.onMotion({ ...DEFAULT_MOTION })}
                >
                  Reset
                </button>
              ) : undefined,
            body: (
              <>
                {caps.rotation && (
                  <SliderRow
                    label="Rotation"
                    hint="Global spin master — 0% stops all rotation, 100% = normal, up to 200%"
                    min={0}
                    max={2}
                    step={0.05}
                    value={props.motion.rotation}
                    onChange={(v) => props.onMotion({ rotation: v })}
                    format={PERCENT}
                    onHint={setHint}
                    disabledReason={unavailable}
                  />
                )}
                {caps.pulse && (
                  <SliderRow
                    label="Pulse"
                    hint="Global pulse master — 0% removes beat pumping, 100% = normal, up to 200%"
                    min={0}
                    max={2}
                    step={0.05}
                    value={props.motion.pulse}
                    onChange={(v) => props.onMotion({ pulse: v })}
                    format={PERCENT}
                    onHint={setHint}
                    disabledReason={unavailable}
                  />
                )}
                {caps.detail && (
                  <SliderRow
                    label="Detail"
                    hint="Detail — how many bars / points / segments this mode draws"
                    min={0}
                    max={1}
                    step={0.02}
                    value={props.motion.detail}
                    onChange={(v) => props.onMotion({ detail: v })}
                    format={PERCENT}
                    onHint={setHint}
                    disabledReason={unavailable}
                  />
                )}
                <p className="section-hint">
                  {props.simplifiedRenderer
                    ? "The motion masters drive the visual's own shader, so they need hardware rendering (WebGPU). Your settings are kept and apply again where it is available."
                    : "Global motion for this mode — exports match."}
                </p>
              </>
            ),
          } satisfies SectionDef,
        ]
      : []),
    {
      id: "Templates",
      title: "Templates",
      tab: "visual",
      search:
        `templates theme complete looks colors sync post save export import bftheme gallery community browse ${FACTORY_THEMES.map((t) => t.meta.name).join(" ")}`.toLowerCase(),
      body: (
        <>
          <p className="section-hint">
            Complete looks — visual, colors, sync, post — in one click. Drop any .bftheme file onto
            the window to import; save yours to share.
          </p>
          <div className="style-chips">
            {FACTORY_THEMES.map((t) => (
              <button
                key={t.meta.name}
                className="style-chip"
                title={`${t.meta.description ?? ""}${t.meta.bpmHint ? ` (~${t.meta.bpmHint[0]}-${t.meta.bpmHint[1]} BPM)` : ""}`}
                onClick={() => props.onApplyTheme(t.document, t.meta.name)}
              >
                {t.meta.name}
              </button>
            ))}
          </div>
          {savingTheme ? (
            <form
              className="save-look-row"
              onSubmit={(e) => {
                e.preventDefault();
                props.onExportTheme({
                  name: themeName.trim(),
                  author: themeAuthor.trim() || "anonymous",
                  license: "CC0-1.0",
                });
                setSavingTheme(false);
                setThemeName("");
              }}
            >
              <input
                className="look-name-input"
                autoFocus
                placeholder="Template name…"
                value={themeName}
                maxLength={80}
                onChange={(e) => setThemeName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSavingTheme(false);
                }}
              />
              <input
                className="look-name-input"
                placeholder="Your name…"
                value={themeAuthor}
                maxLength={60}
                onChange={(e) => setThemeAuthor(e.target.value)}
              />
              <button type="submit" className="text-btn" disabled={!themeName.trim()}>
                Save
              </button>
            </form>
          ) : (
            <div className="save-look-row">
              <button
                className="text-btn"
                title="Save EVERYTHING currently set up (visual, layers, timeline, post) as a shareable .bftheme file (CC0)"
                onClick={() => setSavingTheme(true)}
              >
                + Save as template…
              </button>
            </div>
          )}
          <GalleryLink />
        </>
      ),
    },
    // ---------------- Sync ----------------
    {
      id: "Sync",
      title: "Sync",
      tab: "sync",
      search:
        "sync react kick energy bass melody voice treble snare hats smoothing attack release spectrum smooth curve merge rounding contrast monstercat flatten shape frequency range low high edge hz analyzer resolution fft measured bins interpolation linear logarithmic",
      body: (
        <>
          <div className="sync-grid">
            {SYNC_OPTIONS.map((o) => (
              <button
                key={o.mode}
                className={`segment ${props.sync.mode === o.mode ? "active" : ""}`}
                title={o.hint}
                onPointerEnter={() => setHint(o.hint)}
                onPointerLeave={() => setHint(null)}
                onFocus={() => setHint(o.hint)}
                onBlur={() => setHint(null)}
                onClick={() => props.onSync({ ...props.sync, mode: o.mode })}
              >
                {o.label}
              </button>
            ))}
          </div>
          <SliderRow
            label="Smoothing"
            hint="Overall response — 0 = punchy, 1 = long glides. Sets attack + release together"
            min={0}
            max={1}
            step={0.01}
            value={props.sync.smooth}
            onChange={(v) =>
              props.onSync({ ...props.sync, smooth: v, attack: undefined, release: undefined })
            }
            onHint={setHint}
          />
          <SliderRow
            label="Attack"
            hint="Attack — how fast the reaction rises on a hit (0 = instant, 1 = slow)"
            min={0}
            max={1}
            step={0.01}
            value={props.sync.attack ?? props.sync.smooth}
            onChange={(v) => props.onSync({ ...props.sync, attack: v })}
            onHint={setHint}
          />
          <SliderRow
            label="Release"
            hint="Release — how slowly the reaction falls after a hit (0 = instant, 1 = long)"
            min={0}
            max={1}
            step={0.01}
            value={props.sync.release ?? props.sync.smooth}
            onChange={(v) => props.onSync({ ...props.sync, release: v })}
            onHint={setHint}
          />
          {caps.spectrumSmooth && (
            <>
              <SliderRow
                label="Spectrum smooth"
                hint="Rounds the spectrum from hard bins toward a flowing curve"
                min={0}
                max={1}
                step={0.02}
                value={props.motion.spectrumSmooth}
                onChange={(v) => props.onMotion({ spectrumSmooth: v })}
                format={PERCENT}
                onHint={setHint}
              />
              <ToggleRow
                label="Smooth curve"
                hint="Spline-smoothed spectrum: curves instead of corners"
                checked={props.smoothSpectrum}
                onChange={props.onSmoothSpectrum}
                onHint={setHint}
              />
              <div className="row">
                <span className="row-label">Resolution</span>
                <div style={{ flex: 1 }}>
                  <Segmented
                    value={props.sync.spectrumResolution ?? "responsive"}
                    onChange={(spectrumResolution) =>
                      props.onSync({ ...props.sync, spectrumResolution })
                    }
                    onHint={setHint}
                    ariaLabel="Drawn spectrum resolution"
                    options={(["responsive", "detailed", "precise"] as const).map((value) => ({
                      value,
                      label: resolutionLabel(value),
                      hint:
                        value === "responsive"
                          ? `Fastest response; existing 85 ms-class display window (${resolutionLatency(value)})`
                          : `Longer display-only FFT: finer low-frequency detail (${resolutionLatency(value)})`,
                    }))}
                  />
                </div>
              </div>
              <div className="row">
                <span className="row-label">Axis</span>
                <div style={{ flex: 1 }}>
                  <Segmented
                    value={
                      props.sync.spectrumSampling === "measured"
                        ? "linear"
                        : (props.sync.spectrumAxis ?? "log")
                    }
                    onChange={(spectrumAxis) => props.onSync({ ...props.sync, spectrumAxis })}
                    disabled={props.sync.spectrumSampling === "measured"}
                    onHint={setHint}
                    ariaLabel="Spectrum frequency axis"
                    options={[
                      {
                        value: "log" as const,
                        label: "Musical",
                        hint: "Log axis: equal width per octave; display bands are resampled",
                      },
                      {
                        value: "linear" as const,
                        label: "Linear",
                        hint: "Linear hertz axis: equal frequency width across the frame",
                      },
                    ]}
                  />
                </div>
              </div>
              <div className="row">
                <span className="row-label">Sampling</span>
                <div style={{ flex: 1 }}>
                  <Segmented
                    value={props.sync.spectrumSampling ?? "interpolated"}
                    onChange={(spectrumSampling) =>
                      props.onSync({ ...props.sync, spectrumSampling })
                    }
                    onHint={setHint}
                    ariaLabel="Spectrum sampling"
                    options={[
                      {
                        value: "interpolated" as const,
                        label: "96 bands",
                        hint: "Keep 96 bars by resampling FFT data into display bands",
                      },
                      {
                        value: "measured" as const,
                        label: "FFT bins",
                        hint: "Read integer FFT bins only; no interpolation, linear axis, fewer bars when physics provides fewer",
                      },
                    ]}
                  />
                </div>
              </div>
              <p className="section-hint">
                {Math.round(spectrumInfo.windowMs)} ms window · ≈
                {Math.round(spectrumInfo.latencyMs)} ms visual latency ·{" "}
                {spectrumInfo.hzPerBin.toFixed(2)}
                Hz/bin · {spectrumInfo.nativeBins} native bins in range ·{" "}
                {spectrumInfo.measured
                  ? `${spectrumInfo.displayBins} measured bars, no interpolation`
                  : `${spectrumInfo.displayBins} display bands`}
                . Detector timing stays on responsive resolution.
              </p>
              <SliderRow
                label="Merge"
                hint="Bars prop up their neighbors (Monstercat-style) — melts lone spikes into one connected shape"
                min={0}
                max={1}
                step={0.01}
                value={props.sync.shapeMerge ?? 0}
                onChange={(v) => props.onSync({ ...props.sync, shapeMerge: v })}
                format={PERCENT}
                onHint={setHint}
              />
              <SliderRow
                label="Rounding"
                hint="Averages neighboring bars before drawing — real smoothing that removes spikes, not just curved corners"
                min={0}
                max={1}
                step={0.01}
                value={props.sync.shapeRound ?? 0}
                onChange={(v) => props.onSync({ ...props.sync, shapeRound: v })}
                format={PERCENT}
                onHint={setHint}
              />
              <SliderRow
                label="Contrast"
                hint="Below 50% flattens the spectrum (fuller, calmer bars); above 50% exaggerates peaks vs valleys"
                min={0}
                max={1}
                step={0.01}
                value={props.sync.contrast ?? 0.5}
                onChange={(v) => props.onSync({ ...props.sync, contrast: v })}
                format={PERCENT}
                onHint={setHint}
              />
              <SliderRow
                label="Low edge"
                hint="Lowest frequency the bars cover — raise it to stop spending bars on sub-bass the track doesn't have"
                min={10}
                max={500}
                step={1}
                value={props.sync.freqMin ?? MIN_FREQ}
                onChange={(v) =>
                  props.onSync({
                    ...props.sync,
                    freqMin: v,
                    freqMax: props.sync.freqMax ?? MAX_FREQ,
                  })
                }
                format={HERTZ}
                onHint={setHint}
              />
              <SliderRow
                label="High edge"
                hint="Highest frequency the bars cover — lower it to give the musical range more of the width"
                min={200}
                max={22050}
                step={50}
                value={props.sync.freqMax ?? MAX_FREQ}
                onChange={(v) =>
                  props.onSync({
                    ...props.sync,
                    freqMin: props.sync.freqMin ?? MIN_FREQ,
                    freqMax: v,
                  })
                }
                format={KILOHERTZ}
                onHint={setHint}
              />
            </>
          )}
          <p className="section-hint">
            What this visual reacts to. Saved per mode; exports use it too.
          </p>
        </>
      ),
    },
    {
      id: "Modulation",
      title: "Modulation",
      tab: "sync",
      search: "modulation route stem source amount kick hats auto-route feature knob",
      body: (
        <>
          {props.mods.length === 0 && (
            <p className="section-hint">
              Route any audio feature to any knob of this visual — kick pumps the zoom, hats flicker
              the glow. Applied in exports identically.
            </p>
          )}
          <div className="save-look-row">
            {props.stems.map((st) => (
              <span key={st.slot} className="user-chip-wrap">
                <span
                  className="style-chip user"
                  title="Imported stem — its bands appear as modulation sources"
                >
                  {st.analysis.name}
                </span>
                <button
                  className="chip-x"
                  title="Auto-route: wire this stem's kick/bass/snare/hats/mids to the best-matching knobs of this visual"
                  aria-label={`Auto-route ${st.analysis.name}`}
                  onClick={() => props.onAutoRouteStem(st.slot)}
                >
                  ✦
                </button>
                <button
                  className="chip-x"
                  title="Remove this stem (routes to it go inert)"
                  aria-label={`Remove ${st.analysis.name} stem`}
                  onClick={() => props.onRemoveStem(st.slot)}
                >
                  ✕
                </button>
              </span>
            ))}
            {props.stemAnalyzing ? (
              <span className="section-hint">Analyzing {props.stemAnalyzing}…</span>
            ) : (
              props.stems.length < MAX_STEMS && (
                <label
                  className="text-btn"
                  title="Import a stem (drums/bass/vocals bounced from 0:00) — analyzed once, never played; its bands become modulation sources"
                >
                  + Add stem…
                  <input
                    type="file"
                    accept="audio/*,.mp3,.flac,.wav,.ogg,.m4a"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) props.onAddStem(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              )
            )}
          </div>
          {props.mods.map((r) => (
            <div key={r.id} className="mod-row">
              <select
                className="select mod-select"
                value={r.source}
                title="What drives this route"
                onChange={(e) => props.onUpdateMod(r.id, { source: e.target.value as ModSource })}
              >
                {MOD_SOURCES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
                {props.stems.map((st) =>
                  STEM_TRACK_KEYS.map((k) => (
                    <option key={`${st.slot}:${k}`} value={`${st.slot}:${k}`}>
                      {st.analysis.name}: {k}
                    </option>
                  )),
                )}
              </select>
              <span className="mod-arrow">→</span>
              <select
                className="select mod-select"
                value={r.param}
                title="Which knob it moves"
                onChange={(e) => props.onUpdateMod(r.id, { param: e.target.value })}
              >
                {/* Grouped by the SAME ParamSpec.group the panel lays out, so
                    a 35-knob visual reads as eight short lists instead of one
                    unsearchable run of options. */}
                {paramGroupViews.map(({ group, params }) => (
                  <optgroup key={group.id} label={group.label}>
                    {params.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {/* Post targets are namespaced ("post:chromatic") so they can
                    live in the same route list as preset params — animating
                    the post chain was a direct user request. */}
                <optgroup label="Post-processing">
                  {POST_MOD_TARGETS.map((p) => (
                    <option key={p.key} value={`${POST_TARGET_PREFIX}${p.key}`}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              </select>
              <SliderField
                label={`${r.source} to ${r.param} amount`}
                min={-1}
                max={1}
                step={0.01}
                value={r.amount}
                onChange={(amount) => props.onUpdateMod(r.id, { amount })}
              />
              <button
                className="chip-x"
                title="Remove route"
                aria-label={`Remove ${r.source} to ${r.param} modulation route`}
                onClick={() => props.onRemoveMod(r.id)}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="save-look-row">
            <button
              className="text-btn"
              title="Add a feature-to-knob route"
              onClick={() => props.onAddMod("kick", props.preset.params[0]?.key ?? "")}
            >
              + Route
            </button>
          </div>
        </>
      ),
    },
    // ---------------- Scene ----------------
    {
      id: "Background",
      title: "Background",
      tab: "scene",
      search:
        "background animated solid transparent image video color dim blur album art chroma green magenta keying per-mode this mode scope override fit fill contain stretch cover crop letterbox zoom pan align position offset x y",
      body: (
        <>
          <Segmented
            value={props.bgPerMode ? 1 : 0}
            onHint={setHint}
            ariaLabel="Background scope"
            options={[
              {
                value: 0,
                label: "All modes",
                hint: "One background shared by every visual mode (the default)",
              },
              {
                value: 1,
                label: "This mode",
                hint: `Give ${props.preset.name} its own background — other modes keep the shared one`,
              },
            ]}
            onChange={(v) => props.onBgPerMode(v === 1)}
          />
          <Segmented
            value={props.bg.mode}
            onHint={setHint}
            ariaLabel="Background mode"
            options={(props.showVideoBg
              ? [...BG_OPTIONS_BASE, BG_OPTION_VIDEO]
              : BG_OPTIONS_BASE
            ).map((o) => ({
              value: o.mode,
              label: o.label,
              // Video frames are uploaded as GPU textures every frame — the
              // simplified renderer has nowhere to put them, and picking Video
              // there used to decode the whole clip and then draw a hue wash
              // that matched nothing the user chose (F9).
              disabled: o.mode === BG_VIDEO && props.simplifiedRenderer,
              hint: o.mode === BG_VIDEO && unavailable ? unavailable : o.hint,
            }))}
            onChange={(mode) => {
              if (mode === BG_IMAGE && !props.bg.image) props.onPickBackgroundImage();
              else if (mode === BG_VIDEO && !props.bg.video) props.onPickVideoBackground();
              else props.onBg({ ...props.bg, mode });
            }}
          />
          {props.bg.mode === BG_SOLID && (
            <BgColorRow
              value={props.bg.color}
              onChange={(color) => props.onBg({ ...props.bg, color })}
              title="Custom background color"
            />
          )}
          {props.bg.mode === BG_IMAGE && props.bg.image && (
            <>
              <div className="save-look-row">
                <button
                  className="text-btn"
                  title="Choose a different image file"
                  onClick={props.onPickBackgroundImage}
                >
                  Choose image…
                </button>
                <button
                  className="text-btn"
                  disabled={!props.hasCoverArt}
                  title={
                    props.hasCoverArt
                      ? "Use the loaded track's album art"
                      : "The loaded track has no embedded cover art"
                  }
                  onClick={props.onUseAlbumArtBackground}
                >
                  Use album art
                </button>
              </div>
              <SliderRow
                label="Dim"
                hint="Darken the image so the visualization stays readable"
                min={0}
                max={0.9}
                step={0.01}
                value={props.bg.image.dim}
                onChange={(dim) => props.onBg({ ...props.bg, image: { ...props.bg.image!, dim } })}
              />
              <SliderRow
                label="Blur"
                hint="Soften the image behind the visualization"
                min={0}
                max={60}
                step={1}
                value={props.bg.image.blur}
                onChange={(blur) =>
                  props.onBg({ ...props.bg, image: { ...props.bg.image!, blur } })
                }
              />
              <BgFitRows
                what="image"
                value={props.bg.image}
                onChange={(patch) =>
                  props.onBg({ ...props.bg, image: { ...props.bg.image!, ...patch } })
                }
                color={props.bg.color}
                onColor={(color) => props.onBg({ ...props.bg, color })}
                onHint={setHint}
              />
            </>
          )}
          {props.bg.mode === BG_VIDEO && (
            <>
              <div className="save-look-row">
                <button
                  className="text-btn"
                  disabled={props.simplifiedRenderer}
                  title={unavailable ?? "Choose a different video file"}
                  onClick={props.onPickVideoBackground}
                >
                  {props.videoBgLoading ? "Decoding…" : "Choose video…"}
                </button>
              </div>
              {props.bg.video && (
                <SliderRow
                  label="Dim"
                  hint="Darken the video so the visualization stays readable (re-decodes)"
                  min={0}
                  max={0.9}
                  step={0.01}
                  value={props.bg.video.dim}
                  onChange={(dim) =>
                    props.onBg({ ...props.bg, video: { ...props.bg.video!, dim } })
                  }
                  disabledReason={unavailable}
                />
              )}
              {props.bg.video && (
                <SliderRow
                  label="Blur"
                  hint="Soften the video behind the visualization (baked once per loop; re-decodes)"
                  min={0}
                  max={60}
                  step={1}
                  value={props.bg.video.blur}
                  onChange={(blur) =>
                    props.onBg({ ...props.bg, video: { ...props.bg.video!, blur } })
                  }
                  disabledReason={unavailable}
                />
              )}
              {props.bg.video && (
                <BgFitRows
                  what="video"
                  value={props.bg.video}
                  onChange={(patch) =>
                    props.onBg({ ...props.bg, video: { ...props.bg.video!, ...patch } })
                  }
                  color={props.bg.color}
                  onColor={(color) => props.onBg({ ...props.bg, color })}
                  onHint={setHint}
                  disabledReason={unavailable}
                />
              )}
              <p className="section-hint">
                {props.simplifiedRenderer
                  ? "Video backgrounds upload a frame to the GPU every frame, so they need hardware rendering (WebGPU). This mode currently paints the flat background color instead — pick Animated, Solid or Image."
                  : `A short clip loops behind the visualization (first ${12}s, decoded to a fixed loop). Export selects frames from the same track-time index. Desktop only.`}
              </p>
            </>
          )}
          {props.bg.mode === BG_TRANSPARENT && (
            <p className="section-hint">
              Preview shows a checkerboard. MP4 exports have no alpha channel — transparent renders
              over black; use solid green/magenta for editor keying.
            </p>
          )}
        </>
      ),
    },
    {
      id: "Frame",
      title: "Frame",
      tab: "scene",
      search:
        `frame aspect ratio shape preview export ${ASPECTS.map((a) => a.label).join(" ")} shorts posts`.toLowerCase(),
      body: (
        <>
          <Segmented
            value={props.aspect}
            onChange={props.onAspect}
            onHint={setHint}
            ariaLabel="Frame aspect"
            options={ASPECTS.map((a) => ({ value: a.id, label: a.label, hint: a.hint }))}
          />
          <p className="section-hint">
            Frame shape for preview and export — 9:16 for Canvas/Shorts, 1:1 for posts.
          </p>
        </>
      ),
    },
    {
      id: "Post",
      title: "Post",
      tab: "scene",
      search:
        `post processing finishing filmic tonemap aces ${POST_SLIDERS.map((r) => r.label).join(" ")}`.toLowerCase(),
      headerExtra:
        postChanged && !props.simplifiedRenderer ? (
          <button
            className="text-btn"
            title="Turn off all post-processing (neutral)"
            onClick={() => props.onPost({ ...DEFAULT_POST })}
          >
            Reset
          </button>
        ) : undefined,
      body: (
        <>
          <ToggleRow
            label="Filmic tonemap"
            hint="Filmic (ACES) tonemap — cinematic contrast and highlight rolloff"
            checked={props.post.tonemap}
            onChange={(v) => props.onPost({ tonemap: v })}
            onHint={setHint}
            disabledReason={unavailable}
          />
          {POST_SLIDERS.map((r) => (
            <SliderRow
              key={r.key}
              label={r.label}
              hint={r.hint}
              min={r.min}
              max={r.max}
              step={r.step}
              value={props.post[r.key]}
              onChange={(v) => props.onPost({ [r.key]: v })}
              onHint={setHint}
              disabledReason={unavailable}
            />
          ))}
          <p className="section-hint">
            {props.simplifiedRenderer
              ? "The finishing pass runs on the GPU, so it needs hardware rendering (WebGPU). Your settings are kept and apply again where it is available."
              : "Finishing pass applied to the whole frame — grain is deterministic from track time in both preview and export."}
          </p>
        </>
      ),
    },
    {
      id: "Layers",
      title: "Layers",
      tab: "scene",
      search: "layers text image overlay album art drawn over visuals",
      standalone: true,
      body: (
        <LayersPanel
          layers={props.overlayLayers}
          assets={props.assets}
          hasCoverArt={props.hasCoverArt}
          onAddText={props.onAddTextLayer}
          onAddImage={props.onAddImageLayer}
          onAddAlbumArt={props.onAddAlbumArtLayer}
          onUpdate={props.onUpdateLayer}
          onRemove={props.onRemoveLayer}
        />
      ),
    },
    // ---------------- Text ----------------
    {
      id: "Lyrics",
      title: "Lyrics",
      tab: "text",
      search:
        "lyrics lrc srt karaoke position animation slide pop size fade color import timed generate ai whisper local transcribe vocals",
      body: (
        <>
          <div className="save-look-row">
            {props.lyricFileName ? (
              <span className="user-chip-wrap">
                <span className="style-chip user" title="Loaded timed lyrics">
                  {props.lyricFileName}
                </span>
                <button
                  className="chip-x"
                  title="Remove lyrics"
                  aria-label="Remove lyrics"
                  onClick={props.onClearLyrics}
                >
                  ✕
                </button>
              </span>
            ) : (
              <label
                className="text-btn"
                title="Import timed lyrics (.lrc from any lyrics site, or .srt) — drawn as a karaoke overlay, identical in exports"
              >
                + Import lyrics…
                <input
                  type="file"
                  accept=".lrc,.srt"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) props.onImportLyrics(f);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
          {props.lyricFileName && (
            <>
              <ToggleRow
                label="Show"
                hint="Draw the active lyric line over the visual"
                checked={props.lyricStyle.enabled}
                onChange={(v) => props.onLyricStyle({ enabled: v })}
                onHint={setHint}
              />
              <SelectRow
                label="Position"
                hint="Where the lines sit in the frame"
                value={props.lyricStyle.position}
                onChange={(position) => props.onLyricStyle({ position })}
                onHint={setHint}
                options={[
                  { value: "bottom" as const, label: "Bottom" },
                  { value: "center" as const, label: "Center" },
                  { value: "top" as const, label: "Top" },
                ]}
              />
              <SelectRow
                label="Animation"
                hint="How each line enters — plain fade, slide up, or a scale pop"
                value={props.lyricStyle.anim ?? "plain"}
                onChange={(anim) => props.onLyricStyle({ anim })}
                onHint={setHint}
                options={LYRIC_ANIMS.map((a) => ({
                  value: a,
                  label:
                    a === "plain"
                      ? "Plain"
                      : a === "slide"
                        ? "Slide up"
                        : a === "pop"
                          ? "Pop"
                          : "Karaoke",
                }))}
              />
              <SliderRow
                label="Size"
                hint="Lyric text size"
                min={0.5}
                max={2}
                step={0.05}
                value={props.lyricStyle.size}
                onChange={(v) => props.onLyricStyle({ size: v })}
                onHint={setHint}
              />
              <SliderRow
                label="Fade"
                hint="Cross-fade time between lines, in seconds"
                min={0}
                max={1}
                step={0.05}
                value={props.lyricStyle.fadeSec}
                onChange={(v) => props.onLyricStyle({ fadeSec: v })}
                onHint={setHint}
              />
              <ColorRow
                label="Color"
                hint="Lyric text color"
                value={props.lyricStyle.color}
                onChange={(color) => props.onLyricStyle({ color })}
                onHint={setHint}
              />
            </>
          )}
          {!props.lyricFileName && (
            <p className="section-hint">
              Drop an .lrc or .srt on the window (or import here) — the current line follows the
              music, karaoke-style, live and in every export.
            </p>
          )}
          {/* Local automatic lyrics (FEAT-004): generate an .lrc from the
              loaded track — the result lands exactly where an import would. */}
          {!props.lyricFileName && <LyricsGenPanel />}
        </>
      ),
    },
    {
      id: "LyricsEdit",
      title: "Edit lyrics",
      tab: "text",
      search:
        "edit lyrics correct fix words timing nudge split merge insert delete line word karaoke " +
        "confidence flagged re-align align save lrc export undo redo",
      // Store-connected (LyricsGenPanel idiom): the editor re-renders on its
      // own lyric edits without dragging the whole memoized panel along.
      body: <LyricsEditPanel />,
    },
    {
      id: "Audiogram",
      title: "Audiogram",
      tab: "text",
      search: "audiogram progress bar time readout waveform strip position accent podcast reel",
      body: (
        <>
          <p className="section-hint">
            Overlay elements driven by the track — a progress bar, a time readout, a mini-waveform
            strip. The podcast/reel look; drawn identically in exports.
          </p>
          <ToggleRow
            label="Progress bar"
            hint="A thin played/remaining bar driven by the track position"
            checked={props.audiogram.progressBar}
            onChange={(v) => props.onAudiogram({ progressBar: v })}
            onHint={setHint}
          />
          <ToggleRow
            label="Time readout"
            hint="Elapsed / total time, drawn as text"
            checked={props.audiogram.timeReadout}
            onChange={(v) => props.onAudiogram({ timeReadout: v })}
            onHint={setHint}
          />
          <ToggleRow
            label="Waveform strip"
            hint="A mini waveform overview with a moving playhead"
            checked={props.audiogram.waveformStrip}
            onChange={(v) => props.onAudiogram({ waveformStrip: v })}
            onHint={setHint}
          />
          {(props.audiogram.progressBar ||
            props.audiogram.timeReadout ||
            props.audiogram.waveformStrip) && (
            <>
              <SelectRow
                label="Position"
                hint="Which edge of the frame the audiogram elements sit against"
                value={props.audiogram.position}
                onChange={(position) => props.onAudiogram({ position })}
                onHint={setHint}
                options={[
                  { value: "bottom" as const, label: "Bottom" },
                  { value: "top" as const, label: "Top" },
                ]}
              />
              <ColorRow
                label="Accent"
                hint="Bar fill, playhead and played-waveform color"
                value={props.audiogram.color}
                onChange={(color) => props.onAudiogram({ color })}
                onHint={setHint}
              />
            </>
          )}
        </>
      ),
    },
    // ---------------- Live ----------------
    {
      id: "Live",
      title: "Live",
      tab: "live",
      search: "live switch quantize off beat bar boundary ableton number keys performance",
      body: (
        <>
          <Segmented
            value={props.switchQuantize}
            onChange={props.onSwitchQuantize}
            onHint={setHint}
            ariaLabel="Switch quantize"
            options={QUANTIZE_MODES.map((m) => ({
              value: m,
              label: m === "off" ? "Off" : m === "beat" ? "Beat" : "Bar",
              hint:
                m === "off"
                  ? "Mode switches happen instantly"
                  : `Mode switches wait for the next ${m} before taking over`,
            }))}
          />
          <p className="section-hint">
            Switch quantize — number keys 1–9 (or a mode chip) jump to a visual; with Beat/Bar the
            switch lands on the next boundary, Ableton-style. Live only; exports are unaffected.
          </p>
        </>
      ),
    },
    ...(props.midiSupported
      ? [
          {
            id: "MIDI",
            title: "MIDI",
            tab: "live" as const,
            search: "midi controller cc note learn knob fader device mapping performance",
            headerExtra: props.midiEnabled ? (
              <button
                className="text-btn"
                title="Stop listening to MIDI"
                onClick={props.onDisableMidi}
              >
                Disable
              </button>
            ) : undefined,
            body: !props.midiEnabled ? (
              <>
                <div className="save-look-row">
                  <button
                    className="text-btn"
                    title="Grant MIDI access and start listening"
                    onClick={props.onEnableMidi}
                  >
                    Enable MIDI…
                  </button>
                </div>
                <p className="section-hint">
                  Map a controller's knobs to any setting and its notes to visual modes. Live
                  performance only — exports are unaffected.
                </p>
              </>
            ) : (
              <>
                <p className="section-hint">
                  {props.midiDevices.length
                    ? `Connected: ${props.midiDevices.join(", ")}`
                    : "No MIDI inputs detected — plug one in."}
                </p>
                <div className="save-look-row">
                  <select
                    className="select"
                    value={midiParam || props.preset.params[0]?.key || ""}
                    title="Which setting a knob/fader should control"
                    onChange={(e) => setMidiParam(e.target.value)}
                  >
                    {paramGroupViews.map(({ group, params }) => (
                      <optgroup key={group.id} label={group.label}>
                        {params.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button
                    className="text-btn"
                    title="Then move a knob/fader on your controller to bind it"
                    onClick={() => {
                      if (props.midiLearn?.kind === "cc") {
                        props.onMidiLearn(null);
                        return;
                      }
                      const key = midiParam || props.preset.params[0]?.key;
                      const spec = allParams(props.preset).find((p) => p.key === key);
                      if (spec)
                        props.onMidiLearn({ kind: "cc", param: key, min: spec.min, max: spec.max });
                    }}
                  >
                    {props.midiLearn?.kind === "cc" ? "Move a knob…" : "Learn CC"}
                  </button>
                </div>
                <div className="save-look-row">
                  <button
                    className="text-btn"
                    title={`Bind a note to switch to ${props.preset.name}`}
                    onClick={() =>
                      props.midiLearn?.kind === "note"
                        ? props.onMidiLearn(null)
                        : props.onMidiLearn({ kind: "note", presetId: props.preset.id })
                    }
                  >
                    {props.midiLearn?.kind === "note"
                      ? "Play a note…"
                      : `Learn note → ${props.preset.name}`}
                  </button>
                </div>
                {props.midiBindings.map((b) => {
                  const id = bindingId(b);
                  const label =
                    b.kind === "cc"
                      ? `CC ${b.cc} → ${allParams(props.preset).find((p) => p.key === b.param)?.label ?? b.param}`
                      : `Note ${b.note} → ${b.presetId}`;
                  return (
                    <div key={id} className="mod-row">
                      <span className="row-label" style={{ flex: 1 }}>
                        {label}
                      </span>
                      <button
                        className="chip-x"
                        title="Remove this binding"
                        aria-label={`Remove ${label}`}
                        onClick={() => props.onRemoveMidiBinding(id)}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </>
            ),
          } satisfies SectionDef,
        ]
      : []),
  ];

  const visibleSections = sections.filter((s) =>
    searching ? s.search.includes(q) : s.tab === tab,
  );

  return (
    <aside className="chrome params-panel">
      <div className="panel-header">
        <span className="panel-heading">Visual settings</span>
        <button className="icon-btn subtle" title="Close (G)" onClick={props.onClose}>
          <IconClose size={16} />
        </button>
      </div>

      <div className="panel-tabs">
        <Segmented
          value={tab}
          onChange={changeTab}
          onHint={setHint}
          ariaLabel="Settings tab"
          options={PARAMS_TABS.map((t) => ({ value: t.id, label: t.label, hint: t.hint }))}
        />
      </div>

      <input
        type="search"
        className="panel-search"
        placeholder="Search settings…"
        value={query}
        aria-label="Search settings"
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="panel-scroll">
        {searching && visibleSections.length > 0 && (
          <p className="search-summary">
            {visibleSections.length === 1
              ? "1 section matches"
              : `${visibleSections.length} sections match`}{" "}
            “{query.trim()}” — tabs are bypassed while searching.
          </p>
        )}
        {visibleSections.map((s) =>
          s.standalone ? (
            <Fragment key={s.id}>{s.body}</Fragment>
          ) : (
            <CollapsibleSection
              key={s.id}
              title={s.title}
              open={searching ? true : !collapsed.includes(s.id)}
              onToggle={searching ? undefined : (open) => toggleCollapsed(s.id, open)}
              headerExtra={s.headerExtra}
            >
              {s.body}
            </CollapsibleSection>
          ),
        )}
        {searching && visibleSections.length === 0 && (
          <p className="panel-empty">No settings match “{query.trim()}”.</p>
        )}
      </div>

      <div className="panel-footer">
        {/* The backend id is developer shorthand — fine as a badge while it
            reads "webgpu" and everything works, useless as the ONLY signal
            that the app has quietly stopped drawing what you asked for (F1).
            On the fallback it says so in words, in the app's warning colour. */}
        <span
          className={`renderer-badge ${props.simplifiedRenderer ? "danger" : ""}`}
          title={
            props.simplifiedRenderer
              ? "Simplified renderer — hardware rendering (WebGPU) is unavailable, so every mode draws the same spectrum bars and video export is off"
              : "Active render backend"
          }
        >
          {props.simplifiedRenderer ? "simplified" : props.rendererKind}
        </span>
        {props.bpm !== null && props.bpm > 0 && (
          <span className="renderer-badge" title="Detected tempo (beat grid)">
            {props.bpm.toFixed(props.bpm % 1 === 0 ? 0 : 1)} BPM
          </span>
        )}
        {props.keyName && (
          <span className="renderer-badge" title="Detected musical key (Krumhansl profile match)">
            {props.keyName}
          </span>
        )}
        {props.lufs !== null && (
          <span
            className="renderer-badge"
            title="Momentary loudness (BS.1770). Streaming targets sit around -14 LUFS."
          >
            {props.lufs <= -70 ? "−∞" : props.lufs.toFixed(1)} LUFS
          </span>
        )}
        <span className={`footer-hint ${hint ? "is-hint" : ""}`}>
          {hint ?? "Hover a setting to see what it does"}
        </span>
      </div>
    </aside>
  );
});
