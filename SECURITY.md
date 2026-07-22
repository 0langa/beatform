# Security Policy

Beatform is a free, open-source desktop app (Tauri 2 + Rust + WebGPU). There
is no cloud service, account system, or telemetry — the attack surface that
matters is the desktop app itself: the Rust shell, the bundled ffmpeg
sidecar, and anything reachable from a compromised renderer.

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

- The app version (Help modal) and OS/build.
- Whether the issue requires a malicious project file (`.avproj`,
  `.avpreset`, `.avtheme`), a malicious media file, or local access.
- Steps to reproduce, or a minimal repro file/track.

## What counts as a security issue here

Given the app's shape, the reports most worth flagging privately are things
like:

- A `.avproj` / `.avpreset` / `.avtheme` / `.avshader` file that, when
  opened, can read/write/execute outside the app's intended scope.
- A path or filename (batch output, export destination, library scan) that
  escapes the intended directory, follows an unexpected symlink, or reaches
  a UNC/network path unintentionally.
- Anything in `src-tauri/` that widens what a compromised or malicious
  renderer could do to the filesystem or OS.
- A supply-chain concern in the bundled ffmpeg sidecar or a dependency.

General crashes, visual bugs, and sync/export correctness issues are
regular bugs — please file those as normal
[issues](https://github.com/0langa/beatform/issues/new), not security
reports.

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
- The updater's network activity is the app's only network activity: a fetch
  of `latest.json` and the installer from `github.com` release assets. No
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
