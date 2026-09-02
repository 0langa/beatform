import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Type-only: erased at compile time, so these never hoist a module body above
// the global stubs below (the reason the value imports are dynamic).
import type { BeatGrid } from "../audio/analysis/beatGrid";
import type { AudioEngine } from "../audio/engine";
import type { PlaybackState } from "../audio/types";

/**
 * Live-capture async-setup window (BACKLOG hardening row; store.ts
 * `toggleLiveInput`, engine.ts `startLiveInput`).
 *
 * `toggleLiveInput` awaits `engine.startLiveInput()` — the worklet-module
 * load — before anything live exists. The engine has ALREADY stopped the
 * track's source by then (it freezes the playhead the way pause() does and
 * tears the source down before its first await), so for the whole window the
 * speakers are silent and `engine.playing` reads false (no `_playing`, no
 * `liveNode`) — which is what starves the analyzer's texture-feedback advance
 * license (`lastUpdateTicked = analysisTick && engine.playing`). The store
 * must agree with the engine for that window: `liveInputActive` still false,
 * the transport mirror reading paused, the previous track's grid untouched, no
 * source reset, no Rust capture spawned. Documented as correct behavior; never
 * pinned until now.
 *
 * The REAL AudioEngine runs here against the fake Web Audio graph the engine
 * suites use (engineLoadRace.test.ts), with the worklet load held open by the
 * test. services.ts is mocked away as in every store test; its one
 * live-relevant line — `eng.onStateChange = (s) => hooks.onPlayback(s)`
 * (services.ts) feeding `set({ playback })` (store.ts hooks) — is replicated
 * verbatim, so the transport MIRROR the transport bar reads is under test,
 * not only the engine getter.
 */

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

interface FakeNode {
  kind: string;
  outputs: FakeNode[];
  connect(dst: FakeNode, ...rest: unknown[]): FakeNode;
  disconnect(): void;
}

function node(kind: string): FakeNode {
  return {
    kind,
    outputs: [],
    connect(dst: FakeNode) {
      this.outputs.push(dst);
      return dst;
    },
    disconnect() {
      this.outputs.length = 0;
    },
  };
}

/** One gate per `audioWorklet.addModule` call — THE await under test. */
let workletLoads: Array<{ land: () => void; fail: (e: Error) => void }> = [];

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48_000;
  destination = node("destination");
  state = "running";
  audioWorklet = {
    addModule: () =>
      new Promise<void>((resolve, reject) => {
        workletLoads.push({ land: resolve, fail: reject });
      }),
  };
  createGain() {
    return { ...node("gain"), gain: { value: 1, setValueAtTime() {}, setTargetAtTime() {} } };
  }
  createAnalyser() {
    return {
      ...node("analyser"),
      fftSize: 2048,
      frequencyBinCount: 1024,
      getFloatTimeDomainData() {},
      getByteFrequencyData() {},
    };
  }
  createChannelSplitter() {
    return node("splitter");
  }
  createBufferSource() {
    return {
      ...node("bufferSource"),
      buffer: null,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      onended: null,
      start() {},
      stop() {},
    };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

/** What `startLiveInput` builds once the module has loaded. */
class FakeAudioWorkletNode {
  port = { postMessage: vi.fn(), close: vi.fn() };
  outputs: FakeNode[] = [];
  connect(dst: FakeNode) {
    this.outputs.push(dst);
    return dst;
  }
  disconnect() {
    this.outputs.length = 0;
  }
}

function fakeAudioBuffer(): AudioBuffer {
  return {
    duration: 30,
    length: 30 * 48_000,
    numberOfChannels: 2,
    sampleRate: 48_000,
    getChannelData: () => new Float32Array(4096),
  } as unknown as AudioBuffer;
}

const analyzer = { setSync: vi.fn(), setBeatGrid: vi.fn(), setSections: vi.fn(), reset: vi.fn() };
/** The REAL engine, rebuilt per test (see beforeEach). Read lazily by the
 * services mock, exactly as production's `getEngine()` singleton is. */
let engine: AudioEngine;

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
  return {
    ...actual,
    writeAutosave: vi.fn(async () => {}),
    // The live path is desktop-only; each test opts in (beforeEach) so the
    // store's own module init still runs the browser lane every other store
    // test runs.
    isTauri: vi.fn(() => false),
    // The Rust WASAPI spawn — the SECOND await of the toggle, after the one
    // under test. Same rate as the fake context, so the mismatch branch stays
    // out of the way.
    startLoopback: vi.fn(async () => ({
      sampleRate: 48_000,
      channels: 2,
      device: "Speakers (Realtek)",
    })),
    stopLoopback: vi.fn(async () => {}),
  };
});

vi.stubGlobal("AudioContext", FakeAudioContext);
vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);

const { useVizStore } = await import("./store");
const { isTauri, startLoopback, stopLoopback } = await import("./platform");
const { AudioEngine: RealAudioEngine } = await import("../audio/engine");

const s = () => useVizStore.getState();

const GRID: BeatGrid = {
  bpm: 120,
  beatTimes: Float32Array.from([0, 0.5, 1, 1.5]),
  hopSec: 0.0116,
};

/** Drain the microtask queue far past any chain the toggle builds before its
 * first real await. */
