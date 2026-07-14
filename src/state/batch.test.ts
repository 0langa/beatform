import { describe, expect, it } from "vitest";
import {
  classifyError,
  expandJobs,
  isRunComplete,
  retryFailed,
  runStats,
  safeName,
  type BatchRun,
  type BatchTrack,
} from "./batch";
import type { FormatPreset } from "../export/buildExportOptions";

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
        status: { k: "running", done: 50, total: 300, fps: 30 },
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
        status: { k: "running", done: 50, total: 0, fps: null },
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
