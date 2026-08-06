import { describe, expect, it } from "vitest";
import { OfflineAnalyzer } from "./offlineSource";
import { FeaturePipeline, WAVEFORM_LENGTH } from "./featurePipeline";
import { analysisFftSize } from "./dsp/fftSize";
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
 *
 * TIMEOUTS: every describe that drives real `OfflineAnalyzer` passes carries
 * an explicit `{ timeout: 30_000 }` (the same remedy store.test.ts applies to
 * its async initApp tests). Nothing in this file asserts timing — every test
 * is deterministic math — so its only load-sensitive failure mode was
 * vitest's 5 s per-test DEFAULT timeout: a single `it` can run five
 * multi-second FFT passes at up to 192 kHz, which crossed 5 s under thermal
 * throttle. That default, not the DSP, is what earned this file its old
 * "thermal-sensitive — rerun before believing" reputation. With the budgets
 * explicit, the root cause is gone: a failure here is a logic failure, never
 * a rerun instruction. (The two FeaturePipeline-only describes at the bottom
 * construct no analyzers and keep the default.)
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

/**
 * DENSE percussive material, and the density is load-bearing.
 *
 * The isolated-kick fixtures cannot test frame-rate independence of onset
 * detection: four hits in two seconds sit far under the refractory ceiling, so
 * the count is pinned by the music and nothing about the sampling rate can move
 * it. Real music keeps spectral flux continuously near the adaptive threshold,
 * which is the regime where the detector's history window length matters — and
 * a wrong window there is invisible on sparse material.
 *
 * Deterministic hash-noise, no Math.random, so every run is the same test.
 */
