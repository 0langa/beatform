# Beatform

Beatform is a free, open-source music visualizer for Windows. Drop a track in,
get a beat-locked video out. Preview and export share one creative definition;
exact guarantees and measured tolerances are documented in the
[preview/export truth contract](PREVIEW-EXPORT-CONTRACT.md).

**[Download the latest release](https://github.com/0langa/beatform/releases/latest)**
(NSIS installer or MSI + SHA256 checksums). No account, no cloud, no telemetry;
GitHub is the only channel and everything is free forever.

## Fifteen minutes to a finished video

1. **Install and open.** Three synthesized demo tracks are built in — press
   play on one to see everything moving before you touch a file of your own.
2. **Drop your track** anywhere on the window (MP3/FLAC/WAV/OGG/M4A). The app
   reads its tags, detects BPM + key, and locks grid-synced visuals to the
   real beats.
3. **Pick a look.** Sixteen visual modes across the top; each ships 5–7
   curated styles. Or open _Visuals ▸ Themes_ and click a factory
   theme — Cover Story, Hyperlane, Chrome Sunset, Ion Storm, and more — for a
   complete tuned setup in one click.
4. **Make it yours.** Press **G** for **Visuals**, the dock on the right —
   the picture makes room for it, so you can tune while you watch. Its
   section rail is the whole app in eight stops: _Mode_, _Motion_,
   _Themes_, _Sync_, _Modulation_, _Scene_, _Text_, _Live_. _Scene ▸
   Layers_ adds your title (auto-filled from tags), logo or album art;
   _Sync_ chooses what drives the motion (kicks, bass, melody, voice…);
   _Scene ▸ Post_ adds bloom, grain and vignette; _Modulation_ wires any
   audio feature straight onto a knob.
5. **Export.** One MP4 (H.264/HEVC/AV1), a transparent WebM (VP9 + alpha), a
   PNG sequence with alpha, or a ProRes 4444 `.mov` for your editor. The same
   project definition renders on an indexed export timeline; live reaction and
   cross-hardware pixels follow the documented parity tolerances.

## More

- **[User guide](guide)** — every surface, mode, and export option
- **[Themes (.bftheme)](templates)** — share a complete look as one file
- **[Preset SDK](presets)** — add a visual mode with one WGSL file
- **[Export design](EXPORT-DESIGN)** — indexed A/V timing and parity boundaries
- **[Contributing](https://github.com/0langa/beatform/blob/main/CONTRIBUTING.md)**

## Highlights

- **Beat-grid sync**: offline tempo tracking places beats on the audible
  transients (regression-tested: mean offset under 8 ms, worst case under
  12 ms); grid-locked visuals ride the real
  beats and fall back to onset pulses when a track has no grid.
- **Batch render**: drop 20 tracks in, get 20 titled videos out — titles come
  from each file's own tags. Unattended, per-job isolation.
- **Music library**: point at your folder once, click tracks to play,
  near-gapless auto-advance.
- **Listen to the system**: visualize whatever the PC is playing (Spotify, a
  browser, a DAW) via native loopback — live, no setup.
- **Deterministic export timeline**: indexed frame/audio timestamps, no
  accumulated A/V drift. Raw-frame repeatability and preview parity have
  explicit scope: [truth contract](PREVIEW-EXPORT-CONTRACT.md).
