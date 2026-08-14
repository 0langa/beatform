import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Store-level contract of the lyrics correction editor (FEAT-004 phase 4):
 * edits land in `lyrics` (the overlay's source of truth), the editor-local
 * undo/redo walks them, and loading/clearing a lyrics document resets that
 * history. The pure op semantics live in lyricsEdit.test.ts — here it's the
 * wiring: snapshot discipline, depth mirroring, reset hooks, conf transport.
 */

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

vi.mock("../services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => ({
    ctx: { decodeAudioData: vi.fn() },
    audioBuffer: null as { duration: number } | null,
    currentTime: 0,
    duration: 0,
    playing: false,
    setVolume: vi.fn(),
    onEnded: null,
    dispose: vi.fn(),
  })),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn() })),
  peekAnalyzer: vi.fn(() => null),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

vi.mock("../platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform")>();
  return { ...actual, writeAutosave: vi.fn(async () => {}) };
});

// Dynamic import: a static one would hoist above the global stubs and the
// store's module-init would read localStorage before it exists (the
// store.test.ts discipline).
const { useVizStore } = await import("../store");
const { getEngine } = await import("../services");
const { MAX_TIME_SEC } = await import("../lyricsEdit");

const LRC =
  "[00:12.00]<00:12.00>Out <00:12.40>of <00:12.60>my <00:13.30>mind<00:14.42>\n" +
  "[00:19.65]Plain fallback line\n" +
  "[00:24.00]Third line here\n";

function load() {
  useVizStore.getState().loadLyricsText("song.lrc", LRC);
}

beforeEach(() => {
  useVizStore.getState().clearLyrics();
});

afterEach(() => {
  // Every test below that sets a track duration must not leak it forward —
  // the default (no track loaded) is what every OTHER test in this file
  // implicitly relies on for the tail-ceiling fallback.
  vi.mocked(getEngine).mockReturnValue({
    ctx: { decodeAudioData: vi.fn() },
    audioBuffer: null,
    currentTime: 0,
    duration: 0,
    playing: false,
    setVolume: vi.fn(),
    onEnded: null,
    dispose: vi.fn(),
  } as unknown as ReturnType<typeof getEngine>);
});

describe("editor actions through the store", () => {
  it("edits land in state and are undo/redo-able, with mirrored depths", () => {
    load();
    const s = () => useVizStore.getState();
    expect(s().lyricsEditUndoDepth).toBe(0); // fresh document, fresh history

    s().editLyricLineText(1, "Plain corrected line");
    expect(s().lyrics![1].text).toBe("Plain corrected line");
    expect(s().lyricsEditUndoDepth).toBe(1);

    s().nudgeLyricLine(1, 0.1);
    expect(s().lyrics![1].t).toBeCloseTo(19.75);
    expect(s().lyricsEditUndoDepth).toBe(2);

    s().undoLyricsEdit();
    expect(s().lyrics![1].t).toBeCloseTo(19.65);
    expect(s().lyrics![1].text).toBe("Plain corrected line");
    expect(s().lyricsEditRedoDepth).toBe(1);

    s().undoLyricsEdit();
    expect(s().lyrics![1].text).toBe("Plain fallback line");
    expect(s().lyricsEditUndoDepth).toBe(0);

    s().redoLyricsEdit();
    expect(s().lyrics![1].text).toBe("Plain corrected line");
    expect(s().lyricsEditUndoDepth).toBe(1);
    expect(s().lyricsEditRedoDepth).toBe(1);
  });

  it("a fresh edit clears the redo branch", () => {
    load();
    const s = () => useVizStore.getState();
    s().editLyricLineText(1, "one");
    s().undoLyricsEdit();
    expect(s().lyricsEditRedoDepth).toBe(1);
    s().editLyricLineText(1, "two");
    expect(s().lyricsEditRedoDepth).toBe(0);
    expect(s().lyrics![1].text).toBe("two");
  });

  it("structural ops (split, merge, insert, delete, word edits) all round through undo", () => {
    load();
    const s = () => useVizStore.getState();
    const before = JSON.stringify(s().lyrics);

    s().splitLyricLine(0, "Out of ".length);
    expect(s().lyrics).toHaveLength(4);
    s().mergeLyricLineWithNext(0);
    expect(s().lyrics).toHaveLength(3);
    s().insertLyricLineAfter(1);
    expect(s().lyrics).toHaveLength(4);
    s().deleteLyricLine(2);
    expect(s().lyrics).toHaveLength(3);
    s().editLyricWord(0, 0, "Right");
    expect(s().lyrics![0].text.startsWith("Right")).toBe(true);
    s().nudgeLyricWord(0, 1, 0.05);
    s().redistributeLyricWords(0);

    // Walk all seven edits back — byte-identical to the parsed original.
    for (let i = 0; i < 7; i++) s().undoLyricsEdit();
    expect(JSON.stringify(s().lyrics)).toBe(before);
    expect(s().lyricsEditUndoDepth).toBe(0);
  });

  it("no-op edits do not spend an undo entry", () => {
    load();
    const s = () => useVizStore.getState();
    s().editLyricLineText(1, "Plain fallback line"); // unchanged text
    s().splitLyricLine(2, 0); // splittable? "Third line here" -> caret 0 still splits
    // (that one DID split; undo it to keep the count honest)
    const depthAfter = s().lyricsEditUndoDepth;
    s().nudgeLyricLine(0, 0); // zero delta
    s().mergeLyricLineWithNext(99); // out of range
    expect(s().lyricsEditUndoDepth).toBe(depthAfter);
  });

  it("loading a new document or clearing resets the editor history", () => {
    load();
    const s = () => useVizStore.getState();
    s().editLyricLineText(1, "edited");
    expect(s().lyricsEditUndoDepth).toBe(1);
    load(); // same file re-imported = a NEW document
    expect(s().lyricsEditUndoDepth).toBe(0);
    expect(s().lyricsEditRedoDepth).toBe(0);
    s().editLyricLineText(1, "edited again");
    s().clearLyrics();
    expect(s().lyrics).toBeNull();
    expect(s().lyricsEditUndoDepth).toBe(0);
  });

  it("applyLyricsConfidence attaches conf without spending an undo entry", () => {
    load();
    const s = () => useVizStore.getState();
    s().applyLyricsConfidence([
      { conf: 0.8, words: [0.9, 0.85, 0.75, 0.7] },
      { conf: null, words: [] },
      { conf: 0.1, words: [] },
    ]);
    expect(s().lyrics![0].conf).toBeCloseTo(0.8);
    expect(s().lyrics![0].words![0].conf).toBeCloseTo(0.9);
    expect(s().lyrics![2].conf).toBeCloseTo(0.1);
    expect(s().lyricsEditUndoDepth).toBe(0);
    // Mismatched length: ignored entirely.
    s().applyLyricsConfidence([{ conf: 1, words: [] }]);
    expect(s().lyrics![0].conf).toBeCloseTo(0.8);
  });
});

