import { describe, expect, it } from "vitest";
import {
  VOCAL_ATTACK_SEC,
  VOCAL_MERGE_GAP_SEC,
  VOCAL_RELEASE_SEC,
  vocalPresenceAt,
  vocalSpansFromLyrics,
} from "./vocalPresence";

describe("vocalSpansFromLyrics", () => {
  it("uses word timing where present and merges breath gaps into phrases", () => {
    const spans = vocalSpansFromLyrics([
      {
        t: 10,
        end: 12,
        words: [
          { t: 10, end: 10.4 },
          { t: 10.5, end: null }, // ends at next word's start
          { t: 10.8, end: 11.6 },
        ],
      },
    ]);
    // 0.1/0.2 s inter-word gaps are under the merge gap → ONE phrase span.
    expect(spans).toEqual([{ start: 10, end: 11.6 }]);
  });

  it("a plain LRC line (null end) runs to the next line's start and merges with it", () => {
    const spans = vocalSpansFromLyrics([
      { t: 5, end: null },
      { t: 8, end: 9 },
      { t: 30, end: 31 },
    ]);
    expect(spans).toEqual([
      { start: 5, end: 9 },
      { start: 30, end: 31 },
    ]);
  });

  it("an open-ended LAST line gets the 4 s nominal window", () => {
    expect(vocalSpansFromLyrics([{ t: 50, end: null }])).toEqual([{ start: 50, end: 54 }]);
  });

  it("keeps spans apart only past the merge gap", () => {
    const nearly = vocalSpansFromLyrics([
      { t: 0, end: 1 },
      { t: 1 + VOCAL_MERGE_GAP_SEC - 0.01, end: 2 },
    ]);
    expect(nearly).toHaveLength(1);
    const apart = vocalSpansFromLyrics([
      { t: 0, end: 1 },
      { t: 1 + VOCAL_MERGE_GAP_SEC + 0.01, end: 2 },
    ]);
    expect(apart).toHaveLength(2);
  });

  it("is deterministic and order-insensitive", () => {
    const shuffled = [
      { t: 20, end: 21 },
      { t: 0, end: 1 },
      { t: 10, end: 11 },
    ];
    expect(vocalSpansFromLyrics(shuffled)).toEqual(
      vocalSpansFromLyrics([...shuffled].sort((a, b) => a.t - b.t)),
    );
  });
});

describe("vocalPresenceAt", () => {
  const spans = vocalSpansFromLyrics([
    { t: 10, end: 12 },
    { t: 20, end: 24 },
  ]);

  it("is 1 inside a span and 0 well outside", () => {
    expect(vocalPresenceAt(spans, 11)).toBe(1);
    expect(vocalPresenceAt(spans, 22)).toBe(1);
    expect(vocalPresenceAt(spans, 0)).toBe(0);
    expect(vocalPresenceAt(spans, 16)).toBe(0);
    expect(vocalPresenceAt(spans, 100)).toBe(0);
    expect(vocalPresenceAt([], 11)).toBe(0);
  });

  it("ramps linearly over the attack window before a span", () => {
    expect(vocalPresenceAt(spans, 10 - VOCAL_ATTACK_SEC)).toBe(0);
    expect(vocalPresenceAt(spans, 10 - VOCAL_ATTACK_SEC / 2)).toBeCloseTo(0.5, 10);
    expect(vocalPresenceAt(spans, 10)).toBe(1);
    // The attack also applies to a LATER span reached from silence between
    // spans (the binary search must look one span ahead).
    expect(vocalPresenceAt(spans, 20 - VOCAL_ATTACK_SEC / 2)).toBeCloseTo(0.5, 10);
  });

  it("ramps linearly over the release window after a span", () => {
    expect(vocalPresenceAt(spans, 12)).toBe(1);
    expect(vocalPresenceAt(spans, 12 + VOCAL_RELEASE_SEC / 2)).toBeCloseTo(0.5, 10);
    expect(vocalPresenceAt(spans, 12 + VOCAL_RELEASE_SEC)).toBe(0);
  });

  it("is a pure function of (spans, t): seek anywhere, same value", () => {
    const probe = 12 + VOCAL_RELEASE_SEC / 3;
    const a = vocalPresenceAt(spans, probe);
    vocalPresenceAt(spans, 0);
    vocalPresenceAt(spans, 23);
    expect(vocalPresenceAt(spans, probe)).toBe(a);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });

  it("stays within 0..1 across a dense sweep", () => {
    for (let t = 5; t < 30; t += 0.01) {
      const v = vocalPresenceAt(spans, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
