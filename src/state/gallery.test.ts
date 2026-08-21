import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  entryGate,
  fetchEntryContent,
  fetchEntryPreview,
  fetchRegistry,
  GalleryError,
  MAX_PREVIEW_BYTES,
  parseRegistry,
  semverGte,
  type GalleryEntry,
} from "./gallery";
import { APP_VERSION } from "../version";
import { FACTORY_GALLERY_ENTRIES } from "./factoryThemes";

/**
 * The gallery is the one place the app takes UNTRUSTED REMOTE input, so
 * these tests are adversarial by design: every check that stands between
 * a hostile registry/file and the parsers must provably reject, and the
 * happy path must provably verify (not just download).
 */

// This file runs in vitest's node environment: crypto.subtle is Node's real
// WebCrypto (so genuine hashing runs — no mocked digests), but object URLs
// do not exist and are stubbed.
beforeAll(() => {
  if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = vi.fn(() => "blob:mock") as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const PIN = "a".repeat(40);
async function sha(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer.slice(0) as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function makeEntry(over: Partial<GalleryEntry> & Record<string, unknown> = {}): GalleryEntry {
  return {
    // P-6: real GalleryEntry values always carry this (validEntry() stamps
    // it); spelled out here too so a `makeEntry()` object matches the real
    // shape byte-for-byte instead of relying on `Partial<GalleryEntry>`
    // quietly making the cast below compile without the field ever being
    // set at runtime.
    origin: "remote",
    id: "test-look",
    type: "look",
    name: "Test Look",
    description: "A look for tests.",
    author: { name: "tester" },
    license: "CC0-1.0",
    contentUrl: `https://raw.githubusercontent.com/beatform-app/gallery/${PIN}/looks/test-look.bfpreset`,
    sha256: "0".repeat(64),
    sizeBytes: 10,
    minAppVersion: "2.71.0",
    schemaVersion: 1,
    ...over,
  } as GalleryEntry;
}

function registryJson(entries: unknown[]): string {
  return JSON.stringify({ schemaVersion: 1, entries });
}

function stubFetch(bytes: Uint8Array, status = 200, declaredLength?: number) {
  /** How many times any response body was actually read (R2-29 pins that a
   * header-refused download never buffers its body at all). */
  const reads = { count: 0 };
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        declaredLength !== undefined && name.toLowerCase() === "content-length"
          ? String(declaredLength)
          : null,
    },
    arrayBuffer: async () => {
      reads.count++;
      return bytes.buffer.slice(0);
    },
    text: async () => new TextDecoder().decode(bytes),
  }));
  vi.stubGlobal("fetch", fn);
  return Object.assign(fn, { reads });
}

describe("semverGte", () => {
  it("orders plain semvers numerically, not lexically", () => {
    expect(semverGte("2.70.0", "2.70.0")).toBe(true);
    expect(semverGte("2.71.0", "2.70.9")).toBe(true);
    expect(semverGte("2.9.0", "2.10.0")).toBe(false); // lexical would say true
    expect(semverGte("3.0.0", "2.99.99")).toBe(true);
    expect(semverGte("2.70.0", "2.70.1")).toBe(false);
  });
});

