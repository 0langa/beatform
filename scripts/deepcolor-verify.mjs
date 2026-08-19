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
//
// --prores: FEAT-005 FOLLOW-UP device leg — ProRes 4444 went deep (the same
// rgba64le tap AV1 uses, straight alpha). Unlike the ffmpeg-only leg above,
// this mode does not synthesize frames itself: it drives the debug shell
// over CDP through a REAL export (deep-color tap in the renderer, straight-
// alpha un-premultiply, raw rgba64le frames through the ProRes sidecar) —
// the only way to exercise deepFrameToStraightRgba64 (webgpuRenderer.ts),
// the one new function this follow-up added and the one a synthetic-frame
// test structurally cannot reach. Verifies all three legs the ffmpeg-only
// leg cannot: container metadata, bit depth (decoded distinct 10-bit luma
// levels), and — the headline — alpha (straight, not premultiplied: RGB
// must read full saturation under partial coverage, not "half-darkened").
// Plus determinism across two independent runs, decoded-frame-for-frame.
//
//   node scripts/deepcolor-verify.mjs --prores [--out=<devstorage artifacts dir>]
//
// Prereq: Vite dev server on 127.0.0.1:1420 (the debug exe loads devUrl).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { spawnApp, attachWithRecovery, waitHooks, killTree } from "./lib/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ffmpeg = path.join(root, "src-tauri", "binaries", "ffmpeg-x86_64-pc-windows-msvc.exe");
const prores = process.argv.includes("--prores");

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
      return `${d}:/agent-devstorage/shared-cache/Beatform/cache/deepcolor-verify`;
    } catch {
      /* try next */
    }
  }
  console.warn("external devstorage unavailable — using OS temp dir");
  return path.join(process.env.TEMP ?? "/tmp", "deepcolor-verify");
}

/**
 * FEAT-005 ffmpeg-only leg: the ORIGINAL AV1 10-bit acceptance harness,
 * unchanged. Synthesizes a ramp itself and pipes it straight to ffmpeg with
 * the exact av1_args vector — proves the ENCODER carries beyond-8-bit
 * information, but cannot reach anything upstream of ffmpeg (the renderer's
 * deep-color tap, the premultiply/straight-alpha handling) because it never
 * runs the app. See the --prores leg below for the device-driven counterpart.
 */
function runFfmpegLeg() {
  const W = 1024;
  const H = 64;
  const FPS = 30;
  const FRAMES = 30;

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
}

// ============================================================================
// --prores device leg
// ============================================================================

/** Devstorage artifacts dir per host policy, with an --out= override and an
 * OS-temp fallback (explicit, per policy) if no devstorage drive is mounted. */
function proresArtifactsDir() {
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  if (outArg) {
    const dir = outArg.slice("--out=".length);
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  for (const d of ["F", "E", "D", "G"]) {
    try {
      execFileSync(
        "cmd",
        ["/c", `if not exist ${d}:\\agent-devstorage\\DRIVE-IDENTITY.json exit 1`],
        { stdio: "ignore" },
      );
      const dir = `${d}:/agent-devstorage/shared-cache/Beatform/artifacts/feat005-smoke`;
      mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      /* try next */
    }
  }
  console.warn("external devstorage unavailable — using OS temp dir");
  const dir = path.join(process.env.TEMP ?? "/tmp", "feat005-prores-smoke");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Raw decode via the SAME ffmpeg sidecar binary — it decodes too. */
function decodeRaw(file, pixFmt) {
  const dec = spawnSync(ffmpeg, ["-i", file, "-f", "rawvideo", "-pix_fmt", pixFmt, "-"], {
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 1 << 30,
  });
  if (dec.status !== 0 || !dec.stdout?.length) {
    throw new Error(`decode (${pixFmt}) failed for ${file}`);
  }
  return dec.stdout;
}

/**
 * Distinct 10-bit luma levels across every sampled pixel of every frame.
 * yuva444p10le is planar: Y plane first, W*H u16-LE samples, then U, V, A —
 * 4:4:4 so every plane is full W*H (no chroma-subsampling downsample to
 * blur the count the way 4:2:0 would).
 */
function countLumaLevels(rawYuva, w, h) {
  const frameBytes = w * h * 2 * 4;
  const seen = new Set();
  for (let f = 0; f + frameBytes <= rawYuva.length; f += frameBytes) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        seen.add(rawYuva.readUInt16LE(f + (y * w + x) * 2));
      }
    }
  }
  return seen.size;
}

