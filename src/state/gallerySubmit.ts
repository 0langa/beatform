import { GalleryError, parseRegistry, REGISTRY_SCHEMA_VERSION, type GalleryEntry } from "./gallery";
import { FACTORY_GALLERY_ENTRIES } from "./factoryThemes";
import { parseUserPreset, USER_PRESET_EXTENSION } from "./userPresets";
import { parseTheme, THEME_EXTENSION } from "./themes";
import { APP_VERSION } from "../version";

/**
 * Gallery submission helper (P-21 stage 2, BACKLOG D6) — the importable core
 * behind `scripts/gallery-submit.mjs`. Turns a local `.bfpreset`/`.bftheme`
 * into a ready PR body: validated with the app's OWN parsers (never a
 * re-implementation), hashed and sized exactly, and self-checked by running
 * the assembled registry entry back through the app's OWN `parseRegistry` —
 * the same function `fetchRegistry()` uses on a live index — so "the helper
 * emits exactly what install checks" is not a claim, it is a thing this file
 * proves on every call rather than promising once in a comment.
 *
 * PREPARES ONLY: no network call anywhere in this module, no `gh` call, no
 * auto-PR. The free-OSS contract is no accounts and no services — a human
 * reviews the printed body and opens the PR by hand.
 *
 * `contentUrl`'s commit segment is a real gap this file cannot close: the
 * registry pins content to the commit that MERGES it into
 * beatform-app/gallery, which does not exist yet at submission time. Every
 * entry below stamps PLACEHOLDER_PIN (40 zeros — syntactically a valid
 * commit-shaped hex string, so the self-check below can still validate the
 * rest of the shape) and the printed PR body says so in words. Filling in
 * the real commit is the maintainer's step on merge, not this tool's.
 */

export type SubmissionKind = "look" | "theme";

/** Extension -> registry type, built from the two real extension constants
 * rather than duplicated string literals. The Gallery only ever accepts
 * these two kinds (GalleryEntryType in gallery.ts) — Builder stacks
 * (.bfbuilder) and custom shaders (.bfshader) are shareable app file
 * formats but are not, today, Gallery-submittable ones. */
const EXTENSION_KIND: Readonly<Record<string, SubmissionKind>> = {
  [USER_PRESET_EXTENSION]: "look",
  [THEME_EXTENSION]: "theme",
};

/** Syntactically a 40-hex commit pin (so CONTENT_URL_RE-shaped checks still
 * run) but not a real one — see the module comment. Exported so the CLI and
 * tests can recognize/replace it without guessing the literal. */
export const PLACEHOLDER_PIN = "0".repeat(40);

const LICENSES = ["CC0-1.0", "CC-BY-4.0"] as const;

export class SubmissionError extends Error {}

export interface SubmissionOptions {
  /** Registry slug. Defaults to a slugified form of the resolved name — see
   * slugify()'s comment for why an EXPLICIT id is never auto-corrected. */
  id?: string;
  /** Overrides the display name read from the file itself. */
  name?: string;
  author: string;
  authorUrl?: string;
  /** Loosely typed on purpose: this is CLI input, validated here against
   * the registry's real two-value set rather than trusted at the type
   * level (an invalid string must produce a clear refusal, not a type
   * error the CLI wrapper can't surface). */
  license: string;
  description: string;
  /** Declares the oldest Beatform this submission is meant to install on.
   * Defaults to the app version actually running this tool. A submitter
   * MAY know the content is compatible with an older release than the one
   * they built it with; this tool cannot know that on its own. */
  minAppVersion?: string;
}

export interface Submission {
  kind: SubmissionKind;
  folder: "looks" | "themes";
  /** "<id>.<ext>" — where the PR must add the file, under looks/ or themes/. */
  fileName: string;
  sha256: string;
  sizeBytes: number;
  /** The registry entry, with PLACEHOLDER_PIN standing in for the future
   * merge commit. Already proven parseable by the app's own parseRegistry —
   * see the module comment. */
  entry: GalleryEntry;
  /** Ready to paste into a PR description. */
  prBody: string;
}

/** Message of a caught value, without assuming it is an Error at all —
 * parse functions here only ever throw Error subclasses, but this stays
 * honest about values that technically could be anything. */
function reasonOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

/** Best-effort default id from a display name. NEVER applied to an
 * explicit --id: a submitter who names a slug on purpose (to match an
 * existing convention, say) gets it back literally, and if it is not
 * registry-shaped the self-check below refuses with a clear reason —
 * silently "fixing" a value someone typed on purpose would be a worse
 * surprise than refusing it. */
