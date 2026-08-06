// Smoke against an INSTALLED build: boot the given exe, prove the WebView2
// runtime serves the real app shell (title, canvas, WebGPU). Boot stays
// LOCAL (arbitrary installed exe + optional data dir); page-poll + CDP
// client come from scripts/lib (P-14-lite).
//
//   node scripts/installed-runtime-smoke.mjs --exe=<absolute path> [--data-dir=<dir>]
import { spawn } from "node:child_process";
import path from "node:path";
import { Cdp } from "./lib/cdp.mjs";
import { harnessPort, waitForPage, killTree } from "./lib/app.mjs";

const exeArg = process.argv.find((arg) => arg.startsWith("--exe="));
if (!exeArg) throw new Error("usage: installed-runtime-smoke.mjs --exe=<absolute path>");
const exe = path.resolve(exeArg.slice("--exe=".length));
const dataArg = process.argv.find((arg) => arg.startsWith("--data-dir="));
const dataDir = dataArg ? path.resolve(dataArg.slice("--data-dir=".length)) : undefined;
const port = harnessPort(10140); // see the map in lib/app.mjs

let app;
let cdp;

try {
  const args = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? "";
  let log = "";
  const child = spawn(exe, [], {
    cwd: path.dirname(exe),
    windowsHide: true,
    env: {
      ...process.env,
      ...(dataDir ? { WEBVIEW2_USER_DATA_FOLDER: dataDir } : {}),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `${args} --remote-debugging-port=${port}`.trim(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keep = (chunk) => (log = (log + chunk.toString()).slice(-20_000));
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  app = { child, port, log: () => log };

  // The installed app serves the bundled frontend (no dev URL) — match its
  // page by title rather than a localhost origin.
  const page = await waitForPage(app, {
    timeoutMs: 45_000,
    intervalMs: 400,
    match: (entry) =>
      entry.type === "page" && entry.webSocketDebuggerUrl && entry.title === "Beatform",
  });
  cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();
  const result = await cdp.eval(
    `({
      title: document.title,
      readyState: document.readyState,
      canvasCount: document.querySelectorAll("canvas").length,
      webgpu: !!navigator.gpu,
      bodyText: document.body.innerText.slice(0, 500)
    })`,
    false,
  );
  if (result.title !== "Beatform") throw new Error(`wrong title: ${result.title}`);
  if (result.readyState !== "complete") throw new Error(`document state: ${result.readyState}`);
  if (result.canvasCount < 1) throw new Error("visual canvas missing");
  if (!result.webgpu) throw new Error("WebGPU unavailable in installed runtime");
  if (result.bodyText.trim().length < 20) throw new Error("app shell did not render");
  console.log(
    `Installed runtime passed: ${page.url}, title ${result.title}, ` +
      `${result.canvasCount} canvas, WebGPU available`,
  );
} finally {
  cdp?.close();
  killTree(app);
}
