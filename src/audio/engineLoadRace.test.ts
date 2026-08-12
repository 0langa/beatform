import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * E3g — the engine ordered overlapping loads by READ COMPLETION while the
 * store orders them by CALL TIME, and the two can disagree.
 *
 * `loadFile` awaited `file.arrayBuffer()` and only then let `loadArrayBuffer`
 * claim `++loadGen`. So a large file dropped FIRST could finish its read LAST,
 * claim the HIGHER engine generation, and commit AFTER a small track requested
 * later — clobbering the newer track's audio. The store's `trackLoadGen` is
 * claimed synchronously at entry, so the store-side continuation of the stale
 * load correctly bails at its `gen !== shared.trackLoadGen` guard — which is
 * exactly the problem: that bail happens BEFORE `invalidateAnalysis()`, so
 * nothing voids the newer track's grid, and the preview pulses track B's grid
 * over track A's audio PERMANENTLY. (The export half was already neutralized
 * by E3d's audio-identity re-check; this is the preview half.)
 *
 * These tests drive the REAL AudioEngine with reads whose completion order the
 * test owns, and pin the contract that repairs the disagreement: engine
 * generations are claimed at CALL time, so the last-CALLED load wins no matter
 * how reads and decodes interleave.
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

/** A decode gate per decodeAudioData CALL, in call order — like the tag-scan
 * gates in trackLoadInvalidation.test.ts, one deferred per call, never shared. */
const decodes: Array<{ promise: Promise<AudioBuffer>; land: (b: AudioBuffer) => void }> = [];

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  destination = node("destination");
  state = "running";
  audioWorklet = { addModule: () => Promise.resolve() };
  createGain() {
    return { ...node("gain"), gain: { value: 1, setValueAtTime() {} } };
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
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
    let land!: (b: AudioBuffer) => void;
    const promise = new Promise<AudioBuffer>((resolve) => {
      land = resolve;
    });
    decodes.push({ promise, land });
    void data;
    return promise;
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

function fakeAudioBuffer(name: string): AudioBuffer {
  return {
    duration: 1,
    length: 48000,
    numberOfChannels: 2,
    sampleRate: 48000,
    getChannelData: () => new Float32Array(48000),
    __tag: name,
  } as unknown as AudioBuffer;
}

/** A File whose read the test owns: `arrayBuffer()` resolves only when the
 * test lands it — the exact await `loadFile` holds open on a large file. */
function fileWithGatedRead(name: string) {
  let land!: () => void;
  const gate = new Promise<ArrayBuffer>((resolve) => {
    land = () => resolve(new ArrayBuffer(8));
  });
  const file = new File([], name);
  Object.defineProperty(file, "arrayBuffer", { value: () => gate });
  return { file, land };
}

/** Drain the microtask queue far past any chain a load path builds. */
async function flush(turns = 20) {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

async function freshEngine() {
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.resetModules();
  const { AudioEngine } = await import("./engine");
  return new AudioEngine();
}

/** Same remedy and reasoning as the other src/audio suites — see GATES.md §1.
 * Every case rebuilds the module graph via `vi.resetModules()`, the one cost
 * here that scales with pool contention. */
describe(
  "overlapping loads commit in CALL order, not read-completion order (E3g)",
  { timeout: 30_000 },
  () => {
    afterEach(() => {
      decodes.length = 0;
      vi.unstubAllGlobals();
    });

    it("a slow first read cannot clobber the load requested after it", async () => {
      const engine = await freshEngine();
      const a = fileWithGatedRead("a-large.mp3");
      const b = fileWithGatedRead("b-small.mp3");

      // A is CALLED first and parks on its read; B is called second.
      const loadA = engine.loadFile(a.file);
      const loadB = engine.loadFile(b.file);

      // B's read and decode land while A is still reading: B commits fully.
      b.land();
      await flush();
      decodes[0].land(fakeAudioBuffer("B"));
      await loadB;
      expect(engine.state.trackName).toBe("b-small.mp3");
      const committed = engine.audioBuffer;
      expect(committed).not.toBeNull();

      // Now A's read finally lands, and its decode resolves after B's commit —
      // the read-completion order says A is "newest", the call order says B is.
      a.land();
      await flush();
      decodes[1].land(fakeAudioBuffer("A"));
      await loadA;
      await flush();

      // The call order must win: B's audio stays. Before the fix, A claimed the
      // higher generation at decode entry and clobbered B here — trackName came
      // back "a-large.mp3" and the buffer identity changed.
      expect(engine.state.trackName).toBe("b-small.mp3");
      expect(engine.audioBuffer).toBe(committed);
    });

    it("a demo installed while a dropped file is still reading keeps the demo", async () => {
      const engine = await freshEngine();
      const a = fileWithGatedRead("a-large.mp3");

      const loadA = engine.loadFile(a.file);
      // The user gives up on the big drop and clicks a demo: `loadBuffer`
      // supersedes synchronously, exactly like a store-side load would.
      const demo = fakeAudioBuffer("Demo");
      engine.loadBuffer(demo, "Demo");
      expect(engine.audioBuffer).toBe(demo);

      // The abandoned drop's read lands afterwards.
      a.land();
      await flush();
      decodes[0]?.land(fakeAudioBuffer("A"));
      await loadA;
      await flush();

      expect(engine.state.trackName).toBe("Demo");
      expect(engine.audioBuffer).toBe(demo);
    });

    it("still lets the later-called load win a pure DECODE race (the pre-existing guard)", async () => {
      // Reads land instantly in call order here; only the decodes overlap. This
      // was already correct before E3g's fix and must stay correct after it.
      const engine = await freshEngine();
      const a = fileWithGatedRead("first.mp3");
      const b = fileWithGatedRead("second.mp3");

      const loadA = engine.loadFile(a.file);
      a.land();
      await flush();
      const loadB = engine.loadFile(b.file);
      b.land();
      await flush();
      expect(decodes).toHaveLength(2);

      // B's decode resolves FIRST, then A's slow decode drips in last.
      const bBuffer = fakeAudioBuffer("B");
      decodes[1].land(bBuffer);
      await loadB;
      decodes[0].land(fakeAudioBuffer("A"));
      await loadA;
      await flush();

      expect(engine.state.trackName).toBe("second.mp3");
      expect(engine.audioBuffer).toBe(bBuffer);
    });
  },
);
