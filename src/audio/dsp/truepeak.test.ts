import { describe, expect, it } from "vitest";
import { TruePeakLimiter, toDb, truePeakDbfs } from "./truepeak";

const SR = 48000;

function sine(freq: number, seconds: number, amplitude: number, phase = 0): Float32Array {
  const out = new Float32Array(Math.round(SR * seconds));
  for (let i = 0; i < out.length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / SR + phase);
  }
  return out;
}

/**
 * Raised-cosine fade over the edges. A tone that appears out of nowhere is a
 * step, and a step's reconstruction overshoots (Gibbs) — real, but it would
 * swamp the filter accuracy these measurement tests are actually probing.
 */
function faded(src: Float32Array, ramp = 512): Float32Array {
  const out = src.slice();
  for (let i = 0; i < ramp && i < out.length; i++) {
    const w = 0.5 - 0.5 * Math.cos((Math.PI * i) / ramp);
    out[i] *= w;
    out[out.length - 1 - i] *= w;
  }
  return out;
}

/**
 * Run a whole buffer through the limiter the way exportCore does: prime with
 * the first `latency` samples, then feed `latency` ahead of what we emit and
 * zero-pad past the end, so output stays sample-aligned with input.
 */
function limitAll(
  channels: Float32Array[],
  gain: number,
  ceilingDb: number,
): { out: Float32Array[]; limiter: TruePeakLimiter } {
  const n = channels[0].length;
  const nch = channels.length;
  const limiter = new TruePeakLimiter(SR, nch, gain, ceilingDb);
  const lat = limiter.latency;
  const at = (ch: number, i: number) => (i < n ? channels[ch][i] : 0);

  const prime = new Float32Array(nch * lat);
  for (let ch = 0; ch < nch; ch++) {
    for (let i = 0; i < lat; i++) prime[ch * lat + i] = at(ch, i);
  }
  limiter.process(prime, lat);

  const main = new Float32Array(nch * n);
  for (let ch = 0; ch < nch; ch++) {
    for (let i = 0; i < n; i++) main[ch * n + i] = at(ch, i + lat);
  }
  limiter.process(main, n);

  const out = Array.from({ length: nch }, (_, ch) => main.slice(ch * n, ch * n + n));
  return { out, limiter };
}

/**
 * TIMEOUTS: both describes carry an explicit 30 s budget rather than vitest's
 * 5 s default. The limiter cases run a 4x-oversampled filter over half a second
 * of audio and then assert sample-by-sample alignment — ~24000 `expect` calls
 * in one `it`, which is the actual cost — and the heaviest measured 0.6 s in a
 * normal full-suite run against 1.3 s with the pool oversubscribed 2:1. The
 * per-sample form is the point (a limiter that shifts the signal by one sample
 * has to fail here), so the budget is what gives way. Same remedy as
 * `dspCharacterization.test.ts`; see GATES.md §1.
 */
const SUITE = { timeout: 30_000 };

describe("true-peak measurement", SUITE, () => {
  it("reads DC at its own level — no phantom inter-sample peak", () => {
    // Each polyphase branch is normalised to unit DC gain; if it weren't, a
    // constant signal would reconstruct as a ripple and read hot. Faded, since
    // a level appearing out of silence is a step and a step really does ring.
    const dc = faded(new Float32Array(4000).fill(0.5));
    expect(truePeakDbfs([dc])).toBeCloseTo(toDb(0.5), 2);
  });

  it("never reads below the sample peak", () => {
    // The floor guaranteed by the odd-length prototype: branch 0 is a pure
    // delay, so every input sample is itself evaluated. An even-length filter
    // puts all four branches at fractional offsets and can read *under* a peak
    // that sits exactly on a sample.
    const s = faded(sine(SR / 4, 0.2, 0.5, Math.PI / 2));
    let samplePeak = 0;
    for (const v of s) samplePeak = Math.max(samplePeak, Math.abs(v));
    expect(truePeakDbfs([s])).toBeGreaterThanOrEqual(toDb(samplePeak) - 1e-6);
  });

  it("finds inter-sample overshoot the sample peak misses", () => {
    // Phase-shifted so every sample straddles a crest: samples sit at ±0.707 of
    // the amplitude while the true peak is the full amplitude — ~3 dB of
    // overshoot that a sample-peak meter cannot see.
    const s = faded(sine(SR / 4, 0.2, 0.5, Math.PI / 4));
    let samplePeak = 0;
    for (const v of s) samplePeak = Math.max(samplePeak, Math.abs(v));
    const tp = truePeakDbfs([s]);
    expect(tp).toBeGreaterThan(toDb(samplePeak) + 2);
    expect(tp).toBeCloseTo(toDb(0.5), 1);
  });

  it("stays within the 4x grid's floor up to 20 kHz", () => {
    // Worst-case under-read measured across crest positions is 0.168 dB, and
    // that is the oversampling grid, not the filter — 32 taps per branch does
    // no better. Anything worse here means the interpolator regressed.
    for (const freq of [1000, 10000, 12000, 15000, 18000, 20000]) {
      for (const phase of [0, Math.PI / 5, Math.PI / 3, Math.PI / 2]) {
        const tp = truePeakDbfs([faded(sine(freq, 0.1, 0.5, phase))]);
        expect(tp - toDb(0.5)).toBeGreaterThan(-0.2);
        expect(tp - toDb(0.5)).toBeLessThan(0.05);
      }
    }
  });

  it("returns a finite floor for silence", () => {
    expect(truePeakDbfs([new Float32Array(1000)])).toBeLessThan(-200);
    expect(Number.isFinite(truePeakDbfs([new Float32Array(1000)]))).toBe(true);
  });
});

