/**
 * Hand-written declarations for release-helpers.mjs — the repo's tsconfig
 * has no `allowJs`, and src/release/releaseHelpers.test.ts imports the module
 * to unit-test the release script's resume decisions. Keep in lockstep with
 * the .mjs (same pattern as gpu-pixel-verdict.d.mts).
 */

export function releaseSubject(version: string, title: string): string;

export interface CommitFacts {
  version: string;
  tag: string;
  title: string;
  /** HEAD commit sha. */
  head: string;
  /** Subject line of HEAD. */
  headSubject: string;
  /** `git status --porcelain` printed nothing. */
  treeClean: boolean;
  /** Version `bump-version.mjs --verify` agrees on; null when the files disagree. */
  filesAtVersion: string | null;
  /** Commit the local tag resolves to; null when absent. */
  tagTarget: string | null;
  /** Commit the remote tag resolves to (ls-remote); null when absent. */
  remoteTagTarget: string | null;
  /** origin/main after a fetch; null when unknown. */
  remoteMain: string | null;
}

export interface CommitPlan {
  commit: boolean;
  tag: boolean;
  pushMain: boolean;
  pushTag: boolean;
  notes: string[];
}

export function commitPlan(facts: CommitFacts): CommitPlan;

export const RUN_CREATED_SKEW_MS: number;

/** One entry of `gh run list --json databaseId,headBranch,status,conclusion,createdAt`. */
export interface WorkflowRun {
  databaseId: number;
  headBranch: string;
  status: string;
  /** Empty string while the run has not finished. */
  conclusion: string;
  createdAt: string;
}

export function pickReleaseRun(
  runs: WorkflowRun[],
  tag: string,
  afterIso: string | null,
): WorkflowRun | null;

export function parseLsRemoteTag(output: string, tag: string): string | null;

export function parseVerifiedVersion(output: string): string | null;

export function remoteMismatches(
  head: string,
  remote: { remoteMain: string | null; remoteTagTarget: string | null },
  tag: string,
): string[];
