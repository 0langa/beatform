import { describe, expect, it } from "vitest";
import { OfflineAnalyzer } from "./offlineSource";
import type { AudioFeatures, PcmData, SyncSettings } from "./types";
import { DEFAULT_SYNC } from "./types";

/**
 * DSP CHARACTERIZATION SUITE
 *
 * These tests pin what the analysis pipeline does TODAY across sample rates and
 * frame rates. They are not a specification. Two of them deliberately assert
 * BROKEN values, marked "pinned defect", so that the fix has to come past this
 * file and say so:
 *
 *   - 96 kHz reads bass 72 % higher than 48 kHz on identical audio, because the
 *     FFT size is fixed while the bin grid is not.
 *   - a DC offset pegs the lowest band once the analysed span reaches 10 Hz.
 *
 * The existing coverage could not see any of this: `featurePipeline.test.ts`
 * synthesises `magDb` directly rather than going through the FFT, and its only
 * cross-fps assertion compares beat TIMES with a 50 ms tolerance. Everything
 * here runs the real `OfflineAnalyzer` — real windowing, real FFT, real
 * pipeline — over generated PCM at several sample rates.
 *
 * Every assertion here has been mutation-checked: the constant it guards was
 * perturbed and the test confirmed to fail before the perturbation was
 * reverted. That step is not optional. Writing this suite, two separate
 * mutations passed all 906 tests in the repo, and one of the fixtures was
 * saturated at 1.0 and measuring nothing — none of which was visible from a
 * green run.
 *
 * Mutations already known to be caught by OTHER tests (the golden trace and
 * `featurePipeline.test.ts`) are deliberately not duplicated here: the main
 * beat detector's dt scaling, DISPLAY_GAMMA, the bass band's upper edge, and
 * the attack/release asymmetry.
 */

// ---------------------------------------------------------------- generators

/** Deterministic LCG. Math.random would make every run a different test. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function makePcm(
  sampleRate: number,
  duration: number,
  fn: (t: number, i: number) => number,
  channels = 1,
): PcmData {
  const length = Math.round(sampleRate * duration);
  const ch: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) data[i] = fn(i / sampleRate, i);
    ch.push(data);
  }
  return { sampleRate, duration, length, channels: ch };
}

const silence = (sr: number, dur = 2) => makePcm(sr, dur, () => 0);

/** Sine landing exactly on an FFT bin centre for the given transform size. */
function binCentredSine(sr: number, dur = 2, fftSize = 4096, bin = 40): PcmData {
  const hz = (bin * sr) / fftSize;
  return makePcm(sr, dur, (t) => 0.5 * Math.sin(2 * Math.PI * hz * t));
}

/** Sine landing exactly between two bin centres — worst case for leakage. */
function offBinSine(sr: number, dur = 2, fftSize = 4096, bin = 40): PcmData {
  const hz = ((bin + 0.5) * sr) / fftSize;
  return makePcm(sr, dur, (t) => 0.5 * Math.sin(2 * Math.PI * hz * t));
}

/**
 * Two bass partials 8 Hz apart: resolvable only by a long enough window.
 *
 * Amplitude 0.01 is deliberate and load-bearing. `bandMean` ends in
 * `clamp01((s / n) * 1.6)`, so a healthy 0.35 saturates the bass band to
 * exactly 1.0 at EVERY sample rate — which silently hid the whole
 * sample-rate defect behind the clamp when this fixture was first written.
 * Keep the level well below saturation or these tests measure the clamp.
 */
const twoBassTones = (sr: number, dur = 2, amp = 0.01) =>
  makePcm(
    sr,
    dur,
    (t) => amp * Math.sin(2 * Math.PI * 60 * t) + amp * Math.sin(2 * Math.PI * 68 * t),
  );

/** Sustained 808: the material a long-window bass lane would be for. */
const sub808 = (sr: number, dur = 2) =>
  makePcm(sr, dur, (t) => 0.6 * Math.sin(2 * Math.PI * 45 * t));

const dcOffset = (sr: number, dur = 2) =>
  makePcm(sr, dur, (t) => 0.3 + 0.2 * Math.sin(2 * Math.PI * 440 * t));

/** Log sweep 30 Hz -> 16 kHz across the whole buffer. */
const sweep = (sr: number, dur = 2) =>
  makePcm(sr, dur, (t) => {
    const k = Math.log(16000 / 30) / dur;
    return 0.4 * Math.sin(((2 * Math.PI * 30) / k) * (Math.exp(k * t) - 1));
  });

