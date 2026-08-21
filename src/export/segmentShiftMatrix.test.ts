import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LYRIC_STYLE, type LyricLine } from "../state/lyrics";
import { DEFAULT_AUDIOGRAM } from "../state/audiogram";
import { DEFAULT_MOTION, DEFAULT_POST } from "../render/types";
import type { StemAnalysis, StemEntry } from "../audio/stems";
import type { ExportJob } from "./exportCore";

/**
 * E2 — the segment-shift MATRIX.
 *
 * A segment export (Canvas loop, "export this slice") slices the audio so the
 * rendered clip starts at t=0, which rebases the whole timeline. EVERY
 * time-bearing structure `exportVideo` hands the core must move with it. Miss
 * one and preview and file disagree for the entire clip — that is a
 * determinism-law break, not a cosmetic bug, and it has happened: F4a shipped
 * with lyric LINES rebased while their WORDS rode through in absolute track
 * time (see segmentLyricShift.test.ts for that one's arithmetic).
 *
 * `segmentLyricShift.test.ts` pins the lyric mapping. This file pins the
 * CHECKLIST — every field at once, three ways, so the next field to grow a
 * timestamp cannot slip through the same crack:
 *
 *  1. A KEY CENSUS. Every key `buildJob` emits must be classified TIME_BEARING
 *     or TIMELESS here. Adding a field to ExportJob without deciding which it
 *     is fails this test with the question spelled out.
 *  2. A SENTINEL-BAND SWEEP. Every track timestamp in the fixture lives in
 *     [BAND_LO, BAND_HI] and nothing else in the job does. After the shift, a
 *     deep walk of the ENTIRE job must find no number left in that band. This
 *     is the generic guard: it does not know what `words` is, so it catches a
 *     sub-field that rode through unshifted exactly as it catches a whole
 *     missing field. A control run WITHOUT a segment proves the sweep can see
 *     the sentinels at all.
 *  3. PER-FIELD VALUE ASSERTIONS. The band sweep alone would accept a "shift"
 *     that zeroed a structure, so each one is also checked by value.
 *
 * The core is stubbed and `Worker` removed, so `exportVideo` takes its inline
 * path and hands us the job it built — the real `buildJob`, never a restatement
 * of it.
 */

const captured = vi.hoisted(() => ({ job: null as unknown as ExportJob }));

vi.mock("./exportCore", () => ({
  runExportJob: vi.fn(async (job: ExportJob) => {
    captured.job = job;
    return { bytes: 1, seconds: 1, audioCodec: "aac" as const };
  }),
}));

// Imported after the mock so videoExporter binds the stub.
import { exportVideo, type ExportOptions } from "./videoExporter";

const SEG_START = 137;
const SEG_DURATION = 40;

/**
 * Every TRACK timestamp in the fixture sits inside this band, and no other
 * number in the job does — checked by the control run below, which asserts the
 * sweep finds the sentinels when nothing has been shifted. Shifted values land
 * in [0, 60], comfortably below BAND_LO, so a correctly-shifted job is empty of
 * band members and cannot be confused with an unshifted one.
 */
const BAND_LO = 137;
const BAND_HI = 197;

/**
 * The legitimately-absolute numbers in a segment job:
 *  - bgVideo.timeOffset — the video background loops on ABSOLUTE track time in
 *    the live view, so the core is told where the clip starts rather than
 *    having the loop rebased;
 *  - timeOrigin — the clip's own t=0 in track time, which the core stamps onto
 *    every analyzed frame so absolute-time sources (the tempo-locked LFOs) can
 *    recover the phase the preview shows (E2-R1).
 */
const ABSOLUTE_BY_DESIGN = ["bgVideo.timeOffset", "timeOrigin"];

