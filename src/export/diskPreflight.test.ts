import { describe, expect, it } from "vitest";
import {
  estimateExportBytes,
  formatBytes,
  preflightWarning,
  translateExportError,
  wavBytes,
  type VolumeSpace,
} from "./diskPreflight";

/**
 * These tests exist because of one real failure: a ProRes 4444 export at
 * 2560x1440@60 to D:\ rendered for eleven minutes, wrote 7506 MB, and died
 * with the Blob API's NotReadableError — "permission problems that have
 * occurred after a reference to a file was acquired". The actual cause was
 * C: sitting at 3.2 GB free of 236 GB. D: had 518 GB free and was never
 * involved.
 *
 * So the two things worth pinning are: the check looks at BOTH volumes, and
 * the message names the RIGHT one. A warning that blamed the output drive
 * would have sent the owner deleting files on the healthy disk.
 */

const GB = 1e9;
const vol = (root: string, freeGb: number, totalGb = 500): VolumeSpace => ({
  root,
  freeBytes: freeGb * GB,
  totalBytes: totalGb * GB,
});

describe("estimateExportBytes", () => {
  it("bills the ProRes mezzanine WAV to the scratch drive as well as the file", () => {
    // %TEMP% holds the whole PCM WAV before ffmpeg starts (prores_audio_*),
    // and the .mov then carries a second copy — the scratch cost is invisible
    // if you only look at the output size, which is exactly how it got missed.
    const seconds = 3600;
    const need = estimateExportBytes({
      format: "prores",
      width: 2560,
      height: 1440,
      fps: 60,
      seconds,
      bitrate: 0,
      sampleRate: 48000,
      channels: 2,
    });
    const wav = wavBytes(seconds, 48000, 2);
    expect(wav).toBeGreaterThan(690e6); // ~691 MB for an hour of 48k stereo
    expect(need.scratchBytes).toBe(wav);
    expect(need.outputBytes).toBeGreaterThan(wav);
  });

  it("lands in the right order of magnitude for the export that failed", () => {
    // 3960 frames actually reached disk as 7506 MB before the failure. The
    // estimate should be at least that, and not wildly more (a pre-flight that
    // cries wolf gets clicked through).
    const seconds = 3960 / 60;
    const need = estimateExportBytes({
      format: "prores",
      width: 2560,
      height: 1440,
      fps: 60,
      seconds,
      bitrate: 0,
      sampleRate: 48000,
      channels: 2,
    });
    expect(need.outputBytes).toBeGreaterThan(7506e6);
    expect(need.outputBytes).toBeLessThan(7506e6 * 2);
  });

  it("bills the AV1 10-bit mezzanine WAV to the scratch drive like ProRes", () => {
    // The AV1 lane stages the same PCM WAV in %TEMP% before ffmpeg starts
    // (same prores_audio_* handshake) — only the muxed audio differs (AAC,
    // not the WAV itself), so scratch pays for the WAV and the file does not.
    const seconds = 3600;
    const need = estimateExportBytes({
      format: "av1-10",
      width: 1920,
      height: 1080,
      fps: 60,
      seconds,
      bitrate: 0,
      sampleRate: 48000,
      channels: 2,
    });
    const wav = wavBytes(seconds, 48000, 2);
    expect(need.scratchBytes).toBe(wav);
    // crf output has no chosen bitrate to trust: 0.15 bytes/pixel-frame is
    // the deliberately conservative ceiling, plus 192 kbit/s AAC in the file.
    expect(need.outputBytes).toBe(
      Math.round(1920 * 1080 * seconds * 60 * 0.15 + Math.round(24_000 * seconds)),
    );
  });

  it("uses the chosen bitrate for mp4 and stages nothing", () => {
    const need = estimateExportBytes({
      format: "mp4",
      width: 1920,
      height: 1080,
      fps: 30,
      seconds: 100,
      bitrate: 8_000_000,
      sampleRate: 48000,
      channels: 2,
    });
    // (8 Mbit video + 192 kbit audio) * 100 s / 8
    expect(need.outputBytes).toBe(Math.round(((8_000_000 + 192_000) * 100) / 8));
    expect(need.scratchBytes).toBe(0);
  });

  it("scales with pixels, frames and duration", () => {
    const base = {
      format: "prores" as const,
      width: 1920,
      height: 1080,
      fps: 30,
      seconds: 10,
      bitrate: 0,
      sampleRate: 48000,
      channels: 2,
    };
    const twiceTheFrames = estimateExportBytes({ ...base, fps: 60 });
    expect(twiceTheFrames.outputBytes).toBeGreaterThan(estimateExportBytes(base).outputBytes * 1.9);
  });
});

