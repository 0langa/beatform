// FEAT-004 phase-2+3 device end-to-end proof: the REAL local-lyrics flow
// through the debug shell (Vite dev frontend + Tauri IPC) over the WebView2
// devtools protocol. Covers, in order:
//   1. model manager against the LIVE beatform-app/models release:
//      real download -> mid-flight cancel -> Range-RESUME -> SHA-256 verify
//      (positive + negative verify); the phase-3 alignment pair installs
//      with the tier (downloaded from the release on the first run, then
//      cached on devstorage)
//   2. generation on a spike-corpus track through the store action: staged
//      audio -> sidecar -> LRC lands in store.lyrics via loadLyricsText,
//      timestamps strictly monotonic + PHASE 3: >=80% of lines carry word
//      timing, word spans sane/monotonic, store notice reports words timed
//      + PHASE 4: per-line confidence rode the result event into the lines
//   2b. correction-editor leg on the generated lines, all through __store:
//      text edit (word timings kept), line + word nudges, split/merge with
//      a full undo walk back to the pre-edit snapshot, then the round-trip
//      proof: editor LRC writer -> loadLyricsText -> identical lines incl.
//      word starts + trailing ends, and a byte-identical second write;
//      finally a REAL per-line re-align (sidecar --align-line) on the
//      edited text, words verified against the line + conf attached
//   3. cancel mid-isolation: phase returns to idle, no lyrics, no error
//   4. (unless --skip-madness) the owner's dense-mix test file
//      (Muse - Madness.flac, read in place from devstorage) through the
//      same store flow — the case the spike corpus could not cover — with
//      the same word assertions + an honest per-word sample report
//   5. (unless --skip-compare) direct-sidecar run on Madness (with the
//      alignment stage) + --dump-stem + a whisper pass on the ISOLATED
//      STEM, so the isolated-vs-mix transcripts can be compared honestly
//
//   node scripts/lyrics-e2e.mjs [--skip-madness] [--skip-compare] [--out=<dir>]
//
// Prereqs: Vite dev on 127.0.0.1:1420; debug build of the app (fetch scripts
// + build-lyrics-sidecar run); spike model cache on devstorage.
// Env: BEATFORM_EXE overrides the app path (e.g. a CARGO_TARGET_DIR build).
//
// Boot stays LOCAL (built-app smoke family — media server, model prep,
// BEATFORM_EXE override); attach + page-poll + CDP client come from
// scripts/lib (P-14-lite). The lib Cdp carries this harness's socket-death
// handling: a dying app must REJECT every in-flight eval.
import { spawn, spawnSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  debugExe,
  harnessPort,
  attachWithRecovery,
  waitHooks,
  checkDevServer,
  killTree,
} from "./lib/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2).filter((a) => !a.startsWith("--out=")));
const outDir =
  (process.argv.find((a) => a.startsWith("--out=")) ?? "").slice("--out=".length) ||
  // p3: phase-2's artifacts under feat004-p2-e2e are frozen ledger evidence —
  // word-timing runs land in their own directory.
  "F:/agent-devstorage/shared-cache/Beatform/artifacts/feat004-p3-e2e";
mkdirSync(outDir, { recursive: true });

const exe = process.env.BEATFORM_EXE ?? debugExe(root);
const CACHE = "F:/agent-devstorage/shared-cache/Beatform/cache/feat004-models";
const CORPUS = "F:/agent-devstorage/shared-cache/Beatform/artifacts/feat004-spike/corpus";
const MADNESS = "F:/agent-devstorage/claude-cache/beatform/bf-test/media/Muse - Madness.flac";
const E2E_MODELS = path.join(CACHE, "e2e-app-models");
const port = harnessPort(10060); // see the map in lib/app.mjs
let app;
let child;
let mediaServer;

