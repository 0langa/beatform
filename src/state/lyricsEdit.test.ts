import { describe, expect, it } from "vitest";
import {
  applyLineDetails,
  applyRealignedWords,
  clampLineTime,
  clampWordTime,
  cloneLines,
  deleteLine,
  flaggedCount,
  insertLineAfter,
  lineSeverity,
  lineWindow,
  lrcTimestamp,
  MAX_TIME_SEC,
  mergeWithNext,
  nextFlagged,
  nudgeLine,
  nudgeWord,
  parseTimeInput,
  redistributeWords,
  setLineText,
  setLineTime,
  setWordText,
  setWordTime,
  splitLine,
  withLineUids,
  writeLrc,
} from "./lyricsEdit";
import { activeLyricIndex, parseLrc, type LyricLine, type LyricWord } from "./lyrics";

const word = (t: number, text: string, end: number | null = null, conf?: number): LyricWord => ({
  t,
  end,
  text,
  ...(conf !== undefined ? { conf } : {}),
});

/** A worded two-line fixture in the generated shape (ends null, trailing
 * end tag on the last word of each line). */
function fixture(): LyricLine[] {
  return [
    {
      t: 12,
      end: null,
      text: "Out of my mind",
      conf: 0.8,
      words: [
        word(12.0, "Out", null, 0.9),
        word(12.4, "of", null, 0.85),
        word(12.6, "my", null, 0.75),
        word(13.3, "mind", 14.42, 0.7),
      ],
    },
    { t: 19.65, end: null, text: "Plain fallback line" },
    { t: 24.0, end: null, text: "Third line here", conf: 0.1 },
  ];
}

describe("edit ops are pure", () => {
  it("never mutate their input", () => {
    const lines = fixture();
    const snapshot = cloneLines(lines);
    setLineText(lines, 0, "changed words here now");
    setLineTime(lines, 0, 11);
    splitLine(lines, 0, 7);
    mergeWithNext(lines, 0);
    insertLineAfter(lines, 0);
    deleteLine(lines, 1);
    setWordText(lines, 0, 1, "off");
    setWordTime(lines, 0, 1, 12.5);
    redistributeWords(lines, 0);
    expect(lines).toEqual(snapshot);
  });
});

describe("setLineText", () => {
  it("keeps word timings when the token count matches, dropping conf only on edited words", () => {
    const out = setLineText(fixture(), 0, "Out of my MIND");
    const words = out[0].words!;
    expect(words.map((w) => w.text)).toEqual(["Out", "of", "my", "MIND"]);
    expect(words.map((w) => w.t)).toEqual([12.0, 12.4, 12.6, 13.3]);
    expect(words[3].end).toBe(14.42); // trailing end survives
    expect(words[0].conf).toBe(0.9); // untouched word keeps its conf
    expect(words[3].conf).toBeUndefined(); // edited word is reviewed
    expect(out[0].conf).toBeUndefined(); // line conf recomputes -> undefined
    expect(out[0].text).toBe("Out of my MIND");
  });

  it("redistributes evenly when the token count changes", () => {
    const out = setLineText(fixture(), 0, "completely new words in this line");
    const words = out[0].words!;
    expect(words).toHaveLength(6);
    // Evenly across the window [12, next line 19.65).
    expect(words[0].t).toBeCloseTo(12);
    expect(words[1].t - words[0].t).toBeCloseTo(words[2].t - words[1].t, 6);
    expect(words[5].end).toBeCloseTo(19.65);
    expect(words.every((w) => w.conf === undefined)).toBe(true);
    expect(out[0].text).toBe("completely new words in this line");
  });

  it("edits plain lines and clears their conf (reviewed)", () => {
    const out = setLineText(fixture(), 2, "third line fixed");
    expect(out[2].text).toBe("third line fixed");
    expect(out[2].conf).toBeUndefined();
    expect(out[2].words).toBeUndefined();
  });

  it("emptied text clears the words", () => {
    const out = setLineText(fixture(), 0, "   ");
    expect(out[0].text).toBe("");
    expect(out[0].words).toBeUndefined();
  });
});

