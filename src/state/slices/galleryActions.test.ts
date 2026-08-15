import { afterEach, describe, expect, it, vi } from "vitest";
import { validateDocument } from "../project";
import { serializeTheme } from "../themes";
// Value import deliberately NOT static: userPresets.ts pulls in
// persistence.ts, whose module scope calls stampDocSchema() unconditionally
// on load — a static import here would run before vi.stubGlobal("localStorage",
// ...) below (ES import evaluation always precedes a module's own statements),
// so persistence.ts would see a real, unstubbed `localStorage` and throw. The
// dynamic import further down (alongside useVizStore) runs after the stub is
// in place, matching every other test file's own convention.
import type { UserPreset } from "../userPresets";
import type { GalleryEntry } from "../gallery";

/**
 * P-6 review Important 1 — GalleryDialog deliberately exempts a built-in
 * Apply from the "one remote install at a time" busy lock (it never
 * fetches, so there is nothing to guard against — see that file's own
 * comment on `disabled`). That means a slow remote install can still be
 * IN FLIGHT when the user clicks a built-in's Apply button. Before this
 * fix, installGalleryEntry's remote branches called
 * applyTheme/applyUserPreset unconditionally once the download/verify
 * finished, with no idea a later, more deliberate action had already
 * happened — the stale remote result silently clobbered it.
 */

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

vi.mock("../services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => {
    throw new Error("getEngine: not expected without initApp");
  }),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn() })),
  peekAnalyzer: vi.fn(() => null),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

vi.mock("../platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform")>();
  return { ...actual, isTauri: vi.fn(() => false) };
});

vi.mock("../gallery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../gallery")>();
  return {
    ...actual,
    fetchRegistry: vi.fn(async () => []),
    fetchEntryPreview: vi.fn(async () => null),
    entryGate: vi.fn(() => null),
    fetchEntryContent: vi.fn(async () => ""),
  };
});

// Two synthetic built-ins with DISTINCT, known preset ids — real
// FACTORY_GALLERY_ENTRIES entries aren't guaranteed to reference different
// underlying presets, which would make presetId assertions ambiguous.
vi.mock("../factoryThemes", async () => {
  const { validateDocument: validate } = await import("../project");
  const mk = (id: string, presetId: string) => ({
    origin: "builtin" as const,
    id,
    type: "theme" as const,
    name: `Builtin ${id}`,
    description: "d",
    author: { name: "beatform" },
    license: "CC0-1.0" as const,
    previewUrl: "blob:mock",
    document: validate({ presetId }),
  });
  return {
    FACTORY_GALLERY_ENTRIES: [mk("builtin-a", "spectrum-bars"), mk("builtin-b", "particle-flow")],
  };
});

const { useVizStore } = await import("../store");
const { fetchEntryContent } = await import("../gallery");
const { FACTORY_GALLERY_ENTRIES } = await import("../factoryThemes");
const { serializeUserPreset } = await import("../userPresets");

const PRISTINE = { ...useVizStore.getState() };
const [BUILTIN_A, BUILTIN_B] = FACTORY_GALLERY_ENTRIES;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function remoteEntry(id: string, type: "look" | "theme"): GalleryEntry {
  return {
    origin: "remote",
    id,
    type,
    name: `Remote ${id}`,
    description: "A remote gallery entry, for tests.",
    author: { name: "tester" },
    license: "CC0-1.0",
    contentUrl: `https://raw.githubusercontent.com/beatform-app/gallery/${"a".repeat(40)}/x/${id}`,
    sha256: "0".repeat(64),
    sizeBytes: 10,
    minAppVersion: "2.71.0",
    schemaVersion: 1,
  };
}

function themeContent(presetId: string, name: string): string {
  return serializeTheme(
    validateDocument({ presetId }),
    { name, author: "tester", license: "CC0-1.0" },
    "test",
  );
}

// parseUserPreset mints a FRESH id on import regardless of what's in the
// file ("the same file imported twice must not collide" — userPresets.ts),
// so the id given here never survives into the store; tests read the real
// one back off galleryInstalled/userPresets instead of predicting it.
function lookContent(presetId: string, name: string): string {
  const preset: UserPreset = {
    id: "id-from-file-is-discarded-on-import",
    name,
    presetId,
    params: {},
    createdAt: new Date().toISOString(),
  };
  return serializeUserPreset(preset);
}