function fatal(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

// --- prep: models dir the app will be pointed at ---------------------------
// ggml-small is pre-seeded from the spike cache (a 487 MB download has no
// place in a routine E2E); mdx-voc-ft is deliberately ABSENT so the download
// leg exercises the real release. The phase-3 alignment pair seeds from the
// devstorage cache when present — the FIRST run downloads it from the live
// release (exercising the multi-model download) and then caches it. exFAT
// has no links, so these are single copies, reused across runs.
const ALIGN_FILES = ["wav2vec2-base-960h-ctc-int8.onnx", "wav2vec2-base-960h-vocab.json"];
const ALIGN_CACHE = path.join(CACHE, "wav2vec2-int8");

function prepModelsDir() {
  mkdirSync(E2E_MODELS, { recursive: true });
  const small = path.join(E2E_MODELS, "ggml-small.bin");
  if (!existsSync(small)) {
    console.log("seeding ggml-small.bin into the e2e models dir (one-time copy)…");
    copyFileSync(path.join(CACHE, "ggml", "ggml-small.bin"), small);
  }
  // The download leg must start from nothing: no installed file, no .part.
  rmSync(path.join(E2E_MODELS, "UVR-MDX-NET-Voc_FT.onnx"), { force: true });
  rmSync(path.join(E2E_MODELS, "UVR-MDX-NET-Voc_FT.onnx.part"), { force: true });
  for (const f of ALIGN_FILES) {
    rmSync(path.join(E2E_MODELS, f), { force: true });
    rmSync(path.join(E2E_MODELS, `${f}.part`), { force: true });
    const cached = path.join(ALIGN_CACHE, f);
    if (existsSync(cached)) copyFileSync(cached, path.join(E2E_MODELS, f));
  }
}

/** After the download leg installed the alignment pair, keep a devstorage
 * copy so later runs skip the 122 MB fetch. */
function cacheAlignModels() {
  mkdirSync(ALIGN_CACHE, { recursive: true });
  for (const f of ALIGN_FILES) {
    const src = path.join(E2E_MODELS, f);
    const dst = path.join(ALIGN_CACHE, f);
    if (existsSync(src) && !existsSync(dst)) copyFileSync(src, dst);
  }
}

// --- phase-3 word-timing assertions ----------------------------------------
/** Assert the parsed store lines carry sane word timing: >=80% of lines
 * aligned, word texts reproduce the line text, starts monotonic within each
 * line, spans inside the (padded) line window. Returns the aligned count. */
function assertWordTiming(lines, label) {
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  let aligned = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const words = line.words;
    if (!words || words.length === 0) continue;
    aligned++;
    if (norm(words.map((w) => w.text).join(" ")) !== norm(line.text)) {
      fatal(`${label}: line ${i} word texts diverge from the line text`);
    }
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      if (!Number.isFinite(w.t)) fatal(`${label}: line ${i} word ${k} has no start`);
      if (k > 0 && w.t < words[k - 1].t) {
        fatal(`${label}: line ${i} word ${k} starts before its predecessor`);
      }
      if (w.end != null && w.end <= w.t)
        fatal(`${label}: line ${i} word ${k} ends before it starts`);
    }
    // Window sanity: the aligner pads ±0.4 s around the whisper line span and
    // whisper ends drift on held notes — 0.5/1.0 s tolerances, not slack for
    // wholesale misplacement.
    const nextT = i + 1 < lines.length ? lines[i + 1].t : Infinity;
    if (words[0].t < line.t - 0.5) {
      fatal(
        `${label}: line ${i} first word ${words[0].t.toFixed(2)} predates line ${line.t.toFixed(2)}`,
      );
    }
    const last = words[words.length - 1];
    const lastEnd = last.end ?? last.t;
    if (nextT !== Infinity && lastEnd > nextT + 1.0) {
      fatal(
        `${label}: line ${i} last word ends ${lastEnd.toFixed(2)}, next line starts ${nextT.toFixed(2)}`,
      );
    }
  }
  const frac = aligned / Math.max(1, lines.length);
  if (frac < 0.8) {
    fatal(`${label}: only ${aligned}/${lines.length} lines have word timing (<80%)`);
  }
  return aligned;
}

// --- phase-4 correction-editor leg -----------------------------------------
const LINES = `JSON.parse(JSON.stringify(window.__store.getState().lyrics))`;

/** Drive the correction editor through the real store actions on the lines
 * the generation leg just produced: edits, undo walk, writer round-trip,
 * and a REAL per-line re-align through the sidecar's --align-line mode. */
