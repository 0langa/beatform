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
      // The AnalyserNode defaults (Web Audio §1.6) — what the engine gets
      // unless it says otherwise, and what the channel-parity test models.
      channelCount: 2,
      channelCountMode: "max",
      channelInterpretation: "speakers",
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

/** What `startLiveInput` builds. The port log is ordered on purpose: the
 * close handshake is a claim about what reaches the processor BEFORE the
 * port shuts, not merely that something does. */
class FakeAudioWorkletNode {
  static instances: FakeAudioWorkletNode[] = [];
  portLog: string[] = [];
  port = {
    postMessage: (m: unknown) => {
      this.portLog.push(`post:${JSON.stringify(m)}`);
    },
    close: () => {
      this.portLog.push("close");
    },
  };
  outputs: FakeNode[] = [];
  connect(dst: FakeNode) {
    this.outputs.push(dst);
    return dst;
  }
  disconnect() {
    this.outputs.length = 0;
  }
  constructor() {
    FakeAudioWorkletNode.instances.push(this);
  }
}

interface ChannelConfig {
  channelCount: number;
  channelCountMode: string;
  channelInterpretation: string;
}

/**
 * Web Audio channel mixing (§4), for the shapes this graph meets. "speakers"
 * is the spec's layout table; only the layouts a 1-, 2- or 6-channel track
 * can reach are written out, and anything else throws so a changed setting
 * fails loudly here instead of being quietly mis-modelled.
 */
function speakersMix(src: number[], to: number): number[] {
  const n = src.length;
  const q = Math.SQRT1_2;
  if (n === 1 && to === 2) return [src[0], src[0]];
  if (n === 2 && to === 1) return [0.5 * (src[0] + src[1])];
  if (n === 6 && to === 2) {
    const [L, R, C, , SL, SR] = src;
    return [L + q * (C + SL), R + q * (C + SR)];
  }
  if (n === 6 && to === 1) {
    const [L, R, C, , SL, SR] = src;
    return [q * (L + R) + C + 0.5 * (SL + SR)];
  }
  throw new Error(`unmodelled speakers mix ${n} -> ${to}`);
}

/** One sample of N-channel programme as the analyser's mono tap sees it:
 * the input stage mixes to the node's computed channel count per its
 * channelCount/Mode/Interpretation, then getFloatTimeDomainData reads the
 * AnalyserNode's own "speakers" down-mix to mono (§1.6). */
function analysedMono(a: ChannelConfig, programme: number[]): number {
  const n = programme.length;
  const computed =
    a.channelCountMode === "explicit"
      ? a.channelCount
      : a.channelCountMode === "clamped-max"
        ? Math.min(n, a.channelCount)
        : n;
  let mixed = programme;
  if (computed !== n) {
    mixed =
      a.channelInterpretation === "discrete"
        ? Array.from({ length: computed }, (_, i) => programme[i] ?? 0)
        : speakersMix(programme, computed);
  }
  return mixed.length === 1 ? mixed[0] : speakersMix(mixed, 1)[0];
}

/** The export's mixdown: the PCM is sliced to its first two channels
 * (videoExporter.ts) and OfflineSource averages what is left. */
function exportMono(programme: number[]): number {
  const two = programme.slice(0, 2);
  return two.reduce((s, v) => s + v, 0) / two.length;
}

/**
 * TIMEOUTS: an explicit 30 s budget rather than vitest's 5 s default. Every
 * case here calls `vi.resetModules()` and re-imports `./engine`, so its cost is
 * a module graph rebuilt per test — the one cost in this suite that scales with
 * how many workers are competing for the transform pipeline, and it showed:
 * 0.3 s in a normal full-suite run against 1.3 s with the pool oversubscribed
 * 2:1. Nothing here awaits a real clock (`FakeAudioContext` resolves
 * immediately), so the default timeout was the only load-sensitive failure
 * mode. Same remedy as `dspCharacterization.test.ts`.
 */
