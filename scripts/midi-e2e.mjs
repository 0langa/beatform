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
//   7. pad commands (HD-19): note-learn Play/pause, Next mode, Previous mode
//      and Blackout; each pad fires the store action its key fires, and the
//      blackout pad obeys the key's arming rule (inert outside Stage)
//   8. relaunch (HD-18): MIDI left enabled survives a restart — the next
//      launch re-arms by itself (no click) and a saved CC binding applies
//
//   node scripts/midi-e2e.mjs
// Prereqs: Vite dev on 127.0.0.1:1420; loopMIDI running with a port whose
// name contains "loopMIDI Beatform".
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { spawnApp, attachWithRecovery, killTree, waitHooks } from "./lib/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT_NAME = "loopMIDI Beatform";

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

let app;
const spawnMidiApp = () =>
  spawnApp({
    root,
    portBase: 9380, // see the map in lib/app.mjs
    profileName: "wv2-midi-profile",
  });
try {
  app = spawnMidiApp();
  // Probe with the hook wait, not TAURI_WARMUP (deleted — see lib/app.mjs):
  // a cold-cache Vite reload mid-poll still trips the recovery retry.
  let cdp = await attachWithRecovery(app, (c) => waitHooks(c, ["__store"]), {
    retrySleepMs: 2000,
  });

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
    const lines = app
      .log()
      .split(/\r?\n/)
      .filter((l) => l.includes("[midi-permission]"));
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

  // 7: pad commands (HD-19). Quantize off so a mode step lands at once; a
  // demo track so play/pause has something to play.
  await cdp.eval(`(async () => {
    const st = window.__store.getState();
    st.setSwitchQuantize("off");
    st.setStageMode(false);
    st.setBlackout(false);
    await st.loadDemo("groove");
    return true;
  })()`);
  for (const [note, command] of [
    ["3E", "playPause"],
    ["40", "nextMode"],
    ["41", "prevMode"],
    ["43", "blackout"],
  ]) {
    await cdp.eval(
      `window.__store.getState().setMidiLearn({ kind: "command", command: "${command}" }); true`,
      false,
    );
    send(`90-${note}-7F`);
    await sleep(500);
  }
  const cmdBindings = await cdp.eval(
    `window.__store.getState().midiBindings.filter(b => b.kind === "command").map(b => b.command + "@" + b.note).sort().join(",")`,
    false,
  );
  console.log("COMMANDS:", cmdBindings);
  if (cmdBindings !== "blackout@67,nextMode@64,playPause@62,prevMode@65") {
    throw new Error(`command learn failed: ${cmdBindings}`);
  }
  const before = await cdp.eval(
    `({ preset: window.__store.getState().presetId, playing: window.__store.getState().playback.playing })`,
    false,
  );
  send("90-40-7F"); // next mode
  await sleep(600);
  const afterNext = await cdp.eval(`window.__store.getState().presetId`, false);
  send("90-41-7F"); // previous mode
  await sleep(600);
  const afterPrev = await cdp.eval(`window.__store.getState().presetId`, false);
  send("90-3E-7F"); // play / pause
  await sleep(1500);
  const playing = await cdp.eval(`window.__store.getState().playback.playing`, false);
  send("90-43-7F"); // blackout outside Stage: must stay inert
  await sleep(500);
  const inertBlackout = await cdp.eval(`window.__store.getState().blackout`, false);
  await cdp.eval(`window.__store.getState().setStageMode(true); true`, false);
  send("90-43-7F"); // blackout inside Stage
  await sleep(500);
  const armedBlackout = await cdp.eval(`window.__store.getState().blackout`, false);
  await cdp.eval(`window.__store.getState().setStageMode(false); true`, false);
  const cmd = { before, afterNext, afterPrev, playing, inertBlackout, armedBlackout };
  console.log("COMMAND-APPLY:", JSON.stringify(cmd));
  if (afterNext === before.preset) throw new Error("next-mode pad did not step");
  if (afterPrev !== before.preset) throw new Error("previous-mode pad did not step back");
  if (playing === before.playing) throw new Error("play/pause pad did not toggle playback");
  if (inertBlackout) throw new Error("blackout pad fired outside Stage (arming rule broken)");
  if (!armedBlackout) throw new Error("blackout pad did not fire in Stage");

  // 8: relaunch (HD-18). Leave MIDI enabled, give WebView2 time to flush
  // localStorage (the kill below is not graceful), restart on the SAME
  // profile and never call enableMidi: the app must re-arm by itself.
  if (playing) await cdp.eval(`window.__store.getState().togglePlay().then(() => true)`);
  await sleep(8000);
  killTree(app);
  await sleep(2000);
  app = spawnMidiApp();
  cdp = await attachWithRecovery(app, (c) => waitHooks(c, ["__store"]), { retrySleepMs: 2000 });
  const relaunch = await cdp.eval(`(async () => {
    const store = window.__store;
    const t0 = Date.now() + 15000;
    while (!store.getState().midiEnabled && Date.now() < t0) {
      await new Promise(r => setTimeout(r, 200));
    }
    store.getState().switchPreset?.("particles");
    window.__ccChanges = 0;
    let last = store.getState().paramsByPreset?.particles?.speed;
    store.subscribe((s) => {
      const v = s.paramsByPreset?.particles?.speed;
      if (v !== last) { last = v; window.__ccChanges++; }
    });
    return { enabled: store.getState().midiEnabled, devices: store.getState().midiDevices };
  })()`);
  console.log("RELAUNCH:", JSON.stringify(relaunch));
  if (!relaunch.enabled) throw new Error("MIDI did not re-arm after relaunch (HD-18)");
  send("B0-07-7F");
  await sleep(600);
  const reApply = await cdp.eval(
    `({ v: window.__store.getState().paramsByPreset?.particles?.speed, n: window.__ccChanges })`,
    false,
  );
  console.log("RELAUNCH-APPLY:", JSON.stringify(reApply));
  if (Math.abs(reApply.v - 1.5) > 1e-6 || reApply.n !== 1) {
    throw new Error(`saved CC binding did not apply after relaunch: ${JSON.stringify(reApply)}`);
  }
  // Leave the profile as a fresh install would be: MIDI off.
  await cdp.eval(`window.__store.getState().disableMidi(); true`, false);
  await sleep(6000);

  console.log(
    "MIDI-E2E OK: permission+discovery+ccLearn+ccApply+noteApply+reconnect+padCommands+relaunch all pass",
  );
} finally {
  killTree(app);
}
