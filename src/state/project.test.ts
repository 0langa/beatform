import { describe, expect, it } from "vitest";
import { parseProject, ProjectParseError, serializeProject, type ProjectDocument } from "./project";
import { BG_SOLID } from "../render/types";
import { presets } from "../render/presets";

const doc: ProjectDocument = {
  presetId: presets[2].id,
  paramsByPreset: {
    [presets[2].id]: { intensity: 0.8, speed: 1.25 },
    [presets[0].id]: { barCount: 64 },
  },
  syncByPreset: {
    [presets[2].id]: { mode: "bass" as const, smooth: 0.7 },
  },
  bg: { mode: BG_SOLID, color: [0, 0.69, 0.25] as [number, number, number] },
};

describe("project files (.avproj)", () => {
  it("round-trips serialize → parse", () => {
    const json = serializeProject(doc, "1.2.0");
    expect(parseProject(json)).toEqual(doc);
  });

  it("stamps metadata", () => {
    const file = JSON.parse(serializeProject(doc, "1.2.0"));
    expect(file.kind).toBe("avproj");
    expect(file.schemaVersion).toBe(1);
    expect(file.appVersion).toBe("1.2.0");
    expect(typeof file.savedAt).toBe("string");
  });

  it("rejects non-JSON", () => {
    expect(() => parseProject("not json {")).toThrow(ProjectParseError);
  });

  it("rejects JSON that is not a project", () => {
    expect(() => parseProject('{"foo": 1}')).toThrow(ProjectParseError);
    expect(() => parseProject('"a string"')).toThrow(ProjectParseError);
  });

  it("rejects files from a newer schema", () => {
    const file = JSON.parse(serializeProject(doc, "1.2.0"));
    file.schemaVersion = 99;
    expect(() => parseProject(JSON.stringify(file))).toThrow(/newer app version/);
  });

  it("sanitizes malformed fields instead of crashing", () => {
    const file = JSON.parse(serializeProject(doc, "1.2.0"));
    file.document.presetId = "no-such-preset";
    file.document.bg = { mode: 42, color: "red" };
    file.document.paramsByPreset = {
      ok: { a: 1, bad: "x", worse: Infinity },
      broken: null,
    };
    file.document.syncByPreset = {
      ok: { mode: "bass", smooth: 3 }, // smooth out of range → clamped
      bad: { mode: "psychic", smooth: 0.5 },
    };
    const parsed = parseProject(JSON.stringify(file));
    expect(parsed.presetId).toBe(presets[0].id); // fallback
    expect(parsed.bg).toEqual({ mode: 0, color: [0, 0, 0] }); // fallback
    expect(parsed.paramsByPreset.ok).toEqual({ a: 1 }); // non-finite dropped
    expect(parsed.syncByPreset.ok).toEqual({ mode: "bass", smooth: 1 });
    expect(parsed.syncByPreset.bad).toBeUndefined();
  });
});
