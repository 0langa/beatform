// Export colorimetry gate — guards the R2-01 class of defect.
//
// What broke (R2-01): the ProRes lane's ffmpeg args carried no color tags, so
// the RGB->YUV conversion swscale performed was undeclared in the file and
// every NLE/player had to guess the matrix. The cargo contract tests pin WHAT
// arg vector the Rust side passes (prores.rs's args_are_exactly_the_proven_
// contract), but nothing proved what those flags DO — a tag that ffmpeg
// silently ignored, or a conversion that quietly ran BT.601 under a BT.709
// label, would have sailed through every existing check.
//
// So this script encodes a few synthetic PURE-RED rgba64le frames through arg
// vectors kept in lockstep with prores_args/av1_args (src-tauri/src/prores.rs
// — the cargo tests pin that side, the comments there point here), then for
// BOTH lanes:
//
//   1. asserts the stream metadata carries the bt709/tv tags (the bundled
//      build ships no separate ffprobe; `ffmpeg -i` prints the container's
//      color tuple on the Video: stream line, which is the same information
//      ffprobe's color_space/color_primaries/color_transfer fields carry),
//   2. decodes the file back to 10-bit YUV and asserts pure red's luma lands
//      at the BT.709 value — Y' = 0.2126 of full scale (tv-range) — within
//      ±0.02. A BT.601 conversion reads 0.299 there, so a wrong or missing
//      matrix is unmissable; this is the check that catches a conversion
//      whose TAGS lie. Measured against the pre-R2-01 vector on the bundled
//      build: the untagged ProRes lane really did encode Y'(red) = 0.3002 —
//      BT.601 pixels, not just missing labels — which is exactly the class
//      this gate exists to keep dead.
//
// GATES.md §3: mandatory when ProRes/AV1 sidecar arg vectors or color code
// changed.
//
//   node scripts/export-color-verify.mjs
//
// Prereq: the ffmpeg sidecar (scripts/fetch-ffmpeg.mjs) — nothing else; no
// dev server, no app build.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ffmpeg = path.join(root, "src-tauri", "binaries", "ffmpeg-x86_64-pc-windows-msvc.exe");
if (!existsSync(ffmpeg)) {
  throw new Error("ffmpeg sidecar not found — run scripts/fetch-ffmpeg.mjs first");
}

// Scratch on devstorage per host policy (deepcolor-verify.mjs's shape); fall
// back to the OS temp dir with an explicit note if no devstorage is mounted.
function scratchDir() {
  for (const d of ["F", "E", "D", "G"]) {
    try {
      execFileSync(
        "cmd",
        ["/c", `if not exist ${d}:\\agent-devstorage\\DRIVE-IDENTITY.json exit 1`],
        { stdio: "ignore" },
      );
      return `${d}:/agent-devstorage/shared-cache/Beatform/cache/export-color-verify`;
    } catch {
      /* try next */
    }
  }
  console.warn("external devstorage unavailable — using OS temp dir");
  return path.join(process.env.TEMP ?? "/tmp", "export-color-verify");
}

// Small and even-dimensioned (AV1's 4:2:0 requires even), fast to encode.
const W = 320;
const H = 180;
const FPS = 30;
const FRAMES = 30;

/** BT.709 luma of pure red, and the tv-range 10-bit code math. */
const RED_Y_709 = 0.2126;
const RED_Y_601 = 0.299; // what a mis-matrixed conversion would read
const TOLERANCE = 0.02;

/**
 * The two sidecar arg vectors, mirrored from src-tauri/src/prores.rs
 * (prores_args / av1_args). KEEP IN LOCKSTEP: the cargo contract tests pin
 * the Rust side byte for byte; this mirror is what lets the gate run without
 * building the app. `-hide_banner` is left off — this harness reads stderr
 * anyway.
 */
const LANES = [
  {
    name: "ProRes 4444 (prores_args)",
    ext: "mov",
    // ProRes 4444 stores 12-bit natively; prores_ks upgrades the 10le
    // request (FEAT-005 finding), so the decoder reports yuva444p12le.
    pixFmtRe: /yuva444p1[02]le/,
    args: (wav, out) => [
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
      "prores_ks",
      "-profile:v",
      "4444",
      "-pix_fmt",
      "yuva444p10le",
      // R2-01: the tags under test.
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-colorspace",
      "bt709",
      "-color_range",
      "tv",
      "-vendor",
      "apl0",
      "-c:a",
      "pcm_s16le",
      "-shortest",
      out,
    ],
  },
  {
    name: "AV1 10-bit (av1_args)",
    ext: "mp4",
    pixFmtRe: /yuv420p10le/,
    args: (wav, out) => [
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
    ],
  },
];

