import { CODEC_LABELS, type CodecSupport, type VideoCodecId } from "../export/codecProbe";
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
  /**
   * Encode speed in frames/s over the last ~5 s of frames (E4b) — tracks the
   * CURRENT pipeline rate, so a slow stretch shows up promptly instead of
   * being averaged away by everything rendered before it. null until enough
   * recent samples exist. This is what the dialog displays.
   */
  speed: number | null;
  /**
   * Cumulative done/elapsed average across the whole run so far — the OLD
   * `speed` computation, kept for ETA math (total remaining time wants the
   * long-run rate, not a window that swings with a momentary GPU/encoder
   * hiccup) if a caller ever needs it. null until known. Optional: only the
   * interactive single-export path (exportActions.ts) populates it today —
   * batch progress (batchActions.ts) has no separate windowed reading, so it
   * mirrors its one rate into `speed` and leaves this unset rather than
   * claim a distinct number it does not have.
   */
  avgSpeed?: number | null;
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
 * The half of that sentence that is not about video export specifically.
 * Batch render refuses for the same reason but names itself and adds its own
 * consequence, so it cannot share the whole string — it shares this clause
 * instead. Before G7 it carried a third hand-written copy, drifted the same
 * way ("isn't available"), which is how one machine managed to describe one
 * missing capability in two voices across three surfaces.
 */
