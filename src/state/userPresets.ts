import { sanitizeSync, type SyncSettings } from "../audio/types";
import type { ParamValues } from "../render/types";
import { canonicalPresetId, presets } from "../render/presets";
import { safeSetItem } from "./persistence";

/**
 * User presets ("my looks"): a named snapshot of one visual mode's params
 * (+ its sync settings). Stored in localStorage; exchanged as .bfpreset
 * files so looks can be shared. Distinct from factory styles (in code) and
 * from projects (whole-session .bfproj).
 */

export const USER_PRESET_VERSION = 1;
export const USER_PRESET_EXTENSION = "bfpreset";
const LS_KEY = "viz.userPresets.v1";

export interface UserPreset {
  id: string;
  name: string;
  /** Visual mode this look belongs to. */
  presetId: string;
  params: ParamValues;
  sync?: SyncSettings;
  createdAt: string;
}

interface UserPresetFile {
  schemaVersion: number;
  kind: "bfpreset";
  preset: UserPreset;
}

/**
 * KNOWN GAP, chosen deliberately: a look saved for Kaleido Nebula before
 * schema v14 (app 2.75.0) still carries the OLD `saturation` semantics — a raw
 * 0..1 palette mix — and is loaded verbatim, so it renders ~21% flatter than
 * it did when it was saved. It does not ride the v14 remap that .bfproj
 * (parseProject) and .bftheme (parseTheme) run, for two reasons that are not
 * fixable inside this file:
 *
 *  - This list has no version stamp of any kind, and the .bfpreset envelope's
 *    `schemaVersion` tracks the LOOK format (still 1), not the document
 *    schema — so nothing here can tell a pre-v14 value from a post-v14 one.
 *    The values are the same numbers under both readings.
 *  - Bumping USER_PRESET_VERSION to carry the distinction would make every
 *    newly written file unreadable by every build shipped through 2.89.0
 *    (parseUserPreset refuses schemaVersion > USER_PRESET_VERSION), which is
 *    an owner-level call about a public file format, not a migration detail.
 *
 * Recorded rather than papered over — see the v14 note in project.ts
 * (lines 112-116), which names this store as one of the three that cannot ride
 * the migration. userPresets.test.ts pins the current behaviour so the gap
 * cannot close by accident.
 */
export function loadUserPresets(): UserPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const out: UserPreset[] = [];
    for (const item of raw) {
      const preset = validUserPreset(item);
      if (preset) out.push(preset);
    }
    return out;
  } catch {
    return [];
  }
}

export function saveUserPresets(list: UserPreset[]): void {
  safeSetItem(LS_KEY, JSON.stringify(list));
}

export function newUserPresetId(): string {
  return `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function serializeUserPreset(preset: UserPreset): string {
  const file: UserPresetFile = {
    schemaVersion: USER_PRESET_VERSION,
    kind: "bfpreset",
    preset,
  };
  return JSON.stringify(file, null, 2);
}

export class UserPresetParseError extends Error {}

export function parseUserPreset(json: string): UserPreset {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new UserPresetParseError("Not a valid JSON file");
  }
  const file = raw as Partial<UserPresetFile>;
  if (file?.kind !== "bfpreset") {
    throw new UserPresetParseError("Not a .bfpreset file");
  }
  if (typeof file.schemaVersion !== "number" || file.schemaVersion > USER_PRESET_VERSION) {
    throw new UserPresetParseError(
      "Preset was saved by a newer app version; update the app to import it",
    );
  }
  const preset = validUserPreset(file.preset);
  if (!preset) {
    throw new UserPresetParseError("Preset file is malformed");
  }
  // Fresh identity on import: the same file imported twice must not collide.
  // preset was just built field-by-field below, so this spread is safe —
  // it can only carry the fields validUserPreset put there itself.
  return { ...preset, id: newUserPresetId() };
}

/**
 * Validate an untrusted value and build a clean UserPreset from ONLY its
 * known fields, or return null.
 *
 * Previously this was a boolean type-guard (isValidUserPreset) and both
 * call sites spread the ORIGINAL untrusted object after it passed — so any
 * extra key in a hand-edited or foreign .bfpreset file (or a corrupted
 * localStorage entry) rode straight through into app state and got
 * re-serialized on the next save. It also never looked at `sync` at all:
 * a malformed sync object passed validation unexamined and sat in state/
 * storage until something happened to sanitize it (setSync does, at apply
 * time — but only once the look was actually applied, not at rest).
 * Building the object explicitly, field by field, closes both gaps: unknown
 * keys have nowhere to attach, and sync (still optional) is run through the
 * same sanitizer setSync itself uses for exactly this kind of untrusted input.
 */
function validUserPreset(v: unknown): UserPreset | null {
  const p = v as Partial<UserPreset>;
  // Renamed built-in ids (v13: "starfield" -> "particles") are mapped before
  // the membership check — a saved look for a renamed mode must keep loading,
  // not be silently dropped from the library on the next save.
  const presetId = typeof p.presetId === "string" ? canonicalPresetId(p.presetId) : null;
  if (
    typeof p !== "object" ||
    p === null ||
    typeof p.id !== "string" ||
    typeof p.name !== "string" ||
    p.name.length === 0 ||
    presetId === null ||
    !presets.some((x) => x.id === presetId) ||
    typeof p.params !== "object" ||
    p.params === null ||
    !Object.values(p.params).every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    return null;
  }
  return {
    id: p.id,
    name: p.name,
    presetId,
    params: { ...p.params },
    ...(p.sync !== undefined ? { sync: sanitizeSync(p.sync) } : {}),
    createdAt: typeof p.createdAt === "string" ? p.createdAt : new Date().toISOString(),
  };
}
