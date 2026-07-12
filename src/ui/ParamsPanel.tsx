import type { BgMode, BgSettings, ParamValues, PresetDef } from "../render/types";
import { BG_PRESET, BG_SOLID, BG_TRANSPARENT } from "../render/types";
import { Slider } from "./Slider";
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

const BG_OPTIONS: Array<{ mode: BgMode; label: string }> = [
  { mode: BG_PRESET, label: "Animated" },
  { mode: BG_SOLID, label: "Solid" },
  { mode: BG_TRANSPARENT, label: "Transparent" },
];

/** Right-hand settings panel: active preset parameters + background. */
export function ParamsPanel(props: {
  preset: PresetDef;
  params: ParamValues;
  onParam: (key: string, value: number) => void;
  onReset: () => void;
  bg: BgSettings;
  onBg: (bg: BgSettings) => void;
  rendererKind: string;
  onClose: () => void;
}) {
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
            <button className="text-btn" onClick={props.onReset}>
              Reset
            </button>
          </div>
          {props.preset.params.map((p) => {
            const isToggle = p.step === 1 && p.min === 0 && p.max === 1;
            const value = props.params[p.key] ?? p.default;
            return isToggle ? (
              <label key={p.key} className="row toggle-row">
                <span className="row-label">{p.label}</span>
                <button
                  className={`switch ${value > 0.5 ? "on" : ""}`}
                  role="switch"
                  aria-checked={value > 0.5}
                  onClick={() => props.onParam(p.key, value > 0.5 ? 0 : 1)}
                >
                  <span className="knob" />
                </button>
              </label>
            ) : (
              <label key={p.key} className="row param-row">
                <span className="row-label">{p.label}</span>
                <Slider
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={value}
                  onChange={(v) => props.onParam(p.key, v)}
                />
                <span className="row-value">
                  {value.toFixed(p.step < 1 ? 2 : 0)}
                </span>
              </label>
            );
          })}
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
                onChange={(e) =>
                  props.onBg({ ...props.bg, color: hexToRgb(e.target.value) })
                }
                title="Custom background color"
              />
              {["#000000", "#ffffff", "#00b140", "#ff00ff"].map((hex) => (
                <button
                  key={hex}
                  className="swatch"
                  style={{ background: hex }}
                  title={hex === "#00b140" ? "Chroma green" : hex === "#ff00ff" ? "Chroma magenta" : hex}
                  onClick={() => props.onBg({ ...props.bg, color: hexToRgb(hex) })}
                />
              ))}
            </div>
          )}
          {props.bg.mode === BG_TRANSPARENT && (
            <p className="section-hint">
              Preview shows a checkerboard. MP4 exports have no alpha channel —
              transparent renders over black; use solid green/magenta for
              editor keying.
            </p>
          )}
        </section>
      </div>

      <div className="panel-footer">
        <span className="renderer-badge" title="Active render backend">
          {props.rendererKind}
        </span>
        <span className="footer-hint">Params saved per preset</span>
      </div>
    </aside>
  );
}
