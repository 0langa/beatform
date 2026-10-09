/* global process, console, fetch, Buffer */
// Track C evidence harness: photographs every row of the veto sheet.
//
//   node trackc-candidates/shots.mjs [--rows=themes|looks|all] [--only=id1,id2]
//
// Rows 1-5 (the flagship .bftheme candidates) are applied through the app's
// REAL import path, `importThemeText` — the same entry point a drag-import and
// a gallery install use — because the point of that evidence is that the FILE
// works. Rows 6-18 (the look deltas and the new looks) are applied as a whole
// document instead, for a reason worth keeping: a look carries params and sync
// ONLY, so applying one leaves whatever post chain, background and motion the
// document already had. Photographing look #12 through a store still wearing
// look #11's leftovers would compare two things that differ in more than the
// delta. Each look shot therefore starts from a NEUTRAL document (default post,
// default motion, preset background) with only that look's params and sync
// written in — which is also exactly what a user gets applying it to a fresh
// project, and what `scripts/gallery-seed-shots.mjs` captured the approved
// seeds against.
//
// Differences from that seed harness, which this follows otherwise:
//
//  - It drives a BROWSER against `vite`, not the Tauri debug shell. The shell
//    needs the lyrics sidecar built before cargo will run at all; `npm run dev`
//    is the documented fast path and renders through the same WebGPU renderer.
//    The window is real (not headless) on purpose — headless Chromium falls
//    back to a software adapter, and a Canvas2D fallback shot would be evidence
//    for a renderer this content does not use.
//  - It spawns its own Vite on 1424 --strictPort and kills it at the end, so it
//    can never collide with another lane's 1420.
//
// It finishes by writing web-weight JPEG copies of every still into
// evidence-web/, converted IN THE PAGE (createImageBitmap -> canvas ->
// toDataURL) because the repo has no image library and this needs no new
// dependency. Quality steps down until each file is under the size cap.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os";
import { Cdp } from "../scripts/lib/cdp.mjs";
import { loadDemoAndPlay } from "../scripts/lib/demo.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(HERE, "evidence");
const WEB_OUT = path.join(HERE, "evidence-web");
const VITE_PORT = 1424;
const CDP_PORT = 9744;
/** Web-weight budget per still. 28 stills x 250 KB stays well inside the
 * review page's 16 MB ceiling. */
const WEB_MAX_BYTES = 250 * 1024;
// OUTSIDE the repo, and this is load-bearing: Vite watches the project tree,
// and a Chromium profile inside it makes chokidar try to watch the locked
// `Network/Cookies` file. That throws EBUSY on the FSWatcher, which kills the
// dev server mid-load — the module requests come back ERR_CONNECTION_RESET
// and the app never mounts. It looks exactly like a broken app.
const PROFILE = path.join(tmpdir(), "beatform-trackc-shots-profile");

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? "").split("=")[1];
const only = (arg("only") ?? "").split(",").filter(Boolean);
const rows = arg("rows") ?? "all";

/**
 * Rows 1-5. `t` is TRACK TIME per frame — chosen per entry rather than shared,
 * because the moments that matter differ: Cold Open has to be caught inside its
 * standby scene AND after the glitch, and the slow entries need a quiet bar and
 * a loud one to show the lag doing something.
 *
 * `title`/`artist` stage the overlay tokens. A demo track loads with its own
 * name as the title and an EMPTY artist, so the one candidate whose design is a
 * title lockup would photograph with half of it missing. Stand-in tags, exactly
 * as a real track's would be, and the veto sheet says so.
 *
 * The demo tracks are short and do NOT loop (groove 16 s, neuro 22 s, drift
 * 27 s), so every time below sits inside its own track — a seek past the end
 * would photograph silence.
 */
