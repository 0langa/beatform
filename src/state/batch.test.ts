import { describe, expect, it } from "vitest";
import {
  batchInertSources,
  classifyError,
  describeFailure,
  expandJobs,
  isRunComplete,
  retryFailed,
  runStats,
  safeName,
  type BatchRun,
  type BatchTrack,
} from "./batch";
import type { FormatPreset } from "../export/buildExportOptions";
import type { ProjectDocument } from "./project";

const F16: FormatPreset = {
  id: "16:9",
  label: "16:9",
  w: 1920,
  h: 1080,
  fps: 30,
  mbps: 12,
  format: "mp4",
};
const F9: FormatPreset = {
  id: "9:16",
  label: "9:16",
  w: 1080,
  h: 1920,
  fps: 30,
  mbps: 12,
  format: "mp4",
};

function track(id: string, title: string, duration: number | null = 60): BatchTrack {
  return {
    id,
    file: new File([], `${title}.mp3`),
    meta: { title, artist: "A" },
    metaFromTags: true,
    coverArt: null,
    duration,
  };
}

describe("expandJobs", () => {
  it("makes one job per track per format", () => {
    const jobs = expandJobs([track("t1", "One"), track("t2", "Two")], [F16, F9], "/out");
    expect(jobs).toHaveLength(4);
  });

  it("names by title alone for a single format", () => {
    const jobs = expandJobs([track("t1", "Midnight")], [F16], "/out");
    expect(jobs[0].outPath).toBe("/out/Midnight.mp4");
  });

  it("qualifies by resolution for multiple formats — else they collide on one path", () => {
    const jobs = expandJobs([track("t1", "Midnight")], [F16, F9], "/out");
    expect(jobs.map((j) => j.outPath)).toEqual([
      "/out/Midnight_1920x1080.mp4",
      "/out/Midnight_1080x1920.mp4",
    ]);
  });

  it("never lets two tracks with the same title write to one path", () => {
    // A remix and its original really can share a title. Overwriting a
    // finished render is the one thing an overnight batch must never do.
    const jobs = expandJobs([track("t1", "Drift"), track("t2", "Drift")], [F16], "/out");
    expect(jobs[0].outPath).toBe("/out/Drift.mp4");
    expect(jobs[1].outPath).toBe("/out/Drift (2).mp4");
  });

  it("avoids names already on disk", () => {
    const jobs = expandJobs([track("t1", "Drift")], [F16], "/out", new Set(["drift.mp4"]));
    expect(jobs[0].outPath).toBe("/out/Drift (2).mp4");
  });

  it("names vp9a formats .webm (VP9+alpha muxes into WebM, not MP4)", () => {
    const jobs = expandJobs([track("t1", "Overlay")], [{ ...F16, codec: "vp9a" }], "/out");
    expect(jobs[0].outPath).toBe("/out/Overlay.webm");
  });

  it("strips only what the filesystem forbids", () => {
    const jobs = expandJobs([track("t1", 'A/B:C*?"<>|D')], [F16], "/out");
    expect(jobs[0].outPath).toBe("/out/ABCD.mp4");
  });

  it("keeps non-ASCII titles instead of collapsing them together", () => {
    // The old rule was [^\w\- ], and \w is ASCII-only — so every CJK/Cyrillic
    // title sanitised to empty and a whole batch piled up as
    // "visualization.mp4", "visualization (2).mp4", losing the mapping back to
    // the tracks. The filesystem has no such objection.
    const jobs = expandJobs(
      [track("t1", "夜明け"), track("t2", "Полночь"), track("t3", "Café Déjà-vu")],
      [F16],
      "/out",
    );
    expect(jobs.map((j) => j.outPath)).toEqual([
      "/out/夜明け.mp4",
      "/out/Полночь.mp4",
      "/out/Café Déjà-vu.mp4",
    ]);
  });

  it("falls back to a usable name when a title sanitises to nothing", () => {
    expect(safeName("???")).toBe("visualization");
    expect(safeName("")).toBe("visualization");
  });

  it("defuses Windows reserved device names, case-insensitively", () => {
    // "CON", "con.txt" and "Con.mp4.bak" are ALL refused by Windows — it
    // matches the segment before the first dot, not the whole filename. A
    // stock ID3 title of exactly "CON" would otherwise render an unwritable
    // batch job that fails at write time with no useful error.
    expect(safeName("CON")).not.toBe("CON");
    expect(safeName("con")).not.toMatch(/^con$/i);
    expect(safeName("Con")).not.toMatch(/^con$/i);
    expect(safeName("COM1")).not.toMatch(/^com1$/i);
    expect(safeName("lpt9")).not.toMatch(/^lpt9$/i);
    expect(safeName("NUL")).not.toMatch(/^nul$/i);
  });

  it("only defuses an EXACT reserved-name segment, not a superstring", () => {
    // Real titles/artists that merely start with a reserved-looking prefix
    // must pass through untouched — "COM" with no digit isn't reserved, and
    // "Confessions" isn't "CON".
    expect(safeName("Confessions")).toBe("Confessions");
    expect(safeName("Com Truise")).toBe("Com Truise");
    expect(safeName("Nullptr")).toBe("Nullptr");
  });

  it("keeps a reserved-name stem unwritable-proof once the caller appends an extension", () => {
    const jobs = expandJobs([track("t1", "CON")], [F16], "/out");
    expect(jobs[0].outPath).not.toBe("/out/CON.mp4");
    expect(jobs[0].outPath.toLowerCase()).not.toMatch(/\/con\.mp4$/);
  });

  it("strips control characters an ID3 tag can legally contain", () => {
    // Frame text can carry raw bytes 0x00-0x1F (NUL, BEL, TAB, CR/LF, ...);
    // Windows refuses every one of them in a filename. Built via
    // String.fromCharCode rather than source escapes so the test file
    // itself never carries a literal control byte.
    const bel = String.fromCharCode(7);
    const nul = String.fromCharCode(0);
    const tab = String.fromCharCode(9);
    const crlf = String.fromCharCode(13) + String.fromCharCode(10);
    expect(safeName(`Track${bel}Title`)).toBe("TrackTitle");
    expect(safeName(`A${nul}B`)).toBe("AB");
    expect(safeName(`Tab${tab}Here`)).toBe("TabHere");
    expect(safeName(`Line1${crlf}Line2`)).toBe("Line1Line2");
  });

  it("caps a hostile or merely verbose ID3 tag to a writable length", () => {
    const long = safeName("A".repeat(5000));
    expect(long.length).toBeLessThanOrEqual(200);
    // Truncation must not stop right after a space/dot the sanitizer would
    // otherwise have trimmed from the end.
    expect(long).not.toMatch(/[. ]$/);
  });

  it("derives total frames from duration and fps", () => {
    const jobs = expandJobs([track("t1", "One", 10)], [F16], "/out");
    expect(jobs[0].totalFrames).toBe(300);
  });

  it("leaves total frames unknown when duration is unknown", () => {
    const jobs = expandJobs([track("t1", "One", null)], [F16], "/out");
    expect(jobs[0].totalFrames).toBeNull();
  });
});

