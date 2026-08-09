import { spawn, spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(root, "src", "render", "__baselines__", "gpu-pixel-matrix.json");
const update = process.argv.includes("--update");
const attach = process.argv.includes("--attach");
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = Number(portArg?.slice("--port=".length) ?? 9400 + (process.pid % 500));
const endpoint = `http://127.0.0.1:${port}`;

let child = null;
let childLog = "";
let socket = null;

function keepLog(chunk) {
  childLog = (childLog + chunk.toString()).slice(-20_000);
}

async function waitForPage(timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode != null) {
      throw new Error(`Tauri dev exited ${child.exitCode}\n${childLog}`);
    }
    try {
      const pages = await fetch(`${endpoint}/json/list`).then((r) => r.json());
      const page = pages.find(
        (p) => p.type === "page" && p.webSocketDebuggerUrl && /localhost|127\.0\.0\.1/.test(p.url),
      );
      if (page) return page;
    } catch {
      // Runtime not listening yet.
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for WebView2 debugger at ${endpoint}\n${childLog}`);
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.ws = new globalThis.WebSocket(url);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

function signatureError(a64, b64) {
  const a = Buffer.from(a64, "base64");
  const b = Buffer.from(b64, "base64");
  if (a.length !== b.length) return { mae: Infinity, max: Infinity };
  let sum = 0;
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    sum += d;
    if (d > max) max = d;
  }
  return { mae: sum / a.length, max };
}

function signatureChroma(a64) {
  const rgb = Buffer.from(a64, "base64");
  let max = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    max = Math.max(
      max,
      Math.abs(rgb[i] - rgb[i + 1]),
      Math.abs(rgb[i] - rgb[i + 2]),
      Math.abs(rgb[i + 1] - rgb[i + 2]),
    );
  }
  return max;
}

/**
 * The dock's REPORT-ONLY overflow diagnostic, flattened into lines a human
 * reads rather than a JSON blob nobody opens.
 *
 * Deliberately not a failure: turning it into an assertion is BACKLOG Q8, an
 * owner decision, because it could light up pre-existing failures app-wide.
 * "Not asserted" is not "not printed", though, and the two are exactly what
 * this run used to confuse — the summary said `dock layout clean on 8 pages`
 * whatever this array held, which is the sentence that lets a real overflow be
 * waved through. Every caller below prints these lines, including the
 * baseline-update path, so no run can quietly swallow one.
 */
function dockOverflowLines(dock) {
  const lines = [];
  for (const end of ["narrow", "wide"]) {
    const leg = dock?.[end];
    for (const page of leg?.pages ?? []) {
      const at = `${end} ${leg.dockWidth}px / ${page.page}`;
      if (page.scrollerOverflowPx > 0) {
        lines.push(
          `  ${at}: .panel-scroll grew ${page.scrollerOverflowPx}px of HORIZONTAL ` +
            `scroll range — the dock is not supposed to scroll sideways at all`,
        );
      }
      for (const entry of page.overflow ?? []) {
        lines.push(`  ${at}: ${entry.el} +${entry.px}px  ${JSON.stringify(entry.text ?? "")}`);
      }
    }
  }
  return lines;
}

function printDockOverflow(dock) {
  const lines = dockOverflowLines(dock);
  if (!lines.length) {
    console.log("dock overflow diagnostic: nothing overflowed at either dock end");
    return 0;
  }
  console.log(
    `DOCK OVERFLOW: ${lines.length} REPORT-ONLY finding(s) — not asserted ` +
      `(BACKLOG Q8), and NOT "clean". Each line is a defect to fix or to file:`,
  );
  for (const line of lines) console.log(line);
  return lines.length;
}

function assertRuntime(matrix) {
  const failures = [];
  if (Object.keys(matrix.compileErrors).length) {
    failures.push(`WGSL compile errors: ${JSON.stringify(matrix.compileErrors)}`);
  }
  if (matrix.gpuErrors !== 0) failures.push(`uncaptured WebGPU errors: ${matrix.gpuErrors}`);
  // F4: the param-extreme cases are the one family where a black frame is a
  // legitimate result — "brightness at min" and "count at min" are supposed
  // to render nothing — so they are counted and printed instead of failed.
  // Read the list: a mode that goes black at an edge is not automatically a
  // defect, but it is always worth knowing which ones do.
  const blackExtremes = [];
  for (const entry of matrix.cases) {
    if (entry.litFraction === 0 && entry.meanLuma === 0) {
      if (entry.id.includes("/extreme/")) blackExtremes.push(entry.id);
      else failures.push(`${entry.id}: fully black frame`);
    }
    if (
      (entry.id.endsWith("/color/grayscale") || entry.id.endsWith("/color/bright-grayscale")) &&
      signatureChroma(entry.signature) > 1
    ) {
      failures.push(`${entry.id}: saturation 0 left visible chroma`);
    }
  }
  const spectrum = matrix.spectrumSmoke;
  if (!spectrum?.passed) {
    failures.push(`analyzer-quality spectrum smoke failed: ${JSON.stringify(spectrum)}`);
  }
  // D16: the Modulation page's clipping audit, at both ends of the dock's
  // range. Not a pixel assertion — the hashes above cannot see the panel at
  // all — so it is reported separately and read as a layout gate.
  const modulation = matrix.modulationSmoke;
  if (!modulation?.passed) {
    failures.push(`modulation page layout audit failed: ${JSON.stringify(modulation)}`);
  }
  // H4: row geometry plus the eight-page clipping audit at both ends of the
  // dock's range. Not a pixel assertion — the hashes cannot see the panel —
  // and it is the only gate in the tree that can look at a rendered row at
  // all. Its `overflow` field is diagnostic, deliberately not asserted
  // (BACKLOG Q8): read it, never wave it through.
  const dock = matrix.dockLayoutSmoke;
  // Printed BEFORE the throw below, and before the --update branch: a run that
  // fails on a hash somewhere else, or one that re-blesses the baseline, must
  // still surface the dock's overflow findings. The JSON in the failure message
  // technically contains them and has never once been read.
  const dockOverflow = printDockOverflow(dock);
  if (!dock?.passed) failures.push(`dock layout audit failed: ${JSON.stringify(dock)}`);
  if (failures.length) throw new Error(failures.join("\n"));
  return { blackExtremes, dockOverflow };
}

async function compare(matrix) {
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  if (baseline.width !== matrix.width || baseline.height !== matrix.height) {
    throw new Error(
      `baseline size ${baseline.width}x${baseline.height}, runtime ${matrix.width}x${matrix.height}`,
    );
  }
  const expected = new Map(baseline.cases.map((entry) => [entry.id, entry]));
  const actual = new Map(matrix.cases.map((entry) => [entry.id, entry]));
  const missing = [...expected.keys()].filter((id) => !actual.has(id));
  const added = [...actual.keys()].filter((id) => !expected.has(id));
  if (missing.length || added.length) {
    throw new Error(`matrix case drift; missing=${missing.join(",")} added=${added.join(",")}`);
  }

  const failures = [];
  let rawHashChanges = 0;
  for (const [id, got] of actual) {
    const want = expected.get(id);
    const sig = signatureError(got.signature, want.signature);
    const lumaDelta = Math.abs(got.meanLuma - want.meanLuma);
    const litDelta = Math.abs(got.litFraction - want.litFraction);
    if (got.hash !== want.hash) rawHashChanges++;
    if (sig.mae > 8 || lumaDelta > 8 || litDelta > 0.12) {
      failures.push(
        `${id}: rgbMAE=${sig.mae.toFixed(2)} max=${sig.max} ` +
          `lumaDelta=${lumaDelta.toFixed(2)} litDelta=${litDelta.toFixed(3)}`,
      );
    }
  }
  if (failures.length) throw new Error(`pixel baseline mismatch\n${failures.join("\n")}`);
  return rawHashChanges;
}

async function evaluateMatrix() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const page = await waitForPage();
    const cdp = new CdpClient(page.webSocketDebuggerUrl);
    socket = cdp;
    try {
      await cdp.open();
      await cdp.send("Runtime.enable");
      const evaluated = await cdp.send("Runtime.evaluate", {
        // NO BACKTICKS ANYWHERE BELOW, comments included. Everything from here
        // to the closing brace is one template literal, so a single backtick
        // ends the expression early and the harness dies with a SyntaxError
        // whose caret points at a comment. Quote identifiers with "double
        // quotes" when a comment needs to name one.
        expression: `(async () => {
          const deadline = Date.now() + 60000;
          while (typeof window.__runGpuMatrix !== "function") {
            if (Date.now() > deadline) throw new Error("__runGpuMatrix hook unavailable");
            await new Promise(r => setTimeout(r, 100));
          }
          const matrix = await window.__runGpuMatrix(192, 108);
          const store = window.__store;
          const analyzer = window.__analyzer;
          const engine = window.__engine;
          const originalSync = { ...store.getState().sync };
          const originalPanel = store.getState().showPanel;
          // The dock's own prefs. Both legs below navigate the rail and the
          // Modulation leg resizes the dock, and both of those PERSIST — so
          // an interrupted run must not leave the app booting on Sync at
          // 760px forever.
          const originalPage = window.__prefs.get().visualsPage;
          const originalWidth = window.__prefs.get().visualsWidth;
          const settle = () =>
            new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          let spectrumSmoke;
          let modulationSmoke;
          // Declared out here with the other two, NOT inside the leg it
          // belongs to: the return below sits AFTER the outer finally, so a
          // binding scoped to that try block is a ReferenceError every run.
          let dockLayoutSmoke;
          try {
            store.getState().setSync({
              ...originalSync,
              freqMin: 30,
              freqMax: 300,
              spectrumResolution: "precise",
              spectrumAxis: "linear",
              spectrumSampling: "measured",
            });
            store.getState().setShowPanel(true);
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

            // P-1 replaced the tab bar AND the per-section collapse with one
            // rail, so reaching Sync is now a single click instead of two.
            // What this leg verifies is unchanged: that the Sync controls
            // render, and that the measured-bars readout below reflects the
            // real display FFT.
            const syncRail = [...document.querySelectorAll(".rail-item")]
              .find(button => button.dataset.section === "sync");
            if (!syncRail) throw new Error("Visuals rail: no Sync destination");
            syncRail.click();
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

            const panel = document.querySelector(".params-panel");
            const text = panel?.textContent ?? "";
            const axis = panel?.querySelector('[aria-label="Spectrum frequency axis"]');
            const activeAxis = axis?.querySelector('[aria-pressed="true"]')?.textContent?.trim();
            const axisLocked = axis
              ? [...axis.querySelectorAll("button")].every(button => button.disabled)
              : false;
            const displayBins = analyzer.features.bins.length;
            const expectedFft = Math.min(32768, engine.analyser.fftSize * 4);
            const audit = window.__auditUI(".params-panel");
            spectrumSmoke = {
              passed:
                engine.analyser.fftSize !== engine.displayAnalyser.fftSize &&
                engine.displayAnalyser.fftSize === expectedFft &&
                displayBins > 0 && displayBins <= 96 &&
                text.includes(displayBins + " measured bars, no interpolation") &&
                activeAxis === "Linear" && axisLocked &&
                Array.isArray(audit) && audit.length === 0,
              detectorFft: engine.analyser.fftSize,
              displayFft: engine.displayAnalyser.fftSize,
              displayBins,
              activeAxis,
              axisLocked,
              audit,
            };

            // ---- Modulation leg (P-1 stage 3). ------------------------
            // The showpiece of 2.83.0 and, without this, the only dock page
            // with zero layout coverage in any gate: the hash matrix above
            // renders into an OffscreenCanvas and is awaited before the
            // panel is even shown, so it is structurally incapable of
            // noticing a card that clips. __auditUI is that coverage, and it
            // runs at BOTH ends of the dock's range — 380px is where the
            // measured content column is 174px (the width the card layout
            // was designed against) and 760px is where a fixed-width child
            // would leave a hole.
            const seeded = [];
            try {
              const modRail = [...document.querySelectorAll(".rail-item")]
                .find(button => button.dataset.section === "modulation");
              if (!modRail) throw new Error("Visuals rail: no Modulation destination");
              modRail.click();
              await settle();
              // A dev session boots with whatever routes localStorage holds,
              // so everything below is a DELTA against what was already here.
              const cardsBefore = document.querySelectorAll(".mod-card").length;

              // Seeded from the page's OWN create picker, never a literal key
              // list: it enumerates exactly allParams+isModTarget for whatever
              // visual is active, so re-tiering a knob cannot rot this leg.
              // Sorted LONGEST LABEL FIRST on purpose — those are the clip
              // candidates the 174px column has to absorb.
              const create = document.querySelector(".mod-create");
              if (!create) throw new Error("Modulation page: no create picker");
              const options = [...create.querySelectorAll("option")]
                .filter(option => option.value && !option.disabled)
                .sort((a, b) => b.textContent.trim().length - a.textContent.trim().length)
                .map(option => option.value);
              const paramTargets = options.filter(v => !v.startsWith("post:")).slice(0, 3);
              const postTarget = options.find(v => v.startsWith("post:"));
              if (paramTargets.length < 3 || !postTarget) {
                throw new Error("Modulation page: create picker offered too little");
              }

              // Four cards over three distinct sources, so the "Driven by"
              // chip row is populated too. "Vocals (lyrics)" is the longest
              // source label in the registry.
              const add = (source, param) => {
                store.getState().addModRoute(source, param);
                const routes = store.getState().activeMods;
                const id = routes[routes.length - 1].id;
                seeded.push(id);
                return id;
              };
              add("kick", paramTargets[0]);
              const negative = add("vocal", paramTargets[1]);
              add("rms", paramTargets[2]);
              add("kick", postTarget);
              // A negative depth reverses the painted range (--start/--dir),
              // and a non-default shape prints the collapsed summary line.
              store.getState().updateModRoute(negative, {
                amount: -0.72,
                curve: "smooth",
                attack: 0.42,
                release: 3.5,
              });
              await settle();
              // …and one card's disclosure open, so the Segmented and the two
              // lag rows are measured rather than assumed.
              document.querySelector(".mod-card-toggle")?.click();
              await settle();

              // The dock's width is React state seeded from prefs, so writing
              // the pref cannot move it. The resize separator's KEYBOARD path
              // is the real one and it is exact at both ends: Home = 380 (the
              // floor), End = 760 (the ceiling).
              const handle = document.querySelector('[aria-label="Resize Visuals"]');
              if (!handle) throw new Error("Visuals dock: no resize separator");
              const press = async (key, shiftKey = false) => {
                handle.dispatchEvent(
                  new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }),
                );
                await settle();
              };
              const legAt = async key => {
                await press(key);
                const panel = document.querySelector(".params-panel");
                return {
                  // Reported, not asserted: the --visuals-w custom property
                  // is additionally clamped to 100vw minus 560px, so on a
                  // narrow display the ceiling leg genuinely cannot reach 760
                  // and a hard assertion would be a false failure about the
                  // SCREEN rather than about this page.
                  dockWidth: Math.round(panel.getBoundingClientRect().width),
                  audit: window.__auditUI(".params-panel"),
                };
              };

              const narrow = await legAt("Home");
              const wide = await legAt("End");
              const cards = document.querySelectorAll(".mod-card").length;
              const chips = document.querySelectorAll(".mod-source-chip").length;
              const meters = document.querySelectorAll(
                ".mod-meter-fill, .mod-swing-arm",
              ).length;

              modulationSmoke = {
                // The three counts are the anti-vacuity clause: an audit over
                // a page that rendered nothing is empty for the wrong reason.
                // 4 new cards, at least the 3 sources they introduced, and at
                // least one meter per chip plus one arm per card.
                passed:
                  cards === cardsBefore + 4 && chips >= 3 && meters >= 7 &&
                  Array.isArray(narrow.audit) && narrow.audit.length === 0 &&
                  Array.isArray(wide.audit) && wide.audit.length === 0,
                cardsBefore,
                cards,
                chips,
                meters,
                narrow,
                wide,
              };
            } finally {
              for (const id of seeded) store.getState().removeModRoute(id);
              // Walk the live width back toward where it started. Only the
              // 16/48px steps are reachable by keyboard, so the exact value
              // is restored through prefs immediately after — the next boot
              // reads that, not the in-session state.
              const handle = document.querySelector('[aria-label="Resize Visuals"]');
              if (handle) {
                handle.dispatchEvent(
                  new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }),
                );
                const steps = Math.round((originalWidth - 380) / 16);
                for (let i = 0; i < steps; i++) {
                  handle.dispatchEvent(
                    new KeyboardEvent("keydown", {
                      key: "ArrowLeft",
                      bubbles: true,
                      cancelable: true,
                    }),
                  );
                }
              }
            }

            // ---- Dock layout leg (H4, v2.84.0). -----------------------
            // The row-geometry gate, and the only place it CAN live. The
            // hash matrix above renders into an OffscreenCanvas and is
            // awaited before the panel is ever shown, so it is structurally
            // incapable of seeing a row; jsdom has no layout, so vitest
            // cannot see one either. Between them that left the dock's row
            // geometry uncheckable, and a slider rendering at 0px width
            // shipped for three releases with every gate green.
            //
            // radial-burst DELIBERATELY. Its "Angle" is a CURATED param —
            // declared in the preset's own params array, not behind a
            // group's expert disclosure — so the row whose track measured
            // 0px at the 380px floor, and reported a real text-clip of the
            // range thumb, is on screen with nothing opened. A baseline
            // taken on a preset that declares no angle param records a
            // FALSE GREEN, and that is exactly how this survived v2.81-2.83.
            const originalPreset = store.getState().presetId;
            const originalCollapsed = [...window.__prefs.get().collapsedSections];
            try {
              store.getState().switchPreset("radial-burst");
              await settle();

              // The dock's width is React state seeded from prefs once at
              // mount, so writing the pref cannot move it. The separator's
              // KEYBOARD path is the real one and it is exact at both ends:
              // Home = 380 (the floor), End = 760 (the ceiling).
              const dockHandle = document.querySelector('[aria-label="Resize Visuals"]');
              if (!dockHandle) throw new Error("Visuals dock: no resize separator");
              const pressWidth = async key => {
                dockHandle.dispatchEvent(
                  new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
                );
                await settle();
              };

              // Frozen ids, not labels — same contract the Sync and
              // Modulation legs select on (ParamsPanel data-section).
              const PAGES = [
                "mode",
                "motion",
                "themes",
                "sync",
                "modulation",
                "scene",
                "text",
                "live",
              ];
              const goToPage = async id => {
                const rail = [...document.querySelectorAll(".rail-item")]
                  .find(button => button.dataset.section === id);
                if (!rail) throw new Error("Visuals rail: no " + id + " destination");
                rail.click();
                await settle();
              };

              // Group disclosures PERSIST (prefs.collapsedSections) and are
              // seeded into React state at mount, so a dev session that left
              // "Motion" collapsed would hide the angle row and turn the
              // anti-vacuity clause below into a false FAILURE about this
              // machine's localStorage. Opening them restores the SHIPPED
              // DEFAULT (collapsedSections is [] out of the box); it does
              // not open any group's expert tier, so "curated, no disclosure
              // opened" still describes exactly what the angle row is.
              // Re-queried each pass because React re-renders between the
              // synchronous clicks, and bounded so a styling change that
              // stops .open landing cannot spin here.
              await goToPage("mode");
              let openedGroups = 0;
              for (let i = 0; i < 24; i++) {
                const shut = [...document.querySelectorAll(".param-group > .group-head")]
                  .find(head => !head.classList.contains("open") && !head.disabled);
                if (!shut) break;
                shut.click();
                openedGroups++;
                await settle();
              }

              const widthLeg = async key => {
                await pressWidth(key);
                const pages = [];
                for (const id of PAGES) {
                  await goToPage(id);
                  const scroller = document.querySelector(".panel-scroll");
                  const context = document.querySelector(".visuals-context");
                  if (!scroller || !context) {
                    throw new Error("Visuals page: no scroller/context on " + id);
                  }
                  pages.push({
                    page: id,
                    audit: window.__auditUI(".params-panel"),
                    header: Math.round(context.getBoundingClientRect().height),
                    // Reported so an empty AUDIT can be told apart from an
                    // audit of an empty PAGE. Pages legitimately differ:
                    // Motion is a single explanatory paragraph whenever the
                    // active visual declares no rotation/pulse/detail
                    // masters, and Live is a short list until MIDI is bound.
                    // That is why this is a diagnostic and the anti-vacuity
                    // assertion is anchored on the Mode page instead.
                    rows: scroller.querySelectorAll(".row, .field, .panel-section").length,
                    // REPORTED, NOT ASSERTED — owner decision (BACKLOG Q8).
                    // Both of __auditUI's blind spots are FIXED as of H16 (see
                    // scrollsOnAxis / rendersOwnText in src/devHooks.ts), so
                    // the audit field above can finally fire inside the dock.
                    // This diagnostic stays anyway, because it answers a
                    // different question: the auditor reports the ELEMENT that
                    // pokes out, and this reports the BOX that swallowed it. A
                    // non-empty entry here is a finding to fix or file, NEVER
                    // something to wave through as "auditor clean" — and the
                    // summary printed at the end of the run now says so out
                    // loud instead of reporting the word "clean" regardless.
                    //
                    // The symptom the auditor structurally cannot name: a
                    // VERTICAL scroller that has grown HORIZONTAL scroll range
                    // is the scrollbar the dock is never supposed to have, and
                    // it is one honest number per page.
                    scrollerOverflowPx: scroller.scrollWidth - scroller.clientWidth,
                    overflow: [
                      ...scroller.querySelectorAll(
                        ".row, .field, .mod-card, .layer-editor, .layer-editor-grid," +
                          " .param-group-body",
                      ),
                    ]
                      .filter(el => el.scrollWidth > el.clientWidth + 1)
                      .map(el => ({
                        el: String(el.className),
                        px: el.scrollWidth - el.clientWidth,
                        // Which row, not just which shape. "row param-row" is
                        // 40 rows deep on the Mode page and the class list
                        // alone cannot tell them apart; the same 25-character
                        // slice __auditUI uses to name an element makes a
                        // finding something you can go and look at.
                        text: (el.textContent ?? "").trim().slice(0, 25),
                      })),
                  });
                }
                await goToPage("mode");
                const panel = document.querySelector(".params-panel");
                const page = document.querySelector(".visuals-page");
                const scroller = document.querySelector(".panel-scroll");
                if (!panel || !page || !scroller) {
                  throw new Error("Visuals dock: no panel/page/scroller to measure");
                }
                const widths = sel =>
                  [...document.querySelectorAll(sel)].map(el =>
                    Math.round(el.getBoundingClientRect().width),
                  );
                return {
                  // Reported, not asserted, for the reason the Modulation
                  // leg reports its own: --visuals-w is additionally clamped
                  // to 100vw minus 560px, so on a narrow display the wide leg
                  // genuinely cannot reach 760 and a hard 760 assertion would
                  // be a false failure about the SCREEN, not about the dock.
                  dockWidth: Math.round(panel.getBoundingClientRect().width),
                  container: Math.round(page.getBoundingClientRect().width),
                  labelColumn: getComputedStyle(scroller)
                    .getPropertyValue("--row-label-w")
                    .trim(),
                  angleSliders: widths(".panel-scroll .angle-row .slider"),
                  paramSliders: widths(".panel-scroll .param-row .slider"),
                  pages,
                };
              };

              const narrow = await widthLeg("Home");
              const wide = await widthLeg("End");
              const seen = [...narrow.pages, ...wide.pages];
              dockLayoutSmoke = {
                passed:
                  // ANTI-VACUITY, and first on purpose: an audit over a page
                  // that rendered nothing is empty for the WRONG REASON, and
                  // every clause after this one is meaningless if the sweep
                  // never saw the geometry it claims to gate. radial-burst
                  // puts one angle row and well over five param rows on the
                  // Mode page with no expert tier opened, at BOTH ends of the
                  // range — the wide half matters too, because a query that
                  // stacked or hid a row would otherwise read as clean.
                  narrow.angleSliders.length >= 1 &&
                  wide.angleSliders.length >= 1 &&
                  narrow.paramSliders.length >= 5 &&
                  wide.paramSliders.length >= 5 &&
                  seen.every(p => Array.isArray(p.audit) && p.audit.length === 0) &&
                  // The defect this release closes. At the floor the angle
                  // track was 0px; 80px is where a 13px thumb finally has
                  // more travel than thumb.
                  Math.min(...narrow.angleSliders) >= 80 &&
                  Math.min(...wide.angleSliders) >= 80 &&
                  Math.min(...wide.paramSliders) >= 80 &&
                  Math.min(...narrow.paramSliders) > 0 &&
                  // The container contract actually FIRED, and only above the
                  // step. A no-op query — the token declared on the query
                  // container itself, or a selector whose specificity the
                  // base rule beats — still passes the narrow half, so the
                  // wide half is the one that catches it.
                  narrow.labelColumn === "76px" &&
                  wide.labelColumn === "104px" &&
                  // The precondition any future context-header work must
                  // clear. __auditUI is blind to a wrapped .section-title
                  // (it wraps, it does not clip, and the auditor only sees
                  // clipping), so height is the only signal that a fourth
                  // leaf pushed the header onto two lines. One line measures
                  // ~26px: 12.5px type plus 2+8 padding and a 1px rule.
                  seen.every(p => p.header <= 36),
                openedGroups,
                narrow,
                wide,
              };
            } finally {
              // switchPreset records an undo entry and writes localStorage;
              // switching back reverses both, exactly as the other legs undo
              // what they mutate. The group disclosures go back through prefs
              // for the same reason the dock width does — the next boot reads
              // the persisted set, not this session's React state.
              store.getState().switchPreset(originalPreset);
              window.__prefs.set({ collapsedSections: originalCollapsed });
              // …and walk the LIVE width back off the 760 ceiling this leg
              // left it on, the same way the Modulation leg does: the outer
              // finally restores the pref, but an --attach run keeps looking
              // at the window afterwards.
              const dockHandleBack = document.querySelector('[aria-label="Resize Visuals"]');
              if (dockHandleBack) {
                dockHandleBack.dispatchEvent(
                  new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }),
                );
                const backSteps = Math.round((originalWidth - 380) / 16);
                for (let i = 0; i < backSteps; i++) {
                  dockHandleBack.dispatchEvent(
                    new KeyboardEvent("keydown", {
                      key: "ArrowLeft",
                      bubbles: true,
                      cancelable: true,
                    }),
                  );
                }
              }
            }
          } finally {
            store.getState().setSync(originalSync);
            store.getState().setShowPanel(originalPanel);
            window.__prefs.set({ visualsPage: originalPage, visualsWidth: originalWidth });
          }
          return { ...matrix, spectrumSmoke, modulationSmoke, dockLayoutSmoke };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (evaluated.exceptionDetails) {
        throw new Error(
          evaluated.exceptionDetails.exception?.description ?? "GPU matrix evaluation failed",
        );
      }
      return evaluated.result.value;
    } catch (error) {
      cdp.close();
      socket = null;
      if (attempt === 3 || !/context was destroyed|websocket/i.test(String(error))) throw error;
      await sleep(1000);
    }
  }
  throw new Error("GPU matrix evaluation did not return");
}

