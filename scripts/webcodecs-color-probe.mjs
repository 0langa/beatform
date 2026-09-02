// B5 (R2-30 remainder) device probe: does the WebCodecs H.264 lane — the
// default MP4 export, Chromium's VideoEncoder muxed by mediabunny — TAG its
// color space, and which matrix did the encoder actually use?
//
// R2-01 found the ProRes sidecar lane encoding BT.601 untagged; the sidecar
// lanes are now guarded by scripts/export-color-verify.mjs, which drives
// ffmpeg directly with the shipped arg vectors. The WebCodecs lane cannot be
// probed that way — the encoder lives inside WebView2 — so this harness drives
// the debug shell over CDP through a REAL export of a red document (solid red
// background, Spectrum Bars on digital silence, neutral post) and verifies the
// file with the bundled ffmpeg:
//   1. container: the Video stream line carries bt709 tags (tv range)
//   2. matrix: the renderer's OWN RGB of the same document, read from the PNG
//      lane (PNG is RGB — no matrix is involved reading it back), predicts what
//      Y' pure BT.709 and pure BT.601 would each produce; the H.264 Y' plane
//      of a mid-clip frame (YUV->YUV conversion is plane work only) says which
//      one the encoder wrote. Note the composite's tone curve means the red is
//      not (255,0,0); that is exactly why the source RGB is measured, not
//      assumed.
//
//   node scripts/webcodecs-color-probe.mjs --out=<devstorage artifacts dir>
//
// Prereq: Vite dev server on 127.0.0.1:1420 and a built debug shell
// (src-tauri/target/debug/beatform.exe). Not a gate (GATES.md §3 lists it
// under probe harnesses) until it earns a table row; exit 1 on a finding.
import { execFileSync, spawnSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { spawnApp, attachWithRecovery, waitHooks, killTree } from "./lib/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = (process.argv.find((a) => a.startsWith("--out=")) ?? "").slice("--out=".length);
if (!outDir) throw new Error("--out=<dir> is required (devstorage artifacts dir)");
mkdirSync(outDir, { recursive: true });
const ffmpeg = path.join(root, "src-tauri", "binaries", "ffmpeg-x86_64-pc-windows-msvc.exe");

const W = 320;
const H = 180;
const FPS = 30;
const DURATION_S = 4;
/** How far the measured Y' may sit from the winning matrix's prediction. */
const TOLERANCE = 0.02;

// Sample the upper-middle of the frame: solid background, above the bars'
// baseline even if a preset draws a floor line at silence.
const REGION = {
  r0: Math.floor(H * 0.1),
  r1: Math.floor(H * 0.45),
  c0: Math.floor(W * 0.25),
  c1: Math.floor(W * 0.75),
};

function ensureWav() {
  const wav = path.join(outDir, "silence-4s.wav");
  if (existsSync(wav)) return wav;
  // Digital silence: Spectrum Bars draws zero-height bars, so the frame is
  // the solid background — one flat color the decode-back can measure.
  execFileSync(
    ffmpeg,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-t",
      String(DURATION_S),
      "-c:a",
      "pcm_s16le",
      wav,
    ],
    { stdio: "ignore" },
  );
  return wav;
}

function serveWav(wav) {
  const server = createHttpServer((req, res) => {
    if (req.url !== `/${path.basename(wav)}`) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "audio/wav",
      "Content-Length": statSync(wav).size,
      "Access-Control-Allow-Origin": "*",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(wav).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
    server.on("error", reject);
  });
}

/** Decode one frame (a still, or the mid-clip frame of a video) to raw pixels. */
function decodeFrame(file, pixFmt, { mid = false } = {}) {
  const args = ["-i", file];
  if (mid) args.push("-ss", String(DURATION_S * 0.5));
  args.push("-frames:v", "1", "-f", "rawvideo", "-pix_fmt", pixFmt, "-");
  const dec = spawnSync(ffmpeg, args, { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26 });
  if (dec.status !== 0 || !dec.stdout?.length)
    throw new Error(`decode (${pixFmt}) of ${file} failed`);
  return dec.stdout;
}

/** Mean over REGION of an interleaved buffer with `stride` bytes per pixel,
 * channel `ch`. For a planar buffer the first plane is stride 1, channel 0. */
function regionMean(buf, stride, ch) {
  let sum = 0;
  let n = 0;
  for (let r = REGION.r0; r < REGION.r1; r++) {
    for (let c = REGION.c0; c < REGION.c1; c++) {
      sum += buf[(r * W + c) * stride + ch];
      n++;
    }
  }
  return sum / n;
}

