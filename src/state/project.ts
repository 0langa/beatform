import type { SyncSettings } from "../audio/types";
import type { BgSettings, ParamValues } from "../render/types";
import { BG_PRESET, BG_SOLID, BG_TRANSPARENT } from "../render/types";
import { presets } from "../render/presets";
import type { OverlayAsset, OverlayLayer, OverlayAnchor } from "../render/overlay";

/**
 * .avproj — the project file format. Versioned JSON around the store's
 * document slice. Rules:
 *  - schemaVersion bumps only on breaking shape changes; parseProject
 *    migrates every older version forward (never strand a user's file).
 *  - Unknown presets/params are preserved on load (forward compatibility:
 *    a file from a newer app with more presets still opens).
 *
 * History: v1 = preset/params/sync/bg · v2 (+) overlay layers + assets
 */

export const PROJECT_VERSION = 2;
export const PROJECT_EXTENSION = "avproj";

export interface ProjectDocument {
  presetId: string;
  paramsByPreset: Record<string, ParamValues>;
  syncByPreset: Record<string, SyncSettings>;
  bg: BgSettings;
  overlayLayers: OverlayLayer[];
  assets: Record<string, OverlayAsset>;
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
  // v1 files simply lack overlay fields — the validators below default them.
  const doc = file.document;
  if (typeof doc !== "object" || doc === null) {
    throw new ProjectParseError("Project has no document");
  }
  const assets = validAssets(doc.assets);
  return {
    presetId: validPresetId(doc.presetId),
    paramsByPreset: validParamsByPreset(doc.paramsByPreset),
    syncByPreset: validSyncByPreset(doc.syncByPreset),
    bg: validBg(doc.bg),
    overlayLayers: validLayers(doc.overlayLayers, assets),
    assets,
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

const ANCHORS = new Set(["tl", "tc", "tr", "cl", "cc", "cr", "bl", "bc", "br"]);

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

export function validAssets(v: unknown): Record<string, OverlayAsset> {
  if (typeof v !== "object" || v === null) return {};
  const out: Record<string, OverlayAsset> = {};
  for (const [id, asset] of Object.entries(v)) {
    const a = asset as Partial<OverlayAsset>;
    if (
      typeof a === "object" &&
      a !== null &&
      typeof a.dataUrl === "string" &&
      a.dataUrl.startsWith("data:image/")
    ) {
      out[id] = { id, name: typeof a.name === "string" ? a.name : "image", dataUrl: a.dataUrl };
    }
  }
  return out;
}

function validColor(v: unknown): [number, number, number] {
  if (Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === "number")) {
    return v.map((c) => Math.min(1, Math.max(0, c))) as [number, number, number];
  }
  return [1, 1, 1];
}

export function validLayers(v: unknown, assets: Record<string, OverlayAsset>): OverlayLayer[] {
  if (!Array.isArray(v)) return [];
  const out: OverlayLayer[] = [];
  for (const raw of v) {
    const l = raw as Partial<OverlayLayer> & { type?: string };
    if (typeof l !== "object" || l === null || typeof l.id !== "string") continue;
    const anchor = (
      typeof l.anchor === "string" && ANCHORS.has(l.anchor) ? l.anchor : "cc"
    ) as OverlayAnchor;
    const offset: [number, number] = Array.isArray(l.offset)
      ? [num(l.offset[0], 0, -1, 1), num(l.offset[1], 0, -1, 1)]
      : [0, 0];
    if (l.type === "text") {
      const t = raw as Partial<import("../render/overlay").TextLayer>;
      out.push({
        id: l.id,
        type: "text",
        text: typeof t.text === "string" ? t.text.slice(0, 200) : "",
        font: typeof t.font === "string" ? t.font.slice(0, 100) : "Arial",
        weight: num(t.weight, 700, 100, 1000),
        size: num(t.size, 0.06, 0.005, 0.5),
        color: validColor(t.color),
        opacity: num(t.opacity, 1, 0, 1),
        letterSpacing: num(t.letterSpacing, 0, -0.2, 1),
        anchor,
        offset,
        glow: num(t.glow, 0, 0, 1),
        uppercase: t.uppercase === true,
      });
    } else if (l.type === "image") {
      const i = raw as Partial<import("../render/overlay").ImageLayer>;
      if (typeof i.assetId !== "string" || !assets[i.assetId]) continue;
      out.push({
        id: l.id,
        type: "image",
        assetId: i.assetId,
        size: num(i.size, 0.2, 0.01, 2),
        opacity: num(i.opacity, 1, 0, 1),
        anchor,
        offset,
        rounded: num(i.rounded, 0, 0, 0.5),
      });
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