describe("line time", () => {
  it("clamps between neighbours and moves words with the line", () => {
    const lines = fixture();
    expect(clampLineTime(lines, 1, 5)).toBeCloseTo(12.01);
    expect(clampLineTime(lines, 1, 30)).toBeCloseTo(23.99);
    const out = setLineTime(lines, 0, 11.5);
    expect(out[0].t).toBeCloseTo(11.5);
    expect(out[0].words![0].t).toBeCloseTo(11.5);
    expect(out[0].words![3].t).toBeCloseTo(12.8);
    expect(out[0].words![3].end).toBeCloseTo(13.92);
  });

  it("nudges by a delta and never goes below zero", () => {
    const lines: LyricLine[] = [{ t: 0.05, end: null, text: "start" }];
    const out = nudgeLine(lines, 0, -1);
    expect(out[0].t).toBe(0);
  });

  it("keeps indices stable — a nudge cannot cross a neighbour", () => {
    const out = nudgeLine(fixture(), 1, 100);
    expect(out[1].t).toBeCloseTo(23.99);
    expect(out[1].t).toBeLessThan(out[2].t);
  });
});

describe("split / merge / insert / delete", () => {
  it("splits at a caret on a token boundary; both halves keep their words", () => {
    const out = splitLine(fixture(), 0, "Out of ".length)!;
    expect(out).toHaveLength(4);
    expect(out[0].text).toBe("Out of");
    expect(out[1].text).toBe("my mind");
    expect(out[1].t).toBeCloseTo(12.6); // the first word of the second half
    expect(out[0].words!.map((w) => w.text)).toEqual(["Out", "of"]);
    expect(out[1].words!.map((w) => w.text)).toEqual(["my", "mind"]);
    expect(out[1].words![1].end).toBe(14.42);
    // The first half's last word may not keep an explicit end (A2 form).
    expect(out[0].words![1].end).toBeNull();
  });

  it("splits a plain line char-proportionally", () => {
    const lines: LyricLine[] = [
      { t: 10, end: null, text: "one two three four" },
      { t: 20, end: null, text: "next" },
    ];
    const out = splitLine(lines, 0, 8)!;
    expect(out[0].text).toBe("one two");
    expect(out[1].text).toBe("three four");
    expect(out[1].t).toBeGreaterThan(10);
    expect(out[1].t).toBeLessThan(20);
  });

  it("refuses to split single-token or edge carets", () => {
    const lines: LyricLine[] = [{ t: 10, end: null, text: "solo" }];
    expect(splitLine(lines, 0, 2)).toBeNull();
    const two = splitLine(fixture(), 0, 0)!;
    expect(two[0].text).toBe("Out"); // caret at 0 still makes a non-empty first half
  });

  it("merge keeps words only when BOTH sides carry them", () => {
    const both = mergeWithNext(
      [
        { t: 1, end: null, text: "a b", words: [word(1, "a"), word(1.5, "b", 2)] },
        { t: 3, end: null, text: "c", words: [word(3, "c", 3.5)] },
      ],
      0,
    )!;
    expect(both[0].text).toBe("a b c");
    expect(both[0].words!.map((w) => w.text)).toEqual(["a", "b", "c"]);
    expect(both[0].words![1].end).toBeNull(); // mid-line end normalized away
    expect(both[0].words![2].end).toBe(3.5);

    const half = mergeWithNext(fixture(), 0)!;
    expect(half[0].text).toBe("Out of my mind Plain fallback line");
    expect(half[0].words).toBeUndefined();
  });

  it("insert places an empty line midway (and before the first line for -1)", () => {
    const out = insertLineAfter(fixture(), 0);
    expect(out).toHaveLength(4);
    expect(out[1].text).toBe("");
    expect(out[1].t).toBeCloseTo((12 + 19.65) / 2);
    const first = insertLineAfter(fixture(), -1);
    expect(first[0].text).toBe("");
    expect(first[0].t).toBeLessThan(12);
  });

  it("delete removes exactly one line", () => {
    const out = deleteLine(fixture(), 1);
    expect(out.map((l) => l.text)).toEqual(["Out of my mind", "Third line here"]);
  });

  /**
   * E2. The correction editor runs on whatever lyrics are loaded, including an
   * imported .srt — and an SRT cue carries an EXPLICIT end that routinely
   * overlaps the next cue (parseSrt keeps them; it only rejects end <= start).
   * `splitLine` used to clamp the second half to the line's own WINDOW, which
   * for such a cue reaches past its successor, so the split-off half landed
   * AFTER the next line. `activeLyricIndex` binary-searches by start, so it
   * then never selected that line: the half the user had just split off
   * disappeared from the overlay — in the preview and in the export — while
   * still showing in the editor list.
   */
  describe("splitLine keeps the line list monotonic (overlapping SRT cue)", () => {
    const overlapping = (): LyricLine[] => [
      { t: 0, end: 20, text: "one two three" }, // cue 1 runs past cue 2
      { t: 5, end: 9, text: "later" },
    ];

    it("places the second half before the next line's start", () => {
      const out = splitLine(overlapping(), 0, 4)!;
      expect(out.map((l) => l.text)).toEqual(["one", "two three", "later"]);
      expect(out[1].t).toBeGreaterThan(out[0].t);
      expect(out[1].t).toBeLessThanOrEqual(out[2].t);
      // Monotonic, which is the invariant every other op in this module holds.
      for (let i = 1; i < out.length; i++) expect(out[i].t).toBeGreaterThanOrEqual(out[i - 1].t);
    });

    it("and the new line is reachable — the overlay can actually show it", () => {
      const out = splitLine(overlapping(), 0, 4)!;
      const seen = new Set<number>();
      for (let t = 0; t <= 10; t += 0.05) seen.add(activeLyricIndex(out, t));
      expect(seen.has(1)).toBe(true);
      expect(seen.has(0)).toBe(true);
      expect(seen.has(2)).toBe(true);
    });

    it("changes nothing for a line whose end does NOT overlap", () => {
      // min(window end, next start) === window end here, so this is the exact
      // pre-fix arithmetic — the guard only bites on the overlapping case.
      const lines: LyricLine[] = [
        { t: 10, end: 15, text: "one two three four" },
        { t: 20, end: null, text: "next" },
      ];
      const out = splitLine(lines, 0, 8)!;
      expect(out[1].t).toBeCloseTo(10 + ((15 - 10) * 8) / 18, 12);
    });

    it("a degenerate corridor still puts the second half AFTER the first", () => {
      const lines: LyricLine[] = [
        { t: 5, end: 30, text: "one two" },
        { t: 5, end: 6, text: "same instant" },
      ];
      const out = splitLine(lines, 0, 4)!;
      expect(out[1].t).toBeGreaterThan(out[0].t);
    });
  });
});

