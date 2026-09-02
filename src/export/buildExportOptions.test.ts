import { describe, expect, it } from "vitest";
import {
  buildExportOptions,
  resolveDocParams,
  type ExportIo,
  type FormatPreset,
  type TrackInput,
} from "./buildExportOptions";
import type { ExportOptions } from "./videoExporter";
import { DEFAULT_POST, DEFAULT_MOTION, type PresetDef } from "../render/types";
import type { BuilderLayer } from "../render/builder2";
import { DEFAULT_SYNC } from "../audio/types";
import type { BeatGrid } from "../audio/analysis/beatGrid";
import { STEM_TRACK_KEYS, type StemEntry, type StemTrackKey } from "../audio/stems";
import { vocalSpansFromLyrics } from "../audio/vocalPresence";
import { DEFAULT_LYRIC_STYLE, type LyricLine } from "../state/lyrics";
import { DEFAULT_AUDIOGRAM } from "../state/audiogram";
import type { ProjectDocument } from "../state/project";
import { resolveActiveFrame } from "../state/frameResolve";
import { BG_IMAGE, BG_SOLID, BG_VIDEO, type BgSettings } from "../render/types";

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
    bgByPreset: {},
    centerImageByPreset: {},
    bg: { kind: "solid", colorA: "#000", colorB: "#111", angle: 0, alpha: 1 } as never,
    overlayLayers: [],
    assets: {},
    aspect: "16:9",
    modsByPreset: {},
    smoothSpectrum: false,
    timeline: { enabled: false, scenes: [], lanes: [] },
    post: { ...DEFAULT_POST },
    motion: { ...DEFAULT_MOTION },
    lyricStyle: { ...DEFAULT_LYRIC_STYLE },
    audiogram: { ...DEFAULT_AUDIOGRAM },
    customDefs: [],
    builderStack: { layers: [] },
    ...over,
  };
}

const track = { name: "t.mp3", meta: { title: "T", artist: "A" }, coverArt: null, beatGrid: null };

/**
 * Every key of ExportOptions (videoExporter.ts), as a Record so the COMPILER
 * keeps the list honest in both directions: a key added to the type is a
 * typecheck error here until it is listed ("Property 'x' is missing"), and a
 * key removed from the type is an excess-property error. The full-surface
 * test then requires buildExportOptions to CARRY every listed key at runtime.
 * That key set is stable — the chokepoint's return literal assigns each key
 * explicitly, undefined or not, so Object.keys never depends on the fixture.
 */
const EXPORT_OPTION_KEYS: Record<keyof ExportOptions, true> = {
  width: true,
  height: true,
  fps: true,
  bitrate: true,
  codec: true,
  presetId: true,
  params: true,
  bg: true,
  bgImage: true,
  bgVideo: true,
  sync: true,
  mods: true,
  smoothSpectrum: true,
  post: true,
  motion: true,
  paramsByPreset: true,
  modsByPreset: true,
  timeline: true,
  builderStack: true,
  overlay: true,
  coverArt: true,
  beatGrid: true,
  sections: true,
  vocalSpans: true,
  stems: true,
  lyrics: true,
  audiogram: true,
  customPresets: true,
  streamToPath: true,
  pngDir: true,
  onPngFrame: true,
  deepColor: true,
  onRawFrame: true,
  deepStraightAlpha: true,
  loudness: true,
  segment: true,
  loopCrossfadeSec: true,
  signal: true,
  onProgress: true,
};

