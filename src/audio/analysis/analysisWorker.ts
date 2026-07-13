/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import { analyzeBeatGrid } from "./beatGrid";
import { estimateKey } from "./keyDetect";
import type { PcmData } from "../types";

/**
 * Track-analysis worker: runs the offline analysis pass (beat grid now;
 * onset classes / key / sections join it in later phases) without touching
 * the main thread. One job per message; results post back tagged.
 */
type InMessage = { type: "analyze"; id: number; pcm: PcmData };

self.onmessage = (e: MessageEvent<InMessage>) => {
  const msg = e.data;
  if (msg.type !== "analyze") return;
  try {
    const grid = analyzeBeatGrid(msg.pcm);
    // Key runs on a mono mixdown; cheap and keeps the analyses independent
    const mono = new Float32Array(msg.pcm.length);
    for (const data of msg.pcm.channels) {
      for (let i = 0; i < data.length; i++) mono[i] += data[i];
    }
    if (msg.pcm.channels.length > 1) {
      const g = 1 / msg.pcm.channels.length;
      for (let i = 0; i < mono.length; i++) mono[i] *= g;
    }
    const key = estimateKey(mono, msg.pcm.sampleRate);
    self.postMessage({ type: "analysis", id: msg.id, grid, key }, [grid.beatTimes.buffer]);
  } catch (err) {
    self.postMessage({ type: "error", id: msg.id, message: (err as Error).message });
  }
};
