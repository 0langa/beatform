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
} from "../batch";
import { runBatch } from "../batchRunner";
import { autoBitrateMbps, RESOLUTIONS } from "../exportConfig";
import { isTauri, pickFolder } from "../platform";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";
import { shared } from "./shared";

/** Stops the whole batch; separate from the per-job controller so that
 * skipping one job never ends the night. */
let batchAbort: AbortController | null = null;
/** Claimed synchronously by startBatch, before the folder dialog awaits. */
let batchStarting = false;

export function batchActions(set: SetFn, get: GetFn, ctx: SliceCtx) {
  return {
    setShowBatch(open) {
      set({ showBatch: open });
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
      try {
        set({ batchScanning: files.length });
        for (const file of files) {
          const { meta, fromTags, coverArt, duration } = await readTrackMeta(file, file.name, {
            duration: true,
          });
          added.push({ id: newBatchId(), file, meta, metaFromTags: fromTags, coverArt, duration });
          set({ batchScanning: files.length - added.length });
        }
      } finally {
        set({ batchScanning: 0 });
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
      if (get().exporting || shared.exportStarting) {
        set({ exportError: "Finish (or cancel) the running export before starting a batch" });
        return;
      }
      if (!isTauri()) {
        set({ exportError: "Batch render needs the desktop app (it writes files to a folder)" });
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

      // The format the export panel is currently set to — one output shape in
      // this version; the model already fans out to several.
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

      const ac = new AbortController();
      batchAbort = ac;
      set({ batch: run, batchStatus: "running", exportError: null });
      try {
        await runBatch(run, {
          onJobStart: (_id, jobAc) => {
            // Reuse the single-export controller so the existing Cancel path
            // means "skip this job" for free.
            shared.exportAbort = jobAc;
          },
          onTrackStart: (_trackId, trackAc) => {
            // Same wiring as onJobStart, one level earlier: while a track is
            // still decoding/analysing (before any of its jobs exist), Skip
            // must still have something to abort, or it sits inert until
            // that finishes on its own.
            shared.exportAbort = trackAc;
          },
          onJobUpdate: (id, status) => {
            const cur = get().batch;
            if (!cur) return;
            const jobs = cur.jobs.map((j) => (j.id === id ? { ...j, status } : j));
            set({ batch: { ...cur, jobs } });
            // Mirror into `exporting` so the rest of the app already knows a
            // render is in flight: the Export button is conditionally rendered
            // on !exporting, and runExport has no re-entrancy guard, so
            // without this a click mid-batch would start a second export and
            // clobber the shared abort controller.
            set({
              exporting:
                status.k === "running"
                  ? { done: status.done, total: Math.max(1, status.total), speed: status.fps }
                  : null,
            });
          },
          shouldStop: () => ac.signal.aborted,
        });
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
      if (!b || get().batchStatus === "running") return;
      // Same single-render rule as startBatch: never race a running export.
      if (get().exporting || shared.exportStarting) {
        set({ exportError: "Finish (or cancel) the running export before retrying the batch" });
        return;
      }
      // Retry names must also avoid files OTHER runs left in this folder —
      // the run object only knows its own; the disk knows them all.
      const again = retryFailed(b, Date.now(), await ctx.fileNamesInDir(b.outDir));
      if (again.jobs.length === 0) return;
      const ac = new AbortController();
      batchAbort = ac;
      set({ batch: again, batchStatus: "running", exportError: null });
      try {
        await runBatch(again, {
          onJobStart: (_id, jobAc) => {
            shared.exportAbort = jobAc;
          },
          // A retry re-decodes/re-analyses any track whose failed job it
          // just re-queued — same window, same need for Skip to reach it.
          onTrackStart: (_trackId, trackAc) => {
            shared.exportAbort = trackAc;
          },
          onJobUpdate: (id, status) => {
            const cur = get().batch;
            if (!cur) return;
            set({
              batch: { ...cur, jobs: cur.jobs.map((j) => (j.id === id ? { ...j, status } : j)) },
              exporting:
                status.k === "running"
                  ? { done: status.done, total: Math.max(1, status.total), speed: status.fps }
                  : null,
            });
          },
          shouldStop: () => ac.signal.aborted,
        });
      } finally {
        shared.exportAbort = null;
        batchAbort = null;
        const cur = get().batch;
        set({ exporting: null, batchStatus: cur && isRunComplete(cur) ? "done" : "idle" });
      }
    },
  } satisfies Partial<VizState>;
}
