import { describe, expect, it } from "vitest";
import { buildExportOptions, resolveDocParams, type FormatPreset } from "./buildExportOptions";
import { DEFAULT_POST, DEFAULT_MOTION } from "../render/types";
import { DEFAULT_SYNC } from "../audio/types";
import type { ProjectDocument } from "../state/project";

const FMT: FormatPreset = {
  id: "t",
  label: "Test",
  w: 1920,
  h: 1080,
  fps: 60,
  mbps: 12,
  format: "mp4",
};

function doc(over: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    presetId: "spectrum-bars",
    paramsByPreset: {},
    syncByPreset: {},
    bg: { kind: "solid", colorA: "#000", colorB: "#111", angle: 0, alpha: 1 } as never,
    overlayLayers: [],
    assets: {},
    aspect: "16:9",
    modsByPreset: {},
    smoothSpectrum: false,
    timeline: { enabled: false, scenes: [], lanes: [] },
    post: { ...DEFAULT_POST },
    motion: { ...DEFAULT_MOTION },
    ...over,
  };
}

const track = { name: "t.mp3", meta: { title: "T", artist: "A" }, coverArt: null, beatGrid: null };

describe("buildExportOptions", () => {
  it("carries every field the export pipeline reads", () => {
    // A dropped optional field would not fail typecheck and would silently
    // change the render — so assert the full surface, not a sample.
    const o = buildExportOptions(doc(), FMT, track, undefined, {
      streamToPath: "/out.mp4",
      signal: new AbortController().signal,
    });
    expect(o.width).toBe(1920);
    expect(o.height).toBe(1080);
    expect(o.fps).toBe(60);
    expect(o.bitrate).toBe(12e6);
    expect(o.presetId).toBe("spectrum-bars");
    expect(o.params).toEqual(resolveDocParams("spectrum-bars", {}));
    expect(o.bg).toBeDefined();
    expect(o.sync).toEqual(DEFAULT_SYNC);
    expect(o.mods).toEqual([]);
    expect(o.smoothSpectrum).toBe(false);
    expect(o.post).toEqual(DEFAULT_POST);
    expect(o.motion).toEqual(DEFAULT_MOTION);
    expect(o.paramsByPreset).toEqual({});
    expect(o.modsByPreset).toEqual({});
    expect(o.streamToPath).toBe("/out.mp4");
    expect(o.signal).toBeDefined();
  });

  it("passes the timeline only when it is enabled", () => {
    // exportCore treats a present-but-disabled timeline as active, so this
    // gate is what keeps a disabled timeline from taking over the render.
    const off = buildExportOptions(doc(), FMT, track, undefined, {});
    expect(off.timeline).toBeUndefined();

    const on = buildExportOptions(
      doc({ timeline: { enabled: true, scenes: [], lanes: [] } }),
      FMT,
      track,
      undefined,
      {},
    );
    expect(on.timeline).toBeDefined();
  });

  it("resolves sync and mods from the BASE preset, matching the preview", () => {
    // exportCore builds one OfflineAnalyzer from job.sync for the whole
    // render, so a scene that switches preset still uses the base preset's
    // sync. Resolving per-scene here would diverge from the preview.
    const d = doc({
      presetId: "radial-burst",
      syncByPreset: {
        "radial-burst": { mode: "bass", smooth: 0.9 },
        aurora: { mode: "hats", smooth: 0.1 },
      },
      modsByPreset: { "radial-burst": [{ id: "r1", source: "kick", param: "x", amount: 1 }] },
    });
    const o = buildExportOptions(d, FMT, track, undefined, {});
    expect(o.sync).toEqual({ mode: "bass", smooth: 0.9 });
    expect(o.mods).toHaveLength(1);
  });

  it("falls back to defaults for a preset with no overrides", () => {
    const o = buildExportOptions(doc({ presetId: "aurora" }), FMT, track, undefined, {});
    expect(o.sync).toEqual(DEFAULT_SYNC);
    expect(o.mods).toEqual([]);
  });

  it("maps track-scoped inputs, not document ones", () => {
    const o = buildExportOptions(
      doc(),
      FMT,
      { ...track, coverArt: "data:image/png;base64,AAA", beatGrid: { bpm: 120 } as never },
      undefined,
      {},
    );
    expect(o.coverArt).toBe("data:image/png;base64,AAA");
    expect(o.beatGrid).toEqual({ bpm: 120 });
  });

  it("uses literal dimensions so a job never depends on array order", () => {
    // FormatPreset carries w/h rather than an index into RESOLUTIONS: an index
    // would silently repoint if that array were ever reordered.
    const o = buildExportOptions(doc(), { ...FMT, w: 1080, h: 1920 }, track, undefined, {});
    expect([o.width, o.height]).toEqual([1080, 1920]);
  });
});
