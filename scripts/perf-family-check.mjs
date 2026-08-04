// Device check for the perf overlay's process-family aggregation: launches
// the debug shell, turns the overlay on, and asserts the RAM/CPU rows carry
// the family total with the "(main …)" split — family resident memory must
// dwarf the exe alone (the WebView2 renderer/GPU processes are where the app
// actually lives).
//   node scripts/perf-family-check.mjs
// Prereq: Vite dev on 127.0.0.1:1420.
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = path.join(root, "src-tauri", "target", "debug", "beatform.exe");
const port = 9700 + (process.pid % 80);
let child;
let log = "";

async function page() {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`app exited ${child.exitCode}\n${log}`);
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const m = pages.find(
        (p) => p.type === "page" && p.webSocketDebuggerUrl && /localhost|127\.0\.0\.1/.test(p.url),
      );
      if (m) return m;
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
        ex?.description ?? (ex?.value != null ? JSON.stringify(ex.value) : null) ?? "eval failed",
      );
    }
    return r.result.value;
  }
}

try {
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

  const out = await cdp.eval(`(async () => {
    const deadline = Date.now() + 30000;
    while (!window.__prefs) {
      if (Date.now() > deadline) throw new Error("hooks unavailable");
      await new Promise(r => setTimeout(r, 200));
    }
    window.__prefs.set({ perfOverlay: true });
    // Two Rust polls minimum (family CPU needs a delta; scan is on poll 1).
    await new Promise(r => setTimeout(r, 3200));
    const el = document.querySelector('[role="status"]');
    window.__prefs.set({ perfOverlay: false });
    return el ? el.textContent : null;
  })()`);

  console.log("OVERLAY:", out);
  if (!out) throw new Error("overlay did not mount");
  const ram = /RAM(\d+) MB \(main (\d+) MB\)/.exec(out);
  if (!ram) throw new Error(`RAM row missing family split: ${out}`);
  const family = Number(ram[1]);
  const main = Number(ram[2]);
  if (!(family > main + 50)) {
    throw new Error(`family (${family} MB) should dwarf main (${main} MB) — filter broken?`);
  }
  if (!/CPU\d+% \(main \d+%\) · sys \d+%/.test(out)) {
    throw new Error(`CPU row missing family split: ${out}`);
  }
  console.log(`PERF-FAMILY OK: family=${family}MB main=${main}MB`);
} finally {
  child?.kill();
  try {
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      "Get-Process -Name beatform -ErrorAction SilentlyContinue | Stop-Process -Force",
    ]);
  } catch {
    /* gone */
  }
}
