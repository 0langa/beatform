#!/usr/bin/env node
/**
 * Gallery submission helper (P-21 stage 2, BACKLOG D6). Validates a local
 * .bfpreset/.bftheme with the APP'S OWN parsers, computes its exact
 * SHA-256 + byte size, and prints a ready PR body (registry entry JSON +
 * hash/size + attribution) — so a first Gallery submission is one command
 * instead of the seven manual steps the original P-21 brief named.
 *
 *   node scripts/gallery-submit.mjs <file.bfpreset|.bftheme> \
 *     --author="Your Name" --license=CC0-1.0 --description="..." \
 *     [--author-url=https://...] [--id=custom-slug] [--name="Display Name"] \
 *     [--min-app-version=2.90.0] [--out=submission.md]
 *
 * PREPARES ONLY: no network call, no `gh` call, no auto-PR. The human
 * reviews the printed body and opens the PR by hand (free-OSS contract: no
 * accounts, no services).
 *
 * WHY THIS LOADS src/state/gallerySubmit.ts THROUGH VITE, NOT A PLAIN IMPORT:
 * src/ uses bundler-style extensionless relative imports throughout (e.g.
 * `from "./project"`), which Node's own ESM resolver does not resolve —
 * confirmed by hand: `node` (this repo pins Node with native TypeScript
 * type-stripping) throws ERR_MODULE_NOT_FOUND on the very first such import.
 * Only a bundler-aware loader resolves them. Rather than re-implement
 * parseUserPreset/parseTheme/the registry-entry shape here — explicitly
 * forbidden by PLAN-P21S2.md ("import the real parse/validate functions —
 * never a re-implementation") — this boots a throwaway Vite SSR module
 * runner: `vite` is already a devDependency (nothing new added), and
 * `server.ssrLoadModule` is Vite's own supported API for running project
 * TypeScript outside a browser (it's the mechanism vite-node/Vitest itself
 * builds on). `middlewareMode` + never calling `.listen()` means no port is
 * bound and no dev server is left running — this is a one-shot module
 * loader, not `npm run dev`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq === -1) flags[arg.slice(2)] = "true";
      else flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function usage() {
  return [
    "usage: node scripts/gallery-submit.mjs <file.bfpreset|.bftheme>",
    '  --author="Your Name" --license=CC0-1.0|CC-BY-4.0 --description="..."',
    '  [--author-url=https://...] [--id=custom-slug] [--name="Display Name"]',
    "  [--min-app-version=2.90.0] [--out=submission.md]",
  ].join("\n");
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const filePath = positional[0];
  if (!filePath) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }
  const missing = ["author", "license", "description"].filter((k) => flags[k] === undefined);
  if (missing.length > 0) {
    console.error(`missing required flag(s): ${missing.map((k) => `--${k}`).join(", ")}\n`);
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  let bytes;
  try {
    bytes = new Uint8Array(readFileSync(filePath));
  } catch (e) {
    console.error(`could not read "${filePath}": ${e.message}`);
    process.exitCode = 1;
    return;
  }

  // src/state/persistence.ts touches `localStorage` at module scope
  // (stampDocSchema(), always inside try/catch — confirmed by reading it —
  // so this is a quiet-output nicety, not a crash fix). Without a stub,
  // every run prints a "[persistence] write failed" warning for a session
  // cache key nothing in this tool reads.
  if (typeof globalThis.localStorage === "undefined") {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
  }

  const server = await createServer({
    configFile: false,
    root,
    logLevel: "error",
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
    ssr: {},
  });

  let submissionMod;
  try {
    submissionMod = await server.ssrLoadModule("/src/state/gallerySubmit.ts");
  } finally {
    await server.close();
  }
  const { buildSubmission, SubmissionError } = submissionMod;

  try {
    const result = await buildSubmission(basename(filePath), bytes, {
      author: flags.author,
      authorUrl: flags["author-url"],
      license: flags.license,
      description: flags.description,
      id: flags.id,
      name: flags.name,
      minAppVersion: flags["min-app-version"],
    });
    process.stdout.write(result.prBody);
    if (flags.out) {
      writeFileSync(flags.out, result.prBody);
      console.error(`\nwrote ${flags.out}`);
    }
  } catch (e) {
    if (e instanceof SubmissionError) {
      console.error(`refused: ${e.message}`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }
}

main();