async function runEditorLeg(cdp) {
  const call = (expr) => cdp.eval(`window.__store.getState().${expr}; true`, false);
  const lines0 = await cdp.eval(LINES, false);

  // Phase-4 conf transport: the result event's lineDetails landed on the
  // parsed lines (session-side; the LRC itself carries none).
  const confLines = lines0.filter((l) => typeof l.conf === "number");
  if (confLines.length === 0) fatal("editor: no line carries aligner confidence");
  for (const l of confLines) {
    if (!(l.conf >= 0 && l.conf <= 1)) fatal(`editor: conf out of range: ${l.conf}`);
  }
  const withWordConf = lines0.filter(
    (l) => (l.words ?? []).every((w) => typeof w.conf === "number") && l.words?.length,
  );
  if (withWordConf.length === 0) fatal("editor: no per-word confidences arrived");
  console.log(
    `EDITOR: conf transport OK — ${confLines.length}/${lines0.length} lines carry confidence`,
  );

  const wi = lines0.findIndex((l) => l.words && l.words.length >= 3);
  if (wi < 0) fatal("editor: no word-timed line with >=3 words to edit");

  // -- text edit that keeps the token count: timings must survive ----------
  const tokens = lines0[wi].text.split(/\s+/);
  tokens[tokens.length - 1] = "edited";
  await call(`editLyricLineText(${wi}, ${JSON.stringify(tokens.join(" "))})`);
  let now = await cdp.eval(LINES, false);
  if (now[wi].text !== tokens.join(" ")) fatal(`editor: text edit did not land: ${now[wi].text}`);
  if (now[wi].words.length !== lines0[wi].words.length) {
    fatal("editor: same-count text edit must keep the word list");
  }
  for (let k = 0; k < now[wi].words.length; k++) {
    if (Math.abs(now[wi].words[k].t - lines0[wi].words[k].t) > 1e-9) {
      fatal(`editor: word ${k} start moved on a text edit`);
    }
  }
  if (now[wi].words.at(-1).conf !== undefined) fatal("editor: edited word kept its conf");

  // -- line nudge: start + words travel together ----------------------------
  await call(`nudgeLyricLine(${wi}, 0.05)`);
  now = await cdp.eval(LINES, false);
  if (Math.abs(now[wi].t - (lines0[wi].t + 0.05)) > 1e-6) {
    fatal(`editor: line nudge landed at ${now[wi].t}, expected ${lines0[wi].t + 0.05}`);
  }
  if (Math.abs(now[wi].words[0].t - (lines0[wi].words[0].t + 0.05)) > 1e-6) {
    fatal("editor: line nudge did not move its words");
  }

  // -- word ops -------------------------------------------------------------
  const w1Before = now[wi].words[1].t;
  await call(`nudgeLyricWord(${wi}, 1, 0.02)`);
  await call(`editLyricWord(${wi}, 0, "yo")`);
  now = await cdp.eval(LINES, false);
  if (Math.abs(now[wi].words[1].t - (w1Before + 0.02)) > 1e-6) {
    fatal("editor: word nudge did not move the word start");
  }
  if (!now[wi].text.startsWith("yo ")) fatal(`editor: word edit must re-derive the line text`);

  // -- split + merge, then a full undo walk back ----------------------------
  const preStructural = await cdp.eval(`JSON.stringify(window.__store.getState().lyrics)`, false);
  const preLen = now.length;
  await call(`splitLyricLine(${wi}, ${now[wi].text.indexOf(" ") + 1})`);
  now = await cdp.eval(LINES, false);
  if (now.length !== preLen + 1) fatal("editor: split did not add a line");
  if (now[wi].text !== "yo") fatal(`editor: split first half wrong: ${now[wi].text}`);
  await call(`mergeLyricLineWithNext(${wi})`);
  now = await cdp.eval(LINES, false);
  if (now.length !== preLen) fatal("editor: merge did not remove a line");
  await call("undoLyricsEdit()");
  await call("undoLyricsEdit()");
  const walked = await cdp.eval(`JSON.stringify(window.__store.getState().lyrics)`, false);
  if (walked !== preStructural) fatal("editor: undo walk did not restore the pre-split state");
  const depths = await cdp.eval(SNAPSHOT, false);
  if (depths.redoDepth !== 2) fatal(`editor: redo depth after two undos: ${depths.redoDepth}`);
  console.log("EDITOR: text/nudge/word/split/merge + undo walk OK");

  // -- round-trip proof: writer -> loadLyricsText -> identical lines --------
  const preExport = await cdp.eval(LINES, false);
  const lrcText = await cdp.eval(`window.__lyricsLrc()`, false);
  writeFileSync(path.join(outDir, "editor-roundtrip.lrc"), lrcText);
  await cdp.eval(
    `window.__store.getState().loadLyricsText("editor-roundtrip.lrc", window.__lyricsLrc()); true`,
    false,
  );
  const re = await cdp.eval(LINES, false);
  if (re.length !== preExport.length) {
    fatal(`editor: round-trip line count ${re.length} != ${preExport.length}`);
  }
  for (let i = 0; i < re.length; i++) {
    if (Math.abs(re[i].t - preExport[i].t) > 0.006) {
      fatal(`editor: round-trip line ${i} start ${re[i].t} != ${preExport[i].t}`);
    }
    if (re[i].text !== preExport[i].text) {
      fatal(`editor: round-trip line ${i} text "${re[i].text}" != "${preExport[i].text}"`);
    }
    const a = preExport[i].words ?? [];
    const b = re[i].words ?? [];
    if (a.length !== b.length)
      fatal(`editor: round-trip line ${i} word count ${b.length} != ${a.length}`);
    for (let k = 0; k < a.length; k++) {
      if (b[k].text !== a[k].text)
        fatal(`editor: round-trip word text ${b[k].text} != ${a[k].text}`);
      if (Math.abs(b[k].t - a[k].t) > 0.006)
        fatal(`editor: round-trip word start ${b[k].t} != ${a[k].t}`);
      const aEnd = a[k].end;
      const bEnd = b[k].end;
      if ((aEnd == null) !== (bEnd == null))
        fatal(`editor: round-trip word end nullity differs at line ${i} word ${k}`);
      if (aEnd != null && Math.abs(bEnd - aEnd) > 0.006)
        fatal(`editor: round-trip word end ${bEnd} != ${aEnd}`);
      if (b[k].conf !== undefined) fatal("editor: conf must NOT survive the artifact");
    }
  }
  const secondWrite = await cdp.eval(`window.__lyricsLrc()`, false);
  if (secondWrite !== lrcText) fatal("editor: second write is not byte-identical");
  const resetDepths = await cdp.eval(SNAPSHOT, false);
  if (resetDepths.undoDepth !== 0) fatal("editor: re-import must reset the edit history");
  console.log(
    `EDITOR: round-trip OK — ${re.length} lines incl. words survive writer->parser byte-stable`,
  );

  // -- REAL per-line re-align (sidecar --align-line) ------------------------
  const target = re.findIndex((l) => l.words && l.words.length >= 3);
  if (target < 0) fatal("editor: no line to re-align");
  const targetText = re[target].text;
  await call(`realignLyricLine(${target})`);
  const t0 = Date.now();
  for (;;) {
    const snap = await cdp.eval(SNAPSHOT, false);
    if (snap.error) fatal(`editor: re-align surfaced error: ${snap.error}`);
    if (snap.realign === null && Date.now() - t0 > 2_000) break;
    if (Date.now() - t0 > 180_000) fatal("editor: re-align timed out");
    await sleep(1000);
  }
  const aligned = await cdp.eval(LINES, false);
  const words = aligned[target].words ?? [];
  if (words.length === 0) fatal("editor: re-align produced no words");
  if (words.map((w) => w.text).join(" ") !== targetText.split(/\s+/).join(" ")) {
    fatal(`editor: re-aligned words diverge from the line text`);
  }
  for (let k = 0; k < words.length; k++) {
    if (!(typeof words[k].conf === "number" && words[k].conf >= 0 && words[k].conf <= 1)) {
      fatal(`editor: re-aligned word ${k} has no conf`);
    }
    if (k > 0 && words[k].t < words[k - 1].t) fatal("editor: re-aligned words not monotonic");
  }
  if (words[0].t < aligned[target].t - 0.7) {
    fatal(
      `editor: re-aligned first word ${words[0].t.toFixed(2)} far before line ${aligned[target].t.toFixed(2)}`,
    );
  }
  if (typeof aligned[target].conf !== "number") fatal("editor: re-align must set line conf");
  const spans = words
    .map((w) => `${w.t.toFixed(2)}${w.end != null ? `-${w.end.toFixed(2)}` : ""} ${w.text}`)
    .join(" | ");
  console.log(`EDITOR: re-align OK on line ${target} ("${targetText}") -> ${spans}`);
}

