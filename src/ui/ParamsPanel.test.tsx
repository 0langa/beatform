// @vitest-environment jsdom
import { StrictMode, useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_PREFS, getPrefs, setPrefs, subscribePrefs } from "../state/prefs";
import { ParamsPanel } from "./ParamsPanel";
import { cardHeading } from "./ModulationPage";
import { __meterCount } from "./ModMeters";
import { formatValue } from "./kit";
import { renderProbe } from "./testing/renderProbe";
import { presets } from "../render/presets";
import {
  advancedKeys,
  allParams,
  groupParams,
  isModTarget,
  POST_MOD_TARGETS,
} from "../render/types";
import { BUILDER2_ID } from "../render/builder2";
import { LFO_SOURCES, MOD_LAG_MAX_SEC, MOD_SOURCES } from "../state/modMatrix";
import { MOD_ROUTE_RECIPES } from "../state/modRoutePresets";

/**
 * The Visuals contract after P-12.
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
  // ModMeters is in this file's import graph as of P-1 stage 3 (the Modulation
  // page mounts the driver). The driver bails on `peekAnalyzer() -> null`
  // before it ever reads stems, but a mock that simply OMITS an export the
  // subject imports is a TypeError waiting for the first test that hands the
  // analyzer back — so it is stubbed rather than left undefined.
  getLiveStemValues: vi.fn(() => undefined),
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
  // Prefs bleed between tests otherwise — the panel seeds advancedGroups,
  // the active page and the collapse set from getPrefs() at MOUNT, so a
  // collapse written by one test silently hides controls from the next (it
  // only ever worked because that describe was last in the file).
  setPrefs(DEFAULT_PREFS);
  errorSpy.mockRestore();
  // The standing anti-allocation guard for the whole file: an allocating
  // selector is a crash class, and the `.filter()` shape dies with no React
  // warning at all — this is what notices it.
  expect(consoleErrors.join("\n")).not.toMatch(/getSnapshot should be cached|Maximum update depth/);
  // The meter registry is MODULE-level, so an element that unmounts without
  // its ref cleanup running leaks across the whole suite and every later
  // assertion about meter counts is measuring the previous test. Mirrors
  // ModMeters.test.tsx's own guard; `cleanup()` above is what makes it hold.
  expect(__meterCount()).toBe(0);
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
 * T7–T11 keep their subjects verbatim across P-1 stage 3; only the SELECTOR
 * moved. The Modulation page is now one CARD PER MODULATED CONTROL, so a
 * page-wide `getByTitle("Which knob it moves")` matches one picker per card
 * the moment a second knob is modulated — every one of these scopes into a
 * single `.mod-card` instead. They stay the canary for the routing grid.
 */

/** Navigate to the Modulation page. Its own name in the rail is the P-1 claim. */
function gotoModulation() {
  fireEvent.click(screen.getByRole("button", { name: "Modulation" }));
}

/** One card per modulated target — every route on that target lives inside. */
function cards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".mod-card")];
}

/** A second real target of spectrum-bars, taken from the registry rather than
 *  spelled out, so re-tiering a param cannot quietly rot these tests. */
function otherTarget(): string {
  return allParams(spectrumBars())
    .filter(isModTarget)
    .map((p) => p.key)
    .find((k) => k !== "hue")!;
}

describe("modulation & MIDI target lists (RP-2 / RP-14)", () => {
  it('T7: mod:"off" params are absent from the route-target picker', () => {
    // spectrum-bars: "mirror"/"peaks" are pure toggles (mod:"off"); "hue" is a
    // regular target. A route must exist for the picker to render at all.
    expect(spectrumBars().params.find((p) => p.key === "mirror")?.mod).toBe("off");
    seedRoute("hue");
    render(<ParamsPanel />);
    gotoModulation();
    const select = within(cards()[0]).getByTitle("Which knob it moves") as HTMLSelectElement;
    const values = [...select.querySelectorAll("option")].map((o) => o.getAttribute("value"));
    // Derived from the registry, never a literal list: the contract is
    // "everything allParams+isModTarget offers, plus every post target".
    const offered = new Set(values);
    for (const p of allParams(spectrumBars()).filter(isModTarget)) {
      expect(offered.has(p.key)).toBe(true);
    }
    for (const p of POST_MOD_TARGETS) expect(offered.has(`post:${p.key}`)).toBe(true);
    expect(values).toContain("hue");
    expect(values).not.toContain("mirror");
    expect(values).not.toContain("peaks");
    expect(values).toContain("post:chromatic"); // post targets unaffected
  });

  it("T8: a legacy route to an off param stays visible, inert, unrewritten and deletable", () => {
    seedRoute("mirror");
    render(<ParamsPanel />);
    gotoModulation();
    // A card list that only drew VALID (source, target) pairs would make this
    // route invisible — worse than the select-snapping bug below, because it
    // survives in the saved file with no way to see or delete it.
    expect(cards()).toHaveLength(1);
    const card = cards()[0];
    const select = within(card).getByTitle("Which knob it moves") as HTMLSelectElement;
    expect(select.value).toBe("mirror");
    expect(
      [...select.querySelectorAll("option")].some(
        (o) => o.getAttribute("value") === "mirror" && /not modulatable/.test(o.textContent ?? ""),
      ),
    ).toBe(true);
    // Labelled inert in the card BODY, not only inside a closed dropdown.
    expect(within(card).getByText(/does nothing/i)).toBeTruthy();
    // Opening the Visuals must not MUTATE the document — snapping the select
    // onto the first modulatable param would rewrite the route on the next
    // unrelated edit.
    expect(useVizStore.getState().activeMods[0].param).toBe("mirror");
    // …and there is a way out of it.
    fireEvent.click(within(card).getByRole("button", { name: /^Stop /i }));
    expect(useVizStore.getState().activeMods).toHaveLength(0);
  });
});

