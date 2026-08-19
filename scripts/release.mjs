#!/usr/bin/env node
/**
 * The one-command release (P-13b). Automates the ritual that used to live as
 * seven prose steps in CLAUDE.md, resumable at every step:
 *
 *   node scripts/release.mjs 2.74.0 --title "short release title" --gates-ran
 *   node scripts/release.mjs 2.74.0 --continue         # resume after a stop
 *   node scripts/release.mjs 2.74.0 --from=watch       # force-resume at a step
 *   node scripts/release.mjs 2.74.0 --dry-run          # print the plan, run nothing
 *
 * Steps (state in node_modules/.cache/release-state.json, keyed by version —
 * a rerun resumes at the first incomplete step):
 *   1. preflight   clean tree on main, bump-version --verify, gh auth reachable,
 *                  prints the GATES.md checklist and requires --gates-ran
 *                  (it does NOT rerun the gates — you run them, it records
 *                  your acknowledgment)
 *   2. bump        bump-version.mjs X.Y.Z + npm i --package-lock-only +
 *                  cargo check --workspace
 *   3. changelog   scaffold an empty `## [X.Y.Z] - <today>` section + link
 *                  refs, then STOP so a human writes the notes (rerun with
 *                  --continue); passes straight through when the section
 *                  already has content
 *   4. commit      commit "chore(release): X.Y.Z — <title>" + tag vX.Y.Z +
 *                  push main + push the tag
 *   5. watch       wait for the "Release installers" workflow run on the tag,
 *                  stream it, then verify its recorded conclusion directly
 *   6. publish     gh release edit vX.Y.Z --draft=false
 *                  --title "Beatform vX.Y.Z" --latest
 *   7. verify      download live latest.json + SHA256SUMS.txt + the setup
 *                  exe; assert manifest version, signature present, URL
 *                  targets the tag, and the SHA-256 matches — prints a
 *                  verification block (the GATES.md §4 set)
 *   8. reminder    ALIGN-002: after the installed app auto-updates, HKCU
 *                  uninstall DisplayVersion must equal X.Y.Z (exact-version
 *                  check) — printed, then marked done
 *
 * AUTH, REQUIRED ON THIS MACHINE: every `gh` invocation here runs with
 * GITHUB_TOKEN REMOVED from the child environment — the exact equivalent of
 * `env -u GITHUB_TOKEN gh ...`. gh's keyring credentials only engage when
 * the env PAT is absent; the exported PAT shadows them (and 403s on org
 * repos). Do not "fix" this by passing the env token through.
 *
 * Downloads in step 7 follow the host agent-devstorage routing policy:
 * a mounted drive with agent-devstorage\DRIVE-IDENTITY.json receives them
 * under shared-cache/<repo>/cache/ (and the routing.log gets a line);
 * otherwise they fall back to node_modules/.cache with an explicit notice.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateFile = path.join(root, "node_modules", ".cache", "release-state.json");
const STEPS = [
  "preflight",
  "bump",
  "changelog",
  "commit",
  "watch",
  "publish",
  "verify",
  "reminder",
];

// ---------------------------------------------------------------- CLI ------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  return undefined;
};

if (flag("help") || argv.length === 0) {
  console.log(
    [
      "usage: node scripts/release.mjs <X.Y.Z> [options]",
      "",
      "options:",
      '  --title "..."    release title (required by the commit step; stored in state)',
      "  --gates-ran      acknowledge the GATES.md checklist was run green (preflight)",
      "  --continue       resume after the changelog stop (same as a plain rerun)",
      `  --from=<step>    redo from a step onward (${STEPS.join(", ")})`,
      "  --dry-run        print the plan and state; execute NOTHING",
      "  --help           this text",
    ].join("\n"),
  );
  process.exit(0);
}

const version = argv[0];
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`release: "${version}" is not X.Y.Z`);
  process.exit(1);
}
const tag = `v${version}`;
const dryRun = flag("dry-run");

// ------------------------------------------------------------- helpers -----
/** Child env with the PAT stripped — the `env -u GITHUB_TOKEN` equivalent
 * (see the header: REQUIRED for gh keyring auth on this machine). */
function ghEnv() {
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  return env;
}

