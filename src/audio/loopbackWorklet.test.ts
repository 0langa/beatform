import { describe, expect, it } from "vitest";
// The worklet's own source text, read through Vite rather than the filesystem —
// `?raw` keeps this on the same module resolution the app uses and needs no
// node types in a DOM-only tsconfig.
import workletSource from "../../public/loopback-worklet.js?raw";

/**
 * The loopback feed worklet is a plain asset, not a module the bundle imports —
 * it is loaded by `audioWorklet.addModule("/loopback-worklet.js")` at runtime,
 * so nothing in the app's own import graph can reach it. Loading the source
 * here with the globals the Worklet scope provides is what makes the ring
 * testable at all, and its DEPTH is the one property that has to be right: the
 * ring sits between the WASAPI capture and the analysers, so every frame held
 * in it is a frame of eye-behind-ear lag in the live visualization.
 */
const SR = 48000;
const QUANTUM = 128; // render quantum, frames

interface Processor {
  port: {
    onmessage: ((e: { data: unknown }) => void) | null;
    postMessage: (data: unknown) => void;
  };
  process(inputs: unknown, outputs: Float32Array[][]): boolean;
}

function loadWorklet(sampleRate = SR): new () => Processor {
  class FakeProcessor {
    port = { onmessage: null, postMessage: (_data: unknown) => {} };
  }
  let registered: unknown = null;
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", workletSource)(
    FakeProcessor,
    (_name: string, ctor: unknown) => (registered = ctor),
    sampleRate,
  );
  return registered as new () => Processor;
}

interface RingRun {
  /** Ring latency in frames, sampled per emitted frame. */
  lag: number[];
  /** Same, but only after the ring has warmed up (first 0.5 s dropped). */
  settledLag: number[];
  underruns: number;
  settledFrames: number;
}

/**
 * Model the two clocks the ring actually sits between.
 *
 * Capture and the audio graph run off the SAME device (loopback taps the
 * default output), so they do not drift — production and consumption match rate
 * for rate. What separates them is that the graph's render thread can HITCH: a
 * quantum of graph time it fails to run is a quantum of audio the capture side
 * produced anyway, and it lands in the ring. Delivery jitter (the Rust forward
 * thread, the IPC hop, the main thread's postMessage) is modelled separately
 * because it can only ever DELAY a chunk, never un-capture it.
 *
 * Samples carry their own absolute frame index as their VALUE, so latency is
 * read straight off the output rather than inferred: `written - value` is
 * exactly how far behind the emitted frame is.
 */
