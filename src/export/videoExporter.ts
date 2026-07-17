import type { SyncSettings } from "../audio/types";
import { pcmFromAudioBuffer } from "../audio/offlineSource";
import type { BgSettings, ParamValues } from "../render/types";
import {
  runExportJob,
  type ExportCoreResult,
  type ExportJob,
  type LoudnessJob,
  type LoudnessResult,
} from "./exportCore";
import type { BeatGrid } from "../audio/analysis/beatGrid";
import type { VideoCodecId } from "./codecProbe";
import { shiftStemAnalysis, type StemEntry } from "../audio/stems";
import type { LyricLine, LyricStyle } from "../state/lyrics";
import type { PresetDef as PresetDefLike } from "../render/types";
import type { ModRoute } from "../state/modMatrix";
import type { Timeline } from "../state/timeline";
import type { MotionSettings, PostSettings } from "../render/types";

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
  /** Video codec (default "h264"). Encode lane only — pixels are identical. */
  codec?: VideoCodecId;
  /** Image background asset + baked-look params (bg.mode 3). */
  bgImage?: { dataUrl: string; dim: number; blur: number };
  /** Imported stems' envelope timelines (mod-matrix stem sources). */
  stems?: StemEntry[];
  /** Timed lyrics + style — composited onto the overlay per line, exactly
   * like the live view (same compose function, same frame keys). */
  lyrics?: { lines: LyricLine[]; style: LyricStyle };
  /** User-authored WGSL presets (registered in the worker). */
  customPresets?: PresetDefLike[];
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
  /** Post-processing chain. */
  post?: PostSettings;
  /** Global motion masters (rotation/pulse/detail). */
  motion?: MotionSettings;
  /** Track cover art (data URL) for presets that sample it. */
  coverArt?: string;
  /** Timeline in TRACK time; segment exports shift it automatically. */
  timeline?: Timeline;
  /** Per-preset param overrides for scene base resolution. */
  paramsByPreset?: Record<string, ParamValues>;
  /** Per-preset mod routes for scene mod resolution. */
  modsByPreset?: Record<string, ModRoute[]>;
  /** Desktop: stream the file here instead of building a Blob. */
  streamToPath?: string;
  /**
   * Desktop: write a PNG image sequence into this folder instead of an MP4
   * (frame_00001.png ...). Keeps alpha when the background is transparent —
   * the editorial hand-off. No audio is written; keep the original track.
   */
  pngDir?: string;
  /**
   * Receive each encoded PNG instead of (or as well as) writing to pngDir —
   * for callers without desktop fs access. Setting either selects PNG mode.
   */
  onPngFrame?: (data: Uint8Array, index: number) => void;
  /**
   * Normalize the delivered audio to a loudness target with a true-peak
   * ceiling. Audio-only: the visuals do not change, so a normalized export
   * still matches the preview frame for frame. Omit to encode at source level.
   */
  loudness?: LoudnessJob;
  onProgress?: (framesDone: number, framesTotal: number) => void;
  signal?: AbortSignal;
}

export interface ExportResult {
  /** Present unless streamToPath was used. */
  blob?: Blob;
  bytes: number;
  seconds: number;
  audioCodec: "aac" | "opus";
  /** What normalization actually did — present only when it ran. */
  loudness?: LoudnessResult;
}

interface FileWriter {
  write(data: Uint8Array, position: number): void;
  close(): Promise<void>;
  /** Best-effort cleanup of a partial file after abort/failure. */
  discard(): Promise<void>;
}

/**
 * Writes a PNG image sequence into a folder, one file per frame. Writes are
 * serialized through a promise chain (same shape as the MP4 writer) so frames
 * land in order and a failure surfaces on close().
 */
interface SequenceWriter {
  write(data: Uint8Array, index: number): void;
  close(): Promise<void>;
  discard(): Promise<void>;
}

