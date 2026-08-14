import {
  migrateNebulaSaturationV14,
  PROJECT_VERSION,
  validateDocument,
  type ProjectDocument,
} from "./project";

/**
 * .bftheme — a shareable theme: the whole document as one file. Metadata
 * (author, license, tempo hint, optional thumbnail) + a full ProjectDocument
 * (preset/params/styles, background, overlay layers with embedded assets,
 * timeline scenes, post chain, motion masters). No code of any kind — a
 * theme can only select and parameterize the app's own presets, so
 * importing one is exactly as safe as clicking around the UI.
 *
 * Versioning rides the project schema: for SHAPE changes, document validation
 * IS migration (missing fields default), so an old theme opens in a new app
 * forever, and a newer theme is refused with a clear message rather than
 * misread. VALUE-semantics changes cannot work that way — the same number
 * means different things under different schemas — so those are gated on the
 * file's own `projectSchemaVersion` in parseTheme below (v14 nebula
 * saturation is the first and so far only one).
 */

export const THEME_VERSION = 1;
/** Mirrors userPresets.ts's USER_PRESET_EXTENSION — the file-kind constant
 * gallerySubmit.ts keys its extension→type table off, so that table is
 * built from the same two real sources as everything else there. */
export const THEME_EXTENSION = "bftheme";

export interface ThemeMeta {
  /** Display name of the theme ("Midnight Phonk"). */
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
  kind: "bftheme";
  schemaVersion: number;
  /** Schema of the embedded document — same versioning as .bfproj. */
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
    kind: "bftheme",
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
    throw new ThemeParseError("Theme has no name");
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

/** Parse + validate + migrate a .bftheme file. Throws ThemeParseError. */
export function parseTheme(json: string): { meta: ThemeMeta; document: ProjectDocument } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ThemeParseError("Not a valid JSON file");
  }
  if (typeof raw !== "object" || raw === null) {
    throw new ThemeParseError("Not a theme file");
  }
  const file = raw as Partial<ThemeFile>;
  if (file.kind !== "bftheme") {
    throw new ThemeParseError("Not a .bftheme file");
  }
  if (typeof file.schemaVersion !== "number" || file.schemaVersion < 1) {
    throw new ThemeParseError("Missing schema version");
  }
  if (file.schemaVersion > THEME_VERSION) {
    throw new ThemeParseError(
      "Theme was saved by a newer app version; update the app to import it",
    );
  }
  if (
    typeof file.projectSchemaVersion === "number" &&
    file.projectSchemaVersion > PROJECT_VERSION
  ) {
    throw new ThemeParseError("Theme uses a newer document format; update the app to import it");
  }
  if (typeof file.document !== "object" || file.document === null) {
    throw new ThemeParseError("Theme has no document");
  }
  // v14 (RP-6) nebula-saturation remap, threaded from the file's OWN
  // projectSchemaVersion. Mirrors parseProject's gate verbatim — and the
  // literal `14` is the load-bearing character here: `psv < PROJECT_VERSION`
  // reads identically TODAY and would silently re-divide every already-correct
  // theme by 0.75 the moment PROJECT_VERSION becomes 15. It is a fixed
  // historical boundary, not "the current schema".
  //
  // An ABSENT projectSchemaVersion counts as pre-v14 and migrates:
  // serializeTheme has always written the field unconditionally, so no
  // Beatform build has ever produced a theme without one. The branch is
  // reachable only from a hand-authored or third-party file, where the cost is
  // a visibly wrong import that Ctrl+Z undoes (applyTheme opens with
  // ctx.record("theme")) — cheaper than stranding every genuine pre-v14 theme.
  //
  // Ordering: this pre-pass runs BEFORE validateDocument, therefore before the
  // version-independent v13 rename pre-pass inside it. Safe only because
  // "nebula" was never renamed and the migration keys on that literal id.
  //
  // Deliberately NOT duplicated in galleryActions: keying on the file's own
  // field covers drag-import and gallery install alike, and is immune to a
  // registry index whose schemaVersion disagrees with the file it points at.
  const psv = typeof file.projectSchemaVersion === "number" ? file.projectSchemaVersion : 0;
  return {
    meta: validMeta(file.meta),
    document: validateDocument(
      psv < 14 ? migrateNebulaSaturationV14(file.document) : file.document,
    ),
  };
}
