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
  timeline: {
    enabled: true,
    scenes: [{ id: "sc-1", name: "Drop", presetId: presets[1].id, start: 30 }],
    lanes: [
      {
        param: "hue",
        keyframes: [
          { id: "kf-1", t: 0, value: 100, curve: "linear" as const },
          { id: "kf-2", t: 10, value: 200, curve: "smooth" as const },
        ],
      },
    ],
  },
  post: {
    bloom: 0.5,
    bloomThreshold: 0.9,
    exposure: 1.2,
    tonemap: true,
    vignette: 0.3,
    grain: 0.05,
    chromatic: 0.2,
  },
  motion: { rotation: 0.5, pulse: 1.5, detail: 0.7, spectrumSmooth: 0.4 },
};

describe("project files (.avproj)", () => {
  it("round-trips serialize → parse", () => {
    const json = serializeProject(doc, "1.2.0");
    expect(parseProject(json)).toEqual(doc);
  });

  it("stamps metadata", () => {
    const file = JSON.parse(serializeProject(doc, "1.2.0"));
    expect(file.kind).toBe("avproj");
    expect(file.schemaVersion).toBe(8);
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
    delete file.document.timeline;
    delete file.document.post;
    delete file.document.motion;
    const parsed = parseProject(JSON.stringify(file));
    expect(parsed.overlayLayers).toEqual([]);
    expect(parsed.assets).toEqual({});
    expect(parsed.aspect).toBe("free"); // v1 default
    expect(parsed.modsByPreset).toEqual({}); // pre-v3 default
    expect(parsed.post.bloom).toBe(0); // pre-v5 default (neutral)
    expect(parsed.post.exposure).toBe(1);
    expect(parsed.motion).toEqual({ rotation: 1, pulse: 1, detail: 1, spectrumSmooth: 0 }); // pre-v6 default (neutral)
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

  it("v7: image background round-trips with clamped dim/blur", () => {
    const file = JSON.parse(serializeProject(doc, "x"));
    file.document.assets = {
      "as-1": { id: "as-1", name: "bg", dataUrl: "data:image/png;base64,AA" },
    };
    file.document.bg = { mode: 3, color: [0, 0, 0], image: { assetId: "as-1", dim: 5, blur: -2 } };
    const parsed = parseProject(JSON.stringify(file));
    expect(parsed.bg.mode).toBe(3);
    expect(parsed.bg.image).toEqual({ assetId: "as-1", dim: 0.9, blur: 0 }); // clamped
  });

  it("v7: image background with a missing asset degrades to the preset bg", () => {
    const file = JSON.parse(serializeProject(doc, "x"));
    file.document.bg = { mode: 3, color: [0, 0, 0], image: { assetId: "gone", dim: 0.2, blur: 4 } };
    const parsed = parseProject(JSON.stringify(file));
    expect(parsed.bg.mode).toBe(0); // no black hole
  });

  it("v7: image mode without any image reference degrades too", () => {
    const file = JSON.parse(serializeProject(doc, "x"));
    file.document.bg = { mode: 3, color: [0, 0, 0] };
    const parsed = parseProject(JSON.stringify(file));
    expect(parsed.bg.mode).toBe(0);
  });

  // Regression: video assets are minted as `data:video/…` but validAssets only
  // accepted `data:image/`, so every save/load silently dropped the asset and
  // flipped bg.mode back to the preset background — a shipped feature that
  // could not survive being saved.
  it("video background survives a round-trip (asset + mode + dim/blur)", () => {
    const file = JSON.parse(serializeProject(doc, "x"));
    file.document.assets = {
      "vid-1": { id: "vid-1", name: "clip", dataUrl: "data:video/mp4;base64,AA" },
    };
    file.document.bg = {
      mode: 4,
      color: [0, 0, 0],
      video: { assetId: "vid-1", dim: 0.4, blur: 12 },
    };
    const parsed = parseProject(JSON.stringify(file));
    expect(parsed.assets["vid-1"]?.dataUrl).toBe("data:video/mp4;base64,AA");
    expect(parsed.bg.mode).toBe(4);
    expect(parsed.bg.video).toEqual({ assetId: "vid-1", dim: 0.4, blur: 12 });
  });

  it("video background with a missing asset still degrades to the preset bg", () => {
    const file = JSON.parse(serializeProject(doc, "x"));
    file.document.bg = { mode: 4, color: [0, 0, 0], video: { assetId: "gone", dim: 0.4, blur: 0 } };
    const parsed = parseProject(JSON.stringify(file));
    expect(parsed.bg.mode).toBe(0);
  });

  it("an image layer cannot reference a video asset", () => {
    const file = JSON.parse(serializeProject(doc, "x"));
    file.document.assets = {
      "vid-1": { id: "vid-1", name: "clip", dataUrl: "data:video/mp4;base64,AA" },
    };
    file.document.overlayLayers = [
      { id: "l1", type: "image", assetId: "vid-1", size: 0.2, opacity: 1, anchor: "center" },
    ];
    const parsed = parseProject(JSON.stringify(file));
    expect(parsed.overlayLayers).toHaveLength(0);
  });

  // Regression (M26): video backgrounds landed after the v7 bump with no
  // version bump of their own, so a pre-video file and a post-video file
  // were both stamped schemaVersion 7 and indistinguishable. v8 gives the
  // current (video-capable) shape its own number; old files must still open.
  describe("schema v7 -> v8 (video backgrounds)", () => {
    it("the current shape is stamped v8", () => {
      const file = JSON.parse(serializeProject(doc, "2.35.0"));
      expect(file.schemaVersion).toBe(8);
    });

    it("still opens a real v7 file saved before video backgrounds existed", () => {
      // A pre-video .avproj: schemaVersion 7, image background only, no
      // bg.video anywhere in the shape — exactly what an app version before
      // video backgrounds landed would have written to disk.
      const file = {
        schemaVersion: 7,
        kind: "avproj",
        appVersion: "2.20.0",
        savedAt: "2025-01-01T00:00:00.000Z",
        document: {
          ...doc,
          assets: { "as-1": { id: "as-1", name: "bg.png", dataUrl: PIXEL } },
          bg: { mode: 3, color: [0, 0, 0], image: { assetId: "as-1", dim: 0.3, blur: 5 } },
        },
      };
      const parsed = parseProject(JSON.stringify(file));
      expect(parsed.bg.mode).toBe(3);
      expect(parsed.bg.image).toEqual({ assetId: "as-1", dim: 0.3, blur: 5 });
      expect(parsed.presetId).toBe(doc.presetId);
    });

    it("opens a v8 file with a video background", () => {
      const file = {
        schemaVersion: 8,
        kind: "avproj",
        appVersion: "2.35.0",
        savedAt: "2026-07-01T00:00:00.000Z",
        document: {
          ...doc,
          assets: {
            "vid-1": { id: "vid-1", name: "clip.mp4", dataUrl: "data:video/mp4;base64,AA" },
          },
          bg: { mode: 4, color: [0, 0, 0], video: { assetId: "vid-1", dim: 0.4, blur: 12 } },
        },
      };
      const parsed = parseProject(JSON.stringify(file));
      expect(parsed.bg.mode).toBe(4);
      expect(parsed.bg.video).toEqual({ assetId: "vid-1", dim: 0.4, blur: 12 });
      expect(parsed.assets["vid-1"]?.dataUrl).toBe("data:video/mp4;base64,AA");
    });

    it("still rejects a file from a schema newer than the current v8", () => {
      const file = JSON.parse(serializeProject(doc, "x"));
      file.schemaVersion = 9;
      expect(() => parseProject(JSON.stringify(file))).toThrow(/newer app version/);
    });
  });

  // Regression (L17): validAssets accepted `data:image/svg+xml` (it matches
  // the generic `data:image/` prefix) while the theme-thumbnail validator
  // explicitly refused SVG — the two disagreed. SVG decoding is a known DoS
  // surface and consumption is createImageBitmap either way, so there is no
  // upside to accepting it; make the general asset validator refuse it too.
  it("refuses an SVG asset (matches the theme-thumbnail validator)", () => {
    const file = JSON.parse(serializeProject(doc, "x"));
    file.document.assets = {
      "svg-1": {
        id: "svg-1",
        name: "logo.svg",
        dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      },
    };
    const parsed = parseProject(JSON.stringify(file));
    expect(parsed.assets["svg-1"]).toBeUndefined();
  });

  it("an SVG background asset degrades to the preset bg instead of persisting", () => {
    const file = JSON.parse(serializeProject(doc, "x"));
    file.document.assets = {
      "svg-1": {
        id: "svg-1",
        name: "bg.svg",
        dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      },
    };
    file.document.bg = {
      mode: 3,
      color: [0, 0, 0],
      image: { assetId: "svg-1", dim: 0.2, blur: 0 },
    };
    const parsed = parseProject(JSON.stringify(file));
    expect(parsed.assets["svg-1"]).toBeUndefined();
    expect(parsed.bg.mode).toBe(0); // no black hole, same degrade path as a missing asset
  });
});