function run(file, args, { cwd = root, env, capture = false } = {}) {
  const res = spawnSync(file, args, {
    cwd,
    env: env ?? process.env,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const detail = capture ? `\n${res.stdout ?? ""}${res.stderr ?? ""}` : "";
    throw new Error(`${file} ${args.join(" ")} exited ${res.status}${detail}`);
  }
  return capture ? res.stdout.trim() : "";
}

/** npm needs a shell wrapper on Windows (npm.cmd); loopback-smoke pattern. */
function runNpm(args, opts = {}) {
  if (process.platform === "win32") {
    return run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `npm ${args.join(" ")}`], opts);
  }
  return run("npm", args, opts);
}

function gh(args, opts = {}) {
  return run("gh", args, { ...opts, env: ghEnv() });
}

function node(args, opts = {}) {
  return run(process.execPath, args, opts);
}

function repoSlug() {
  const url = run("git", ["remote", "get-url", "origin"], { capture: true });
  const m = /github\.com[:/]+([^/]+)\/([^/.]+)(?:\.git)?/.exec(url);
  if (!m) throw new Error(`cannot parse owner/repo from remote: ${url}`);
  return `${m[1]}/${m[2]}`;
}

function loadState() {
  if (!existsSync(stateFile)) return null;
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

function saveState(state) {
  if (dryRun) return;
  mkdirSync(path.dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

/** Devstorage discovery per host policy: a drive participates iff its
 * DRIVE-IDENTITY.json exists (never trust letters). Returns the
 * agent-devstorage root or null. */
function devstorageRoot() {
  for (const letter of ["D", "E", "F", "G", "H", "I", "J"]) {
    const marker = `${letter}:\\agent-devstorage\\DRIVE-IDENTITY.json`;
    try {
      if (existsSync(marker)) return `${letter}:\\agent-devstorage`;
    } catch {
      /* drive letter not mounted */
    }
  }
  return null;
}

function verifyDownloadDir() {
  const ds = devstorageRoot();
  if (ds) {
    // Layout per <drive>:\agent-devstorage\README.md contract:
    // shared-cache\<repo>\cache for regenerable downloads.
    const dir = path.join(ds, "shared-cache", "Beatform", "cache", "release-verify", tag);
    mkdirSync(dir, { recursive: true });
    try {
      appendFileSync(
        path.join(ds, "_janitor", "routing.log"),
        `${new Date().toISOString()} claude-code Beatform ${dir} release-verify downloads\n`,
      );
    } catch {
      /* routing log is best-effort */
    }
    return dir;
  }
  console.log(
    "external devstorage unavailable (no mounted drive has agent-devstorage\\DRIVE-IDENTITY.json) — verify downloads fall back to node_modules/.cache on C:",
  );
  const dir = path.join(root, "node_modules", ".cache", "release-verify", tag);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function download(url, file) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return buf;
}

function printGatesChecklist() {
  const gates = readFileSync(path.join(root, "GATES.md"), "utf8");
  const lines = gates.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith("## 1."));
  const end = lines.findIndex((l) => l.startsWith("## 4."));
  console.log("\n--- GATES.md checklist (sections 1-3; §4 is what this script automates) ---");
  console.log(lines.slice(start, end === -1 ? undefined : end).join("\n"));
  console.log("--- end of checklist ---\n");
}

// --------------------------------------------------------------- steps -----
const steps = {
  preflight(state) {
    const branch = run("git", ["branch", "--show-current"], { capture: true });
    if (branch !== "main") throw new Error(`preflight: on "${branch}", need main`);
    const dirty = run("git", ["status", "--porcelain"], { capture: true });
    if (dirty) throw new Error(`preflight: working tree not clean:\n${dirty}`);
    node([path.join("scripts", "bump-version.mjs"), "--verify"]);
    try {
      gh(["auth", "status"], { capture: true });
    } catch (e) {
      throw new Error(
        `preflight: gh auth not usable with the env PAT stripped (keyring). ${e.message}`,
        { cause: e },
      );
    }
    printGatesChecklist();
    if (!flag("gates-ran")) {
      console.log(
        "STOP: run the checklist above for every touched area, then rerun with --gates-ran.",
      );
      console.log("(release.mjs records your acknowledgment; it does not rerun the gates.)");
      return false; // not done — rerun resumes here
    }
    state.gatesAckAt = new Date().toISOString();
    return true;
  },

  bump() {
    node([path.join("scripts", "bump-version.mjs"), version]);
    runNpm(["i", "--package-lock-only"]);
    run("cargo", ["check", "--workspace"], { cwd: path.join(root, "src-tauri") });
    return true;
  },

  changelog() {
    const file = path.join(root, "CHANGELOG.md");
    let text = readFileSync(file, "utf8");
    const heading = `## [${version}]`;
    if (!text.includes(heading)) {
      const today = new Date().toISOString().slice(0, 10);
      const unrel = "## [Unreleased]";
      if (!text.includes(unrel)) throw new Error("changelog: no ## [Unreleased] section");
      text = text.replace(unrel, `${unrel}\n\n${heading} - ${today}`);
      // Link references: retarget [Unreleased] to compare from this tag and
      // add this version's compare line right below it.
      const refRe = /^\[Unreleased\]: (.+)\/compare\/v([\d.]+)\.\.\.HEAD$/m;
      const m = refRe.exec(text);
      if (!m) throw new Error("changelog: [Unreleased] link reference not found");
      const [, base, prev] = m;
      text = text.replace(
        refRe,
        `[Unreleased]: ${base}/compare/${tag}...HEAD\n[${version}]: ${base}/compare/v${prev}...${tag}`,
      );
      writeFileSync(file, text);
      console.log(`changelog: scaffolded "${heading} - ${today}" + link references.`);
      console.log("STOP: write the release notes under that heading (it is user-facing UI — the");
      console.log("update dialog renders it), then rerun with --continue.");
      return false;
    }
    // Section exists — require real content before moving on.
    const lines = text.split(/\r?\n/);
    const i = lines.findIndex((l) => l.startsWith(heading));
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith("## [")) j++;
    const body = lines
      .slice(i + 1, j)
      .join("\n")
      .trim();
    if (!body) {
      console.log(`changelog: "${heading}" exists but is EMPTY.`);
      console.log("STOP: write the release notes, then rerun with --continue.");
      return false;
    }
    return true;
  },

  commit(state) {
    const title = opt("title") ?? state.title;
    if (!title) throw new Error('commit: no title — pass --title "..." (stored in state)');
    state.title = title;
    run("git", ["add", "-A"]);
    run("git", ["commit", "-m", `chore(release): ${version} — ${title}`]);
    run("git", ["tag", tag]);
    run("git", ["push", "origin", "main"]);
    run("git", ["push", "origin", tag]);
    return true;
  },

  async watch() {
    // Find the tag's "Release installers" run (registration can lag the push).
    let runId = null;
    for (let i = 0; i < 30 && !runId; i++) {
      const out = gh(
        [
          "run",
          "list",
          "--workflow",
          "Release installers",
          "--json",
          "databaseId,headBranch,status",
          "--limit",
          "20",
        ],
        { capture: true },
      );
      const match = JSON.parse(out).find((r) => r.headBranch === tag);
      if (match) runId = match.databaseId;
      else await sleep(10_000);
    }
    if (!runId) throw new Error(`watch: no "Release installers" run appeared for ${tag}`);
    console.log(`watch: streaming run ${runId} (env -u GITHUB_TOKEN gh run watch)`);
    gh(["run", "watch", String(runId), "--exit-status"]);
    // `gh run watch --exit-status` has returned zero for a failed run on this
    // machine before. Publishing is irreversible enough that the workflow's
    // recorded conclusion, not the watch process, is the release gate.
    const outcome = JSON.parse(
      gh(["run", "view", String(runId), "--json", "status,conclusion,url"], {
        capture: true,
      }),
    );
    if (outcome.status !== "completed" || outcome.conclusion !== "success") {
      throw new Error(
        `watch: release workflow ${runId} was ${outcome.status}/${outcome.conclusion}: ${outcome.url}`,
      );
    }
    console.log(`watch: confirmed run ${runId} completed/success`);
    return true;
  },

  publish() {
    gh(["release", "edit", tag, "--draft=false", "--title", `Beatform ${tag}`, "--latest"]);
    return true;
  },

  async verify() {
    const slug = repoSlug();
    const dir = verifyDownloadDir();
    const liveUrl = `https://github.com/${slug}/releases/latest/download/latest.json`;
    const sumsUrl = `https://github.com/${slug}/releases/download/${tag}/SHA256SUMS.txt`;
    const setupName = `Beatform_${version}_x64-setup.exe`;
    const setupUrl = `https://github.com/${slug}/releases/download/${tag}/${setupName}`;

    const manifest = JSON.parse(
      (await download(liveUrl, path.join(dir, "latest.json"))).toString(),
    );
    if (manifest.version !== version) {
      throw new Error(`verify: live latest.json serves ${manifest.version}, expected ${version}`);
    }
    const plat = manifest.platforms?.["windows-x86_64"];
    if (!plat?.signature || plat.signature.length < 100) {
      throw new Error("verify: updater signature missing/implausible in latest.json");
    }
    if (!plat.url?.includes(`/${tag}/`) || !plat.url.endsWith(setupName)) {
      throw new Error(`verify: manifest url does not target ${tag}: ${plat.url}`);
    }

    const sums = (await download(sumsUrl, path.join(dir, "SHA256SUMS.txt"))).toString();
    const sumLine = sums.split(/\r?\n/).find((l) => l.trim().endsWith(setupName));
    if (!sumLine) throw new Error(`verify: ${setupName} missing from SHA256SUMS.txt:\n${sums}`);
    const expected = sumLine.trim().split(/\s+/)[0].toLowerCase();

    const setupBytes = await download(setupUrl, path.join(dir, setupName));
    const actual = createHash("sha256").update(setupBytes).digest("hex");
    if (actual !== expected) {
      throw new Error(
        `verify: SHA-256 MISMATCH\n  SHA256SUMS: ${expected}\n  downloaded: ${actual}`,
      );
    }

    console.log(
      [
        "",
        "=== release verification block ===",
        `  version        ${version} (tag ${tag})`,
        `  live manifest  ${liveUrl}`,
        `  manifest ver   ${manifest.version}  OK`,
        `  signature      present (${plat.signature.length} chars)  OK`,
        `  manifest url   ${plat.url}  OK`,
        `  installer      ${setupName} (${setupBytes.length} bytes)`,
        `  sha256         ${actual}`,
        `  SHA256SUMS     match  OK`,
        `  downloads in   ${dir}`,
        "==================================",
        "",
      ].join("\n"),
    );
    return true;
  },

  reminder() {
    console.log(
      [
        "ALIGN-002 (manual, after the installed app auto-updates): the HKCU uninstall",
        `entry's DisplayVersion must equal ${version} EXACTLY. Check with:`,
        "  powershell -NoProfile -Command \"Get-ItemProperty HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Where-Object { $_.DisplayName -like 'Beatform*' } | Select-Object DisplayName, DisplayVersion\"",
        "Also smoke the installed artifact (scripts/installed-runtime-smoke.mjs) —",
        "source/dev server alone is insufficient (GATES.md §4).",
      ].join("\n"),
    );
    return true;
  },
};

// ---------------------------------------------------------------- main -----
let state = loadState();
if (!state || state.version !== version) {
  state = { version, title: opt("title"), done: {} };
} else if (opt("title")) {
  state.title = opt("title");
}

const from = opt("from");
if (from) {
  if (!STEPS.includes(from)) {
    console.error(`release: unknown --from step "${from}" (${STEPS.join(", ")})`);
    process.exit(1);
  }
  for (const s of STEPS.slice(STEPS.indexOf(from))) delete state.done[s];
}

if (dryRun) {
  console.log(`release ${version} — DRY RUN (nothing executes, state untouched)`);
  console.log(`state file: ${stateFile}`);
  console.log(
    `state:      ${existsSync(stateFile) ? readFileSync(stateFile, "utf8").trim() : "(none)"}`,
  );
  console.log("plan:");
  for (const s of STEPS) {
    console.log(`  ${state.done[s] ? "done   " : "pending"}  ${s}`);
  }
  console.log("\nnotes: gh runs with GITHUB_TOKEN stripped (env -u equivalent, keyring auth);");
  console.log("gates are NOT rerun here — preflight prints GATES.md and needs --gates-ran.");
  process.exit(0);
}

for (const name of STEPS) {
  if (state.done[name]) {
    console.log(`release: ${name} — already done (${state.done[name]}), skipping`);
    continue;
  }
  console.log(`\nrelease: ${name} …`);
  const ok = await steps[name](state);
  if (!ok) {
    saveState(state); // keep title/ack; step stays incomplete
    process.exit(0);
  }
  state.done[name] = new Date().toISOString();
  saveState(state);
}

console.log(`\nrelease ${version} COMPLETE — all steps done. State: ${stateFile}`);