function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "") // strip combining accents rather than drop the letter
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Extension of a filename, lowercased, no dot. Trivial string slicing, not
 * a format validator — there is exactly one correct definition of "the
 * substring after the last dot", so writing it here duplicates nothing. */
function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i < 0 ? "" : fileName.slice(i + 1).toLowerCase();
}

/** Same digest gallery.ts's private sha256Hex computes (same Web Crypto
 * call, same lowercase-hex-padded format) — SHA-256 has one definition, so
 * a hash computed here is guaranteed to match what the app's own
 * verifiedFetch() computes for the same bytes. digest() accepts a
 * TypedArray directly; no ArrayBuffer extraction needed. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Validate + extract via the REAL parser (parseUserPreset). Throws
 * SubmissionError carrying that parser's own message — this function IS
 * the "corrupted file -> refusal naming the reason" contract for looks. */
function resolveLook(
  text: string,
  nameOverride: string | undefined,
): { name: string; schemaVersion: number } {
  let preset: ReturnType<typeof parseUserPreset>;
  try {
    preset = parseUserPreset(text);
  } catch (e) {
    throw new SubmissionError(reasonOf(e));
  }
  // parseUserPreset's return carries no schemaVersion (identity is
  // fresh-minted on import) — read the envelope field directly off JSON
  // parseUserPreset already proved parses and carries kind: "bfpreset".
  const schemaVersion = (JSON.parse(text) as { schemaVersion: number }).schemaVersion;
  return { name: nameOverride ?? preset.name, schemaVersion };
}

/** Same contract as resolveLook, for themes via parseTheme. */
function resolveTheme(
  text: string,
  nameOverride: string | undefined,
): { name: string; schemaVersion: number } {
  let parsed: ReturnType<typeof parseTheme>;
  try {
    parsed = parseTheme(text);
  } catch (e) {
    throw new SubmissionError(reasonOf(e));
  }
  // parseTheme's return has no projectSchemaVersion — it is consumed
  // internally for the v14 nebula-saturation migration decision and
  // discarded. Read the raw envelope field directly; absent means pre-v14
  // (parseTheme treats it the same way for the same reason — see themes.ts).
  const raw = JSON.parse(text) as { projectSchemaVersion?: number };
  return { name: nameOverride ?? parsed.meta.name, schemaVersion: raw.projectSchemaVersion ?? 0 };
}

function prBody(sub: Omit<Submission, "prBody">, opts: SubmissionOptions): string {
  const authorLine = opts.authorUrl ? `${opts.author} (${opts.authorUrl})` : opts.author;
  return [
    `## New ${sub.kind}: ${sub.entry.name}`,
    "",
    sub.entry.description,
    "",
    `- **Author:** ${authorLine}`,
    `- **License:** ${sub.entry.license}`,
    `- **File:** \`${sub.folder}/${sub.fileName}\` (${sub.sizeBytes} bytes)`,
    `- **SHA-256:** \`${sub.sha256}\``,
    "",
    `Add \`${sub.fileName}\` to \`${sub.folder}/\` in this PR. The registry entry`,
    "below is ready for `index.json` once a maintainer merges it — replace the",
    `40 zeros in \`contentUrl\` (\`${PLACEHOLDER_PIN}\`) with the merge commit's`,
    "SHA; nothing else in the entry should need to change.",
    "",
    "```json",
    // `origin` is an in-memory discriminant parseRegistry stamps on every
    // entry it returns (P-6) — never part of the on-disk registry FORMAT,
    // so it is stripped here rather than pasted into a real index.json.
    JSON.stringify(
      Object.fromEntries(Object.entries(sub.entry).filter(([k]) => k !== "origin")),
      null,
      2,
    ),
    "```",
    "",
  ].join("\n");
}

/**
 * Validate `bytes` (the exact file contents — sha256'd and sized as-is,
 * never a re-serialized copy) as a Gallery submission and build a PR body.
 * Throws SubmissionError with a reason a human can act on.
 */
