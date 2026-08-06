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
import path from "node:path";
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

/**
 * Spawn the app with an isolated WebView2 profile and a remote-debugging
 * port. Returns a handle: { child, port, exe, profileDir, log() }.
 *
 *   root         repo root (harnesses resolve it from import.meta.url)
 *   portBase     REQUIRED — this harness's base from the map above
 *   profileName  directory name under node_modules/.cache for the profile
 *   exe          override binary (default BEATFORM_EXE, then debug shell)
 *   profileDir   override profile path (default WV2_PROFILE_DIR, then
 *                node_modules/.cache/<profileName>)
 *   cwd, env     extra spawn options (env is merged over process.env)
 */
export function spawnApp({ root, portBase, profileName, exe, profileDir, cwd, env = {} }) {
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
  return { child, port, exe: file, profileDir: profile, log: () => log };
}

/**
 * Poll the devtools /json/list endpoint until the app's page target shows
 * up. Default match: a page with a webSocketDebuggerUrl on localhost (the
 * dev frontend); pass `match` for other shapes (e.g. the installed app's
 * title). Throws with the app's log tail on timeout or app exit.
 */
export async function waitForPage(app, { timeoutMs = 240_000, intervalMs = 500, match } = {}) {
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
