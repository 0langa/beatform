import { memo, useState } from "react";
import type { PresetDef } from "../render/types";
import { IconClose } from "./Icons";
import { useFocusTrap } from "./useFocusTrap";

/**
 * Shadertoy GLSL import (FEAT-001) — paste the Image tab of a Shadertoy
 * shader, name it, credit the author, and the Rust-side translator turns it
 * into a Beatform visual. Diagnostics come back with the user's own GLSL
 * line numbers. Re-opens with the original GLSL when editing an imported
 * visual, so the source (not the generated WGSL) stays the thing you edit.
 * Props-only, like every panel.
 */
export interface ShadertoyImportProps {
  /** Imported visual being re-edited, or null for a fresh import. */
  editDef: PresetDef | null;
  /** Transpile + compile-check + install. Resolves [] on success. */
  onImport: (
    glsl: string,
    meta: { name: string; author?: string; source?: string; license?: string },
  ) => Promise<string[]>;
  onClose: () => void;
}

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

export const ShadertoyImport = memo(function ShadertoyImport(props: ShadertoyImportProps) {
  const st = props.editDef?.shadertoy;
  const [glsl, setGlsl] = useState(st?.glsl ?? "");
  const [name, setName] = useState(props.editDef?.name ?? "");
  const [author, setAuthor] = useState(st?.author ?? "");
  const [source, setSource] = useState(st?.source ?? "");
  const [license, setLicense] = useState(st?.license ?? DEFAULT_LICENSE);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dialogRef = useFocusTrap(true);

  const requestClose = () => {
    if (dirty && !window.confirm("Discard this import?")) return;
    props.onClose();
  };

  const apply = async () => {
    if (!glsl.trim()) {
      setErrors(["Paste the shader's GLSL first"]);
      return;
    }
    setBusy(true);
    const result = await props.onImport(glsl, { name, author, source, license });
    setBusy(false);
    setErrors(result);
    if (result.length === 0) props.onClose();
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
            {props.editDef ? "Edit imported shader" : "Import Shadertoy shader"}
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
          Multi-pass (Buffer A–D), cubemap, video and keyboard channels are not supported. Respect
          the original shader's license — most Shadertoy work is <code>CC BY-NC-SA</code> and needs
          credit.
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
          {busy ? "Translating…" : props.editDef ? "Translate + update" : "Translate + add visual"}
        </button>
      </div>
    </div>
  );
});