/**
 * Keys whose value carries at least one track timestamp.
 *
 * A key can be in BOTH this list and ABSOLUTE_BY_DESIGN, and `timeOrigin` is:
 * the two lists answer different questions. TIME_BEARING says "this field
 * holds a track timestamp, so a reviewer must decide what a rebase does to
 * it"; ABSOLUTE_BY_DESIGN says "and the answer for this one is: nothing —
 * leave it absolute". Without the first membership the census would let the
 * field ride through unclassified; without the second the sentinel sweep would
 * flag its (correct) absolute value as an unshifted leftover.
 */
const TIME_BEARING = [
  "pcm",
  "beatGrid",
  "sections",
  "vocalSpans",
  "timeline",
  "lyrics",
  "stems",
  "audiogram",
  "bgVideo",
  "timeOrigin",
] as const;

/**
 * Keys that carry no track timestamp. Durations (`loopCrossfadeSec`, a scene's
 * `fadeSec`, a route's attack/release) are spans, not instants: they are
 * invariant under a rebase and must NOT be shifted.
 */
const TIMELESS = [
  "width",
  "height",
  "fps",
  "bitrate",
  "codec",
  "deepColor",
  "deepStraightAlpha",
  "presetId",
  "params",
  "bg",
  "sync",
  "overlay",
  "mods",
  "smoothSpectrum",
  "post",
  "motion",
  "coverArt",
  "bgImage",
  "customPresets",
  "builderStack",
  "paramsByPreset",
  "modsByPreset",
  "loopCrossfadeSec",
  "mode",
  "loudness",
  "powerPreference",
] as const;

// --- fixture ---------------------------------------------------------------

const TRACK_SECONDS = 300;
const SAMPLE_RATE = 100; // small on purpose: the walk below visits every sample

function fakeAudioBuffer(): AudioBuffer {
  const length = TRACK_SECONDS * SAMPLE_RATE;
  const channel = new Float32Array(length); // all zeros: no accidental band members
  return {
    sampleRate: SAMPLE_RATE,
    length,
    duration: TRACK_SECONDS,
    numberOfChannels: 2,
    getChannelData: () => channel.slice(),
  } as unknown as AudioBuffer;
}

const STEM_RATE = 2;
const STEM_FRAMES = 600;

function stemAnalysis(): StemAnalysis {
  const track = () => {
    const a = new Float32Array(STEM_FRAMES);
    for (let i = 0; i < STEM_FRAMES; i++) a[i] = i / STEM_FRAMES; // 0..1, never in band
    return a;
  };
  return {
    name: "drums",
    rate: STEM_RATE,
    frames: STEM_FRAMES,
    tracks: {
      energy: track(),
      bass: track(),
      mid: track(),
      treble: track(),
      kick: track(),
      snare: track(),
      hat: track(),
    },
  };
}

const LYRIC_LINES: LyricLine[] = [
  {
    t: 140,
    end: 145,
    text: "words carry their own clock",
    words: [
      { t: 140, end: 142, text: "words carry" },
      { t: 142, end: 145, text: "their own clock" },
    ],
  },
  {
    t: 150,
    end: null,
    text: "held to the end",
    words: [{ t: 150, end: null, text: "held" }],
  },
];

function waveformOverview(): Float32Array {
  const wf = new Float32Array(1000);
  for (let i = 0; i < wf.length; i++) wf[i] = (i % 100) / 100; // 0..0.99
  return wf;
}