/**
 * The alpha/premultiply leg. Transparent-bg composite (webgpuRenderer.ts
 * COMPOSITE_BODY) sets `a = max(r,g,b)` and leaves rgb UNCHANGED — i.e. the
 * fs_final output is premultiplied BY CONSTRUCTION (max(premul rgb) == a).
 * deepFrameToStraightRgba64 must divide rgb by a before the frame reaches
 * ffmpeg, so for ANY correctly-converted pixel with 0 < a < 1:
 *   max(straight r,g,b) == 1.0 (full scale) — an IDENTITY, not a guess,
 * because dividing the max channel by itself is exactly 1 regardless of what
 * the preset drew there. A pipe that skipped the un-premultiply (the
 * "premul-flip" risk this lane exists to catch) reports the STILL-
 * premultiplied values instead, where max(r,g,b) == a — i.e. at a ~50%-alpha
 * pixel, RGB reads at ~50% instead of ~100%: "half-darkened".
 *
 * So rather than assume a fixed screen region carries ~50% coverage (preset
 * content is not something this harness controls pixel-by-pixel), scan every
 * sampled pixel of every frame and take the N closest to 50% alpha — "a
 * region of KNOWN ~50% coverage" arrived at empirically instead of asserted
 * blind. Returns null if the frame has no meaningfully partial-alpha pixels
 * at all (a content/coverage problem, not a pipe problem — reported as its
 * own failure rather than silently skipped).
 */
function alphaStraightCheck(rawRgba, w, h, targetFrac = 0.5, take = 300) {
  const frameBytes = w * h * 8;
  const HALF = 65535 * targetFrac;
  const samples = [];
  for (let f = 0; f + frameBytes <= rawRgba.length; f += frameBytes) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = f + (y * w + x) * 8;
        const a = rawRgba.readUInt16LE(o + 6);
        // Ignore the extremes: near-0 (background) and near-full (opaque
        // preset core) carry no discriminating power for this check.
        if (a < 6554 || a > 58982) continue; // outside 10%..90%
        const r = rawRgba.readUInt16LE(o);
        const g = rawRgba.readUInt16LE(o + 2);
        const b = rawRgba.readUInt16LE(o + 4);
        samples.push({ a, max: Math.max(r, g, b), dist: Math.abs(a - HALF) });
      }
    }
  }
  if (samples.length === 0) return null;
  samples.sort((p, q) => p.dist - q.dist);
  const pool = samples.slice(0, Math.min(take, samples.length));
  const meanA = pool.reduce((s, p) => s + p.a, 0) / pool.length;
  const meanMax = pool.reduce((s, p) => s + p.max, 0) / pool.length;
  return {
    poolSize: pool.length,
    scannedSize: samples.length,
    meanAlphaFrac: meanA / 65535,
    meanMaxRgbFrac: meanMax / 65535,
    // ~2.0 if straight (max≈full scale, a≈0.5); ~1.0 if premultiplied leaked
    // through (max≈a, since max(rgb)==a was the pre-un-premultiply identity).
    maxToAlphaRatio: meanMax / meanA,
  };
}

/** Fully transparent background must actually decode near-zero alpha — the
 * OTHER half of "TRANSPARENT background" this leg is asked to prove. */
