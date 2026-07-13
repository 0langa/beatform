import { useState } from "react";
import type { SyncMode, SyncSettings } from "../audio/types";
import type { BgMode, BgSettings, ParamSpec, ParamValues, PresetDef } from "../render/types";
import { BG_PRESET, BG_SOLID, BG_TRANSPARENT, defaultParams } from "../render/types";
import type { UserPreset } from "../state/userPresets";
import { ASPECTS, type Aspect } from "../state/project";
import type { ImageLayer, OverlayAsset, OverlayLayer, TextLayer } from "../render/overlay";
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
  aspect: Aspect;
  onAspect: (a: Aspect) => void;
  overlayLayers: OverlayLayer[];
  assets: Record<string, OverlayAsset>;
  hasCoverArt: boolean;
  onAddTextLayer: () => void;
  onAddImageLayer: () => void;
  onAddAlbumArtLayer: () => void;
  onUpdateLayer: (id: string, patch: Partial<TextLayer> | Partial<ImageLayer>) => void;
  onRemoveLayer: (id: string) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(
    () => localStorage.getItem("viz.advancedOpen") === "1",
  );
  const [hint, setHint] = useState<string | null>(null);
  const [savingLook, setSavingLook] = useState(false);
  const [lookName, setLookName] = useState("");
  const toggleAdvanced = () => {
    setShowAdvanced((v) => {
      localStorage.setItem("viz.advancedOpen", v ? "0" : "1");
      return !v;
    });
  };
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
            title="0 = punchy and instant, 1 = long smooth glides"
            onPointerEnter={() =>
              setHint("How smoothly the visuals follow the source — 0 = punchy, 1 = long glides")
            }
            onPointerLeave={() => setHint(null)}
          >
            <span className="row-label">Smoothing</span>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={props.sync.smooth}
              onChange={(v) => props.onSync({ ...props.sync, smooth: v })}
            />
            <span className="row-value">{props.sync.smooth.toFixed(2)}</span>
          </label>
          <p className="section-hint">
            What this visual reacts to. Saved per mode; exports use it too.
          </p>
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
                onClick={() => props.onBg({ ...props.bg, mode: o.mode })}
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
          {props.bg.mode === BG_TRANSPARENT && (
            <p className="section-hint">
              Preview shows a checkerboard. MP4 exports have no alpha channel — transparent renders
              over black; use solid green/magenta for editor keying.
            </p>
          )}
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
        <span className={`footer-hint ${hint ? "is-hint" : ""}`}>
          {hint ?? "Hover a setting to see what it does"}
        </span>
      </div>
    </aside>
  );
}