/** One pure-red rgba64le frame: R=65535, G=0, B=0, A=65535 per pixel. */
function redFrame() {
  const frame = Buffer.alloc(W * H * 8);
  for (let px = 0; px < W * H; px++) {
    frame.writeUInt16LE(65535, px * 8);
    frame.writeUInt16LE(65535, px * 8 + 6);
  }
  return frame;
}

function verifyLane(lane, dir, wav) {
  const out = path.join(dir, `red.${lane.ext}`);
  const enc = spawnSync(ffmpeg, lane.args(wav, out), {
    input: Buffer.concat(Array.from({ length: FRAMES }, redFrame)),
    stdio: ["pipe", "ignore", "pipe"],
    maxBuffer: 1 << 28,
  });
  if (enc.status !== 0) {
    console.error(enc.stderr?.toString().slice(-2000));
    throw new Error(`${lane.name}: encode failed (${enc.status})`);
  }

  // 1) Stream metadata. `ffmpeg -i` with no output exits 1 by design; the
  // stream info arrives on stderr. The color tuple prints inside the pix_fmt
  // parens — "(tv, bt709, ...)" when range+primaries/trc/matrix all landed.
  const meta = spawnSync(ffmpeg, ["-hide_banner", "-i", out], { encoding: "utf8" }).stderr ?? "";
  const videoLine = meta
    .split("\n")
    .find((l) => l.includes("Video:"))
    ?.trim();
  if (!videoLine) throw new Error(`${lane.name}: no Video stream line in:\n${meta}`);
  const failures = [];
  if (!lane.pixFmtRe.test(videoLine)) {
    failures.push(`pix_fmt: expected ${lane.pixFmtRe} in "${videoLine}"`);
  }
  if (!videoLine.includes("bt709")) {
    failures.push(`color tags: "bt709" missing from "${videoLine}"`);
  }
  if (!/\(tv, bt709/.test(videoLine)) {
    failures.push(`color range: "(tv, bt709" tuple missing from "${videoLine}"`);
  }

  // 2) Decode a mid-clip frame back to 10-bit 4:4:4 and read the Y plane.
  // YUV->YUV format conversion is plane/bit-depth work only — no matrix math
  // (that only happens crossing YUV<->RGB) — so the codes we read are the
  // codes the encoder wrote.
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
      "yuv444p10le",
      "-",
    ],
    { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 },
  );
  if (dec.status !== 0 || !dec.stdout?.length) {
    throw new Error(`${lane.name}: decode-back failed`);
  }
  const luma = dec.stdout; // planar: Y first, W*H u16 LE
  const row = H >> 1;
  let sum = 0;
  for (let x = 0; x < W; x++) sum += luma.readUInt16LE((row * W + x) * 2);
  // tv-range 10-bit: Y' = (code - 64) / 876 (16..235 scaled x4 = 64..940).
  const yNorm = (sum / W - 64) / 876;
  if (Math.abs(yNorm - RED_Y_709) > TOLERANCE) {
    failures.push(
      `decoded pure-red Y' = ${yNorm.toFixed(4)}, want ${RED_Y_709} ±${TOLERANCE}` +
        (Math.abs(yNorm - RED_Y_601) <= TOLERANCE
          ? " — this is the BT.601 value: the conversion matrix is wrong"
          : ""),
    );
  }

  const verdict = failures.length === 0;
  console.log(
    `${verdict ? "PASS" : "FAIL"}  ${lane.name}: Y'(red)=${yNorm.toFixed(4)} ` +
      `(bt709 wants ${RED_Y_709}, bt601 would read ${RED_Y_601})\n      ${videoLine}`,
  );
  return { lane: lane.name, videoLine, redLumaNormalized: yNorm, failures };
}

const dir = scratchDir();
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

// Silence for the audio input both arg vectors expect.
const wav = path.join(dir, "silence.wav");
execFileSync(
  ffmpeg,
  ["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(FRAMES / FPS), wav],
  { stdio: "ignore" },
);

const results = LANES.map((lane) => verifyLane(lane, dir, wav));
writeFileSync(path.join(dir, "RESULT.json"), `${JSON.stringify(results, null, 2)}\n`);

const failed = results.filter((r) => r.failures.length > 0);
if (failed.length > 0) {
  throw new Error(
    `COLOR_VERIFY_FAILED\n${failed.map((r) => `${r.lane}:\n  ${r.failures.join("\n  ")}`).join("\n")}`,
  );
}
console.log("PASS — both sidecar lanes tag AND convert BT.709/tv");
