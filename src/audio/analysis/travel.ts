/**
 * The travel curve: loudness-integrated track time.
 *
 * A visual that "goes faster when the music is loud" cannot integrate
 * loudness as it goes — an accumulator diverges between a seeking preview
 * and a frame-by-frame export, which the determinism law forbids. Folding
 * loudness into the travel POSITION instead (travel = t·v + k·drive, the
 * shape every mode shipped with) makes the picture lurch backwards whenever
 * the music gets quieter — a tunnel that pumps instead of flying, the owner's
 * "doesn't feel like travelling continuously".
 *
 * This curve is the law-abiding integral: computed ONCE from the decoded PCM
 * at track-analysis time (beside the beat grid and sections) and sampled by
 * track time, so preview, seek, export and batch all read the identical
 * value at the identical moment. `travel(t)` is
 *
 *     ∫₀ᵗ L(τ) / L̄ dτ
 *
 * with L the short-window RMS amplitude and L̄ its whole-track mean, so the
 * curve advances at exactly 1 s/s on average (a quiet intro moves slowly, a
 * drop surges, the whole song still covers its own duration), is monotonic
 * by construction, and equals plain `t` for a track of constant loudness.
 * Shaders read it as `u.travel`; modes blend between `u.time` and
 * `u.travel` to taste.
 */
export interface TravelCurve {
  /** Sample spacing, seconds. */
  hopSec: number;
  /** `values[i]` = travel at time `i * hopSec`; `values[0]` is 0. */
  values: Float32Array;
}

/** Analysis hop: 50 ms is fine enough that no beat reads as a step and
 * coarse enough that a two-hour track is ~150k floats. */
export const TRAVEL_HOP_SEC = 0.05;

/**
 * Below this fraction of the track's mean amplitude a hop is treated as
 * "silent-ish" and advances at the floor rate — a digital-silence intro
 * would otherwise park a loudness-driven camera completely still.
 */
const FLOOR_RATIO = 0.08;

/**
 * Build the travel curve of a mono signal. Deterministic: same PCM in, same
 * curve out. Returns null for audio too short to hold two hops.
 */
export function travelCurveOf(mono: Float32Array, sampleRate: number): TravelCurve | null {
  const hop = Math.max(1, Math.round(sampleRate * TRAVEL_HOP_SEC));
  const hops = Math.floor(mono.length / hop);
  if (hops < 2) return null;
  const rms = new Float32Array(hops);
  let sum = 0;
  for (let h = 0; h < hops; h++) {
    const base = h * hop;
    let acc = 0;
    for (let i = 0; i < hop; i++) {
      const v = mono[base + i];
      acc += v * v;
    }
    const r = Math.sqrt(acc / hop);
    rms[h] = r;
    sum += r;
  }
  const mean = sum / hops;
  const values = new Float32Array(hops + 1);
  if (!(mean > 0)) {
    // Digital silence end to end: travel is plain time.
    for (let h = 0; h <= hops; h++) values[h] = h * TRAVEL_HOP_SEC;
    return { hopSec: TRAVEL_HOP_SEC, values };
  }
  // Floor, then renormalise so the curve still covers exactly the track's
  // duration — the floor lifts silence, the renormalisation keeps the average
  // rate at 1 s/s.
  let floored = 0;
  const floor = mean * FLOOR_RATIO;
  for (let h = 0; h < hops; h++) {
    const w = Math.max(rms[h], floor);
    rms[h] = w;
    floored += w;
  }
  const scale = hops / floored;
  let acc = 0;
  values[0] = 0;
  for (let h = 0; h < hops; h++) {
    acc += rms[h] * scale * TRAVEL_HOP_SEC;
    values[h + 1] = acc;
  }
  return { hopSec: TRAVEL_HOP_SEC, values };
}

/**
 * Sample the curve at track time `t` (linear between hops). Before 0 and
 * past the last sample the curve continues at 1 s/s, so a clip that outruns
 * its analysis still moves. Negative t (a lead-in) extrapolates likewise.
 */
export function travelAt(curve: TravelCurve, t: number): number {
  const v = curve.values;
  const last = v.length - 1;
  if (!(t > 0)) return t;
  const x = t / curve.hopSec;
  if (x >= last) return v[last] + (t - last * curve.hopSec);
  const i = Math.floor(x);
  const f = x - i;
  return v[i] + (v[i + 1] - v[i]) * f;
}

/**
 * Rebase the curve onto a clip starting at `start` seconds — a segment
 * export's t=0 — so `travelAt(shifted, t) === travelAt(curve, start + t) -
 * travelAt(curve, start)`: the clip's travel starts at 0 like its time does,
 * and every per-frame DIFFERENCE (the motion) is the one the preview shows
 * at the same track moment. Mirrors how the beat grid, sections and lyrics
 * are shifted for a segment.
 */
export function shiftTravelCurve(curve: TravelCurve, start: number): TravelCurve {
  if (!(start > 0)) return curve;
  const origin = travelAt(curve, start);
  const remaining = Math.max(0, (curve.values.length - 1) * curve.hopSec - start);
  const n = Math.floor(remaining / curve.hopSec) + 1;
  const values = new Float32Array(Math.max(2, n));
  for (let i = 0; i < values.length; i++) {
    values[i] = travelAt(curve, start + i * curve.hopSec) - origin;
  }
  return { hopSec: curve.hopSec, values };
}
