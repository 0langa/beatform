import type { StoreApi } from "zustand";
import type { PresetDef } from "../../render/types";
import type { ProjectDocument } from "../project";
import type { VizState } from "../store";

/** zustand's `set`/`get` for the store, typed precisely (no middleware). */
export type SetFn = StoreApi<VizState>["setState"];
export type GetFn = StoreApi<VizState>["getState"];

/**
 * The shared closure surface built inside `create()` in store.ts and passed to
 * every slice factory. These are the helpers that close over module-scope
 * ephemera or the history/autosave machinery and are therefore genuinely
 * shared across action groups.
 */
export interface SliceCtx {
  /** Current document slice as a ProjectDocument (history + save share it). */
  docOf: (s: VizState) => ProjectDocument;
  /** The custom defs the document actually references (active + timeline). */
  referencedCustomDefs: (s: VizState) => PresetDef[];
  /** Record the current document before a mutation (gesture-grouped). */
  record: (key: string) => void;
  /** Record ONE history entry for `key`, then run `fn` with inner record()
   * calls suppressed — a compound action must cost exactly one Ctrl+Z. */
  asOneGesture: (key: string, fn: () => void) => void;
  /** Transient positive feedback toast (auto-clears). */
  flashNotice: (notice: string) => void;
  /** Decode the track's cover art and hand it to the renderer (race-guarded). */
  applyCoverArt: () => void;
  /** Bake + hand the image background to the renderer (or clear it). */
  applyBgImage: () => void;
  /** Decode (or clear) the video-background loop for the current bg. */
  applyVideoBg: () => void;
  /** Crash-safe project autosave (desktop), debounced past edit bursts. */
  scheduleAutosave: () => void;
  /** Lower-cased file names already present in a folder (desktop). */
  fileNamesInDir: (dir: string) => Promise<Set<string>>;
  /** Read + decode the NEXT library track while the current one plays. */
  prefetchNextLibraryTrack: () => Promise<void>;
  /**
   * Void every value derived from the PREVIOUS track's audio (beat grid, key,
   * sections, waveform overview) and declare an analysis outstanding. Called at
   * the moment the NEW audio reaches the engine — see store.ts for why that
   * moment and not the one where the analysis job starts (E3c).
   */
  invalidateAnalysis: () => void;
  /**
   * Clear an invalidation that no analysis job ever claimed. Every load-path
   * exit that will not reach `analyzeCurrentTrack()` must call this: since E3b
   * `analyzing` is a gate, and a stuck one costs every later export its full
   * analysis timeout.
   */
  settleUnclaimedAnalysis: () => void;
}
