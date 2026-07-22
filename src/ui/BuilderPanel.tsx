import { useState } from "react";
import {
  builderLayerType,
  newLayerId,
  BUILDER_LAYER_TYPES,
  BUILDER_MAX_LAYERS,
  type BuilderBlend,
  type BuilderLayer,
  type BuilderStack,
} from "../render/builder2";
import { ParamRow, SliderRow, Segmented } from "./kit";

const BLEND_OPTIONS: Array<{ value: BuilderBlend; label: string; hint: string }> = [
  {
    value: "normal",
    label: "Normal",
    hint: "Cross-fade this layer over the ones below by its opacity",
  },
  {
    value: "add",
    label: "Add",
    hint: "Add this layer's light on top — good for glows and particles",
  },
  {
    value: "screen",
    label: "Screen",
    hint: "Screen blend — brightens without blowing out, softer than Add",
  },
];

const deg = (v: number) => `${Math.round(v)}°`;

/**
 * Builder Studio layer-stack editor. Props-only (like LayersPanel): every
 * mutation rebuilds a NEW BuilderStack and hands it to onChange — the store
 * owns recompile/upload. Never mutates props.stack.
 */
export interface BuilderPanelProps {
  stack: BuilderStack;
  onChange: (stack: BuilderStack) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onHint?: (h: string | null) => void;
}