describe("audio graph", { timeout: 30_000 }, () => {
  afterEach(() => {
    created.length = 0;
    FakeAudioWorkletNode.instances.length = 0;
    vi.unstubAllGlobals();
  });

  /**
   * Channel parity with the offline analysers. Export and beat/section
   * analysis both work on the PCM's FIRST TWO channels — c0 for mono,
   * (c0+c1)/2 otherwise — while an AnalyserNode at its defaults takes every
   * channel and down-mixes by the speaker rules, so a 5.1 file was analysed
   * one way live and another way in the export: a preview/export divergence
   * on the programme material itself. The fix is a channel configuration,
   * and this models the spec's mixing for it, because the obvious settings
   * are each wrong in one direction: "explicit" up-mixes mono to [m, 0] and
   * halves it, "speakers" folds a 5.1 file's centre and surrounds in.
   */
  it("feeds the detector analysers exactly what the export analyses — mono, stereo and 5.1", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.resetModules();
    const { AudioEngine } = await import("./engine");
    const engine = new AudioEngine();

    const programmes = {
      mono: [0.8],
      stereo: [0.8, 0.2],
      "5.1": [0.8, 0.2, 0.5, 0.1, 0.3, 0.4],
    };
    for (const analyser of [engine.analyser, engine.displayAnalyser]) {
      for (const [name, programme] of Object.entries(programmes)) {
        expect(analysedMono(analyser, programme), `${name} programme`).toBeCloseTo(
          exportMono(programme),
          9,
        );
      }
    }
    // The L/R taps sit behind a ChannelSplitter, discrete by definition, and
    // are left alone: mono still feeds a silent right, exactly as the
    // offline meter assumes (offlineSource.ts, meterChannels).
    const splitter = findByKind("splitter")[0];
    const [tapL, tapR] = [engine.analyserL, engine.analyserR] as unknown as FakeNode[];
    expect(reaches(splitter, tapL)).toBe(true);
    expect(reaches(splitter, tapR)).toBe(true);
  });

  /**
   * An AudioWorkletProcessor whose process() returns true is an active
   * source the context keeps alive; closing the port and disconnecting the
   * node end nothing. stopLiveInput must tell the processor to stand down
   * BEFORE the port closes — after, there is no channel left to say it on.
   */
  it("tells the live worklet to close before shutting its port", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
    vi.resetModules();
    const { AudioEngine } = await import("./engine");
    const engine = new AudioEngine();

    const push = await engine.startLiveInput();
    const node = FakeAudioWorkletNode.instances[0];
    expect(engine.liveInput).toBe(true);
    push(new ArrayBuffer(16));

    engine.stopLiveInput();

    expect(node.portLog.slice(-2)).toEqual(['post:{"type":"close"}', "close"]);
    expect(node.outputs).toHaveLength(0);
    expect(engine.liveInput).toBe(false);
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

  /**
   * The store resets the analyzer only when a loop/region action really moved
   * the playhead, and it learns that from this counter — diffing currentTime
   * misfired on a playing clock (see loopToggleReset.test.ts).
   */
  it("counts only reconfigurations that move the playhead", async () => {
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
    engine.loadBuffer(buffer, "moves.wav");
    await engine.play();
    const ctx = engine.ctx as unknown as { currentTime: number };

    ctx.currentTime = 5; // playhead 5 s
    engine.setLoopStart(4);
    engine.setLoopEnd(6);
    engine.loop = true; // inside the region: stays put
    engine.loop = false;
    engine.clearLoopRegion();
    expect(engine.relocations).toBe(0);

    engine.setLoopStart(7);
    engine.setLoopEnd(9);
    engine.loop = true; // outside: teleports to 7
    expect(engine.currentTime).toBe(7);
    expect(engine.relocations).toBe(1);

    engine.setLoopStart(8); // region 8..9 shuts the playhead (7) out
    expect(engine.currentTime).toBe(8);
    expect(engine.relocations).toBe(2);
  });
});
