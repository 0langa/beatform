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

## Sign-off

Record evidence here when an item goes green (date, installed version, HEAD,
one line of evidence).
