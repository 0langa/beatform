import type { SpectrumResolution, SyncSettings } from "../types";
import { analysisFftSize } from "./fftSize";

/** Web Audio's AnalyserNode maximum, and a practical ceiling for export FFTs. */
export const MAX_DISPLAY_FFT_SIZE = 32768;

const RESOLUTION_MULTIPLIER: Record<SpectrumResolution, number> = {
  responsive: 1,
  detailed: 2,
  precise: 4,
};

export function spectrumResolution(sync: SyncSettings): SpectrumResolution {
  return sync.spectrumResolution ?? "responsive";
}

/**
 * Drawn-spectrum transform size. The detector transform never calls this: its
 * ~85 ms window remains governed by analysisFftSize(), preserving sync feel.
 */
export function displaySpectrumFftSize(sampleRate: number, resolution: SpectrumResolution): number {
  return Math.min(
    MAX_DISPLAY_FFT_SIZE,
    analysisFftSize(sampleRate) * RESOLUTION_MULTIPLIER[resolution],
  );
}

export interface SpectrumDiagnostics {
  fftSize: number;
  windowMs: number;
  hzPerBin: number;
  /** Integer, non-DC FFT bins whose centres fall inside selected span. */
  nativeBins: number;
  /** Values handed to renderer. Interpolated mode keeps authored bar budget. */
  displayBins: number;
  measured: boolean;
  axis: "log" | "linear";
}

/** Current mapping, used by UI honesty readout and regression tests. */
export function spectrumDiagnostics(
  sync: SyncSettings,
  sampleRate: number,
  maxDisplayBins = 96,
): SpectrumDiagnostics {
  const safeRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
  const fftSize = displaySpectrumFftSize(safeRate, spectrumResolution(sync));
  const hzPerBin = safeRate / fftSize;
  const nyquist = safeRate / 2;
  const loHz = Math.max(0, sync.freqMin ?? 30);
  const hiHz = Math.min(sync.freqMax ?? 16000, nyquist * 0.99);
  const loBin = Math.max(1, Math.ceil(loHz / hzPerBin));
  const hiBin = Math.min(fftSize / 2 - 1, Math.floor(hiHz / hzPerBin));
  const nativeBins = Math.max(0, hiBin - loBin + 1);
  const measured = sync.spectrumSampling === "measured";
  return {
    fftSize,
    windowMs: (fftSize / safeRate) * 1000,
    hzPerBin,
    nativeBins,
    displayBins: measured ? Math.min(maxDisplayBins, nativeBins) : maxDisplayBins,
    measured,
    // Raw FFT bins are uniformly spaced in hertz. Calling them logarithmic
    // would be false; log mode necessarily resamples into display bands.
    axis: measured ? "linear" : (sync.spectrumAxis ?? "log"),
  };
}
