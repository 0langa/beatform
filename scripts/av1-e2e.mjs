// FEAT-005 device end-to-end proof: drives the debug shell (Vite dev frontend
// + Tauri IPC) over the WebView2 devtools protocol through a REAL AV1 10-bit
// export — deep-color tap in the renderer, raw rgba64le frames through the
// av1 ffmpeg sidecar, finished .mp4 on devstorage — then verifies the file:
//   1. renderer leg: >256 distinct u16 red values in the final raw frame
//      (an 8-bit-quantized source cannot exceed 256)
//   2. container: av1 + yuv420p10le + bt709 stream metadata
//   3. decode-back: >256 distinct 10-bit luma levels across the frames
//
//   node scripts/av1-e2e.mjs --out=<devstorage artifacts dir>
//
// Prereq: Vite dev server on 127.0.0.1:1420 (the debug exe loads devUrl).
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = (process.argv.find((a) => a.startsWith("--out=")) ?? "").slice("--out=".length);
if (!outDir) throw new Error("--out=<dir> is required (devstorage artifacts dir)");
mkdirSync(outDir, { recursive: true });
const ffmpeg = path.join(root, "src-tauri", "binaries", "ffmpeg-x86_64-pc-windows-msvc.exe");
const exe = path.join(root, "src-tauri", "target", "debug", "beatform.exe");
const port = 9700 + (process.pid % 80);
const endpoint = `http://127.0.0.1:${port}`;
const W = 640;
const H = 360;
const FPS = 30;
let child;
let log = "";