function options(overrides: Partial<ExportOptions> = {}): ExportOptions {
  const stems: StemEntry[] = [{ slot: "stem1", analysis: stemAnalysis() }];
  return {
    width: 256,
    height: 128,
    fps: 25,
    bitrate: 1_000_000,
    codec: "h264",
    presetId: "spectrum-bars",
    params: { bars: 64 },
    bg: { mode: 0, color: [0, 0, 0] },
    mods: [{ id: "r1", source: "rms", param: "bars", amount: 0.5, attack: 0.4, release: 0.9 }],
    smoothSpectrum: true,
    post: { ...DEFAULT_POST },
    motion: { ...DEFAULT_MOTION },
    bgVideo: { dataUrl: "data:video/mp4;base64,AA", dim: 0.3, blur: 4 },
    stems,
    lyrics: { lines: LYRIC_LINES, style: { ...DEFAULT_LYRIC_STYLE } },
    audiogram: {
      settings: { ...DEFAULT_AUDIOGRAM, progressBar: true, waveformStrip: true },
      waveform: waveformOverview(),
    },
    customPresets: [],
    builderStack: { layers: [] },
    paramsByPreset: { "spectrum-bars": { bars: 64 } },
    modsByPreset: { "spectrum-bars": [] },
    timeline: {
      enabled: true,
      scenes: [
        { id: "s1", name: "A", presetId: "aurora", start: 145, fadeSec: 2 },
        { id: "s2", name: "B", presetId: "nebula", start: 170 },
      ],
      lanes: [
        {
          param: "bars",
          keyframes: [
            { id: "k1", t: 150, value: 0.2, curve: "linear" },
            { id: "k2", t: 180, value: 0.8, curve: "smooth" },
          ],
        },
      ],
    },
    loopCrossfadeSec: 2,
    beatGrid: { bpm: 120, beatTimes: new Float32Array([138, 138.5, 139, 190]), hopSec: 0.0116 },
    sections: [137, 160, 195],
    vocalSpans: [
      { start: 141, end: 143 },
      { start: 175, end: 178 },
    ],
    loudness: { targetLufs: -14, truePeakDb: -1 },
    ...overrides,
  };
}

// --- the deep sweep --------------------------------------------------------

/** Every number in the job, with the dotted path it was found at. */
function walkNumbers(root: unknown): { path: string; value: number }[] {
  const out: { path: string; value: number }[] = [];
  const seen = new WeakSet<object>();
  const visit = (v: unknown, path: string): void => {
    if (typeof v === "number") {
      out.push({ path, value: v });
      return;
    }
    if (v === null || typeof v !== "object") return;
    if (seen.has(v)) return;
    seen.add(v);
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      const arr = v as unknown as ArrayLike<number>;
      for (let i = 0; i < arr.length; i++) out.push({ path: `${path}[${i}]`, value: arr[i] });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => visit(item, `${path}[${i}]`));
      return;
    }
    for (const [k, val] of Object.entries(v)) visit(val, path ? `${path}.${k}` : k);
  };
  visit(root, "");
  return out;
}

const inBand = (n: { path: string; value: number }) =>
  n.value >= BAND_LO &&
  n.value <= BAND_HI &&
  !ABSOLUTE_BY_DESIGN.some((p) => n.path === p || n.path.startsWith(`${p}[`));

async function buildJob(o: Partial<ExportOptions> = {}): Promise<ExportJob> {
  captured.job = null as unknown as ExportJob;
  await exportVideo(fakeAudioBuffer(), options(o));
  expect(captured.job, "the stubbed core never received a job").toBeTruthy();
  return captured.job;
}

const segment = { start: SEG_START, duration: SEG_DURATION };

let realWorker: unknown;

beforeEach(() => {
  realWorker = (globalThis as { Worker?: unknown }).Worker;
  // No Worker => exportVideo takes runInline, which calls the stubbed core here
  // on this thread with the job object itself (a worker would clone it).
  delete (globalThis as { Worker?: unknown }).Worker;
});

afterEach(() => {
  if (realWorker !== undefined) (globalThis as { Worker?: unknown }).Worker = realWorker;
  vi.clearAllMocks();
});