describe("buildExportOptions", () => {
  it("passes the format's codec through (frozen batch runs keep encoding it)", () => {
    const o = buildExportOptions(doc(), { ...FMT, codec: "hevc" }, track, undefined, {});
    expect(o.codec).toBe("hevc");
    const w = buildExportOptions(doc(), { ...FMT, codec: "vp9a" }, track, undefined, {});
    expect(w.codec).toBe("vp9a");
  });

  it("carries every field the export pipeline reads", () => {
    // A dropped optional field would not fail typecheck and would silently
    // change the render — so assert the full surface, not a sample. Every
    // input the chokepoint accepts is populated below, on the arm it really
    // arrives by:
    //   document — presetId, params, sync, mods, smoothSpectrum, post,
    //     motion, paramsByPreset, modsByPreset, timeline, builderStack, bg
    //     (+ bgImage / bgVideo resolved from assets), coverArt via
    //     centerImageByPreset.
    //   track — coverArt fallback, beatGrid, sections, stems, lyrics,
    //     vocalSpans (derived from vocalLines), audiogram, customPresets.
    //     Session state and track analysis, never persisted in a .bfproj, so
    //     no document can drive them (TrackInput in buildExportOptions.ts).
    //   format — width, height, fps, bitrate, codec.
    //   overlay — the pre-rasterized ImageBitmap; composed by the caller
    //     (rasterizeOverlay in exportActions.ts / batchRunner.ts).
    //   io — streamToPath, pngDir, onPngFrame, deepColor, onRawFrame,
    //     deepStraightAlpha, loudness, segment, loopCrossfadeSec, signal,
    //     onProgress: destination and lifecycle, caller-owned (ExportIo).
    // bgImage and bgVideo are exclusive by construction (one bg.mode), so the
    // surface takes two documents: image mode here, video mode at the end.
    const bgAsset = { id: "as-bg", name: "bg.png", dataUrl: "data:image/png;base64,AA==" };
    const centerAsset = { id: "as-c", name: "c.png", dataUrl: "data:image/png;base64,BB==" };
    const layer: BuilderLayer = {
      id: "l1",
      type: "rings",
      enabled: true,
      opacity: 1,
      blend: "add",
      hue: 30,
      hueSpread: 60,
      params: {},
    };
    const d = doc({
      paramsByPreset: { "spectrum-bars": { gain: 2 }, aurora: { speed: 0.5 } },
      syncByPreset: { "spectrum-bars": { mode: "bass", smooth: 0.7 } },
      modsByPreset: {
        "spectrum-bars": [{ id: "m1", source: "kick", param: "gain", amount: 0.5 }],
      },
      smoothSpectrum: true,
      post: { ...DEFAULT_POST, bloom: 0.9 },
      motion: { ...DEFAULT_MOTION, rotation: 1.5 },
      timeline: {
        enabled: true,
        scenes: [{ id: "sc1", name: "S", presetId: "aurora", start: 4 }],
        lanes: [],
      },
      builderStack: { layers: [layer] },
      assets: { "as-bg": bgAsset, "as-c": centerAsset },
      bg: { mode: BG_IMAGE, color: [0, 0, 0], image: { assetId: "as-bg", dim: 0.3, blur: 2 } },
      centerImageByPreset: { "spectrum-bars": "as-c" },
    });

    const beatGrid: BeatGrid = {
      bpm: 128,
      beatTimes: new Float32Array([0, 0.46875]),
      hopSec: 512 / 48000,
    };
    const lines: LyricLine[] = [
      { t: 1, end: 2, text: "one" },
      { t: 3, end: null, text: "two" },
    ];
    const stem: StemEntry = {
      slot: "stem1",
      analysis: {
        name: "drums",
        rate: 30,
        frames: 2,
        tracks: Object.fromEntries(STEM_TRACK_KEYS.map((k) => [k, new Float32Array(2)])) as Record<
          StemTrackKey,
          Float32Array
        >,
      },
    };
    const customPreset: PresetDef = {
      id: "custom-x",
      name: "X",
      params: [],
      wgsl: "fn preset(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }",
    };
    const trackIn: TrackInput = {
      ...track,
      coverArt: "data:cover",
      beatGrid,
      sections: [0, 12.5, 40],
      stems: [stem],
      lyrics: { lines, style: { ...DEFAULT_LYRIC_STYLE, position: "top" } },
      vocalLines: lines,
      audiogram: { settings: { ...DEFAULT_AUDIOGRAM }, waveform: new Float32Array([0, 0.5, 1]) },
      customPresets: [customPreset],
    };

    const onPngFrame = (_data: Uint8Array, _index: number) => undefined;
    const onRawFrame = (_data: Uint16Array) => undefined;
    const onProgress = (_done: number, _total: number) => undefined;
    const signal = new AbortController().signal;
    const io: ExportIo = {
      streamToPath: "/out.mp4",
      pngDir: "/frames",
      onPngFrame,
      deepColor: true,
      onRawFrame,
      deepStraightAlpha: true,
      loudness: { targetLufs: -14, truePeakDb: -1 },
      segment: { start: 30, duration: 15 },
      loopCrossfadeSec: 0.5,
      signal,
      onProgress,
    };
    // Node has no ImageBitmap; the chokepoint only passes the handle through.
    const overlay = { width: 1920, height: 1080 } as unknown as ImageBitmap;

    const o = buildExportOptions(d, FMT, trackIn, overlay, io);

    // Structural guard, direction 1: the options object carries EXACTLY the
    // keys of ExportOptions (EXPORT_OPTION_KEYS is compiler-checked against
    // the type). A field added to the type or to the chokepoint fails here
    // until it is listed AND asserted below — on purpose, never silently.
    const keys = Object.keys(EXPORT_OPTION_KEYS).sort() as (keyof ExportOptions)[];
    expect(Object.keys(o).sort()).toEqual(keys);
    // Direction 2: every key is actually populated from the fixture (bgVideo
    // excepted — exclusive with bgImage, covered by the video document below).
    for (const key of keys) {
      if (key !== "bgVideo") expect(o[key], key).toBeDefined();
    }

    // Format.
    expect(o.width).toBe(1920);
    expect(o.height).toBe(1080);
    expect(o.fps).toBe(60);
    expect(o.bitrate).toBe(12e6);
    expect(o.codec).toBe("h264"); // omitted on the format -> default

    // Document.
    expect(o.presetId).toBe("spectrum-bars");
    expect(o.params).toEqual(resolveDocParams("spectrum-bars", d.paramsByPreset));
    expect(o.params.gain).toBe(2);
    expect(o.bg).toEqual(d.bg);
    expect(o.bgImage).toEqual({ dataUrl: bgAsset.dataUrl, dim: 0.3, blur: 2 });
    expect(o.sync).toEqual({ mode: "bass", smooth: 0.7 });
    expect(o.mods).toEqual(d.modsByPreset["spectrum-bars"]);
    expect(o.smoothSpectrum).toBe(true);
    expect(o.post).toEqual({ ...DEFAULT_POST, bloom: 0.9 });
    expect(o.motion).toEqual({ ...DEFAULT_MOTION, rotation: 1.5 });
    expect(o.paramsByPreset).toEqual(d.paramsByPreset);
    expect(o.modsByPreset).toEqual(d.modsByPreset);
    expect(o.timeline).toEqual(d.timeline);
    expect(o.builderStack).toEqual({ layers: [layer] });
    expect(o.coverArt).toBe(centerAsset.dataUrl); // center image wins over the cover

    // Track.
    expect(o.beatGrid).toBe(beatGrid);
    expect(o.sections).toEqual([0, 12.5, 40]);
    expect(o.vocalSpans).toEqual(vocalSpansFromLyrics(lines));
    expect(o.vocalSpans).not.toHaveLength(0);
    expect(o.stems).toEqual([stem]);
    expect(o.lyrics).toEqual(trackIn.lyrics);
    expect(o.audiogram).toEqual(trackIn.audiogram);
    expect(o.customPresets).toEqual([customPreset]);

    // Overlay.
    expect(o.overlay).toBe(overlay);

    // Io.
    expect(o.streamToPath).toBe("/out.mp4");
    expect(o.pngDir).toBe("/frames");
    expect(o.onPngFrame).toBe(onPngFrame);
    expect(o.deepColor).toBe(true);
    expect(o.onRawFrame).toBe(onRawFrame);
    expect(o.deepStraightAlpha).toBe(true);
    expect(o.loudness).toEqual({ targetLufs: -14, truePeakDb: -1 });
    expect(o.segment).toEqual({ start: 30, duration: 15 });
    expect(o.loopCrossfadeSec).toBe(0.5);
    expect(o.signal).toBe(signal);
    expect(o.onProgress).toBe(onProgress);

    // The other background kind: bgVideo populated, bgImage empty, same keys.
    const v = buildExportOptions(
      doc({
        assets: { "as-bg": bgAsset },
        bg: { mode: BG_VIDEO, color: [0, 0, 0], video: { assetId: "as-bg", dim: 0.4, blur: 1 } },
      }),
      FMT,
      trackIn,
      overlay,
      io,
    );
    expect(Object.keys(v).sort()).toEqual(keys);
    expect(v.bgVideo).toEqual({ dataUrl: bgAsset.dataUrl, dim: 0.4, blur: 1 });
    expect(v.bgImage).toBeUndefined();
  });

  it("passes the deep-color lane's fields through the chokepoint (AV1 10-bit)", () => {
    // The AV1 sidecar feed rides ExportIo like onPngFrame does for ProRes: a
    // dropped field here would silently downgrade a "10-bit" export to the
    // 8-bit canvas path — the exact honesty class FEAT-005 exists to close.
    const onRawFrame = (_data: Uint16Array) => undefined;
    const o = buildExportOptions(doc(), FMT, track, undefined, {
      deepColor: true,
      onRawFrame,
    });
    expect(o.deepColor).toBe(true);
    expect(o.onRawFrame).toBe(onRawFrame);
    // AV1 must NOT pick up straight-alpha behind the caller's back — its
    // yuv420p10le has no alpha channel, and this lane's own tests pin the
    // premultiplied-passthrough bytes exactly.
    expect(o.deepStraightAlpha).toBeUndefined();
    // And absent stays absent — the 8-bit lanes must not accidentally ask
    // the core for the deep-color tap.
    const off = buildExportOptions(doc(), FMT, track, undefined, {});
    expect(off.deepColor).toBeUndefined();
    expect(off.onRawFrame).toBeUndefined();
  });

  it("passes deepStraightAlpha through the same chokepoint (ProRes 4444, FEAT-005)", () => {
    // ProRes rides the identical deepColor/onRawFrame fields as AV1 above,
    // plus deepStraightAlpha — a dropped field here would silently flip
    // ProRes's alpha channel from straight to premultiplied, corrupting
    // every semi-transparent pixel while every other check still passes.
    const onRawFrame = (_data: Uint16Array) => undefined;
    const o = buildExportOptions(doc(), FMT, track, undefined, {
      deepColor: true,
      deepStraightAlpha: true,
      onRawFrame,
    });
    expect(o.deepColor).toBe(true);
    expect(o.deepStraightAlpha).toBe(true);
    expect(o.onRawFrame).toBe(onRawFrame);
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

describe("per-mode overrides (schema v11) resolve at the export chokepoint", () => {
  const asset = { id: "as-x", name: "x.png", dataUrl: "data:image/png;base64,AA==" };
  const solidRed: BgSettings = { mode: BG_SOLID, color: [1, 0, 0] };

  it("a bg override for the active mode wins over the global bg", () => {
    const d = doc({
      bg: { mode: 0, color: [0, 0, 0] },
      bgByPreset: { "spectrum-bars": solidRed },
    });
    const o = buildExportOptions(d, FMT, track, undefined, {});
    expect(o.bg).toEqual(solidRed);
  });

  it("another mode's override does NOT leak into this mode", () => {
    const d = doc({
      bg: { mode: 0, color: [0, 0, 0] },
      bgByPreset: { "bass-circle": solidRed },
    });
    const o = buildExportOptions(d, FMT, track, undefined, {});
    expect(o.bg.mode).toBe(0);
  });

  it("an image bg override resolves its asset into bgImage", () => {
    const d = doc({
      assets: { "as-x": asset },
      bgByPreset: {
        "spectrum-bars": {
          mode: BG_IMAGE,
          color: [0, 0, 0],
          image: { assetId: "as-x", dim: 0.3, blur: 4 },
        },
      },
    });
    const o = buildExportOptions(d, FMT, track, undefined, {});
    expect(o.bgImage).toEqual({ dataUrl: asset.dataUrl, dim: 0.3, blur: 4 });
  });

  // Background framing (fit/zoom/pan) travels on `bg`, not on the bgImage /
  // bgVideo bake blocks: exportCore pushes it with setBackground(rf.bg) every
  // frame, the same call the live loop makes. These pin that it survives the
  // chokepoint for BOTH background kinds — a dropped field here would export a
  // differently-cropped picture than the preview showed, silently.
  it("an image background's fit / zoom / pan reach the export options", () => {
    const image = {
      assetId: "as-x",
      dim: 0.3,
      blur: 4,
      fit: 1,
      zoom: 2,
      offsetX: -0.25,
      offsetY: 0.1,
    };
    const d = doc({
      assets: { "as-x": asset },
      bg: { mode: BG_IMAGE, color: [0, 0, 0], image },
    });
    const o = buildExportOptions(d, FMT, track, undefined, {});
    expect(o.bg.image).toEqual(image);
    // The bake block stays bake-only — one source of truth for the framing.
    expect(o.bgImage).toEqual({ dataUrl: asset.dataUrl, dim: 0.3, blur: 4 });
  });

  it("a video background's fit / zoom / pan reach the export options", () => {
    const video = {
      assetId: "as-x",
      dim: 0.4,
      blur: 0,
      fit: 2,
      zoom: 1.5,
      offsetX: 0.5,
      offsetY: -0.5,
    };
    const d = doc({
      assets: { "as-x": asset },
      bgByPreset: {
        "spectrum-bars": { mode: BG_VIDEO, color: [0, 0, 0], video },
      },
    });
    const o = buildExportOptions(d, FMT, track, undefined, {});
    expect(o.bg.video).toEqual(video);
    expect(o.bgVideo).toEqual({ dataUrl: asset.dataUrl, dim: 0.4, blur: 0 });
  });

  it("LIVE PARITY: the framing the export sees is the framing frameResolve hands the preview", () => {
    // The renderer reads fit/zoom/pan off the BgSettings it was last given —
    // so as long as both paths resolve the same object, the crop cannot drift.
    const image = { assetId: "as-x", dim: 0, blur: 0, fit: 1, zoom: 3, offsetX: 0.2, offsetY: 0 };
    const d = doc({
      assets: { "as-x": asset },
      bgByPreset: { "spectrum-bars": { mode: BG_IMAGE, color: [0.2, 0, 0], image } },
    });
    const exported = buildExportOptions(d, FMT, track, undefined, {});
    const rf = resolveActiveFrame(
      {
        timeline: d.timeline,
        basePresetId: d.presetId,
        baseParams: {},
        baseMods: [],
        baseBg: d.bgByPreset[d.presetId] ?? d.bg,
        paramsByPreset: d.paramsByPreset,
        modsByPreset: d.modsByPreset,
      },
      1.0,
    );
    expect(rf.bg.image).toEqual(exported.bg.image);
  });

  it("a center image wins over the track's cover art", () => {
    const d = doc({
      assets: { "as-x": asset },
      centerImageByPreset: { "spectrum-bars": "as-x" },
    });
    const o = buildExportOptions(
      d,
      FMT,
      { ...track, coverArt: "data:image/png;base64,BB==" },
      undefined,
      {},
    );
    expect(o.coverArt).toBe(asset.dataUrl);
  });

  it("no center image falls back to the track cover", () => {
    const o = buildExportOptions(doc(), FMT, { ...track, coverArt: "data:cover" }, undefined, {});
    expect(o.coverArt).toBe("data:cover");
  });

  it("LIVE PARITY (AX-6): a timeline scene's image-asset bg resolves identically for both paths", () => {
    // The scene names its OWN asset while the base bg is not in image mode.
    // buildExportOptions resolves bytes for the BASE bg only (no bgImage
    // here), and the live loop bakes only effBg() — so neither path has a
    // texture for the scene's asset. resolveActiveFrame (shared by both
    // loops) must therefore degrade the scene bg to the preset background on
    // BOTH sides, instead of live showing a stale/base texture while the
    // export rendered image mode against a never-uploaded one.
    const sceneAsset = { id: "as-s", name: "s.png", dataUrl: "data:image/png;base64,BB==" };
    const d = doc({
      assets: { "as-s": sceneAsset },
      bg: { mode: 0, color: [0, 0, 0] },
      timeline: {
        enabled: true,
        scenes: [
          {
            id: "sc1",
            name: "S",
            presetId: "bass-circle",
            start: 2,
            bg: {
              mode: BG_IMAGE,
              color: [0.1, 0, 0],
              image: { assetId: "as-s", dim: 0.2, blur: 1 },
            },
          },
        ],
        lanes: [],
      },
    });
    const exported = buildExportOptions(d, FMT, track, undefined, {});
    // The export job carries no bytes for the scene's asset — only the base
    // bg is resolved (that is the premise this degrade exists for).
    expect(exported.bgImage).toBeUndefined();

    // Export loop's frameInput (exportCore builds exactly these fields from
    // the job) and the live loop's (store.getFrameInput) — same document,
    // same shared resolver.
    const exportInput = {
      timeline: exported.timeline!,
      basePresetId: exported.presetId,
      baseParams: {},
      baseMods: [],
      baseBg: exported.bg,
      paramsByPreset: exported.paramsByPreset ?? {},
      modsByPreset: exported.modsByPreset ?? {},
    };
    const liveInput = {
      timeline: d.timeline,
      basePresetId: d.presetId,
      baseParams: {},
      baseMods: [],
      baseBg: d.bgByPreset[d.presetId] ?? d.bg,
      paramsByPreset: d.paramsByPreset,
      modsByPreset: d.modsByPreset,
    };
    const exportRf = resolveActiveFrame(exportInput, 3);
    const liveRf = resolveActiveFrame(liveInput, 3);
    // Inside the scene, both paths degrade the unhonorable image mode to the
    // preset background — and resolve the SAME background object shape.
    expect(exportRf.bg.mode).toBe(0);
    expect(liveRf.bg).toEqual(exportRf.bg);

    // Control: when the BASE bg runs the same asset-backed mode, the scene bg
    // is honored on both paths (the base's baked texture is what renders).
    const dSame = doc({
      assets: { "as-s": sceneAsset },
      bg: { mode: BG_IMAGE, color: [0, 0, 0], image: { assetId: "as-s", dim: 0, blur: 0 } },
      timeline: d.timeline,
    });
    const exportedSame = buildExportOptions(dSame, FMT, track, undefined, {});
    expect(exportedSame.bgImage).toBeDefined(); // base asset's bytes travel
    const sameRf = resolveActiveFrame(
      { ...exportInput, timeline: exportedSame.timeline!, baseBg: exportedSame.bg },
      3,
    );
    expect(sameRf.bg.mode).toBe(BG_IMAGE);
  });

  it("LIVE PARITY (BG1): frameResolve with the store's effective baseBg yields the export's bg", () => {
    // The live loop feeds resolveActiveFrame baseBg = bgByPreset[presetId] ?? bg
    // (store.getFrameInput) and re-applies rf.bg every frame. This pins that
    // both paths resolve the SAME background for the same document — the exact
    // invariant BG1 broke (override exported but was invisible live).
    const d = doc({
      bg: { mode: 0, color: [0, 0, 0] },
      bgByPreset: { "spectrum-bars": solidRed },
    });
    const exported = buildExportOptions(d, FMT, track, undefined, {});
    const liveBaseBg = d.bgByPreset[d.presetId] ?? d.bg; // = store.getFrameInput().baseBg
    const rf = resolveActiveFrame(
      {
        timeline: d.timeline,
        basePresetId: d.presetId,
        baseParams: {},
        baseMods: [],
        baseBg: liveBaseBg,
        paramsByPreset: d.paramsByPreset,
        modsByPreset: d.modsByPreset,
      },
      1.0,
    );
    expect(rf.bg).toEqual(exported.bg);
  });
});
