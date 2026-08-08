import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PcmData } from "../audio/types";
import type { ModRoute } from "../state/modMatrix";
import { DEFAULT_MOTION, DEFAULT_POST } from "../render/types";
import { DEFAULT_LYRIC_STYLE, type LyricLine } from "../state/lyrics";
import { DEFAULT_AUDIOGRAM } from "../state/audiogram";

/**
 * F4 — the exportCore determinism test.
 *
 * The determinism law says preview and export must resolve identical frames
 * from the same document. The GPU pixel matrix guards the shader half on a
 * device; nothing guarded the WALK — the sequence of resolved frames the core
 * hands the renderer. This file records that sequence through a fake renderer
 * and asserts two independent walks over the same job are identical.
 *
 * It is built to fail on the three ways that guarantee gets lost:
 *  - wall clock: the two runs are executed under different system times and a
 *    monotonic performance clock, and the timing globals are asserted untouched;
 *  - unseeded randomness: Math.random is stubbed to a varying sequence and
 *    asserted never called;
 *  - per-run state: the walk carries lag memory (attack/release routes), so a
 *    ModEvalState promoted out of runExportJob would leak run 1's smoothed
 *    values into run 2's opening frames. `createModEvalState` is counted and
 *    identity-checked per run, and the 60 Hz feedback catch-up walk is proven
 *    to use its OWN state rather than the presented walk's.
 */

type TraceEntry = Record<string, unknown>;

const cfg = vi.hoisted(() => ({
  trace: [] as TraceEntry[],
  /** Force the AX-2 feedback gate off without changing the preset. */
  feedbackEnabled: true,
  /** Every ModEvalState the core created, in creation order. */
  created: [] as object[],
  /** `created` index the current run started at, so a trace's state tags are
   * RUN-RELATIVE and two runs stay comparable. */
  runBase: 0,
}));

/** Typed arrays -> plain arrays so two traces deep-compare structurally. */
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
        t,
        params: norm(params),
        transition: norm(transition),
        opts: norm(opts),
        features: norm(features),
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
    presetUsesFeedback: (p: Parameters<typeof mod.presetUsesFeedback>[0]) =>
      cfg.feedbackEnabled && mod.presetUsesFeedback(p),
  };
});

// Real math, wrapped: the two designed anti-leak points (a fresh state per
// run, a separate state for the feedback catch-up walk) are what this records.
vi.mock("../state/modMatrix", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../state/modMatrix")>();
  return {
    ...mod,
    createModEvalState: () => {
      const s = mod.createModEvalState();
      cfg.created.push(s);
      return s;
    },
    applyMods: (...args: Parameters<typeof mod.applyMods>) => {
      cfg.trace.push({
        call: "applyMods",
        stateIndex: cfg.created.indexOf(args[5] as object) - cfg.runBase,
      });
      return mod.applyMods(...args);
    },
  };
});

// Loaded AFTER the mocks so exportCore binds them.
import { runExportJob, type ExportJob } from "./exportCore";

function makePcm(): PcmData {
  // 0.4 s with a swelling envelope, so lag'd routes are genuinely mid-glide
  // at every frame rather than parked at a constant.
  const n = 19200;
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = Math.sin(i * 0.05) * (0.05 + 0.9 * (i / n));
  return { sampleRate: 48000, length: n, duration: n / 48000, channels: [ch] };
}

/** Attack/release routes: these are what make the walk stateful at all. */
const MODS: ModRoute[] = [
  {
    id: "r1",
    source: "rms",
    param: "decay",
    amount: 0.7,
    curve: "smooth",
    attack: 0.4,
    release: 0.9,
  },
  { id: "r2", source: "bass", param: "post:bloom", amount: 0.6, attack: 0.25, release: 0.6 },
];

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    pcm: makePcm(),
    // Deliberately NOT square: a width/height swap at any call site must show.
    width: 96,
    height: 64,
    fps: 30,
    bitrate: 1_000_000,
    // A feedback preset: the 60 Hz catch-up walk runs alongside the presented
    // frames, which is the second stateful walk this file pins.
    presetId: "echo-trails",
    params: {},
    bg: { mode: 0, color: [0, 0, 0] },
    mods: MODS,
    post: { ...DEFAULT_POST },
    motion: { ...DEFAULT_MOTION },
    smoothSpectrum: true,
    mode: "png",
    ...overrides,
  };
}

const hooks = () => ({ onFrame: async () => {} });

