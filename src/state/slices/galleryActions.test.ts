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

// Map-backed rather than no-op: HD-13 persists the gallery install record,
// and the tests below read it back to prove what landed on disk.
const fakeStorage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => fakeStorage.get(k) ?? null,
  setItem: (k: string, v: string) => {
    fakeStorage.set(k, v);
  },
  removeItem: (k: string) => {
    fakeStorage.delete(k);
  },
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
  fakeStorage.clear();
});

const GALLERY_INSTALLED_KEY = "viz.galleryInstalled.v1";
const USER_PRESETS_KEY = "viz.userPresets.v1";
const SHA_V1 = "1".repeat(64);
const SHA_V2 = "2".repeat(64);

/** A look already sitting in My Looks, as the store holds it. */
function installedLook(id: string, presetId: string, name: string): UserPreset {
  return { id, name, presetId, params: {}, createdAt: "2026-01-01T00:00:00.000Z" };
}

function persisted<T>(key: string, fallback: string): T {
  return JSON.parse(fakeStorage.get(key) ?? fallback) as T;
}

/**
 * HD-13 — an entry the author updated upstream used to read "Already in My
 * Looks" for as long as the installed copy survived: the install recorded
 * only WHICH preset it created, never WHAT content, so nothing could tell a
 * newer upstream version from the one installed. Now the install records the
 * registry digest too, and an entry whose digest moved installs OVER the
 * old copy through the same verified path — same preset id, same slot, so
 * the look stays where it was in My Looks and the active look follows.
 */
