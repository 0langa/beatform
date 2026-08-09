import { describe, expect, it } from "vitest";
import { OfflineAnalyzer } from "./offlineSource";
import { ANALYSIS_HZ } from "./featurePipeline";
import type { PcmData } from "./types";

/**
 * The onset LATCH and the pipeline's own envelope STATE are two different
 * things, and conflating them made every sub-60 fps export wrong.
 *
 * A rendered frame can span several analysis ticks (a 30 fps export consumes
 * two), so `nextFrameFeatures` reports the MAXIMUM of the onset values over
 * the frame's ticks — otherwise a hit landing on the first of two ticks would
 * be reported at its already-decayed value and a 30 fps export would show a
 * dimmer flash than the audio deserves. That much is deliberate.
 *
 * The accident was WHERE the maximum was written. `kick`, `snare`, `hat` and
 * `driveBeat` live inside their detectors and `features.*` is only a readout
 * of them, so overwriting the readout is harmless. `beatIntensity` is not: the
 * pipeline stores its decaying envelope directly on `features.beatIntensity`
 * and multiplies THAT down on each tick. Writing the frame maximum back into
 * it fed the peak in again, so the envelope advanced one decay step per
 * rendered FRAME instead of one per analysis TICK — at 30 fps the beat flash
 * rang for twice as long as the 60 Hz preview showed, and the error compounded
 * frame after frame rather than settling.
 *
 * Measured on the kick fixture before the fix (60 fps is the reference the
 * preview runs at):
 *
 *      t       60 fps   30 fps   |Δ|
 *      0.033   0.766    0.875    0.109
 *      0.067   0.587    0.766    0.179
 *      0.100   0.449    0.670    0.221
 *      0.133   0.344    0.587    0.242    <- growing, not settling
 *
 * Every export at 30 fps is affected, and that is not an exotic setting: the
 * export dialog offers exactly {30, 60} and Canvas-loop exports are forced to
 * 30. Worse, a job whose preset uses feedback builds a SECOND analyzer pinned
 * at 60 Hz over the same audio, so one export contained two disagreeing
 * notions of how long a beat rings.
 *
 * 60 fps and above are untouched by construction — a frame never consumes more
 * than one tick there, so the maximum IS the pipeline's own value and both the
 * save and the restore are exact no-ops. That is what keeps the golden trace
 * in offlineSource.test.ts bit-identical.
 */

const SR = 48000;
/** featurePipeline's BEAT_DECAY. Private there; the observable is this ratio. */
const BEAT_DECAY = 8;
/** What one analysis tick multiplies a quiet beatIntensity by. */
const PER_TICK = Math.exp(-BEAT_DECAY / ANALYSIS_HZ);

/** 440 Hz bed with a hard 100 Hz kick every 0.5 s — the house fixture. */
function kickTrack(seconds = 2): PcmData {
  const length = SR * seconds;
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / SR;
    data[i] = 0.25 * Math.sin(2 * Math.PI * 440 * t);
    const since = t % 0.5;
    if (since < 0.05) data[i] += 0.9 * Math.sin(2 * Math.PI * 100 * since) * Math.exp(-since * 80);
  }
  return { sampleRate: SR, duration: seconds, length, channels: [data] };
}

interface Frame {
  t: number;
  beat: boolean;
  intensity: number;
}

function run(fps: number): Frame[] {
  const a = new OfflineAnalyzer(kickTrack(), fps);
  const out: Frame[] = [];
  for (let n = 0; n < a.frameCount; n++) {
    const f = a.nextFrameFeatures();
    out.push({ t: f.time, beat: f.beat, intensity: f.beatIntensity });
  }
  return out;
}

