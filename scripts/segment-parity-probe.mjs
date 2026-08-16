/**
 * ONE-OFF device probe for E2-R1 + option (f). Not a gate; not in GATES.md.
 *
 * WHAT IT REPORTS: the per-frame content hashes of a REAL canvas-loop (segment)
 * export through the real GPU, plus whether two identical runs agree.
 *
 * WHY IT IS NOT A PARITY TEST. The obvious experiment — compare a segment
 * export against the same window of a full-track export — does NOT isolate the
 * time origin, and an earlier version of this file wrongly tried it. Loop mode
 * crossfades the tail of the AUDIO into its head before the analyzer ever runs
 * (exportCore.ts:653-669), so every feature in the clip differs from a straight
 * walk whatever the time origin is. The two are simply not comparable, and the
 * uniform mismatch that produced was an artefact of the comparison, not a
 * finding about the fix.
 *
 * The decisive comparison is the same export on two BUILDS: run it on the
 * current tree, then again with the offset in exportCore's `renderAt` mutated
 * away, and diff the digests. Different digests prove the change reaches real
 * exported pixels and is not a no-op. Drive that from the shell — this script
 * only prints the digest.
 *
 * Port base 10380: registered in lib/app.mjs's map. (Originally 10220,
 * "clear of the map" — until p11-smoke.mjs and deepcolor-verify.mjs each
 * independently claimed the same slot; all three now own distinct bases.)
 * Preset and start are overridable so the same probe can serve BACKLOG E3a,
 * whose experiment is specifically about Particle Flow.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { spawnApp, attachWithRecovery, waitHooks, killTree } from "./lib/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FPS = 30;
const START = Number(process.env.PROBE_START ?? 8);
const DUR = 4;
const W = 160;
const H = 90;
/** tunnel-rings travels on time — the strongest `u.time` signal in the roster. */
const PRESET = process.env.PROBE_PRESET ?? "tunnel-rings";

/** A synthetic 20s WAV, so the probe owns its own track and its own clock. */
function makeWav(seconds = 20, rate = 44100) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.exp(-8 * (t % 0.5)); // 2 Hz pulse train — real onsets to find
    const v = Math.sin(2 * Math.PI * 60 * t) * env * 0.8;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
  }
  return buf;
}

const wav = makeWav();
const server = createServer((_req, res) => {
  // CORS: the page origin is localhost:1420 and this server is 127.0.0.1:N, so
  // the fetch is cross-origin. av1-e2e sets the same header for the same reason.
  res.writeHead(200, {
    "Content-Type": "audio/wav",
    "Content-Length": wav.length,
    "Access-Control-Allow-Origin": "*",
  });
  res.end(wav);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const wavPort = server.address().port;

const app = spawnApp({ root, portBase: 10380, profileName: "segment-parity" });
let cdp;
// Deliberately uninitialised: the only path that sets it is the one that
// actually reached a verdict. Anything else — a throw through the finally,
// an early exit — leaves it undefined and exits non-zero below, so "the probe
// did not finish" can never read as a pass.
let failed;
try {
  cdp = await attachWithRecovery(app, (c) =>
    waitHooks(c, ["__store", "__loadFile", "__runExport"], { timeoutMs: 120_000 }),
  );
  // No Tauri warmup: this probe uses only the in-memory PNG lane (frames are
  // hashed, never written), so it needs no IPC — and a bare specifier cannot
  // resolve in a CDP eval outside Vite's module graph anyway.
  await cdp.eval(
    `window.__loadFile(${JSON.stringify(`http://127.0.0.1:${wavPort}/probe.wav`)}, "probe.wav")`,
  );
  await cdp.eval(`window.__store.getState().switchPreset(${JSON.stringify(PRESET)})`);
  // Verify rather than assume: presetById falls back to presets[0] on an
  // unknown id, so a typo silently audits the wrong shader. It did, once.
  const got = await cdp.eval(`window.__store.getState().presetId`);
  if (got !== PRESET) throw new Error(`preset switch did not take: wanted ${PRESET}, got ${got}`);
  console.log(`SETUP: preset=${got} start=${START}s dur=${DUR}s ${W}x${H}@${FPS}`);

  const run = () =>
    cdp.eval(
      `window.__runExport(${JSON.stringify({
        width: W,
        height: H,
        fps: FPS,
        png: true,
        canvasLoop: { start: START, duration: DUR },
      })})`,
    );

  // THREE runs, because two cannot tell the two hypotheses apart. If the first
  // export in a process differs from later ones but 2 and 3 agree, that is a
  // warm-up effect and is deterministic given position; if 2 and 3 also differ,
  // it is genuine nondeterminism and a far more serious thing.
  // Report the analysis state around each run. `analyzeTrack` is ASYNC and
  // `beatGrid` is null until it resolves, so an export fired straight after a
  // load can run with bpm 0 and no grid while later ones have the real thing —
  // which would make "the first export differs" a RACE, not a warm-up.
  const state = async (label) => {
    const v = await cdp.eval(
      `(() => { const s = window.__store.getState();
        return { analyzing: s.analyzing, bpm: s.beatGrid ? s.beatGrid.bpm : null,
                 beats: s.beatGrid ? s.beatGrid.beatTimes.length : 0,
                 sections: s.sections.length }; })()`,
    );
    console.log(`STATE(${label}): ${JSON.stringify(v)}`);
    return v;
  };

  if (process.env.PROBE_WAIT_ANALYSIS === "1") {
    console.log("waiting for track analysis to settle before run 1…");
    await cdp.eval(
      `new Promise((res, rej) => { const t0 = Date.now();
        const tick = () => { const s = window.__store.getState();
          if (!s.analyzing && s.beatGrid) return res(true);
          if (Date.now() - t0 > 60000) return rej(new Error("analysis did not settle"));
          setTimeout(tick, 100); }; tick(); })`,
    );
  }

  await state("before run 1");
  console.log("loop export, run 1 (first in this process)…");
  const a = await run();
  await state("after run 1");
  console.log("loop export, run 2…");
  const b = await run();
  console.log("loop export, run 3…");
  const c = await run();

  const A = a.pngHashes ?? [];
  const B = b.pngHashes ?? [];
  const C = c.pngHashes ?? [];
  if (!A.length || !B.length || !C.length) {
    throw new Error("no per-frame hashes returned — nothing to judge");
  }
  const diff = (x, y) => x.reduce((n, h, i) => n + (h === y[i] ? 0 : 1), 0);

  console.log(`FRAMES: ${A.length}`);
  console.log(`DIGEST(run1): ${A.slice(0, 6).join(" ")} ... ${A[A.length - 1]}`);
  console.log(`RUN1 vs RUN2: ${diff(A, B)}/${A.length} frames differ`);
  console.log(`RUN2 vs RUN3: ${diff(B, C)}/${B.length} frames differ  <- the meaningful one`);
  // Only run2-vs-run3 is a determinism claim. run1 differing is the warm-up
  // question, reported but not failed, because it is a separate finding.
  failed = diff(B, C) !== 0 || A.length < 10;
  console.log(
    failed
      ? "PROBE: repeated exports are NOT reproducible — findings above"
      : "PROBE OK — repeated exports reproduce exactly",
  );
} finally {
  cdp?.close?.();
  killTree(app);
  server.close();
}
process.exit(failed === false ? 0 : 1);