function run(jobs: BatchRun["jobs"], startedAt = 0): BatchRun {
  return {
    doc: {} as never,
    tracks: [],
    formats: [F16],
    jobs,
    outDir: "/out",
    startedAt,
  };
}

describe("runStats", () => {
  it("estimates from completed jobs, not the in-flight one", () => {
    // 1 of 2 jobs done: 300 frames in 10s -> 30 fps -> 300 frames left = 10s.
    const r = run([
      {
        id: "a",
        trackId: "t1",
        formatId: "16:9",
        outPath: "/o/a.mp4",
        totalFrames: 300,
        status: { k: "done", bytes: 1, path: "/o/a.mp4" },
      },
      {
        id: "b",
        trackId: "t2",
        formatId: "16:9",
        outPath: "/o/b.mp4",
        totalFrames: 300,
        status: { k: "queued" },
      },
    ]);
    const s = runStats(r, 10_000);
    expect(s.done).toBe(1);
    expect(s.framesTotal).toBe(600);
    expect(s.etaMs).toBe(10_000);
  });

  it("has no estimate before anything has finished", () => {
    const r = run([
      {
        id: "a",
        trackId: "t1",
        formatId: "16:9",
        outPath: "/o/a.mp4",
        totalFrames: 300,
        status: { k: "running", done: 50, total: 300, fps: 30, avgFps: 30 },
      },
    ]);
    expect(runStats(r, 5_000).etaMs).toBeNull();
  });

  it("drops a failed job's frames from the outstanding work", () => {
    // Otherwise its frames sit in framesTotal forever: the bar can never reach
    // 100% and the ETA keeps counting frames that will never be rendered.
    const r = run([
      {
        id: "a",
        trackId: "t1",
        formatId: "16:9",
        outPath: "/o/a.mp4",
        totalFrames: 300,
        status: { k: "done", bytes: 1, path: "/o/a.mp4" },
      },
      {
        id: "b",
        trackId: "t2",
        formatId: "16:9",
        outPath: "/o/b.mp4",
        totalFrames: 300,
        status: { k: "failed", kind: "gpu", message: "lost" },
      },
    ]);
    const s = runStats(r, 10_000);
    expect(s.framesTotal).toBe(300);
    expect(s.framesDone).toBe(300);
    expect(s.etaMs).toBe(0);
  });

  it("gives no estimate while any job's length is unknown", () => {
    // "0m left" while a track is still rendering is worse than admitting we
    // don't know: a null duration used to be folded in as 0 frames.
    const r = run([
      {
        id: "a",
        trackId: "t1",
        formatId: "16:9",
        outPath: "/o/a.mp4",
        totalFrames: 300,
        status: { k: "done", bytes: 1, path: "/o/a.mp4" },
      },
      {
        id: "b",
        trackId: "t2",
        formatId: "16:9",
        outPath: "/o/b.mp4",
        totalFrames: null,
        status: { k: "running", done: 50, total: 0, fps: null, avgFps: null },
      },
    ]);
    const s = runStats(r, 10_000);
    expect(s.etaMs).toBeNull();
    // And progress must never exceed the total.
    expect(s.framesDone).toBeLessThanOrEqual(s.framesTotal);
  });

  it("counts a failed job as finished but not as progress", () => {
    const r = run([
      {
        id: "a",
        trackId: "t1",
        formatId: "16:9",
        outPath: "/o/a.mp4",
        totalFrames: 300,
        status: { k: "failed", kind: "gpu", message: "lost" },
      },
    ]);
    const s = runStats(r, 1000);
    expect(s.failed).toBe(1);
    expect(s.framesDone).toBe(0);
    expect(isRunComplete(r)).toBe(true);
  });
});

