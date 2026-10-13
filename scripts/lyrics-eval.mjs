// Score the lyrics sidecar against reference LRCs — the measuring stick for
// model, flag and pipeline changes (added 2026-10-13 on the RTX 5060 Ti).
//
//   node scripts/lyrics-eval.mjs --config <name> [--mode sidecar|replay] [options]
//
// Layout of --songs (the owner's test collection, never in the repo):
//   <songs>/mix/<slug>.wav      the full mix, 44.1 kHz stereo
//   <songs>/<slug>.ref.lrc      line-synced reference lyrics (optional)
//   <songs>/stem/<slug>.wav     the isolated vocal, written by a sidecar run
//   <songs>/langs.json          {"<slug>": "de"} overrides for --lang
//
// Modes:
//   sidecar  the product path: the sidecar runs whisper itself (its own
//            flags, its language pre-pass) and dumps the stem.
//   replay   whisper-cli runs HERE with --whisper-flags on the mix or the
//            stem (--whisper-input), and the sidecar replays that JSON
//            through the real VAD, assembly and alignment stages
//            (--whisper-json dev hook). Whisper output is cached per config.
//
// Per song: <out>/<config>/<slug>.lrc, .json (whisper), .score.json, and a
// summary table. Metrics against the reference:
//   WER        word Levenshtein over the whole text (normalized)
//   flagged    lines the aligner flagged (conf < 0.2 or unaligned)
//   true/false flags whose line text is wrong / right (match < 60 % / >= 60 %)
//   missed     wrong lines the aligner did NOT flag
//   timing     first word of each reference line vs its matched hypothesis
//              word, around the song's median offset (the reference's own
//              shift): coverage, median and p90 |deviation|, share within
//              300 ms
//
// Env: BEATFORM_LYRICS_SONGS, BEATFORM_LYRICS_MODELS, BEATFORM_WHISPER_CLI,
// BEATFORM_LYRICS_OUT default the paths below.
import { spawn, spawnSync } from "node:child_process";
import { clearTimeout, setTimeout } from "node:timers";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "src-tauri", "binaries");
const argv = process.argv.slice(2);
const opt = (k, def) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : def;
};
const has = (k) => argv.includes(`--${k}`);

const SONGS = opt("songs", process.env.BEATFORM_LYRICS_SONGS ?? "C:/bf-test/songs");
const MODELS = opt("models", process.env.BEATFORM_LYRICS_MODELS ?? "C:/bf-test/models");
const OUT = opt("out", process.env.BEATFORM_LYRICS_OUT ?? "C:/bf-test/out/eval");
const CONFIG = opt("config", null);
const MODE = opt("mode", "sidecar");
const WHISPER_CLI = opt(
  "whisper-cli",
  process.env.BEATFORM_WHISPER_CLI ??
    "C:/bf-test/dl/whisper-cuda-v1.9.1/extract/Release/whisper-cli.exe",
);
const WHISPER_MODEL = opt("whisper-model", path.join(MODELS, "ggml-large-v3-turbo.bin"));
const DTW = opt("dtw", "large.v3.turbo");
const WHISPER_INPUT = opt("whisper-input", "mix"); // replay: mix | stem
const WHISPER_FLAGS = opt("whisper-flags", ""); // replay: appended to the base flags
const LANG = opt("lang", "auto");
const THREADS = opt("threads", "12");
const SIDECAR = opt("sidecar", path.join(BIN, "lyrics-sidecar-x86_64-pc-windows-msvc.exe"));
const ALIGN_MODEL = opt("align-model", path.join(MODELS, "wav2vec2-base-960h-ctc-int8.onnx"));
const ALIGN_VOCAB = opt("align-vocab", path.join(MODELS, "wav2vec2-base-960h-vocab.json"));
const NO_ALIGN = has("no-align");
const ONLY = opt("only", null)?.split(",").filter(Boolean) ?? null;
const RERUN = has("rerun"); // ignore cached whisper JSON
const JSON_FROM = opt("json-from", null); // replay another config's whisper JSON (aligner experiments)
const LOW_CONF = 0.2;

