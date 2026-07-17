import { describe, expect, it } from "vitest";
import {
  activeLyricIndex,
  lyricAlphaAt,
  LyricParseError,
  parseLrc,
  parseLyrics,
  parseSrt,
} from "./lyrics";

const LRC = `[ar:Artist]
[ti:Title]
[offset:+500]
[00:05.00]First line
[00:10.50][01:00.00]Repeated chorus
[00:20]No fraction
Plain text without tags
[00:30.25]Line with [00:99] fake tag inside`;

describe("parseLrc", () => {
  it("parses timestamps, applies offset, expands multi-stamp lines, skips metadata", () => {
    const lines = parseLrc(LRC);
    expect(lines.map((l) => l.text)).toEqual([
      "First line",
      "Repeated chorus",
      "No fraction",
      "Line with [00:99] fake tag inside",
      "Repeated chorus",
    ]);
    // +500ms offset applied to every stamp
    expect(lines[0].t).toBeCloseTo(5.5, 5);
    expect(lines[1].t).toBeCloseTo(11.0, 5);
    expect(lines[2].t).toBeCloseTo(20.5, 5);
    expect(lines[4].t).toBeCloseTo(60.5, 5);
    // LRC lines have implicit ends
    expect(lines.every((l) => l.end === null)).toBe(true);
  });
});

const SRT = `1
00:00:02,000 --> 00:00:04,500
<i>Hello</i> world

2
00:00:06,000 --> 00:00:08,000
Two
lines

not-a-block
`;

describe("parseSrt", () => {
  it("parses cue ranges, strips tags, joins multi-line text", () => {
    const lines = parseSrt(SRT);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ t: 2, end: 4.5, text: "Hello world" });
    expect(lines[1].text).toBe("Two lines");
  });
});

describe("parseLyrics", () => {
  it("dispatches by extension and throws on garbage", () => {
    expect(parseLyrics("a.srt", SRT)).toHaveLength(2);
    expect(parseLyrics("a.lrc", LRC).length).toBeGreaterThan(0);
    // unknown extension: tries LRC, falls back to SRT
    expect(parseLyrics("a.txt", SRT)).toHaveLength(2);
    expect(() => parseLyrics("a.lrc", "just prose")).toThrow(LyricParseError);
  });
});

describe("activeLyricIndex + lyricAlphaAt", () => {
  const lines = parseSrt(SRT); // [2..4.5], [6..8]
  it("resolves the active line, gaps and explicit ends", () => {
    expect(activeLyricIndex(lines, 0)).toBe(-1); // before first
    expect(activeLyricIndex(lines, 3)).toBe(0);
    expect(activeLyricIndex(lines, 5)).toBe(-1); // gap (explicit end passed)
    expect(activeLyricIndex(lines, 7)).toBe(1);
    expect(activeLyricIndex(lines, 9)).toBe(-1); // after last
  });

  it("LRC lines run until the next line starts", () => {
    const lrc = parseLrc("[00:05]A\n[00:10]B");
    expect(activeLyricIndex(lrc, 7)).toBe(0);
    expect(activeLyricIndex(lrc, 11)).toBe(1);
  });

  it("fades in and out inside the window, full alpha between", () => {
    expect(lyricAlphaAt(lines, 0, 2.05, 0.1)).toBeCloseTo(0.5, 5); // fading in
    expect(lyricAlphaAt(lines, 0, 3, 0.1)).toBe(1);
    expect(lyricAlphaAt(lines, 0, 4.45, 0.1)).toBeCloseTo(0.5, 5); // fading out
    expect(lyricAlphaAt(lines, -1, 3, 0.1)).toBe(0);
    expect(lyricAlphaAt(lines, 0, 3, 0)).toBe(1); // fade off = hard
  });
});
