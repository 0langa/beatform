import { afterEach, describe, expect, it, vi } from "vitest";
import { runExportJob, type ExportJob } from "./exportCore";
import type { PcmData } from "../audio/types";

/**
 * FEAT-005 deep-colour lane — job-start validation.
 *
 * The deepColor flag switches runExportJob onto the raw-frame sidecar lane
 * (no muxer, no WebCodecs), and its impossible pairings are rejected BEFORE
 * any GPU/encoder resource exists. These tests pin both facts: the rejection
 * messages, and that a valid deep job probes no encoder at all — a regression
 * where deep fell back into the mediabunny lane would show up here as an
 * unexpected isConfigSupported call, not as a corrupted file on a user's disk.
 */

const pcm: PcmData = {
  sampleRate: 48000,
  length: 4800,
  duration: 0.1,
  channels: [new Float32Array(4800)],
};

function deepJob(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    pcm,
    width: 64,
    height: 64,
    fps: 30,
    // A full-track job: the clip IS the track, so its origin is 0. Required
    // rather than defaulted, so a job that forgets it cannot render silently at
    // the wrong moment (E2-R1).
    timeOrigin: 0,
    bitrate: 1_000_000,
    presetId: "spectrum-bars",
    params: {},
    bg: { mode: 0, color: [0, 0, 0] },
    mode: "stream",
    deepColor: true,
    ...overrides,
  };
}

const onRawFrame = () => {};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runExportJob deepColor validation", () => {
  it("rejects deepColor + PNG mode (one frame sink per job)", async () => {
    await expect(runExportJob(deepJob({ mode: "png" }), { onRawFrame })).rejects.toThrow(
      /deepColor is mutually exclusive with PNG mode/,
    );
  });

  it("rejects deepColor + loop crossfade (the blend canvas is 8-bit)", async () => {
    await expect(runExportJob(deepJob({ loopCrossfadeSec: 1.5 }), { onRawFrame })).rejects.toThrow(
      /mutually exclusive with loop crossfade/,
    );
  });

  it("rejects deepColor without an onRawFrame sink", async () => {
    await expect(runExportJob(deepJob(), {})).rejects.toThrow(
      /deepColor requires hooks\.onRawFrame/,
    );
  });

  it("rejects PNG mode without an onFrame sink, mirroring this lane's own sink guard (R2-30a)", async () => {
    // The identical silent-discard hazard one lane over: a PNG job whose
    // caller forgot the sink would render every frame into the void and
    // "succeed" while producing nothing.
    await expect(runExportJob(deepJob({ mode: "png", deepColor: false }), {})).rejects.toThrow(
      /PNG mode requires hooks\.onFrame/,
    );
  });

  it("a sinked PNG job passes validation and never probes a WebCodecs encoder", async () => {
    const videoProbe = vi.fn();
    const audioProbe = vi.fn();
    vi.stubGlobal("VideoEncoder", { isConfigSupported: videoProbe });
    vi.stubGlobal("AudioEncoder", { isConfigSupported: audioProbe });

    await expect(
      runExportJob(deepJob({ mode: "png", deepColor: false }), { onFrame: () => {} }),
    ).rejects.toThrow(/OffscreenCanvas/);
    expect(videoProbe).not.toHaveBeenCalled();
    expect(audioProbe).not.toHaveBeenCalled();
  });

  it("valid deep jobs pass validation and never probe a WebCodecs encoder", async () => {
    // Deep mode must take the sidecar lane: no VideoEncoder/AudioEncoder
    // config probe, no mediabunny output — even when the job carries a codec
    // field (it is documented as ignored). Stub the encoder globals with
    // recorders; the run then dies at OffscreenCanvas (absent in Node),
    // which is PAST every muxer/encoder branch.
    const videoProbe = vi.fn();
    const audioProbe = vi.fn();
    vi.stubGlobal("VideoEncoder", { isConfigSupported: videoProbe });
    vi.stubGlobal("AudioEncoder", { isConfigSupported: audioProbe });

    await expect(runExportJob(deepJob({ codec: "vp9a" }), { onRawFrame })).rejects.toThrow(
      /OffscreenCanvas/,
    );
    expect(videoProbe).not.toHaveBeenCalled();
    expect(audioProbe).not.toHaveBeenCalled();
  });
});