/** One full walk; returns its trace and leaves cfg.created accumulating. */
async function walk(j: ExportJob = job()): Promise<TraceEntry[]> {
  cfg.trace = [];
  cfg.runBase = cfg.created.length;
  await runExportJob(j, hooks());
  return cfg.trace;
}

const renders = (t: TraceEntry[]) => t.filter((e) => e.call === "render");
const presented = (t: TraceEntry[]) =>
  renders(t).filter((e) => (e.opts as { feedback: string }).feedback !== "advance-only");

beforeEach(() => {
  cfg.trace = [];
  cfg.created = [];
  cfg.feedbackEnabled = true;
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

describe("runExportJob walk determinism (F4)", () => {
  it("two walks over the same job resolve byte-identical frames", async () => {
    const a = await walk();
    const b = await walk();

    // Non-vacuity: the walk must have done stateful, varying work, or two
    // identical traces would prove nothing about determinism.
    expect(a.length).toBeGreaterThan(100);
    expect(presented(a).length).toBe(12); // 0.4 s at 30 fps
    expect(renders(a).length).toBeGreaterThan(presented(a).length); // feedback ticks ran
    const decays = new Set(presented(a).map((e) => (e.params as { decay: number }).decay));
    expect(decays.size).toBeGreaterThan(5); // the lag'd route is mid-glide
    const blooms = new Set(
      a.filter((e) => e.call === "setPost").map((e) => (e.post as { bloom: number }).bloom),
    );
    expect(blooms.size).toBeGreaterThan(5);

    expect(b).toEqual(a);
  });

  it("resolves the same frames under a different wall clock and no randomness", async () => {
    let tick = 0;
    const random = vi.spyOn(Math, "random").mockImplementation(() => ((tick += 1) % 13) / 13);
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => 1_600_000_000_000 + (tick += 7));
    const perfNow = vi.spyOn(performance, "now").mockImplementation(() => (tick += 3));

    const a = await walk();
    const b = await walk();

    expect(b).toEqual(a);
    expect(random).not.toHaveBeenCalled();
    expect(dateNow).not.toHaveBeenCalled();
    expect(perfNow).not.toHaveBeenCalled();
  });

  it("gives every run FRESH lag memory — nothing survives into the next export", async () => {
    await walk();
    const afterFirst = cfg.created.length;
    await walk();

    // Two per run: the presented walk's state and the feedback walk's.
    expect(afterFirst).toBe(2);
    expect(cfg.created.length).toBe(4);
    expect(new Set(cfg.created).size).toBe(4); // four distinct objects
  });

  it("gives the 60 Hz feedback catch-up walk its OWN lag memory", async () => {
    // Sharing one state would make presented-frame smoothing depend on whether
    // a feedback preset happens to be in the job. Every applyMods call is
    // tagged with which state it used; the tick calls must never use the
    // presented walk's, and vice versa.
    const t = await walk();
    let lastState = -1;
    let presentedCalls = 0;
    let tickCalls = 0;
    for (const e of t) {
      if (e.call === "applyMods") lastState = e.stateIndex as number;
      if (e.call !== "render") continue;
      const advanceOnly = (e.opts as { feedback: string }).feedback === "advance-only";
      expect(lastState, "a render ran with no applyMods before it").toBeGreaterThanOrEqual(0);
      expect(
        lastState,
        advanceOnly
          ? "feedback tick used the presented state"
          : "presented frame used the feedback state",
      ).toBe(advanceOnly ? 1 : 0);
      if (advanceOnly) tickCalls++;
      else presentedCalls++;
    }
    expect(presentedCalls).toBe(12);
    expect(tickCalls).toBeGreaterThan(12); // 60 Hz over 0.4 s, minus none
  });

  it("the feedback walk cannot perturb the presented frames (AX-2 gate is output-identical)", async () => {
    // Same job, once with the feedback catch-up walk armed and once with the
    // gate forced off. The gate's claim is that skipping it is
    // output-identical; if the two walks ever shared mod state, the presented
    // frames would drift apart here.
    cfg.feedbackEnabled = true;
    const withWalk = presented(await walk());
    cfg.feedbackEnabled = false;
    const without = presented(await walk());

    expect(without.length).toBe(withWalk.length);
    expect(without).toEqual(withWalk);
  });

  it("a timeline scene switch resolves identically on a second walk", async () => {
    const j = job({
      timeline: {
        enabled: true,
        scenes: [
          { id: "s1", name: "S1", presetId: "spectrum-bars", start: 0.15 },
          { id: "s2", name: "S2", presetId: "echo-trails", start: 0.3 },
        ],
        lanes: [],
      },
      paramsByPreset: { "spectrum-bars": {} },
      modsByPreset: { "spectrum-bars": MODS },
    });
    const a = await walk(j);
    const b = await walk(j);

    const switched = new Set(a.filter((e) => e.call === "setPreset").map((e) => e.id));
    expect(switched.size).toBeGreaterThan(1); // the scenes really did switch
    expect(b).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// The EXPORT half of the overlay-compose contract. The live half lives in
// src/state/liveOverlayCompose.test.ts and asserts the identical tuple.
// ---------------------------------------------------------------------------

vi.mock("../render/dynamicOverlay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../render/dynamicOverlay")>();
  return {
    ...actual,
    composeOverlayFrame: vi.fn(async (_b, _d, t: number) => ({
      tag: `composed@${t}`,
      close: () => {},
    })),
  };
});

const LINES: LyricLine[] = [
  { t: 0.05, end: 0.25, text: "hold the line" },
  { t: 0.3, end: 0.39, text: "second line here" },
];
// Hard cuts + a whole-second clock: over a sub-second clip most frames share a
// key, so the cache has something to skip and the gating below is observable.
const STYLE = { ...DEFAULT_LYRIC_STYLE, anim: "plain" as const, fadeSec: 0 };
const AUDIOGRAM = { ...DEFAULT_AUDIOGRAM, timeReadout: true };
const WAVEFORM = new Float32Array([0.1, 0.4, 0.9, 0.3]);

function overlayJob(): ExportJob {
  const base = { tag: "static-base", close: () => {} } as unknown as ImageBitmap;
  return job({
    overlay: base,
    lyrics: { lines: LINES, style: STYLE },
    audiogram: { settings: AUDIOGRAM, waveform: WAVEFORM },
  });
}

describe("runExportJob overlay compose call (F4)", () => {
  it("composes from TRACK TIME, the output size and the shared dynamics shape", async () => {
    const { composeOverlayFrame } = await import("../render/dynamicOverlay");
    vi.mocked(composeOverlayFrame).mockClear();

    const j = overlayJob();
    await walk(j);

    const calls = vi.mocked(composeOverlayFrame).mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    // Same tuple the live loop passes (see liveOverlayCompose.test.ts): the
    // retained static base, the dynamics bundle, TRACK TIME, output w/h.
    expect(calls[0]).toEqual([
      j.overlay,
      {
        lyrics: { lines: LINES, style: STYLE },
        // duration is the track's, exactly as the live path reads it off the
        // engine — here the (segment-sliced) pcm the job carries.
        audiogram: { settings: AUDIOGRAM, duration: j.pcm.duration, waveform: WAVEFORM },
      },
      0,
      j.width,
      j.height,
    ]);
    // Every compose time is a frame index over fps — no wall clock can enter.
    for (const call of calls) {
      const t = call[2] as number;
      expect(Number.isInteger(t * j.fps)).toBe(true);
      expect(t).toBeLessThan(j.pcm.duration);
    }
  });

  it("re-composes only when the shared frame key moves, and identically on a re-run", async () => {
    const { composeOverlayFrame, overlayFrameKeyAt, sameOverlayFrame } =
      await import("../render/dynamicOverlay");
    const j = overlayJob();

    vi.mocked(composeOverlayFrame).mockClear();
    const a = await walk(j);
    const timesA = vi.mocked(composeOverlayFrame).mock.calls.map((c) => c[2]);

    vi.mocked(composeOverlayFrame).mockClear();
    const b = await walk(j);
    const timesB = vi.mocked(composeOverlayFrame).mock.calls.map((c) => c[2]);

    expect(timesB).toEqual(timesA);
    expect(b).toEqual(a);

    // The skipped frames are exactly the ones whose key did not move — proving
    // the gate is the shared key function, not an internal shortcut.
    const dyn = {
      lyrics: { lines: LINES, style: STYLE },
      audiogram: { settings: AUDIOGRAM, duration: j.pcm.duration, waveform: WAVEFORM },
    };
    const frames = Math.round(j.pcm.duration * j.fps);
    let prev = overlayFrameKeyAt(dyn, timesA[0] as number, j.width);
    const expected = [timesA[0]];
    for (let n = 0; n < frames; n++) {
      const t = n / j.fps;
      if (t <= (timesA[0] as number)) continue;
      const key = overlayFrameKeyAt(dyn, t, j.width);
      if (!sameOverlayFrame(key, prev)) {
        expected.push(t);
        prev = key;
      }
    }
    expect(timesA).toEqual(expected);
    expect(timesA.length).toBeLessThan(frames); // the cache really did skip work
  });
});