function pinkish(sr: number, dur = 2): PcmData {
  const r = rng(0x5eed);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  return makePcm(sr, dur, () => {
    const w = r() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    return (b0 + b1 + b2 + w * 0.1848) * 0.22;
  });
}

/**
 * Kick every 0.5 s over a quiet 440 Hz bed — same shape as the existing golden
 * fixture in offlineSource.test.ts, so the two suites describe one signal.
 */
const kickTrain = (sr: number, dur = 2) =>
  makePcm(sr, dur, (t) => {
    let v = 0.25 * Math.sin(2 * Math.PI * 440 * t);
    const since = t % 0.5;
    if (since < 0.05) v += 0.9 * Math.sin(2 * Math.PI * 100 * since) * Math.exp(-since * 80);
    return v;
  });

/**
 * Same kick train at an amplitude where the detectors' ABSOLUTE flux floor is
 * the binding term rather than the relative `mean * 1.7`.
 *
 * 0.002 is chosen from measurement, not taste: raising the onset floor from
 * 0.01 to 0.6 leaves 30 and 60 fps detecting all four kicks at this level while
 * 144 fps collapses to one. That is the whole reason the floor must scale with
 * dt — flux shrinks as frames shorten, so a fixed floor silently becomes a
 * high-frame-rate suppressor. Louder fixtures cannot see this at all.
 */
const quietKickTrain = (sr: number, dur = 2) => kickTrainAt(sr, dur, 0.002);

function kickTrainAt(sr: number, dur: number, amp: number): PcmData {
  return makePcm(sr, dur, (t) => {
    let v = 0.05 * Math.sin(2 * Math.PI * 440 * t);
    const since = t % 0.5;
    if (since < 0.05) v += amp * Math.sin(2 * Math.PI * 100 * since) * Math.exp(-since * 80);
    return v;
  });
}

/** Band-limited noise burst every 0.5 s, shaped into the snare band. */
function snareTrain(sr: number, dur = 2): PcmData {
  const r = rng(0xbeef);
  let lp = 0;
  let hp = 0;
  return makePcm(sr, dur, (t) => {
    const since = t % 0.5;
    const w = r() * 2 - 1;
    lp += (w - lp) * 0.25; // ~roll off the very top
    hp = w - lp; // keep the 200 Hz-2.5 kHz-ish region
    return since < 0.04 ? hp * 0.8 * Math.exp(-since * 60) : 0;
  });
}

/** Bright, very short noise burst every 0.25 s — hi-hat band. */
function hatTrain(sr: number, dur = 2): PcmData {
  const r = rng(0xf00d);
  let lp = 0;
  return makePcm(sr, dur, (t) => {
    const since = t % 0.25;
    const w = r() * 2 - 1;
    lp += (w - lp) * 0.7;
    return since < 0.012 ? (w - lp) * 0.7 * Math.exp(-since * 250) : 0;
  });
}

// ------------------------------------------------------------------- driver

interface Trace {
  frames: number;
  beatFrames: number[];
  kickFrames: number[];
  snareFrames: number[];
  hatFrames: number[];
  /** Per-frame copy of the drawn spectrum, for cross-fps comparison. */
  bins: Float32Array[];
  /** Track time of each frame, so two fps runs can be aligned by TIME. */
  times: number[];
  mean: { bass: number; mid: number; treble: number; energy: number };
}

/** Onset pulses are decaying envelopes; a "hit" is the rising edge to 1. */
function isHit(prev: number, cur: number): boolean {
  return cur > 0.99 && prev <= 0.99;
}

