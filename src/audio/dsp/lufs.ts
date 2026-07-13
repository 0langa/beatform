/**
 * ITU-R BS.1770-4 loudness. K-weighting = stage 1 high-shelf (+4 dB above
 * ~1.5 kHz, head-diffraction model) + stage 2 high-pass (~38 Hz, RLB curve),
 * then mean-square over 400 ms blocks: L = -0.691 + 10*log10(sum_ch z_i).
 * Coefficients are designed per sample rate with RBJ biquad formulas using
 * the spec's analog corner parameters, matching the reference tables at
 * 48 kHz to 4 decimals.
 */

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * K-weighting stage filters via the parametric redesign from De Man,
 * "Evaluation of implementations of the ITU-R BS.1770 loudness algorithm"
 * — reproduces the spec's 48 kHz coefficient tables exactly and stays
 * spec-faithful at other sample rates.
 */
function kShelf(sampleRate: number): Biquad {
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const fc = 1681.974450955533;
  const K = Math.tan((Math.PI * fc) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  return {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

// The spec's numerator is literally [1, -2, 1] (un-normalized) — the slight
// >1 gain at Nyquist is intentional.
function kHighPass(sampleRate: number): Biquad {
  const Q = 0.5003270373238773;
  const fc = 38.13547087602444;
  const K = Math.tan((Math.PI * fc) / sampleRate);
  const a0 = 1 + K / Q + K * K;
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

function kWeighting(sampleRate: number): [Biquad, Biquad] {
  return [kShelf(sampleRate), kHighPass(sampleRate)];
}

class BiquadState {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(private c: Biquad) {}

  process(x: number): number {
    const y = this.c.b0 * x + this.c.b1 * this.x1 + this.c.b2 * this.x2;
    const out = y - this.c.a1 * this.y1 - this.c.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = out;
    return out;
  }
}

export const LUFS_FLOOR = -70;

/**
 * Streaming momentary-loudness meter: feed contiguous samples per channel,
 * read `momentary` (400 ms window, LUFS). Live meter use.
 */
export class LoudnessMeter {
  private filters: BiquadState[][];
  /** Ring buffer of per-sample K-weighted squared sums (channel-summed). */
  private ring: Float32Array;
  private ringPos = 0;
  private ringFill = 0;
  private sum = 0;

  constructor(sampleRate: number, channels: number) {
    const [shelf, hp] = kWeighting(sampleRate);
    this.filters = Array.from({ length: channels }, () => [
      new BiquadState(shelf),
      new BiquadState(hp),
    ]);
    this.ring = new Float32Array(Math.round(sampleRate * 0.4));
  }

  /** Feed one contiguous block per channel (equal lengths). */
  process(channels: Float32Array[]): void {
    const n = channels[0]?.length ?? 0;
    for (let i = 0; i < n; i++) {
      let z = 0;
      for (let ch = 0; ch < this.filters.length; ch++) {
        const x = channels[ch]?.[i] ?? 0;
        const [shelf, hp] = this.filters[ch];
        const w = hp.process(shelf.process(x));
        z += w * w;
      }
      this.sum -= this.ring[this.ringPos];
      this.ring[this.ringPos] = z;
      this.sum += z;
      this.ringPos = (this.ringPos + 1) % this.ring.length;
      if (this.ringFill < this.ring.length) this.ringFill++;
    }
  }

  /** Momentary loudness (LUFS) over the last 400 ms; LUFS_FLOOR when silent. */
  get momentary(): number {
    if (this.ringFill < this.ring.length / 4) return LUFS_FLOOR;
    const mean = Math.max(1e-12, this.sum / this.ringFill);
    return Math.max(LUFS_FLOOR, -0.691 + 10 * Math.log10(mean));
  }
}

/**
 * Integrated loudness (LUFS) of a whole track per BS.1770-4 gating:
 * 400 ms blocks with 75% overlap, absolute gate at -70 LUFS, then relative
 * gate 10 LU below the absolute-gated mean.
 */
export function integratedLufs(channels: Float32Array[], sampleRate: number): number {
  const length = channels[0]?.length ?? 0;
  if (length === 0) return LUFS_FLOOR;
  const [shelfC, hpC] = kWeighting(sampleRate);
  const weighted = channels.map((data) => {
    const shelf = new BiquadState(shelfC);
    const hp = new BiquadState(hpC);
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = hp.process(shelf.process(data[i]));
    return out;
  });

  const block = Math.round(sampleRate * 0.4);
  const hop = Math.round(sampleRate * 0.1);
  const blockPowers: number[] = [];
  for (let start = 0; start + block <= length; start += hop) {
    let z = 0;
    for (const w of weighted) {
      for (let i = start; i < start + block; i++) z += w[i] * w[i];
    }
    blockPowers.push(z / block);
  }
  if (blockPowers.length === 0) return LUFS_FLOOR;

  const toLufs = (p: number) => -0.691 + 10 * Math.log10(Math.max(1e-12, p));
  const absGated = blockPowers.filter((p) => toLufs(p) > -70);
  if (absGated.length === 0) return LUFS_FLOOR;
  const absMean = absGated.reduce((a, b) => a + b, 0) / absGated.length;
  const relThreshold = toLufs(absMean) - 10;
  const relGated = absGated.filter((p) => toLufs(p) > relThreshold);
  if (relGated.length === 0) return LUFS_FLOOR;
  return toLufs(relGated.reduce((a, b) => a + b, 0) / relGated.length);
}
