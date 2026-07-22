#!/usr/bin/env node
/**
 * Bump the app version in every file that carries it, atomically, and verify
 * they agree afterwards. Replaces the manual five-file ritual that let
 * src/version.ts drift for ten releases (v2.28.1 → v2.34.1) because nothing
 * cross-checked it.
 *
 *   node scripts/bump-version.mjs 2.39.0
 *   node scripts/bump-version.mjs --verify   # check agreement only
 *
 * Files stamped:
 *   package.json                 "version"
 *   src-tauri/tauri.conf.json    "version"  (also the updater manifest source)
 *   src-tauri/Cargo.toml         version =
 *   src-tauri/Cargo.lock         the `beatform` package entry
 *   src/version.ts               APP_VERSION
 *
 * package-lock.json is refreshed via `npm i --package-lock-only` by the
 * caller (release flow) — it is not rewritten here to keep this script
 * dependency-free and instant.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const p = (rel) => resolve(root, rel);

const SEMVER = /^\d+\.\d+\.\d+$/;

/** [path, read current version, replace version] */
const FILES = [
  [
    "package.json",
    (s) => s.match(/"version":\s*"([^"]+)"/)?.[1],
    (s, v) => s.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`),
  ],
  [
    "src-tauri/tauri.conf.json",
    (s) => s.match(/"version":\s*"([^"]+)"/)?.[1],
    (s, v) => s.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`),
  ],
  [
    "src-tauri/Cargo.toml",
    (s) => s.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
    (s, v) => s.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${v}$2`),
  ],
  [
    "src-tauri/Cargo.lock",
    (s) => s.match(/name = "beatform"\nversion = "([^"]+)"/)?.[1],
    (s, v) => s.replace(/(name = "beatform"\nversion = ")[^"]+(")/, `$1${v}$2`),
  ],
  [
    "src/version.ts",
    (s) => s.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1],
    (s, v) => s.replace(/(APP_VERSION\s*=\s*")[^"]+(")/, `$1${v}$2`),
  ],
];

function currentVersions() {
  return FILES.map(([rel, read]) => [rel, read(readFileSync(p(rel), "utf8"))]);
}

function fail(msg) {
  console.error(`bump-version: ${msg}`);
  process.exit(1);
}

const arg = process.argv[2];
if (!arg) fail("usage: bump-version.mjs <x.y.z> | --verify");

if (arg === "--verify") {
  const vs = currentVersions();
  const set = new Set(vs.map(([, v]) => v));
  for (const [rel, v] of vs) console.log(`${v ?? "NOT FOUND"}  ${rel}`);
  if (set.size !== 1 || set.has(undefined)) fail("version files DISAGREE");
  console.log(`OK — all files at ${vs[0][1]}`);
  process.exit(0);
}

if (!SEMVER.test(arg)) fail(`"${arg}" is not x.y.z`);

// Read + transform everything BEFORE writing anything, so a bad regex or a
// missing file can't leave the five files half-bumped.
const staged = FILES.map(([rel, read, replace]) => {
  const before = readFileSync(p(rel), "utf8");
  const cur = read(before);
  if (!cur) fail(`could not find the version in ${rel}`);
  const after = replace(before, arg);
  if (read(after) !== arg) fail(`replacement failed in ${rel}`);
  return [rel, after];
});
for (const [rel, after] of staged) writeFileSync(p(rel), after);

const check = new Set(currentVersions().map(([, v]) => v));
if (check.size !== 1 || !check.has(arg)) fail("post-write verification failed");
console.log(`bumped ${staged.length} files to ${arg}`);
console.log("next: npm i --package-lock-only && (cd src-tauri && cargo check)");
