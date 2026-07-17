import { useState } from "react";
import type { SyncMode, SyncSettings } from "../audio/types";
import type {
  BgMode,
  BgSettings,
  MotionSettings,
  ParamSpec,
  ParamValues,
  PostSettings,
  PresetDef,
} from "../render/types";
import {
  BG_IMAGE,
  BG_PRESET,
  BG_SOLID,
  BG_TRANSPARENT,
  DEFAULT_MOTION,
  DEFAULT_POST,
  defaultParams,
} from "../render/types";
import type { UserPreset } from "../state/userPresets";
import { ASPECTS, type Aspect, type ProjectDocument } from "../state/project";
import { FACTORY_THEMES } from "../state/factoryThemes";
import type { ThemeMeta } from "../state/themes";
import type { ImageLayer, OverlayAsset, OverlayLayer, TextLayer } from "../render/overlay";
import { MOD_SOURCES, type ModRoute, type ModSource } from "../state/modMatrix";
import { MAX_STEMS, STEM_TRACK_KEYS, type StemEntry, type StemSlot } from "../audio/stems";
import type { LyricStyle } from "../state/lyrics";
import { allParams } from "../render/types";
import { Slider } from "./Slider";
import { LayersPanel } from "./LayersPanel";
import { IconChevronRight, IconClose } from "./Icons";

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

const BG_OPTIONS: Array<{ mode: BgMode; label: string; hint: string }> = [
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
    hint: "Your artwork (or the album art) behind the visualization — cover-fit, with blur and dim",
  },
];

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
    hint: "Deterministic film grain — identical in preview and export",
  },
];

function ParamRow(props: {
  spec: ParamSpec;
  value: number;
  onChange: (v: number) => void;
  onHint: (hint: string | null) => void;
}) {
  const { spec: p, value } = props;
  const isToggle = p.step === 1 && p.min === 0 && p.max === 1;
  const hintProps = {
    title: p.hint,
    onPointerEnter: () => props.onHint(p.hint ?? null),
    onPointerLeave: () => props.onHint(null),
  };
  return isToggle ? (
    <label className="row toggle-row" {...hintProps}>
      <span className="row-label">{p.label}</span>
      <button
        className={`switch ${value > 0.5 ? "on" : ""}`}
        role="switch"
        aria-checked={value > 0.5}
        onClick={() => props.onChange(value > 0.5 ? 0 : 1)}
      >
        <span className="knob" />
      </button>
    </label>
  ) : (
    <label className="row param-row" {...hintProps}>
      <span className="row-label">{p.label}</span>
      <Slider min={p.min} max={p.max} step={p.step} value={value} onChange={props.onChange} />
      <span className="row-value">{value.toFixed(p.step < 1 ? 2 : 0)}</span>
    </label>
  );
}

