/* global process, console, fetch */
// Track C1 evidence harness: applies each candidate .bftheme through the app's
// REAL import path and photographs it at chosen moments of a demo track.
//
//   node trackc-candidates/shots.mjs [--only=id1,id2]
//
// Differences from scripts/gallery-seed-shots.mjs, which this follows
// otherwise, and why:
//
//  - It drives a BROWSER against `vite`, not the Tauri debug shell. The shell
//    needs the lyrics sidecar built before cargo will run at all, and the
//    machine's GPU-heavy slot belongs to another lane right now; `npm run dev`
//    is the documented fast path and renders through the same WebGPU
//    renderer. The window is real (not headless) on purpose — headless
//    Chromium falls back to a software adapter, and a Canvas2D fallback shot
//    would be evidence for a renderer these themes do not use.
//  - It spawns its own Vite on 1424 --strictPort and kills it at the end, so
//    it can never collide with another lane's 1420.
//  - It applies the EMITTED FILE through `importThemeText`, the same entry
//    point a drag-import and a gallery install use, rather than poking params
//    into the store. The point of the evidence is that the file works.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os";
import { Cdp } from "../scripts/lib/cdp.mjs";
import { loadDemoAndPlay } from "../scripts/lib/demo.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(HERE, "evidence");
const VITE_PORT = 1424;
const CDP_PORT = 9744;
// OUTSIDE the repo, and this is load-bearing: Vite watches the project tree,
// and a Chromium profile inside it makes chokidar try to watch the locked
// `Network/Cookies` file. That throws EBUSY on the FSWatcher, which kills the
// dev server mid-load — the module requests come back ERR_CONNECTION_RESET
// and the app never mounts. It looks exactly like a broken app.
const PROFILE = path.join(tmpdir(), "beatform-trackc-shots-profile");

const only = (process.argv.find((a) => a.startsWith("--only=")) ?? "")
  .slice("--only=".length)
  .split(",")
  .filter(Boolean);

/**
 * What to photograph. `at` is TRACK TIME in seconds for each frame — chosen
 * per entry rather than shared, because the moments that matter differ:
 * Cold Open has to be caught inside its standby scene AND after the glitch,
 * and the slow entries need a quiet bar and a loud one to show the lag doing
 * something.
 *
 * `title`/`artist` stage the overlay tokens. A demo track loads with its own
 * name as the title and an EMPTY artist, so the one candidate whose design is
 * a title lockup would photograph with half of it missing. These are stand-in
 * tags, exactly as a real track's would be, and the veto sheet says so.
 */
const SHOTS = [
  // `t` is the CAPTURE time in track seconds; the harness seeks to t - SETTLE
  // so the frame lands there. The demo tracks are short and do NOT loop
  // (groove 16 s, neuro 22 s, drift 27 s), so every time below is chosen to
  // sit inside its own track — a seek past the end would photograph silence.
  {
    id: "deep-current",
    demo: "drift",
    at: [
      { t: 8, tag: "quiet" },
      { t: 24, tag: "swell" },
    ],
  },
  {
    // Three frames rather than two: the sun sinks and the fog rolls in across
    // a 24-second timeline lane, and a before/after pair cannot show a move.
    id: "sunset-circuit",
    demo: "groove",
    at: [
      { t: 3, tag: "lane-03s" },
      { t: 9, tag: "lane-09s" },
      { t: 15, tag: "lane-15s" },
    ],
  },
  {
    // Scene 1 runs 0-12 s; scene 2 cuts in at 12 with a 2.5 s glitch fade, so
    // 13.5 catches the transition mid-blend and 15.5 catches it arrived.
    id: "cold-open",
    demo: "groove",
    title: "Cold Open",
    artist: "Beatform",
    at: [
      { t: 6, tag: "standby" },
      { t: 13.5, tag: "glitch" },
      { t: 15.5, tag: "open" },
    ],
  },
  {
    id: "meteor-hour",
    demo: "neuro",
    at: [
      { t: 8, tag: "build" },
      { t: 19, tag: "drop" },
    ],
  },
  {
    id: "blacklight",
    demo: "groove",
    at: [
      { t: 6, tag: "lattice" },
      { t: 14, tag: "peak" },
    ],
  },
];

/** Seconds of playback between the seek and the shutter — feedback, phosphor
 * and particle state all look wrong for the first half second after a seek. */
const SETTLE_S = 2.2;

function findBrowser() {
  const candidates = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ];
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) throw new Error("no Edge/Chrome found for the capture session");
  return hit;
}

async function waitFor(label, probe, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const v = await probe();
      if (v) return v;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(400);
  }
}

mkdirSync(OUT, { recursive: true });

// Vite through node directly, never `npx` + `shell: true`: on Windows that
// puts a cmd.exe between us and the server, so `kill()` reaps the shell and
// leaves the real server holding --strictPort for the next run. Piped stdio
// so a startup failure is reportable instead of silent.
const vite = spawn(process.execPath, [
  path.join(ROOT, "node_modules", "vite", "bin", "vite.js"),
  "--port",
  String(VITE_PORT),
  "--strictPort",
]);
let viteLog = "";
vite.stdout.on("data", (d) => (viteLog += d));
vite.stderr.on("data", (d) => (viteLog += d));