export function BuilderPanel(props: BuilderPanelProps) {
  const layers = props.stack.layers;
  const [selectedId, setSelectedId] = useState<string | null>(layers[0]?.id ?? null);
  const emitHint = props.onHint ?? (() => undefined);

  const commit = (next: BuilderLayer[]) => props.onChange({ layers: next });
  const patch = (id: string, p: Partial<BuilderLayer>) =>
    commit(layers.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const patchParam = (id: string, key: string, value: number) =>
    commit(layers.map((l) => (l.id === id ? { ...l, params: { ...l.params, [key]: value } } : l)));

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= layers.length) return;
    const next = layers.slice();
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };
  const duplicate = (i: number) => {
    if (layers.length >= BUILDER_MAX_LAYERS) return;
    const src = layers[i];
    const copy: BuilderLayer = { ...src, id: newLayerId(), params: { ...src.params } };
    const next = layers.slice();
    next.splice(i + 1, 0, copy);
    commit(next);
    setSelectedId(copy.id);
  };
  const remove = (id: string) => {
    commit(layers.filter((l) => l.id !== id));
    if (selectedId === id) setSelectedId(null);
  };
  const add = (type: string) => {
    if (layers.length >= BUILDER_MAX_LAYERS || !builderLayerType(type)) return;
    const t = builderLayerType(type)!;
    const created: BuilderLayer = {
      id: newLayerId(),
      type: t.type,
      enabled: true,
      opacity: 1,
      blend: "normal",
      hue: 210,
      hueSpread: 90,
      params: Object.fromEntries(t.params.map((p) => [p.key, p.default])),
    };
    commit([...layers, created]);
    setSelectedId(created.id);
  };

  const selected = layers.find((l) => l.id === selectedId) ?? null;
  const selectedType = selected ? builderLayerType(selected.type) : undefined;
  const atMax = layers.length >= BUILDER_MAX_LAYERS;

  return (
    <section className="panel-section builder-panel">
      <div className="section-head">
        <span className="section-title">Builder layers</span>
        <span className="builder-count">
          {layers.length}/{BUILDER_MAX_LAYERS}
        </span>
      </div>
      <p className="section-hint">
        Stack, blend and tune elements freely. The list runs drawn bottom → top: the first row is
        the backdrop, later rows layer over it. ▲▼ reorder, ⧉ duplicate, ✕ remove.
      </p>

      {layers.length === 0 && (
        <p className="section-hint">Empty stack — add a layer below to start building.</p>
      )}

      {layers.map((l, i) => {
        const label = builderLayerType(l.type)?.label ?? l.type;
        return (
          <div key={l.id} className="builder-row-wrap">
            <div className="row builder-row">
              <button
                className={`switch ${l.enabled ? "on" : ""}`}
                role="switch"
                aria-checked={l.enabled}
                title={l.enabled ? "Mute this layer" : "Enable this layer"}
                aria-label={`${l.enabled ? "Mute" : "Enable"} ${label}`}
                onClick={() => patch(l.id, { enabled: !l.enabled })}
              >
                <span className="knob" />
              </button>
              <button
                className={`builder-name ${selectedId === l.id ? "open" : ""} ${l.enabled ? "" : "muted"}`}
                title="Select this layer to edit it"
                onClick={() => setSelectedId(selectedId === l.id ? null : l.id)}
              >
                {label}
              </button>
              <button
                className="chip-x"
                title="Move down (toward the backdrop)"
                aria-label={`Move ${label} down`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ▲
              </button>
              <button
                className="chip-x"
                title="Move up (toward the top)"
                aria-label={`Move ${label} up`}
                disabled={i === layers.length - 1}
                onClick={() => move(i, 1)}
              >
                ▼
              </button>
              <button
                className="chip-x"
                title="Duplicate this layer"
                aria-label={`Duplicate ${label}`}
                disabled={atMax}
                onClick={() => duplicate(i)}
              >
                ⧉
              </button>
              <button
                className="chip-x"
                title="Remove this layer"
                aria-label={`Remove ${label}`}
                onClick={() => remove(l.id)}
              >
                ✕
              </button>
            </div>
            {selectedId === l.id && selectedType && (
              <div className="builder-editor">
                {selectedType.description && (
                  <p className="section-hint">{selectedType.description}</p>
                )}
                <label className="row">
                  <span className="row-label">Blend</span>
                  <Segmented
                    value={l.blend}
                    onChange={(blend) => patch(l.id, { blend })}
                    onHint={props.onHint}
                    ariaLabel="Blend mode"
                    options={BLEND_OPTIONS.map((o) => ({
                      value: o.value,
                      label: o.label,
                      hint: o.hint,
                    }))}
                  />
                </label>
                <SliderRow
                  label="Opacity"
                  hint="How strongly this layer contributes"
                  min={0}
                  max={1}
                  step={0.01}
                  value={l.opacity}
                  onChange={(opacity) => patch(l.id, { opacity })}
                  onHint={props.onHint}
                />
                <SliderRow
                  label="Hue"
                  hint="Base color of this layer (degrees around the color wheel)"
                  min={0}
                  max={360}
                  step={1}
                  value={l.hue}
                  onChange={(hue) => patch(l.id, { hue })}
                  format={deg}
                  onHint={props.onHint}
                />
                <SliderRow
                  label="Hue spread"
                  hint="How far the color fans out across the layer"
                  min={0}
                  max={360}
                  step={1}
                  value={l.hueSpread}
                  onChange={(hueSpread) => patch(l.id, { hueSpread })}
                  format={deg}
                  onHint={props.onHint}
                />
                {selectedType.params.map((spec) => (
                  <ParamRow
                    key={spec.key}
                    spec={spec}
                    value={l.params[spec.key] ?? spec.default}
                    onChange={(v) => patchParam(l.id, spec.key, v)}
                    onHint={emitHint}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="save-look-row builder-add-row">
        <label className="field builder-add-field" title="Add a layer to the top of the stack">
          <span>Add layer</span>
          <select
            className="select"
            value=""
            disabled={atMax}
            onChange={(e) => {
              add(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="" disabled>
              {atMax ? "Stack full" : "+ Add layer…"}
            </option>
            {BUILDER_LAYER_TYPES.map((t) => (
              <option key={t.type} value={t.type} title={t.description}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="save-look-row">
        <button
          className="text-btn"
          title="Save this layer stack as a shareable .avbuilder file"
          onClick={props.onExport}
        >
          Export .avbuilder
        </button>
        <label className="text-btn" title="Import a .avbuilder layer stack file">
          Import…
          <input
            type="file"
            accept=".avbuilder"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) props.onImport(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </section>
  );
}