describe("retryFailed", () => {
  it("re-queues the failures and KEEPS the completed jobs", () => {
    // Dropping the done jobs made the panel under-report what was rendered —
    // "18 done" would become "0 done" the moment you retried the 2 failures.
    const doc = { presetId: "aurora" } as never;
    const r: BatchRun = {
      ...run([
        {
          id: "a",
          trackId: "t1",
          formatId: "16:9",
          outPath: "/out/A.mp4",
          totalFrames: 1,
          status: { k: "done", bytes: 1, path: "/out/A.mp4" },
        },
        {
          id: "b",
          trackId: "t2",
          formatId: "16:9",
          outPath: "/out/B.mp4",
          totalFrames: 1,
          status: { k: "failed", kind: "gpu", message: "lost" },
        },
      ]),
      doc,
      tracks: [track("t1", "A"), track("t2", "B")],
    };
    const again = retryFailed(r, 500);
    expect(again.jobs).toHaveLength(2);
    expect(again.jobs.find((j) => j.id === "a")!.status.k).toBe("done");
    expect(again.jobs.find((j) => j.id === "b")!.status).toEqual({ k: "queued" });
    // A retry must reproduce the original attempt, not adopt a newer template.
    expect(again.doc).toBe(doc);
  });

  it("re-derives the output path from the track's CURRENT title", () => {
    // Fixing a wrong title and hitting Retry is the whole reason retry exists;
    // rendering the new title into the old filename would defeat it.
    const r: BatchRun = {
      ...run([
        {
          id: "b",
          trackId: "t2",
          formatId: "16:9",
          outPath: "/out/Old Name.mp4",
          totalFrames: 1,
          status: { k: "failed", kind: "gpu", message: "lost" },
        },
      ]),
      tracks: [track("t2", "Fixed Title")],
    };
    expect(retryFailed(r, 1).jobs[0].outPath).toBe("/out/Fixed Title.mp4");
  });

  it("never reuses a path a completed job already wrote", () => {
    const r: BatchRun = {
      ...run([
        {
          id: "a",
          trackId: "t1",
          formatId: "16:9",
          outPath: "/out/Drift.mp4",
          totalFrames: 1,
          status: { k: "done", bytes: 1, path: "/out/Drift.mp4" },
        },
        {
          id: "b",
          trackId: "t2",
          formatId: "16:9",
          outPath: "/out/Drift (2).mp4",
          totalFrames: 1,
          status: { k: "failed", kind: "gpu", message: "lost" },
        },
      ]),
      tracks: [track("t1", "Drift"), track("t2", "Drift")],
    };
    // t2 retitled to collide with the finished t1 — the retry must not clobber it.
    expect(retryFailed(r, 1).jobs.find((j) => j.id === "b")!.outPath).toBe("/out/Drift (2).mp4");
  });

  it("leaves skipped jobs alone — the user passed those over on purpose", () => {
    const r: BatchRun = {
      ...run([
        {
          id: "s",
          trackId: "t1",
          formatId: "16:9",
          outPath: "/out/S.mp4",
          totalFrames: 1,
          status: { k: "skipped" },
        },
      ]),
      tracks: [track("t1", "S")],
    };
    expect(retryFailed(r, 1).jobs[0].status).toEqual({ k: "skipped" });
  });

  it("resuming a cancelled run (queued-only, no failures) restamps the rate window (R2-31d)", () => {
    // A cancel leaves queued jobs behind and retryFailedBatch resumes them —
    // but with no failures the old early return kept the ORIGINAL
    // startedAt/preDoneFrames, so runStats measured the resumed run against
    // the whole pause: old work over new elapsed, a nonsense ETA.
    const r: BatchRun = {
      ...run(
        [
          {
            id: "a",
            trackId: "t1",
            formatId: "16:9",
            outPath: "/out/A.mp4",
            totalFrames: 300,
            status: { k: "done", bytes: 1, path: "/out/A.mp4" },
          },
          {
            id: "b",
            trackId: "t2",
            formatId: "16:9",
            outPath: "/out/B.mp4",
            totalFrames: 300,
            status: { k: "queued" },
          },
        ],
        1_000, // the original start, long before the pause
      ),
      tracks: [track("t1", "A"), track("t2", "B")],
    };
    const again = retryFailed(r, 600_000); // resumed after a ten-minute pause
    expect(again.startedAt).toBe(600_000);
    expect(again.preDoneFrames).toBe(300); // a's frames precede the resume
    expect(again.jobs).toBe(r.jobs); // nothing re-queued — statuses untouched
    // The rate window is genuinely fresh: no frames finished since the
    // resume, so the ETA honestly says "don't know yet" instead of scaling
    // pre-pause work across the pause.
    expect(runStats(again, 600_500).etaMs).toBeNull();
  });

  it("a run with nothing failed and nothing queued is returned unchanged", () => {
    const r: BatchRun = {
      ...run([
        {
          id: "a",
          trackId: "t1",
          formatId: "16:9",
          outPath: "/out/A.mp4",
          totalFrames: 300,
          status: { k: "done", bytes: 1, path: "/out/A.mp4" },
        },
      ]),
      tracks: [track("t1", "A")],
    };
    expect(retryFailed(r, 99)).toBe(r);
  });
});

