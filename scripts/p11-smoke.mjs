// P-11 device smoke — desktop boots from the autosave file, not localStorage
// (PLAN-P11.md / .superpowers/p11-lane-log.md). Runs the six coordinator
// scenarios (S1-S6) against a REAL Tauri shell built under an identifier
// OVERLAY (com.olanga.audiovisualizer.p11smoke, see scripts/p11-smoke.conf.json)
// so it can never adopt or overwrite the owner's real document at
// %APPDATA%\com.olanga.audiovisualizer\.
//
//   node scripts/p11-smoke.mjs [--only=S1,S3] [--exe=<absolute path>]
//
// Boot is spawnApp() from lib/app.mjs (P-14-lite) with an ISOLATED
// WEBVIEW2_USER_DATA_FOLDER per scenario (kept under node_modules/.cache on
// the repo drive, per that file's own hard rule — never on exFAT devstorage).
// The Tauri filesystem AppData (document.bfproj and friends) is INDEPENDENT
// of the WebView2 profile — it is keyed by the app identifier alone — so
// every scenario resets it explicitly rather than relying on profile
// isolation to do that job.
//
// Port base 10220: the next free slot after lib/app.mjs's map (which tops
// out at 10140 for installed-runtime-smoke.mjs), kept >=80 past it so a
// concurrent run of any mapped harness cannot collide. Not added to that
// file's own comment — this script isn't in the map's file, and the task
// scope for this lane is exactly the two files named in the smoke's own
// instructions.
//
// Requires the exe to have been built with VITE_E2E_HOOKS=1 (installDevHooks
// gate, src/App.tsx) — a release `vite build` otherwise never installs
// window.__store, which every scenario below reads/polls. Same documented
// trick loopback-smoke.mjs's own comment names for optimized validation.
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
// Callback-style timers, explicitly imported: this dir's eslint config only
// allowlists console/process/fetch/Buffer as globals (see lib/app.mjs's own
// comment on the same constraint) — the promise-based `sleep` above covers
// most needs, but waitForExit needs a CANCELLABLE handle (clearTimeout),
// which only the callback API provides.
import { setTimeout as setTimer, clearTimeout as clearTimer } from "node:timers";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp } from "./lib/cdp.mjs";
import { spawnApp, waitForPage, killTree } from "./lib/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT_BASE = 10220;
const IDENTIFIER = "com.olanga.audiovisualizer.p11smoke";

const exeArg = process.argv.find((a) => a.startsWith("--exe="));
const CARGO_TARGET_DIR =
  process.env.CARGO_TARGET_DIR ??
  "F:\\agent-devstorage\\shared-cache\\audio-visualizer\\cache\\cargo-target-worktree";
const EXE_PATH = exeArg
  ? path.resolve(exeArg.slice("--exe=".length))
  : path.join(CARGO_TARGET_DIR, "release", "beatform.exe");

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",")) : null;

// Two built-in preset ids, distinct from the default (presets[0] ==
// "spectrum-bars") and from each other — see src/render/presets/{nebula,
// oscilloscope}.ts.
const ALT_PRESET_A = "nebula";
const ALT_PRESET_B = "oscilloscope";

function smokeAppDataDir() {
  return path.join(process.env.APPDATA, IDENTIFIER);
}

function documentPath() {
  return path.join(smokeAppDataDir(), "document.bfproj");
}

/** Delete document.bfproj + its tmp/quarantine siblings, leaving the rest of
 * the AppData dir (if any) untouched. Used at the start of every scenario so
 * scenarios are independent regardless of run order. */
function resetSmokeDocument() {
  const dir = smokeAppDataDir();
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (
      f === "document.bfproj" ||
      f === "document.bfproj.tmp" ||
      f.startsWith("document.bfproj.corrupt-")
    ) {
      fs.rmSync(path.join(dir, f), { force: true });
    }
  }
}

/** Full wipe — the "no AppData dir at all" precondition (S1), and the
 * before/after-the-whole-run cleanup the task's setup section asks for. */
function resetSmokeAppDataDirCompletely() {
  fs.rmSync(smokeAppDataDir(), { recursive: true, force: true });
}

function listCorruptSiblings() {
  const dir = smokeAppDataDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("document.bfproj.corrupt-"))
    .map((f) => path.join(dir, f));
}

async function waitForFile(filePath, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return true;
    await sleep(intervalMs);
  }
  return fs.existsSync(filePath);
}