// --- media server: corpus + Madness, read in place -------------------------
const MEDIA = {
  "/ssb.wav": path.join(CORPUS, "ssb-navy-solo.wav"),
  "/madness.flac": MADNESS,
};

function startMediaServer() {
  mediaServer = createHttpServer((req, res) => {
    const file = MEDIA[req.url ?? ""];
    if (!file || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    const size = statSync(file).size;
    res.writeHead(200, {
      "Content-Type": req.url.endsWith(".flac") ? "audio/flac" : "audio/wav",
      "Content-Length": size,
      "Access-Control-Allow-Origin": "*",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    mediaServer.listen(0, "127.0.0.1", () => resolve(mediaServer.address().port));
    mediaServer.on("error", reject);
  });
}

// --- CDP plumbing: lib attach + lib Cdp, fatal-wrapped ----------------------
/** Store snapshot the polls read — one shape for every leg. */
const SNAPSHOT = `(() => {
  const s = window.__store.getState();
  return {
    phase: s.lyricsGen.phase,
    stage: s.lyricsGen.gen?.stage ?? null,
    pct: s.lyricsGen.gen?.pct ?? null,
    dl: s.lyricsGen.download,
    lyricsLen: s.lyrics ? s.lyrics.length : null,
    fileName: s.lyricFileName,
    realign: s.lyricsRealign ? s.lyricsRealign.index : null,
    undoDepth: s.lyricsEditUndoDepth,
    redoDepth: s.lyricsEditRedoDepth,
    error: s.error,
    notice: s.notice,
  };
})()`;

async function pollUntil(cdp, pred, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child.exitCode != null) {
      fatal(`${label}: app exited ${child.exitCode} mid-poll\n${app.log()}`);
    }
    const snap = await cdp.eval(SNAPSHOT, false).catch((e) => {
      fatal(`${label}: ${e.message}\n${app.log()}`);
    });
    if (pred(snap)) return snap;
    if (snap.error) fatal(`${label}: store error surfaced: ${snap.error}`);
    if (Date.now() > deadline) fatal(`${label}: timed out after ${timeoutMs} ms`);
    await sleep(1000);
  }
}

// --- direct sidecar run (comparison leg) -----------------------------------
function runSidecarDirect(input, lrcOut, stemOut) {
  const sidecar = path.join(path.dirname(exe), "lyrics-sidecar.exe");
  const bin = path.join(root, "src-tauri", "binaries");
  const argv = [
    "--input",
    input,
    "--out",
    lrcOut,
    "--ffmpeg",
    path.join(bin, "ffmpeg-x86_64-pc-windows-msvc.exe"),
    "--whisper-cli",
    path.join(bin, "whisper", "whisper-cli.exe"),
    "--whisper-model",
    path.join(E2E_MODELS, "ggml-small.bin"),
    "--mdx-model",
    path.join(E2E_MODELS, "UVR-MDX-NET-Voc_FT.onnx"),
    "--ort-dylib",
    path.join(bin, "onnxruntime", "onnxruntime.dll"),
    "--gpu",
    "auto",
    "--threads",
    "4",
    "--dump-stem",
    stemOut,
    "--align-model",
    path.join(E2E_MODELS, "wav2vec2-base-960h-ctc-int8.onnx"),
    "--align-vocab",
    path.join(E2E_MODELS, "wav2vec2-base-960h-vocab.json"),
  ];
  const res = spawnSync(sidecar, argv, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) fatal(`direct sidecar run failed (${res.status}): ${res.stdout}`);
  const events = res.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return events;
}

function runWhisperOnStem(stemWav, prefix) {
  const bin = path.join(root, "src-tauri", "binaries");
  const res = spawnSync(
    path.join(bin, "whisper", "whisper-cli.exe"),
    [
      "-m",
      path.join(E2E_MODELS, "ggml-small.bin"),
      "-f",
      stemWav,
      "-otxt",
      "-of",
      prefix,
      "-t",
      "4",
      "-bs",
      "5",
      "-np",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.status !== 0) fatal(`whisper on stem failed: ${res.stderr?.slice(-400)}`);
  return readFileSync(`${prefix}.txt`, "utf8");
}

// --- main ------------------------------------------------------------------
try {
  if (!existsSync(exe)) fatal(`app not built: ${exe} (set BEATFORM_EXE or cargo build)`);
  prepModelsDir();
  const mediaPort = await startMediaServer();

  const existingArgs = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? "";
  let log = "";
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
  // devServerCheck is what spawnApp() parks on its handle: waitForPage awaits
  // it and fails loudly if a leftover Vite from another tree owns :1420 (G9).
  app = { child, port, log: () => log, devServerCheck: checkDevServer({ root }) };

  // EVERYTHING up to the first assertion rides inside the recovery probe (G8):
  // the hook wait AND the first IPC call. On a cold Vite dep cache either can
  // eat the "new dependencies optimized — reloading page" reload that destroys
  // the eval context; only the IPC leg used to be guarded, so a reload during
  // the hook wait killed the run before a single assertion (midi-e2e lesson;
  // CDP itself cannot import bare specifiers, hence the __invoke dev hook).
  const cdp = await attachWithRecovery(
    app,
    async (c) => {
      await waitHooks(c, ["__store", "__loadFile", "__invoke"]);
      await c.eval(`window.__invoke("scratch_dir")`);
    },
    { retrySleepMs: 2000 },
  ).catch((e) => fatal(`attach: ${e?.message ?? e}\n${log}`));

  // Models-dir override + fresh state.
  await cdp.eval(`(async () => {
    await window.__invoke("debug_set_lyrics_models_dir", { dir: ${JSON.stringify(E2E_MODELS)} });
    await window.__store.getState().refreshLyricsGen();
    return true;
  })()`);
  const models0 = await cdp.eval(`window.__store.getState().lyricsGen.models`, false);
  if (!models0 || models0.models.length !== 5)
    fatal(`models state wrong: ${JSON.stringify(models0)}`);
  const mdx0 = models0.models.find((m) => m.id === "mdx-voc-ft");
  const small0 = models0.models.find((m) => m.id === "whisper-small");
  if (mdx0.installed) fatal("precondition: mdx must start uninstalled");
  if (!small0.installed) fatal("precondition: seeded ggml-small must count as installed");
  const alignSeeded = models0.models.find((m) => m.id === "wav2vec2-align").installed;
  console.log(
    `SETUP OK: hooks + models override; small seeded, mdx absent, align ${alignSeeded ? "cached" : "will download"}`,
  );

  // ---- 1. download -> cancel -> resume -> verify (live release) ----------
  await cdp.eval(`window.__store.getState().downloadLyricsTier("small"); true`, false);
  const midway = await pollUntil(
    cdp,
    (s) => s.phase === "downloading" && s.dl && s.dl.received > 8_000_000,
    120_000,
    "download-start",
  );
  console.log(`DOWNLOAD: ${midway.dl.received} of ${midway.dl.total} bytes — cancelling`);
  await cdp.eval(`window.__store.getState().cancelLyricsDownload(); true`, false);
  await pollUntil(cdp, (s) => s.phase === "idle", 60_000, "download-cancel");
  const afterCancel = await cdp.eval(
    `window.__store.getState().refreshLyricsGen().then(() =>
       window.__store.getState().lyricsGen.models.models.find((m) => m.id === "mdx-voc-ft"))`,
  );
  if (afterCancel.installed || afterCancel.partBytes <= 0) {
    fatal(`cancel must keep a resumable part: ${JSON.stringify(afterCancel)}`);
  }
  console.log(`CANCEL OK: ${afterCancel.partBytes} bytes kept for resume`);

  await cdp.eval(`window.__store.getState().downloadLyricsTier("small"); true`, false);
  await pollUntil(cdp, (s) => s.phase === "downloading", 60_000, "resume-start");
  await pollUntil(cdp, (s) => s.phase === "idle", 600_000, "resume-finish");
  const afterResume = await cdp.eval(
    `window.__store.getState().lyricsGen.models.models
       .filter((m) => ["mdx-voc-ft", "wav2vec2-align", "wav2vec2-vocab"].includes(m.id))`,
    false,
  );
  for (const m of afterResume) {
    if (!m.installed) fatal(`resume did not install ${m.id}: ${JSON.stringify(afterResume)}`);
  }
  const verifyOk = await cdp.eval(`window.__invoke("lyrics_model_verify", { id: "mdx-voc-ft" })`);
  if (verifyOk !== true) fatal("post-resume SHA-256 verify must pass");
  // Phase 3: the alignment model + vocab hashes must match the manifest pins
  // whether they came from this run's release download or the devstorage seed.
  const verifyAlign = await cdp.eval(
    `window.__invoke("lyrics_model_verify", { id: "wav2vec2-align" })`,
  );
  if (verifyAlign !== true) fatal("wav2vec2-align SHA-256 verify must pass");
  const verifyVocab = await cdp.eval(
    `window.__invoke("lyrics_model_verify", { id: "wav2vec2-vocab" })`,
  );
  if (verifyVocab !== true) fatal("wav2vec2-vocab SHA-256 verify must pass");
  const verifyAbsent = await cdp.eval(
    `window.__invoke("lyrics_model_verify", { id: "whisper-medium" })`,
  );
  if (verifyAbsent !== false) fatal("verify of an uninstalled model must be false");
  cacheAlignModels();
  console.log(
    "RESUME+VERIFY OK: real release download, hash-verified (incl. alignment pair), negative case false",
  );

  // ---- 2. generation on the corpus track through the store ---------------
  await cdp.eval(`(async () => {
    await window.__loadFile("http://127.0.0.1:${mediaPort}/ssb.wav", "ssb-navy-solo.wav");
    window.__store.getState().pause?.();
    window.__store.getState().clearLyrics();
    return true;
  })()`);
  await cdp.eval(`window.__store.getState().generateLyrics("small", "auto"); true`, false);
  await pollUntil(cdp, (s) => s.phase === "generating", 60_000, "gen-start");
  const done = await pollUntil(
    cdp,
    (s) => s.phase === "idle" && s.lyricsLen != null,
    10 * 60_000,
    "gen-finish",
  );
  const lines = await cdp.eval(
    `JSON.parse(JSON.stringify(window.__store.getState().lyrics))`,
    false,
  );
  if (!lines || lines.length < 5) fatal(`too few lines: ${lines?.length}`);
  for (let i = 1; i < lines.length; i++) {
    if (!(lines[i].t > lines[i - 1].t)) fatal(`timestamps not monotonic at ${i}`);
  }
  if (!/\(generated\)\.lrc$/.test(done.fileName ?? "")) fatal(`fileName wrong: ${done.fileName}`);
  if (!lines.some((l) => /say can you see/i.test(l.text))) {
    fatal(`corpus transcript unexpectedly off: ${JSON.stringify(lines.slice(0, 3))}`);
  }
  const corpusAligned = assertWordTiming(lines, "corpus");
  if (!/words timed/.test(done.notice ?? "")) {
    fatal(`store notice must report word timing, got: ${done.notice}`);
  }
  console.log(
    `GEN OK: ${lines.length} lines (${corpusAligned} word-timed) in store via loadLyricsText (${done.fileName})`,
  );
  console.log(`GEN NOTICE: ${done.notice}`);

  // ---- 2b. the correction editor on those lines --------------------------
  await runEditorLeg(cdp);

  // ---- 3. cancel mid-isolation -------------------------------------------
  await cdp.eval(`window.__store.getState().clearLyrics(); true`, false);
  await cdp.eval(`window.__store.getState().generateLyrics("small", "auto"); true`, false);
  await pollUntil(
    cdp,
    (s) => s.phase === "generating" && s.stage === "isolate" && (s.pct ?? 0) > 5,
    120_000,
    "cancel-arm",
  );
  await cdp.eval(`window.__store.getState().cancelLyricsGenerate(); true`, false);
  const cancelled = await pollUntil(cdp, (s) => s.phase === "idle", 30_000, "cancel-finish");
  if (cancelled.lyricsLen != null) fatal("cancel must not land lyrics");
  if (cancelled.error) fatal(`cancel must be silent, got error: ${cancelled.error}`);
  console.log("GEN-CANCEL OK: idle again, no lyrics, no error");

  // ---- 4. the owner's dense mix ------------------------------------------
  if (!args.has("--skip-madness")) {
    if (!existsSync(MADNESS)) fatal(`Madness.flac not found at ${MADNESS}`);
    await cdp.eval(`(async () => {
      await window.__loadFile("http://127.0.0.1:${mediaPort}/madness.flac", "Muse - Madness.flac");
      window.__store.getState().pause?.();
      window.__store.getState().clearLyrics();
      return true;
    })()`);
    const t0 = Date.now();
    await cdp.eval(`window.__store.getState().generateLyrics("small", "auto"); true`, false);
    await pollUntil(cdp, (s) => s.phase === "generating", 60_000, "madness-start");
    const mdone = await pollUntil(
      cdp,
      (s) => s.phase === "idle" && s.lyricsLen != null,
      25 * 60_000,
      "madness-finish",
    );
    const mlines = await cdp.eval(
      `JSON.parse(JSON.stringify(window.__store.getState().lyrics))`,
      false,
    );
    for (let i = 1; i < mlines.length; i++) {
      if (!(mlines[i].t > mlines[i - 1].t)) fatal(`madness timestamps not monotonic at ${i}`);
    }
    const mAligned = assertWordTiming(mlines, "madness");
    if (!/words timed/.test(mdone.notice ?? "")) {
      fatal(`madness notice must report word timing, got: ${mdone.notice}`);
    }
    const wall = Math.round((Date.now() - t0) / 1000);
    writeFileSync(
      path.join(outDir, "madness-app-flow.json"),
      JSON.stringify({ wallSec: wall, fileName: mdone.fileName, lines: mlines }, null, 2),
    );
    console.log(
      `MADNESS OK: ${mlines.length} lines (${mAligned} word-timed) in ${wall}s via the real store flow — transcript saved to ${outDir}`,
    );
    console.log(`MADNESS NOTICE: ${mdone.notice}`);
    for (const l of mlines) console.log(`  [${l.t.toFixed(2)}] ${l.text}`);
    // Honest per-word sample: the first three word-timed lines with their
    // spans, so the timing quality is inspectable against the actual song —
    // machine timings on the owner's local file, judged by ear.
    console.log("MADNESS WORD SAMPLE (first 3 word-timed lines):");
    for (const l of mlines.filter((x) => x.words && x.words.length > 0).slice(0, 3)) {
      const spans = l.words
        .map((w) => `${w.t.toFixed(2)}${w.end != null ? `-${w.end.toFixed(2)}` : ""} ${w.text}`)
        .join(" | ");
      console.log(`  [${l.t.toFixed(2)}] ${spans}`);
    }
  }

  // ---- 5. isolated-vs-mix comparison (direct sidecar) --------------------
  if (!args.has("--skip-compare") && !args.has("--skip-madness")) {
    console.log("COMPARE: direct sidecar run on Madness with --dump-stem…");
    const lrcOut = path.join(outDir, "madness-direct-mix.lrc");
    const stemOut = path.join(outDir, "madness-stem.wav");
    const events = runSidecarDirect(MADNESS, lrcOut, stemOut);
    writeFileSync(path.join(outDir, "madness-direct-events.json"), JSON.stringify(events, null, 2));
    const result = events.find((e) => e.type === "result");
    const iso = events.find((e) => e.type === "stageDone" && e.stage === "isolate");
    const alignDone = events.find((e) => e.type === "stageDone" && e.stage === "align");
    if (!alignDone) fatal("direct run must emit an align stageDone");
    if (!(result?.words > 0))
      fatal(`direct run produced no word timing: ${JSON.stringify(result)}`);
    console.log(
      `COMPARE: direct run done — ep=${result?.ep} isolateRTF=${iso?.rtf?.toFixed(3)} ` +
        `vocalSec=${result?.vocalSec?.toFixed(1)} lines=${result?.lines} words=${result?.words} ` +
        `aligned=${result?.alignedLines} lowConf=${result?.lowConfLines} ` +
        `alignWall=${alignDone.wallSec?.toFixed(1)}s (${alignDone.detail ?? ""})`,
    );
    console.log("COMPARE: whisper small on the ISOLATED STEM…");
    const stemText = runWhisperOnStem(stemOut, path.join(outDir, "madness-stem-transcript"));
    const mixLrc = readFileSync(lrcOut, "utf8");
    writeFileSync(path.join(outDir, "madness-mix.lrc"), mixLrc);
    const norm = (t) =>
      t
        .toLowerCase()
        .replace(/\[[^\]]*\]/g, " ")
        .replace(/[^a-z' ]+/g, " ")
        .split(/\s+/)
        .filter(Boolean);
    const mixWords = norm(mixLrc);
    const stemWords = norm(stemText);
    const overlap = mixWords.filter((w) => stemWords.includes(w)).length;
    console.log(
      `COMPARE: mix-pipeline words=${mixWords.length} stem-only words=${stemWords.length} ` +
        `shared-vocab overlap=${((100 * overlap) / Math.max(1, mixWords.length)).toFixed(0)}% ` +
        `(full texts in ${outDir})`,
    );
  }

  console.log(
    "LYRICS-E2E OK: download+cancel+resume+verify, corpus generation, editor leg " +
      "(conf transport, edits, undo walk, LRC round-trip, real re-align), mid-run cancel" +
      (args.has("--skip-madness") ? "" : ", dense-mix generation + stem comparison") +
      " all pass",
  );
} finally {
  // PID-tree only: /T covers the sidecar + whisper children the app itself
  // spawned; direct sidecar/whisper runs above are spawnSync (already done).
  // Never a name-wide sweep — it would hit an installed Beatform.
  killTree(app);
  mediaServer?.close();
}
