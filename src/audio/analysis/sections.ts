import { RealFFT } from "../dsp/fft";

/**
 * Section-boundary detection (intro/drop/breakdown edges), Foote-style but
 * lightweight: a per-block feature vector (loudness + band balance +
 * spectral centroid) and a before/after contrast novelty curve. Peaks above
 * an adaptive threshold, spaced by a minimum section length, are boundaries.
 *
 * Coarse on purpose — these mark the seek bar and later seed timeline
 * scenes; they don't need beat precision.
 */

const FFT_SIZE = 2048;
/** Feature block hop (seconds). */
const BLOCK_SEC = 0.5;
/** Contrast window on each side of a candidate boundary (seconds). */
const CONTEXT_SEC = 8;
/** Two boundaries can't be closer than this (seconds). */
const MIN_SECTION_SEC = 10;

interface Block {
  loud: number;
  bass: number;
  mid: number;
  treble: number;
  centroid: number;
}

function blockFeatures(mono: Float32Array, sampleRate: number): Block[] {
  const fft = new RealFFT(FFT_SIZE);
  const magDb = new Float32Array(FFT_SIZE / 2);
  const frame = new Float32Array(FFT_SIZE);
  const hop = Math.round(sampleRate * BLOCK_SEC);
  const blocks: Block[] = [];
  const hzPerBin = sampleRate / FFT_SIZE;
  const bassHi = Math.round(150 / hzPerBin);
  const midHi = Math.round(2000 / hzPerBin);

  for (let start = 0; start + FFT_SIZE <= mono.length; start += hop) {
    frame.set(mono.subarray(start, start + FFT_SIZE));
    fft.magnitudesDb(frame, magDb);
    let bass = 0;
    let mid = 0;
    let treble = 0;
    let wsum = 0;
    let fsum = 0;
    for (let b = 1; b < FFT_SIZE / 2; b++) {
      const db = magDb[b];
      if (db === -Infinity) continue;
      const m = Math.pow(10, db / 20);
      if (b <= bassHi) bass += m;
      else if (b <= midHi) mid += m;
      else treble += m;
      wsum += m;
      fsum += m * b * hzPerBin;
    }
    const total = bass + mid + treble;
    blocks.push({
      loud: Math.log10(1e-6 + total),
      bass: total > 0 ? bass / total : 0,
      mid: total > 0 ? mid / total : 0,
      treble: total > 0 ? treble / total : 0,
      centroid: wsum > 0 ? Math.log2(Math.max(20, fsum / wsum) / 20) / 10 : 0,
    });
  }
  return blocks;
}

function blockDistance(a: Block, b: Block): number {
  return (
    Math.abs(a.loud - b.loud) * 0.8 +
    Math.abs(a.bass - b.bass) * 2 +
    Math.abs(a.mid - b.mid) * 2 +
    Math.abs(a.treble - b.treble) * 2 +
    Math.abs(a.centroid - b.centroid) * 1.5
  );
}

function meanBlock(blocks: Block[], from: number, to: number): Block {
  const out: Block = { loud: 0, bass: 0, mid: 0, treble: 0, centroid: 0 };
  const n = Math.max(1, to - from);
  for (let i = from; i < to; i++) {
    out.loud += blocks[i].loud / n;
    out.bass += blocks[i].bass / n;
    out.mid += blocks[i].mid / n;
    out.treble += blocks[i].treble / n;
    out.centroid += blocks[i].centroid / n;
  }
  return out;
}

/** Section boundaries (seconds, ascending) — track start/end excluded. */
export function detectSections(mono: Float32Array, sampleRate: number): number[] {
  const blocks = blockFeatures(mono, sampleRate);
  const ctx = Math.round(CONTEXT_SEC / BLOCK_SEC);
  if (blocks.length < ctx * 2 + 2) return []; // too short for sections

  // Novelty: distance between mean-before and mean-after at every block
  const novelty = new Float32Array(blocks.length);
  for (let i = ctx; i < blocks.length - ctx; i++) {
    novelty[i] = blockDistance(meanBlock(blocks, i - ctx, i), meanBlock(blocks, i, i + ctx));
  }

  // Adaptive threshold: mean + 1.2 std over the valid range
  let mean = 0;
  let count = 0;
  for (let i = ctx; i < novelty.length - ctx; i++) {
    mean += novelty[i];
    count++;
  }
  mean /= Math.max(1, count);
  let variance = 0;
  for (let i = ctx; i < novelty.length - ctx; i++) {
    variance += (novelty[i] - mean) ** 2;
  }
  const std = Math.sqrt(variance / Math.max(1, count));
  // Absolute floor: homogeneous audio has near-zero novelty everywhere and a
  // tiny std — without the floor, numeric jitter would become "boundaries".
  const threshold = Math.max(mean + 1.2 * std, 0.15);

  // Local maxima above threshold, spaced by the minimum section length
  const minGap = Math.round(MIN_SECTION_SEC / BLOCK_SEC);
  const bounds: number[] = [];
  for (let i = ctx + 1; i < novelty.length - ctx - 1; i++) {
    if (
      novelty[i] > threshold &&
      novelty[i] >= novelty[i - 1] &&
      novelty[i] >= novelty[i + 1] &&
      (bounds.length === 0 || i - bounds[bounds.length - 1] >= minGap)
    ) {
      bounds.push(i);
    }
  }
  return bounds.map((i) => i * BLOCK_SEC);
}

/**
 * Section-pulse decay rate, 1/s. A section change is a bigger musical moment
 * than a beat, so its pulse rings longer than beatIntensity (decay 8): at 4/s
 * it reads ~0.37 after 250 ms and is gone (~2%) within a second.
 */
export const SECTION_PULSE_DECAY = 4;

export interface SectionState {
  /** 0 before the first boundary, +1 at each boundary crossed. */
  sectionIndex: number;
  /** 1 exactly at a boundary, exp(-Δt * SECTION_PULSE_DECAY) after, 0 before
   * the first boundary. */
  sectionPulse: number;
}

/**
 * Section identity at time t, as a PURE function of (boundaries, t) — no
 * envelope state, so scrubbing anywhere resolves the identical value the
 * export renders at that track moment, and live/offline share one code path
 * by construction (both call this with their track clock).
 *
 * The field names deliberately match `PipelineInput`/`AudioFeatures`, so the
 * sources can spread the result straight into a pipeline update.
 */
export function sectionStateAt(bounds: number[], t: number): SectionState {
  // Binary search: count of boundaries <= t (bounds ascending from
  // detectSections; also correct on an empty list — one whole-track section).
  let lo = 0;
  let hi = bounds.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bounds[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  const sectionIndex = lo;
  const sectionPulse = lo > 0 ? Math.exp(-(t - bounds[lo - 1]) * SECTION_PULSE_DECAY) : 0;
  return { sectionIndex, sectionPulse };
}