if (!CONFIG) {
  console.error("--config <name> is required");
  process.exit(2);
}
if (!["sidecar", "replay"].includes(MODE)) {
  console.error(`--mode must be sidecar or replay, not ${MODE}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Text

/** Lowercase, apostrophes unified, hyphens split, punctuation dropped. */
export function normalizeWords(text) {
  return text
    .toLowerCase()
    .replace(/[\u2019\u02BC`]/g, "'")
    .replace(/[\u2010-\u2015-]/g, " ")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

function parseStamp(m, s, cs) {
  return Number(m) * 60 + Number(s) + Number(cs.padEnd(3, "0").slice(0, 3)) / 1000;
}

/** Reference LRC: [{t, text}], empty lines dropped. */
export function parseRefLrc(src) {
  const lines = [];
  for (const raw of src.split(/\r?\n/)) {
    const m = raw.match(/^\[(\d+):(\d+)\.(\d+)\]\s*(.*)$/);
    if (!m) continue;
    const text = m[4].trim();
    if (!text) continue;
    lines.push({ t: parseStamp(m[1], m[2], m[3]), text });
  }
  return lines;
}

/** Enhanced LRC from the sidecar: [{t, text, words: [{t, text}] | null}]. */
export function parseHypLrc(src) {
  const lines = [];
  for (const raw of src.split(/\r?\n/)) {
    const m = raw.match(/^\[(\d+):(\d+)\.(\d+)\](.*)$/);
    if (!m) continue;
    const t = parseStamp(m[1], m[2], m[3]);
    const rest = m[4];
    if (rest.includes("<")) {
      const words = [];
      for (const w of rest.matchAll(/<(\d+):(\d+)\.(\d+)>([^<]*)/g)) {
        const text = w[4].trim();
        if (text) words.push({ t: parseStamp(w[1], w[2], w[3]), text });
      }
      lines.push({ t, text: words.map((w) => w.text).join(" "), words });
    } else if (rest.trim()) {
      lines.push({ t, text: rest.trim(), words: null });
    }
  }
  return lines;
}

/**
 * Word-level Levenshtein alignment. Returns ops [{op, r, h}] with op in
 * match|sub|del|ins, r/h the ref/hyp word indices (null where absent).
 */
