// Diagnostic: raw requestMIDIAccess result inside the debug shell + the Rust
// permission handler's stderr trace. Not a test — a truth extractor.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { spawnApp, attach, killTree } from "./lib/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let app;
try {
  app = spawnApp({
    root,
    portBase: 9220, // see the map in lib/app.mjs
    profileName: "wv2-midi-probe-profile",
  });
  const cdp = await attach(app);
  await sleep(2000);

  const probe = await cdp.eval(`(async () => {
    const out = { hasApi: "requestMIDIAccess" in navigator, secure: window.isSecureContext,
                  origin: location.origin };
    try {
      const a = await navigator.requestMIDIAccess({ sysex: false });
      const names = [];
      a.inputs.forEach(i => names.push(i.name));
      out.ok = true; out.inputs = names;
    } catch (e) {
      out.ok = false; out.err = (e && (e.name + ": " + e.message)) || String(e);
    }
    return out;
  })()`);
  console.log("PROBE:", JSON.stringify(probe));

  // Second stage: the STORE path. Distinguish "await startMidi never
  // settles" from "settles but the null-handle branch fired" (notice set).
  const store = await cdp.eval(`(async () => {
    const deadline = Date.now() + 20000;
    while (!window.__store) {
      if (Date.now() > deadline) return { err: "no store" };
      await new Promise(r => setTimeout(r, 200));
    }
    const s = window.__store;
    const before = { enabled: s.getState().midiEnabled, notice: s.getState().notice };
    const p = s.getState().enableMidi();
    const settle = await Promise.race([
      p.then(() => "resolved", (e) => "threw: " + e),
      new Promise(r => setTimeout(() => r("STILL PENDING after 4s"), 4000)),
    ]);
    return { before, settle,
             after: { enabled: s.getState().midiEnabled,
                      devices: JSON.parse(JSON.stringify(s.getState().midiDevices)),
                      notice: s.getState().notice } };
  })()`);
  console.log("STORE:", JSON.stringify(store));
  await sleep(500);
  const lines = app
    .log()
    .split(/\r?\n/)
    .filter((l) => l.includes("[midi-permission]"));
  console.log("RUST:", lines.length ? lines.join(" | ") : "(no handler output)");
} finally {
  killTree(app);
}