function run(pcm: PcmData, fps: number, sync?: Partial<SyncSettings>): Trace {
  const a = new OfflineAnalyzer(pcm, fps, 96, sync ? { ...DEFAULT_SYNC, ...sync } : undefined);
  const t: Trace = {
    frames: a.frameCount,
    beatFrames: [],
    kickFrames: [],
    snareFrames: [],
    hatFrames: [],
    bins: [],
    times: [],
    mean: { bass: 0, mid: 0, treble: 0, energy: 0 },
  };
  let pk = 0;
  let ps = 0;
  let ph = 0;
  for (let n = 0; n < a.frameCount; n++) {
    const f: AudioFeatures = a.nextFrameFeatures();
    if (f.beat) t.beatFrames.push(n);
    if (isHit(pk, f.kick)) t.kickFrames.push(n);
    if (isHit(ps, f.snare)) t.snareFrames.push(n);
    if (isHit(ph, f.hat)) t.hatFrames.push(n);
    pk = f.kick;
    ps = f.snare;
    ph = f.hat;
    t.bins.push(Float32Array.from(f.bins));
    t.times.push(f.time);
    t.mean.bass += f.bass;
    t.mean.mid += f.mid;
    t.mean.treble += f.treble;
    t.mean.energy += f.energy;
  }
  const n = Math.max(1, a.frameCount);
  t.mean.bass /= n;
  t.mean.mid /= n;
  t.mean.treble /= n;
  t.mean.energy /= n;
  return t;
}

/** Frame indices -> track seconds. */
const secs = (frames: number[], fps: number) => frames.map((f) => f / fps);

/**
 * Analysed span dragged down to the 10 Hz floor, which is where the DC-bin
 * guard in `binAt` starts to matter (the lowest band's edges fall below FFT
 * bin 1 only once `freqMin` gets this low).
 *
 * BOTH edges are required. `sanitizeSync` carries the span as a pair on
 * purpose — a lone edge is dropped entirely rather than half-applied — so
 * passing `freqMin` alone silently leaves the analyser at its 30 Hz default
 * and the test measures nothing.
 */
const LOW_SPAN = { freqMin: 10, freqMax: 16000 } as const;

/**
 * Mean cosine similarity between two runs' spectra, sampled at matching TRACK
 * TIMES (not frame indices — that would compare different moments of audio).
 * 1.0 = the two frame rates see an identical spectrum.
 */
function spectrumSimilarity(a: Trace, b: Trace): number {
  const lo = a.times.length < b.times.length ? a : b;
  const hi = lo === a ? b : a;
  let acc = 0;
  let count = 0;
  for (let i = 0; i < lo.times.length; i++) {
    const target = lo.times[i];
    // nearest frame in the denser run by track time
    let j = Math.round(target / Math.max(1e-9, hi.times[1] ?? 1) || 0);
    j = Math.max(0, Math.min(hi.bins.length - 1, j));
    const x = lo.bins[i];
    const y = hi.bins[j];
    let dot = 0;
    let nx = 0;
    let ny = 0;
    for (let k = 0; k < x.length; k++) {
      dot += x[k] * y[k];
      nx += x[k] * x[k];
      ny += y[k] * y[k];
    }
    if (nx > 1e-9 && ny > 1e-9) {
      acc += dot / Math.sqrt(nx * ny);
      count++;
    }
  }
  return count > 0 ? acc / count : 1;
}

// -------------------------------------------------------------------- specs

describe("characterization: determinism", () => {
  it("two runs over the same buffer produce byte-identical traces", () => {
    const a = run(kickTrain(48000), 60);
    const b = run(kickTrain(48000), 60);
    expect(a.beatFrames).toEqual(b.beatFrames);
    expect(a.kickFrames).toEqual(b.kickFrames);
    expect(Array.from(a.bins[59])).toEqual(Array.from(b.bins[59]));
  });

  it("the noise generators are seeded, not random", () => {
    const a = run(pinkish(48000), 60);
    const b = run(pinkish(48000), 60);
    expect(a.mean.mid).toBe(b.mean.mid);
  });
});

