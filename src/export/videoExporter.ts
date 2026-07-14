import type { SyncSettings } from "../audio/types";
import { pcmFromAudioBuffer } from "../audio/offlineSource";
import type { BgSettings, ParamValues } from "../render/types";
import { runExportJob, type ExportCoreResult, type ExportJob } from "./exportCore";
import type { BeatGrid } from "../audio/analysis/beatGrid";
import type { ModRoute } from "../state/modMatrix";
import type { Timeline } from "../state/timeline";

/**
 * Main-thread export API. Spawns the export worker (UI stays fluid), falls
 * back to running the pipeline inline where workers can't (no Worker at all,
 * or WebGPU unavailable in workers but available here).
 *
 * Output goes one of two ways:
 *  - streamToPath set (desktop): fragmented MP4 streamed straight to disk via
 *    the Tauri fs plugin — memory stays flat for hour-long exports; no Blob.
 *  - otherwise (browser dev): classic in-memory fastStart MP4 Blob.
 */
export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  /** Video bitrate, bits/second */
  bitrate: number;
  presetId: string;
  params: ParamValues;
  bg: BgSettings;
  /** Sync-source selection — same values as the live view for WYSIWYG */
  sync?: SyncSettings;
  /** Pre-rasterized overlay (text/logo) at output size. */
  overlay?: ImageBitmap;
  /** Export only this slice of the track (seconds). Canvas loop mode. */
  segment?: { start: number; duration: number };
  /** Seamless-loop crossfade in seconds (blends tail into head). */
  loopCrossfadeSec?: number;
  /** Beat grid in TRACK time; segment exports shift it automatically. */
  beatGrid?: BeatGrid;
  /** Modulation routes for the active preset. */
  mods?: ModRoute[];
  /** Spline-connected spectrum sampling toggle. */
  smoothSpectrum?: boolean;
  /** Timeline in TRACK time; segment exports shift it automatically. */
  timeline?: Timeline;
  /** Per-preset param overrides for scene base resolution. */
  paramsByPreset?: Record<string, ParamValues>;
  /** Per-preset mod routes for scene mod resolution. */
  modsByPreset?: Record<string, ModRoute[]>;
  /** Desktop: stream the file here instead of building a Blob. */
  streamToPath?: string;
  onProgress?: (framesDone: number, framesTotal: number) => void;
  signal?: AbortSignal;
}

export interface ExportResult {
  /** Present unless streamToPath was used. */
  blob?: Blob;
  bytes: number;
  seconds: number;
  audioCodec: "aac" | "opus";
}

interface FileWriter {
  write(data: Uint8Array, position: number): void;
  close(): Promise<void>;
  /** Best-effort cleanup of a partial file after abort/failure. */
  discard(): Promise<void>;
}

async function createTauriWriter(path: string): Promise<FileWriter> {
  const { open, remove, SeekMode } = await import("@tauri-apps/plugin-fs");
  const handle = await open(path, { write: true, create: true, truncate: true });
  let queue: Promise<void> = Promise.resolve();
  let cursor = 0;
  let failed: Error | null = null;

  return {
    write(data, position) {
      queue = queue.then(async () => {
        if (failed) return;
        try {
          if (position !== cursor) {
            await handle.seek(position, SeekMode.Start);
            cursor = position;
          }
          let off = 0;
          while (off < data.length) {
            const n = await handle.write(data.subarray(off));
            if (!n) throw new Error("file write stalled");
            off += n;
          }
          cursor = position + data.length;
        } catch (e) {
          failed = e as Error;
        }
      });
    },
    async close() {
      await queue;
      await handle.close();
      if (failed) throw failed;
    },
    async discard() {
      await queue.catch(() => undefined);
      await handle.close().catch(() => undefined);
      await remove(path).catch(() => undefined);
    },
  };
}

function toResult(core: ExportCoreResult): ExportResult {
  return {
    blob: core.buffer ? new Blob([core.buffer], { type: "video/mp4" }) : undefined,
    bytes: core.bytes,
    seconds: core.seconds,
    audioCodec: core.audioCodec,
  };
}