/** Poll document.bfproj until its presetId matches (or the deadline passes),
 * rather than one flat sleep-then-read — absorbs ordinary timer jitter
 * around the 5s autosave interval instead of treating a few hundred ms of
 * slack as a hard failure. Tolerates the brief tmp+rename window (a read
 * mid-rename is a Windows race, not a real failure) by just retrying.
 * Returns the last content it saw either way, so a genuine timeout still
 * reports what was actually on disk. */
async function waitForDocumentPreset(expectedPresetId, timeoutMs, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = readDocumentJson();
      if (last.document?.presetId === expectedPresetId) return last;
    } catch {
      // ENOENT or a mid-rename partial read — transient, keep polling.
    }
    await sleep(intervalMs);
  }
  return last;
}

function readDocumentJson() {
  const raw = fs.readFileSync(documentPath(), "utf8");
  return JSON.parse(raw);
}

const beatformTitleMatch = (entry) =>
  entry.type === "page" && entry.webSocketDebuggerUrl && entry.title === "Beatform";

function launch(profileName) {
  return spawnApp({
    root,
    portBase: PORT_BASE,
    profileName,
    exe: EXE_PATH,
    cwd: path.dirname(EXE_PATH), // mirror installed-runtime-smoke.mjs: boot from the exe's own dir
    devServer: false, // built app serves its bundled frontend, no Vite involved
  });
}

/** Poll for window.__store (installDevHooks, VITE_E2E_HOOKS=1 build) rather
 * than reusing lib/app.mjs's waitHooks — this one throws a message naming
 * the actual gate so a build without the env var fails legibly instead of a
 * bare 60s "hooks unavailable". */
async function waitStoreHook(cdp, timeoutMs = 60_000) {
  try {
    await cdp.eval(
      `(async () => {
        const delay = ms => new Promise(r => setTimeout(r, ms));
        const deadline = Date.now() + ${timeoutMs};
        while (!window.__store) {
          if (Date.now() > deadline) throw new Error("window.__store never appeared");
          await delay(50);
        }
        return true;
      })()`,
    );
  } catch (e) {
    throw new Error(
      `${e.message} — was the exe built with VITE_E2E_HOOKS=1? (installDevHooks gate, src/App.tsx)`,
      { cause: e },
    );
  }
}

async function waitDocumentComplete(cdp, timeoutMs = 45_000) {
  await cdp.eval(`new Promise((resolve, reject) => {
    if (document.readyState === "complete") return resolve(true);
    const timer = setTimeout(
      () => reject(new Error("document did not reach complete within ${timeoutMs}ms")),
      ${timeoutMs},
    );
    window.addEventListener("load", () => { clearTimeout(timer); resolve(true); }, { once: true });
  })`);
}

const SHELL_CHECK = `({
  title: document.title,
  readyState: document.readyState,
  canvasCount: document.querySelectorAll("canvas").length,
  webgpu: !!navigator.gpu,
  bodyLen: document.body.innerText.length
})`;

/** "Full load" per the scenarios' own wording: title + canvas + real content.
 * WebGPU is recorded, not required — Canvas2D is a supported fallback
 * (CLAUDE.md), so requiring it would fail a healthy machine without one. */
function assertShell(shell) {
  if (shell.title !== "Beatform") throw new Error(`wrong title: ${shell.title}`);
  if (shell.readyState !== "complete") throw new Error(`document state: ${shell.readyState}`);
  if (shell.canvasCount < 1) throw new Error("visual canvas missing");
  if (shell.bodyLen < 20)
    throw new Error("app shell did not render (no white screen check failed)");
}

/** Live console.* capture for a page — Runtime.enable already ran inside
 * cdp.open(); this just also listens for the event messages the Cdp class's
 * own handler ignores (it only resolves pending command replies). Pushes
 * into `sink` so one array can span multiple launches within a scenario. */
function captureConsole(cdp, sink = []) {
  cdp.ws.addEventListener("message", (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.method !== "Runtime.consoleAPICalled") return;
    const args = (m.params.args ?? [])
      .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? "")))
      .join(" ");
    sink.push(`[${m.params.type}] ${args}`);
  });
  return sink;
}

async function pollForBodyText(cdp, text, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await cdp.eval(
      `document.body.innerText.includes(${JSON.stringify(text)})`,
      false,
    );
    if (found) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function pollForErrorToast(cdp, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await cdp.eval(
      `document.querySelector(".toast.error-toast .toast-text")?.textContent ?? null`,
      false,
    );
    if (text) return text;
    await sleep(intervalMs);
  }
  return null;
}

