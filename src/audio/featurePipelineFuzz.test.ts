import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FeaturePipeline, MAX_DB, MIN_DB, WAVEFORM_LENGTH } from "./featurePipeline";
import { analysisFftSize } from "./dsp/fftSize";
import { sanitizeSync } from "./types";
import type { AudioFeatures } from "./types";

/**
 * Property fuzzing of the audio→render contract (BACKLOG E2).
 *
 * `AudioFeatures` is the only thing renderers see, and a non-finite value in
 * it is not cosmetic: a NaN reaching a shader uniform paints nothing and
 * reports nothing, and every continuous feature here is an EMA, so one bad
 * frame poisons every later one until the app restarts. The example-based
 * suites all feed the pipeline well-formed spectra; this feeds it the whole
 * range its two real callers can produce, at every supported sample rate and
 * under any settings that survive `sanitizeSync`.
 *
 * ── WHY THE GENERATORS LOOK LIKE THIS ───────────────────────────────────────
 *
 * The trap is that junk collapses to defaults and every default is finite, so
 * a finiteness property can pass without ever having reached a guard. Two
 * disciplines keep this one honest.
 *
 * FIRST, the alphabet is the REACHABLE one, established by reading the
 * producers rather than by assuming:
 *
 *   - `magDb` is only ever written by `RealFFT.magnitudesDb`, whose last line
 *     is `m > 1e-10 ? 20 * log10(m) : -Infinity`. NaN fails that comparison,
 *     so the transform provably cannot emit NaN — but it emits -Infinity for
 *     every silent bin of every silent frame, which is the single most common
 *     value in the whole system. Both are generated; NaN is not, because no
 *     input can produce it.
 *   - Waveform samples are NOT clamped to ±1 anywhere. A 32-bit-float WAV is a
 *     standard format that carries no such guarantee and `decodeAudioData`
 *     does not impose one, so huge magnitudes are reachable and generated.
 *     NaN samples are not: every path into a channel buffer is a decoder, an
 *     OfflineAudioContext render or a subarray of one.
 *   - `dt` includes 0. That is reachable live — two rAF callbacks can carry
 *     the identical timestamp and `realtimeSource` computes `now - lastFrameAt`
 *     straight from them.
 *   - Sync settings come from `sanitizeSync(<arbitrary junk>)`, the documented
 *     chokepoint for imported .bfpreset/.bfproj and localStorage, so span,
 *     axis, sampling and the three shape controls all move under the property.
 *   - `fftBins` is `analysisFftSize(rate) / 2`, the real geometry. Picking a
 *     convenient small transform instead makes the display-band property below
 *     fail for a reason no user can reach.
 *
 * SECOND, each property was mutation-checked — the guard it covers was broken
 * and the property confirmed red. See the note above each one.
 *
 * ── WHAT IS DELIBERATELY NOT GENERATED, AND WHY ─────────────────────────────
 *
 * Two inputs DO poison the contract and are left out because nothing can
 * supply them. Recorded so the next sweep does not re-derive them:
 *
 *   - a NaN `width`. It feeds an EMA that `reset()` never clears, so one NaN
 *     frame kills stereo-driven visuals until restart. Both callers compute it
 *     with `stereoWidth`, which returns 0 for a dead channel and otherwise a
 *     ratio of sums of real samples.
 *   - a NaN waveform SAMPLE. `clamp01` keeps it out of every scalar (that is
 *     audit A7's guard), but `features.waveform`/`waveformL`/`waveformR` are
 *     copied through verbatim and would carry it to the oscilloscope. See
 *     above for why no decode path can produce one.
 */

/** Deterministic: a red run reproduces from the seed printed in its output. */
const RUNS = { numRuns: 200, seed: 0x4e_11_ac_02 };

/** Sample rates the app actually meets, from an 8 kHz voice memo up. */
const RATES = [8000, 22050, 44100, 48000, 96000, 192000] as const;

/**
 * Generators produce a short PATTERN which is then tiled across the real
 * transform length. Generating 8192 independent doubles per frame would spend
 * the whole budget in fast-check rather than in the pipeline, and tiling still
 * puts every generated value into a real bin.
 */
const PATTERN = 48;

const dbValue = fc.oneof(
  { weight: 6, arbitrary: fc.double({ min: -140, max: 20, noNaN: true }) },
  { weight: 4, arbitrary: fc.constant(-Infinity) },
  { weight: 1, arbitrary: fc.constantFrom(MIN_DB, MAX_DB, -0, 660, 1e308, -1e308) },
);

