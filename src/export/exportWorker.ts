/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import { runExportJob, type ExportJob } from "./exportCore";

/**
 * Export worker: runs the whole render+encode+mux pipeline off the main
 * thread so the UI stays fluid during long or 4K exports.
 *
 * Protocol (all messages tagged by `type`):
 *  in:  { type: "start", job: ExportJob }   — begin (channels transferred in)
 *  in:  { type: "abort" }                   — cancel
 *  in:  { type: "frameAck" }                — png mode: main thread wrote a frame
 *  in:  { type: "rawFrameAck" }             — deep mode: main thread wrote a raw frame
 *  in:  { type: "chunkAck" }                — stream mode: main thread wrote a chunk
 *  out: { type: "progress", done, total }
 *  out: { type: "chunk", data, position }   — stream mode file chunks
 *  out: { type: "frame", data, index }      — png mode: one encoded PNG/frame
 *  out: { type: "rawFrame", data }          — deep mode: one rgba64le u16 frame
 *  out: { type: "done", result }            — buffer transferred out if present
 *  out: { type: "error", message, name }
 *
 * The frame/frameAck and chunk/chunkAck pairs are flow control. The PNG lane
 * (PNG sequence, ProRes, GIF, WebP) has no encoder queue to backpressure on,
 * and the ffmpeg sidecar is usually slower than the GPU render — so without an
 * ack the worker would post frames faster than the main thread could write them
 * and the backlog would grow by hundreds of MB/s at 4K. The stream lane has the
 * same hole with a slower fuse: postMessage hands the chunk off and returns, so
 * the encoders ran at GPU speed while every chunk the Tauri fs IPC had not
 * flushed stayed live on the main thread (~16 MiB apiece — the whole bitstream
 * for a 2-hour export). Both hooks return a promise that settles on the ack,
 * and the core awaits them, so the render is paced by the disk.
 */
type InMessage =
  | { type: "start"; job: ExportJob }
  | { type: "abort" }
  | { type: "frameAck" }
  | { type: "rawFrameAck" }
  | { type: "chunkAck" };

const controller = new AbortController();

/** Resolver for the frame the main thread is currently writing (png mode). */
let pendingFrameAck: (() => void) | null = null;
/** Resolver for the deep-colour raw frame in flight (rgba64le lane). */
let pendingRawAck: (() => void) | null = null;
/** Resolver for the file chunk the main thread is currently writing (stream). */
let pendingChunkAck: (() => void) | null = null;

self.onmessage = (e: MessageEvent<InMessage>) => {
  const msg = e.data;
  if (msg.type === "abort") {
    controller.abort();
    // Don't strand the render on an ack that will never come.
    pendingFrameAck?.();
    pendingFrameAck = null;
    pendingRawAck?.();
    pendingRawAck = null;
    pendingChunkAck?.();
    pendingChunkAck = null;
    return;
  }
  if (msg.type === "frameAck") {
    pendingFrameAck?.();
    pendingFrameAck = null;
    return;
  }
  if (msg.type === "rawFrameAck") {
    pendingRawAck?.();
    pendingRawAck = null;
    return;
  }
  if (msg.type === "chunkAck") {
    pendingChunkAck?.();
    pendingChunkAck = null;
    return;
  }
  if (msg.type === "start") {
    void run(msg.job);
  }
};

async function run(job: ExportJob): Promise<void> {
  try {
    const result = await runExportJob(job, {
      signal: controller.signal,
      onProgress: (done, total) => {
        self.postMessage({ type: "progress", done, total });
      },
      onChunk: (data, position) => {
        // Copy out of the muxer's internal chunk buffer before transferring
        const copy = new Uint8Array(data);
        self.postMessage({ type: "chunk", data: copy, position }, [copy.buffer]);
        // Then wait for the main thread to land it on disk. The core awaits
        // this, mediabunny's StreamTarget propagates it into the encoders, so
        // only ONE chunk is ever in flight instead of an unbounded backlog.
        return new Promise<void>((resolve) => {
          pendingChunkAck = resolve;
        });
      },
      onFrame: (data, index) => {
        // Already a fresh array per frame — transfer it straight out, then
        // wait for the main thread to finish writing it (see the protocol
        // note above). The core awaits this, which paces the render.
        self.postMessage({ type: "frame", data, index }, [data.buffer]);
        return new Promise<void>((resolve) => {
          pendingFrameAck = resolve;
        });
      },
      // Deep-colour lane: same flow control as frame/frameAck — one ~16 MB
      // (1080p) rgba64le frame in flight, transferred not copied, and the
      // core's await pins the render to the ffmpeg sidecar's pace.
      onRawFrame: (data) => {
        self.postMessage({ type: "rawFrame", data }, [data.buffer]);
        return new Promise<void>((resolve) => {
          pendingRawAck = resolve;
        });
      },
    });
    if (result.buffer) {
      self.postMessage({ type: "done", result }, [result.buffer]);
    } else {
      self.postMessage({ type: "done", result });
    }
  } catch (err) {
    const e = err as Error;
    self.postMessage({ type: "error", message: e.message, name: e.name });
  }
}
