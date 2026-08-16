// P-6 follow-up (BACKLOG, Track E / 2.100.0): regenerates
// src/assets/gallery-builtins/*.webp from FACTORY_THEMES via the real
// applyTheme path, so the built-in Gallery thumbnails are no longer "taken
// by hand against a running app, nothing re-renders them if a theme's
// params/post/mods/Builder stack change later" (the exact drift risk the
// follow-up entry named). Same overall shape as scripts/gallery-seed-shots.mjs
// (apply -> settle -> shoot -> write), applying each factory theme's OWN
// document instead of a hand-authored candidate param map.
//
// Deliberately does NOT reuse spawnApp()/the Tauri debug shell the other
// screenshot harnesses drive: applyTheme + a canvas capture is pure web-app
// work with zero Tauri IPC anywhere in the path, and the debug shell's
// devUrl is hardcoded to :1420 in tauri.conf.json — this script owns a
// SEPARATE port (1427, --strictPort) precisely so it never collides with
// another worktree's `tauri dev`/`vite` already holding :1420. Drives a
// bare Chromium browser over CDP instead, reusing lib/app.mjs's generic
// page-poll/attach/kill plumbing (it only ever assumed "some process with a
// devtools /json/list endpoint", never WebView2 specifically) and
// lib/cdp.mjs's Cdp client untouched.
//
//   node scripts/gallery-builtin-shots.mjs [--out=<dir>] [--only=slug1,slug2]
//     [--demo=groove] [--settle=6] [--width=240] [--height=135] [--quality=0.82]
//
// CHROME_PATH overrides browser discovery (any Chromium build, Edge included).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { attachWithRecovery, harnessPort, killTree, waitHooks } from "./lib/app.mjs";
import { loadDemoAndPlay, seekAndPlay } from "./lib/demo.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, dflt) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? "").slice(name.length + 3) || dflt;

const outDir = path.resolve(root, arg("out", path.join("src", "assets", "gallery-builtins")));
const only = arg("only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const demo = arg("demo", "groove");
const settleMs = Math.round(Number(arg("settle", "6")) * 1000);
const width = Number(arg("width", "240"));
const height = Number(arg("height", "135"));
// 0.75 measured against the committed set: keeps content-light themes near
// their original size and pulls the two content-heavy outliers (synthwave
// grid noise, particle-flow chaos) back toward the ~1.4-8KB range without
// visible banding at this resolution — see the lane log for the sweep.
const quality = Number(arg("quality", "0.75"));

// Vite's own port, fixed and --strictPort: this harness must get a server it
// spawned itself or fail loudly, never silently talk to a stale/foreign dev
// server the way a bare "whichever port is free" pick could (the G9 lesson
// lib/app.mjs's checkDevServer guards against for the :1420 harnesses). This
// script does not need that stamp probe at all — --strictPort already makes
// "wrong tree answered" structurally impossible: either THIS spawn wins the
// port or Vite exits nonzero and waitForVite below throws with its log.
const VITE_PORT = 1427;
// This harness's own CDP debug port. See the map in lib/app.mjs — 10300,
// spaced past p11-smoke.mjs's (undocumented there) 10220.
const DEBUG_PORT = harnessPort(10300);

mkdirSync(outDir, { recursive: true });

function findBrowser() {
  if (process.env.CHROME_PATH) {
    if (!existsSync(process.env.CHROME_PATH)) {
      throw new Error(`CHROME_PATH=${process.env.CHROME_PATH} does not exist`);
    }
    return process.env.CHROME_PATH;
  }
  // Edge first: it is the same Chromium/Dawn stack WebView2 embeds, so it is
  // the closest stand-in for what the other harnesses' debug-shell captures
  // actually render with. Falls through to Chrome, whichever is installed.
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const hit = candidates.find(existsSync);
  if (!hit) {
    throw new Error(
      "no Chromium browser found at the default Edge/Chrome install paths — set CHROME_PATH",
    );
  }
  return hit;
}

/** Spawn a bare child and give it the {child, log()} shape lib/app.mjs's
 * generic helpers (waitForPage, killTree) only ever actually depend on. */
function spawnLogged(file, args, opts = {}) {
  let log = "";
  const child = spawn(file, args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  const keep = (c) => (log = (log + c.toString()).slice(-20_000));
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  return { child, log: () => log };
}

function spawnVite() {
  // Same cmd.exe indirection gpu-pixel-matrix.mjs uses for its own
  // `npm run tauri -- dev`: a bare spawn("npm", ...) needs npm.cmd's shell
  // resolution on Windows, which spawn() without shell:true does not do.
  const command =
    process.platform === "win32"
      ? {
          file: process.env.ComSpec ?? "cmd.exe",
          args: ["/d", "/s", "/c", `npm run dev -- --port=${VITE_PORT} --strictPort`],
        }
      : { file: "npm", args: ["run", "dev", "--", `--port=${VITE_PORT}`, "--strictPort"] };
  return spawnLogged(command.file, command.args, { cwd: root });
}

async function waitForVite(vite, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (vite.child.exitCode != null) {
      throw new Error(
        `vite exited ${vite.child.exitCode} before serving :${VITE_PORT} (another process on the ` +
          `port? --strictPort refuses to fall back)\n${vite.log()}`,
      );
    }
    try {
      // Any response at all means the server is up; the SPA shell 200s.
      await fetch(`http://127.0.0.1:${VITE_PORT}/`);
      return;
    } catch {
      /* not listening yet */
    }
    await sleep(300);
  }
  throw new Error(`vite did not come up on :${VITE_PORT} within ${timeoutMs}ms\n${vite.log()}`);
}

function spawnBrowser() {
  const exe = findBrowser();
  // Isolated profile (own dir, own run): never the owner's real browser
  // profile/open tabs, mirroring spawnApp()'s WebView2 profile isolation for
  // exactly the same reason. On the repo drive (C:, NTFS), not devstorage —
  // same ACL/locking rationale lib/app.mjs already documents for WebView2
  // profiles, which applies just as much to a Chromium user-data-dir.
  const profile = path.join(root, "node_modules", ".cache", "gallery-builtin-shots-profile");
  return spawnLogged(exe, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--disable-infobars",
    // Without this, Chrome's autoplay gate leaves the AudioContext suspended
    // forever: store.play() below is called from a CDP Runtime.evaluate, not
    // a real user gesture, so every theme would capture a silent, non-
    // reactive frame with no error anywhere to say why.
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1280,800",
    `http://127.0.0.1:${VITE_PORT}/`,
  ]);
}

