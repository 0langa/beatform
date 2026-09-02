import { describe, expect, it } from "vitest";
import {
  RUN_CREATED_SKEW_MS,
  commitPlan,
  parseLsRemoteTag,
  parseVerifiedVersion,
  pickReleaseRun,
  releaseSubject,
  remoteMismatches,
  type CommitFacts,
  type WorkflowRun,
} from "../../scripts/lib/release-helpers.mjs";

/**
 * Pure decision logic of the one-command release (scripts/release.mjs),
 * unit-tested in Node the same way scripts/gpu-pixel-verdict.mjs is: the
 * script stays a thin git/gh shell around these functions, so what this file
 * pins IS what a release rerun decides. The file lives under src/ because
 * vitest's include is `src/**`.
 *
 * Both regressions come from the 2.108 wave:
 *   (a) the commit step was not idempotent — a rerun after a half-finished
 *       commit/tag/push sequence died on `git commit` (nothing to commit) or
 *       `git tag` (already exists) instead of resuming;
 *   (b) the watch step attached to the FIRST run whose headBranch was the tag,
 *       so after a failed run + tag delete + re-push it re-watched the old,
 *       completed, failed run.
 */

const HEAD = "aaaa000000000000000000000000000000000001";
const OLDER = "bbbb000000000000000000000000000000000002";
const OTHER = "cccc000000000000000000000000000000000003";

function facts(over: Partial<CommitFacts> = {}): CommitFacts {
  // Default: the normal first pass — bump + changelog dirty in the tree, HEAD
  // is the previous commit, nothing tagged or pushed yet.
  return {
    version: "2.109.0",
    tag: "v2.109.0",
    title: "Resume where it stopped",
    head: HEAD,
    headSubject: "docs: unrelated previous commit",
    treeClean: false,
    filesAtVersion: "2.109.0",
    tagTarget: null,
    remoteTagTarget: null,
    remoteMain: OLDER,
    ...over,
  };
}

function run(over: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    databaseId: 100,
    headBranch: "v2.109.0",
    status: "in_progress",
    conclusion: "",
    createdAt: "2026-09-02T12:00:30Z",
    ...over,
  };
}

describe("releaseSubject", () => {
  it("matches the subject shape git history carries (em dash, not a hyphen)", () => {
    expect(releaseSubject("2.108.0", "Fast where it counts")).toBe(
      "chore(release): 2.108.0 — Fast where it counts",
    );
  });
});

describe("commitPlan — first pass", () => {
  it("does all four sub-actions when nothing has happened yet", () => {
    const plan = commitPlan(facts());
    expect(plan).toMatchObject({ commit: true, tag: true, pushMain: true, pushTag: true });
  });

  it("refuses to commit a tree whose version files are not at the release version", () => {
    expect(() => commitPlan(facts({ filesAtVersion: "2.108.0" }))).toThrow(/--from=bump/);
    expect(() => commitPlan(facts({ filesAtVersion: null }))).toThrow(/--from=bump/);
  });

  it("refuses to commit when a tag for the release already exists somewhere", () => {
    // A local tag before the release commit exists can only point at the wrong
    // commit; moving it silently is the one thing this step must never do.
    expect(() => commitPlan(facts({ tagTarget: OLDER }))).toThrow(/never move/i);
    expect(() => commitPlan(facts({ remoteTagTarget: OLDER }))).toThrow(/remote/i);
  });
});

describe("commitPlan — resuming (regression a)", () => {
  const committed = {
    headSubject: releaseSubject("2.109.0", "Resume where it stopped"),
    treeClean: true,
  };

  it("bump committed, nothing tagged: skips the commit, does tag + both pushes", () => {
    const plan = commitPlan(facts(committed));
    expect(plan).toMatchObject({ commit: false, tag: true, pushMain: true, pushTag: true });
  });

  it("tagged locally at HEAD, nothing pushed: skips commit + tag", () => {
    const plan = commitPlan(facts({ ...committed, tagTarget: HEAD }));
    expect(plan).toMatchObject({ commit: false, tag: false, pushMain: true, pushTag: true });
  });

  it("main pushed, tag push failed: only the tag push remains", () => {
    const plan = commitPlan(facts({ ...committed, tagTarget: HEAD, remoteMain: HEAD }));
    expect(plan).toMatchObject({ commit: false, tag: false, pushMain: false, pushTag: true });
  });

  it("everything already pushed: a no-op plan, and says so", () => {
    const plan = commitPlan(
      facts({ ...committed, tagTarget: HEAD, remoteMain: HEAD, remoteTagTarget: HEAD }),
    );
    expect(plan).toMatchObject({ commit: false, tag: false, pushMain: false, pushTag: false });
    expect(plan.notes.join("\n")).toMatch(/already/);
  });

  it("local tag missing but the remote already has it at HEAD: recreate locally, no push", () => {
    const plan = commitPlan(facts({ ...committed, remoteMain: HEAD, remoteTagTarget: HEAD }));
    expect(plan).toMatchObject({ commit: false, tag: true, pushMain: false, pushTag: false });
  });

  it("a clean tree at the release version under some other subject counts as committed", () => {
    // Someone committed the bump by hand (or reran with a reworded --title):
    // the bump is in history, so the step must not fail on "nothing to commit".
    const plan = commitPlan(facts({ headSubject: "bump to 2.109.0", treeClean: true }));
    expect(plan.commit).toBe(false);
    expect(plan.notes.join("\n")).toMatch(/2\.109\.0/);
  });

  it("a clean tree NOT at the release version means the bump never landed", () => {
    expect(() =>
      commitPlan(facts({ headSubject: "something", treeClean: true, filesAtVersion: "2.108.0" })),
    ).toThrow(/--from=bump/);
  });

  it("release commit at HEAD but a dirty tree is an error, not a silent partial release", () => {
    expect(() => commitPlan(facts({ ...committed, treeClean: false }))).toThrow(/dirty/i);
  });

  it("never moves a tag: local tag pointing elsewhere is an error", () => {
    expect(() => commitPlan(facts({ ...committed, tagTarget: OTHER }))).toThrow(/never move/i);
  });

  it("never force-pushes a tag: remote tag pointing elsewhere is an error with the manual fix", () => {
    expect(() =>
      commitPlan(facts({ ...committed, tagTarget: HEAD, remoteTagTarget: OTHER })),
    ).toThrow(/:refs\/tags\/v2\.109\.0/);
  });
});

