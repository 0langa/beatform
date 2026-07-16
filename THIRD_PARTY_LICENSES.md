# Third-party components

## FFmpeg (sidecar binary)

The desktop app bundles an **FFmpeg** executable as a separate sidecar binary
(`ffmpeg.exe`, next to the app executable). It is used exclusively for the
ProRes 4444 export path; the app spawns it as an external process and pipes
rendered frames to it. It is not linked into the application.

- Build: BtbN FFmpeg-Builds, **LGPL** win64 build of FFmpeg 8.1
  (no GPL components — ProRes uses FFmpeg's native `prores_ks` encoder).
- License: GNU Lesser General Public License v2.1 or later.
  The full license text ships alongside the binary as
  `FFMPEG-LICENSE.txt` and is included in the repository at
  `src-tauri/binaries/FFMPEG-LICENSE.txt`.
- Source code: <https://ffmpeg.org> — the exact build is pinned in
  `scripts/fetch-ffmpeg.mjs` (BtbN autobuild tag + asset name), and sources
  for BtbN builds are available at
  <https://github.com/BtbN/FFmpeg-Builds>.

FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project.
This application is not affiliated with or endorsed by the FFmpeg project.

Everything else in this repository is original code under the repository's
own MIT license; JavaScript dependencies carry their own licenses via npm.
