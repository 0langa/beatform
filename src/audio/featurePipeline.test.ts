import { describe, expect, it } from "vitest";
import { FeaturePipeline, MIN_DB, MAX_DB } from "./featurePipeline";
import type { PipelineInput } from "./featurePipeline";

const SAMPLE_RATE = 48000;
const FFT_BINS = 2048; // fftSize 4096
const WAVE_LEN = 1536;
const DT = 1 / 60;

function makePipeline(): FeaturePipeline {
  return new FeaturePipeline({
    sampleRate: SAMPLE_RATE,
    fftBins: FFT_BINS,
    binCount: 96,
    waveformLength: WAVE_LEN,
  });
}

function makeInput(overrides: Partial<PipelineInput> = {}): PipelineInput {
  return {
    magDb: new Float32Array(FFT_BINS).fill(MIN_DB),
    waveform: new Float32Array(FFT_BINS),
    time: 0,
    dt: DT,
    playing: true,
    duration: 60,
    ...overrides,
  };
}

/** FFT bin index for a frequency, mirroring the pipeline's own mapping. */
function hzToBin(hz: number): number {
  const hzPerBin = SAMPLE_RATE / 2 / FFT_BINS;
  return Math.max(0, Math.min(FFT_BINS - 1, Math.round(hz / hzPerBin)));
}

function fillBand(magDb: Float32Array, loHz: number, hiHz: number, db: number): void {
  for (let b = hzToBin(loHz); b <= hzToBin(hiHz); b++) magDb[b] = db;
}

/** Beat times (s) for a kick-every-0.5s signal run at a given fps. */
function beatTimesAtFps(fps: number, seconds: number): number[] {
  const p = makePipeline();
  const dt = 1 / fps;
  const beats: number[] = [];
  const frames = Math.round(seconds * fps);
  for (let n = 0; n < frames; n++) {
    const t = n / fps;
    const magDb = new Float32Array(FFT_BINS).fill(MIN_DB);
    // A kick lands on the first frame at/after each 0.5 s boundary
    const sinceKick = t % 0.5;
    if (sinceKick < dt) fillBand(magDb, 40, 140, MAX_DB);
    const f = p.update(makeInput({ magDb, time: t, dt }));
    if (f.beat) beats.push(t);
  }
  return beats;
}

describe("FeaturePipeline fps-independence (WYSIWYG)", () => {
  it("fires beats at the same track times at 60 and 30 fps", () => {
    const at60 = beatTimesAtFps(60, 4);
    const at30 = beatTimesAtFps(30, 4);
    expect(at60.length).toBeGreaterThanOrEqual(6);
    // Same count, and each 30 fps beat is within ~1.5 frames of its 60 fps twin
    expect(Math.abs(at60.length - at30.length)).toBeLessThanOrEqual(1);
    const pairs = Math.min(at60.length, at30.length);
    for (let i = 0; i < pairs; i++) {
      expect(Math.abs(at60[i] - at30[i])).toBeLessThan(0.05);
    }
  });
});

