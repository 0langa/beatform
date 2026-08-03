import { describe, expect, it } from "vitest";
import { RealFFT } from "./fft";

/** Reference: naive O(N^2) DFT with the same Hann window and scaling as RealFFT. */
function naiveMagnitudes(input: Float32Array, size: number): Float64Array {
  const windowed = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    windowed[i] = input[i] * 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  const out = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < size; n++) {
      const phi = (-2 * Math.PI * k * n) / size;
      re += windowed[n] * Math.cos(phi);
      im += windowed[n] * Math.sin(phi);
    }
    out[k] = Math.hypot(re, im) * (4 / size);
  }
  return out;
}

function dbToLinear(db: number): number {
  return db === -Infinity ? 0 : Math.pow(10, db / 20);
}

/** Deterministic pseudo-random numbers (mulberry32). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("RealFFT", () => {
  it("rejects non-power-of-2 sizes", () => {
    expect(() => new RealFFT(1000)).toThrow();
  });

  it("matches a naive DFT on random input (N=1024)", () => {
    const size = 1024;
    const rand = prng(0xc0ffee);
    const input = new Float32Array(size);
    for (let i = 0; i < size; i++) input[i] = rand() * 2 - 1;

    const fft = new RealFFT(size);
    const outDb = new Float32Array(size / 2);
    fft.magnitudesDb(input, outDb);
    const expected = naiveMagnitudes(input, size);

    for (let k = 0; k < size / 2; k++) {
      const got = dbToLinear(outDb[k]);
      const want = expected[k];
      expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-4 + 2e-3 * Math.max(got, want));
    }
  });

  it("puts a bin-centered full-scale sine at ~0 dB in the right bin", () => {
    const size = 4096;
    const k = 100;
    const input = new Float32Array(size);
    for (let n = 0; n < size; n++) input[n] = Math.sin((2 * Math.PI * k * n) / size);

    const fft = new RealFFT(size);
    const outDb = new Float32Array(size / 2);
    fft.magnitudesDb(input, outDb);

    let maxBin = 0;
    for (let i = 1; i < size / 2; i++) if (outDb[i] > outDb[maxBin]) maxBin = i;
    expect(maxBin).toBe(k);
    // Hann coherent gain is compensated by the 4/N scale, so a full-scale
    // bin-centered sine lands at 0 dB (± window edge effects).
    expect(outDb[k]).toBeGreaterThan(-0.1);
    expect(outDb[k]).toBeLessThan(0.1);
    // Hann main lobe: adjacent bins sit ~6 dB down.
    expect(outDb[k - 1]).toBeGreaterThan(-6.5);
    expect(outDb[k - 1]).toBeLessThan(-5.5);
    // Far bins are deep in the noise floor.
    expect(outDb[k + 500]).toBeLessThan(-100);
  });

  it("leaves DC alone by default, so the whole-track analysers keep a plain DFT", () => {
    // beatGrid, keyDetect and sections all construct RealFFT without the flag.
    // If the default ever flips, their tempo/key/section results move silently.
    const size = 1024;
    const input = new Float32Array(size).fill(0.5);
    const outDb = new Float32Array(size / 2);
    new RealFFT(size).magnitudesDb(input, outDb);
    expect(outDb[0]).toBeGreaterThan(-12); // the offset is plainly present
  });

  it("blockDc drives bin 0 to silence for a constant offset", () => {
    const size = 1024;
    const input = new Float32Array(size).fill(0.5);
    const outDb = new Float32Array(size / 2);
    new RealFFT(size, true).magnitudesDb(input, outDb);
    // Exactly zero energy, not merely reduced: the window-weighted mean is the
    // one correction that nulls bin 0 rather than trading it against a residue.
    expect(outDb[0]).toBeLessThan(-100);
    expect(outDb[1]).toBeLessThan(-100);
  });

  it("blockDc uses the window-weighted mean, not the arithmetic mean", () => {
    // The two agree on any signal that is symmetric across the window — a
    // constant, or a bin-centred sine — so those fixtures cannot tell them
    // apart. A single half-cycle is deliberately lopsided: its flat average is
    // 2/pi ~ 0.637 while the Hann weighting, which is centre-heavy, sees a
    // noticeably larger one.
    //
    // Bin 0 of the transform IS sum(w * x), so only the weighted mean drives
    // it to zero. Subtracting the flat average instead leaves a residue, and
    // that residue is what lifted the lowest bands on offset-free material.
    const size = 1024;
    const input = new Float32Array(size);
    for (let n = 0; n < size; n++) input[n] = Math.sin((Math.PI * n) / size);
    const outDb = new Float32Array(size / 2);
    new RealFFT(size, true).magnitudesDb(input, outDb);
    expect(outDb[0]).toBeLessThan(-100);
  });

  it("blockDc leaves an offset tone's own bin untouched", () => {
    // A DC block must remove the offset WITHOUT attenuating real content, or
    // it would quietly change every band on every track rather than the bottom
    // of ones that carry an offset.
    const size = 4096;
    const k = 100;
    const plain = new Float32Array(size);
    const offset = new Float32Array(size);
    for (let n = 0; n < size; n++) {
      const s = Math.sin((2 * Math.PI * k * n) / size);
      plain[n] = s;
      offset[n] = s + 0.4;
    }
    const a = new Float32Array(size / 2);
    const b = new Float32Array(size / 2);
    new RealFFT(size, true).magnitudesDb(plain, a);
    new RealFFT(size, true).magnitudesDb(offset, b);
    expect(Math.abs(b[k] - a[k])).toBeLessThan(0.01);
  });

  it("returns -Infinity for silence", () => {
    const size = 512;
    const fft = new RealFFT(size);
    const outDb = new Float32Array(size / 2);
    fft.magnitudesDb(new Float32Array(size), outDb);
    for (const v of outDb) expect(v).toBe(-Infinity);
  });

  it("reports the symmetric window's half-window peak offset", () => {
    // The legacy display latency: a symmetric Hann reads a transient strongest
    // at its centre, half a window behind the window end.
    expect(new RealFFT(4096).peakOffsetSamples).toBe((4096 - 1) / 2);
    expect(new RealFFT(16384, true).peakOffsetSamples).toBe((16384 - 1) / 2);
  });

  it("is deterministic across repeated calls", () => {
    const size = 2048;
    const rand = prng(42);
    const input = new Float32Array(size);
    for (let i = 0; i < size; i++) input[i] = rand() * 2 - 1;

    const fft = new RealFFT(size);
    const a = new Float32Array(size / 2);
    const b = new Float32Array(size / 2);
    fft.magnitudesDb(input, a);
    fft.magnitudesDb(input, b);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe("RealFFT asymmetric display window", () => {
  it("keeps a full-scale bin-centered sine at 0 dB (2/windowSum calibration)", () => {
    // The asymmetric window's coherent gain differs sample-for-sample from the
    // symmetric Hann's, so the historical 4/N literal would mis-calibrate it.
    // The general 2/sum(w) normalization must land a full-scale sine at 0 dB
    // exactly like the default window does.
    for (const size of [4096, 16384]) {
      const k = 100;
      const input = new Float32Array(size);
      for (let n = 0; n < size; n++) input[n] = Math.sin((2 * Math.PI * k * n) / size);
      const outDb = new Float32Array(size / 2);
      new RealFFT(size, false, true).magnitudesDb(input, outDb);
      let maxBin = 0;
      for (let i = 1; i < size / 2; i++) if (outDb[i] > outDb[maxBin]) maxBin = i;
      expect(maxBin).toBe(k);
      expect(outDb[k]).toBeGreaterThan(-0.1);
      expect(outDb[k]).toBeLessThan(0.1);
    }
  });

  it("puts the effective display latency in the window/6..window/10 region", () => {
    // E = round(N/8): far enough from the end to keep a usable main lobe, far
    // enough from the symmetric N/2 that a 341 ms window stops reading a
    // transient 171 ms late.
    for (const size of [4096, 8192, 16384]) {
      const fft = new RealFFT(size, true, true);
      expect(fft.peakOffsetSamples).toBe(Math.round(size / 8));
      expect(fft.peakOffsetSamples).toBeGreaterThan(size / 10);
      expect(fft.peakOffsetSamples).toBeLessThan(size / 6);
    }
  });

  it("reads an impulse loudest when it sits peakOffsetSamples before the end", () => {
    // Behavioral pin of the alignment contract: the exported display window is
    // shifted so this exact point lands on the frame time.
    const size = 4096;
    const fft = new RealFFT(size, false, true);
    const outDb = new Float32Array(size / 2);
    const levelAt = (pos: number) => {
      const input = new Float32Array(size);
      input[pos] = 1;
      fft.magnitudesDb(input, outDb);
      return outDb[100]; // impulse spectrum is flat; any non-DC bin will do
    };
    const atPeak = levelAt(size - 1 - fft.peakOffsetSamples);
    expect(atPeak).toBeGreaterThan(levelAt(size - 8)); // near the very end
    expect(atPeak).toBeGreaterThan(levelAt(Math.floor(size / 2))); // old centre
    expect(atPeak).toBeGreaterThan(levelAt(256)); // deep in the rise
  });

  it("does not change the default window (spot check against the naive DFT)", () => {
    // The asymmetric flag must be strictly opt-in: a default-constructed
    // RealFFT keeps matching the symmetric-Hann reference to the same bound
    // the long-standing tests assert.
    const size = 1024;
    const rand = prng(0xbeefcafe);
    const input = new Float32Array(size);
    for (let i = 0; i < size; i++) input[i] = rand() * 2 - 1;
    const outDb = new Float32Array(size / 2);
    new RealFFT(size).magnitudesDb(input, outDb);
    const expected = naiveMagnitudes(input, size);
    for (let k = 0; k < size / 2; k++) {
      const got = dbToLinear(outDb[k]);
      expect(Math.abs(got - expected[k])).toBeLessThanOrEqual(
        1e-4 + 2e-3 * Math.max(got, expected[k]),
      );
    }
  });
});