describe("word ops", () => {
  it("edits one word's text, re-deriving the line text and clearing its conf", () => {
    const out = setWordText(fixture(), 0, 3, "mine");
    expect(out[0].text).toBe("Out of my mine");
    expect(out[0].words![3].text).toBe("mine");
    expect(out[0].words![3].conf).toBeUndefined();
    expect(out[0].words![3].t).toBeCloseTo(13.3);
    expect(out[0].conf).toBeUndefined();
  });

  it("splits a slot when several words are typed, deletes it when emptied", () => {
    const split = setWordText(fixture(), 0, 0, "Right out");
    expect(split[0].words!.map((w) => w.text)).toEqual(["Right", "out", "of", "my", "mind"]);
    expect(split[0].text).toBe("Right out of my mind");
    const gone = setWordText(fixture(), 0, 1, "");
    expect(gone[0].words!.map((w) => w.text)).toEqual(["Out", "my", "mind"]);
    expect(gone[0].text).toBe("Out my mind");
  });

  it("clamps word starts between neighbours; the last word's end keeps its duration", () => {
    const early = setWordTime(fixture(), 0, 1, 5);
    expect(early[0].words![1].t).toBeCloseTo(12.01);
    const late = nudgeWord(fixture(), 0, 3, 0.5);
    expect(late[0].words![3].t).toBeCloseTo(13.8);
    expect(late[0].words![3].end).toBeCloseTo(14.92); // duration preserved
  });

  it("redistributes words evenly across the line window and drops conf", () => {
    const out = redistributeWords(fixture(), 0);
    const words = out[0].words!;
    expect(words).toHaveLength(4);
    expect(words[0].t).toBeCloseTo(12);
    expect(words[3].end).toBeCloseTo(19.65);
    expect(out[0].conf).toBeUndefined();
    expect(words.every((w) => w.conf === undefined)).toBe(true);
  });
});