export async function buildSubmission(
  fileName: string,
  bytes: Uint8Array,
  opts: SubmissionOptions,
): Promise<Submission> {
  const ext = extensionOf(fileName);
  const kind = EXTENSION_KIND[ext];
  if (!kind) {
    const supported = Object.entries(EXTENSION_KIND)
      .map(([e, k]) => `.${e} (${k})`)
      .join(", ");
    throw new SubmissionError(
      `Unsupported file type "${fileName}" — the Gallery accepts ${supported} files only.`,
    );
  }
  if (!LICENSES.includes(opts.license as (typeof LICENSES)[number])) {
    throw new SubmissionError(
      `License must be one of ${LICENSES.join(", ")} — got "${opts.license}". ` +
        "The registry only lists these two; a theme file's own free-text meta.license is a separate, looser field.",
    );
  }
  if (opts.authorUrl !== undefined && !opts.authorUrl.startsWith("https://")) {
    throw new SubmissionError(`--author-url must start with "https://" — got "${opts.authorUrl}".`);
  }
  if (opts.author.trim().length === 0) throw new SubmissionError("--author cannot be empty.");
  if (opts.description.trim().length === 0) {
    throw new SubmissionError("--description cannot be empty.");
  }

  const text = new TextDecoder().decode(bytes);
  const { name: resolvedName, schemaVersion } =
    kind === "look" ? resolveLook(text, opts.name) : resolveTheme(text, opts.name);

  const id = opts.id ?? slugify(resolvedName);
  if (id.length === 0) {
    throw new SubmissionError(
      "Could not derive a registry id from the file's name — pass --id explicitly.",
    );
  }
  const folder: Submission["folder"] = kind === "look" ? "looks" : "themes";
  const fileNameOut = `${id}.${ext}`;
  const contentUrl = `https://raw.githubusercontent.com/beatform-app/gallery/${PLACEHOLDER_PIN}/${folder}/${fileNameOut}`;
  const sha256 = await sha256Hex(bytes);

  // Not yet a real GalleryEntry: `origin` is stamped by parseRegistry's own
  // validEntry() below, on the far side of the same self-check every real
  // registry fetch runs — asserting it here, before that check has run,
  // would be claiming a fact this object has not earned yet.
  const entry: Omit<GalleryEntry, "origin"> = {
    id,
    type: kind,
    name: resolvedName,
    description: opts.description,
    author: { name: opts.author, ...(opts.authorUrl ? { url: opts.authorUrl } : {}) },
    license: opts.license as GalleryEntry["license"],
    contentUrl,
    sha256,
    sizeBytes: bytes.byteLength,
    minAppVersion: opts.minAppVersion ?? APP_VERSION,
    schemaVersion,
  };

  // RESERVED-ID CHECK, sibling of the self-check below: P-6's built-in
  // Gallery entries (FACTORY_GALLERY_ENTRIES, gallery.ts's BuiltinGalleryEntry)
  // are matched by id BEFORE the fetched registry is even consulted
  // (installGalleryEntry checks built-ins first, unconditionally) — a
  // submission that reused one of those 13 ids would, if a maintainer ever
  // merged it, sit in the Gallery as an apparently-normal remote card whose
  // Apply button silently applies the BUILT-IN theme instead of the
  // submitted one, no matter what the card itself shows. parseRegistry's
  // own validator (the self-check right below) has no knowledge of
  // built-ins and would happily accept the collision, so it has to be
  // caught here, before a maintainer ever sees the PR.
  const reserved = FACTORY_GALLERY_ENTRIES.find((e) => e.id === id);
  if (reserved) {
    throw new SubmissionError(
      `"${id}" is reserved by the built-in factory theme "${reserved.name}" — pick a ` +
        "different --id. Built-in ids are matched before the fetched registry, so an entry " +
        "with this id would never be reachable no matter how it looks in the PR.",
    );
  }

  // SELF-CHECK: run the assembled entry back through the app's OWN registry
  // parser — the same one fetchRegistry() feeds a live index into.
  // validEntry() (gallery.ts) is not exported, so this round-trip is the
  // only way to exercise it without copying its rules here. A rejected
  // entry means some field (name/description length, author name length,
  // the license value, the id's shape, or the content URL's own shape)
  // would be silently DROPPED by every real Beatform install on fetch —
  // refuse instead of handing out a snippet the app would ignore.
  let checked: GalleryEntry[];
  try {
    checked = parseRegistry(
      JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION, entries: [entry] }),
    );
  } catch (e) {
    throw new SubmissionError(
      e instanceof GalleryError
        ? `The assembled entry failed the app's own registry validator: ${e.message}`
        : reasonOf(e),
    );
  }
  if (checked.length !== 1) {
    throw new SubmissionError(
      "The assembled entry failed the app's own registry validator (parseRegistry dropped it) " +
        "— check the id, name/description length, author name, and license.",
    );
  }

  const partial: Omit<Submission, "prBody"> = {
    kind,
    folder,
    fileName: fileNameOut,
    sha256,
    sizeBytes: bytes.byteLength,
    entry: checked[0],
  };
  return { ...partial, prBody: prBody(partial, opts) };
}