function runRing(opts: {
  seconds: number;
  /** Graph-thread hitch length in seconds, applied once per second. */
  hitch?: number;
  /** Peak delivery delay in seconds. */
  jitter?: number;
  /** One extra pile of frames handed over at t = 1 s, seconds' worth. */
  burstAt1s?: number;
  sampleRate?: number;
}): RingRun {
  const sr = opts.sampleRate ?? SR;
  const Ctor = loadWorklet(sr);
  const node = new Ctor();
  const push = (from: number, frames: number) => {
    const buf = new ArrayBuffer(frames * 2 * 4);
    const view = new Float32Array(buf);
    for (let i = 0; i < frames; i++) {
      view[i * 2] = from + i;
      view[i * 2 + 1] = from + i;
    }
    node.port.onmessage?.({ data: buf });
  };

  const chunk = Math.round(sr * 0.01); // ~10 ms, a WASAPI shared-mode period
  const jitter = Math.round((opts.jitter ?? 0.005) * sr);
  const hitch = Math.round((opts.hitch ?? 0) * sr);
  const quanta = Math.round((opts.seconds * sr) / QUANTUM);
  const perSecond = Math.round(sr / QUANTUM);
  const burst = opts.burstAt1s ? Math.round(opts.burstAt1s * sr) : 0;
  const L = new Float32Array(QUANTUM);
  const R = new Float32Array(QUANTUM);

  let elapsed = 0; // real time, in frames
  let written = 0;
  let consumed = 0;
  let underruns = 0;
  let settledFrames = 0;
  const lag: number[] = [];
  const settledLag: number[] = [];

  for (let q = 0; q < quanta; q++) {
    // A hitch: real time moves, the graph does not.
    elapsed += QUANTUM + (hitch > 0 && q % perSecond === perSecond - 1 ? hitch : 0);
    const delay = Math.round(((Math.sin(q * 0.37) + 1) / 2) * jitter);
    const deliverUpTo = elapsed - delay;
    while (written + chunk <= deliverUpTo) {
      push(written, chunk);
      written += chunk;
    }
    if (burst > 0 && q === perSecond) {
      push(written, burst);
      written += burst;
      elapsed += burst;
    }

    L.fill(-1);
    R.fill(-1);
    node.process(null, [[L, R]]);
    consumed += QUANTUM;
    const settled = consumed > sr * 0.5;
    for (let i = 0; i < QUANTUM; i++) {
      if (settled) settledFrames++;
      if (L[i] === 0 && written > 0) {
        if (settled) underruns++;
      } else if (L[i] > 0) {
        lag.push(written - L[i]);
        if (settled) settledLag.push(written - L[i]);
      }
    }
  }
  return { lag, settledLag, underruns, settledFrames };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const max = (xs: number[]) => xs.reduce((a, b) => (b > a ? b : a), 0);

describe("loopback worklet ring depth", () => {
  it("reports depth diagnostics only when explicitly requested", () => {
    const Ctor = loadWorklet();
    const node = new Ctor();
    const reports: unknown[] = [];
    node.port.postMessage = (data) => reports.push(data);
    node.port.onmessage?.({ data: { type: "stats", requestId: 7, reset: true } });
    expect(reports).toEqual([
      {
        type: "stats",
        requestId: 7,
        depthFrames: 0,
        maxDepthFrames: 0,
        skippedFrames: 0,
        hardSkippedFrames: 0,
        adaptiveSkippedFrames: 0,
        overflowDroppedFrames: 0,
        underrunFrames: 0,
        underrunEvents: 0,
        maxUnderrunFrames: 0,
        sampleRate: SR,
      },
    ]);
  });

  /**
   * The defect this pins (BUG-001): the ring had no drain. Depth only ever grew
   * — every render-thread hitch left frames in it that nothing took back out —
   * and the single corrective branch waited for a QUARTER SECOND of backlog
   * before halving it. So the steady state was a 125-250 ms sawtooth of pure
   * latency between what the speakers played and what the analysers saw, on top
   * of the ~90 ms the analysis itself costs.
   */
  it("holds only a few tens of milliseconds of audio in the steady state", () => {
    const { settledLag } = runRing({ seconds: 8, hitch: 0.03 });
    const avgMs = (mean(settledLag) / SR) * 1000;
    const worstMs = (max(settledLag) / SR) * 1000;
    // Measured on this fixture: 120.5 ms mean / 247.3 ms worst before the
    // drain, 22.7 / 54.7 after.
    expect(avgMs, `mean ring latency ${avgMs.toFixed(1)} ms`).toBeLessThan(110);
    expect(worstMs, `worst ring latency ${worstMs.toFixed(1)} ms`).toBeLessThan(200);
  });

  /**
   * The ratchet, isolated. One stall hands the ring a pile of frames at once;
   * without a drain that pile is latency the user keeps for the rest of the
   * session, because production and consumption run at the same rate afterwards
   * and nothing ever catches up.
   */
  it("drains a one-off backlog instead of keeping it forever", () => {
    const { lag } = runRing({ seconds: 8, burstAt1s: 0.2 });
    const tail = lag.slice(-SR); // the last second, long after the burst
    const tailMs = (mean(tail) / SR) * 1000;
    expect(tailMs, `latency ${tailMs.toFixed(1)} ms after a 200 ms burst`).toBeLessThan(110);
  });

  /** Draining must not overshoot into starvation: a drained ring that underruns
   * feeds the analysers digital silence, which reads as a dropout in the
   * visuals — trading a lag bug for a flicker bug. */
  it("does not starve itself while draining", () => {
    const { underruns, settledFrames } = runRing({ seconds: 8, hitch: 0.03 });
    const frac = underruns / settledFrames;
    expect(frac, `underrun fraction ${frac}`).toBeLessThan(0.002);
  });

  it("keeps its depth in seconds, not frames, at other sample rates", () => {
    const { settledLag } = runRing({ seconds: 6, hitch: 0.03, sampleRate: 96000 });
    const avgMs = (mean(settledLag) / 96000) * 1000;
    expect(avgMs, `mean ring latency ${avgMs.toFixed(1)} ms at 96 kHz`).toBeLessThan(110);
  });
});

/**
 * R2-32e — writer-side overflow honesty. The capture side keeps delivering
 * whether or not the render thread runs, and the old writer wrapped straight
 * over unread frames once depth passed the 2 s ring capacity: `w - rd` kept
 * climbing past cap (an accounting lie — only cap frames exist) while the
 * data `rd` pointed at was silently replaced by audio from seconds later, so
 * a recovered graph read a garbled splice. The writer now drops the part of
 * the INCOMING block that has no room and counts it (`overflowDroppedFrames`);
 * the existing drain/hard-skip machinery fast-forwards through the bounded
 * backlog once the graph runs again.
 *
 * Second half: underrun stats and CREDIT must not arm before the first
 * delivery. The pre-delivery idle (worklet started, capture IPC not flowing
 * yet) is not an underrun — and credit earned there let the first real
 * delivery be hard-skipped as "stale", discarding genuine audio.
 */
describe("stalled-graph overflow protection (R2-32e)", () => {
  /** Deliver `frames` frames whose VALUES are their absolute capture index —
   * same encoding as runRing, offset so index 0 is never confused with the
   * silence the ring emits on underrun. */
  function makePush(node: Processor) {
    return (from: number, frames: number) => {
      const buf = new ArrayBuffer(frames * 2 * 4);
      const view = new Float32Array(buf);
      for (let i = 0; i < frames; i++) {
        view[i * 2] = from + i;
        view[i * 2 + 1] = from + i;
      }
      node.port.onmessage?.({ data: buf });
    };
  }

  function statsOf(node: Processor): Record<string, number> {
    let out: Record<string, number> | null = null;
    const prev = node.port.postMessage;
    node.port.postMessage = (data) => {
      out = data as Record<string, number>;
    };
    node.port.onmessage?.({ data: { type: "stats", requestId: 1 } });
    node.port.postMessage = prev;
    return out!;
  }

  it("a 3 s stall never wraps over unread audio: depth caps at the ring, the tail is dropped and counted", () => {
    const Ctor = loadWorklet();
    const node = new Ctor();
    const push = makePush(node);
    const chunk = Math.round(SR * 0.01);
    const L = new Float32Array(QUANTUM);
    const R = new Float32Array(QUANTUM);

    // Normal running start: 0.5 s delivered and consumed in lockstep.
    let written = 1000; // offset: value 0 stays unambiguous underrun silence
    let consumedQuanta = 0;
    for (let t = 0; t < SR * 0.5; t += chunk) {
      push(written, chunk);
      written += chunk;
      while ((consumedQuanta + 1) * QUANTUM < written - 1000) {
        node.process(null, [[L, R]]);
        consumedQuanta++;
      }
    }

    // The stall: 3 s of capture arrives, the graph never runs once.
    for (let t = 0; t < SR * 3; t += chunk) {
      push(written, chunk);
      written += chunk;
    }

    const stats = statsOf(node);
    // Depth is bounded by the ring's real capacity — the accounting can no
    // longer claim more frames than exist.
    expect(stats.depthFrames).toBeLessThanOrEqual(SR * 2);
    expect(stats.maxDepthFrames).toBeLessThanOrEqual(SR * 2);
    // Everything that had no room was dropped from the incoming tail, and
    // every dropped frame is on the books.
    expect(stats.overflowDroppedFrames).toBeGreaterThan(SR * 0.9);
    expect(stats.overflowDroppedFrames).toBeLessThanOrEqual(SR * 1.6);

    // The graph recovers: emitted frame indices must be strictly monotonic —
    // the wrap-over bug spliced seconds-later audio under old read indices,
    // which reads back as values jumping around the wrap seam.
    let last = -Infinity;
    for (let q = 0; q < Math.round((SR * 2.5) / QUANTUM); q++) {
      node.process(null, [[L, R]]);
      for (let i = 0; i < L.length; i++) {
        if (L[i] === 0) continue; // underrun silence once the ring drains
        expect(L[i], `frame after ${last}`).toBeGreaterThan(last);
        last = L[i];
      }
    }
    expect(last).toBeGreaterThan(1000); // fixture sanity: data actually flowed
  });

  it("pre-delivery idle arms nothing: zero underrun stats, zero credit to hard-skip real audio with", () => {
    const Ctor = loadWorklet();
    const node = new Ctor();
    const push = makePush(node);
    const L = new Float32Array(QUANTUM);
    const R = new Float32Array(QUANTUM);

    // A full second of graph time before capture IPC ever delivers.
    for (let q = 0; q < Math.round(SR / QUANTUM); q++) node.process(null, [[L, R]]);
    const idle = statsOf(node);
    expect(idle.underrunFrames).toBe(0);
    expect(idle.underrunEvents).toBe(0);
    expect(idle.maxUnderrunFrames).toBe(0);

    // First delivery lands late and large (0.5 s > the 120 ms hard ceiling).
    // With no credit armed, the ceiling must NOT discard any of it — every
    // frame is genuine, nothing was ever emitted as silence in its place.
    push(1000, Math.round(SR * 0.5));
    const after = statsOf(node);
    expect(after.hardSkippedFrames).toBe(0);
    expect(after.skippedFrames).toBe(0);

    // Underruns count normally once delivery has begun and the ring drains.
    for (let q = 0; q < Math.round(SR / QUANTUM); q++) node.process(null, [[L, R]]);
    expect(statsOf(node).underrunFrames).toBeGreaterThan(0);
  });
});
