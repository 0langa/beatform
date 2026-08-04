// Build the lyrics sidecar (src-tauri/lyrics-sidecar) in release mode and
// install it where tauri's bundler expects an externalBin:
//
//   node scripts/build-lyrics-sidecar.mjs
//
// tauri-build validates externalBin at COMPILE time, so this must run before
// any `cargo build`/`tauri build`/`tauri dev` of the app — same contract as
// fetch-ffmpeg.mjs (CI runs both). Honors CARGO_TARGET_DIR redirects.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_TAURI = path.join(ROOT, "src-tauri");
// Only Windows is shipped today (same stance as fetch-ffmpeg's pinning).
const DEST = path.join(SRC_TAURI, "binaries", "lyrics-sidecar-x86_64-pc-windows-msvc.exe");

console.log("cargo build --release -p lyrics-sidecar…");
execFileSync("cargo", ["build", "--release", "-p", "lyrics-sidecar"], {
  cwd: SRC_TAURI,
  stdio: "inherit",
});

const targetDir = process.env.CARGO_TARGET_DIR ?? path.join(SRC_TAURI, "target");
const built = path.join(targetDir, "release", "lyrics-sidecar.exe");
if (!existsSync(built)) {
  throw new Error(`built binary not found at ${built}`);
}
mkdirSync(path.dirname(DEST), { recursive: true });
copyFileSync(built, DEST);
console.log(`OK: ${DEST}`);
