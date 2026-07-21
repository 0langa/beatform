import type { OverlayMeta } from "../render/overlay";
import type { PresetDef } from "../render/types";
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

export type FailKind = "input" | "gpu" | "disk" | "unknown";

export type JobStatus =
  | { k: "queued" }
  | { k: "running"; done: number; total: number; fps: number | null }
  | { k: "done"; bytes: number; path: string }
  | { k: "failed"; kind: FailKind; message: string }
  /**
   * The user asked for this one to be skipped. Distinct from "failed": nothing
   * went wrong, so it must not show up red, and "Retry failed" must not quietly
   * render the track they deliberately passed over.
   */
  | { k: "skipped" };

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
  /**
   * Wall-clock start (Date.now, NOT performance.now). The panel's countdown
   * ticks on Date.now and reports a finish time, so both ends must share one
   * epoch — mixing them silently yields an elapsed of ~55 years.
   */
  startedAt: number;
  /**
   * Frames already finished when startedAt was (re)stamped — set by retry so
   * the rate counts only frames rendered SINCE the retry began. Without it a
   * retry divides hours of finished frames by seconds of elapsed time and
   * every ETA reads ~0.
   */
  preDoneFrames?: number;
  /** Loudness target, frozen with the doc. Undefined = encode at source level. */
  loudness?: { targetLufs: number; truePeakDb: number };
  /**
   * User-authored WGSL presets, frozen with the doc. The doc only carries the
   * custom preset's ID — without the defs riding along, the export worker's
   * empty registry silently falls back to the default visual for every job.
   */
  customPresets?: PresetDef[];
}

/**
 * Strip an extension and the characters a filename cannot contain.
 *
 * Deliberately NOT `[^\w\- ]`, which is what the single-export path uses: \w is
 * ASCII-only, so that rule deletes every CJK/Cyrillic/accented character. A
 * batch of Japanese titles would each sanitise to empty and pile up as
 * "visualization.mp4", "visualization (2).mp4" — every filename useless and the
 * mapping back to the tracks lost. The filesystem has no such objection.
 */
/** The characters Windows refuses in a filename. Everything else is fair
 * game — including CJK, Cyrillic and accents. */
const ILLEGAL_IN_FILENAME = ["<", ">", ":", '"', "/", "\\", "|", "?", "*"];

/**
 * Windows device names, reserved regardless of case or extension: `CON`,
 * `con.txt` and `Con.mp4.bak` are all refused because the OS matches on the
 * path segment before the FIRST dot, not the whole filename. A title (or
 * fallback filename) that happens to equal one exactly would otherwise
 * produce an unwritable batch output.
 */
const RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

/**
 * NTFS filenames cap out at 255 UTF-16 code units. This is comfortably under
 * that even after a caller appends the longest realistic suffix — a
 * resolution qualifier plus a dedupe counter plus an extension, e.g.
 * `_3840x2160 (12).mp4` (~20 chars).
 */
const MAX_STEM_LENGTH = 200;

export function safeName(name: string): string {
  let base = name.replace(/\.[a-z0-9]+$/i, "");
  for (const ch of ILLEGAL_IN_FILENAME) base = base.split(ch).join("");
  // Control characters (NUL and 0x01-0x1F) are illegal in Windows filenames.
  // A literal control-character regex trips eslint's no-control-regex (it's
  // usually a mistake elsewhere), so filter by code unit instead.
  base = base
    .split("")
    .filter((ch) => ch.charCodeAt(0) > 0x1f)
    .join("");
  // Windows also rejects a trailing dot or space.
  base = base.replace(/[. ]+$/, "").trim();
  // A hostile or merely verbose ID3 tag must not produce an unwritable path.
  base = base.slice(0, MAX_STEM_LENGTH);
  // Truncation can strand a new trailing dot/space; strip once more.
  base = base.replace(/[. ]+$/, "").trim();
  if (!base) return "visualization";
  // Windows matches the reserved-name list against the segment before the
  // FIRST dot only — "CON.mp4.bak" is still refused, "Confessions" is not.
  const firstSegment = base.split(".", 1)[0];
  if (RESERVED_NAMES.has(firstSegment.toUpperCase())) return `_${base}`;
  return base;
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
      const ext = fmt.codec === "vp9a" ? "webm" : "mp4";
      let name = `${withFmt}.${ext}`;
      let n = 2;
      while (used.has(name.toLowerCase())) name = `${withFmt} (${n++}).${ext}`;
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
  skipped: number;
  total: number;
  framesDone: number;
  framesTotal: number;
  /** Milliseconds left, or null when it cannot honestly be estimated. */
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
  let skipped = 0;
  let framesDone = 0;
  let framesTotal = 0;
  let finishedFrames = 0;
  // A job whose duration could not be read has no frame count, so no honest
  // share of the bar. Track that separately rather than folding it in as 0:
  // counting it as zero-length makes the run look further along than it is,
  // and lets framesDone overshoot framesTotal once it actually renders.
  let unknown = 0;
  for (const j of run.jobs) {
    if (j.totalFrames == null) unknown++;
    else framesTotal += j.totalFrames;

    if (j.status.k === "done") {
      done++;
      framesDone += j.totalFrames ?? 0;
      // Rate comes only from jobs that both finished AND had a known length.
      if (j.totalFrames != null) finishedFrames += j.totalFrames;
    } else if (j.status.k === "failed") {
      failed++;
      // Its frames will never be rendered — drop them from the outstanding
      // work, or the bar can never reach 100% and the ETA counts ghost frames.
      if (j.totalFrames != null) framesTotal -= j.totalFrames;
    } else if (j.status.k === "skipped") {
      skipped++;
      if (j.totalFrames != null) framesTotal -= j.totalFrames;
    } else if (j.status.k === "running") {
      // Clamp: a job's reported progress can exceed the duration-derived
      // estimate by a frame or two, and a bar over 100% reads as a bug.
      framesDone += Math.min(j.status.done, j.totalFrames ?? j.status.done);
    }
  }
  const elapsed = nowMs - run.startedAt;
  const freshFrames = finishedFrames - (run.preDoneFrames ?? 0);
  const rate = freshFrames > 0 && elapsed > 0 ? freshFrames / elapsed : null;
  const remaining = Math.max(0, framesTotal - framesDone);
  return {
    done,
    failed,
    skipped,
    total: run.jobs.length,
    framesDone: Math.min(framesDone, framesTotal),
    framesTotal,
    // No estimate while any queued job's length is unknown — "0m left" with a
    // track still rendering is worse than admitting we don't know.
    etaMs: rate && rate > 0 && unknown === 0 ? Math.round(remaining / rate) : null,
  };
}

