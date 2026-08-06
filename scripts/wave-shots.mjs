// Track B wave verification: per-mode style strips on the live device.
// For each requested mode, applies every factory style (defaults first)
// against a demo track and screenshots the canvas — the before/after
// evidence pack behind every GPU-matrix re-bless in the depth program.
//
//   node scripts/wave-shots.mjs --modes=aurora,synthwave --out=<dir> [--demo=groove]
// Prereq: Vite dev on 127.0.0.1:1420 (the debug exe loads it).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { spawnApp, attachWithRecovery, waitHooks, killTree } from "./lib/app.mjs";
import { loadDemoAndPlay, seekAndPlay } from "./lib/demo.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, dflt) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? "").slice(name.length + 3) || dflt;
const modes = arg("modes", "").split(",").filter(Boolean);
const outDir = arg("out", "");
const demo = arg("demo", "groove");
if (!modes.length || !outDir) throw new Error("--modes=a,b and --out=<dir> required");
mkdirSync(outDir, { recursive: true });

let app;
try {
  app = spawnApp({
    root,
    portBase: 9300, // see the map in lib/app.mjs
    profileName: "wave-shots-profile",
  });
  // The demo load is part of the recovery probe: on a cold Vite dep cache
  // its dynamic imports trigger "new dependencies optimized — reloading
  // page", which destroys the awaited eval ("Promise was collected") — the
  // retry re-attaches to the reloaded page and re-loads the demo.
  const cdp = await attachWithRecovery(app, async (c) => {
    await waitHooks(c, ["__store", "__presets"]);
    await loadDemoAndPlay(c, demo);
  });
  await sleep(1200);

  const shotCanvas = async (name) => {
    await cdp.shotCanvas(path.join(outDir, name));
    console.log("SHOT", name);
  };

  for (const mode of modes) {
    const styles = await cdp.eval(
      `(() => { const p = window.__presets().find(x => x.id === ${JSON.stringify(mode)});
         return p ? p.styles.map(s => ({ id: s.id, name: s.name, values: s.values })) : null; })()`,
      false,
    );
    if (!styles) {
      console.log("MODE MISS", mode);
      continue;
    }
    // Defaults first: switch + reset gives the mode's stock look.
    await seekAndPlay(cdp);
    await cdp.eval(
      `(() => { const s = window.__store.getState();
        s.switchPreset(${JSON.stringify(mode)});
        s.resetParams?.();
        return true; })()`,
      false,
    );
    await sleep(4000);
    await shotCanvas(`${mode}--defaults.png`);
    for (const st of styles) {
      await seekAndPlay(cdp);
      await cdp.eval(
        `(() => { const s = window.__store.getState();
          s.resetParams?.();
          s.applyStyle(${JSON.stringify(st.values)});
          return true; })()`,
        false,
      );
      await sleep(4000);
      const safe = st.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      await shotCanvas(`${mode}--${safe}.png`);
    }
  }
  console.log("WAVE-SHOTS OK");
} finally {
  killTree(app);
}
