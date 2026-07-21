import { memo, useState } from "react";
import type { ParamSpec, PresetDef } from "../render/types";
import { NEW_SHADER_TEMPLATE, newCustomPresetId } from "../render/presets/custom";
import { IconClose } from "./Icons";
import { useFocusTrap } from "./useFocusTrap";

/**
 * The WGSL preset editor — a modal that authors a custom PresetDef: name,
 * parameter schema (each row becomes a P_<key>() accessor and an auto-built
 * slider), and the fragment WGSL. Apply compile-checks against the full ABI
 * and either installs the visual or lists the compiler's errors with line
 * numbers relative to the user's code. Props-only, like every panel.
 */
export interface ShaderEditorProps {
  /** Existing custom presets (editable / deletable / exportable). */
  customDefs: PresetDef[];
  /** Compile-check + install; resolves with [] on success, else errors. */
  onSave: (def: PresetDef) => Promise<string[]>;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onImportFile: (file: File) => void;
  onClose: () => void;
}

interface ParamRow {
  key: string;
  label: string;
  min: string;
  max: string;
  step: string;
  default: string;
}

const EMPTY_ROW: ParamRow = {
  key: "",
  label: "",
  min: "0",
  max: "1",
  step: "0.01",
  default: "0.5",
};

const STARTER_ROWS: ParamRow[] = [
  { key: "hue", label: "Hue", min: "0", max: "360", step: "1", default: "200" },
];

function rowsToSpecs(rows: ParamRow[]): { specs: ParamSpec[]; errors: string[] } {
  const specs: ParamSpec[] = [];
  const errors: string[] = [];
  for (const r of rows) {
    if (!r.key.trim()) continue; // blank row = ignored
    const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
    const min = num(r.min);
    const max = num(r.max);
    const step = num(r.step);
    const def = num(r.default);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,30}$/.test(r.key)) {
      errors.push(`param "${r.key}": key must be a WGSL-safe identifier`);
      continue;
    }
    if (![min, max, step, def].every(Number.isFinite) || !(max > min) || !(step > 0)) {
      errors.push(
        `param "${r.key}": min/max/step/default must be numbers with max > min, step > 0`,
      );
      continue;
    }
    specs.push({
      key: r.key,
      label: r.label.trim() || r.key,
      min,
      max,
      step,
      default: Math.min(max, Math.max(min, def)),
    });
  }
  return { specs, errors };
}

function specsToRows(specs: ParamSpec[]): ParamRow[] {
  return specs.map((s) => ({
    key: s.key,
    label: s.label,
    min: String(s.min),
    max: String(s.max),
    step: String(s.step),
    default: String(s.default),
  }));
}

