import { RealFFT } from "../dsp/fft";
import type { PcmData } from "../types";

/**
 * Offline tempo estimation + beat tracking. Three classic stages:
 *
 *  1. Onset-strength envelope: spectral flux (positive magnitude change,
 *     log-compressed) over hops of ~11.6 ms.
 *  2. Tempo: autocorrelation of the envelope, scored with a log-normal
 *     preference window centered near 120 BPM (Ellis), octave-corrected.
 *  3. Beat times: dynamic programming (Ellis 2007) — maximize onset strength
 *     at beats while penalizing deviations from the tempo period.
 *
 * Deterministic: same PCM in, same grid out. Runs off the main thread via
 * analysisWorker (a 3-minute track takes well under a second).
 */
export interface BeatGrid {
  bpm: number;
  /** Beat instants, seconds, ascending. Empty when tracking failed. */
  beatTimes: Float32Array;
  /** Onset-envelope hop, seconds (diagnostic). */
  hopSec: number;
}

const FFT_SIZE = 2048;
const HOP = 512;
const MIN_BPM = 60;
const MAX_BPM = 200;
/**
 * Envelope frames are timestamped at the analysis window START, but a
 * transient only drives the flux once it has slid ~0.7 windows in (the Hann
 * edge suppresses it before that). Measured on synthetic kick tracks at
 * 90/120/174 BPM: beats reported 27-36 ms early, mean ~-30 ms at 48 kHz =
 * 0.7 * FFT_SIZE / sampleRate. Shifting the reported beat times by that
 * constant puts the grid on the audible transients.
 */
const ONSET_LATENCY_WINDOWS = 0.7;

/** Onset-strength envelope via log-magnitude spectral flux. */
export function onsetEnvelope(
  mono: Float32Array,
  sampleRate: number,
): { env: Float32Array; hopSec: number } {
  const fft = new RealFFT(FFT_SIZE);
  const magDb = new Float32Array(FFT_SIZE / 2);
  const window = new Float32Array(FFT_SIZE);
  const hops = Math.max(0, Math.floor((mono.length - FFT_SIZE) / HOP));
  const env = new Float32Array(hops);
  const prev = new Float32Array(FFT_SIZE / 2);
  // Focus flux below ~8 kHz — percussive energy lives there, and dropping
  // the top octave halves the work
  const maxBin = Math.min(FFT_SIZE / 2, Math.round((8000 / (sampleRate / 2)) * (FFT_SIZE / 2)));

  for (let h = 0; h < hops; h++) {
    window.set(mono.subarray(h * HOP, h * HOP + FFT_SIZE));
    fft.magnitudesDb(window, magDb);
    let flux = 0;
    for (let b = 1; b < maxBin; b++) {
      // dB is already log-compressed; clamp the silent floor
      const m = Math.max(-90, magDb[b]);
      const d = m - prev[b];
      if (d > 0) flux += d;
      prev[b] = m;
    }
    env[h] = flux;
  }

  // Remove the local mean (adaptive whitening-lite) so sustained loudness
  // doesn't read as onsets; half-wave rectify.
  const MEAN_W = 16;
  const out = new Float32Array(hops);
  for (let i = 0; i < hops; i++) {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - MEAN_W); j < Math.min(hops, i + MEAN_W); j++) {
      s += env[j];
      n++;
    }
    out[i] = Math.max(0, env[i] - s / Math.max(1, n));
  }
  return { env: out, hopSec: HOP / sampleRate };
}

/** Autocorrelation tempo estimate with a mild 120 BPM-centered prior. */
export function estimateTempo(env: Float32Array, hopSec: number): number {
  const minLag = Math.max(1, Math.round(60 / MAX_BPM / hopSec));
  const maxLag = Math.min(env.length - 1, Math.round(60 / MIN_BPM / hopSec));
  if (maxLag <= minLag) return 0;

  // Smooth a copy for the ACF: onset peaks are 1-2 hops wide, and a tempo
  // period is rarely an integer hop count — without smearing, alignment
  // drifts and the true lag scores unpredictably (classic octave errors).
  const smooth = new Float32Array(env.length);
  const R = 3;
  for (let i = 0; i < env.length; i++) {
    let s = 0;
    let wsum = 0;
    for (let j = -R; j <= R; j++) {
      const k = i + j;
      if (k < 0 || k >= env.length) continue;
      const w = R + 1 - Math.abs(j);
      s += env[k] * w;
      wsum += w;
    }
    smooth[i] = s / Math.max(1, wsum);
  }

  // Normalize by overlap length so long lags aren't penalized for having
  // fewer product terms
  const acfAtLag = (lag: number) => {
    let s = 0;
    const n = smooth.length - lag;
    for (let i = 0; i < n; i++) s += smooth[i] * smooth[i + lag];
    return n > 0 ? s / n : 0;
  };

  // Peak SALIENCE, not raw ACF: slow amplitude modulation inflates the ACF
  // baseline at long lags (smoothly — no beat alignment needed), which is
  // exactly how 3:2 metrical impostors win. Subtracting the local off-peak
  // baseline keeps only sharp periodicity peaks.
  const salienceAtLag = (lag: number) => {
    const d = Math.max(2, Math.round(lag * 0.15));
    const lo = Math.max(0, lag - d);
    const hi = Math.min(env.length - 1, lag + d);
    return acfAtLag(lag) - (acfAtLag(lo) + acfAtLag(hi)) / 2;
  };

  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    // Log-normal tempo preference centered at 120 BPM (sigma ~0.7 octaves)
    const bpm = 60 / (lag * hopSec);
    const pref = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.7, 2));
    const score = salienceAtLag(lag) * pref;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag === 0) return 0;

  // Octave correction: when the half lag (double tempo) is nearly as salient,
  // the true beat is the subdivision — prefer it.
  while (bestLag >= 2 * minLag) {
    const half = Math.round(bestLag / 2);
    if (salienceAtLag(half) >= 0.8 * salienceAtLag(bestLag)) bestLag = half;
    else break;
  }

  // Parabolic refinement around the peak lag for sub-hop precision
  const y0 = acfAtLag(Math.max(minLag, bestLag - 1));
  const y1 = acfAtLag(bestLag);
  const y2 = acfAtLag(Math.min(maxLag, bestLag + 1));
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom)) : 0;
  return 60 / ((bestLag + shift) * hopSec);
}

