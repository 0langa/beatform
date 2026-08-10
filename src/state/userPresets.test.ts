import { describe, expect, it, vi } from "vitest";
import {
  loadUserPresets,
  newUserPresetId,
  parseUserPreset,
  saveUserPresets,
  serializeUserPreset,
  USER_PRESET_VERSION,
  UserPresetParseError,
  type UserPreset,
} from "./userPresets";
import { presets } from "../render/presets";

const look: UserPreset = {
  id: "up-test-1",
  name: "Neon Drop",
  presetId: presets[1].id,
  params: { intensity: 0.9, hue: 0.62 },
  sync: { mode: "kick", smooth: 0.3 },
  createdAt: "2026-07-13T00:00:00.000Z",
};

describe("user presets (.bfpreset)", () => {
  it("round-trips serialize → parse (with fresh identity)", () => {
    const parsed = parseUserPreset(serializeUserPreset(look));
    expect(parsed.name).toBe(look.name);
    expect(parsed.presetId).toBe(look.presetId);
    expect(parsed.params).toEqual(look.params);
    expect(parsed.sync).toEqual(look.sync);
    // Importing the same file twice must not collide
    expect(parsed.id).not.toBe(look.id);
  });

  it("rejects non-preset JSON", () => {
    expect(() => parseUserPreset('{"kind": "other"}')).toThrow(UserPresetParseError);
    expect(() => parseUserPreset("garbage")).toThrow(UserPresetParseError);
  });

  it("rejects looks for unknown visual modes", () => {
    const file = JSON.parse(serializeUserPreset(look));
    file.preset.presetId = "no-such-mode";
    expect(() => parseUserPreset(JSON.stringify(file))).toThrow(UserPresetParseError);
  });

  it("migrates a look saved under a RENAMED mode id (starfield -> particles)", () => {
    // Pre-v2.68 saved looks (localStorage entries, hand-carried files) carry
    // the legacy id; dropping them as unknown would silently delete them.
    const file = JSON.parse(serializeUserPreset(look));
    file.preset.presetId = "starfield";
    const parsed = parseUserPreset(JSON.stringify(file));
    expect(parsed.presetId).toBe("particles");
    expect(parsed.params).toEqual(look.params);
  });

  it("rejects malformed params", () => {
    const file = JSON.parse(serializeUserPreset(look));
    file.preset.params = { a: "not a number" };
    expect(() => parseUserPreset(JSON.stringify(file))).toThrow(UserPresetParseError);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newUserPresetId()));
    expect(ids.size).toBe(100);
  });

  // Regression (L16): parseUserPreset validated the file then spread the
  // ORIGINAL untrusted object, so any extra key rode straight through into
  // app state and got re-serialized on the next save.
  it("drops unvalidated extra keys instead of carrying them through", () => {
    const file = JSON.parse(serializeUserPreset(look));
    (file.preset as Record<string, unknown>).extra = "unexpected";
    (file.preset as Record<string, unknown>).__proto__polluter = "nope";
    const parsed = parseUserPreset(JSON.stringify(file));
    expect(parsed).not.toHaveProperty("extra");
    expect(parsed).not.toHaveProperty("__proto__polluter");
    expect(Object.keys(parsed).sort()).toEqual(
      ["createdAt", "id", "name", "params", "presetId", "sync"].sort(),
    );
  });

  // Regression (L16): isValidUserPreset never looked at `sync` at all, so a
  // malformed sync object passed through completely unexamined and sat in
  // state/storage as-is. It should be coerced through the same sanitizer
  // setSync itself uses for untrusted sync data, not ignored.
  it("sanitizes a malformed sync instead of passing it through untouched", () => {
    const file = JSON.parse(serializeUserPreset(look));
    file.preset.sync = { mode: "psychic", smooth: 5 };
    const parsed = parseUserPreset(JSON.stringify(file));
    expect(parsed.sync).toEqual({ mode: "kick", smooth: 1 });
  });

  it("leaves sync undefined when the file has none, rather than inventing one", () => {
    const file = JSON.parse(serializeUserPreset(look));
    delete file.preset.sync;
    const parsed = parseUserPreset(JSON.stringify(file));
    expect(parsed.sync).toBeUndefined();
  });
});

describe("loadUserPresets (localStorage round-trip)", () => {
  function fakeLocalStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
  }

  it("round-trips a saved preset with its own id and sync intact", () => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
    saveUserPresets([look]);
    const loaded = loadUserPresets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(look);
    vi.unstubAllGlobals();
  });

  // Same hardening applies to locally-stored presets, not just imported
  // files: a hand-edited or corrupted localStorage entry gets the same
  // explicit-build treatment as an imported .bfpreset.
  it("drops extra keys and sanitizes sync for entries already in storage", () => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
    saveUserPresets([{ ...look, sync: { mode: "psychic" as never, smooth: 99 } } as UserPreset]);
    // Simulate hand-tampering after the save.
    const raw = JSON.parse(localStorage.getItem("viz.userPresets.v1")!);
    raw[0].extra = "garbage";
    localStorage.setItem("viz.userPresets.v1", JSON.stringify(raw));

    const loaded = loadUserPresets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).not.toHaveProperty("extra");
    expect(loaded[0].sync).toEqual({ mode: "kick", smooth: 1 });
    vi.unstubAllGlobals();
  });
});

/**
 * The v14 gap in .bfpreset, pinned as CHOSEN rather than missed.
 *
 * Schema v14 changed Kaleido Nebula's `saturation` from a raw 0..1 palette mix
 * to a 0..2 scaler. .bfproj (parseProject) and .bftheme (parseTheme) remap
 * stored pre-v14 values; looks do not, and cannot without an owner decision:
 * a look carries no document-schema number, and the envelope's `schemaVersion`
 * tracks the LOOK format, so nothing distinguishes a pre-v14 value from a
 * post-v14 one. See the note above loadUserPresets, and project.ts:112-116.
 */
describe("user looks do NOT ride the v14 nebula remap (a chosen gap)", () => {
  function fakeLocalStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
  }

  // E1. MUTATION: any content-keyed or key-bumped remap landing here without
  // an owner decision. REACHABLE because 0.6 is not a fixed point of v / 0.75
  // — it would load as 0.8 — and the look uses "nebula", the exact id every
  // form of the migration keys on.
  it("E1: a stored pre-v14 nebula look loads verbatim, saturation untouched", () => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
    const nebulaLook: UserPreset = {
      id: "up-nebula-1",
      name: "Old Nebula",
      presetId: "nebula",
      params: { saturation: 0.6 },
      createdAt: "2026-06-01T00:00:00.000Z",
    };
    saveUserPresets([nebulaLook]);
    const loaded = loadUserPresets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].params.saturation).toBe(0.6);
    expect(loaded[0]).toEqual(nebulaLook);
    vi.unstubAllGlobals();
  });

  // E3. A TRIPWIRE, not a behaviour test.
  //
  // Bumping USER_PRESET_VERSION makes every newly written .bfpreset unreadable
  // by every build shipped through 2.89.0 (parseUserPreset refuses
  // schemaVersion > USER_PRESET_VERSION) and refused by the gallery's own
  // entryGate. That is a public-file-format decision and the owner's call.
  // This pin exists so the bump cannot happen without someone deleting it and
  // reading why.
  it("E3: USER_PRESET_VERSION is pinned at 1 — bumping it is the owner's call", () => {
    expect(USER_PRESET_VERSION).toBe(1);
  });
});
