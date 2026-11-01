// TESTING.md D3 — the Visuals dock + section rail, driven on device.
//
// Added in v2.81.0 and never run on a real window until this harness: every
// D3 check that is a fact about geometry, focus or state is asserted here
// over CDP against the debug shell (real WebView2 layout, real pointer
// capture, real key events). What stays human: whether the drag LOOKS
// smooth.
//
// D3 as first written asked for a LETTERBOX (the canvas giving up the dock's
// width). The design moved on: `.stage` is full-bleed and the dock floats
// over the image on glass (App.css, ".stage" — a dead black column beside
// the dock was judged worse than the covering). The probe asserts the
// current contract instead: the canvas fills the window and never resizes
// for a dock drag — which is also why the trails cannot strobe — while the
// chrome that must not hide under the dock (mode strip, toasts, timeline,
// drop overlay, perf overlay) keeps to the column left of it. The dock's
// width is clamped so that column never drops below 560 px.
//
//   node scripts/dock-device-pass.mjs
//
// Prereqs: debug shell built (cargo build in src-tauri/), Vite dev on
// 127.0.0.1:1420. A probe, not a gate.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { spawnApp, attachWithRecovery, waitHooks, killTree } from "./lib/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = ["mode", "motion", "themes", "sync", "modulation", "scene", "text", "live"];
const results = [];
let failed = 0;
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : " — " + JSON.stringify(detail)}`,
  );
}

const spawnDockApp = () => spawnApp({ root, portBase: 10540, profileName: "wv2-dock-profile" }); // see lib/app.mjs map

/** CSS-pixel rect of the first element matching `sel` (null when absent or display:none). */
const rectJs = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height };
})()`;

async function mouse(cdp, type, x, y) {
  await cdp.send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: "left",
    buttons: type === "mouseReleased" ? 0 : 1,
    clickCount: type === "mouseMoved" ? 0 : 1,
  });
}

async function key(cdp, k, { shift = false } = {}) {
  const codes = {
    ArrowLeft: 37,
    ArrowRight: 39,
    ArrowUp: 38,
    ArrowDown: 40,
    Home: 36,
    End: 35,
    Tab: 9,
  };
  const base = { key: k, code: k, windowsVirtualKeyCode: codes[k], modifiers: shift ? 8 : 0 };
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(120);
}

