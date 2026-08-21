import { APP_VERSION } from "../version";
import { PROJECT_VERSION } from "./project";
import { USER_PRESET_VERSION } from "./userPresets";
import type { ProjectDocument } from "./project";

/**
 * Gallery — the in-app browser for the public, owner-curated registry at
 * github.com/beatform-app/gallery.
 *
 * Security model (BACKLOG FEAT-003, enforced here end to end):
 *  - The registry index is fetched from a fixed raw.githubusercontent.com
 *    URL (the only remote host the CSP's connect-src permits).
 *  - Every content/preview URL inside the registry must match a strict
 *    allowlist pattern (host + org/repo + 40-hex commit pin + folder +
 *    slug + extension) — checked at parse time AND again at download time,
 *    so a hostile index can never point the app at another origin.
 *  - Downloads go to memory, are size-capped BEFORE hashing, and their
 *    SHA-256 must equal the registry's digest before the bytes are ever
 *    parsed. The commit pin makes the content immutable server-side; the
 *    hash makes it immutable end-to-end.
 *  - Preview images go through the same verified fetch and are shown via
 *    blob: URLs — the CSP's img-src deliberately does NOT include the raw
 *    host, so an unverified preview cannot even render by accident.
 *  - Parsing/installing reuses the exact validators the drag-import paths
 *    use (parseUserPreset / parseTheme) — the gallery grants no new trust.
 */

/** Where the live registry lives. The index itself moves with `main` (that
 * is how new entries arrive without an app update); everything the index
 * POINTS at is commit-pinned and hash-verified. */
export const GALLERY_REGISTRY_URL =
  "https://raw.githubusercontent.com/beatform-app/gallery/main/index.json";

/** Dev-only escape hatch so an unmerged registry branch can be end-to-end
 * tested (localStorage key with a full raw URL). Compiled out of release
 * builds by the DEV guard. */
export function galleryRegistryUrl(): string {
  if (import.meta.env.DEV && typeof localStorage !== "undefined") {
    const override = localStorage.getItem("viz.galleryRegistryOverride");
    if (override) return override;
  }
  return GALLERY_REGISTRY_URL;
}

export const REGISTRY_SCHEMA_VERSION = 1;
/** Hard caps mirrored from the gallery repo's validator. */
export const MAX_CONTENT_BYTES = 32 * 1024 * 1024;
export const MAX_PREVIEW_BYTES = 512 * 1024;

const CONTENT_URL_RE =
  /^https:\/\/raw\.githubusercontent\.com\/beatform-app\/gallery\/[0-9a-f]{40}\/(looks|themes)\/[a-z0-9]+(?:-[a-z0-9]+)*\.(bfpreset|bftheme)$/;
const PREVIEW_URL_RE =
  /^https:\/\/raw\.githubusercontent\.com\/beatform-app\/gallery\/[0-9a-f]{40}\/previews\/[a-z0-9]+(?:-[a-z0-9]+)*\.(png|jpg)$/;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export type GalleryEntryType = "look" | "theme";

export interface GalleryEntry {
  /** P-6: every REMOTE entry is tagged, so a card-rendering/gate/install
   * call site can discriminate `GalleryEntry | BuiltinGalleryEntry` on one
   * field instead of guessing from which properties happen to be present. */
  origin: "remote";
  id: string;
  type: GalleryEntryType;
  name: string;
  description: string;
  author: { name: string; url?: string };
  license: "CC0-1.0" | "CC-BY-4.0";
  contentUrl: string;
  sha256: string;
  sizeBytes: number;
  minAppVersion: string;
  /** Version of the CONTENT format (.bfpreset schemaVersion / .bftheme
   * projectSchemaVersion) — lets the app refuse without downloading. */
  schemaVersion: number;
  preview?: { url: string; sha256: string };
}

/**
 * P-6: a factory theme, shaped to sit in the same Gallery grid as a
 * REMOTE {@link GalleryEntry} — but it is not one. `origin: "builtin"` is
 * the whole reason this is its own interface rather than an optional-field
 * bag bolted onto `GalleryEntry`: a built-in never has a `contentUrl`, a
 * `sha256`, a size cap or a `minAppVersion`, because it never fetches
 * anything — it is already inside the binary. Making that a TYPE fact
 * (rather than "these fields happen to be undefined") is what keeps a
 * future edit from wiring a built-in through `verifiedFetch`/`fetchEntryContent`
 * by accident.
 *
 * Factory themes are the only source today, so `type` is pinned to
 * `"theme"` rather than the full {@link GalleryEntryType} union — narrower
 * than necessary is the honest shape; widening it is a one-line change
 * the day a built-in LOOK exists.
 */
