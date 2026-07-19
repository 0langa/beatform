import type { SyncSettings } from "../audio/types";
import type { BgSettings, MotionSettings, ParamValues, PostSettings } from "../render/types";
import {
  BG_IMAGE,
  BG_PRESET,
  BG_SOLID,
  BG_TRANSPARENT,
  BG_VIDEO,
  DEFAULT_MOTION,
  DEFAULT_POST,
} from "../render/types";
import { presets } from "../render/presets";
import { customPresetById } from "../render/presets/custom";
import type { OverlayAsset, OverlayLayer, OverlayAnchor } from "../render/overlay";
import { validModsByPreset, type ModRoute } from "./modMatrix";
import { validTimeline, type Timeline } from "./timeline";

/**
 * .avproj — the project file format. Versioned JSON around the store's
 * document slice. Rules:
 *  - schemaVersion bumps only on breaking shape changes; parseProject
 *    migrates every older version forward (never strand a user's file).
 *  - Unknown presets/params are preserved on load (forward compatibility:
 *    a file from a newer app with more presets still opens).
 *
 * History: v1 = preset/params/sync/bg · v2 (+) overlay layers + assets ·
 * v3 (+) modulation-matrix routes · v4 (+) timeline (scenes + automation) ·
 * v5 (+) post-processing (bloom/tonemap/vignette/grain/chromatic) ·
 * v6 (+) global motion masters (rotation/pulse/detail) ·
 * v7 (+) image backgrounds (bg.mode 3 + bg.image asset ref/dim/blur)
 */

export const PROJECT_VERSION = 7;
export const PROJECT_EXTENSION = "avproj";

/** Frame aspect: "free" fills the window; fixed ratios letterbox the stage. */
export type Aspect = "free" | "16:9" | "9:16" | "1:1";

export const ASPECTS: Array<{ id: Aspect; label: string; hint: string }> = [
  { id: "free", label: "Fill", hint: "Use the whole window" },
  { id: "16:9", label: "16:9", hint: "YouTube / landscape video" },
  { id: "9:16", label: "9:16", hint: "Reels, Shorts, Spotify Canvas" },
  { id: "1:1", label: "1:1", hint: "Square posts" },
];

export interface ProjectDocument {
  presetId: string;
  paramsByPreset: Record<string, ParamValues>;
  syncByPreset: Record<string, SyncSettings>;
  bg: BgSettings;
  overlayLayers: OverlayLayer[];
  assets: Record<string, OverlayAsset>;
  aspect: Aspect;
  modsByPreset: Record<string, ModRoute[]>;
  smoothSpectrum: boolean;
  timeline: Timeline;
  post: PostSettings;
  motion: MotionSettings;
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
  return validateDocument(doc);
}

/**
 * Field-by-field validation + defaulting of an untrusted document. This IS
 * the migration path: older schemas simply lack fields and the validators
 * default them. Shared by .avproj projects and .avtheme templates.
 */
export function validateDocument(doc: Partial<ProjectDocument>): ProjectDocument {
  const assets = validAssets(doc.assets);
  const bg = validBg(doc.bg);
  // Image/video background referencing a missing asset degrades to the
  // preset's own background instead of rendering a black hole.
  if (bg.mode === BG_IMAGE && (!bg.image || !assets[bg.image.assetId])) {
    bg.mode = BG_PRESET;
  }
  if (bg.mode === BG_VIDEO && (!bg.video || !assets[bg.video.assetId])) {
    bg.mode = BG_PRESET;
  }
  return {
    presetId: validPresetId(doc.presetId),
    paramsByPreset: validParamsByPreset(doc.paramsByPreset),
    syncByPreset: validSyncByPreset(doc.syncByPreset),
    bg,
    overlayLayers: validLayers(doc.overlayLayers, assets),
    assets,
    aspect: validAspect(doc.aspect),
    modsByPreset: validModsByPreset(doc.modsByPreset),
    smoothSpectrum: doc.smoothSpectrum === true,
    timeline: validTimeline(doc.timeline),
    post: validPost(doc.post),
    motion: validMotion(doc.motion),
  };
}

