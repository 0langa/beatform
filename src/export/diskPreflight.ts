/**
 * Disk pre-flight for exports, and translation of the failures that happen
 * when it is ignored.
 *
 * The bug this exists for: a ProRes 4444 export at 2560x1440@60 rendered for
 * ELEVEN MINUTES and wrote 7506 MB before dying with
 *
 *   "The requested file could not be read, typically due to permission
 *    problems that have occurred after a reference to a file was acquired."
 *
 * — the Blob API's `NotReadableError`, whose permission-oriented text hid a
 * full blob-storage drive in this incident. The output drive (D:) had 518 GB
 * free and was never involved; the SYSTEM drive had 3.2 GB of 236 GB left.
 * `NotReadableError` is not itself proof of disk exhaustion, so translation
 * below requires a fresh low-space measurement.
 *
 * So two things live here:
 *  1. An estimate + warning, checked against BOTH volumes before a frame is
 *     rendered. Warn-and-override, never a hard block: the estimate is an
 *     estimate and the user may know something we do not (a cleanup script,
 *     a compressed volume).
 *  2. A translator that turns the disk-shaped exceptions into a sentence that
 *     names the drive that actually ran out. Blaming the output drive — the
 *     obvious guess — would have sent the owner deleting files on a disk with
 *     518 GB free.
 *
 * Everything here is pure so it can be unit-tested without a disk; the two
 * Tauri commands that supply the numbers live in `src-tauri/src/diskspace.rs`.
 */

/** Which lane an export runs down. Mirrors the format picker, not the muxer. */
export type ExportFormatKind = "mp4" | "webm" | "prores" | "av1-10" | "gif" | "webp" | "png";

export interface ExportSizeInput {
  format: ExportFormatKind;
  width: number;
  height: number;
  fps: number;
  /** Rendered duration in seconds (the SEGMENT's, for Canvas-loop exports). */
  seconds: number;
  /** Video bitrate in bits/second — the mp4/webm lanes only. */
  bitrate: number;
  /** Source audio rate/channels, for the staged mezzanine WAV. */
  sampleRate: number;
  channels: number;
}

export interface DiskNeed {
  /** Bytes the finished file is expected to occupy. */
  outputBytes: number;
  /**
   * Bytes needed in %TEMP% while the export runs. ProRes stages the whole
   * mezzanine WAV there before ffmpeg starts (`prores_audio_*`), which is
   * 691 MB for an hour of 48 kHz stereo — the single biggest scratch user.
   */
  scratchBytes: number;
  /**
   * True for the lanes that emit frames one at a time (PNG sequence, ProRes,
   * GIF, WebP). Those go through `convertToBlob()` + `blob.arrayBuffer()`, so
   * every frame passes through the engine's blob storage on the system drive.
   * The MP4/WebM lanes hand frames to an encoder instead and never build a
   * Blob per frame.
   */
  framesThroughScratch: boolean;
}

/** Free/total for one volume, as `disk_space` reports it. */
export interface VolumeSpace {
  freeBytes: number;
  totalBytes: number;
  /** Volume root as the user knows it ("C:\\") — the warning must name it. */
  root: string;
}

/**
 * Compressed bytes per pixel per frame, per format.
 *
 * ProRes 4444: Apple specifies ~330 Mbit/s at 1920x1080@29.97, which is
 * 330e6 / (1920*1080*29.97) = 5.3 bits = 0.66 bytes per pixel. Checked against
 * the export that prompted this file: 2560x1440, 3960 frames written, 7506 MB
 * on disk = 1.9 MB/frame against a 2.4 MB/frame estimate — i.e. the estimate
 * is ~25% conservative on real (mostly dark) visualiser content, which is the
 * direction a pre-flight should err.
 *
 * PNG: measured 1.80 MB for a 2560x1440 gradient frame = 0.49 bytes/px.
 * GIF: 8-bit palette + LZW, which on flat synthetic frames lands well under
 * one byte per pixel. WebP animation is lossy and much smaller again.
 *
 * AV1 10-bit (libsvtav1, crf 24, preset 6): rate-factor output has no chosen
 * bitrate to trust, so this is a deliberately conservative ceiling — real
 * crf-24 AV1 on visualiser content lands an order of magnitude under it, but
 * a pre-flight that under-estimates a mastering export is the failure mode
 * this file exists to prevent.
 */
