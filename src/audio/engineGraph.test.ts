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

describe("audio graph", () => {
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
});
