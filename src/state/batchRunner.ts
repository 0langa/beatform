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

export async function runBatch(run: BatchRun, hooks: BatchRunnerHooks): Promise<void> {
  // The preview would otherwise keep drawing a canvas nobody is watching,
  // competing with the export for the same GPU all night.
  setLiveRenderPaused(true);
  try {
    for (const track of run.tracks) {
      if (hooks.shouldStop()) break;
      const jobs = run.jobs.filter((j) => j.trackId === track.id && j.status.k === "queued");
      if (jobs.length === 0) continue;

      // Decode + analyse ONCE per track, shared by that track's format jobs.
      // Safe to share: buildPcm() inside exportVideo always copies, so the
      // source AudioBuffer is never detached or mutated by a job.
      let buf: AudioBuffer;
      let grid: Awaited<ReturnType<typeof analyzeTrack>["result"]>["grid"];
      try {
        // Decode on the engine's context, NOT a fresh OfflineAudioContext:
        // decodeAudioData resamples to the context rate, so decoding at 44.1k
        // while the preview runs at 48k would shift every FFT bin, feature and
        // LUFS reading — a determinism break that reports no error at all.
        buf = await getEngine().ctx.decodeAudioData(await track.file.arrayBuffer());
        // Per-track analysis is not optional: without it every track after the
        // first renders against track 1's beat grid and is silently off-beat.
        // Note analyzeTrack returns { id, result } — it is not awaitable itself.
        const { result } = analyzeTrack(buf);
        grid = (await result).grid;
      } catch (e) {
        // A file that cannot be decoded fails its jobs and nothing else.
        const c = classifyError(e);
        for (const job of jobs) {
          hooks.onJobUpdate(job.id, c ? { k: "failed", ...c } : { k: "skipped" });
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
          hooks.onJobUpdate(job.id, { k: "skipped" });
          continue;
        }
        hooks.onJobUpdate(job.id, {
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
                  hooks.onJobUpdate(job.id, {
                    k: "running",
                    done,
                    total,
                    fps: done > 0 && secs > 0 ? done / secs : null,
                  });
                },
              },
            ),
          );
          hooks.onJobUpdate(job.id, {
            k: "done",
            bytes: result.bytes,
            path: job.outPath,
          });
        } catch (e) {
          // Deliberately swallowed: one job's failure is one job's failure.
          // An abort means the user hit Skip — record that, not a red error.
          const c = classifyError(e);
          hooks.onJobUpdate(job.id, c ? { k: "failed", ...c } : { k: "skipped" });
        } finally {
          // 20 full-res bitmaps would otherwise pile up over a night. close()
          // on an already-detached bitmap is a no-op, so this is safe even
          // when the inline path already closed it.
          overlay?.close();
        }
      }
    }
  } finally {
    setLiveRenderPaused(false);
  }
}