const THEME_SHOTS = [
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

/**
 * The three C2 rows that get a BEFORE frame as well as the proposed one,
 * because in each the argument is a comparison rather than a description:
 *  - abyssal-bloom: the v14 saturation misread — the whole claim is "this is
 *    rendering flatter than you approved", which is unreadable without the pair;
 *  - orchid-glass: `environment` Void -> Studio, i.e. the look finally being
 *    the "studio chrome" its own description promises;
 *  - solar-temple: 12 authored params against a 27-param mode, the biggest
 *    single jump in the pass.
 * Every other row's delta is legible from one frame plus its prose.
 */
const BEFORE_PAIRS = new Set(["abyssal-bloom", "orchid-glass", "solar-temple"]);

/** C3 looks have no seed entry, so they carry their own demo + settle. */
const C3_SHOOT = {
  "ember-veil": { demo: "drift", settle: 6 },
  // The waterfall is a scrolling history: it needs bars of playback before
  // there is anything to see below the top row.
  "sonar-wall": { demo: "groove", settle: 8 },
  "wide-glass": { demo: "groove", settle: 4 },
  "phase-bloom": { demo: "groove", settle: 5 },
};

/** Seconds between the seek and the shutter for the THEME rows — feedback,
 * phosphor and particle state all look wrong right after a seek. */
const SETTLE_S = 2.2;
/** Where the look rows seek to before their own settle, matching the seed
 * harness's `seekAndPlay` default so the frames are comparable to the
 * originally approved previews. */
const LOOK_SEEK_S = 2;

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

/**
 * Recover the seed harness's `LOOKS` array — a module-private `const` in a
 * script with no exports, so the literal is sliced out and evaluated. Same
 * approach `looks.test.ts` uses, and for the same reason: the demo track and
 * settle each seed was originally shot against are the only way a before/after
 * pair is genuinely comparable, and hand-copying them is how they drift.
 */
function liveSeeds() {
  const src = readFileSync(path.join(ROOT, "scripts", "gallery-seed-shots.mjs"), "utf8");
  const open = src.indexOf("[", src.indexOf("const LOOKS = ["));
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  return new Function(`return ${src.slice(open, end)}`)();
}

/**
 * A complete ProjectDocument at defaults, carrying one look's params + sync.
 * Everything a look does NOT own is pinned neutral so consecutive look shots
 * differ only by the look. `builderStack` is borrowed from an emitted candidate
 * rather than invented: it has to be a real stack, and those are deterministic.
 */
function neutralDoc(presetId, params, sync, builderStack) {
  return {
    presetId,
    paramsByPreset: { [presetId]: params },
    syncByPreset: sync ? { [presetId]: sync } : {},
    bg: { mode: 0, color: [0, 0, 0] },
    bgByPreset: {},
    centerImageByPreset: {},
    overlayLayers: [],
    assets: {},
    aspect: "16:9",
    modsByPreset: {},
    smoothSpectrum: false,
    timeline: { enabled: false, scenes: [], lanes: [] },
    post: {
      bloom: 0,
      bloomThreshold: 1,
      exposure: 1,
      tonemap: false,
      vignette: 0,
      grain: 0,
      chromatic: 0,
    },
    motion: { rotation: 1, pulse: 1, detail: 1, spectrumSmooth: 0 },
    lyricStyle: {
      enabled: true,
      position: "bottom",
      size: 1,
      color: "#ffffff",
      fadeSec: 0.15,
      anim: "plain",
    },
    audiogram: {
      progressBar: false,
      timeReadout: false,
      waveformStrip: false,
      position: "bottom",
      color: "#7c5cff",
    },
    customDefs: [],
    builderStack,
  };
}

/** Build the row 6-18 plan from the emitted .bfpreset files + the live seeds. */
function lookShots() {
  const seeds = new Map(liveSeeds().map((s) => [s.id, s]));
  const stack = JSON.parse(readFileSync(path.join(HERE, "themes", "deep-current.bftheme"), "utf8"))
    .document.builderStack;
  const out = [];
  for (const file of readdirSync(path.join(HERE, "looks")).sort()) {
    const id = file.replace(/\.bfpreset$/, "");
    const { preset } = JSON.parse(readFileSync(path.join(HERE, "looks", file), "utf8"));
    const seed = seeds.get(id);
    const shoot = seed
      ? { demo: seed.demo, settle: seed.settle ?? 5 }
      : (C3_SHOOT[id] ?? { demo: "groove", settle: 5 });
    if (seed && BEFORE_PAIRS.has(id)) {
      // The seed EXACTLY as it ships today: its own params, and no sync at all
      // — not one of the nine carries one, which is half of what the pass is
      // about.
      out.push({
        id,
        tag: "before",
        ...shoot,
        doc: neutralDoc(seed.mode, seed.params, undefined, stack),
      });
    }
    out.push({
      id,
      tag: seed && BEFORE_PAIRS.has(id) ? "after" : "proposed",
      ...shoot,
      doc: neutralDoc(preset.presetId, preset.params, preset.sync, stack),
    });
  }
  // Group by demo so the session reloads each track once instead of per row.
  const order = { groove: 0, neuro: 1, drift: 2 };
  return out.sort((a, b) => (order[a.demo] ?? 9) - (order[b.demo] ?? 9));
}

/**
 * PNG -> JPEG in the page. No image library in this repo and none worth adding
 * for a lane that never merges, and the browser is already running. Bytes go in
 * as a Blob (never a data: URL — the app ships a CSP and this sidesteps it
 * entirely), and quality steps down until the file fits the cap.
 */
async function toWebJpeg(cdp, pngPath, jpgPath) {
  const b64 = readFileSync(pngPath).toString("base64");
  await cdp.eval(
    `(async () => {
       const bin = atob(${JSON.stringify(b64)});
       const bytes = new Uint8Array(bin.length);
       for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
       window.__bmp?.close?.();
       window.__bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
       return true; })()`,
  );
  for (const q of [0.8, 0.72, 0.64, 0.56, 0.46]) {
    const url = await cdp.eval(
      `(() => {
         const b = window.__bmp;
         const c = document.createElement("canvas");
         c.width = b.width; c.height = b.height;
         c.getContext("2d").drawImage(b, 0, 0);
         return c.toDataURL("image/jpeg", ${q}); })()`,
      false,
    );
    const buf = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    if (buf.length <= WEB_MAX_BYTES || q === 0.46) {
      writeFileSync(jpgPath, buf);
      return { bytes: buf.length, q };
    }
  }
}

mkdirSync(OUT, { recursive: true });
mkdirSync(WEB_OUT, { recursive: true });

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

  let loaded = null;
  const ensureDemo = async (demo) => {
    if (loaded === demo) return;
    await loadDemoAndPlay(cdp, demo);
    loaded = demo;
    // A real beat grid, not just `analyzing === false`: the flag is also false
    // in the gap BEFORE analysis starts, and several entries are built on
    // section boundaries that do not exist until it lands.
    await sleep(800);
    await waitFor("analysis", () =>
      cdp.eval(
        `(() => { const s = window.__store.getState();
           return s.analyzing === false && !!s.beatGrid; })()`,
        false,
      ),
    );
  };
  const shoot = async (file, wantT) => {
    const landed = await cdp.eval(`window.__engine.state.time`, false);
    if (wantT != null && Math.abs(landed - wantT) > 0.75) {
      console.warn(`  note: ${file} landed at ${landed.toFixed(2)}s, wanted ${wantT}s`);
    }
    await cdp.shotCanvas(path.join(OUT, file), { settleMs: 250 });
    console.log("SHOT", file, `t=${landed.toFixed(2)}s`);
  };
  // AWAITED, and the engine's own play() — it resumes a suspended AudioContext,
  // which the store action does not. Without this the transport sits paused,
  // the clock never advances past the seek, and every "after the drop" frame is
  // really an "at the seek" frame with the lag envelopes and LFOs frozen.
  const seekPlay = async (id, at) => {
    const playing = await cdp.eval(
      `(async () => {
         window.__engine.seek?.(${at});
         await window.__engine.play();
         return window.__engine.state.playing; })()`,
    );
    if (!playing) throw new Error(`${id}: playback would not start`);
  };

  let shots = 0;

  if (rows === "all" || rows === "themes") {
    for (const shot of THEME_SHOTS.filter((s) => !only.length || only.includes(s.id))) {
      await ensureDemo(shot.demo);
      const json = readFileSync(path.join(HERE, "themes", `${shot.id}.bftheme`), "utf8");
      const err = await cdp.eval(
        `(() => { window.__store.getState().importThemeText(${JSON.stringify(json)});
           return window.__store.getState().error; })()`,
        false,
      );
      if (err) throw new Error(`${shot.id}: import refused — ${err}`);
      if (shot.title) {
        await cdp.eval(
          `(() => { window.__store.setState({ trackMeta: { title: ${JSON.stringify(shot.title)}, artist: ${JSON.stringify(shot.artist ?? "")} } });
             window.__store.getState().refreshOverlay(); return true; })()`,
          false,
        );
      }
      for (const { t, tag } of shot.at) {
        await seekPlay(shot.id, Math.max(0, t - SETTLE_S));
        await sleep(SETTLE_S * 1000);
        await shoot(`${shot.id}-${tag}.png`, t);
        shots++;
      }
    }
  }

  if (rows === "all" || rows === "looks") {
    for (const shot of lookShots().filter((s) => !only.length || only.includes(s.id))) {
      await ensureDemo(shot.demo);
      await cdp.eval(
        `(() => { window.__store.getState().applyTheme(${JSON.stringify(shot.doc)}, ${JSON.stringify(shot.id)}); return true; })()`,
        false,
      );
      await seekPlay(shot.id, LOOK_SEEK_S);
      await sleep(shot.settle * 1000);
      await shoot(`${shot.id}-${shot.tag}.png`, LOOK_SEEK_S + shot.settle);
      shots++;
    }
  }

  console.log("STILLS", shots);

  // ---- web-weight pass over EVERY still, not just this run's ----
  let total = 0;
  const files = readdirSync(OUT)
    .filter((f) => f.endsWith(".png"))
    .sort();
  for (const f of files) {
    const r = await toWebJpeg(
      cdp,
      path.join(OUT, f),
      path.join(WEB_OUT, f.replace(/\.png$/, ".jpg")),
    );
    total += r.bytes;
    const over = r.bytes > WEB_MAX_BYTES ? "  OVER CAP" : "";
    console.log(
      `WEB ${f.replace(/\.png$/, ".jpg")} ${(r.bytes / 1024).toFixed(0)}KB q=${r.q}${over}`,
    );
  }
  console.log(`WEB TOTAL ${files.length} files, ${(total / 1024).toFixed(0)} KB`);
  console.log("EVIDENCE OK");
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
