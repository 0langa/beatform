import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioFeatures, PcmData } from "../audio/types";
import { applyMods, type ModRoute } from "../state/modMatrix";
import { presetById } from "../render/presets";
import { DEFAULT_MOTION, DEFAULT_POST, type ParamValues } from "../render/types";

/**
 * E2-R1 — the segment LFO phase, walked end to end.
 *
 * `modMatrix.test.ts` pins the arithmetic, `offlineSource.test.ts` pins the
 * stamp, `segmentShiftMatrix.test.ts` pins the job field. All three are blind
 * to the LINK between them: `exportCore` handing `job.timeOrigin` to the
 * analyzer as an OPTIONAL POSITIONAL parameter with a `= 0` default. Drop that
 * argument and every other test in this change stays green while every segment
 * export resolves the wrong LFO phase — which is precisely the failure mode
 * this design was chosen to avoid, so it gets its own walk.
 *
 * The renderer is faked (harness from exportCoreDeterminism.test.ts) so the
 * real core runs the real analyzer over real PCM and we read the params it
 * resolved per frame. Those must equal what the LIVE path resolves for the
 * same music at ABSOLUTE track time.
 */

type TraceEntry = Record<string, unknown>;

const cfg = vi.hoisted(() => ({ trace: [] as TraceEntry[] }));

/** Typed arrays -> plain arrays so recorded frames compare structurally. */
function norm(v: unknown): unknown {
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
    return Array.from(v as unknown as ArrayLike<number>);
  }
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = norm(val);
    return out;
  }
  return v;
}

vi.mock("../render/webgpuRenderer", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../render/webgpuRenderer")>();
  const rec = (call: string, fields: TraceEntry = {}) => cfg.trace.push({ call, ...fields });
  class FakeRenderer {
    onDeviceLost: ((reason: string) => void) | null = null;
    static create = async () => new FakeRenderer();
    setDeepCapture(on: boolean) {
      rec("setDeepCapture", { on });
    }
    setPreset(p: { id: string }) {
      rec("setPreset", { id: p.id });
    }
    setBackground(bg: unknown) {
      rec("setBackground", { bg: norm(bg) });
    }
    setOverlay(o: unknown) {
      rec("setOverlay", { overlay: (o as { tag?: string } | null)?.tag ?? null });
    }
    setSmoothSpectrum(on: boolean) {
      rec("setSmoothSpectrum", { on });
    }
    setPost(p: unknown) {
      rec("setPost", { post: norm(p) });
    }
    setMotion(m: unknown) {
      rec("setMotion", { motion: norm(m) });
    }
    setBuilderParams(d: Float32Array) {
      rec("setBuilderParams", { data: norm(d) });
    }
    setCoverArt() {
      rec("setCoverArt");
    }
    setBackgroundImage() {
      rec("setBackgroundImage");
    }
    updateBackgroundVideoFrame() {
      rec("updateBackgroundVideoFrame");
    }
    setTransitionPreset(p: { id: string } | null) {
      rec("setTransitionPreset", { id: p?.id ?? null });
    }
    resize(w: number, h: number, dpr: number) {
      rec("resize", { w, h, dpr });
    }
    render(features: unknown, t: number, params: unknown, transition: unknown, opts: unknown) {
      rec("render", {
        // `t` is the RENDERER's clock — the shader's u.time. Since option (f)
        // that is ABSOLUTE track time, so it is deliberately NOT the clip time
        // the rest of the walk runs on; `featureTime` below is that.
        t,
        params: norm(params),
        transition: norm(transition),
        opts: norm(opts),
        // Only the two scalars the LFO reads — the whole feature frame would
        // bury the assertion in 1200 spectrum numbers.
        bpm: (features as AudioFeatures).bpm,
        timeOrigin: (features as AudioFeatures).timeOrigin,
        featureTime: (features as AudioFeatures).time,
      });
    }
    async gpuDone() {}
    async readbackDeepFrame() {
      return new Uint16Array(0);
    }
    dispose() {}
  }
  return {
    ...mod,
    WebGPURenderer: FakeRenderer,
  };
});

// Loaded AFTER the mock so exportCore binds it.
import { runExportJob, type ExportJob } from "./exportCore";

/** The segment start the fixture exports from, in track seconds. */
const TIME_ORIGIN = 137;
const BPM = 120;
const FPS = 30;

