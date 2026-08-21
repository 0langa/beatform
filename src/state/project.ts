import { sanitizeSync, type SyncSettings } from "../audio/types";
import type { BgFit, BgSettings, MotionSettings, ParamValues, PostSettings } from "../render/types";
import {
  BG_IMAGE,
  BG_PRESET,
  BG_SOLID,
  BG_TRANSPARENT,
  BG_VIDEO,
  DEFAULT_MOTION,
  DEFAULT_POST,
} from "../render/types";
import { canonicalPresetId, knownPresetId, presets } from "../render/presets";
import { NEBULA_SAT_AUTHORED } from "../render/presets/nebula";
import { registerCustomPreset, validCustomPreset } from "../render/presets/custom";
import type { PresetDef } from "../render/types";
import { validLyricStyle, type LyricStyle } from "./lyrics";
import { defaultBuilderStack, validBuilderStack, type BuilderStack } from "../render/builder2";
import { validAudiogram, type AudiogramSettings } from "./audiogram";
import type { OverlayAsset, OverlayLayer, OverlayAnchor } from "../render/overlay";
import { validModsByPreset, type ModRoute } from "./modMatrix";
import { validTimeline, type Timeline } from "./timeline";

/**
 * .bfproj — the project file format. Versioned JSON around the store's
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
 * v7 (+) image backgrounds (bg.mode 3 + bg.image asset ref/dim/blur) ·
 * v8 (+) video backgrounds (bg.mode 4 + bg.video asset ref/dim/blur, and
 *        `data:video/` entries in the asset map)
 *
 * v8 note: video backgrounds actually landed in the app after the v7 bump,
 * with no version bump of their own — so real v7 files exist in both the
 * pre-video shape (only ever bg.mode <= 3, only `data:image/` assets) and,
 * confusingly, some that already carried bg.mode 4 / video assets under a
 * schemaVersion that predates the field's documented introduction. v8 exists
 * to give the current (video-capable) shape its own honest number; nothing
 * below the schema-version gate changed, so older files of every prior
 * version keep loading exactly as before — the per-field validators are the
 * actual migration path, not a per-version branch.
 *
 * v9 (+) lyricStyle, audiogram, and the custom WGSL defs the document
 *        references (presetId / timeline scenes). All three affect rendered
 *        pixels but previously lived only in localStorage, so the same
 *        .bfproj rendered differently on another machine — and a project
 *        using a custom visual silently fell back to the default mode for
 *        anyone who hadn't separately imported the matching .bfshader.
 *        Older files simply lack the fields and the validators default them.
 *
 * v10 (+) builderStack — Builder's ordered layer list. Older files
 *        default to the starter stack; the classic `builder` preset is
 *        untouched and still renders identically.
 *
 * v11 (+) bgByPreset — optional per-mode background overrides (each entry a
 *        full BgSettings; the global `bg` remains the default for modes
 *        without one) — and centerImageByPreset — per-mode asset ids that
 *        replace the track's cover art in modes that draw a center image
 *        (Bass Circle, Radial Burst). Older files lack both fields and the
 *        validators default them to empty.
 *
 * No bump for background fit/zoom/pan (bg.image / bg.video BgFit): the four
 * fields are optional and their absent value is the cover-fit the shader
 * already hardcoded, so a v11 file written before they existed renders
 * byte-identically after loading. A version bump is for shape changes that
 * older readers would MISREAD — this one they simply do not see.
 *
 * v12 (+) imported Shadertoy defs may appear in customDefs (`shadertoy`
 *        marker + full-module `wgsl`). CONDITIONAL: a file is written at v12
 *        only when it actually embeds one — an older reader's validator would
 *        silently DROP such a def (its `wgsl` has no `fn preset(`) and fall
 *        back to Spectrum Bars, which is a misread, so those files must
 *        refuse to open there. Projects without shadertoy defs keep writing
 *        v11 and stay compatible.
 *
 * v13 (=) the Particles mode's internal preset id was renamed
 *        "starfield" -> "particles" (RENAMED_PRESET_IDS in render/presets).
 *        Loading migrates the old id at EVERY site it persists — presetId,
 *        the five per-preset maps and timeline scenes — before validation,
 *        for files of every prior version. CONDITIONAL like v12: only a
 *        document whose presetId or a scene actually references "particles"
 *        is stamped v13, because an older reader would MISREAD exactly those
 *        (validPresetId falls back to the default mode; validTimeline drops
 *        the scene). Per-preset map keys are merely preserved-unknown there,
 *        so they don't force the bump.
 *
 * v14 (=) the Kaleido Nebula advanced `saturation` changed SEMANTICS (RP-6):
 *        raw 0..1 palette mix (default 0.75) -> the roster colour-tier
 *        shape, a 0..2 whole-visual scaler with neutral 1. The shader
 *        anchors the scaler on the old default (satT = value * 0.75), so
 *        parseProject remaps every pre-v14 stored value by the exact inverse
 *        (v / 0.75) at each site a document persists one — paramsByPreset,
 *        nebula scene overrides, and nebula `saturation` mod-route amounts
 *        (those scale by the param's RANGE, which doubled while the shader
 *        slope shrank 0.75x, so amounts divide by 1.5) — and every old file
 *        renders identically. CONDITIONAL like v12/v13: only a document that
 *        actually CARRIES one of those values is stamped v14 — an older
 *        reader would render them oversaturated (they sit past its 0..1
 *        range) or over-modulated, a misread; a document without them is
 *        portable both ways, because absent-means-default holds on both
 *        sides and the two defaults render identically by construction.
 *        Version-GATED in parseProject, unlike the v13 rename pre-pass
 *        inside validateDocument: value semantics are invisible to
 *        inspection (the same 1.0 is a v13 ceiling and a v14 neutral), so
 *        only a reader that knows the file's schema can apply it. Recorded
 *        honestly: sibling stores that validate WITHOUT their version
 *        reaching this module — the localStorage last-session cache and
 *        .bfpreset looks — cannot ride this migration without plumbing of
 *        their own. (.bftheme documents DO thread their stored
 *        projectSchemaVersion through validation and ride it; themes.ts,
 *        pinned by themes.test.ts.)
 */

