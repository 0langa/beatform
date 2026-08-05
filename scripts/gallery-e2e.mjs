// FEAT-003 Gallery E2E: drives the debug shell over CDP against the REAL
// beatform-app/gallery registry (a branch until the owner merges), through
// the app's full verified-download path — CSP, allowlist, exact-size,
// SHA-256, parse — and proves install effects in the store.
//
//   node scripts/gallery-e2e.mjs [--registry=<raw index.json url>]
// Prereq: Vite dev on 127.0.0.1:1420.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry =
  (process.argv.find((a) => a.startsWith("--registry=")) ?? "").slice("--registry=".length) ||
  "https://raw.githubusercontent.com/beatform-app/gallery/seed-candidates/index.json";
const outDir = path.join(root, "node_modules", ".cache", "gallery-e2e");
mkdirSync(outDir, { recursive: true });
const exe = path.join(root, "src-tauri", "target", "debug", "beatform.exe");
const port = 9600 + (process.pid % 80);
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
  async shot(name) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(outDir, name), Buffer.from(r.data, "base64"));
    console.log("SHOT", path.join(outDir, name));
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
      WEBVIEW2_USER_DATA_FOLDER: path.join(outDir, "wv2-profile"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keep = (c) => (log = (log + c.toString()).slice(-20_000));
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);

  const t = await page();
  const cdp = new Cdp(t.webSocketDebuggerUrl);
  await cdp.open();

  await cdp.eval(`(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const deadline = Date.now() + 60000;
    while (!window.__store) {
      if (Date.now() > deadline) throw new Error("hooks unavailable");
      await delay(100);
    }
    localStorage.setItem("viz.galleryRegistryOverride", ${JSON.stringify(registry)});
    return true;
  })()`);

  // 1. Load the registry through the real fetch + validation path.
  const loaded = await cdp.eval(`(async () => {
    const s = window.__store.getState();
    await s.openGallery();
    const st = window.__store.getState();
    return { status: st.galleryStatus, error: st.galleryError,
             count: st.galleryEntries.length,
             ids: st.galleryEntries.map(e => e.id) };
  })()`);
  console.log("REGISTRY:", JSON.stringify(loaded));
  if (loaded.status !== "ready" || loaded.count < 11) {
    throw new Error(`registry load failed: ${JSON.stringify(loaded)}`);
  }

  // 2. Previews: hash-verified blob URLs must accumulate.
  const previews = await cdp.eval(`(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const deadline = Date.now() + 60000;
    while (Object.keys(window.__store.getState().galleryPreviews).length < 11) {
      if (Date.now() > deadline) break;
      await delay(300);
    }
    const p = window.__store.getState().galleryPreviews;
    return { count: Object.keys(p).length, sample: Object.values(p)[0] ?? null };
  })()`);
  console.log("PREVIEWS:", JSON.stringify(previews));
  if (previews.count < 11 || !/^blob:/.test(previews.sample ?? "")) {
    throw new Error(`previews incomplete: ${JSON.stringify(previews)}`);
  }

  // 3. Install a LOOK: verified download -> parseUserPreset -> My Looks + applied.
  const look = await cdp.eval(`(async () => {
    const before = window.__store.getState().userPresets.length;
    await window.__store.getState().installGalleryEntry("prism-cathedral");
    const st = window.__store.getState();
    return { before, after: st.userPresets.length,
             first: st.userPresets[0]?.name ?? null,
             presetId: st.presetId, error: st.error,
             installed: st.galleryInstalled["prism-cathedral" ] === true };
  })()`);
  console.log("LOOK-INSTALL:", JSON.stringify(look));
  if (
    look.after !== look.before + 1 ||
    look.first !== "Prism Cathedral" ||
    look.presetId !== "echo-trails" ||
    !look.installed
  ) {
    throw new Error(`look install failed: ${JSON.stringify(look)}`);
  }

  // 4. Apply a THEME: verified download -> parseTheme -> document applied.
  const theme = await cdp.eval(`(async () => {
    await window.__store.getState().installGalleryEntry("deep-current");
    const st = window.__store.getState();
    return { presetId: st.presetId, smooth: st.smoothSpectrum, error: st.error,
             installed: st.galleryInstalled["deep-current"] === true };
  })()`);
  console.log("THEME-APPLY:", JSON.stringify(theme));
  if (theme.presetId !== "nebula" || !theme.installed) {
    throw new Error(`theme apply failed: ${JSON.stringify(theme)}`);
  }

  // 5. Visual proof: panel open on the Gallery section.
  await cdp.eval(
    `(() => {
    const st = window.__store.getState();
    st.setShowPanel(true);
    document.querySelector(".update-hero-close")?.click();
    if (window.__store.getState().recoveredDoc) st.dismissAutosave();
    return true;
  })()`,
    false,
  );
  await sleep(800);
  const dom = await cdp.eval(
    `(() => { const cards = document.querySelectorAll(".gallery-card");
              cards[0]?.scrollIntoView({ block: "start" });
              return { cards: cards.length,
                       imgs: document.querySelectorAll(".gallery-preview[src^='blob:']").length }; })()`,
    false,
  );
  await sleep(500);
  console.log("DOM:", JSON.stringify(dom));
  await cdp.shot("gallery-panel.png");

  console.log("GALLERY-E2E OK");
} finally {
  if (child?.pid) {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* gone */
    }
  }
}
