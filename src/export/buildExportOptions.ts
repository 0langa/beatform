import { DEFAULT_SYNC } from "../audio/types";
import type { BeatGrid } from "../audio/analysis/beatGrid";
import { presetById } from "../render/presets";
import {
  BG_IMAGE,
  BG_VIDEO,
  defaultParams,
  type ParamValues,
  type PresetDef,
} from "../render/types";
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
 * Preview and export must consume one creative document definition. That was
 * previously held up by hand: runExport read ~18 fields off the store in the
 * right way, and another caller could omit one silently. This makes it a call
 * graph instead — one function, so batch and single export cannot drift in
 * document fields.
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
  /** Ask the core for the deep-color tap (post-tonemap rgba16float target
   * instead of the 8-bit canvas readback). Wired by the renderer-tap branch. */
  deepColor?: boolean;
  /** Per-frame raw sink for the deep-color lane (AV1 10-bit sidecar feed):
   * tightly-packed rgba64le u16 (R,G,B,A row-major, length w*h*4). The core
   * awaits it — that is the backpressure. Wired by the renderer-tap branch. */
  onRawFrame?: (data: Uint16Array) => Promise<void> | void;
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
  // Per-mode overrides (v2.46): the mode's own background wins over the
  // global one, and a custom center image replaces the track's cover art —
  // resolved HERE so the interactive export and the batch runner cannot
  // drift apart.
  const bg = doc.bgByPreset[doc.presetId] ?? doc.bg;
  const centerId = doc.centerImageByPreset[doc.presetId];
  const centerImage = centerId ? doc.assets[centerId]?.dataUrl : undefined;
  return {
    width: fmt.w,
    height: fmt.h,
    fps: fmt.fps,
    bitrate: fmt.mbps * 1e6,
    codec: fmt.codec ?? "h264",
    presetId: doc.presetId,
    params: resolveDocParams(doc.presetId, doc.paramsByPreset),
    bg,
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
    coverArt: centerImage ?? track.coverArt ?? undefined,
    // Image background: resolve the asset here (the export job carries the
    // bytes; the core bakes with the same function as the live view).
    //
    // BAKE parameters only. The framing (bg.image.fit/zoom/offsetX/offsetY) is
    // deliberately NOT copied here: it is a shader uniform, and exportCore
    // pushes it by calling setBackground(rf.bg) every frame — the same call the
    // live loop makes with the same object. Duplicating it into this bake block
    // would create a second source of truth that a timeline scene's own bg
    // (frameResolve overrides rf.bg, not job.bgImage) would silently contradict.
    bgImage:
      bg.mode === BG_IMAGE && bg.image && doc.assets[bg.image.assetId]
        ? {
            dataUrl: doc.assets[bg.image.assetId].dataUrl,
            dim: bg.image.dim,
            blur: bg.image.blur,
          }
        : undefined,
    // Video background: same asset-resolve; the core decodes the loop itself.
    bgVideo:
      bg.mode === BG_VIDEO && bg.video && doc.assets[bg.video.assetId]
        ? {
            dataUrl: doc.assets[bg.video.assetId].dataUrl,
            dim: bg.video.dim,
            blur: bg.video.blur,
          }
        : undefined,
    beatGrid: track.beatGrid ?? undefined,
    stems: track.stems,
    lyrics: track.lyrics,
    audiogram: track.audiogram,
    customPresets: track.customPresets,
    builderStack: doc.builderStack,
    streamToPath: io.streamToPath,
    pngDir: io.pngDir,
    onPngFrame: io.onPngFrame,
    deepColor: io.deepColor,
    onRawFrame: io.onRawFrame,
    loudness: io.loudness,
    segment: io.segment,
    loopCrossfadeSec: io.loopCrossfadeSec,
    signal: io.signal,
    onProgress: io.onProgress,
  };
}