export async function exportVideo(audio: AudioBuffer, o: ExportOptions): Promise<ExportResult> {
  const full = pcmFromAudioBuffer(audio);
  // Segment slice (Canvas loop mode). Always COPY: transferring the engine's
  // live channel data to the worker would detach it. buildPcm() is called
  // per-attempt so the worker path and any inline fallback each get their own
  // fresh, transferable copy (the worker transfer neuters the buffers).
  const s0 = o.segment ? Math.max(0, Math.floor(o.segment.start * full.sampleRate)) : 0;
  const s1 = o.segment
    ? Math.min(full.length, s0 + Math.floor(o.segment.duration * full.sampleRate))
    : full.length;
  if (s1 - s0 <= 0) throw new Error("Nothing to export: the audio segment is empty");
  const buildPcm = () => ({
    sampleRate: full.sampleRate,
    length: s1 - s0,
    duration: (s1 - s0) / full.sampleRate,
    channels: full.channels.slice(0, 2).map((c) => c.slice(s0, s1)),
  });

  const buildJob = (pcm: ExportJob["pcm"]): ExportJob => ({
    pcm,
    width: o.width,
    height: o.height,
    fps: o.fps,
    bitrate: o.bitrate,
    presetId: o.presetId,
    params: o.params,
    bg: o.bg,
    sync: o.sync,
    overlay: o.overlay,
    mods: o.mods,
    smoothSpectrum: o.smoothSpectrum,
    paramsByPreset: o.paramsByPreset,
    modsByPreset: o.modsByPreset,
    timeline:
      o.timeline && o.segment
        ? {
            ...o.timeline,
            scenes: o.timeline.scenes.map((s) => ({ ...s, start: s.start - o.segment!.start })),
            lanes: o.timeline.lanes.map((l) => ({
              ...l,
              keyframes: l.keyframes.map((k) => ({ ...k, t: k.t - o.segment!.start })),
            })),
          }
        : o.timeline,
    loopCrossfadeSec: o.loopCrossfadeSec,
    beatGrid:
      o.beatGrid && o.segment
        ? { ...o.beatGrid, beatTimes: o.beatGrid.beatTimes.map((t) => t - o.segment!.start) }
        : o.beatGrid,
    mode: o.streamToPath ? "stream" : "buffer",
  });

  const writer = o.streamToPath ? await createTauriWriter(o.streamToPath) : null;
  try {
    let result: ExportCoreResult;
    if (typeof Worker === "undefined") {
      result = await runInline(buildJob(buildPcm()), o, writer);
    } else {
      try {
        result = await runInWorker(buildJob(buildPcm()), o, writer);
      } catch (e) {
        // A worker may lack WebGPU where the main thread has it (older
        // WebView2). The worker run transferred (detached) its job's PCM, so
        // the inline fallback gets a FRESH job with fresh copies.
        if ((e as Error).message.startsWith("__fallback__")) {
          result = await runInline(buildJob(buildPcm()), o, writer);
        } else {
          throw e;
        }
      }
    }
    await writer?.close();
    return toResult(result);
  } catch (e) {
    await writer?.discard();
    throw e;
  }
}

async function runInline(
  job: ExportJob,
  o: ExportOptions,
  writer: FileWriter | null,
): Promise<ExportCoreResult> {
  return runExportJob(job, {
    signal: o.signal,
    onProgress: o.onProgress,
    onChunk: writer ? (data, position) => writer.write(data, position) : undefined,
  });
}

function runInWorker(
  job: ExportJob,
  o: ExportOptions,
  writer: FileWriter | null,
): Promise<ExportCoreResult> {
  const worker = new Worker(new URL("./exportWorker.ts", import.meta.url), {
    type: "module",
  });
  const onAbort = () => worker.postMessage({ type: "abort" });

  return new Promise<ExportCoreResult>((resolve, reject) => {
    o.signal?.addEventListener("abort", onAbort);

    worker.onerror = () => {
      // Worker script failed to load/start — retry inline.
      reject(new Error("__fallback__ worker failed to start"));
    };
    worker.onmessage = (
      e: MessageEvent<
        | { type: "progress"; done: number; total: number }
        | { type: "chunk"; data: Uint8Array; position: number }
        | { type: "done"; result: ExportCoreResult }
        | { type: "error"; message: string; name: string }
      >,
    ) => {
      const msg = e.data;
      switch (msg.type) {
        case "progress":
          o.onProgress?.(msg.done, msg.total);
          break;
        case "chunk":
          writer?.write(msg.data, msg.position);
          break;
        case "done":
          resolve(msg.result);
          break;
        case "error":
          if (msg.name === "AbortError") {
            reject(new DOMException(msg.message, "AbortError"));
          } else if (msg.message.includes("requires WebGPU")) {
            reject(new Error("__fallback__ no WebGPU in worker"));
          } else {
            reject(new Error(msg.message));
          }
          break;
      }
    };

    // Transfer only the big PCM buffers. The overlay ImageBitmap is left OUT
    // of the transfer list so it is structured-CLONED to the worker and the
    // main-thread copy survives for a possible inline fallback.
    const transfers: Transferable[] = job.pcm.channels.map((c) => c.buffer);
    worker.postMessage({ type: "start", job }, transfers);
  }).finally(() => {
    o.signal?.removeEventListener("abort", onAbort);
    worker.terminate();
  });
}
