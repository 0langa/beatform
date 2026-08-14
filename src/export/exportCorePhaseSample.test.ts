import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PcmData } from "../audio/types";
import { DEFAULT_MOTION, DEFAULT_POST } from "../render/types";

/**
 * E4b — the per-frame phase-timing test seam (ExportCoreHooks.onPhaseSample).
 *
 * Added to answer BACKLOG E4b's measurement question — does the frame loop's
 * render wait or its encode wait dominate wall time, which decides whether a
 * one-frame pipeline overlap (Task 3) is worth building — without leaving a
 * hook in the tree that nobody can trust. Same bar E4a's onHeartbeat/
 * livenessPulseMs test seam set: zero cost when absent, and that claim
 * pinned by a real test rather than left as a comment's word.
 *
 * Same renderer/mediabunny mocking as exportLiveness.test.ts's finalize-window
 * block — "buffer" mode + h264 is the ordinary MP4 encoder lane (no readback,
 * no sidecar), the one BACKLOG E4b's device measurement actually exercises.
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

vi.mock("mediabunny", () => {
  class Output {
    state = "started";
    addVideoTrack() {}
    addAudioTrack() {}
    async start() {}
    async finalize() {
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

import { runExportJob, type ExportJob, type PhaseSample } from "./exportCore";

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
    mode: "buffer",
    codec: "h264",
  };
}

describe("export phase-sample test seam (E4b)", () => {
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
  });

  it("fires once per frame with a monotonically-consistent phase split", async () => {
    const samples: PhaseSample[] = [];
    const result = await runExportJob(job(makePcm(0.2)), {
      onPhaseSample: (s) => samples.push(s),
    });
    expect(result.buffer).toBeDefined();
    // 0.2 s @ 30 fps: the exact count is incidental, only ">0 and every frame
    // reported" matters here.
    expect(samples.length).toBeGreaterThan(0);
    samples.forEach((s, i) => {
      expect(s.n).toBe(i);
      expect(s.renderMs).toBeGreaterThanOrEqual(0);
      // "buffer" mode never reads pixels back (the encoder samples the
      // canvas directly) — readbackMs must stay exactly the initialized 0,
      // never drift positive from a stray timestamp in the wrong branch.
      expect(s.readbackMs).toBe(0);
      expect(s.encodeMs).toBeGreaterThanOrEqual(0);
      // Telescoping sum: wallMs is read strictly after the other three (it
      // also spans the per-frame audio pump), so on a monotonic clock it can
      // never be less than their total.
      expect(s.wallMs).toBeGreaterThanOrEqual(s.renderMs + s.readbackMs + s.encodeMs);
    });
  });

  it("costs nothing when absent — zero performance.now() calls from the frame loop", async () => {
    const nowSpy = vi.spyOn(performance, "now");
    const before = nowSpy.mock.calls.length;
    const result = await runExportJob(job(makePcm(0.2)), {});
    // No onPhaseSample: every timestamp in the loop is gated on the hook's
    // existence (exportCore.ts), so this run must not touch performance.now()
    // at all. exportCore.ts has no OTHER performance.now() call site, so this
    // is a direct pin of the "zero cost when absent" claim in
    // ExportCoreHooks.onPhaseSample's doc comment, not an indirect proxy.
    expect(nowSpy.mock.calls.length).toBe(before);
    expect(result.buffer).toBeDefined();
    nowSpy.mockRestore();
  });
});
