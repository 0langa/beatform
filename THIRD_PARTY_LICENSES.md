# Third-party components

## Local lyrics pipeline (sidecar binaries, runtimes and models)

The "Generate lyrics" feature runs entirely on-device through a separate
sidecar executable (`lyrics-sidecar.exe`, built from `src-tauri/lyrics-sidecar`
in this repository) that orchestrates the following third-party components:

- **whisper.cpp** (<https://github.com/ggml-org/whisper.cpp>) — bundled as an
  unmodified binary build (`whisper-cli.exe` + ggml runtime DLLs, release
  v1.9.1, pinned by SHA-256 in `scripts/fetch-whisper.mjs`) and spawned as an
  external process for speech-to-text. License: **MIT** (The ggml authors).
  The bundled `libopenblas.dll` is **BSD-3-Clause** (OpenBLAS). Full texts:
  `WHISPER-LICENSE.txt` next to the binaries.
- **Whisper models** (OpenAI; ggml conversions from
  <https://huggingface.co/ggerganov/whisper.cpp>) — downloaded on first use
  from Beatform's pinned mirror
  (<https://github.com/beatform-app/models/releases/tag/v1>), SHA-256-verified
  in-app. License: **MIT** (OpenAI Whisper weights).
- **Ultimate Vocal Remover (UVR) MDX-Net vocal model**
  (`UVR-MDX-NET-Voc_FT.onnx`) — trained and published by the UVR project
  (<https://github.com/Anjok07/ultimatevocalremovergui>), downloaded on first
  use from the same pinned mirror, SHA-256-verified. License: **MIT**, per the
  UVR project's stated terms, which ask third-party applications to credit
  UVR — **vocal isolation in Beatform is powered by UVR's MDX-Net models;
  thank you to the UVR developers.** (The credit also appears in-app in the
  lyrics feature and the user guide.)
- **ONNX Runtime** (<https://github.com/microsoft/onnxruntime>) — bundled as
  the unmodified official `onnxruntime.dll` (DirectML build, version pinned by
  SHA-256 in `scripts/fetch-onnxruntime.mjs`), loaded dynamically by the
  sidecar for MDX-Net inference. License: **MIT** (Microsoft). Full text:
  `ONNXRUNTIME-LICENSE.txt` next to the binary.
- **DirectML** (`DirectML.dll`, from the `Microsoft.AI.DirectML` NuGet
  package, version pinned by SHA-256 in the same script) — the GPU-execution
  backend for vocal isolation on machines with a DirectX 12 adapter.
  License: **Microsoft Software License Terms for DirectML** — a proprietary
  but redistribution-permitted license for applications built with machine
  learning frameworks on Windows; it is NOT open source, and like the LGPL
  FFmpeg build it ships as a clearly-separated, unmodified redistributable
  next to the app with its full license text (`DIRECTML-LICENSE.txt` and
  `DIRECTML-ThirdPartyNotices.txt` next to the binary). The feature falls
  back to CPU when DirectML is unavailable.

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

| Crate                                             | Purpose                                                | License           |
| ------------------------------------------------- | ------------------------------------------------------ | ----------------- |
| `tauri`, `tauri-plugin-dialog`, `tauri-plugin-fs` | Desktop shell, native dialogs, filesystem access       | MIT OR Apache-2.0 |
| `cpal`                                            | Cross-platform audio I/O (WASAPI loopback capture)     | Apache-2.0        |
| `lofty`                                           | Audio metadata/tag reading for the library scanner     | MIT OR Apache-2.0 |
| `walkdir`                                         | Recursive directory traversal for the library scanner  | MIT OR Unlicense  |
| `serde`, `serde_json`                             | Serialization                                          | MIT OR Apache-2.0 |
| `reqwest`, `rustls`, `sha2`                       | Verified lyrics-model downloads (also used by updater) | MIT OR Apache-2.0 |
| `ort` (lyrics sidecar)                            | ONNX Runtime bindings for MDX-Net vocal isolation      | MIT OR Apache-2.0 |
| `realfft` (lyrics sidecar)                        | Real-signal STFT for the MDX-Net pipeline              | MIT               |
| `rustfft` (lyrics sidecar)                        | FFT engine under `realfft`                             | MIT OR Apache-2.0 |

These and their transitive dependencies are overwhelmingly dual-licensed
`MIT OR Apache-2.0` (the Rust ecosystem convention). The authoritative,
complete list with exact versions is `src-tauri/Cargo.lock`; a full
license manifest can be regenerated at any time with `cargo license` or
`cargo about` against that lockfile. No crate in the tree carries a strong
copyleft (GPL/AGPL) license; five transitive dependencies (`option-ext`,
`selectors`, `cssparser`, `cssparser-macros`, `dtoa-short`) are MPL-2.0, a
weak file-level copyleft whose source-availability obligation is met by the
unmodified crates.io distribution.

The bundled **ffmpeg** sidecar is a separate LGPL binary, not linked — see
`binaries/FFMPEG-LICENSE.txt`.

Everything else in this repository is original code under the repository's
own MIT license; JavaScript dependencies carry their own licenses via npm.