/**
 * E2-U2: the tail line/word (no next neighbour to bound against) used to
 * clamp against `hi = Infinity`, so an unbounded typed value (parseTimeInput
 * has no upper bound) passed straight through. Nothing crashed — lrcTimestamp
 * went on saturating the DISPLAY and the .lrc export at 99:59.99 — but the
 * internal `t` stayed astronomical, so the line/word silently, permanently
 * stopped appearing in the karaoke overlay (activeLyricIndex's binary search
 * never reaches it) in both preview and export, with no error anywhere.
 */
describe("tail time ceiling (E2-U2)", () => {
  it("clampLineTime caps the LAST line at MAX_TIME_SEC instead of accepting an unbounded paste", () => {
    const lines = fixture();
    const last = lines.length - 1;
    expect(clampLineTime(lines, last, 1e300)).toBe(MAX_TIME_SEC);
    // A legit tail edit well within bounds is untouched.
    expect(clampLineTime(lines, last, 40)).toBeCloseTo(40);
  });

  it("a no-colon paste of '1e300' on the LAST line no longer drops it from the overlay forever", () => {
    // Routed through the real parser, matching the reaching scenario exactly:
    // TimeChip hands the typed string to parseTimeInput, which accepts any
    // finite, non-negative number with no upper bound.
    const parsed = parseTimeInput("1e300");
    expect(parsed).not.toBeNull(); // confirms the repro's precondition
    const lines = fixture();
    const last = lines.length - 1;
    const out = setLineTime(lines, last, parsed!);
    expect(out[last].t).toBe(MAX_TIME_SEC);
    // Still findable — this is the actual user-visible bug: pre-fix, `t`
    // sailed past every time the app could ever reach, so this index was
    // never selected by activeLyricIndex, live or in export.
    expect(activeLyricIndex(out, MAX_TIME_SEC)).toBe(last);
    // Display/export clamp and the internal value now agree exactly — the
    // old "editing the field again self-heals it" round-trip is a no-op,
    // not a silent repair of a still-corrupt internal value.
    expect(lrcTimestamp(out[last].t)).toBe("99:59.99");
    expect(parseTimeInput(lrcTimestamp(out[last].t))).toBeCloseTo(out[last].t, 2);
  });

  it("clampWordTime caps the LAST word of a line the same way", () => {
    const line = fixture()[0];
    const lastWord = line.words!.length - 1;
    expect(clampWordTime(line, lastWord, 1e300)).toBe(MAX_TIME_SEC);
    // A legit tail word edit well within bounds is untouched.
    expect(clampWordTime(line, lastWord, 15)).toBeCloseTo(15);
  });

  it("setWordTime on the last word survives a huge paste without corrupting the line", () => {
    const out = setWordTime(fixture(), 0, 3, 1e300);
    const w = out[0].words![3];
    expect(w.t).toBe(MAX_TIME_SEC);
    // The trailing explicit end keeps a positive duration relative to t —
    // proves normalizeWords still ran on the saturated value rather than
    // being skipped because t hit the ceiling.
    expect(w.end).toBeGreaterThan(w.t);
  });

  it("non-tail lines/words are unaffected — the neighbour-derived corridor still wins", () => {
    // Pins that the ceiling applies ONLY to the tail: a regression that
    // widened it to every line (e.g. dropping the ternary) would go red
    // here even though the two tests above would stay green.
    const lines = fixture();
    expect(clampLineTime(lines, 1, 1e300)).toBeCloseTo(23.99);
    const line = fixture()[0];
    expect(clampWordTime(line, 1, 1e300)).toBeCloseTo(12.59); // bounded by word 2 ("my" @ 12.6), not MAX_TIME_SEC
  });

  /**
   * Whole-lane review, IMPORTANT: MAX_TIME_SEC alone regressed a legitimate
   * tail edit on any track past ~100 minutes — imported lyrics have no
   * clamp of their own, so such a file genuinely reaches this code with a
   * real duration past 5999.99s. clampLineTime/clampWordTime/setLineTime/
   * setWordTime all gained an optional `ceiling` parameter (default
   * MAX_TIME_SEC — the tests above already pin that default's own
   * behavior); these pin the parameter itself, at the pure-function layer,
   * decoupled from lyricsEditActions.ts's own duration-sourcing (covered
   * in lyricsEditActions.test.ts).
   */
  describe("the tail ceiling is a parameter (whole-lane review, IMPORTANT)", () => {
    it("clampLineTime honors a caller-supplied ceiling on the LAST line", () => {
      const lines = fixture();
      const last = lines.length - 1;
      expect(clampLineTime(lines, last, 1e300, 7200)).toBe(7200);
      // A value within the custom ceiling but past MAX_TIME_SEC survives —
      // proves this is a REPLACEMENT ceiling, not an additional cap.
      expect(clampLineTime(lines, last, 6500, 7200)).toBeCloseTo(6500);
    });

    it("clampWordTime honors a caller-supplied ceiling on the LAST word", () => {
      const line = fixture()[0];
      const lastWord = line.words!.length - 1;
      expect(clampWordTime(line, lastWord, 1e300, 7200)).toBe(7200);
      expect(clampWordTime(line, lastWord, 6500, 7200)).toBeCloseTo(6500);
    });

    it("setLineTime forwards the ceiling through to the clamp", () => {
      const lines = fixture();
      const last = lines.length - 1;
      const out = setLineTime(lines, last, 1e300, 7200);
      expect(out[last].t).toBe(7200);
    });

    it("setWordTime forwards the ceiling through to the clamp", () => {
      const out = setWordTime(fixture(), 0, 3, 1e300, 7200);
      expect(out[0].words![3].t).toBe(7200);
    });

    it("omitting the ceiling still defaults to MAX_TIME_SEC — the pure contract every existing caller relies on is unchanged", () => {
      const lines = fixture();
      const last = lines.length - 1;
      expect(clampLineTime(lines, last, 1e300)).toBe(MAX_TIME_SEC);
    });
  });
});

