/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { serializeUserPreset, type UserPreset } from "./userPresets";
import { presets } from "../render/presets";
import { serializeTheme } from "./themes";
import { FACTORY_THEMES } from "./factoryThemes";

/**
 * Regression coverage for the CLI WRAPPER itself (scripts/gallery-submit.mjs)
 * — argv parsing, the Vite SSR bootstrap, exit codes, --out — run as a REAL
 * subprocess. gallerySubmit.test.ts already covers buildSubmission()
 * in-process; nothing there exercises the wrapper's own argv handling, the
 * Vite server bootstrap, or the process exit code a shell script/CI step
 * would actually see.
 *
 * Lives under src/, not scripts/, even though it tests a scripts/ file:
 * vitest.config.ts's `include` is scoped to `src/**\/*.test.ts` — verified
 * by hand that a test file physically inside scripts/ is silently never
 * discovered, even when its exact path is passed on the vitest command line
 * ("No test files found"). Putting it here is what makes it actually run as
 * part of `npm test`, not a cosmetic naming choice.
 *
 * Each case boots a real Vite SSR module runner in a child process, which
 * costs real wall-clock time (observed ~1-2s per invocation) — hence the
 * describe-level budget, the same SUITE idiom GATES.md documents for the
 * audio suites (realtimeSource.test.ts, dspCharacterization.test.ts, etc.).
 */
const SUITE = { timeout: 30_000 };

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/gallery-submit.mjs");

let dir: string;
let lookPath: string;
let themePath: string;
let corruptedPath: string;

beforeAll(() => {
  dir = mkdtempSync(resolve(tmpdir(), "gallery-submit-cli-"));

  const look: UserPreset = {
    id: "up-cli-fixture",
    name: "CLI Fixture Look",
    presetId: presets[0].id,
    params: { intensity: 0.5 },
    createdAt: "2026-07-13T00:00:00.000Z",
  };
  lookPath = resolve(dir, "cli-fixture.bfpreset");
  writeFileSync(lookPath, serializeUserPreset(look));

  const factoryTheme = FACTORY_THEMES[0];
  themePath = resolve(dir, "cli-fixture.bftheme");
  writeFileSync(
    themePath,
    serializeTheme(factoryTheme.document, factoryTheme.meta, "0.0.0-cli-test"),
  );

  corruptedPath = resolve(dir, "corrupted.bfpreset");
  writeFileSync(corruptedPath, "{not valid json");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Runs the CLI as a real child process. Array args, no shell — sidesteps
 * Windows cmd/PowerShell quoting entirely (execFileSync with an argv array
 * spawns the executable directly). Uses process.execPath rather than a bare
 * "node" so the subprocess is guaranteed the exact same Node binary running
 * the test, not whatever "node" resolves to on PATH.
 *
 * `timeout: 25_000` is load-bearing, not a nicety: execFileSync is
 * SYNCHRONOUS and blocks this process's event loop for as long as the
 * child runs, so vitest's own describe-level `{ timeout: 30_000 }` cannot
 * preempt a genuinely hung child — that timer callback can never fire
 * while the event loop is blocked inside this call. Without an explicit
 * timeout here, a hang would wait forever, not 30s. Node's own
 * `execFileSync` timeout kills the CHILD (default SIGTERM) once it fires,
 * which unblocks this call and lets the describe budget mean something.
 * Set below the describe budget so a hang is reported as a timeout
 * failure from THIS call, not a separate vitest-level budget breach. */
function run(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      timeout: 25_000,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status: number | null; stdout: string; stderr: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("gallery-submit.mjs — real subprocess", SUITE, () => {
  it("success path: valid look prints a PR body with the correct hash and size", () => {
    const bytes = readFileSync(lookPath);
    const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
    const result = run([
      lookPath,
      "--author=CLI Test",
      "--license=CC0-1.0",
      "--description=CLI subprocess fixture.",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("## New look: CLI Fixture Look");
    expect(result.stdout).toContain(`"sizeBytes": ${bytes.byteLength}`);
    // Independent of the tool's own Web Crypto call — createHash is a
    // completely separate implementation, same discipline as the manual
    // verification this test now automates.
    expect(result.stdout).toContain(expectedSha256);
  });

  it("refusal path: corrupted JSON exits 1 and names the reason on stderr", () => {
    const result = run([
      corruptedPath,
      "--author=CLI Test",
      "--license=CC0-1.0",
      "--description=x",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/refused:.*valid JSON/i);
    expect(result.stdout).toBe("");
  });

  it("--out writes the exact same PR body to a file", () => {
    const outPath = resolve(dir, "out.md");
    const result = run([
      themePath,
      "--author=CLI Test",
      "--license=CC-BY-4.0",
      "--description=CLI subprocess theme fixture.",
      // themePath's content is the REAL first factory theme (Cover Story,
      // see beforeAll) so its own name would derive a RESERVED id (P-6) —
      // explicit --id sidesteps that gate, same as gallerySubmit.test.ts's
      // in-process theme fixtures needed.
      "--id=cli-fixture-theme",
      `--out=${outPath}`,
    ]);
    expect(result.status).toBe(0);
    const written = readFileSync(outPath, "utf8");
    expect(written).toBe(result.stdout);
    expect(written).toContain("## New theme:");
  });
});
