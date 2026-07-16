# Audio Visualizer

Free, open-source music visualizer for Windows. Drop a track in, get a
beat-locked video out — live preview and exported file are the same render,
by construction.

**[Download the latest release](https://github.com/0langa/audio-visualizer/releases/latest)**
(NSIS installer or MSI + SHA256 checksums). No account, no cloud, no telemetry;
GitHub is the only channel and everything is free forever.

## Fifteen minutes to a finished video

1. **Install and open.** Three synthesized demo tracks are built in — press
   play on one to see everything moving before you touch a file of your own.
2. **Drop your track** anywhere on the window (MP3/FLAC/WAV/OGG/M4A). The app
   reads its tags, detects BPM + key, and locks grid-synced visuals to the
   real beats.
3. **Pick a look.** Sixteen visual modes across the top; each ships 5–7
   curated styles. Or open _Settings → Templates_ and click a factory pack —
   Trap Nation Classic, Midnight Phonk, Lo-fi Haze, Outrun Nights, and more —
   for a complete tuned setup in one click.
4. **Make it yours.** _Layers_ adds your title (auto-filled from tags), logo,
   or album art. _Sync_ chooses what drives the motion (kicks, bass, melody,
   voice…). _Post_ adds bloom, grain, vignette.
5. **Export.** One MP4 (H.264/HEVC/AV1), a PNG sequence with alpha, or a
   ProRes 4444 `.mov` for your editor. What you previewed is what renders —
   sync is sample-exact.

## More

- **[User guide](guide)** — every panel, mode, and export option
- **[Templates (.avtheme)](templates)** — share a complete look as one file
- **[Preset SDK](presets)** — add a visual mode with one WGSL file
- **[Export design](EXPORT-DESIGN)** — why preview and file can't drift
- **[Contributing](https://github.com/0langa/audio-visualizer/blob/main/CONTRIBUTING.md)**

## Highlights

- **Beat-grid sync**: offline tempo tracking places beats on the audible
  transients (±6 ms, regression-tested); grid-locked visuals ride the real
  beats and fall back to onset pulses when a track has no grid.
- **Batch render**: drop 20 tracks in, get 20 titled videos out — titles come
  from each file's own tags. Unattended, per-job isolation.
- **Music library**: point at your folder once, click tracks to play,
  near-gapless auto-advance.
- **Listen to the system**: visualize whatever the PC is playing (Spotify, a
  browser, a DAW) via native loopback — live, no setup.
- **Deterministic renders**: same input, byte-identical frames, every run.