async function flush(turns = 20) {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

beforeEach(async () => {
  workletLoads = [];
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(startLoopback).mockClear();
  vi.mocked(stopLoopback).mockClear();
  analyzer.reset.mockClear();
  analyzer.setBeatGrid.mockClear();
  analyzer.setSections.mockClear();

  engine = new RealAudioEngine();
  // services.ts, verbatim: the engine's state reports are the ONLY way the
  // store's `playback` — what the transport bar renders — ever changes.
  engine.onStateChange = (st: PlaybackState) => useVizStore.setState({ playback: st });
  // A track is loaded, analysed and PLAYING when the user reaches for Live.
  engine.loadBuffer(fakeAudioBuffer(), "track.mp3");
  await engine.play();
  useVizStore.setState({
    liveInputActive: false,
    beatGrid: GRID,
    sections: [0, 15],
    trackKey: null,
    analyzing: false,
    error: null,
    notice: null,
  });
  expect(engine.playing).toBe(true);
  expect(s().playback.playing).toBe(true);
});

afterEach(async () => {
  // Leave no toggle in flight: the store's `liveToggling` claim is module
  // state, and a toggle a failed assertion abandoned mid-window would make
  // every later toggle in this file a silent no-op.
  for (const w of workletLoads) w.land();
  await flush();
});

describe("toggleLiveInput's worklet-load window (live-capture async setup)", () => {
  it("during the load: the track is stopped, playing reads false everywhere, nothing live exists yet — then the load lands and live flips on", async () => {
    const toggle = s().toggleLiveInput();
    await flush();
    // The engine reached its worklet await and is parked on it.
    expect(workletLoads).toHaveLength(1);

    // The source is gone and the engine reports paused: no `_playing`, no
    // `liveNode`. This is the analyzer's whole advance license, so no
    // feedback tick can be reported for the duration.
    expect(engine.playing).toBe(false);
    expect(engine.liveInput).toBe(false);
    expect(engine.state.playing).toBe(false);
    expect(engine.state.trackName).toBe("track.mp3"); // not renamed yet
    // The store agrees with the engine: the transport mirror reads paused
    // over a silent source, and live has not begun.
    expect(s().playback.playing).toBe(false);
    expect(s().liveInputActive).toBe(false);
    // Nothing live has happened: no source reset, the track's grid still
    // stands (and is still what the analyzer holds), no capture spawned.
    expect(analyzer.reset).not.toHaveBeenCalled();
    expect(analyzer.setBeatGrid).not.toHaveBeenCalled();
    expect(s().beatGrid).toBe(GRID);
    expect(s().analyzing).toBe(false);
    expect(startLoopback).not.toHaveBeenCalled();

    workletLoads[0].land();
    await toggle;

    // Live is on, on both ends. Live counts as playing for the engine — the
    // advance license is back — while `state.playing` (the mirror) stays
    // false: the store reads `liveInputActive` for live, never `playback`.
    expect(engine.liveInput).toBe(true);
    expect(engine.playing).toBe(true);
    expect(engine.state.trackName).toBe("System audio");
    expect(s().liveInputActive).toBe(true);
    expect(s().playback.playing).toBe(false);
    expect(s().playback.trackName).toBe("System audio");
    expect(startLoopback).toHaveBeenCalledTimes(1);
    expect(analyzer.reset).toHaveBeenCalledWith("source");
    expect(analyzer.setBeatGrid).toHaveBeenCalledWith(null);
    expect(analyzer.setSections).toHaveBeenCalledWith(null);
    expect(s().beatGrid).toBeNull();
    expect(s().sections).toEqual([]);
    expect(s().analyzing).toBe(false);
    expect(s().error).toBeNull();
    expect(s().notice).toBe("Listening to Speakers (Realtek)");
  });

  it("a second toggle inside the window is a no-op — one worklet, one capture", async () => {
    const first = s().toggleLiveInput();
    await flush();
    // `liveToggling` (store.ts) is claimed before the first await, so this
    // returns at once instead of running a second start path whose failure
    // cleanup would tear down the first click's worklet.
    await s().toggleLiveInput();
    expect(workletLoads).toHaveLength(1);
    expect(s().liveInputActive).toBe(false);

    workletLoads[0].land();
    await first;
    expect(startLoopback).toHaveBeenCalledTimes(1);
    expect(s().liveInputActive).toBe(true);
  });

  it("a failed worklet load leaves every consumer consistent: paused, not live, error shown, track resumable", async () => {
    const toggle = s().toggleLiveInput();
    await flush();
    // The historical failure (blob worklets under the app CSP), reproduced.
    workletLoads[0].fail(new Error("Unable to load a worklet's module"));
    await toggle;

    expect(s().error).toContain("System-audio capture failed");
    expect(s().error).toContain("Unable to load a worklet's module");
    expect(s().liveInputActive).toBe(false);
    expect(startLoopback).not.toHaveBeenCalled();
    expect(stopLoopback).toHaveBeenCalled(); // the Rust side is cleared regardless
    // The engine stopped the track before the load; the transport mirror must
    // not keep saying "playing" over a source that is silent.
    expect(engine.playing).toBe(false);
    expect(engine.state.trackName).toBe("track.mp3");
    expect(s().playback.playing).toBe(false);
    // The track's analysis survives a failed toggle — only a SUCCESSFUL live
    // start supersedes the grid.
    expect(s().beatGrid).toBe(GRID);
    // And the track picks up from the frozen playhead, mirror in step.
    await engine.play();
    expect(engine.playing).toBe(true);
    expect(s().playback.playing).toBe(true);
  });
});
