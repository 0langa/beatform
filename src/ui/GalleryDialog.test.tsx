// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { GalleryEntry } from "../state/gallery";
import type { UserPreset } from "../state/userPresets";

/**
 * HD-13 — the installed-state card. Two things this pins that no store test
 * can:
 *
 *  1. The card SAYS where removal lives. Install is on this surface; removal
 *     is on another (Visuals ▸ Looks & themes), and the card used to name
 *     neither — "delete the look there" with no "there".
 *  2. The three installed states the hash-aware gate distinguishes render as
 *     three different buttons: "+ Add look" (absent), "✓ Added" disabled
 *     (current — identical content already in My Looks) and "Update look"
 *     ENABLED (outdated — the registry's digest moved since the install).
 *
 * Mocks: `services` and `platform` as every store-backed UI test does; the
 * factory pack is emptied so the grid holds exactly the one card under test.
 * The store itself is real.
 */

vi.mock("../state/services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => ({ audioBuffer: null, state: {} })),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn() })),
  peekAnalyzer: vi.fn(() => null),
  getLiveStemValues: vi.fn(() => undefined),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

vi.mock("../state/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/platform")>();
  return { ...actual, isTauri: () => false, writeAutosave: vi.fn(async () => {}) };
});

vi.mock("../state/factoryThemes", () => ({ FACTORY_GALLERY_ENTRIES: [] }));

const { GalleryDialog } = await import("./GalleryDialog");
const { useVizStore } = await import("../state/store");

const PRISTINE = { ...useVizStore.getState() };
const SHA_V1 = "1".repeat(64);
const SHA_V2 = "2".repeat(64);
const ENTRY_ID = "prism-cathedral";
/** The one phrase both the visible line and the tooltip must carry. */
const REMOVAL_HINT = /Visuals ▸ Looks & themes/;

function lookEntry(sha256: string): GalleryEntry {
  return {
    origin: "remote",
    id: ENTRY_ID,
    type: "look",
    name: "Prism Cathedral",
    description: "A look for the card test.",
    author: { name: "tester" },
    license: "CC0-1.0",
    contentUrl: `https://raw.githubusercontent.com/beatform-app/gallery/${"a".repeat(40)}/looks/${ENTRY_ID}.bfpreset`,
    sha256,
    sizeBytes: 10,
    minAppVersion: "2.71.0",
    schemaVersion: 1,
  };
}

function mine(id: string): UserPreset {
  return {
    id,
    name: "Prism Cathedral",
    presetId: "spectrum-bars",
    params: {},
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

type Seed = Partial<
  Pick<
    ReturnType<typeof useVizStore.getState>,
    "galleryEntries" | "userPresets" | "galleryInstalled"
  >
>;

function renderWith(seed: Seed) {
  useVizStore.setState({ galleryStatus: "ready", ...seed });
  return render(<GalleryDialog />);
}

afterEach(() => {
  cleanup();
  useVizStore.setState(PRISTINE);
});

describe("GalleryDialog — installed-state card (HD-13)", () => {
  it("not installed: '+ Add look', enabled, and no removal hint anywhere on the card", () => {
    renderWith({ galleryEntries: [lookEntry(SHA_V1)] });
    const btn = screen.getByRole("button", { name: "+ Add look" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(screen.queryByText(REMOVAL_HINT)).toBeNull();
  });

  it("installed and identical: '✓ Added', disabled, and the card says where removal lives", () => {
    renderWith({
      galleryEntries: [lookEntry(SHA_V1)],
      userPresets: [mine("up-1")],
      galleryInstalled: { [ENTRY_ID]: { presetId: "up-1", sha256: SHA_V1 } },
    });
    const btn = screen.getByRole("button", { name: "✓ Added" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/Already in My Looks/);
    expect(btn.title).toMatch(REMOVAL_HINT);
    // The DECLARE line itself — visible, not tooltip-only: a disabled
    // button's title is the one place a user cannot be relied on to hover.
    expect(screen.getByText(REMOVAL_HINT)).toBeTruthy();
  });

  it("installed but upstream changed: 'Update look', ENABLED, tooltip names the update, removal hint still shown", () => {
    renderWith({
      galleryEntries: [lookEntry(SHA_V2)],
      userPresets: [mine("up-1")],
      galleryInstalled: { [ENTRY_ID]: { presetId: "up-1", sha256: SHA_V1 } },
    });
    const btn = screen.getByRole("button", { name: "Update look" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.title).toMatch(/Update available/);
    expect(screen.getByText(REMOVAL_HINT)).toBeTruthy();
  });

  it("installed with no recorded digest (pre-provenance record): reads '✓ Added', never 'Update look'", () => {
    renderWith({
      galleryEntries: [lookEntry(SHA_V2)],
      userPresets: [mine("up-1")],
      galleryInstalled: { [ENTRY_ID]: { presetId: "up-1" } },
    });
    expect((screen.getByRole("button", { name: "✓ Added" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByRole("button", { name: "Update look" })).toBeNull();
  });

  it("the installed look's preset was deleted: back to '+ Add look' with no hint (the record is not the truth — My Looks is)", () => {
    renderWith({
      galleryEntries: [lookEntry(SHA_V1)],
      userPresets: [],
      galleryInstalled: { [ENTRY_ID]: { presetId: "up-1", sha256: SHA_V1 } },
    });
    expect((screen.getByRole("button", { name: "+ Add look" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.queryByText(REMOVAL_HINT)).toBeNull();
  });
});