export function alignWords(ref, hyp) {
  const n = ref.length;
  const m = hyp.length;
  const cost = new Array((n + 1) * (m + 1)).fill(0);
  const back = new Uint8Array((n + 1) * (m + 1)); // 0 diag, 1 up (del), 2 left (ins)
  const at = (i, j) => i * (m + 1) + j;
  for (let i = 1; i <= n; i++) {
    cost[at(i, 0)] = i;
    back[at(i, 0)] = 1;
  }
  for (let j = 1; j <= m; j++) {
    cost[at(0, j)] = j;
    back[at(0, j)] = 2;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = ref[i - 1] === hyp[j - 1];
      let best = cost[at(i - 1, j - 1)] + (same ? 0 : 1);
      let from = 0;
      const del = cost[at(i - 1, j)] + 1;
      if (del < best) {
        best = del;
        from = 1;
      }
      const ins = cost[at(i, j - 1)] + 1;
      if (ins < best) {
        best = ins;
        from = 2;
      }
      cost[at(i, j)] = best;
      back[at(i, j)] = from;
    }
  }
  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const from = back[at(i, j)];
    if (i > 0 && j > 0 && from === 0) {
      ops.push({ op: ref[i - 1] === hyp[j - 1] ? "match" : "sub", r: i - 1, h: j - 1 });
      i--;
      j--;
    } else if (i > 0 && (from === 1 || j === 0)) {
      ops.push({ op: "del", r: i - 1, h: null });
      i--;
    } else {
      ops.push({ op: "ins", r: null, h: j - 1 });
      j--;
    }
  }
  ops.reverse();
  return { ops, distance: cost[at(n, m)] };
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Score one hypothesis (parsed LRC + per-line conf) against a reference. */
export function score(ref, hyp, lineConf, lineAlign = null, lineP = null) {
  // Flatten to words with back-references.
  const refWords = [];
  ref.forEach((line, li) => {
    for (const w of normalizeWords(line.text)) refWords.push({ w, line: li });
  });
  const hypWords = [];
  hyp.forEach((line, li) => {
    // A plain (line-level) line: its stamp times its first word only.
    const tokens =
      line.words ?? line.text.split(/\s+/).map((text, k) => ({ t: k === 0 ? line.t : null, text }));
    tokens.forEach((tok) => {
      // A display word may normalize to several words (hyphens) or none.
      for (const w of normalizeWords(tok.text)) hypWords.push({ w, line: li, t: tok.t });
    });
  });
  const { ops } = alignWords(
    refWords.map((x) => x.w),
    hypWords.map((x) => x.w),
  );
  const counts = { match: 0, sub: 0, del: 0, ins: 0 };
  const hypMatched = new Array(hypWords.length).fill(false);
  const refToHyp = new Array(refWords.length).fill(null);
  for (const o of ops) {
    counts[o.op]++;
    if (o.op === "match") hypMatched[o.h] = true;
    if (o.op === "match" || o.op === "sub") refToHyp[o.r] = { h: o.h, exact: o.op === "match" };
  }
  const wer = refWords.length ? (counts.sub + counts.del + counts.ins) / refWords.length : null;

  // Per hypothesis line: how much of its text the reference confirms.
  const perLine = hyp.map((line, li) => {
    const idx = hypWords.map((x, k) => (x.line === li ? k : -1)).filter((k) => k >= 0);
    const right = idx.filter((k) => hypMatched[k]).length;
    const conf = lineConf?.[li] ?? null;
    const alignConf = lineAlign?.[li] ?? null;
    const whisperP = lineP?.[li] ?? null;
    const flagged = conf == null || conf < LOW_CONF;
    const correct = idx.length ? right / idx.length : 0;
    return {
      li,
      words: idx.length,
      correct,
      conf,
      alignConf,
      whisperP,
      flagged,
      wrong: correct < 0.6,
    };
  });
  const flagged = perLine.filter((l) => l.flagged).length;
  const trueFlags = perLine.filter((l) => l.flagged && l.wrong).length;
  const falseFlags = perLine.filter((l) => l.flagged && !l.wrong).length;
  const missed = perLine.filter((l) => !l.flagged && l.wrong).length;
  const wrongLines = perLine.filter((l) => l.wrong).length;

  // Longest run of inserted (unconfirmed) hypothesis words — hallucination.
  let run = 0;
  let longestRun = 0;
  for (const o of ops) {
    run = o.op === "ins" ? run + 1 : 0;
    if (run > longestRun) longestRun = run;
  }

  // Line-start timing: the first word of each reference line.
  const offsets = [];
  let timedRefLines = 0;
  let firstWordIdx = 0;
  ref.forEach((line, li) => {
    const n = normalizeWords(line.text).length;
    if (n > 0) {
      const link = refToHyp[firstWordIdx];
      const t = link ? hypWords[link.h].t : null;
      if (t != null) {
        offsets.push(t - line.t);
        timedRefLines++;
      }
      firstWordIdx += n;
    }
    void li;
  });
  // Reference LRCs carry a constant per-song offset against this audio
  // (different masters; measured -0.9 s on one song, +1.0 s on another), so
  // the spread is measured around the song's median offset, which is
  // reported separately as the reference's own shift.
  const sortedOffsets = [...offsets].sort((a, b) => a - b);
  const shift = sortedOffsets.length ? quantile(sortedOffsets, 0.5) : 0;
  const abs = offsets.map((o) => Math.abs(o - shift)).sort((a, b) => a - b);
  const timing = {
    refLines: ref.length,
    matched: timedRefLines,
    coverage: ref.length ? timedRefLines / ref.length : null,
    refShiftMs: sortedOffsets.length ? Math.round(shift * 1000) : null,
    medianAbsMs: abs.length ? Math.round(quantile(abs, 0.5) * 1000) : null,
    p90AbsMs: abs.length ? Math.round(quantile(abs, 0.9) * 1000) : null,
    within300: abs.length ? abs.filter((a) => a <= 0.3).length / abs.length : null,
  };
  return {
    refWords: refWords.length,
    hypWords: hypWords.length,
    wer,
    counts,
    longestInsertRun: longestRun,
    lines: hyp.length,
    flagged,
    flaggedPct: hyp.length ? flagged / hyp.length : null,
    wrongLines,
    trueFlags,
    falseFlags,
    missed,
    timing,
    perLine,
  };
}

