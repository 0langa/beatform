# Security Policy

Beatform is a free, open-source desktop app (Tauri 2 + Rust + WebGPU). There
is no cloud service, account system, or telemetry — the attack surface that
matters is the desktop app itself: the Rust shell, the bundled sidecars
(ffmpeg and the lyrics sidecar), the content the app can be asked to
download (updates, Gallery looks/themes, lyrics AI models), and anything
reachable from a compromised renderer.

## Supported versions

This project ships continuously to a single `latest` release on GitHub —
there is no long-term-support branch. Only the most recently published
release is supported; if you can reproduce an issue, please update to
`latest` first.

## Reporting a vulnerability

**Preferred: GitHub private vulnerability reporting.** Use
[Report a vulnerability](https://github.com/0langa/beatform/security/advisories/new)
on this repository's Security tab. This opens a private advisory that only
the maintainer can see — nothing is exposed publicly until a fix is ready.

If that isn't available to you, open a
[regular issue](https://github.com/0langa/beatform/issues/new) with as much
detail as you can share **without** including exploit specifics in the
public description; a maintainer will follow up to move sensitive details to
a private channel.

Please include, where relevant:

- The app version (press H — the shortcuts overlay shows it) and OS/build.
- Whether the issue requires a malicious project file (`.bfproj`,
  `.bfpreset`, `.bftheme`, `.bfbuilder`, `.bfshader`), a malicious media
  file, a malicious Gallery entry, or local access.
- Steps to reproduce, or a minimal repro file/track.

## What counts as a security issue here

Given the app's shape, the reports most worth flagging privately are things
like:

- A `.bfproj` / `.bfpreset` / `.bftheme` / `.bfbuilder` / `.bfshader` file
  that, when opened, can read/write/execute outside the app's intended
  scope.
- A path or filename (batch output, export destination, library scan) that
  escapes the intended directory, follows an unexpected symlink, or reaches
  a UNC/network path unintentionally.
- Anything in `src-tauri/` that widens what a compromised or malicious
  renderer could do to the filesystem or OS.
- A way past the Gallery's verified-download chain (`src/state/gallery.ts`):
  every content/preview URL in the registry must match a strict allowlist
  (host + `beatform-app/gallery` + 40-hex commit pin + folder + slug +
  extension), downloads are size-capped and SHA-256-checked against the
  registry digest **before** the bytes are parsed, and installing reuses the
  exact validators the drag-import paths use. A hostile registry entry that
  reaches another origin, gets an unverified byte to a parser, or gains
  anything a hand-imported file couldn't, is a security issue.
- A way to make the app accept a tampered lyrics AI model: the models
  (MDX-Net vocal isolation, whisper.cpp, wav2vec2 alignment) are downloaded
  with their sizes and SHA-256 digests pinned in the binary
  (`src-tauri/src/lyrics.rs`) and verified before the file gains its final
  name — see THIRD_PARTY_LICENSES.md for their provenance. Likewise
  anything that lets a malicious audio file or model file escalate through
  the lyrics sidecar process.
- A supply-chain concern in the bundled ffmpeg or lyrics sidecars, the
  pinned model set, or a dependency.

General crashes, visual bugs, and sync/export correctness issues are
regular bugs — please file those as normal
[issues](https://github.com/0langa/beatform/issues/new), not security
reports.

## Network behavior

No telemetry, no analytics, nothing in the background. Every request the
app makes is user-facing and goes to GitHub. The full inventory, verified
against v2.72.1:

| Purpose                             | Host                                                                                                | Process               | When                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------- |
| Update check (`latest.json`)        | `github.com` (this repo's release assets)                                                           | Rust (updater plugin) | at startup and on a manual "Check for updates"  |
| Installer download                  | `github.com` (this repo's release assets, minisign-verified)                                        | Rust (updater plugin) | only after you accept an offered update         |
| Release notes for the update dialog | `raw.githubusercontent.com` (this repo's `CHANGELOG.md`, pinned to the offered tag)                 | Webview               | when an update is offered                       |
| Gallery registry, content, previews | `raw.githubusercontent.com` (`beatform-app/gallery` — commit-pinned, SHA-256-verified before parse) | Webview               | only while you browse or install in the Gallery |
| Lyrics AI-model downloads           | `github.com` (`beatform-app/models` release — SHA-256-pinned in the binary, Range-resumable)        | Rust                  | only when you ask to download a model           |

The webview's CSP backs this split up. The only remote host the renderer is
allowed to contact is `raw.githubusercontent.com`; the `github.com` traffic
(updater, model downloads) happens in the Rust process, outside the webview
entirely. The CSP as shipped (`src-tauri/tauri.conf.json`):

```
default-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' data: blob: ipc: http://ipc.localhost https://raw.githubusercontent.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'
```

Note that `img-src` deliberately does **not** include the raw host: Gallery
previews render only from verified bytes via `blob:` URLs, never straight
off the network. If a release changes `connect-src`, `gallery.ts`, or
`lyrics.rs`, this table gets re-verified as part of that release.

## Update integrity (auto-updater, v2.39.0+)

- Updates are delivered as the NSIS installer from GitHub Releases and
  verified in-app against a minisign public key pinned in the binary
  (`tauri.conf.json → plugins.updater.pubkey`). An update payload that does
  not carry a valid signature is refused before anything runs.
- The signing private key exists only in this repository's GitHub Actions
  secrets and the maintainer's offline backup. **If the key is lost**, the
  next release cannot be auto-delivered: install it manually once from the
  releases page — it ships with a freshly pinned key. **If the key is
  compromised**, it is rotated the same way and affected release assets are
  removed.
- The only network the update path generates is what the
  [Network behavior](#network-behavior) table lists: the `latest.json`
  check, the installer download, and the `CHANGELOG.md` fetch that shows
  the release notes for the versions between yours and the offered one. No
  telemetry rides along.
- Installers are not Authenticode-signed (no code-signing certificate), so
  SmartScreen may warn on first manual install; `SHA256SUMS.txt` on each
  release is the manual verification path.

## Response

This is a small, independently maintained project with no dedicated
security team, so there is no formal SLA. Reports are read and triaged on a
best-effort basis, and a confirmed vulnerability will get a fix released as
soon as reasonably possible, with credit to the reporter (unless you'd
rather stay anonymous).
