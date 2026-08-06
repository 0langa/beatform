// Track B wave verification: per-mode style strips on the live device.
// For each requested mode, applies every factory style (defaults first)
// against a demo track and screenshots the canvas — the before/after
// evidence pack behind every GPU-matrix re-bless in the depth program.
//
//   node scripts/wave-shots.mjs --modes=aurora,synthwave --out=<dir> [--demo=groove]
// Prereq: Vite dev on 127.0.0.1:1420 (the debug exe loads it).
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, dflt) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? "").slice(name.length + 3) || dflt;
const modes = arg("modes", "").split(",").filter(Boolean);
const outDir = arg("out", "");
const demo = arg("demo", "groove");
if (!modes.length || !outDir) throw new Error("--modes=a,b and --out=<dir> required");
mkdirSync(outDir, { recursive: true });
const exe = path.join(root, "src-tauri", "target", "debug", "beatform.exe");
const port = 9300 + (process.pid % 80);
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
    await this.send("Page.enable");
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
  async shotCanvas(name) {
    await this.eval(
      `(() => {
        document.querySelector(".update-hero-close")?.click();
        const st = window.__store.getState();
        if (st.recoveredDoc) st.dismissAutosave();
        window.__store.setState({ chromeIdle: true });
        return true;
      })()`,
      false,
    ).catch(() => {});
    await sleep(250);
    const rect = await this.eval(
      `(() => { const c = document.querySelector("canvas"); const r = c.getBoundingClientRect();
         return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
      false,
    );
    const r = await this.send("Page.captureScreenshot", {
      format: "png",
      clip: { ...rect, scale: 1 },
    });
    writeFileSync(path.join(outDir, name), Buffer.from(r.data, "base64"));
    console.log("SHOT", name);
  }
}

try {
  child = spawn(exe, [], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, "node_modules", ".cache", "wave-shots-profile"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keep = (c) => (log = (log + c.toString()).slice(-20_000));
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);

  const attach = async () => {
    const t = await page();
    const c = new Cdp(t.webSocketDebuggerUrl);
    await c.open();
    return c;
  };
  let cdp = await attach();
  const waitHooks = () =>
    cdp.eval(`(async () => {
      const d = ms => new Promise(r => setTimeout(r, ms));
      const dl = Date.now() + 60000;
      while (!window.__store || !window.__presets) { if (Date.now() > dl) throw new Error("no hooks"); await d(100); }
      return true; })()`);
  try {
    await waitHooks();
  } catch {
    await sleep(2500);
    cdp = await attach();
    await waitHooks();
  }

  await cdp.eval(`window.__store.getState().loadDemo(${JSON.stringify(demo)})`);
  await cdp.eval(`(async () => { const d=ms=>new Promise(r=>setTimeout(r,ms)); const dl=Date.now()+30000;
    while(!(window.__engine.state.duration>0)){ if(Date.now()>dl) throw new Error("demo"); await d(200);}
    window.__store.getState().play?.(); return true; })()`);
  await sleep(1200);

  for (const mode of modes) {
    const styles = await cdp.eval(
      `(() => { const p = window.__presets().find(x => x.id === ${JSON.stringify(mode)});
         return p ? p.styles.map(s => ({ id: s.id, name: s.name, values: s.values })) : null; })()`,
      false,
    );
    if (!styles) {
      console.log("MODE MISS", mode);
      continue;
    }
    // Defaults first: switch + reset gives the mode's stock look.
    await cdp.eval(`(() => { const s = window.__store.getState();
      window.__engine.seek?.(2);
      if (!window.__engine.state.playing) s.play?.();
      s.switchPreset(${JSON.stringify(mode)});
      s.resetParams?.();
      return true; })()`);
    await sleep(4000);
    await cdp.shotCanvas(`${mode}--defaults.png`);
    for (const st of styles) {
      await cdp.eval(`(() => { const s = window.__store.getState();
        window.__engine.seek?.(2);
        if (!window.__engine.state.playing) s.play?.();
        s.resetParams?.();
        s.applyStyle(${JSON.stringify(st.values)});
        return true; })()`);
      await sleep(4000);
      const safe = st.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      await cdp.shotCanvas(`${mode}--${safe}.png`);
    }
  }
  console.log("WAVE-SHOTS OK");
} finally {
  if (child?.pid) {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* gone */
    }
  }
}
