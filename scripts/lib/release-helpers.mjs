/**
 * Pure decision logic for scripts/release.mjs — no git, no gh, no I/O — so
 * the release ritual's resume behaviour is unit-tested in Node
 * (src/release/releaseHelpers.test.ts) and the script stays a thin shell
 * that gathers facts, asks these functions, and executes the answer.
 *
 * Two 2.108-wave regressions shaped this module:
 *   (a) the commit step was not idempotent — with the bump commit already in
 *       history a rerun died on `git commit` / `git tag` instead of resuming;
 *   (b) the watch step attached to the first run whose headBranch was the
 *       tag, i.e. to the OLD completed/failed run after a tag delete + re-push.
 *
 * Hard rule carried by commitPlan: a tag is NEVER moved or force-pushed
 * silently. A tag pointing somewhere other than the release commit is an
 * error that names the manual fix.
 */

/** The release commit subject exactly as git history carries it (em dash). */
export function releaseSubject(version, title) {
  return `chore(release): ${version} — ${title}`;
}

/**
 * Decide which of the commit step's four sub-actions still need to run.
 *
 * Facts are what the script reads from git right before the step:
 *   head, headSubject       — HEAD sha and subject line
 *   treeClean               — `git status --porcelain` printed nothing
 *   filesAtVersion          — what `bump-version.mjs --verify` agrees on, or
 *                             null when the version files disagree
 *   tagTarget               — commit the LOCAL tag resolves to, or null
 *   remoteTagTarget         — commit the REMOTE tag resolves to (ls-remote), or null
 *   remoteMain              — origin/main after a fetch, or null when unknown
 *
 * Returns booleans per sub-action plus human-facing notes. Throws on any
 * state that must not be resolved silently.
 */
export function commitPlan(facts) {
  const { version, tag, title, head, headSubject, treeClean } = facts;
  const { filesAtVersion, tagTarget, remoteTagTarget, remoteMain } = facts;
  const subject = releaseSubject(version, title);
  const notes = [];

  // -- commit ---------------------------------------------------------------
  let commit;
  if (headSubject === subject) {
    if (!treeClean) {
      throw new Error(
        `commit: HEAD is already the release commit but the working tree is dirty. ` +
          `A release must not leave changes behind — stash or commit them first ` +
          `(if they belong in the release, amend, retag by hand, and rerun with --from=commit).`,
      );
    }
    commit = false;
    notes.push(`release commit already at HEAD (${head.slice(0, 7)}) — skipping commit`);
  } else if (treeClean) {
    if (filesAtVersion !== version) {
      throw new Error(
        `commit: nothing to commit, but the version files are at ${filesAtVersion ?? "no single version"} ` +
          `(expected ${version}) — the bump never landed; rerun with --from=bump.`,
      );
    }
    commit = false;
    notes.push(
      `tree is clean and the version files are at ${version} under "${headSubject}" — ` +
        `treating the bump as committed, skipping commit`,
    );
  } else {
    if (filesAtVersion !== version) {
      throw new Error(
        `commit: version files are at ${filesAtVersion ?? "no single version"}, expected ${version} — ` +
          `refusing to commit a mis-bumped tree; rerun with --from=bump.`,
      );
    }
    commit = true;
  }

  // -- tag ------------------------------------------------------------------
  // With a commit still pending, HEAD is about to change, so any existing tag
  // can only point at the wrong commit.
  if (commit && tagTarget) {
    throw new Error(
      `commit: local tag ${tag} already exists at ${tagTarget.slice(0, 7)} but the release ` +
        `commit has not been made yet. This step never moves a tag: ` +
        `\`git tag -d ${tag}\` if it is stale, then rerun.`,
    );
  }
  if (commit && remoteTagTarget) {
    throw new Error(
      `commit: the remote already has ${tag} at ${remoteTagTarget.slice(0, 7)} but the release ` +
        `commit has not been made yet. Delete it deliberately ` +
        `(\`git push origin :refs/tags/${tag}\`) if it is stale, then rerun.`,
    );
  }
  let tagAction;
  if (!tagTarget) {
    tagAction = true;
  } else if (tagTarget === head) {
    tagAction = false;
    notes.push(`${tag} already points at HEAD — skipping tag`);
  } else {
    throw new Error(
      `commit: local tag ${tag} points at ${tagTarget.slice(0, 7)}, not HEAD ${head.slice(0, 7)}. ` +
        `This step never moves a tag: inspect it, \`git tag -d ${tag}\` if it is stale, then rerun.`,
    );
  }

  // -- push main ------------------------------------------------------------
  let pushMain;
  if (!commit && remoteMain === head) {
    pushMain = false;
    notes.push("origin/main already at HEAD — skipping push main");
  } else {
    pushMain = true;
  }

  // -- push tag -------------------------------------------------------------
  let pushTag;
  if (!remoteTagTarget) {
    pushTag = true;
  } else if (remoteTagTarget === head) {
    pushTag = false;
    notes.push(`origin already has ${tag} at HEAD — skipping push tag`);
  } else {
    throw new Error(
      `commit: origin has ${tag} at ${remoteTagTarget.slice(0, 7)}, not HEAD ${head.slice(0, 7)}. ` +
        `This step never force-pushes a tag: delete the remote tag deliberately ` +
        `(\`git push origin :refs/tags/${tag}\`) and rerun.`,
    );
  }

  return { commit, tag: tagAction, pushMain, pushTag, notes };
}

