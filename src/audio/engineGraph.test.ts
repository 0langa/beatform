import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The audio graph must route every playing source THROUGH the analysis tap.
 *
 * This exists because it shipped broken. `startSourceAt` connected the buffer
 * source straight to `gain`, but the analysers hang off `tap`, and the graph
 * runs tap -> gain -> destination. So audio reached the speakers while every
 * analyser received digital silence: the spectrum read -70 LUFS, every
 * audio-driven visual collapsed to nothing, and the canvas went black except
 * for the static background wash.
 *
 * It survived a full verification pass because exports analyse raw PCM
 * offline and never touch this graph — the export path, the golden frame
 * hashes and the preset thumbnails were all still perfect. Only the LIVE
 * preview was dead. A graph-shape assertion is the cheapest thing that would
 * have caught it, so here it is.
 */

interface FakeNode {
  kind: string;
  outputs: FakeNode[];
  connect(dst: FakeNode): FakeNode;
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

/** Every node reachable downstream of `from`. */
function reaches(from: FakeNode, target: FakeNode, seen = new Set<FakeNode>()): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return from.outputs.some((o) => reaches(o, target, seen));
}

const created: FakeNode[] = [];
function track<T extends FakeNode>(n: T): T {
  created.push(n);
  return n;
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  destination = track(node("destination"));
  state = "running";
  audioWorklet = { addModule: () => Promise.resolve() };
  createGain() {
    return track({ ...node("gain"), gain: { value: 1, setValueAtTime() {} } }) as FakeNode;
  }
  createAnalyser() {
    return track({
      ...node("analyser"),
      fftSize: 2048,
      frequencyBinCount: 1024,
      getFloatTimeDomainData() {},
      getByteFrequencyData() {},
    }) as FakeNode;
  }
  createChannelSplitter() {
    return track(node("splitter"));
  }
  createBufferSource() {
    return track({
      ...node("bufferSource"),
      buffer: null,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      onended: null,
      start() {},
      stop() {},
    }) as FakeNode;
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

function findByKind(kind: string): FakeNode[] {
  return created.filter((n) => n.kind === kind);
}

/**
 * TIMEOUTS: an explicit 30 s budget rather than vitest's 5 s default. Every
 * case here calls `vi.resetModules()` and re-imports `./engine`, so its cost is
 * a module graph rebuilt per test — the one cost in this suite that scales with
 * how many workers are competing for the transform pipeline, and it showed:
 * 0.3 s in a normal full-suite run against 1.3 s with the pool oversubscribed
 * 2:1. Nothing here awaits a real clock (`FakeAudioContext` resolves
 * immediately), so the default timeout was the only load-sensitive failure
 * mode. Same remedy as `dspCharacterization.test.ts`; see GATES.md §1.
 */
describe("audio graph", { timeout: 30_000 }, () => {
  afterEach(() => {
    created.length = 0;
    vi.unstubAllGlobals();
  });

  it("routes a playing source through the tap so the analysers actually hear it", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.resetModules();
    const { AudioEngine } = await import("./engine");

    const engine = new AudioEngine();
    expect(engine.displayAnalyser).not.toBe(engine.analyser);
    // A 1-second silent buffer is enough — we assert graph SHAPE, not signal.
    const buffer = {
      duration: 1,
      length: 48000,
      numberOfChannels: 2,
      sampleRate: 48000,
      getChannelData: () => new Float32Array(48000),
    } as unknown as AudioBuffer;
    engine.loadBuffer(buffer, "test.wav");
    await engine.play();

    const sources = findByKind("bufferSource");
    expect(sources.length).toBeGreaterThan(0);
    const analysers = findByKind("analyser");
    expect(analysers.length).toBeGreaterThan(0);

    for (const src of sources) {
      // The whole point: the source must reach EVERY analyser, not just the
      // speakers. Connecting to `gain` satisfies the speakers alone.
      for (const a of analysers) {
        expect(
          reaches(src, a),
          "a playing source does not reach an analyser — the live preview will " +
            "render silence while audio still plays",
        ).toBe(true);
      }
      // ...and it must still reach the speakers.
      const dest = findByKind("destination")[0];
      expect(reaches(src, dest)).toBe(true);
    }
  });

  it("applies ordered A-B endpoints and reports exact short-region wraps", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.resetModules();
    const { AudioEngine } = await import("./engine");

    const engine = new AudioEngine();
    const buffer = {
      duration: 10,
      length: 480000,
      numberOfChannels: 2,
      sampleRate: 48000,
      getChannelData: () => new Float32Array(480000),
    } as unknown as AudioBuffer;
    engine.loadBuffer(buffer, "loop.wav");

    // Either marker may be set first; A is always the earlier boundary.
    engine.setLoopStart(2.2);
    engine.setLoopEnd(2);
    expect(engine.loopRegion).toEqual({ start: 2, end: 2.2 });
    engine.loop = true;
    await engine.play();

    const sources = findByKind("bufferSource");
    const source = sources[sources.length - 1] as FakeNode & {
      loop: boolean;
      loopStart: number;
      loopEnd: number;
    };
    expect(source.loop).toBe(true);
    expect(source.loopStart).toBe(2);
    expect(source.loopEnd).toBe(2.2);

    (engine.ctx as unknown as { currentTime: number }).currentTime = 0.21;
    expect(engine.currentTime).toBeCloseTo(2.01, 6);
    expect(engine.loopEpoch).toBe(1);

    (engine.ctx as unknown as { currentTime: number }).currentTime = 0.61;
    expect(engine.currentTime).toBeCloseTo(2.01, 6);
    expect(engine.loopEpoch).toBe(3);
  });

  it("clears A-B markers per track and keeps whole-track loop available", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.resetModules();
    const { AudioEngine } = await import("./engine");

    const buffer = {
      duration: 10,
      length: 480000,
      numberOfChannels: 2,
      sampleRate: 48000,
      getChannelData: () => new Float32Array(480000),
    } as unknown as AudioBuffer;
    const engine = new AudioEngine();
    engine.loadBuffer(buffer, "first.wav");
    engine.setLoopStart(2);
    engine.setLoopEnd(4);
    engine.loop = true;
    engine.clearLoopRegion();
    expect(engine.state).toMatchObject({ loop: true, loopStart: null, loopEnd: null });

    await engine.play();
    const sources = findByKind("bufferSource");
    const source = sources[sources.length - 1] as FakeNode & {
      loop: boolean;
      loopStart: number;
      loopEnd: number;
    };
    expect(source).toMatchObject({ loop: true, loopStart: 0, loopEnd: 0 });

    engine.setLoopStart(1);
    engine.setLoopEnd(3);
    engine.loadBuffer(buffer, "second.wav");
    expect(engine.state).toMatchObject({
      trackName: "second.wav",
      loop: true,
      loopStart: null,
      loopEnd: null,
    });
  });

  it("re-anchors the playhead when looping is disabled after several laps", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.resetModules();
    const { AudioEngine } = await import("./engine");

    const buffer = {
      duration: 10,
      length: 480000,
      numberOfChannels: 2,
      sampleRate: 48000,
      getChannelData: () => new Float32Array(480000),
    } as unknown as AudioBuffer;
    const engine = new AudioEngine();
    engine.loadBuffer(buffer, "clock.wav");
    engine.loop = true;
    await engine.play();

    (engine.ctx as unknown as { currentTime: number }).currentTime = 12;
    expect(engine.currentTime).toBe(2);
    expect(engine.loopEpoch).toBe(1);

    engine.loop = false;
    expect(engine.currentTime).toBe(2);
    (engine.ctx as unknown as { currentTime: number }).currentTime = 13;
    expect(engine.currentTime).toBe(3);
  });
});
