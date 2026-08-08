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
 * The the Visuals contract after P-12.
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

describe("selector granularity (P-12: the Visuals subscribes only what it reads)", () => {
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
    expect(screen.getByText("Visuals")).toBeTruthy();
  });
});

/**
 * T7–T11 changed in exactly ONE way for P-1: the navigation click that gets
 * them to the routes is now `Modulation`, not `Sync`. Every assertion after
 * it is untouched, because their subjects are untouched — Modulation is a
 * first-class rail destination now instead of a "+ Route" link buried at the
 * bottom of Sync, and these five clicks are the proof that it is reachable
 * under that name. They stay the stage-3 canary for the routing grid.
 */
describe("modulation & MIDI target lists (RP-2 / RP-14)", () => {
  it('T7: mod:"off" params are absent from the route-target picker', () => {
    // spectrum-bars: "mirror"/"peaks" are pure toggles (mod:"off"); "hue" is a
    // regular target. A route must exist for the picker to render at all.
    expect(spectrumBars().params.find((p) => p.key === "mirror")?.mod).toBe("off");
    seedRoute("hue");
    render(<ParamsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Modulation" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Modulation" }));
    const select = screen.getByTitle("Which knob it moves") as HTMLSelectElement;
    expect(select.value).toBe("mirror");
    expect(
      [...select.querySelectorAll("option")].some(
        (o) => o.getAttribute("value") === "mirror" && /not modulatable/.test(o.textContent ?? ""),
      ),
    ).toBe(true);
    // Opening the Visuals must not MUTATE the document — snapping the select
    // onto the first modulatable param would rewrite the route on the next
    // unrelated edit.
    expect(useVizStore.getState().activeMods[0].param).toBe("mirror");
  });
});

describe("modulation v2 UI (P-16/P-7)", () => {
  it("T9: source picker offers the whole beat-synced LFO family", () => {
    seedRoute();
    render(<ParamsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Modulation" }));
    const select = screen.getByTitle("What drives this route") as HTMLSelectElement;
    const values = [...select.querySelectorAll("option")].map((o) => o.getAttribute("value"));
    for (const s of LFO_SOURCES) expect(values).toContain(s.id);
  });

  it("T10: every recipe has a chip, and clicking one lands real routes", () => {
    act(() => useVizStore.setState({ presetId: "spectrum-bars", activeMods: [] }));
    render(<ParamsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Modulation" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Modulation" }));
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
   * getPrefs)): a setPrefs executed while the Visuals renders schedules an
   * update on this component mid-render — React dev logs "Cannot update a
   * component…". StrictMode is what re-runs useState updaters in the render
   * phase, so it is required for the repro. */
  function PrefsMirror() {
    const p = useSyncExternalStore(subscribePrefs, getPrefs);
    return <span data-testid="prefs-mirror">{p.collapsedSections.length}</span>;
  }

  /** Second mirror, on the zustand store — the Visuals now writes THERE too,
   * and today's guard covered only the prefs emitter. */
  function StoreMirror() {
    const id = useVizStore((s) => s.presetId);
    return <span data-testid="store-mirror">{id}</span>;
  }

  /**
   * Re-pointed from `.section-toggle` to `.group-head` for P-1, deliberately
   * NOT to a rail item. The hazard is `setPrefs` called from a click handler
   * OUTSIDE a setState updater (ParamsPanel's toggleGroup), and group collapse
   * is the surviving code path with that exact shape. A rail item would look
   * like the same test and be a weaker one: `setPrefs` no-ops on an unchanged
   * value, so clicking one item twice writes nothing at all and half the
   * repro evaporates. T12b covers the rail with two DIFFERENT items, so both
   * writes are real.
   */
  it("T12: group collapse persists prefs without a render-phase update (StrictMode)", () => {
    render(
      <StrictMode>
        <PrefsMirror />
        <StoreMirror />
        <ParamsPanel />
      </StrictMode>,
    );
    const heads = document.querySelectorAll(".group-head");
    expect(heads.length).toBeGreaterThan(0);
    fireEvent.click(heads[0]);
    fireEvent.click(heads[0]);
    expect(consoleErrors.filter((e) => e.includes("Cannot update a component"))).toEqual([]);
  });

  it("T12b: rail navigation persists visualsPage without a render-phase update", () => {
    render(
      <StrictMode>
        <PrefsMirror />
        <StoreMirror />
        <ParamsPanel />
      </StrictMode>,
    );
    // Two DIFFERENT destinations, so neither write is swallowed by samePrefs.
    fireEvent.click(screen.getByRole("button", { name: "Scene" }));
    expect(getPrefs().visualsPage).toBe("scene");
    fireEvent.click(screen.getByRole("button", { name: "Modulation" }));
    expect(getPrefs().visualsPage).toBe("modulation");
    expect(consoleErrors.filter((e) => e.includes("Cannot update a component"))).toEqual([]);
  });
});