/**
 * Whole-lane review, IMPORTANT on top of E2-U2: `MAX_TIME_SEC` alone (the
 * finding's original shape) regressed a legitimate tail edit on any track
 * longer than ~100 minutes — imported lyrics have no clamp of their own,
 * so such a file genuinely reaches this code with a real, longer duration.
 * `setLyricLineTime`/`setLyricWordTime` (the two call sites the finding
 * named) and `nudgeLyricLine`/`nudgeLyricWord` (the same underlying clamp,
 * reachable a different way — extended to close the SAME regression
 * rather than leave half of it standing) now source the ceiling from
 * `getEngine().audioBuffer?.duration`, falling back to MAX_TIME_SEC only
 * when no track is loaded.
 */
describe("tail time ceiling is duration-aware (whole-lane review, IMPORTANT on top of E2-U2)", () => {
  function mockDuration(duration: number | null) {
    vi.mocked(getEngine).mockReturnValue({
      ctx: { decodeAudioData: vi.fn() },
      audioBuffer: duration === null ? null : ({ duration } as { duration: number }),
      currentTime: 0,
      duration: 0,
      playing: false,
      setVolume: vi.fn(),
      onEnded: null,
      dispose: vi.fn(),
    } as unknown as ReturnType<typeof getEngine>);
  }

  it("setLyricLineTime clamps a tail-line paste to the loaded track's own duration on a >100-min track", () => {
    mockDuration(7200); // 2-hour track — well past MAX_TIME_SEC (5999.99s)
    load();
    const s = () => useVizStore.getState();
    const last = s().lyrics!.length - 1;

    s().setLyricLineTime(last, 1e300);

    expect(s().lyrics![last].t).toBe(7200);
  });

  it("setLyricLineTime still falls back to MAX_TIME_SEC when no track is loaded", () => {
    mockDuration(null);
    load();
    const s = () => useVizStore.getState();
    const last = s().lyrics!.length - 1;

    s().setLyricLineTime(last, 1e300);

    expect(s().lyrics![last].t).toBe(MAX_TIME_SEC);
  });

  it("setLyricWordTime clamps a tail-word paste to the track's duration the same way", () => {
    mockDuration(7200);
    load();
    const s = () => useVizStore.getState();
    const lastWord = s().lyrics![0].words!.length - 1; // "mind", the last word of line 0

    s().setLyricWordTime(0, lastWord, 1e300);

    expect(s().lyrics![0].words![lastWord].t).toBe(7200);
  });

  it("nudgeLyricLine (the same clamp, reached a different way) is duration-aware too", () => {
    mockDuration(7200);
    load();
    const s = () => useVizStore.getState();
    const last = s().lyrics!.length - 1;
    // Land the tail line right at the edge of the OLD (wrong) ceiling first,
    // then nudge it forward — a version that forgot the ceiling on the nudge
    // path specifically would snap this back to 5999.99 instead of moving it.
    s().setLyricLineTime(last, 6500);
    expect(s().lyrics![last].t).toBe(6500);

    s().nudgeLyricLine(last, 500);

    expect(s().lyrics![last].t).toBe(7000);
  });

  it("a legit tail edit well within a long track's duration is untouched", () => {
    mockDuration(7200);
    load();
    const s = () => useVizStore.getState();
    const last = s().lyrics!.length - 1;

    s().setLyricLineTime(last, 6800);

    expect(s().lyrics![last].t).toBeCloseTo(6800);
  });
});