const sampleValue = fc.oneof(
  { weight: 8, arbitrary: fc.double({ min: -1, max: 1, noNaN: true }) },
  { weight: 1, arbitrary: fc.constantFrom(0, -0, 1e30, -1e30, 3.4e38, -3.4e38) },
);

const dtValue = fc.oneof(
  { weight: 6, arbitrary: fc.double({ min: 1 / 240, max: 1 / 20, noNaN: true }) },
  { weight: 2, arbitrary: fc.constantFrom(0, -0) },
  { weight: 1, arbitrary: fc.constantFrom(10, 1e-9) },
);

const frameArb = fc.record({
  db: fc.array(dbValue, { minLength: PATTERN, maxLength: PATTERN }),
  wave: fc.array(sampleValue, { minLength: PATTERN, maxLength: PATTERN }),
  dt: dtValue,
  playing: fc.boolean(),
  time: fc.double({ min: 0, max: 600, noNaN: true }),
  tick: fc.boolean(),
});

/**
 * Analysed-span pairs, biased HARD toward the collapsed, near-equal and
 * inverted cases `sanitizeSync`'s MIN_SPAN_RATIO coercion exists for.
 *
 * This bias is the difference between a real test and a green one. Two
 * independent `fc.double()`s essentially never land within a factor of three
 * of each other inside 10..22050 Hz, so the first version of this file
 * generated spans for 200 runs and never once reached the coercion — deleting
 * it outright left every property passing. Every entry below is a pair the
 * span UI can produce by dragging one slider into the other.
 */
const spanArb: fc.Arbitrary<{ freqMin: unknown; freqMax: unknown }> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom<Array<{ freqMin: unknown; freqMax: unknown }>[number]>(
      { freqMin: 10, freqMax: 10 },
      { freqMin: 10, freqMax: 10.0001 },
      { freqMin: 30, freqMax: 31 },
      { freqMin: 22050, freqMax: 22050 },
      { freqMin: 16000, freqMax: 30 },
      { freqMin: 1e300, freqMax: 1e-300 },
      { freqMin: 0, freqMax: 0 },
      { freqMin: 440, freqMax: 441 },
    ),
  },
  {
    weight: 3,
    arbitrary: fc.double({ min: 8, max: 22100, noNaN: true }).chain((a) =>
      fc.record({
        freqMin: fc.constant(a),
        freqMax: fc.double({ min: a * 0.5, max: a * 1.6, noNaN: true }),
      }),
    ),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      freqMin: fc.oneof(fc.double(), fc.constant(NaN)),
      freqMax: fc.oneof(fc.double(), fc.constant(NaN)),
    }),
  },
);

/** Arbitrary junk shaped vaguely like a settings object. */
const syncArb = fc.oneof(
  fc.constant(undefined),
  fc.jsonValue({ maxDepth: 2 }),
  spanArb,
  spanArb.chain((span) =>
    fc.record({
      freqMin: fc.constant(span.freqMin),
      freqMax: fc.constant(span.freqMax),
      spectrumSampling: fc.constantFrom("measured", "interpolated"),
      spectrumResolution: fc.constantFrom("responsive", "detailed", "precise"),
      spectrumAxis: fc.constantFrom("log", "linear"),
    }),
  ),
  fc.record(
    {
      mode: fc.oneof(fc.string(), fc.constantFrom("kick", "energy", "voice", "hats")),
      smooth: fc.oneof(fc.double(), fc.constant(NaN)),
      attack: fc.oneof(fc.double(), fc.constant(NaN)),
      release: fc.oneof(fc.double(), fc.constant(NaN)),
      shapeMerge: fc.double(),
      shapeRound: fc.double(),
      contrast: fc.double(),
      freqMin: fc.oneof(fc.double(), fc.constant(NaN)),
      freqMax: fc.oneof(fc.double(), fc.constant(NaN)),
      spectrumResolution: fc.constantFrom("responsive", "detailed", "precise", "nonsense"),
      spectrumAxis: fc.constantFrom("log", "linear", "nonsense"),
      spectrumSampling: fc.constantFrom("interpolated", "measured", "nonsense"),
    },
    { requiredKeys: [] },
  ),
);

const SCALARS = [
  "rms",
  "energy",
  "voice",
  "drive",
  "driveBeat",
  "bass",
  "mid",
  "treble",
  "width",
  "lufs",
  "kick",
  "snare",
  "hat",
  "bpm",
  "beatPhase",
  "barPhase",
  "beatIntensity",
  "time",
  "duration",
  "beatIndex",
  "barIndex",
  "sectionIndex",
  "sectionPulse",
  "vocal",
] as const;

