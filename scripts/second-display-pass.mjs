// TESTING.md A2 — second-display pass, the automatable half.
//
// Drives the debug shell: loads a demo, opens the performance window on the
// NON-primary monitor from the Perform drawer's own store actions, then
// watches both windows for `--minutes` (default 4): the output's own runtime
// counters (window.__performStats in the perform page — framesRendered,
// lagMs, degraded), the primary's frame counter, and the OS-level window
// rectangle (user32 via PowerShell) against the monitor list Windows
// reports. Half-way through it sets the preview frame cap to 30 and checks
// the output keeps its rate (the 2.110.0 cap lift, effectiveFpsCap). Rates
// are judged against a 20 s primary-alone baseline, not an absolute 60: a
// debug shell on a DPI-scaled display sits in the 40s on this machine.
// Finally it closes the window through the store and expects the primary to
// keep running.
//
// What it cannot do is the physical part of A2 — pulling the HDMI cable —
// and the owner's eyes on smoothness; both stay owner-side or waived.
//
//   node scripts/second-display-pass.mjs [--minutes=4]
// Prereq: a built debug shell (cargo build in src-tauri) and Vite dev on
// 127.0.0.1:1420 (plain `npm run dev`), like every built-shell harness.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { Cdp } from "./lib/cdp.mjs";
import { spawnApp, attachWithRecovery, waitHooks, killTree } from "./lib/app.mjs";
import { loadDemoAndPlay } from "./lib/demo.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, dflt) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? "").slice(name.length + 3) || dflt;
const minutes = Number(arg("minutes", "4"));

