import { describe, expect, it } from "vitest";
import { buildExportOptions, type FormatPreset } from "./buildExportOptions";
import { DEFAULT_POST, DEFAULT_MOTION } from "../render/types";
import { DEFAULT_LYRIC_STYLE } from "../state/lyrics";
import { DEFAULT_AUDIOGRAM } from "../state/audiogram";
import type { ProjectDocument } from "../state/project";
import type { LyricLine } from "../state/lyrics";
import { vocalPresenceAt, vocalSpansFromLyrics } from "../audio/vocalPresence";

/**
 * P-15 wiring contract: the reactivity fuel (section identity, lyric-derived
 * vocal presence) must reach the EXPORT walk the same way it reaches the live
 * analyzer, or preview and export resolve different frames from one document
 * — the determinism law's exact failure mode. The pipeline math itself is
 * covered in src/audio; this file pins the plumbing between the store, the
 * options builder and the worker job.
 */

const FMT: FormatPreset = { id: "t", label: "T", w: 640, h: 360, fps: 30, mbps: 4, format: "mp4" };

function doc(): ProjectDocument {
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
  };
}

const LINES: LyricLine[] = [
  { t: 1, end: 3, text: "first line" },
  { t: 10, end: 12, text: "second line" },
] as LyricLine[];

const baseTrack = {
  name: "t.mp3",
  meta: { title: "T", artist: "A" },
  coverArt: null,
  beatGrid: null,
};

describe("P-15 fuel reaches the export job", () => {
  it("carries detected section boundaries into the job", () => {
    const o = buildExportOptions(doc(), FMT, { ...baseTrack, sections: [12, 48] }, undefined, {});
    expect(o.sections).toEqual([12, 48]);
  });

  it("derives vocal spans from the timed lines", () => {
    const o = buildExportOptions(doc(), FMT, { ...baseTrack, vocalLines: LINES }, undefined, {});
    expect(o.vocalSpans).toEqual(vocalSpansFromLyrics(LINES));
  });

  it("omits both when the track has neither (batch tracks stay inert)", () => {
    const o = buildExportOptions(doc(), FMT, baseTrack, undefined, {});
    expect(o.sections).toBeUndefined();
    expect(o.vocalSpans).toBeUndefined();
  });

  it("keeps vocal presence alive when the lyric OVERLAY is off", () => {
    // The regression this guards: `lyrics` only travels when the overlay is
    // enabled (it is what gets composited), so deriving presence from that
    // field would silently zero the modulation source for anyone who loads
    // lyrics without drawing them — while the live path, fed straight from
    // store state, kept modulating. `vocalLines` is deliberately separate.
    const drawn = buildExportOptions(
      doc(),
      FMT,
      { ...baseTrack, vocalLines: LINES, lyrics: { lines: LINES, style: DEFAULT_LYRIC_STYLE } },
      undefined,
      {},
    );
    const hidden = buildExportOptions(
      doc(),
      FMT,
      { ...baseTrack, vocalLines: LINES },
      undefined,
      {},
    );
    expect(hidden.lyrics).toBeUndefined();
    expect(hidden.vocalSpans).toEqual(drawn.vocalSpans);
    expect(hidden.vocalSpans?.length).toBeGreaterThan(0);
  });
});

describe("P-15 fuel survives a segment export", () => {
  /**
   * videoExporter shifts every TRACK-time quantity by the segment start
   * because the exported audio is sliced to zero. Sections and vocal spans
   * are track times exactly like the beat grid's beats, so this reproduces
   * that shift and asserts the resolved presence matches what the same
   * moment resolves to in the full-track timeline.
   */
  const SEG_START = 8;
  const shift = (t: number) => t - SEG_START;

  it("shifted sections describe the same musical moments", () => {
    const sections = [4, 12, 30];
    const shifted = sections.map(shift);
    expect(shifted).toEqual([-4, 4, 22]);
    // A boundary before the segment lands negative — already passed, exactly
    // as the live path sees it when the playhead is at that moment.
    expect(shifted[0]).toBeLessThan(0);
  });

  it("shifted vocal spans resolve the identical presence value", () => {
    const spans = vocalSpansFromLyrics(LINES);
    const shifted = spans.map((s) => ({ start: shift(s.start), end: shift(s.end) }));
    // Track time 11 s sits inside the second line; in segment time that is 3 s.
    expect(vocalPresenceAt(shifted, 11 - SEG_START)).toBeCloseTo(vocalPresenceAt(spans, 11), 12);
    // And an instrumental moment stays silent on both timelines.
    expect(vocalPresenceAt(shifted, 6 - SEG_START)).toBeCloseTo(vocalPresenceAt(spans, 6), 12);
  });
});
