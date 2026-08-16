import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricLine, LyricStyle } from "./lyrics";
import { DEFAULT_LYRIC_STYLE } from "./lyrics";
import { lyricPlateKeyAt } from "../render/lyricPlate";

/**
 * The LIVE half of the lyric-plate chokepoint contract (Lyric Stage's text
 * input). The plate only stays deterministic if preview and export reach the
 * same bitmap through the same function with the same (lines, key) tuple:
 * this file pins what the live loop's onFrameTick feeds it, and
 * `src/export/exportCoreDeterminism.test.ts` pins the export walk against the
 * identical tuple. The harness is liveOverlayCompose.test.ts's, because the
 * call site is the same onFrameTick.
 */

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

const captured = vi.hoisted(() => ({
  onFrameTick: null as ((t: number) => void) | null,
  renderer: { setLyricPlate: vi.fn(), setOverlay: vi.fn() },
}));

vi.mock("./services", () => ({
  initServices: vi.fn((_canvas: unknown, callbacks: { onFrameTick: (t: number) => void }) => {
    captured.onFrameTick = callbacks.onFrameTick;
    return vi.fn();
  }),
  getEngine: vi.fn(() => ({
    ctx: { decodeAudioData: vi.fn() },
    currentTime: 0,
    duration: 214.5,
    playing: false,
    setVolume: vi.fn(),
    onEnded: null,
    dispose: vi.fn(),
  })),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn() })),
  peekAnalyzer: vi.fn(() => null),
  getRenderer: vi.fn(() => captured.renderer),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

vi.mock("./platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./platform")>();
  return { ...actual, writeAutosave: vi.fn(async () => {}) };
});

vi.mock("./midiInput", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./midiInput")>();
  return { ...actual, startMidi: vi.fn(async () => ({ stop: vi.fn() })) };
});

// The real key/gating helpers stay REAL — only the rasterizing call is
// intercepted (no canvas here), because the (lines, key) tuple IS the
// contract under test. The overlay compositor is intercepted too so caption
// dynamics cannot crash on the missing canvas.
const composed = () => ({ close: vi.fn() }) as unknown as ImageBitmap;
vi.mock("../render/lyricPlate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../render/lyricPlate")>();
  return { ...actual, composeLyricPlate: vi.fn(async () => composed()) };
});
vi.mock("../render/dynamicOverlay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../render/dynamicOverlay")>();
  return { ...actual, composeOverlayFrame: vi.fn(async () => composed()) };
});

const CANVAS_W = 1280;
const CANVAS_H = 720;

function fakeCanvas(): HTMLCanvasElement {
  return {
    width: CANVAS_W,
    height: CANVAS_H,
    getBoundingClientRect: () => ({ width: CANVAS_W, height: CANVAS_H }),
  } as unknown as HTMLCanvasElement;
}

const LINES: LyricLine[] = [
  { t: 1, end: 4, text: "hold the line", words: [{ t: 1, end: 3, text: "hold" }] },
  { t: 5, end: 9, text: "second line here" },
];
/** Caption OFF: the plate must not care — it serves the preset. */
const STYLE: LyricStyle = { ...DEFAULT_LYRIC_STYLE, enabled: false };

async function armedStore() {
  const { useVizStore } = await import("./store");
  const dispose = useVizStore.getState().initApp(fakeCanvas());
  useVizStore.setState({ lyrics: LINES, lyricStyle: STYLE });
  return { useVizStore, dispose };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("live loop lyric plate compose call", () => {
  beforeEach(async () => {
    const { composeLyricPlate } = await import("../render/lyricPlate");
    vi.mocked(composeLyricPlate).mockClear();
    captured.renderer.setLyricPlate.mockClear();
  });

  it("composes (lines, key at TRACK TIME over the canvas size) — caption off", async () => {
    const { composeLyricPlate } = await import("../render/lyricPlate");
    const { dispose } = await armedStore();
    // Arming wrote `lyrics`, and the identity chokepoint cleared the plate —
    // count only what the tick itself uploads.
    captured.renderer.setLyricPlate.mockClear();

    captured.onFrameTick!(2.37);

    // The exact tuple the export walk must also produce — see the export-side
    // counterpart in src/export/exportCoreDeterminism.test.ts. The key comes
    // from the SHARED key function at the tick's track time, never wall clock.
    expect(composeLyricPlate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(composeLyricPlate).mock.calls[0]).toEqual([
      LINES,
      lyricPlateKeyAt(LINES, 2.37, CANVAS_W, CANVAS_H),
    ]);
    await flush();
    expect(captured.renderer.setLyricPlate).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("re-composes only when the plate key moves", async () => {
    const { composeLyricPlate } = await import("../render/lyricPlate");
    const { dispose } = await armedStore();

    captured.onFrameTick!(1.5);
    vi.mocked(composeLyricPlate).mockClear();

    // A time inside the same fill quantum must not re-rasterize...
    const still = 1.5002;
    expect(lyricPlateKeyAt(LINES, still, CANVAS_W, CANVAS_H)).toEqual(
      lyricPlateKeyAt(LINES, 1.5, CANVAS_W, CANVAS_H),
    );
    captured.onFrameTick!(still);
    expect(composeLyricPlate).not.toHaveBeenCalled();

    // ...and one that crosses a boundary must.
    captured.onFrameTick!(3.4);
    expect(composeLyricPlate).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("clears the plate through the lyrics-identity chokepoint", async () => {
    const { composeLyricPlate } = await import("../render/lyricPlate");
    const { useVizStore, dispose } = await armedStore();
    captured.onFrameTick!(1.5);
    captured.renderer.setLyricPlate.mockClear();

    // Any lyrics write lands here — nine writers, one subscription. The
    // stale plate is cleared immediately, and the next tick recomposes from
    // the new lines (fresh sheet) or leaves it cleared (null).
    useVizStore.setState({ lyrics: null });
    expect(captured.renderer.setLyricPlate).toHaveBeenCalledWith(null);

    vi.mocked(composeLyricPlate).mockClear();
    captured.onFrameTick!(2.0);
    expect(composeLyricPlate).not.toHaveBeenCalled();
    dispose();
  });

  it("a superseded raster is closed, not uploaded (token guard)", async () => {
    const { composeLyricPlate } = await import("../render/lyricPlate");
    const { useVizStore, dispose } = await armedStore();

    // Tick, then invalidate BEFORE the async raster resolves: the late
    // bitmap must be closed instead of landing on the renderer over the
    // newer state.
    const late = { close: vi.fn() } as unknown as ImageBitmap;
    vi.mocked(composeLyricPlate).mockImplementationOnce(async () => late);
    captured.onFrameTick!(1.5);
    useVizStore.setState({ lyrics: null }); // bumps the token, clears the plate
    captured.renderer.setLyricPlate.mockClear();
    await flush();
    expect((late as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalled();
    expect(captured.renderer.setLyricPlate).not.toHaveBeenCalled();
    dispose();
  });
});