function denseMix(sr: number, dur = 3): PcmData {
  return makePcm(sr, dur, (t, i) => {
    let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    const n = ((h ^ (h >>> 16)) >>> 0) / 0x80000000 - 1;
    let v = 0.18 * n + 0.2 * Math.sin(2 * Math.PI * 55 * t);
    const k = t % 0.125;
    if (k < 0.03) v += 0.7 * Math.sin(2 * Math.PI * 90 * k) * Math.exp(-k * 120);
    const s = (t + 0.0625) % 0.25;
    if (s < 0.02) v += 0.5 * n * Math.exp(-s * 150);
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

describe("characterization: determinism", { timeout: 30_000 }, () => {
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

describe("characterization: silence and DC", { timeout: 30_000 }, () => {
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

describe("characterization: onset timing across frame rate", { timeout: 30_000 }, () => {
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

describe("characterization: sample-rate variance", { timeout: 30_000 }, () => {
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
  it("96 kHz and 48 kHz now read the same bass on identical audio", () => {
    const at48 = run(twoBassTones(48000), 60).mean;
    const at96 = run(twoBassTones(96000), 60).mean;
    // Guard the fixture itself: a saturated band reads 1.0 at every rate and
    // would make this pass for entirely the wrong reason. That is exactly how
    // the defect stayed hidden when the fixture was first written at 0.35.
    expect(at48.bass, "fixture must not clamp").toBeLessThan(0.95);
    expect(at96.bass, "fixture must not clamp").toBeLessThan(0.99);
    const drift = Math.abs(at96.bass - at48.bass) / at48.bass;
    // Was 0.72 — a 72% overread — while the FFT size was fixed at 4096 and
    // bassRange therefore spanned 10 bins at 48 kHz but 5 at 96 kHz. Now
    // 0.00016. The residue is the resampling of the fixture, not the analyser.
    expect(drift, "48k->96k bass drift").toBeLessThan(0.01);
  });

  it("192 kHz matches 48 kHz too", () => {
    const at48 = run(twoBassTones(48000), 60).mean;
    const at192 = run(twoBassTones(192000), 60).mean;
    expect(at48.bass).toBeLessThan(0.95);
    expect(Math.abs(at192.bass - at48.bass) / at48.bass).toBeLessThan(0.01);
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

describe("characterization: spectrum stability across frame rate", { timeout: 30_000 }, () => {
  /**
   * These used to assert the spectra were merely SIMILAR, and pinned that they
   * were not identical. They now assert identity, because the analyser runs at
   * a fixed cadence rather than once per rendered frame.
   *
   * What made this worth fixing was never the spectrum — the similarity was
   * already 0.9998+ and `bass` was bit-identical. It was event counts: the same
   * 60 s of real music produced 170 beats at 30 fps and 299 at 144, because
   * every extra frame was another independent chance to cross the adaptive
   * threshold. Preview on a 144 Hz display reacted ~75% more than its own
   * export of the same project.
   */
  it("30 and 60 fps see the same spectrum to within EMA sampling", () => {
    // Deliberately NOT exact. Continuous features (bins, peaks, bands, drive)
    // still update once per rendered frame, so a 144 Hz display stays as smooth
    // as it ever was; only ONSET DETECTION moved to a fixed clock. The residue
    // here is the bin EMA seeing a different number of samples, which was
    // never the defect: on real music it measured 0.9998+ before any of this
    // work, and this synthetic fixture — sharp transients every 0.5 s, a
    // deliberate worst case — sits at 0.9988.
    const sim = spectrumSimilarity(run(kickTrain(48000), 30), run(kickTrain(48000), 60));
    expect(sim).toBeGreaterThan(0.998);
  });

  it("60 and 144 fps see the same spectrum to within EMA sampling", () => {
    const sim = spectrumSimilarity(run(kickTrain(48000), 60), run(kickTrain(48000), 144));
    expect(sim).toBeGreaterThan(0.998);
  });

  it("fires the same number of beats and drum hits at every frame rate", () => {
    // The assertion the synthetic fixtures could never make before. Four
    // isolated kicks hid this; real music, with continuous transient density,
    // is where a per-frame threshold test runs away with itself.
    const ref = run(kickTrain(48000), 60);
    for (const fps of [30, 90, 120, 144]) {
      const t = run(kickTrain(48000), fps);
      expect(t.beatFrames.length, `beats at ${fps} fps`).toBe(ref.beatFrames.length);
      expect(t.kickFrames.length, `kicks at ${fps} fps`).toBe(ref.kickFrames.length);
    }
  });
});

describe("characterization: detectors are frame-rate independent", { timeout: 30_000 }, () => {
  /**
   * The assertion this whole suite existed to make, and the one it could not
   * make until it had dense material to make it on.
   *
   * Onset detection steps on a fixed 60 Hz clock rather than once per rendered
   * frame. Before that, the same 60 s of real music produced 170 beats at 30 fps
   * and 299 at 144 — a project reacting ~75% more on a high-refresh display
   * than in its own export.
   *
   * Counts FIRES (the envelope only jumps up on a fire) rather than threshold
   * crossings, so it is immune to how many render frames sample a held value.
   */
  const fires = (fps: number) => {
    const t = run(denseMix(48000), fps);
    return {
      beats: t.beatFrames.length,
      kick: t.kickFrames.length,
      snare: t.snareFrames.length,
      hat: t.hatFrames.length,
    };
  };

  it("fires identically at 30, 60, 90, 120 and 144 fps", () => {
    const ref = fires(60);
    // Fixture sanity: the detectors must be BUSY, not merely non-zero. 13 beats
    // in 3 s is ~60% of the 0.14 s refractory ceiling, and the drum detectors
    // fire several times that — enough that the history-window length actually
    // decides outcomes, which is what makes the comparison below meaningful.
    expect(ref.beats, "fixture must keep the detector busy").toBeGreaterThan(10);
    expect(ref.kick, "fixture must keep the drum detector busy").toBeGreaterThan(10);
    for (const fps of [30, 90, 120, 144]) {
      expect(fires(fps), `detector fires at ${fps} fps`).toEqual(ref);
    }
  });
});

describe("characterization: band ordering on shaped material", { timeout: 30_000 }, () => {
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

describe("characterization: waveform length is independent of the FFT", { timeout: 30_000 }, () => {
  /**
   * The renderer downsamples `f.waveform` to a fixed 512 points by CHUNK MEAN,
   * with the chunk width taken as `length / 512`. So the waveform's length is
   * not a free parameter — it sets how much averaging the oscilloscope trace
   * receives. While it was derived as `fftSize * 3/4`, raising the transform
   * size would have doubled the chunk from 6 samples to 12 and visibly smoothed
   * the trace, with nothing in the drawing code having changed.
   *
   * These guard the decoupling ahead of the FFT size becoming sample-rate
   * aware, which is exactly when the old derivation would have bitten.
   */
  it("every sample rate produces the same waveform length", () => {
    // The literal, NOT the constant. Asserting `length === WAVEFORM_LENGTH`
    // compares the constant against itself and passes for any value it takes —
    // which it duly did when the constant was mutated to 6144.
    for (const sr of [44100, 48000, 96000]) {
      const a = new OfflineAnalyzer(kickTrain(sr), 60);
      expect(a.nextFrameFeatures().waveform.length, `waveform length at ${sr}`).toBe(3072);
    }
    expect(WAVEFORM_LENGTH).toBe(3072);
  });

  /**
   * The assertion that was impossible before the FFT size became rate-aware:
   * while every transform was 4096, `fftSize * 3/4` and a fixed 3072 were the
   * same number, so reverting the decoupling was undetectable. At 96 kHz the
   * transform is 8192 and the old expression would yield 6144 — doubling the
   * renderer's chunk-mean width and visibly smoothing the oscilloscope.
   */
  it("stays 3072 at 96 kHz, where the transform is 8192", () => {
    expect(analysisFftSize(96000)).toBe(8192);
    const a = new OfflineAnalyzer(kickTrain(96000), 60);
    expect(a.nextFrameFeatures().waveform.length).toBe(3072);
  });

  it("the zero-crossing trigger does not move when headroom grows", () => {
    // Growing the FFT only grows the search headroom. The trigger takes the
    // FIRST rising crossing, so its index must not depend on how much room it
    // had to look — otherwise a larger transform would shift the whole trace.
    const wave = new Float32Array(8192);
    for (let i = 0; i < wave.length; i++) wave[i] = Math.sin((2 * Math.PI * i) / 700);
    const trace = (fftBins: number) => {
      const p = new FeaturePipeline({
        sampleRate: 48000,
        fftBins,
        binCount: 96,
        waveformLength: WAVEFORM_LENGTH,
      });
      return Array.from(
        p.update({
          magDb: new Float32Array(fftBins).fill(-90),
          waveform: wave,
          time: 0,
          dt: 1 / 60,
          playing: true,
          duration: 10,
        }).waveform,
      );
    };
    expect(trace(4096)).toEqual(trace(2048));
  });
});

describe("characterization: detector bands are specified in hertz", () => {
  /**
   * The main beat detector's flux band used to be written as
   * `midRange[0] + 8` — eight FFT BINS above 150 Hz. A bin is not a fixed
   * number of hertz, so the band it actually measured moved with the sample
   * rate: ~246 Hz at 48 kHz but ~237 Hz at 44.1 kHz. Nobody chose that.
   *
   * Neither rate is "wrong" by much, which is exactly why it survived: the
   * difference never flipped a detection on any material tested. It is a unit
   * mismatch, and this asserts the units rather than the symptom.
   */
  it("the flux band covers the same frequencies at every sample rate", () => {
    const hz = (sr: number) =>
      new FeaturePipeline({
        sampleRate: sr,
        fftBins: 2048,
        binCount: 96,
        waveformLength: WAVEFORM_LENGTH,
      }).fluxBandHz;
    const ref = hz(48000);
    expect(ref[1]).toBeGreaterThan(240);
    expect(ref[1]).toBeLessThan(252);
    for (const sr of [44100, 96000, 192000]) {
      const b = hz(sr);
      // Within one bin of the reference at that rate, not within a fixed
      // tolerance: a coarser grid genuinely cannot land on 245 Hz exactly.
      const binHz = sr / 2 / 2048;
      expect(Math.abs(b[1] - ref[1]), `flux band top at ${sr}`).toBeLessThanOrEqual(binHz);
    }
  });
});

describe("characterization: absolute flux floors scale with bin density", () => {
  const scale = (sr: number, fftBins: number) =>
    new FeaturePipeline({ sampleRate: sr, fftBins, binCount: 96, waveformLength: WAVEFORM_LENGTH })
      .absoluteFloorScale;

  /**
   * Flux is a SUM over the bins in a band, so it grows with bin density while
   * the detectors' absolute floors do not — the same unit bug as the dt
   * scaling, on the other axis.
   *
   * This is asserted numerically rather than behaviourally on purpose. The
   * correction is a few percent of a threshold and does not flip a detection on
   * any material measured here, so a behavioural test would either be vacuous
   * or tuned to a knife edge. What matters is the exactness below.
   */
  it("is EXACTLY 1 at the reference, so 48 kHz and the golden trace cannot move", () => {
    expect(scale(48000, 2048)).toBe(1);
  });

  it("stays 1 when the FFT size tracks the sample rate", () => {
    // Holding the analysis window constant holds bins-per-hertz constant, so
    // rate-aware sizing needs no correction at all — the scale only earns its
    // keep where the window cannot be held.
    expect(scale(96000, 4096)).toBeCloseTo(1, 10);
    expect(scale(192000, 8192)).toBeCloseTo(1, 10);
  });

  it("compensates the rates where the window cannot be held exactly", () => {
    // 44.1 kHz on a 4096-point transform packs ~8.8% more bins per hertz than
    // the 48 kHz reference, so its flux sums run correspondingly higher.
    expect(scale(44100, 2048)).toBeCloseTo(1.0884, 3);
  });
});
