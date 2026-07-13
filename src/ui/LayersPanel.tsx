import { useState } from "react";
import type {
  ImageLayer,
  OverlayAnchor,
  OverlayAsset,
  OverlayLayer,
  TextLayer,
} from "../render/overlay";
import { Slider } from "./Slider";

const ANCHOR_GRID: OverlayAnchor[] = ["tl", "tc", "tr", "cl", "cc", "cr", "bl", "bc", "br"];

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

function AnchorPicker(props: { value: OverlayAnchor; onChange: (a: OverlayAnchor) => void }) {
  return (
    <div className="anchor-grid" title="Where the layer attaches on screen">
      {ANCHOR_GRID.map((a) => (
        <button
          key={a}
          className={`anchor-cell ${props.value === a ? "active" : ""}`}
          onClick={() => props.onChange(a)}
        />
      ))}
    </div>
  );
}

function LayerSlider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="row param-row">
      <span className="row-label">{props.label}</span>
      <Slider
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={props.onChange}
      />
      <span className="row-value">{props.value.toFixed(2)}</span>
    </label>
  );
}

function TextLayerEditor(props: { layer: TextLayer; onChange: (p: Partial<TextLayer>) => void }) {
  const l = props.layer;
  return (
    <div className="layer-editor">
      <input
        className="look-name-input"
        value={l.text}
        placeholder="Text — use {title} and {artist}"
        maxLength={200}
        onChange={(e) => props.onChange({ text: e.target.value })}
      />
      <div className="layer-editor-grid">
        <AnchorPicker value={l.anchor} onChange={(anchor) => props.onChange({ anchor })} />
        <div className="layer-editor-col">
          <LayerSlider
            label="Size"
            min={0.01}
            max={0.3}
            step={0.005}
            value={l.size}
            onChange={(size) => props.onChange({ size })}
          />
          <LayerSlider
            label="Opacity"
            min={0}
            max={1}
            step={0.01}
            value={l.opacity}
            onChange={(opacity) => props.onChange({ opacity })}
          />
          <LayerSlider
            label="Glow"
            min={0}
            max={1}
            step={0.01}
            value={l.glow}
            onChange={(glow) => props.onChange({ glow })}
          />
        </div>
      </div>
      <LayerSlider
        label="Offset X"
        min={-0.5}
        max={0.5}
        step={0.005}
        value={l.offset[0]}
        onChange={(x) => props.onChange({ offset: [x, l.offset[1]] })}
      />
      <LayerSlider
        label="Offset Y"
        min={-0.5}
        max={0.5}
        step={0.005}
        value={l.offset[1]}
        onChange={(y) => props.onChange({ offset: [l.offset[0], y] })}
      />
      <LayerSlider
        label="Spacing"
        min={-0.1}
        max={0.5}
        step={0.01}
        value={l.letterSpacing}
        onChange={(letterSpacing) => props.onChange({ letterSpacing })}
      />
      <div className="row layer-flags">
        <input
          type="color"
          className="bg-color"
          value={rgbToHex(l.color)}
          onChange={(e) => props.onChange({ color: hexToRgb(e.target.value) })}
          title="Text color"
        />
        <button
          className={`style-chip ${l.weight >= 700 ? "active" : ""}`}
          title="Bold"
          onClick={() => props.onChange({ weight: l.weight >= 700 ? 400 : 700 })}
        >
          Bold
        </button>
        <button
          className={`style-chip ${l.uppercase ? "active" : ""}`}
          title="ALL CAPS"
          onClick={() => props.onChange({ uppercase: !l.uppercase })}
        >
          AA
        </button>
        <input
          className="look-name-input font-input"
          value={l.font}
          maxLength={100}
          title="Font family (system font name)"
          onChange={(e) => props.onChange({ font: e.target.value })}
        />
      </div>
    </div>
  );
}

function ImageLayerEditor(props: {
  layer: ImageLayer;
  onChange: (p: Partial<ImageLayer>) => void;
}) {
  const l = props.layer;
  return (
    <div className="layer-editor">
      <div className="layer-editor-grid">
        <AnchorPicker value={l.anchor} onChange={(anchor) => props.onChange({ anchor })} />
        <div className="layer-editor-col">
          <LayerSlider
            label="Size"
            min={0.02}
            max={1}
            step={0.01}
            value={l.size}
            onChange={(size) => props.onChange({ size })}
          />
          <LayerSlider
            label="Opacity"
            min={0}
            max={1}
            step={0.01}
            value={l.opacity}
            onChange={(opacity) => props.onChange({ opacity })}
          />
          <LayerSlider
            label="Corners"
            min={0}
            max={0.5}
            step={0.01}
            value={l.rounded}
            onChange={(rounded) => props.onChange({ rounded })}
          />
        </div>
      </div>
      <LayerSlider
        label="Offset X"
        min={-0.5}
        max={0.5}
        step={0.005}
        value={l.offset[0]}
        onChange={(x) => props.onChange({ offset: [x, l.offset[1]] })}
      />
      <LayerSlider
        label="Offset Y"
        min={-0.5}
        max={0.5}
        step={0.005}
        value={l.offset[1]}
        onChange={(y) => props.onChange({ offset: [l.offset[0], y] })}
      />
    </div>
  );
}

/** Overlay layer list + editors: text, logo, album art over the visuals. */
export function LayersPanel(props: {
  layers: OverlayLayer[];
  assets: Record<string, OverlayAsset>;
  hasCoverArt: boolean;
  onAddText: () => void;
  onAddImage: () => void;
  onAddAlbumArt: () => void;
  onUpdate: (id: string, patch: Partial<TextLayer> | Partial<ImageLayer>) => void;
  onRemove: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section className="panel-section">
      <div className="section-head">
        <span className="section-title">Layers</span>
      </div>
      {props.layers.length === 0 && (
        <p className="section-hint">Text and images drawn over the visuals — in exports too.</p>
      )}
      {props.layers.map((l) => {
        const label =
          l.type === "text" ? l.text || "Text" : (props.assets[l.assetId]?.name ?? "Image");
        return (
          <div key={l.id} className="layer-row-wrap">
            <div className="row layer-row">
              <button
                className={`layer-name ${openId === l.id ? "open" : ""}`}
                title="Edit this layer"
                onClick={() => setOpenId(openId === l.id ? null : l.id)}
              >
                <span className="layer-kind">{l.type === "text" ? "T" : "▣"}</span>
                {label}
              </button>
              <button className="chip-x" title="Remove layer" onClick={() => props.onRemove(l.id)}>
                ✕
              </button>
            </div>
            {openId === l.id &&
              (l.type === "text" ? (
                <TextLayerEditor layer={l} onChange={(p) => props.onUpdate(l.id, p)} />
              ) : (
                <ImageLayerEditor layer={l} onChange={(p) => props.onUpdate(l.id, p)} />
              ))}
          </div>
        );
      })}
      <div className="save-look-row">
        <button
          className="text-btn"
          title="Add a text layer ({title}, {artist} auto-fill)"
          onClick={props.onAddText}
        >
          + Text
        </button>
        <button
          className="text-btn"
          title="Add a logo or image from a file"
          onClick={props.onAddImage}
        >
          + Image…
        </button>
        {props.hasCoverArt && (
          <button
            className="text-btn"
            title="Add the track's embedded cover art"
            onClick={props.onAddAlbumArt}
          >
            + Album art
          </button>
        )}
      </div>
    </section>
  );
}
