/**
 * Cumulative release notes for the update dialog.
 *
 * The updater's latest.json can only carry ONE blurb — a user three versions
 * behind would only ever read about the newest one. Instead the dialog pulls
 * the repository's CHANGELOG.md (written user-facing, Keep-a-Changelog style)
 * and shows EVERY section between the installed version (exclusive) and the
 * offered version (inclusive), so "what do I get?" is answered no matter how
 * far behind the install is. latest.json's blurb remains the offline
 * fallback.
 *
 * The fetch is pinned to the OFFERED RELEASE'S TAG, not to `main`: a tag is
 * immutable and always carries the section for the version it released,
 * whereas `main` can be ahead of it (or, in the window right after a tag
 * push, behind). Reading `main` risked presenting OLDER sections as
 * "what's new" when the offered version's own section wasn't there yet, so
 * `main` is only a fallback and any document that lacks the offered
 * version's section is discarded.
 */

const REPO = "0langa/beatform";

/** Raw CHANGELOG at a git ref (tag or branch). */
export function changelogUrl(ref: string): string {
  return `https://raw.githubusercontent.com/${REPO}/${ref}/CHANGELOG.md`;
}

/** The branch copy — fallback only; see the module docstring. */
export const CHANGELOG_URL = changelogUrl("main");

/** How many sections the dialog renders before summarising the rest. A
 * long-idle install would otherwise pour 70+ sections into a small box. */
const MAX_SECTIONS = 5;

/** Give up on a wedged connection instead of leaving a promise pending for
 * the life of the process — the dialog just shows the blurb instead. */
const FETCH_TIMEOUT_MS = 8000;

/** Numeric core of a version: tolerates a leading `v` and drops any
 * prerelease/build suffix, so `v2.48.0` and `2.48.0-rc1` still compare. */
function parseVersion(v: string): number[] {
  const core = v.trim().replace(/^v/i, "").split(/[-+]/)[0];
  return core.split(".").map((n) => parseInt(n, 10) || 0);
}

/** Numeric x.y.z compare: negative when a < b. Non-numeric parts compare 0. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/** Every `## [x.y.z]` heading in the document, in file order. */
function headings(markdown: string): Array<{ version: string; start: number; end: number }> {
  const re = /^## \[(\d+\.\d+\.\d+)\][^\n]*$/gm;
  const heads: Array<{ version: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    heads.push({ version: match[1], start: match.index, end: match.index + match[0].length });
  }
  return heads;
}

/** True when the document carries a section for exactly this version. */
export function hasVersionSection(markdown: string, version: string): boolean {
  return headings(markdown).some((h) => compareVersions(h.version, version) === 0);
}

/**
 * Extract the CHANGELOG sections for every version v with from < v <= to,
 * newest first (the changelog's own order), each prefixed with a
 * "## What's new in vX.Y.Z" heading the dialog's mini-markdown renderer
 * understands. Returns null when nothing matches (unknown versions, malformed
 * changelog) — callers fall back to the transport blurb.
 */
export function changelogBetween(markdown: string, from: string, to: string): string | null {
  const sections: Array<{ version: string; body: string }> = [];
  const heads = headings(markdown);
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    if (compareVersions(h.version, from) <= 0) continue;
    if (compareVersions(h.version, to) > 0) continue;
    const bodyEnd = i + 1 < heads.length ? heads[i + 1].start : markdown.length;
    const body = markdown.slice(h.end, bodyEnd).trim();
    if (body) sections.push({ version: h.version, body });
  }
  if (sections.length === 0) return null;
  const shown = sections.slice(0, MAX_SECTIONS);
  const rest = sections.length - shown.length;
  const out = shown.map((s) => `## What's new in v${s.version}\n\n${s.body}`).join("\n\n");
  return rest > 0
    ? `${out}\n\n## Earlier releases\n\n- ...and ${rest} more release${rest === 1 ? "" : "s"} before these.`
    : out;
}

/** Fetch text with a timeout. Resolves null on any failure — never throws. */
async function fetchText(url: string): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctl.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch + slice the changelog for the update dialog. Never throws: any
 * network/parse failure resolves null and the caller shows the transport
 * blurb instead. Desktop-only host is allowlisted in the CSP.
 *
 * Fails CLOSED: a document that doesn't carry the offered version's own
 * section is ignored rather than rendered, so the dialog can never present
 * older releases as "what's new".
 */
export async function fetchNotesBetween(from: string, to: string): Promise<string | null> {
  const tag = `v${to.replace(/^v/i, "")}`;
  for (const url of [changelogUrl(tag), CHANGELOG_URL]) {
    const md = await fetchText(url);
    if (!md || !hasVersionSection(md, to)) continue;
    const notes = changelogBetween(md, from, to);
    if (notes) return notes;
  }
  return null;
}