describe("characterization: silence and DC", () => {
  it("silence produces no onsets of any class", () => {
    const t = run(silence(48000), 60);
    expect(t.beatFrames).toEqual([]);
    expect(t.kickFrames).toEqual([]);
    expect(t.snareFrames).toEqual([]);
    expect(t.hatFrames).toEqual([]);
    expect(t.mean.energy).toBe(0);
  });

  /**
   * REGRESSION PIN for a bug this suite found and then fixed.
   *
   * `binAt` guards the DC term with `Math.max(1, ...)`, and its comment claims
   * that without it "a file with any DC offset would otherwise light the
   * lowest bar permanently once the low edge is dragged near 10 Hz". The guard
   * had no test anywhere — removing it passed all 906 tests in the repo — and
   * it did not actually achieve that. It excludes bin 0, but a Hann window
   * leaks DC into bin 1 at about -6 dB, and at `freqMin` = 10 Hz the lowest
   * band's edges land on bin 1, so the bar pegged anyway:
   *
   *     DC 0.3  ->  bin 0 ~ -4.4 dBFS, bin 1 ~ -10.4 dBFS
   *     display: ((80 - 10.4) / 72) ^ 1.3 = 0.957     measured: 0.9559
   *     with the guard removed entirely:              0.9623   (worth 0.65 %)
   *
   * `RealFFT` now subtracts the window-weighted mean for the two feature paths
   * (opt-in, so the whole-track analysers keep a plain DFT), which drives bin 0
   * to zero at the cause rather than excluding bins one at a time. Same
   * measurement after the fix: 3.3e-7.
   */
  it("a DC offset leaves the lowest band dark even at a 10 Hz span", () => {
    const withDc = run(dcOffset(48000), 60, LOW_SPAN).bins[100][0];
    expect(withDc, "lowest band under DC offset").toBeLessThan(0.01);
  });

  it("the same span without DC leaves the lowest band dark (control)", () => {
    // Proves the assertion above is about the DC term, not about the span:
    // identical settings, identical tone, no offset.
    const noDc = run(
      makePcm(48000, 2, (s) => 0.3 * Math.sin(2 * Math.PI * 440 * s)),
      60,
      LOW_SPAN,
    ).bins[100][0];
    expect(noDc, "lowest band without DC offset").toBeLessThan(0.2);
  });
});

describe("characterization: onset timing across frame rate", () => {
  // Kicks land at t = 0, 0.5, 1.0, 1.5.
  const expected = [0, 0.5, 1.0, 1.5];

  it("the main beat detector fires 4 kicks at 30, 60 and 144 fps", () => {
    for (const fps of [30, 60, 144]) {
      const t = run(kickTrain(48000), fps);
      const times = secs(t.beatFrames, fps);
      expect(times.length, `beat count at ${fps} fps`).toBe(4);
      for (let i = 0; i < expected.length; i++) {
        expect(Math.abs(times[i] - expected[i]), `beat ${i} at ${fps} fps`).toBeLessThan(0.05);
      }
    }
  });

  /**
   * The drum-class detector already agrees across frame rates on any realistic
   * signal, and this pins that so it stays true.
   *
   * Worth recording why, because the source looks like it should NOT:
   * `OnsetClassDetector` uses a fixed absolute floor (`+ 0.01`) while the main
   * and sync detectors scale theirs by `dt * 60`. That inconsistency is real.
   * It is also unreachable: measured across amplitudes from 0.9 down to
   * 0.0002 (about -74 dBFS), all three frame rates detect all four kicks. The
   * relative term `mean * 1.7` dominates at every audible level, and the first
   * rate to lose a hit below that is 30 fps, not 144 — the opposite of what a
   * dt-scaling bug would produce.
   *
   * So normalising that floor is a consistency change, not a bug fix, and must
   * not be described to users as one.
   */
  it("the drum-class detector agrees at 30, 60 and 144 fps", () => {
    for (const fps of [30, 60, 144]) {
      const t = run(kickTrain(48000), fps);
      expect(t.kickFrames.length, `kick count at ${fps} fps`).toBe(4);
      const times = secs(t.kickFrames, fps);
      for (let i = 0; i < expected.length; i++) {
        expect(Math.abs(times[i] - expected[i]), `kick ${i} at ${fps} fps`).toBeLessThan(0.05);
      }
    }
  });

  /**
   * Closes the second real hole: the onset detector's absolute floor could be
   * moved from 0.01 to 0.6 without a single one of the repo's 906 tests
   * failing. Every existing fixture is loud enough that `mean * 1.7` is the
   * binding term.
   *
   * This runs the SAME assertion on quiet material, where the floor is what
   * decides. It is the guard that makes the floor's value — and its dt
   * scaling — a tested property rather than an unexamined constant.
   */
  it("still agrees at 30, 60 and 144 fps when the absolute floor is the binding term", () => {
    for (const fps of [30, 60, 144]) {
      const t = run(quietKickTrain(48000), fps);
      expect(t.kickFrames.length, `quiet kick count at ${fps} fps`).toBe(4);
    }
  });
});