export const PROJECT_VERSION = 14;
export const PROJECT_EXTENSION = "bfproj";

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
  /** Per-mode background overrides — an entry here wins over `bg` while that
   * mode is active. Sparse: modes without an override follow the global bg. */
  bgByPreset: Record<string, BgSettings>;
  /** Per-mode center-image overrides (asset id): shown instead of the track's
   * embedded cover art by modes that draw a center image. */
  centerImageByPreset: Record<string, string>;
  overlayLayers: OverlayLayer[];
  assets: Record<string, OverlayAsset>;
  aspect: Aspect;
  modsByPreset: Record<string, ModRoute[]>;
  smoothSpectrum: boolean;
  timeline: Timeline;
  post: PostSettings;
  motion: MotionSettings;
  lyricStyle: LyricStyle;
  audiogram: AudiogramSettings;
  /** Custom WGSL defs the document references (active preset + timeline
   * scenes) — embedded so the project renders identically on a machine that
   * never imported the matching .bfshader. NOT the user's whole library. */
  customDefs: PresetDef[];
  /** Builder layer stack (renders when presetId === "builder2"). */
  builderStack: BuilderStack;
}

export interface ProjectFile {
  schemaVersion: number;
  kind: "bfproj";
  appVersion: string;
  savedAt: string;
  document: ProjectDocument;
}

