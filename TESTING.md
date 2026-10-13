# Beatform — manual acceptance checklist

**Reusing this file:** when the next batch opens, add its items under a
dated heading, update the "State as of" line, and keep the environment facts
current — never start a parallel document.

**State as of 2026-10-13:** new machine (RTX 5060 Ti 16 GB, Ryzen 9 9900X,
31 GB RAM, Windows 11 Pro); the GPU lyrics batch below is open. The
automated device gates guard every surface they can; items land here only
when automation cannot judge them.

## Environment facts (read first)

- Installed app: `C:\Users\Julius\AppData\Local\Beatform\Beatform.exe`
  (`(Get-Item <path>).VersionInfo.ProductVersion`); uninstall registry
  `HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Beatform`
  (`DisplayVersion`).
- Bundled ffmpeg (probe exports, generate test media):
  `C:\Users\Julius\AppData\Local\Beatform\ffmpeg.exe`.
- Autosave file: `%APPDATA%\com.olanga.audiovisualizer\autosave.bfproj`.
- The WebGPU canvas is **invisible to standard screen capture** of the WebView2
  window — never judge visuals from screenshots; judge from exported files,
  UI chrome, or the owner's eyes.
- Native Win32 file dialogs: automate by typing the full path into the
  file-name field + Enter.
- Scratch folder: `C:\bf-test\` (`media`, `models`, `dl`, `out`, `e2e-cache`,
  `e2e-corpus`) — the lyrics fixtures: all seven models, the unpacked CUDA
  whisper build, four CC-BY / public-domain sung test tracks as 44.1 kHz
  WAVs, the synthetic bed for the timing probe.
- Lyrics harness env: `BEATFORM_LYRICS_CACHE=C:/bf-test/e2e-cache`,
  `BEATFORM_LYRICS_CORPUS=C:/bf-test/e2e-corpus`,
  `BEATFORM_LYRICS_OUT=C:/bf-test/out/e2e`, `BEATFORM_LYRICS_TIER=turbo`,
  always `--skip-dense` (the dense-mix fixture did not move with the machine).
- Lyrics quality bench: the owner's real test collection lives in
  `C:\Users\Julius\OneDrive\Music\bf-lyrics-testsongs` (six English songs
  with line-synced `.lrc` references, one German rap track without); decoded
  44.1 kHz copies, their isolated stems and the references sit in
  `C:\bf-test\songs\{mix,stem}` + `<slug>.ref.lrc`, with `langs.json` pinning
  each song's language. `node scripts/lyrics-eval.mjs --config <name>` scores
  the sidecar against the references (WER, wrong lines, true/false flags,
  line-start timing around the reference's own per-song shift);
  `--mode replay` runs whisper-cli here with any flags and replays its JSON
  through the real VAD/assembly/alignment stages (`--whisper-json`), cached
  per config; `--json-from <config>` reuses another config's transcript for
  aligner experiments. Results and transcripts: `C:\bf-test\out\eval\<config>`.
- `BEATFORM_DEV_MONITOR=secondary` (debug builds only) parks the operator
  window on the largest non-primary monitor — the Huawei 1080p screen on the
  left — so harness runs and `tauri dev` stay off the main screen; a monitor
  index works too.
- WebGPU here: every powerPreference resolves to the NVIDIA adapter
  (probed 2026-10-13); the AMD iGPU never wins the adapter request.

## Next batch — 2026-10-13, GPU lyrics (open)

- **A3 — Lyric Stage by ear, Large v3 Turbo on CUDA.** Generate lyrics for a
  real song with the GPU pack installed and Turbo selected; watch Lyric
  Stage in Stage mode. Expected: words light when sung (the timing probe
  measures spoken words within 100 ms median; sung melisma is the owner's
  call), no line seconds early at an instrumental intro, the language
  picked is the song's. Judge: the owner's ears.
- **A4 — First GPU run on this card.** With a fresh driver cache, the first
  CUDA transcription paid ~40-90 s once: the driver JIT-compiles the pack's
  sm_90 PTX for Blackwell (pinned 2026-10-13 — `CUDA_CACHE_DISABLE=1` brings
  the cost back on every run). Expected: the panel's "first GPU run" hint
  reads true once and the second run is seconds.
- **A6 — The 27 pixel cases that moved with the GPU.** `npm run test:gpu`
  against the Iris Xe baselines on this card: 321 of 348 cases bit-identical,
  27 moved — oscilloscope (every variant, max 2 levels), the seven feedback
  export-walks, every transition mid-frame, the three backgrounds, Builder
  defaults and deep/spectrum-bars by 1-3 levels; metaballs feedback
  export-walk by more (feedback accumulation, max 147 on one pixel) and the
  glitch transition by more (its noise hash, rgbMAE 11). Baselines re-blessed
  on this card (strict policy R2-16: a GPU change IS the reviewed change).
  Owner's eyes: glitch and metaballs feedback on a real track look as before.
- **A5 — The pack offer on the laptop path.** On a PC without an NVIDIA
  driver (or with `nvcuda.dll` renamed in a VM): no Download GPU acceleration
  button, the hint names the CPU, Small is recommended.
- **A7 — The flags mean something now.** Generate lyrics for the seven bench
  songs (the GPU pack; Large v3 is what this card gets recommended, Turbo
  the faster second) and open the editor. Measured 2026-10-13 against the
  references: before, Enter Sandman came back as 110 copies of one unsung
  line and 63 % of all lines were flagged; after (whisper on the isolated
  vocal, no text context carried between windows, whisper's own word
  certainty merged into the aligner's reading) the loops are gone, word
  error over the six English songs is 22 % with Turbo and 18 % with Large
  v3, and red flags are a few per song — where red means both whisper and
  the aligner doubted the words.
  Expected by ear: a red line is wrong or garbled often enough to be worth
  the click; amber lines (soft, breathy, processed or backing vocals) are
  mostly right; the German track transcribes as German. Known limit: a
  confident mishearing by whisper (an invented but plausible word) can pass
  unflagged — the aligner cannot tell it from soft singing.

## Sign-off

Record evidence here when an item goes green (date, installed version, HEAD,
one line of evidence).