/** Every reason this frame is not a legal AudioFeatures, or []. */
function violations(f: AudioFeatures): string[] {
  const bad: string[] = [];
  for (const k of SCALARS) {
    const v = f[k];
    if (typeof v === "number" && !Number.isFinite(v)) bad.push(`${k}=${v}`);
  }
  const unit = (name: string, a: Float32Array | undefined) => {
    if (!a) return;
    for (let i = 0; i < a.length; i++) {
      if (!Number.isFinite(a[i])) return bad.push(`${name}[${i}]=${a[i]}`);
      if (a[i] < 0 || a[i] > 1) return bad.push(`${name}[${i}]=${a[i]} outside 0..1`);
    }
  };
  const finite = (name: string, a: Float32Array | undefined) => {
    if (!a) return;
    for (let i = 0; i < a.length; i++) {
      if (!Number.isFinite(a[i])) return bad.push(`${name}[${i}]=${a[i]}`);
    }
  };
  // bins/peaks/chroma are documented 0..1 and reach shader uniforms as such.
  unit("bins", f.bins);
  unit("peaks", f.peaks);
  unit("chroma", f.chroma);
  // The waveform lanes are -1..1 by contract but the pipeline copies the
  // caller's window verbatim, so only finiteness is this layer's promise.
  finite("waveform", f.waveform);
  finite("waveformL", f.waveformL);
  finite("waveformR", f.waveformR);
  return bad;
}

interface Rig {
  pipeline: FeaturePipeline;
  db: Float32Array;
  wave: Float32Array;
}

function rigFor(sampleRate: number): Rig {
  const fftSize = analysisFftSize(sampleRate);
  return {
    pipeline: new FeaturePipeline({
      sampleRate,
      fftBins: fftSize / 2,
      binCount: 96,
      waveformLength: WAVEFORM_LENGTH,
    }),
    db: new Float32Array(fftSize / 2),
    wave: new Float32Array(fftSize),
  };
}

/** Tile a generated pattern across a real-length buffer. */
function tile(dst: Float32Array, pattern: number[]): void {
  for (let i = 0; i < dst.length; i++) dst[i] = pattern[i % pattern.length];
}