export function serializeProject(document: ProjectDocument, appVersion: string): string {
  // Write the OLDEST schema that can represent the document (see the
  // v12/v13/v14 history notes): a shadertoy def forces v12; an ACTIVE
  // reference to the renamed "particles" id (presetId or a scene) forces
  // v13; a stored nebula `saturation` value at any of its three sites
  // forces v14 (an older reader would render exactly those wrong).
  const needsV14 =
    document.paramsByPreset.nebula?.saturation !== undefined ||
    document.timeline.scenes.some(
      (s) => s.presetId === "nebula" && s.params?.saturation !== undefined,
    ) ||
    (document.modsByPreset.nebula ?? []).some((r) => r.param === "saturation");
  const needsV13 =
    document.presetId === "particles" ||
    document.timeline.scenes.some((s) => s.presetId === "particles");
  const needsV12 = document.customDefs.some((d) => d.shadertoy);
  const file: ProjectFile = {
    schemaVersion: needsV14 ? PROJECT_VERSION : needsV13 ? 13 : needsV12 ? 12 : 11,
    kind: "bfproj",
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
  if (file.kind !== "bfproj") {
    throw new ProjectParseError("Not a .bfproj project file");
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
  // v14 pre-pass, version-GATED here rather than inside validateDocument:
  // the nebula saturation change is pure value semantics, so only the
  // file's schema number can say whether a stored value needs remapping.
  return validateDocument(file.schemaVersion < 14 ? migrateNebulaSaturationV14(doc) : doc);
}

/**
 * Re-key a Record whose keys are preset ids through canonicalPresetId, so a
 * map saved under a renamed id (v13: "starfield" -> "particles") lands under
 * the current one. Untrusted input: non-objects pass through untouched for
 * the field validators to reject, and an existing entry under the NEW id
 * wins over a legacy one (a hand-edited file carrying both). Built with
 * Object.fromEntries, which defines own properties — a "__proto__" key
 * cannot become the result's prototype. Exported for the localStorage
 * loaders in persistence.ts, which persist the same per-preset maps.
 */
export function migratePresetIdKeys(v: unknown): unknown {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return v;
  const entries = Object.entries(v);
  if (!entries.some(([k]) => canonicalPresetId(k) !== k)) return v;
  const taken = new Set(entries.map(([k]) => k));
  return Object.fromEntries(
    entries.flatMap(([k, val]) => {
      const canon = canonicalPresetId(k);
      if (canon === k) return [[k, val]];
      return taken.has(canon) ? [] : [[canon, val]];
    }),
  );
}

/** Timeline with every scene's presetId mapped through canonicalPresetId —
 * shapes the validator would reject pass through untouched. Exported for
 * persistence.ts (the localStorage timeline cache persists scene ids too). */
export function migrateTimelinePresetIds(v: unknown): unknown {
  if (typeof v !== "object" || v === null) return v;
  const t = v as { scenes?: unknown };
  if (!Array.isArray(t.scenes)) return v;
  const scenes = t.scenes.map((s) => {
    if (typeof s !== "object" || s === null) return s;
    const scene = s as { presetId?: unknown };
    if (typeof scene.presetId !== "string") return s;
    const canon = canonicalPresetId(scene.presetId);
    return canon === scene.presetId ? s : { ...scene, presetId: canon };
  });
  return { ...t, scenes };
}

/** Loose object guard for the untrusted shapes the migrations walk. */
function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * v14 pre-pass (RP-6): remap the Kaleido Nebula `saturation` values a
 * pre-v14 file stores. The old param entered the shader raw
 * (satT = value, 0..1, default 0.75); the new one is the colour-tier scaler
 * the shader folds onto the old authored point (satT = value * 0.75, 0..2,
 * neutral 1). Equal rendering therefore means oldValue = newValue * 0.75 —
 * so stored values map by the exact inverse, v / NEBULA_SAT_AUTHORED: the
 * old floor 0 stays 0, the old default 0.75 lands exactly on the new
 * default 1, and the old ceiling 1 lands on 4/3, inside the new range.
 * Deliberately NOT clamped: an out-of-range value in a hand-edited file
 * rendered out of range before and keeps rendering identically after.
 *
 * Three sites, all keyed to the nebula mode explicitly (never the bare
 * param name — sibling modes own a `saturation` of their own that always
 * had scaler semantics):
 *  - paramsByPreset.nebula.saturation — the headline;
 *  - timeline scene overrides on scenes whose presetId is "nebula";
 *  - modsByPreset.nebula routes targeting "saturation": a route's amount
 *    scales by the param's RANGE (applyMods adds value*amount*(max-min)),
 *    and the range doubled (1 -> 2) while the shader slope per param unit
 *    shrank to 0.75x — net 1.5x deeper modulation — so amounts divide by
 *    2 * NEBULA_SAT_AUTHORED = 1.5 to keep the depth users tuned. (The one
 *    unavoidable edge: a route that used to pin the old ceiling now has
 *    headroom up to the new 2, so pushes past the old clamp go brighter
 *    instead of flat — inherent to extending the range at all.)
 *
 * Automation lanes are deliberately NOT touched: a lane targets a bare
 * param key across whatever mode is active per scene, so the same
 * "saturation" lane can drive nebula in one scene and a colour-tier mode in
 * the next — no per-mode remap is well-defined there. That cross-mode
 * ambiguity predates this migration.
 *
 * Runs ONLY for files whose schemaVersion < 14 — the CALLER gates it,
 * unlike the version-independent rename pre-pass below, because a value
 * carries no evidence of its own semantics.
 */
export function migrateNebulaSaturationV14(
  doc: Partial<ProjectDocument>,
): Partial<ProjectDocument> {
  const out: Partial<ProjectDocument> = { ...doc };

  const maps: unknown = doc.paramsByPreset;
  if (isRec(maps) && isRec(maps.nebula) && typeof maps.nebula.saturation === "number") {
    const migrated: unknown = {
      ...maps,
      nebula: { ...maps.nebula, saturation: maps.nebula.saturation / NEBULA_SAT_AUTHORED },
    };
    out.paramsByPreset = migrated as typeof doc.paramsByPreset;
  }

  const t: unknown = doc.timeline;
  if (isRec(t) && Array.isArray(t.scenes)) {
    const scenes = (t.scenes as unknown[]).map((s) => {
      if (!isRec(s) || s.presetId !== "nebula") return s;
      const p = s.params;
      if (!isRec(p) || typeof p.saturation !== "number") return s;
      return { ...s, params: { ...p, saturation: p.saturation / NEBULA_SAT_AUTHORED } };
    });
    const migrated: unknown = { ...t, scenes };
    out.timeline = migrated as typeof doc.timeline;
  }

  const mods: unknown = doc.modsByPreset;
  if (isRec(mods) && Array.isArray(mods.nebula)) {
    const routes = (mods.nebula as unknown[]).map((r) => {
      if (!isRec(r) || r.param !== "saturation" || typeof r.amount !== "number") return r;
      return { ...r, amount: r.amount / (2 * NEBULA_SAT_AUTHORED) };
    });
    const migrated: unknown = { ...mods, nebula: routes };
    out.modsByPreset = migrated as typeof doc.modsByPreset;
  }

  return out;
}

/**
 * v13 pre-pass: map renamed preset ids at every site a document persists
 * them, BEFORE any validator runs — validPresetId/validTimeline would
 * otherwise treat the legacy id as unknown and fall back / drop the scene.
 * Applies to files of every prior version (the rename map is the honest
 * record of which ids ever changed; a legacy id cannot collide with a
 * custom one, which are "custom-"-prefixed).
 */
function migrateRenamedPresetIds(doc: Partial<ProjectDocument>): Partial<ProjectDocument> {
  const out: Partial<ProjectDocument> = { ...doc };
  if (typeof doc.presetId === "string") {
    out.presetId = canonicalPresetId(doc.presetId);
  }
  out.paramsByPreset = migratePresetIdKeys(doc.paramsByPreset) as typeof doc.paramsByPreset;
  out.syncByPreset = migratePresetIdKeys(doc.syncByPreset) as typeof doc.syncByPreset;
  out.bgByPreset = migratePresetIdKeys(doc.bgByPreset) as typeof doc.bgByPreset;
  out.centerImageByPreset = migratePresetIdKeys(
    doc.centerImageByPreset,
  ) as typeof doc.centerImageByPreset;
  out.modsByPreset = migratePresetIdKeys(doc.modsByPreset) as typeof doc.modsByPreset;
  out.timeline = migrateTimelinePresetIds(doc.timeline) as typeof doc.timeline;
  return out;
}

/**
 * Field-by-field validation + defaulting of an untrusted document. This IS
 * the migration path: older schemas simply lack fields and the validators
 * default them. Shared by .bfproj projects and .bftheme themes.
 */
export function validateDocument(rawDoc: Partial<ProjectDocument>): ProjectDocument {
  const doc = migrateRenamedPresetIds(rawDoc);
  // Custom defs FIRST, and registered immediately: validPresetId and
  // validTimeline both resolve custom-* ids through the runtime registry, so
  // a project that embeds the defs it references must have them registered
  // before those validators run — otherwise the preset falls back to the
  // default mode and timeline scenes are dropped. Registration is idempotent
  // (a re-import of the same id replaces the entry) and deliberately a side
  // effect of validation: every consumer (projects, themes, undo snapshots)
  // needs the same guarantee.
  const customDefs = validCustomDefs(doc.customDefs);
  for (const def of customDefs) registerCustomPreset(def);
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
    bgByPreset: validBgByPreset(doc.bgByPreset, assets),
    centerImageByPreset: validCenterImages(doc.centerImageByPreset, assets),
    overlayLayers: validLayers(doc.overlayLayers, assets),
    assets,
    aspect: validAspect(doc.aspect),
    modsByPreset: validModsByPreset(doc.modsByPreset),
    smoothSpectrum: doc.smoothSpectrum === true,
    timeline: validTimeline(doc.timeline),
    post: validPost(doc.post),
    motion: validMotion(doc.motion),
    lyricStyle: validLyricStyle(doc.lyricStyle),
    audiogram: validAudiogram(doc.audiogram),
    customDefs,
    builderStack:
      doc.builderStack === undefined ? defaultBuilderStack() : validBuilderStack(doc.builderStack),
  };
}

/** Whitelist-validate embedded custom defs; duplicates by id keep the first. */
export function validCustomDefs(v: unknown): PresetDef[] {
  if (!Array.isArray(v)) return [];
  const out: PresetDef[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    const def = validCustomPreset(raw);
    if (def && !seen.has(def.id)) {
      seen.add(def.id);
      out.push(def);
    }
  }
  return out;
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
  // knownPresetId covers strip presets, HIDDEN built-ins (the classic
  // builder left the strip in v2.44 but old projects keep rendering it),
  // Builder and registered custom defs. A custom id whose def the
  // user deleted falls back to the default mode.
  if (knownPresetId(v)) return v;
  return presets[0].id;
}

export function validParamsByPreset(v: unknown): Record<string, ParamValues> {
  if (typeof v !== "object" || v === null) return {};
  const out: Record<string, ParamValues> = Object.create(null);
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

/** Per-mode background overrides. Each entry is validated like the global bg
 * (including the dangling-asset degradations); entries that end up identical
 * to "no information" are still kept — sparseness is the caller's business,
 * an empty object is the default. */
export function validBgByPreset(
  v: unknown,
  assets: Record<string, OverlayAsset>,
): Record<string, BgSettings> {
  if (typeof v !== "object" || v === null) return {};
  const out: Record<string, BgSettings> = Object.create(null);
  for (const [presetId, raw] of Object.entries(v)) {
    if (typeof presetId !== "string" || !presetId) continue;
    const bg = validBg(raw);
    if (bg.mode === BG_IMAGE && (!bg.image || !assets[bg.image.assetId])) bg.mode = BG_PRESET;
    if (bg.mode === BG_VIDEO && (!bg.video || !assets[bg.video.assetId])) bg.mode = BG_PRESET;
    out[presetId] = bg;
  }
  return out;
}

/** Per-mode center-image overrides: presetId -> asset id. Entries whose asset
 * is gone are dropped (the mode falls back to the track's cover art). */
export function validCenterImages(
  v: unknown,
  assets: Record<string, OverlayAsset>,
): Record<string, string> {
  if (typeof v !== "object" || v === null) return {};
  const out: Record<string, string> = Object.create(null);
  for (const [presetId, assetId] of Object.entries(v)) {
    if (typeof presetId !== "string" || !presetId) continue;
    if (typeof assetId !== "string" || !assets[assetId]) continue;
    out[presetId] = assetId;
  }
  return out;
}

export function validSyncByPreset(v: unknown): Record<string, SyncSettings> {
  if (typeof v !== "object" || v === null) return {};
  const out: Record<string, SyncSettings> = Object.create(null);
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
      // Normalize through the SAME sanitizer the live pipeline uses instead of
      // rebuilding the field list here. This copy had drifted: it omitted
      // freqMin/freqMax, so every saved .bfproj/.bftheme silently discarded the
      // user's analysed-frequency-range setting and reopened at the defaults.
      // A parallel list also loses the NEXT field added to SyncSettings; there
      // is one canonical normalizer and this is it. The guard above still
      // rejects malformed entries rather than turning them into defaults.
      out[presetId] = sanitizeSync(s);
    }
  }
  return out;
}