describe("realign + confidence transport", () => {
  it("applies re-aligned words in representable form with conf", () => {
    const out = applyRealignedWords(fixture(), 2, [
      { t: 24.1, end: 24.5, conf: 0.9, text: "Third" },
      { t: 24.5, end: 24.8, conf: 0.8, text: "line" },
      { t: 24.9, end: 25.4, conf: 0.7, text: "here" },
    ])!;
    const words = out[2].words!;
    expect(words.map((w) => w.end)).toEqual([null, null, 25.4]);
    expect(out[2].conf).toBeCloseTo(0.8);
    expect(out[2].text).toBe("Third line here");
  });

  it("rejects a stale result whose tokens no longer match the line", () => {
    expect(
      applyRealignedWords(fixture(), 2, [{ t: 1, end: 2, conf: 1, text: "different" }]),
    ).toBeNull();
  });

  it("applyLineDetails maps conf by index and guards word-count mismatches", () => {
    const lines: LyricLine[] = [
      { t: 1, end: null, text: "a b", words: [word(1, "a"), word(1.5, "b", 2)] },
      { t: 3, end: null, text: "plain" },
    ];
    const out = applyLineDetails(lines, [
      { conf: 0.9, words: [0.95, 0.85] },
      { conf: null, words: [] },
    ]);
    expect(out[0].conf).toBeCloseTo(0.9);
    expect(out[0].words![0].conf).toBeCloseTo(0.95);
    expect(out[1].conf).toBeUndefined();
    // Length mismatch: nothing applied.
    expect(applyLineDetails(lines, [{ conf: 1, words: [] }])).toBe(lines);
    // Word-count mismatch: line conf lands, word confs do not.
    const off = applyLineDetails(lines, [
      { conf: 0.5, words: [0.1] },
      { conf: null, words: [] },
    ]);
    expect(off[0].conf).toBeCloseTo(0.5);
    expect(off[0].words![0].conf).toBeUndefined();
  });
});

