import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PcmData } from "../audio/types";
import { DEFAULT_MOTION, DEFAULT_POST } from "../render/types";

/**
 * E4a — the liveness pulse that keeps a HEALTHY export alive past the worker
 * watchdog.
 *
 * The owner's installed 2.93.0 killed an AV1 1080p60 export with "Export
 * worker stopped responding mid-render". The watchdog (videoExporter.ts,
 * WORKER_WATCHDOG_MS = 30 s) exists to catch a DEAD worker event loop — the
 * silent-OOM case onerror never reports — but during the frame loop its only
 * food was chunk output and the every-10-frames progress post. Software AV1
 * at `latencyMode: "quality"` holds a ~20+ frame lookahead before its FIRST
 * chunk, and on a slow machine a heavy mode feeds it slowly — so every food
 * source can legitimately starve for >30 s while the loop sits parked on the
 * encoder's backpressure await, perfectly alive. Same false-kill family as
 * the sink-busy exemption the watchdog already carries.
 *
 * The fix: exportCore beats `onHeartbeat` on a timer for the whole life of
 * the frame loop, so the watchdog's meaning collapses to exactly its
 * documented purpose — event-loop death. A wedged encoder no longer gets the
 * export KILLED; it gets an export that honestly hangs until the user
 * cancels, which is the recoverable state.
 *
 * The test parks the loop on a stalled SINK await (the PNG lane's onFrame —
 * the same backpressure position the encoder's add() occupies in the MP4
 * lane) and asserts the pulse keeps beating through the stall. Real timers:
 * the pulse interval is the injectable `livenessPulseMs` test seam.
 */

vi.mock("../render/webgpuRenderer", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../render/webgpuRenderer")>();
  class FakeRenderer {
    onDeviceLost: ((reason: string) => void) | null = null;
    static create = async () => new FakeRenderer();
    setDeepCapture() {}
    setPreset() {}
    setBackground() {}
    setOverlay() {}
    setSmoothSpectrum() {}
    setPost() {}
    setMotion() {}
    setBuilderParams() {}
    setCoverArt() {}
    setBackgroundImage() {}
    updateBackgroundVideoFrame() {}
    setTransitionPreset() {}
    resize() {}
    render() {}
    async gpuDone() {}
    async readbackDeepFrame() {
      return new Uint16Array(0);
    }
    dispose() {}
  }
  return { ...mod, WebGPURenderer: FakeRenderer };
});

/** Finalize gate the mediabunny mock parks on when a test arms it. */
const finalizeCtl: { gate: Promise<void> | null; started: boolean } = {
  gate: null,
  started: false,
};

vi.mock("mediabunny", () => {
  class Output {
    state = "started";
    addVideoTrack() {}
    addAudioTrack() {}
    async start() {}
    async finalize() {
      finalizeCtl.started = true;
      if (finalizeCtl.gate) await finalizeCtl.gate;
      this.state = "finalized";
    }
    async cancel() {
      this.state = "canceled";
    }
  }
  class VideoSampleSource {
    async add() {}
  }
  class AudioSampleSource {
    async add() {}
  }
  class VideoSample {
    close() {}
  }
  class AudioSample {
    close() {}
  }
  class BufferTarget {
    buffer = new ArrayBuffer(8);
  }
  class StreamTarget {}
  class Mp4OutputFormat {}
  class WebMOutputFormat {}
  return {
    Output,
    VideoSampleSource,
    AudioSampleSource,
    VideoSample,
    AudioSample,
    BufferTarget,
    StreamTarget,
    Mp4OutputFormat,
    WebMOutputFormat,
  };
});

import { runExportJob, type ExportJob } from "./exportCore";

function makePcm(seconds: number): PcmData {
  const sampleRate = 48000;
  const n = Math.round(sampleRate * seconds);
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = Math.sin(i * 0.06) * 0.4;
  return { sampleRate, length: n, duration: n / sampleRate, channels: [ch] };
}