describe("offline onset latch vs pipeline envelope state", () => {
  /**
   * The sharp form. At 30 fps every frame past the first consumes exactly two
   * ticks, so on any stretch with no fire the reported value must fall by TWO
   * decay steps per frame. One step per frame is precisely the defect.
   *
   * Asserted as a ratio rather than against stored numbers so it survives any
   * legitimate retune of the fixture, and tightly enough (1e-4) that the two
   * candidate values — 0.7659 and 0.8752 — cannot be confused.
   */
  it("30 fps loses two decay steps per frame, not one", () => {
    const frames = run(30);
    const fire = frames.findIndex((f) => f.beat);
    expect(fire, "fixture must fire a beat").toBeGreaterThanOrEqual(0);
    // Skip the frame straight after the fire: whether it falls one step or two
    // depends on WHICH of that frame's two ticks fired, which is a property of
    // the audio, not of the latch.
    let checked = 0;
    for (let n = fire + 2; n < fire + 6; n++) {
      if (frames[n].beat || frames[n - 1].beat) continue;
      const ratio = frames[n].intensity / frames[n - 1].intensity;
      expect(ratio, `frame ${n} decay ratio`).toBeCloseTo(PER_TICK * PER_TICK, 4);
      checked++;
    }
    expect(checked, "must actually have checked some quiet frames").toBeGreaterThanOrEqual(3);
  });

  it("60 fps loses exactly one decay step per frame (the reference rate)", () => {
    const frames = run(60);
    const fire = frames.findIndex((f) => f.beat);
    let checked = 0;
    for (let n = fire + 2; n < fire + 6; n++) {
      if (frames[n].beat || frames[n - 1].beat) continue;
      expect(frames[n].intensity / frames[n - 1].intensity, `frame ${n}`).toBeCloseTo(PER_TICK, 4);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  /**
   * The user-facing form, and the one that states the determinism law: the
   * envelope a 30 fps EXPORT draws at track time T is the envelope the 60 Hz
   * PREVIEW draws at T, offset by the one analysis tick the latch necessarily
   * looks back over. A constant offset is WYSIWYG; the defect was a different
   * decay rate, which no offset can explain.
   */
  it("a 30 fps export tracks the 60 fps envelope to within one analysis tick", () => {
    const at30 = run(30);
    const at60 = new Map(run(60).map((f) => [f.t.toFixed(5), f.intensity]));
    // A frame that CONTAINS a fire reports the fire, wherever in the frame it
    // landed, so the one-tick shift is undefined there — and so is the frame
    // after one, whose predecessor's maximum may have come from its last tick.
    // Excluding the fire's immediate neighbourhood is not excluding the
    // interesting part: the defect was in the DECAY between fires.
    const skip = new Set<number>();
    at30.forEach((f, i) => {
      if (f.beat) [i - 1, i, i + 1].forEach((j) => skip.add(j));
    });
    let compared = 0;
    let worst = 0;
    for (let i = 0; i < at30.length; i++) {
      if (skip.has(i)) continue;
      const f = at30[i];
      const shifted = at60.get((f.t - 1 / ANALYSIS_HZ).toFixed(5));
      if (shifted === undefined) continue;
      worst = Math.max(worst, Math.abs(f.intensity - shifted));
      compared++;
    }
    // 60 frames at 30 fps, less the ~3-frame neighbourhood of each of the four
    // kicks. Guards against the loop silently comparing nothing.
    expect(compared, "frame times must actually line up").toBeGreaterThan(40);
    // Pre-fix this reached 0.13 and kept growing along each decay; the residue
    // now is float noise on identical arithmetic.
    expect(worst, "worst |Δ| vs the 60 fps envelope one tick earlier").toBeLessThan(1e-6);
  });

  /**
   * 24 fps consumes two OR three ticks per frame depending on where the frame
   * lands, so it cannot be pinned by a single ratio — but the half-life it
   * shows must still be the audio's, not the frame rate's. Measured in TRACK
   * SECONDS, so a frame-rate-shaped error has nowhere to hide.
   */
  it("the envelope's half-life in track seconds does not depend on the frame rate", () => {
    /** Crossing time of 0.5, linearly interpolated so the frame grid does not
     * quantise the answer into the tolerance. */
    const halfLife = (fps: number): number => {
      const frames = run(fps);
      const fire = frames.findIndex((f) => f.beat);
      const from = frames[fire].t;
      for (let n = fire + 1; n < frames.length; n++) {
        if (frames[n].beat) break;
        if (frames[n].intensity < 0.5) {
          const a = frames[n - 1];
          const b = frames[n];
          const cross = a.t + ((b.t - a.t) * (a.intensity - 0.5)) / (a.intensity - b.intensity);
          return cross - from;
        }
      }
      throw new Error(`no half-life at ${fps} fps`);
    };
    const ref = halfLife(60);
    // ln(2)/8 = 86.6 ms. 60 fps samples the envelope on the analysis grid
    // itself, so its interpolated crossing sits within a millisecond of it.
    expect(ref, "60 fps half-life").toBeCloseTo(Math.LN2 / BEAT_DECAY, 2);
    for (const fps of [24, 30, 120]) {
      // Budget: the latch's inherent one-tick look-back plus one frame of
      // interpolation grid. NOT a free pass — pre-fix, 30 fps came in at
      // 174 ms against 87 ms, twice this whole budget.
      const budget = 1 / ANALYSIS_HZ + 1 / fps;
      expect(Math.abs(halfLife(fps) - ref), `half-life at ${fps} fps`).toBeLessThan(budget);
    }
  });

  /**
   * The latch's own reason for existing, kept honest: reporting the maximum is
   * what stops a 30 fps frame from swallowing a full-strength hit. If a future
   * change "fixes" the decay by reporting the last tick instead, this fails.
   */
  it("still reports full-strength pulses at 30 fps", () => {
    const frames = run(30);
    const peaks = frames.filter((f) => f.intensity > 0.999).length;
    expect(peaks, "kicks reported at full strength").toBeGreaterThanOrEqual(3);
  });
});
