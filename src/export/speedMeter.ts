/**
 * One fps meter for both export lanes (HD-24).
 *
 * Two readings from one stream of (now, done) samples:
 *
 * - `speed` — frames/s over the last SPEED_WINDOW_MS of samples (E4b). A
 *   pure cumulative average rides the encoder-queue fill at render speed for
 *   the first few seconds and then decays toward the real steady-state rate
 *   for the rest of the run ("16 fps -> 7 fps at 16%"); the window tracks
 *   the CURRENT rate instead, so a slow stretch shows up promptly.
 * - `avgSpeed` — done / elapsed since the meter started: the long-run rate,
 *   the number an ETA wants (a window swings with every momentary hiccup).
 *
 * Extracted from exportActions.runExport's inline ring so the batch runner
 * reports the same two numbers for each job instead of its own third one
 * (it used to label the per-job cumulative average `fps`).
 *
 * Pure over the clock it is handed — callers pass `performance.now()`, tests
 * pass whatever they like. Nothing here reads the wall clock.
 */

/** Window width for the `speed` readout. onProgress fires every 10 frames
 * (exportCore.ts), so 5 s covers several samples even on a fast 60 fps job. */
export const SPEED_WINDOW_MS = 5000;

export interface SpeedReading {
  /** Frames/s over the recent window; null until enough recent samples exist. */
  speed: number | null;
  /** Frames/s over the whole run so far; null until the first frame lands. */
  avgSpeed: number | null;
}

export class SpeedMeter {
  private readonly samples: Array<{ t: number; done: number }> = [];

  constructor(
    private readonly startedAt: number,
    private readonly windowMs = SPEED_WINDOW_MS,
  ) {}

  sample(now: number, done: number): SpeedReading {
    // Drop samples older than the window, always keeping at least the one
    // just pushed so the first call of a run never reads an empty ring.
    this.samples.push({ t: now, done });
    const windowStart = now - this.windowMs;
    while (this.samples.length > 1 && this.samples[0].t < windowStart) this.samples.shift();
    const oldest = this.samples[0];
    const windowSecs = (now - oldest.t) / 1000;
    const windowDone = done - oldest.done;
    const elapsed = (now - this.startedAt) / 1000;
    return {
      speed: windowSecs > 0 && windowDone > 0 ? windowDone / windowSecs : null,
      avgSpeed: done > 0 && elapsed > 0 ? done / elapsed : null,
    };
  }
}
