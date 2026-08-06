// End-to-end gate for the Shadertoy import (FEAT-001), on the pattern of
// loopback-smoke.mjs: launch the debug shell (which serves the Vite DEV
// frontend and exposes the diagnostic hooks), drive it over the WebView2
// devtools protocol, and exercise the REAL path — pasted GLSL → Rust/naga
// transpile → device compile check → registered preset → rendered frames →
// the export chokepoints — plus the diagnostic path and persistence.
//
//   npm run test:shadertoy:built     (requires: npm run dev running is NOT
//                                     needed — the debug exe serves devUrl,
//                                     but Vite must be up, same as loopback)
//
// Boot stays LOCAL (built-app smoke family); page-poll + CDP client come
// from scripts/lib (P-14-lite).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { Cdp } from "./lib/cdp.mjs";
import { debugExe, harnessPort, waitForPage, killTree } from "./lib/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = harnessPort(9800); // see the map in lib/app.mjs
let app;
let cdp;

async function evaluate(url) {
  cdp = new Cdp(url);
  await cdp.open();
  return cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const delay = ms => new Promise(r => setTimeout(r, ms));
      const deadline = Date.now() + 60000;
      while (!window.__store || !window.__engine || !window.__runExport) {
        if (Date.now() > deadline) throw new Error("dev hooks unavailable");
        await delay(100);
      }
      const store = window.__store;
      const s = () => store.getState();
      const failures = [];

      // Audio-reactive test shader: spectrum bars from iChannel0 row 0, a
      // waveform trace from row 1, animated tint from iTime — exercises the
      // uniform block, the audio texture and a texture call in a branch
      // (the uniformity-rewrite case).
      const GLSL = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "    vec2 uv = fragCoord / iResolution.xy;",
        "    float fft = texture(iChannel0, vec2(uv.x, 0.25)).x;",
        "    float wav = texture(iChannel0, vec2(uv.x, 0.75)).x;",
        "    float bar = step(uv.y, fft);",
        "    float trace = 1.0 - smoothstep(0.0, 0.02, abs(uv.y - wav));",
        "    vec3 col = vec3(0.06, 0.05, 0.1);",
        "    if (uv.x > 0.02) { col += bar * vec3(0.2 + 0.3 * sin(iTime), 0.9, 0.5); }",
        "    col += trace * vec3(1.0, 0.9, 0.3);",
        "    fragColor = vec4(col, 1.0);",
        "}",
      ].join("\\n");

      // 0) A previous crashed run may have left its def behind — the smoke
      //    must be self-cleaning or name lookups hit the stale copy.
      for (const d of [...s().customDefs]) {
        if (d.name === "Smoke Import") s().deleteCustomPreset(d.id);
      }

      // 1) Demo track (deterministic synth — same beats every run).
      await s().loadDemo("groove");
      await delay(1500);
      if (!window.__engine.audioBuffer) failures.push("demo track did not load");

      // 2) Happy-path import through the real action (Rust transpile +
      //    device compile + register + persist + switch).
      const errs = await s().importShadertoyGlsl(
        GLSL,
        { name: "Smoke Import", author: "beatform-e2e", license: "CC0 / public domain" },
        null,
      );
      if (errs.length) failures.push("import failed: " + errs.join(" | "));
      const def = s().customDefs.find((d) => d.id === s().presetId && d.name === "Smoke Import");
      if (!def) failures.push("active preset is not the imported def");
      if (def && !def.shadertoy) failures.push("def lost its shadertoy marker");

      // 3) Let it render live for a moment; count GPU validation errors.
      const gpuBefore = window.__gpuErrors ?? 0;
      await delay(1200);
      const gpuAfter = window.__gpuErrors ?? 0;
      if (gpuAfter > gpuBefore) failures.push("GPU errors during live render: " + (gpuAfter - gpuBefore));

      // 4) Determinism through the real export chokepoints: two PNG probes
      //    must produce IDENTICAL per-frame hashes, frames must animate
      //    (distinct hashes across the run) and must not be black (size).
      const probe = () => window.__runExport({ png: true, fps: 30, width: 320, height: 180,
        canvasLoop: { start: 0, duration: 2 } });
      const a = await probe();
      const b = await probe();
      const ha = JSON.stringify(a.pngHashes);
      if (ha !== JSON.stringify(b.pngHashes)) failures.push("export hashes differ between runs");
      if (new Set(a.pngHashes).size < 10) failures.push("frames barely animate: " + new Set(a.pngHashes).size + " distinct of " + a.pngHashes.length);
      const avg = a.pngBytes.reduce((x, y) => x + y, 0) / Math.max(1, a.pngBytes.length);
      if (avg < 3000) failures.push("frames look black (avg png " + Math.round(avg) + " B)");

      // 5a) v2.65.0: sampler-typed parameters SPECIALIZE now — a helper
      //     taking a channel must import and render.
      const specErrs = await s().importShadertoyGlsl(
        "float peak(sampler2D ch, float x) { return texture(ch, vec2(x, 0.25)).x; }\\nvoid mainImage(out vec4 c, in vec2 f) { vec2 uv = f / iResolution.xy; c = vec4(step(uv.y, peak(iChannel0, uv.x))); }",
        { name: "Smoke Specialized" },
        null,
      );
      if (specErrs.length) failures.push("sampler-param import failed: " + specErrs.join(" | "));
      const specDef = s().customDefs.find((d) => d.name === "Smoke Specialized");
      if (!specDef) failures.push("specialized def not registered");
      else s().deleteCustomPreset(specDef.id);

      // 5b) Diagnostic path: a channel that never resolves to a concrete
      //     iChannelN must fail with the plain-language message.
      const bad = await s().importShadertoyGlsl(
        "float peak(sampler2D ch, float x) { return texture(ch, vec2(x, 0.25)).x; }\\nfloat route(sampler2D a, sampler2D b, float x) { return peak(x > 0.5 ? a : b, x); }\\nvoid mainImage(out vec4 c, in vec2 f) { c = vec4(route(iChannel0, iChannel1, f.x)); }",
        { name: "Should Fail" },
        null,
      );
      if (!bad.length || !/iChannel0\\.\\.3|channel/.test(bad[0])) {
        failures.push("non-concrete channel error missing/wrong: " + JSON.stringify(bad));
      }
      if (s().customDefs.some((d) => d.name === "Should Fail")) {
        failures.push("failed import still registered a def");
      }

      // 6) Persistence: the saved library must carry the def WITH its GLSL.
      const stored = JSON.parse(localStorage.getItem("viz.customPresets.v1") ?? "[]");
      const persisted = stored.find((d) => d.name === "Smoke Import");
      if (!persisted) failures.push("imported def not persisted");
      else if (!persisted.shadertoy || !persisted.shadertoy.glsl) failures.push("persisted def lost GLSL source");

      // 7) Cleanup so the smoke leaves no state behind.
      if (def) s().deleteCustomPreset(def.id);

      return {
        failures,
        frames: a.pngFrames,
        distinct: new Set(a.pngHashes).size,
        avgPng: Math.round(avg),
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
}

