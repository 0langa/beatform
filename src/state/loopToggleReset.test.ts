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
});