describe("flags", () => {
  it("severity uses the calibrated two-threshold rule; no conf = no flag", () => {
    expect(lineSeverity({ t: 0, end: null, text: "x", conf: 0.1 })).toBe("flag");
    expect(lineSeverity({ t: 0, end: null, text: "x", conf: 0.3 })).toBe("warn");
    expect(lineSeverity({ t: 0, end: null, text: "x", conf: 0.6 })).toBeNull();
    expect(lineSeverity({ t: 0, end: null, text: "x" })).toBeNull();
  });

  it("nextFlagged cycles with wrap-around", () => {
    const lines = fixture(); // only line 2 is flagged (conf 0.1); line 0 is 0.8
    expect(flaggedCount(lines)).toBe(1);
    expect(nextFlagged(lines, -1)).toBe(2);
    expect(nextFlagged(lines, 2)).toBe(2); // wraps back to itself
    expect(nextFlagged([{ t: 0, end: null, text: "x" }], -1)).toBe(-1);
  });
});

describe("LRC writer", () => {
  it("timestamps format and carry exactly like the sidecar writer", () => {
    expect(lrcTimestamp(0)).toBe("00:00.00");
    expect(lrcTimestamp(1.234)).toBe("00:01.23");
    expect(lrcTimestamp(61)).toBe("01:01.00");
    expect(lrcTimestamp(59.996)).toBe("01:00.00"); // rounding carries
    expect(lrcTimestamp(-3)).toBe("00:00.00");
    expect(lrcTimestamp(99 * 60 + 59.999)).toBe("99:59.99"); // saturates
  });

  /** The enhanced shape — this exact document is mirrored in the sidecar's
   * lrc.rs tests and in lyrics.test.ts; change all three together. */
  it("writes A2 word tags with one trailing end; mismatched words degrade to plain", () => {
    const lines: LyricLine[] = [
      {
        t: 12,
        end: null,
        text: "Out of my mind",
        words: [word(12.0, "Out"), word(12.4, "of"), word(12.6, "my"), word(13.3, "mind", 14.42)],
      },
      { t: 19.65, end: null, text: "Plain fallback line" },
      { t: 21, end: null, text: "two words", words: [word(21, "two")] }, // mismatch
      { t: 25, end: null, text: "   " }, // empty: skipped like the parser would
    ];
    expect(writeLrc(lines)).toBe(
      "[re:Beatform lyrics editor]\n" +
        "[00:12.00]<00:12.00>Out <00:12.40>of <00:12.60>my <00:13.30>mind<00:14.42>\n" +
        "[00:19.65]Plain fallback line\n" +
        "[00:21.00]two words\n",
    );
  });

  it("round-trips through the app's own parser, words and all", () => {
    const lines = fixture();
    const reparsed = parseLrc(writeLrc(lines));
    expect(reparsed).toHaveLength(3);
    for (let i = 0; i < reparsed.length; i++) {
      expect(reparsed[i].t).toBeCloseTo(lines[i].t, 2);
      expect(reparsed[i].text).toBe(lines[i].text);
    }
    const words = reparsed[0].words!;
    expect(words.map((w) => w.text)).toEqual(["Out", "of", "my", "mind"]);
    expect(words.map((w) => w.t)).toEqual([12.0, 12.4, 12.6, 13.3]);
    expect(words[3].end).toBeCloseTo(14.42, 2);
    expect(words.slice(0, 3).every((w) => w.end === null)).toBe(true);
    // conf is session-only: it must NOT survive the artifact.
    expect(reparsed[0].conf).toBeUndefined();
    expect(words.every((w) => w.conf === undefined)).toBe(true);
    // A second pass is byte-identical — the editor's form IS the writer's.
    expect(writeLrc(reparsed)).toBe(writeLrc(lines));
  });
});

