import type { SyncSettings } from "../audio/types";
import type { BgSettings, ParamValues } from "../render/types";
import { BG_PRESET, BG_SOLID, BG_TRANSPARENT } from "../render/types";
import { presets } from "../render/presets";

/**
 * .avproj — the project file format. Versioned JSON around the store's
 * document slice. Rules:
 *  - schemaVersion bumps only on breaking shape changes; parseProject
 *    migrates every older version forward (never strand a user's file).
 *  - Unknown presets/params are preserved on load (forward compatibility:
 *    a file from a newer app with more presets still opens).
 */

export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = "avproj";

export interface ProjectDocument {
  presetId: string;
  paramsByPreset: Record<string, ParamValues>;
  syncByPreset: Record<string, SyncSettings>;
  bg: BgSettings;
}

export interface ProjectFile {
  schemaVersion: number;
  kind: "avproj";
  appVersion: string;
  savedAt: string;
  document: ProjectDocument;
}

export function serializeProject(document: ProjectDocument, appVersion: string): string {
  const file: ProjectFile = {
    schemaVersion: PROJECT_VERSION,
    kind: "avproj",
    appVersion,
    savedAt: new Date().toISOString(),
    document,
  };
  return JSON.stringify(file, null, 2);
}

export class ProjectParseError extends Error {}

/** Parse + validate + migrate a project file. Throws ProjectParseError. */
export function parseProject(json: string): ProjectDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ProjectParseError("Not a valid JSON file");
  }
  if (typeof raw !== "object" || raw === null) {
    throw new ProjectParseError("Not a project file");
  }
  const file = raw as Partial<ProjectFile>;
  if (file.kind !== "avproj") {
    throw new ProjectParseError("Not an .avproj project file");
  }
  if (typeof file.schemaVersion !== "number" || file.schemaVersion < 1) {
    throw new ProjectParseError("Missing schema version");
  }
  if (file.schemaVersion > PROJECT_VERSION) {
    throw new ProjectParseError(
      `Project was saved by a newer app version (schema ${file.schemaVersion}); update the app to open it`,
    );
  }
  // schemaVersion 1: no migrations yet. Future versions migrate here.
  const doc = file.document;
  if (typeof doc !== "object" || doc === null) {
    throw new ProjectParseError("Project has no document");
  }
  return {
    presetId: validPresetId(doc.presetId),
    paramsByPreset: validParamsByPreset(doc.paramsByPreset),
    syncByPreset: validSyncByPreset(doc.syncByPreset),
    bg: validBg(doc.bg),
  };
}

function validPresetId(v: unknown): string {
  return typeof v === "string" && presets.some((p) => p.id === v) ? v : presets[0].id;
}

function validParamsByPreset(v: unknown): Record<string, ParamValues> {
  if (typeof v !== "object" || v === null) return {};
  const out: Record<string, ParamValues> = {};
  for (const [presetId, params] of Object.entries(v)) {
    if (typeof params !== "object" || params === null) continue;
    const clean: ParamValues = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "number" && Number.isFinite(value)) clean[key] = value;
    }
    out[presetId] = clean;
  }
  return out;
}

const SYNC_MODES = new Set(["energy", "bass", "kick", "melody", "voice", "treble"]);

function validSyncByPreset(v: unknown): Record<string, SyncSettings> {
  if (typeof v !== "object" || v === null) return {};
  const out: Record<string, SyncSettings> = {};
  for (const [presetId, sync] of Object.entries(v)) {
    const s = sync as Partial<SyncSettings>;
    if (
      typeof s === "object" &&
      s !== null &&
      typeof s.mode === "string" &&
      SYNC_MODES.has(s.mode) &&
      typeof s.smooth === "number" &&
      Number.isFinite(s.smooth)
    ) {
      out[presetId] = { mode: s.mode, smooth: Math.min(1, Math.max(0, s.smooth)) };
    }
  }
  return out;
}

function validBg(v: unknown): BgSettings {
  const bg = v as Partial<BgSettings>;
  const validMode = bg?.mode === BG_PRESET || bg?.mode === BG_SOLID || bg?.mode === BG_TRANSPARENT;
  const validColor =
    Array.isArray(bg?.color) &&
    bg.color.length === 3 &&
    bg.color.every((c) => typeof c === "number" && Number.isFinite(c));
  if (validMode && validColor) {
    return {
      mode: bg.mode!,
      color: bg.color!.map((c) => Math.min(1, Math.max(0, c))) as [number, number, number],
    };
  }
  return { mode: BG_PRESET, color: [0, 0, 0] };
}