export const NO_HARDWARE_RENDERING_CLAUSE =
  "needs hardware rendering (WebGPU), which is unavailable on this system";

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
 * That sentence was aspirational until G7: the top bar's `exportBlocked`
 * carried its own copy, and the copy had already drifted ("isn't available"
 * against this one's "is unavailable") — the same button and the dialog it
 * opens giving two different reasons. There is one literal now, and
 * exportConfig.test.ts fails if a second one appears.
 *
 * Lives here rather than in store.ts so the slices can import it as a value
 * without a cycle back through the store (same reason RESOLUTIONS does).
 */
export const SIMPLIFIED_EXPORT_REASON = `Video export ${NO_HARDWARE_RENDERING_CLAUSE}`;

/** Loudness targets people actually deliver to. */
export const LOUDNESS_PRESETS: { label: string; hint: string; lufs: number }[] = [
  { label: "-14", hint: "Streaming (Spotify, YouTube, Apple Music)", lufs: -14 },
  { label: "-16", hint: "Podcasts, spoken word", lufs: -16 },
  { label: "-23", hint: "EBU R128 broadcast", lufs: -23 },
];

/* ── P-8 · the export dialog's capability map ──────────────────────────────
 *
 * The dialog used to HIDE what this machine or this mode cannot do: the four
 * sidecar formats simply did not render outside Tauri, and the Codec row
 * vanished whenever the probe found fewer than two codecs — which is exactly
 * the machine whose user most wants to know why "transparent WebM", a README
 * headline, is nowhere to be seen. Hiding a capability makes it unpredictable;
 * showing it with the reason makes the dialog a map of the machine.
 *
 * The rules live here, as pure functions of a flat capability record, for two
 * reasons: they are the same facts the export ACTION enforces (so they can be
 * asserted against it without a DOM), and the dialog must be able to build
 * their input from individually-subscribed store fields — an allocating
 * zustand selector is a mount crash, not a slow render.
 */

/** The values `ExportSettings.format` can hold. PERSISTED (`viz.exportSettings.v1`,
 * validated in persistence.ts `loadStoredExportSettings`) — add, never rename. */
export type ExportFormatId = ExportSettings["format"];

/**
 * One entry in the capability map.
 *
 * `reason === null` is the ONLY spelling of "available": its PRESENCE is what
 * disables the tile and what the tile prints, so a choice cannot be switched
 * off without saying what would switch it back on. Same coupling as the
 * control kit's `disabledReason` (kit.tsx), for the same audit finding.
 */
export interface ExportOption<T extends string> {
  id: T;
  /** Short name on the tile. */
  label: string;
  /** What you get when it IS available (tooltip). */
  hint: string;
  /** One line: why this is unavailable right now. `null` = available. */
  reason: string | null;
}

/**
 * Everything the availability rules read. Deliberately three primitives, not
 * the store: every condition below is enforced somewhere in
 * `slices/exportActions.ts`, and nothing else in the store can change the
 * answer.
 */
export interface ExportCapabilities {
  /** `exportSettings.mode === "canvas"`. */
  canvasMode: boolean;
  /** `isTauri()`. */
  desktop: boolean;
  /** WebCodecs probe result, or `null` while it is still in flight. */
  codecSupport: CodecSupport | null;
}

/**
 * Reason strings, one per REAL condition, each traceable to the code that
 * enforces it. They are constants so the test can pin the mapping rather than
 * re-typing prose, and so a rule change cannot leave the sentence behind.
 */

/** ProRes / AV1 10-bit / GIF / WebP all shell out to the bundled ffmpeg
 * sidecar; `exportActions.runExport` refuses them outright off-desktop. */
export const REASON_DESKTOP_FFMPEG = "Needs the desktop app — it runs the bundled ffmpeg";
/** PNG writes a numbered sequence into a folder the user picks — there is no
 * browser equivalent, and `runExport` refuses it off-desktop. */
export const REASON_DESKTOP_FOLDER = "Needs the desktop app — it writes a folder of frames";
/** `setExportSettings` coerces png/prores/av1-10 to mp4 in canvas mode: a
 * Spotify Canvas is uploaded as a video, so the others cannot be produced. */
export const REASON_CANVAS_MP4 = "Canvas loops upload as MP4 — switch Type to Video";
/** `runExport` pins `codec: "h264"` for canvas loops (platform ingest is
 * pickiest there), so the stored codec is not what a canvas export uses. */
export const REASON_CANVAS_H264 = "Canvas loops always encode H.264 — switch Type to Video";
/** The probe starts when the dialog opens and resolves asynchronously; until
 * it does, "unsupported" would be a guess. */
export const REASON_CODEC_PROBING = "Checking what this machine's video encoder supports…";

/**
 * CODEC_LABELS entries read "H.264 — plays everywhere"; a tile wants the two
 * halves separately, and codecProbe stays the single source for both. A label
 * with no em-dash degrades to name-only rather than to an empty tile.
 */
function splitCodecLabel(codec: VideoCodecId): { label: string; hint: string } {
  const [label, ...rest] = CODEC_LABELS[codec].split(" — ");
  return { label, hint: rest.join(" — ") };
}

/**
 * Why a codec is missing. NOTE the wording: `VideoEncoder.isConfigSupported`
 * does not distinguish a hardware encoder from a software one, so this must
 * not claim "no hardware HEVC" — all it knows is that this machine's WebCodecs
 * implementation will not take the config.
 */
export function codecUnavailableReason(codec: VideoCodecId): string {
  return `${splitCodecLabel(codec).label} encoding is not available on this machine`;
}

/** Tile order — the deliverable people reach for first, then the specialists. */
const FORMAT_ORDER: readonly ExportFormatId[] = ["mp4", "png", "prores", "av1-10", "gif", "webp"];

/** Names and "what you get" copy, carried over verbatim from the segmented
 * control this map replaced. */
const FORMAT_META: Record<ExportFormatId, { label: string; hint: string }> = {
  mp4: {
    label: "MP4",
    hint: "One video file with audio: H.264/HEVC/AV1 (.mp4) or VP9 with alpha (.webm)",
  },
  png: {
    label: "PNG frames",
    hint: "A folder of numbered PNG frames — keeps transparency (set Background to Transparent). No audio; for editors.",
  },
  prores: {
    label: "ProRes",
    hint: "One .mov file: ProRes 4444 with alpha + PCM audio — drops straight into Premiere/Resolve/After Effects",
  },
  "av1-10": {
    label: "AV1 10-bit",
    hint: "One .mp4 file: genuine 10-bit AV1 + AAC audio — for grading and mastering; software-encoded, works on any machine",
  },
  gif: {
    label: "GIF",
    hint: "Animated .gif loop — no audio; pairs with Canvas loop mode for a seamless loop",
  },
  webp: {
    label: "WebP",
    hint: "Animated .webp loop — much smaller than GIF, keeps alpha; no audio",
  },
};

/** Every format, always, each with the honest reason it cannot run right now. */
export function exportFormatOptions(caps: ExportCapabilities): ExportOption<ExportFormatId>[] {
  const desktopOnly = (kind: "folder" | "ffmpeg"): string | null =>
    caps.desktop ? null : kind === "folder" ? REASON_DESKTOP_FOLDER : REASON_DESKTOP_FFMPEG;
  const videoOnly = (): string | null => (caps.canvasMode ? REASON_CANVAS_MP4 : null);
  // Desktop FIRST where both apply: switching Type back to Video does not
  // make a PNG folder appear in a browser session, and naming the fixable
  // constraint while an absolute one also holds is a lie by omission.
  const reasons: Record<ExportFormatId, string | null> = {
    mp4: null,
    png: desktopOnly("folder") ?? videoOnly(),
    prores: desktopOnly("ffmpeg") ?? videoOnly(),
    "av1-10": desktopOnly("ffmpeg") ?? videoOnly(),
    // GIF/WebP are the two sidecar formats canvas loops DO allow — a seamless
    // 3-8 s loop is the whole point of an animated file.
    gif: desktopOnly("ffmpeg"),
    webp: desktopOnly("ffmpeg"),
  };
  return FORMAT_ORDER.map((id) => ({ id, ...FORMAT_META[id], reason: reasons[id] }));
}

/** Tile order — H.264 first because it is the one that always works. */
export const CODEC_ORDER: readonly VideoCodecId[] = ["h264", "hevc", "av1", "vp9a"];

/**
 * Every codec, always. What this CANNOT know: the probe runs at 1080p60, and
 * `exportCore` re-checks `isConfigSupported` at the job's real dimensions —
 * a codec listed here as available can still be refused at 4K60. That is a
 * genuine export-time fact, so it is surfaced as an advisory in the dialog
 * rather than faked into a disabled tile here.
 */
export function exportCodecOptions(caps: ExportCapabilities): ExportOption<VideoCodecId>[] {
  return CODEC_ORDER.map((id) => {
    const { label, hint } = splitCodecLabel(id);
    const reason =
      caps.canvasMode && id !== "h264"
        ? REASON_CANVAS_H264
        : !caps.codecSupport
          ? REASON_CODEC_PROBING
          : caps.codecSupport[id]
            ? null
            : codecUnavailableReason(id);
    return { id, label, hint, reason };
  });
}