const BYTES_PER_PIXEL_FRAME: Partial<Record<ExportFormatKind, number>> = {
  prores: 0.66,
  "av1-10": 0.15,
  png: 0.5,
  gif: 0.35,
  webp: 0.12,
};

/** 16-bit PCM mezzanine, plus the 44-byte RIFF header. */
export function wavBytes(seconds: number, sampleRate: number, channels: number): number {
  return Math.ceil(seconds * sampleRate) * Math.min(2, Math.max(1, channels)) * 2 + 44;
}

/**
 * What this job will need, on each of the two volumes.
 *
 * Deliberately an over-estimate rather than an under-estimate: a pre-flight
 * that stays quiet before an 11-minute failure is worth nothing.
 */
export function estimateExportBytes(i: ExportSizeInput): DiskNeed {
  const pixels = Math.max(0, i.width) * Math.max(0, i.height);
  const frames = Math.max(0, i.seconds) * Math.max(0, i.fps);
  const wav = wavBytes(i.seconds, i.sampleRate, i.channels);
  const bpp = BYTES_PER_PIXEL_FRAME[i.format];
  if (bpp === undefined) {
    // mp4 / webm: the bitrate IS the size, and it is chosen, not guessed.
    // 192 kbit/s is what the core configures both audio encoders at.
    const bits = (Math.max(0, i.bitrate) + 192_000) * Math.max(0, i.seconds);
    return { outputBytes: Math.round(bits / 8), scratchBytes: 0, framesThroughScratch: false };
  }
  // ProRes muxes the PCM mezzanine into the .mov, so the audio is paid for
  // twice: once staged in %TEMP%, once inside the output file. AV1 re-encodes
  // the staged WAV to 192 kbit/s AAC inside the .mp4 (24 kB/s).
  const audioInFile =
    i.format === "prores"
      ? wav
      : i.format === "av1-10"
        ? Math.round(24_000 * Math.max(0, i.seconds))
        : 0;
  return {
    outputBytes: Math.round(pixels * frames * bpp + audioInFile),
    // The mezzanine WAV is the only thing we stage at a size worth counting,
    // and only the WAV-muxing sidecar lanes (ProRes, AV1) stage one. Per-frame
    // blob traffic is handled by the floor check — see SCRATCH_FLOOR_BYTES.
    scratchBytes: i.format === "prores" || i.format === "av1-10" ? wav : 0,
    framesThroughScratch: true,
  };
}

/**
 * Leave the volume some room rather than filling it to zero. A drive at 0
 * bytes free takes the whole OS down with it, so "it exactly fits" is not a
 * pass.
 */
export const FREE_SPACE_RESERVE_BYTES = 512 * 1024 * 1024;

/**
 * Below this much free space, the scratch volume is called out for any export
 * that streams frames through blob storage — regardless of the (usually tiny)
 * `scratchBytes` estimate.
 *
 * This is a FLOOR, not a model. Each frame Blob is short-lived, but how much
 * of that traffic the engine keeps resident before collecting it is not
 * observable from here, and the export that prompted all of this died on a
 * volume holding 3.2 GB of 236 GB with nothing in the app looking at either
 * number. 5 GB is the smallest round figure that would have caught it, and it
 * is cheap to be wrong in this direction: the prompt is overridable.
 */