let app;
try {
  app = spawnDockApp();
  let cdp = await attachWithRecovery(app, (c) => waitHooks(c, ["__store", "__prefs"]), {
    retrySleepMs: 2000,
  });

  // Known start: a playing demo on a FEEDBACK mode, dock open on Mode at 760.
  await cdp.eval(`(async () => {
    const st = window.__store.getState();
    st.setStageMode(false);
    st.setShowLibrary(false);
    st.setShowTimeline(false);
    st.setShowPanel(true);
    window.__prefs.set({ visualsWidth: 760, visualsPage: "mode", perfOverlay: false });
    st.switchPreset("echo-trails");
    await st.loadDemo("groove");
    return true;
  })()`);
  // visualsWidth is read into App state at mount — reload once so the
  // dock starts from the pref, exactly like a launch does.
  await cdp.eval(`location.reload(); true`, false);
  await sleep(4000);
  cdp = await attachWithRecovery(app, (c) => waitHooks(c, ["__store", "__prefs"]), {
    retrySleepMs: 2000,
  });
  await cdp.eval(`(async () => {
    const st = window.__store.getState();
    st.setShowPanel(true);
    st.switchPreset("echo-trails");
    await st.loadDemo("groove");
    return true;
  })()`);
  await sleep(1500);

  const vw = await cdp.eval(`window.innerWidth`, false);
  const dock = () => cdp.eval(rectJs(".params-panel"), false);
  const canvas = () => cdp.eval(rectJs(".viz-canvas"), false);
  const handle = () => cdp.eval(rectJs('[aria-label="Resize Visuals"]'), false);

  /** The chrome column's right edge for a dock width setting (App.css
   * --visuals-w: the dock gives ground so this never drops below 560). */
  const columnRight = (w) => vw - Math.min(w, Math.max(320, vw - 560));

  // --- Full-bleed: the image fills the window, the dock floats over it ---
  for (const aspect of ["free", "16:9"]) {
    await cdp.eval(`window.__store.getState().setAspect(${JSON.stringify(aspect)}); true`, false);
    await sleep(500);
    const [d, c, st] = [await dock(), await canvas(), await cdp.eval(rectJs(".stage"), false)];
    const ok =
      !!d &&
      !!st &&
      !!c &&
      Math.round(st.l) === 0 &&
      Math.round(st.r) === vw &&
      (aspect === "free" ? Math.round(c.r) === vw : c.r <= vw + 1);
    check(`full-bleed (${aspect}): the stage spans the window under the dock`, ok, {
      stage: st && [Math.round(st.l), Math.round(st.r)],
      canvas: c && [Math.round(c.l), Math.round(c.r)],
      dockLeft: d?.l,
    });
  }
  await cdp.eval(`window.__store.getState().setAspect("free"); true`, false);
  await sleep(300);

  // --- Drag the left edge end to end: the canvas column holds still until release ---
  {
    const h = await handle();
    const y = (h.t + h.b) / 2;
    const c0 = await canvas();
    const bs0 = await cdp.eval(`document.querySelector(".viz-canvas").width`, false);
    await mouse(cdp, "mousePressed", h.l + h.w / 2, y);
    const during = [];
    for (let x = h.l + h.w / 2; x <= vw - 380 + 2; x += 40) {
      await mouse(cdp, "mouseMoved", x, y);
      await sleep(30);
      const [c, d] = [await canvas(), await dock()];
      during.push({ canvasW: Math.round(c.w), dockW: Math.round(d.w) });
    }
    await mouse(cdp, "mouseMoved", vw - 380 + 2, y);
    await sleep(60);
    const bsDuring = await cdp.eval(`document.querySelector(".viz-canvas").width`, false);
    await mouse(cdp, "mouseReleased", vw - 380 + 2, y);
    await sleep(600);
    const c1 = await canvas();
    const d1 = await dock();
    const canvasWidths = [...new Set(during.map((s) => s.canvasW))];
    const dockWidths = [...new Set(during.map((s) => s.dockW))];
    check(
      "drag: the dock follows the pointer while the canvas holds still",
      canvasWidths.length === 1 && canvasWidths[0] === Math.round(c0.w) && dockWidths.length > 3,
      { canvasWidths, dockFrames: dockWidths.length },
    );
    const bsAfter = await cdp.eval(`document.querySelector(".viz-canvas").width`, false);
    check(
      "drag: the canvas backing store never resizes (feedback trails cannot strobe)",
      bsDuring === bs0 && bsAfter === bs0 && Math.round(c1.w) === Math.round(c0.w),
      { before: bs0, during: bsDuring, after: bsAfter },
    );
    const valueNow = await cdp.eval(
      `Number(document.querySelector('[aria-label="Resize Visuals"]').getAttribute("aria-valuenow"))`,
      false,
    );
    check("drag: released at the minimum width", valueNow === 380 && d1.r <= vw, {
      valueNow,
      dockW: d1.w,
    });
  }

  // --- Keyboard on the same edge: arrows ±16, Shift ±48, Home/End 380/760 ---
  {
    await cdp.eval(`document.querySelector('[aria-label="Resize Visuals"]').focus(); true`, false);
    const now = () =>
      cdp.eval(
        `Number(document.querySelector('[aria-label="Resize Visuals"]').getAttribute("aria-valuenow"))`,
        false,
      );
    const v0 = await now();
    await key(cdp, "ArrowLeft");
    const v1 = await now();
    await key(cdp, "ArrowLeft", { shift: true });
    const v2 = await now();
    await key(cdp, "ArrowRight");
    const v3 = await now();
    await key(cdp, "End");
    const vEnd = await now();
    await key(cdp, "Home");
    const vHome = await now();
    check(
      "keyboard: arrows step 16, Shift steps 48, Home/End reach the limits",
      Math.abs(v1 - v0) === 16 &&
        Math.abs(v2 - v1) === 48 &&
        Math.abs(v3 - v2) === 16 &&
        [vEnd, vHome].sort((a, b) => a - b).join() === "380,760",
      { v0, v1, v2, v3, vEnd, vHome },
    );
    // Park at 760 for the overlap checks below.
    const endIs760 = vEnd === 760;
    await key(cdp, endIs760 ? "End" : "Home");
  }
  const d760 = await dock();
  const parked = await cdp.eval(
    `Number(document.querySelector('[aria-label="Resize Visuals"]').getAttribute("aria-valuenow"))`,
    false,
  );
  const col760 = columnRight(760);
  check("dock parked at 760, clamped to keep a 560 px column", parked === 760 && d760.l >= col760, {
    parked,
    dockLeft: d760.l,
    columnRight: col760,
  });

  // --- Nothing floats over the dock ---
  {
    await cdp.eval(`window.__store.getState().setShowTimeline(true); true`, false);
    await sleep(500);
    const tl = await cdp.eval(rectJs(".timeline-panel"), false);
    check("timeline stops at the dock's edge", !!tl && tl.r <= d760.l + 1, {
      timelineRight: tl?.r,
      dockLeft: d760.l,
    });
    await cdp.eval(`window.__store.getState().setShowTimeline(false); true`, false);

    await cdp.eval(`window.__store.setState({ notice: "dock pass toast" }); true`, false);
    await sleep(400);
    const toast = await cdp.eval(rectJs(".notice-toast"), false);
    const c = await canvas();
    const toastMid = toast ? (toast.l + toast.r) / 2 : null;
    const colMid = col760 / 2;
    check(
      "toast centres in the column left of the dock",
      toast && Math.abs(toastMid - colMid) <= 2 && toast.r <= d760.l,
      {
        toastMid,
        columnMid: colMid,
        canvasMid: c ? (c.l + c.r) / 2 : null,
      },
    );

    await cdp.eval(`window.__store.getState().setDragOver(true); true`, false);
    await sleep(300);
    const drop = await cdp.eval(rectJs(".drop-overlay"), false);
    check("drop overlay stops at the dock", !!drop && drop.r <= d760.l + 1, {
      dropRight: drop?.r,
      dockLeft: d760.l,
    });
    await cdp.eval(`window.__store.getState().setDragOver(false); true`, false);

    for (const corner of ["top-right", "bottom-right"]) {
      await cdp.eval(
        `window.__prefs.set({ perfOverlay: true, perfOverlayCorner: ${JSON.stringify(corner)} }); true`,
        false,
      );
      await sleep(700);
      const po = await cdp.eval(rectJs(".perf-overlay"), false);
      check(`perf overlay (${corner}) stays left of the dock`, !!po && po.r <= d760.l + 1, {
        overlayRight: po?.r,
        dockLeft: d760.l,
      });
    }
    await cdp.eval(`window.__prefs.set({ perfOverlay: false }); true`, false);
  }

  // --- Rail: eight destinations, click swaps, arrows walk, ONE tab stop ---
  {
    const ids = await cdp.eval(
      `[...document.querySelectorAll(".visuals-rail button.rail-item[data-section]")].map(b => b.dataset.section).filter(s => s !== "search")`,
      false,
    );
    check("rail: eight destinations in order", JSON.stringify(ids) === JSON.stringify(PAGES), {
      ids,
    });
    const swapped = [];
    for (const id of PAGES) {
      await cdp.eval(
        `document.querySelector('.visuals-rail button.rail-item[data-section="${id}"]').click(); true`,
        false,
      );
      await sleep(150);
      swapped.push(await cdp.eval(`window.__prefs.get().visualsPage`, false));
    }
    check(
      "rail: clicking each destination swaps the page",
      JSON.stringify(swapped) === JSON.stringify(PAGES),
      { swapped },
    );

    await cdp.eval(
      `document.querySelector('.visuals-rail button.rail-item[data-section="mode"]').click(); document.querySelector('.visuals-rail button.rail-item[data-section="mode"]').focus(); true`,
      false,
    );
    await sleep(150);
    await key(cdp, "ArrowDown");
    await key(cdp, "ArrowDown");
    const walked = await cdp.eval(
      `({ page: window.__prefs.get().visualsPage, focus: document.activeElement?.dataset?.section })`,
      false,
    );
    check(
      "rail: arrow keys walk it",
      walked.page === "themes" && walked.focus === "themes",
      walked,
    );
    const tabStops = await cdp.eval(
      `[...document.querySelectorAll(".visuals-rail button.rail-item")].filter(b => b.tabIndex === 0).length`,
      false,
    );
    check("rail: the whole rail is ONE tab stop", tabStops === 1, { tabStops });
  }

  // --- Counts on Modulation / Scene / Live once there is something to count ---
  {
    const badges = await cdp.eval(`(async () => {
      const st = window.__store.getState();
      const badge = (id) => document.querySelector('.visuals-rail button.rail-item[data-section="' + id + '"] .group-count')?.textContent ?? null;
      const before = { modulation: badge("modulation"), scene: badge("scene"), live: badge("live") };
      st.setMidiLearn?.(null);
      window.__store.setState({ midiBindings: [{ kind: "note", note: 61, presetId: "particles" }] });
      st.addTextLayer();
      st.addModRoute("bass", window.__presets().find(p => p.id === st.presetId).params[0].key);
      await new Promise(r => setTimeout(r, 400));
      return { before, after: { modulation: badge("modulation"), scene: badge("scene"), live: badge("live") } };
    })()`);
    check("rail: Live shows a count once a MIDI binding exists", badges.after.live === "1", badges);
    console.log("BADGES:", JSON.stringify(badges));
  }

  // --- Motion is dimmed on Voice Orb and LED Matrix, says why, still clickable ---
  for (const preset of ["voice-orb", "led-matrix"]) {
    await cdp.eval(
      `window.__store.getState().switchPreset(${JSON.stringify(preset)}); true`,
      false,
    );
    await sleep(300);
    const m = await cdp.eval(
      `(() => {
      const b = document.querySelector('.visuals-rail button.rail-item[data-section="motion"]');
      const dimmed = b.classList.contains("is-unavailable");
      const title = b.title;
      b.click();
      return { dimmed, title };
    })()`,
      false,
    );
    await sleep(150);
    const page = await cdp.eval(`window.__prefs.get().visualsPage`, false);
    check(
      `rail: Motion dimmed on ${preset}, says why, still clickable`,
      m.dimmed && m.title.length > 10 && page === "motion",
      { ...m, page },
    );
  }
  await cdp.eval(`window.__store.getState().switchPreset("echo-trails"); true`, false);

  // --- Stage round-trip: S hides the dock, S brings it back exactly as it was ---
  {
    const before = {
      rect: await dock(),
      page: await cdp.eval(`window.__prefs.get().visualsPage`, false),
    };
    await cdp.eval(`window.__store.getState().setStageMode(true); true`, false);
    await sleep(400);
    const hidden = await dock();
    await cdp.eval(`window.__store.getState().setStageMode(false); true`, false);
    await sleep(400);
    const after = {
      rect: await dock(),
      page: await cdp.eval(`window.__prefs.get().visualsPage`, false),
    };
    check(
      "stage round-trip: hidden on stage, back exactly as it was",
      hidden === null &&
        after.rect &&
        Math.round(after.rect.w) === Math.round(before.rect.w) &&
        after.page === before.page,
      {
        hidden,
        before: { w: before.rect?.w, page: before.page },
        after: { w: after.rect?.w, page: after.page },
      },
    );
  }

  // --- Idle: playing, pointer still -> top bar and player bar fade, dock stays lit ---
  {
    // From the top: the demo may have played out by now, and a finished
    // track is not "playing" — idle needs a running transport.
    await cdp.eval(`(async () => {
      const st = window.__store.getState();
      st.seekStart();
      if (!window.__store.getState().playback.playing) await st.togglePlay();
      window.__store.getState().pokeChrome();
      return true;
    })()`);
    await sleep(4500);
    const idle = await cdp.eval(
      `(() => {
      const op = (sel) => { const el = document.querySelector(sel); return el ? Number(getComputedStyle(el).opacity) : null; };
      return { chromeIdle: window.__store.getState().chromeIdle, top: op(".top-bar"), player: op(".player-bar"), dock: op(".params-panel"), grip: op('[aria-label="Resize Visuals"]') };
    })()`,
      false,
    );
    check(
      "idle: bars fade, the dock and its grip stay lit",
      idle.chromeIdle && idle.top < 0.2 && idle.player < 0.2 && idle.dock > 0.9 && idle.grip > 0.9,
      idle,
    );
    await cdp.eval(`window.__store.getState().pokeChrome(); true`, false);
  }

  // --- Library grip with the dock CLOSED ---
  {
    await cdp.eval(
      `(() => { const st = window.__store.getState(); st.setShowPanel(false); st.setShowLibrary(true); return true; })()`,
      false,
    );
    await sleep(500);
    const lh = await cdp.eval(rectJs('[aria-label="Resize the library"]'), false);
    const lib0 = await cdp.eval(rectJs(".library-panel"), false);
    let lib1 = null;
    if (lh) {
      const y = (lh.t + lh.b) / 2;
      await mouse(cdp, "mousePressed", lh.l + lh.w / 2, y);
      for (let x = lh.l + lh.w / 2; x <= lh.l + 120; x += 30) {
        await mouse(cdp, "mouseMoved", x, y);
        await sleep(30);
      }
      await mouse(cdp, "mouseReleased", lh.l + 120, y);
      await sleep(300);
      lib1 = await cdp.eval(rectJs(".library-panel"), false);
    }
    check("library grip works with the dock closed", !!lh && !!lib1 && lib1.w > lib0.w + 40, {
      before: lib0?.w,
      after: lib1?.w,
    });
    await cdp.eval(
      `(() => { const st = window.__store.getState(); st.setShowLibrary(false); st.setShowPanel(true); return true; })()`,
      false,
    );
    await sleep(300);
  }

  // --- Persistence: page and width survive a relaunch ---
  {
    await cdp.eval(
      `document.querySelector('.visuals-rail button.rail-item[data-section="sync"]').click(); document.querySelector('[aria-label="Resize Visuals"]').focus(); true`,
      false,
    );
    await sleep(150);
    await key(cdp, "Home");
    await key(cdp, "End");
    await key(cdp, "ArrowLeft", { shift: true });
    const want = await cdp.eval(
      `({ page: window.__prefs.get().visualsPage, width: window.__prefs.get().visualsWidth })`,
      false,
    );
    // Close the way a user does (WM_CLOSE), so WebView2 flushes localStorage
    // on shutdown — a hard kill can lose the last seconds of writes, which
    // is a harness artefact, not the app forgetting.
    await sleep(1500);
    try {
      execFileSync("taskkill", ["/PID", String(app.child.pid)], { stdio: "ignore" });
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 40 && app.child.exitCode === null; i++) await sleep(250);
    killTree(app);
    await sleep(1500);
    app = spawnDockApp();
    cdp = await attachWithRecovery(app, (c) => waitHooks(c, ["__store", "__prefs"]), {
      retrySleepMs: 2000,
    });
    await cdp.eval(`window.__store.getState().setShowPanel(true); true`, false);
    await sleep(800);
    const got = await cdp.eval(
      `(() => {
      const active = document.querySelector(".visuals-rail button.rail-item.active")?.dataset?.section;
      const w = Number(document.querySelector('[aria-label="Resize Visuals"]')?.getAttribute("aria-valuenow"));
      return { page: active, width: Math.round(w ?? 0) };
    })()`,
      false,
    );
    check(
      "persistence: page and width come back after a relaunch",
      got.page === want.page && got.width === want.width,
      { want, got },
    );
  }

  console.log(
    failed === 0
      ? `DOCK-PASS OK (${results.length} checks)`
      : `DOCK-PASS FAILED ${failed}/${results.length}`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  killTree(app);
}
