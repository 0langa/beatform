import { describe, expect, it } from "vitest";
import { RealtimeAnalyzer } from "./realtimeSource";
import type { AudioEngine } from "./engine";

const SR = 48000;
const FFT = 4096;

/**
 * Minimal AudioEngine stand-in. RealtimeAnalyzer only ever reads the analyser
 * fftSize, pulls time-domain samples, and asks the engine for playing state and
 * clocks — so a real Web Audio graph is not needed to test its CADENCE, which
 * is the thing that has to be right.
 */
function fakeEngine(signal: (t: number) => number) {
  let now = 0;
  const fill = (buf: Float32Array) => {
    // Window ending at the current clock, like a real analyser tap.
    for (let i = 0; i < buf.length; i++) buf[i] = signal(now - (buf.length - 1 - i) / SR);
  };
  const analyser = { fftSize: FFT, getFloatTimeDomainData: fill };
  return {
    engine: {
      analyser,
      analyserL: analyser,
      analyserR: analyser,
      ctx: { sampleRate: SR },
      playing: true,
      duration: 60,
      currentTime: 0,
    } as unknown as AudioEngine,
    setNow: (t: number) => {
      now = t;
    },
  };
}

/**
 * DENSE percussive material, and that density is the whole point.
 *
 * An isolated kick every 0.5 s cannot test this: four seconds yields ~8 beats,
 * far under the 0.14 s refractory ceiling of 28, so the count is pinned by the
 * music and no amount of extra sampling changes it. The first version of this
 * fixture was exactly that, and both mutations below passed against it.
 *
 * Real music keeps spectral flux continuously near the adaptive threshold,
 * which is the regime where each extra frame is another chance to cross. This
 * reproduces it with a deterministic broadband texture plus a busy kick
 * pattern — no Math.random, so every run is the same test.
 */
function dense(t: number): number {
  if (t < 0) return 0;
  // Deterministic hash-noise: cheap, seeded by sample index, no state.
  const i = Math.floor(t * SR);
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  const n = ((h ^ (h >>> 16)) >>> 0) / 0x80000000 - 1;
  let v = 0.18 * n + 0.2 * Math.sin(2 * Math.PI * 55 * t);
  // Kicks every 1/8 s, tight enough that the detector is genuinely busy.
  const s = t % 0.125;
  if (s < 0.03) v += 0.7 * Math.sin(2 * Math.PI * 90 * s) * Math.exp(-s * 120);
  return v;
}

/** Drive the analyser for `seconds` of wall clock at a given refresh rate. */
function runAtRefresh(hz: number, seconds: number) {
  const { engine, setNow } = fakeEngine(dense);
  const ana = new RealtimeAnalyzer(engine);
  const frames = Math.round(seconds * hz);
  let beats = 0;
  for (let n = 0; n < frames; n++) {
    const t = n / hz;
    setNow(t);
    (engine as unknown as { currentTime: number }).currentTime = t;
    if (ana.update(t, t).beat) beats++;
  }
  return beats;
}

describe("RealtimeAnalyzer analysis cadence", () => {
  /**
   * The live counterpart of the offline fixed-cadence guarantee. Before this,
   * the detectors stepped once per animation frame, so a 144 Hz display got
   * 2.4x the chances to fire that the 60 fps export of the same project did —
   * measured on real music, 299 beats against 170 at 30 fps.
   *
   * A live tap cannot replay missed ticks, so refresh rates BELOW 60 Hz analyse
   * at their own rate and are excluded here; that ceiling is inherent, not a
   * bug this can fix.
   */
  it("fires within one beat of the 60 Hz count at 120 and 144 Hz refresh", () => {
    const at60 = runAtRefresh(60, 4);
    // Fixture sanity: the detector must be BUSY, not just non-zero. Under ~15
    // beats in 4 s the refractory pins the count and the test proves nothing.
    expect(at60).toBeGreaterThan(12);
    // Within one, not exact, and that limit is structural. A live tap can only
    // be read on animation-frame boundaries, so on a 144 Hz display the ticks
    // land ~1/60 s apart but never exactly on the 60 Hz grid the export uses;
    // the windows differ slightly and the count can wobble by one. Before this
    // change the same comparison was 2.4x, not one beat.
    for (const hz of [120, 144]) {
      expect(Math.abs(runAtRefresh(hz, 4) - at60), `beats at ${hz} Hz refresh`).toBeLessThanOrEqual(
        1,
      );
    }
  });

  it("a 90 Hz refresh does not fire meaningfully more than a 60 Hz one", () => {
    expect(Math.abs(runAtRefresh(90, 4) - runAtRefresh(60, 4))).toBeLessThanOrEqual(1);
  });

  /**
   * A stall — hidden window, GC pause, a dragged window — leaves the analysis
   * clock owing several ticks. It can only pay them with the ONE window of
   * audio the live tap exposes, so without a cap it would step the detectors
   * repeatedly over a spectrum it has already seen, firing a burst of beats
   * that are not in the music.
   */
  it("does not fire a burst of beats after a long stall", () => {
    // Measured over a full second, not a handful of frames: the refractory
    // allows only one beat per 0.14 s, so a short window cannot tell a healthy
    // analyser from one ticking every frame to work off a backlog.
    // Driven at 144 Hz on purpose. At a 60 Hz refresh a backlog is invisible,
    // because ticking every frame IS the correct rate there — the cap only
    // matters when the display is faster than the analysis clock, which is
    // exactly the case this whole change exists for.
    const HZ = 144;
    const afterStall = (stallSec: number) => {
      const { engine, setNow } = fakeEngine(dense);
      const ana = new RealtimeAnalyzer(engine);
      let t = 0;
      for (let n = 0; n < 2 * HZ; n++, t = n / HZ) {
        setNow(t);
        ana.update(t, t);
      }
      t += stallSec; // one hitch: hidden window, GC pause, a dragged window
      let beats = 0;
      for (let n = 0; n < HZ; n++) {
        setNow(t);
        if (ana.update(t, t).beat) beats++;
        t += 1 / HZ;
      }
      return beats;
    };
    const healthy = afterStall(1 / 60);
    const stalled = afterStall(0.5); // thirty ticks' worth owed at once
    expect(healthy).toBeGreaterThan(3); // fixture sanity
    // Exactly equal, not within one: without the cap this measures healthy 5,
    // stalled 6, and a tolerance of one is precisely wide enough to miss it.
    expect(stalled).toBe(healthy);
  });
});
