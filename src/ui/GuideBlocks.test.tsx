// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { GuideBlocks, K } from "./GuideBlocks";
import { GUIDE_FIXTURE, type Block } from "./guideContent";
import type { DerivedTables } from "./guideDerived";

/**
 * GuideBlocks is the one React renderer for the Block/Inline shapes
 * guideContent.ts describes — the in-app twin of guideMarkdown.ts's string
 * emitter (guideMarkdown.test.ts pins the markdown side of the same
 * shapes). DerivedTables below is always a literal STUB, never the real
 * derivedTables() registries: GuideBlocks takes the data as a prop and does
 * not know or care where it came from, so a stub with two shortcut groups
 * and a couple of mod-sources/prefs-tabs entries exercises every rendering
 * rule without pulling SettingsDialog/store (and jsdom's localStorage
 * requirement that comes with it) into this file's import graph. jsdom is
 * still required up top purely because @testing-library/react's render()
 * needs a DOM to mount into.
 *
 * No jest-dom in this repo (see ExportDialog.test.tsx) — assertions read
 * tagName/classList/getAttribute/textContent directly.
 */

afterEach(cleanup);

const STUB_DERIVED: DerivedTables = {
  shortcutSheet: [
    { keys: ["Space"], literals: [" "], action: "Play or pause", group: "Playback" },
    {
      keys: ["N", "P"],
      literals: ["n", "N", "p", "P"],
      action: "Next or previous mode",
      group: "Performance",
    },
    {
      keys: ["1"],
      literals: ["1"],
      action: "Jump to mode 1",
      group: "Performance",
      note: "example note",
    },
  ],
  modSources: [
    { id: "kick", label: "Kick" },
    { id: "bass", label: "Bass" },
  ],
  prefsTabs: [{ label: "General" }, { label: "Modes" }],
};

describe("K", () => {
  it("renders a guide-key kbd chip — moved here from GuideDialog.tsx, exported", () => {
    render(<K k="Ctrl+S" />);
    const kbd = screen.getByText("Ctrl+S");
    expect(kbd.tagName).toBe("KBD");
    expect(kbd.classList.contains("guide-key")).toBe(true);
  });
});

describe("GuideBlocks", () => {
  it("renders h4, every inline mark and a ul from GUIDE_FIXTURE[0]", () => {
    render(<GuideBlocks blocks={GUIDE_FIXTURE[0].blocks} derived={STUB_DERIVED} />);

    const heading = screen.getByRole("heading", { level: 4, name: "Basic Controls" });
    expect(heading.tagName).toBe("H4");

    const kbd = screen.getByText("Space");
    expect(kbd.tagName).toBe("KBD");
    expect(kbd.classList.contains("guide-key")).toBe(true);

    expect(screen.getByText("emphasis").tagName).toBe("EM");
    expect(screen.getByText("strong").tagName).toBe("STRONG");
    expect(screen.getByText("code").tagName).toBe("CODE");

    const link = screen.getByRole("link", { name: "link text" });
    expect(link.getAttribute("href")).toBe("https://example.invalid");

    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  });

  it("renders an ol from GUIDE_FIXTURE[1] and delegates its mod-sources derived block to the prop data", () => {
    const { container } = render(
      <GuideBlocks blocks={GUIDE_FIXTURE[1].blocks} derived={STUB_DERIVED} />,
    );

    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(within(ol!).getAllByRole("listitem")).toHaveLength(3);

    // mod-sources: a bold-label <li> per STUB_DERIVED.modSources entry, in
    // registry order — proves the block reads the prop, not a hardcoded list.
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    const labels = within(ul!)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(labels).toEqual(["Kick", "Bass"]);
    expect(ul!.querySelectorAll("strong")).toHaveLength(2);
  });

  it('a derived "shortcut-sheet" block renders one heading per group and one row per sheet entry', () => {
    const blocks: Block[] = [{ derived: "shortcut-sheet" }];
    const { container } = render(<GuideBlocks blocks={blocks} derived={STUB_DERIVED} />);

    // One heading per distinct group, in first-seen order (Playback,
    // Performance — mirrors guideDerived.ts's groupShortcuts()).
    const headings = screen.getAllByRole("heading", { level: 4 });
    expect(headings.map((h) => h.textContent)).toEqual(["Playback", "Performance"]);

    // One row per STUB_DERIVED.shortcutSheet entry (3), keys joined " / ",
    // action after an em dash, note in parens when present.
    const rows = container.querySelectorAll("p");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toBe("Space — Play or pause");
    expect(rows[1].textContent).toBe("N / P — Next or previous mode");
    expect(rows[2].textContent).toBe("1 — Jump to mode 1 (example note)");

    // A <K/> guide-key chip per key across all rows: Space, N, P, 1.
    expect(container.querySelectorAll("kbd.guide-key")).toHaveLength(4);
  });

  it('a derived "preferences-tabs" block renders one list item joining bold tab labels with " · "', () => {
    const blocks: Block[] = [{ derived: "preferences-tabs" }];
    const { container } = render(<GuideBlocks blocks={blocks} derived={STUB_DERIVED} />);

    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    const items = within(ul!).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toBe("General · Modes");
    expect(items[0].querySelectorAll("strong")).toHaveLength(2);
  });

  // Unknown-block exhaustiveness (a 6th Block variant) is a TYPE check, not
  // a runtime test: GuideBlocks.tsx's block() ends `return b satisfies
  // never;` after the five known `in` narrowings, exactly like
  // guideMarkdown.ts's block(). `Block` is a closed union, so there is no
  // legal runtime value to construct here that would exercise a "default"
  // path — `npm run typecheck` is what actually guards this.
});