describe("preflightWarning", () => {
  const need = { outputBytes: 40 * GB, scratchBytes: 1 * GB, framesThroughScratch: false };

  it("stays silent when both volumes have room", () => {
    expect(preflightWarning(need, vol("D:\\", 518), vol("C:\\", 100))).toBeNull();
  });

  it("names the SCRATCH drive when only the scratch drive is short", () => {
    // The failure this whole file exists for. D: had 518 GB free; C: had 3.2.
    const msg = preflightWarning(
      { outputBytes: 8 * GB, scratchBytes: 4 * GB, framesThroughScratch: false },
      vol("D:\\", 518),
      vol("C:\\", 3.2),
    );
    expect(msg).toContain("C:\\");
    // Must NOT accuse the drive with 518 GB free.
    expect(msg).not.toContain("D:\\");
    expect(msg).toMatch(/working space/i);
  });

  it("names the OUTPUT drive when only the output drive is short", () => {
    const msg = preflightWarning(need, vol("E:\\", 5), vol("C:\\", 200));
    expect(msg).toContain("E:\\");
    expect(msg).not.toContain("C:\\");
  });

  it("adds both requirements when output and scratch are the same volume", () => {
    // A single-drive machine, or saving to the desktop. Checked separately,
    // 30 GB free clears a 28 GB file on its own, and clears 4 GB of scratch on
    // its own — but the two land on the same disk and 32 GB does not fit.
    const both = { outputBytes: 28 * GB, scratchBytes: 4 * GB, framesThroughScratch: false };
    expect(preflightWarning(both, vol("C:\\", 30), vol("C:\\", 30))).not.toBeNull();
    // Same numbers on two different drives are genuinely fine.
    expect(preflightWarning(both, vol("D:\\", 30), vol("C:\\", 30))).toBeNull();
  });

  it("treats the volume root case-insensitively when deciding they are one disk", () => {
    const both = { outputBytes: 28 * GB, scratchBytes: 4 * GB, framesThroughScratch: false };
    expect(preflightWarning(both, vol("c:\\", 30), vol("C:\\", 30))).not.toBeNull();
  });

  it("refuses to fill a volume to exactly zero", () => {
    // "It fits with 0 bytes to spare" is not a pass — that takes the OS down.
    expect(
      preflightWarning(
        { outputBytes: 10 * GB, scratchBytes: 0, framesThroughScratch: false },
        vol("D:\\", 10),
        null,
      ),
    ).not.toBeNull();
  });

  it("calls out a nearly-full scratch drive even when the estimate is tiny", () => {
    // The actual incident. A 3 s GIF needs almost no staged bytes, so the size
    // check clears — but every frame still goes through blob storage on C:,
    // and C: was the drive that ran out. Silence here is the original bug.
    const tiny = { outputBytes: 50e6, scratchBytes: 0, framesThroughScratch: true };
    const msg = preflightWarning(tiny, vol("D:\\", 518), vol("C:\\", 3.2));
    expect(msg).toContain("C:\\");
    expect(msg).toMatch(/nearly full/i);
    expect(msg).not.toContain("D:\\");
  });

  it("leaves the encoder lanes alone — they never build a Blob per frame", () => {
    // MP4/WebM hand frames straight to the encoder, so a tight system drive is
    // not their problem and warning about it would be noise.
    const tiny = { outputBytes: 50e6, scratchBytes: 0, framesThroughScratch: false };
    expect(preflightWarning(tiny, vol("D:\\", 518), vol("C:\\", 3.2))).toBeNull();
  });

  it("does not name the same drive twice in one sentence", () => {
    // Output and scratch both on a nearly-full C:: the size shortfall already
    // names it, so the floor check must not append a second clause about it.
    const big = { outputBytes: 40 * GB, scratchBytes: 1 * GB, framesThroughScratch: true };
    const msg = preflightWarning(big, vol("C:\\", 3), vol("C:\\", 3)) ?? "";
    expect(msg.match(/C:\\/g)?.length).toBe(1);
  });

  it("stays silent when a volume could not be measured at all", () => {
    // An unqueryable volume means no information, not bad news; inventing a
    // warning there would train the user to click through the real ones.
    expect(preflightWarning(need, null, null)).toBeNull();
  });
});

describe("translateExportError", () => {
  it("turns NotReadableError into a disk message only with measured low scratch space", () => {
    // The exact exception the failed export showed. Its stock text says
    // "permission problems", which reads as a problem with the output file —
    // the one thing that was definitely fine.
    const e = new DOMException(
      "The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.",
      "NotReadableError",
    );
    const msg = translateExportError(e, {
      root: "C:\\",
      freeBytes: 3.2e9,
      totalBytes: 236e9,
    });
    expect(msg).not.toBeNull();
    expect(msg).toContain("C:\\");
    expect(msg).toMatch(/working space/i);
    expect(msg).toContain("3.2 GB");
  });

  it("preserves NotReadableError when scratch space is healthy or unknown", () => {
    const e = new DOMException("boom", "NotReadableError");
    expect(translateExportError(e, null)).toBeNull();
    expect(
      translateExportError(e, { root: "C:\\", freeBytes: 20e9, totalBytes: 236e9 }),
    ).toBeNull();
  });

  it("recognises a disk-full report from ffmpeg or the OS, whatever the wording", () => {
    for (const text of [
      "Error writing output: No space left on device",
      "failed to write frame: There is not enough space on the disk. (os error 112)",
      "ENOSPC: no space left",
    ]) {
      // Sidecar failures arrive as raw STRINGS from the Rust command, not
      // Errors — reading .message off them yields undefined.
      expect(translateExportError(text, null)).toMatch(/ran out of space/i);
    }
  });

  it("returns null for errors that are not about disk space", () => {
    // The caller falls back to the original text; guessing here would replace
    // a precise message with a wrong one.
    expect(translateExportError(new Error("GPU device lost during export"), null)).toBeNull();
    expect(translateExportError("Unknown animation format: bmp", null)).toBeNull();
    expect(
      translateExportError(new DOMException("Export cancelled", "AbortError"), null),
    ).toBeNull();
  });
});

describe("formatBytes", () => {
  it("reads the way a person would say it", () => {
    expect(formatBytes(7506e6)).toBe("7.5 GB");
    expect(formatBytes(3.2e9)).toBe("3.2 GB");
    expect(formatBytes(512e6)).toBe("512 MB");
  });
});