/**
 * Poll the live store's presetId via CDP until it matches (or the deadline
 * passes), rather than one immediate read. `window.__store` existing proves
 * only that the FIRST RENDER committed (installDevHooks runs directly in
 * the render body, src/App.tsx) — bootDesktopDocument fires from a SEPARATE
 * useEffect and is itself async (a real Tauri IPC file read + parse +
 * apply), so there is a genuine, variable-width window after the store hook
 * appears where the synchronous default (spectrum-bars) is still the live
 * value. A single immediate read races that window: found live via a
 * standalone repro that polled docEpoch alongside presetId every 250ms —
 * t+0ms consistently showed {presetId:"spectrum-bars", docEpoch:0} (the
 * synchronous default), settling to the real value within one or two
 * intervals (docEpoch bumped by exactly 1, confirming a single correct
 * apply, never zero). Reproduced this racing S6's relaunch check specifically
 * at roughly a 33-67% rate across a handful of runs — NOT a production bug
 * (the on-disk document.bfproj was byte-identical and correct across every
 * single one of those runs, both immediately post-close and post-relaunch;
 * only the harness's own read was too early). Returns the last value seen
 * either way, so a genuine timeout still reports what was actually live.
 */
async function pollForStorePreset(cdp, expectedPresetId, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await cdp.eval(`window.__store.getState().presetId`, false);
    if (last === expectedPresetId) return last;
    await sleep(intervalMs);
  }
  return last;
}

/** Click a preset chip and return the store's presetId immediately after —
 * one round trip so there is no ambiguity about ordering relative to a
 * separate read. queuePreset falls back to an INSTANT switchPreset whenever
 * nothing is playing (store.ts), which holds for every scenario here (no
 * track is ever loaded), so this never actually waits on beat-quantize. */
async function clickPresetChip(cdp, presetId) {
  return cdp.eval(
    `(() => {
      const b = document.querySelector('button.chip[data-preset-id="${presetId}"]');
      if (!b) return { clicked: false, presetId: null };
      b.click();
      return { clicked: true, presetId: window.__store.getState().presetId };
    })()`,
    false,
  );
}

/** taskkill WITHOUT /F, and deliberately WITHOUT /T — posts WM_CLOSE to the
 * MAIN process's own top-level window so Tauri's onCloseRequested actually
 * gets to run. /T was tried first and found live to break this entirely:
 * WebView2's windowless helper subprocesses (GPU/renderer/network/crashpad —
 * `msedgewebview2.exe` children with no top-level window) can only be force-
 * closed, and taskkill's non-forceful /T refuses to signal ANY ancestor
 * while a descendant can't be closed — so with /T, the real app window never
 * receives WM_CLOSE at all (confirmed: taskkill reports errors for the
 * windowless children and never even attempts the parent). Targeting just
 * the main PID sidesteps that tree-walk entirely; the main process owns the
 * real window (confirmed via Get-Process's MainWindowHandle), so this alone
 * is both necessary and sufficient to trigger onCloseRequested. */
function gracefulClose(app) {
  const pid = app?.child?.pid;
  if (!pid) return;
  try {
    execFileSync("taskkill", ["/PID", String(pid)], { stdio: "ignore" });
  } catch {
    // taskkill exits non-zero when it can't find/signal the process at all —
    // the real verdict is whether the process actually exits afterward.
  }
}

function waitForExit(app, timeoutMs) {
  if (app.child.exitCode != null || app.child.signalCode != null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimer(() => resolve(false), timeoutMs);
    app.child.once("exit", () => {
      clearTimer(timer);
      resolve(true);
    });
  });
}

/** Close gracefully (WM_CLOSE) and wait for the process to really exit,
 * falling back to a forced kill only as an orphan safety net if it hangs.
 * Returns how long the exit took — S6 reports it as the close-flush proof;
 * other callers just check `exited`. */
async function closeAndWait(app, timeoutMs = 10_000) {
  const t0 = Date.now();
  gracefulClose(app);
  const exited = await waitForExit(app, timeoutMs);
  const gapMs = Date.now() - t0;
  if (!exited) killTree(app); // orphan safety net so a stuck app doesn't block later scenarios
  return { exited, gapMs };
}

async function teardown(app, cdp) {
  try {
    cdp?.close();
  } catch {
    /* already dead */
  }
  if (app) killTree(app); // safe even if the process already exited gracefully
}