function job(pcm: PcmData): ExportJob {
  return {
    pcm,
    width: 96,
    height: 64,
    fps: 30,
    timeOrigin: 0,
    bitrate: 1_000_000,
    presetId: "spectrum-bars",
    params: {},
    bg: { mode: 0, color: [0, 0, 0] },
    mods: [],
    post: { ...DEFAULT_POST },
    motion: { ...DEFAULT_MOTION },
    smoothSpectrum: true,
    beatGrid: { bpm: 120, beatTimes: new Float32Array([0, 0.5]), hopSec: 512 / 48000 },
    sections: [],
    vocalSpans: [],
    mode: "png",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(cond: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("waitUntil timed out");
    await sleep(10);
  }
}

/** TIMEOUTS: real timers over real stalls; see GATES.md §1. */
describe("export liveness pulse (E4a)", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          return null;
        }
        async convertToBlob() {
          return new Blob([new Uint8Array([0x89, 0x50])]);
        }
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps beating while the frame loop is parked on a stalled sink", async () => {
    let release!: () => void;
    const stall = new Promise<void>((r) => (release = r));
    let framesSeen = 0;
    let beats = 0;
    const run = runExportJob(job(makePcm(0.3)), {
      livenessPulseMs: 40,
      onHeartbeat: () => {
        beats++;
      },
      onFrame: async () => {
        framesSeen++;
        // Frame 3 parks the loop exactly where a slow encoder would: on the
        // sink's backpressure await, with no frames, chunks or progress
        // flowing — the watchdog-starvation window.
        if (framesSeen === 3) await stall;
      },
    });

    await waitUntil(() => framesSeen === 3);
    const beatsWhenParked = beats;
    await sleep(250);
    // Before the pulse existed, setup's staged heartbeats had all fired by
    // now and NOTHING beat during the stall — this held at exactly 0 new
    // beats. Six-plus pulse intervals fit in the window; requiring two keeps
    // the assertion loose enough for a loaded pool.
    expect(beats).toBeGreaterThanOrEqual(beatsWhenParked + 2);

    release();
    await run;
    expect(framesSeen).toBe(9); // 0.3 s at 30 fps — the export completed
  });

  it("stops beating once the job settles — no timer leaks past the run", async () => {
    let beats = 0;
    await runExportJob(job(makePcm(0.1)), {
      livenessPulseMs: 20,
      onHeartbeat: () => {
        beats++;
      },
      onFrame: async () => {},
    });
    const atEnd = beats;
    await sleep(120);
    expect(beats).toBe(atEnd);
  });
});

/**
 * The FINALIZE window — the owner's SECOND hit, H.264 dying at 99% on the
 * installed 2.93.0. After the last frame, `output.finalize()` flushes both
 * quality-mode encoder queues and the muxer tail with ZERO messages flowing
 * (the final onProgress posts only AFTERWARDS), so a long job's flush on a
 * throttled machine starves the watchdog exactly like the AV1 lookahead did
 * mid-loop. The pulse must span finalize: its stop lives in the function's
 * `finally`, AFTER finalize — this test pins that position (green since the
 * E4a fix landed with the stop placed there; moving `stopLivenessPulse()`
 * above the finalize await turns it red, which is the binding check).
 */
describe("export liveness pulse spans finalize (E4a, the 99% window)", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          return null;
        }
        async convertToBlob() {
          return new Blob([new Uint8Array([0x89, 0x50])]);
        }
      },
    );
    vi.stubGlobal("VideoEncoder", { isConfigSupported: async () => ({ supported: true }) });
    vi.stubGlobal("AudioEncoder", { isConfigSupported: async () => ({ supported: true }) });
    // The audio pump constructs real WebCodecs AudioData before handing it to
    // the (mocked) AudioSample; node has no WebCodecs, so stub the shell.
    vi.stubGlobal(
      "AudioData",
      class {
        constructor(public init: unknown) {}
        close() {}
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    finalizeCtl.gate = null;
    finalizeCtl.started = false;
  });

  it("keeps beating while finalize() is parked on the encoder flush", async () => {
    let release!: () => void;
    finalizeCtl.gate = new Promise<void>((r) => (release = r));
    let beats = 0;
    const run = runExportJob(
      { ...job(makePcm(0.2)), mode: "buffer", codec: "h264" },
      {
        livenessPulseMs: 40,
        onHeartbeat: () => {
          beats++;
        },
      },
    );

    await waitUntil(() => finalizeCtl.started);
    const beatsAtFinalize = beats;
    await sleep(250);
    // On the installed 2.93.0 this window carried NOTHING — six pulse
    // intervals fit here; requiring two keeps it loose under pool load.
    expect(beats).toBeGreaterThanOrEqual(beatsAtFinalize + 2);

    release();
    const result = await run;
    expect(result.buffer).toBeDefined();
  });
});