let browser = null;
let cdp = null;
try {
  await waitFor("vite", () => /ready in|Local:/i.test(viteLog) || null, 120_000);
  await waitFor("vite serving", async () => (await fetch(`http://127.0.0.1:${VITE_PORT}/`)).ok);
  console.log("VITE", VITE_PORT);

  // Opened on about:blank and navigated over CDP. Handing the app URL to the
  // command line races Vite's dependency pre-bundle: the first page load
  // triggers the one-off "new dependencies optimized" reload, the in-flight
  // module requests come back ERR_CONNECTION_RESET, and the app never mounts
  // — a blank page with no canvas and no dev hooks. Same failure the seed
  // harness documents; the retry loop below is the same fix.
  browser = spawn(
    findBrowser(),
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate,MediaRouter",
      // Autoplay: the harness starts playback programmatically, and a gesture
      // gate would leave every shot on a silent, motionless first frame.
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=1360,860",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const page = await waitFor("cdp page", async () => {
    const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
    return list.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
  });
  cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();

  let mounted = false;
  for (let attempt = 1; attempt <= 4 && !mounted; attempt++) {
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${VITE_PORT}/` });
    mounted = await waitFor(
      "dev hooks",
      () => cdp.eval(`!!(window.__store && window.__engine)`, false).catch(() => false),
      20_000,
    ).catch(() => false);
    if (!mounted) console.log("RELOAD", attempt, "(dep pre-bundle reload)");
  }
  if (!mounted) throw new Error(`app never mounted\n${viteLog.slice(-2000)}`);

  // 1280x720 exactly, so every still is comparable and matches the plan.
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // Stage mode, not just `chromeIdle`: the top bar, the mode strip and the
  // transport are all `.chrome`, and the canvas is FULL-BLEED behind them, so
  // clipping to the canvas still composites every one of them into the shot.
  // `.app.stage-mode .chrome { display: none }` is the only thing that
  // actually takes them out of the frame.
  await cdp.eval(`window.__store.getState().setStageMode(true); true`, false);

  // Read AFTER the renderer has had a chance to install: `rendererKind` is
  // seeded with a placeholder and only becomes real when the loop starts, so
  // probing it at mount reports the placeholder and cries wolf.
  await waitFor("renderer", () =>
    cdp.eval(`window.__store.getState().rendererKind !== "…"`, false),
  );
  const backend = await cdp.eval(`window.__store.getState().rendererKind`, false);
  console.log("RENDERER", backend);
  if (backend !== "webgpu") {
    console.warn(`WARNING: renderer is "${backend}" — stills are NOT WebGPU evidence`);
  }

  const run = SHOTS.filter((s) => only.length === 0 || only.includes(s.id));
  let loaded = null;
  for (const shot of run) {
    if (loaded !== shot.demo) {
      await loadDemoAndPlay(cdp, shot.demo);
      loaded = shot.demo;
      // sectionPulse and the beat grid only exist after analysis lands, and
      // two of the five are built around section boundaries.
      // A real beat grid, not just `analyzing === false`: the flag is also
      // false in the gap BEFORE analysis starts, and two of the five entries
      // are built on section boundaries that do not exist until it lands.
      await sleep(800);
      await waitFor("analysis", () =>
        cdp.eval(
          `(() => { const s = window.__store.getState();
             return s.analyzing === false && !!s.beatGrid; })()`,
          false,
        ),
      );
    }
    const json = readFileSync(path.join(HERE, "themes", `${shot.id}.bftheme`), "utf8");
    await cdp
      .eval(
        `(() => { window.__store.getState().importThemeText(${JSON.stringify(json)});
         return window.__store.getState().error; })()`,
        false,
      )
      .then((err) => {
        if (err) throw new Error(`${shot.id}: import refused — ${err}`);
      });
    if (shot.title) {
      await cdp.eval(
        `(() => { window.__store.setState({ trackMeta: { title: ${JSON.stringify(shot.title)}, artist: ${JSON.stringify(shot.artist ?? "")} } });
           window.__store.getState().refreshOverlay(); return true; })()`,
        false,
      );
    }
    for (const { t, tag } of shot.at) {
      // AWAITED, and the engine's own play() — it resumes a suspended
      // AudioContext, which the store action does not. Without this the
      // transport sits paused, the clock never advances past the seek, and
      // every "after the drop" frame is really an "at the seek" frame with
      // the lag envelopes and LFOs frozen where they landed.
      const playing = await cdp.eval(
        `(async () => {
           window.__engine.seek?.(${Math.max(0, t - SETTLE_S)});
           await window.__engine.play();
           return window.__engine.state.playing; })()`,
      );
      if (!playing) throw new Error(`${shot.id}: playback would not start`);
      await sleep(SETTLE_S * 1000);
      const landed = await cdp.eval(`window.__engine.state.time`, false);
      if (Math.abs(landed - t) > 0.75) {
        console.warn(`  note: ${shot.id}-${tag} landed at ${landed.toFixed(2)}s, wanted ${t}s`);
      }
      const file = path.join(OUT, `${shot.id}-${tag}.png`);
      await cdp.shotCanvas(file, { settleMs: 250 });
      console.log("SHOT", path.basename(file), `t=${landed.toFixed(2)}s`);
    }
  }
  console.log("EVIDENCE OK", run.length, "candidates");
} finally {
  cdp?.close();
  browser?.kill();
  vite.kill();
  // Belt and braces on Windows: kill the whole tree, so --strictPort is free
  // for the next run even if a worker outlives the parent.
  if (process.platform === "win32" && vite.pid) {
    spawn("taskkill", ["/pid", String(vite.pid), "/t", "/f"], { stdio: "ignore" });
  }
}