describe("FeaturePipeline property fuzz", () => {
  /**
   * MUTATION-CHECKED, twice:
   *   - `clamp01`'s upper bound removed (`v > 0 ? v : 0`), which lets a
   *     float-WAV-scale magnitude out of the dB mapping:
   *     RED, `chroma[0]=1.0000001192092896 outside 0..1`.
   *   - `sanitizeSync`'s `Number.isFinite` check dropped so a NaN `smooth`
   *     survives into the drive EMA: RED, `drive=NaN` — the exact class-1
   *     failure (a NaN reaching a shader uniform) this file exists for.
   * Both reverted.
   */
  it("no reachable frame sequence puts a non-finite value in AudioFeatures", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...RATES),
        syncArb,
        fc.array(frameArb, { minLength: 1, maxLength: 6 }),
        (sampleRate, syncJunk, frames) => {
          const rig = rigFor(sampleRate);
          rig.pipeline.setSync(sanitizeSync(syncJunk));
          for (const fr of frames) {
            tile(rig.db, fr.db);
            tile(rig.wave, fr.wave);
            const out = rig.pipeline.update({
              magDb: rig.db,
              waveform: rig.wave,
              time: fr.time,
              dt: fr.dt,
              playing: fr.playing,
              duration: 600,
              analysisTick: fr.tick,
            });
            const bad = violations(out);
            if (bad.length) throw new Error(bad.join(", "));
          }
        },
      ),
      RUNS,
    );
  });

  /**
   * The poisoning property, which a single-frame finiteness check cannot make:
   * every continuous feature is an EMA, so anything that survives ONE hostile
   * frame survives forever. Drive a burst of hostile frames, then ordinary
   * material, and demand the output be not merely finite but ALIVE.
   *
   * MUTATION-CHECKED: same `clamp01` mutation — RED with
   * `peaks[40]=2.5307116508483887 outside 0..1`, i.e. the poison outlived the
   * hostile burst and the 30 clean frames after it. Reverted.
   */
  it("recovers to live, clean output after a burst of hostile frames", () => {
    fc.assert(
      fc.property(fc.array(frameArb, { minLength: 1, maxLength: 4 }), (hostile) => {
        const rig = rigFor(48000);
        for (const fr of hostile) {
          tile(rig.db, fr.db);
          tile(rig.wave, fr.wave);
          rig.pipeline.update({
            magDb: rig.db,
            waveform: rig.wave,
            time: fr.time,
            dt: fr.dt,
            playing: fr.playing,
            duration: 600,
            analysisTick: fr.tick,
          });
        }
        rig.db.fill(-40);
        for (let i = 0; i < rig.wave.length; i++) rig.wave[i] = 0.2 * Math.sin(i / 23);
        let out: AudioFeatures | null = null;
        for (let n = 0; n < 30; n++) {
          out = rig.pipeline.update({
            magDb: rig.db,
            waveform: rig.wave,
            time: 10 + n / 60,
            dt: 1 / 60,
            playing: true,
            duration: 600,
            analysisTick: true,
          });
        }
        const f = out as AudioFeatures;
        const bad = violations(f);
        if (bad.length) throw new Error(bad.join(", "));
        if (!(f.rms > 0)) throw new Error("rms did not recover");
        if (!(f.bass > 0)) throw new Error("bass did not recover");
      }),
      RUNS,
    );
  });

  /**
   * The drawn spectrum must never collapse to zero bands: `measured` sampling
   * exposes only the native FFT bins whose centres fall inside the analysed
   * span, and a span narrow relative to the bin grid is where that count goes
   * to zero and the renderer is handed an empty `bins` array — a black
   * spectrum with nothing in any log to explain it.
   *
   * MUTATION-CHECKED: `sanitizeSync`'s MIN_SPAN_RATIO coercion was removed so
   * a collapsed pair (freqMin === freqMax) survives; the span then resolves to
   * zero native bins and the property went RED on `empty bins`. Reverted.
   *
   * That guard had no test anywhere, and the first version of THIS one could
   * not see it either — see `spanArb` for why an unbiased generator made the
   * whole span axis vacuous.
   */
  it("always exposes at least one display band, at every rate and span", () => {
    fc.assert(
      fc.property(fc.constantFrom(...RATES), syncArb, (sampleRate, syncJunk) => {
        const rig = rigFor(sampleRate);
        rig.pipeline.setSync(sanitizeSync(syncJunk));
        rig.db.fill(-50);
        const out = rig.pipeline.update({
          magDb: rig.db,
          waveform: rig.wave,
          time: 0,
          dt: 1 / 60,
          playing: true,
          duration: 10,
        });
        if (out.bins.length < 1) throw new Error("empty bins");
        if (out.bins.length !== out.peaks.length) throw new Error("bins/peaks length mismatch");
        if (out.chroma?.length !== 12) throw new Error("chroma must always be 12 lanes");
      }),
      RUNS,
    );
  });
});

describe("sanitizeSync property fuzz", () => {
  /**
   * MUTATION-CHECKED: dropping the MIN_SPAN_RATIO coercion went RED with
   * `expected 1 to be greater than or equal to 2.999999999`; dropping the
   * `Number.isFinite` guard in `sanitizeSync`'s clamp helper went RED with
   * `release finite: expected false to be true`. Both reverted.
   */
  it("turns any junk into settings the pipeline can use", () => {
    fc.assert(
      // `syncArb`, not bare jsonValue: random JSON never produces a numeric
      // freqMin/freqMax pair, so the span half of this test would be vacuous.
      fc.property(syncArb, (junk) => {
        const s = sanitizeSync(junk);
        expect(Number.isFinite(s.smooth)).toBe(true);
        expect(s.smooth).toBeGreaterThanOrEqual(0);
        expect(s.smooth).toBeLessThanOrEqual(1);
        for (const k of ["attack", "release", "shapeMerge", "shapeRound", "contrast"] as const) {
          const v = s[k];
          if (v !== undefined) {
            expect(Number.isFinite(v), `${k} finite`).toBe(true);
            expect(v >= 0 && v <= 1, `${k} in 0..1`).toBe(true);
          }
        }
        // The span travels as a PAIR, and the geometric spacing divides by the
        // low edge — a lone edge, an inverted pair or a collapsed one would be
        // a NaN in every drawn band.
        expect(s.freqMin === undefined).toBe(s.freqMax === undefined);
        if (s.freqMin !== undefined && s.freqMax !== undefined) {
          expect(s.freqMin).toBeGreaterThan(0);
          expect(s.freqMax / s.freqMin).toBeGreaterThanOrEqual(3 - 1e-9);
        }
      }),
      RUNS,
    );
  });
});
