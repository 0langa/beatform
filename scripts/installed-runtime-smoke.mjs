import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const exeArg = process.argv.find((arg) => arg.startsWith("--exe="));
if (!exeArg) throw new Error("usage: installed-runtime-smoke.mjs --exe=<absolute path>");
const exe = path.resolve(exeArg.slice("--exe=".length));
const dataArg = process.argv.find((arg) => arg.startsWith("--data-dir="));
const dataDir = dataArg ? path.resolve(dataArg.slice("--data-dir=".length)) : undefined;
const port = 9800 + (process.pid % 100);
const endpoint = `http://127.0.0.1:${port}`;

let child;
let socket;
let log = "";

async function waitForPage() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`app exited ${child.exitCode}\n${log}`);
    try {
      const pages = await fetch(`${endpoint}/json/list`).then((response) => response.json());
      const page = pages.find(
        (entry) =>
          entry.type === "page" && entry.webSocketDebuggerUrl && entry.title === "Beatform",
      );
      if (page) return page;
    } catch {
      // WebView2 debugger not ready yet.
    }
    await sleep(400);
  }
  throw new Error(`timed out waiting for installed WebView2 runtime\n${log}`);
}

async function evaluate(url) {
  socket = new globalThis.WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  await send("Runtime.enable");
  const result = await send("Runtime.evaluate", {
    expression: `({
      title: document.title,
      readyState: document.readyState,
      canvasCount: document.querySelectorAll("canvas").length,
      webgpu: !!navigator.gpu,
      bodyText: document.body.innerText.slice(0, 500)
    })`,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "runtime evaluation failed");
  }
  return result.result.value;
}

try {
  const args = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? "";
  child = spawn(exe, [], {
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
  const page = await waitForPage();
  const result = await evaluate(page.webSocketDebuggerUrl);
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
  socket?.close();
  if (child?.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else child.kill("SIGTERM");
  }
}
