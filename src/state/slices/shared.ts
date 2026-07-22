import type { OverlayFrameKey } from "../../render/dynamicOverlay";
import type { MidiHandle } from "../midiInput";

/**
 * Non-serializable ephemera shared by 2+ action groups (and the store core).
 * Each field has exactly one conceptual owner but is read/written across file
 * boundaries after the store split, so it lives here instead of being
 * duplicated. A single mutable holder keeps the `++gen` / assignment idioms
 * working verbatim (`shared.trackLoadGen++`, `shared.lastFrameKey = …`).
 */
export const NULL_FRAME_KEY: OverlayFrameKey = {
  lyricIdx: -2,
  lyricAlphaQ: -1,
  lyricProgQ: -1,
  progressPx: -2,
  clockSec: -2,
};

export const shared: {
  /** Monotonic track-load counter: a slow decode/tag-scan must not write its
   * metadata (or trigger analysis) over a newer load's. Touched by the core
   * load path, export, library and stem actions. */
  trackLoadGen: number;
  /** Single-export/per-job abort controller. Shared by export + batch. */
  exportAbort: AbortController | null;
  /** Synchronous claim for runExport, also read by the batch guards. */
  exportStarting: boolean;
  /** Last composed dynamic-overlay frame key (frame tick + refreshOverlay +
   * lyrics/audiogram edits + applyDocument). */
  lastFrameKey: OverlayFrameKey;
  /** Next library track, read + decoded ahead of time while the current one
   * plays. Shared by the library actions and the store teardown. */
  libraryPrefetch: { path: string; file: File; buffer: AudioBuffer } | null;
  /** Active Web MIDI listener handle (null = off). MIDI actions + teardown. */
  midiHandle: MidiHandle | null;
} = {
  trackLoadGen: 0,
  exportAbort: null,
  exportStarting: false,
  lastFrameKey: NULL_FRAME_KEY,
  libraryPrefetch: null,
  midiHandle: null,
};
