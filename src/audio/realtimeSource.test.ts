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
function fakeEngine(signal: (t: number) => number, liveInput = false) {
  let now = 0;
  let displayReads = 0;
  const fill = (buf: Float32Array) => {
    // Window ending at the current clock, like a real analyser tap.
    for (let i = 0; i < buf.length; i++) buf[i] = signal(now - (buf.length - 1 - i) / SR);
  };
  const analyser = { fftSize: FFT, getFloatTimeDomainData: fill };
  const displayAnalyser = {
    fftSize: FFT,
    getFloatTimeDomainData(buf: Float32Array) {
      displayReads++;
      fill(buf);
    },
  };
  return {
    engine: {
      analyser,
      displayAnalyser,
      analyserL: analyser,
      analyserR: analyser,
      ctx: { sampleRate: SR },
      playing: true,
      liveInput,
      duration: 60,
      currentTime: 0,
    } as unknown as AudioEngine,
    setNow: (t: number) => {
      now = t;
    },
    getDisplayReads: () => displayReads,
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

/**
 * These drive a real 4096-point FFT for every simulated frame — the 144 Hz case
 * alone is ~1700 transforms — so they are seconds of genuine work, not a hang.
 * Vitest's 5 s default left the heaviest one at ~80% of budget on an idle
 * machine and timing out on a busy one, which is a flaky suite rather than a
 * real signal. Shortening the fixtures is not an option: their whole point is
 * that the detector stays BUSY for long enough that the count is decided by the
 * cadence rather than by the refractory.
 */
const SLOW = 30_000;

describe("RealtimeAnalyzer analysis cadence", () => {
  it("does no second transform work on the legacy/default path", () => {
    const { engine, setNow, getDisplayReads } = fakeEngine(dense);
    const ana = new RealtimeAnalyzer(engine);
    for (let n = 0; n < 60; n++) {
      const t = n / 60;
      setNow(t);
      ana.update(t, t);
    }
    expect(getDisplayReads()).toBe(0);
    expect(ana.features.bins).toHaveLength(96);
  });

  it("runs an opt-in long display FFT only on fixed analysis ticks", () => {
    const { engine, setNow, getDisplayReads } = fakeEngine(dense);
    const ana = new RealtimeAnalyzer(engine);
    ana.setSync({
      mode: "kick",
      smooth: 0.5,
      spectrumResolution: "precise",
      spectrumAxis: "linear",
      spectrumSampling: "measured",
      freqMin: 30,
      freqMax: 300,
    });
    for (let n = 0; n < 120; n++) {
      const t = n / 120;
      setNow(t);
      ana.update(t, t);
    }
    expect(engine.analyser.fftSize).toBe(4096);
    expect(engine.displayAnalyser.fftSize).toBe(16384);
    expect(getDisplayReads()).toBe(60);
    expect(ana.features.bins).toHaveLength(92);

    ana.setSync({ mode: "kick", smooth: 0.5 });
    for (let n = 120; n < 180; n++) {
      const t = n / 120;
      setNow(t);
      ana.update(t, t);
    }
    expect(engine.displayAnalyser.fftSize).toBe(4096);
    expect(getDisplayReads()).toBe(60);
    expect(ana.features.bins).toHaveLength(96);
  });

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
  it(
    "fires within one beat of the 60 Hz count at 120 and 144 Hz refresh",
    () => {
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
        expect(
          Math.abs(runAtRefresh(hz, 4) - at60),
          `beats at ${hz} Hz refresh`,
        ).toBeLessThanOrEqual(1);
      }
    },
    SLOW,
  );

  it(
    "a 90 Hz refresh does not fire meaningfully more than a 60 Hz one",
    () => {
      expect(Math.abs(runAtRefresh(90, 4) - runAtRefresh(60, 4))).toBeLessThanOrEqual(1);
    },
    SLOW,
  );

  /**
   * A stall — hidden window, GC pause, a dragged window — leaves the analysis
   * clock owing several ticks. It can only pay them with the ONE window of
   * audio the live tap exposes, so without a cap it would step the detectors
   * repeatedly over a spectrum it has already seen, firing a burst of beats
   * that are not in the music.
   */
  it(
    "does not fire a burst of beats after a long stall",
    () => {
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
    },
    SLOW,
  );
});

/**
 * A stationary, inaudible noise floor — the level a muted output device still
 * hands back when the driver's own processing (APOs, "audio enhancements")
 * injects dither or hum instead of digital zeros.
 *
 * dBFS is a PEAK spec here: `amp` is the largest sample the signal reaches, so
 * a threshold expressed the same way can be reasoned about directly.
 */
function hum(dbfs: number): (t: number) => number {
  const amp = Math.pow(10, dbfs / 20);
  return (t) => {
    if (t < 0) return 0;
    const i = Math.floor(t * SR);
    let h = Math.imul(i ^ 0x27d4eb2f, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x9e3779b1);
    const n = ((h ^ (h >>> 16)) >>> 0) / 0x80000000 - 1;
    // A little 50 Hz mains buzz plus broadband dither, scaled to the peak.
    return amp * (0.7 * Math.sin(2 * Math.PI * 50 * t) + 0.3 * n);
  };
}

function runLive(
  signal: (t: number) => number,
  seconds: number,
  liveInput: boolean,
): { beats: number; maxDrive: number; maxBin: number; maxBeatIntensity: number } {
  const { engine, setNow } = fakeEngine(signal, liveInput);
  const ana = new RealtimeAnalyzer(engine);
  ana.reset("source");
  let beats = 0;
  let maxDrive = 0;
  let maxBin = 0;
  let maxBeatIntensity = 0;
  const frames = Math.round(seconds * 60);
  for (let n = 0; n < frames; n++) {
    const t = n / 60;
    setNow(t);
    const f = ana.update(t, t);
    if (f.beat) beats++;
    maxDrive = Math.max(maxDrive, f.drive);
    maxBeatIntensity = Math.max(maxBeatIntensity, f.beatIntensity);
    for (let i = 0; i < f.bins.length; i++) maxBin = Math.max(maxBin, f.bins[i]);
  }
  return { beats, maxDrive, maxBin, maxBeatIntensity };
}

describe("RealtimeAnalyzer live-input silence gate", () => {
  /**
   * BUG-002: system-audio visualization "pumps" and throws beat spikes with
   * nothing playing. Exact digital zeros already render flat, so the report
   * only reproduces on a driver that hands back a NOISE FLOOR — and the chain
   * amplifies one: the sync scale bottoms out at -90 dBFS, bandMean multiplies
   * by 1.6, attack is four times faster than release (so every wiggle reads as
   * a pulse), and the flux detectors carry absolute floors low enough that
   * stationary noise crosses them by chance.
   *
   * -68 dBFS is roughly 22 dB SPL at a normal listening level: below a quiet
   * room's own noise floor, and nothing a user could call "system audio".
   */
  it("renders an inaudible noise floor as silence in live mode", () => {
    const r = runLive(hum(-68), 4, true);
    expect(r.beats, "beats fired on a silent system").toBe(0);
    expect(r.maxBeatIntensity).toBe(0);
    expect(r.maxDrive).toBeLessThan(0.001);
    expect(r.maxBin).toBeLessThan(0.001);
  });

  /**
   * The gate is deliberately live-input-only. Track playback has an EXPORT that
   * must match it frame for frame, and a gate is a hard nonlinearity that the
   * offline path does not have — so applying it there would trade this bug for
   * a preview-versus-export divergence. Live capture has no export counterpart,
   * which is exactly why it can afford one.
   */
  it("leaves the same floor alone for track playback", () => {
    const r = runLive(hum(-68), 4, false);
    expect(r.maxBin, "track preview must be unchanged").toBeGreaterThan(0.05);
  });

  it(
    "passes real programme material through untouched",
    () => {
      const live = runLive(dense, 4, true);
      const track = runLive(dense, 4, false);
      expect(live.beats).toBe(track.beats);
      expect(live.maxBin).toBeCloseTo(track.maxBin, 6);
      expect(live.maxDrive).toBeCloseTo(track.maxDrive, 6);
    },
    SLOW,
  );

  /** Music that ducks to nothing and comes back must not lose the return —
   * a gate that needs re-arming would eat the first hit after every break. */
  it("reopens on the first frame of real audio after a silent stretch", () => {
    const gap = (t: number) => (t < 2 ? hum(-68)(t) : dense(t - 2));
    const { engine, setNow } = fakeEngine(gap, true);
    const ana = new RealtimeAnalyzer(engine);
    ana.reset("source");
    let firstAudible = -1;
    for (let n = 0; n < 60 * 4; n++) {
      const t = n / 60;
      setNow(t);
      const f = ana.update(t, t);
      if (firstAudible < 0 && f.bins.some((v) => v > 0.05)) firstAudible = n;
    }
    // 2 s is frame 120; allow the analyser's own 4096-sample window to fill.
    expect(firstAudible).toBeGreaterThanOrEqual(120);
    expect(firstAudible).toBeLessThan(126);
  });
});
