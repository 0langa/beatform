import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AudioFeatures, PcmData } from "../audio/types";
import type { ModRoute } from "../state/modMatrix";
import { DEFAULT_MOTION, DEFAULT_POST } from "../render/types";

/**
 * E2 — the CROSS-FRAME-RATE walk.
 *
 * `exportCoreDeterminism.test.ts` proves two runs of the SAME job resolve the
 * same frames. That is blind to the other half of the determinism law: a 60 fps
 * preview and a 30 fps export must resolve the same frame at the same TRACK
 * TIME. An accumulator written per FRAME instead of per SECOND satisfies the
 * first test perfectly and breaks the second — which is exactly how
 * `beatIntensity` shipped decaying once per rendered frame, so every sub-60 fps
 * export ran its beat pulse down faster than the preview did. Nothing in the
 * suite compared two frame rates, so nothing caught it.
 *
 * This file renders one job at 30 fps and again at 60 fps and compares the
 * frames at the timestamps they share (every 30 fps frame is also a 60 fps
 * frame). At those instants the CONTINUOUS features must be bit-identical, and
 * so must the params an instant modulation route resolves from them.
 *
 * TWO exclusions from that comparison, and they are NOT the same kind of thing:
 *
 *  - LATCHED_FIELDS is excluded because a rendered frame reports the MAX of
 *    each onset field over every analysis tick it swallowed. That latch is
 *    deliberate — it is what stops a 30 fps export dropping a hit that landed
 *    between its frames — so the two rates legitimately report different
 *    instantaneous values. Their DECAY RATE must still match, and the sweep
 *    lower down asserts exactly that.
 *  - Attack/release routes are excluded by design. `alpha = 1 - exp(-dt/tau)`
 *    is frame-rate INDEPENDENT in the sense that matters (same time constant,
 *    same convergence) but two half-steps over a MOVING target do not equal one
 *    whole step. The routes here are instant on purpose; a lag'd route's
 *    cross-rate behaviour is a tolerance question, not an equality one.
 */

type Rendered = { t: number; features: AudioFeatures; params: Record<string, number> };

const cfg = vi.hoisted(() => ({ rendered: [] as Rendered[] }));

/** Snapshot the analyzer's REUSED feature object — it is mutated in place. */
function snapshotFeatures(f: AudioFeatures): AudioFeatures {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    out[k] = ArrayBuffer.isView(v) ? (v as Float32Array).slice() : v;
  }
  return out as unknown as AudioFeatures;
}

vi.mock("../render/webgpuRenderer", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../render/webgpuRenderer")>();
  class FakeRenderer {
    onDeviceLost: ((reason: string) => void) | null = null;
    static create = async () => new FakeRenderer();
    setDeepCapture() {}
    setPreset() {}
    setBackground() {}
    setOverlay() {}
    setSmoothSpectrum() {}
    setPost() {}
    setMotion() {}
    setBuilderParams() {}
    setCoverArt() {}
    setBackgroundImage() {}
    updateBackgroundVideoFrame() {}
    setTransitionPreset() {}
    resize() {}
    render(features: AudioFeatures, t: number, params: Record<string, number>) {
      cfg.rendered.push({ t, features: snapshotFeatures(features), params: { ...params } });
    }
    async gpuDone() {}
    async readbackDeepFrame() {
      return new Uint16Array(0);
    }
    dispose() {}
  }
  return { ...mod, WebGPURenderer: FakeRenderer };
});

import { runExportJob, type ExportJob } from "./exportCore";

/**
 * The onset fields, latched over every analysis tick a rendered frame
 * consumes. Excluded from the equality sweep because they DO NOT currently
 * agree across frame rates — see the pinning test at the bottom.
 */
const LATCHED_FIELDS = ["beat", "beatIntensity", "kick", "snare", "hat", "driveBeat"] as const;

/** The decaying members of that set (everything but the boolean). */
type OnsetEnvelope = Exclude<(typeof LATCHED_FIELDS)[number], "beat">;

/** 1 s of a swelling, beating tone: the features have to actually move, or
 * "identical at every shared timestamp" is a comparison of constants. */
function makePcm(): PcmData {
  const sampleRate = 48000;
  const n = sampleRate;
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = i / sampleRate;
    // A 4 Hz amplitude pulse over a swelling tone — onsets and a rising floor.
    const pulse = Math.pow(1 - ((s * 4) % 1), 3);
    ch[i] = Math.sin(i * 0.06) * (0.05 + 0.7 * s) * (0.25 + 0.75 * pulse);
  }
  return { sampleRate, length: n, duration: n / sampleRate, channels: [ch] };
}