/** Give WebView2's commit-batched localStorage backend time to flush to its
 * on-disk LevelDB store, then hard-kill. NOT a graceful close: live (see
 * scenarioS6's own finding) `appWindow.destroy()` is rejected by the
 * capabilities ACL (`core:window:allow-destroy` isn't granted in
 * src-tauri/capabilities/default.json), so `onCloseRequested` can never
 * actually finish closing the window — a graceful-close teardown here would
 * just hang for the same reason S6 fails, for a step that isn't even testing
 * that path. A plain wait sidesteps the broken mechanism entirely: Chromium
 * commits DOM storage on a short internal timer regardless of how the
 * process eventually ends, so time alone is enough (confirmed live: an
 * immediate killTree right after setItem lost the write; this does not). */
async function flushLocalStorageThenKill(app, waitMs = 9000) {
  await sleep(waitMs);
  killTree(app);
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenarioS1() {
  const id = "S1";
  resetSmokeAppDataDirCompletely(); // "no AppData dir"
  let app;
  let cdp;
  const consoleLines = [];
  try {
    const tBoot = Date.now();
    app = launch("p11-smoke-S1");
    const page = await waitForPage(app, {
      timeoutMs: 60_000,
      intervalMs: 400,
      match: beatformTitleMatch,
    });
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    captureConsole(cdp, consoleLines);
    await waitDocumentComplete(cdp);
    const shell = await cdp.eval(SHELL_CHECK, false);
    assertShell(shell);

    const filePath = documentPath();
    const appeared = await waitForFile(filePath, 8000, 100);
    const elapsedMs = Date.now() - tBoot;
    if (!appeared)
      throw new Error(
        `document.bfproj did not appear within 8000ms of boot (elapsed ${elapsedMs}ms)`,
      );
    const parsed = readDocumentJson();
    if (parsed.kind !== "bfproj") throw new Error(`unexpected kind: ${parsed.kind}`);
    if (typeof parsed.schemaVersion !== "number" || parsed.schemaVersion < 1) {
      throw new Error(`bad schemaVersion: ${parsed.schemaVersion}`);
    }
    if (typeof parsed.document?.presetId !== "string")
      throw new Error("document.presetId missing/not a string");

    return {
      id,
      ok: true,
      detail:
        `Virgin boot: shell reached full load (title/canvas/${shell.bodyLen}ch body, webgpu=${shell.webgpu}); ` +
        `document.bfproj appeared ${elapsedMs}ms after spawn and parsed as a valid project ` +
        `(schemaVersion=${parsed.schemaVersion}, presetId=${parsed.document.presetId}).`,
      consoleLines,
    };
  } catch (e) {
    return { id, ok: false, detail: String(e.stack ?? e), consoleLines };
  } finally {
    await teardown(app, cdp);
  }
}

async function scenarioS2() {
  const id = "S2";
  resetSmokeDocument();
  const profile = "p11-smoke-S2";
  let app;
  let cdp;
  const consoleLines = [];
  try {
    // Launch 1: bootstrap a real profile + a real (default) document.bfproj.
    app = launch(profile);
    let page = await waitForPage(app, { match: beatformTitleMatch });
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    await waitDocumentComplete(cdp);
    await waitStoreHook(cdp);
    // Seed localStorage directly — this is what a pre-P-11 install's cache
    // looks like. Raw string, not JSON: loadStoredPresetId() reads it with a
    // plain localStorage.getItem (persistence.ts).
    await cdp.eval(
      `localStorage.setItem("viz.activePreset", "${ALT_PRESET_A}"); localStorage.setItem("viz.cleanExit", "1"); true`,
      false,
    );
    cdp.close();
    cdp = null;
    await flushLocalStorageThenKill(app); // see the helper's own comment
    app = null;

    resetSmokeDocument(); // "delete document.bfproj" — the migration precondition

    // Launch 2 (SAME profile -> localStorage persists): the measured boot.
    app = launch(profile);
    page = await waitForPage(app, { match: beatformTitleMatch });
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    captureConsole(cdp, consoleLines);
    await waitDocumentComplete(cdp);
    await waitStoreHook(cdp);

    const presetId = await cdp.eval(`window.__store.getState().presetId`, false);
    if (presetId !== ALT_PRESET_A)
      throw new Error(`UI shows presetId=${presetId}, expected ${ALT_PRESET_A}`);

    const filePath = documentPath();
    const appeared = await waitForFile(filePath, 8000, 100);
    if (!appeared) throw new Error("document.bfproj did not reappear after the migration boot");
    const parsed = readDocumentJson();
    if (parsed.document?.presetId !== ALT_PRESET_A) {
      throw new Error(
        `new document.bfproj has presetId=${parsed.document?.presetId}, expected ${ALT_PRESET_A}`,
      );
    }

    return {
      id,
      ok: true,
      detail:
        `Migration boot: with document.bfproj absent, UI booted from localStorage's ${ALT_PRESET_A} ` +
        `and the freshly-written document.bfproj carries it too (schemaVersion=${parsed.schemaVersion}).`,
      consoleLines,
    };
  } catch (e) {
    return { id, ok: false, detail: String(e.stack ?? e), consoleLines };
  } finally {
    await teardown(app, cdp);
  }
}

async function scenarioS3() {
  const id = "S3";
  resetSmokeDocument();
  const profile = "p11-smoke-S3";
  let app;
  let cdp;
  const consoleLines = [];
  try {
    // Launch 1: bootstrap a real document.bfproj to mutate into the fixture,
    // and seed localStorage with a DIFFERENT preset than the fixture will
    // carry (the two-source disagreement the scenario needs).
    app = launch(profile);
    let page = await waitForPage(app, { match: beatformTitleMatch });
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    await waitDocumentComplete(cdp);
    await waitStoreHook(cdp);
    await cdp.eval(
      `localStorage.setItem("viz.activePreset", "${ALT_PRESET_A}"); localStorage.setItem("viz.cleanExit", "1"); true`,
      false,
    );
    cdp.close();
    cdp = null;
    await flushLocalStorageThenKill(app); // see the helper's own comment (scenarioS2 found this live)
    app = null;

    const filePath = documentPath();
    const fixture = JSON.parse(fs.readFileSync(filePath, "utf8"));
    fixture.document.presetId = ALT_PRESET_B;
    fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2), "utf8");

    // Launch 2 (SAME profile): the measured boot. Every preliminary CDP round
    // trip before polling starts (page discovery, Runtime.enable, a separate
    // localStorage read) inflates the measurement floor beyond what the page
    // itself needs to resolve window.__store — found live: a first draft
    // with a plain waitForPage() + a SEPARATE localStorage-check eval before
    // the flash poll consistently measured 0ms even on a run independently
    // proven (via that separate check) to have a real localStorage/file
    // disagreement to race. Tightened here: a fast page-discovery poll, and
    // the localStorage read folded into the SAME injected script as the
    // flash poll so it costs zero extra round trips.
    app = launch(profile);
    page = await waitForPage(app, { timeoutMs: 60_000, intervalMs: 50, match: beatformTitleMatch });
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    captureConsole(cdp, consoleLines);

    const flash = await cdp.eval(
      `(() => new Promise((resolve) => {
        // Raw localStorage read: synchronous, unaffected by React/store
        // timing — the only way to positively confirm the seed survived
        // launch 1's close+kill even when the autosave apply wins the race
        // before the first store observation below (that race alone cannot
        // distinguish "seed worked but flashed by too fast to catch" from
        // "seed silently failed").
        const seeded = localStorage.getItem("viz.activePreset");
        if (seeded !== "${ALT_PRESET_A}") {
          resolve({ seedError: seeded });
          return;
        }
        const hooksDeadline = Date.now() + 15000;
        function waitHook() {
          if (window.__store) return afterHook();
          if (Date.now() > hooksDeadline) return resolve({ error: "window.__store never appeared" });
          setTimeout(waitHook, 2);
        }
        function afterHook() {
          const t0 = performance.now();
          const initial = window.__store.getState().presetId;
          if (initial === "${ALT_PRESET_B}") {
            resolve({ initial, final: initial, elapsedMs: 0, changed: false });
            return;
          }
          const deadline = performance.now() + 5000;
          function poll() {
            const cur = window.__store.getState().presetId;
            if (cur === "${ALT_PRESET_B}") {
              resolve({ initial, final: cur, elapsedMs: performance.now() - t0, changed: true });
              return;
            }
            if (performance.now() > deadline) {
              resolve({ initial, final: cur, elapsedMs: performance.now() - t0, changed: false, timedOut: true });
              return;
            }
            requestAnimationFrame(poll);
          }
          requestAnimationFrame(poll);
        }
        waitHook();
      }))()`,
    );
    if (flash.seedError !== undefined) {
      throw new Error(
        `localStorage seed did not survive launch 1's close (viz.activePreset="${flash.seedError}", ` +
          `expected "${ALT_PRESET_A}") — independent of any store/flash timing`,
      );
    }
    if (flash.error) throw new Error(flash.error);
    if (flash.timedOut) throw new Error(`file preset never won the race — stuck on ${flash.final}`);
    if (flash.final !== ALT_PRESET_B) throw new Error(`unexpected final preset ${flash.final}`);

    await waitDocumentComplete(cdp);
    const parsedAfter = readDocumentJson();
    if (parsedAfter.document?.presetId !== ALT_PRESET_B) {
      throw new Error(
        `file presetId drifted to ${parsedAfter.document?.presetId} after boot settled`,
      );
    }

    const flashMs = Math.round(flash.elapsedMs);
    return {
      id,
      ok: true,
      detail:
        `Autosave-preferred boot: localStorage's ${ALT_PRESET_A} seed independently confirmed present at ` +
        `boot (raw localStorage read, not a store observation); file's ${ALT_PRESET_B} won the boot race. ` +
        `Stale-flash window: ${flashMs}ms` +
        (flash.changed
          ? ` (initial paint showed ${flash.initial}, autosave apply landed ${flashMs}ms later — I2, ` +
            `recorded but deliberately left un-veiled per the coordinator's ruling in the lane log)`
          : ` (no visible flash at the earliest moment CDP could observe window.__store — the autosave ` +
            `apply already won by then; this bounds the flash from above, it does not prove zero)`),
      flashMs,
      consoleLines,
    };
  } catch (e) {
    return { id, ok: false, detail: String(e.stack ?? e), consoleLines };
  } finally {
    await teardown(app, cdp);
  }
}