// Memoized (H13): requires every callback prop from App.tsx to stay
// reference-stable (see the useCallback block there) or memo does nothing.
export const ShaderEditor = memo(function ShaderEditor(props: ShaderEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("My Visual");
  const [rows, setRows] = useState<ParamRow[]>(STARTER_ROWS);
  const [wgsl, setWgsl] = useState(NEW_SHADER_TEMPLATE);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // L12: the editor used to discard unsaved WGSL with no confirmation on a
  // backdrop click (and Escape didn't close it at all, for the same reason).
  // Track whether the in-progress edit differs from what was last loaded/
  // saved, and gate every dismissal path (backdrop, header ✕, Escape) behind
  // one confirm — a clean editor (nothing to lose) still closes instantly.
  const [dirty, setDirty] = useState(false);
  const dialogRef = useFocusTrap(true);

  const loadExisting = (def: PresetDef) => {
    setEditingId(def.id);
    setName(def.name);
    setRows(specsToRows([...(def.params ?? []), ...(def.advanced ?? [])]));
    setWgsl(def.wgsl);
    setErrors([]);
    setDirty(false);
  };

  const requestClose = () => {
    if (dirty && !window.confirm("Discard unsaved changes to this shader?")) return;
    props.onClose();
  };

  const apply = async () => {
    const { specs, errors: rowErrors } = rowsToSpecs(rows);
    if (rowErrors.length > 0) {
      setErrors(rowErrors);
      return;
    }
    setBusy(true);
    const def: PresetDef = {
      id: editingId ?? newCustomPresetId(),
      name: name.trim() || "Untitled",
      params: specs,
      wgsl,
    };
    const result = await props.onSave(def);
    setBusy(false);
    setErrors(result);
    if (result.length === 0) {
      setEditingId(def.id);
      setDirty(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <div
        ref={dialogRef}
        className="modal wide shader-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Shader editor"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          // Handled locally (not the App-level shortcut handler) so the
          // dirty confirm above can run first — see L12.
          e.stopPropagation();
          requestClose();
        }}
      >
        <div className="panel-header">
          <span className="panel-heading">Shader editor</span>
          <button
            className="icon-btn subtle"
            title="Close"
            aria-label="Close shader editor"
            onClick={requestClose}
          >
            <IconClose size={16} />
          </button>
        </div>

        <p className="section-hint">
          Write a visual as one WGSL function — the full audio ABI (spectrum, waveform, sync
          signals, tempo pulses) is in scope; each parameter below becomes a{" "}
          <code>P_&lt;key&gt;()</code> accessor and an automatic slider. See the docs' Preset SDK
          page for the reference. Custom visuals export and preview exactly like built-ins.
        </p>

        {props.customDefs.length > 0 && (
          <div className="style-chips">
            {props.customDefs.map((d) => (
              <span key={d.id} className="user-chip-wrap">
                <button
                  className={`style-chip user ${d.id === editingId ? "active" : ""}`}
                  title="Load into the editor"
                  onClick={() => loadExisting(d)}
                >
                  {d.name}
                </button>
                <button
                  className="chip-x"
                  title="Delete"
                  aria-label={`Delete "${d.name}"`}
                  onClick={() => props.onDelete(d.id)}
                >
                  ✕
                </button>
                <button
                  className="chip-x"
                  title="Export as .avshader file"
                  aria-label={`Export "${d.name}" as .avshader file`}
                  onClick={() => props.onExport(d.id)}
                >
                  ↗
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="save-look-row">
          <input
            className="look-name-input"
            value={name}
            maxLength={40}
            placeholder="Visual name…"
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
          <button
            className="text-btn"
            title="Start a fresh visual from the template"
            onClick={() => {
              setEditingId(null);
              setName("My Visual");
              setRows(STARTER_ROWS);
              setWgsl(NEW_SHADER_TEMPLATE);
              setErrors([]);
              setDirty(false);
            }}
          >
            New
          </button>
          <label className="text-btn" title="Import an .avshader file">
            Import…
            <input
              type="file"
              accept=".avshader,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) props.onImportFile(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>

        <div className="shader-params">
          {rows.map((r, i) => (
            <div key={i} className="shader-param-row">
              {(["key", "label", "min", "max", "step", "default"] as const).map((field) => (
                <input
                  key={field}
                  className="look-name-input"
                  placeholder={field}
                  aria-label={`Parameter ${field}`}
                  title={field}
                  value={r[field]}
                  onChange={(e) => {
                    setRows(
                      rows.map((row, j) => (j === i ? { ...row, [field]: e.target.value } : row)),
                    );
                    setDirty(true);
                  }}
                />
              ))}
              <button
                className="chip-x"
                title="Remove parameter"
                aria-label="Remove parameter"
                onClick={() => {
                  setRows(rows.filter((_, j) => j !== i));
                  setDirty(true);
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="text-btn"
            onClick={() => {
              setRows([...rows, { ...EMPTY_ROW }]);
              setDirty(true);
            }}
            title="Add a parameter (becomes P_<key>() in WGSL and a slider in the panel)"
          >
            + Parameter
          </button>
        </div>

        <textarea
          className="shader-code"
          spellCheck={false}
          value={wgsl}
          onChange={(e) => {
            setWgsl(e.target.value);
            setDirty(true);
          }}
        />

        {errors.length > 0 && (
          <div className="shader-errors">
            {errors.map((e, i) => (
              <div key={i} className="shader-error">
                {e}
              </div>
            ))}
          </div>
        )}

        <button className="btn-primary wide" disabled={busy} onClick={() => void apply()}>
          {busy ? "Compiling…" : editingId ? "Compile + update" : "Compile + add visual"}
        </button>
      </div>
    </div>
  );
});
