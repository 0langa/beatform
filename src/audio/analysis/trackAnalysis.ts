import type { BeatGrid } from "./beatGrid";
import { analyzeBeatGrid } from "./beatGrid";
import { estimateKey, type KeyEstimate } from "./keyDetect";
import { detectSections } from "./sections";
import { travelCurveOf, type TravelCurve } from "./travel";
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
  /** Section boundaries, seconds. Empty when undetected. */
  sections: number[];
  /** Loudness-integrated time curve (travel.ts). Null when the audio is too
   * short — consumers then read travel as plain time. */
  travel: TravelCurve | null;
}

/**
 * How long a job may go unanswered before the worker is presumed dead. A
 * real analysis takes seconds; this only has to be shorter than "forever".
 * It exists for the worker that dies WITHOUT an error event — an OOM kill
 * fires no `onerror` — because an unanswered job leaves the store's
 * `analyzing` flag up for good, and every export then waits out its whole
 * analysis timeout and refuses with advice ("reload the track") that cannot
 * help: the reload posts into the same dead worker.
 */
export const ANALYSIS_LIVENESS_MS = 10 * 60_000;

let worker: Worker | null = null;
let nextId = 1;
interface PendingJob {
  resolve: (result: TrackAnalysis) => void;
  liveness: ReturnType<typeof setTimeout>;
}
const pending = new Map<number, PendingJob>();

const nullAnalysis = (): TrackAnalysis => ({ grid: null, key: null, sections: [], travel: null });

function settle(id: number, result: TrackAnalysis): void {
  const job = pending.get(id);
  if (!job) return;
  pending.delete(id);
  clearTimeout(job.liveness);
  job.resolve(result);
}

/**
 * Drop a worker that will never answer again, so the NEXT job gets a fresh
 * one. The old handler resolved the pending jobs null but kept the broken
 * instance: a worker whose module failed to load (404, CSP, a boot throw)
 * stayed the singleton, every later `analyzeTrack` posted into it, no reply
 * ever came, and the promise never settled. Every in-flight job dies with
 * the worker, so each resolves null here — callers degrade, they do not hang.
 */
function discardWorker(reason: string): void {
  console.error("[analysis]", reason);
  worker?.terminate();
  worker = null;
  for (const id of [...pending.keys()]) settle(id, nullAnalysis());
}

function ensureWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (!worker) {
    const w = new Worker(new URL("./analysisWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (
      e: MessageEvent<
        | {
            type: "analysis";
            id: number;
            grid: BeatGrid;
            key: KeyEstimate | null;
            sections: number[];
            travel: TravelCurve | null;
          }
        | { type: "error"; id: number; message: string }
      >,
    ) => {
      const msg = e.data;
      if (msg.type === "analysis") {
        settle(msg.id, {
          grid: msg.grid,
          key: msg.key,
          sections: msg.sections,
          travel: msg.travel,
        });
      } else {
        console.error("[analysis]", msg.message);
        settle(msg.id, nullAnalysis());
      }
    };
    w.onerror = () => {
      // Only if it is still the live instance — a liveness timeout may have
      // already replaced it, and the pending jobs then belong to the new one.
      if (worker === w) discardWorker("worker failed — recycling it");
    };
    worker = w;
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
          return {
            grid: analyzeBeatGrid(copy),
            key: estimateKey(mono, copy.sampleRate),
            sections: detectSections(mono, copy.sampleRate),
            travel: travelCurveOf(mono, copy.sampleRate),
          };
        } catch {
          return { grid: null, key: null, sections: [], travel: null };
        }
      }),
    };
  }
  const result = new Promise<TrackAnalysis>((resolve) => {
    const liveness = setTimeout(() => {
      if (!pending.has(id)) return;
      discardWorker(
        `job ${id} unanswered for ${ANALYSIS_LIVENESS_MS / 1000} s — recycling the worker`,
      );
    }, ANALYSIS_LIVENESS_MS);
    pending.set(id, { resolve, liveness });
    try {
      w.postMessage(
        { type: "analyze", id, pcm: copy },
        copy.channels.map((c) => c.buffer),
      );
    } catch (e) {
      // Never reached the worker (a clone failure): nothing to wait for, and
      // a timer left armed here would later kill a healthy worker for it.
      pending.delete(id);
      clearTimeout(liveness);
      throw e;
    }
  });
  return { id, result };
}