async function createPngSequenceWriter(dir: string): Promise<SequenceWriter> {
  const { writeFile, mkdir } = await import("@tauri-apps/plugin-fs");
  await mkdir(dir, { recursive: true }).catch(() => undefined);
  let queue: Promise<void> = Promise.resolve();
  let failed: Error | null = null;
  const written: string[] = [];
  return {
    write(data, index) {
      queue = queue.then(async () => {
        if (failed) return;
        const name = `frame_${String(index + 1).padStart(5, "0")}.png`;
        const path = `${dir}/${name}`;
        try {
          await writeFile(path, data);
          written.push(path);
        } catch (e) {
          failed = e as Error;
        }
      });
    },
    async close() {
      await queue;
      if (failed) throw failed;
    },
    async discard() {
      await queue.catch(() => undefined);
      const { remove } = await import("@tauri-apps/plugin-fs");
      for (const p of written) await remove(p).catch(() => undefined);
    },
  };
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

function toResult(core: ExportCoreResult, codec?: VideoCodecId): ExportResult {
  return {
    blob: core.buffer
      ? new Blob([core.buffer], { type: codec === "vp9a" ? "video/webm" : "video/mp4" })
      : undefined,
    bytes: core.bytes,
    seconds: core.seconds,
    audioCodec: core.audioCodec,
    loudness: core.loudness,
  };
}

export async function exportVideo(audio: AudioBuffer, o: ExportOptions): Promise<ExportResult> {
  // An already-aborted signal must not start work: runInWorker only listens for
  // a future "abort" event, which never fires for a signal aborted before the
  // call, so the whole job would render and only then be thrown away.
  if (o.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
  const isPng = !!(o.pngDir || o.onPngFrame);
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
    codec: o.codec,
    presetId: o.presetId,
    params: o.params,
    bg: o.bg,
    sync: o.sync,
    overlay: o.overlay,
    mods: o.mods,
    smoothSpectrum: o.smoothSpectrum,
    post: o.post,
    motion: o.motion,
    coverArt: o.coverArt,
    bgImage: o.bgImage,
    // Segment exports (Canvas loops) slice the audio, so the stems' t=0 must
    // move with it — same treatment as beatGrid/timeline below. Unshifted
    // stems would modulate the loop with envelopes from the track's start.
    stems:
      o.stems && o.segment
        ? o.stems.map((s) => ({
            ...s,
            analysis: shiftStemAnalysis(s.analysis, o.segment!.start),
          }))
        : o.stems,
    // Lyrics are timed in TRACK time; segment exports shift them like the
    // beat grid and timeline so the right line shows over the right beat.
    lyrics:
      o.lyrics && o.segment
        ? {
            ...o.lyrics,
            lines: o.lyrics.lines.map((l) => ({
              ...l,
              t: l.t - o.segment!.start,
              end: l.end === null ? null : l.end - o.segment!.start,
            })),
          }
        : o.lyrics,
    customPresets: o.customPresets,
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
    mode: isPng ? "png" : o.streamToPath ? "stream" : "buffer",
    loudness: o.loudness,
  });

  const writer = o.streamToPath && !isPng ? await createTauriWriter(o.streamToPath) : null;
  const pngWriter = o.pngDir ? await createPngSequenceWriter(o.pngDir) : null;
  // Frames go to the folder writer and/or the caller's sink.
  const onFrame = isPng
    ? (data: Uint8Array, index: number) => {
        pngWriter?.write(data, index);
        o.onPngFrame?.(data, index);
      }
    : undefined;
  try {
    let result: ExportCoreResult;
    if (typeof Worker === "undefined") {
      result = await runInline(buildJob(buildPcm()), o, writer, onFrame);
    } else {
      try {
        result = await runInWorker(buildJob(buildPcm()), o, writer, onFrame);
      } catch (e) {
        // A worker may lack WebGPU where the main thread has it (older
        // WebView2). The worker run transferred (detached) its job's PCM, so
        // the inline fallback gets a FRESH job with fresh copies.
        if ((e as Error).message.startsWith("__fallback__")) {
          result = await runInline(buildJob(buildPcm()), o, writer, onFrame);
        } else {
          throw e;
        }
      }
    }
    await writer?.close();
    await pngWriter?.close();
    return toResult(result, o.codec);
  } catch (e) {
    await writer?.discard();
    await pngWriter?.discard();
    throw e;
  }
}

async function runInline(
  job: ExportJob,
  o: ExportOptions,
  writer: FileWriter | null,
  onFrame: ((data: Uint8Array, index: number) => void) | undefined,
): Promise<ExportCoreResult> {
  return runExportJob(job, {
    signal: o.signal,
    onProgress: o.onProgress,
    onChunk: writer ? (data, position) => writer.write(data, position) : undefined,
    onFrame,
  });
}

function runInWorker(
  job: ExportJob,
  o: ExportOptions,
  writer: FileWriter | null,
  onFrame: ((data: Uint8Array, index: number) => void) | undefined,
): Promise<ExportCoreResult> {
  const worker = new Worker(new URL("./exportWorker.ts", import.meta.url), {
    type: "module",
  });
  const onAbort = () => worker.postMessage({ type: "abort" });
  // Falling back means re-running the whole job inline, over a file the worker
  // may already have written into. Once a single byte is out, a failure is a
  // real failure — retrying would append a second pass onto the first one's
  // bytes (the writer only truncates at open()) and hand back a corrupt file.
  let wroteAnything = false;

  return new Promise<ExportCoreResult>((resolve, reject) => {
    o.signal?.addEventListener("abort", onAbort);

    worker.onerror = () => {
      // Fires for any uncaught worker error, including one 90% into a job —
      // only a start-up failure is safe to retry inline.
      reject(
        wroteAnything
          ? new Error("Export worker crashed mid-render")
          : new Error("__fallback__ worker failed to start"),
      );
    };
    worker.onmessage = (
      e: MessageEvent<
        | { type: "progress"; done: number; total: number }
        | { type: "chunk"; data: Uint8Array; position: number }
        | { type: "frame"; data: Uint8Array; index: number }
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
          wroteAnything = true;
          writer?.write(msg.data, msg.position);
          break;
        case "frame":
          wroteAnything = true;
          onFrame?.(msg.data, msg.index);
          break;
        case "done":
          resolve(msg.result);
          break;
        case "error":
          if (msg.name === "AbortError") {
            reject(new DOMException(msg.message, "AbortError"));
          } else if (msg.name === "GpuInitError" && !wroteAnything) {
            // No GPU in the worker at all — the inline path may still have one.
            reject(new Error("__fallback__ no WebGPU in worker"));
          } else {
            // Keep the name: it is what lets callers tell a cancel from a
            // device loss from a disk failure. Dropping it made every
            // downstream classification dead code on the path that runs.
            const err = new Error(msg.message);
            err.name = msg.name;
            reject(err);
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
