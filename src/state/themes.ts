import { PROJECT_VERSION, validateDocument, type ProjectDocument } from "./project";

/**
 * .avtheme — a shareable look/template. One JSON file: metadata (author,
 * license, tempo hint, optional thumbnail) + a full ProjectDocument
 * (preset/params/styles, background, overlay layers with embedded assets,
 * timeline scenes, post chain, motion masters). No code of any kind — a
 * template can only select and parameterize the app's own presets, so
 * importing one is exactly as safe as clicking around the UI.
 *
 * Versioning rides the project schema: document validation IS migration
 * (missing fields default), so an old theme opens in a new app forever, and
 * a newer theme is refused with a clear message rather than misread.
 */

export const THEME_VERSION = 1;

export interface ThemeMeta {
  /** Display name of the template ("Midnight Phonk"). */
  name: string;
  author: string;
  /** SPDX-ish string, e.g. "CC0-1.0", "CC-BY-4.0", "MIT". */
  license: string;
  description?: string;
  /** Tempo range the look was designed around, BPM [lo, hi]. A hint, not a gate. */
  bpmHint?: [number, number];
  /** Small PNG preview as a data URL. Optional. */
  thumbnail?: string;
}

export interface ThemeFile {
  kind: "avtheme";
  schemaVersion: number;
  /** Schema of the embedded document — same versioning as .avproj. */
  projectSchemaVersion: number;
  appVersion: string;
  meta: ThemeMeta;
  document: ProjectDocument;
}

export class ThemeParseError extends Error {}

export function serializeTheme(
  document: ProjectDocument,
  meta: ThemeMeta,
  appVersion: string,
): string {
  const file: ThemeFile = {
    kind: "avtheme",
    schemaVersion: THEME_VERSION,
    projectSchemaVersion: PROJECT_VERSION,
    appVersion,
    meta,
    document,
  };
  return JSON.stringify(file, null, 2);
}

function validMeta(v: unknown): ThemeMeta {
  const m = (typeof v === "object" && v !== null ? v : {}) as Partial<ThemeMeta>;
  if (typeof m.name !== "string" || m.name.trim().length === 0) {
    throw new ThemeParseError("Template has no name");
  }
  const str = (x: unknown): string | undefined =>
    typeof x === "string" && x.trim().length > 0 ? x : undefined;
  const bpm =
    Array.isArray(m.bpmHint) &&
    m.bpmHint.length === 2 &&
    m.bpmHint.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0 && n < 1000)
      ? ([m.bpmHint[0], m.bpmHint[1]] as [number, number])
      : undefined;
  // Thumbnails must be inline images — anything else (remote URLs, svg with
  // scripts) is refused, not sanitized.
  const thumb =
    typeof m.thumbnail === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(m.thumbnail)
      ? m.thumbnail
      : undefined;
  return {
    name: m.name.trim().slice(0, 80),
    author: str(m.author) ?? "unknown",
    license: str(m.license) ?? "unspecified",
    ...(str(m.description) ? { description: str(m.description) } : {}),
    ...(bpm ? { bpmHint: bpm } : {}),
    ...(thumb ? { thumbnail: thumb } : {}),
  };
}

/** Parse + validate + migrate an .avtheme file. Throws ThemeParseError. */
export function parseTheme(json: string): { meta: ThemeMeta; document: ProjectDocument } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ThemeParseError("Not a valid JSON file");
  }
  if (typeof raw !== "object" || raw === null) {
    throw new ThemeParseError("Not a template file");
  }
  const file = raw as Partial<ThemeFile>;
  if (file.kind !== "avtheme") {
    throw new ThemeParseError("Not an .avtheme template file");
  }
  if (typeof file.schemaVersion !== "number" || file.schemaVersion < 1) {
    throw new ThemeParseError("Missing schema version");
  }
  if (file.schemaVersion > THEME_VERSION) {
    throw new ThemeParseError(
      "Template was saved by a newer app version; update the app to import it",
    );
  }
  if (
    typeof file.projectSchemaVersion === "number" &&
    file.projectSchemaVersion > PROJECT_VERSION
  ) {
    throw new ThemeParseError("Template uses a newer document format; update the app to import it");
  }
  if (typeof file.document !== "object" || file.document === null) {
    throw new ThemeParseError("Template has no document");
  }
  return { meta: validMeta(file.meta), document: validateDocument(file.document) };
}