describe("modulation v2 UI (P-16/P-7)", () => {
  it("T9: source picker offers the whole beat-synced LFO family", () => {
    seedRoute();
    render(<ParamsPanel />);
    gotoModulation();
    const select = within(cards()[0]).getByTitle("What drives this route") as HTMLSelectElement;
    const values = [...select.querySelectorAll("option")].map((o) => o.getAttribute("value"));
    // Registry iteration, deliberately: the 19th LFO is covered for free.
    for (const s of LFO_SOURCES) expect(values).toContain(s.id);
    for (const s of MOD_SOURCES) expect(values).toContain(s.id);
  });

  it("T10: every recipe has a chip below the primary action, and clicking one lands real routes", () => {
    act(() => useVizStore.setState({ presetId: "spectrum-bars", activeMods: [] }));
    render(<ParamsPanel />);
    gotoModulation();
    for (const rec of MOD_ROUTE_RECIPES) {
      expect(screen.getByRole("button", { name: rec.name })).toBeTruthy();
    }
    // Recipes sit BELOW the create picker and are always visible — they are a
    // shortcut, not an empty-state placeholder.
    const create = screen.getByTitle("Choose a knob to modulate");
    const firstChip = screen.getByRole("button", { name: MOD_ROUTE_RECIPES[0].name });
    expect(
      create.compareDocumentPosition(firstChip) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Kick punch" }));
    // Assert the DOCUMENT, not a spy's argument shape.
    expect(useVizStore.getState().activeMods.length).toBeGreaterThan(0);
    expect(useVizStore.getState().activeMods.some((r) => r.source === "kick")).toBe(true);
    // Still offered once the page has content.
    expect(screen.getByRole("button", { name: "Kick punch" })).toBeTruthy();
  });

  it("T11: the shape controls write curve and lag, and the defaults clear the fields", () => {
    seedRoute();
    render(<ParamsPanel />);
    gotoModulation();
    const card = cards()[0];
    fireEvent.click(within(card).getByRole("button", { name: /^Response shape for/ }));

    fireEvent.click(within(card).getByRole("button", { name: "Exp" }));
    expect(useVizStore.getState().activeMods[0].curve).toBe("exp");
    fireEvent.click(within(card).getByRole("button", { name: "Linear" }));
    expect(useVizStore.getState().activeMods[0].curve).toBeUndefined();

    // Rise/Fall reach the validator's own bound now, not the old one-way 2 s
    // valve that made half the accepted range unreachable from the UI.
    const lag = card.querySelectorAll<HTMLInputElement>(".mod-lag .slider");
    expect(lag).toHaveLength(2);
    expect(lag[0].max).toBe(String(MOD_LAG_MAX_SEC));
    expect(lag[1].max).toBe(String(MOD_LAG_MAX_SEC));
    fireEvent.change(lag[1], { target: { value: "0.35" } });
    expect(useVizStore.getState().activeMods[0].release).toBeCloseTo(0.35);
    fireEvent.change(lag[1], { target: { value: "0" } });

    // THE PERSISTED-SHAPE GUARANTEE, asserted on the projection that actually
    // reaches disk: a widget that wrote concrete neutrals would rewrite the
    // shape of every route it merely RENDERED, in every saved project and
    // .bftheme, and validModRoutes omits rather than defaults.
    const route = useVizStore.getState().activeMods[0];
    expect(Object.keys(JSON.parse(JSON.stringify(route))).sort()).toEqual([
      "amount",
      "id",
      "param",
      "source",
    ]);
  });

  it("T18: retargeting a stacked card moves EVERY route on it", () => {
    const a = { id: "r1", source: "kick" as const, param: "hue", amount: 0.5 };
    const b = { id: "r2", source: "bass" as const, param: "hue", amount: -0.25 };
    act(() =>
      useVizStore.setState({
        presetId: "spectrum-bars",
        activeMods: [a, b],
        modsByPreset: { ...useVizStore.getState().modsByPreset, "spectrum-bars": [a, b] },
      }),
    );
    render(<ParamsPanel />);
    gotoModulation();
    // Two routes on one knob are ONE card: that grouping is applyMods'
    // accumulation key (`out[route.param]` read back and clamped per route),
    // not a presentation choice.
    expect(cards()).toHaveLength(1);
    expect(within(cards()[0]).getAllByTitle("What drives this route")).toHaveLength(2);
    const next = otherTarget();
    fireEvent.change(within(cards()[0]).getByTitle("Which knob it moves"), {
      target: { value: next },
    });
    // The R14 last-write-wins lesson: one patch per route, each re-reading
    // get(), or the second route is silently left behind on the old target.
    expect(useVizStore.getState().activeMods.map((r) => r.param)).toEqual([next, next]);
  });

  it('T20: no built-in target label contains " · ", so the heading rule never eats one', () => {
    // The safety proof for the card heading, pinned. cardHeading() prints the
    // tail after the LAST " · " so a Builder v2 virtual param
    // (`L2 Particles · Density`) reads as `Density` under its own
    // `Layer 2 · Particles` header. If a BUILT-IN ever adopted that
    // separator, the rule would silently eat half of its label.
    for (const preset of presets) {
      if (preset.id === BUILDER2_ID) continue; // the one deliberate user, below
      for (const p of allParams(preset).filter(isModTarget)) {
        expect(`${preset.id}/${p.key}: ${p.label}`).not.toContain(" · ");
        expect(cardHeading(p.label)).toBe(p.label);
      }
    }
    for (const p of POST_MOD_TARGETS) expect(cardHeading(p.label)).toBe(p.label);

    // The deliberate case, ASSERTED rather than assumed: every Builder label
    // that carries the separator shortens to a heading whose dropped prefix
    // is already printed by that param's own group header, one line above.
    const builder = presets.find((p) => p.id === BUILDER2_ID)!;
    let shortened = 0;
    for (const { group, params } of groupParams(builder, allParams(builder).filter(isModTarget))) {
      for (const p of params) {
        if (!p.label.includes(" · ")) continue;
        shortened += 1;
        const cut = p.label.lastIndexOf(" · ");
        expect(cardHeading(p.label)).toBe(p.label.slice(cut + 3));
        const [, n, type] = /^L(\d+) (.+)$/.exec(p.label.slice(0, cut))!;
        expect(group.label).toBe(`Layer ${n} · ${type}`);
      }
    }
    expect(shortened).toBeGreaterThan(0);
  });

  it("T21: a card names the control, its resting value and where the route takes it", () => {
    seedRoute("hue"); // amount 0.5
    const hue = allParams(spectrumBars()).find((p) => p.key === "hue")!;
    act(() => useVizStore.setState({ activeParams: { hue: hue.min } }));
    render(<ParamsPanel />);
    gotoModulation();
    const card = cards()[0];
    // The heading takes the WHOLE header row — no resting-value column beside
    // it. At the 380px minimum a 44px readout leaves the heading 59px of text
    // against a ~90px p90 label, i.e. the card's own name truncating on most
    // controls. The resting value lives in the range line instead.
    expect(card.querySelector(".mod-card-base")).toBeNull();
    // The resulting range, both as text and as the painted span the live
    // marker walks. amount 0.5 from the bottom of the range = the lower half.
    const track = card.querySelector<HTMLElement>(".mod-range-track")!;
    expect(track.style.getPropertyValue("--from")).toBe("0%");
    expect(track.style.getPropertyValue("--span")).toBe("50%");
    expect(track.style.getPropertyValue("--dir")).toBe("1");
    expect(card.querySelector(".mod-range-text")!.textContent).toBe(
      `${formatValue(undefined, hue.min, hue.step)} → ${formatValue(undefined, hue.min + 0.5 * (hue.max - hue.min), hue.step)}`,
    );
    // The two elements the meter engine drives. It writes `--v` on these and
    // nothing else; every pixel of travel is CSS.
    expect(card.querySelector(".mod-swing-arm")).toBeTruthy();
    expect(card.querySelector(".mod-diamond")).toBeTruthy();

    // Negative depth paints the same span the other way, so the marker walks
    // DOWN from the resting value instead of up.
    act(() =>
      useVizStore.setState({
        activeParams: { hue: hue.max },
        activeMods: [{ id: "r1", source: "kick", param: "hue", amount: -0.5 }],
      }),
    );
    const flipped = cards()[0].querySelector<HTMLElement>(".mod-range-track")!;
    expect(flipped.style.getPropertyValue("--from")).toBe("50%");
    expect(flipped.style.getPropertyValue("--span")).toBe("50%");
    expect(flipped.style.getPropertyValue("--start")).toBe("1");
    expect(flipped.style.getPropertyValue("--dir")).toBe("-1");
  });

  it("T22: the create picker is target-first and cannot stack a duplicate", () => {
    act(() =>
      useVizStore.setState({ presetId: "spectrum-bars", activeMods: [], modsByPreset: {} }),
    );
    render(<ParamsPanel />);
    gotoModulation();
    const create = screen.getByTitle("Choose a knob to modulate") as HTMLSelectElement;
    expect(create.value).toBe("");
    fireEvent.change(create, { target: { value: "hue" } });
    // The retired "+ Route" button wrote `param: ""` on any visual with no
    // modulatable knobs (validModRoutes then dropped the route on reload) and
    // stacked a fresh compounding route on every extra click. A list of real
    // targets whose routed entries are disabled makes both unreachable.
    const mods = useVizStore.getState().activeMods;
    expect(mods).toHaveLength(1);
    expect(mods[0].param).toBe("hue");
    expect(mods[0].source).toBe("kick");
    expect(create.value).toBe("");
    const routedOption = [...create.querySelectorAll("option")].find((o) => o.value === "hue")!;
    expect(routedOption.disabled).toBe(true);
    expect([...create.querySelectorAll("option")].every((o) => o.value !== "mirror")).toBe(true);
  });

  it("T23: a route to a stem that is not loaded still names itself", () => {
    seedRoute("hue", { source: "stem1:kick" });
    render(<ParamsPanel />);
    gotoModulation();
    const select = within(cards()[0]).getByTitle("What drives this route") as HTMLSelectElement;
    // `stems` is runtime-only while `modsByPreset` persists, so EVERY
    // reopened stem project lands here. Blank is not survivable: the source
    // is the route row's primary text.
    expect(select.value).toBe("stem1:kick");
    expect(select.selectedOptions[0].textContent).toMatch(/stem not loaded/);
    expect(useVizStore.getState().activeMods[0].source).toBe("stem1:kick");
  });

  it("T24: the Driven by chips meter the sources in use and filter the cards", () => {
    const other = otherTarget();
    const a = { id: "r1", source: "kick" as const, param: "hue", amount: 0.5 };
    const b = { id: "r2", source: "bass" as const, param: other, amount: 0.4 };
    act(() =>
      useVizStore.setState({
        presetId: "spectrum-bars",
        activeMods: [a, b],
        modsByPreset: { ...useVizStore.getState().modsByPreset, "spectrum-bars": [a, b] },
      }),
    );
    render(<ParamsPanel />);
    gotoModulation();
    // One meter per source IN USE — never one per registry entry (34–62 of
    // those is exactly the load v2.80.0 removed).
    expect(document.querySelectorAll(".mod-source-chip")).toHaveLength(2);
    expect(document.querySelectorAll(".mod-chip-meter .mod-meter-fill")).toHaveLength(2);
    expect(cards()).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Kick" }));
    expect(cards()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Kick" }));
    expect(cards()).toHaveLength(2);

    // The filter is DERIVED, never stored back: deleting the last route on
    // the filtered source must not leave a page filtered to nothing, and
    // getting there must not need a setState during render.
    fireEvent.click(screen.getByRole("button", { name: "Bass" }));
    expect(cards()).toHaveLength(1);
    act(() =>
      useVizStore.setState({
        activeMods: [a],
        modsByPreset: { ...useVizStore.getState().modsByPreset, "spectrum-bars": [a] },
      }),
    );
    expect(cards()).toHaveLength(1);
    expect(within(cards()[0]).getByTitle("Which knob it moves")).toHaveProperty("value", "hue");
  });

  it("T25: a non-default curve or lag is printed on the CLOSED card", () => {
    seedRoute("hue", { curve: "exp", release: 0.35 });
    render(<ParamsPanel />);
    gotoModulation();
    const card = cards()[0];
    // The disclosure is a USER's choice and is never width-gated, so nothing
    // it hides may be the only place a set value appears.
    expect(within(card).queryByRole("button", { name: "Exp" })).toBeNull();
    expect(within(card).getByText("Exp · fall 0.35 s")).toBeTruthy();

    fireEvent.click(within(card).getByRole("button", { name: /^Response shape for/ }));
    expect(within(card).getByRole("button", { name: "Exp" })).toBeTruthy();
    expect(within(card).queryByText("Exp · fall 0.35 s")).toBeNull();
    // Nothing about opening it touched the document.
    expect(useVizStore.getState().activeMods[0].release).toBe(0.35);
  });

  it("T26: the empty page teaches what modulation is for", () => {
    act(() => useVizStore.setState({ presetId: "spectrum-bars", activeMods: [] }));
    render(<ParamsPanel />);
    gotoModulation();
    expect(cards()).toHaveLength(0);
    // P-1 promoted this page precisely so a first-time user learns the idea
    // HERE. An empty list with an add button teaches nothing.
    const hint = document.querySelector(".mod-empty")!;
    expect(hint.textContent).toMatch(/music move a knob/i);
    expect(hint.textContent).toMatch(/export/i);
    // …and the primary action is still right there.
    expect(screen.getByTitle("Choose a knob to modulate")).toBeTruthy();
  });
});

describe("the meter seam (P-1 stage 3)", () => {
  it("T27: meters register with the driver on this page only, and survive a depth drag", () => {
    seedRoute("hue");
    render(<ParamsPanel />);
    // The registry is module-level and the driver's rAF is created by the
    // page's own subtree, so nothing exists until you are looking at it.
    expect(__meterCount()).toBe(0);
    gotoModulation();
    // One chip meter (kick is the only source in use) + one route arm.
    expect(__meterCount()).toBe(2);

    // WHY THE REF IS MEMOIZED, asserted rather than asserted-in-a-comment. A
    // ref callback built inline has a fresh identity every render, so React
    // runs its cleanup — which REMOVES `--v` — and re-registers. This page
    // re-renders once per pointer move while Depth is dragged, and on a paused
    // track the driver's "track time did not move" fast path would then leave
    // every meter at its resting position for up to 250 ms. `--v` is written
    // here the way the driver writes it, and must still be there afterwards.
    const arm = document.querySelector<HTMLElement>(".mod-swing-arm")!;
    arm.style.setProperty("--v", "0.400");
    act(() => useVizStore.getState().updateModRoute("r1", { amount: 0.31 }));
    expect(
      document.querySelector<HTMLElement>(".mod-swing-arm")!.style.getPropertyValue("--v"),
    ).toBe("0.400");
    expect(__meterCount()).toBe(2);

    // It DOES re-register when the displayed value would change anyway — the
    // spec is memoized on (source, curve), not frozen.
    act(() => useVizStore.getState().updateModRoute("r1", { source: "bass" }));
    expect(
      document.querySelector<HTMLElement>(".mod-swing-arm")!.style.getPropertyValue("--v"),
    ).toBe("");
    expect(__meterCount()).toBe(2);

    // Leaving the page tears the whole subtree down; the file's afterEach
    // guard is what proves the same for unmount.
    fireEvent.click(screen.getByRole("button", { name: "Scene" }));
    expect(__meterCount()).toBe(0);
  });
});

describe("the driven mark reaches the post rows (P-1 stage 3)", () => {
  /** The Post row whose label is `label`, and the `.param-slot` around it. */
  function postSlot(label: string): HTMLElement | undefined {
    return [...document.querySelectorAll<HTMLElement>(".param-slot")].find(
      (slot) => slot.querySelector(".row-label")?.textContent === label,
    );
  }

  it("T28: a post: route marks its Scene row, and only that row", () => {
    // `drivenParamKeys` deliberately excludes post: routes — post targets are
    // namespaced keys no preset declares and they never reach ParamGroups —
    // so this is the OTHER half of that decision. Without it, the one class of
    // route that lives on a different page from its knob would have no mark
    // anywhere, which is exactly the page-independence H5 asked for.
    seedRoute("post:bloom");
    render(<ParamsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Scene" }));

    const bloom = postSlot("Bloom");
    expect(bloom).toBeTruthy();
    expect(bloom!.className).toContain("is-driven");
    expect(bloom!.getAttribute("title")).toMatch(/still the base value/i);
    // The mark is on the SLOT, never a fourth child of the row: `.param-row`
    // is a fixed 76px / 1fr / 44px grid on every surface the kit serves.
    expect(bloom!.querySelectorAll(".param-row")).toHaveLength(1);
    expect(bloom!.querySelector(".param-row")!.children).toHaveLength(3);

    // Every other post row is untouched — a mark that lit all six would be
    // indistinguishable from decoration.
    for (const other of ["Exposure", "Bloom threshold", "Vignette", "Chromatic", "Film grain"]) {
      expect(postSlot(other)?.className).not.toContain("is-driven");
    }
    expect(document.querySelectorAll(".param-slot.is-driven")).toHaveLength(1);

    // …and it did not leak onto Mode: a post: route moves no preset knob, so
    // `drivenParamKeys` must leave that page completely unmarked.
    fireEvent.click(screen.getByRole("button", { name: "Mode" }));
    expect(document.querySelectorAll(".param-slot").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".param-slot.is-driven")).toHaveLength(0);
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

  /**
   * The P-9 sibling of T12. `toggleAdvanced` has the identical hazardous
   * shape — setPrefs from a click handler, outside the setState updater — and
   * StrictMode re-running updaters in the render phase is what turns a
   * setPrefs placed inside one into "Cannot update a component (App)".
   * OPEN then CLOSE, so both writes are real: setPrefs early-exits on an
   * unchanged value (samePrefs), and two identical clicks would evaporate
   * half the repro.
   */
  it("T12c: a group's expert disclosure persists without a render-phase update (StrictMode)", () => {
    render(
      <StrictMode>
        <PrefsMirror />
        <StoreMirror />
        <ParamsPanel />
      </StrictMode>,
    );
    const tiers = document.querySelectorAll(".group-advanced");
    expect(tiers.length).toBeGreaterThan(0);
    fireEvent.click(tiers[0]);
    expect(getPrefs().advancedGroups).toHaveLength(1);
    fireEvent.click(document.querySelectorAll(".group-advanced")[0]);
    expect(getPrefs().advancedGroups).toEqual([]);
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
    // The labels the harness must NOT select on, but the user reads. The
    // asymmetry with the ids above is deliberate and permanent: page ids are
    // persisted (prefs.visualsPage) and selected on by
    // scripts/gpu-pixel-matrix.mjs, so they are frozen; labels are an iterated
    // design surface. Two moved in 2.82.0 with no id change: "Motion" became
    // "Global motion" because the per-visual `motion` group renders on Mode,
    // and "Themes" became "Looks & themes" because the user-looks save/manage
    // surface moved onto that page.
    expect(railItems().map((b) => b.querySelector(".rail-label")?.textContent)).toEqual([
      "Mode",
      "Global motion",
      "Looks & themes",
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
    // from the rail, and its content must NOT be on the Sync page. Re-pointed
    // at `.mod-card` and the create picker for stage 3 — the old "+ Route"
    // button and page-wide target select are gone, but the NEGATIVE half is
    // what stops a refactor putting modulation back on Sync, so it stays.
    seedRoute("hue");
    render(<ParamsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    expect(document.querySelector(".mod-card")).toBeNull();
    expect(screen.queryByTitle("Which knob it moves")).toBeNull();
    expect(screen.queryByTitle("Choose a knob to modulate")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Modulation" }));
    expect(document.querySelectorAll(".mod-card")).toHaveLength(1);
    expect(screen.getByTitle("Which knob it moves")).toBeTruthy();
    expect(screen.getByTitle("Choose a knob to modulate")).toBeTruthy();
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
    // Derived, not the literal 7: the contract is "every OTHER item is -1",
    // and a hardcoded count silently weakens it the day a ninth page lands.
    expect(items.filter((b) => b.tabIndex === -1)).toHaveLength(items.length - 1);
  });

  it("R7: arrows move and activate, wrapping; Home/End jump to the ends", () => {
    render(<ParamsPanel />);
    const at = () => document.activeElement as HTMLButtonElement;
    // Derived from the rail itself for the same reason as R6 — the subject is
    // "arrows move AND activate, with wrap", not which ids happen to be first
    // and last today.
    const ids = railItems().map((b) => b.dataset.section);
    const [first, second, last] = [ids[0], ids[1], ids[ids.length - 1]];

    railItems()[0].focus();
    fireEvent.keyDown(at(), { key: "ArrowDown" });
    expect(at().dataset.section).toBe(second);
    expect(getPrefs().visualsPage).toBe(second); // follow-focus

    fireEvent.keyDown(at(), { key: "End" });
    expect(at().dataset.section).toBe(last);
    fireEvent.keyDown(at(), { key: "ArrowDown" }); // wraps
    expect(at().dataset.section).toBe(first);
    fireEvent.keyDown(at(), { key: "ArrowUp" }); // wraps the other way
    expect(at().dataset.section).toBe(last);
    fireEvent.keyDown(at(), { key: "Home" });
    expect(at().dataset.section).toBe(first);
    expect(getPrefs().visualsPage).toBe(first);
  });

  it("R8: an unavailable destination is dimmed and clickable, and its page says why", () => {
    // led-matrix drives none of the three motion masters (presetMasters).
    act(() => useVizStore.setState({ presetId: "led-matrix" }));
    render(<ParamsPanel />);
    const motion = railItems().find((b) => b.dataset.section === "motion")!;
    // The signpost half is load-bearing: the per-visual `motion` group DOES
    // render on Mode, so "no motion controls" without it reads as a lie.
    const reason =
      "This visual has no rotation, pulse or detail masters — its own motion controls are on Mode";
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

  /**
   * R12's other half, and the reason it is a separate test: Layers is the one
   * section on Scene that LayersPanel owns rather than ParamsPanel, and it was
   * the only one whose title was a <span>. Visually identical — `.section-title`
   * is the same rule — but it left Scene rendering three headings for four
   * sections, so the heading tree said the layer list belonged to whatever
   * section came before it. Asserting the tag, not just the class, is the
   * point: a class alone is what let this drift.
   */
  it("R12b: the Layers section heading is a real heading, in the shared idiom", () => {
    render(<ParamsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Scene" }));
    const head = screen.getByRole("heading", { name: "Layers" });
    expect(head.tagName).toBe("H3");
    expect(head.classList.contains("section-title")).toBe(true);
    expect(head.closest(".panel-section")).toBeTruthy();
    // All four of Scene's sections are headed the same way.
    for (const name of ["Background", "Frame", "Post", "Layers"]) {
      expect(screen.getByRole("heading", { name }).tagName).toBe("H3");
    }
  });

  /**
   * D6, and the whole reason the split is a split. The SAVE/MANAGE half of
   * looks (your saved chips, the save form, Import…, the Gallery deep link) is
   * occasional and is what makes a destination worth visiting, so it moved.
   * The FACTORY style chips are the visual's own presets — the first thing
   * touched after picking a mode, with the context header right above them
   * naming which one is active — so they stayed. Asserting both halves in one
   * test is deliberate: either one drifting alone is the regression.
   */
  it("R18: the looks save/manage surface is on Looks & themes; the factory chips stayed on Mode", () => {
    const def = spectrumBars();
    const style = def.styles![0];
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

    // Mode keeps the visual's own presets and its description…
    expect(screen.getByTitle(`Apply the "${style.name}" look`)).toBeTruthy();
    expect(document.querySelector(".preset-desc")).not.toBeNull();
    // …and none of the save/manage chrome (~70px off the tallest page).
    expect(document.querySelector(".user-presets")).toBeNull();
    expect(screen.queryByRole("button", { name: 'Delete "Evening"' })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Save look" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Import…" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Looks & themes" }));
    expect(screen.getByRole("button", { name: 'Delete "Evening"' })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Save look" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import…" })).toBeTruthy();
    expect(screen.getByText("Browse looks in the Gallery…")).toBeTruthy();
    // The factory chips did NOT follow.
    expect(screen.queryByTitle(`Apply the "${style.name}" look`)).toBeNull();
    expect(document.querySelector(".preset-desc")).toBeNull();
    // ONE section on the page, not a second bare-headed one, and the looks
    // hint says "this visual" rather than printing the name — R10's
    // getByText(preset.name) throws on a second match, so this is the guard
    // that keeps the wording honest from here.
    expect(document.querySelectorAll(".panel-scroll .panel-section")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Looks & themes" })).toBeTruthy();
    expect(screen.getByText(def.name)).toBeTruthy();
  });

  /**
   * The blob has to move with the content. Sections are filtered by
   * `SectionDef.search` while ParamGroups filters ROWS, so a word left behind
   * on the Mode blob routes the user to a page where the thing they typed is
   * not there — and a word never added to the Themes blob makes the surface
   * unreachable by search at its new address.
   *
   * radial-burst rather than spectrum-bars: it is one of the two presets with
   * a `cover` param, so it renders the center-image extra — the reason
   * "custom" had to STAY on the Mode blob even though the rest of the looks
   * vocabulary left with the surface.
   */
  it("R19: search follows the looks surface to Looks & themes", () => {
    act(() =>
      useVizStore.setState({
        presetId: "radial-burst",
        userPresets: [
          {
            id: "u1",
            name: "Evening",
            presetId: "radial-burst",
            params: {},
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    render(<ParamsPanel />);
    const search = screen.getByLabelText("Search controls");

    // Found at the new address — including by the one name on the page the
    // user chose themselves.
    for (const q of ["bfpreset", "gallery", "evening"]) {
      fireEvent.change(search, { target: { value: q } });
      expect(screen.getByRole("button", { name: "+ Save look" })).toBeTruthy();
      // …and no longer at the old one: the Mode section did not match.
      expect(document.querySelector(".preset-desc")).toBeNull();
    }

    // "custom" is NOT looks vocabulary — it covers the "Custom" style readout
    // and the center-image extra ("choose custom picture"), both still on
    // Mode. Dropping it from the blob would hide the very row whose own search
    // text advertises it.
    fireEvent.change(search, { target: { value: "custom" } });
    expect(document.querySelector(".center-image-row")).not.toBeNull();
  });
});

/**
 * P-9: the global Essentials/All switch is gone and every group owns its own
 * expert tier. What the panel is responsible for is the WIRING — reading and
 * writing `prefs.advancedGroups`, and the one-click bulk switch that stops
 * per-group disclosures from charging a power user six clicks for what the
 * retired switch charged one. The rendering contract itself (which rows are
 * curated, where the button sits, that search ignores the tier) is
 * ParamGroups' and is proven in ParamGroups.test.tsx.
 */
describe("per-group expert tier wiring (P-9)", () => {
  /** The groups of a preset that actually RENDER a disclosure — read out of
   * the registry, not out of the panel, so this stays a contract rather than
   * a mirror of the implementation. spectrum-bars' Motion group has one
   * curated knob and zero expert ones, which is exactly the case that makes
   * "every group id" the wrong set to write. */
  const expertGroupIds = (presetId: string) => {
    const def = presets.find((p) => p.id === presetId)!;
    const adv = advancedKeys(def);
    return groupParams(def, allParams(def))
      .filter((g) => g.params.some((s) => adv.has(s.key)))
      .map((g) => g.group.id);
  };

  it("R13: the tier is closed at mount, and one click persists that group's bare id", () => {
    act(() => useVizStore.setState({ presetId: "spectrum-bars" }));
    render(<ParamsPanel />);
    // Default closed — the seed from the retired switch happens in prefs, and
    // DEFAULT_PREFS carries none of it.
    expect(getPrefs().advancedGroups).toEqual([]);

    const tiers = [...document.querySelectorAll(".group-advanced")];
    expect(tiers.map((t) => t.getAttribute("aria-expanded"))).toEqual(tiers.map(() => "false"));
    fireEvent.click(tiers[0]);

    // BARE id, no "group:" prefix — advancedGroups is its own prefs field and
    // does not share collapsedSections' namespace.
    const first = expertGroupIds("spectrum-bars")[0];
    expect(getPrefs().advancedGroups).toEqual([first]);
    expect(getPrefs().collapsedSections).toEqual([]);
    // Exactly one disclosure opened; the others are untouched.
    const after = [...document.querySelectorAll(".group-advanced")];
    expect(after.filter((t) => t.getAttribute("aria-expanded") === "true")).toHaveLength(1);
  });

  /**
   * THE BULK-SETTER TEST, and the reason the button could not be built from
   * ParamGroups' pinned props. A loop of `onToggleAdvanced(id, true)` collapses
   * to last-write-wins: every call derives `next` from the same closure-captured
   * `advancedGroups`, so N clicks-worth of intent lands as ONE open group and
   * N prefs writes. This asserts the inverse of both halves — every disclosure
   * open, from a SINGLE prefs notification.
   */
  it("R14: one click on Show every control opens every group, in one write", () => {
    act(() => useVizStore.setState({ presetId: "spectrum-bars" }));
    render(<ParamsPanel />);
    const ids = expertGroupIds("spectrum-bars");
    expect(ids.length).toBeGreaterThan(1); // or the test proves nothing
    expect(document.querySelectorAll(".group-advanced")).toHaveLength(ids.length);

    let writes = 0;
    const stop = subscribePrefs(() => {
      writes += 1;
    });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Show every control" }));
    } finally {
      stop();
    }

    expect(writes).toBe(1); // ONE update for N groups, not N updates
    expect([...getPrefs().advancedGroups].sort()).toEqual([...ids].sort());
    const open = [...document.querySelectorAll(".group-advanced")];
    expect(open.map((t) => t.getAttribute("aria-expanded"))).toEqual(open.map(() => "true"));

    // The label is the state readout, so it has to flip — and flipping back
    // must leave nothing behind.
    expect(screen.queryByRole("button", { name: "Show every control" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide expert controls" }));
    expect(getPrefs().advancedGroups).toEqual([]);
    expect(
      [...document.querySelectorAll(".group-advanced")].every(
        (t) => t.getAttribute("aria-expanded") === "false",
      ),
    ).toBe(true);
  });

  it("R15: the retired Essentials/All vocabulary left the search blob", () => {
    render(<ParamsPanel />);
    fireEvent.change(screen.getByLabelText("Search controls"), { target: { value: "essentials" } });
    // A blob that still answers to a control that no longer exists sends the
    // user to a page where they cannot find what they searched for.
    expect(document.querySelector(".panel-empty")?.textContent).toBe(
      "No controls match “essentials”.",
    );
    expect(document.querySelector(".param-groups")).toBeNull();
  });

  it("R15b: the bulk switch goes away while searching", () => {
    // Search already crosses the tier, so every match is on screen and the
    // switch has nothing left to reveal. ParamGroups hides the per-group
    // disclosures mid-search for the same reason; the two must agree, or the
    // page offers a control that cannot change what you are looking at.
    render(<ParamsPanel />);
    expect(document.querySelector(".param-groups-actions")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Search controls"), { target: { value: "hue" } });
    expect(document.querySelector(".param-groups")).not.toBeNull();
    expect(document.querySelector(".param-groups-actions")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search controls"), { target: { value: "" } });
    expect(document.querySelector(".param-groups-actions")).not.toBeNull();
  });

  it("R16: builder2 renders neither the grouped rows nor the bulk switch", () => {
    act(() => useVizStore.setState({ presetId: BUILDER2_ID }));
    render(<ParamsPanel />);
    // RP-20: builder2's virtual l<i>.* params exist for the modulation/MIDI
    // target lists, NOT as a second knob surface beside BuilderPanel. The
    // suppression guard was untested until the bulk switch joined it inside.
    expect(document.querySelector(".param-groups")).toBeNull();
    expect(document.querySelector(".param-groups-actions")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show every control" })).toBeNull();
    // …and the absence is a suppression, not an empty page: builder2 IS the
    // active visual and its own editor is what renders instead.
    expect(document.querySelector(".visuals-context .section-title")?.textContent).toBe("Builder");
    expect(document.querySelector(".panel-empty")).toBeNull();
  });

  it("R17: the whole-preset changed pill counts the expert TIER, not preset.advanced", () => {
    const def = spectrumBars();
    // `vignette` is a curated spec that still LIVES in advanced[] (the tier
    // flag re-tiers in place, at zero ABI cost). Counting raw membership would
    // bill it as expert; advancedKeys() must not.
    const curated = (def.advanced ?? []).find((s) => s.tier === "curated")!;
    const expert = (def.advanced ?? []).find((s) => s.tier === undefined)!;

    act(() =>
      useVizStore.setState({
        presetId: "spectrum-bars",
        activeParams: {
          ...useVizStore.getState().activeParams,
          [curated.key]: curated.default + 1,
        },
      }),
    );
    render(<ParamsPanel />);
    expect(document.querySelector(".panel-scroll .advanced-count")).toBeNull();

    cleanup();
    act(() =>
      useVizStore.setState({
        activeParams: { ...useVizStore.getState().activeParams, [expert.key]: expert.default + 1 },
      }),
    );
    render(<ParamsPanel />);
    // The pill lives in the Mode section's header, beside Reset — the old one
    // sat inside the density switch that no longer exists.
    const pill = document.querySelector(".section-head .advanced-count")!;
    expect(pill.textContent).toBe("1 changed");
    expect(pill.parentElement?.querySelector(".text-btn")?.textContent).toBe("Reset");
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
    // The looks surface lives on Looks & themes since 2.82.0; the subject of
    // this test — a declined askConfirm leaves userPresets untouched — is
    // unchanged, only its address is.
    fireEvent.click(screen.getByRole("button", { name: "Looks & themes" }));
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
