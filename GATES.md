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
- No suite in `src/audio/` is flaky, and none of them needs a rerun. Their
  one former failure mode was vitest's 5 s per-test DEFAULT timeout under
  full-suite parallelism, root-fixed with explicit `{ timeout: 30_000 }`
  **describe** budgets in every suite that spends seconds on real work:
  `dspCharacterization`, `featurePipelineFuzz`, `realtimeSource`,
  `syncLatency`, `offlineSource`, `engineGraph` and `dsp/truepeak`. A
  failure in any of them is a logic failure. Rerunning, `--maxWorkers=2`
  and shrinking a fixture are all non-answers — if a NEW suite starts
  timing out, give it a describe budget and say why in the file.
  The budget belongs on the `describe`, not on individual `it`s: the
  per-test form leaves every test nobody measured on the 5 s default, which
  is exactly how `featurePipelineFuzz` stayed red long after the suites
  around it were fixed.

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

The GPU matrix owns its full dev lifecycle: `npm run test:gpu` launches
`tauri dev`, whose `beforeDevCommand` starts Vite. **Do not pre-start Vite for
this gate**; doing so races the matrix for ports 1420/1421. No environment
pin is needed: the bare command is the supported form.

The other device harnesses launch an already-built debug shell and attach CDP
to it; they do not invoke `tauri dev`. Build the shell first (`cargo build` in
`src-tauri/`), then start Vite separately — plain `npm run dev` is the
supported form for these too.

**The bind (E3f, resolved 2026-08-13).** Vite's default is `127.0.0.1`, set
in `vite.config.ts` — never `host: false`, which bound whatever Node
resolves "localhost" to (`[::1]` on this machine) while tauri probed its
devUrl as 127.0.0.1 and waited forever, blaming the server that was READY.
The server stays off the LAN; consumers that dial `http://localhost:1420`
(the built-shell harnesses' WebView2, browsers) reach it through address
fallback — `[::1]` refuses fast, `127.0.0.1` answers. Proven on device
against this exact default: bare `test:gpu` (the full matrix green — 269
cases then; the baseline has since grown),
`test:shadertoy:built` (60 deterministic frames) and `test:loopback:built`
all green with no `TAURI_DEV_HOST` set. `TAURI_DEV_HOST` remains an
OVERRIDE for LAN/device work, not a prerequisite.

The harnesses share `scripts/lib/` (isolated WebView2 profiles, per-harness
debug ports, PID-tree-only kills) — see the port map in
`scripts/lib/app.mjs`. A leftover dev server from an older checkout can
still hold the port; `spawnApp` stamps whatever answers the URL against
this checkout's `public/icon.svg` and fails with "a different dev server is
already serving …" instead of the misleading "Cannot find execution
context".

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

After the tag (the `Release installers` workflow runs the same
release-critical web and Rust gates, then builds and uploads; dependency
audits remain CI/PR-only per section 5):

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

Release-critical web and Rust gates must stay aligned between both workflows.
Dependency audits are the intentional exception: they block CI/PR but not a
tag build. Change gate policy HERE first, then update every affected workflow
in the same commit.
