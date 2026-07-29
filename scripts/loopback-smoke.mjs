import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const built = process.argv.includes("--built");
const exeArg = process.argv.find((arg) => arg.startsWith("--exe="));
const fpsArg = process.argv.find((arg) => arg.startsWith("--fps="));
const testFps = Number(fpsArg?.slice("--fps=".length) ?? 0);
const port = 9900 + (process.pid % 80);
const endpoint = `http://127.0.0.1:${port}`;
let log = "";
let child;
let ws;

const command = exeArg
  ? { file: path.resolve(exeArg.slice("--exe=".length)), args: [] }
  : built
    ? {
        // Debug shell still serves Vite's DEV frontend, which exposes required
        // diagnostic hooks. For optimized validation, build with
        // VITE_E2E_HOOKS=1 into an isolated target and pass --exe=<path>.
        file: path.join(root, "src-tauri", "target", "debug", "beatform.exe"),
        args: [],
      }
    : process.platform === "win32"
      ? {
          file: process.env.ComSpec ?? "cmd.exe",
          args: ["/d", "/s", "/c", "npm run tauri -- dev --no-watch"],
        }
      : { file: "npm", args: ["run", "tauri", "--", "dev", "--no-watch"] };

async function page() {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Tauri dev exited ${child.exitCode}\n${log}`);
    try {
      const pages = await fetch(`${endpoint}/json/list`).then((r) => r.json());
      const match = pages.find(
        (p) => p.type === "page" && p.webSocketDebuggerUrl && /localhost|127\.0\.0\.1/.test(p.url),
      );
      if (match) return match;
    } catch {
      // Runtime not ready.
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for WebView2\n${log}`);
}