describe("clock domain", () => {
  it("startedAt is a Date.now epoch, not performance.now", () => {
    // The bug this exists to prevent: the store stamped startedAt with
    // performance.now() (ms since page load, ~1e4) while the panel ticked on
    // Date.now() (~1.8e12). runStats' elapsed became ~55 YEARS, the rate
    // collapsed to ~0, and every ETA was garbage. Both ends must share an
    // epoch. The earlier unit tests missed it by using consistent units on
    // both sides — the defect only existed where the two met.
    const startedAt = Date.now() - 10_000; // 10s ago, wall clock
    const r = run(
      [
        {
          id: "a",
          trackId: "t1",
          formatId: "16:9",
          outPath: "/o/a.mp4",
          totalFrames: 300,
          status: { k: "done", bytes: 1, path: "/o/a.mp4" },
        },
        {
          id: "b",
          trackId: "t2",
          formatId: "16:9",
          outPath: "/o/b.mp4",
          totalFrames: 300,
          status: { k: "queued" },
        },
      ],
      startedAt,
    );
    const s = runStats(r, Date.now());
    // 300 frames in 10s -> 300 left -> ~10s. Anything in the hours or years
    // means the epochs have drifted apart again.
    expect(s.etaMs).toBeGreaterThan(8_000);
    expect(s.etaMs).toBeLessThan(12_000);
  });
});