/** True once no job can still make progress. */
export function isRunComplete(run: BatchRun): boolean {
  return (
    run.jobs.length > 0 &&
    run.jobs.every(
      (j) => j.status.k === "done" || j.status.k === "failed" || j.status.k === "skipped",
    )
  );
}

/** Output paths already written by this run — never overwrite a finished video. */
export function takenPaths(run: BatchRun): Set<string> {
  const taken = new Set<string>();
  for (const j of run.jobs) {
    if (j.status.k === "done") taken.add(j.outPath.split("/").pop()!.toLowerCase());
  }
  return taken;
}

/**
 * Re-queue the failed jobs, KEEPING the completed ones so the report still
 * tells the truth about what was rendered. Same frozen document: a retry
 * reproduces the original attempt rather than adopting a newer template.
 *
 * Skipped jobs are left alone — the user passed over those on purpose.
 *
 * Output paths are re-derived from the tracks' CURRENT titles, because the
 * usual reason to retry is that you just fixed a title; writing the new title
 * into the old filename would be its own small betrayal. Paths already written
 * by this run are excluded so a retry can never clobber a finished video.
 */
export function retryFailed(
  run: BatchRun,
  nowMs: number,
  /** Extra reserved names (files already on disk from OTHER runs into the
   * same folder) — this run's own done files are excluded automatically. */
  alsoTaken: ReadonlySet<string> = new Set(),
): BatchRun {
  const failed = run.jobs.filter((j) => j.status.k === "failed");
  if (failed.length === 0) return run;
  const taken = takenPaths(run);
  for (const n of alsoTaken) taken.add(n);
  const byId = new Map(run.tracks.map((t) => [t.id, t]));
  const requeued = failed.map((j) => {
    const track = byId.get(j.trackId);
    const fmt = run.formats.find((f) => f.id === j.formatId);
    let outPath = j.outPath;
    if (track && fmt) {
      const stem = safeName(track.meta.title || track.file.name);
      const withFmt = run.formats.length > 1 ? `${stem}_${fmt.w}x${fmt.h}` : stem;
      const ext = fmt.codec === "vp9a" ? "webm" : "mp4";
      let name = `${withFmt}.${ext}`;
      let n = 2;
      while (taken.has(name.toLowerCase())) name = `${withFmt} (${n++}).${ext}`;
      taken.add(name.toLowerCase());
      outPath = `${run.outDir}/${name}`;
    }
    return { ...j, outPath, status: { k: "queued" } as JobStatus };
  });
  const requeuedIds = new Set(requeued.map((j) => j.id));
  // Frames finished before this retry: excluded from the retry's rate so the
  // ETA reflects rendering speed since NOW, not old-work / new-elapsed.
  let preDoneFrames = 0;
  for (const j of run.jobs) {
    if (j.status.k === "done" && j.totalFrames != null) preDoneFrames += j.totalFrames;
  }
  return {
    ...run,
    startedAt: nowMs,
    preDoneFrames,
    // Keep every other job exactly as it was; only the failures re-run.
    jobs: run.jobs.map((j) => (requeuedIds.has(j.id) ? requeued.find((r) => r.id === j.id)! : j)),
  };
}

/**
 * Classify a thrown export error into something a user can act on.
 *
 * Returns null for an abort — that is not a failure, it is the user getting
 * what they asked for, and showing it red next to real failures (and then
 * re-rendering it under "Retry failed") would be a lie about what happened.
 */
export function classifyError(e: unknown): { kind: FailKind; message: string } | null {
  const err = e as Error;
  const name = err?.name ?? "";
  const message = err?.message ?? String(e);
  if (name === "AbortError") return null;
  if (name === "GpuDeviceLostError" || name === "GpuInitError") return { kind: "gpu", message };
  // Codec preflights say "... encode not supported ..." (H.264/HEVC/AV1/VP9)
  // — a machine capability, not a broken input file. The /unsupported/ input
  // match below never catches the two-word form.
  if (/encode not supported/i.test(message)) return { kind: "gpu", message };
  // Windows ERROR_DISK_FULL (112) surfaces through @tauri-apps/plugin-fs as
  // "There is not enough space on the disk. (os error 112)" — which matched
  // none of the POSIX spellings, so the most common desktop out-of-disk was
  // landing in "unknown" and losing its tailored retry advice.
  if (/no space|not enough space|ENOSPC|os error 112|disk full|stalled/i.test(message)) {
    return { kind: "disk", message };
  }
  if (/decode|empty|unsupported/i.test(message)) return { kind: "input", message };
  return { kind: "unknown", message };
}
