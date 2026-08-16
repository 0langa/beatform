// Shared debug-shell boot / page-poll / attach / kill for the device
// harnesses (P-14-lite). One copy of the plumbing that was pasted into a
// dozen scripts with drifted timeouts and colliding ports.
//
// PORT-BASE MAP — every harness owns a distinct base so parallel runs cannot
// collide. Effective port = base + (pid % 80), so bases are spaced >= 80:
//
//   9060   heap-soak.mjs
//   9140   perf-family-check.mjs
//   9220   midi-probe.mjs
//   9300   wave-shots.mjs             (historical base, kept)
//   9380   midi-e2e.mjs
//   9460   v268-visual-check.mjs
//   9600   gallery-e2e.mjs            (historical)
//   9700   gallery-seed-shots.mjs     (historical)
//   9800   shadertoy-smoke.mjs        (historical)
//   9900   loopback-smoke.mjs         (historical)
//   9980   av1-e2e.mjs
//   10060  lyrics-e2e.mjs
//   10140  installed-runtime-smoke.mjs
//   10220  p11-smoke.mjs               (undocumented base, added retroactively)
//   10300  gallery-builtin-shots.mjs   (CDP debug port only — Vite itself
//                                       runs on :1427, --strictPort, a
//                                       separate port this harness owns)
//   10380  segment-parity-probe.mjs    (moved off 10220 — three scripts had
//                                       independently claimed it)
//   10460  deepcolor-verify.mjs --prores  (same collision, same move)
//
//   (gpu-pixel-matrix.mjs predates this map and rolls 9400 + pid % 500 —
//   a span that overlaps several bases above. It accepts --port=<n>; pass
//   one when running it alongside another harness.)
//
// WebView2 PROFILE ISOLATION: the debug exe and an installed Beatform share
// a user-data folder by default, and a second WebView2 process JOINS the
// existing browser — silently dropping the debugging port AND entangling a
// harness with an app the owner may have open. Every spawnApp() therefore
// uses an ISOLATED WEBVIEW2_USER_DATA_FOLDER. Profiles live under
// node_modules/.cache on the repo drive (C:, NTFS) — NEVER on devstorage:
// WebView2 profiles need ACLs/locking that exFAT does not provide.
// WV2_PROFILE_DIR overrides the location; BEATFORM_EXE overrides the exe
// (e.g. a CARGO_TARGET_DIR build elsewhere).
//
// KILL DISCIPLINE: PID-tree only (taskkill /PID <pid> /T /F). NEVER a
// name-wide sweep — `Get-Process -Name beatform | Stop-Process` would take
// down an installed Beatform the owner has open. /T covers the WebView2 and
// sidecar children the app itself spawned.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { Cdp } from "./cdp.mjs";

/** Default debug-shell path for a repo root. */
export function debugExe(root) {
  return path.join(root, "src-tauri", "target", "debug", "beatform.exe");
}

/** Per-run port from a harness's base (see the map above). */
export function harnessPort(base) {
  return base + (process.pid % 80);
}

/** Expression that warms the dynamic @tauri-apps import. On a cold Vite dep
 * cache it triggers "new dependencies optimized — reloading page", which
 * destroys the eval context — run it as an attachWithRecovery probe so the
 * reload is absorbed BEFORE the real run. */
export const TAURI_WARMUP = `import("@tauri-apps/api/core").then(() => true)`;

// STALE DEV SERVER (G9): no harness starts Vite — they spawn the debug shell,
// which loads the `devUrl` baked into tauri.conf.json. On this machine
// `host: false` makes Vite listen on `localhost`, and `localhost` resolves to
// `[::1]` BEFORE `127.0.0.1` — so a leftover dev server can hold `[::1]:1420`
// while a fresh one binds `127.0.0.1:1420` without either noticing. The app
// then loads someone else's tree and the harness dies on its first eval with
// "Cannot find execution context", which names nothing. The probe below
// stamps whatever answers that URL against THIS checkout before the first
// eval can lie about the cause. The dual-stack incantations are in GATES.md
// §3: `npm run dev -- --host`, or `TAURI_DEV_HOST=127.0.0.1 npm run dev`.

/** `public/icon.svg` is the stamp: index.html links it, so it cannot silently
 * disappear, and Vite serves publicDir files VERBATIM from the server's OWN
 * root — bytes prove the project, `Last-Modified` proves the checkout (two
 * worktrees of this repo hold byte-identical files with different mtimes). */
const STAMP_FILE = ["public", "icon.svg"];

/** The URL the debug shell will load, read from the SAME config the app reads
 * so the probe can never end up checking a different port than the app uses. */
