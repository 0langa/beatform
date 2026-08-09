// Device check for the perf overlay's process-family aggregation: launches
// the debug shell, turns the overlay on, and asserts the RAM/CPU rows carry
// the family total with the "(main …)" split — family resident memory must
// dwarf the exe alone (the WebView2 renderer/GPU processes are where the app
// actually lives).
//   node scripts/perf-family-check.mjs
// Prereq: Vite dev on 127.0.0.1:1420.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnApp, attachWithRecovery, waitHooks, killTree } from "./lib/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let app;
try {
  app = spawnApp({
    root,
    portBase: 9140, // see the map in lib/app.mjs
    profileName: "wv2-perf-family-profile",
  });
  // Vite pushes one reload shortly after a cold boot (dep re-optimize / ws
  // reconnect), which destroys the eval context mid-wait — attach, and on
  // that specific failure re-attach once (the v2.68 lesson). The hook wait is
  // the probe because it is the first thing that can hit the dead context;
  // a bare attach() died here before reaching a single assertion (G8).
  const cdp = await attachWithRecovery(app, (c) =>
    waitHooks(c, ["__prefs"], { timeoutMs: 30_000 }),
  );

  const out = await cdp.eval(`(async () => {
    window.__prefs.set({ perfOverlay: true });
    // Two Rust polls minimum (family CPU needs a delta; scan is on poll 1).
    await new Promise(r => setTimeout(r, 3200));
    // Not '[role="status"]': the notice toast carries that role too, so the
    // lookup used to depend on PerfOverlay coming first in App's JSX.
    const el = document.querySelector('[data-testid="perf-overlay"]');
    window.__prefs.set({ perfOverlay: false });
    return el ? el.textContent : null;
  })()`);

  console.log("OVERLAY:", out);
  if (!out) throw new Error("overlay did not mount");
  const ram = /RAM(\d+) MB \(main (\d+) MB\)/.exec(out);
  if (!ram) throw new Error(`RAM row missing family split: ${out}`);
  const family = Number(ram[1]);
  const main = Number(ram[2]);
  if (!(family > main + 50)) {
    throw new Error(`family (${family} MB) should dwarf main (${main} MB) — filter broken?`);
  }
  if (!/CPU\d+% \(main \d+%\) · sys \d+%/.test(out)) {
    throw new Error(`CPU row missing family split: ${out}`);
  }
  console.log(`PERF-FAMILY OK: family=${family}MB main=${main}MB`);
} finally {
  killTree(app);
}
