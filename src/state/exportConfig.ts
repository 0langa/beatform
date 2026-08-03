import type { VideoCodecId } from "../export/codecProbe";
import type { Aspect } from "./project";

export const RESOLUTIONS = [
  { label: "720p (1280×720)", w: 1280, h: 720, aspect: "16:9" },
  { label: "1080p (1920×1080)", w: 1920, h: 1080, aspect: "16:9" },
  { label: "1440p (2560×1440)", w: 2560, h: 1440, aspect: "16:9" },
  { label: "4K (3840×2160)", w: 3840, h: 2160, aspect: "16:9" },
  { label: "Square (1080×1080)", w: 1080, h: 1080, aspect: "1:1" },
  { label: "Vertical (1080×1920)", w: 1080, h: 1920, aspect: "9:16" },
  { label: "Vertical 4K (2160×3840)", w: 2160, h: 3840, aspect: "9:16" },
] as const;

/** Resolution indices offered for a frame aspect ("free" offers all). */
export function resolutionsForAspect(aspect: Aspect): number[] {
  const all = RESOLUTIONS.map((_, i) => i);
  if (aspect === "free") return all;
  return all.filter((i) => RESOLUTIONS[i].aspect === aspect);
}

/**
 * resIdx if it is valid for the aspect, else the aspect's preferred default.
 * Every path that changes aspect OR resIdx-out-from-under-the-aspect must go
 * through this (setAspect, store init, applyDocument) — otherwise the export
 * Resolution select renders blank and the export contradicts the frame.
 */
export function reconciledResIdx(aspect: Aspect, resIdx: number): number {
  const allowed = resolutionsForAspect(aspect);
  return allowed.includes(resIdx) ? resIdx : allowed[allowed.length > 1 ? 1 : 0];
}

export function autoBitrateMbps(w: number, h: number, fps: number): number {
  return Math.min(60, Math.max(2, Math.round((w * h * fps * 0.09) / 1e6)));
}

export interface ExportProgress {
  done: number;
  total: number;
  /** Encode speed in frames/s, measured over the run; null until known. */
  speed: number | null;
}

export interface ExportSettings {
  resIdx: number;
  fps: number;
  autoRate: boolean;
  manualMbps: number;
  /** Video codec — offered only when the hardware probe confirms support. */
  codec: VideoCodecId;
  /** "video" = whole track; "canvas" = 3-8 s seamless loop (Spotify Canvas). */
  mode: "video" | "canvas";
  canvasStart: number;
  canvasDuration: number;
  /**
   * "mp4" = H.264 + audio in one file. "png" = PNG image sequence into a
   * folder, keeping alpha when the background is Transparent (for editors).
   * "prores" = ProRes 4444 .mov via the ffmpeg sidecar. "av1-10" = genuine
   * 10-bit AV1 .mp4 via the same sidecar, fed raw rgba64le frames from the
   * renderer's deep-color tap (a FORMAT, not a codec: codec ids route through
   * the WebCodecs probe and its 8-bit lane). "gif"/"webp" = animated loop
   * files via the same sidecar (no audio; pair with Canvas loop mode for
   * seamless loops).
   */
  format: "mp4" | "png" | "prores" | "av1-10" | "gif" | "webp";
  /**
   * Integrated-loudness target for the exported audio (LUFS), or null to leave
   * the track at its own level. Off by default — silently changing someone's
   * master is not a default. Audio-only; the visuals never move.
   */
  loudnessTarget: number | null;
  /** True-peak ceiling the limiter holds when normalizing (dBTP). */
  truePeakDb: number;
}

/**
 * Why every render path refuses to run on the Canvas2D fallback (audit F2).
 *
 * The export worker builds its own WebGPU device, so a machine that fell back
 * to Canvas2D cannot encode a single frame — exportCore throws GpuInitError.
 * It used to throw AFTER the native save dialog and a full decode + analysis
 * (and, in a batch, once per queued track). This one string is what the
 * disabled buttons put in their tooltip AND what the actions set as their
 * error, so the promise the UI makes and the reason it gives cannot drift.
 *
 * Lives here rather than in store.ts so the slices can import it as a value
 * without a cycle back through the store (same reason RESOLUTIONS does).
 */
export const SIMPLIFIED_EXPORT_REASON =
  "Video export needs hardware rendering (WebGPU), which is unavailable on this system";

/** Loudness targets people actually deliver to. */
export const LOUDNESS_PRESETS: { label: string; hint: string; lufs: number }[] = [
  { label: "-14", hint: "Streaming (Spotify, YouTube, Apple Music)", lufs: -14 },
  { label: "-16", hint: "Podcasts, spoken word", lufs: -16 },
  { label: "-23", hint: "EBU R128 broadcast", lufs: -23 },
];