/**
 * 8 beats per cycle is the load-bearing choice. At 120 BPM, 137 s is 274
 * beats: 274/8 = 34.25 cycles, so the preview sits at phase 0.25 while a clip
 * anchored on clip time alone opens at phase 0. At rates 0.25/0.5/1/2 the same
 * start divides evenly and BOTH resolve phase 0 — a test at those rates cannot
 * see the defect at all.
 */
const ROUTE: ModRoute = { id: "lfo", source: "lfo:sine:8", param: "hue", amount: 0.5 };
/** Parked at the param's min so the expected value cannot be a clamp. */
const BASE_PARAMS: ParamValues = { hue: 0 };

function makePcm(): PcmData {
  const n = 9600; // 0.2 s at 48 kHz -> 6 frames at 30 fps
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = Math.sin(i * 0.05) * 0.5;
  return { sampleRate: 48000, length: n, duration: n / 48000, channels: [ch] };
}

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    pcm: makePcm(),
    width: 96,
    height: 64,
    fps: FPS,
    bitrate: 1_000_000,
    presetId: "spectrum-bars",
    params: BASE_PARAMS,
    bg: { mode: 0, color: [0, 0, 0] },
    mods: [ROUTE],
    post: { ...DEFAULT_POST },
    motion: { ...DEFAULT_MOTION },
    smoothSpectrum: true,
    mode: "png",
    // Explicit: `features.bpm` is 0 without a grid, which silently switches
    // the LFO onto its 120-BPM-equivalent fallback clock. The test asserts the
    // recorded bpm below so this cannot rot into that fallback unnoticed.
    beatGrid: { bpm: BPM, beatTimes: new Float32Array([0, 0.5, 1]), hopSec: 0.01 },
    timeOrigin: TIME_ORIGIN,
    ...overrides,
  };
}

/** Hand-built LIVE feature frame: what the preview hands applyMods. */
function liveFeatures(time: number): AudioFeatures {
  return {
    bins: new Float32Array(96),
    peaks: new Float32Array(96),
    waveform: new Float32Array(512),
    waveformL: new Float32Array(512),
    waveformR: new Float32Array(512),
    rms: 0,
    energy: 0,
    voice: 0,
    drive: 0,
    driveBeat: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    width: 0,
    lufs: -70,
    kick: 0,
    snare: 0,
    hat: 0,
    bpm: BPM,
    beatPhase: 0,
    barPhase: 0,
    beat: false,
    beatIntensity: 0,
    // ABSOLUTE track time — the preview never rebases anything, and never
    // sets timeOrigin.
    time,
    duration: 300,
  };
}

/** What the live loop resolves for this route at absolute track time `t`. */
function liveParams(presetId: string, t: number): ParamValues {
  return applyMods(presetById(presetId), BASE_PARAMS, [ROUTE], liveFeatures(t));
}

const hooks = () => ({ onFrame: async () => {} });

async function walk(j: ExportJob = job()): Promise<TraceEntry[]> {
  cfg.trace = [];
  await runExportJob(j, hooks());
  return cfg.trace;
}

const renders = (t: TraceEntry[]) => t.filter((e) => e.call === "render");
const presented = (t: TraceEntry[]) =>
  renders(t).filter((e) => (e.opts as { feedback: string }).feedback !== "advance-only");
const advanceOnly = (t: TraceEntry[]) =>
  renders(t).filter((e) => (e.opts as { feedback: string }).feedback === "advance-only");