describe("characterization: sample-rate variance", () => {
  /**
   * PINS A KNOWN DEFECT — the largest one this suite found.
   *
   * The FFT size is a hardcoded 4096 regardless of context rate, so a 96 kHz
   * device analyses half the time window and twice the bin spacing. The knock-on
   * effect is not subtle: `bassRange` is [toBin(30), toBin(150)], which is 10
   * bins at 48 kHz but only 5 at 96 kHz, so `bandMean` divides the same tonal
   * energy by half as many bins. Measured on identical audio:
   *
   *     mean bass   48 kHz 0.526    96 kHz 0.904     (+72%)
   *
   * Every project a 96 kHz user builds is therefore modulated by a bass value
   * far above what the same track produces for everyone else. T5 makes the FFT
   * size rate-aware, which holds the window (and bins-per-Hz) constant and MUST
   * collapse this gap. Re-bless with the new numbers when it lands.
   */
  it("96 kHz reads bass far higher than 48 kHz on identical audio (pinned defect)", () => {
    const at48 = run(twoBassTones(48000), 60).mean;
    const at96 = run(twoBassTones(96000), 60).mean;
    // Guard the fixture itself: a saturated band would make the drift vanish
    // and this test pass for the wrong reason.
    expect(at48.bass, "fixture must not clamp").toBeLessThan(0.95);
    expect(at96.bass, "fixture must not clamp").toBeLessThan(0.99);
    const drift = (at96.bass - at48.bass) / at48.bass;
    expect(drift, "48k->96k bass overread").toBeGreaterThan(0.5);
  });

  it("44.1 kHz and 48 kHz stay close (both select the same window today)", () => {
    const a = run(twoBassTones(44100), 60).mean;
    const b = run(twoBassTones(48000), 60).mean;
    expect(Math.abs(a.bass - b.bass) / b.bass).toBeLessThan(0.05);
  });

  it("a bin-centred tone reads at least as high as the same tone off-bin", () => {
    for (const sr of [44100, 48000, 96000]) {
      const on = Math.max(...Array.from(run(binCentredSine(sr), 60).bins[100]));
      const off = Math.max(...Array.from(run(offBinSine(sr), 60).bins[100]));
      expect(on, `bin-centred vs off-bin at ${sr}`).toBeGreaterThanOrEqual(off - 1e-6);
    }
  });
});

describe("characterization: spectrum stability across frame rate", () => {
  /**
   * The T6 metric. The pipeline samples the FFT once per RENDERED frame, so a
   * 30 fps run sees half the transients a 60 fps run does. The bin EMA is
   * dt-normalised, but the sampling is not — this is the measurement that
   * decides whether a fixed-hop analysis architecture is worth its cost.
   *
   * Pinned as a floor, not an equality: it must not silently get WORSE.
   */
  it("30 vs 60 fps spectra are similar but not identical (pinned)", () => {
    const sim = spectrumSimilarity(run(kickTrain(48000), 30), run(kickTrain(48000), 60));
    expect(sim).toBeGreaterThan(0.9);
    expect(sim).toBeLessThan(1.0);
  });

  it("60 vs 144 fps spectra are similar but not identical (pinned)", () => {
    const sim = spectrumSimilarity(run(kickTrain(48000), 60), run(kickTrain(48000), 144));
    expect(sim).toBeGreaterThan(0.9);
    expect(sim).toBeLessThan(1.0);
  });
});

describe("characterization: band ordering on shaped material", () => {
  it("a sustained 808 puts bass above mid and treble", () => {
    const m = run(sub808(48000), 60).mean;
    expect(m.bass).toBeGreaterThan(m.mid);
    expect(m.bass).toBeGreaterThan(m.treble);
  });

  it("a hat train puts treble above bass", () => {
    const m = run(hatTrain(48000), 60).mean;
    expect(m.treble).toBeGreaterThan(m.bass);
  });

  it("a snare train registers snare hits", () => {
    const t = run(snareTrain(48000), 60);
    expect(t.snareFrames.length).toBeGreaterThan(0);
  });

  it("a sweep visits the whole analysed span", () => {
    const t = run(sweep(48000), 60);
    const early = t.bins[20];
    const late = t.bins[t.frames - 20];
    // energy starts low-band and ends high-band
    const lowEarly = early.slice(0, 24).reduce((a, b) => a + b, 0);
    const highLate = late.slice(72).reduce((a, b) => a + b, 0);
    expect(lowEarly).toBeGreaterThan(0);
    expect(highLate).toBeGreaterThan(0);
  });
});