describe("classifyError", () => {
  it("tells the failures apart by name, which is why the name is preserved", () => {
    const lost = new Error("GPU device lost during export: reset");
    lost.name = "GpuDeviceLostError";
    expect(classifyError(lost)?.kind).toBe("gpu");

    const init = new Error("Export requires WebGPU");
    init.name = "GpuInitError";
    expect(classifyError(init)?.kind).toBe("gpu");

    expect(classifyError(new Error("ENOSPC: no space left"))?.kind).toBe("disk");
    expect(classifyError(new Error("file write stalled"))?.kind).toBe("disk");
    // Windows ERROR_DISK_FULL as the Tauri fs plugin words it — the most
    // common desktop out-of-disk, previously classified "unknown".
    expect(
      classifyError(new Error("There is not enough space on the disk. (os error 112)"))?.kind,
    ).toBe("disk");
    expect(classifyError(new Error("Nothing to export: the audio segment is empty"))?.kind).toBe(
      "input",
    );
    expect(classifyError(new Error("something else"))?.kind).toBe("unknown");
  });

  it("does not treat an abort as a failure", () => {
    // Skipping a track is the user getting what they asked for. Showing it red
    // beside real failures — and re-rendering it under "Retry failed" — would
    // misreport what happened.
    expect(classifyError(new DOMException("stop", "AbortError"))).toBeNull();
  });
});

/**
 * HD-24 — a batch job's failure gets the single lane's diagnosis.
 *
 * runExport folds `translateExportError` over every failure with a FRESH
 * scratch-volume reading, so a NotReadableError (the Blob API's stock text
 * blames "permission problems" on the drive the user exported TO — the one
 * drive known to be fine) is named as out-of-working-space when scratch
 * really is full. The batch lane only ever ran `classifyError`, so its rows
 * carried the misleading raw text. describeFailure is classifyError plus
 * that translation, and a translated failure is a DISK failure whatever the
 * raw text matched.
 */
describe("describeFailure", () => {
  const lowScratch = { freeBytes: 100e6, totalBytes: 500e9, root: "C:\\" };
  const roomyScratch = { freeBytes: 400e9, totalBytes: 500e9, root: "C:\\" };

  it("translates a Windows disk-full into the single lane's sentence, kind disk", () => {
    const d = describeFailure(
      new Error("There is not enough space on the disk. (os error 112)"),
      null,
    );
    expect(d?.kind).toBe("disk");
    expect(d?.message).toMatch(/ran out of space while writing/);
  });

  it("names a NotReadableError as working-space exhaustion only when scratch is really low", () => {
    const nre = new DOMException("The requested file could not be read", "NotReadableError");
    const low = describeFailure(nre, lowScratch);
    expect(low?.kind).toBe("disk");
    expect(low?.message).toMatch(/working space on C:\\/);
    // Plenty of scratch: no confident disk diagnosis — the raw text and the
    // ordinary classification stand, exactly like classifyError alone.
    const roomy = describeFailure(nre, roomyScratch);
    expect(roomy).toEqual(classifyError(nre));
    expect(roomy?.kind).toBe("unknown");
  });

  it("leaves untranslatable failures exactly as classifyError reads them", () => {
    const gpu = new Error("GPU device lost during export: reset");
    gpu.name = "GpuDeviceLostError";
    expect(describeFailure(gpu, lowScratch)).toEqual(classifyError(gpu));
  });

  it("still reads an abort as not-a-failure", () => {
    expect(describeFailure(new DOMException("stop", "AbortError"), lowScratch)).toBeNull();
  });
});