describe("segment-shift checklist: the key census", () => {
  it("every field the core receives is classified time-bearing or timeless", async () => {
    const job = await buildJob({ segment });
    const declared = [...TIME_BEARING, ...TIMELESS] as string[];
    const actual = Object.keys(job);

    const unclassified = actual.filter((k) => !declared.includes(k));
    expect(
      unclassified,
      "new ExportJob field(s) reached the core unclassified. Decide whether each " +
        "carries a TRACK TIMESTAMP (then shift it in videoExporter.buildJob and add " +
        "it to TIME_BEARING) or does not (add it to TIMELESS)",
    ).toEqual([]);

    const vanished = declared.filter((k) => !actual.includes(k));
    expect(vanished, "classified field(s) no longer emitted by buildJob").toEqual([]);

    // Non-vacuity: an empty census would satisfy both assertions above.
    expect(actual.length).toBeGreaterThan(30);
  });
});

describe("segment-shift checklist: the sentinel-band sweep", () => {
  it("an UNSHIFTED job is full of band members — the sweep can see them", async () => {
    // The control. Without this, "no band members after the shift" could just
    // mean the walker never reached the timestamps in the first place.
    const job = await buildJob();
    const hits = walkNumbers(job).filter(inBand);
    const paths = new Set(hits.map((h) => h.path.replace(/\[\d+\]/g, "[]")));

    expect(hits.length).toBeGreaterThanOrEqual(20);
    // ...and spread across every time-bearing structure, not piled into one.
    expect([...paths].sort()).toEqual([
      "beatGrid.beatTimes[]",
      "lyrics.lines[].end",
      "lyrics.lines[].t",
      "lyrics.lines[].words[].end",
      "lyrics.lines[].words[].t",
      "sections[]",
      "timeline.lanes[].keyframes[].t",
      "timeline.scenes[].start",
      "vocalSpans[].end",
      "vocalSpans[].start",
    ]);
  });

  it("a SEGMENT job has none left anywhere in it", async () => {
    const job = await buildJob({ segment });
    const leftovers = walkNumbers(job).filter(inBand);
    expect(
      leftovers.map((l) => `${l.path} = ${l.value}`),
      "these still hold ABSOLUTE track time in a segment export",
    ).toEqual([]);
    // Non-vacuity: the walk must have visited a real job, not an empty object.
    expect(walkNumbers(job).length).toBeGreaterThan(1000);
  });

  it("keeps the video-background loop anchored to absolute track time", async () => {
    // The absolutes the sweep whitelists are pinned BY VALUE so the whitelist
    // can never quietly become a hiding place for an unshifted field.
    expect((await buildJob({ segment })).bgVideo?.timeOffset).toBe(SEG_START);
    expect((await buildJob()).bgVideo?.timeOffset).toBe(0);
  });

  it("carries the clip's own t=0 as UNSHIFTED track time (E2-R1)", async () => {
    // The other whitelisted absolute. `timeOrigin` is what the core stamps
    // onto every analyzed frame so the tempo-locked LFOs resolve the phase the
    // preview shows; shifting it (or defaulting it to 0 under a segment) puts
    // the export's first frame at cycle start while the preview sits
    // mid-cycle. Pinned by value: subtracting the segment start here would
    // give 0 and satisfy the band sweep perfectly.
    expect((await buildJob({ segment })).timeOrigin).toBe(SEG_START);
    expect((await buildJob()).timeOrigin).toBe(0);
  });
});

