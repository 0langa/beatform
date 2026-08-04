import { describe, expect, it } from "vitest";
import {
  activeLyricIndex,
  lyricAlphaAt,
  lyricProgressAt,
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
    // Plain LRC carries no word timing at all
    expect(lines.every((l) => l.words === undefined)).toBe(true);
  });
});

describe("parseLrc — enhanced (A2 word tags)", () => {
  it("round-trips the sidecar writer's exact output", () => {
    // This document is asserted string-for-string by the Rust writer test
    // (lrc.rs word_timed_lines_write_a2_tags_with_a_trailing_end); change
    // both together or writer and parser have silently diverged.
    const doc =
      "[re:Beatform local lyrics v1]\n" +
      "[00:12.00]<00:12.00>Out <00:12.40>of <00:12.60>my <00:13.30>mind<00:14.42>\n" +
      "[00:19.65]Plain fallback line\n";
    const lines = parseLrc(doc);
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe("Out of my mind");
    expect(lines[0].words).toEqual([
      { t: 12.0, end: null, text: "Out" },
      { t: 12.4, end: null, text: "of" },
      { t: 12.6, end: null, text: "my" },
      { t: 13.3, end: 14.42, text: "mind" }, // trailing tag = last word's end
    ]);
    expect(lines[1].text).toBe("Plain fallback line");
    expect(lines[1].words).toBeUndefined();
  });

  it("reads foreign ELRC variants: spaced tags, per-word end tags, untagged prefixes", () => {
    // Space after each tag (a common exporter style)
    const spaced = parseLrc("[00:01.00] <00:01.00> alpha <00:02.00> beta");
    expect(spaced[0].text).toBe("alpha beta");
    expect(spaced[0].words).toEqual([
      { t: 1, end: null, text: "alpha" },
      { t: 2, end: null, text: "beta" },
    ]);
    // Per-word end tags: <start>word<end> pairs
    const paired = parseLrc("[00:01.00]<00:01.00>hold<00:01.50> <00:03.00>on<00:03.40>");
    expect(paired[0].words).toEqual([
      { t: 1, end: 1.5, text: "hold" },
      { t: 3, end: 3.4, text: "on" },
    ]);
    // Untagged leading text stays in the display line, untimed
    const prefix = parseLrc("[00:05.00]Oh <00:06.00>yes");
    expect(prefix[0].text).toBe("Oh yes");
    expect(prefix[0].words).toEqual([{ t: 6, end: null, text: "yes" }]);
  });

  it("applies [offset:] to word times and sanitizes backwards timings", () => {
    const withOffset = parseLrc("[offset:+1000]\n[00:01.00]<00:01.00>one <00:02.00>two");
    expect(withOffset[0].t).toBeCloseTo(2, 5);
    expect(withOffset[0].words![0].t).toBeCloseTo(2, 5);
    expect(withOffset[0].words![1].t).toBeCloseTo(3, 5);
    // A backwards second word clamps to its predecessor; an end before its
    // own start is dropped rather than kept as a lie.
    const dirty = parseLrc("[00:10.00]<00:11.00>a <00:10.50>b<00:10.20>");
    expect(dirty[0].words).toEqual([
      { t: 11, end: null, text: "a" },
      { t: 11, end: null, text: "b" },
    ]);
  });

  it("attaches words to exactly one copy of a multi-stamp line", () => {
    const lines = parseLrc("[00:10.00][01:00.00]<01:00.20>same <01:00.80>words");
    expect(lines).toHaveLength(2);
    const [first, second] = lines;
    expect(first.t).toBeCloseTo(10, 5);
    expect(first.words).toBeUndefined(); // absolute word times belong to the 1:00 copy
    expect(second.t).toBeCloseTo(60, 5);
    expect(second.words).toHaveLength(2);
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

  it("karaoke wipe progress runs 0..1 across the line window", () => {
    // line 0 is [2, 4.5]: midpoint 3.25 -> 0.5
    expect(lyricProgressAt(lines, 0, 2)).toBe(0);
    expect(lyricProgressAt(lines, 0, 3.25)).toBeCloseTo(0.5, 5);
    expect(lyricProgressAt(lines, 0, 4.5)).toBe(1);
    expect(lyricProgressAt(lines, 0, 5)).toBe(1); // clamped past the end
    expect(lyricProgressAt(lines, -1, 3)).toBe(0); // no active line
  });

  it("karaoke wipe follows real word timings when the line has them", () => {
    // "Out of my mind": 14 fill-weighted chars (11 letters + 3 separators).
    const wordLines = parseLrc(
      "[00:12.00]<00:12.00>Out <00:12.40>of <00:12.60>my <00:13.30>mind<00:14.42>\n[00:19.65]next",
    );
    const p = (t: number) => lyricProgressAt(wordLines, 0, t);
    expect(p(11.9)).toBe(0); // line active machinery aside, nothing sung
    expect(p(12.0)).toBe(0); // first word about to start
    // Halfway through "Out" (12.0-12.4): 1.5 of 14 chars
    expect(p(12.2)).toBeCloseTo(1.5 / 14, 5);
    // "Out of" done + "my" (12.6-13.3) at 6/7: (3 + 3 + 3*(6/7)) / 14
    expect(p(13.2)).toBeCloseTo((6 + 3 * (0.6 / 0.7)) / 14, 5);
    // Past the last word's explicit end: fully filled although the line
    // stays on screen until 19.65 — that hold IS the word-timing payoff.
    expect(p(14.42)).toBe(1);
    expect(p(16)).toBe(1);
  });

  it("holds the fill between a word's explicit end and the next word's start", () => {
    const gap = parseLrc("[00:01.00]<00:01.00>hold<00:01.50> <00:03.00>on<00:03.40>\n[00:09]x");
    const p = (t: number) => lyricProgressAt(gap, 0, t);
    // 7 weighted chars: hold=4, on=3 (2 + separator).
    expect(p(1.5)).toBeCloseTo(4 / 7, 5);
    expect(p(2.2)).toBeCloseTo(4 / 7, 5); // held through the gap
    expect(p(3.2)).toBeCloseTo((4 + 3 * 0.5) / 7, 5);
    expect(p(3.4)).toBe(1);
  });

  it("word-timed last line without an end tag completes at the line window end", () => {
    const open = parseLrc("[00:01.00]<00:01.20>only");
    // Open-ended single line: nominal 4 s window ends at 5.0.
    expect(lyricProgressAt(open, 0, 1.1)).toBe(0);
    expect(lyricProgressAt(open, 0, 5.0)).toBe(1);
    const mid = lyricProgressAt(open, 0, 3.1);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
});