const results = [];
let failed = 0;
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : " — " + JSON.stringify(detail)}`,
  );
}

/** Top-level windows of beatform.exe with their screen rects, via user32. */
function appWindows() {
  const dir = mkdtempSync(path.join(tmpdir(), "bf-a2-"));
  const ps = path.join(dir, "windows.ps1");
  writeFileSync(
    ps,
    `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class W {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
}
"@
$pids = @(Get-Process -Name beatform -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$out = @()
[W]::EnumWindows({ param($h, $l)
  if (-not [W]::IsWindowVisible($h)) { return $true }
  $pid2 = 0; [void][W]::GetWindowThreadProcessId($h, [ref]$pid2)
  if ($pids -notcontains [int]$pid2) { return $true }
  $len = [W]::GetWindowTextLength($h); if ($len -le 0) { return $true }
  $sb = New-Object System.Text.StringBuilder ($len + 1); [void][W]::GetWindowText($h, $sb, $sb.Capacity)
  $r = New-Object W+RECT; [void][W]::GetWindowRect($h, [ref]$r)
  $script:out += [pscustomobject]@{ title = $sb.ToString(); x = $r.Left; y = $r.Top; w = $r.Right - $r.Left; h = $r.Bottom - $r.Top }
  return $true
}, [IntPtr]::Zero) | Out-Null
$out | ConvertTo-Json -Compress
`,
  );
  const text = execFileSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps],
    {
      encoding: "utf8",
    },
  ).trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

let app;
let main;
let out;
try {
  app = spawnApp({ root, portBase: 10620, profileName: "wv2-a2-profile" }); // see lib/app.mjs map
  main = await attachWithRecovery(app, async (c) => {
    await waitHooks(c, ["__store", "__engine", "__vizFrames"]);
    await loadDemoAndPlay(c, "groove");
  });
  await main.eval(
    `(() => { const s = window.__store.getState(); if (!s.loop) s.toggleLoop(); return s.loop; })()`,
    false,
  );
  await sleep(1500);

  // Baseline: the primary alone, 20 s, so the mirror is judged against what
  // THIS machine's loop does without an output window (a debug shell on a
  // scaled 1440p display does not reach 60 — the question A2 asks is
  // whether the output keeps the primary's cadence and the 30 cap stays off
  // the audience, not what the absolute number is). Taken after a settle:
  // the first seconds after boot also render the strip thumbnails.
  await sleep(15_000);
  const base0 = await main.eval(`window.__vizFrames`, false);
  await sleep(20_000);
  const base1 = await main.eval(`window.__vizFrames`, false);
  const baselineFps = (base1 - base0) / 20;
  console.log(`  baseline primary alone: ${baselineFps.toFixed(1)} fps`);

  // Remember the primary's target id so the output probe below can skip it.
  {
    const pages = await fetch(`http://127.0.0.1:${app.port}/json/list`).then((r) => r.json());
    const primary = pages.find(
      (p) => p.type === "page" && p.webSocketDebuggerUrl && /localhost|127\.0\.0\.1/.test(p.url),
    );
    main.targetId = primary?.id;
  }

  // Monitors as the app enumerates them (Rust side), and as Windows reports.
  const monitors = await main.eval(
    `(async () => { const s = window.__store.getState(); s.setShowPerform(true);
       await s.refreshPerformMonitors(); return window.__store.getState().performMonitors; })()`,
  );
  check("app enumerates two or more monitors", monitors.length >= 2, monitors);
  const secondary = monitors.find((m) => !m.primary);
  check("a non-primary monitor exists", !!secondary, secondary);
  if (!secondary) throw new Error("no secondary monitor — cannot run A2");

  // Open on the secondary, through the same actions the drawer uses.
  const opened = await main.eval(
    `(async () => { const s = window.__store.getState();
       await s.setPerformMonitor(${secondary.index});
       await s.openPerformWindow();
       const deadline = Date.now() + 15000;
       while (!window.__store.getState().performOpen) {
         if (Date.now() > deadline) return false;
         await new Promise(r => setTimeout(r, 100));
       }
       return true; })()`,
  );
  check("performOpen flips true after openPerformWindow", opened === true);

  // Attach to the output window's own page. It loads the SAME index.html as
  // the primary (the Tauri label "perform" is what branches main.tsx), so the
  // target is found by probing each localhost page for the output runtime's
  // own hook rather than by URL.
  const mainTargetId = main.targetId;
  const deadline = Date.now() + 30_000;
  while (!out && Date.now() < deadline) {
    const pages = await fetch(`http://127.0.0.1:${app.port}/json/list`).then((r) => r.json());
    for (const p of pages) {
      if (p.type !== "page" || !p.webSocketDebuggerUrl || p.id === mainTargetId) continue;
      if (!/localhost|127\.0\.0\.1/.test(p.url)) continue;
      const probe = new Cdp(p.webSocketDebuggerUrl);
      try {
        await probe.open();
        const isOut = await probe.eval(`typeof window.__performStats === "function"`, false);
        if (isOut) {
          out = probe;
          break;
        }
      } catch {
        /* not ready */
      }
      probe.close();
    }
    if (!out) await sleep(500);
  }
  check("the output window's page is reachable over CDP", !!out);
  if (!out) throw new Error("output page not found");
  await waitHooks(out, ["__performStats"]);
  await sleep(3000);

  // Placement: the output's OS window rect must lie on the secondary.
  const wins = appWindows();
  const onSecondary = wins.filter(
    (w) =>
      w.x >= secondary.x - 8 &&
      w.x < secondary.x + secondary.width * secondary.scale &&
      w.w > 200 &&
      w.h > 150,
  );
  check("an app window sits on the secondary monitor", onSecondary.length >= 1, {
    windows: wins,
    secondary,
  });

  // Watch the show. Sample both windows every 10 s.
  const stats0 = await out.eval(`window.__performStats()`, false);
  const viz0 = await main.eval(`window.__vizFrames`, false);
  const t0 = Date.now();
  const samples = [];
  let capSetAt = null;
  const totalMs = minutes * 60_000;
  while (Date.now() - t0 < totalMs) {
    await sleep(10_000);
    const st = await out.eval(`window.__performStats()`, false);
    const viz = await main.eval(`window.__vizFrames`, false);
    const alive = await main.eval(
      `(() => { const s = window.__store.getState(); return { performOpen: s.performOpen, playing: window.__engine.playing, t: window.__engine.currentTime, error: s.error }; })()`,
      false,
    );
    samples.push({ at: Date.now() - t0, ...st, viz, alive });
    console.log(
      `  t=${Math.round((Date.now() - t0) / 1000)}s rendered=${st.framesRendered} received=${st.framesReceived} lag=${st.lagMs.toFixed(1)}ms degraded=${st.degraded} viz=${viz} playing=${alive.playing} open=${alive.performOpen}`,
    );
    if (!capSetAt && Date.now() - t0 >= totalMs / 2) {
      // Half-way: the operator's 30 fps cap must not reach the audience.
      await main.eval(`window.__prefs.set({ fpsCap: 30 })`, false);
      capSetAt = Date.now() - t0;
      console.log("  preview frame cap set to 30 — the output must keep its rate");
    }
  }
  const statsEnd = await out.eval(`window.__performStats()`, false);
  const vizEnd = await main.eval(`window.__vizFrames`, false);
  await main.eval(`window.__prefs.set({ fpsCap: 0 })`, false);

  const seconds = (Date.now() - t0) / 1000;
  const outFps = (statsEnd.framesRendered - stats0.framesRendered) / seconds;
  const mainFps = (vizEnd - viz0) / seconds;
  check(
    "output keeps the primary's cadence over the whole run (within 10 %, and at least 24 fps)",
    outFps >= 24 && outFps >= mainFps * 0.9,
    {
      outFps: +outFps.toFixed(1),
      mainFps: +mainFps.toFixed(1),
      baselineFps: +baselineFps.toFixed(1),
      seconds: Math.round(seconds),
    },
  );
  check(
    "a live mirror costs the primary less than a quarter of its own rate",
    mainFps >= baselineFps * 0.75,
    { mainFps: +mainFps.toFixed(1), baselineFps: +baselineFps.toFixed(1) },
  );
  // Backlog = frames received but not yet rendered. A few frames in flight
  // is the pipeline; what must never happen is GROWTH over the run.
  const backlogs = samples.map((s) => s.framesReceived - s.framesRendered);
  check(
    "no backlog builds over the run: received minus rendered does not grow",
    backlogs[backlogs.length - 1] - backlogs[0] <= 8 && Math.max(...backlogs) <= 30,
    { first: backlogs[0], last: backlogs[backlogs.length - 1], max: Math.max(...backlogs) },
  );
  check(
    "output never degraded (delivery lag stayed under the backpressure knee)",
    samples.every((s) => !s.degraded) && !statsEnd.degraded,
    { maxLagMs: +Math.max(...samples.map((s) => s.lagMs)).toFixed(1) },
  );
  check(
    "primary kept playing and the output stayed open",
    samples.every((s) => s.alive.playing && s.alive.performOpen && !s.alive.error),
  );

  // The cap-lift half: output fps after the cap vs before.
  const before = samples.filter((s) => s.at < capSetAt);
  const after = samples.filter((s) => s.at > capSetAt + 10_000);
  if (before.length >= 2 && after.length >= 2) {
    const rate = (arr) =>
      (arr[arr.length - 1].framesRendered - arr[0].framesRendered) /
      ((arr[arr.length - 1].at - arr[0].at) / 1000);
    const rb = rate(before);
    const ra = rate(after);
    check(
      "with the preview capped at 30, the output keeps its rate (the cap never reaches the audience)",
      ra >= rb * 0.9 && ra > 31,
      { beforeCapFps: +rb.toFixed(1), afterCapFps: +ra.toFixed(1) },
    );
  } else {
    check("cap-lift sample window", false, { before: before.length, after: after.length });
  }

  // Close through the store; the primary must survive it.
  const closed = await main.eval(
    `(async () => { const s = window.__store.getState(); await s.closePerformWindow();
       const deadline = Date.now() + 10000;
       while (window.__store.getState().performOpen) {
         if (Date.now() > deadline) return false;
         await new Promise(r => setTimeout(r, 100));
       }
       await new Promise(r => setTimeout(r, 1500));
       return { closed: true, playing: window.__engine.playing, frames: window.__vizFrames }; })()`,
  );
  check(
    "output closes through the store and the primary keeps running",
    !!closed && closed.playing,
    closed,
  );

  console.log(
    `\nSECOND-DISPLAY PASS ${failed ? "FAILED" : "OK"}: ${results.length - failed}/${results.length} checks`,
  );
  if (failed) process.exitCode = 1;
} finally {
  try {
    out?.close();
  } catch {
    /* ignore */
  }
  try {
    main?.close();
  } catch {
    /* ignore */
  }
  killTree(app);
}
