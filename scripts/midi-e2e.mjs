// VERIFY-003: Web MIDI browser-to-adapter transport, end to end on device.
//
// Drives the debug shell over CDP through the REAL Web MIDI path — WebView2's
// requestMIDIAccess against a real (virtual) MIDI port — with messages sent
// from outside the app via winmm (scripts/midi-send.ps1). Covers:
//   1. permission + access: enableMidi() succeeds inside WebView2
//   2. discovery: the loopMIDI port appears in midiDevices
//   3. CC learn: setMidiLearn(cc) + one CC message => binding, learn cleared
//   4. CC apply: one CC message => exactly ONE param change, correct scaling
//   5. note learn + apply: note binding switches the preset
//   6. reconnect: disableMidi() + enableMidi() => still exactly ONE change
//      per message (no stacked handlers / duplicate subscriptions)
//
//   node scripts/midi-e2e.mjs
// Prereqs: Vite dev on 127.0.0.1:1420; loopMIDI running with a port whose
// name contains "loopMIDI Beatform".
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = path.join(root, "src-tauri", "target", "debug", "beatform.exe");
const PORT_NAME = "loopMIDI Beatform";
const port = 9700 + (process.pid % 80);
let child;
let log = "";

function send(messages) {
  const out = execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(root, "scripts", "midi-send.ps1"),
      "-Port",
      PORT_NAME,
      "-Messages",
      messages,
    ],
    { encoding: "utf8" },
  ).trim();
  if (!out.startsWith("SENT")) throw new Error(`sender failed: ${out}`);
}

