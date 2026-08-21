// Fetch the pinned LGPL ffmpeg build for the export sidecar
// (ProRes 4444, 10-bit AV1, GIF, animated WebP).
// The binary is ~110 MB and deliberately NOT in git — run this once after
// cloning (and in CI) before `npm run tauri build`:
//
//   node scripts/fetch-ffmpeg.mjs
//
// LGPL build (no GPL components): ProRes uses ffmpeg's native prores_ks
// encoder, so nothing GPL is required. The binary ships as a SEPARATE
// sidecar executable next to the app, keeping the MIT app itself clean —
// see src-tauri/binaries/FFMPEG-LICENSE.txt.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadToFile } from "./lib/download.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST = path.join(ROOT, "src-tauri", "binaries", "ffmpeg-x86_64-pc-windows-msvc.exe");

// Pinned: BtbN release-branch build of ffmpeg 8.1 (win64, LGPL, static).
//
// RETENTION RULE (learned 2026-08-01 when the previous mid-month pin 404'd
// and broke CI): BtbN keeps only ~2 weeks of daily autobuilds, but the LAST
// autobuild of each month is retained permanently (verified back to 2023).
// ONLY pin month-end tags, or this breaks again two weeks after the bump.
const TAG = "autobuild-2026-07-31-14-10";
const ASSET = "ffmpeg-n8.1.2-34-g9b6c8969e0-win64-lgpl-8.1.zip";
const URL = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${TAG}/${ASSET}`;

// SHA-256 of the EXTRACTED ffmpeg.exe. The tag+filename alone do not pin
// anything: GitHub release assets are mutable, so the owning account (or an
// attacker who compromises it) can re-upload different bytes under the same
// name — and this script runs unattended on every release build and Rust CI
// run, with the result bundled into the shipped installer. Verified below;
// a mismatch is fatal rather than a warning.
const EXPECTED_SHA256 = "6099366f31293cdc6c283ea44ffb32f07e3139cd0caf6d0db652a7d064d089cb";

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

if (existsSync(DEST)) {
  console.log(`ffmpeg sidecar already present: ${DEST}`);
  process.exit(0);
}

console.log(`Downloading ${ASSET} (~140 MB)…`);
const tmpZip = path.join(ROOT, "src-tauri", "binaries", "_ffmpeg.zip");
mkdirSync(path.dirname(tmpZip), { recursive: true });
// Bounded retry for transient host failures (5xx/429/network drops); a 404
// or the checksum mismatch below stays immediately fatal — see lib/download.mjs.
await downloadToFile(URL, tmpZip);

console.log("Extracting ffmpeg.exe…");
const binDir = path.join(ROOT, "src-tauri", "binaries");
const extractDir = path.join(binDir, "_ffmpeg_extract");
rmSync(extractDir, { recursive: true, force: true });
mkdirSync(extractDir, { recursive: true });
// NOT `tar`: Git Bash puts GNU tar first in PATH and it reads neither zip
// archives nor "C:\" paths. PowerShell's Expand-Archive is always present
// on Windows (and on GitHub's windows runners); unzip covers the rest.
if (process.platform === "win32") {
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Expand-Archive -Path '_ffmpeg.zip' -DestinationPath '_ffmpeg_extract' -Force",
    ],
    { cwd: binDir },
  );
} else {
  execFileSync("unzip", ["-q", "_ffmpeg.zip", "-d", "_ffmpeg_extract"], { cwd: binDir });
}
const inner = ASSET.replace(/\.zip$/, "");
const extracted = path.join(extractDir, inner, "bin", "ffmpeg.exe");

// Verify BEFORE installing it as the sidecar, so a mismatched binary never
// reaches src-tauri/binaries (and therefore never reaches an installer).
const actual = sha256(extracted);
if (actual !== EXPECTED_SHA256) {
  rmSync(tmpZip, { force: true });
  rmSync(extractDir, { recursive: true, force: true });
  throw new Error(
    `ffmpeg checksum mismatch — refusing to install.\n` +
      `  expected ${EXPECTED_SHA256}\n  actual   ${actual}\n` +
      `The pinned release asset changed. Verify the upstream build before ` +
      `updating EXPECTED_SHA256 in this script.`,
  );
}

renameSync(extracted, DEST);
rmSync(tmpZip, { force: true });
rmSync(extractDir, { recursive: true, force: true });
console.log(`OK: ${DEST} (sha256 verified)`);