describe("installGalleryEntry — hash-aware installed state (HD-13)", () => {
  it("a fresh look install records WHICH preset it created and WHAT content (digest), and persists the record", async () => {
    const remote = { ...remoteEntry("remote-look-3", "look"), sha256: SHA_V1 };
    useVizStore.setState({ galleryEntries: [remote] });
    vi.mocked(fetchEntryContent).mockResolvedValue(lookContent("particle-flow", "Fresh look"));

    await useVizStore.getState().installGalleryEntry(remote.id);

    const st = useVizStore.getState();
    const rec = st.galleryInstalled[remote.id];
    expect(rec).toEqual({ presetId: st.userPresets[0].id, sha256: SHA_V1 });
    expect(persisted(GALLERY_INSTALLED_KEY, "{}")).toEqual({ [remote.id]: rec });
  });

  it("an entry whose content the installed copy already has is a no-op — 'Already in My Looks' (the A1 dup guard, now through installedLookState)", async () => {
    const remote = { ...remoteEntry("remote-look-4", "look"), sha256: SHA_V1 };
    const mine = installedLook("up-same", "particle-flow", "Installed look");
    useVizStore.setState({
      galleryEntries: [remote],
      userPresets: [mine],
      galleryInstalled: { [remote.id]: { presetId: "up-same", sha256: SHA_V1 } },
    });

    await useVizStore.getState().installGalleryEntry(remote.id);

    expect(fetchEntryContent).not.toHaveBeenCalled();
    expect(useVizStore.getState().userPresets).toEqual([mine]);
  });

  it("a record without a digest (installed before provenance existed) also reads as installed: no-op, never an update", async () => {
    const remote = { ...remoteEntry("remote-look-4b", "look"), sha256: SHA_V2 };
    const mine = installedLook("up-legacy", "particle-flow", "Legacy install");
    useVizStore.setState({
      galleryEntries: [remote],
      userPresets: [mine],
      galleryInstalled: { [remote.id]: { presetId: "up-legacy" } },
    });

    await useVizStore.getState().installGalleryEntry(remote.id);

    expect(fetchEntryContent).not.toHaveBeenCalled();
    expect(useVizStore.getState().userPresets).toEqual([mine]);
  });

  it("an entry whose upstream content CHANGED installs over the existing copy: same preset id and slot, new content, nothing stacked, record re-stamped, applied", async () => {
    const remote = { ...remoteEntry("remote-look-5", "look"), sha256: SHA_V2 };
    const other = installedLook("up-other", "spectrum-bars", "Unrelated look");
    const mine = installedLook("up-old", "spectrum-bars", "Remote look v1");
    useVizStore.setState({
      galleryEntries: [remote],
      userPresets: [other, mine],
      galleryInstalled: { [remote.id]: { presetId: "up-old", sha256: SHA_V1 } },
    });
    vi.mocked(fetchEntryContent).mockResolvedValue(lookContent("particle-flow", "Remote look v2"));

    await useVizStore.getState().installGalleryEntry(remote.id);

    const st = useVizStore.getState();
    // Same two looks, same order — the update did not stack a third copy or
    // move the look to the front the way a fresh install would.
    expect(st.userPresets.map((p) => p.id)).toEqual(["up-other", "up-old"]);
    expect(st.userPresets[1]).toMatchObject({
      id: "up-old",
      name: "Remote look v2",
      presetId: "particle-flow",
    });
    expect(st.galleryInstalled[remote.id]).toEqual({ presetId: "up-old", sha256: SHA_V2 });
    // Applied, exactly like a fresh install.
    expect(st.presetId).toBe("particle-flow");
    // Both persisted stores agree with state.
    expect(persisted<Record<string, unknown>>(GALLERY_INSTALLED_KEY, "{}")[remote.id]).toEqual({
      presetId: "up-old",
      sha256: SHA_V2,
    });
    expect(persisted<UserPreset[]>(USER_PRESETS_KEY, "[]").map((p) => p.id)).toEqual([
      "up-other",
      "up-old",
    ]);
  });

  it("if the user deletes the look while its update is downloading, the new content still lands in My Looks as a fresh copy instead of vanishing", async () => {
    const remote = { ...remoteEntry("remote-look-6", "look"), sha256: SHA_V2 };
    const mine = installedLook("up-old", "spectrum-bars", "Remote look v1");
    useVizStore.setState({
      galleryEntries: [remote],
      userPresets: [mine],
      galleryInstalled: { [remote.id]: { presetId: "up-old", sha256: SHA_V1 } },
    });
    const gate = deferred<string>();
    vi.mocked(fetchEntryContent).mockReturnValue(gate.promise);

    const install = useVizStore.getState().installGalleryEntry(remote.id);
    // Gone mid-flight: the replace target no longer exists.
    useVizStore.getState().deleteUserPreset("up-old");
    gate.resolve(lookContent("particle-flow", "Remote look v2"));
    await install;

    const st = useVizStore.getState();
    expect(st.userPresets).toHaveLength(1);
    expect(st.userPresets[0].name).toBe("Remote look v2");
    expect(st.userPresets[0].id).not.toBe("up-old");
    expect(st.galleryInstalled[remote.id]).toEqual({
      presetId: st.userPresets[0].id,
      sha256: SHA_V2,
    });
  });
});

describe("loadGalleryInstalled — boot-time read of the persisted record", () => {
  it("reads the persisted map back, validated, and tolerates garbage or absence", async () => {
    const { loadGalleryInstalled } = await import("./galleryActions");
    fakeStorage.set(
      GALLERY_INSTALLED_KEY,
      JSON.stringify({
        "a-look": { presetId: "up-1", sha256: SHA_V1 },
        "bad!": { presetId: "up-2" },
      }),
    );
    expect(loadGalleryInstalled()).toEqual({ "a-look": { presetId: "up-1", sha256: SHA_V1 } });
    fakeStorage.set(GALLERY_INSTALLED_KEY, "{not json");
    expect(loadGalleryInstalled()).toEqual({});
    fakeStorage.delete(GALLERY_INSTALLED_KEY);
    expect(loadGalleryInstalled()).toEqual({});
  });
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
    const installedPresetId = useVizStore.getState().galleryInstalled[remote.id]?.presetId;
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
    const installedPresetId = useVizStore.getState().galleryInstalled[remote.id]?.presetId;
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