// ---------------------------------------------------------------------------
// Runs

function runSidecar(args, label) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(SIDECAR, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c.toString()));
    child.stderr.on("data", (c) => (err += c.toString()));
    const timer = setTimeout(() => child.kill(), 15 * 60 * 1000);
    child.on("close", (code) => {
      clearTimeout(timer);
      const events = out
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      resolve({ code, events, stderr: err, wallSec: (Date.now() - t0) / 1000, label });
    });
  });
}

function runWhisper(input, jsonPrefix, lang) {
  const args = [
    "-m",
    WHISPER_MODEL,
    "-f",
    input,
    "-ojf",
    "-of",
    jsonPrefix,
    "-t",
    THREADS,
    "-bs",
    "5",
    "-l",
    lang,
    "-pp",
  ];
  if (DTW && DTW !== "none") args.push("-nfa", "-dtw", DTW);
  if (WHISPER_FLAGS.trim()) args.push(...WHISPER_FLAGS.trim().split(/\s+/));
  const t0 = Date.now();
  const r = spawnSync(WHISPER_CLI, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const wallSec = (Date.now() - t0) / 1000;
  const cuda = /found \d+ CUDA device/.test(r.stderr || "");
  const timings = {};
  for (const m of (r.stderr || "").matchAll(
    /whisper_print_timings:\s+(\w[\w ]*?)\s*=\s*([\d.]+) ms/g,
  )) {
    timings[m[1].trim()] = Number(m[2]);
  }
  return {
    code: r.status,
    wallSec,
    cuda,
    timings,
    args,
    stderrTail: (r.stderr || "").split(/\r?\n/).slice(-6),
  };
}

function slugs() {
  const dir = path.join(SONGS, "mix");
  const all = (existsSync(dir) ? readdirSyncSafe(dir) : [])
    .filter((f) => f.toLowerCase().endsWith(".wav"))
    .map((f) => f.slice(0, -4))
    .sort();
  return ONLY ? all.filter((s) => ONLY.includes(s)) : all;
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function langFor(slug) {
  const p = path.join(SONGS, "langs.json");
  if (existsSync(p)) {
    try {
      const map = JSON.parse(readFileSync(p, "utf8"));
      if (map[slug]) return map[slug];
    } catch {
      /* ignore */
    }
  }
  return LANG;
}

async function evalSong(slug) {
  const mix = path.join(SONGS, "mix", `${slug}.wav`);
  const stemDir = path.join(SONGS, "stem");
  mkdirSync(stemDir, { recursive: true });
  const stem = path.join(stemDir, `${slug}.wav`);
  const outDir = path.join(OUT, CONFIG);
  mkdirSync(outDir, { recursive: true });
  const lrcPath = path.join(outDir, `${slug}.lrc`);
  rmSync(lrcPath, { force: true });
  const lang = langFor(slug);

  const base = [
    "--input",
    mix,
    "--out",
    lrcPath,
    "--ffmpeg",
    path.join(BIN, "ffmpeg-x86_64-pc-windows-msvc.exe"),
    "--whisper-cli",
    WHISPER_CLI,
    "--whisper-model",
    WHISPER_MODEL,
    "--mdx-model",
    path.join(MODELS, "UVR-MDX-NET-Voc_FT.onnx"),
    "--ort-dylib",
    path.join(BIN, "onnxruntime", "onnxruntime.dll"),
    "--gpu",
    "auto",
    "--threads",
    THREADS,
    "--language",
    lang,
  ];
  if (!NO_ALIGN) base.push("--align-model", ALIGN_MODEL, "--align-vocab", ALIGN_VOCAB);
  if (DTW && DTW !== "none") base.push("--whisper-dtw", DTW);
  if (!existsSync(stem)) base.push("--dump-stem", stem);

  let whisper = null;
  if (MODE === "replay") {
    const input = WHISPER_INPUT === "stem" ? stem : mix;
    if (WHISPER_INPUT === "stem" && !existsSync(stem)) {
      // One sidecar pass just to write the stem (its whisper output is discarded).
      process.stdout.write(`  ${slug}: isolating the stem first…\n`);
      await runSidecar([...base, "--language", "en"], "stem-pass");
      rmSync(lrcPath, { force: true });
      if (!existsSync(stem)) throw new Error(`stem not written for ${slug}`);
    }
    const prefix = path.join(outDir, slug);
    const jsonPath = JSON_FROM ? path.join(OUT, JSON_FROM, `${slug}.json`) : `${prefix}.json`;
    if (JSON_FROM && !existsSync(jsonPath)) {
      return { slug, config: CONFIG, error: `no whisper JSON in config ${JSON_FROM}` };
    }
    if (!JSON_FROM && (RERUN || !existsSync(jsonPath))) {
      rmSync(jsonPath, { force: true });
      whisper = runWhisper(input, prefix, lang === "auto" ? "auto" : lang);
      if (whisper.code !== 0 || !existsSync(jsonPath)) {
        return {
          slug,
          config: CONFIG,
          error: `whisper-cli failed (${whisper.code}): ${whisper.stderrTail.join(" | ")}`,
        };
      }
      writeFileSync(`${prefix}.whisper-run.json`, JSON.stringify(whisper, null, 2));
    } else {
      whisper = { cached: true };
      try {
        whisper = {
          cached: true,
          ...JSON.parse(readFileSync(`${prefix}.whisper-run.json`, "utf8")),
        };
      } catch {
        /* no run record */
      }
    }
    base.push("--whisper-json", jsonPath);
  }

  const run = await runSidecar(base, CONFIG);
  const stages = {};
  for (const e of run.events) {
    if (e.type === "stageDone")
      stages[e.stage] = {
        wallSec: +e.wallSec.toFixed(2),
        rtf: e.rtf != null ? +e.rtf.toFixed(4) : undefined,
        detail: e.detail,
      };
  }
  const result = run.events.find((e) => e.type === "result");
  const errorEv = run.events.find((e) => e.type === "error");
  if (!result || !existsSync(lrcPath)) {
    return {
      slug,
      config: CONFIG,
      error: errorEv?.message ?? `sidecar exit ${run.code}`,
      stderrTail: run.stderr.split(/\r?\n/).filter(Boolean).slice(-8),
      stages,
    };
  }
  const hyp = parseHypLrc(readFileSync(lrcPath, "utf8"));
  const lineConf = result.lineDetails ? result.lineDetails.map((d) => d.conf ?? null) : null;
  // The aligner's own reading and whisper's vote ride on stderr only; the
  // merged confidence is what lineDetails carries.
  const lineAlign = new Array(hyp.length).fill(null);
  const lineP = new Array(hyp.length).fill(null);
  for (const m of run.stderr.matchAll(
    /align line (\d+): conf ([\d.]+) p ([\d.]+) merged [\d.]+/g,
  )) {
    lineAlign[Number(m[1])] = Number(m[2]);
    lineP[Number(m[1])] = Number(m[3]);
  }
  const refPath = path.join(SONGS, `${slug}.ref.lrc`);
  const ref = existsSync(refPath) ? parseRefLrc(readFileSync(refPath, "utf8")) : null;
  const scored = ref ? score(ref, hyp, lineConf, lineAlign, lineP) : null;
  const flaggedNoRef = lineConf ? lineConf.filter((c) => c == null || c < LOW_CONF).length : null;
  const row = {
    slug,
    config: CONFIG,
    mode: MODE,
    lang,
    language: result.language,
    whisperBackend: result.whisper,
    stages,
    sidecarWallSec: +run.wallSec.toFixed(1),
    whisperWallSec: whisper?.wallSec != null ? +whisper.wallSec.toFixed(1) : undefined,
    lines: result.lines,
    alignedLines: result.alignedLines,
    lowConfLines: result.lowConfLines,
    flaggedPct: hyp.length
      ? +((flaggedNoRef ?? result.lowConfLines) / hyp.length).toFixed(3)
      : null,
    vocalSec: +result.vocalSec.toFixed(1),
    score: scored
      ? {
          wer: +scored.wer.toFixed(3),
          counts: scored.counts,
          refWords: scored.refWords,
          hypWords: scored.hypWords,
          longestInsertRun: scored.longestInsertRun,
          wrongLines: scored.wrongLines,
          trueFlags: scored.trueFlags,
          falseFlags: scored.falseFlags,
          missed: scored.missed,
          timing: scored.timing,
        }
      : null,
  };
  writeFileSync(
    path.join(outDir, `${slug}.score.json`),
    JSON.stringify(
      {
        ...row,
        perLine: scored?.perLine,
        lineConf,
        lineAlign,
        lineP,
        hypLines: hyp.map((l) => l.text),
      },
      null,
      2,
    ),
  );
  return row;
}

function pct(x) {
  return x == null ? "   -" : `${Math.round(x * 100)}%`.padStart(4);
}
function num(x, w = 5) {
  return (x == null ? "-" : String(x)).padStart(w);
}

const rows = [];
const list = slugs();
console.log(
  `config ${CONFIG} (${MODE}) — ${list.length} songs — model ${path.basename(WHISPER_MODEL)}${MODE === "replay" ? ` on ${WHISPER_INPUT} ${WHISPER_FLAGS ? `[${WHISPER_FLAGS}]` : ""}` : ""}`,
);
for (const slug of list) {
  const row = await evalSong(slug);
  rows.push(row);
  if (row.error) {
    console.log(`  ${slug}: ERROR ${row.error}`);
    continue;
  }
  const s = row.score;
  const tr = MODE === "replay" ? row.whisperWallSec : row.stages.transcribe?.wallSec;
  console.log(
    `  ${slug.padEnd(14)} lines ${num(row.lines, 3)}  flagged ${pct(row.flaggedPct)}  ` +
      (s
        ? `WER ${pct(s.wer)}  wrong ${num(s.wrongLines, 3)}  flags true/false/missed ${num(s.trueFlags, 3)}/${num(s.falseFlags, 3)}/${num(s.missed, 3)}  ` +
          `timing cov ${pct(s.timing.coverage)} med ${num(s.timing.medianAbsMs, 4)} p90 ${num(s.timing.p90AbsMs, 5)} ok300 ${pct(s.timing.within300)} shift ${num(s.timing.refShiftMs, 5)} ms  ins-run ${num(s.longestInsertRun, 3)}  `
        : `(no reference)  `) +
      `whisper ${num(tr, 5)} s  lang ${row.language}`,
  );
}
const ok = rows.filter((r) => !r.error && r.score);
if (ok.length) {
  const mean = (f) => ok.reduce((a, r) => a + f(r), 0) / ok.length;
  const sumL = ok.reduce((a, r) => a + r.lines, 0);
  const sumF = ok.reduce((a, r) => a + (r.lowConfLines ?? 0), 0);
  console.log(
    `  ${"MEAN".padEnd(14)} lines ${num(sumL, 3)}  flagged ${pct(sumF / sumL)}  WER ${pct(mean((r) => r.score.wer))}  wrong ${num(
      ok.reduce((a, r) => a + r.score.wrongLines, 0),
      3,
    )}  ` +
      `flags true/false/missed ${num(
        ok.reduce((a, r) => a + r.score.trueFlags, 0),
        3,
      )}/${num(
        ok.reduce((a, r) => a + r.score.falseFlags, 0),
        3,
      )}/${num(
        ok.reduce((a, r) => a + r.score.missed, 0),
        3,
      )}  ` +
      `timing cov ${pct(mean((r) => r.score.timing.coverage))} med ${num(Math.round(mean((r) => r.score.timing.medianAbsMs ?? 0)), 4)} p90 ${num(Math.round(mean((r) => r.score.timing.p90AbsMs ?? 0)), 5)} ms`,
  );
}
mkdirSync(path.join(OUT, CONFIG), { recursive: true });
writeFileSync(path.join(OUT, CONFIG, "summary.json"), JSON.stringify(rows, null, 2));