export interface BuiltinGalleryEntry {
  origin: "builtin";
  id: string;
  type: "theme";
  name: string;
  description: string;
  author: { name: string };
  license: "CC0-1.0" | "CC-BY-4.0";
  /** A bundled asset URL (Vite-hashed, served from 'self') — never fetched
   * over the network, never hash-verified, because it never leaves the app. */
  previewUrl: string;
  /** What "Apply" hands to `applyTheme` — already-validated, already in the
   * binary; there is no download/parse step for a built-in to skip past. */
  document: ProjectDocument;
}

/** Anywhere the Gallery dialog needs to treat a remote and a built-in row
 * uniformly (badge, gate, card fields) — see the file header for what stays
 * REMOTE-only (the verified-download contract) below this type. */
export type AnyGalleryEntry = GalleryEntry | BuiltinGalleryEntry;

export class GalleryError extends Error {}

/** a >= b for plain MAJOR.MINOR.PATCH strings (both must match SEMVER_RE). */
export function semverGte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return true;
}

/**
 * Why can't this entry be installed by THIS build? null when it can.
 * Newer content is listed but gated — seeing what exists is the nudge to
 * update; silently hiding it would look like an empty gallery.
 *
 * P-6: a built-in is NEVER gated — it has no `minAppVersion` and no
 * `schemaVersion` to compare (it shipped with this exact build), so this
 * returns null before touching either field. Falling through to the
 * version comparison below on a field that does not exist would show the
 * whole factory pack as permanently un-installable — the trap the P-6
 * design note calls out by name.
 */
export function entryGate(entry: GalleryEntry | BuiltinGalleryEntry): string | null {
  if (entry.origin === "builtin") return null;
  if (!semverGte(APP_VERSION, entry.minAppVersion)) {
    return `Needs Beatform ${entry.minAppVersion} or newer — update the app to install this`;
  }
  const supported = entry.type === "look" ? USER_PRESET_VERSION : PROJECT_VERSION;
  if (entry.schemaVersion > supported) {
    return "Saved by a newer app version — update the app to install this";
  }
  return null;
}

function validEntry(v: unknown): GalleryEntry | null {
  const e = v as Partial<GalleryEntry> & { tombstone?: unknown };
  if (typeof e !== "object" || e === null) return null;
  // Tombstoned entries exist so IDs are never reused; they are not content.
  if (e.tombstone === true) return null;
  const author = e.author as { name?: unknown; url?: unknown } | undefined;
  if (
    typeof e.id !== "string" ||
    !ID_RE.test(e.id) ||
    e.id.length < 3 ||
    e.id.length > 64 ||
    (e.type !== "look" && e.type !== "theme") ||
    typeof e.name !== "string" ||
    e.name.length === 0 ||
    e.name.length > 80 ||
    typeof e.description !== "string" ||
    e.description.length === 0 ||
    e.description.length > 500 ||
    typeof author !== "object" ||
    author === null ||
    typeof author.name !== "string" ||
    author.name.length === 0 ||
    author.name.length > 80 ||
    (author.url !== undefined &&
      (typeof author.url !== "string" || !author.url.startsWith("https://"))) ||
    (e.license !== "CC0-1.0" && e.license !== "CC-BY-4.0") ||
    typeof e.contentUrl !== "string" ||
    !CONTENT_URL_RE.test(e.contentUrl) ||
    typeof e.sha256 !== "string" ||
    !SHA256_RE.test(e.sha256) ||
    !Number.isInteger(e.sizeBytes) ||
    (e.sizeBytes as number) < 1 ||
    (e.sizeBytes as number) > MAX_CONTENT_BYTES ||
    typeof e.minAppVersion !== "string" ||
    !SEMVER_RE.test(e.minAppVersion) ||
    !Number.isInteger(e.schemaVersion) ||
    (e.schemaVersion as number) < 1
  ) {
    return null;
  }
  // Folder/extension must agree with the declared type, and the filename
  // must equal the id — same identity rules the repo's CI enforces.
  const folder = e.type === "look" ? "looks" : "themes";
  const ext = e.type === "look" ? "bfpreset" : "bftheme";
  if (!e.contentUrl.includes(`/${folder}/${e.id}.${ext}`)) return null;
  let preview: GalleryEntry["preview"];
  if (e.preview !== undefined) {
    const p = e.preview as { url?: unknown; sha256?: unknown };
    if (
      typeof p !== "object" ||
      p === null ||
      typeof p.url !== "string" ||
      !PREVIEW_URL_RE.test(p.url) ||
      typeof p.sha256 !== "string" ||
      !SHA256_RE.test(p.sha256)
    ) {
      return null;
    }
    preview = { url: p.url, sha256: p.sha256 };
  }
  return {
    origin: "remote",
    id: e.id,
    type: e.type,
    name: e.name,
    description: e.description,
    author: { name: author.name, ...(author.url !== undefined ? { url: author.url } : {}) },
    license: e.license,
    contentUrl: e.contentUrl,
    sha256: e.sha256,
    // Number.isInteger above proved these; TS cannot see through it.
    sizeBytes: e.sizeBytes as number,
    minAppVersion: e.minAppVersion,
    schemaVersion: e.schemaVersion as number,
    ...(preview !== undefined ? { preview } : {}),
  };
}