/** Right-hand settings panel: styles, preset parameters, background. */
export function ParamsPanel(props: {
  preset: PresetDef;
  params: ParamValues;
  onParam: (key: string, value: number) => void;
  onApplyStyle: (values: Partial<ParamValues>) => void;
  onReset: () => void;
  bg: BgSettings;
  onBg: (bg: BgSettings) => void;
  onPickBackgroundImage: () => void;
  onUseAlbumArtBackground: () => void;
  sync: SyncSettings;
  onSync: (sync: SyncSettings) => void;
  rendererKind: string;
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
  /** Save the whole current setup as a shareable .avtheme file. */
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
  mods: ModRoute[];
  /** Imported stems (analysis-only modulation sources). */
  stems: StemEntry[];
  stemAnalyzing: string | null;
  onAddStem: (file: File) => void;
  onRemoveStem: (slot: StemSlot) => void;
  onAddMod: (source: ModSource, param: string) => void;
  onUpdateMod: (id: string, patch: Partial<ModRoute>) => void;
  onRemoveMod: (id: string) => void;
  /** Timed lyrics: loaded file name (null = none) + display style. */
  lyricFileName: string | null;
  lyricStyle: LyricStyle;
  onImportLyrics: (file: File) => void;
  onClearLyrics: () => void;
  onLyricStyle: (patch: Partial<LyricStyle>) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(
    () => localStorage.getItem("viz.advancedOpen") === "1",
  );
  const [hint, setHint] = useState<string | null>(null);
  const [savingLook, setSavingLook] = useState(false);
  const [lookName, setLookName] = useState("");
  const [savingTheme, setSavingTheme] = useState(false);
  const [themeName, setThemeName] = useState("");
  const [themeAuthor, setThemeAuthor] = useState("");
  const toggleAdvanced = () => {
    setShowAdvanced((v) => {
      localStorage.setItem("viz.advancedOpen", v ? "0" : "1");
      return !v;
    });
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

  // A style is "active" when current params exactly equal defaults + values
  const defaults = defaultParams(props.preset);
  const activeStyleId = (props.preset.styles ?? []).find((s) => {
    const merged = { ...defaults, ...s.values };
    return Object.keys(merged).every((k) => (props.params[k] ?? defaults[k]) === merged[k]);
  })?.id;

  return (
    <aside className="chrome params-panel">
      <div className="panel-header">
        <span className="panel-heading">Visual settings</span>
        <button className="icon-btn subtle" title="Close (G)" onClick={props.onClose}>
          <IconClose size={16} />
        </button>
      </div>

      <div className="panel-scroll">
        <section className="panel-section">
          <div className="section-head">
            <span className="section-title">{props.preset.name}</span>
            <button
              className="text-btn"
              onClick={props.onReset}
              title="Back to factory defaults (all settings incl. advanced)"
            >
              Reset
            </button>
          </div>
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
                      onClick={() => props.onDeleteUserPreset(p.id)}
                    >
                      ✕
                    </button>
                    <button
                      className="chip-x"
                      title={`Export "${p.name}" as .avpreset file`}
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
                  title="Import a .avpreset look file"
                  onClick={props.onImportUserPreset}
                >
                  Import…
                </button>
              </div>
            )}
          </div>

          {props.preset.params.map((p) => (
            <ParamRow
              key={p.key}
              spec={p}
              value={props.params[p.key] ?? p.default}
              onChange={(v) => props.onParam(p.key, v)}
              onHint={setHint}
            />
          ))}

          {advanced.length > 0 && (
            <>
              <button
                className={`advanced-toggle ${showAdvanced ? "open" : ""}`}
                onClick={toggleAdvanced}
                title="Expert knobs — every internal constant of this visual"
              >
                <IconChevronRight size={13} />
                Advanced
                <span className="advanced-count">
                  {changedCount > 0 ? `${changedCount} changed` : `${advanced.length}`}
                </span>
              </button>
              {showAdvanced && (
                <div className="advanced-body">
                  {advanced.map((p) => (
                    <ParamRow
                      key={p.key}
                      spec={p}
                      value={props.params[p.key] ?? p.default}
                      onChange={(v) => props.onParam(p.key, v)}
                      onHint={setHint}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <section className="panel-section">
          <div className="section-head">
            <span className="section-title">Templates</span>
          </div>
          <p className="section-hint">
            Complete looks — visual, colors, sync, post — in one click. Drop any .avtheme file onto
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
                title="Save EVERYTHING currently set up (visual, layers, timeline, post) as a shareable .avtheme file (CC0)"
                onClick={() => setSavingTheme(true)}
              >
                + Save as template…
              </button>
            </div>
          )}
        </section>

        <section className="panel-section">
          <div className="section-head">
            <span className="section-title">Motion</span>
            {motionChanged && (
              <button
                className="text-btn"
                title="Back to normal motion (100% everywhere)"
                onClick={() => props.onMotion({ ...DEFAULT_MOTION })}
              >
                Reset
              </button>
            )}
          </div>
          <label
            className="row param-row"
            title="Master rotation — 0% stops all spinning in every mode"
            onPointerEnter={() =>
              setHint("Global spin master — 0% stops all rotation, 100% = normal, up to 200%")
            }
            onPointerLeave={() => setHint(null)}
          >
            <span className="row-label">Rotation</span>
            <Slider
              min={0}
              max={2}
              step={0.05}
              value={props.motion.rotation}
              onChange={(v) => props.onMotion({ rotation: v })}
            />
            <span className="row-value">{Math.round(props.motion.rotation * 100)}%</span>
          </label>
          <label
            className="row param-row"
            title="Master pulse — 0% removes all beat pumping / zoom in every mode"
            onPointerEnter={() =>
              setHint("Global pulse master — 0% removes beat pumping, 100% = normal, up to 200%")
            }
            onPointerLeave={() => setHint(null)}
          >
            <span className="row-label">Pulse</span>
            <Slider
              min={0}
              max={2}
              step={0.05}
              value={props.motion.pulse}
              onChange={(v) => props.onMotion({ pulse: v })}
            />
            <span className="row-value">{Math.round(props.motion.pulse * 100)}%</span>
          </label>
          <label
            className="row param-row"
            title="How many bars / points / segments the visual draws, where the mode supports it"
            onPointerEnter={() =>
              setHint("Detail — number of bars/points/segments (modes that support it)")
            }
            onPointerLeave={() => setHint(null)}
          >
            <span className="row-label">Detail</span>
            <Slider
              min={0}
              max={1}
              step={0.02}
              value={props.motion.detail}
              onChange={(v) => props.onMotion({ detail: v })}
            />
            <span className="row-value">{Math.round(props.motion.detail * 100)}%</span>
          </label>
          <label
            className="row param-row"
            title="Smooths the spectrum shape — 0% = hard bins, 100% = a flowing curve"
            onPointerEnter={() =>
              setHint("Spectrum smooth — rounds the spectrum from hard bins toward a flowing curve")
            }
            onPointerLeave={() => setHint(null)}
          >
            <span className="row-label">Spectrum smooth</span>
            <Slider
              min={0}
              max={1}
              step={0.02}
              value={props.motion.spectrumSmooth}
              onChange={(v) => props.onMotion({ spectrumSmooth: v })}
            />
            <span className="row-value">{Math.round(props.motion.spectrumSmooth * 100)}%</span>
          </label>
          <p className="section-hint">
            Global motion — applies to every mode that spins, pulses or draws discrete elements.
            Exports match.
          </p>
        </section>

        <section className="panel-section">
          <div className="section-head">
            <span className="section-title">Sync</span>
          </div>
          <div className="sync-grid">
            {SYNC_OPTIONS.map((o) => (
              <button
                key={o.mode}
                className={`segment ${props.sync.mode === o.mode ? "active" : ""}`}
                title={o.hint}
                onPointerEnter={() => setHint(o.hint)}
                onPointerLeave={() => setHint(null)}
                onClick={() => props.onSync({ ...props.sync, mode: o.mode })}
              >
                {o.label}
              </button>
            ))}
          </div>
          <label
            className="row param-row"
            title="Overall smoothing — 0 = punchy and instant, 1 = long smooth glides. Sets both attack and release."
            onPointerEnter={() =>
              setHint(
                "Overall response — 0 = punchy, 1 = long glides. Sets attack + release together",
              )
            }
            onPointerLeave={() => setHint(null)}
          >
            <span className="row-label">Smoothing</span>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={props.sync.smooth}
              onChange={(v) =>
                props.onSync({ ...props.sync, smooth: v, attack: undefined, release: undefined })
              }
            />
            <span className="row-value">{props.sync.smooth.toFixed(2)}</span>
          </label>
          <label
            className="row param-row"
            title="How fast the visuals rise on a hit — 0 = instant, 1 = slow swell"
            onPointerEnter={() =>
              setHint("Attack — how fast the reaction rises on a hit (0 = instant, 1 = slow)")
            }
            onPointerLeave={() => setHint(null)}
          >
            <span className="row-label">Attack</span>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={props.sync.attack ?? props.sync.smooth}
              onChange={(v) => props.onSync({ ...props.sync, attack: v })}
            />
            <span className="row-value">{(props.sync.attack ?? props.sync.smooth).toFixed(2)}</span>
          </label>
          <label
            className="row param-row"
            title="How slowly the visuals fall after a hit — 0 = instant, 1 = long glide out"
            onPointerEnter={() =>
              setHint("Release — how slowly the reaction falls after a hit (0 = instant, 1 = long)")
            }
            onPointerLeave={() => setHint(null)}
          >
            <span className="row-label">Release</span>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={props.sync.release ?? props.sync.smooth}
              onChange={(v) => props.onSync({ ...props.sync, release: v })}
            />
            <span className="row-value">
              {(props.sync.release ?? props.sync.smooth).toFixed(2)}
            </span>
          </label>
          <label
            className="row toggle-row"
            title="Connect the spectrum with smooth splines instead of hard-edged bins"
            onPointerEnter={() =>
              setHint("Spline-smoothed spectrum: curves instead of corners, in every visual")
            }
            onPointerLeave={() => setHint(null)}
          >
            <span className="row-label">Smooth curve</span>
            <button
              className={`switch ${props.smoothSpectrum ? "on" : ""}`}
              role="switch"
              aria-checked={props.smoothSpectrum}
              onClick={() => props.onSmoothSpectrum(!props.smoothSpectrum)}
            >
              <span className="knob" />
            </button>
          </label>
          <p className="section-hint">
            What this visual reacts to. Saved per mode; exports use it too.
          </p>
        </section>

        <section className="panel-section">
          <div className="section-head">
            <span className="section-title">Lyrics</span>
          </div>
          <div className="save-look-row">
            {props.lyricFileName ? (
              <span className="user-chip-wrap">
                <span className="style-chip user" title="Loaded timed lyrics">
                  {props.lyricFileName}
                </span>
                <button className="chip-x" title="Remove lyrics" onClick={props.onClearLyrics}>
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
              <label className="field">
                <span>Show</span>
                <input
                  type="checkbox"
                  checked={props.lyricStyle.enabled}
                  title="Draw the active lyric line over the visual"
                  onChange={(e) => props.onLyricStyle({ enabled: e.target.checked })}
                />
              </label>
              <label className="field">
                <span>Position</span>
                <select
                  className="select"
                  value={props.lyricStyle.position}
                  title="Where the lines sit in the frame"
                  onChange={(e) =>
                    props.onLyricStyle({ position: e.target.value as LyricStyle["position"] })
                  }
                >
                  <option value="bottom">Bottom</option>
                  <option value="center">Center</option>
                  <option value="top">Top</option>
                </select>
              </label>
              <div className="field">
                <span>Size</span>
                <Slider
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={props.lyricStyle.size}
                  onChange={(v) => props.onLyricStyle({ size: v })}
                />
              </div>
              <div className="field">
                <span>Fade</span>
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={props.lyricStyle.fadeSec}
                  onChange={(v) => props.onLyricStyle({ fadeSec: v })}
                />
              </div>
              <label className="field">
                <span>Color</span>
                <input
                  type="color"
                  value={props.lyricStyle.color}
                  title="Lyric text color"
                  onChange={(e) => props.onLyricStyle({ color: e.target.value })}
                />
              </label>
            </>
          )}
          {!props.lyricFileName && (
            <p className="section-hint">
              Drop an .lrc or .srt on the window (or import here) — the current line follows the
              music, karaoke-style, live and in every export.
            </p>
          )}
        </section>

        <section className="panel-section">
          <div className="section-head">
            <span className="section-title">Modulation</span>
          </div>
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
                  title="Remove this stem (routes to it go inert)"
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
                {allParams(props.preset).map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <Slider
                min={-1}
                max={1}
                step={0.01}
                value={r.amount}
                onChange={(amount) => props.onUpdateMod(r.id, { amount })}
              />
              <span className="row-value">{r.amount.toFixed(2)}</span>
              <button
                className="chip-x"
                title="Remove route"
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
        </section>

        <section className="panel-section">
          <div className="section-head">
            <span className="section-title">Frame</span>
          </div>
          <div className="segmented">
            {ASPECTS.map((a) => (
              <button
                key={a.id}
                className={`segment ${props.aspect === a.id ? "active" : ""}`}
                title={a.hint}
                onPointerEnter={() => setHint(a.hint)}
                onPointerLeave={() => setHint(null)}
                onClick={() => props.onAspect(a.id)}
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="section-hint">
            Frame shape for preview and export — 9:16 for Canvas/Shorts, 1:1 for posts.
          </p>
        </section>

        <section className="panel-section">
          <div className="section-head">
            <span className="section-title">Background</span>
          </div>
          <div className="segmented">
            {BG_OPTIONS.map((o) => (
              <button
                key={o.mode}
                className={`segment ${props.bg.mode === o.mode ? "active" : ""}`}
                title={o.hint}
                onPointerEnter={() => setHint(o.hint)}
                onPointerLeave={() => setHint(null)}
                onClick={() => {
                  if (o.mode === BG_IMAGE && !props.bg.image) props.onPickBackgroundImage();
                  else props.onBg({ ...props.bg, mode: o.mode });
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
          {props.bg.mode === BG_SOLID && (
            <div className="row color-row">
              <input
                type="color"
                className="bg-color"
                value={rgbToHex(props.bg.color)}
                onChange={(e) => props.onBg({ ...props.bg, color: hexToRgb(e.target.value) })}
                title="Custom background color"
              />
              {["#000000", "#ffffff", "#00b140", "#ff00ff"].map((hex) => (
                <button
                  key={hex}
                  className="swatch"
                  style={{ background: hex }}
                  title={
                    hex === "#00b140" ? "Chroma green" : hex === "#ff00ff" ? "Chroma magenta" : hex
                  }
                  onClick={() => props.onBg({ ...props.bg, color: hexToRgb(hex) })}
                />
              ))}
            </div>
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
              <label
                className="row param-row"
                title="Darken the image so the visualization stays readable"
              >
                <span className="row-label">Dim</span>
                <Slider
                  min={0}
                  max={0.9}
                  step={0.01}
                  value={props.bg.image.dim}
                  onChange={(dim) =>
                    props.onBg({ ...props.bg, image: { ...props.bg.image!, dim } })
                  }
                />
                <span className="row-value">{props.bg.image.dim.toFixed(2)}</span>
              </label>
              <label className="row param-row" title="Soften the image behind the visualization">
                <span className="row-label">Blur</span>
                <Slider
                  min={0}
                  max={60}
                  step={1}
                  value={props.bg.image.blur}
                  onChange={(blur) =>
                    props.onBg({ ...props.bg, image: { ...props.bg.image!, blur } })
                  }
                />
                <span className="row-value">{props.bg.image.blur.toFixed(0)}</span>
              </label>
            </>
          )}
          {props.bg.mode === BG_TRANSPARENT && (
            <p className="section-hint">
              Preview shows a checkerboard. MP4 exports have no alpha channel — transparent renders
              over black; use solid green/magenta for editor keying.
            </p>
          )}
        </section>

        <section className="panel-section">
          <div className="section-head">
            <span className="section-title">Post</span>
            {postChanged && (
              <button
                className="text-btn"
                title="Turn off all post-processing (neutral)"
                onClick={() => props.onPost({ ...DEFAULT_POST })}
              >
                Reset
              </button>
            )}
          </div>
          <label
            className="row toggle-row"
            title="ACES filmic tonemap — filmic contrast/rolloff on highlights"
            onPointerEnter={() =>
              setHint("Filmic (ACES) tonemap — cinematic contrast and highlight rolloff")
            }
            onPointerLeave={() => setHint(null)}
          >
            <span className="row-label">Filmic tonemap</span>
            <button
              className={`switch ${props.post.tonemap ? "on" : ""}`}
              role="switch"
              aria-checked={props.post.tonemap}
              onClick={() => props.onPost({ tonemap: !props.post.tonemap })}
            >
              <span className="knob" />
            </button>
          </label>
          {POST_SLIDERS.map((r) => (
            <label
              key={r.key}
              className="row param-row"
              title={r.hint}
              onPointerEnter={() => setHint(r.hint)}
              onPointerLeave={() => setHint(null)}
            >
              <span className="row-label">{r.label}</span>
              <Slider
                min={r.min}
                max={r.max}
                step={r.step}
                value={props.post[r.key]}
                onChange={(v) => props.onPost({ [r.key]: v })}
              />
              <span className="row-value">{props.post[r.key].toFixed(2)}</span>
            </label>
          ))}
          <p className="section-hint">
            Finishing pass applied to the whole frame — grain is deterministic, so preview and
            export match exactly.
          </p>
        </section>

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
      </div>

      <div className="panel-footer">
        <span className="renderer-badge" title="Active render backend">
          {props.rendererKind}
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
}
