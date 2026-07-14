import type { OverlayMeta } from "../render/overlay";
import type { FormatPreset } from "../export/buildExportOptions";
import type { ProjectDocument } from "./project";

/**
 * Batch render model: pure data + pure functions. No store, no engine, no fs.
 *
 * The product this serves is "drop 20 MP3s in, get 20 titled videos out" — the
 * titles come from the files' own tags, so the surface is a table of tracks
 * with editable titles and the job list is derived from it.
 */

export function newBatchId(): string {
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface BatchTrack {
  id: string;
  file: File;
  meta: OverlayMeta;
  /** False when the title was guessed from the filename — surfaced in the UI. */
  metaFromTags: boolean;
  /** Cover art data URL from the file's tags, for presets that sample it. */
  coverArt: string | null;
  duration: number | null;
}

export type FailKind = "input" | "gpu" | "disk" | "stalled" | "cancelled" | "unknown";

export type JobStatus =
  | { k: "queued" }
  | { k: "running"; done: number; total: number; fps: number | null }
  | { k: "done"; bytes: number; path: string }
  | { k: "failed"; kind: FailKind; message: string };

export interface BatchJob {
  id: string;
  trackId: string;
  formatId: string;
  outPath: string;
  totalFrames: number | null;
  status: JobStatus;
}

export interface BatchRun {
  /**
   * The template, FROZEN when the run starts. A batch renders what it began
   * with, not whatever the user edits at midnight — which also makes the run
   * reproducible and provably read-only against live state.
   */
  doc: ProjectDocument;
  tracks: BatchTrack[];
  formats: FormatPreset[];
  jobs: BatchJob[];
  outDir: string;
  startedAt: number;
}

/** Strip an extension and anything a filesystem would object to. */
export function safeName(name: string): string {
  const base = name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^\w\- ]+/g, "")
    .trim();
  return base || "visualization";
}

/**
 * Cartesian product of tracks x formats, with collision-safe output paths.
 *
 * Two tracks can legitimately share a title (a remix and its original), and one
 * track rendered to three aspects would otherwise write three jobs to one path
 * — so names carry the format when there is more than one, and repeats get a
 * numeric suffix. Silently overwriting a finished render is the one outcome an
 * overnight batch must never produce.
 */
export function expandJobs(
  tracks: BatchTrack[],
  formats: FormatPreset[],
  outDir: string,
  taken: ReadonlySet<string> = new Set(),
): BatchJob[] {
  const used = new Set<string>(taken);
  const jobs: BatchJob[] = [];
  for (const track of tracks) {
    for (const fmt of formats) {
      const stem = safeName(track.meta.title || track.file.name);
      const withFmt = formats.length > 1 ? `${stem}_${fmt.w}x${fmt.h}` : stem;
      let name = `${withFmt}.mp4`;
      let n = 2;
      while (used.has(name.toLowerCase())) name = `${withFmt} (${n++}).mp4`;
      used.add(name.toLowerCase());
      jobs.push({
        id: newBatchId(),
        trackId: track.id,
        formatId: fmt.id,
        outPath: `${outDir}/${name}`,
        totalFrames: track.duration != null ? Math.ceil(track.duration * fmt.fps) : null,
        status: { k: "queued" },
      });
    }
  }
  return jobs;
}

export interface BatchStats {
  done: number;
  failed: number;
  total: number;
  framesDone: number;
  framesTotal: number;
  /** Milliseconds left, or null until at least one job has finished. */
  etaMs: number | null;
}

/**
 * Progress across the run.
 *
 * The ETA averages throughput over COMPLETED jobs rather than using the
 * instantaneous rate: the current job's fps swings wildly (a 4K job is slower
 * than a 720p one, and the first frames include pipeline compilation), and an
 * estimate that oscillates is worse than none at 3am.
 */
export function runStats(run: BatchRun, nowMs: number): BatchStats {
  let done = 0;
  let failed = 0;
  let framesDone = 0;
  let framesTotal = 0;
  let finishedFrames = 0;
  for (const j of run.jobs) {
    framesTotal += j.totalFrames ?? 0;
    if (j.status.k === "done") {
      done++;
      framesDone += j.totalFrames ?? 0;
      finishedFrames += j.totalFrames ?? 0;
    } else if (j.status.k === "failed") {
      failed++;
    } else if (j.status.k === "running") {
      framesDone += j.status.done;
    }
  }
  const elapsed = nowMs - run.startedAt;
  const rate = finishedFrames > 0 && elapsed > 0 ? finishedFrames / elapsed : null;
  const remaining = Math.max(0, framesTotal - framesDone);
  return {
    done,
    failed,
    total: run.jobs.length,
    framesDone,
    framesTotal,
    etaMs: rate && rate > 0 ? Math.round(remaining / rate) : null,
  };
}

/** True once no job can still make progress. */
export function isRunComplete(run: BatchRun): boolean {
  return run.jobs.every((j) => j.status.k === "done" || j.status.k === "failed");
}

/**
 * A new run containing only the failed jobs, against the SAME frozen document
 * — a retry must reproduce the original attempt, not silently adopt whatever
 * the template looks like now.
 */
export function retryFailed(run: BatchRun, nowMs: number): BatchRun {
  const failed = run.jobs.filter((j) => j.status.k === "failed");
  return {
    ...run,
    startedAt: nowMs,
    jobs: failed.map((j) => ({ ...j, status: { k: "queued" } as JobStatus })),
  };
}

/** Classify a thrown export error into something a user can act on. */
export function classifyError(e: unknown): { kind: FailKind; message: string } {
  const err = e as Error;
  const name = err?.name ?? "";
  const message = err?.message ?? String(e);
  if (name === "AbortError") return { kind: "cancelled", message: "Cancelled" };
  if (name === "GpuDeviceLostError" || name === "GpuInitError") return { kind: "gpu", message };
  if (/no space|ENOSPC|disk/i.test(message)) return { kind: "disk", message };
  if (/decode|empty|unsupported/i.test(message)) return { kind: "input", message };
  return { kind: "unknown", message };
}
