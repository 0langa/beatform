// FEAT-005 acceptance harness, ffmpeg leg: prove that the AV1 10-bit sidecar
// pipeline carries MORE than 8 bits of information end to end. No existing
// tool measured exported pixel fidelity — every prior check was container
// metadata or decode-exits-0, which is exactly how an 8-bit-fed "10-bit"
// output can masquerade (see BACKLOG.md FEAT-005: ProRes does today).
//
// Method: synthesize rgba64le frames carrying a smooth horizontal luminance
// ramp that spans 1024 distinct 10-bit steps but would collapse to ≤256
// distinct values in any 8-bit bottleneck. Pipe them through the EXACT
// encoder argument vector the Rust sidecar uses, then decode the file back
// to raw 10-bit YUV and count distinct luma levels along the ramp.
//
//   node scripts/deepcolor-verify.mjs
//
// PASS requires: ffprobe reports yuv420p10le + bt709 primaries/transfer/
// matrix, and the decoded ramp holds > 400 distinct luma levels (8-bit
// ceiling would be ≤ 256 even before chroma subsampling losses; AV1 at
// crf 24 keeps a clean ramp well above 400).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ffmpeg = path.join(root, "src-tauri", "binaries", "ffmpeg-x86_64-pc-windows-msvc.exe");
const W = 1024;
const H = 64;
const FPS = 30;
const FRAMES = 30;

// Scratch on devstorage per host policy; fall back to the OS temp dir with an
// explicit note if no devstorage drive is mounted.
function scratchDir() {
  for (const d of ["F", "E", "D", "G"]) {
    try {
      execFileSync(
        "cmd",
        ["/c", `if not exist ${d}:\\agent-devstorage\\DRIVE-IDENTITY.json exit 1`],
        {
          stdio: "ignore",
        },
      );
      return `${d}:/agent-devstorage/shared-cache/audio-visualizer/cache/deepcolor-verify`;
    } catch {
      /* try next */
    }
  }
  console.warn("external devstorage unavailable — using OS temp dir");
  return path.join(process.env.TEMP ?? "/tmp", "deepcolor-verify");
}

const dir = scratchDir();
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const out = path.join(dir, "ramp.mp4");
const wav = path.join(dir, "silence.wav");

// 0.5 s of silence for the audio input the arg vector expects.
execFileSync(
  ffmpeg,
  ["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(FRAMES / FPS), wav],
  { stdio: "ignore" },
);

// One frame: horizontal ramp, 1024 columns -> 1024 distinct 10-bit-scale
// values, constant down each column. rgba64le = little-endian u16 RGBA.
const frame = Buffer.alloc(W * H * 8);
for (let x = 0; x < W; x++) {
  // Map column to a u16 so consecutive columns differ by exactly 64 = one
  // 10-bit step (65535/1023 ≈ 64.06) — invisible at 8 bits (4 columns per
  // 8-bit step), fully resolvable at 10.
  const v = Math.round((x / (W - 1)) * 65535);
  for (let y = 0; y < H; y++) {
    const o = (y * W + x) * 8;
    frame.writeUInt16LE(v, o);
    frame.writeUInt16LE(v, o + 2);
    frame.writeUInt16LE(v, o + 4);
    frame.writeUInt16LE(65535, o + 6);
  }
}

// EXACT vector the Rust sidecar uses (keep in lockstep with av1_args in
// src-tauri/src/prores.rs — the cargo contract test pins that side).
const args = [
  "-y",
  "-f",
  "rawvideo",
  "-pix_fmt",
  "rgba64le",
  "-s",
  `${W}x${H}`,
  "-framerate",
  String(FPS),
  "-i",
  "-",
  "-i",
  wav,
  "-c:v",
  "libsvtav1",
  "-preset",
  "6",
  "-crf",
  "24",
  "-pix_fmt",
  "yuv420p10le",
  "-color_primaries",
  "bt709",
  "-color_trc",
  "bt709",
  "-colorspace",
  "bt709",
  "-color_range",
  "tv",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-movflags",
  "+faststart",
  "-shortest",
  out,
];
const enc = spawnSync(ffmpeg, args, {
  input: Buffer.concat(Array.from({ length: FRAMES }, () => frame)),
  stdio: ["pipe", "ignore", "pipe"],
  maxBuffer: 1 << 28,
});
if (enc.status !== 0) {
  console.error(enc.stderr?.toString().slice(-2000));
  throw new Error(`encode failed (${enc.status})`);
}

// 1) Stream metadata must say what the ledger demands. (`ffmpeg -i` with no
// output exits 1 by design — the stream info arrives on stderr.)
const probeRun = spawnSync(ffmpeg, ["-hide_banner", "-i", out], { encoding: "utf8" });
const meta = probeRun.stderr ?? "";
const checks = ["av1", "yuv420p10le", "bt709"];
for (const c of checks) {
  if (!meta.includes(c))
    throw new Error(`metadata check failed: "${c}" not found in stream info\n${meta}`);
}

// 2) Decode back to raw 10-bit YUV and count distinct luma levels on the
// middle row of a middle frame.
const dec = spawnSync(
  ffmpeg,
  [
    "-i",
    out,
    "-frames:v",
    "1",
    "-ss",
    String((FRAMES / FPS) * 0.5),
    "-f",
    "rawvideo",
    "-pix_fmt",
    "yuv420p10le",
    "-",
  ],
  { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 },
);
if (dec.status !== 0 || !dec.stdout?.length) throw new Error("decode-back failed");
const luma = dec.stdout; // Y plane first: W*H u16 LE
const row = H >> 1;
const seen = new Set();
for (let x = 0; x < W; x++) seen.add(luma.readUInt16LE((row * W + x) * 2));
const distinct = seen.size;

const report = `deepcolor-verify: distinct 10-bit luma levels across ramp = ${distinct} (8-bit ceiling 256, pass threshold 400)`;
console.log(report);
writeFileSync(path.join(dir, "RESULT.txt"), report + "\n");
if (distinct <= 400)
  throw new Error("FAILED: ramp collapsed — pipeline is not carrying >8-bit information");
console.log("PASS — beyond-8-bit information survives encode + decode");