/** Instant routes only (see the header): pure functions of the features. */
const MODS: ModRoute[] = [
  { id: "r1", source: "rms", param: "glow", amount: 0.8, curve: "smooth" },
  { id: "r2", source: "treble", param: "barHeight", amount: -0.8 },
];

function job(fps: number, pcm: PcmData): ExportJob {
  return {
    pcm,
    width: 96,
    height: 64,
    fps,
    bitrate: 1_000_000,
    // Non-feedback on purpose: the 60 Hz feedback catch-up walk has its own
    // fixed clock and its own coverage; this file is about the PRESENTED walk.
    presetId: "spectrum-bars",
    params: {},
    bg: { mode: 0, color: [0, 0, 0] },
    mods: MODS,
    post: { ...DEFAULT_POST },
    motion: { ...DEFAULT_MOTION },
    smoothSpectrum: true,
    // Track analysis, so bpm/beatPhase/barPhase/sectionIndex/sectionPulse and
    // the vocal envelope are all live rather than parked at their defaults.
    beatGrid: { bpm: 120, beatTimes: new Float32Array([0, 0.5, 1]), hopSec: 512 / 48000 },
    sections: [0.3, 0.7],
    vocalSpans: [{ start: 0.2, end: 0.6 }],
    mode: "png",
  };
}

async function walk(fps: number, pcm: PcmData): Promise<Rendered[]> {
  cfg.rendered = [];
  await runExportJob(job(fps, pcm), { onFrame: async () => {} });
  return cfg.rendered;
}

