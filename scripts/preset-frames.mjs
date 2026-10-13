// Frames to look at: render presets with param overrides on the app's own
// WebGPU path (dev hook __renderPresetFrames) and write PNGs — the way a new
// knob gets judged by eye, where the pixel matrix only says that a hash moved.
//
//   node scripts/preset-frames.mjs --cases <cases.json> --out <dir>
//     [--width 640] [--height 360] [--times 1,3]
//
// cases.json: [{ "id": "aurora-mirror", "preset": "aurora", "values": { "mirror": 6 } }, ...]
// Needs the Vite dev server running (npm run dev -- --host 127.0.0.1); spawns
// the debug shell like the other harnesses (scripts/lib/app.mjs).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachWithRecovery, killTree, spawnApp, waitHooks } from "./lib/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k, def) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : def;
};
const casesPath = opt("cases");
const outDir = opt("out", path.join(root, "node_modules", ".cache", "preset-frames"));
if (!casesPath) throw new Error("usage: preset-frames.mjs --cases <cases.json> --out <dir>");
const cases = JSON.parse(readFileSync(casesPath, "utf8"));
const width = Number(opt("width", "640"));
const height = Number(opt("height", "360"));
const times = opt("times", "1,3")
  .split(",")
  .map(Number)
  .filter((n) => Number.isFinite(n));
mkdirSync(outDir, { recursive: true });

const app = spawnApp({ root, portBase: 10700, profileName: "wv2-frames-profile" }); // see lib/app.mjs map
let cdp;
try {
  cdp = await attachWithRecovery(app, (c) => waitHooks(c, ["__renderPresetFrames"]));
  for (const c of cases) {
    const frames = await cdp.eval(
      `window.__renderPresetFrames(${JSON.stringify(c.preset)}, ${JSON.stringify(c.values ?? {})}, ${JSON.stringify({ width, height, times, motion: c.motion })})`,
    );
    for (const f of frames) {
      const file = path.join(outDir, `${c.id}@${f.t}s.png`);
      writeFileSync(file, Buffer.from(f.png.split(",")[1], "base64"));
      console.log(file);
    }
  }
} finally {
  cdp?.close();
  killTree(app);
}