try {
  if (!attach) {
    const existingArgs = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? "";
    const command =
      process.platform === "win32"
        ? {
            file: process.env.ComSpec ?? "cmd.exe",
            args: ["/d", "/s", "/c", "npm run tauri -- dev --no-watch"],
          }
        : { file: "npm", args: ["run", "tauri", "--", "dev", "--no-watch"] };
    child = spawn(command.file, command.args, {
      cwd: root,
      windowsHide: true,
      env: {
        ...process.env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
          `${existingArgs} --remote-debugging-port=${port}`.trim(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", keepLog);
    child.stderr.on("data", keepLog);
  }

  const matrix = await evaluateMatrix();
  const { blackExtremes, dockOverflow } = assertRuntime(matrix);

  if (update) {
    const baseline = {
      version: 1,
      width: matrix.width,
      height: matrix.height,
      cases: matrix.cases,
    };
    await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`GPU baseline updated: ${matrix.cases.length} cases`);
  } else {
    const rawHashChanges = await compare(matrix);
    console.log(
      `GPU matrix passed: ${matrix.cases.length} cases, 0 compile errors, ` +
        `0 GPU errors, ${rawHashChanges} tolerance-only raw hash changes; ` +
        `spectrum smoke ${matrix.spectrumSmoke.displayBins} measured bins; ` +
        `modulation audit clean at ${matrix.modulationSmoke.narrow.dockWidth}px and ` +
        `${matrix.modulationSmoke.wide.dockWidth}px; ` +
        // "audit clean", NOT "clean": the audit is one of two things this leg
        // looks at, and the other one is report-only. Saying "clean" while the
        // overflow diagnostic held entries is how a shipped defect reads as a
        // pass, so the count rides along in the same sentence.
        `dock layout audit clean on 8 pages at ${matrix.dockLayoutSmoke.narrow.dockWidth}px ` +
        `and ${matrix.dockLayoutSmoke.wide.dockWidth}px` +
        (dockOverflow ? ` — SEE THE ${dockOverflow} DOCK OVERFLOW FINDING(S) ABOVE` : ""),
    );
  }
  console.log(
    blackExtremes.length
      ? `param extremes rendering black (diagnostic, not a failure): ${blackExtremes.join(", ")}`
      : "param extremes: every edge rendered something",
  );
} finally {
  socket?.close();
  if (child?.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  }
}
