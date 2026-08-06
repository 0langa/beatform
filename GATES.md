# GATES.md — the release-gate manifest

This file is the **single canonical definition** of every quality gate in
this repository. `CLAUDE.md`, `CONTRIBUTING.md` and `BACKLOG.md` quote it;
`.github/workflows/ci.yml` and `release.yml` implement it. If any of those
ever disagree with this file, **this file wins and the other is drift** —
fix the drift, don't fork the definition. (The 2026-08 audit found three
contradicting gate definitions living in parallel; that is how two releases
shipped off a main that was failing `format:check`.)

## 1. Web gates — every change

```
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Notes:

- `npm test` is vitest over the whole web suite (DSP, schemas, golden
  traces). `-- --maxWorkers=2` is an allowed local variation under thermal
  load; it changes scheduling, not coverage.
- `src/audio/dspCharacterization.test.ts` is not flaky: its former failure
  mode (vitest's 5 s default timeout under thermal load) is root-fixed with
  explicit 30 s describe budgets. A failure there is real; reruns are not
  the protocol.

## 2. Rust gates — every change touching `src-tauri/`, and always before release

Run from `src-tauri/` (or add `--manifest-path src-tauri/Cargo.toml` from
the repo root — same commands):

```
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

**ALWAYS `--workspace` / `--all`.** `src-tauri` is a non-virtual workspace
root, so bare `cargo test` / `cargo clippy` / `cargo fmt` silently cover
ONLY the app package and skip the `lyrics-sidecar` member — a green run
that never compiled its tests. (`fmt` spells the flag `--all`; the others
spell it `--workspace`.)

CI narrows the test invocation to `cargo test --workspace --lib --bins` to
bound runtime; neither crate has integration-test dirs, so today that is
the same coverage minus doc-tests. The canonical local form stays
`cargo test --workspace`.

Prerequisite once per clone: all four sidecar steps
(`fetch-ffmpeg` / `fetch-whisper` / `fetch-onnxruntime` /
`build-lyrics-sidecar`) — tauri's build script validates bundled resources
at COMPILE time, so no cargo command works until they exist.

## 3. Device gates — need this machine's hardware; mandatory per touched area, and before a release that touched the area

| Gate             | Command                                                            | Mandatory when                                                                                            |
| ---------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| GPU pixel matrix | `npm run test:gpu`                                                 | Shader, renderer, preset params, color, presentation, or export-pixel code changed                        |
| Gallery E2E      | `node scripts/gallery-e2e.mjs`                                     | Gallery or store-install surfaces changed (registry load, verified download, install/apply state, dialog) |
| Loopback smoke   | `npm run test:loopback:built` and `npm run test:loopback:built:30` | Native audio capture, timing, packaging, or Tauri integration changed                                     |
| Shadertoy smoke  | `npm run test:shadertoy:built`                                     | Shadertoy import, transpiler, or compat pipeline changed                                                  |
| Lyrics E2E       | `npm run test:lyrics` (`test:lyrics:quick` for the short leg)      | Lyrics sidecar, models, alignment, or correction editor changed                                           |

Device-gate prerequisites: a debug build of the shell
(`cargo build` in `src-tauri/`) and Vite dev serving 127.0.0.1:1420.
The harnesses share `scripts/lib/` (isolated WebView2 profiles, per-harness
debug ports, PID-tree-only kills) — see the port map in
`scripts/lib/app.mjs`.

**GPU-matrix re-bless protocol** (when `test:gpu` reports hash deltas):
a shader change legitimately alters pixel hashes. Verify the change
VISUALLY first (device screenshots / wave-shots evidence), confirm the
delta is confined to the modes you touched, then re-bless with
`npm run test:gpu:update` and justify the re-bless in the commit message.
Never re-bless to silence a delta you cannot explain.

## 4. Release-time verification set

Automated by `node scripts/release.mjs` (steps 5–7 of its flow); the
checklist stays here as the definition of done:

Before tagging:

- Working tree clean, on `main`.
- Full web + Rust gates green; device gates green for every touched area.
- `node scripts/bump-version.mjs --verify` — the five version-bearing
  files agree (package.json, tauri.conf.json, Cargo.toml, Cargo.lock,
  src/version.ts).
- `CHANGELOG.md` has a real section for the version (it is user-facing UI —
  the update dialog renders it).

After the tag (the `Release installers` workflow runs the same gate set as
`ci.yml`, then builds and uploads):

- Workflow green; DRAFT release exists with assets.
- Publish: `gh release edit vX.Y.Z --draft=false --title "Beatform vX.Y.Z" --latest`.
- **SHA256SUMS match**: recompute SHA-256 of the downloaded
  `Beatform_X.Y.Z_x64-setup.exe`; it must equal the `SHA256SUMS.txt` entry.
- **Signed manifest**: `latest.json` carries a non-empty
  `platforms["windows-x86_64"].signature` (the updater verifies it against
  the pubkey pinned in `tauri.conf.json`) and its `url` points at the
  vX.Y.Z setup asset.
- **Live endpoint**: `releases/latest/download/latest.json` serves
  `version == X.Y.Z` (installed apps poll this exact URL).
- Installed-artifact smoke (`scripts/installed-runtime-smoke.mjs` or
  manual): source/dev server alone is insufficient.
- ALIGN-002 regression check: after the installed app auto-updates, the
  HKCU uninstall entry's `DisplayVersion` equals the new binary's version.

## 5. Where each gate runs in CI

| Gate                                                    | `ci.yml` (push/PR) | `release.yml` (tag)                              |
| ------------------------------------------------------- | ------------------ | ------------------------------------------------ |
| typecheck / lint / format:check / `npm test`            | `checks` job       | yes                                              |
| `npm run build`                                         | `checks` job       | via `npm run tauri build` (`beforeBuildCommand`) |
| `cargo fmt --all -- --check`                            | `rust` job         | yes                                              |
| `cargo clippy --workspace --all-targets -- -D warnings` | `rust` job         | yes                                              |
| `cargo test --workspace --lib --bins`                   | `rust` job         | yes                                              |
| `npm audit` / `cargo audit`                             | `audit` job        | no (dependency hygiene, not a release blocker)   |
| Device gates (section 3)                                | no — need hardware | no — run locally per touched area before tagging |

If a gate is worth blocking a PR, it is worth blocking a release: the two
workflows must keep running the same set. Change gates HERE first, then in
both workflows in the same commit.
