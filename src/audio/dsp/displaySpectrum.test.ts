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
  });
});
