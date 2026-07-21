import { exportVideo } from "../export/videoExporter";
import { buildExportOptions } from "../export/buildExportOptions";
import { rasterizeOverlay } from "../render/overlay";
import { analyzeTrack } from "../audio/analysis/trackAnalysis";
import { getEngine, setLiveRenderPaused } from "./services";
import { classifyError, type BatchRun, type JobStatus } from "./batch";

/**
 * The batch runner: a for-loop with per-job isolation.
 *
 * exportVideo is already a pure one-shot — no handle, no context, nothing to
 * keep warm — so a batch is genuinely just iteration. The value here is not
 * machinery, it is what the loop refuses to do:
 *
 * - **One job at a time.** Each export builds its own GPU device and encoder
 *   session; running two would mean two of everything for no throughput on a
 *   single GPU.
 * - **A fresh AbortController per job**, never a shared signal — sharing one
 *   would make cancelling a single job cancel the rest of the night.
 * - **The catch never rethrows.** Job 7 failing must cost job 7, not jobs
 *   8-20. That is the entire promise of unattended batch.
 * - **No worker reuse.** exportVideo terminates its worker per job, which is
 *   exactly what stops a poisoned job from infecting the next one.
 */

export interface BatchRunnerHooks {
  /** Status transition for one job — the store mirrors this into React state. */
  onJobUpdate(jobId: string, status: JobStatus): void;
  /** Hands out the in-flight job's controller so "skip this job" can work. */
  onJobStart(jobId: string, ac: AbortController): void;
  /**
   * Hands out a controller for the per-track decode+analysis window, BEFORE
   * any job for this track exists — so "skip this job" also has something to
   * abort while its track is still decoding/analysing, not just once it's
   * actually rendering. Optional: without it, that window is only ever
   * interrupted by a full batch cancel (shouldStop) or the analysis timeout.
   */
  onTrackStart?(trackId: string, ac: AbortController): void;
  /** True once the whole run should stop (batch cancel). */
  shouldStop(): boolean;
  /**
   * Where a job's bytes go. Defaults to streaming to the job's own path, which
   * is what keeps memory flat across a long run. Where a job's output goes is
   * the caller's business rather than the loop's, which also lets the loop be
   * exercised without a filesystem.
   */
  streamPathFor?(outPath: string): string | undefined;
}

/**
 * How long decode + analysis may run (each) before a track is treated as
 * hung and its jobs failed rather than left blocking the batch forever.
 *
 * This is a LIVENESS net, not a performance budget. It exists for the one
 * case trackAnalysis.ts cannot bound itself — analyzeTrack's promise has no
 * rejection path for a worker that simply never replies — so the only job of
 * this number is to turn "blocks forever" into "fails visibly". Being
 * generous costs nothing; being tight turns a slow machine into a false
 * failure on work that would have completed.
 *
 * Sized against a measurement rather than a guess: analysis of the 120 BPM
 * demo ran at 2.22 ms per audio-second, which projects to ~16 s for a 2 h
 * mix (the longest input TESTING.md asks anyone to try). Five minutes is
 * ~19x that projection, leaving room for a much slower machine, a much
 * denser track, and the separate decode of a multi-hour file — while still
 * being far short of "the user gave up and killed the app".
 */
export const ANALYSIS_TIMEOUT_MS = 300_000;

/** Poll interval for noticing a cancel/skip while decode or analysis is in
 * flight. */
const STOP_POLL_MS = 150;

/**
 * Race a promise against the batch (or this one track) being stopped, and
 * against a timeout. Neither decodeAudioData nor analyzeTrack expose a way
 * to actually interrupt in-flight work once started, so this can't cancel
 * the underlying decode/analysis — but it stops the LOOP from blocking on
 * it, which is what makes Cancel/Skip responsive during that window instead
 * of inert, and turns a hung analysis worker into a real, visible per-track
 * failure instead of a permanent stall.
 */
function raceAgainstStop<T>(promise: Promise<T>, isStopped: () => boolean): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      fn();
    };
    const poll = setInterval(() => {
      if (isStopped()) {
        finish(() => {
          const abort = new Error("Batch cancelled");
          abort.name = "AbortError";
          reject(abort);
        });
      }
    }, STOP_POLL_MS);
    const timer = setTimeout(() => {
      finish(() =>
        reject(new Error(`Track analysis did not respond within ${ANALYSIS_TIMEOUT_MS / 1000}s`)),
      );
    }, ANALYSIS_TIMEOUT_MS);
    promise.then(
      (v) => finish(() => resolve(v)),
      (e) => finish(() => reject(e as Error)),
    );
  });
}