beforeEach(() => {
  cfg.trace = [];
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return null; // only the loop-crossfade blend canvas asks; unused here
      }
      async convertToBlob() {
        return new Blob([new Uint8Array([0x89, 0x50])]);
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("segment export: the LFO resolves the preview's phase (E2-R1)", () => {
  it("fixture sanity: the routed param is a plain 0..360 knob", () => {
    // So the assertions below cannot be about a snapped or disabled target.
    const spec = presetById("spectrum-bars").params.find((p) => p.key === "hue")!;
    expect(spec).toBeDefined();
    expect(spec.min).toBe(0);
    expect(spec.max).toBe(360);
    expect(spec.mod).toBeUndefined(); // not snapped, not disabled
  });

  it("the first presented frame carries the preview's value, not cycle start", async () => {
    const frames = presented(await walk());

    // Non-vacuity #1: frames were actually presented.
    expect(frames.length).toBe(6); // 0.2 s at 30 fps
    // Non-vacuity #2: the beat grid reached the analyzer, so this is the
    // tempo clock and not the bpm-0 fallback.
    expect(frames[0].bpm).toBe(BPM);
    // Non-vacuity #3: clip time really is clip time — frame 0 is t=0, and the
    // origin rides beside it rather than inside it.
    expect(frames[0].featureTime).toBe(0);
    expect(frames[0].timeOrigin).toBe(TIME_ORIGIN);

    // THE assertion: what the core resolved for the clip's first frame equals
    // what the live loop resolves at 137 s — EXACTLY, same object shape, same
    // doubles.
    expect(frames[0].params).toEqual(liveParams("spectrum-bars", TIME_ORIGIN));
    // And by value, so "both sides are equally wrong" cannot pass: phase 0.25
    // -> sine 0.5 -> amount 0.5 -> a quarter of the 0..360 range above the
    // base. (toBeCloseTo, not toBe: cos(pi/2) is 6.1e-17, not 0, so the
    // literal is 89.99999999999999 — identical on both paths, which is what
    // the assertion above pins.)
    expect((frames[0].params as { hue: number }).hue).toBeCloseTo(90, 10);
    // Non-vacuity #4: the modulated value differs from the unmodulated base,
    // so an applyMods that silently did nothing would fail here. (Dropping
    // job.timeOrigin from the OfflineAnalyzer call resolves phase 0 -> hue 0
    // -> exactly BASE_PARAMS.)
    expect(frames[0].params).not.toEqual(BASE_PARAMS);
  });

  it("every frame of the clip tracks the preview, not just the first", async () => {
    const frames = presented(await walk());
    for (const f of frames) {
      // Clip time comes off the FEATURE frame, which is what applyMods read —
      // the render argument is the shader clock and no longer the same number.
      const clip = f.featureTime as number;
      expect(f.params, `clip time ${clip}`).toEqual(
        liveParams("spectrum-bars", TIME_ORIGIN + clip),
      );
    }
    // The route genuinely moves across the clip — a frozen LFO would make the
    // loop above trivially true.
    expect(new Set(frames.map((f) => (f.params as { hue: number }).hue)).size).toBeGreaterThan(1);
  });

  it("a full-track export (no segment) is unchanged: origin 0, phase from clip time", async () => {
    const frames = presented(await walk(job({ timeOrigin: 0 })));
    expect(frames[0].timeOrigin).toBe(0);
    expect(frames[0].params).toEqual({ hue: 0 }); // phase 0 -> sine 0
    expect(frames[0].params).toEqual(liveParams("spectrum-bars", 0));
  });

  it("the 60 Hz feedback catch-up walk resolves the same phase as the pixels", async () => {
    // That walk builds its OWN analyzer and runs its own applyMods, so it
    // needs the same origin or the feedback history would be advanced with a
    // different LFO value than the frames it feeds.
    const trace = await walk(job({ presetId: "echo-trails" }));
    const ticks = advanceOnly(trace);
    expect(ticks.length).toBeGreaterThan(6); // 60 Hz over 0.2 s, above the 6 presented
    expect(ticks[0].timeOrigin).toBe(TIME_ORIGIN);
    for (const tick of ticks) {
      const clip = tick.featureTime as number;
      expect(tick.params, `tick clip time ${clip}`).toEqual(
        liveParams("echo-trails", TIME_ORIGIN + clip),
      );
    }
    // ...and the presented frames of the same job still agree.
    for (const f of presented(trace)) {
      const clip = f.featureTime as number;
      expect(f.params, `clip time ${clip}`).toEqual(liveParams("echo-trails", TIME_ORIGIN + clip));
    }
  });
});

/**
 * Option (f) — the SECOND divergence in the same family, one layer down.
 *
 * `renderer.render`'s time argument is uniform slot 0, `u.time`: most presets
 * read it, and the post chain's film grain seeds from `fract(u.time)`. The
 * live preview feeds it ABSOLUTE track time (services.ts `trackTime`) for the
 * presented frame and the texture-feedback advance alike, while this walk
 * counts frames from the clip's zero — so every time-driven shader in a
 * segment or Canvas-loop export drew a different moment than the preview.
 *
 * These pin the renderer's clock specifically. They are independent of the LFO
 * tests above: those read `features`, these read the render argument.
 */
describe("segment export: the shader clock is absolute track time (option f)", () => {
  it("F1 — the presented frame renders at absolute track time", async () => {
    const frames = presented(await walk());
    expect(frames.length).toBe(6);
    // Frame 0 is the whole bug in one number: 137, not 0.
    expect(frames[0].t).toBe(TIME_ORIGIN);
    // ...and the clip clock still runs underneath it, unshifted.
    expect(frames[0].featureTime).toBe(0);
    frames.forEach((f, n) => {
      expect(f.t, `frame ${n}`).toBeCloseTo(TIME_ORIGIN + n / FPS, 10);
      expect(f.featureTime, `frame ${n}`).toBeCloseTo(n / FPS, 10);
    });
    // Non-vacuity: the clock actually advanced across the clip, so a constant
    // 137 for every frame would not pass either.
    expect(new Set(frames.map((f) => f.t)).size).toBe(6);
  });

  it("F2 — the feedback advance walk and the presented frame share ONE clock", async () => {
    // The specific failure this fix must not introduce: offsetting one of the
    // two render call sites and not the other gives a feedback preset two
    // different clocks inside a single frame. F1 cannot see that — it never
    // looks at an advance-only render.
    const trace = renders(await walk(job({ presetId: "echo-trails" })));
    // Every advance-only render belongs to the frame whose presentation
    // follows it (the walk drains ticks, then presents).
    const groups: { ticks: TraceEntry[]; frame: TraceEntry }[] = [];
    let pending: TraceEntry[] = [];
    for (const e of trace) {
      if ((e.opts as { feedback: string }).feedback === "advance-only") pending.push(e);
      else {
        groups.push({ ticks: pending, frame: e });
        pending = [];
      }
    }
    // Non-vacuity: a feedback preset really did run both walks, and at least
    // one frame really did drain ticks — otherwise this loop asserts nothing.
    expect(groups.length).toBe(6);
    expect(groups.reduce((n, g) => n + g.ticks.length, 0)).toBeGreaterThan(6);
    expect(groups.filter((g) => g.ticks.length > 0).length).toBeGreaterThan(1);

    // The origin each render used = its shader clock minus the clip clock its
    // own features carry. Offsetting only one site makes these two disagree.
    const originOf = (e: TraceEntry) => (e.t as number) - (e.featureTime as number);
    for (const [i, g] of groups.entries()) {
      expect(originOf(g.frame), `frame ${i} presentation`).toBeCloseTo(TIME_ORIGIN, 9);
      for (const tick of g.ticks) {
        expect(originOf(tick), `frame ${i} feedback tick`).toBeCloseTo(originOf(g.frame), 9);
        expect(originOf(tick), `frame ${i} feedback tick`).toBeCloseTo(TIME_ORIGIN, 9);
        // The rigid translation also has to preserve ORDER: a tick still
        // precedes the frame it belongs to on the shader clock.
        expect(tick.t as number).toBeLessThanOrEqual((g.frame.t as number) + 1e-9);
      }
    }
    // The tick clock is still the fixed 60 Hz grid, just translated.
    const ticks = advanceOnly(trace);
    ticks.forEach((tick, k) => {
      expect(tick.featureTime, `tick ${k}`).toBeCloseTo(k / 60, 10);
      expect(tick.t, `tick ${k}`).toBeCloseTo(TIME_ORIGIN + k / 60, 9);
    });
  });

  it("F3 — a full-track export is untouched: the shader clock IS the clip clock", async () => {
    const trace = renders(await walk(job({ presetId: "echo-trails", timeOrigin: 0 })));
    expect(trace.length).toBeGreaterThan(6);
    for (const e of trace) {
      // Byte-for-byte what the pre-(f) code passed: any unconditional offset
      // breaks this, and so does an offset applied to the wrong job field.
      expect(e.t).toBe(e.featureTime);
    }
    presented(trace).forEach((f, n) => {
      expect(f.t, `frame ${n}`).toBeCloseTo(n / FPS, 10);
    });
    // Non-vacuity: times really did span a range, so `toBe` above is not
    // comparing 0 to 0 six times.
    expect(new Set(trace.map((e) => e.t)).size).toBeGreaterThan(6);
  });
});
