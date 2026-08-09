import { describe, expect, it } from "vitest";
import {
  parseProject,
  PROJECT_VERSION,
  ProjectParseError,
  serializeProject,
  type ProjectDocument,
  validBg,
  validSyncByPreset,
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

describe("project files (.bfproj)", () => {
  it("round-trips serialize → parse", () => {
    const json = serializeProject(doc, "1.2.0");
    expect(parseProject(json)).toEqual(doc);
  });

  it("stamps metadata", () => {
    const file = JSON.parse(serializeProject(doc, "1.2.0"));
    expect(file.kind).toBe("bfproj");
    // v12 is conditional (shadertoy defs only — see the version-history
    // note): a document without one stays at v11 so older apps keep opening
    // it. projectShadertoy.test.ts covers the v12 path.
    expect(file.schemaVersion).toBe(11);
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
    it("the current shape is stamped with its OWN schema version", () => {
      // Not PROJECT_VERSION: since the conditional v12 (shadertoy defs), a
      // video-capable document without one writes the oldest schema that can
      // represent it — v11. The M26 property this test protects still holds:
      // the video-capable shape is distinguishable from the pre-video v7.
      const file = JSON.parse(serializeProject(doc, "2.35.0"));
      expect(file.schemaVersion).toBe(11);
    });

    it("still opens a real v7 file saved before video backgrounds existed", () => {
      // A pre-video project document: schemaVersion 7, image background only,
      // no bg.video anywhere in the shape — what an app before video
      // backgrounds wrote. kind is today's (the 2.70 .av*→.bf* rename dropped
      // pre-rename files at the kind gate, no back-compat); the point here is
      // the v7→current document migration chain, which localStorage caches
      // still ride.
      const file = {
        schemaVersion: 7,
        kind: "bfproj",
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
        kind: "bfproj",
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

describe("schema v13 (preset id rename: starfield -> particles)", () => {
  /** A v11 file exactly as a pre-rename app wrote it: the legacy id at every
   * site a document can persist it. */
  const legacyFile = () => ({
    schemaVersion: 11,
    kind: "bfproj",
    appVersion: "2.67.0",
    savedAt: "2026-08-01T00:00:00.000Z",
    document: {
      presetId: "starfield",
      paramsByPreset: { starfield: { density: 19, size: 0.22 }, aurora: { bright: 0.3 } },
      syncByPreset: { starfield: { mode: "kick" as const, smooth: 0.4 } },
      bgByPreset: { starfield: { mode: 1, color: [0.1, 0.1, 0.1] } },
      centerImageByPreset: { starfield: "as-1" },
      assets: { "as-1": { id: "as-1", name: "x.png", dataUrl: PIXEL } },
      modsByPreset: {
        starfield: [{ id: "m1", source: "kick", param: "beatDance", amount: 0.4 }],
      },
      timeline: {
        enabled: true,
        scenes: [
          { id: "sc-1", name: "Drop", presetId: "starfield", start: 30 },
          { id: "sc-2", name: "Outro", presetId: "aurora", start: 90 },
        ],
        lanes: [],
      },
    },
  });

  it("re-keys EVERY site to the new id and loses nothing", () => {
    const parsed = parseProject(JSON.stringify(legacyFile()));
    expect(parsed.presetId).toBe("particles");
    expect(parsed.paramsByPreset.particles).toEqual({ density: 19, size: 0.22 });
    expect(parsed.paramsByPreset.starfield).toBeUndefined();
    expect(parsed.paramsByPreset.aurora).toEqual({ bright: 0.3 }); // untouched
    expect(parsed.syncByPreset.particles?.mode).toBe("kick");
    expect(parsed.syncByPreset.starfield).toBeUndefined();
    expect(parsed.bgByPreset.particles?.mode).toBe(1);
    expect(parsed.centerImageByPreset.particles).toBe("as-1");
    expect(parsed.modsByPreset.particles).toHaveLength(1);
    expect(parsed.timeline.scenes.map((s) => s.presetId)).toEqual(["particles", "aurora"]);
    // Nothing anywhere still references the legacy id.
    expect(JSON.stringify(parsed)).not.toContain("starfield");
  });

  it("round-trips: re-saving the migrated document writes the new id at v13", () => {
    const parsed = parseProject(JSON.stringify(legacyFile()));
    const file = JSON.parse(serializeProject(parsed, "2.68.0"));
    // presetId "particles" is exactly what an older reader would MISREAD
    // (validPresetId falls back to the default mode), so the conditional
    // bump fires — mirroring the v12 shadertoy rule.
    expect(file.schemaVersion).toBe(13);
    expect(parseProject(JSON.stringify(file))).toEqual(parsed);
  });

  it("does NOT bump for a document that merely stores params under the new id", () => {
    const document = validateDocument({
      presetId: "spectrum-bars",
      paramsByPreset: { particles: { density: 10 } },
    });
    const file = JSON.parse(serializeProject(document, "2.68.0"));
    // Older readers preserve unknown map keys — no misread, no bump.
    expect(file.schemaVersion).toBe(11);
  });

  it("a hand-edited file carrying BOTH ids keeps the current one's entry", () => {
    const file = legacyFile();
    (file.document.paramsByPreset as Record<string, unknown>).particles = { density: 7 };
    const parsed = parseProject(JSON.stringify(file));
    expect(parsed.paramsByPreset.particles).toEqual({ density: 7 });
    expect(parsed.paramsByPreset.starfield).toBeUndefined();
  });
});

describe("schema v14 (nebula saturation semantics: authored 0..1 -> scaler 0..2)", () => {
  /** A v11 file exactly as a pre-RP-6 app wrote it: old-semantics nebula
   * saturation at every site a document can persist one, next to sibling
   * data that must NOT be touched (the colour-tier modes always had scaler
   * semantics; other params and other routes are innocent bystanders). */
  const legacyFile = (nebulaParams: Record<string, number>) => ({
    schemaVersion: 11,
    kind: "bfproj",
    appVersion: "2.73.0",
    savedAt: "2026-08-01T00:00:00.000Z",
    document: {
      presetId: "nebula",
      paramsByPreset: {
        nebula: nebulaParams,
        "spectrum-bars": { saturation: 1.7 },
      },
      modsByPreset: {
        nebula: [
          { id: "m1", source: "bass", param: "saturation", amount: 0.75 },
          { id: "m2", source: "kick", param: "hue", amount: 0.3 },
        ],
        "spectrum-bars": [{ id: "m3", source: "bass", param: "saturation", amount: 0.9 }],
      },
      timeline: {
        enabled: true,
        scenes: [
          {
            id: "s1",
            name: "Neb",
            presetId: "nebula",
            start: 10,
            params: { saturation: 0.5, flow: 0.2 },
          },
          {
            id: "s2",
            name: "Bars",
            presetId: "spectrum-bars",
            start: 60,
            params: { saturation: 1.5 },
          },
        ],
        lanes: [],
      },
    },
  });

  it("remaps stored values by the exact inverse of the shader change (boundaries)", () => {
    // The shader used to consume the raw value (satT = v) and now consumes
    // satT = v * 0.75, so identical rendering means new = old / 0.75: the
    // old floor 0 stays 0, the OLD DEFAULT 0.75 lands exactly on the NEW
    // DEFAULT 1 (so a file that pinned the default keeps rendering the
    // default), and the old ceiling 1 lands on 4/3 — inside the new 0..2.
    for (const [oldV, newV] of [
      [0, 0],
      [0.75, 1],
      [1, 4 / 3],
    ] as const) {
      const parsed = parseProject(JSON.stringify(legacyFile({ saturation: oldV })));
      expect(parsed.paramsByPreset.nebula.saturation).toBe(newV);
    }
  });

  it("leaves sibling modes, sibling params and non-saturation routes alone", () => {
    const parsed = parseProject(JSON.stringify(legacyFile({ saturation: 1, hue: 200 })));
    // Colour-tier saturation always was a 0..2 scaler — not remapped.
    expect(parsed.paramsByPreset["spectrum-bars"].saturation).toBe(1.7);
    // Other nebula params pass through untouched.
    expect(parsed.paramsByPreset.nebula.hue).toBe(200);
    // A nebula route to a DIFFERENT param keeps its amount...
    expect(parsed.modsByPreset.nebula.find((r) => r.param === "hue")?.amount).toBe(0.3);
    // ...and a saturation route on a sibling mode keeps its amount.
    expect(parsed.modsByPreset["spectrum-bars"][0].amount).toBe(0.9);
  });

  it("remaps nebula scene overrides but not other modes' scenes", () => {
    const parsed = parseProject(JSON.stringify(legacyFile({ saturation: 1 })));
    const neb = parsed.timeline.scenes.find((s) => s.id === "s1")!;
    const bars = parsed.timeline.scenes.find((s) => s.id === "s2")!;
    expect(neb.params?.saturation).toBe(2 / 3); // 0.5 / 0.75
    expect(neb.params?.flow).toBe(0.2); // sibling key untouched
    expect(bars.params?.saturation).toBe(1.5); // sibling mode untouched
  });

  it("rescales nebula saturation route amounts by the range-times-slope growth (1.5)", () => {
    // applyMods adds value * amount * (max - min): the range doubled while
    // the shader slope per param unit shrank to 0.75x, so an unchanged
    // amount would modulate 1.5x deeper. 0.75 / 1.5 = 0.5 exactly.
    const parsed = parseProject(JSON.stringify(legacyFile({ saturation: 1 })));
    expect(parsed.modsByPreset.nebula.find((r) => r.id === "m1")?.amount).toBe(0.5);
  });

  it("a document whose nebula params lack saturation is untouched — defaults align by construction", () => {
    // Absent means "render the default" on both sides of the migration, and
    // the new default's satT (1 * 0.75) is bit-equal to the old default's
    // (0.75) — so absence must stay absence, and such a file must keep
    // writing the pre-v14 schema (it is portable in both directions).
    const parsed = parseProject(JSON.stringify(legacyFile({ hue: 200 })));
    expect(parsed.paramsByPreset.nebula.saturation).toBeUndefined();
    expect(parsed.paramsByPreset.nebula.hue).toBe(200);
  });

  it("round-trips: the migrated document is stamped v14 and re-parses unchanged (idempotence)", () => {
    const parsed = parseProject(JSON.stringify(legacyFile({ saturation: 1 })));
    const file = JSON.parse(serializeProject(parsed, "2.74.0"));
    // The stored 4/3 (and the rescaled route) are exactly what an older
    // reader would misread as oversaturated, so the conditional bump fires.
    expect(file.schemaVersion).toBe(14);
    // A v14 file is NOT remapped again: 4/3 stays 4/3, 0.5 stays 0.5.
    const reparsed = parseProject(JSON.stringify(file));
    expect(reparsed).toEqual(parsed);
    expect(reparsed.paramsByPreset.nebula.saturation).toBe(4 / 3);
    expect(reparsed.modsByPreset.nebula.find((r) => r.id === "m1")?.amount).toBe(0.5);
  });

  it("stamps v14 only for documents that actually carry a nebula saturation value", () => {
    // Params carrier.
    const params = validateDocument({
      presetId: "nebula",
      paramsByPreset: { nebula: { saturation: 1.2 } },
    });
    expect(JSON.parse(serializeProject(params, "x")).schemaVersion).toBe(14);
    // Scene-override carrier.
    const scene = validateDocument({
      presetId: "spectrum-bars",
      timeline: {
        enabled: true,
        scenes: [{ id: "s", name: "N", presetId: "nebula", start: 0, params: { saturation: 1.2 } }],
        lanes: [],
      },
    });
    expect(JSON.parse(serializeProject(scene, "x")).schemaVersion).toBe(14);
    // Route carrier.
    const route = validateDocument({
      presetId: "nebula",
      modsByPreset: { nebula: [{ id: "m", source: "bass", param: "saturation", amount: 0.4 }] },
    });
    expect(JSON.parse(serializeProject(route, "x")).schemaVersion).toBe(14);
    // Mere nebula usage without a stored saturation value is portable — no
    // bump (mirrors the v13 "params under the new id" rule).
    const clean = validateDocument({
      presetId: "nebula",
      paramsByPreset: { nebula: { hue: 200 } },
    });
    expect(JSON.parse(serializeProject(clean, "x")).schemaVersion).toBe(11);
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

describe("per-preset sync survives a save/load round trip", () => {
  /**
   * validSyncByPreset used to rebuild SyncSettings field by field, and that
   * hand-rolled list had drifted out of sync with the type: freqMin/freqMax
   * were missing. Every .bfproj/.bftheme therefore reopened with the user's
   * analysed frequency range silently reset to the defaults. Reusing
   * sanitizeSync makes the omission impossible to reintroduce.
   */
  it("keeps a custom analysed frequency range", () => {
    const out = validSyncByPreset({
      "spectrum-bars": {
        mode: "bass",
        smooth: 0.5,
        freqMin: 60,
        freqMax: 12000,
        spectrumResolution: "precise",
        spectrumAxis: "linear",
        spectrumSampling: "measured",
      },
    });
    expect(out["spectrum-bars"].freqMin).toBe(60);
    expect(out["spectrum-bars"].freqMax).toBe(12000);
    expect(out["spectrum-bars"].spectrumResolution).toBe("precise");
    expect(out["spectrum-bars"].spectrumAxis).toBe("linear");
    expect(out["spectrum-bars"].spectrumSampling).toBe("measured");
  });

  it("still rejects an entry with an unknown mode", () => {
    expect(validSyncByPreset({ x: { mode: "not-a-mode", smooth: 0.5 } })).toEqual({});
  });
});

/**
 * E2. Every migration that actually transforms data, run against a document
 * from EVERY older schema version — not just the one it shipped next to.
 *
 * Only two of the fourteen versions carry a transform. v1–v11 are pure "field
 * absent, the validator defaults it" steps, v12 is a compatibility gate with no
 * transform at all, v13 is the version-INDEPENDENT preset-id rename pre-pass
 * inside validateDocument, and v14 is the version-GATED nebula-saturation
 * remap. The two live ones therefore have to be exercised as a matrix: v13's
 * rename must fire for a file of ANY prior version (nothing gates it), and
 * v14's remap must fire for exactly `schemaVersion < 14` and never twice.
 *
 * The property each row asserts is the one that makes a migration safe rather
 * than merely present: parse -> serialize -> parse is a FIXPOINT. A migration
 * that is not idempotent, or whose re-stamped version lets it run again on the
 * next load, is silent data loss on the user's next save.
 */
describe("migration matrix: every transform against every older version", () => {
  const asFile = (schemaVersion: number, document: unknown) =>
    JSON.stringify({
      schemaVersion,
      kind: "bfproj",
      appVersion: "2.0.0",
      savedAt: "2020-01-01T00:00:00.000Z",
      document,
    });

  /** Old-semantics nebula saturation at all three sites v14 remaps. */
  const nebulaDoc = {
    presetId: "nebula",
    paramsByPreset: { nebula: { saturation: 0.75, hue: 10 } },
    modsByPreset: { nebula: [{ id: "r1", source: "bass", param: "saturation", amount: 0.6 }] },
    timeline: {
      enabled: true,
      scenes: [{ id: "s1", presetId: "nebula", start: 0, params: { saturation: 1 } }],
      lanes: [],
    },
  };
  /** The legacy preset id at every site v13 re-keys. */
  const starfieldDoc = {
    presetId: "starfield",
    paramsByPreset: { starfield: { hue: 5 } },
    syncByPreset: { starfield: { mode: "bass", smooth: 0.5 } },
    modsByPreset: { starfield: [{ id: "r1", source: "bass", param: "hue", amount: 0.5 }] },
    timeline: { enabled: true, scenes: [{ id: "s1", presetId: "starfield", start: 0 }], lanes: [] },
  };

  const versions = Array.from({ length: PROJECT_VERSION }, (_, i) => i + 1);

  it.each(versions)("v%i -> nebula saturation: remapped iff pre-v14, and a fixpoint", (v) => {
    const d = parseProject(asFile(v, nebulaDoc));
    // 0.75 / NEBULA_SAT_AUTHORED lands exactly on 1; route amounts /1.5.
    const want =
      v < 14 ? { param: 1, scene: 4 / 3, amount: 0.4 } : { param: 0.75, scene: 1, amount: 0.6 };
    expect(d.paramsByPreset.nebula.saturation).toBeCloseTo(want.param, 12);
    expect(d.timeline.scenes[0].params!.saturation).toBeCloseTo(want.scene, 12);
    expect(d.modsByPreset.nebula[0].amount).toBeCloseTo(want.amount, 12);
    expect(d.paramsByPreset.nebula.hue).toBe(10); // innocent bystander
    // Re-saving stamps v14 (the values now carry the new semantics), so the
    // reload must NOT divide again — the fixpoint is what proves it.
    const json = serializeProject(d, "2.0.0");
    expect(JSON.parse(json).schemaVersion).toBe(14);
    expect(parseProject(json)).toEqual(d);
  });

  it.each(versions)("v%i -> starfield rename: re-keyed everywhere, and a fixpoint", (v) => {
    const d = parseProject(asFile(v, starfieldDoc));
    expect(d.presetId).toBe("particles");
    expect(Object.keys(d.paramsByPreset)).toEqual(["particles"]);
    expect(Object.keys(d.syncByPreset)).toEqual(["particles"]);
    expect(Object.keys(d.modsByPreset)).toEqual(["particles"]);
    expect(d.timeline.scenes[0].presetId).toBe("particles");
    const json = serializeProject(d, "2.0.0");
    expect(JSON.parse(json).schemaVersion).toBe(13);
    expect(parseProject(json)).toEqual(d);
  });

  it("a document with nothing migratable is a fixpoint from every version", () => {
    const plain = {
      presetId: presets[0].id,
      paramsByPreset: { [presets[0].id]: { hue: 42 } },
      bg: { mode: BG_SOLID, color: [1, 0, 0] },
    };
    for (const v of versions) {
      const d = parseProject(asFile(v, plain));
      const json = serializeProject(d, "2.0.0");
      expect(parseProject(json)).toEqual(d);
      // v11 is the floor: nothing here forces the v12/v13/v14 bumps.
      expect(JSON.parse(json).schemaVersion).toBe(11);
    }
  });
});
