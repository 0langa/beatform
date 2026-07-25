import { describe, expect, it } from "vitest";
import { changelogBetween, compareVersions } from "./changelogNotes";

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
