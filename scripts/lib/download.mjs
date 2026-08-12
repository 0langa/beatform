// Shared download step for the sidecar fetch scripts (fetch-ffmpeg,
// fetch-whisper, fetch-onnxruntime): bounded retry with exponential backoff
// for TRANSIENT failures only.
//
// Why: CI run 31643439746 (2026-08-12) died with "Download failed: HTTP 503"
// from the ffmpeg release host — a passing upstream outage that a single
// retry would have absorbed. So: 4 attempts total, waiting 2 s / 8 s / 30 s
// between them, and only for failures that can plausibly heal themselves
// (HTTP 5xx, 429, dropped connections / DNS hiccups — including drops
// mid-body, which surface from the stream pipeline rather than fetch()).
//
// What must NOT retry: a 404 (a vanished pin is a real breakage — see the
// BtbN retention rule in fetch-ffmpeg.mjs), other 4xx, and local filesystem
// errors. Checksum verification is deliberately OUTSIDE this helper: every
// caller hashes the downloaded bytes AFTER this resolves, exactly as before,
// so a mismatch stays immediately fatal and retries never touch it.
import { createWriteStream, rmSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";

// Waits between the four bounded attempts.
const RETRY_DELAYS_MS = [2_000, 8_000, 30_000];

// Local filesystem failures — retrying cannot fix a full disk or a
// permission problem, so these stay immediately fatal like a 404.
const FATAL_FS_CODES = new Set(["EACCES", "EPERM", "ENOSPC", "EROFS", "EISDIR", "ENOENT"]);

function isTransient(err) {
  if (typeof err?.httpStatus === "number") {
    return err.httpStatus === 429 || err.httpStatus >= 500;
  }
  // fetch() rejections wrap the network error in `cause`; stream/fs errors
  // carry the code directly. Anything not provably local is worth a retry.
  const code = err?.code ?? err?.cause?.code;
  return !FATAL_FS_CODES.has(code);
}

// Downloads `url` to `destFile`, following redirects. Resolves once the full
// body is on disk; throws the LAST attempt's error once retries are
// exhausted (so the terminal message stays the familiar
// "Download failed: HTTP NNN" the callers have always thrown).
export async function downloadToFile(url, destFile) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) {
        const err = new Error(`Download failed: HTTP ${res.status}`);
        err.httpStatus = res.status;
        throw err;
      }
      await pipeline(res.body, createWriteStream(destFile));
      return;
    } catch (err) {
      // Never leave a half-written file for the next attempt (or a later
      // run) to trip over.
      rmSync(destFile, { force: true });
      const delayMs = RETRY_DELAYS_MS[attempt - 1];
      if (delayMs === undefined || !isTransient(err)) throw err;
      const cause =
        typeof err.httpStatus === "number"
          ? `HTTP ${err.httpStatus}`
          : (err?.code ?? err?.cause?.code ?? err.message);
      console.warn(
        `  transient download failure (${cause}) — retrying in ${delayMs / 1000} s ` +
          `(attempt ${attempt + 1} of ${RETRY_DELAYS_MS.length + 1})…`,
      );
      await sleep(delayMs);
    }
  }
}
