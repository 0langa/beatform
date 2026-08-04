// Fetch the pinned whisper.cpp CLI build for the lyrics sidecar (FEAT-004).
// ~57 MB of exe+DLLs, deliberately NOT in git — run once after cloning (and
// in CI) before `npm run tauri build`:
//
//   node scripts/fetch-whisper.mjs
//
// whisper.cpp is MIT (ggml authors); the bundled libopenblas.dll is
// BSD-3-Clause (OpenBLAS) — see src-tauri/binaries/WHISPER-LICENSE.txt.
// The OpenBLAS build is the exact artifact the FEAT-004 phase-1 spike
// benchmarked on the reference machine (whisper small RTF 0.24–0.42).
import {
  createWriteStream,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST_DIR = path.join(ROOT, "src-tauri", "binaries", "whisper");

// Pinned: whisper.cpp v1.9.1 (2026-06-19, commit f049fff) OpenBLAS win-x64
// build — the exact zip the FEAT-004 spike hash-verified in its license
// matrix. GitHub release assets are MUTABLE, so the tag+name alone pin
// nothing: the ZIP's SHA-256 is verified before anything is extracted, and a
// mismatch is fatal.
const TAG = "v1.9.1";
const ASSET = "whisper-blas-bin-x64.zip";
const URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${TAG}/${ASSET}`;
const EXPECTED_ZIP_SHA256 = "3c319eab3e87f85883e1ff3d14426c0a1986c661c5eb5985e8af431ed9c4f71f";

// The subset the sidecar needs: the CLI plus its runtime DLLs. The zip also
// carries servers, demos and SDL2 — none of that ships.
const WANTED = [
  "whisper-cli.exe",
  "whisper.dll",
  "ggml.dll",
  "ggml-base.dll",
  "ggml-blas.dll",
  "ggml-cpu-alderlake.dll",
  "ggml-cpu-cannonlake.dll",
  "ggml-cpu-cascadelake.dll",
  "ggml-cpu-haswell.dll",
  "ggml-cpu-icelake.dll",
  "ggml-cpu-sandybridge.dll",
  "ggml-cpu-skylakex.dll",
  "ggml-cpu-sse42.dll",
  "ggml-cpu-x64.dll",
  "libopenblas.dll",
];

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

if (WANTED.every((f) => existsSync(path.join(DEST_DIR, f)))) {
  console.log(`whisper-cli already present: ${DEST_DIR}`);
  process.exit(0);
}

console.log(`Downloading ${ASSET} (~72 MB)…`);
const res = await fetch(URL, { redirect: "follow" });
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
const binDir = path.join(ROOT, "src-tauri", "binaries");
mkdirSync(binDir, { recursive: true });
const tmpZip = path.join(binDir, "_whisper.zip");
await pipeline(res.body, createWriteStream(tmpZip));

// Verify the ZIP before extracting anything — the zip hash pins every file
// inside it, so per-file pins would be redundant.
const actual = sha256(tmpZip);
if (actual !== EXPECTED_ZIP_SHA256) {
  rmSync(tmpZip, { force: true });
  throw new Error(
    `whisper zip checksum mismatch — refusing to extract.\n` +
      `  expected ${EXPECTED_ZIP_SHA256}\n  actual   ${actual}\n` +
      `The pinned release asset changed. Verify upstream before updating ` +
      `EXPECTED_ZIP_SHA256 in this script.`,
  );
}

console.log("Extracting whisper-cli + runtime DLLs…");
const extractDir = path.join(binDir, "_whisper_extract");
rmSync(extractDir, { recursive: true, force: true });
mkdirSync(extractDir, { recursive: true });
// PowerShell Expand-Archive: always present on Windows + GitHub runners
// (Git Bash's GNU tar reads neither zips nor C:\ paths — fetch-ffmpeg lesson).
if (process.platform === "win32") {
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Expand-Archive -Path '_whisper.zip' -DestinationPath '_whisper_extract' -Force",
    ],
    { cwd: binDir },
  );
} else {
  execFileSync("unzip", ["-q", "_whisper.zip", "-d", "_whisper_extract"], { cwd: binDir });
}

// v1.9.1's zip nests everything under Release/.
const srcDir = path.join(extractDir, "Release");
mkdirSync(DEST_DIR, { recursive: true });
for (const f of WANTED) {
  const src = path.join(srcDir, f);
  if (!existsSync(src)) {
    rmSync(tmpZip, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
    throw new Error(`expected file missing from the verified zip: ${f}`);
  }
  copyFileSync(src, path.join(DEST_DIR, f));
}

rmSync(tmpZip, { force: true });
rmSync(extractDir, { recursive: true, force: true });
console.log(`OK: ${DEST_DIR} (${WANTED.length} files, zip sha256 verified)`);
