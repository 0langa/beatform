import { spawn, spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(root, "src", "render", "__baselines__", "gpu-pixel-matrix.json");
const update = process.argv.includes("--update");
const attach = process.argv.includes("--attach");
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = Number(portArg?.slice("--port=".length) ?? 9400 + (process.pid % 500));
const endpoint = `http://127.0.0.1:${port}`;

let child = null;
let childLog = "";
let socket = null;

function keepLog(chunk) {
  childLog = (childLog + chunk.toString()).slice(-20_000);
}

async function waitForPage(timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode != null) {
      throw new Error(`Tauri dev exited ${child.exitCode}\n${childLog}`);
    }
    try {
      const pages = await fetch(`${endpoint}/json/list`).then((r) => r.json());
      const page = pages.find(
        (p) => p.type === "page" && p.webSocketDebuggerUrl && /localhost|127\.0\.0\.1/.test(p.url),
      );
      if (page) return page;
    } catch {
      // Runtime not listening yet.
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for WebView2 debugger at ${endpoint}\n${childLog}`);
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.ws = new globalThis.WebSocket(url);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

function signatureError(a64, b64) {
  const a = Buffer.from(a64, "base64");
  const b = Buffer.from(b64, "base64");
  if (a.length !== b.length) return { mae: Infinity, max: Infinity };
  let sum = 0;
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    sum += d;
    if (d > max) max = d;
  }
  return { mae: sum / a.length, max };
}

function signatureChroma(a64) {
  const rgb = Buffer.from(a64, "base64");
  let max = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    max = Math.max(
      max,
      Math.abs(rgb[i] - rgb[i + 1]),
      Math.abs(rgb[i] - rgb[i + 2]),
      Math.abs(rgb[i + 1] - rgb[i + 2]),
    );
  }
  return max;
}

function assertRuntime(matrix) {
  const failures = [];
  if (Object.keys(matrix.compileErrors).length) {
    failures.push(`WGSL compile errors: ${JSON.stringify(matrix.compileErrors)}`);
  }
  if (matrix.gpuErrors !== 0) failures.push(`uncaptured WebGPU errors: ${matrix.gpuErrors}`);
  for (const entry of matrix.cases) {
    if (entry.litFraction === 0 && entry.meanLuma === 0) {
      failures.push(`${entry.id}: fully black frame`);
    }
    if (
      (entry.id.endsWith("/color/grayscale") || entry.id.endsWith("/color/bright-grayscale")) &&
      signatureChroma(entry.signature) > 1
    ) {
      failures.push(`${entry.id}: saturation 0 left visible chroma`);
    }
  }
  const spectrum = matrix.spectrumSmoke;
  if (!spectrum?.passed) {
    failures.push(`analyzer-quality spectrum smoke failed: ${JSON.stringify(spectrum)}`);
  }
  if (failures.length) throw new Error(failures.join("\n"));
}

async function compare(matrix) {
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  if (baseline.width !== matrix.width || baseline.height !== matrix.height) {
    throw new Error(
      `baseline size ${baseline.width}x${baseline.height}, runtime ${matrix.width}x${matrix.height}`,
    );
  }
  const expected = new Map(baseline.cases.map((entry) => [entry.id, entry]));
  const actual = new Map(matrix.cases.map((entry) => [entry.id, entry]));
  const missing = [...expected.keys()].filter((id) => !actual.has(id));
  const added = [...actual.keys()].filter((id) => !expected.has(id));
  if (missing.length || added.length) {
    throw new Error(`matrix case drift; missing=${missing.join(",")} added=${added.join(",")}`);
  }

  const failures = [];
  let rawHashChanges = 0;
  for (const [id, got] of actual) {
    const want = expected.get(id);
    const sig = signatureError(got.signature, want.signature);
    const lumaDelta = Math.abs(got.meanLuma - want.meanLuma);
    const litDelta = Math.abs(got.litFraction - want.litFraction);
    if (got.hash !== want.hash) rawHashChanges++;
    if (sig.mae > 8 || lumaDelta > 8 || litDelta > 0.12) {
      failures.push(
        `${id}: rgbMAE=${sig.mae.toFixed(2)} max=${sig.max} ` +
          `lumaDelta=${lumaDelta.toFixed(2)} litDelta=${litDelta.toFixed(3)}`,
      );
    }
  }
  if (failures.length) throw new Error(`pixel baseline mismatch\n${failures.join("\n")}`);
  return rawHashChanges;
}

async function evaluateMatrix() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const page = await waitForPage();
    const cdp = new CdpClient(page.webSocketDebuggerUrl);
    socket = cdp;
    try {
      await cdp.open();
      await cdp.send("Runtime.enable");
      const evaluated = await cdp.send("Runtime.evaluate", {
        expression: `(async () => {
          const deadline = Date.now() + 60000;
          while (typeof window.__runGpuMatrix !== "function") {
            if (Date.now() > deadline) throw new Error("__runGpuMatrix hook unavailable");
            await new Promise(r => setTimeout(r, 100));
          }
          const matrix = await window.__runGpuMatrix(192, 108);
          const store = window.__store;
          const analyzer = window.__analyzer;
          const engine = window.__engine;
          const originalSync = { ...store.getState().sync };
          const originalPanel = store.getState().showPanel;
          let spectrumSmoke;
          try {
            store.getState().setSync({
              ...originalSync,
              freqMin: 30,
              freqMax: 300,
              spectrumResolution: "precise",
              spectrumAxis: "linear",
              spectrumSampling: "measured",
            });
            store.getState().setShowPanel(true);
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

            // P-1 replaced the tab bar AND the per-section collapse with one
            // rail, so reaching Sync is now a single click instead of two.
            // What this leg verifies is unchanged: that the Sync controls
            // render, and that the measured-bars readout below reflects the
            // real display FFT.
            const syncRail = [...document.querySelectorAll(".rail-item")]
              .find(button => button.dataset.section === "sync");
            if (!syncRail) throw new Error("Visuals rail: no Sync destination");
            syncRail.click();
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

            const panel = document.querySelector(".params-panel");
            const text = panel?.textContent ?? "";
            const axis = panel?.querySelector('[aria-label="Spectrum frequency axis"]');
            const activeAxis = axis?.querySelector('[aria-pressed="true"]')?.textContent?.trim();
            const axisLocked = axis
              ? [...axis.querySelectorAll("button")].every(button => button.disabled)
              : false;
            const displayBins = analyzer.features.bins.length;
            const expectedFft = Math.min(32768, engine.analyser.fftSize * 4);
            const audit = window.__auditUI(".params-panel");
            spectrumSmoke = {
              passed:
                engine.analyser.fftSize !== engine.displayAnalyser.fftSize &&
                engine.displayAnalyser.fftSize === expectedFft &&
                displayBins > 0 && displayBins <= 96 &&
                text.includes(displayBins + " measured bars, no interpolation") &&
                activeAxis === "Linear" && axisLocked &&
                Array.isArray(audit) && audit.length === 0,
              detectorFft: engine.analyser.fftSize,
              displayFft: engine.displayAnalyser.fftSize,
              displayBins,
              activeAxis,
              axisLocked,
              audit,
            };
          } finally {
            store.getState().setSync(originalSync);
            store.getState().setShowPanel(originalPanel);
          }
          return { ...matrix, spectrumSmoke };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (evaluated.exceptionDetails) {
        throw new Error(
          evaluated.exceptionDetails.exception?.description ?? "GPU matrix evaluation failed",
        );
      }
      return evaluated.result.value;
    } catch (error) {
      cdp.close();
      socket = null;
      if (attempt === 3 || !/context was destroyed|websocket/i.test(String(error))) throw error;
      await sleep(1000);
    }
  }
  throw new Error("GPU matrix evaluation did not return");
}

try {
  if (!attach) {
    const existingArgs = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? "";
    const command =
      process.platform === "win32"
        ? {
            file: process.env.ComSpec ?? "cmd.exe",
            args: ["/d", "/s", "/c", "npm run tauri -- dev --no-watch"],
          }
        : { file: "npm", args: ["run", "tauri", "--", "dev", "--no-watch"] };
    child = spawn(command.file, command.args, {
      cwd: root,
      windowsHide: true,
      env: {
        ...process.env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
          `${existingArgs} --remote-debugging-port=${port}`.trim(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", keepLog);
    child.stderr.on("data", keepLog);
  }

  const matrix = await evaluateMatrix();
  assertRuntime(matrix);

  if (update) {
    const baseline = {
      version: 1,
      width: matrix.width,
      height: matrix.height,
      cases: matrix.cases,
    };
    await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`GPU baseline updated: ${matrix.cases.length} cases`);
  } else {
    const rawHashChanges = await compare(matrix);
    console.log(
      `GPU matrix passed: ${matrix.cases.length} cases, 0 compile errors, ` +
        `0 GPU errors, ${rawHashChanges} tolerance-only raw hash changes; ` +
        `spectrum smoke ${matrix.spectrumSmoke.displayBins} measured bins`,
    );
  }
} finally {
  socket?.close();
  if (child?.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  }
}
