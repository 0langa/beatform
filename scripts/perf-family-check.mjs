// Device check for the perf overlay's process-family aggregation: launches
// the debug shell, turns the overlay on, and asserts the RAM/CPU rows carry
// the family total with the "(main …)" split — family resident memory must
// dwarf the exe alone (the WebView2 renderer/GPU processes are where the app
// actually lives).
//   node scripts/perf-family-check.mjs
// Prereq: Vite dev on 127.0.0.1:1420.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnApp, attach, killTree } from "./lib/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let app;
try {
  app = spawnApp({
    root,
    portBase: 9140, // see the map in lib/app.mjs
    profileName: "wv2-perf-family-profile",
  });
  const cdp = await attach(app);

  const out = await cdp.eval(`(async () => {
    const deadline = Date.now() + 30000;
    while (!window.__prefs) {
      if (Date.now() > deadline) throw new Error("hooks unavailable");
      await new Promise(r => setTimeout(r, 200));
    }
    window.__prefs.set({ perfOverlay: true });
    // Two Rust polls minimum (family CPU needs a delta; scan is on poll 1).
    await new Promise(r => setTimeout(r, 3200));
    const el = document.querySelector('[role="status"]');
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