// Short but real: 8 s of tonal audio so the visual actually moves.
function ensureWav() {
  const wav = path.join(outDir, "av1-e2e-8s.wav");
  if (existsSync(wav)) return wav;
  execFileSync(
    ffmpeg,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=55:beep_factor=8:duration=8",
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
  return wav;
}

async function page() {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`app exited ${child.exitCode}\n${log}`);
    try {
      const pages = await fetch(`${endpoint}/json/list`).then((r) => r.json());
      const match = pages.find(
        (p) => p.type === "page" && p.webSocketDebuggerUrl && /localhost|127\.0\.0\.1/.test(p.url),
      );
      if (match) return match;
    } catch {
      /* not ready */
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for WebView2\n${log}`);
}

class Cdp {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.ws = new globalThis.WebSocket(url);
  }
  async open() {
    await new Promise((res, rej) => {
      this.ws.addEventListener("open", res, { once: true });
      this.ws.addEventListener("error", rej, { once: true });
    });
    this.ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message));
      else p.resolve(m.result);
    });
    await this.send("Runtime.enable");
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, awaitPromise = true) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails.exception;
      throw new Error(
        ex?.description ??
          (ex?.value != null ? JSON.stringify(ex.value) : null) ??
          r.exceptionDetails.text ??
          "eval failed",
      );
    }
    return r.result.value;
  }
}

let wavServer;
try {
  const wav = ensureWav();
  const outMp4 = path.join(outDir, `av1-e2e-${Date.now().toString(36)}.mp4`);

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

  const existingArgs = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? "";
  child = spawn(exe, [], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        `${existingArgs} --remote-debugging-port=${port}`.trim(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keep = (c) => (log = (log + c.toString()).slice(-20_000));
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);

  const attach = async () => {
    const target = await page();
    const c = new Cdp(target.webSocketDebuggerUrl);
    await c.open();
    return c;
  };
  let cdp = await attach();

  // Warm up the dynamic @tauri-apps/api import FIRST: on a cold Vite dep
  // cache this triggers "new dependencies optimized — reloading page", which
  // destroys the execution context. Absorb that here and re-attach, so the
  // real run below never gets reloaded out from under the export.
  try {
    await cdp.eval(`import("@tauri-apps/api/core").then(() => true)`);
  } catch {
    await sleep(2000);
    cdp = await attach();
  }

  // Wait for hooks, load the track, pick a smooth-gradient preset (tunnel),
  // then start the REAL av1 lane WITHOUT awaiting it (heap-soak pattern:
  // a multi-minute awaited eval is fragile over the CDP socket) and poll.
  await cdp.eval(`(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const deadline = Date.now() + 60000;
    while (!window.__store || !window.__engine || !window.__loadFile || !window.__runExport) {
      if (Date.now() > deadline) throw new Error("hooks unavailable");
      await delay(100);
    }
    await window.__loadFile(${JSON.stringify(`http://127.0.0.1:${wavPort}/${path.basename(wav)}`)}, "e2e.wav");
    window.__store.getState().pause?.();
    window.__store.getState().switchPreset?.("tunnel");
    return true;
  })()`);
  await cdp.eval(
    `window.__e2e = { done: false };
     window.__runExport({
       av1Path: ${JSON.stringify(outMp4)},
       fps: ${FPS}, width: ${W}, height: ${H},
     })
       .then(r => { window.__e2e = { done: true, info: r }; })
       .catch(e => { window.__e2e = { done: true, error: String(e && e.message || e) }; });
     true`,
    false,
  );
  let info;
  const exportDeadline = Date.now() + 300_000;
  for (;;) {
    await sleep(2000);
    const st = await cdp.eval("window.__e2e", false).catch(() => null);
    if (st?.done) {
      if (st.error) throw new Error(`export failed: ${st.error}`);
      info = st.info;
      break;
    }
    if (Date.now() > exportDeadline) throw new Error("export did not finish in 5 min");
  }

  if (!info || !info.rawFrames) throw new Error(`no raw frames: ${JSON.stringify(info)}`);
  if (info.rawDistinct <= 256) {
    throw new Error(`renderer leg FAILED: only ${info.rawDistinct} distinct u16 red values`);
  }
  if (!existsSync(outMp4)) throw new Error(`sidecar produced no file at ${outMp4}`);
  const bytes = statSync(outMp4).size;
  if (bytes < 10_000) throw new Error(`suspiciously small mp4 (${bytes} B)`);

  // 2) container metadata (`ffmpeg -i` exits 1 by design; info is on stderr)
  const meta = spawnSync(ffmpeg, ["-hide_banner", "-i", outMp4], { encoding: "utf8" }).stderr;
  for (const want of ["av1", "yuv420p10le", "bt709"]) {
    if (!meta.includes(want)) throw new Error(`metadata missing "${want}":\n${meta}`);
  }

  // 3) decode-back: distinct 10-bit luma levels across sampled rows of every
  // 15th frame. yuv420p10le luma = w*h little-endian u16 per frame, values
  // 64..940 (tv range) at 10 bits — an 8-bit source collapses to <=256.
  const dec = spawnSync(
    ffmpeg,
    [
      "-i",
      outMp4,
      "-vf",
      "select=not(mod(n\\,15))",
      "-vsync",
      "0",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "yuv420p10le",
      "-",
    ],
    { maxBuffer: 1 << 30 },
  );
  if (dec.status !== 0) throw new Error(`decode failed: ${dec.stderr?.toString().slice(-1500)}`);
  const raw = dec.stdout;
  const frameBytes = W * H * 3; // 4:2:0 at 2 bytes/sample = w*h*3 bytes
  const levels = new Set();
  for (let f = 0; f + frameBytes <= raw.length; f += frameBytes) {
    for (let y = 0; y < H; y += 20) {
      for (let x = 0; x < W; x++) {
        levels.add(raw.readUInt16LE(f + (y * W + x) * 2));
      }
    }
  }
  if (levels.size <= 256) {
    throw new Error(
      `decode-back FAILED: only ${levels.size} distinct luma levels (8-bit ceiling: 256)`,
    );
  }

  console.log(
    `AV1-E2E OK: frames=${info.rawFrames} rawDistinct=${info.rawDistinct} ` +
      `bytes=${bytes} decodedLumaLevels=${levels.size} file=${outMp4}`,
  );
} finally {
  child?.kill();
  wavServer?.close?.();
  try {
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      "Get-Process -Name beatform -ErrorAction SilentlyContinue | Stop-Process -Force",
    ]);
  } catch {
    /* already gone */
  }
}