export const SCRATCH_FLOOR_BYTES = 5 * 1000 * 1000 * 1000;

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(0, Math.round(n / 1e3))} kB`;
}

/**
 * The warning to show before starting, or null when both volumes are fine.
 *
 * `output` and `scratch` may be the SAME volume (a single-drive machine, or a
 * user saving to their desktop) — in that case the two requirements add up,
 * and reporting them separately would clear a job that cannot fit. Compared by
 * volume root, which is exactly why `disk_space` returns one.
 */
export function preflightWarning(
  need: DiskNeed,
  output: VolumeSpace | null,
  scratch: VolumeSpace | null,
): string | null {
  const sameVolume =
    !!output && !!scratch && output.root.toLowerCase() === scratch.root.toLowerCase();
  const shortfalls: string[] = [];

  const check = (vol: VolumeSpace | null, needBytes: number, what: string) => {
    if (!vol || needBytes <= 0) return;
    if (vol.freeBytes >= needBytes + FREE_SPACE_RESERVE_BYTES) return;
    shortfalls.push(
      `${vol.root} has ${formatBytes(vol.freeBytes)} free but this export needs about ` +
        `${formatBytes(needBytes)} ${what}`,
    );
  };

  if (sameVolume) {
    check(output, need.outputBytes + need.scratchBytes, "there (the file plus working space)");
  } else {
    check(output, need.outputBytes, "for the file");
    check(scratch, need.scratchBytes, "of working space");
  }

  // A nearly-full scratch volume is worth saying out loud even when the
  // estimate above is tiny: frames pass through blob storage there one at a
  // time, and that is what actually failed. Skipped when the size check
  // already named this volume, so the user never gets told about one drive
  // twice in one sentence.
  if (
    scratch &&
    need.framesThroughScratch &&
    scratch.freeBytes < SCRATCH_FLOOR_BYTES &&
    !shortfalls.some((s) => s.startsWith(scratch.root))
  ) {
    shortfalls.push(
      `${scratch.root} (the working drive every export stages frames on) is nearly full ` +
        `at ${formatBytes(scratch.freeBytes)} free`,
    );
  }

  if (shortfalls.length === 0) return null;
  return (
    `Not enough disk space: ${shortfalls.join(", and ")}. ` +
    `The export will very likely fail part-way through. Start it anyway?`
  );
}

/**
 * Turn a disk-shaped failure into a sentence that names the right drive.
 *
 * `NotReadableError` is the one that cost eleven minutes, but it is not a
 * disk-full error code: permissions and concurrent file access can produce it
 * too. Only translate it when a fresh scratch-volume measurement independently
 * shows the drive below the same conservative floor used by preflight.
 *
 * Returns null when the error is not disk-related, so callers keep showing the
 * original message rather than guessing.
 */
export function translateExportError(err: unknown, scratch: VolumeSpace | null): string | null {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
  const where = scratch ? `on ${scratch.root}` : "on the system drive";

  if (name === "NotReadableError") {
    if (!scratch || scratch.freeBytes >= SCRATCH_FLOOR_BYTES) return null;
    return (
      `The export ran out of working space ${where}. Frames are staged there while ` +
      `the file is written. The browser reported a read failure, and a fresh disk ` +
      `check found only ${formatBytes(scratch.freeBytes)} free there. Free up space ` +
      `${where} and run the export again.`
    );
  }
  if (name === "QuotaExceededError") {
    return `The export ran out of storage quota ${where}. Free up space ${where} and try again.`;
  }
  // ffmpeg/Rust surface the OS error as text. Windows spells disk-full three
  // different ways depending on which layer reports it (ERROR_DISK_FULL is
  // os error 112), and ffmpeg uses the POSIX phrasing even on Windows.
  if (
    /no space left on device/i.test(text) ||
    /not enough space on the disk/i.test(text) ||
    /os error 112\b/i.test(text) ||
    /ENOSPC/.test(text)
  ) {
    return (
      `The drive ran out of space while writing the export (${text.trim()}). ` +
      `Free up space and run the export again — a partial file has been removed.`
    );
  }
  return null;
}
