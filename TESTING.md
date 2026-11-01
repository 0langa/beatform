# Beatform — manual acceptance checklist

**Reusing this file:** when the next batch opens, add its items under a
dated heading, update the "State as of" line, and keep the environment facts
current — never start a parallel document.

**State as of 2026-10-13:** new machine (discrete GPU, Ryzen 9 9900X,
31 GB RAM, Windows 11 Pro); the GPU lyrics batch below is open. The
automated device gates guard every surface they can; items land here only
when automation cannot judge them.

## Environment facts (read first)

- Installed app: the executable `BEATFORM_EXE` points at
  (`(Get-Item $env:BEATFORM_EXE).VersionInfo.ProductVersion`); uninstall registry
  `HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Beatform`
  (`DisplayVersion`).
- Bundled ffmpeg (probe exports, generate test media): the `ffmpeg.exe`
  beside that install.
- Autosave file: `%APPDATA%\com.olanga.audiovisualizer\autosave.bfproj`.
- The WebGPU canvas is **invisible to standard screen capture** of the WebView2
  window — never judge visuals from screenshots; judge from exported files,
  UI chrome, or the owner's eyes.
- Native Win32 file dialogs: automate by typing the full path into the
  file-name field + Enter.
- Lyrics fixtures live where the harness env points: `BEATFORM_LYRICS_CACHE`,
  `BEATFORM_LYRICS_CORPUS`, `BEATFORM_LYRICS_MODELS`, `BEATFORM_LYRICS_OUT`,
  `BEATFORM_LYRICS_SONGS`, and the timing-probe bed `BEATFORM_LYRICS_BED`.
  That set holds all seven models, the unpacked CUDA whisper build, four
  CC-BY / public-domain sung test tracks as 44.1 kHz WAVs, and the synthetic
  bed for the timing probe.
- Lyrics harness env: `BEATFORM_LYRICS_CACHE`, `BEATFORM_LYRICS_CORPUS`,
  `BEATFORM_LYRICS_OUT`, `BEATFORM_LYRICS_TIER=turbo`, `BEATFORM_EXE` for the
  app under test, always `--skip-dense` (the dense-mix fixture did not move
  with the machine).
- Lyrics quality bench: the owner's real test collection is
  `BEATFORM_LYRICS_SONGS` (six English songs with line-synced `.lrc`
  references, one German rap track without); decoded 44.1 kHz copies, their
  isolated stems and the references sit in that directory as
  `{mix,stem}` + `<slug>.ref.lrc`, with `langs.json` pinning each song's
  language. `node scripts/lyrics-eval.mjs --config <name>` scores the sidecar
  against the references (WER, wrong lines, true/false flags, line-start
  timing around the reference's own per-song shift); `--mode replay` runs
  whisper-cli here with any flags and replays its JSON through the real
  VAD/assembly/alignment stages (`--whisper-json`), cached per config;
  `--json-from <config>` reuses another config's transcript for aligner
  experiments. Results and transcripts: `BEATFORM_LYRICS_OUT` / `<config>`.
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
- **A4 — First GPU run on a new card.** With a fresh driver cache, the first
  CUDA transcription paid ~40-90 s once: the driver JIT-compiles the pack's
  PTX for the installed GPU (pinned 2026-10-13 — `CUDA_CACHE_DISABLE=1` brings
  the cost back on every run). Expected: the panel's "first GPU run" hint
  reads true once and the second run is seconds.
- **A6 — The 27 pixel cases that moved with the GPU.** `npm run test:gpu`
  against the previous GPU's baselines on the current card: 321 of 348
  cases bit-identical,
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
  songs (the GPU pack; Large v3 is what the discrete GPU gets recommended, Turbo
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
- **A8 — The look kit on every visual.** Open any visual's settings and the
  expert rows now carry the shared finishing knobs the mode did not own
  (Mirror, Angle, Spin, Beat zoom, Beat flash, Hue spin, Grain, Scanlines,
  Low/High edge). Expected: every default look is pixel-identical to 3.1.0
  (the GPU matrix's @defaults and style cases did not move — except
  Gatefold's Turntable, which pairs Spin with Scanlines — only the extreme
  sweeps of the fourteen kit modes did); Mirror folds the frame into the
  club's 2-12 wedges, Angle/Spin turn the whole frame and follow
  Motion→Rotation, the beat knobs follow Motion→Pulse, the spectrum window
  audibly narrows what the mode reacts to. Grain and Scanlines stay in
  screen space: with Spin or Angle set the picture turns while the lines
  stay horizontal, under a Mirror the grain is not mirrored, and on a
  Transparent background with Grain up a PNG-sequence frame's empty area
  stays empty (no speckled alpha). `node scripts/preset-frames.mjs --cases
<json> --out <dir>` renders any mode at any values to PNGs (needs Vite
  running). Owner's eyes: the four new looks on Spectro Falls, Lyric Stage,
  Gatefold and Overgrowth (CRT Monitor … Ember Moss) read as designed
  looks, not knob demos.

## Sign-off

Record evidence here when an item goes green (date, installed version, HEAD,
one line of evidence).
