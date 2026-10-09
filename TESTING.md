# Beatform — v3.0.0 acceptance batch

The living manual-test checklist. Reset **2026-09-02** for the 3.0.0 release;
every earlier run (v2.44.1 → VERIFY-003, including the frozen 2026-07-27
acceptance batch and its sign-off) is preserved verbatim in
[archive/ledgers/TESTING-through-2026-08-04.md](archive/ledgers/TESTING-through-2026-08-04.md).

**Reusing this file:** when the next batch opens, reset the boxes, update the
"State as of" line, and replace the banner — never start a parallel document.

This batch is deliberately lean. The automated device gates (GATES.md §3: GPU
pixel matrix, export colorimetry, gallery E2E, loopback smokes, Shadertoy
smoke, lyrics E2E) guard every surface they can; the items below are only what
automation cannot judge — the owner's eyes and the install/update path.

**State as of:** _batch not yet opened — fill in the installed version and
repository HEAD when the last 2.x release (v2.110.x per
[docs/V3-RELEASE-PLAN.md](docs/V3-RELEASE-PLAN.md)) is installed._

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

## A — Owner checks (human; the two that survived the 2026-09-02 reset)

- [ ] **A1. Lyric Stage word timing (~3 min) — closes FEAT-004.** Load a song
      you know well (with vocals). _Visuals ▸ Text_ ▸ generate lyrics if none
      are present (small tier, auto language). Switch to **Lyric Stage**, play.
      PASS = words light up when the vocalist actually sings them — not
      noticeably early or late, sane line breaks, nothing embarrassing. Record
      the verdict here in one sentence.
- [ ] **A2. Second-display eyes (~5 min) — closes FEAT-009.** Press **D** →
      Perform drawer → open the output on the HDMI screen, play a track. Look:
      sharp and smooth on the big screen? Let it run ~5 min while using the
      operator window: any stutter, flicker, drift? Then the yank: pull the
      HDMI cable mid-show — expected: Windows relocates the window, the app
      keeps running, no crash; replug → reopen from the drawer → it re-places
      on the second screen. Also: with Preferences ▸ Performance ▸ frame cap
      at 30, the big screen must still run at display rate (2.110.0 lifts the
      cap while the mirror is live). Silence = pass; anything odd is filed in
      BACKLOG.md and fixed before the tag.

## D — Release path (agent-executable, run against the 3.0.0 candidate)

- [ ] **D1. Updater path into 3.0.0.** An installed 2.x app receives and
      installs the 3.0.0 offer through the live manifest (semver major bump):
      startup dialog names 3.0.0 with rendered notes, _Install now_ downloads,
      relaunches the new version with no UAC prompt. After: exe
      `ProductVersion` **and** HKCU `DisplayVersion` read `3.0.0` exactly
      (ALIGN-002 regression check).
- [ ] **D2. Fresh install on a clean profile.** Run the 3.0.0 setup on a
      profile that never had Beatform (or after uninstall + removing
      `%APPDATA%\com.olanga.audiovisualizer`): first run boots to the
      onboarding empty state, a demo track plays, one short MP4 export
      completes and decodes with the bundled ffmpeg (exit 0).
- [ ] **D3. Visuals dock + section rail device pass** (added in v2.81.0; the
      one surface never run on device). Open with **G** and check, in one
      pass: **Letterbox** — the canvas gives up the dock's width instead of
      hiding under it, at Fill and at 16:9; drag the dock's left edge
      end-to-end on a feedback mode (Echo Trails) and the trails must NOT
      strobe black — the picture snaps once, on release; keyboard on the same
      edge: arrows ±16 px, Shift ±48, Home/End hit 380/760. **Nothing floats
      over it** — **T** (timeline stops at the dock's edge), raise a toast (it
      centres in the canvas column), drag a file onto the window (the drop
      overlay stops at the dock), perf overlay in both right-hand corners with
      the dock at 760. **Rail** — eight destinations (Mode · Motion · Themes ·
      Sync · Modulation · Scene · Text · Live); clicking swaps the page; arrow
      keys walk it; the whole rail is ONE Tab stop; Modulation/Scene/Live show
      counts once you have routes, overlay layers or MIDI bindings; on **Voice
      Orb** or **LED Matrix** the **Motion** destination is dimmed, says why on
      hover, and is still clickable. **Stage round-trip** — **S** hides the
      dock, **S** again brings it back exactly as it was. **Idle** — play a
      track, hold the pointer still: top bar and player bar fade, the dock and
      its grip stay lit. **Library grip** — open the library (**Q**) with the
      dock CLOSED and drag its right edge. **Persistence** — pick a page,
      resize, relaunch: both come back.

## Sign-off

Record evidence here when an item goes green (date, installed version, HEAD,
one line of evidence). The tag is still the owner's explicit call — a green
batch prepares it, it never triggers it.
