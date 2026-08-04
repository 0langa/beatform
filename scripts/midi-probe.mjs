// Diagnostic: raw requestMIDIAccess result inside the debug shell + the Rust
// permission handler's stderr trace. Not a test — a truth extractor.
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
  throw new Error(`timed out\n${log}`);
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
  await sleep(2000);

  const probe = await cdp.eval(`(async () => {
    const out = { hasApi: "requestMIDIAccess" in navigator, secure: window.isSecureContext,
                  origin: location.origin };
    try {
      const a = await navigator.requestMIDIAccess({ sysex: false });
      const names = [];
      a.inputs.forEach(i => names.push(i.name));
      out.ok = true; out.inputs = names;
    } catch (e) {
      out.ok = false; out.err = (e && (e.name + ": " + e.message)) || String(e);
    }
    return out;
  })()`);
  console.log("PROBE:", JSON.stringify(probe));

  // Second stage: the STORE path. Distinguish "await startMidi never
  // settles" from "settles but the null-handle branch fired" (notice set).
  const store = await cdp.eval(`(async () => {
    const deadline = Date.now() + 20000;
    while (!window.__store) {
      if (Date.now() > deadline) return { err: "no store" };
      await new Promise(r => setTimeout(r, 200));
    }
    const s = window.__store;
    const before = { enabled: s.getState().midiEnabled, notice: s.getState().notice };
    const p = s.getState().enableMidi();
    const settle = await Promise.race([
      p.then(() => "resolved", (e) => "threw: " + e),
      new Promise(r => setTimeout(() => r("STILL PENDING after 4s"), 4000)),
    ]);
    return { before, settle,
             after: { enabled: s.getState().midiEnabled,
                      devices: JSON.parse(JSON.stringify(s.getState().midiDevices)),
                      notice: s.getState().notice } };
  })()`);
  console.log("STORE:", JSON.stringify(store));
  await sleep(500);
  const lines = log.split(/\r?\n/).filter((l) => l.includes("[midi-permission]"));
  console.log("RUST:", lines.length ? lines.join(" | ") : "(no handler output)");
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