describe("FeaturePipeline", () => {
  it("maps MIN_DB to 0 and MAX_DB to saturated bins", () => {
    const p = makePipeline();
    // Silence stays at zero
    let f = p.update(makeInput());
    expect(Math.max(...f.bins)).toBe(0);

    // Full-scale spectrum converges to 1 under the attack EMA
    const hot = makeInput({ magDb: new Float32Array(FFT_BINS).fill(MAX_DB) });
    for (let i = 0; i < 60; i++) f = p.update({ ...hot, time: i * DT });
    expect(Math.min(...f.bins)).toBeGreaterThan(0.99);
  });

  it("attacks faster than it releases", () => {
    const p = makePipeline();
    const hot = makeInput({ magDb: new Float32Array(FFT_BINS).fill(MAX_DB) });
    const cold = makeInput();

    let framesUp = 0;
    while (p.update(hot).bins[48] < 0.9 && framesUp < 200) framesUp++;

    let framesDown = 0;
    while (p.update(cold).bins[48] > 0.1 && framesDown < 200) framesDown++;

    expect(framesUp).toBeLessThan(framesDown);
    expect(framesDown).toBeLessThan(200);
  });

  it("holds peaks above bins and lets them fall with gravity", () => {
    const p = makePipeline();
    const hot = makeInput({ magDb: new Float32Array(FFT_BINS).fill(MAX_DB) });
    for (let i = 0; i < 60; i++) p.update(hot);

    const cold = makeInput();
    let prevPeak = p.update(cold).peaks[48];
    for (let i = 0; i < 20; i++) {
      const f = p.update(cold);
      expect(f.peaks[48]).toBeGreaterThanOrEqual(f.bins[48]);
      expect(f.peaks[48]).toBeLessThanOrEqual(prevPeak);
      prevPeak = f.peaks[48];
    }
    // Gravity is 0.55/s: after ~0.35 s the peak has visibly fallen
    expect(prevPeak).toBeLessThan(0.9);
  });

  it("detects low-end impulses as beats and respects the refractory period", () => {
    const p = makePipeline();
    const beatFrames: number[] = [];
    const totalFrames = 240; // 4 s at 60 fps
    for (let i = 0; i < totalFrames; i++) {
      const magDb = new Float32Array(FFT_BINS).fill(MIN_DB);
      if (i > 0 && i % 30 === 0) fillBand(magDb, 40, 140, MAX_DB); // kick every 0.5 s
      const f = p.update(makeInput({ magDb, time: i * DT }));
      if (f.beat) {
        beatFrames.push(i);
        expect(f.beatIntensity).toBe(1);
      }
    }
    // Impulses land at frames 30, 60, ..., 210 — all after warmup, all detected
    expect(beatFrames).toEqual([30, 60, 90, 120, 150, 180, 210]);
  });

  it("decays beatIntensity exponentially after a beat", () => {
    const p = makePipeline();
    for (let i = 0; i < 60; i++) {
      const magDb = new Float32Array(FFT_BINS).fill(MIN_DB);
      if (i === 30) fillBand(magDb, 40, 140, MAX_DB);
      p.update(makeInput({ magDb, time: i * DT }));
    }
    // 30 frames after the beat: intensity = exp(-8 * 0.5) ≈ 0.018, and falling
    const f = p.update(makeInput({ time: 61 * DT }));
    expect(f.beatIntensity).toBeGreaterThan(0);
    expect(f.beatIntensity).toBeLessThan(0.05);
  });

  it("never fires beats while paused", () => {
    const p = makePipeline();
    for (let i = 0; i < 120; i++) {
      const magDb = new Float32Array(FFT_BINS).fill(MIN_DB);
      if (i % 30 === 0) fillBand(magDb, 40, 140, MAX_DB);
      const f = p.update(makeInput({ magDb, playing: false, time: i * DT }));
      expect(f.beat).toBe(false);
    }
  });

  it("starts the displayed waveform at a rising zero crossing", () => {
    const p = makePipeline();
    const wave = new Float32Array(FFT_BINS);
    // Negative half then positive ramp: crossing at index 256
    for (let i = 0; i < FFT_BINS; i++) wave[i] = i < 256 ? -0.5 : 0.5;
    const f = p.update(makeInput({ waveform: wave }));
    expect(f.waveform[0]).toBeCloseTo(0.5, 5);
  });

  it("computes band energies in the right order for a bass-heavy spectrum", () => {
    const p = makePipeline();
    const magDb = new Float32Array(FFT_BINS).fill(MIN_DB);
    fillBand(magDb, 40, 140, MAX_DB); // bass only
    p.update(makeInput({ magDb }));
    const f = p.update(makeInput({ magDb }));
    expect(f.bass).toBeGreaterThan(0.9);
    expect(f.mid).toBeLessThan(0.2);
    expect(f.treble).toBe(0);
  });

  it("classifies drum-band onsets independently (kick vs hat)", () => {
    const p = makePipeline();
    let kickAtKick = 0;
    let hatAtKick = 0;
    let hatAtHat = 0;
    let kickAtHat = 0;
    for (let i = 0; i < 180; i++) {
      const magDb = new Float32Array(FFT_BINS).fill(MIN_DB);
      if (i === 60) fillBand(magDb, 45, 110, MAX_DB); // kick hit
      if (i === 120) fillBand(magDb, 6000, 12000, MAX_DB); // hat hit
      const f = p.update(makeInput({ magDb, time: i * DT }));
      if (i === 60) {
        kickAtKick = f.kick;
        hatAtKick = f.hat;
      }
      if (i === 120) {
        hatAtHat = f.hat;
        kickAtHat = f.kick;
      }
    }
    expect(kickAtKick).toBe(1);
    expect(hatAtKick).toBeLessThan(0.1);
    expect(hatAtHat).toBe(1);
    expect(kickAtHat).toBeLessThan(0.1);
  });

  it("onset-class pulses decay between hits", () => {
    const p = makePipeline();
    let peak = 0;
    let after = 0;
    for (let i = 0; i < 90; i++) {
      const magDb = new Float32Array(FFT_BINS).fill(MIN_DB);
      if (i === 30) fillBand(magDb, 45, 110, MAX_DB);
      const f = p.update(makeInput({ magDb, time: i * DT }));
      if (i === 30) peak = f.kick;
      if (i === 60) after = f.kick;
    }
    expect(peak).toBe(1);
    expect(after).toBeLessThan(0.05);
  });

  it("is deterministic: identical input sequences produce identical features", () => {
    const runs: number[][] = [];
    for (let run = 0; run < 2; run++) {
      const p = makePipeline();
      const trace: number[] = [];
      // Deterministic pseudo-random spectrum sequence
      let seed = 1234;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      for (let i = 0; i < 90; i++) {
        const magDb = new Float32Array(FFT_BINS);
        for (let b = 0; b < FFT_BINS; b++) magDb[b] = MIN_DB + rand() * (MAX_DB - MIN_DB);
        const wave = new Float32Array(FFT_BINS);
        for (let s = 0; s < FFT_BINS; s++) wave[s] = Math.sin(s * 0.05 + i) * rand();
        const f = p.update(makeInput({ magDb, waveform: wave, time: i * DT }));
        trace.push(f.bins[10], f.peaks[10], f.rms, f.energy, f.bass, f.drive, f.beatIntensity);
      }
      runs.push(trace);
    }
    expect(runs[0]).toEqual(runs[1]);
  });
});