describe("parseRegistry", () => {
  it("accepts a valid registry and returns its entries", () => {
    const entries = parseRegistry(registryJson([makeEntry()]));
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("test-look");
  });

  it("throws on invalid JSON and on a newer registry format", () => {
    expect(() => parseRegistry("not json")).toThrow(GalleryError);
    expect(() => parseRegistry(JSON.stringify({ schemaVersion: 2, entries: [] }))).toThrow(
      /newer format/,
    );
    expect(() => parseRegistry(JSON.stringify({ schemaVersion: 1 }))).toThrow(GalleryError);
  });

  it("drops entries whose content URL leaves the gallery allowlist", () => {
    const evil = [
      makeEntry({ contentUrl: `https://evil.example.com/looks/test-look.bfpreset` }),
      makeEntry({
        contentUrl: `http://raw.githubusercontent.com/beatform-app/gallery/${PIN}/looks/test-look.bfpreset`,
      }),
      makeEntry({
        contentUrl: `https://raw.githubusercontent.com/evil-org/gallery/${PIN}/looks/test-look.bfpreset`,
      }),
      // Unpinned ref instead of a 40-hex commit: mutable, refused.
      makeEntry({
        contentUrl: `https://raw.githubusercontent.com/beatform-app/gallery/main/looks/test-look.bfpreset`,
      }),
    ];
    expect(parseRegistry(registryJson(evil))).toHaveLength(0);
  });

  it("drops entries whose type, folder, extension or filename disagree", () => {
    const bad = [
      // theme content in looks/
      makeEntry({ type: "theme" }),
      // filename does not equal the id
      makeEntry({
        contentUrl: `https://raw.githubusercontent.com/beatform-app/gallery/${PIN}/looks/other-name.bfpreset`,
      }),
      // unknown type
      makeEntry({ type: "shader" as GalleryEntry["type"] }),
    ];
    expect(parseRegistry(registryJson(bad))).toHaveLength(0);
  });

  it("drops malformed fields: license, sha256, sizes, semver, author", () => {
    const bad = [
      makeEntry({ license: "MIT" as GalleryEntry["license"] }),
      makeEntry({ sha256: "xyz" }),
      makeEntry({ sizeBytes: 0 }),
      makeEntry({ sizeBytes: 33 * 1024 * 1024 }),
      makeEntry({ minAppVersion: "v2.71" }),
      makeEntry({ author: { name: "" } }),
      makeEntry({ author: { name: "x", url: "http://insecure.example" } }),
      makeEntry({ schemaVersion: 0 }),
    ];
    expect(parseRegistry(registryJson(bad))).toHaveLength(0);
  });

  it("filters tombstones and keeps the first of a duplicated id", () => {
    const first = makeEntry({ name: "First" });
    const dupe = makeEntry({ name: "Second" });
    const gone = makeEntry({ id: "gone-look", tombstone: true });
    const entries = parseRegistry(registryJson([first, dupe, gone]));
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("First");
  });

  it("validates preview blocks and rejects off-allowlist preview URLs", () => {
    const okPrev = makeEntry({
      preview: {
        url: `https://raw.githubusercontent.com/beatform-app/gallery/${PIN}/previews/test-look.jpg`,
        sha256: "1".repeat(64),
      },
    });
    const badPrev = makeEntry({
      preview: { url: "https://evil.example.com/p.jpg", sha256: "1".repeat(64) },
    });
    expect(parseRegistry(registryJson([okPrev]))).toHaveLength(1);
    expect(parseRegistry(registryJson([badPrev]))).toHaveLength(0);
  });
});

describe("entryGate", () => {
  it("gates on minAppVersion and on a newer content schema", () => {
    expect(entryGate(makeEntry({ minAppVersion: "99.0.0" }))).toMatch(/Needs Beatform 99\.0\.0/);
    expect(entryGate(makeEntry({ minAppVersion: APP_VERSION, schemaVersion: 999 }))).toMatch(
      /newer app version/,
    );
    expect(entryGate(makeEntry({ minAppVersion: APP_VERSION, schemaVersion: 1 }))).toBeNull();
  });

  // P-6: a built-in has neither field to compare (no minAppVersion, no
  // schemaVersion — it shipped with this exact build), so entryGate must
  // return null unconditionally, checked BEFORE either comparison runs.
  // Falling through to the version check on an absent field is the trap
  // named in the P-6 design note: it would render the whole factory pack
  // as permanently un-installable.
  it("never gates a built-in, whatever its content", () => {
    expect(FACTORY_GALLERY_ENTRIES.length).toBeGreaterThan(0);
    for (const b of FACTORY_GALLERY_ENTRIES) {
      expect(entryGate(b), `${b.id} should never be gated`).toBeNull();
    }
  });
});

