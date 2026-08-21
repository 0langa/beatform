import { useState } from "react";
import type { ParamSpec, PresetDef } from "../render/types";
import { NEW_SHADER_TEMPLATE, newCustomPresetId } from "../render/presets/custom";
import { askConfirm } from "../state/platform";
import { useVizStore } from "../state/store";
import { IconClose } from "./Icons";
import { useFocusTrap } from "./useFocusTrap";
import { raceTimeout, SHADER_APPLY_TIMEOUT_MS } from "./asyncTimeout";

interface ParamRow {
  /** Stable identity for React keys (audit U3): with index keys, removing a
   * middle row remapped DOM state (focus, selection) onto the wrong row. */
  uid: string;
  key: string;
  label: string;
  min: string;
  max: string;
  step: string;
  default: string;
}

let rowUid = 0;
const nextRowUid = () => `row-${++rowUid}`;

const EMPTY_ROW: Omit<ParamRow, "uid"> = {
  key: "",
  label: "",
  min: "0",
  max: "1",
  step: "0.01",
  default: "0.5",
};

const starterRows = (): ParamRow[] => [
  { uid: nextRowUid(), key: "hue", label: "Hue", min: "0", max: "360", step: "1", default: "200" },
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
    uid: nextRowUid(),
    key: s.key,
    label: s.label,
    min: String(s.min),
    max: String(s.max),
    step: String(s.step),
    default: String(s.default),
  }));
}

/**
 * The WGSL preset editor — a modal that authors a custom PresetDef: name,
 * parameter schema (each row becomes a P_<key>() accessor and an auto-built
 * slider), and the fragment WGSL. Apply compile-checks against the full ABI
 * and either installs the visual or lists the compiler's errors with line
 * numbers relative to the user's code.
 *
 * Store-direct (P-12 wave 2): one subscription (the existing custom presets,
 * which are editable / deletable / exportable) and six actions called where
 * they are clicked. NOT memo()d: with zero props memo can never bail on
 * anything.
 */
export function ShaderEditor() {
  const customDefs = useVizStore((s) => s.customDefs);
  const store = useVizStore.getState;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("My Visual");
  const [rows, setRows] = useState<ParamRow[]>(starterRows);
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
    if (def.shadertoy) {
      // Imported visuals are edited as GLSL in the import dialog; their
      // `wgsl` is generated output no one should hand-edit. (An imported def
      // carries a transpiled module, not a snippet, so THIS editor must never
      // load one.)
      store().openShadertoyImport(def.id);
      return;
    }
    setEditingId(def.id);
    setName(def.name);
    setRows(specsToRows([...(def.params ?? []), ...(def.advanced ?? [])]));
    setWgsl(def.wgsl);
    setErrors([]);
    setDirty(false);
  };

  // askConfirm, not window.confirm — same ACL trap as ShadertoyImport: the
  // dialog plugin routes window.confirm to `plugin:dialog|confirm`, which the
  // capability file does not grant. This dirty-close confirm had been broken
  // in every installed build since it was added (L12); the Shadertoy smoke
  // finally exercised the path.
  //
  // E2-U4: blocked outright while `busy` — ALL THREE dismissal paths
  // (backdrop, header ✕, the local Escape handler below) call this one
  // function, so gating it here is enough for all of them, matching how
  // ExportDialog disables its own close control during work (E2-U5). Before
  // this, "Discard" during an in-flight compile unmounted the dialog but not
  // the promise: saveCustomPreset (customShaderActions.ts) still registered,
  // persisted AND switched the live visual to what was just "discarded",
  // with a toast landing after the dialog was already gone. Once `apply()`
  // settles — success or failure — `busy` clears and normal dismissal rules
  // resume; a failed compile never reached saveCustomPreset's persist/switch
  // step in the first place, so there is nothing left to wrongly "keep" by
  // discarding after a failure.
  const requestClose = () => {
    if (busy) return;
    void (async () => {
      if (dirty && !(await askConfirm("Discard unsaved changes to this shader?", "Shader editor")))
        return;
      store().setShowShaderEditor(false);
    })();
  };

  /** Destructive: a misclick on the 9-px ✕ threw a shader away with no
   * question asked (R2-20) — same UI-level guard as ParamsPanel's deleteLook,
   * except the wording promises no less than the truth: since the delete's
   * snapshot embeds the def, Ctrl+Z genuinely restores it. */
  const deleteShaderGuarded = async (id: string) => {
    const name = customDefs.find((d) => d.id === id)?.name;
    if (name === undefined) return;
    const ok = await askConfirm(`Delete the visual "${name}"?`, "Delete visual");
    if (ok) store().deleteCustomPreset(id);
  };

  /**
   * Whole-lane review, CRITICAL on top of E2-U4: `busy` now hard-gates every
   * dismissal path (requestClose above), so an awaited compile that never
   * settles — a genuine hang, not just a slow one; see asyncTimeout.ts's own
   * comment for why one is structurally possible here — used to leave the
   * dialog permanently unclosable with no escape hatch. `raceTimeout` always
   * settles `busy` back to false within SHADER_APPLY_TIMEOUT_MS, on success,
   * on a thrown/rejected compile, or on a timeout; the AbortSignal it hands
   * `saveCustomPreset` is what stops a compile that finishes AFTER the
   * timeout from silently switching the live visual on its way out.
   */
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
    const outcome = await raceTimeout(
      (signal) => store().saveCustomPreset(def, signal),
      SHADER_APPLY_TIMEOUT_MS,
    );
    setBusy(false);
    if (!outcome.ok) {
      setErrors([
        outcome.timedOut
          ? `Compile timed out after ${SHADER_APPLY_TIMEOUT_MS / 1000}s — check the WGSL for an infinite loop and try again.`
          : `Compile failed: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`,
      ]);
      return;
    }
    setErrors(outcome.value);
    if (outcome.value.length === 0) {
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
            disabled={busy}
            title={busy ? "Compiling…" : "Close"}
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
          page for the reference. Custom visuals use the same preview and export paths as built-ins.
        </p>

        {customDefs.length > 0 && (
          <div className="style-chips">
            {customDefs.map((d) => (
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
                  onClick={() => void deleteShaderGuarded(d.id)}
                >
                  ✕
                </button>
                <button
                  className="chip-x"
                  title="Export as .bfshader file"
                  aria-label={`Export "${d.name}" as .bfshader file`}
                  onClick={() => void store().exportCustomPreset(d.id)}
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
            title="Start a fresh visual from the starter shader"
            onClick={() => {
              setEditingId(null);
              setName("My Visual");
              setRows(starterRows());
              setWgsl(NEW_SHADER_TEMPLATE);
              setErrors([]);
              setDirty(false);
            }}
          >
            New
          </button>
          <label className="text-btn" title="Import a .bfshader file">
            Import…
            <input
              type="file"
              accept=".bfshader,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then((t) => store().importCustomPresetText(t));
                e.target.value = "";
              }}
            />
          </label>
          <button
            className="text-btn"
            title="Paste a Shadertoy GLSL shader and translate it into a visual"
            onClick={() => store().openShadertoyImport()}
          >
            Shadertoy…
          </button>
        </div>

        <div className="shader-params">
          {rows.map((r, i) => (
            <div key={r.uid} className="shader-param-row">
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
              setRows([...rows, { ...EMPTY_ROW, uid: nextRowUid() }]);
              setDirty(true);
            }}
            title="Add a parameter (becomes P_<key>() in WGSL and a slider in Visuals)"
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
}
