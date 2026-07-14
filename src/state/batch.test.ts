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

  it("sanitises titles into filesystem-safe names", () => {
    const jobs = expandJobs([track("t1", 'A/B:C*?"<>|D')], [F16], "/out");
    expect(jobs[0].outPath).toBe("/out/ABCD.mp4");
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
  it("re-queues only the failures, against the same frozen document", () => {
    const doc = { presetId: "aurora" } as never;
    const r: BatchRun = {
      ...run([
        {
          id: "a",
          trackId: "t1",
          formatId: "16:9",
          outPath: "/o/a.mp4",
          totalFrames: 1,
          status: { k: "done", bytes: 1, path: "/o/a.mp4" },
        },
        {
          id: "b",
          trackId: "t2",
          formatId: "16:9",
          outPath: "/o/b.mp4",
          totalFrames: 1,
          status: { k: "failed", kind: "gpu", message: "lost" },
        },
      ]),
      doc,
    };
    const again = retryFailed(r, 500);
    expect(again.jobs).toHaveLength(1);
    expect(again.jobs[0].id).toBe("b");
    expect(again.jobs[0].status).toEqual({ k: "queued" });
    // A retry must reproduce the original attempt, not adopt a newer template.
    expect(again.doc).toBe(doc);
  });
});

describe("classifyError", () => {
  it("tells the failures apart by name, which is why the name is preserved", () => {
    const abort = new DOMException("stop", "AbortError");
    expect(classifyError(abort).kind).toBe("cancelled");

    const lost = new Error("GPU device lost during export: reset");
    lost.name = "GpuDeviceLostError";
    expect(classifyError(lost).kind).toBe("gpu");

    const init = new Error("Export requires WebGPU");
    init.name = "GpuInitError";
    expect(classifyError(init).kind).toBe("gpu");

    expect(classifyError(new Error("ENOSPC: no space left")).kind).toBe("disk");
    expect(classifyError(new Error("Nothing to export: the audio segment is empty")).kind).toBe(
      "input",
    );
    expect(classifyError(new Error("something else")).kind).toBe("unknown");
  });
});
