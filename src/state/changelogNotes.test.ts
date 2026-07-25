import { afterEach, describe, expect, it } from "vitest";
import {
  changelogBetween,
  compareVersions,
  fetchNotesBetween,
  hasVersionSection,
} from "./changelogNotes";

const MD = `# Changelog

Intro prose.

## [Unreleased]

## [2.47.0] - 2026-07-25

### Changed

- **Everything** got better.

## [2.46.2] - 2026-07-25

### Added

- Static Angle controls.

## [2.46.1] - 2026-07-25

### Fixed

- Per-mode backgrounds render live.

## [2.46.0] - 2026-07-24

### Added

- Per-mode backgrounds.
`;

describe("compareVersions", () => {
  it("orders numerically, not lexically", () => {
    expect(compareVersions("2.46.2", "2.47.0")).toBeLessThan(0);
    expect(compareVersions("2.10.0", "2.9.9")).toBeGreaterThan(0);
    expect(compareVersions("2.47.0", "2.47.0")).toBe(0);
  });

  // A hand-uploaded latest.json using a `v` prefix used to parse as 0.0.0 and
  // silently kill the whole notes feature.
  it("tolerates a leading v and prerelease/build suffixes", () => {
    expect(compareVersions("v2.48.0", "2.48.0")).toBe(0);
    expect(compareVersions("2.47.1-rc1", "2.47.1")).toBe(0);
    expect(compareVersions("v2.48.0", "2.47.1")).toBeGreaterThan(0);
  });
});

describe("hasVersionSection", () => {
  it("detects the offered version's own section", () => {
    expect(hasVersionSection(MD, "2.47.0")).toBe(true);
    expect(hasVersionSection(MD, "v2.47.0")).toBe(true);
    expect(hasVersionSection(MD, "2.48.0")).toBe(false);
  });
});

describe("fetchNotesBetween", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("prefers the offered release's TAG over the branch", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (url: string) => {
      seen.push(String(url));
      return { ok: true, text: async () => MD } as Response;
    }) as typeof fetch;
    const out = await fetchNotesBetween("2.46.2", "2.47.0");
    expect(seen[0]).toContain("/v2.47.0/");
    expect(out).toContain("What's new in v2.47.0");
  });

  // The branch copy can lag a freshly pushed tag. Rendering it anyway would
  // present OLDER releases as "what's new", so a document without the offered
  // version's section is discarded and the caller shows the blurb.
  it("fails closed when no document carries the offered version", async () => {
    globalThis.fetch = (async () =>
      ({ ok: true, text: async () => MD }) as Response) as typeof fetch;
    expect(await fetchNotesBetween("2.46.0", "2.48.0")).toBeNull();
  });

  it("resolves null (never throws) when the network fails", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    await expect(fetchNotesBetween("2.46.0", "2.47.0")).resolves.toBeNull();
  });
});

describe("changelogBetween", () => {
  it("returns every section AFTER the installed version up to the offered one", () => {
    const out = changelogBetween(MD, "2.46.0", "2.47.0")!;
    expect(out).toContain("What's new in v2.47.0");
    expect(out).toContain("What's new in v2.46.2");
    expect(out).toContain("What's new in v2.46.1");
    expect(out).not.toContain("v2.46.0"); // installed version excluded
    expect(out).not.toContain("Unreleased");
    expect(out).toContain("Static Angle controls");
    // newest first (changelog order preserved)
    expect(out.indexOf("v2.47.0")).toBeLessThan(out.indexOf("v2.46.1"));
  });

  it("single-version jump shows exactly that section", () => {
    const out = changelogBetween(MD, "2.46.2", "2.47.0")!;
    expect(out).toContain("v2.47.0");
    expect(out).not.toContain("v2.46.2");
    expect(out).not.toContain("v2.46.1");
  });

  it("unknown span or malformed changelog returns null (caller falls back)", () => {
    expect(changelogBetween(MD, "2.47.0", "2.47.0")).toBeNull();
    expect(changelogBetween("no headings here", "1.0.0", "2.0.0")).toBeNull();
  });
});