/** Downscale the live canvas (whatever WebGPU/Canvas2D backend rendered it)
 * onto a small OffscreenCanvas and encode straight to WEBP, entirely inside
 * the page. Reads the CANVAS ELEMENT's own bitmap via drawImage(), not a
 * Page.captureScreenshot of the page — so unlike lib/cdp.mjs's shotCanvas()
 * this needs no dock-closing/update-hero-dismissing dance at all: nothing
 * composited on top of the canvas can leak into a source that never looks at
 * the page, only at the element. Returns a base64 string (a Blob cannot cross
 * the Runtime.evaluate/returnByValue boundary as-is). */
async function captureWebp(cdp, w, h, q) {
  return cdp.eval(
    `(async () => {
      const src = document.querySelector("canvas");
      if (!src) throw new Error("no live canvas");
      // Two rAFs: the same settle idiom gpu-pixel-matrix.mjs uses before
      // reading rendered state, so the frame drawImage sees below is never
      // the one mid-flight when the eval landed.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const off = new OffscreenCanvas(${w}, ${h});
      const ctx = off.getContext("2d");
      ctx.drawImage(src, 0, 0, ${w}, ${h});
      const blob = await off.convertToBlob({ type: "image/webp", quality: ${q} });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    })()`,
  );
}

let vite;
let browserApp;
try {
  vite = spawnVite();
  await waitForVite(vite);

  browserApp = spawnBrowser();
  // waitForPage/attachWithRecovery/waitHooks/killTree only ever assumed
  // {child, port, log()} plus an optional devServerCheck — none of that is
  // WebView2-specific, so this bare-browser handle works with them unchanged.
  browserApp.port = DEBUG_PORT;
  browserApp.devServerCheck = null;

  // Cold Vite dep cache triggers one "new dependencies optimized — reloading
  // page" early on, which destroys whatever eval was in flight (the v2.68
  // lesson every other CDP harness here already absorbs the same way).
  const cdp = await attachWithRecovery(browserApp, async (c) => {
    await waitHooks(c, ["__store", "__factoryThemes"]);
    await loadDemoAndPlay(c, demo);
    // loadDemo sets trackMeta.title to the demo's OWN label ("Groove (120
    // BPM House)"), which cover-story's {title}/{artist} overlay lockup then
    // renders verbatim into the captured frame — a real committed thumbnail
    // showing fake placeholder-track text. releaseLockup's own comment says
    // it "renders nothing at all until one is loaded (empty text is
    // skipped)", so blanking trackMeta back to the store's own boot default
    // ({title:"",artist:""}, store.ts) is enough to suppress it without
    // touching the decoded audio/analysis the demo still provides.
    await c.eval(`window.__store.setState({ trackMeta: { title: "", artist: "" } }); true`, false);
  });

  const allSlugs = await cdp.eval("window.__factoryThemes.map(t => t.slug)", false);
  const slugs = only.length ? allSlugs.filter((s) => only.includes(s)) : allSlugs;
  const missing = only.filter((s) => !allSlugs.includes(s));
  if (missing.length) throw new Error(`--only names slug(s) not in FACTORY_THEMES: ${missing}`);
  if (!slugs.length) throw new Error("no FACTORY_THEMES entries to capture");

  for (const slug of slugs) {
    // Reset to the same track position before every theme, exactly as
    // gallery-seed-shots.mjs does per candidate — otherwise theme N's shot
    // pumps from wherever theme N-1's settle window left playback drifted to.
    await seekAndPlay(cdp);
    const meta = await cdp.eval(
      `(() => {
        const t = window.__factoryThemes.find(x => x.slug === ${JSON.stringify(slug)});
        window.__store.getState().applyTheme(t.document, t.meta.name);
        return { name: t.meta.name, preset: t.document.presetId };
      })()`,
      false,
    );
    await sleep(settleMs);
    const b64 = await captureWebp(cdp, width, height, quality);
    const bytes = Buffer.from(b64, "base64");
    const file = path.join(outDir, `${slug}.webp`);
    writeFileSync(file, bytes);
    console.log("SHOT", file, `${bytes.length} bytes`, `(${meta.name} / ${meta.preset})`);
  }
  console.log("GALLERY-BUILTIN-SHOTS OK", slugs.length, "theme(s) ->", outDir);
} finally {
  // PID-tree kills only, never a name-wide sweep — killTree already carries
  // that discipline (lib/app.mjs's own comment), and it applies just as much
  // to the browser as it does to the debug shell: a name-wide `chrome.exe`
  // kill would take down every tab the owner has open.
  if (browserApp) killTree(browserApp);
  if (vite) killTree(vite);
}
