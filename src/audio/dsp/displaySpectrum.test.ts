import { describe, expect, it } from "vitest";
import { displaySpectrumFftSize, spectrumDiagnostics } from "./displaySpectrum";
import { DEFAULT_SYNC } from "../types";

describe("drawn-spectrum resolution", () => {
  it("offers 1x/2x/4x display windows without changing detector sizing", () => {
    expect(displaySpectrumFftSize(48000, "responsive")).toBe(4096);
    expect(displaySpectrumFftSize(48000, "detailed")).toBe(8192);
    expect(displaySpectrumFftSize(48000, "precise")).toBe(16384);
  });

  it("stays within Web Audio's 32768-point analyser ceiling", () => {
    expect(displaySpectrumFftSize(192000, "precise")).toBe(32768);
  });

  it("reports 92 real bins for a 30-300 Hz precise linear spectrum at 48 kHz", () => {
    const d = spectrumDiagnostics(
      {
        ...DEFAULT_SYNC,
        freqMin: 30,
        freqMax: 300,
        spectrumResolution: "precise",
        spectrumAxis: "linear",
        spectrumSampling: "measured",
      },
      48000,
    );
    expect(d.fftSize).toBe(16384);
    expect(d.windowMs).toBeCloseTo(341.333, 3);
    // Asymmetric display window: latency is the peak offset E = N/8, not the
    // symmetric window's N/2 (which would be ~171 ms here).
    expect(d.latencyMs).toBeCloseTo(42.667, 3);
    expect(d.hzPerBin).toBeCloseTo(2.9296875, 8);
    expect(d.nativeBins).toBe(92);
    expect(d.displayBins).toBe(92);
    expect(d.axis).toBe("linear");
  });

  it("keeps legacy defaults at 96 log-spaced interpolated bands", () => {
    const d = spectrumDiagnostics(DEFAULT_SYNC, 48000);
    expect(d.fftSize).toBe(4096);
    expect(d.displayBins).toBe(96);
    expect(d.measured).toBe(false);
    expect(d.axis).toBe("log");
    // Responsive shares the detector's symmetric Hann, whose peak weight
    // sits at (N-1)/2 — the same half-sample honesty as
    // RealFFT.peakOffsetSamples, not the rounded-up N/2 (R2-32f).
    expect(d.latencyMs).toBeCloseTo(((4096 - 1) / 2 / 48000) * 1000, 6);
  });

  it("reports the asymmetric peak-offset latency for the longer windows", () => {
    const detailed = spectrumDiagnostics(
      { ...DEFAULT_SYNC, spectrumResolution: "detailed" },
      48000,
    );
    expect(detailed.windowMs).toBeCloseTo(170.667, 3);
    expect(detailed.latencyMs).toBeCloseTo(21.333, 3); // round(8192/8) samples
    const precise = spectrumDiagnostics({ ...DEFAULT_SYNC, spectrumResolution: "precise" }, 48000);
    expect(precise.latencyMs).toBeCloseTo(42.667, 3); // round(16384/8) samples
    // The honesty readout's whole point: latency no longer scales with the
    // window; a 341 ms window is not a 171 ms-late display.
    expect(precise.latencyMs).toBeLessThan(precise.windowMs / 4);
  });
});