const ANCHORS = new Set(["tl", "tc", "tr", "cl", "cc", "cr", "bl", "bc", "br"]);

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

/** The asset map holds overlay/background images AND video-background sources
 * (bg.video references one by id), so both MIME families must survive a
 * round-trip. Accepting only `data:image/` silently dropped every video asset
 * on load, which flipped bg.mode back to the preset background and left
 * bg.video as a dangling id that re-serialized forever.
 *
 * SVG is refused even though it starts with `data:image/`: consumption is
 * createImageBitmap (not innerHTML), so this isn't an XSS vector, but SVG
 * decoding is a known DoS surface (recursive references, huge intrinsic
 * sizes) with no upside over a raster format. This also matches the
 * theme-thumbnail validator (themes.ts), which already refused SVG — the two
 * disagreeing was the actual bug; openImageFile no longer offers `.svg` for
 * the same reason, so this only ever fires for a hand-edited or foreign file. */
export function validAssets(v: unknown): Record<string, OverlayAsset> {
  if (typeof v !== "object" || v === null) return {};
  const out: Record<string, OverlayAsset> = Object.create(null);
  for (const [id, asset] of Object.entries(v)) {
    const a = asset as Partial<OverlayAsset>;
    if (
      typeof a === "object" &&
      a !== null &&
      typeof a.dataUrl === "string" &&
      (a.dataUrl.startsWith("data:image/") || a.dataUrl.startsWith("data:video/")) &&
      !a.dataUrl.startsWith("data:image/svg+xml")
    ) {
      const isVideo = a.dataUrl.startsWith("data:video/");
      out[id] = {
        id,
        name: typeof a.name === "string" ? a.name : isVideo ? "video" : "image",
        dataUrl: a.dataUrl,
      };
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

/**
 * One CSS font family: a letter, then letters/digits/spaces/`-`/`_`.
 *
 * A WHITELIST, not an escape. The family is pasted straight into `ctx.font`,
 * and the 2D spec requires an unparseable font assignment to be IGNORED — no
 * throw, no warning — so an imported .bfproj/.bftheme whose family contains a
 * `;`, a `}`, a quote or a leading digit silently renders the layer at the
 * 10px sans-serif default in BOTH the preview and the export, with nothing
 * reported. Unicode letter classes, so real families ("Noto Sans JP",
 * "游ゴシック") pass; nothing that can terminate the shorthand does.
 */
const FONT_FAMILY_RE = /^\p{L}[\p{L}\p{N} _-]*$/u;

/**
 * Validate a font family (or a comma-separated stack), falling back to the
 * same family defaultTextLayer uses. Each part is checked independently
 * because ONE bad family invalidates the whole `ctx.font` shorthand —
 * "Arial, 3Bad" is as dead as "3Bad" on its own.
 */
export function validFontFamily(v: unknown): string {
  if (typeof v !== "string") return "Arial";
  const s = v.trim().slice(0, 100);
  if (!s) return "Arial";
  return s.split(",").every((p) => FONT_FAMILY_RE.test(p.trim())) ? s : "Arial";
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
        font: validFontFamily(t.font),
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
      // The asset map also holds video-background sources now, so an image
      // layer must reference an actual image — not merely an existing asset.
      if (typeof i.assetId !== "string") continue;
      const src = assets[i.assetId];
      if (!src || !src.dataUrl.startsWith("data:image/")) continue;
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
    /** Framing (fit/zoom/pan), shared by image and video backgrounds. All four
     * are optional-with-default: a file saved before they existed lands on
     * cover / no zoom / centred, which is exactly what the composite pass used
     * to hardcode — so old projects render identically and PROJECT_VERSION
     * does not move (same treatment as SyncSettings' shapeMerge/contrast). */
    const fitOf = (b: BgFit): Required<BgFit> => ({
      // Snapped, not clamped: the shader branches on 0/1/2, so a hand-edited
      // 1.4 would silently select contain instead of being rejected.
      fit: Math.round(n(b.fit, 0, 0, 2)),
      zoom: n(b.zoom, 1, 0.25, 4),
      offsetX: n(b.offsetX, 0, -1, 1),
      offsetY: n(b.offsetY, 0, -1, 1),
    });
    const image =
      typeof bg!.image === "object" &&
      bg!.image !== null &&
      typeof bg!.image.assetId === "string" &&
      bg!.image.assetId.length > 0
        ? {
            assetId: bg!.image.assetId,
            dim: n(bg!.image.dim, 0.25, 0, 0.9),
            blur: n(bg!.image.blur, 0, 0, 60),
            ...fitOf(bg!.image),
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
            ...fitOf(bg!.video),
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