function verify(mp4, png) {
  const failures = [];

  // 1) Container tags. `ffmpeg -i` exits 1 by design; the table is on stderr.
  const info = spawnSync(ffmpeg, ["-i", mp4], { encoding: "utf8" });
  const meta = `${info.stdout ?? ""}${info.stderr ?? ""}`;
  const videoLine = (
    meta.split(/\r?\n/).find((l) => /Stream #\d+:\d+.*Video:/.test(l)) ?? ""
  ).trim();
  if (!videoLine) throw new Error(`no Video stream line in:\n${meta}`);
  const tagged709 = /bt709/.test(videoLine);
  const tvRange = /\(tv\b/.test(videoLine);
  if (!tagged709) failures.push(`container: no bt709 tag on the video stream: "${videoLine}"`);
  if (!tvRange) failures.push(`container: range not tagged tv: "${videoLine}"`);

  // 2) Source truth from the renderer's own PNG frame.
  const rgb = decodeFrame(png, "rgb24");
  const src = [regionMean(rgb, 3, 0), regionMean(rgb, 3, 1), regionMean(rgb, 3, 2)];
  const [r, g, b] = src.map((v) => v / 255);
  if (!(r > 0.6 && g < 0.15 && b < 0.15)) {
    throw new Error(
      `PNG region is not red-dominant (rgb ${src.map(Math.round).join(",")}) — probe setup is wrong, not the lane`,
    );
  }
  const expect709 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const expect601 = 0.299 * r + 0.587 * g + 0.114 * b;

  // 3) What the encoder actually wrote, tv-range 8-bit: Y' = (code - 16) / 219.
  const yuv = decodeFrame(mp4, "yuv444p", { mid: true });
  const measured = (regionMean(yuv, 1, 0) - 16) / 219;
  const d709 = Math.abs(measured - expect709);
  const d601 = Math.abs(measured - expect601);
  let matrix = "unknown";
  if (d709 <= TOLERANCE && d709 <= d601) matrix = "bt709";
  else if (d601 <= TOLERANCE) matrix = "bt601";
  if (matrix !== "bt709") {
    failures.push(
      `decoded Y' = ${measured.toFixed(4)}; BT.709 predicts ${expect709.toFixed(4)}, ` +
        `BT.601 predicts ${expect601.toFixed(4)} — ` +
        (matrix === "bt601"
          ? "the encoder used the BT.601 matrix"
          : "matches neither within tolerance"),
    );
  }
  return {
    videoLine,
    tagged709,
    tvRange,
    sourceRgb: src.map((v) => Math.round(v)),
    expect709,
    expect601,
    measured,
    matrix,
    failures,
  };
}

/** Start an export through the dev hook WITHOUT awaiting it over the socket
 * (a multi-second awaited eval is fragile over CDP — av1-e2e pattern), poll
 * to completion, then pull the named Blob out base64. */
async function exportAndPull(cdp, opts, blobName) {
  await cdp.eval(
    `window.__e2e = { done: false };
     window.__runExport(${JSON.stringify(opts)})
       .then(r => { window.__e2e = { done: true, info: r }; })
       .catch(e => { window.__e2e = { done: true, error: String(e && e.message || e) }; });
     true`,
    false,
  );
  const deadline = Date.now() + 180_000;
  for (;;) {
    await sleep(1500);
    const st = await cdp.eval("window.__e2e", false).catch(() => null);
    if (st?.done) {
      if (st.error) throw new Error(`export ${JSON.stringify(opts)} failed: ${st.error}`);
      break;
    }
    if (Date.now() > deadline) throw new Error("export did not finish in 3 min");
  }
  const b64 = await cdp.eval(`(async () => {
    const b = window[${JSON.stringify(blobName)}];
    if (!b) throw new Error("no " + ${JSON.stringify(blobName)} + " after the export");
    const u8 = new Uint8Array(await b.arrayBuffer());
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  })()`);
  return Buffer.from(b64, "base64");
}

let app = null;
let wavServer = null;
try {
  const wav = ensureWav();
  const { server, port: wavPort } = await serveWav(wav);
  wavServer = server;

  app = spawnApp({
    root,
    portBase: 10540, // see the map in lib/app.mjs
    profileName: "wv2-webcodecs-color-profile",
  });
  const cdp = await attachWithRecovery(
    app,
    (c) => waitHooks(c, ["__store", "__engine", "__loadFile", "__runExport"]),
    { retrySleepMs: 2000 },
  );

  // Red document: solid background (BG_SOLID = 1), Spectrum Bars on silence;
  // the profile is fresh, so post and motion sit at their neutral defaults.
  await cdp.eval(`(async () => {
    await window.__loadFile(${JSON.stringify(`http://127.0.0.1:${wavPort}/${path.basename(wav)}`)}, "silence.wav");
    const s = window.__store.getState();
    s.pause?.();
    s.switchPreset?.("spectrum-bars");
    s.setBg?.({ mode: 1, color: [1, 0, 0] });
    return true;
  })()`);

  const mp4 = path.join(outDir, "webcodecs-h264-red.mp4");
  writeFileSync(
    mp4,
    await exportAndPull(cdp, { width: W, height: H, fps: FPS, codec: "h264" }, "__lastExportBlob"),
  );
  if (statSync(mp4).size < 2_000)
    throw new Error(`suspiciously small mp4 (${statSync(mp4).size} B)`);

  const png = path.join(outDir, "renderer-frame.png");
  writeFileSync(
    png,
    await exportAndPull(cdp, { width: W, height: H, fps: FPS, png: true }, "__lastPngFrame"),
  );

  const result = verify(mp4, png);
  writeFileSync(path.join(outDir, "webcodecs-color-probe.json"), JSON.stringify(result, null, 2));
  console.log(`video line : ${result.videoLine}`);
  console.log(`tagged     : bt709=${result.tagged709} tv=${result.tvRange}`);
  console.log(
    `source rgb : ${result.sourceRgb.join(",")} → BT.709 predicts Y' ${result.expect709.toFixed(4)}, BT.601 ${result.expect601.toFixed(4)}`,
  );
  console.log(`measured   : Y' ${result.measured.toFixed(4)} → ${result.matrix}`);
  if (result.failures.length) {
    console.error(`WEBCODECS_COLOR_FINDING\n  ${result.failures.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log("PASS — the WebCodecs H.264 lane tags AND encodes BT.709/tv");
  }
} finally {
  if (app) killTree(app);
  wavServer?.close();
}
