import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LYRIC_STYLE, type LyricLine, type LyricStyle } from "./lyrics";
import { DEFAULT_AUDIOGRAM } from "./audiogram";
import { overlayFrameKeyAt } from "../render/dynamicOverlay";

/**
 * F4 — the LIVE half of the overlay-compose chokepoint contract.
 *
 * The determinism law only holds if preview and export reach the same bitmap
 * through the same function with the same arguments. `composeOverlayFrame` is
 * that function; this file pins what the live loop feeds it, and
 * `src/export/exportCoreDeterminism.test.ts` pins the export walk against the
 * IDENTICAL expected tuple — (static base, dynamics, TRACK TIME, canvas w, h).
 * If either caller starts passing wall clock, its own quantization, or a
 * differently-shaped dynamics object, one of the two files goes red.
 *
 * services.ts is mocked (WebGPU / Web Audio do not exist here), which also
 * gives the test the callback bundle store.ts hands it — `onFrameTick` is the
 * live compose call site, invoked directly with a chosen track time.
 */

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

const captured = vi.hoisted(() => ({ onFrameTick: null as ((t: number) => void) | null }));

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
  getRenderer: vi.fn(() => null),
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
// intercepted, because there is no canvas here and the arguments are the
// contract under test.
const composed = () => ({ close: vi.fn() }) as unknown as ImageBitmap;
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
const STYLE: LyricStyle = { ...DEFAULT_LYRIC_STYLE, anim: "wipe", fadeSec: 0.2 };
const AUDIOGRAM = { ...DEFAULT_AUDIOGRAM, progressBar: true, timeReadout: true };
const WAVEFORM = new Float32Array([0.1, 0.4, 0.9, 0.3]);

async function armedStore() {
  const { useVizStore } = await import("./store");
  const dispose = useVizStore.getState().initApp(fakeCanvas());
  useVizStore.setState({
    lyrics: LINES,
    lyricStyle: STYLE,
    audiogram: AUDIOGRAM,
    waveformOverview: WAVEFORM,
  });
  return { useVizStore, dispose };
}

describe("live loop overlay compose call (F4)", () => {
  beforeEach(async () => {
    const { composeOverlayFrame } = await import("../render/dynamicOverlay");
    vi.mocked(composeOverlayFrame).mockClear();
  });

  it("composes from TRACK TIME, the canvas size and the shared dynamics shape", async () => {
    const { composeOverlayFrame } = await import("../render/dynamicOverlay");
    const { dispose } = await armedStore();

    captured.onFrameTick!(2.37);

    // The exact tuple the export walk must also produce — see the export-side
    // counterpart in src/export/exportCoreDeterminism.test.ts.
    expect(composeOverlayFrame).toHaveBeenCalledTimes(1);
    expect(vi.mocked(composeOverlayFrame).mock.calls[0]).toEqual([
      null, // static base: nothing rasterized yet in this harness
      {
        lyrics: { lines: LINES, style: STYLE },
        audiogram: { settings: AUDIOGRAM, duration: 214.5, waveform: WAVEFORM },
      },
      2.37, // the track time handed to the tick — never a wall clock
      CANVAS_W,
      CANVAS_H,
    ]);
    dispose();
  });

  it("re-composes only when the shared frame key moves", async () => {
    const { composeOverlayFrame } = await import("../render/dynamicOverlay");
    const { dispose } = await armedStore();
    const dyn = {
      lyrics: { lines: LINES, style: STYLE },
      audiogram: { settings: AUDIOGRAM, duration: 214.5, waveform: WAVEFORM },
    };

    // The last-key memo lives for the session, so establish this test's own
    // baseline first rather than depending on what ran before it.
    captured.onFrameTick!(1.5);
    vi.mocked(composeOverlayFrame).mockClear();

    // A time the key does NOT distinguish must not re-rasterize...
    const still = 1.5002;
    expect(overlayFrameKeyAt(dyn, still, CANVAS_W)).toEqual(overlayFrameKeyAt(dyn, 1.5, CANVAS_W));
    captured.onFrameTick!(still);
    expect(composeOverlayFrame).not.toHaveBeenCalled();

    // ...and one it does must.
    expect(overlayFrameKeyAt(dyn, 3.4, CANVAS_W)).not.toEqual(
      overlayFrameKeyAt(dyn, 1.5, CANVAS_W),
    );
    captured.onFrameTick!(3.4);
    expect(composeOverlayFrame).toHaveBeenCalledTimes(1);
    expect(vi.mocked(composeOverlayFrame).mock.calls[0][2]).toBe(3.4);
    dispose();
  });

  it("does not compose at all when no dynamic layer is on", async () => {
    const { composeOverlayFrame } = await import("../render/dynamicOverlay");
    const { useVizStore, dispose } = await armedStore();
    useVizStore.setState({ lyrics: null, audiogram: { ...DEFAULT_AUDIOGRAM } });

    captured.onFrameTick!(2.37);

    expect(composeOverlayFrame).not.toHaveBeenCalled();
    dispose();
  });
});
