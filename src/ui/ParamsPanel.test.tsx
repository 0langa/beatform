// @vitest-environment jsdom
import { StrictMode, useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_PREFS, getPrefs, setPrefs, subscribePrefs } from "../state/prefs";
import { ParamsPanel } from "./ParamsPanel";
import { renderProbe } from "./testing/renderProbe";
import { presets } from "../render/presets";
import { LFO_SOURCES } from "../state/modMatrix";
import { MOD_ROUTE_RECIPES } from "../state/modRoutePresets";

/**
 * The Inspector's contract after P-12.
 *
 * What this file used to prove — "memo() bails when every prop keeps its
 * identity" — no longer exists to be proven: the panel takes no props, so
 * memo could never bail on anything and was removed. The quantity that
 * mattered survives, measured directly instead of through prop identity:
 * SELECTOR GRANULARITY. The store ticks `playback`/`lufs`/`stereoWidth` at
 * 4 Hz through playback and `exporting` on every exported frame; none of
 * those is read here, so none of them may cost this panel a single commit.
 * T1 is the release's headline fix and FAILS on the pre-migration build,
 * where App subscribed `lufs` and handed it down as a prop.
 *
 * Mocks, and why each is mandatory rather than convenient:
 *  - `services`: the panel now drives REAL store actions. setSync reaches
 *    getAnalyzer().setSync() (store.ts) and the audiogram path reaches
 *    getEngine(); both accessors throw "services not initialized" outside the
 *    browser. Every on* prop used to be a vi.fn(), which hid this entirely.
 *  - `platform`: writeAutosave would hit the filesystem, and askConfirm is
 *    the thing T13/T14 assert on.
 * The STORE is deliberately not mocked — no test in this repo mocks it, and
 * it is already in this file's import graph (LyricsEditPanel) and works in
 * jsdom untouched.
 */

vi.mock("../state/services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => ({
    ctx: { decodeAudioData: vi.fn() },
    currentTime: 0,
    duration: 0,
    playing: false,
    setVolume: vi.fn(),
    onEnded: null,
    dispose: vi.fn(),
  })),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn() })),
  peekAnalyzer: vi.fn(() => null),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

const askConfirmMock = vi.fn(async (_message: string, _title: string) => true);
vi.mock("../state/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/platform")>();
  return {
    ...actual,
    writeAutosave: vi.fn(async () => {}),
    askConfirm: (message: string, title: string) => askConfirmMock(message, title),
  };
});

const { useVizStore } = await import("../state/store");

/** Captured at module load, actions included — restoring by MERGE keeps the
 * action identities the panel's click sites call through. */
const PRISTINE = { ...useVizStore.getState() };

let errorSpy: ReturnType<typeof vi.spyOn>;
let consoleErrors: string[] = [];

beforeEach(() => {
  consoleErrors = [];
  errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(" "));
  });
  askConfirmMock.mockClear();
  askConfirmMock.mockImplementation(async () => true);
});

afterEach(() => {
  cleanup();
  // Never setState(x, true): a full replace would drop the actions.
  useVizStore.setState(PRISTINE);
  // Prefs bleed between tests otherwise — the panel seeds showAdvanced/tab/
  // collapsed from getPrefs() at MOUNT, so a collapse written by one test
  // silently hides controls from the next (it only ever worked because that
  // describe was last in the file).
  setPrefs(DEFAULT_PREFS);
  errorSpy.mockRestore();
  // The standing anti-allocation guard for the whole file: an allocating
  // selector is a crash class, and the `.filter()` shape dies with no React
  // warning at all — this is what notices it.
  expect(consoleErrors.join("\n")).not.toMatch(/getSnapshot should be cached|Maximum update depth/);
});

/** The panel wrapped in a commit counter. */
function mountProbed() {
  const { Probe, commits } = renderProbe();
  render(
    <Probe>
      <ParamsPanel />
    </Probe>,
  );
  return commits;
}

/**
 * Counts renders of the PANEL BODY, which `renderProbe()` alone cannot do:
 * React calls a Profiler's onRender ONCE PER COMMIT of the whole tree, so a
 * `lufs` write that reconciles only <PanelFooterBadges /> — which lives
 * inside the panel — is indistinguishable from one that reconciles all 2,000
 * lines. Both are "1 commit".
 *
 * The body reads `preset.params` unconditionally (defaultParams / allParams /
 * groupParams), so a counting getter on the active preset's def is an exact
 * body-render counter. The objection to the old getter trick does not apply
 * here: it fails when planted on STORE state, because zustand re-runs every
 * subscriber's selector on every setState and the getter then fires with no
 * render at all. `selectPreset` only calls `presetById()` and never touches
 * `.params`, so this counter moves if and only if the body actually ran.
 */
function probePresetParams(id: string) {
  const def = presets.find((p) => p.id === id)!;
  const original = def.params;
  let count = 0;
  Object.defineProperty(def, "params", {
    configurable: true,
    get: () => {
      count += 1;
      return original;
    },
  });
  return {
    reads: () => count,
    restore: () =>
      Object.defineProperty(def, "params", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: original,
      }),
  };
}

