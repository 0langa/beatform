import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExportJob } from "./exportCore";
import type { PcmData } from "../audio/types";
import { DEFAULT_PREFS, setPrefs } from "../state/prefs";

/**
 * R2-14 — GPU adapter parity between preview and export.
 *
 * WebGPURenderer.create picks its adapter from getPrefs().powerPreference,
 * but the export worker has no localStorage, so prefs THERE always answered
 * "default": on a dual-GPU machine the preview could run on the chosen
 * adapter while the export silently rendered on a different one — a
 * renderer-environment split between the two sides of the determinism law.
 * The pref now rides the ExportJob, captured at the main-thread job build
 * (so the batch lane inherits it through the same chokepoint), and the
 * worker's renderer creation uses the job's value instead of re-reading
 * prefs it cannot see.
 */

const captured = vi.hoisted(() => ({ job: null as unknown as ExportJob }));

// Half 1 (job assembly): stub the core so exportVideo hands us the job it
// built — the real buildJob, same idiom as segmentShiftMatrix.test.ts.
vi.mock("./exportCore", () => ({
  runExportJob: vi.fn(async (job: ExportJob) => {
    captured.job = job;
    return { bytes: 1, seconds: 1, audioCodec: "aac" as const };
  }),
}));

// Half 2 (worker create path): the REAL runExportJob (vi.importActual below)
// must see a recordable renderer instead of real WebGPU.
vi.mock("../render/webgpuRenderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../render/webgpuRenderer")>();
  return {
    ...actual,
    WebGPURenderer: {
      create: vi.fn(async () => {
        // Dying here is fine — the call's ARGUMENTS are the assertion.
        throw new Error("test renderer: stop at create");
      }),
    },
  };
});

import { exportVideo, type ExportOptions } from "./videoExporter";
import { WebGPURenderer } from "../render/webgpuRenderer";

function fakeAudioBuffer(): AudioBuffer {
  const channel = new Float32Array(480);
  return {
    sampleRate: 48000,
    length: 480,
    duration: 0.01,
    numberOfChannels: 1,
    getChannelData: () => channel.slice(),
  } as unknown as AudioBuffer;
}

const options: ExportOptions = {
  width: 64,
  height: 64,
  fps: 30,
  bitrate: 1_000_000,
  presetId: "spectrum-bars",
  params: {},
  bg: { mode: 0, color: [0, 0, 0] },
};

const pcm: PcmData = {
  sampleRate: 48000,
  length: 480,
  duration: 0.01,
  channels: [new Float32Array(480)],
};

afterEach(() => {
  vi.unstubAllGlobals();
  setPrefs({ powerPreference: DEFAULT_PREFS.powerPreference });
  vi.mocked(WebGPURenderer.create).mockClear();
});

describe("the ExportJob carries the live powerPreference (R2-14)", () => {
  it("buildJob captures the pref at assembly time, on the main thread", async () => {
    setPrefs({ powerPreference: "high-performance" });
    await exportVideo(fakeAudioBuffer(), options);
    expect(captured.job.powerPreference).toBe("high-performance");
  });

  it("a default pref rides through as 'default', not as an absent field", async () => {
    // The field must always be emitted: an absent key would make the worker
    // fall back to ITS prefs read, which is the exact bug this closes.
    await exportVideo(fakeAudioBuffer(), options);
    expect(captured.job.powerPreference).toBe("default");
  });
});

describe("the worker create path uses the job's value (R2-14)", () => {
  it("runExportJob hands job.powerPreference to WebGPURenderer.create", async () => {
    const { runExportJob } = await vi.importActual<typeof import("./exportCore")>("./exportCore");
    // Node has no OffscreenCanvas; a bare stand-in is enough to reach the
    // renderer-creation call (the deep lane probes no encoder before it).
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
      },
    );

    const job: ExportJob = {
      pcm,
      width: 64,
      height: 64,
      fps: 30,
      timeOrigin: 0,
      bitrate: 1_000_000,
      presetId: "spectrum-bars",
      params: {},
      bg: { mode: 0, color: [0, 0, 0] },
      mode: "stream",
      deepColor: true,
      powerPreference: "low-power",
    };
    await expect(runExportJob(job, { onRawFrame: () => {} })).rejects.toThrow(/WebGPU/);

    expect(vi.mocked(WebGPURenderer.create)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(WebGPURenderer.create).mock.calls[0][1]).toBe("low-power");
  });
});