/** Ellis-style DP beat tracker: pick beat frames maximizing onset strength
 * while staying near the tempo period. */
export function trackBeats(env: Float32Array, hopSec: number, bpm: number): Float32Array {
  if (bpm <= 0 || env.length === 0) return new Float32Array(0);
  const period = 60 / bpm / hopSec; // hops per beat
  const tightness = 400;

  // Normalize the envelope so the transition weight is scale-free
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;
  const norm = mean > 0 ? 1 / mean : 1;

  const n = env.length;
  const score = new Float32Array(n);
  const from = new Int32Array(n).fill(-1);
  const lo = Math.max(1, Math.round(period * 0.5));
  const hi = Math.round(period * 2);

  for (let i = 0; i < n; i++) {
    score[i] = env[i] * norm;
    let best = 0;
    let bestJ = -1;
    for (let j = i - hi; j <= i - lo; j++) {
      if (j < 0) continue;
      const gap = i - j;
      const err = Math.log(gap / period);
      const s = score[j] - tightness * err * err * 0.01;
      if (s > best) {
        best = s;
        bestJ = j;
      }
    }
    if (bestJ >= 0) {
      score[i] += best;
      from[i] = bestJ;
    }
  }

  // Backtrack from the best-scoring frame in the final period
  let end = n - 1;
  for (let i = Math.max(0, n - Math.round(period * 1.5)); i < n; i++) {
    if (score[i] > score[end]) end = i;
  }
  const beatsRev: number[] = [];
  for (let i = end; i >= 0; i = from[i]) {
    beatsRev.push(i);
    if (from[i] < 0) break;
  }
  const beats = new Float32Array(beatsRev.length);
  for (let i = 0; i < beatsRev.length; i++) {
    beats[i] = beatsRev[beatsRev.length - 1 - i] * hopSec;
  }
  return beats;
}

/** Full pipeline: PCM → BeatGrid. */
export function analyzeBeatGrid(pcm: PcmData): BeatGrid {
  // Mono mixdown (matches OfflineAnalyzer's)
  const mono = new Float32Array(pcm.length);
  for (const data of pcm.channels) {
    for (let i = 0; i < data.length; i++) mono[i] += data[i];
  }
  if (pcm.channels.length > 1) {
    const g = 1 / pcm.channels.length;
    for (let i = 0; i < mono.length; i++) mono[i] *= g;
  }

  const { env, hopSec } = onsetEnvelope(mono, pcm.sampleRate);
  const bpm = estimateTempo(env, hopSec);
  const beatTimes = trackBeats(env, hopSec, bpm);
  const shift = (ONSET_LATENCY_WINDOWS * FFT_SIZE) / pcm.sampleRate;
  for (let i = 0; i < beatTimes.length; i++) beatTimes[i] += shift;
  return { bpm: Math.round(bpm * 10) / 10, beatTimes, hopSec };
}

/**
 * Phase within the grid at time t: fractional beat position 0..1 and bar
 * position 0..1 (4/4 assumption), plus the beat index. Constant-time-ish
 * lookup with a moving cursor is the caller's job; this does binary search.
 */
export function gridPhase(
  grid: BeatGrid,
  t: number,
): { beatPhase: number; barPhase: number; beatIndex: number } {
  const beats = grid.beatTimes;
  if (beats.length < 2) return { beatPhase: 0, barPhase: 0, beatIndex: -1 };
  // Binary search: last beat <= t
  let loIdx = 0;
  let hiIdx = beats.length - 1;
  if (t < beats[0]) {
    const period = beats[1] - beats[0];
    const phase = 1 - Math.min(1, Math.max(0, (beats[0] - t) / period));
    return { beatPhase: phase, barPhase: phase / 4, beatIndex: -1 };
  }
  while (loIdx < hiIdx) {
    const mid = (loIdx + hiIdx + 1) >> 1;
    if (beats[mid] <= t) loIdx = mid;
    else hiIdx = mid - 1;
  }
  const i = loIdx;
  const next = i + 1 < beats.length ? beats[i + 1] : beats[i] + (beats[i] - beats[i - 1]);
  const span = Math.max(1e-6, next - beats[i]);
  const beatPhase = Math.min(1, Math.max(0, (t - beats[i]) / span));
  const barPhase = ((i % 4) + beatPhase) / 4;
  return { beatPhase, barPhase, beatIndex: i };
}