beforeEach(() => {
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return null;
      }
      async convertToBlob() {
        return new Blob([new Uint8Array([0x89, 0x50])]);
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("export walk across frame rates (E2)", () => {
  it("resolves identical continuous features at every shared track time", async () => {
    /**
     * 30 and 60 are the two rates the export dialog offers (ExportDialog's
     * "Frame rate" select), and 30 is the default. ABOVE 60 the analyzer
     * deliberately refreshes the continuous features on frames where no tick is
     * due (offlineSource.nextFrameFeatures' `!ticked` branch), which makes the
     * EMA-smoothed fields — `bins`/`peaks` — land on different values at the
     * same track time; that asymmetry is documented there, is not reachable
     * from the export UI, and is deliberately out of this comparison.
     */
    const walks = new Map<number, Rendered[]>();
    for (const fps of [30, 60]) walks.set(fps, await walk(fps, makePcm()));
    expect(walks.get(30)).toHaveLength(30);
    expect(walks.get(60)).toHaveLength(60);

    const latched = new Set<string>(LATCHED_FIELDS);
    const compared = new Set<string>();
    let sharedInstants = 0;

    for (const [lo, hi] of [[30, 60]]) {
      const slow = walks.get(lo)!;
      const fast = new Map(walks.get(hi)!.map((r) => [r.t.toFixed(9), r]));
      const shared: [Rendered, Rendered][] = [];
      for (const a of slow) {
        const b = fast.get(a.t.toFixed(9));
        if (b) shared.push([a, b]);
      }
      // Non-vacuity: every slow instant IS a fast instant (hi = 2 * lo), so the
      // overlap is the whole slow walk. A shrinking overlap would gut this test.
      expect(shared, `${lo} vs ${hi} fps overlap`).toHaveLength(lo);
      sharedInstants += shared.length;

      for (const [a, b] of shared) {
        for (const key of Object.keys(a.features)) {
          if (latched.has(key)) continue;
          const av = (a.features as unknown as Record<string, unknown>)[key];
          const bv = (b.features as unknown as Record<string, unknown>)[key];
          compared.add(key);
          const where = `features.${key} differs at t=${a.t} between ${lo} and ${hi} fps`;
          if (ArrayBuffer.isView(av)) {
            expect(Array.from(av as unknown as ArrayLike<number>), where).toEqual(
              Array.from(bv as unknown as ArrayLike<number>),
            );
          } else {
            expect(bv, where).toEqual(av);
          }
        }
      }
    }

    expect(sharedInstants).toBe(30);
    // Non-vacuity 1: the sweep really did compare the whole contract, not a
    // handful of fields that happen to be constant.
    expect(compared.size).toBeGreaterThan(20);
    for (const f of LATCHED_FIELDS) expect(compared.has(f)).toBe(false);

    // Non-vacuity 2: the compared fields MOVE. Constants agree with themselves.
    const at30 = walks.get(30)!;
    const distinct = (pick: (r: Rendered) => number) =>
      new Set(at30.map((r) => pick(r).toFixed(6))).size;
    expect(distinct((r) => r.features.rms)).toBeGreaterThan(5);
    expect(distinct((r) => r.features.bass)).toBeGreaterThan(5);
    expect(distinct((r) => r.features.beatPhase)).toBeGreaterThan(5);
    expect(distinct((r) => r.features.bins[3])).toBeGreaterThan(5);
    // ...and the P-15 fuel that resolves from track time is genuinely on.
    expect(new Set(at30.map((r) => r.features.sectionIndex)).size).toBeGreaterThan(1);
    expect(distinct((r) => r.features.vocal ?? 0)).toBeGreaterThan(3);
  });

  it("resolves identical modulated params at every shared track time", async () => {
    const at30 = await walk(30, makePcm());
    const at60 = await walk(60, makePcm());
    const byTime60 = new Map(at60.map((r) => [r.t.toFixed(9), r]));

    let checked = 0;
    for (const a of at30) {
      const b = byTime60.get(a.t.toFixed(9));
      if (!b) continue;
      expect(b.params, `params differ at t=${a.t} between 30 and 60 fps`).toEqual(a.params);
      checked++;
    }
    expect(checked).toBe(30);

    // Non-vacuity: the routes have to be doing something. A route resolving to
    // one constant would make the equality above meaningless.
    const glow = new Set(at30.map((r) => r.params.glow.toFixed(6)));
    const barHeight = new Set(at30.map((r) => r.params.barHeight.toFixed(6)));
    expect(glow.size).toBeGreaterThan(5);
    expect(barHeight.size).toBeGreaterThan(5);
  });

  /**
   * Median per-FRAME decay factor of an onset envelope, over consecutive frames
   * with no onset between them. A 30 fps frame swallows two 60 Hz analysis
   * ticks, so if the envelope decays PER TICK its 30 fps factor must be the
   * SQUARE of its 60 fps factor. If it decays per rendered FRAME the two
   * factors are equal instead — the whole distinction this file exists to make.
   */
  function frameDecay(rows: Rendered[], f: OnsetEnvelope): number {
    const ratios: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1].features[f];
      if (rows[i].features.beat || rows[i - 1].features.beat || prev < 0.1) continue;
      ratios.push(rows[i].features[f] / prev);
    }
    // Non-vacuity: an envelope that never fired or never decayed gives nothing
    // to measure, and the caller's comparison would be NaN-vs-NaN.
    expect(ratios.length, `no decaying stretch to measure for ${f}`).toBeGreaterThan(5);
    return ratios.sort((a, b) => a - b)[ratios.length >> 1];
  }

  /**
   * `beatIntensity` is in this sweep rather than pinned separately because the
   * E2 audio wave fixed it the same day this file was written. It reached the
   * list by a different route from its four siblings: they are recomputed from
   * private detector state every tick, so the per-frame latch that
   * `nextFrameFeatures` writes back is harmlessly overwritten for them, while
   * `beatIntensity` is the one field the pipeline decays FROM that same object
   * — so the latch fed the peak back in and cancelled one decay step per
   * RENDERED frame. Two independent sweeps found it, and this assertion is the
   * one written without knowledge of the fix.
   */
  it("runs kick / snare / hat / driveBeat / beatIntensity down on the analysis clock, not the frame clock", async () => {
    const at30 = await walk(30, makePcm());
    const at60 = await walk(60, makePcm());
    for (const f of ["kick", "snare", "hat", "driveBeat", "beatIntensity"] as const) {
      const r30 = frameDecay(at30, f);
      const r60 = frameDecay(at60, f);
      expect(r30, `${f}: a 30 fps frame must decay by TWO ticks' worth`).toBeCloseTo(r60 * r60, 4);
      // Non-vacuity: r60 must not be ~1 (no decay) or ~0 (instant), or the
      // squaring above would be indistinguishable from equality.
      expect(r60).toBeGreaterThan(0.5);
      expect(r60).toBeLessThan(0.95);
    }
  });
});
