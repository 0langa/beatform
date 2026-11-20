// A1 proxy: how early or late do generated lyric words land?
//
// TESTING.md A1 asks the owner to judge, by ear, whether Lyric Stage lights a
// word when the vocalist sings it. Most of that question is measurable: the
// renderer draws each word at the start time the lyrics pipeline wrote (the
// determinism law — preview and export resolve the same frames), so the
// pipeline's word starts ARE the on-screen timing. This probe measures them
// against a ground truth:
//
//   1. Windows' SAPI voice speaks every word of known lines on its own
//      (scripts/tts-words.ps1); this script trims and places the words, so
//      each onset is known to the sample.
//   2. The speech is mixed over a music bed at two levels, behind a lead-in.
//   3. The REAL lyrics sidecar (vocal isolation -> whisper -> wav2vec2 word
//      alignment) runs on the mix exactly as the app runs it.
//   4. Every transcribed word is matched to its ground-truth word (longest
//      common subsequence on normalized text) and its start error measured.
//
// What it cannot judge: sung (not spoken) vocals, line breaks that read well,
// and "nothing embarrassing" — those stay the owner's eyes. Spoken words are
// the EASY case for transcription, so a bias here is a floor, not a ceiling.
//
//   node scripts/lyrics-timing-probe.mjs [--out=<dir>]
//
// Prereqs: the lyrics sidecar built (node scripts/build-lyrics-sidecar.mjs),
// the whisper + onnxruntime runtimes fetched, and the model cache on the
// devstorage drive (same cache scripts/lyrics-e2e.mjs reads). A probe, not a
// gate: a red run is information.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "src-tauri", "binaries");
const FFMPEG = path.join(bin, "ffmpeg-x86_64-pc-windows-msvc.exe");
const SIDECAR = path.join(bin, "lyrics-sidecar-x86_64-pc-windows-msvc.exe");
// Model cache + bed: env overrides first (BEATFORM_LYRICS_MODELS,
// BEATFORM_LYRICS_BED), then the historical devstorage layout.
const MODELS =
  process.env.BEATFORM_LYRICS_MODELS ??
  "F:/agent-devstorage/shared-cache/Beatform/cache/feat004-models/e2e-app-models";
const BED =
  process.env.BEATFORM_LYRICS_BED ??
  "F:/agent-devstorage/shared-cache/Beatform/artifacts/feat004-spike/corpus/synthetic-instrumental.wav";
const outDir =
  (process.argv.find((a) => a.startsWith("--out=")) ?? "").slice("--out=".length) ||
  path.join(os.tmpdir(), "beatform-lyrics-timing-probe");
mkdirSync(outDir, { recursive: true });

/** Seconds of bed before the first word — a song rarely opens on a syllable. */
const LEAD_IN = 4;

/** Lyric-shaped lines: short, rhythmic, ordinary words, a pause between. */
const LINES = [
  "Turn the lights down low tonight",
  "We can dance until the morning comes",
  "Every heartbeat follows the drum",
  "Hold on tight and never let me go",
  "The city hums a song we know",
  "Run with me through the falling rain",
  "Nothing here will stay the same",
  "So sing it loud and sing it again",
];

for (const f of [FFMPEG, SIDECAR, BED, path.join(MODELS, "ggml-small.bin")]) {
  if (!existsSync(f)) {
    console.error(`missing prerequisite: ${f}`);
    process.exit(2);
  }
}

function run(cmd, argv, what) {
  const r = spawnSync(cmd, argv, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error(`${what} failed (${r.status}):\n${(r.stderr || r.stdout || "").slice(-2000)}`);
    process.exit(1);
  }
  return r.stdout;
}

// --- 1. speech with known word onsets ----------------------------------------
// Each word is synthesized alone, trimmed to its first/last audible sample,
// and placed by this script — so its onset in the song is known exactly.
const WORD_GAP = 0.06; // seconds between words inside a line
const LINE_GAP = 1.6; // seconds between lines — a breath, a bar of backing
const RATE = 44100;
const wordsDir = path.join(outDir, "words");
mkdirSync(wordsDir, { recursive: true });
const lineWords = LINES.map((l) => l.split(" "));
const flat = lineWords.flat();
run(
  "powershell",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(root, "scripts", "tts-words.ps1"),
    "-Words",
    flat.join("|"),
    "-OutDir",
    wordsDir,
  ],
  "SAPI synthesis",
);

/** 16-bit mono PCM samples of a RIFF/WAVE file, as floats. */
function readWavMono16(file) {
  const b = readFileSync(file);
  let p = 12;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === "data") {
      const out = new Float32Array(size >> 1);
      for (let i = 0; i < out.length; i++) out[i] = b.readInt16LE(p + 8 + i * 2) / 32768;
      return out;
    }
    p += 8 + size + (size & 1);
  }
  throw new Error(`no data chunk in ${file}`);
}

/** Trim to the first/last sample above -40 dBFS — the word's real extent. */
function trim(x) {
  const thr = 0.01;
  let a = 0;
  let z = x.length - 1;
  while (a < x.length && Math.abs(x[a]) < thr) a++;
  while (z > a && Math.abs(x[z]) < thr) z--;
  return x.subarray(a, z + 1);
}