function devUrlFor(root) {
  try {
    const conf = JSON.parse(readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
    return typeof conf?.build?.devUrl === "string" ? conf.build.devUrl : null;
  } catch {
    return null;
  }
}

/** Origins to probe for `devUrl`. `localhost` is BOTH families here and the
 * whole failure mode is two servers, one per family — so probe each address
 * explicitly instead of letting the resolver pick one for us. */
function probeOrigins(devUrl) {
  const u = new URL(devUrl);
  if (u.hostname !== "localhost") return [u.origin];
  const port = u.port ? `:${u.port}` : "";
  return [`${u.protocol}//127.0.0.1${port}`, `${u.protocol}//[::1]${port}`];
}

/** Best-effort culprit ID: ask the answering server for a file by absolute
 * path. A Vite outside whose serving roots that path lies refuses with a 403
 * whose body LISTS those roots — which names the tree actually answering.
 * Two probes because Vite only 403s a path that EXISTS (a missing one falls
 * through to the SPA index): our own index.html, which a server rooted at a
 * SIBLING tree refuses, then node's own binary, for a server rooted at an
 * ANCESTOR of this tree — that one would serve our index.html quite happily.
 * Purely diagnostic; the verdict never depends on it. */
async function foreignRoot(origin, root, timeoutMs) {
  for (const file of [path.join(root, "index.html"), process.execPath]) {
    try {
      const url = `${origin}/@fs/${file.replace(/\\/g, "/")}`;
      // globalThis.: scripts/**.mjs declare only console/process/fetch/Buffer
      // to eslint — the lib/cdp.mjs `globalThis.WebSocket` idiom.
      const res = await fetch(url, { signal: globalThis.AbortSignal.timeout(timeoutMs) });
      if (res.status !== 403) continue;
      const dirs = [...(await res.text()).matchAll(/- ([^<]+)<br\/>/g)].map((m) => m[1]);
      const hit = dirs.find((d) => !d.includes("node_modules"));
      if (hit) return hit;
    } catch {
      /* not this probe */
    }
  }
  return null;
}

async function probeDevServer(root, devUrl, timeoutMs) {
  if (!devUrl) return; // no devUrl in tauri.conf.json — nothing to assert
  const stamp = path.join(root, ...STAMP_FILE);
  let want;
  try {
    want = { bytes: readFileSync(stamp), mtime: statSync(stamp).mtime.toUTCString() };
  } catch {
    return; // the stamp file moved — never block a run over the probe's own asset
  }
  const url = `/${STAMP_FILE.slice(1).join("/")}`;
  const answered = [];
  for (const origin of probeOrigins(devUrl)) {
    let res;
    let body;
    try {
      res = await fetch(origin + url, { signal: globalThis.AbortSignal.timeout(timeoutMs) });
      body = Buffer.from(await res.arrayBuffer());
    } catch {
      continue; // nothing listening on this address family — fine, that is normal
    }
    const lastMod = res.headers.get("last-modified");
    // A server that omits Last-Modified is judged on bytes alone rather than
    // failed on a header it never promised.
    const ours =
      res.status === 200 && body.equals(want.bytes) && (!lastMod || lastMod === want.mtime);
    answered.push({ origin, ours });
  }
  if (answered.length === 0) {
    throw new Error(
      `no dev server answered ${devUrl} (tried ${probeOrigins(devUrl).join(", ")}) — the debug ` +
        `shell loads that URL and will render nothing. Start Vite first:\n` +
        `  npm run dev -- --host`,
    );
  }
  const wrong = answered.filter((a) => !a.ours);
  if (wrong.length === 0) return;
  const who = await foreignRoot(wrong[0].origin, root, timeoutMs);
  throw new Error(
    `a different dev server is already serving ${devUrl}\n` +
      `  ${wrong[0].origin} served ${url} from another tree` +
      (who ? ` (rooted at ${who})` : "") +
      `\n  this harness is ${root}\n` +
      `  Kill it and serve THIS tree instead. Two dev servers coexist on one ` +
      `port here — plain \`npm run dev\` listens on [::1] only — so start it ` +
      `dual-stack: npm run dev -- --host   (GATES.md §3)`,
  );
}

/**
 * Start the dev-server stamp check for `root`. Returns the promise that
 * `waitForPage` re-awaits — resolving when the server answering the app's
 * `devUrl` is this checkout's, rejecting loudly when it is someone else's.
 * The rejection is parked here so a harness that dies before its first
 * `waitForPage` does not turn this into an unhandled rejection.
 */
export function checkDevServer({ root, devUrl = devUrlFor(root), timeoutMs = 3000 } = {}) {
  const p = probeDevServer(root, devUrl, timeoutMs);
  p.catch(() => {});
  return p;
}

/**
 * Spawn the app with an isolated WebView2 profile and a remote-debugging
 * port. Returns a handle: { child, port, exe, profileDir, devServerCheck,
 * log() }.
 *
 *   root         repo root (harnesses resolve it from import.meta.url)
 *   portBase     REQUIRED — this harness's base from the map above
 *   profileName  directory name under node_modules/.cache for the profile
 *   exe          override binary (default BEATFORM_EXE, then debug shell)
 *   profileDir   override profile path (default WV2_PROFILE_DIR, then
 *                node_modules/.cache/<profileName>)
 *   cwd, env     extra spawn options (env is merged over process.env)
 *   devServer    false for a harness driving a BUILT app (no Vite involved) —
 *                every caller today runs the debug shell against the dev
 *                server, so the stamp check defaults on
 */
export function spawnApp({
  root,
  portBase,
  profileName,
  exe,
  profileDir,
  cwd,
  env = {},
  devServer = true,
}) {
  if (!portBase) throw new Error("spawnApp: portBase is required (see the map in lib/app.mjs)");
  const port = harnessPort(portBase);
  const file = exe ?? process.env.BEATFORM_EXE ?? debugExe(root);
  const profile =
    profileDir ??
    process.env.WV2_PROFILE_DIR ??
    path.join(root, "node_modules", ".cache", profileName ?? "wv2-harness-profile");
  const existingArgs = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? "";
  let log = "";
  const child = spawn(file, [], {
    cwd: cwd ?? root,
    windowsHide: true,
    env: {
      ...process.env,
      ...env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        `${existingArgs} --remote-debugging-port=${port}`.trim(),
      WEBVIEW2_USER_DATA_FOLDER: profile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keep = (c) => (log = (log + c.toString()).slice(-20_000));
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  // The stamp probe starts NOW so it overlaps the app's boot, but this
  // function cannot become async: every harness does `app = spawnApp(...)`
  // and then `killTree(app)` in a finally, and a promise there kills nothing.
  // waitForPage() re-awaits it, which is strictly before any eval could
  // report the wrong tree as "Cannot find execution context".
  const devServerCheck = devServer ? checkDevServer({ root }) : null;
  return { child, port, exe: file, profileDir: profile, devServerCheck, log: () => log };
}

/**
 * Poll the devtools /json/list endpoint until the app's page target shows
 * up. Default match: a page with a webSocketDebuggerUrl on localhost (the
 * dev frontend); pass `match` for other shapes (e.g. the installed app's
 * title). Throws with the app's log tail on timeout or app exit.
 */
export async function waitForPage(app, { timeoutMs = 240_000, intervalMs = 500, match } = {}) {
  // A wrong dev server must surface HERE (G9) — before the 240 s timeout
  // below, and before the first eval blames the execution context for it.
  if (app.devServerCheck) await app.devServerCheck;
  const isMatch =
    match ??
    ((p) => p.type === "page" && p.webSocketDebuggerUrl && /localhost|127\.0\.0\.1/.test(p.url));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (app.child.exitCode != null) {
      throw new Error(`app exited ${app.child.exitCode}\n${app.log()}`);
    }
    try {
      const pages = await fetch(`http://127.0.0.1:${app.port}/json/list`).then((r) => r.json());
      const m = pages.find(isMatch);
      if (m) return m;
    } catch {
      /* not ready */
    }
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for WebView2\n${app.log()}`);
}

/** waitForPage + Cdp open. */
export async function attach(app, pageOpts) {
  const target = await waitForPage(app, pageOpts);
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  return cdp;
}

/**
 * Attach, run `probe(cdp)`, and on failure re-attach ONCE and re-probe.
 * Vite pushes one reload shortly after a cold boot (dep re-optimize / ws
 * reconnect), which destroys the eval context mid-wait — this absorbs it
 * (the v2.68 lesson). Pass the hook wait or TAURI_WARMUP as the probe.
 */
export async function attachWithRecovery(app, probe, { retrySleepMs = 2500, pageOpts } = {}) {
  let cdp = await attach(app, pageOpts);
  if (!probe) return cdp;
  try {
    await probe(cdp);
  } catch {
    cdp.close();
    await sleep(retrySleepMs);
    cdp = await attach(app, pageOpts);
    await probe(cdp);
  }
  return cdp;
}

/**
 * Wait inside the page until the named dev hooks exist on window
 * (e.g. ["__store", "__engine"]). The standard 60 s / 100 ms poll.
 */
export function waitHooks(cdp, hooks = ["__store"], { timeoutMs = 60_000 } = {}) {
  const cond = hooks.map((h) => `window.${h}`).join(" && ");
  return cdp.eval(`(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const deadline = Date.now() + ${timeoutMs};
    while (!(${cond})) {
      if (Date.now() > deadline) throw new Error("hooks unavailable");
      await delay(100);
    }
    return true;
  })()`);
}

/** Kill the app's OWN process tree, and only that. */
export function killTree(app) {
  const pid = app?.child?.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* gone */
    }
  } else {
    try {
      app.child.kill("SIGTERM");
    } catch {
      /* gone */
    }
  }
}
