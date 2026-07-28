/** Canonical cadence for every texture-feedback preset. */
export const FEEDBACK_HZ = 60;
export const FEEDBACK_DT = 1 / FEEDBACK_HZ;

/**
 * Monotonic fixed-step clock used by deterministic export.
 *
 * Tick times derive from integer frame indices, never accumulated floating
 * point deltas. `drainThrough(t)` therefore returns the same state-update grid
 * for 24, 30, 60, 120, or any other presentation rate.
 */
export class FixedFeedbackClock {
  private nextFrame = 0;

  drainThrough(time: number): number[] {
    const ticks: number[] = [];
    while (this.nextFrame / FEEDBACK_HZ <= time + 1e-9) {
      ticks.push(this.nextFrame / FEEDBACK_HZ);
      this.nextFrame++;
    }
    return ticks;
  }
}

/** True when a presentation timestamp is itself on the fixed state grid. */
export function isFeedbackTick(time: number): boolean {
  return Math.abs(time * FEEDBACK_HZ - Math.round(time * FEEDBACK_HZ)) <= 1e-7;
}