async function scenarioS4() {
  const id = "S4";
  resetSmokeDocument();
  const profile = "p11-smoke-S4";
  const consoleLines = [];
  let app;
  let cdp;
  try {
    // Launch A: normal boot, then edit.
    app = launch(profile);
    let page = await waitForPage(app, { match: beatformTitleMatch });
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    captureConsole(cdp, consoleLines);
    await waitDocumentComplete(cdp);
    await waitStoreHook(cdp);
    const shellA = await cdp.eval(SHELL_CHECK, false);
    assertShell(shellA);

    const click = await clickPresetChip(cdp, ALT_PRESET_A);
    if (!click.clicked) throw new Error(`${ALT_PRESET_A} chip not found in DOM`);
    if (click.presetId !== ALT_PRESET_A)
      throw new Error(`click did not switch preset (got ${click.presetId})`);

    // Wait past the 5s default autosaveIntervalSec + max-latency cap
    // (prefs.ts) — poll rather than one flat sleep so ordinary timer jitter
    // doesn't read as a failure.
    const parsed = await waitForDocumentPreset(ALT_PRESET_A, 10_000);
    if (parsed?.document?.presetId !== ALT_PRESET_A) {
      throw new Error(
        `autosave had not persisted the edit before the kill (file has ${parsed?.document?.presetId})`,
      );
    }
    const cleanMarkerPreKill = await cdp.eval(`localStorage.getItem("viz.cleanExit")`, false);

    // The crash: hard kill, no pagehide — the marker set by the edit above
    // (markSessionDirty, inside scheduleAutosave) survives to next boot.
    cdp.close();
    cdp = null;
    killTree(app);
    app = null;
    await sleep(300);

    // Launch B: recovery boot, SAME profile.
    app = launch(profile);
    page = await waitForPage(app, { match: beatformTitleMatch });
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    captureConsole(cdp, consoleLines);
    await waitDocumentComplete(cdp);
    await waitStoreHook(cdp);

    // pollForStorePreset, not one immediate read: bootDesktopDocument's
    // apply is async and races window.__store's appearance — see that
    // helper's own comment (found live via S6, same underlying race, this
    // site never confirmed exempt just because it hasn't shown it yet).
    const presetAfterRecovery = await pollForStorePreset(cdp, ALT_PRESET_A, 3000);
    if (presetAfterRecovery !== ALT_PRESET_A) {
      throw new Error(`edited state lost — presetId=${presetAfterRecovery} after recovery boot`);
    }
    const noticeSeen = await pollForBodyText(
      cdp,
      "Recovered your work from the last session",
      3500,
      100,
    );
    if (!noticeSeen)
      throw new Error("recovery notice text not found in the DOM within 3500ms of boot");

    const falseToast = consoleLines.find((l) => l.includes("Autosave is failing"));
    if (falseToast)
      throw new Error(`false "Autosave is failing" console line observed: ${falseToast}`);
    const storeError = await cdp.eval(`window.__store.getState().error`, false);
    if (storeError && String(storeError).includes("Autosave is failing")) {
      throw new Error(`store.error shows a false failing toast: ${storeError}`);
    }

    return {
      id,
      ok: true,
      detail:
        `Crash recovery: edit (${ALT_PRESET_A}) persisted before the unclean kill (cleanExit marker pre-kill=` +
        `"${cleanMarkerPreKill}"); recovered on relaunch with the "Recovered your work from the last session" ` +
        `notice shown; no false write-serialization failing-toast in console or store.error.`,
      consoleLines,
    };
  } catch (e) {
    return { id, ok: false, detail: String(e.stack ?? e), consoleLines };
  } finally {
    await teardown(app, cdp);
  }
}

