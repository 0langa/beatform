import { describe, expect, it } from "vitest";
import {
  parseProject,
  PROJECT_VERSION,
  ProjectParseError,
  serializeProject,
  type ProjectDocument,
  validBg,
  validBgByPreset,
  validCenterImages,
  validLayers,
  validateDocument,
} from "./project";
import { BG_SOLID } from "../render/types";
import { presets } from "../render/presets";

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** The framing validBg fills in for a background that carries none — and, not
 * by coincidence, the exact cover crop the composite shader used to hardcode.
 * Every pre-BgFit file must come out of the validator wearing this. */
const NEUTRAL_FIT = { fit: 0, zoom: 1, offsetX: 0, offsetY: 0 };

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
  bgByPreset: {},
  centerImageByPreset: {},
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
  lyricStyle: {
    enabled: true,
    position: "center" as const,
    size: 1.4,
    color: "#ffcc00",
    fadeSec: 0.3,
    anim: "wipe" as const,
  },
  audiogram: {
    progressBar: true,
    timeReadout: false,
    waveformStrip: true,
    position: "top" as const,
    color: "#00ffaa",
  },
  customDefs: [],
  builderStack: { layers: [] },
};

describe("project files (.avproj)", () => {
  it("round-trips serialize → parse", () => {
    const json = serializeProject(doc, "1.2.0");
    expect(parseProject(json)).toEqual(doc);
  });

  it("stamps metadata", () => {
    const file = JSON.parse(serializeProject(doc, "1.2.0"));
    expect(file.kind).toBe("avproj");
    expect(file.schemaVersion).toBe(PROJECT_VERSION);
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
    delete file.document.lyricStyle;
    delete file.document.audiogram;
    delete file.document.customDefs;
    const parsed = parseProject(JSON.stringify(file));
    expect(parsed.overlayLayers).toEqual([]);
    expect(parsed.assets).toEqual({});
    expect(parsed.aspect).toBe("free"); // v1 default
    expect(parsed.modsByPreset).toEqual({}); // pre-v3 default
    expect(parsed.post.bloom).toBe(0); // pre-v5 default (neutral)
    expect(parsed.post.exposure).toBe(1);
    expect(parsed.motion).toEqual({ rotation: 1, pulse: 1, detail: 1, spectrumSmooth: 0 }); // pre-v6 default (neutral)
    // pre-v9 defaults
    expect(parsed.lyricStyle.position).toBe("bottom");
    expect(parsed.lyricStyle.size).toBe(1);
    expect(parsed.audiogram.progressBar).toBe(false);
    expect(parsed.customDefs).toEqual([]);
    expect(parsed.presetId).toBe(doc.presetId);
  });

  it("v9: lyric style and audiogram round-trip; malformed values fall back", () => {
    const json = serializeProject(doc, "x");
    const parsed = parseProject(json);
    expect(parsed.lyricStyle).toEqual(doc.lyricStyle);
    expect(parsed.audiogram).toEqual(doc.audiogram);

    const file = JSON.parse(json);
    file.document.lyricStyle = { position: "sideways", size: 99, color: "purple", fadeSec: -1 };
    file.document.audiogram = { progressBar: "yes", position: "left", color: 7 };
    const repaired = parseProject(JSON.stringify(file));
    expect(repaired.lyricStyle.position).toBe("bottom");
    expect(repaired.lyricStyle.size).toBe(2); // clamped
    expect(repaired.lyricStyle.color).toBe("#ffffff");
    expect(repaired.lyricStyle.fadeSec).toBe(0);
    expect(repaired.audiogram.progressBar).toBe(false);
    expect(repaired.audiogram.position).toBe("bottom");
    expect(repaired.audiogram.color).toBe("#7c5cff");
  });

  it("v9: an embedded custom def registers, so presetId and scenes survive", () => {
    const customDef = {
      id: "custom-projtest1",
      name: "Proj Test",
      params: [{ key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 200 }],
      wgsl: "fn preset(uv: vec2f) -> vec4f { return vec4f(P_hue() / 360.0); }",
    };
    const file = JSON.parse(serializeProject(doc, "x"));
    file.document.presetId = customDef.id;
    file.document.customDefs = [customDef, { id: "bad id!", wgsl: "nope" }];
    file.document.timeline = {
      enabled: true,
      scenes: [{ id: "sc-c", name: "Custom", presetId: customDef.id, start: 5 }],
      lanes: [],
    };
    const parsed = parseProject(JSON.stringify(file));
    // Without registration-before-validation the preset falls back to the
    // default mode and the scene is dropped — both must survive.
    expect(parsed.presetId).toBe(customDef.id);
    expect(parsed.timeline.scenes).toHaveLength(1);
    expect(parsed.customDefs).toHaveLength(1); // invalid def dropped
    expect(parsed.customDefs[0].id).toBe(customDef.id);
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
    expect(parsed.bg.image).toEqual({ assetId: "as-1", dim: 0.9, blur: 0, ...NEUTRAL_FIT }); // clamped
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
    expect(parsed.bg.video).toEqual({ assetId: "vid-1", dim: 0.4, blur: 12, ...NEUTRAL_FIT });
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
    it("the current shape is stamped with the current schema version", () => {
      const file = JSON.parse(serializeProject(doc, "2.35.0"));
      expect(file.schemaVersion).toBe(PROJECT_VERSION);
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
          bgByPreset: {},
          centerImageByPreset: {},
        },
      };
      const parsed = parseProject(JSON.stringify(file));
      expect(parsed.bg.mode).toBe(3);
      // The framing fields are filled in with the NEUTRAL values, which are
      // the cover crop the shader hardcoded when this file was written — so
      // the picture lands exactly where it did before they existed.
      expect(parsed.bg.image).toEqual({ assetId: "as-1", dim: 0.3, blur: 5, ...NEUTRAL_FIT });
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
          bgByPreset: {},
          centerImageByPreset: {},
        },
      };
      const parsed = parseProject(JSON.stringify(file));
      expect(parsed.bg.mode).toBe(4);
      expect(parsed.bg.video).toEqual({ assetId: "vid-1", dim: 0.4, blur: 12, ...NEUTRAL_FIT });
      expect(parsed.assets["vid-1"]?.dataUrl).toBe("data:video/mp4;base64,AA");
    });

    it("still rejects a file from a schema newer than the current version", () => {
      const file = JSON.parse(serializeProject(doc, "x"));
      file.schemaVersion = PROJECT_VERSION + 1;
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

describe("schema v11 (per-mode backgrounds + center images)", () => {
  const assets = {
    "as-1": { id: "as-1", name: "x.png", dataUrl: "data:image/png;base64,AA==" },
  };

  it("keeps valid bg overrides and degrades dangling image/video refs", () => {
    const out = validBgByPreset(
      {
        "bass-circle": { mode: 3, color: [0, 0, 0], image: { assetId: "as-1", dim: 0.3, blur: 5 } },
        ghost: { mode: 3, color: [0, 0, 0], image: { assetId: "MISSING", dim: 0, blur: 0 } },
        video: { mode: 4, color: [0, 0, 0], video: { assetId: "MISSING", dim: 0, blur: 0 } },
      },
      assets,
    );
    expect(out["bass-circle"].mode).toBe(3);
    expect(out["bass-circle"].image?.assetId).toBe("as-1");
    expect(out.ghost.mode).toBe(0); // degraded, not dropped — the entry itself is legal
    expect(out.video.mode).toBe(0);
  });

  it("garbage bgByPreset shapes default to empty", () => {
    expect(validBgByPreset(null, assets)).toEqual({});
    expect(validBgByPreset(42, assets)).toEqual({});
    expect(validBgByPreset("x", assets)).toEqual({});
  });

  it("keeps center images whose asset exists, drops dangling ones", () => {
    const out = validCenterImages(
      { "bass-circle": "as-1", "radial-burst": "MISSING", bad: 7 },
      assets,
    );
    expect(out).toEqual({ "bass-circle": "as-1" });
  });

  it("both fields survive a full document round-trip", () => {
    const document = validateDocument({
      presetId: "bass-circle",
      assets,
      bgByPreset: {
        "bass-circle": { mode: 1, color: [1, 0, 0] },
      },
      centerImageByPreset: { "bass-circle": "as-1" },
    });
    const parsed = parseProject(serializeProject(document, "rt"));
    expect(parsed.bgByPreset["bass-circle"].mode).toBe(1);
    expect(parsed.centerImageByPreset["bass-circle"]).toBe("as-1");
  });

  it("older documents without the fields default them empty", () => {
    const document = validateDocument({ presetId: "spectrum-bars" });
    expect(document.bgByPreset).toEqual({});
    expect(document.centerImageByPreset).toEqual({});
  });
});

/**
 * Background framing (BgFit) — added WITHOUT a schema bump, so the neutral
 * defaults have to be exactly the cover crop the shader used to hardcode.
 * These are the guards on that promise, plus the clamps that keep a
 * hand-edited or hostile file from reaching the uniform with a value the
 * shader would read as a different fit mode.
 */
describe("background fit / zoom / pan", () => {
  it("defaults to the neutral (cover, unzoomed, centred) framing when absent", () => {
    const bg = validBg({
      mode: 3,
      color: [0, 0, 0],
      image: { assetId: "as-1", dim: 0.2, blur: 3 },
    });
    expect(bg.image).toEqual({ assetId: "as-1", dim: 0.2, blur: 3, ...NEUTRAL_FIT });
    const vid = validBg({
      mode: 4,
      color: [0, 0, 0],
      video: { assetId: "vid-1", dim: 0.3, blur: 0 },
    });
    expect(vid.video).toEqual({ assetId: "vid-1", dim: 0.3, blur: 0, ...NEUTRAL_FIT });
  });

  it("keeps values that are already in range", () => {
    const bg = validBg({
      mode: 3,
      color: [0, 0, 0],
      image: {
        assetId: "as-1",
        dim: 0.2,
        blur: 0,
        fit: 1,
        zoom: 2.5,
        offsetX: -0.4,
        offsetY: 0.25,
      },
    });
    expect(bg.image).toMatchObject({ fit: 1, zoom: 2.5, offsetX: -0.4, offsetY: 0.25 });
  });

  it("clamps zoom and pan to the ranges the UI offers", () => {
    const bg = validBg({
      mode: 3,
      color: [0, 0, 0],
      image: { assetId: "as-1", dim: 0, blur: 0, zoom: 99, offsetX: 12, offsetY: -12 },
    });
    expect(bg.image).toMatchObject({ zoom: 4, offsetX: 1, offsetY: -1 });
    const low = validBg({
      mode: 3,
      color: [0, 0, 0],
      image: { assetId: "as-1", dim: 0, blur: 0, zoom: 0 },
    });
    expect(low.image?.zoom).toBe(0.25);
  });

  it("SNAPS fit to 0/1/2 — the shader branches on it", () => {
    // A fractional 1.4 reaching the uniform would silently select contain;
    // clamping alone would not have caught it, which is why this rounds.
    const of = (fit: unknown) =>
      validBg({ mode: 3, color: [0, 0, 0], image: { assetId: "a", dim: 0, blur: 0, fit } }).image
        ?.fit;
    expect(of(1.4)).toBe(1);
    expect(of(2.9)).toBe(2);
    expect(of(-5)).toBe(0);
  });

  it("falls back to neutral for non-finite and non-numeric junk", () => {
    const bg = validBg({
      mode: 4,
      color: [0, 0, 0],
      video: {
        assetId: "vid-1",
        dim: 0.3,
        blur: 0,
        fit: NaN,
        zoom: Infinity,
        offsetX: "0.5",
        offsetY: null,
      },
    });
    expect(bg.video).toMatchObject(NEUTRAL_FIT);
  });

  it("survives a serialize/parse round-trip", () => {
    const document = validateDocument({
      presetId: "spectrum-bars",
      assets: { "as-1": { id: "as-1", name: "x.png", dataUrl: PIXEL } },
      bg: {
        mode: 3,
        color: [0, 0, 0],
        image: {
          assetId: "as-1",
          dim: 0.2,
          blur: 0,
          fit: 1,
          zoom: 1.75,
          offsetX: 0.2,
          offsetY: -0.1,
        },
      },
    });
    const parsed = parseProject(serializeProject(document, "rt"));
    expect(parsed.bg.image).toMatchObject({ fit: 1, zoom: 1.75, offsetX: 0.2, offsetY: -0.1 });
  });

  it("per-mode overrides inherit the same validation (they call validBg)", () => {
    const out = validBgByPreset(
      {
        "bass-circle": {
          mode: 3,
          color: [0, 0, 0],
          image: { assetId: "as-1", dim: 0.3, blur: 5, fit: 2, zoom: 99, offsetY: 0.5 },
        },
        aurora: { mode: 3, color: [0, 0, 0], image: { assetId: "as-1", dim: 0.3, blur: 5 } },
      },
      { "as-1": { id: "as-1", name: "x.png", dataUrl: PIXEL } },
    );
    expect(out["bass-circle"].image).toMatchObject({
      fit: 2,
      zoom: 4, // clamped, exactly like the global bg
      offsetX: 0,
      offsetY: 0.5,
    });
    expect(out.aurora.image).toMatchObject(NEUTRAL_FIT);
  });
});

describe("text layer font family", () => {
  const layer = (font: unknown) => ({
    id: "ly-f",
    type: "text",
    text: "hi",
    font,
    weight: 700,
    size: 0.06,
    color: [1, 1, 1],
    opacity: 1,
    letterSpacing: 0,
    anchor: "cc",
    offset: [0, 0],
    glow: 0,
    uppercase: false,
  });
  const fontOf = (font: unknown) => {
    const out = validLayers([layer(font)], {});
    return out[0].type === "text" ? out[0].font : null;
  };

  it("keeps ordinary families, stacks and generic keywords", () => {
    expect(fontOf("Arial")).toBe("Arial");
    expect(fontOf("Helvetica Neue")).toBe("Helvetica Neue");
    expect(fontOf("sans-serif")).toBe("sans-serif");
    expect(fontOf("Helvetica Neue, Arial, sans-serif")).toBe("Helvetica Neue, Arial, sans-serif");
    // Non-ASCII families are real font names, not an attack.
    expect(fontOf("Noto Sans JP")).toBe("Noto Sans JP");
    expect(fontOf("游ゴシック")).toBe("游ゴシック");
  });

  it("rejects families that would make the ctx.font assignment a silent no-op", () => {
    // Every one of these leaves ctx.font at 10px sans-serif in BOTH the
    // preview and the export, with nothing reported — the whole point of F12.
    for (const bad of [
      "Arial; color: red",
      "Arial}",
      'Arial"',
      "'Arial'",
      "3Bad",
      "Arial\nBold",
      "",
      "   ",
      42,
      null,
      undefined,
    ]) {
      expect(fontOf(bad)).toBe("Arial");
    }
  });

  it("rejects a stack whose LAST family is bad — one bad part kills the whole shorthand", () => {
    expect(fontOf("Arial, 3Bad")).toBe("Arial");
    expect(fontOf("Arial, sans-serif}")).toBe("Arial");
  });

  it("still caps the family length", () => {
    expect(fontOf("A".repeat(500))).toHaveLength(100);
  });
});
