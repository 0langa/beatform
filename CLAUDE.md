# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Beatform — desktop music visualizer. Tauri 2 (Rust) + React 19 + TypeScript + WebGPU (Canvas2D fallback). Free open source, GitHub Releases only; never propose paid tiers, cloud services or store distribution.

## Commands

```bash
npm install
node scripts/fetch-ffmpeg.mjs          # one-time: ffmpeg sidecar (~110 MB, not in git)
node scripts/fetch-whisper.mjs         # one-time: whisper.cpp runtime (lyrics)
node scripts/fetch-onnxruntime.mjs     # one-time: onnxruntime + DirectML (lyrics)
node scripts/build-lyrics-sidecar.mjs  # build lyrics sidecar exe — REQUIRED before any cargo command works (tauri bundle resource must exist)

npm run dev            # browser dev at localhost:1420 (fastest iteration)
npm run tauri dev      # full desktop shell
npm run tauri build    # installer (needs all sidecars fetched/built)

npx vitest run src/state/project.test.ts        # single file
npx vitest run -t "pattern"                      # single test by name
```

Quality gates are canonically defined in **`GATES.md`** — if anything below disagrees with it, GATES.md wins. Quoting it:

```
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

```
cargo fmt --all -- --check                              # from src-tauri/
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

ALWAYS `--workspace`/`--all` on cargo commands — bare cargo silently skips the lyrics-sidecar member (fmt included).

Device/E2E gates (need hardware; GATES.md §3 says when each is mandatory, and carries the `test:gpu` re-bless protocol):

- `npm run test:gpu` — WebGPU pixel-hash matrix over all visual modes. Shader changes alter hashes: verify visually, then re-bless with `npm run test:gpu:update` and justify in the commit.
- `npm run test:loopback:built`, `npm run test:shadertoy:built`, `npm run test:lyrics` — built-app smokes (loopback capture, Shadertoy import, lyrics pipeline).
- `node scripts/gallery-e2e.mjs` — gallery/store-install surfaces.

`src/audio/dspCharacterization.test.ts` is no longer flaky: its only failure mode was vitest's 5 s default timeout under thermal load, root-fixed with explicit 30 s describe budgets — a failure there is real; reruns are not the protocol.

## Architecture

`README.md` has the directory map. The load-bearing concepts:

- **Determinism law (the core invariant):** preview and export must resolve identical frames from the same project document. Everything time-dependent resolves from _track time_, never wall clock, through shared chokepoints: `src/state/frameResolve.ts`, `src/export/buildExportOptions.ts`, and the overlay compose path. Presets are pure functions of `(AudioFeatures, time, params)`. Any feature touching rendering must go through these chokepoints or it will silently diverge between preview and export. Golden traces + the GPU pixel matrix guard this.
- **Audio → render contract:** `src/audio/types.ts` (`AudioFeatures`) is the only thing renderers see. Live (`realtimeSource`) and offline (`offlineSource`) drive the same `featurePipeline` DSP.
- **Document model:** the zustand store's document slice (`src/state/store.ts`) is what serializes into project files. `project.ts` owns the schema + numbered migrations (`schemaVersion`); themes/user presets/builder stacks/shader files are sibling versioned JSON formats sharing the migration approach. Never change persisted shape without a migration and a test.
- **New visual mode** = one file in `src/render/presets/` + registry entry in `presets/index.ts`. Preset IDs are persisted forever (projects, looks, localStorage) — never rename an ID without a `canonicalPresetId` migration.
- **Rust side:** `src-tauri/src/lib.rs` registers all commands. Filesystem access is scope-gated (dialog grants scope; commands check `fs_scope`). Long child processes: ffmpeg sidecar (ProRes/AV1/GIF/WebP), lyrics sidecar (`src-tauri/lyrics-sidecar/` workspace member — whisper.cpp + MDX-Net vocal isolation + wav2vec2 word alignment, JSON event protocol on stdout).
- **Export pipeline** runs in a worker (`exportCore.ts` env-agnostic, `videoExporter.ts` orchestrates, desktop streams to disk via sidecar/fragmented MP4).

## Project rules

- `BACKLOG.md` is the canonical work ledger — read it before starting feature work, update it when finishing. `CHANGELOG.md` is **user-facing UI** (the update dialog imports it): entries must read as release notes, and editing it while the dev server runs reloads the app.
- Never use `window.confirm`/`alert` — blocked by the Tauri dialog-plugin ACL. Use `askConfirm()` (`src/state/platform.ts`); an eslint rule enforces this.
- Web MIDI: never extract `navigator.requestMIDIAccess` into a local (Illegal invocation, silently swallowed); WebView2 permission is granted in `src-tauri/src/midi_permission.rs`, installed from `on_page_load` (windows don't exist yet in `setup`).
- Release ritual: `node scripts/release.mjs X.Y.Z --title "..."` — one resumable command (bump → changelog scaffold → commit+tag+push → CI watch → publish → verify). The full checklist it automates is GATES.md §4; `gh` on this machine needs the env PAT stripped (the script does it — equivalent of `env -u GITHUB_TOKEN`).
- v3.0.0 is a quality bar, not a milestone — keep shipping 2.x; never propose cutting 3.0.