const spectrumBars = () => presets.find((p) => p.id === "spectrum-bars")!;

/** Seed a route on the active visual. `activeMods` is the live list the panel
 * renders and `modsByPreset` the persisted map every write reads back — seed
 * BOTH or the first updateModRoute writes an entry the test never set up. */
function seedRoute(param = "hue", extra: Record<string, unknown> = {}) {
  const route = { id: "r1", source: "kick" as const, param, amount: 0.5, ...extra };
  act(() => {
    useVizStore.setState({
      presetId: "spectrum-bars",
      activeMods: [route],
      modsByPreset: { ...useVizStore.getState().modsByPreset, "spectrum-bars": [route] },
    });
  });
}

describe("selector granularity (P-12: the Inspector subscribes only what it reads)", () => {
  it("T1: the 4 Hz LUFS meter tick does not reconcile the panel body", () => {
    act(() => useVizStore.setState({ presetId: "spectrum-bars" }));
    const probe = probePresetParams("spectrum-bars");
    try {
      const commits = mountProbed();
      const bodyRenders = probe.reads();
      const treeCommits = commits();
      expect(bodyRenders).toBeGreaterThan(0); // both probes are live
      expect(treeCommits).toBeGreaterThan(0);

      act(() => useVizStore.setState({ lufs: -14.2 }));

      // THE HEADLINE FIX. Before P-12 this read App's `lufs` selector, handed
      // the panel a changed prop, and reconciled all ~2,000 lines four times
      // a second for the whole of playback.
      expect(probe.reads()).toBe(bodyRenders);
      // The one commit that did happen is the four-badge footer — the only
      // subscriber of lufs — and it landed the new value.
      expect(commits()).toBe(treeCommits + 1);
      expect(screen.getByText("-14.2 LUFS")).toBeTruthy();
    } finally {
      probe.restore();
    }
  });

  it("T2: the playback time tick costs the panel nothing", () => {
    const commits = mountProbed();
    const before = commits();
    act(() => useVizStore.setState({ playback: { ...useVizStore.getState().playback, time: 1 } }));
    expect(commits()).toBe(before);
  });

  it("T3: the per-frame export progress tick costs the panel nothing", () => {
    const commits = mountProbed();
    const before = commits();
    // Unthrottled: exportActions writes this once per encoded frame.
    act(() => useVizStore.setState({ exporting: { done: 1, total: 10, speed: 1 } }));
    expect(commits()).toBe(before);
  });

  it("T4: the stereo-width readout costs the panel nothing", () => {
    const commits = mountProbed();
    const before = commits();
    act(() => useVizStore.setState({ stereoWidth: 0.7 }));
    expect(commits()).toBe(before);
  });

  it("T5: a Post write it DOES read commits exactly once and shows up", () => {
    const commits = mountProbed();
    fireEvent.click(screen.getByRole("button", { name: "Scene" }));
    const before = commits();

    act(() => useVizStore.getState().setPost({ bloom: 0.5 }));

    // Exactly one — proof the subscription is connected, not inert, and that
    // the panel is not re-rendering more than once per store write.
    expect(commits()).toBe(before + 1);
    const bloomRow = [...document.querySelectorAll(".param-row")].find(
      (r) => r.querySelector(".row-label")?.textContent === "Bloom",
    );
    expect((bloomRow?.querySelector('input[type="range"]') as HTMLInputElement).value).toBe("0.5");
  });

  it("T6: 200 sequential meter writes neither crash nor unmount it", () => {
    mountProbed();
    act(() => {
      for (let i = 0; i < 200; i++) useVizStore.setState({ lufs: -20 + i * 0.01 });
    });
    expect(screen.getByText("Inspector")).toBeTruthy();
  });
});