describe("pickReleaseRun (regression b)", () => {
  const after = "2026-09-02T12:00:00Z";
  const staleFailed = run({
    databaseId: 10,
    status: "completed",
    conclusion: "failure",
    createdAt: "2026-09-02T11:30:00Z",
  });
  const fresh = run({ databaseId: 20, createdAt: "2026-09-02T12:00:30Z" });

  it("ignores runs for other refs", () => {
    expect(
      pickReleaseRun(
        [run({ headBranch: "main" }), run({ headBranch: "v2.108.0" })],
        "v2.109.0",
        null,
      ),
    ).toBeNull();
  });

  it("does not re-attach to the old failed run when the re-pushed tag's run has not registered yet", () => {
    // The exact 2.108 bite: tag deleted + re-pushed, `gh run list` still only
    // shows the old completed/failure run. The answer is "keep polling".
    expect(pickReleaseRun([staleFailed], "v2.109.0", after)).toBeNull();
  });

  it("picks the run created after the tag push once it appears", () => {
    expect(pickReleaseRun([staleFailed, fresh], "v2.109.0", after)).toBe(fresh);
    expect(pickReleaseRun([fresh, staleFailed], "v2.109.0", after)).toBe(fresh);
  });

  it("without a recorded push time, the newest run by databaseId wins over an older failure", () => {
    expect(pickReleaseRun([staleFailed, fresh], "v2.109.0", null)).toBe(fresh);
  });

  it("without a recorded push time, a lone completed failure is still the answer (it is the gate)", () => {
    expect(pickReleaseRun([staleFailed], "v2.109.0", null)).toBe(staleFailed);
  });

  it("orders by databaseId, not by list position or status", () => {
    const a = run({ databaseId: 30, status: "completed", conclusion: "success" });
    const b = run({ databaseId: 31, status: "queued" });
    expect(pickReleaseRun([b, a], "v2.109.0", null)).toBe(b);
    expect(pickReleaseRun([a, b], "v2.109.0", null)).toBe(b);
  });

  it("tolerates clock skew between this machine and GitHub, but not by much", () => {
    const justBefore = run({
      databaseId: 40,
      createdAt: new Date(Date.parse(after) - RUN_CREATED_SKEW_MS / 2).toISOString(),
    });
    const wellBefore = run({
      databaseId: 41,
      createdAt: new Date(Date.parse(after) - RUN_CREATED_SKEW_MS * 2).toISOString(),
    });
    expect(pickReleaseRun([justBefore], "v2.109.0", after)).toBe(justBefore);
    expect(pickReleaseRun([wellBefore], "v2.109.0", after)).toBeNull();
  });

  it("a run without a parseable createdAt cannot be dated, so it is not eligible under a cutoff", () => {
    expect(pickReleaseRun([run({ createdAt: "" })], "v2.109.0", after)).toBeNull();
    expect(pickReleaseRun([run({ createdAt: "" })], "v2.109.0", null)).not.toBeNull();
  });
});

describe("parseLsRemoteTag", () => {
  it("reads a lightweight tag (the kind `git tag vX` makes)", () => {
    expect(parseLsRemoteTag(`${HEAD}\trefs/tags/v2.109.0\n`, "v2.109.0")).toBe(HEAD);
  });

  it("prefers the peeled commit of an annotated tag", () => {
    const out = `${OTHER}\trefs/tags/v2.109.0\n${HEAD}\trefs/tags/v2.109.0^{}\n`;
    expect(parseLsRemoteTag(out, "v2.109.0")).toBe(HEAD);
  });

  it("returns null when the remote has no such tag, and ignores look-alikes", () => {
    expect(parseLsRemoteTag("", "v2.109.0")).toBeNull();
    expect(parseLsRemoteTag(`${OTHER}\trefs/tags/v2.109.01\n`, "v2.109.0")).toBeNull();
  });
});

describe("parseVerifiedVersion", () => {
  it("reads the version bump-version --verify agrees on", () => {
    const out = [
      "2.109.0  package.json",
      "2.109.0  src-tauri/tauri.conf.json",
      "OK — all files at 2.109.0",
    ].join("\n");
    expect(parseVerifiedVersion(out)).toBe("2.109.0");
  });

  it("returns null when the files disagree (no OK line)", () => {
    expect(
      parseVerifiedVersion("2.109.0  package.json\nbump-version: version files DISAGREE"),
    ).toBeNull();
  });
});

describe("remoteMismatches", () => {
  it("is empty when origin/main and the remote tag both sit at HEAD", () => {
    expect(remoteMismatches(HEAD, { remoteMain: HEAD, remoteTagTarget: HEAD }, "v2.109.0")).toEqual(
      [],
    );
  });

  it("names each thing that did not land", () => {
    const problems = remoteMismatches(
      HEAD,
      { remoteMain: OLDER, remoteTagTarget: null },
      "v2.109.0",
    );
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toMatch(/origin\/main/);
    expect(problems.join("\n")).toMatch(/v2\.109\.0/);
  });
});
