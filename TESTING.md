# Beatform — manual acceptance checklist

The living manual-test checklist. Reset **2026-10-12 at the v3.0.0 cut**; the
v3.0.0 batch with its sign-off is preserved verbatim in
[archive/ledgers/TESTING-through-v3.0.0.md](archive/ledgers/TESTING-through-v3.0.0.md),
every earlier run in the other archived batches.

**Reusing this file:** when the next batch opens, add its items under a
dated heading, update the "State as of" line, and keep the environment facts
current — never start a parallel document.

**State as of 2026-10-12:** installed app **v3.0.0** (fresh install on a clean
profile, boot smoke green); no batch open. The automated device gates
(GATES.md §3) guard every surface they can; items land here only when
automation cannot judge them.

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
- Scratch folder: `C:\bf-test\` (`media`, `out`).

## Next batch

_(not opened — add dated items here when 3.x work starts)_

## Sign-off

Record evidence here when an item goes green (date, installed version, HEAD,
one line of evidence).