/**
 * The section rail (P-1 stage 1). One navigation model: eight destinations,
 * each rendering its existing sections as a page. Everything here is
 * jsdom-verifiable — structure, roles, keyboard, page switching, persistence.
 * What is NOT verifiable without U2's stylesheet is the LOOK: the rail's
 * width, the active spine, the dimmed treatment of `.is-unavailable`, and the
 * dock geometry itself. Those classes are asserted as contracts here, not as
 * appearance.
 */
describe("Visuals section rail", () => {
  const rail = () => document.querySelector(".visuals-rail")!;
  const railItems = () =>
    [
      ...rail().querySelectorAll<HTMLButtonElement>(
        'button.rail-item[data-section]:not([data-section="search"])',
      ),
    ] as HTMLButtonElement[];

  it("R1: eight destinations, in order, addressed by the frozen page ids", () => {
    render(<ParamsPanel />);
    expect(railItems().map((b) => b.dataset.section)).toEqual([
      "mode",
      "motion",
      "themes",
      "sync",
      "modulation",
      "scene",
      "text",
      "live",
    ]);
    // The labels the harness must NOT select on, but the user reads.
    expect(railItems().map((b) => b.querySelector(".rail-label")?.textContent)).toEqual([
      "Mode",
      "Motion",
      "Themes",
      "Sync",
      "Modulation",
      "Scene",
      "Text",
      "Live",
    ]);
  });

  it("R2: it is a nav of buttons, not a tablist, and marks the current page", () => {
    render(<ParamsPanel />);
    // Landmark, not role="tab": these switch views inside a panel, and the
    // suites address every item by button name.
    expect(screen.getByRole("navigation", { name: "Visuals sections" })).toBe(rail());
    expect(rail().querySelector('[role="tab"]')).toBeNull();
    // aria-current="true", never "page" — a screen reader must not announce
    // "current page" for a view switcher.
    const current = railItems().filter((b) => b.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0].dataset.section).toBe("mode");
    expect(rail().querySelector('[aria-current="page"]')).toBeNull();
  });

  it("R3: Modulation is a first-class destination, not a link inside Sync", () => {
    // The entire justification for P-1. It must be reachable by its own name
    // from the rail, and its content must NOT be on the Sync page.
    seedRoute("hue");
    render(<ParamsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    expect(screen.queryByTitle("Which knob it moves")).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Route" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Modulation" }));
    expect(screen.getByTitle("Which knob it moves")).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Route" })).toBeTruthy();
  });

  it("R4: clicking a destination swaps the page and persists it", () => {
    render(<ParamsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    expect(getPrefs().visualsPage).toBe("text");
    expect(screen.getByRole("heading", { name: "Audiogram" })).toBeTruthy();
    // Frame lives on Scene, so it must be gone from the Text page.
    expect(screen.queryByRole("heading", { name: "Frame" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Scene" }));
    expect(getPrefs().visualsPage).toBe("scene");
    expect(screen.getByRole("heading", { name: "Frame" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Audiogram" })).toBeNull();
  });

  it("R5: the persisted page is where a fresh mount lands", () => {
    setPrefs({ visualsPage: "live" });
    render(<ParamsPanel />);
    expect(
      railItems().find((b) => b.getAttribute("aria-current") === "true")?.dataset.section,
    ).toBe("live");
    expect(screen.getByRole("heading", { name: "Live" })).toBeTruthy();
  });

  it("R6: roving tabindex — the rail is ONE tab stop", () => {
    render(<ParamsPanel />);
    const items = railItems();
    // Nine tab stops before any page control would be a real regression
    // against the five-button Segmented the rail replaces.
    expect(items.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(items.find((b) => b.tabIndex === 0)!.dataset.section).toBe("mode");
    expect(items.filter((b) => b.tabIndex === -1)).toHaveLength(7);
  });

  it("R7: arrows move and activate, wrapping; Home/End jump to the ends", () => {
    render(<ParamsPanel />);
    const at = () => document.activeElement as HTMLButtonElement;

    railItems()[0].focus();
    fireEvent.keyDown(at(), { key: "ArrowDown" });
    expect(at().dataset.section).toBe("motion");
    expect(getPrefs().visualsPage).toBe("motion"); // follow-focus

    fireEvent.keyDown(at(), { key: "End" });
    expect(at().dataset.section).toBe("live");
    fireEvent.keyDown(at(), { key: "ArrowDown" }); // wraps
    expect(at().dataset.section).toBe("mode");
    fireEvent.keyDown(at(), { key: "ArrowUp" }); // wraps the other way
    expect(at().dataset.section).toBe("live");
    fireEvent.keyDown(at(), { key: "Home" });
    expect(at().dataset.section).toBe("mode");
    expect(getPrefs().visualsPage).toBe("mode");
  });

  it("R8: an unavailable destination is dimmed and clickable, and its page says why", () => {
    // led-matrix drives none of the three motion masters (presetMasters).
    act(() => useVizStore.setState({ presetId: "led-matrix" }));
    render(<ParamsPanel />);
    const motion = railItems().find((b) => b.dataset.section === "motion")!;
    const reason = "This visual has no rotation, pulse or detail masters";
    expect(motion.classList.contains("is-unavailable")).toBe(true);
    expect(motion.getAttribute("title")).toBe(reason);
    // F1: dimmed, never hidden, never aria-disabled — the page is reachable
    // and explains itself when you get there.
    expect(motion.getAttribute("aria-disabled")).toBeNull();
    expect(motion.hasAttribute("disabled")).toBe(false);

    fireEvent.click(motion);
    expect(document.querySelector(".panel-empty")?.textContent).toBe(reason);
  });

  it("R9: badges count the document and never touch the accessible name", () => {
    seedRoute("hue");
    render(<ParamsPanel />);
    const mod = railItems().find((b) => b.dataset.section === "modulation")!;
    const badge = mod.querySelector(".group-count")!;
    expect(badge.textContent).toBe("1");
    // aria-hidden so getByRole("button", { name }) stays exact; the count is
    // spoken through the title instead.
    expect(badge.getAttribute("aria-hidden")).toBe("true");
    expect(mod.getAttribute("title")).toBe("Modulation — 1 active route");
    expect(screen.getByRole("button", { name: "Modulation" })).toBe(mod);
    // A page with nothing to count shows no pill at all.
    expect(
      railItems()
        .find((b) => b.dataset.section === "text")!
        .querySelector(".group-count"),
    ).toBeNull();
  });

  it("R10: the context header names the mode once", () => {
    act(() => useVizStore.setState({ presetId: "spectrum-bars" }));
    render(<ParamsPanel />);
    const name = presets.find((p) => p.id === "spectrum-bars")!.name;
    expect(document.querySelector(".visuals-context .section-title")?.textContent).toBe(name);
    // Once, not twice: this is why the mode section dropped its own title.
    expect(screen.getByText(name)).toBeTruthy();
  });

  it("R11: search pins its own rail item and crosses pages", () => {
    render(<ParamsPanel />);
    // "vignette" is a Post control (Scene page) while the rail sits on Mode.
    fireEvent.change(screen.getByLabelText("Search controls"), { target: { value: "vignette" } });

    const pinned = rail().querySelector('[data-section="search"]')!;
    expect(pinned.classList.contains("active")).toBe(true);
    expect(pinned.getAttribute("aria-current")).toBe("true");
    // While searching no destination claims to be current.
    expect(railItems().some((b) => b.getAttribute("aria-current") === "true")).toBe(false);
    expect(screen.getByRole("heading", { name: "Post" })).toBeTruthy();

    // Clicking it clears the query and returns to the page it left.
    fireEvent.click(pinned);
    expect((screen.getByLabelText("Search controls") as HTMLInputElement).value).toBe("");
    expect(rail().querySelector('[data-section="search"]')).toBeNull();
    expect(screen.queryByRole("heading", { name: "Post" })).toBeNull();
  });

  it("R12: no section collapses any more — one navigation model", () => {
    render(<ParamsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Scene" }));
    expect(document.querySelectorAll(".section-toggle")).toHaveLength(0);
    expect(document.querySelector(".panel-tabs")).toBeNull();
    // Section headings are plain headings inside the shared .panel-section /
    // .section-head / .section-title idiom.
    const head = screen.getByRole("heading", { name: "Frame" });
    expect(head.tagName).toBe("H3");
    expect(head.classList.contains("section-title")).toBe(true);
    expect(head.closest(".panel-section")).toBeTruthy();
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
