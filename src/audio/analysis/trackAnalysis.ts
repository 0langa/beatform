import type { BeatGrid } from "./beatGrid";
import { analyzeBeatGrid } from "./beatGrid";
import { estimateKey, type KeyEstimate } from "./keyDetect";
import type { PcmData } from "../types";
import { pcmFromAudioBuffer } from "../offlineSource";

/**
 * Main-thread facade for the analysis worker. One worker, jobs tagged with
 * a monotonically increasing id — a newly loaded track invalidates any
 * in-flight result (the stale id is simply ignored by the caller).
 */
export interface TrackAnalysis {
  grid: BeatGrid | null;
  key: KeyEstimate | null;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (result: TrackAnalysis) => void>();

function ensureWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (!worker) {
    worker = new Worker(new URL("./analysisWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (
      e: MessageEvent<
        | { type: "analysis"; id: number; grid: BeatGrid; key: KeyEstimate | null }
        | { type: "error"; id: number; message: string }
      >,
    ) => {
      const msg = e.data;
      const resolve = pending.get(msg.id);
      if (!resolve) return;
      pending.delete(msg.id);
      if (msg.type === "analysis") resolve({ grid: msg.grid, key: msg.key });
      else {
        console.error("[analysis]", msg.message);
        resolve({ grid: null, key: null });
      }
    };
    worker.onerror = () => {
      // Worker failed to boot — resolve everything null; callers fall back
      for (const resolve of pending.values()) resolve({ grid: null, key: null });
      pending.clear();
    };
  }
  return worker;
}

/** Analyze a decoded track. Fields resolve null on failure (callers degrade). */
export function analyzeTrack(audio: AudioBuffer): { id: number; result: Promise<TrackAnalysis> } {
  const id = nextId++;
  const pcm = pcmFromAudioBuffer(audio);
  // Copies — the worker transfer must not detach the engine's live buffer
  const copy: PcmData = { ...pcm, channels: pcm.channels.slice(0, 2).map((c) => c.slice()) };
  const w = ensureWorker();
  if (!w) {
    // No workers (rare) — run inline rather than not at all
    return {
      id,
      result: Promise.resolve().then(() => {
        try {
          const mono = copy.channels[0];
          return { grid: analyzeBeatGrid(copy), key: estimateKey(mono, copy.sampleRate) };
        } catch {
          return { grid: null, key: null };
        }
      }),
    };
  }
  const result = new Promise<TrackAnalysis>((resolve) => {
    pending.set(id, resolve);
    w.postMessage(
      { type: "analyze", id, pcm: copy },
      copy.channels.map((c) => c.buffer),
    );
  });
  return { id, result };
}