describe("time input + window", () => {
  it("parses mm:ss.xx, m:ss and plain seconds; rejects garbage", () => {
    expect(parseTimeInput("01:23.46")).toBeCloseTo(83.46);
    expect(parseTimeInput("1:05")).toBe(65);
    expect(parseTimeInput("12.4")).toBeCloseTo(12.4);
    expect(parseTimeInput("75")).toBe(75);
    expect(parseTimeInput("0:75")).toBeNull();
    expect(parseTimeInput("nope")).toBeNull();
    expect(parseTimeInput("")).toBeNull();
    expect(parseTimeInput("-3")).toBeNull();
  });

  it("lineWindow mirrors the karaoke wipe's window rules", () => {
    const lines = fixture();
    expect(lineWindow(lines, 0)).toEqual({ start: 12, end: 19.65 });
    expect(lineWindow(lines, 2)).toEqual({ start: 24, end: 28 }); // +4s tail
    const srt: LyricLine[] = [{ t: 1, end: 2.5, text: "explicit" }];
    expect(lineWindow(srt, 0)).toEqual({ start: 1, end: 2.5 });
  });
});

/**
 * R2-31k — session row ids: minted at load (withLineUids) and on the two
 * ops that create rows, carried through every other op by cloneLine. The
 * editor keys its rows on them; nothing here ever reaches a file.
 */
describe("session row ids (uid)", () => {
  it("withLineUids fills only the missing ids and is idempotent", () => {
    const lines: LyricLine[] = [
      { t: 0, end: null, text: "a", uid: "keep-me" },
      { t: 1, end: null, text: "b" },
    ];
    const withIds = withLineUids(lines);
    expect(withIds[0].uid).toBe("keep-me");
    expect(withIds[1].uid).toBeDefined();
    expect(withLineUids(withIds)).toBe(withIds); // fully-id'd: same array back
  });

  it("edits keep a row's id; split keeps the first half's; merge keeps the first line's; insert mints", () => {
    const lines = withLineUids([
      { t: 0, end: null, text: "one two" },
      { t: 4, end: null, text: "next line" },
    ]);
    const [idA, idB] = [lines[0].uid, lines[1].uid];

    expect(setLineText(lines, 0, "one too")[0].uid).toBe(idA);
    expect(nudgeLine(lines, 0, 0.1)[0].uid).toBe(idA);

    const split = splitLine(lines, 0, 4)!;
    expect(split[0].uid).toBe(idA); // the split row IS the original
    expect(split[1].uid).toBeDefined();
    expect(split[1].uid).not.toBe(idA);
    expect(split[2].uid).toBe(idB); // untouched rows keep theirs

    const merged = mergeWithNext(lines, 0)!;
    expect(merged[0].uid).toBe(idA);

    const inserted = insertLineAfter(lines, 0);
    expect(inserted[1].uid).toBeDefined();
    expect([idA, idB]).not.toContain(inserted[1].uid);
  });
});
