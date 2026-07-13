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
 *  out: { type: "progress", done, total }
 *  out: { type: "chunk", data, position }   — stream mode file chunks
 *  out: { type: "done", result }            — buffer transferred out if present
 *  out: { type: "error", message, name }
 */
type InMessage = { type: "start"; job: ExportJob } | { type: "abort" };

const controller = new AbortController();

self.onmessage = (e: MessageEvent<InMessage>) => {
  const msg = e.data;
  if (msg.type === "abort") {
    controller.abort();
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