async function scenarioS5() {
  const id = "S5";
  resetSmokeDocument();
  fs.mkdirSync(smokeAppDataDir(), { recursive: true });
  fs.writeFileSync(documentPath(), "{ not json", "utf8");
  const profile = "p11-smoke-S5";
  const consoleLines = [];
  let app;
  let cdp;
  try {
    app = launch(profile);
    const page = await waitForPage(app, { match: beatformTitleMatch });
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    captureConsole(cdp, consoleLines);
    await waitDocumentComplete(cdp);
    const shell = await cdp.eval(SHELL_CHECK, false);
    assertShell(shell); // full shell, no white screen
    await waitStoreHook(cdp);

    const siblings = listCorruptSiblings();
    if (siblings.length === 0) throw new Error("no document.bfproj.corrupt-* sibling was created");

    const errorText = await pollForErrorToast(cdp, 5000, 150);
    if (!errorText) throw new Error("no error toast appeared within 5000ms");
    if (!errorText.includes("couldn't be read and was moved aside")) {
      throw new Error(`error toast had unexpected text: ${JSON.stringify(errorText)}`);
    }

    // Sanity: the fallback write-back left a fresh, valid file behind.
    const parsed = readDocumentJson();
    if (parsed.kind !== "bfproj")
      throw new Error(`fallback file has unexpected kind: ${parsed.kind}`);

    return {
      id,
      ok: true,
      detail:
        `Corrupt file: full shell loaded (no white screen); quarantined to ` +
        `${path.basename(siblings[0])}; error toast present ("${errorText}"); a fresh valid ` +
        `document.bfproj was written behind it.`,
      consoleLines,
    };
  } catch (e) {
    return { id, ok: false, detail: String(e.stack ?? e), consoleLines };
  } finally {
    await teardown(app, cdp);
  }
}

