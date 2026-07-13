import { RealFFT } from "../dsp/fft";

/**
 * Musical key estimation: average chromagram over the track, correlated with
 * the Krumhansl-Kessler major/minor key profiles (24 rotations, pick best).
 * Coarse by design — enough for key-matched palettes and display, not
 * transcription.
 */
export interface KeyEstimate {
  /** Pitch class of the tonic, 0 = C .. 11 = B. */
  tonic: number;
  mode: "major" | "minor";
  /** Pearson correlation with the winning profile, ~0.5-0.95. */
  confidence: number;
  /** Display name, e.g. "F# minor". */
  name: string;
}

const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Krumhansl-Kessler probe-tone profiles
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const FFT_SIZE = 8192;
const HOP = 4096;

/** Average chroma vector (12 pitch classes, C first) over the whole signal. */
export function chromagram(mono: Float32Array, sampleRate: number): Float64Array {
  const fft = new RealFFT(FFT_SIZE);
  const magDb = new Float32Array(FFT_SIZE / 2);
  const frame = new Float32Array(FFT_SIZE);
  const chroma = new Float64Array(12);
  const hzPerBin = sampleRate / FFT_SIZE;
  const loBin = Math.max(1, Math.ceil(55 / hzPerBin)); // A1
  const hiBin = Math.min(FFT_SIZE / 2 - 1, Math.floor(2000 / hzPerBin));

  // Precompute bin -> pitch class (C = 0); -1 marks out-of-range bins
  const pcOfBin = new Int8Array(hiBin + 1).fill(-1);
  for (let b = loBin; b <= hiBin; b++) {
    const f = b * hzPerBin;
    const semisFromC4 = Math.round(12 * Math.log2(f / 261.6256));
    pcOfBin[b] = ((semisFromC4 % 12) + 12) % 12;
  }

  for (let start = 0; start + FFT_SIZE <= mono.length; start += HOP) {
    frame.set(mono.subarray(start, start + FFT_SIZE));
    fft.magnitudesDb(frame, magDb);
    for (let b = loBin; b <= hiBin; b++) {
      const db = magDb[b];
      if (db === -Infinity || db < -60) continue;
      // Power domain sharpens peaks vs noise floor
      const p = Math.pow(10, db / 10);
      chroma[pcOfBin[b]] += p;
    }
  }
  return chroma;
}

function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const denom = Math.sqrt(da * db);
  return denom > 0 ? num / denom : 0;
}

/** Estimate the key of a mono signal. Null when there's no tonal content. */
export function estimateKey(mono: Float32Array, sampleRate: number): KeyEstimate | null {
  const chroma = chromagram(mono, sampleRate);
  let total = 0;
  for (const v of chroma) total += v;
  if (total <= 0) return null;

  let best: KeyEstimate | null = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, profile] of [
      ["major", MAJOR],
      ["minor", MINOR],
    ] as const) {
      // Rotate chroma so the candidate tonic sits at index 0
      const rotated = new Float64Array(12);
      for (let i = 0; i < 12; i++) rotated[i] = chroma[(tonic + i) % 12];
      const r = pearson(rotated, profile);
      if (!best || r > best.confidence) {
        best = {
          tonic,
          mode,
          confidence: r,
          name: `${PITCH_NAMES[tonic]} ${mode}`,
        };
      }
    }
  }
  return best;
}
