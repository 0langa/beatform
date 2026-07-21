import { describe, expect, it, vi } from "vitest";
import {
  loadUserPresets,
  newUserPresetId,
  parseUserPreset,
  saveUserPresets,
  serializeUserPreset,
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

describe("user presets (.avpreset)", () => {
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
  // explicit-build treatment as an imported .avpreset.
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