export function validMotion(v: unknown): MotionSettings {
  const m = (typeof v === "object" && v !== null ? v : {}) as Partial<MotionSettings>;
  const n = (x: unknown, def: number, lo: number, hi: number) =>
    typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : def;
  return {
    rotation: n(m.rotation, DEFAULT_MOTION.rotation, 0, 2),
    pulse: n(m.pulse, DEFAULT_MOTION.pulse, 0, 2),
    detail: n(m.detail, DEFAULT_MOTION.detail, 0, 1),
    spectrumSmooth: n(m.spectrumSmooth, DEFAULT_MOTION.spectrumSmooth, 0, 1),
  };
}

export function validPost(v: unknown): PostSettings {
  const p = (typeof v === "object" && v !== null ? v : {}) as Partial<PostSettings>;
  const n = (x: unknown, def: number, lo: number, hi: number) =>
    typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : def;
  return {
    bloom: n(p.bloom, DEFAULT_POST.bloom, 0, 1),
    bloomThreshold: n(p.bloomThreshold, DEFAULT_POST.bloomThreshold, 0.4, 1.6),
    exposure: n(p.exposure, DEFAULT_POST.exposure, 0.2, 3),
    tonemap: p.tonemap === true,
    vignette: n(p.vignette, DEFAULT_POST.vignette, 0, 1),
    grain: n(p.grain, DEFAULT_POST.grain, 0, 0.5),
    chromatic: n(p.chromatic, DEFAULT_POST.chromatic, 0, 1),
  };
}

export function validAspect(v: unknown): Aspect {
  return v === "16:9" || v === "9:16" || v === "1:1" ? v : "free";
}

function validPresetId(v: unknown): string {
  if (typeof v !== "string") return presets[0].id;
  if (presets.some((p) => p.id === v)) return v;
  // User-authored WGSL presets resolve through the runtime registry — a
  // project referencing one the user deleted falls back to the default mode.
  if (customPresetById(v)) return v;
  return presets[0].id;
}

export function validParamsByPreset(v: unknown): Record<string, ParamValues> {
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

const SYNC_MODES = new Set([
  "energy",
  "bass",
  "kick",
  "melody",
  "voice",
  "treble",
  "snare",
  "hats",
]);

export function validSyncByPreset(v: unknown): Record<string, SyncSettings> {
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
      const clamp01 = (x: unknown) =>
        typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : undefined;
      out[presetId] = {
        mode: s.mode,
        smooth: Math.min(1, Math.max(0, s.smooth)),
        attack: clamp01(s.attack),
        release: clamp01(s.release),
      };
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
  if (Array.isArray(v) && v.length === 3 && v.every((c) => Number.isFinite(c))) {
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

export function validBg(v: unknown): BgSettings {
  const bg = v as Partial<BgSettings>;
  const validMode =
    bg?.mode === BG_PRESET ||
    bg?.mode === BG_SOLID ||
    bg?.mode === BG_TRANSPARENT ||
    bg?.mode === BG_IMAGE ||
    bg?.mode === BG_VIDEO;
  const validColor =
    Array.isArray(bg?.color) &&
    bg.color.length === 3 &&
    bg.color.every((c) => typeof c === "number" && Number.isFinite(c));
  if (validMode && validColor) {
    const n = (x: unknown, def: number, lo: number, hi: number) =>
      typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : def;
    const image =
      typeof bg!.image === "object" &&
      bg!.image !== null &&
      typeof bg!.image.assetId === "string" &&
      bg!.image.assetId.length > 0
        ? {
            assetId: bg!.image.assetId,
            dim: n(bg!.image.dim, 0.25, 0, 0.9),
            blur: n(bg!.image.blur, 0, 0, 60),
          }
        : undefined;
    const video =
      typeof bg!.video === "object" &&
      bg!.video !== null &&
      typeof bg!.video.assetId === "string" &&
      bg!.video.assetId.length > 0
        ? {
            assetId: bg!.video.assetId,
            dim: n(bg!.video.dim, 0.35, 0, 0.9),
            blur: n(bg!.video.blur, 0, 0, 60),
          }
        : undefined;
    return {
      // Image/video mode without a usable reference falls back to the preset's
      // own background (the asset check happens in validateDocument, which can
      // see the assets map).
      mode:
        (bg!.mode === BG_IMAGE && !image) || (bg!.mode === BG_VIDEO && !video)
          ? BG_PRESET
          : bg!.mode!,
      color: bg!.color!.map((c) => Math.min(1, Math.max(0, c))) as [number, number, number],
      ...(image ? { image } : {}),
      ...(video ? { video } : {}),
    };
  }
  return { mode: BG_PRESET, color: [0, 0, 0] };
}
