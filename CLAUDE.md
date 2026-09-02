# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working with code in this repository.

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

Quality gates canonically defined in **`GATES.md`** — if anything below disagrees, GATES.md wins. Quoting it:

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

ALWAYS `--workspace`/`--all` on cargo commands — bare cargo silently skips lyrics-sidecar member (fmt included).

Device/E2E gates (need hardware; GATES.md §3 says when each is mandatory, carries `test:gpu` re-bless protocol):

- `npm run test:gpu` — WebGPU pixel-hash matrix over all visual modes. Shader changes alter hashes: verify visually, then re-bless with `npm run test:gpu:update` and justify in commit.
- `npm run test:loopback:built`, `npm run test:shadertoy:built`, `npm run test:lyrics` — built-app smokes (loopback capture, Shadertoy import, lyrics pipeline).
- `node scripts/gallery-e2e.mjs` — gallery/store-install surfaces.

No `src/audio/` suite is flaky: only failure mode was vitest's 5 s per-test default timeout under full-suite parallelism, root-fixed with explicit 30 s **describe** budgets in every suite doing seconds of real work (`dspCharacterization`, `featurePipelineFuzz`, `realtimeSource`, `syncLatency`, `offlineSource`, `engineGraph`, `dsp/truepeak`). A failure there is real; reruns, `--maxWorkers=2` and smaller fixtures are not the protocol — GATES.md §1 has rule for new suites.

## Architecture

`README.md` has directory map. Load-bearing concepts:

- **Determinism law (the core invariant):** preview and export must resolve identical frames from same project document. Everything time-dependent resolves from _track time_, never wall clock, through shared chokepoints: `src/state/frameResolve.ts`, `src/export/buildExportOptions.ts`, overlay compose path. Presets are pure functions of `(AudioFeatures, time, params)`. Any feature touching rendering must go through these chokepoints or it silently diverges between preview and export. Golden traces + GPU pixel matrix guard this.
- **Audio → render contract:** `src/audio/types.ts` (`AudioFeatures`) is the only thing renderers see. Live (`realtimeSource`) and offline (`offlineSource`) drive same `featurePipeline` DSP.
- **Document model:** zustand store's document slice (`src/state/store.ts`) serializes into project files. `project.ts` owns schema + numbered migrations (`schemaVersion`); themes/user presets/builder stacks/shader files are sibling versioned JSON formats sharing that migration approach. Never change persisted shape without a migration and a test.
- **New visual mode** = one file in `src/render/presets/` + registry entry in `presets/index.ts`. Preset IDs are persisted forever (projects, looks, localStorage) — never rename an ID without a `canonicalPresetId` migration.
- **Rust side:** `src-tauri/src/lib.rs` registers all commands. Filesystem access is scope-gated (dialog grants scope; commands check `fs_scope`). Long child processes: ffmpeg sidecar (ProRes/AV1/GIF/WebP), lyrics sidecar (`src-tauri/lyrics-sidecar/` workspace member — whisper.cpp + MDX-Net vocal isolation + wav2vec2 word alignment, JSON event protocol on stdout).
- **Export pipeline** runs in a worker (`exportCore.ts` env-agnostic, `videoExporter.ts` orchestrates, desktop streams to disk via sidecar/fragmented MP4).

## Project rules

- `BACKLOG.md` is canonical work ledger — read before starting feature work, update when finishing. Completed eras frozen verbatim under `archive/ledgers/` (read-only history; never reopen archived rows — live ledger wins on conflict). `CHANGELOG.md` is **user-facing UI**: update dialog fetches it from GitHub (`raw.githubusercontent.com/<tag>`, falling back to `main`), so entries must read as release notes — local edit is invisible to a running app until pushed.
- Never use `window.confirm`/`alert` — blocked by Tauri dialog-plugin ACL. Use `askConfirm()` (`src/state/platform.ts`); eslint rule enforces this.
- Web MIDI: never extract `navigator.requestMIDIAccess` into a local (Illegal invocation, silently swallowed); WebView2 permission granted in `src-tauri/src/midi_permission.rs`, installed from `on_page_load` (windows don't exist yet in `setup`).
- Release ritual: `node scripts/release.mjs X.Y.Z --title "..."` — one resumable command (bump → changelog scaffold → commit+tag+push → CI watch → publish → verify). Full checklist it automates is GATES.md §4; `gh` on this machine needs env PAT stripped (script does it — equivalent of `env -u GITHUB_TOKEN`).
- v3.0.0 is a quality bar, not a milestone — keep shipping 2.x; never propose cutting 3.0.