async function scenarioS6() {
  const id = "S6";
  resetSmokeDocument();
  const profile = "p11-smoke-S6";
  const consoleLines = [];
  let app;
  let cdp;
  try {
    app = launch(profile);
    let page = await waitForPage(app, { match: beatformTitleMatch });
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    captureConsole(cdp, consoleLines);
    await waitDocumentComplete(cdp);
    await waitStoreHook(cdp);

    const click = await clickPresetChip(cdp, ALT_PRESET_A);
    if (!click.clicked) throw new Error(`${ALT_PRESET_A} chip not found in DOM`);
    if (click.presetId !== ALT_PRESET_A)
      throw new Error(`click did not switch preset (got ${click.presetId})`);

    const tEdit = Date.now();
    // Close IMMEDIATELY — well under the 5s autosave debounce — so a
    // persisted edit can only be explained by the close-flush, not the timer.
    // taskkill WITHOUT /F -> WM_CLOSE -> onCloseRequested.
    const closed = await closeAndWait(app, 10_000);
    const closeGapMs = Date.now() - tEdit;
    if (!closed.exited) {
      const aclHit = consoleLines.find((l) => l.includes("not allowed by ACL"));
      throw new Error(
        `process did not exit within 10000ms of a graceful WM_CLOSE (${closeGapMs}ms after the edit). ` +
          (aclHit
            ? `ROOT CAUSE (confirmed, reproducible): ${aclHit} — onCloseRequested DOES fire and DOES reach ` +
              `its finally block, but appWindow.destroy() is rejected by the capabilities ACL. ` +
              `src-tauri/capabilities/default.json's "permissions" list has no window:allow-destroy (or ` +
              `equivalent core:window:allow-destroy) entry — event.preventDefault() already suppressed the ` +
              `native default close, so with destroy() failing, the window can NEVER close via this path: ` +
              `not this harness, not a real user's title-bar X, not Alt+F4. Every clean-exit close is ` +
              `affected, not just this scenario. See the console dump below for the exact runtime message.`
            : `onCloseRequested may not have fired, or destroy() failed silently with nothing in console — ` +
              `see the console dump below for whatever WAS captured.`),
      );
    }
    cdp = null; // the socket died with the process; nothing left to close

    const parsed = readDocumentJson();
    if (parsed.document?.presetId !== ALT_PRESET_A) {
      throw new Error(
        `close-flush did not persist the edit (file has ${parsed.document?.presetId}) — ` +
          `closed ${closeGapMs}ms after the click, well under the 5000ms autosave interval`,
      );
    }
    app = null; // already exited; nothing to kill in the finally

    // Relaunch (same profile) to confirm the edit really is durable, not
    // just written-but-unread.
    app = launch(profile);
    page = await waitForPage(app, { match: beatformTitleMatch });
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    captureConsole(cdp, consoleLines);
    await waitDocumentComplete(cdp);
    await waitStoreHook(cdp);
    // pollForStorePreset, not one immediate read — see its own comment.
    // Found live HERE first: a standalone diagnostic repro (edit -> close ->
    // relaunch, printing docEpoch alongside presetId every 250ms) proved the
    // synchronous default reads back for a short but real window before
    // bootDesktopDocument's async apply lands, at roughly a 33-67% rate
    // across a handful of runs — the on-disk document.bfproj was correct in
    // every single one, immediately post-close AND post-relaunch. A harness
    // read-timing bug, not the production bug this scenario exists to catch.
    const presetAfterRelaunch = await pollForStorePreset(cdp, ALT_PRESET_A, 3000);
    if (presetAfterRelaunch !== ALT_PRESET_A) {
      throw new Error(`edit not present after relaunch (got ${presetAfterRelaunch}) within 3000ms`);
    }

    const falseToast = consoleLines.find((l) => l.includes("Autosave is failing"));
    if (falseToast)
      throw new Error(`false "Autosave is failing" console line observed: ${falseToast}`);

    return {
      id,
      ok: true,
      detail:
        `Clean-exit tail (C1): close-flush persisted the edit (${ALT_PRESET_A}) ${closeGapMs}ms after the ` +
        `click — well under the 5000ms autosave interval, so only the close path can explain it. ` +
        `Confirmed present after relaunch. No false write-serialization failing-toast.`,
      closeGapMs,
      consoleLines,
    };
  } catch (e) {
    return { id, ok: false, detail: String(e.stack ?? e), consoleLines };
  } finally {
    await teardown(app, cdp);
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const SCENARIOS = [
  ["S1", scenarioS1],
  ["S2", scenarioS2],
  ["S3", scenarioS3],
  ["S4", scenarioS4],
  ["S5", scenarioS5],
  ["S6", scenarioS6],
];

function writeReport(results) {
  const outPath = path.join(root, ".superpowers", "p11-device-smoke.md");
  const allOk = results.length > 0 && results.every((r) => r.ok);
  const lines = [];
  lines.push(`# P-11 device smoke — autosave boot`);
  lines.push("");
  lines.push(`Run: ${new Date().toISOString()}`);
  lines.push(`Branch: p11-autosave-boot | Worktree: ${root}`);
  lines.push(`Identifier overlay: ${IDENTIFIER}`);
  lines.push(`Exe: ${EXE_PATH}`);
  lines.push("");
  lines.push(`## Overall: ${allOk ? "SMOKE_GREEN" : "SMOKE_FAILED"}`);
  lines.push("");
  for (const r of results) {
    lines.push(`### ${r.id} — ${r.ok ? "PASS" : "FAIL"}`);
    lines.push("");
    lines.push(r.detail);
    if (r.consoleLines?.length) {
      lines.push("");
      lines.push("<details><summary>console</summary>");
      lines.push("");
      lines.push("```");
      for (const l of r.consoleLines) lines.push(l);
      lines.push("```");
      lines.push("</details>");
    }
    lines.push("");
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  return outPath;
}

async function main() {
  if (!fs.existsSync(EXE_PATH)) {
    console.error(
      `FATAL: exe not found at ${EXE_PATH} — build it first (see scripts/p11-smoke.conf.json).`,
    );
    process.exit(2);
  }
  console.log(`P-11 device smoke — exe: ${EXE_PATH}`);
  console.log(`Smoke AppData root: ${smokeAppDataDir()}`);

  resetSmokeAppDataDirCompletely(); // "delete it before the run" (task setup step 4)

  const results = [];
  for (const [id, fn] of SCENARIOS) {
    if (ONLY && !ONLY.has(id)) continue;
    console.log(`\n--- ${id} ---`);
    const r = await fn();
    console.log(`${id}: ${r.ok ? "PASS" : "FAIL"} — ${r.detail.split("\n")[0]}`);
    results.push(r);
  }

  const reportPath = writeReport(results);
  console.log(`\nReport written to ${reportPath}`);

  resetSmokeAppDataDirCompletely(); // "...and after"

  const allOk = results.length > 0 && results.every((r) => r.ok);
  console.log(allOk ? "SMOKE_GREEN" : "SMOKE_FAILED");
  process.exit(allOk ? 0 : 1);
}

await main();
