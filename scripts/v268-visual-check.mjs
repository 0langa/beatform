// v2.68 device visual checks: drives the debug shell over CDP and captures
// screenshots of the exact scenarios the owner reported, so the fixes can be
// eyeballed against the bug screenshots before release.
//   1. Particles at t≈160 s (past the old 1.5-cell drift boundary) — the
//      horizontal cutoff seams must be gone.
//   2. Particles with Direction=360 and the owner's screenshot-3 settings —
//      the smeared-strips corruption must be gone.
//   3. Metaballs defaults mid-merge — no saddle creases / white washes.
//   4. Perf overlay ON — DOM node present, perf_stats returns sane numbers.
//   5. previewScale 0.5 — canvas backing store halves; back to 1 restores.
//
//   node scripts/v268-visual-check.mjs --out=<dir>
// Prereq: Vite dev on 127.0.0.1:1420.
import { execFileSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnApp, attachWithRecovery, waitHooks, killTree, TAURI_WARMUP } from "./lib/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = (process.argv.find((a) => a.startsWith("--out=")) ?? "").slice("--out=".length);
if (!outDir) throw new Error("--out=<dir> required");
mkdirSync(outDir, { recursive: true });
const ffmpeg = path.join(root, "src-tauri", "binaries", "ffmpeg-x86_64-pc-windows-msvc.exe");

function ensureWav() {
  const wav = path.join(outDir, "check-180s.wav");
  if (existsSync(wav)) return wav;
  execFileSync(
    ffmpeg,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=55:beep_factor=8:duration=180",
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

let app;
let wavServer;
try {
  const wav = ensureWav();
  wavServer = createHttpServer((req, res) => {
    if (req.url !== `/${path.basename(wav)}`) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "audio/wav",
      "Content-Length": statSync(wav).size,
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

  app = spawnApp({
    root,
    portBase: 9460, // see the map in lib/app.mjs
    profileName: "wv2-v268-profile",
  });
  const cdp = await attachWithRecovery(app, (c) => c.eval(TAURI_WARMUP), { retrySleepMs: 2000 });

  await waitHooks(cdp, ["__store", "__engine", "__loadFile"]);
  await cdp.eval(
    `window.__loadFile(${JSON.stringify(`http://127.0.0.1:${wavPort}/${path.basename(wav)}`)}, "check.wav").then(() => true)`,
  );

  const shot = async (name) => {
    const f = path.join(outDir, name);
    await cdp.shot(f);
    console.log("SHOT", f);
  };

  // --- 1. Particles at t=160 s, size 0.25, density 19 (owner screenshot-2) ---
  await cdp.eval(`(async () => {
    const s = window.__store.getState();
    s.switchPreset?.("particles");
    s.setParam?.("size", 0.25); s.setParam?.("density", 19); s.setParam?.("sizeVar", 0.9);
    s.play?.();
    window.__engine.seek?.(160);
    await new Promise(r => setTimeout(r, 2500));
    return window.__engine.state.currentTime ?? -1;
  })()`);
  await shot("1-particles-t160.png");

  // --- 2. Direction 360 + owner screenshot-3 settings ---
  await cdp.eval(`(async () => {
    const s = window.__store.getState();
    s.setParam?.("direction", 360); s.setParam?.("bandColor", 120);
    s.setParam?.("hueVariance", 105); s.setParam?.("density", 24);
    s.setParam?.("clump", 0.0); s.setParam?.("fill", 1.0); s.setParam?.("speed", 0.3);
    await new Promise(r => setTimeout(r, 2000));
    return true;
  })()`);
  await shot("2-particles-dir360.png");

  // --- 3. Metaballs defaults ---
  await cdp.eval(`(async () => {
    window.__store.getState().switchPreset?.("metaballs");
    await new Promise(r => setTimeout(r, 3000));
    return true;
  })()`);
  await shot("3-metaballs.png");

  // --- 4. Perf overlay + perf_stats sanity ---
  // (No bare-specifier imports here: a CDP eval runs outside Vite's module
  // graph, so "@tauri-apps/api/core" cannot resolve. The overlay itself polls
  // perf_stats internally — CPU digits appearing in its text IS the proof the
  // Rust command works end to end.)
  const stats = await cdp.eval(`(async () => {
    window.__prefs.set({ perfOverlay: true });
    await new Promise(r => setTimeout(r, 2600));
    // Not '[role="status"]' — the notice toast shares that role (see
    // perf-family-check.mjs).
    const el = document.querySelector('[data-testid="perf-overlay"]');
    const text = el ? el.textContent : null;
    return { overlayMounted: !!el, overlayText: text ? text.slice(0, 300) : null,
             hasDigits: !!(text && /\\d/.test(text)) };
  })()`);
  console.log("OVERLAY:", JSON.stringify(stats));
  await shot("4-overlay.png");

  // --- 5. previewScale halves the backing store ---
  const scaleCheck = await cdp.eval(`(async () => {
    const canvas = document.querySelector("canvas");
    const w0 = canvas.width;
    window.__prefs.set({ previewScale: 0.5 });
    await new Promise(r => setTimeout(r, 600));
    const w1 = canvas.width;
    window.__prefs.set({ previewScale: 1 });
    await new Promise(r => setTimeout(r, 600));
    const w2 = canvas.width;
    return { w0, w1, w2 };
  })()`);
  console.log("SCALE:", JSON.stringify(scaleCheck));
  const ok = scaleCheck.w1 <= scaleCheck.w0 * 0.55 && scaleCheck.w2 === scaleCheck.w0;
  if (!ok) throw new Error(`previewScale check failed: ${JSON.stringify(scaleCheck)}`);
  if (!stats.overlayMounted) throw new Error("overlay did not mount");
  if (!stats.hasDigits) throw new Error("overlay mounted but shows no numbers");
  console.log("VISUAL-CHECK OK");
} finally {
  killTree(app);
  wavServer?.close?.();
}