async function evaluate(url) {
  ws = new globalThis.WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    if (message.error) p.reject(new Error(message.error.message));
    else p.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const request = ++id;
      pending.set(request, { resolve, reject });
      ws.send(JSON.stringify({ id: request, method, params }));
    });
  await send("Runtime.enable");
  return send("Runtime.evaluate", {
    expression: `(async () => {
      const delay = ms => new Promise(r => setTimeout(r, ms));
      const deadline = Date.now() + 60000;
      while (!window.__store || !window.__engine || !window.__analyzer || !window.__prefs) {
        if (Date.now() > deadline) throw new Error("dev audio hooks unavailable");
        await delay(100);
      }
      const store = window.__store;
      const engine = window.__engine;
      const analyzer = window.__analyzer;
      const originalFps = window.__prefs.get().fpsCap;
      window.__prefs.set({ fpsCap: ${testFps} });
      let toneCtx = null;
      let oscillators = [];
      const toneBins = [220, 880].map(hz =>
        Math.max(0, Math.min(95, Math.floor(96 * Math.log(hz / 30) / Math.log(16000 / 30))))
      );
      const snapshot = () => {
        const f = analyzer.features;
        let maxBin = 0, toneScore = 0;
        for (let i = 0; i < f.bins.length; i++) {
          const value = f.bins[i];
          if (value > maxBin) maxBin = value;
          if (toneBins.some(bin => Math.abs(bin - i) <= 1) && value > toneScore) toneScore = value;
        }
        return { maxBin, toneScore, drive: f.drive, beatIntensity: f.beatIntensity, width: f.width };
      };
      const collect = async (ms, activeThreshold = Infinity) => {
        const started = performance.now();
        let maxBin = 0, maxTone = 0, maxDrive = 0, maxBeat = 0, samples = 0, activeSamples = 0;
        let inactiveRun = 0, longestInactiveSamples = 0;
        let firstActiveMs = null;
        while (performance.now() - started < ms) {
          const s = snapshot();
          maxBin = Math.max(maxBin, s.maxBin);
          maxTone = Math.max(maxTone, s.toneScore);
          maxDrive = Math.max(maxDrive, s.drive);
          maxBeat = Math.max(maxBeat, s.beatIntensity);
          if (firstActiveMs === null && s.toneScore > activeThreshold)
            firstActiveMs = performance.now() - started;
          if (s.toneScore > activeThreshold) {
            activeSamples++;
            inactiveRun = 0;
          } else {
            inactiveRun++;
            longestInactiveSamples = Math.max(longestInactiveSamples, inactiveRun);
          }
          samples++;
          await delay(40);
        }
        return {
          maxBin, maxTone, maxDrive, maxBeat, firstActiveMs, end: snapshot(), samples,
          activeFraction: activeSamples / Math.max(1, samples),
          longestInactiveMs: longestInactiveSamples * 40,
        };
      };
      try {
        if (store.getState().liveInputActive) await store.getState().toggleLiveInput();
        await store.getState().toggleLiveInput();
        // A dev-page reload can orphan native capture while replacing the JS
        // store. First toggle then performs cleanup and reports "already
        // running"; second toggle starts the now-clean session.
        if (!store.getState().liveInputActive) {
          await delay(200);
          await store.getState().toggleLiveInput();
        }
        if (!store.getState().liveInputActive) {
          throw new Error(store.getState().error || "loopback did not start");
        }
        await delay(900);
        const idle = await collect(1200);
        toneCtx = new AudioContext();
        await toneCtx.resume();
        const gain = toneCtx.createGain();
        gain.gain.value = 0.04;
        gain.connect(toneCtx.destination);
        for (const hz of [220, 880]) {
          const osc = toneCtx.createOscillator();
          osc.type = "sine";
          osc.frequency.value = hz;
          osc.connect(gain);
          osc.start();
          oscillators.push(osc);
        }
        const toneThreshold = Math.max(0.05, idle.end.toneScore * 1.25 + 0.02);
        const onset = await collect(2000, toneThreshold);
        // Startup silence belongs to native-session activation, not steady
        // jitter-buffer health. Reset only after known audio is flowing.
        await engine.loopbackStats(true);
        const active = await collect(12000, toneThreshold);
        const stats = await engine.loopbackStats(false);
        for (const osc of oscillators) osc.stop();
        oscillators = [];
        await toneCtx.close();
        toneCtx = null;
        const recovery = await collect(3000);
        const stayedActive = store.getState().liveInputActive;
        await store.getState().toggleLiveInput();
        return {
          sampleRate: engine.ctx.sampleRate,
          toneThreshold,
          idle,
          onset,
          active,
          recovery,
          stats,
          stayedActive,
          stopped: !store.getState().liveInputActive,
        };
      } finally {
        for (const osc of oscillators) { try { osc.stop(); } catch {} }
        if (toneCtx) await toneCtx.close().catch(() => {});
        if (store.getState().liveInputActive) await store.getState().toggleLiveInput();
        window.__prefs.set({ fpsCap: originalFps });
      }
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
}

function verify(result) {
  const failures = [];
  if (!result.stayedActive) failures.push("capture died during sustained tone");
  if (!result.stopped) failures.push("capture did not stop cleanly");
  if (result.active.maxTone <= result.toneThreshold || result.active.maxDrive <= 0.005) {
    failures.push(`known tone did not reach analyzer: ${JSON.stringify(result.active)}`);
  }
  if (result.onset.firstActiveMs == null || result.onset.firstActiveMs > 750) {
    failures.push(`tone response took ${result.onset.firstActiveMs} ms`);
  }
  if (result.active.activeFraction < 0.95 || result.active.longestInactiveMs > 160) {
    failures.push(`visible tone continuity failed: ${JSON.stringify(result.active)}`);
  }
  if (!result.stats) failures.push("worklet telemetry did not respond");
  else {
    const depthMs = (result.stats.depthFrames / result.stats.sampleRate) * 1000;
    const maxDepthMs = (result.stats.maxDepthFrames / result.stats.sampleRate) * 1000;
    if (depthMs > 115) failures.push(`ring depth ${depthMs.toFixed(1)} ms`);
    if (maxDepthMs > 160) failures.push(`ring max depth ${maxDepthMs.toFixed(1)} ms`);
    // WebView main-thread stalls are also render stalls: worklet underruns in
    // that interval are not visible frames. Credit-backed recovery must never
    // discard more audio than those already-missed frames, and visible feature
    // continuity above is the user-facing gate.
    if (result.stats.hardSkippedFrames > result.stats.underrunFrames) {
      failures.push("stale-frame recovery discarded valid audio");
    }
    const deliveredSec = result.stats.mainFrames / result.stats.sampleRate;
    if (deliveredSec < 11.4 || deliveredSec > 12.6) {
      failures.push(`native delivery covered ${deliveredSec.toFixed(2)} s`);
    }
  }
  if (failures.length) {
    throw new Error(`${failures.join("\n")}\nstats=${JSON.stringify(result.stats)}`);
  }
}

try {
  const existingArgs = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? "";
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
  const keep = (chunk) => (log = (log + chunk.toString()).slice(-20_000));
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);

  let evaluated;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const target = await page();
      evaluated = await evaluate(target.webSocketDebuggerUrl);
      break;
    } catch (error) {
      ws?.close();
      ws = null;
      if (
        attempt === 3 ||
        !/context was destroyed|cannot find default execution context|websocket/i.test(
          String(error),
        )
      )
        throw error;
      await sleep(1000);
    }
  }
  if (!evaluated) throw new Error("loopback smoke evaluation did not return");
  if (evaluated.exceptionDetails) {
    throw new Error(evaluated.exceptionDetails.exception?.description ?? "loopback smoke failed");
  }
  const result = evaluated.result.value;
  verify(result);
  const depthMs = (result.stats.depthFrames / result.stats.sampleRate) * 1000;
  const maxDepthMs = (result.stats.maxDepthFrames / result.stats.sampleRate) * 1000;
  console.log(
    `Loopback passed: ${result.sampleRate} Hz, response ${Math.round(result.onset.firstActiveMs)} ms, ` +
      `depth ${depthMs.toFixed(1)} ms (max ${maxDepthMs.toFixed(1)}), ` +
      `visible ${(result.active.activeFraction * 100).toFixed(1)}%, ` +
      `raw underruns ${result.stats.underrunFrames}, ` +
      `fps cap ${testFps || "display"}`,
  );
} finally {
  ws?.close();
  if (child?.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else child.kill("SIGTERM");
  }
}
