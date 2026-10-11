import { describe, expect, it } from "vitest";
import { SPEED_WINDOW_MS, SpeedMeter, etaLabel } from "./speedMeter";

/**
 * HD-24 — one fps meter for both export lanes.
 *
 * The windowed-vs-cumulative arithmetic used to live inline in
 * exportActions.runExport (E4b) while the batch runner kept its own,
 * different number (a per-job cumulative average it labelled `fps`). Two
 * readouts computed two ways is exactly how the panels came to disagree
 * about what "fps" means. The meter is the single definition; this pins its
 * arithmetic so each lane's test only has to prove it CALLS the meter.
 */
describe("SpeedMeter", () => {
  it("reads null on the very first sample — nothing recent to divide by yet", () => {
    const m = new SpeedMeter(0);
    const r = m.sample(100, 10);
    expect(r.speed).toBeNull();
    // The cumulative average has an elapsed to divide by from sample one.
    expect(r.avgSpeed).toBeCloseTo(100, 5);
  });

  it("windows to the recent stretch while the average remembers the whole run (E4b)", () => {
    const m = new SpeedMeter(0);
    // Fast: 100 frames over 1000 ms (100 fps), a sample every 10 frames.
    for (let i = 1; i <= 10; i++) m.sample(i * 100, i * 10);
    // Slow: 100 more frames over the next 5800 ms (~16.7 fps) — long enough
    // that the 5 s window has slid entirely past the fast phase.
    let last = m.sample(1000 + 580, 110);
    for (let i = 2; i <= 10; i++) last = m.sample(1000 + i * 580, 100 + i * 10);

    expect(last.speed).not.toBeNull();
    expect(last.speed!).toBeGreaterThan(14);
    expect(last.speed!).toBeLessThan(19);
    expect(last.avgSpeed).toBeCloseTo(200 / 6.8, 5);
    expect(last.avgSpeed!).toBeGreaterThan(last.speed! + 5);
  });

  it("keeps at least the newest sample when everything else has aged out", () => {
    const m = new SpeedMeter(0);
    m.sample(100, 10);
    // A gap far wider than the window: the only sample left is the one just
    // pushed, so the windowed rate honestly reads null rather than dividing
    // by a zero-width window.
    const r = m.sample(100 + SPEED_WINDOW_MS * 4, 20);
    expect(r.speed).toBeNull();
    expect(r.avgSpeed).toBeCloseTo(20 / ((100 + SPEED_WINDOW_MS * 4) / 1000), 5);
  });

  it("reports null for both before any frame has landed", () => {
    const m = new SpeedMeter(0);
    const r = m.sample(500, 0);
    expect(r.speed).toBeNull();
    expect(r.avgSpeed).toBeNull();
  });
});

/**
 * The export dialog's time-left readout. It reads the long-run average
 * (avgSpeed), never the window, and stays silent until the run is past the
 * startup burst — a first-second estimate is the one users learn to ignore.
 */
describe("etaLabel", () => {
  it("is silent before the run is 5% through, without an average, or when done", () => {
    expect(etaLabel(4, 100, 10)).toBeNull();
    expect(etaLabel(50, 100, null)).toBeNull();
    expect(etaLabel(50, 100, undefined)).toBeNull();
    expect(etaLabel(50, 100, 0)).toBeNull();
    expect(etaLabel(100, 100, 10)).toBeNull();
    expect(etaLabel(0, 0, 10)).toBeNull();
  });

  it("reads the remaining frames over the long-run average", () => {
    // 900 frames left at 30 fps = 30 s.
    expect(etaLabel(100, 1000, 30)).toBe("about 30 s left");
    // 7200 frames left at 40 fps = 180 s.
    expect(etaLabel(800, 8000, 40)).toBe("about 3 min left");
  });

  it("uses coarse steps a user can read at a glance", () => {
    expect(etaLabel(95, 100, 1)).toBe("a few seconds left"); // 5 s
    expect(etaLabel(50, 100, 50 / 57)).toBe("about 55 s left"); // 57 s → 55
    expect(etaLabel(10, 100, 90 / 59)).toBe("about 1 min left"); // 59 s → never "60 s"
    expect(etaLabel(10, 100, 90 / 3900)).toBe("about 1 h 5 min left"); // 65 min
  });
});
