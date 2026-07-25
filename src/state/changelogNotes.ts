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
 */

export const CHANGELOG_URL = "https://raw.githubusercontent.com/0langa/beatform/main/CHANGELOG.md";

/** Numeric x.y.z compare: negative when a < b. Non-numeric parts compare 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
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
  const re = /^## \[(\d+\.\d+\.\d+)\][^\n]*$/gm;
  let match: RegExpExecArray | null;
  const heads: Array<{ version: string; start: number; end: number }> = [];
  while ((match = re.exec(markdown)) !== null) {
    heads.push({ version: match[1], start: match.index, end: match.index + match[0].length });
  }
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    if (compareVersions(h.version, from) <= 0) continue;
    if (compareVersions(h.version, to) > 0) continue;
    const bodyEnd = i + 1 < heads.length ? heads[i + 1].start : markdown.length;
    const body = markdown.slice(h.end, bodyEnd).trim();
    if (body) sections.push({ version: h.version, body });
  }
  if (sections.length === 0) return null;
  return sections.map((s) => `## What's new in v${s.version}\n\n${s.body}`).join("\n\n");
}

/**
 * Fetch + slice the changelog for the update dialog. Never throws: any
 * network/parse failure resolves null and the caller shows the transport
 * blurb instead. Desktop-only host is allowlisted in the CSP.
 */
export async function fetchNotesBetween(from: string, to: string): Promise<string | null> {
  try {
    const res = await fetch(CHANGELOG_URL, { cache: "no-store" });
    if (!res.ok) return null;
    return changelogBetween(await res.text(), from, to);
  } catch {
    return null;
  }
}
