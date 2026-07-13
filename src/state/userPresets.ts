import type { SyncSettings } from "../audio/types";
import type { ParamValues } from "../render/types";
import { presets } from "../render/presets";

/**
 * User presets ("my looks"): a named snapshot of one visual mode's params
 * (+ its sync settings). Stored in localStorage; exchanged as .avpreset
 * files so looks can be shared. Distinct from factory styles (in code) and
 * from projects (whole-session .avproj).
 */

export const USER_PRESET_VERSION = 1;
export const USER_PRESET_EXTENSION = "avpreset";
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
  kind: "avpreset";
  preset: UserPreset;
}

export function loadUserPresets(): UserPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter(isValidUserPreset) : [];
  } catch {
    return [];
  }
}

export function saveUserPresets(list: UserPreset[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}

export function newUserPresetId(): string {
  return `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function serializeUserPreset(preset: UserPreset): string {
  const file: UserPresetFile = {
    schemaVersion: USER_PRESET_VERSION,
    kind: "avpreset",
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
  if (file?.kind !== "avpreset") {
    throw new UserPresetParseError("Not an .avpreset file");
  }
  if (typeof file.schemaVersion !== "number" || file.schemaVersion > USER_PRESET_VERSION) {
    throw new UserPresetParseError(
      "Preset was saved by a newer app version; update the app to import it",
    );
  }
  if (!isValidUserPreset(file.preset)) {
    throw new UserPresetParseError("Preset file is malformed");
  }
  // Fresh identity on import: the same file imported twice must not collide.
  return { ...file.preset, id: newUserPresetId() };
}

function isValidUserPreset(v: unknown): v is UserPreset {
  const p = v as Partial<UserPreset>;
  return (
    typeof p === "object" &&
    p !== null &&
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    p.name.length > 0 &&
    typeof p.presetId === "string" &&
    presets.some((x) => x.id === p.presetId) &&
    typeof p.params === "object" &&
    p.params !== null &&
    Object.values(p.params).every((n) => typeof n === "number" && Number.isFinite(n))
  );
}
