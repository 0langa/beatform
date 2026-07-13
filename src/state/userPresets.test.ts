import { describe, expect, it } from "vitest";
import {
  newUserPresetId,
  parseUserPreset,
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
});