/**
 * HD-03 — stems and lyrics are imported PER TRACK (loadFile clears both), so
 * no batch track can carry them: a stem route or the Vocals (lyrics) source
 * reads 0 in every batched video — as it would in an interactive export of
 * any track you had not imported them for. That is the determinism law
 * holding, not breaking; what was wrong is that nothing SAID so. This helper
 * is what the panel warns from: which of the LOADED track's imports the
 * document the run will freeze actually leans on. Both halves must hold —
 * a route with nothing imported already reads 0 in preview (nothing
 * diverges, nothing to say), and `lyricStyle.enabled` is TRUE by default, so
 * a caption warning keyed on the style alone would fire on every fresh
 * document with no lyrics anywhere near it.
 */
describe("batchInertSources", () => {
  const route = (source: string, param = "hue") => ({
    id: `r-${source}`,
    source,
    param,
    amount: 0.5,
  });
  const doc = (over: Record<string, unknown>) =>
    ({
      presetId: "bars",
      modsByPreset: {},
      timeline: { enabled: false, scenes: [], lanes: [] },
      lyricStyle: { enabled: false },
      ...over,
    }) as unknown as ProjectDocument;
  const LOADED = { hasStems: true, hasLyrics: true };
  const NOTHING = { hasStems: false, hasLyrics: false };

  it("reads nothing off a document that routes only DSP sources", () => {
    expect(
      batchInertSources(doc({ modsByPreset: { bars: [route("bass"), route("kick")] } }), LOADED),
    ).toEqual({ stems: false, vocal: false, captions: false });
  });

  it("flags stem routes and the Vocals source on the active mode when the track carries them", () => {
    const s = batchInertSources(
      doc({ modsByPreset: { bars: [route("stem1:kick"), route("vocal")] } }),
      LOADED,
    );
    expect(s.stems).toBe(true);
    expect(s.vocal).toBe(true);
  });

  it("stays quiet about routes when nothing is imported — preview reads 0 there too", () => {
    const s = batchInertSources(
      doc({ modsByPreset: { bars: [route("stem1:kick"), route("vocal")] } }),
      NOTHING,
    );
    expect(s).toEqual({ stems: false, vocal: false, captions: false });
    // Each half gates its own source: stems loaded says nothing about lyrics.
    const stemsOnly = batchInertSources(
      doc({ modsByPreset: { bars: [route("stem1:kick"), route("vocal")] } }),
      { hasStems: true, hasLyrics: false },
    );
    expect(stemsOnly).toEqual({ stems: true, vocal: false, captions: false });
  });

  it("ignores routes on a mode the run will never render", () => {
    // Routes are stored per mode; a stem route parked on an INACTIVE mode
    // never evaluates, so warning about it would be a false alarm.
    const s = batchInertSources(doc({ modsByPreset: { tunnel: [route("stem2:bass")] } }), LOADED);
    expect(s.stems).toBe(false);
  });

  it("looks at every scene's mode when the timeline is enabled", () => {
    const scenes = [{ id: "s1", name: "A", presetId: "tunnel", start: 0 }];
    const on = batchInertSources(
      doc({
        modsByPreset: { tunnel: [route("stem2:bass")] },
        timeline: { enabled: true, scenes, lanes: [] },
      }),
      LOADED,
    );
    expect(on.stems).toBe(true);
    // ...and not when it is off: a disabled timeline's scenes are inert too.
    const off = batchInertSources(
      doc({
        modsByPreset: { tunnel: [route("stem2:bass")] },
        timeline: { enabled: false, scenes, lanes: [] },
      }),
      LOADED,
    );
    expect(off.stems).toBe(false);
  });

  it("flags an enabled lyric caption only while the loaded track has lyrics to draw", () => {
    const styled = doc({ lyricStyle: { enabled: true } });
    expect(batchInertSources(styled, LOADED).captions).toBe(true);
    // The default document ships with the caption style ON and no lyrics
    // loaded; that is every user's starting point, not a warning.
    expect(batchInertSources(styled, NOTHING).captions).toBe(false);
    // And lyrics loaded with the caption switched off draw nothing in the
    // preview either — nothing to warn about.
    expect(batchInertSources(doc({}), LOADED).captions).toBe(false);
  });
});
