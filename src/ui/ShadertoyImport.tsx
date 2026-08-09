import { useMemo, useState } from "react";
import { askConfirm } from "../state/platform";
import { useVizStore } from "../state/store";
import { IconClose } from "./Icons";
import { useFocusTrap } from "./useFocusTrap";

/** Shadertoy's default license, preselected — imports must not silently
 * strip the attribution the source site attaches by default. */
const DEFAULT_LICENSE = "CC BY-NC-SA 3.0";
const LICENSES = [DEFAULT_LICENSE, "CC BY-NC 3.0", "CC BY 3.0", "CC0 / public domain", "MIT"];

const PLACEHOLDER = `// Paste a Shadertoy "Image" shader here, e.g.:
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float fft = texture(iChannel0, vec2(uv.x, 0.25)).x;
    fragColor = vec4(uv * fft, 0.5 + 0.5 * sin(iTime), 1.0);
}`;

/**
 * Shadertoy GLSL import (FEAT-001) — paste the Image tab of a Shadertoy
 * shader, name it, credit the author, and the Rust-side translator turns it
 * into a Beatform visual. Diagnostics come back with the user's own GLSL
 * line numbers. Re-opens with the original GLSL when editing an imported
 * visual, so the source (not the generated WGSL) stays the thing you edit.
 *
 * Store-direct (P-12 wave 2): the def being re-edited is resolved from the two
 * fields it is made of rather than handed down. `customDefs.find(...)` returns
 * a store-owned element, so it WOULD be selector-safe — but it goes through
 * `useMemo` anyway, matching ParamsPanel's `looksForMode`, because the shape
 * that is safe by accident and the shape that crashes on mount should not look
 * identical at the call site. NOT memo()d: with zero props memo can never bail.
 */
export function ShadertoyImport() {
  const customDefs = useVizStore((s) => s.customDefs);
  const editId = useVizStore((s) => s.shadertoyImportEditId);
  const store = useVizStore.getState;
  /** Imported visual being re-edited, or null for a fresh import. */
  const editDef = useMemo(
    () => customDefs.find((d) => d.id === editId) ?? null,
    [customDefs, editId],
  );

  const st = editDef?.shadertoy;
  const [glsl, setGlsl] = useState(st?.glsl ?? "");
  const [name, setName] = useState(editDef?.name ?? "");
  const [author, setAuthor] = useState(st?.author ?? "");
  const [source, setSource] = useState(st?.source ?? "");
  const [license, setLicense] = useState(st?.license ?? DEFAULT_LICENSE);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dialogRef = useFocusTrap(true);

  // askConfirm, not window.confirm: the Tauri dialog plugin patches
  // window.confirm into `plugin:dialog|confirm`, which the capability file
  // deliberately does not allow (only `ask` is granted). Raw confirm threw
  // "not allowed by ACL" in the installed v2.64.0 build.
  const requestClose = () => {
    void (async () => {
      if (dirty && !(await askConfirm("Discard this import?", "Import Shadertoy shader"))) return;
      store().closeShadertoyImport();
    })();
  };

  const apply = async () => {
    if (!glsl.trim()) {
      setErrors(["Paste the shader's GLSL first"]);
      return;
    }
    setBusy(true);
    // The edit id is read off the live snapshot at call time, exactly as
    // App's retired forwarder did.
    const s = store();
    const result = await s.importShadertoyGlsl(
      glsl,
      { name, author, source, license },
      s.shadertoyImportEditId,
    );
    setBusy(false);
    setErrors(result);
    if (result.length === 0) store().closeShadertoyImport();
  };

  const edit = (fn: () => void) => {
    fn();
    setDirty(true);
  };

  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <div
        ref={dialogRef}
        className="modal wide shader-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Import Shadertoy shader"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          requestClose();
        }}
      >
        <div className="panel-header">
          <span className="panel-heading">
            {editDef ? "Edit imported shader" : "Import Shadertoy shader"}
          </span>
          <button
            className="icon-btn subtle"
            title="Close"
            aria-label="Close import dialog"
            onClick={requestClose}
          >
            <IconClose size={16} />
          </button>
        </div>

        <p className="section-hint">
          Paste the <b>Image</b> tab of a single-pass Shadertoy shader. <code>iChannel0</code>{" "}
          carries Beatform's audio (row 0 spectrum, row 1 waveform — Shadertoy's music-texture
          layout); <code>iTime</code> follows the track, so previews and exports match exactly.
          Helpers taking <code>sampler2D</code> parameters are translated automatically. Multi-pass
          (Buffer A–D), cubemap, video and keyboard channels are not supported. Respect the original
          shader's license — most Shadertoy work is <code>CC BY-NC-SA</code> and needs credit.
        </p>

        <div className="save-look-row">
          <input
            className="look-name-input"
            value={name}
            maxLength={40}
            placeholder="Visual name…"
            aria-label="Visual name"
            onChange={(e) => edit(() => setName(e.target.value))}
          />
          <input
            className="look-name-input"
            value={author}
            maxLength={80}
            placeholder="Original author"
            aria-label="Original author"
            onChange={(e) => edit(() => setAuthor(e.target.value))}
          />
        </div>
        <div className="save-look-row">
          <input
            className="look-name-input"
            value={source}
            maxLength={200}
            placeholder="Source URL (shadertoy.com/view/…)"
            aria-label="Source URL"
            onChange={(e) => edit(() => setSource(e.target.value))}
          />
          <select
            className="look-name-input"
            value={license}
            aria-label="License of the original shader"
            title="License of the original shader"
            onChange={(e) => edit(() => setLicense(e.target.value))}
          >
            {LICENSES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <textarea
          className="shader-code"
          spellCheck={false}
          value={glsl}
          placeholder={PLACEHOLDER}
          aria-label="Shadertoy GLSL source"
          onChange={(e) => edit(() => setGlsl(e.target.value))}
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
          {busy ? "Translating…" : editDef ? "Translate + update" : "Translate + add visual"}
        </button>
      </div>
    </div>
  );
}