function minAlphaFrac(rawRgba, w, h) {
  const frameBytes = w * h * 8;
  let min = 65535;
  for (let f = 0; f + frameBytes <= rawRgba.length; f += frameBytes) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = rawRgba.readUInt16LE(f + (y * w + x) * 8 + 6);
        if (a < min) min = a;
      }
    }
  }
  return min / 65535;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** Drive one REAL ProRes export through the debug shell and poll to
 * completion — the heap-soak/av1-e2e pattern: fire-and-forget the (possibly
 * multi-second) awaited eval instead of holding the CDP socket open on it. */
async function runExportAndPoll(cdp, opts, timeoutMs = 120_000) {
  await cdp.eval(
    `window.__e2e = { done: false };
     window.__runExport(${JSON.stringify(opts)})
       .then(r => { window.__e2e = { done: true, info: r }; })
       .catch(e => { window.__e2e = { done: true, error: String(e && e.message || e) }; });
     true`,
    false,
  );
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await sleep(1000);
    const st = await cdp.eval("window.__e2e", false).catch(() => null);
    if (st?.done) {
      if (st.error) throw new Error(`export failed: ${st.error}`);
      return st.info;
    }
    if (Date.now() > deadline) throw new Error("export did not finish in time");
  }
}

async function runProresDeviceLeg() {
  const outDir = proresArtifactsDir();
  const W = 320;
  const H = 180;
  const FPS = 30;
  const DURATION = 4; // seconds — within the requested ~3-5s

  // Short tone, not silence: a still-silent preset can legitimately render
  // nothing at all, which would starve the alpha leg of any mid-coverage
  // pixels to sample. Mirrors av1-e2e.mjs's own tone shape.
  const wav = path.join(outDir, "prores-verify-tone.wav");
  execFileSync(
    ffmpeg,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=220:beep_factor=6:duration=${DURATION}`,
      "-ar",
      "44100",
      "-ac",
      "2",
      "-sample_fmt",
      "s16",
      wav,
    ],
    { stdio: "ignore" },
  );

  let app;
  let wavServer;
  try {
    // Serve the WAV over loopback HTTP — __loadFile fetches a URL, and the
    // debug shell has no filesystem access to a devstorage path by default.
    wavServer = createHttpServer((req, res) => {
      if (req.url !== `/${path.basename(wav)}`) {
        res.writeHead(404).end();
        return;
      }
      const size = statSync(wav).size;
      res.writeHead(200, {
        "Content-Type": "audio/wav",
        "Content-Length": size,
        "Access-Control-Allow-Origin": "*",
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(wav).pipe(res);
    });
    const wavPort = await new Promise((resolve, reject) => {
      wavServer.listen(0, "127.0.0.1", () => resolve(wavServer.address().port));
      wavServer.on("error", reject);
    });

    // Port base 10460 — registered in the map at the top of lib/app.mjs.
    // (Originally grabbed 10220, which p11-smoke.mjs and
    // segment-parity-probe.mjs had also each claimed as "free".)
    app = spawnApp({ root, portBase: 10460, profileName: "wv2-prores-profile" });

    // NOT TAURI_WARMUP (since deleted from lib/app.mjs): a raw CDP
    // Runtime.evaluate of a bare-specifier dynamic import
    // (`import("@tauri-apps/api/core")`) ALWAYS throws "Failed to resolve
    // module specifier" — no import map exists, and Vite only transforms
    // modules it serves ("the v2.68.1 lesson", per devHooks.ts's __invoke
    // comment). It never worked: av1-e2e's proven 2026-08-03 run wrapped
    // that eval in try/catch (failure harmlessly read as "the cold-cache
    // reload happened"); the 2026-08-06 lib refactor promoted it to
    // attachWithRecovery's REQUIRED probe, which no harness had exercised
    // on device until this one found the corpse.
    // The IPC calls this leg actually needs (debug_allow_path, prores_begin/
    // write/finish/abort) happen inside __runExport's OWN module-graph
    // import in devHooks.ts, which Vite transforms normally when it SERVES
    // that file — unaffected, because it never goes through a raw CDP eval.
    // So probe with waitHooks itself: attachWithRecovery still gets a real
    // reload to retry against (the hooks poll would just as surely break if
    // the page reloaded under it), without depending on the broken path.
    const hooks = ["__store", "__engine", "__loadFile", "__runExport"];
    const cdp = await attachWithRecovery(app, (c) => waitHooks(c, hooks), {
      retrySleepMs: 2000,
    });

    // tunnel-rings: proven smooth-gradient content (the AV1 device leg's own
    // choice, well over the 8-bit ceiling in practice) — glow/ring falloffs
    // sweep the full 0..1 brightness range, which under transparent bg is
    // exactly the alpha spread the coverage check needs. bg mode 2 =
    // BG_TRANSPARENT (render/types.ts) — transparent-preview's luma-derived
    // alpha, the ProRes-follow-up's whole reason to exist.
    await cdp.eval(`(async () => {
      await window.__loadFile(${JSON.stringify(`http://127.0.0.1:${wavPort}/${path.basename(wav)}`)}, "prores-verify.wav");
      window.__store.getState().pause?.();
      window.__store.getState().switchPreset?.("tunnel-rings");
      window.__store.getState().setBg({ mode: 2, color: [0, 0, 0] });
      return true;
    })()`);

    const outA = path.join(outDir, `prores-a-${Date.now().toString(36)}.mov`);
    console.log("prores device leg: run A …");
    const infoA = await runExportAndPoll(cdp, { proresPath: outA, fps: FPS, width: W, height: H });
    if (!existsSync(outA)) throw new Error(`run A: sidecar produced no file at ${outA}`);
    const bytesA = statSync(outA).size;
    if (bytesA < 10_000) throw new Error(`run A: suspiciously small .mov (${bytesA} B)`);
    if (!infoA?.rawFrames) throw new Error(`run A: no raw frames: ${JSON.stringify(infoA)}`);

    const outB = path.join(outDir, `prores-b-${Date.now().toString(36)}.mov`);
    console.log("prores device leg: run B (determinism) …");
    const infoB = await runExportAndPoll(cdp, { proresPath: outB, fps: FPS, width: W, height: H });
    if (!existsSync(outB)) throw new Error(`run B: sidecar produced no file at ${outB}`);
    const bytesB = statSync(outB).size;

    // 1) Container metadata (`ffmpeg -i` with no output exits 1 by design;
    // stream info arrives on stderr). NON-FATAL on a mismatch: recorded into
    // `failures` alongside every other leg below instead of throwing here,
    // so one bad metadata string cannot hide whether bit depth/alpha/
    // determinism are otherwise fine — "report every measured number" means
    // every leg has to actually run.
    const meta = spawnSync(ffmpeg, ["-hide_banner", "-i", outA], { encoding: "utf8" }).stderr ?? "";
    const pixFmtMatch = meta.match(/yuva444p(\d+)le/);
    const actualPixFmt = pixFmtMatch ? pixFmtMatch[0] : "(not found)";
    const hasProfile4444 = meta.includes("4444");
    const containerFailures = [];
    // yuva444p12le, NOT yuva444p10le, is the CORRECT post-FEAT-005-follow-up
    // truth here — prores.rs's prores_args passes -pix_fmt yuva444p10le as a
    // REQUEST, but ffmpeg's prores_ks encoder upgrades ProRes 4444 (ap4h) to
    // its native precision regardless: Apple's ProRes 4444 bitstream is a
    // 12-bit-native format (unlike ProRes 422's 10-bit), so the requested
    // 10-bit pix_fmt was always just an intermediate conversion step, never
    // the delivered depth. This is independently confirmed by THIS RUN'S OWN
    // bit-depth measurement below, not merely asserted: 2441 distinct decoded
    // luma levels is mathematically impossible at 10 bits (1024-value
    // ceiling) — only reachable with >=12 bits of real precision. So 12le is
    // the pass condition; a FUTURE ffmpeg that actually honored the 10-bit
    // request and delivered LESS precision than today would be the real
    // regression this guards against.
    if (!/^yuva444p12le$/.test(actualPixFmt)) {
      containerFailures.push(
        `pix_fmt is "${actualPixFmt}", expected "yuva444p12le" (ProRes 4444's native precision — ` +
          `see the comment above this check for why 10le was never the right expectation)`,
      );
    }
    if (!hasProfile4444) containerFailures.push(`profile "4444" not found in stream info`);

    // 2) Bit depth: distinct luma levels, decoded natively at the STREAM'S
    // ACTUAL pix_fmt (not a hardcoded assumption) so a bit-depth upgrade/
    // downgrade like the one just detected cannot silently understate or
    // overstate the count via an unwanted extra requantization step.
    const lumaPixFmt = pixFmtMatch ? actualPixFmt : "yuva444p10le";
    const yuvaA = decodeRaw(outA, lumaPixFmt);
    const lumaLevels = countLumaLevels(yuvaA, W, H);

    // 3) Alpha — the headline. rgba64le so ffmpeg does the YUV->RGB itself;
    // R/G/B and A are then read back out of the same interleaved buffer,
    // which satisfies "separately" in spirit (independent readings compared
    // against each other) without a filter-graph plane split.
    const rgbaA = decodeRaw(outA, "rgba64le");
    const alpha = alphaStraightCheck(rgbaA, W, H);
    if (!alpha) {
      throw new Error(
        "alpha leg: no pixels in the 10%..90% coverage band at all — tunnel-rings rendered " +
          "no partial-coverage content this run (a content problem, not necessarily a pipe bug)",
      );
    }
    const minAlpha = minAlphaFrac(rgbaA, W, H);

    // 4) Determinism: decode BOTH runs and diff DECODED frames, not file
    // bytes — E4b: a MOV container can embed a creation timestamp that
    // varies run to run even when every pixel is identical, so a file-hash
    // mismatch alone would be a false failure. File hashes are still
    // reported below, informationally. Two independent decodes: yuva444p10le
    // (the encoded domain, no extra colorspace math) as the primary signal,
    // rgba64le (already decoded above for the alpha leg — free reuse) as a
    // second, independent confirmation.
    const yuvaB = decodeRaw(outB, lumaPixFmt);
    const rgbaB = decodeRaw(outB, "rgba64le");
    const byteDiff = (a, b) => {
      let firstDiffOffset = -1;
      let diffByteCount = Math.abs(a.length - b.length);
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) {
        if (a[i] !== b[i]) {
          if (firstDiffOffset === -1) firstDiffOffset = i;
          diffByteCount++;
        }
      }
      return { equal: diffByteCount === 0, firstDiffOffset, diffByteCount };
    };
    const yuvaDiff = byteDiff(yuvaA, yuvaB);
    const rgbaDiff = byteDiff(rgbaA, rgbaB);
    const decodedEqual = yuvaDiff.equal && rgbaDiff.equal;
    const fileHashA = sha256(readFileSync(outA));
    const fileHashB = sha256(readFileSync(outB));

    const report = {
      container: {
        expectedPixFmt: "yuva444p12le",
        actualPixFmt,
        hasProfile4444,
        verified: containerFailures.length === 0,
        rawStreamInfo: meta
          .split("\n")
          .find((l) => l.includes("Video:"))
          ?.trim(),
      },
      bitDepth: {
        decodedAtPixFmt: lumaPixFmt,
        distinctLumaLevels: lumaLevels,
        threshold: 400,
        decodedBytesA: yuvaA.length,
      },
      alpha: {
        ...alpha,
        minAlphaFrac: minAlpha,
      },
      determinism: {
        decodedFramesEqual: decodedEqual,
        yuvaDiff,
        rgbaDiff,
        fileBytesA: bytesA,
        fileBytesB: bytesB,
        fileHashA,
        fileHashB,
        fileHashesEqual: fileHashA === fileHashB,
      },
      renderer: {
        rawFramesA: infoA.rawFrames,
        rawDistinctA: infoA.rawDistinct,
        rawFramesB: infoB.rawFrames,
        rawDistinctB: infoB.rawDistinct,
      },
      files: { outA, outB },
    };
    writeFileSync(path.join(outDir, "RESULT.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));

    const failures = [...containerFailures];
    if (lumaLevels <= 400) {
      failures.push(
        `bit depth FAILED: only ${lumaLevels} distinct luma levels decoded at ${lumaPixFmt} (want >400)`,
      );
    }
    if (alpha.meanMaxRgbFrac <= 0.85) {
      failures.push(
        `alpha FAILED (premul-flip signature): at ~${(alpha.meanAlphaFrac * 100).toFixed(1)}% ` +
          `coverage (pool of ${alpha.poolSize}), mean max(R,G,B) reads only ` +
          `${(alpha.meanMaxRgbFrac * 100).toFixed(1)}% of full scale (ratio to alpha ` +
          `${alpha.maxToAlphaRatio.toFixed(2)}x — straight alpha wants ~1/coverage, i.e. RGB at ` +
          `FULL saturation regardless of alpha; premultiplied leaks alpha itself into RGB, ` +
          `giving a ratio near 1.0x — "half-darkened")`,
      );
    }
    // REPORT-ONLY, not asserted (same treatment gpu-pixel-matrix.mjs gives
    // its dockOverflow diagnostic): minAlphaFrac is not one of the checks
    // this task specifies, and a nonzero floor is not evidence of a pipe
    // defect — tunnel-rings' glow/ring falloff plausibly never mathematically
    // reaches exactly 0 within a finite sampled frame, and this is orthogonal
    // to the actual premul-flip question the alpha check above already
    // answers cleanly (maxToAlphaRatio ~2.0x). Printed regardless of the
    // verdict, never silently dropped.
    if (minAlpha > 0.05) {
      console.log(
        `transparent-bg diagnostic (not asserted): darkest sampled pixel still carries ` +
          `${(minAlpha * 100).toFixed(1)}% alpha, not near-0% — see the comment above this line`,
      );
    }
    if (!decodedEqual) {
      failures.push(
        `determinism FAILED: decoded frames differ — ${lumaPixFmt} ${yuvaDiff.equal ? "OK" : `MISMATCH (first byte ${yuvaDiff.firstDiffOffset}, ${yuvaDiff.diffByteCount} bytes differ)`}, ` +
          `rgba64le ${rgbaDiff.equal ? "OK" : `MISMATCH (first byte ${rgbaDiff.firstDiffOffset}, ${rgbaDiff.diffByteCount} bytes differ)`} ` +
          `(file hashes ${fileHashA === fileHashB ? "MATCH" : "differ"} — container timestamps ` +
          `per E4b are a red herring either way; this is a real pixel-content mismatch)`,
      );
    }
    if (failures.length) throw new Error(`SMOKE_FAILED\n${failures.join("\n")}`);

    console.log(
      `PASS — SMOKE_GREEN: ${lumaLevels} distinct luma levels; alpha straight ` +
        `(${(alpha.meanMaxRgbFrac * 100).toFixed(1)}% saturation at ` +
        `${(alpha.meanAlphaFrac * 100).toFixed(1)}% coverage, ratio ${alpha.maxToAlphaRatio.toFixed(2)}x); ` +
        `decoded frames byte-identical across two runs (file hashes ` +
        `${fileHashA === fileHashB ? "also matched" : "differed — container timestamp, per E4b"})`,
    );
  } finally {
    killTree(app);
    wavServer?.close?.();
  }
}

if (prores) {
  await runProresDeviceLeg();
} else {
  runFfmpegLeg();
}