describe("segment-shift checklist: field by field", () => {
  it("slices the PCM to the segment and leaves the whole track alone otherwise", async () => {
    const seg = await buildJob({ segment });
    expect(seg.pcm.length).toBe(SEG_DURATION * SAMPLE_RATE);
    expect(seg.pcm.duration).toBeCloseTo(SEG_DURATION, 10);
    expect(seg.pcm.channels).toHaveLength(2);

    const full = await buildJob();
    expect(full.pcm.length).toBe(TRACK_SECONDS * SAMPLE_RATE);
  });

  it("shifts the beat grid's beats and leaves bpm / hop alone", async () => {
    const job = await buildJob({ segment });
    expect([...job.beatGrid!.beatTimes]).toEqual([1, 1.5, 2, 53]);
    expect(job.beatGrid!.bpm).toBe(120);
    expect(job.beatGrid!.hopSec).toBeCloseTo(0.0116, 10);
  });

  it("shifts the section boundaries", async () => {
    expect((await buildJob({ segment })).sections).toEqual([0, 23, 58]);
  });

  it("shifts both ends of every vocal span", async () => {
    expect((await buildJob({ segment })).vocalSpans).toEqual([
      { start: 4, end: 6 },
      { start: 38, end: 41 },
    ]);
  });

  it("shifts scene starts and automation keyframes, but not fade DURATIONS", async () => {
    const tl = (await buildJob({ segment })).timeline!;
    expect(tl.scenes.map((s) => s.start)).toEqual([8, 33]);
    expect(tl.scenes[0].fadeSec).toBe(2); // a span, invariant under a rebase
    expect(tl.scenes.map((s) => s.presetId)).toEqual(["aurora", "nebula"]);
    expect(tl.lanes[0].keyframes.map((k) => [k.t, k.value])).toEqual([
      [13, 0.2],
      [43, 0.8],
    ]);
    expect(tl.enabled).toBe(true);
  });

  it("shifts lyric lines AND the words inside them (F4a)", async () => {
    const lines = (await buildJob({ segment })).lyrics!.lines;
    expect(lines.map((l) => [l.t, l.end])).toEqual([
      [3, 8],
      [13, null],
    ]);
    expect(lines[0].words!.map((w) => [w.t, w.end])).toEqual([
      [3, 5],
      [5, 8],
    ]);
    expect(lines[1].words!.map((w) => [w.t, w.end])).toEqual([[13, null]]);
    // The text rides through untouched — a "shift" that rebuilt the lines from
    // scratch would lose it.
    expect(lines.map((l) => l.text)).toEqual(LYRIC_LINES.map((l) => l.text));
  });

  it("resamples every stem envelope onto the clip's t=0", async () => {
    const shifted = (await buildJob({ segment })).stems![0].analysis;
    const source = stemAnalysis();
    const off = SEG_START * STEM_RATE; // 274 frames in
    expect(shifted.frames).toBe(STEM_FRAMES);
    expect(shifted.rate).toBe(STEM_RATE);
    for (const n of [0, 1, 100, STEM_FRAMES - off - 1]) {
      expect(shifted.tracks.kick[n], `stem frame ${n}`).toBeCloseTo(source.tracks.kick[n + off], 6);
    }
    // Past the end of the source reads 0 rather than wrapping or holding.
    expect(shifted.tracks.kick[STEM_FRAMES - 1]).toBe(0);
    // Non-vacuity: an unshifted analysis would be the source verbatim.
    expect(shifted.tracks.kick[0]).not.toBeCloseTo(source.tracks.kick[0], 6);
  });

  it("slices the audiogram's whole-track waveform down to the clip", async () => {
    const src = waveformOverview();
    const job = await buildJob({ segment });
    const wf = job.audiogram!.waveform!;
    const i0 = Math.floor((SEG_START / TRACK_SECONDS) * src.length);
    const i1 = Math.ceil(((SEG_START + SEG_DURATION) / TRACK_SECONDS) * src.length);
    expect(wf.length).toBe(i1 - i0);
    expect(wf[0]).toBeCloseTo(src[i0], 6);
    // ...and the un-segmented export keeps the whole overview.
    expect((await buildJob()).audiogram!.waveform!.length).toBe(src.length);
  });

  it("leaves the timeless fields byte-identical to the un-segmented job", async () => {
    const seg = await buildJob({ segment });
    const full = await buildJob();
    for (const key of TIMELESS) {
      expect(seg[key], `timeless field "${key}" changed under a segment`).toEqual(full[key]);
    }
    // Non-vacuity: the two jobs really are different jobs.
    expect(seg.pcm.length).not.toBe(full.pcm.length);
  });
});