const clips = flat.map((_, i) => trim(readWavMono16(path.join(wordsDir, `w${i}.wav`))));
const truth = [];
let cursor = LEAD_IN;
let k = 0;
for (const words of lineWords) {
  for (const text of words) {
    truth.push({ t: cursor, text, len: clips[k].length / RATE });
    cursor += clips[k].length / RATE + WORD_GAP;
    k++;
  }
  cursor += LINE_GAP - WORD_GAP;
}
const speech = new Float32Array(Math.ceil((cursor + 1) * RATE));
truth.forEach((w, i) => speech.set(clips[i], Math.round(w.t * RATE)));
const speechWav = path.join(outDir, "speech.wav");
{
  const pcm = Buffer.alloc(speech.length * 2);
  for (let i = 0; i < speech.length; i++)
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(speech[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  writeFileSync(speechWav, Buffer.concat([h, pcm]));
}
writeFileSync(path.join(outDir, "speech-words.json"), JSON.stringify(truth, null, 1));

// --- 2. mixes ------------------------------------------------------------------
const norm = (s) => s.toLowerCase().replace(/[^a-z']/g, "");

/** LCS over normalized words: pairs of (truth index, hypothesis index). */
function matchWords(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] =
        norm(a[i].text) === norm(b[j].text)
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (norm(a[i].text) === norm(b[j].text)) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** Word starts from the sidecar's enhanced LRC (`[line]<t>word <t>word <end>`). */
function lrcWords(lrc) {
  const words = [];
  for (const line of lrc.split(/\r?\n/)) {
    const body = line.replace(/^\[\d+:\d+\.\d+\]/, "");
    if (body === line) continue;
    const re = /<(\d+):(\d+\.\d+)>([^<]*)/g;
    for (let mm; (mm = re.exec(body));) {
      const text = mm[3].trim();
      if (text) words.push({ t: Number(mm[1]) * 60 + Number(mm[2]), text });
    }
  }
  return words;
}

const quantile = (xs, q) => {
  const s = [...xs].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};

const report = [];
for (const [label, bedGain] of [
  ["bed -9 dB", 0.35],
  ["bed 0 dB", 1.0],
]) {
  const tag = label.replace(/[^a-z0-9]+/gi, "_");
  const mix = path.join(outDir, `song_${tag}.wav`);
  const lrc = path.join(outDir, `song_${tag}.lrc`);
  run(
    FFMPEG,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      BED,
      "-i",
      speechWav,
      "-filter_complex",
      `[1:a]aformat=channel_layouts=stereo[v];` +
        `[0:a]volume=${bedGain}[b];[b][v]amix=inputs=2:duration=shortest:normalize=0[out]`,
      "-map",
      "[out]",
      "-ar",
      "44100",
      mix,
    ],
    `ffmpeg mix (${label})`,
  );
  const started = Date.now();
  const stdout = run(
    SIDECAR,
    [
      "--input",
      mix,
      "--out",
      lrc,
      "--ffmpeg",
      FFMPEG,
      "--whisper-cli",
      path.join(bin, "whisper", "whisper-cli.exe"),
      "--whisper-model",
      path.join(MODELS, "ggml-small.bin"),
      "--mdx-model",
      path.join(MODELS, "UVR-MDX-NET-Voc_FT.onnx"),
      "--ort-dylib",
      path.join(bin, "onnxruntime", "onnxruntime.dll"),
      "--gpu",
      "auto",
      "--threads",
      "4",
      "--align-model",
      path.join(MODELS, "wav2vec2-base-960h-ctc-int8.onnx"),
      "--align-vocab",
      path.join(MODELS, "wav2vec2-base-960h-vocab.json"),
      // BEATFORM_LYRICS_DTW=small: whisper's measured token times (the app
      // passes the model's preset); unset = the evenly-spread offsets.
      ...(process.env.BEATFORM_LYRICS_DTW
        ? ["--whisper-dtw", process.env.BEATFORM_LYRICS_DTW]
        : []),
    ],
    `lyrics sidecar (${label})`,
  );
  const result = stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .find((e) => e.type === "result");
  const hyp = lrcWords(readFileSync(lrc, "utf8"));
  const pairs = matchWords(truth, hyp);
  const errs = pairs.map(([i, j]) => hyp[j].t - truth[i].t);
  const abs = errs.map(Math.abs);
  const within = (s) => abs.filter((e) => e <= s).length / Math.max(1, abs.length);
  const row = {
    condition: label,
    secs: Math.round((Date.now() - started) / 1000),
    ep: result?.ep,
    truthWords: truth.length,
    transcribedWords: hyp.length,
    matched: pairs.length,
    coverage: pairs.length / truth.length,
    biasMs: Math.round((errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length)) * 1000),
    medianAbsMs: Math.round(quantile(abs, 0.5) * 1000),
    p90AbsMs: Math.round(quantile(abs, 0.9) * 1000),
    maxAbsMs: Math.round(Math.max(0, ...abs) * 1000),
    within100: within(0.1),
    within250: within(0.25),
  };
  report.push(row);
  writeFileSync(
    path.join(outDir, `pairs_${tag}.json`),
    JSON.stringify(
      pairs.map(([i, j]) => ({ word: truth[i].text, truth: truth[i].t, got: hyp[j].t })),
      null,
      1,
    ),
  );
  console.log(JSON.stringify(row));
}

// PASS bar: a word lit 100 ms off reads as on time; 250 ms is where karaoke
// fill starts to look early or late. Coverage guards the "matched only the
// easy words" escape.
const pass = report.every(
  (r) => r.coverage >= 0.9 && r.medianAbsMs <= 100 && r.p90AbsMs <= 250 && Math.abs(r.biasMs) <= 80,
);
writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ pass, report }, null, 2));
console.log(pass ? "PASS" : "FAIL", `— artifacts in ${outDir}`);
process.exitCode = pass ? 0 : 1;
