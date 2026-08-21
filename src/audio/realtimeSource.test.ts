import { describe, expect, it } from "vitest";
import { RealtimeAnalyzer } from "./realtimeSource";
import { sectionStateAt } from "./analysis/sections";
import { vocalPresenceAt } from "./vocalPresence";
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
  const raw = {
    analyser,
    displayAnalyser,
    analyserL: analyser,
    analyserR: analyser,
    ctx: { sampleRate: SR },
    playing: true,
    liveInput,
    duration: 60,
    currentTime: 0,
  };
  return {
    engine: raw as unknown as AudioEngine,
    setNow: (t: number) => {
      now = t;
    },
    // The real engine's getter is `_playing || liveNode !== null` (live input
    // COUNTS as playing) and flips false on pause() and on natural track end
    // (onended). Tests drive the flag directly.
    setPlaying: (v: boolean) => {
      raw.playing = v;
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
 * TIMEOUTS: every describe here carries an explicit 30 s budget rather than
 * vitest's 5 s default.
 *
 * These tests drive a real 4096-point FFT for every simulated frame — the
 * 144 Hz case alone is ~1700 transforms — so they are seconds of genuine work,
 * not a hang. Nothing in this file asserts wall-clock timing; the analyser's
 * clock is the `setNow` fixture. So the 5 s default was the only load-sensitive
 * failure mode, and it is the file's worst: the heaviest test measured 2.3 s in
 * a normal full-suite run and 4.2 s with the pool oversubscribed 2:1, i.e. one
 * loaded machine away from a red run that means nothing.
 *
 * The budget lives on the DESCRIBES, not on individual `it`s, which is the
 * point of this shape. The per-test form it replaced covered the four tests
 * that were measured as heaviest and left three others in the same class
 * (~1.5 s oversubscribed) on the default — the same gap that made
 * `featurePipelineFuzz.test.ts` tip over long after the suites around it were
 * fixed. Same remedy as `dspCharacterization.test.ts` and `store.test.ts`; see
 * GATES.md §1. Shortening the fixtures is not an option: their whole point is
 * that the detector stays BUSY for long enough that the count is decided by the
 * cadence rather than by the refractory.
 */
const SUITE = { timeout: 30_000 };

describe("RealtimeAnalyzer analysis cadence", SUITE, () => {
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

describe("RealtimeAnalyzer P-15 fuel fields", SUITE, () => {
  it("resolves grid, section and vocal fuel from track time via the shared helpers", () => {
    const { engine, setNow } = fakeEngine(dense);
    const ana = new RealtimeAnalyzer(engine);
    const grid = {
      bpm: 120,
      beatTimes: new Float32Array(Array.from({ length: 16 }, (_, i) => i * 0.5)),
      hopSec: 0.01,
    };
    const sections = [1.0];
    const spans = [{ start: 0.4, end: 0.8 }];
    ana.setBeatGrid(grid);
    ana.setSections(sections);
    ana.setVocalSpans(spans);
    for (let n = 0; n < 120; n++) {
      const t = n / 60;
      setNow(t);
      const f = ana.update(t, t);
      // The live path resolves each value through the SAME pure helpers the
      // offline path calls with its frame clock — asserting against them here
      // asserts live/offline agreement by construction.
      const s = sectionStateAt(sections, t);
      expect(f.sectionIndex).toBe(s.sectionIndex);
      expect(f.sectionPulse).toBe(s.sectionPulse);
      expect(f.vocal).toBe(vocalPresenceAt(spans, t));
      expect(f.beatIndex).toBe(Math.min(15, Math.floor(t / 0.5)));
      expect(f.barIndex).toBe(Math.floor(Math.min(15, Math.floor(t / 0.5)) / 4));
    }
  });

  it("detaching the analyses stops driving the fields (they hold, like bpm)", () => {
    const { engine, setNow } = fakeEngine(dense);
    const ana = new RealtimeAnalyzer(engine);
    ana.setBeatGrid({
      bpm: 174,
      beatTimes: new Float32Array(Array.from({ length: 8 }, (_, i) => i * 0.5)),
      hopSec: 0.01,
    });
    ana.setSections([0.5]);
    ana.setVocalSpans([{ start: 0, end: 10 }]);
    setNow(1);
    const f = ana.update(1, 1);
    expect(f.sectionIndex).toBe(1);
    expect(f.vocal).toBe(1);
    expect(f.bpm).toBe(174);
    ana.setBeatGrid(null);
    ana.setSections(null);
    ana.setVocalSpans(null);
    setNow(1 + 1 / 60);
    const g = ana.update(1 + 1 / 60, 1 + 1 / 60);
    expect(g.sectionIndex).toBe(1); // held — the keep-previous convention
    expect(g.vocal).toBe(1);
    expect(g.bpm).toBe(174); // detach mid-track HOLDS: same audio, same tempo
    ana.reset("source"); // a source change clears them to the honest unknowns
    setNow(1 + 2 / 60);
    const h = ana.update(1 + 2 / 60, 1 + 2 / 60);
    expect(h.sectionIndex).toBe(-1);
    expect(h.vocal).toBe(0);
    // R2-32a: the grid readouts clear too — tempo-locked LFOs must fall back
    // to their documented no-grid behaviour instead of running the dead
    // track's BPM until the new track's analysis lands.
    expect(h.bpm).toBe(0);
    expect(h.beatPhase).toBe(0);
    expect(h.barPhase).toBe(0);
  });
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

describe("RealtimeAnalyzer live-input silence gate", SUITE, () => {
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

  it("passes real programme material through untouched", () => {
    const live = runLive(dense, 4, true);
    const track = runLive(dense, 4, false);
    expect(live.beats).toBe(track.beats);
    expect(live.maxBin).toBeCloseTo(track.maxBin, 6);
    expect(live.maxDrive).toBeCloseTo(track.maxDrive, 6);
  });

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

/**
 * The feedback tick pause gate (2.104.2). `feedbackTicked` is the live
 * loop's ONLY license to advance texture-feedback state (Spectro Falls'
 * record, Overgrowth's chemistry) — the renderer steps those by a fixed
 * FEEDBACK_DT on every advance directive. The tick used to be pure wall
 * clock, so paused frames kept advancing state at frozen track time:
 * Spectro Falls scrolled one silence-recording slice per tick and drained
 * its whole 180-slice record in ~3 s of pause (device-confirmed, filed in
 * BACKLOG's 2.103.0 entry). The gate: a tick is only REPORTED while the
 * engine is playing. `engine.playing` is `_playing || liveNode !== null`,
 * so live capture stays alive, natural track end holds the record like a
 * pause, and an A-B wrap (playing throughout) can never freeze the stream —
 * no track-time comparison exists to mishandle the backward jump.
 *
 * The DETECTOR clock is deliberately not gated: paused frames still step
 * the pipeline (whose detectors already gate their FIRING on `playing`), so
 * meters and bins keep decaying to silence exactly as shipped.
 */
describe("RealtimeAnalyzer feedback tick pause gate", SUITE, () => {
  /** Drive one frame at 60 Hz wall clock and report whether it ticked. */
  function frame(
    ana: RealtimeAnalyzer,
    setNow: (t: number) => void,
    n: number,
    trackTime: number,
  ): boolean {
    const t = n / 60;
    setNow(t);
    ana.update(t, trackTime);
    return ana.feedbackTicked;
  }

  it("reports no feedback ticks while paused — the record must hold, not drain", () => {
    const { engine, setNow, setPlaying } = fakeEngine(dense);
    const ana = new RealtimeAnalyzer(engine);
    let playingTicks = 0;
    for (let n = 0; n < 60; n++) if (frame(ana, setNow, n, n / 60)) playingTicks++;
    expect(playingTicks, "fixture sanity: the live clock ticks every 60 Hz frame").toBe(60);

    // Pause: track time freezes, the rAF loop keeps calling update on the
    // wall clock. The fake keeps handing back LOUD audio on purpose — even a
    // hot analyser window must not advance feedback while paused (the real
    // tap decays to silence, which is what made the drain record emptiness).
    setPlaying(false);
    const frozen = 1;
    let pausedTicks = 0;
    for (let n = 60; n < 60 * 4; n++) if (frame(ana, setNow, n, frozen)) pausedTicks++;
    expect(pausedTicks, "paused frames reported feedback ticks — the record drains").toBe(0);
  });

  it("a paused seek or scrub never advances feedback (the record is kept, not replayed)", () => {
    const { engine, setNow, setPlaying } = fakeEngine(dense);
    const ana = new RealtimeAnalyzer(engine);
    for (let n = 0; n < 30; n++) frame(ana, setNow, n, n / 60);
    setPlaying(false);

    let ticks = 0;
    // Forward scrub: the seek bar dragged right — track time advances in
    // steps while paused. Deliberately WITHOUT reset("seek") so the gate
    // itself is what's under test (a "time advanced?" comparison would leak
    // one tick per scrub step and drain the record while scrubbing).
    let pos = 0.5;
    for (let n = 30; n < 90; n++) {
      if (n % 5 === 0) pos += 0.4;
      if (frame(ana, setNow, n, pos)) ticks++;
    }
    // Backward seek: the store fires reset("seek") on every seek, and the
    // loop does too for backward jumps — mirror the callers.
    pos = 0.25;
    ana.reset("seek");
    for (let n = 90; n < 150; n++) if (frame(ana, setNow, n, pos)) ticks++;
    expect(ticks, "a paused seek/scrub advanced feedback state").toBe(0);
  });

  it("an A-B loop wrap does not freeze the tick stream (backward jump while playing)", () => {
    const { engine, setNow } = fakeEngine(dense);
    const ana = new RealtimeAnalyzer(engine);
    for (let n = 0; n < 60; n++) frame(ana, setNow, n, 4 + n / 60);
    // The wrap: track time jumps BACKWARD while playing stays true. The live
    // loop detects it (loopEpoch / backward jump) and calls reset("seek")
    // before the next update — reproduce that exact call order here.
    ana.reset("seek");
    let ticksAfterWrap = 0;
    let firstTickFrame = -1;
    for (let n = 60; n < 120; n++) {
      if (frame(ana, setNow, n, 1 + (n - 60) / 60)) {
        ticksAfterWrap++;
        if (firstTickFrame < 0) firstTickFrame = n - 60;
      }
    }
    // reset() zeroes the accumulator, so the first post-wrap tick owes one
    // full ANALYSIS_DT — arriving within two frames, then every frame.
    expect(firstTickFrame, "first tick after the wrap").toBeLessThanOrEqual(2);
    expect(ticksAfterWrap).toBeGreaterThanOrEqual(58);
  });

  it("resume after pause: the first tick lands within two frames and cadence continues", () => {
    const { engine, setNow, setPlaying } = fakeEngine(dense);
    const ana = new RealtimeAnalyzer(engine);
    for (let n = 0; n < 30; n++) frame(ana, setNow, n, n / 60);
    setPlaying(false);
    let pausedTicks = 0;
    for (let n = 30; n < 90; n++) if (frame(ana, setNow, n, 0.5)) pausedTicks++;
    expect(pausedTicks).toBe(0);
    setPlaying(true);
    let firstTickFrame = -1;
    let resumedTicks = 0;
    for (let n = 90; n < 150; n++) {
      if (frame(ana, setNow, n, 0.5 + (n - 90) / 60)) {
        resumedTicks++;
        if (firstTickFrame < 0) firstTickFrame = n - 90;
      }
    }
    expect(firstTickFrame, "first tick after resume").toBeLessThanOrEqual(2);
    expect(resumedTicks).toBeGreaterThanOrEqual(58);
  });

  it("playback cadence is untouched: every frame at 60 Hz, the 60/s subset at 144 Hz, live included", () => {
    // 60 Hz track playback: exactly one tick per frame (matches export).
    const track = fakeEngine(dense);
    const anaTrack = new RealtimeAnalyzer(track.engine);
    let at60 = 0;
    for (let n = 0; n < 60; n++) if (frame(anaTrack, track.setNow, n, n / 60)) at60++;
    expect(at60).toBe(60);

    // Live capture: engine.playing is true by the getter's definition
    // (`_playing || liveNode !== null`) — the gate must never dry up a
    // live session, which has no pause concept at all.
    const live = fakeEngine(dense, true);
    const anaLive = new RealtimeAnalyzer(live.engine);
    let liveTicks = 0;
    for (let n = 0; n < 60; n++) if (frame(anaLive, live.setNow, n, n / 60)) liveTicks++;
    expect(liveTicks).toBe(60);

    // 144 Hz display: ticks on the ~60/s subset of frames, exactly as the
    // analysis-cadence suite above pins for the detectors.
    const hi = fakeEngine(dense);
    const anaHi = new RealtimeAnalyzer(hi.engine);
    let at144 = 0;
    for (let n = 0; n < 288; n++) {
      const t = n / 144;
      hi.setNow(t);
      anaHi.update(t, t);
      if (anaHi.feedbackTicked) at144++;
    }
    expect(at144).toBeGreaterThanOrEqual(118);
    expect(at144).toBeLessThanOrEqual(121);
  });
});

/**
 * R2-32d: the LUFS meter freezes with playback. While paused, the analyser
 * tap decays to digital zeros, and feeding those into the meter filled its
 * 400 ms momentary window with silence — so although f.lufs itself froze on
 * pause (the pipeline's keep-previous rule), the FIRST ~400 ms after every
 * resume read a deep dip that the audio never contained. Skipping
 * meter.process while !playing freezes the momentary exactly like f.lufs.
 */
describe("RealtimeAnalyzer LUFS meter pause freeze (R2-32d)", SUITE, () => {
  it("60 paused frames of zero windows, then resume: momentary within 0.5 LU immediately", () => {
    let silent = false;
    const sig = (t: number) => (silent || t < 0 ? 0 : 0.35 * Math.sin(2 * Math.PI * 220 * t));
    const { engine, setNow, setPlaying } = fakeEngine(sig);
    const ana = new RealtimeAnalyzer(engine);
    let f = ana.features;
    for (let n = 0; n < 120; n++) {
      const t = n / 60;
      setNow(t);
      f = ana.update(t, t);
    }
    const before = f.lufs;
    expect(before).toBeGreaterThan(-30); // fixture sanity: a real level

    // Pause: playback stops and the tap hands back zero windows.
    setPlaying(false);
    silent = true;
    for (let n = 120; n < 180; n++) {
      const t = n / 60;
      setNow(t);
      f = ana.update(t, t);
    }
    expect(f.lufs).toBe(before); // f.lufs freezes on pause — unchanged rule

    // Resume: the very FIRST playing frame must read the pre-pause level,
    // not a window still 400 ms deep in pause silence.
    setPlaying(true);
    silent = false;
    setNow(3);
    f = ana.update(3, 3);
    expect(Math.abs(f.lufs - before), `resumed at ${f.lufs} vs ${before}`).toBeLessThan(0.5);
  });
});

/**
 * willTick (R2-25): the live loop's license to SKIP a whole feature update on
 * a frame the fps cap will not present. It must be exactly update()'s own
 * analysisTick decision — same dt fallback, same accumulator, same epsilon —
 * or a capped display would either drop canonical 60 Hz ticks (feedback state
 * falls behind, detectors miss steps) or burn updates it meant to skip. The
 * suite pins exactness three ways: frame-for-frame agreement under jitter,
 * agreement under the cap-gated call pattern where tickless frames are never
 * delivered at all, and purity (asking never moves the clock).
 */
describe("RealtimeAnalyzer willTick prediction (R2-25)", SUITE, () => {
  /** Deterministic timestamp jitter, ±1.5 ms — rAF timestamps are never
   * perfectly gridded, and the epsilon arithmetic must survive that. */
  const jittered = (n: number, hz: number) => n / hz + 0.0015 * Math.sin(n * 0.73);

  it("matches update()'s own tick decision frame-for-frame, jitter included", () => {
    const { engine, setNow } = fakeEngine(dense);
    const ana = new RealtimeAnalyzer(engine);
    for (let n = 0; n < 400; n++) {
      const t = Math.max(0, jittered(n, 144));
      const predicted = ana.willTick(t);
      setNow(t);
      ana.update(t, t);
      // playing is true throughout, so feedbackTicked IS the tick decision.
      expect(ana.feedbackTicked, `frame ${n}`).toBe(predicted);
    }
  });

  it("stays exact when tickless frames are never delivered (the cap-gated call pattern)", () => {
    // Twin analyzers on the same clock: the reference sees every frame, the
    // gated one only the frames services.ts would deliver under a 30 fps cap
    // (presented frames + predicted ticks). The canonical tick stream must
    // land on IDENTICAL frames — the accumulator owes the same total time
    // whether it arrived as many small dts or one spanning dt.
    const CAP = 30;
    const HZ = 144;
    const FRAMES = 288; // 2 s
    const ref = fakeEngine(dense);
    const anaRef = new RealtimeAnalyzer(ref.engine);
    const gated = fakeEngine(dense);
    const anaGated = new RealtimeAnalyzer(gated.engine);

    const refTickFrames: number[] = [];
    const gatedTickFrames: number[] = [];
    let updates = 0;
    let lastCapDraw = -1e9;
    for (let n = 0; n < FRAMES; n++) {
      const t = Math.max(0, jittered(n, HZ));
      ref.setNow(t);
      anaRef.update(t, t);
      if (anaRef.feedbackTicked) refTickFrames.push(n);

      // services.ts's own gate, verbatim: skip when the cap skips AND no
      // tick is owed.
      const tMs = t * 1000;
      const capSkipped = tMs - lastCapDraw < 1000 / CAP - 1;
      if (!capSkipped) lastCapDraw = tMs;
      if (capSkipped && !anaGated.willTick(t)) continue;
      gated.setNow(t);
      anaGated.update(t, t);
      updates++;
      if (anaGated.feedbackTicked) gatedTickFrames.push(n);
    }

    expect(gatedTickFrames, "tick frames under the cap gate").toEqual(refTickFrames);
    expect(refTickFrames.length).toBeGreaterThanOrEqual(118);
    // The point of the gate: far fewer updates than frames (288 here), yet
    // never fewer than the tick stream needs.
    expect(updates).toBeGreaterThanOrEqual(refTickFrames.length);
    expect(updates).toBeLessThan(FRAMES * 0.65);
  });

  it("predicts a tick for the first-ever frame and immediately after reset", () => {
    const { engine, setNow } = fakeEngine(dense);
    const ana = new RealtimeAnalyzer(engine);
    // First frame: update() assumes dt = 1/60, which is exactly one owed tick.
    expect(ana.willTick(0.42)).toBe(true);
    setNow(0.42);
    ana.update(0.42, 0.42);
    expect(ana.feedbackTicked).toBe(true);
    // reset() nulls lastFrameAt, so the next frame is "first" again — the
    // priming frame must never be skippable regardless of cap state.
    ana.reset("seek");
    expect(ana.willTick(0.421)).toBe(true);
  });

  it("is pure: asking repeatedly never moves the clock", () => {
    const { engine, setNow } = fakeEngine(dense);
    const ana = new RealtimeAnalyzer(engine);
    setNow(0);
    ana.update(0, 0);
    const t = 1 / 144; // too soon for the next tick
    const first = ana.willTick(t);
    for (let i = 0; i < 10; i++) expect(ana.willTick(t)).toBe(first);
    expect(first).toBe(false);
    // The clock still ticks at its own time afterwards.
    expect(ana.willTick(1 / 60 + 1e-6)).toBe(true);
  });
});
