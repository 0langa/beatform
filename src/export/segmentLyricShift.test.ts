import { describe, expect, it } from "vitest";
import { lyricProgressAt, shiftLyricsForSegment, type LyricLine } from "../state/lyrics";

/**
 * F4a: a segment export must shift lyric WORDS with their line.
 *
 * Every time-carrying quantity handed to a segment export is rebased from
 * track time to clip time — the beat grid's beats, the timeline's scenes and
 * keyframes, stem envelopes, section boundaries, vocal spans. Lyric lines were
 * rebased too, but `words` rode through on the object spread still holding
 * ABSOLUTE track times, while `lyricProgressAt` compares them against clip
 * time. The line then reads as entirely unsung for the whole clip: the karaoke
 * wipe renders dim while the preview sweeps it normally.
 *
 * Only segment/Canvas-loop exports of word-timed lyrics (enhanced LRC or the
 * local aligner) with `anim: "wipe"` were affected, which is why nothing
 * louder ever surfaced it.
 *
 * The shift is `shiftLyricsForSegment`, exported from state/lyrics for the
 * same reason `shiftStemAnalysis` is exported from audio/stems: the caller
 * lives behind a Worker, and the arithmetic is worth testing directly. This
 * file imports that function — it does not restate it — so the tests fail if
 * the production mapping regresses.
 */

const SEGMENT_START = 58;

/** The line as authored, in track time. */
function trackLine(): LyricLine {
  return {
    t: 60,
    end: 64,
    text: "never gonna give you up",
    words: [
      { t: 60, end: 61, text: "never" },
      { t: 61, end: 62.5, text: "gonna" },
      { t: 62.5, end: 63.2, text: "give" },
      { t: 63.2, end: 64, text: "you up" },
    ],
  } as LyricLine;
}

/** The REAL mapping videoExporter applies — imported, never reimplemented.
 *  A local copy here would pass against a broken videoExporter, which is the
 *  vacuous-test shape this whole file exists to avoid. */
function shiftForSegment(line: LyricLine, start: number): LyricLine {
  return shiftLyricsForSegment([line], start)[0];
}

/** The pre-fix mapping: the line moved, the words did not. */
function shiftLineOnly(line: LyricLine, start: number): LyricLine {
  return {
    ...line,
    t: line.t - start,
    end: line.end === null ? null : line.end - start,
  } as LyricLine;
}

describe("segment exports rebase lyric words with their line (F4a)", () => {
  const sweep = [60.5, 61.0, 61.5, 62.0, 62.75, 63.0, 63.9];

  it("keeps the sung fraction identical to the preview across the line", () => {
    const track = [trackLine()];
    const clip = [shiftForSegment(trackLine(), SEGMENT_START)];
    let moved = 0;
    for (const t of sweep) {
      const preview = lyricProgressAt(track, 0, t);
      const exported = lyricProgressAt(clip, 0, t - SEGMENT_START);
      expect(exported).toBeCloseTo(preview, 12);
      if (preview > 0 && preview < 1) moved += 1;
    }
    // Non-vacuity: the sweep has to actually catch the wipe mid-sweep, or
    // "identical" would be two constant zeros agreeing with each other.
    expect(moved).toBeGreaterThan(3);
  });

  it("fails the way the defect failed when only the line is shifted", () => {
    // The regression, pinned. Word spans left in track time are all far in the
    // future relative to clip time, so the fill never starts.
    const clip = [shiftLineOnly(trackLine(), SEGMENT_START)];
    for (const t of sweep) {
      expect(lyricProgressAt(clip, 0, t - SEGMENT_START)).toBe(0);
    }
    // ...while the preview was sweeping normally at those same moments.
    const track = [trackLine()];
    expect(lyricProgressAt(track, 0, 63.0)).toBeGreaterThan(0.5);
  });

  it("leaves a plain line without word timings unchanged", () => {
    const plain = { t: 60, end: 64, text: "no word tags" } as LyricLine;
    const shifted = shiftForSegment(plain, SEGMENT_START);
    expect(shifted.words).toBeUndefined();
    expect(lyricProgressAt([shifted], 0, 62 - SEGMENT_START)).toBeCloseTo(
      lyricProgressAt([plain], 0, 62),
      12,
    );
  });

  it("carries an open-ended word end through the shift", () => {
    const openEnded = {
      t: 60,
      end: null,
      text: "held note",
      words: [
        { t: 60, end: null, text: "held" },
        { t: 62, end: null, text: "note" },
      ],
    } as LyricLine;
    const shifted = shiftForSegment(openEnded, SEGMENT_START);
    expect(shifted.end).toBeNull();
    expect(shifted.words?.map((w) => [w.t, w.end])).toEqual([
      [2, null],
      [4, null],
    ]);
  });
});