describe("verified downloads", () => {
  it("returns content text when size and SHA-256 both match", async () => {
    const bytes = new TextEncoder().encode('{"kind":"bfpreset"}');
    stubFetch(bytes);
    const entry = makeEntry({ sha256: await sha(bytes), sizeBytes: bytes.byteLength });
    await expect(fetchEntryContent(entry)).resolves.toBe('{"kind":"bfpreset"}');
  });

  it("refuses tampered bytes (hash mismatch) even at the right size", async () => {
    const good = new TextEncoder().encode('{"kind":"bfpreset"}');
    const tampered = new TextEncoder().encode('{"kind":"bfhacked"}');
    stubFetch(tampered);
    const entry = makeEntry({ sha256: await sha(good), sizeBytes: tampered.byteLength });
    await expect(fetchEntryContent(entry)).rejects.toThrow(/hash mismatch/);
  });

  it("refuses a size mismatch before hashing", async () => {
    const bytes = new TextEncoder().encode("12345");
    stubFetch(bytes);
    const entry = makeEntry({ sha256: await sha(bytes), sizeBytes: 4 });
    await expect(fetchEntryContent(entry)).rejects.toThrow(/size does not match/);
  });

  it("never fetches a URL outside the allowlist", async () => {
    const fetchFn = stubFetch(new Uint8Array(1));
    const entry = makeEntry({ contentUrl: "https://evil.example.com/x.bfpreset" });
    await expect(fetchEntryContent(entry)).rejects.toThrow(/outside the gallery/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("maps HTTP failures and network errors to friendly GalleryErrors", async () => {
    stubFetch(new Uint8Array(1), 404);
    await expect(fetchEntryContent(makeEntry({ sizeBytes: 1 }))).rejects.toThrow(/HTTP 404/);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    await expect(fetchEntryContent(makeEntry())).rejects.toThrow(/check your connection/);
  });

  it("verifies previews, enforces the preview cap, and returns a blob URL", async () => {
    const img = new Uint8Array(64).fill(7);
    stubFetch(img);
    const entry = makeEntry({
      preview: {
        url: `https://raw.githubusercontent.com/beatform-app/gallery/${PIN}/previews/test-look.jpg`,
        sha256: await sha(img),
      },
    });
    await expect(fetchEntryPreview(entry)).resolves.toMatch(/^blob:/);
    // no preview declared -> null, no fetch
    await expect(fetchEntryPreview(makeEntry())).resolves.toBeNull();
    // oversized preview refused even with a matching hash
    const fat = new Uint8Array(MAX_PREVIEW_BYTES + 1);
    stubFetch(fat);
    const fatEntry = makeEntry({
      preview: {
        url: `https://raw.githubusercontent.com/beatform-app/gallery/${PIN}/previews/test-look.jpg`,
        sha256: await sha(fat),
      },
    });
    await expect(fetchEntryPreview(fatEntry)).rejects.toThrow(/larger than the gallery allows/);
  });

  it("refuses a header-declared oversize BEFORE reading the body (R2-29)", async () => {
    const img = new Uint8Array(8);
    const fetchFn = stubFetch(img, 200, MAX_PREVIEW_BYTES + 1);
    const entry = makeEntry({
      preview: {
        url: `https://raw.githubusercontent.com/beatform-app/gallery/${PIN}/previews/test-look.jpg`,
        sha256: await sha(img),
      },
    });
    await expect(fetchEntryPreview(entry)).rejects.toThrow(/larger than the gallery allows/);
    // The point of the header check: the body was never buffered at all.
    expect(fetchFn.reads.count).toBe(0);
  });

  it("a lying (small) Content-Length admits nothing — the byte-count backstop still refuses (R2-29)", async () => {
    const fat = new Uint8Array(MAX_PREVIEW_BYTES + 1);
    stubFetch(fat, 200, 10); // header claims 10 bytes; the body is oversize
    const fatEntry = makeEntry({
      preview: {
        url: `https://raw.githubusercontent.com/beatform-app/gallery/${PIN}/previews/test-look.jpg`,
        sha256: await sha(fat),
      },
    });
    await expect(fetchEntryPreview(fatEntry)).rejects.toThrow(/larger than the gallery allows/);
  });

  it("an honest in-bounds Content-Length changes nothing — verification proceeds to the hash", async () => {
    const bytes = new TextEncoder().encode('{"kind":"bfpreset"}');
    stubFetch(bytes, 200, bytes.byteLength);
    const entry = makeEntry({ sha256: await sha(bytes), sizeBytes: bytes.byteLength });
    await expect(fetchEntryContent(entry)).resolves.toBe('{"kind":"bfpreset"}');
  });
});

describe("fetchRegistry", () => {
  it("fetches, parses and returns entries", async () => {
    const json = registryJson([makeEntry()]);
    stubFetch(new TextEncoder().encode(json));
    const entries = await fetchRegistry();
    expect(entries).toHaveLength(1);
  });

  it("reports offline and HTTP failure states distinctly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    await expect(fetchRegistry()).rejects.toThrow(/check your connection/);
    stubFetch(new Uint8Array(0), 500);
    await expect(fetchRegistry()).rejects.toThrow(/HTTP 500/);
  });
});
