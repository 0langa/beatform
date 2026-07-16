// Fetch the pinned LGPL ffmpeg build for the ProRes export sidecar.
// The binary is ~110 MB and deliberately NOT in git — run this once after
// cloning (and in CI) before `npm run tauri build`:
//
//   node scripts/fetch-ffmpeg.mjs
//
// LGPL build (no GPL components): ProRes uses ffmpeg's native prores_ks
// encoder, so nothing GPL is required. The binary ships as a SEPARATE
// sidecar executable next to the app, keeping the MIT app itself clean —
// see src-tauri/binaries/FFMPEG-LICENSE.txt.
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST = path.join(ROOT, "src-tauri", "binaries", "ffmpeg-x86_64-pc-windows-msvc.exe");

// Pinned: BtbN release-branch build of ffmpeg 8.1 (win64, LGPL, static).
const TAG = "autobuild-2026-07-15-14-01";
const ASSET = "ffmpeg-n8.1.2-22-g94138f6973-win64-lgpl-8.1.zip";
const URL = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${TAG}/${ASSET}`;

if (existsSync(DEST)) {
  console.log(`ffmpeg sidecar already present: ${DEST}`);
  process.exit(0);
}

console.log(`Downloading ${ASSET} (~140 MB)…`);
const res = await fetch(URL, { redirect: "follow" });
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
const tmpZip = path.join(ROOT, "src-tauri", "binaries", "_ffmpeg.zip");
mkdirSync(path.dirname(tmpZip), { recursive: true });
await pipeline(res.body, createWriteStream(tmpZip));

console.log("Extracting ffmpeg.exe…");
const extractDir = path.join(ROOT, "src-tauri", "binaries", "_ffmpeg_extract");
rmSync(extractDir, { recursive: true, force: true });
// tar on Windows 10+ understands zip archives.
mkdirSync(extractDir, { recursive: true });
execFileSync("tar", ["-xf", tmpZip, "-C", extractDir]);
const inner = ASSET.replace(/\.zip$/, "");
renameSync(path.join(extractDir, inner, "bin", "ffmpeg.exe"), DEST);
rmSync(tmpZip, { force: true });
rmSync(extractDir, { recursive: true, force: true });
console.log(`OK: ${DEST}`);