/**
 * Parse + validate untrusted registry JSON. Entries that fail validation
 * are dropped (a curated index should never contain any; a compromised one
 * gains nothing by being malformed), duplicate IDs keep the first
 * occurrence. Throws GalleryError when the top level is unusable.
 */
export function parseRegistry(json: string): GalleryEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new GalleryError("The gallery index is not valid JSON");
  }
  const root = raw as { schemaVersion?: unknown; entries?: unknown };
  if (typeof root !== "object" || root === null) {
    throw new GalleryError("The gallery index is malformed");
  }
  if (root.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new GalleryError("The gallery uses a newer format — update the app to browse it");
  }
  if (!Array.isArray(root.entries)) {
    throw new GalleryError("The gallery index is malformed");
  }
  const out: GalleryEntry[] = [];
  const seen = new Set<string>();
  for (const item of root.entries) {
    const entry = validEntry(item);
    if (entry && !seen.has(entry.id)) {
      seen.add(entry.id);
      out.push(entry);
    }
  }
  return out;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Fetch bytes and verify them against an expected SHA-256 before anything
 * downstream may touch them. Size is enforced BEFORE hashing: exactly
 * `exactBytes` when the registry declared it, and never above `maxBytes`.
 * The URL is re-checked against the allowlist here so this function is safe
 * even if a caller ever hands it an unvalidated entry.
 */
export async function verifiedFetch(
  url: string,
  expectedSha256: string,
  opts: { exactBytes?: number; maxBytes: number },
): Promise<ArrayBuffer> {
  if (!CONTENT_URL_RE.test(url) && !PREVIEW_URL_RE.test(url)) {
    throw new GalleryError("Blocked download from an address outside the gallery");
  }
  let res: Response;
  try {
    res = await fetch(url, { redirect: "error" });
  } catch {
    throw new GalleryError("Could not reach the gallery — check your connection");
  }
  if (!res.ok) {
    throw new GalleryError(`Gallery download failed (HTTP ${res.status})`);
  }
  // R2-29: when the server declares a Content-Length, refuse an oversized
  // response BEFORE buffering its body. The header only ever REFUSES, never
  // admits: it is advisory (and with Content-Encoding in play it measures
  // the compressed transfer, not the decoded bytes), so the byte-count
  // checks below remain the backstop that actually decides. NaN default
  // makes an absent/garbage header skip this check entirely.
  const declaredLength = Number(res.headers?.get("content-length") ?? NaN);
  if (declaredLength > opts.maxBytes) {
    throw new GalleryError("Download is larger than the gallery allows — refusing it");
  }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > opts.maxBytes) {
    throw new GalleryError("Download is larger than the gallery allows — refusing it");
  }
  if (opts.exactBytes !== undefined && bytes.byteLength !== opts.exactBytes) {
    throw new GalleryError("Download size does not match the gallery index — refusing it");
  }
  const actual = await sha256Hex(bytes);
  if (actual !== expectedSha256.toLowerCase()) {
    throw new GalleryError("Download failed verification (hash mismatch) — refusing it");
  }
  return bytes;
}

/** Fetch + verify an entry's content file and return its text. */
export async function fetchEntryContent(entry: GalleryEntry): Promise<string> {
  const bytes = await verifiedFetch(entry.contentUrl, entry.sha256, {
    exactBytes: entry.sizeBytes,
    maxBytes: MAX_CONTENT_BYTES,
  });
  return new TextDecoder().decode(bytes);
}

/** Fetch + verify an entry's preview image; null when it has none.
 * Returns a blob: URL (caller owns revoking it). */
export async function fetchEntryPreview(entry: GalleryEntry): Promise<string | null> {
  if (!entry.preview) return null;
  const bytes = await verifiedFetch(entry.preview.url, entry.preview.sha256, {
    maxBytes: MAX_PREVIEW_BYTES,
  });
  const mime = entry.preview.url.endsWith(".png") ? "image/png" : "image/jpeg";
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

/** Fetch + parse the registry. */
export async function fetchRegistry(): Promise<GalleryEntry[]> {
  let res: Response;
  try {
    // no-store: GitHub's raw CDN caches aggressively enough already; a
    // refresh press should genuinely re-ask.
    res = await fetch(galleryRegistryUrl(), { cache: "no-store", redirect: "error" });
  } catch {
    throw new GalleryError("Could not reach the gallery — check your connection");
  }
  if (!res.ok) {
    throw new GalleryError(`Could not load the gallery (HTTP ${res.status})`);
  }
  return parseRegistry(await res.text());
}
