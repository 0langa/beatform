import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricLine } from "./lyrics";
import { vocalSpansFromLyrics } from "../audio/vocalPresence";

/**
 * The lyric-derived vocal-presence feed is a store SUBSCRIPTION, not a call
 * at each site that writes `lyrics` — there are nine of those (import, clear,
 * two track-load resets, the library loader, generation, and the editor's
 * edit/undo/redo ops), and a forgotten call fails silently: the modulation
 * source just reads 0 forever. These tests pin the chokepoint by driving the
 * store the way those paths do and asserting the analyzer was fed.
 */

const setVocalSpans = vi.fn();

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

vi.mock("./services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => ({
    ctx: { decodeAudioData: vi.fn() },
    currentTime: 0,
    duration: 0,
    playing: false,
    setVolume: vi.fn(),
    onEnded: null,
    dispose: vi.fn(),
  })),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn(), setBeatGrid: vi.fn(), setSections: vi.fn() })),
  peekAnalyzer: vi.fn(() => ({ setVocalSpans })),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

vi.mock("./platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./platform")>();
  return { ...actual, writeAutosave: vi.fn(async () => {}) };
});

const { useVizStore } = await import("./store");

const LINES: LyricLine[] = [
  { t: 1, end: 3, text: "one" },
  { t: 5, end: 7, text: "two" },
] as LyricLine[];

describe("vocal-presence feed chokepoint", () => {
  beforeEach(() => {
    setVocalSpans.mockClear();
    useVizStore.setState({ lyrics: null });
    setVocalSpans.mockClear();
  });

  it("feeds spans whenever lyrics arrive, whatever wrote them", () => {
    useVizStore.setState({ lyrics: LINES });
    expect(setVocalSpans).toHaveBeenCalledTimes(1);
    expect(setVocalSpans).toHaveBeenLastCalledWith(vocalSpansFromLyrics(LINES));
  });

  it("feeds null when lyrics are cleared", () => {
    useVizStore.setState({ lyrics: LINES });
    setVocalSpans.mockClear();
    useVizStore.setState({ lyrics: null });
    expect(setVocalSpans).toHaveBeenLastCalledWith(null);
  });

  it("recomputes after an EDIT, not just on load", () => {
    // The editor rebuilds the array, so reference identity is the right
    // change signal — an in-place mutation would be invisible here, which is
    // exactly why the editor is snapshot-based.
    useVizStore.setState({ lyrics: LINES });
    setVocalSpans.mockClear();
    const edited = [{ ...LINES[0], t: 2 }, LINES[1]] as LyricLine[];
    useVizStore.setState({ lyrics: edited });
    expect(setVocalSpans).toHaveBeenCalledTimes(1);
    expect(setVocalSpans).toHaveBeenLastCalledWith(vocalSpansFromLyrics(edited));
  });

  it("stays quiet when unrelated state changes", () => {
    useVizStore.setState({ lyrics: LINES });
    setVocalSpans.mockClear();
    useVizStore.setState({ error: "something else" });
    useVizStore.setState({ analyzing: true });
    expect(setVocalSpans).not.toHaveBeenCalled();
  });
});