describe("modulation & MIDI target lists (RP-2 / RP-14)", () => {
  it('T7: mod:"off" params are absent from the route-target picker', () => {
    // spectrum-bars: "mirror"/"peaks" are pure toggles (mod:"off"); "hue" is a
    // regular target. A route must exist for the picker to render at all.
    expect(spectrumBars().params.find((p) => p.key === "mirror")?.mod).toBe("off");
    seedRoute("hue");
    render(<ParamsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    const select = screen.getByTitle("Which knob it moves") as HTMLSelectElement;
    const values = [...select.querySelectorAll("option")].map((o) => o.getAttribute("value"));
    expect(values).toContain("hue");
    expect(values).not.toContain("mirror");
    expect(values).not.toContain("peaks");
    expect(values).toContain("post:chromatic"); // post targets unaffected
  });

  it("T8: a legacy route to an off param stays visible, inert and unrewritten", () => {
    seedRoute("mirror");
    render(<ParamsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    const select = screen.getByTitle("Which knob it moves") as HTMLSelectElement;
    expect(select.value).toBe("mirror");
    expect(
      [...select.querySelectorAll("option")].some(
        (o) => o.getAttribute("value") === "mirror" && /not modulatable/.test(o.textContent ?? ""),
      ),
    ).toBe(true);
    // Opening the Inspector must not MUTATE the document — snapping the select
    // onto the first modulatable param would rewrite the route on the next
    // unrelated edit.
    expect(useVizStore.getState().activeMods[0].param).toBe("mirror");
  });
});

describe("modulation v2 UI (P-16/P-7)", () => {
  it("T9: source picker offers the whole beat-synced LFO family", () => {
    seedRoute();
    render(<ParamsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    const select = screen.getByTitle("What drives this route") as HTMLSelectElement;
    const values = [...select.querySelectorAll("option")].map((o) => o.getAttribute("value"));
    for (const s of LFO_SOURCES) expect(values).toContain(s.id);
  });

  it("T10: every recipe has a chip, and clicking one lands real routes", () => {
    act(() => useVizStore.setState({ presetId: "spectrum-bars", activeMods: [] }));
    render(<ParamsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    for (const rec of MOD_ROUTE_RECIPES) {
      expect(screen.getByRole("button", { name: rec.name })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Kick punch" }));
    // Assert the DOCUMENT, not a spy's argument shape.
    expect(useVizStore.getState().activeMods.length).toBeGreaterThan(0);
    expect(useVizStore.getState().activeMods.some((r) => r.source === "kick")).toBe(true);
  });

  it("T11: the shape row writes a curve, and Linear clears the field", () => {
    seedRoute();
    render(<ParamsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    const curveSel = screen.getByTitle(/Response curve/) as HTMLSelectElement;
    fireEvent.change(curveSel, { target: { value: "exp" } });
    expect(useVizStore.getState().activeMods[0].curve).toBe("exp");
    fireEvent.change(curveSel, { target: { value: "linear" } });
    // The persisted-shape guarantee: Linear writes `undefined`, so an
    // untouched route keeps its v1 shape in saved documents.
    expect(useVizStore.getState().activeMods[0].curve).toBeUndefined();
  });
});

describe("no external-store writes during render", () => {
  /** Stand-in for App's prefs subscription (useSyncExternalStore(subscribePrefs,
   * getPrefs)): a setPrefs executed while the Inspector renders schedules an
   * update on this component mid-render — React dev logs "Cannot update a
   * component…". StrictMode is what re-runs useState updaters in the render
   * phase, so it is required for the repro. */
  function PrefsMirror() {
    const p = useSyncExternalStore(subscribePrefs, getPrefs);
    return <span data-testid="prefs-mirror">{p.collapsedSections.length}</span>;
  }

  /** Second mirror, on the zustand store — the Inspector now writes THERE too,
   * and today's guard covered only the prefs emitter. */
  function StoreMirror() {
    const id = useVizStore((s) => s.presetId);
    return <span data-testid="store-mirror">{id}</span>;
  }

  it("T12: section collapse persists prefs without a render-phase update (StrictMode)", () => {
    render(
      <StrictMode>
        <PrefsMirror />
        <StoreMirror />
        <ParamsPanel />
      </StrictMode>,
    );
    const toggles = document.querySelectorAll(".section-toggle");
    expect(toggles.length).toBeGreaterThan(0);
    fireEvent.click(toggles[0]);
    fireEvent.click(toggles[0]);
    expect(consoleErrors.filter((e) => e.includes("Cannot update a component"))).toEqual([]);
  });
});

describe("destructive actions ask first (audit UI-3)", () => {
  it("T13: declining the look-delete confirm leaves userPresets untouched", async () => {
    askConfirmMock.mockImplementation(async () => false);
    act(() =>
      useVizStore.setState({
        presetId: "spectrum-bars",
        userPresets: [
          {
            id: "u1",
            name: "Evening",
            presetId: "spectrum-bars",
            params: {},
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    render(<ParamsPanel />);
    fireEvent.click(screen.getByRole("button", { name: 'Delete "Evening"' }));
    await act(async () => {});

    expect(askConfirmMock).toHaveBeenCalledTimes(1);
    expect(String(askConfirmMock.mock.calls[0][0])).toContain('Delete the look "Evening"');
    expect(useVizStore.getState().userPresets).toHaveLength(1);
  });

  it("T14: declining the lyrics-clear confirm leaves the lines loaded", async () => {
    askConfirmMock.mockImplementation(async () => false);
    act(() =>
      useVizStore.setState({
        lyricFileName: "track.lrc",
        lyrics: [
          { t: 0, end: null, text: "one" },
          { t: 1, end: null, text: "two" },
        ],
      }),
    );
    render(<ParamsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove lyrics" }));
    await act(async () => {});

    expect(askConfirmMock).toHaveBeenCalledTimes(1);
    expect(String(askConfirmMock.mock.calls[0][0])).toContain("Remove the loaded lyrics (2 lines)");
    expect(useVizStore.getState().lyrics).toHaveLength(2);
  });
});
