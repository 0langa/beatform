import { describe, expect, it } from "vitest";
import { parseProject, ProjectParseError, serializeProject, type ProjectDocument } from "./project";
import { BG_SOLID } from "../render/types";
import { presets } from "../render/presets";

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
  overlayLayers: [
    {
      id: "ly-1",
      type: "text",
      text: "{title}",
      font: "Arial",
      weight: 700,
      size: 0.06,
      color: [1, 1, 1],
      opacity: 1,
      letterSpacing: 0.05,
      anchor: "bc",
      offset: [0, -0.06],
      glow: 0.3,
      uppercase: true,
    },
    {
      id: "ly-2",
      type: "image",
      assetId: "as-1",
      size: 0.2,
      opacity: 0.9,
      anchor: "tr",
      offset: [-0.03, 0.05],
      rounded: 0.1,
    },
  ],
  assets: { "as-1": { id: "as-1", name: "logo.png", dataUrl: PIXEL } },
  aspect: "9:16",
  modsByPreset: {
    [presets[2].id]: [{ id: "mr-1", source: "kick", param: "intensity", amount: 0.6 }],
  },
  smoothSpectrum: true,
};

describe("project files (.avproj)", () => {
  it("round-trips serialize → parse", () => {
    const json = serializeProject(doc, "1.2.0");
    expect(parseProject(json)).toEqual(doc);
  });

  it("stamps metadata", () => {
    const file = JSON.parse(serializeProject(doc, "1.2.0"));
    expect(file.kind).toBe("avproj");
    expect(file.schemaVersion).toBe(3);
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

  it("migrates v1 files (no overlay fields) to empty layers/assets", () => {
    const file = JSON.parse(serializeProject(doc, "1.2.0"));
    file.schemaVersion = 1;
    delete file.document.overlayLayers;
    delete file.document.assets;
    delete file.document.aspect;
    delete file.document.modsByPreset;
    const parsed = parseProject(JSON.stringify(file));
    expect(parsed.overlayLayers).toEqual([]);
    expect(parsed.assets).toEqual({});
    expect(parsed.aspect).toBe("free"); // v1 default
    expect(parsed.modsByPreset).toEqual({}); // pre-v3 default
    expect(parsed.presetId).toBe(doc.presetId);
  });

  it("sanitizes mod routes (bad sources/amounts dropped or clamped)", () => {
    const file = JSON.parse(serializeProject(doc, "1.5.0"));
    file.document.modsByPreset = {
      ok: [
        { id: "a", source: "kick", param: "x", amount: 5 }, // clamped to 1
        { id: "b", source: "psychic", param: "x", amount: 0.5 }, // dropped
        { id: "c", source: "bass", param: "", amount: 0.5 }, // dropped (no param)
      ],
    };
    const parsed = parseProject(JSON.stringify(file));
    expect(parsed.modsByPreset.ok).toHaveLength(1);
    expect(parsed.modsByPreset.ok[0].amount).toBe(1);
  });

  it("drops image layers whose asset is missing and clamps layer numbers", () => {
    const file = JSON.parse(serializeProject(doc, "1.2.0"));
    file.document.overlayLayers.push({
      id: "ly-orphan",
      type: "image",
      assetId: "no-such-asset",
      size: 0.2,
      opacity: 1,
      anchor: "cc",
      offset: [0, 0],
      rounded: 0,
    });
    file.document.overlayLayers[0].size = 99; // way out of range → clamped
    file.document.overlayLayers[0].anchor = "weird"; // → "cc"
    const parsed = parseProject(JSON.stringify(file));
    expect(parsed.overlayLayers.find((l) => l.id === "ly-orphan")).toBeUndefined();
    const text = parsed.overlayLayers[0];
    expect(text.type).toBe("text");
    if (text.type === "text") {
      expect(text.size).toBeLessThanOrEqual(0.5);
      expect(text.anchor).toBe("cc");
    }
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
