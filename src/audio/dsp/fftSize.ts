/**
 * Analysis FFT size for a given context sample rate.
 *
 * Beatform creates its AudioContext without forcing a rate, so it inherits the
 * output device's — commonly 44.1 or 48 kHz, but 96 and 192 kHz interfaces are
 * ordinary. The transform size was a hardcoded 4096 regardless, which fixes the
 * number of BINS instead of the analysis WINDOW. A 96 kHz device therefore
 * analysed half the time window and twice the bin spacing as everyone else, and
 * the effect on what it drew was not subtle: `bassRange` spans 10 bins at
 * 48 kHz but only 5 at 96 kHz, and `bandMean` divides by the bin count, so
 * identical audio measured mean bass 0.526 at 48 kHz against 0.904 at 96 kHz —
 * a 72% overread driving every modulation route on that machine.
 *
 * Sizing by rate holds the window near the 48 kHz reference (~85 ms) instead,
 * which also holds bins-per-hertz constant — so band widths, flux sums and the
 * detectors' absolute floors all keep their meaning across devices.
 *
 *   <= 48 kHz          4096     85.3 ms at 48 k, 92.9 ms at 44.1 k
 *   88.2 / 96 kHz      8192     85.3 ms at 96 k
 *   176.4 / 192 kHz   16384     85.3 ms at 192 k
 *
 * Rates at or below 48 kHz stay at 4096, so the common case is untouched and
 * the golden trace cannot move. The floor is not lowered for unusual low rates
 * either: WAVEFORM_LENGTH is 3072 and the zero-crossing trigger needs the
 * window to exceed it.
 */
export function analysisFftSize(sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 4096;
  if (sampleRate <= 48000) return 4096;
  if (sampleRate <= 96000) return 8192;
  return 16384;
}