describe("true-peak limiter", SUITE, () => {
  it("holds the ceiling when gained well past it", () => {
    const { out, limiter } = limitAll([sine(220, 1, 0.5), sine(220, 1, 0.5)], 4, -1);
    // Tolerance covers the interpolator's own measurement ripple, not slop in
    // the gain curve: the sliding-min + boxcar pair is exact at the peak.
    expect(truePeakDbfs(out)).toBeLessThanOrEqual(-1 + 0.1);
    expect(limiter.report.peakInDb).toBeGreaterThan(0);
    expect(limiter.report.reductionDb).toBeLessThan(-5);
  });

  it("holds the ceiling on transients, not just steady tone", () => {
    const n = SR;
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // Isolated clicks: worst case for a limiter's attack.
      a[i] = i % 4800 === 0 ? 0.95 : 0.02 * Math.sin((2 * Math.PI * 60 * i) / SR);
    }
    const { out } = limitAll([a], 2, -1);
    expect(truePeakDbfs(out)).toBeLessThanOrEqual(-1 + 0.1);
  });

  it("passes signal that never reaches the ceiling through untouched", () => {
    const src = sine(440, 0.5, 0.1);
    const { out, limiter } = limitAll([src], 1, -1);
    expect(limiter.report.reductionDb).toBeCloseTo(0, 6);
    // Alignment check too: a transparent limiter must not shift the signal.
    for (let i = 0; i < src.length; i++) expect(out[0][i]).toBeCloseTo(src[i], 5);
  });

  it("applies makeup gain exactly while below the ceiling", () => {
    const src = sine(440, 0.5, 0.05);
    const { out } = limitAll([src], 2, -1);
    for (let i = 0; i < src.length; i++) expect(out[0][i]).toBeCloseTo(src[i] * 2, 5);
  });

  it("keeps the stereo image — both channels share one gain curve", () => {
    const l = sine(220, 0.5, 0.9);
    const r = sine(220, 0.5, 0.3);
    const { out } = limitAll([l, r], 2, -1);
    // Per-channel gain would collapse the level difference; a shared curve
    // preserves the 0.9:0.3 ratio everywhere.
    for (let i = 100; i < l.length - 100; i++) {
      if (Math.abs(out[1][i]) > 1e-4) {
        expect(out[0][i] / out[1][i]).toBeCloseTo(3, 3);
      }
    }
  });

  it("is deterministic across chunk boundaries", () => {
    const src = sine(220, 0.3, 0.8);
    const whole = limitAll([src], 3, -1).out[0];

    // Same input, fed in ragged chunks: streaming state must carry across.
    const limiter = new TruePeakLimiter(SR, 1, 3, -1);
    const lat = limiter.latency;
    const at = (i: number) => (i < src.length ? src[i] : 0);
    const prime = new Float32Array(lat);
    for (let i = 0; i < lat; i++) prime[i] = at(i);
    limiter.process(prime, lat);

    const chunked = new Float32Array(src.length);
    let pos = 0;
    for (const size of [1, 7, 100, 1, 4096, 333]) {
      while (pos < src.length) {
        const frames = Math.min(size, src.length - pos);
        const buf = new Float32Array(frames);
        for (let i = 0; i < frames; i++) buf[i] = at(pos + lat + i);
        limiter.process(buf, frames);
        chunked.set(buf, pos);
        pos += frames;
        break;
      }
    }
    while (pos < src.length) {
      const frames = Math.min(512, src.length - pos);
      const buf = new Float32Array(frames);
      for (let i = 0; i < frames; i++) buf[i] = at(pos + lat + i);
      limiter.process(buf, frames);
      chunked.set(buf, pos);
      pos += frames;
    }
    for (let i = 0; i < src.length; i++) expect(chunked[i]).toBeCloseTo(whole[i], 6);
  });
});