async function page() {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`app exited ${child.exitCode}\n${log}`);
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const m = pages.find(
        (p) => p.type === "page" && p.webSocketDebuggerUrl && /localhost|127\.0\.0\.1/.test(p.url),
      );
      if (m) return m;
    } catch {
      /* not ready */
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for WebView2\n${log}`);
}

class Cdp {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.ws = new globalThis.WebSocket(url);
  }
  async open() {
    await new Promise((res, rej) => {
      this.ws.addEventListener("open", res, { once: true });
      this.ws.addEventListener("error", rej, { once: true });
    });
    this.ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message));
      else p.resolve(m.result);
    });
    await this.send("Runtime.enable");
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, awaitPromise = true) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails.exception;
      throw new Error(
        ex?.description ?? (ex?.value != null ? JSON.stringify(ex.value) : null) ?? "eval failed",
      );
    }
    return r.result.value;
  }
}

try {
  const existingArgs = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? "";
  child = spawn(exe, [], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        `${existingArgs} --remote-debugging-port=${port}`.trim(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keep = (c) => (log = (log + c.toString()).slice(-20_000));
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);

  const attach = async () => {
    const t = await page();
    const c = new Cdp(t.webSocketDebuggerUrl);
    await c.open();
    return c;
  };
  let cdp = await attach();
  // Cold Vite dep cache reloads the page on the first dynamic @tauri-apps
  // import ("new dependencies optimized") — absorb it before the real run.
  try {
    await cdp.eval(`import("@tauri-apps/api/core").then(() => true)`);
  } catch {
    await sleep(2000);
    cdp = await attach();
  }

  // 1+2: enable MIDI (permission + access + discovery), install a change
  // counter for the duplicate checks, park on the particles preset (its
  // "speed" param 0..1.5 is the CC target).
  const setup = await cdp.eval(`(async () => {
    const deadline = Date.now() + 30000;
    while (!window.__store) {
      if (Date.now() > deadline) throw new Error("hooks unavailable");
      await new Promise(r => setTimeout(r, 200));
    }
    const store = window.__store;
    store.getState().switchPreset?.("particles");
    // The permission handler installs on the Rust side during page load;
    // give it a beat, and retry once — a request that races the install is
    // denied and enableMidi's null return would otherwise end the story.
    await new Promise(r => setTimeout(r, 1200));
    for (let attempt = 0; attempt < 2 && !store.getState().midiEnabled; attempt++) {
      await store.getState().enableMidi();
      const t0 = Date.now() + 5000;
      while (!store.getState().midiEnabled && Date.now() < t0) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    // Count every change of the CC-bound param; the duplicate checks read
    // and reset this between sends.
    window.__ccChanges = 0;
    let last = store.getState().paramsByPreset?.particles?.speed;
    window.__unsubMidiE2e?.();
    window.__unsubMidiE2e = store.subscribe((s) => {
      const v = s.paramsByPreset?.particles?.speed;
      if (v !== last) { last = v; window.__ccChanges++; }
    });
    return {
      enabled: store.getState().midiEnabled,
      devices: store.getState().midiDevices,
    };
  })()`);
  console.log("SETUP:", JSON.stringify(setup));
  if (!setup.enabled) {
    // Failure forensics: raw API state (reject vs hang) + the Rust handler
    // trace that the child wrote to stderr.
    const raw = await cdp.eval(`(async () => {
      const timeout = new Promise(r => setTimeout(() => r({ state: "PENDING after 3s" }), 3000));
      const req = navigator.requestMIDIAccess({ sysex: false })
        .then(a => { const n = []; a.inputs.forEach(i => n.push(i.name)); return { state: "ok", inputs: n }; })
        .catch(e => ({ state: "rejected", err: (e && e.name + ": " + e.message) || String(e) }));
      return Promise.race([req, timeout]);
    })()`);
    console.log("RAW:", JSON.stringify(raw));
    const lines = log.split(/\r?\n/).filter((l) => l.includes("[midi-permission]"));
    console.log("RUST:", lines.length ? lines.join(" | ") : "(no handler output)");
    throw new Error("enableMidi failed — permission/access blocked in WebView2");
  }
  if (!setup.devices.some((d) => d.includes("loopMIDI"))) {
    throw new Error(`loopMIDI port not discovered: ${JSON.stringify(setup.devices)}`);
  }

  // 3: CC learn — arm, send CC#7, expect a binding and learn cleared.
  await cdp.eval(
    `window.__store.getState().setMidiLearn({ kind: "cc", param: "speed", min: 0, max: 1.5 }); true`,
    false,
  );
  send("B0-07-40");
  await sleep(600);
  const learned = await cdp.eval(
    `JSON.parse(JSON.stringify({ b: window.__store.getState().midiBindings, l: window.__store.getState().midiLearn }))`,
    false,
  );
  console.log("LEARNED:", JSON.stringify(learned));
  const ccBinding = learned.b.find((b) => b.kind === "cc" && b.cc === 7);
  if (!ccBinding || learned.l !== null) throw new Error("CC learn failed");
  if (ccBinding.param !== "speed" || ccBinding.max !== 1.5) {
    throw new Error(`CC binding wrong: ${JSON.stringify(ccBinding)}`);
  }

  // 4: CC apply — full-scale message must set speed to max, exactly once.
  await cdp.eval(`window.__ccChanges = 0; true`, false);
  send("B0-07-7F");
  await sleep(600);
  const apply = await cdp.eval(
    `({ v: window.__store.getState().paramsByPreset?.particles?.speed, n: window.__ccChanges })`,
    false,
  );
  console.log("APPLY:", JSON.stringify(apply));
  if (Math.abs(apply.v - 1.5) > 1e-6) throw new Error(`CC scaling wrong: ${apply.v} (want 1.5)`);
  if (apply.n !== 1) throw new Error(`expected exactly 1 param change, got ${apply.n}`);

  // 5: note learn + apply — bind note 60 to metaballs, then trigger it.
  await cdp.eval(
    `window.__store.getState().setMidiLearn({ kind: "note", presetId: "metaballs" }); true`,
    false,
  );
  send("90-3C-7F");
  await sleep(600);
  send("90-3C-7F");
  await sleep(800);
  const note = await cdp.eval(
    `({ preset: window.__store.getState().presetId,
        bound: window.__store.getState().midiBindings.some(b => b.kind === "note" && b.note === 60) })`,
    false,
  );
  console.log("NOTE:", JSON.stringify(note));
  if (!note.bound) throw new Error("note learn failed");
  if (note.preset !== "metaballs") throw new Error(`note apply failed: preset=${note.preset}`);

  // 6: reconnect — tear down, re-enable, one message must mean ONE change.
  // Back on particles first: the CC binding drives the ACTIVE preset's param,
  // and the note test just switched to metaballs.
  const re = await cdp.eval(`(async () => {
    const store = window.__store;
    store.getState().switchPreset?.("particles");
    store.getState().disableMidi();
    await new Promise(r => setTimeout(r, 300));
    const during = { enabled: store.getState().midiEnabled, devices: store.getState().midiDevices };
    await store.getState().enableMidi();
    const t0 = Date.now() + 10000;
    while (!store.getState().midiEnabled && Date.now() < t0) {
      await new Promise(r => setTimeout(r, 200));
    }
    window.__ccChanges = 0;
    return { during, enabled: store.getState().midiEnabled, devices: store.getState().midiDevices };
  })()`);
  console.log("RECONNECT:", JSON.stringify(re));
  if (re.during.enabled || re.during.devices.length !== 0) {
    throw new Error("disableMidi left state behind");
  }
  if (!re.enabled) throw new Error("re-enable failed");
  send("B0-07-00");
  await sleep(600);
  const re2 = await cdp.eval(
    `({ v: window.__store.getState().paramsByPreset?.particles?.speed, n: window.__ccChanges })`,
    false,
  );
  console.log("RECONNECT-APPLY:", JSON.stringify(re2));
  if (Math.abs(re2.v - 0) > 1e-6) throw new Error(`post-reconnect scaling wrong: ${re2.v}`);
  if (re2.n !== 1) {
    throw new Error(`post-reconnect: expected exactly 1 change, got ${re2.n} (stacked handlers?)`);
  }

  console.log("MIDI-E2E OK: permission+discovery+ccLearn+ccApply+noteApply+reconnect all pass");
} finally {
  child?.kill();
  try {
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      "Get-Process -Name beatform -ErrorAction SilentlyContinue | Stop-Process -Force",
    ]);
  } catch {
    /* gone */
  }
}
