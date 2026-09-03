import { readTrackMeta } from "../../audio/trackMeta";
import type { FormatPreset } from "../../export/buildExportOptions";
import {
  expandJobs,
  isRunComplete,
  newBatchId,
  retryFailed,
  takenPaths,
  type BatchRun,
  type BatchTrack,
  type JobStatus,
} from "../batch";
import { runBatch, type BatchRunnerHooks } from "../batchRunner";
import { estimateExportBytes, preflightWarning, sumDiskNeeds } from "../../export/diskPreflight";
import {
  autoBitrateMbps,
  exportFormatLabel,
  RESOLUTIONS,
  SIMPLIFIED_EXPORT_REASON,
  type ExportSettings,
} from "../exportConfig";
import { askConfirm, diskSpace, isTauri, pickFolder, scratchDir } from "../platform";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";
import { shared } from "./shared";

/** Stops the whole batch; separate from the per-job controller so that
 * skipping one job never ends the night. */
let batchAbort: AbortController | null = null;
/** Claimed synchronously by startBatch (before the folder dialog awaits) and
 * by retryFailedBatch (before its readDir/pre-flight awaits, R2-04) — one
 * variable, so the two entry points also exclude each other. */
let batchStarting = false;

/** One sentence for the single-export-running refusal (F2): the store guard
 * below and the panel's disabled-Start tooltip must give the same reason. */
export const EXPORT_RUNNING_REASON =
  "Finish (or cancel) the running export before starting a batch";

/** What batch renders, in the panel's words — the note beside Start and the
 * first clause of every settings refusal, so the two cannot drift. */
export const BATCH_OUTPUT_NOTE = "Batch renders whole tracks as MP4 / WebM";

/**
 * HD-01 / HD-02: the batch lane renders exactly one thing — the in-worker
 * WebCodecs video (MP4, or WebM under the VP9 + alpha codec), one whole
 * track per job. Every other export-panel Format (PNG frames, ProRes, AV1
 * 10-bit, GIF, WebP) and the Canvas loop Type are single-track lanes the
 * runner has no path for: the sidecar formats need an ffmpeg session per
 * file and the deep-color tap, a Canvas loop needs a segment, a crossfade
 * and the 9:16 spec. startBatch used to read none of it and quietly wrote
 * MP4s. One sentence, shared by the store guard and the panel's disabled
 * Start (the F2 idiom), naming the setting and what batch renders. Null =
 * nothing to refuse.
 */
export function batchSettingsRefusal(
  settings: Pick<ExportSettings, "format" | "mode">,
): string | null {
  const fixes: string[] = [];
  if (settings.mode === "canvas") fixes.push("Type from Canvas loop to Video");
  if (settings.format !== "mp4") {
    fixes.push(`Format from ${exportFormatLabel(settings.format)} to MP4`);
  }
  if (fixes.length === 0) return null;
  return `${BATCH_OUTPUT_NOTE} — switch ${fixes.join(" and ")} in the Export panel`;
}

/**
 * R2-13: the summed warn-and-override disk pre-flight, shared by startBatch
 * AND retryFailedBatch — a retry re-runs exactly the jobs that may have
 * failed on a full disk, so it needs the check at least as much as the first
 * attempt did. Sums per-queued-job estimateExportBytes into one DiskNeed and
 * runs the identical askConfirm the single lane uses; never a hard block.
 * diskSpace answers null off the desktop (and for an unqueryable volume) and
 * preflightWarning stays silent on null volumes, so the browser build passes
 * through without a word. Returns false only when the user DECLINED; throws
 * propagate (the ACL-throw precedent) for the callers to turn into
 * batchError while releasing their own claims.
 */
async function batchDiskPreflight(run: BatchRun): Promise<boolean> {
  const scratchPath = await scratchDir();
  const [outVol, scratchVol] = await Promise.all([
    diskSpace(run.outDir),
    scratchPath ? diskSpace(scratchPath) : Promise.resolve(null),
  ]);
  const byTrack = new Map(run.tracks.map((t) => [t.id, t]));
  const need = sumDiskNeeds(
    run.jobs
      .filter((j) => j.status.k === "queued")
      .map((j) => {
        const jobFmt = run.formats.find((f) => f.id === j.formatId);
        // A job whose format record is gone cannot be estimated — count it
        // as zero rather than inventing numbers (warn-and-override anyway).
        if (!jobFmt) return { outputBytes: 0, scratchBytes: 0, framesThroughScratch: false };
        return estimateExportBytes({
          format: jobFmt.codec === "vp9a" ? "webm" : "mp4",
          width: jobFmt.w,
          height: jobFmt.h,
          fps: jobFmt.fps,
          // Unknown duration (unreadable tags) estimates as zero — an
          // honest under-count, and the prompt is overridable anyway.
          seconds: byTrack.get(j.trackId)?.duration ?? 0,
          bitrate: jobFmt.mbps * 1e6,
          // Nothing is decoded yet; only the WAV-staging sidecar lanes
          // read these, and the batch renders mp4/webm.
          sampleRate: 48_000,
          channels: 2,
        });
      }),
  );
  const warning = preflightWarning(need, outVol, scratchVol);
  return !warning || (await askConfirm(warning, "Low disk space"));
}

