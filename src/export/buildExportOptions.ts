import { DEFAULT_SYNC } from "../audio/types";
import type { BeatGrid } from "../audio/analysis/beatGrid";
import { presetById } from "../render/presets";
import { BG_IMAGE, defaultParams, type ParamValues, type PresetDef } from "../render/types";
import type { OverlayMeta } from "../render/overlay";
import type { ProjectDocument } from "../state/project";
import type { ExportOptions } from "./videoExporter";
import type { LoudnessJob } from "./exportCore";
import type { VideoCodecId } from "./codecProbe";
import type { StemEntry } from "../audio/stems";
import type { LyricLine, LyricStyle } from "../state/lyrics";
import type { AudiogramSettings } from "../state/audiogram";

/**
 * The single place a ProjectDocument becomes an ExportOptions.
 *
 * The app's cardinal invariant is that the preview and the export are the same
 * render. That was previously held up by hand: runExport read ~18 fields off
 * the store in the right way, and anything else wanting to render a document
 * had to read them the same way or silently diverge. This makes it a call
 * graph instead — one function, so a second caller (the batch queue) cannot
 * drift from the first.
 *
 * Pure: no store, no engine, no globals. Everything varying per render arrives
 * as an argument.
 */

/** An output shape. Resolutions are literal — see the note on FormatPreset.w. */
export interface FormatPreset {
  id: string;
  label: string;
  /**
   * Literal pixel dimensions, deliberately NOT an index into RESOLUTIONS:
   * a saved job holding `resIdx: 2` would silently repoint at a different
   * resolution the day that array is reordered.
   */
  w: number;
  h: number;
  fps: number;
  mbps: number;
  format: "mp4";
  /** Video codec; omitted = "h264". Frozen with the format so a saved batch
   * run keeps encoding what it started with. */
  codec?: VideoCodecId;
}

/** Everything about the track being rendered, independent of the document. */
export interface TrackInput {
  name: string;
  meta: OverlayMeta;
  /** Cover art as a data URL, for presets that sample it (e.g. Bass Circle). */
  coverArt: string | null;
  beatGrid: BeatGrid | null;
  /** Imported stems (session-scoped, like the beat grid). Omitted by the
   * batch queue — stem routes then read 0 and are silently inert. */
  stems?: StemEntry[];
  /** Timed lyrics + style (session-scoped, like stems). Omitted by the
   * batch queue — batch tracks have no imported lyrics. */
  lyrics?: { lines: LyricLine[]; style: LyricStyle };
  /** Audiogram elements + waveform overview (session-scoped). */
  audiogram?: { settings: AudiogramSettings; waveform: Float32Array | null };
  /** User-authored WGSL presets the document may reference. */
  customPresets?: PresetDef[];
}

/** Destination + lifecycle, supplied by the caller. */
export interface ExportIo {
  streamToPath?: string;
  pngDir?: string;
  /** Per-frame PNG sink (ProRes sidecar feed / browser probes). Setting it
   * puts the core in PNG-frame mode, same as pngDir. */
  onPngFrame?: (data: Uint8Array, index: number) => void;
  loudness?: LoudnessJob;
  segment?: { start: number; duration: number };
  loopCrossfadeSec?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/** Resolve a preset's params against the document's per-preset overrides. */
export function resolveDocParams(
  presetId: string,
  overrides: Record<string, ParamValues>,
): ParamValues {
  const preset = presetById(presetId);
  return { ...defaultParams(preset), ...overrides[preset.id] };
}

export function buildExportOptions(
  doc: ProjectDocument,
  fmt: FormatPreset,
  track: TrackInput,
  overlay: ImageBitmap | undefined,
  io: ExportIo,
): ExportOptions {
  return {
    width: fmt.w,
    height: fmt.h,
    fps: fmt.fps,
    bitrate: fmt.mbps * 1e6,
    codec: fmt.codec ?? "h264",
    presetId: doc.presetId,
    params: resolveDocParams(doc.presetId, doc.paramsByPreset),
    bg: doc.bg,
    // The base preset's sync, even when a timeline scene switches preset:
    // exportCore builds ONE OfflineAnalyzer from job.sync for the whole
    // render, so this is what the preview does too. Resolving per-scene sync
    // here would be "smarter" and would diverge from the preview — that is a
    // bug, not an improvement.
    sync: doc.syncByPreset[doc.presetId] ?? { ...DEFAULT_SYNC },
    mods: doc.modsByPreset[doc.presetId] ?? [],
    smoothSpectrum: doc.smoothSpectrum,
    post: doc.post,
    motion: doc.motion,
    paramsByPreset: doc.paramsByPreset,
    modsByPreset: doc.modsByPreset,
    timeline: doc.timeline.enabled ? doc.timeline : undefined,
    overlay,
    coverArt: track.coverArt ?? undefined,
    // Image background: resolve the asset here (the export job carries the
    // bytes; the core bakes with the same function as the live view).
    bgImage:
      doc.bg.mode === BG_IMAGE && doc.bg.image && doc.assets[doc.bg.image.assetId]
        ? {
            dataUrl: doc.assets[doc.bg.image.assetId].dataUrl,
            dim: doc.bg.image.dim,
            blur: doc.bg.image.blur,
          }
        : undefined,
    beatGrid: track.beatGrid ?? undefined,
    stems: track.stems,
    lyrics: track.lyrics,
    audiogram: track.audiogram,
    customPresets: track.customPresets,
    streamToPath: io.streamToPath,
    pngDir: io.pngDir,
    onPngFrame: io.onPngFrame,
    loudness: io.loudness,
    segment: io.segment,
    loopCrossfadeSec: io.loopCrossfadeSec,
    signal: io.signal,
    onProgress: io.onProgress,
  };
}
