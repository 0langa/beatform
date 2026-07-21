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

## mediabunny (bundled JavaScript library)

The WebM (VP9 + alpha) export path uses **mediabunny**
(<https://github.com/Vanilagy/mediabunny>), bundled into the application
JavaScript like any other npm dependency.

- License: **Mozilla Public License 2.0** (file-level copyleft). The library
  is used unmodified; its complete corresponding source is available from the
  npm package (`mediabunny`, version pinned in `package-lock.json`) and the
  repository above, which satisfies MPL-2.0 source availability.

## Rust crates (statically linked into the desktop binary)

The desktop app (`src-tauri`) links a Rust dependency tree of ~450 crates,
locked in `src-tauri/Cargo.lock`. The direct dependencies are:

| Crate                                             | Purpose                                               | License           |
| ------------------------------------------------- | ----------------------------------------------------- | ----------------- |
| `tauri`, `tauri-plugin-dialog`, `tauri-plugin-fs` | Desktop shell, native dialogs, filesystem access      | MIT OR Apache-2.0 |
| `cpal`                                            | Cross-platform audio I/O (WASAPI loopback capture)    | Apache-2.0        |
| `lofty`                                           | Audio metadata/tag reading for the library scanner    | MIT OR Apache-2.0 |
| `walkdir`                                         | Recursive directory traversal for the library scanner | MIT OR Unlicense  |
| `serde`, `serde_json`                             | Serialization                                         | MIT OR Apache-2.0 |

These and their transitive dependencies are overwhelmingly dual-licensed
`MIT OR Apache-2.0` (the Rust ecosystem convention). The authoritative,
complete list with exact versions is `src-tauri/Cargo.lock`; a full
license manifest can be regenerated at any time with `cargo license` or
`cargo about` against that lockfile. No crate in the tree carries a
copyleft (GPL/AGPL) license.

The bundled **ffmpeg** sidecar is a separate LGPL binary, not linked — see
`binaries/FFMPEG-LICENSE.txt`.

Everything else in this repository is original code under the repository's
own MIT license; JavaScript dependencies carry their own licenses via npm.
