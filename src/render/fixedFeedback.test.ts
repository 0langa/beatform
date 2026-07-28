import { describe, expect, it } from "vitest";
import { FEEDBACK_DT, FEEDBACK_HZ, FixedFeedbackClock, isFeedbackTick } from "./fixedFeedback";

describe("fixed feedback clock", () => {
  it("advances exactly 60 state frames per second at every presentation rate", () => {
    for (const fps of [24, 30, 48, 60, 90, 120, 144]) {
      const clock = new FixedFeedbackClock();
      const ticks: number[] = [];
      for (let n = 0; n < fps; n++) ticks.push(...clock.drainThrough(n / fps));
      ticks.push(...clock.drainThrough(1 - FEEDBACK_DT / 2));

      expect(ticks, `${fps} fps tick count`).toHaveLength(FEEDBACK_HZ);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBeCloseTo(1 - FEEDBACK_DT, 12);
      for (let n = 0; n < ticks.length; n++) {
        expect(ticks[n], `${fps} fps tick ${n}`).toBe(n / FEEDBACK_HZ);
      }
    }
  });

  it("never returns a fixed tick twice across adjacent output frames", () => {
    const clock = new FixedFeedbackClock();
    const ticks = [
      ...clock.drainThrough(0),
      ...clock.drainThrough(1 / 120),
      ...clock.drainThrough(1 / 60),
      ...clock.drainThrough(1 / 30),
    ];
    expect(ticks).toEqual([0, 1 / 60, 2 / 60]);
  });

  it("distinguishes state-grid frames from presentation-only frames", () => {
    expect(isFeedbackTick(0)).toBe(true);
    expect(isFeedbackTick(1 / 60)).toBe(true);
    expect(isFeedbackTick(59 / 60)).toBe(true);
    expect(isFeedbackTick(1 / 120)).toBe(false);
    expect(isFeedbackTick(1 / 24)).toBe(false);
  });
});