try {
  const existingArgs = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? "";
  let log = "";
  const child = spawn(debugExe(root), [], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        `${existingArgs} --remote-debugging-port=${port}`.trim(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keep = (chunk) => (log = (log + chunk.toString()).slice(-20_000));
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  app = { child, port, log: () => log };

  // Attach can race the page's first load (visible under machine load, e.g.
  // a soak run in parallel) — same transient set loopback-smoke retries.
  let evaluated;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const target = await waitForPage(app);
      evaluated = await evaluate(target.webSocketDebuggerUrl);
      break;
    } catch (error) {
      cdp?.close();
      cdp = null;
      if (
        attempt === 3 ||
        !/context was destroyed|cannot find default execution context|websocket/i.test(
          String(error),
        )
      )
        throw error;
      await sleep(1000);
    }
  }
  if (!evaluated) throw new Error("shadertoy smoke evaluation did not return");
  if (evaluated.exceptionDetails) {
    throw new Error(evaluated.exceptionDetails.exception?.description ?? "shadertoy smoke failed");
  }
  const result = evaluated.result.value;
  if (result.failures.length) {
    throw new Error("Shadertoy smoke FAILED:\n" + result.failures.join("\n"));
  }
  console.log(
    `Shadertoy smoke passed: ${result.frames} frames, ` +
      `${result.distinct} distinct hashes, avg png ${result.avgPng} B, ` +
      `deterministic across two export runs.`,
  );
} finally {
  cdp?.close();
  killTree(app);
}