/**
 * Tolerance when comparing a run's server-side createdAt with the locally
 * recorded tag-push time. Real NTP skew is sub-second; a minute is generous
 * for that and still far below the time any failed run needs to exist before
 * someone can delete the tag and push again.
 */
export const RUN_CREATED_SKEW_MS = 60_000;

/**
 * Pick the "Release installers" run for `tag` from `gh run list --json
 * databaseId,headBranch,status,conclusion,createdAt`.
 *
 * Only runs created at or after `afterIso` (the recorded tag push, minus
 * RUN_CREATED_SKEW_MS) are eligible; with `afterIso` null every run for the
 * tag is (the caller warns). The newest by databaseId wins, which is what
 * keeps a completed failed run from being picked while a newer run for the
 * same tag exists. Returns null when nothing is eligible yet — keep polling.
 */
export function pickReleaseRun(runs, tag, afterIso) {
  const cutoff = afterIso ? Date.parse(afterIso) - RUN_CREATED_SKEW_MS : null;
  const eligible = runs.filter((r) => {
    if (r.headBranch !== tag) return false;
    if (cutoff === null) return true;
    const created = Date.parse(r.createdAt ?? "");
    return Number.isFinite(created) && created >= cutoff;
  });
  if (eligible.length === 0) return null;
  return eligible.reduce((best, r) => (r.databaseId > best.databaseId ? r : best));
}

/**
 * Commit a tag resolves to on the remote, from
 * `git ls-remote --tags origin refs/tags/<tag> refs/tags/<tag>^{}` output.
 * Lightweight tags (what `git tag vX` makes) print one line; annotated tags
 * add a peeled `^{}` line whose sha is the commit — that one wins.
 */
export function parseLsRemoteTag(output, tag) {
  let plain = null;
  let peeled = null;
  for (const line of output.split(/\r?\n/)) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (!sha || !ref) continue;
    if (ref === `refs/tags/${tag}^{}`) peeled = sha;
    else if (ref === `refs/tags/${tag}`) plain = sha;
  }
  return peeled ?? plain;
}

/** The version `bump-version.mjs --verify` reports agreement on, or null. */
export function parseVerifiedVersion(output) {
  return /OK — all files at (\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

/** Post-push check: what still does not match HEAD on the remote. */
export function remoteMismatches(head, { remoteMain, remoteTagTarget }, tag) {
  const problems = [];
  if (remoteMain !== head) {
    problems.push(`origin/main is at ${remoteMain ?? "(unknown)"}, expected HEAD ${head}`);
  }
  if (remoteTagTarget !== head) {
    problems.push(`origin ${tag} is at ${remoteTagTarget ?? "(missing)"}, expected HEAD ${head}`);
  }
  return problems;
}