export function batchActions(set: SetFn, get: GetFn, ctx: SliceCtx) {
  /**
   * The runner hooks both entry points share — one definition, so a retry
   * cannot drift from a first run in what it mirrors or how it diagnoses.
   *
   * onJobStart/onTrackStart reuse the single-export controller so the
   * existing Cancel path means "skip this job" for free — one level earlier
   * for the track window, because while a track is still decoding/analysing
   * (before any of its jobs exist) Skip must still have something to abort,
   * or it sits inert until that finishes on its own.
   *
   * onJobUpdate mirrors the running job into `exporting` so the rest of the
   * app already knows a render is in flight: the Export button is
   * conditionally rendered on !exporting, and runExport has no re-entrancy
   * guard, so without this a click mid-batch would start a second export
   * and clobber the shared abort controller. Both rates ride along (HD-24).
   *
   * measureScratch is the fresh scratch-volume reading the runner folds into
   * a failed job's diagnosis (HD-24) — the same re-measure runExport does.
   */
  const runnerHooks = (ac: AbortController): BatchRunnerHooks => ({
    onJobStart: (_id, jobAc) => {
      shared.exportAbort = jobAc;
    },
    onTrackStart: (_trackId, trackAc) => {
      shared.exportAbort = trackAc;
    },
    onJobUpdate: (id: string, status: JobStatus) => {
      const cur = get().batch;
      if (!cur) return;
      set({
        batch: { ...cur, jobs: cur.jobs.map((j) => (j.id === id ? { ...j, status } : j)) },
        exporting:
          status.k === "running"
            ? {
                done: status.done,
                total: Math.max(1, status.total),
                speed: status.fps,
                avgSpeed: status.avgFps,
              }
            : null,
      });
    },
    measureScratch: async () => {
      const path = await scratchDir();
      return path ? diskSpace(path) : null;
    },
    shouldStop: () => ac.signal.aborted,
  });

  return {
    setShowBatch(open) {
      // A refusal message belongs to the attempt that earned it — reopening
      // the panel starts clean instead of resurrecting a stale reason.
      set({ showBatch: open, batchError: null });
    },

    async addBatchTracks(files) {
      // Guard BOTH ends. Reading tags takes seconds per file (a VBR scan), and
      // a run can start inside that window — writing a pre-await snapshot then
      // would blank the live run's jobs and flip batchStatus back to "idle",
      // which in turn defeats every other guard in this file.
      if (get().batchStatus === "running") {
        // The drop overlay invites exactly this — say why nothing happened.
        ctx.flashNotice("Batch is running — add tracks after it finishes");
        return;
      }
      // Reading each file's own tags IS the feature: no spreadsheet, no data
      // source, no manual titling. duration:true here (and only here) — the
      // queue needs it for its estimate and pays the VBR scan cost off the
      // interactive path.
      const added: BatchTrack[] = [];
      // R2-31f: an AGGREGATE counter, never this call's own numbers. Drops
      // overlap — nothing stops a second drop while the first is still reading
      // tags — so each call adds its files on entry, subtracts one per file,
      // and on exit subtracts only what it still owes. Per-call writes
      // (`files.length`, then 0 in the finally) let the second drop overwrite
      // the first's remaining count and let whichever drop finished first
      // zero the counter with the other's files still in flight, so the
      // panel's spinner vanished mid-scan.
      let owed = files.length;
      set({ batchScanning: get().batchScanning + owed });
      try {
        for (const file of files) {
          const { meta, fromTags, coverArt, duration } = await readTrackMeta(file, file.name, {
            duration: true,
          });
          added.push({ id: newBatchId(), file, meta, metaFromTags: fromTags, coverArt, duration });
          owed--;
          set({ batchScanning: get().batchScanning - 1 });
        }
      } finally {
        // A throw mid-drop releases the rest of THIS drop's files only.
        if (owed > 0) set({ batchScanning: Math.max(0, get().batchScanning - owed) });
      }
      // Re-read after the awaits, and bail if a run began while we scanned.
      if (get().batchStatus === "running") return;
      const cur = get().batch;
      set({
        batch: {
          doc: ctx.docOf(get()),
          formats: cur?.formats ?? [],
          outDir: cur?.outDir ?? "",
          startedAt: 0,
          tracks: [...(cur?.tracks ?? []), ...added],
          // KEEP the previous run's job records: takenPaths() reads them so a
          // later Start into the same folder never overwrites a video an
          // earlier run already finished. Wiping them here re-armed exactly
          // that overwrite.
          jobs: cur?.jobs ?? [],
        },
        batchStatus: "idle",
      });
    },

    removeBatchTrack(id) {
      const b = get().batch;
      if (!b || get().batchStatus === "running") return;
      set({ batch: { ...b, tracks: b.tracks.filter((t) => t.id !== id) } });
    },

    setBatchTrackMeta(id, meta) {
      const b = get().batch;
      if (!b) return;
      set({
        batch: {
          ...b,
          tracks: b.tracks.map((t) => (t.id === id ? { ...t, meta: { ...t.meta, ...meta } } : t)),
        },
      });
    },

    async startBatch() {
      const b = get().batch;
      if (!b || b.tracks.length === 0 || get().batchStatus === "running" || batchStarting) return;
      // Symmetric to runExport's batch check: two renders at once would fight
      // over the GPU and the shared progress/abort state (concurrency is 1 by
      // design — each export builds its own device + encoder session).
      // Refusals land in batchError — the panel that owns the Start button —
      // not exportError, which only ExportDialog renders (SS-3).
      if (get().exporting || shared.exportStarting) {
        set({ batchError: EXPORT_RUNNING_REASON });
        return;
      }
      // F2: worse here than for a single export — every job builds its own
      // WebGPU device, so on the Canvas2D fallback a 20-track queue used to
      // fail 20 times in a row, paying a full decode + analysis for each. Stop
      // before the folder dialog, same reason the Start button's tooltip gives.
      if (get().simplifiedRenderer) {
        set({ batchError: SIMPLIFIED_EXPORT_REASON });
        return;
      }
      if (!isTauri()) {
        set({ batchError: "Batch render needs the desktop app (it writes files to a folder)" });
        return;
      }
      // HD-01 / HD-02: a Format or Type the batch lane cannot render is
      // refused HERE — before the folder dialog, after the desktop check (an
      // absolute constraint is named before a fixable one).
      const refusal = batchSettingsRefusal(get().exportSettings);
      if (refusal) {
        set({ batchError: refusal });
        return;
      }
      // batchStatus does not become "running" until after the folder dialog, so
      // a double-click on Start would otherwise pass this guard twice and launch
      // two runs writing to the same paths. Claim the slot synchronously.
      batchStarting = true;
      let outDir: string | null = null;
      try {
        outDir = await pickFolder("Choose a folder for the rendered videos");
      } finally {
        if (!outDir) batchStarting = false;
      }
      if (!outDir) return;

      // The shape the export panel is currently set to — one output shape in
      // this version; the model already fans out to several. `format` is the
      // only value FormatPreset admits: the WebCodecs lane's video container
      // (.mp4, or .webm under the VP9 + alpha codec); every other panel
      // format was turned away by batchSettingsRefusal above.
      const settings = get().exportSettings;
      const res = RESOLUTIONS[settings.resIdx];
      const fmt: FormatPreset = {
        id: "primary",
        label: res.label,
        w: res.w,
        h: res.h,
        fps: settings.fps,
        mbps: settings.autoRate ? autoBitrateMbps(res.w, res.h, settings.fps) : settings.manualMbps,
        format: "mp4",
        codec: settings.codec,
      };

      // Re-read after the folder dialog: a tag scan (addBatchTracks) may have
      // committed more tracks while it was open, and freezing the pre-dialog
      // snapshot would silently drop them from the run AND the panel.
      const tracks = get().batch?.tracks ?? b.tracks;
      if (tracks.length === 0) {
        batchStarting = false;
        return;
      }
      // Freeze the template NOW: the run renders what it started with, not
      // whatever gets edited at 2am. Also makes a retry reproduce the original.
      const run: BatchRun = {
        doc: ctx.docOf(get()),
        tracks,
        formats: [fmt],
        outDir,
        // Date.now, not performance.now: the panel's countdown ticks on Date.now
        // and prints a finish time, and mixing the two epochs makes elapsed
        // (and therefore every ETA) meaningless.
        startedAt: Date.now(),
        // Freeze the loudness target with the doc — the batch must deliver what
        // the export panel promises, not silently encode at source level.
        loudness:
          settings.loudnessTarget != null
            ? { targetLufs: settings.loudnessTarget, truePeakDb: settings.truePeakDb }
            : undefined,
        // The frozen doc only carries a custom preset's ID — the defs must
        // ride along or the export worker's empty registry silently renders
        // the default visual for every job.
        customPresets: get().customDefs,
        jobs: [],
      };
      // Never overwrite a video an earlier run already finished into this
      // folder. The previous run OBJECT only remembers one run back (and dies
      // with the session), so the disk itself is the authority: every file
      // already in the folder is a spoken-for name.
      const alreadyDone = get().batch ? takenPaths(get().batch!) : new Set<string>();
      for (const n of await ctx.fileNamesInDir(outDir)) alreadyDone.add(n);
      run.jobs = expandJobs(run.tracks, run.formats, outDir, alreadyDone);

      // R2-13: the summed warn-and-override pre-flight — the failure this
      // catches is twenty individually-fine jobs that do not fit the drive
      // TOGETHER, discovered at 3am as a half-rendered queue.
      try {
        if (!(await batchDiskPreflight(run))) {
          batchStarting = false;
          return;
        }
      } catch (e) {
        // Same ACL-throw discipline as runExport's pre-flight span: a thrown
        // dialog/command must release the claim, not strand the Start button.
        batchStarting = false;
        set({ batchError: `Could not check disk space: ${(e as Error)?.message ?? String(e)}` });
        return;
      }

      const ac = new AbortController();
      batchAbort = ac;
      set({ batch: run, batchStatus: "running", batchError: null });
      try {
        await runBatch(run, runnerHooks(ac));
      } finally {
        shared.exportAbort = null;
        batchAbort = null;
        batchStarting = false;
        const cur = get().batch;
        set({
          exporting: null,
          batchStatus: cur && isRunComplete(cur) ? "done" : "idle",
        });
      }
    },

    dismissBatch() {
      if (get().batchStatus === "running") return;
      set({ batch: null, batchStatus: "idle" });
    },

    skipCurrentBatchJob() {
      // Aborts only the in-flight job; the loop moves to the next one.
      shared.exportAbort?.abort();
    },

    cancelBatch() {
      batchAbort?.abort();
      shared.exportAbort?.abort();
    },

    async retryFailedBatch() {
      const b = get().batch;
      if (!b || get().batchStatus === "running" || batchStarting) return;
      // Same single-render rule as startBatch: never race a running export.
      if (get().exporting || shared.exportStarting) {
        set({ batchError: "Finish (or cancel) the running export before retrying the batch" });
        return;
      }
      // Same gate as startBatch (F2): a retry is a run, and re-running N jobs
      // that can only fail is the exact behaviour that fix exists to remove.
      if (get().simplifiedRenderer) {
        set({ batchError: SIMPLIFIED_EXPORT_REASON });
        return;
      }
      // R2-04: batchStatus stays off "running" through the readDir and
      // pre-flight awaits below, so a double-activation passed the guard
      // above twice and launched two runs into the same folder. Claim the
      // slot synchronously — before ANY await — exactly like startBatch;
      // the outer finally releases it on every exit (decline, nothing to
      // resume, throw, run finished).
      batchStarting = true;
      try {
        // Retry names must also avoid files OTHER runs left in this folder —
        // the run object only knows its own; the disk knows them all.
        const again = retryFailed(b, Date.now(), await ctx.fileNamesInDir(b.outDir));
        // Nothing failed AND nothing queued -> nothing to resume (L19: queued
        // jobs after a cancel are picked straight up by the runner below).
        if (!again.jobs.some((j) => j.status.k === "failed" || j.status.k === "queued")) return;
        // R2-13 (review fix 3): the retry lane needs the pre-flight MOST — it
        // re-runs exactly the jobs that may have just failed on a full disk.
        // A decline leaves the store's run untouched (`again` was never
        // committed), so the panel keeps showing the done/failed state it had.
        try {
          if (!(await batchDiskPreflight(again))) return;
        } catch (e) {
          set({ batchError: `Could not check disk space: ${(e as Error)?.message ?? String(e)}` });
          return;
        }
        const ac = new AbortController();
        batchAbort = ac;
        set({ batch: again, batchStatus: "running", batchError: null });
        try {
          // Same hooks as startBatch: a retry re-decodes/re-analyses any
          // track whose failed job it just re-queued — same window, same
          // need for Skip to reach it.
          await runBatch(again, runnerHooks(ac));
        } finally {
          shared.exportAbort = null;
          batchAbort = null;
          const cur = get().batch;
          set({ exporting: null, batchStatus: cur && isRunComplete(cur) ? "done" : "idle" });
        }
      } finally {
        batchStarting = false;
      }
    },
  } satisfies Partial<VizState>;
}
