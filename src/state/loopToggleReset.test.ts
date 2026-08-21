import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R2-32c — toggleLoop's discontinuity reset. Enabling the loop while the
 * playhead sits OUTSIDE the A-B region teleports playback to the region
 * start (`AudioEngine.set loop` → positionInsideRegion). Its siblings —
 * setLoopStart/setLoopEnd/clearLoopRegion — have always fired the guarded
 * `reset("seek")` when their reconfiguration moved the playhead; toggleLoop
 * was the one region action that didn't, so a FORWARD teleport (which the
 * frame loop's backward-jump heuristic can never catch) diffed the new
 * position's spectrum against the old one and fired a phantom beat.
 *
 * Same mock surface as store.test.ts: services is faked because Web Audio
 * doesn't exist here — the engine stand-in reproduces exactly the setter
 * semantics engine.ts documents (teleport only when outside the region),
 * which is orthogonal to the wiring under test.
 */

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

const engineState = {
  loop: false,
  currentTime: 0,
  loopStart: null as number | null,
  loopEnd: null as number | null,
};

const engine = {
  ctx: { decodeAudioData: vi.fn() },
  get currentTime() {
    return engineState.currentTime;
  },
  get loop() {
    return engineState.loop;
  },
  // The real setter's observable contract (engine.ts): enabling with a
  // region normalizes the playhead into it — outside teleports to start,
  // inside stays put; disabling never moves it.
  set loop(v: boolean) {
    if (v === engineState.loop) return;
    engineState.loop = v;
    const { loopStart, loopEnd } = engineState;
    const region =
      loopStart !== null && loopEnd !== null && loopEnd > loopStart
        ? { start: loopStart, end: loopEnd }
        : null;
    if (v && region) {
      const pos = engineState.currentTime;
      if (!(pos >= region.start && pos < region.end)) engineState.currentTime = region.start;
    }
  },
  duration: 30,
  playing: false,
  setVolume: vi.fn(),
  onEnded: null,
  dispose: vi.fn(),
};

const analyzer = { setSync: vi.fn(), reset: vi.fn() };

vi.mock("./services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => engine),
  getAnalyzer: vi.fn(() => analyzer),
  peekAnalyzer: vi.fn(() => null),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

vi.mock("./platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./platform")>();
  return { ...actual, writeAutosave: vi.fn(async () => {}) };
});

const { useVizStore } = await import("./store");
const s = () => useVizStore.getState();

beforeEach(() => {
  engineState.loop = false;
  engineState.currentTime = 0;
  engineState.loopStart = null;
  engineState.loopEnd = null;
  analyzer.reset.mockClear();
});

describe("toggleLoop fires the discontinuity reset only when the playhead moved (R2-32c)", () => {
  it('outside-region enable teleports forward — reset("seek") fires like the siblings\'', () => {
    engineState.loopStart = 10;
    engineState.loopEnd = 14;
    engineState.currentTime = 3; // outside, BEFORE the region: forward teleport
    s().toggleLoop();
    expect(engineState.currentTime).toBe(10); // fixture sanity: it moved
    expect(analyzer.reset).toHaveBeenCalledWith("seek");
  });

  it("inside-region enable does not move the playhead — no reset, no scrub flash", () => {
    engineState.loopStart = 10;
    engineState.loopEnd = 14;
    engineState.currentTime = 12;
    s().toggleLoop();
    expect(engineState.currentTime).toBe(12);
    expect(analyzer.reset).not.toHaveBeenCalled();
  });

  it("whole-track toggles (no region) never reset", () => {
    engineState.currentTime = 7;
    s().toggleLoop(); // on
    s().toggleLoop(); // off
    expect(analyzer.reset).not.toHaveBeenCalled();
  });

  /**
   * The teleport is a seek in every sense, so it also gets R2-31c's quantize
   * bookkeeping: enabling the loop from before the region must not let the
   * first tick after the jump read every leapt-over beat boundary as
   * "crossed" and fire a queued switch off the teleport. (Cross-lane hole
   * surfaced by the v2.108 review: R2-32c added the reset, R2-31c added the
   * bookkeeping to the seek actions, and only their combination covers this
   * path.)
   */
  it("a queued quantized switch does not fire off the teleport — only off the next natural crossing", async () => {
    const { initServices } = await import("./services");
    const { orderedPresets } = await import("./presetOrder");
    const strip = orderedPresets(s().presetOrder, []);
    const dispose = s().initApp({
      getContext: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as HTMLCanvasElement);
    try {
      const calls = vi.mocked(initServices).mock.calls;
      const tick = calls[calls.length - 1][1].onFrameTick!;
      useVizStore.setState({
        presetId: strip[0].id,
        customDefs: [],
        switchQuantize: "beat",
        playback: { ...s().playback, playing: true },
        beatGrid: {
          bpm: 120,
          beatTimes: Float32Array.from([0, 0.5, 1, 1.5, 2, 9.5, 10, 10.5, 11]),
          hopSec: 0.0116,
        },
        pendingPresetId: null,
      });
      engineState.loopStart = 10;
      engineState.loopEnd = 12;
      engineState.currentTime = 0.1;
      tick(0.1); // baseline the bookkeeping
      s().queuePreset(strip[1].id);
      expect(s().pendingPresetId).toBe(strip[1].id);

      s().toggleLoop(); // teleports 0.1 → 10, leaping many boundaries
      expect(engineState.currentTime).toBe(10);
      tick(10.2); // first tick after the jump — no boundary in (10, 10.2]
      expect(s().presetId).toBe(strip[0].id); // no fire off the teleport
      expect(s().pendingPresetId).toBe(strip[1].id); // still queued

      tick(10.6); // the track naturally crosses 10.5
      expect(s().presetId).toBe(strip[1].id);
    } finally {
      dispose();
    }
  });
});