export async function runBatch(run: BatchRun, hooks: BatchRunnerHooks): Promise<void> {
  // The preview would otherwise keep drawing a canvas nobody is watching,
  // competing with the export for the same GPU all night.
  setLiveRenderPaused(true);
  // run.jobs is a frozen snapshot — nothing in this function ever writes a
  // new status back into it, only OUT through onJobUpdate (the store keeps
  // the live copy). So a job's entry here always still reads "queued" even
  // after it's been driven to done/failed/skipped this run; the ONLY way to
  // tell "reached" from "never reached" from in here is to track it
  // ourselves. See the sweep in `finally` below.
  const touched = new Set<string>();
  const updateJob = (jobId: string, status: JobStatus) => {
    touched.add(jobId);
    hooks.onJobUpdate(jobId, status);
  };
  try {
    for (const track of run.tracks) {
      if (hooks.shouldStop()) break;
      const jobs = run.jobs.filter((j) => j.trackId === track.id && j.status.k === "queued");
      if (jobs.length === 0) continue;

      // Decode + analyse ONCE per track, shared by that track's format jobs.
      // Safe to share: buildPcm() inside exportVideo always copies, so the
      // source AudioBuffer is never detached or mutated by a job.
      //
      // This window has no job yet (jobs are per-format, decode is per-track),
      // so it gets its own controller: shouldStop() alone only covers a full
      // batch cancel, and neither decodeAudioData nor analyzeTrack take a
      // signal of their own — raceAgainstStop can't cancel the underlying
      // work, but it stops the loop waiting on it, which is what makes
      // Cancel/Skip feel responsive instead of inert during this window, and
      // bounds a hung analysis worker that would otherwise never reply.
      const trackAc = new AbortController();
      hooks.onTrackStart?.(track.id, trackAc);
      const isStopped = () => hooks.shouldStop() || trackAc.signal.aborted;

      let buf: AudioBuffer;
      let grid: Awaited<ReturnType<typeof analyzeTrack>["result"]>["grid"];
      try {
        // Decode on the engine's context, NOT a fresh OfflineAudioContext:
        // decodeAudioData resamples to the context rate, so decoding at 44.1k
        // while the preview runs at 48k would shift every FFT bin, feature and
        // LUFS reading — a determinism break that reports no error at all.
        buf = await raceAgainstStop(
          (async () => getEngine().ctx.decodeAudioData(await track.file.arrayBuffer()))(),
          isStopped,
        );
        // Per-track analysis is not optional: without it every track after the
        // first renders against track 1's beat grid and is silently off-beat.
        // Note analyzeTrack returns { id, result } — it is not awaitable itself.
        const { result } = analyzeTrack(buf);
        grid = (await raceAgainstStop(result, isStopped)).grid;
      } catch (e) {
        // A file that cannot be decoded fails its jobs and nothing else.
        // classifyError maps our own AbortError the same way it maps a real
        // user cancel: null -> "skipped", not a red failure.
        const c = classifyError(e);
        for (const job of jobs) {
          updateJob(job.id, c ? { k: "failed", ...c } : { k: "skipped" });
        }
        continue;
      }

      for (const job of jobs) {
        if (hooks.shouldStop()) return;
        const fmt = run.formats.find((f) => f.id === job.formatId);
        if (!fmt) continue;

        const ac = new AbortController();
        hooks.onJobStart(job.id, ac);
        // Skip can be pressed during the decode/analysis window above, before
        // this job's controller existed — honour it rather than rendering the
        // track the user just asked to pass over.
        if (ac.signal.aborted) {
          updateJob(job.id, { k: "skipped" });
          continue;
        }
        updateJob(job.id, {
          k: "running",
          done: 0,
          total: job.totalFrames ?? 0,
          fps: null,
        });

        // Re-rasterized per job: it depends on BOTH this track's title and this
        // format's resolution.
        let overlay: ImageBitmap | undefined;
        const startedAt = performance.now();
        try {
          overlay =
            (await rasterizeOverlay(
              run.doc.overlayLayers,
              run.doc.assets,
              fmt.w,
              fmt.h,
              track.meta,
            )) ?? undefined;

          const result = await exportVideo(
            buf,
            buildExportOptions(
              run.doc,
              fmt,
              {
                name: track.file.name,
                meta: track.meta,
                coverArt: track.coverArt,
                beatGrid: grid,
                // Frozen with the run: without the defs, a custom-preset doc
                // resolves to the default visual inside the worker's empty
                // registry and every job silently renders the wrong thing.
                customPresets: run.customPresets,
              },
              overlay,
              {
                streamToPath: hooks.streamPathFor ? hooks.streamPathFor(job.outPath) : job.outPath,
                // Frozen with the doc at Start. Without this the batch quietly
                // ignored the loudness target the export panel was showing.
                loudness: run.loudness,
                signal: ac.signal,
                onProgress: (done, total) => {
                  const secs = (performance.now() - startedAt) / 1000;
                  updateJob(job.id, {
                    k: "running",
                    done,
                    total,
                    fps: done > 0 && secs > 0 ? done / secs : null,
                  });
                },
              },
            ),
          );
          updateJob(job.id, {
            k: "done",
            bytes: result.bytes,
            path: job.outPath,
          });
        } catch (e) {
          // Deliberately swallowed: one job's failure is one job's failure.
          // An abort means the user hit Skip — record that, not a red error.
          const c = classifyError(e);
          updateJob(job.id, c ? { k: "failed", ...c } : { k: "skipped" });
        } finally {
          // 20 full-res bitmaps would otherwise pile up over a night. close()
          // on an already-detached bitmap is a no-op, so this is safe even
          // when the inline path already closed it.
          overlay?.close();
        }
      }
    }
  } finally {
    // A cancel (or a mid-track Skip whose track had more than one format job)
    // exits the loops above via `break`/`return` the instant shouldStop()
    // flips — so a track further down the list, or a later format job on
    // the CURRENT track, can be left behind never having been reached at
    // all. isRunComplete (batch.ts) requires every job to be in a terminal
    // state, so one straggler silently capped batchStatus at "idle" forever
    // (never "done"), and retryFailed only ever re-queues "failed" jobs —
    // an untouched "queued" job was invisible to it too, so there was no
    // path back to this work at all. "skipped" is the correct terminal
    // state: nothing went wrong, the user asked to stop.
    //
    // job.status.k === "queued" here means "queued when THIS run started"
    // (run.jobs is never mutated in place — see `touched` above), so it's
    // paired with `!touched.has` to exclude jobs this run actually reached
    // and already resolved to done/failed/skipped through updateJob.
    for (const job of run.jobs) {
      if (job.status.k === "queued" && !touched.has(job.id)) {
        hooks.onJobUpdate(job.id, { k: "skipped" });
      }
    }
    setLiveRenderPaused(false);
  }
}