afterEach(() => {
  useVizStore.setState(PRISTINE);
  vi.mocked(fetchEntryContent).mockReset();
});

describe("installGalleryEntry — stale remote install must not clobber a later built-in Apply (P-6 review Important 1)", () => {
  it("a remote THEME install resolving AFTER a later built-in Apply is skipped, not applied", async () => {
    const remote = remoteEntry("remote-theme-1", "theme");
    useVizStore.setState({ galleryEntries: [remote] });
    const gate = deferred<string>();
    vi.mocked(fetchEntryContent).mockReturnValue(gate.promise);

    const install = useVizStore.getState().installGalleryEntry(remote.id);
    expect(useVizStore.getState().galleryBusy).toBe(remote.id);

    // A later, deliberate user action — Apply a built-in — while the remote
    // download is still in flight. Reachable specifically BECAUSE
    // GalleryDialog never disables a built-in's button on `galleryBusy`.
    void useVizStore.getState().installGalleryEntry(BUILTIN_A.id);
    expect(useVizStore.getState().presetId).toBe("spectrum-bars");

    gate.resolve(themeContent("particle-flow", "Slow remote theme"));
    await install;

    // The stale remote install must NOT have clobbered the built-in.
    expect(useVizStore.getState().presetId).toBe("spectrum-bars");
    expect(useVizStore.getState().galleryApplied).not.toBe(remote.id);
    expect(useVizStore.getState().galleryBusy).toBeNull();
  });

  it("a remote LOOK install resolving AFTER a later built-in Apply still installs into My Looks, but does not steal the active preset back", async () => {
    const remote = remoteEntry("remote-look-1", "look");
    useVizStore.setState({ galleryEntries: [remote] });
    const gate = deferred<string>();
    vi.mocked(fetchEntryContent).mockReturnValue(gate.promise);

    const install = useVizStore.getState().installGalleryEntry(remote.id);
    void useVizStore.getState().installGalleryEntry(BUILTIN_A.id);
    expect(useVizStore.getState().presetId).toBe("spectrum-bars");

    gate.resolve(lookContent("particle-flow", "Slow remote look"));
    await install;

    // The content DID install — "✓ Added" in the gallery card must stay
    // honest regardless of whether it ALSO became the active look.
    const installedPresetId = useVizStore.getState().galleryInstalled[remote.id];
    expect(installedPresetId).toBeDefined();
    expect(useVizStore.getState().userPresets.some((p) => p.id === installedPresetId)).toBe(true);
    // But it did not steal the active preset back from the later built-in.
    expect(useVizStore.getState().presetId).toBe("spectrum-bars");
  });

  it("a normal, uninterrupted remote theme install still applies", async () => {
    const remote = remoteEntry("remote-theme-2", "theme");
    useVizStore.setState({ galleryEntries: [remote] });
    vi.mocked(fetchEntryContent).mockResolvedValue(
      themeContent("particle-flow", "Uninterrupted remote theme"),
    );

    await useVizStore.getState().installGalleryEntry(remote.id);

    expect(useVizStore.getState().presetId).toBe("particle-flow");
    expect(useVizStore.getState().galleryApplied).toBe(remote.id);
    expect(useVizStore.getState().galleryBusy).toBeNull();
  });

  it("a normal, uninterrupted remote look install still applies", async () => {
    const remote = remoteEntry("remote-look-2", "look");
    useVizStore.setState({ galleryEntries: [remote] });
    vi.mocked(fetchEntryContent).mockResolvedValue(
      lookContent("particle-flow", "Uninterrupted remote look"),
    );

    await useVizStore.getState().installGalleryEntry(remote.id);

    expect(useVizStore.getState().presetId).toBe("particle-flow");
    const installedPresetId = useVizStore.getState().galleryInstalled[remote.id];
    expect(installedPresetId).toBeDefined();
    expect(useVizStore.getState().userPresets.some((p) => p.id === installedPresetId)).toBe(true);
  });

  it("two rapid built-in Applies: last one wins, no lock needed", () => {
    void useVizStore.getState().installGalleryEntry(BUILTIN_A.id);
    void useVizStore.getState().installGalleryEntry(BUILTIN_B.id);

    expect(useVizStore.getState().presetId).toBe("particle-flow");
    expect(useVizStore.getState().galleryApplied).toBe(BUILTIN_B.id);
  });
});
