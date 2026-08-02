// VERIFY-001: long-export renderer heap characterization.
//
// Drives the debug shell (Vite dev frontend + diagnostic hooks) over the
// WebView2 devtools protocol through a LONG deterministic export and samples,
// on a fixed wall-clock interval:
//   - JS heap (performance.memory.usedJSHeapSize) inside the renderer page
//   - working set of every beatform/msedgewebview2 process (PowerShell)
// The export uses the PNG-probe path (frames are hashed and DISCARDED — no
// video blob accumulates in memory, no file is written), so the measurement
// isolates the renderer/analysis loop the ledger asks about. Audio is a
// generated silence-free synthetic WAV on devstorage; NOTHING is written to
// C:. All processes are dropped to BelowNormal priority so the machine stays
// usable while it runs.
//
//   node scripts/heap-soak.mjs --minutes=85 --out=<dir>   (repeatable)
//   node scripts/heap-soak.mjs --minutes=5  --out=<dir>   (control run)
//
// Output: <out>/heap-soak-<minutes>min-<n>.csv  (elapsedSec, jsHeapMB,
// workingSetMB, processes) plus a summary line on stdout.
import { spawn, execFileSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const minutes = Number(
  (process.argv.find((a) => a.startsWith("--minutes=")) ?? "--minutes=85").slice(
    "--minutes=".length,
  ),
);
const outDir = (process.argv.find((a) => a.startsWith("--out=")) ?? "").slice("--out=".length);
if (!outDir) throw new Error("--out=<dir> is required (devstorage artifacts dir)");
mkdirSync(outDir, { recursive: true });
const port = 9700 + (process.pid % 80);
const endpoint = `http://127.0.0.1:${port}`;
const exe = path.join(root, "src-tauri", "target", "debug", "beatform.exe");
let child;
let log = "";

// --- synthetic long track: quiet 120bpm click+bass loop, mono 22.05k s16 ---
// (deterministic, compresses the decode cost realistically; ~<300 MB decoded
// at 85 min mono 22k — the decoded-buffer footprint is part of what VERIFY-001
// wants to observe.)
function ensureWav(seconds) {
  const wav = path.join(outDir, `soak-${seconds}s.wav`);
  if (existsSync(wav)) return wav;
  const ffmpeg = path.join(root, "src-tauri", "binaries", "ffmpeg-x86_64-pc-windows-msvc.exe");
  execFileSync(
    ffmpeg,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=55:beep_factor=8:duration=${seconds}`,
      "-ar",
      "22050",
      "-ac",
      "1",
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

// Only THIS app's processes: beatform.exe itself plus the msedgewebview2
// children whose command line carries Beatform's user-data folder. Summing or
// deprioritizing every WebView2 on the machine would hit the user's OTHER
// apps — off limits.
const PS_OURS =
  "$ids = @(Get-Process -Name beatform -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id); " +
  "$ids += @(Get-CimInstance Win32_Process -Filter 'Name=\"msedgewebview2.exe\"' -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match '[Bb]eatform' } | Select-Object -ExpandProperty ProcessId); " +
  "$procs = @($ids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }); ";

function workingSetMB() {
  try {
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        PS_OURS + "($procs | Measure-Object WorkingSet64 -Sum).Sum; $procs.Count",
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split(/\r?\n/);
    return { mb: Math.round(Number(out[0]) / 1048576), procs: Number(out[1]) };
  } catch {
    return { mb: -1, procs: -1 };
  }
}

function deprioritize() {
  try {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        PS_OURS + "$procs | ForEach-Object { try { $_.PriorityClass = 'BelowNormal' } catch {} }",
      ],
      { stdio: "ignore" },
    );
  } catch {
    /* best effort */
  }
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
      throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
    }
    return r.result.value;
  }
}

let wavServer;
try {
  const seconds = Math.round(minutes * 60);
  const wav = ensureWav(seconds);
  const runTag = `heap-soak-${minutes}min-${Date.now().toString(36)}`;
  const csv = path.join(outDir, `${runTag}.csv`);
  writeFileSync(csv, "elapsedSec,jsHeapMB,workingSetMB,processes\n");

  // A file:// fetch is blocked from the http-served dev page, so serve the
  // WAV over localhost http with CORS. Static server, devstorage dir only.
  // In-process static server for the single WAV — no external tooling, no
  // spawn quirks, dies with this script. CORS because the dev page origin is
  // localhost:1420.
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

  const target = await page();
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  deprioritize();

  // Wait for hooks, load the synthetic track from a file URL.
  await cdp.eval(`(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const deadline = Date.now() + 60000;
    while (!window.__store || !window.__engine || !window.__loadFile) {
      if (Date.now() > deadline) throw new Error("hooks unavailable");
      await delay(100);
    }
    await window.__loadFile(${JSON.stringify(`http://127.0.0.1:${wavPort}/${path.basename(wav)}`)}, "soak.wav");
    window.__store.getState().pause?.();
    return true;
  })()`);

  // Start the PNG-probe export WITHOUT awaiting it; stash the promise.
  await cdp.eval(
    `window.__soak = { done: false, error: null };
     window.__runExport({ png: true, fps: 30, width: 320, height: 180 })
       .then(r => { window.__soak.done = true; window.__soak.result = { frames: r.pngFrames, ms: r.ms }; })
       .catch(e => { window.__soak.error = String(e); window.__soak.done = true; });
     true`,
    false,
  );

  const started = Date.now();
  let peakJs = 0;
  let peakWs = 0;
  // Sample every 15 s until the export finishes (cap: 6x track length + 10 min).
  const hardStop = started + (seconds * 6 + 600) * 1000;
  for (;;) {
    await sleep(15_000);
    deprioritize(); // new webview children may appear mid-run
    const js = await cdp
      .eval("Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576)", false)
      .catch(() => -1);
    const ws1 = workingSetMB();
    const elapsed = Math.round((Date.now() - started) / 1000);
    appendFileSync(csv, `${elapsed},${js},${ws1.mb},${ws1.procs}\n`);
    peakJs = Math.max(peakJs, js);
    peakWs = Math.max(peakWs, ws1.mb);
    const soak = await cdp.eval("window.__soak", false).catch(() => null);
    if (soak?.done) {
      if (soak.error) throw new Error(`export failed: ${soak.error}`);
      // Post-finalize settling: 90 s of samples after the export ends.
      for (let i = 0; i < 6; i++) {
        await sleep(15_000);
        const js2 = await cdp
          .eval("Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576)", false)
          .catch(() => -1);
        const ws2 = workingSetMB();
        appendFileSync(
          csv,
          `${Math.round((Date.now() - started) / 1000)},${js2},${ws2.mb},${ws2.procs},post\n`,
        );
      }
      const finalJs = await cdp
        .eval("Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576)", false)
        .catch(() => -1);
      console.log(
        `SOAK OK ${minutes}min: frames=${soak.result.frames} exportMs=${soak.result.ms} ` +
          `peakJsHeapMB=${peakJs} finalJsHeapMB=${finalJs} peakWorkingSetMB=${peakWs} csv=${csv}`,
      );
      break;
    }
    if (Date.now() > hardStop) throw new Error("soak hard-stop: export did not finish");
  }
} finally {
  // The CDP socket dies with the app process below.
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
