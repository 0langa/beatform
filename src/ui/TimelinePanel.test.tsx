// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { presets } from "../render/presets";
import type { AutomationLane, Scene, Timeline } from "../state/timeline";
import type { UserPreset } from "../state/userPresets";
import { clearHistory } from "../state/history";
import { renderProbe } from "./testing/renderProbe";
import { TimelinePanel } from "./TimelinePanel";

/**
 * The TimelinePanel contract after P-12 wave 2 — the panel the wave exists
 * for.
 *
 * What this file used to prove — "memo() bails when every prop keeps its
 * identity" — no longer exists to be proven: the panel takes no props, so memo
 * could never bail on anything and was removed. Eleven props became nine
 * subscriptions, one CHILD subscription and two click-time reads.
 *
 * ── The measurement, and why a commit count is the wrong instrument ────────
 *
 * At zoom 12 this panel's track is 11,280 px wide with ~840 ruler / scene /
 * keyframe elements, and it draws a playhead that must move at the 4 Hz
 * playback tick. So "does the tick commit?" is the wrong question — it has to,
 * and it did before the migration too. BOTH versions commit exactly once per
 * tick. What changed is WHAT RUNS inside that commit: 840 elements before,
 * one `<TimelinePlayhead />` div after. `renderProbe()` cannot tell those
 * apart (React calls a Profiler's onRender once per commit of the whole
 * subtree, whatever fraction of it re-rendered), so it is used here only to
 * prove that a commit did or did not happen at all.
 *
 * The load-bearing instrument is a counting getter on `timeline.scenes` — a
 * NESTED field the panel body reads unconditionally (the `sortedScenes` dep
 * array and the empty-lane hint) and that no selector touches. `s.timeline`
 * is selected by identity, so zustand re-running every subscriber's selector
 * on every setState — the objection that kills getters planted on store state
 * generally — cannot move this counter. It moves if and only if the body ran.
 *
 * Mocks: the panel now drives REAL store actions. The ruler's click-to-seek
 * reaches getEngine()/getAnalyzer(), which throw "services not initialized"
 * outside the browser; every on* prop used to be a vi.fn(), which hid that.
 */

const mocks = vi.hoisted(() => ({
  engine: {
    seek: vi.fn(),
    audioBuffer: null as { duration: number } | null,
    currentTime: 0,
    duration: 100,
    playing: false,
    setVolume: vi.fn(),
    onEnded: null,
    dispose: vi.fn(),
    ctx: { decodeAudioData: vi.fn() },
  },
  analyzer: { reset: vi.fn(), setSync: vi.fn() },
}));

vi.mock("../state/services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: () => mocks.engine,
  getAnalyzer: () => mocks.analyzer,
  peekAnalyzer: () => null,
  getLiveStemValues: vi.fn(() => undefined),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

vi.mock("../state/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/platform")>();
  return { ...actual, writeAutosave: vi.fn(async () => {}) };
});

const { useVizStore } = await import("../state/store");

/** Captured at module load, actions included — restoring by MERGE keeps the
 * action identities the panel's edit sites call through. */
const PRISTINE = { ...useVizStore.getState() };

let errorSpy: ReturnType<typeof vi.spyOn>;
let consoleErrors: string[] = [];

beforeEach(() => {
  consoleErrors = [];
  errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(" "));
  });
  mocks.engine.seek.mockClear();
  mocks.engine.audioBuffer = null;
  // history.ts keeps its undo/redo stacks and gesture-grouping key in module
  // state OUTSIDE the zustand store, so restoring PRISTINE below (a shallow
  // merge of store fields) cannot reset it — without this, a test's grouping
  // assertion could pass or fail depending on what an EARLIER test in this
  // file last recorded and how many wall-clock ms ago, since the 800ms
  // grouping window is real time. Same fix stemsModsActions.test.ts uses.
  clearHistory();
});

afterEach(() => {
  cleanup();
  // Never setState(x, true): a full replace would drop the actions.
  useVizStore.setState(PRISTINE);
  errorSpy.mockRestore();
  // The standing anti-allocation guard for the whole file: an allocating
  // selector is a crash class, and the `.filter()` shape dies with no React
  // warning at all — this is what notices it.
  expect(consoleErrors.join("\n")).not.toMatch(/getSnapshot should be cached|Maximum update depth/);
});

/**
 * A Timeline whose `scenes` reads are counted. Every body execution reads it
 * exactly twice — the `sortedScenes` useMemo dep array and the
 * `scenes.length === 0` empty hint — plus once more on the first run, when
 * that useMemo's factory actually executes (3 at mount, +2 per re-render). The
 * counter is proportional to body runs and independent of how much data the
 * panel holds.
 */
function probedTimeline(): { timeline: Timeline; bodyRuns: () => number } {
  let reads = 0;
  const scenes: Timeline["scenes"] = [];
  const timeline = {
    enabled: false,
    lanes: [],
    get scenes() {
      reads += 1;
      return scenes;
    },
  } as Timeline;
  return { timeline, bodyRuns: () => reads };
}

const PLAYBACK = {
  playing: true,
  time: 30,
  duration: 100,
  trackName: "drop.wav",
  loop: false,
  loopStart: null,
  loopEnd: null,
};

/** Seed everything the panel reads, mount it under a commit probe. */
function mountProbed(timeline: Timeline) {
  act(() =>
    useVizStore.setState({
      timeline,
      playback: PLAYBACK,
      beatGrid: null,
      sections: [],
      // null: the waveform effect early-returns, so jsdom is never asked for a
      // 2D canvas context it does not implement.
      waveformOverview: null,
      presetId: presets[0].id,
      simplifiedRenderer: false,
    }),
  );
  const { Probe, commits } = renderProbe();
  render(
    <Probe>
      <TimelinePanel />
    </Probe>,
  );
  expect(screen.getByText("Timeline")).toBeTruthy(); // it mounted
  return commits;
}

const playheadLeft = () =>
  document.querySelector<HTMLElement>(".tl-playhead")?.style.left ?? "(no playhead)";

describe("TimelinePanel selector granularity (P-12 wave 2)", () => {
  it("TL1: the 4 Hz playback tick moves the playhead WITHOUT running the panel body", () => {
    const { timeline, bodyRuns } = probedTimeline();
    const commits = mountProbed(timeline);
    const runsAtMount = bodyRuns();
    const commitsAtMount = commits();
    expect(runsAtMount).toBeGreaterThan(0); // both probes are live
    expect(commitsAtMount).toBeGreaterThan(0);
    const startLeft = playheadLeft();

    act(() => useVizStore.setState({ playback: { ...PLAYBACK, time: 60 } }));
    act(() => useVizStore.setState({ playback: { ...PLAYBACK, time: 90 } }));

    // Asserted in this order on purpose. Two commits happened and the
    // playhead moved, so <TimelinePlayhead /> is subscribed and did its job —
    // and these two assertions pass IDENTICALLY on the pre-migration panel,
    // where `time` was read at the top and all ~840 elements re-rendered.
    // A commit count cannot tell "one div re-rendered" from "the whole track
    // re-rendered": both are one commit.
    expect(commits()).toBe(commitsAtMount + 2);
    expect(playheadLeft()).not.toBe(startLeft);
    expect(playheadLeft()).toBe(`${(90 / 100) * 940}px`);
    // THE HEADLINE FIX, and the only assertion here that can see it. Before
    // the migration `time` was a prop, so each of those ticks reconciled the
    // whole track — four times a second, for the whole of playback, to move
    // one div.
    expect(bodyRuns()).toBe(runsAtMount);
  });

  it("TL2: a slider drag's pointer-rate activeParams write costs the panel nothing at all", () => {
    const { timeline, bodyRuns } = probedTimeline();
    const commits = mountProbed(timeline);
    const runsAtMount = bodyRuns();
    const commitsAtMount = commits();

    // setParam replaces the whole map on every pointermove — a fresh object,
    // so this is the shape that WOULD re-render a subscriber.
    act(() => useVizStore.setState({ activeParams: { hue: 0.5 } }));
    act(() => useVizStore.setState({ activeParams: { hue: 0.6 } }));

    // Not one body run and not one commit: unlike `time`, nothing rendered
    // here reads activeParams, so the panel is off the pointer stream
    // entirely.
    expect(bodyRuns()).toBe(runsAtMount);
    expect(commits()).toBe(commitsAtMount);
  });

  it("TL3: …and 'Automation lane' still seeds a keyframe from the LIVE param value", () => {
    const { timeline } = probedTimeline();
    mountProbed(timeline);
    // A value written after mount: only a click-time read can see it, which
    // is precisely what TL2 traded the subscription for.
    act(() => useVizStore.setState({ activeParams: { hue: 0.77 }, playback: PLAYBACK }));

    const add = screen.getByTitle("Add an automation lane for a parameter") as HTMLSelectElement;
    fireEvent.change(add, { target: { value: "hue" } });

    const lanes = useVizStore.getState().timeline.lanes;
    expect(lanes).toHaveLength(1);
    expect(lanes[0].param).toBe("hue");
    expect(lanes[0].keyframes[0].value).toBe(0.77);
    // …at the live playhead, the other click-time read.
    expect(lanes[0].keyframes[0].t).toBe(30);
  });

  it("TL4: unrelated 4 Hz / per-frame meter ticks cost the panel nothing", () => {
    const { timeline, bodyRuns } = probedTimeline();
    const commits = mountProbed(timeline);
    const runsAtMount = bodyRuns();
    const commitsAtMount = commits();

    act(() => useVizStore.setState({ lufs: -14.2 }));
    act(() => useVizStore.setState({ stereoWidth: 0.7 }));
    act(() => useVizStore.setState({ exporting: { done: 1, total: 10, speed: 1 } }));

    expect(bodyRuns()).toBe(runsAtMount);
    expect(commits()).toBe(commitsAtMount);
  });

  it("TL5: a timeline write it DOES read reconciles it exactly once and shows up", () => {
    const { timeline } = probedTimeline();
    const commits = mountProbed(timeline);
    const commitsAtMount = commits();
    expect(screen.getByText(/No scenes/)).toBeTruthy();

    act(() =>
      useVizStore.getState().setTimeline({
        enabled: true,
        lanes: [],
        scenes: [{ id: "s1", name: "Nebula", presetId: "nebula", start: 12 }],
      }),
    );

    // Exactly one commit: the subscription is connected rather than inert, and
    // a document write does not cost more than a single render. `bodyRuns()`
    // is deliberately NOT the instrument here — this write REPLACES the
    // probed object, so the counter measures the old one and stops. The DOM
    // change below is what proves the body ran, and a write that changed
    // nothing could not produce it.
    expect(commits()).toBe(commitsAtMount + 1);
    expect(screen.getByText("Nebula")).toBeTruthy();
    expect(screen.queryByText(/No scenes/)).toBeNull();
  });

  it("TL6: closing writes through the store, not a callback prop", () => {
    const { timeline } = probedTimeline();
    mountProbed(timeline);
    act(() => useVizStore.setState({ showTimeline: true }));
    fireEvent.click(screen.getByRole("button", { name: "Close timeline" }));
    expect(useVizStore.getState().showTimeline).toBe(false);
  });

  it("TL7: 200 sequential playback ticks neither crash nor unmount it", () => {
    const { timeline, bodyRuns } = probedTimeline();
    mountProbed(timeline);
    const runsAtMount = bodyRuns();
    act(() => {
      for (let i = 0; i < 200; i++) {
        useVizStore.setState({ playback: { ...PLAYBACK, time: i * 0.25 } });
      }
    });
    expect(screen.getByText("Timeline")).toBeTruthy();
    expect(bodyRuns()).toBe(runsAtMount);
  });
});

/** Minimal AudioBuffer stand-in — autoArrangeTimeline reads only `.duration`
 * off whatever `getEngine().audioBuffer` returns. */
function fakeBuffer(duration: number): { duration: number } {
  return { duration };
}

/**
 * P-5 task 1: the manual "Enabled" toggle is gone. `timeline.enabled` is now
 * DERIVED from content at every write site (setTimeline, autoArrangeTimeline)
 * — see deriveTimelineEnabled in state/timeline.ts and the lane log for the
 * full rule, including why `validTimeline` (load) deliberately keeps its own
 * separate formula and is untouched here.
 */
describe("derived timeline.enabled — the toggle is gone, content decides (P-5 task 1)", () => {
  it("the manual Enabled switch no longer renders", () => {
    const { timeline } = probedTimeline();
    mountProbed(timeline);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText("Enabled")).toBeNull();
  });

  it("setTimeline derives enabled from scenes, overriding whatever the caller passed", () => {
    const { timeline } = probedTimeline();
    mountProbed(timeline);
    act(() =>
      useVizStore.getState().setTimeline({
        enabled: false, // caller says off — content says otherwise
        scenes: [{ id: "s1", name: "Nebula", presetId: presets[0].id, start: 0 }],
        lanes: [],
      }),
    );
    expect(useVizStore.getState().timeline.enabled).toBe(true);
  });

  it("setTimeline derives enabled from lanes alone (H11: a lane alone drives its param)", () => {
    const { timeline } = probedTimeline();
    mountProbed(timeline);
    act(() =>
      useVizStore.getState().setTimeline({
        enabled: false,
        scenes: [],
        lanes: [{ param: "hue", keyframes: [{ id: "k1", t: 0, value: 1, curve: "linear" }] }],
      }),
    );
    expect(useVizStore.getState().timeline.enabled).toBe(true);
  });

  it("setTimeline derives enabled false when the caller says true but content is empty", () => {
    const { timeline } = probedTimeline();
    mountProbed(timeline);
    act(() => useVizStore.getState().setTimeline({ enabled: true, scenes: [], lanes: [] }));
    expect(useVizStore.getState().timeline.enabled).toBe(false);
  });

  it("clicking '+ Scene at playhead' turns a fresh, empty, off timeline on", () => {
    const { timeline } = probedTimeline();
    mountProbed(timeline); // enabled:false, empty — probedTimeline()'s shape
    expect(useVizStore.getState().timeline.enabled).toBe(false);
    fireEvent.click(screen.getByTitle("Add a scene with the current visual at the playhead"));
    expect(useVizStore.getState().timeline.enabled).toBe(true);
    expect(useVizStore.getState().timeline.scenes).toHaveLength(1);
  });

  it("auto-arrange derives enabled the same way as setTimeline (normal case: stays on)", () => {
    const { timeline } = probedTimeline();
    mountProbed(timeline);
    mocks.engine.audioBuffer = fakeBuffer(40);
    // Zero-length, not null: autoArrangeTimeline's guard only needs it
    // present (a reference is truthy regardless of length), and length 0 is
    // also the panel's OWN waveform-draw effect's early-return case — the
    // same reason mountProbed() uses null elsewhere. jsdom has no canvas 2D
    // context, so a non-empty overview here would crash on canvas.getContext.
    act(() =>
      useVizStore.setState({
        sections: [10, 20, 30],
        waveformOverview: new Float32Array(0),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Auto-arrange/ }));
    const after = useVizStore.getState().timeline;
    expect(after.scenes.length).toBeGreaterThan(0);
    expect(after.enabled).toBe(true);
  });

  it("auto-arrange never produces enabled:true with zero scenes (0-duration buffer edge case)", () => {
    const { timeline } = probedTimeline();
    mountProbed(timeline);
    // autoArrangeScenes returns [] for duration<=0. The OLD code hardcoded
    // `enabled: true` unconditionally on this write; the shared derivation
    // cannot get this wrong by construction — this is the case that proves it.
    mocks.engine.audioBuffer = fakeBuffer(0);
    // Zero-length for the same jsdom-canvas reason as the test above.
    act(() =>
      useVizStore.setState({
        sections: [1, 2],
        waveformOverview: new Float32Array(0),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Auto-arrange/ }));
    const after = useVizStore.getState().timeline;
    expect(after.scenes).toHaveLength(0);
    expect(after.enabled).toBe(false);
  });
});

/**
 * Selects a scene the same way a user does: pointerdown on its on-track
 * block (which TimelinePanel treats as select-then-maybe-drag). jsdom
 * implements neither Pointer Capture method TimelinePanel calls
 * unconditionally once a gesture begins/ends on the scroll container — same
 * gap, same fix as paramControls.test.tsx's dial stub. No pointermove is
 * fired, so `moved` stays false and this reads as a tap/select, never a drag.
 */
/** jsdom implements neither Pointer Capture method TimelinePanel calls
 * unconditionally once a gesture begins/ends on the scroll container — same
 * gap, same fix as paramControls.test.tsx's dial stub. Returns the (now
 * stubbed) scroll element for the caller to dispatch further events on. */
function stubPointerCapture(): HTMLElement {
  const scroll = document.querySelector<HTMLElement>(".tl-scroll")!;
  const stub = scroll as unknown as {
    setPointerCapture: (id: number) => void;
    releasePointerCapture: (id: number) => void;
  };
  stub.setPointerCapture = () => undefined;
  stub.releasePointerCapture = () => undefined;
  return scroll;
}

/** Selects a scene the same way a user does: pointerdown on its on-track
 * block, no pointermove — reads as a tap/select, never a drag. */
function selectScene(titlePattern: RegExp) {
  const scroll = stubPointerCapture();
  fireEvent.pointerDown(screen.getByTitle(titlePattern), { button: 0, pointerId: 1, clientX: 10 });
  fireEvent.pointerUp(scroll, { pointerId: 1 });
}

/** Drags a scene block from `fromX` to `toX` (clientX only — TimelinePanel's
 * geometry math runs on jsdom's all-zero `getBoundingClientRect`, so only
 * the RELATIVE pointer delta from the down-point is meaningful in this
 * environment, never the absolute resulting `start` time). Two pointermoves,
 * not one, so a test can prove the drag's OWN gesture groups into one undo
 * entry rather than merely firing once. */
function dragScene(titlePattern: RegExp, fromX: number, toX: number) {
  const scroll = stubPointerCapture();
  fireEvent.pointerDown(screen.getByTitle(titlePattern), {
    button: 0,
    pointerId: 1,
    clientX: fromX,
    clientY: 10,
  });
  fireEvent.pointerMove(scroll, { pointerId: 1, clientX: toX, clientY: 10 });
  fireEvent.pointerMove(scroll, { pointerId: 1, clientX: toX + 5, clientY: 10 });
  fireEvent.pointerUp(scroll, { pointerId: 1 });
}

/** The scene editor's Fade row is a real `<input type="range">` (Slider.tsx)
 * with no title/label of its own — SliderField never forwards one, and the
 * wrapping `<label>` covers two form controls (the slider and its readout),
 * so an accessible-name query would be ambiguous. Direct DOM query instead,
 * same idiom this file's own `playheadLeft()` helper already uses. */
const fadeInput = () =>
  document.querySelector<HTMLInputElement>(".tl-scene-editor input[type='range']")!;

describe("undo-key redesign for scenes (P-5 task 2)", () => {
  describe("setTimeline's optional historyKey — the new mechanism", () => {
    it("two rapid calls sharing a custom key group into one undo entry", () => {
      const { timeline } = probedTimeline();
      mountProbed(timeline);
      const depth = useVizStore.getState().undoDepth;
      act(() => {
        useVizStore.getState().setTimeline({ enabled: false, scenes: [], lanes: [] }, "custom-key");
        useVizStore.getState().setTimeline({ enabled: false, scenes: [], lanes: [] }, "custom-key");
      });
      expect(useVizStore.getState().undoDepth).toBe(depth + 1);
    });

    it("two rapid calls with different custom keys stay two undo entries", () => {
      const { timeline } = probedTimeline();
      mountProbed(timeline);
      const depth = useVizStore.getState().undoDepth;
      act(() => {
        useVizStore.getState().setTimeline({ enabled: false, scenes: [], lanes: [] }, "key-a");
        useVizStore.getState().setTimeline({ enabled: false, scenes: [], lanes: [] }, "key-b");
      });
      expect(useVizStore.getState().undoDepth).toBe(depth + 2);
    });

    it("omitting the key still defaults to the groupable 'timeline' key (back-compat)", () => {
      const { timeline } = probedTimeline();
      mountProbed(timeline);
      const depth = useVizStore.getState().undoDepth;
      act(() => {
        useVizStore.getState().setTimeline({ enabled: false, scenes: [], lanes: [] });
        useVizStore.getState().setTimeline({ enabled: false, scenes: [], lanes: [] });
      });
      expect(useVizStore.getState().undoDepth).toBe(depth + 1);
    });
  });

  describe("scene add/remove", () => {
    it("two rapid '+ Scene at playhead' clicks cost TWO undo entries, not one", () => {
      const { timeline } = probedTimeline();
      mountProbed(timeline);
      const depth = useVizStore.getState().undoDepth;
      const addBtn = screen.getByTitle("Add a scene with the current visual at the playhead");

      fireEvent.click(addBtn);
      fireEvent.click(addBtn);

      expect(useVizStore.getState().timeline.scenes).toHaveLength(2);
      expect(useVizStore.getState().undoDepth).toBe(depth + 2);

      // And undo steps back ONE add at a time, not both at once.
      useVizStore.getState().undo();
      expect(useVizStore.getState().timeline.scenes).toHaveLength(1);
    });

    it("removing a scene uses a key distinct from the generic 'timeline' key", () => {
      const scene: Scene = { id: "s1", name: "Nebula", presetId: presets[0].id, start: 5 };
      const timeline: Timeline = { enabled: true, scenes: [scene], lanes: [] };
      mountProbed(timeline);
      selectScene(/Nebula — drag to move/);
      const depth = useVizStore.getState().undoDepth;

      fireEvent.click(screen.getByRole("button", { name: "Delete scene" }));
      // A generic, default-keyed edit fired immediately after: if removeScene
      // still shared the flat "timeline" key, these two would incorrectly
      // group into one entry.
      act(() =>
        useVizStore.getState().setTimeline({ ...useVizStore.getState().timeline, lanes: [] }),
      );

      expect(useVizStore.getState().timeline.scenes).toHaveLength(0);
      expect(useVizStore.getState().undoDepth).toBe(depth + 2);
    });
  });

  describe("scene position drag — per-scene grouping (the rule's own words: 'scene drags... must group per gesture')", () => {
    it("two pointermoves of the SAME drag group into one undo entry", () => {
      const scene: Scene = { id: "s1", name: "Nebula", presetId: presets[0].id, start: 5 };
      const timeline: Timeline = { enabled: true, scenes: [scene], lanes: [] };
      mountProbed(timeline);
      const depth = useVizStore.getState().undoDepth;

      dragScene(/Nebula — drag to move/, 100, 130);

      expect(useVizStore.getState().undoDepth).toBe(depth + 1);
    });

    it("dragging scene A then scene B, back to back, never merges — per-scene key", () => {
      const sceneA: Scene = { id: "s1", name: "Nebula", presetId: presets[0].id, start: 5 };
      const sceneB: Scene = { id: "s2", name: "Aurora", presetId: presets[0].id, start: 40 };
      const timeline: Timeline = { enabled: true, scenes: [sceneA, sceneB], lanes: [] };
      mountProbed(timeline);
      const depth = useVizStore.getState().undoDepth;

      dragScene(/Nebula — drag to move/, 100, 130);
      dragScene(/Aurora — drag to move/, 300, 330);

      expect(useVizStore.getState().undoDepth).toBe(depth + 2);
    });
  });

  describe("scene fade slider — per-scene grouping, like a param drag", () => {
    it("two rapid fade edits on the SAME scene group into one undo entry", () => {
      const scene: Scene = {
        id: "s1",
        name: "Nebula",
        presetId: presets[0].id,
        start: 5,
        fadeSec: 0.5,
      };
      const timeline: Timeline = { enabled: true, scenes: [scene], lanes: [] };
      mountProbed(timeline);
      selectScene(/Nebula — drag to move/);
      const depth = useVizStore.getState().undoDepth;

      fireEvent.change(fadeInput(), { target: { value: "1" } });
      fireEvent.change(fadeInput(), { target: { value: "1.5" } });

      expect(useVizStore.getState().undoDepth).toBe(depth + 1);
      expect(useVizStore.getState().timeline.scenes[0].fadeSec).toBe(1.5);
    });

    it("fade edits on DIFFERENT scenes never merge, even back to back", () => {
      const sceneA: Scene = {
        id: "s1",
        name: "Nebula",
        presetId: presets[0].id,
        start: 5,
        fadeSec: 0.5,
      };
      const sceneB: Scene = {
        id: "s2",
        name: "Aurora",
        presetId: presets[0].id,
        start: 20,
        fadeSec: 0.5,
      };
      const timeline: Timeline = { enabled: true, scenes: [sceneA, sceneB], lanes: [] };
      mountProbed(timeline);
      const depth = useVizStore.getState().undoDepth;

      selectScene(/Nebula — drag to move/);
      fireEvent.change(fadeInput(), { target: { value: "1" } });

      selectScene(/Aurora — drag to move/);
      fireEvent.change(fadeInput(), { target: { value: "2" } });

      expect(useVizStore.getState().undoDepth).toBe(depth + 2);
    });
  });
});

describe("scene thumbnails, on-track (P-5 task 2)", () => {
  it("shows the cached thumbnail for the scene's mode", () => {
    const scene: Scene = { id: "s1", name: "Nebula", presetId: presets[0].id, start: 5 };
    const timeline: Timeline = { enabled: true, scenes: [scene], lanes: [] };
    mountProbed(timeline);
    act(() =>
      useVizStore.setState({ presetThumbs: { [presets[0].id]: "data:image/png;base64,AAA" } }),
    );
    const img = document.querySelector<HTMLImageElement>(".tl-scene img");
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,AAA");
  });

  it("renders text-only, no <img>, when no thumbnail is cached yet", () => {
    const scene: Scene = { id: "s1", name: "Nebula", presetId: presets[0].id, start: 5 };
    const timeline: Timeline = { enabled: true, scenes: [scene], lanes: [] };
    mountProbed(timeline); // presetThumbs is not seeded -> null, like a fresh boot
    expect(document.querySelector(".tl-scene img")).toBeNull();
    expect(screen.getByText("Nebula")).toBeTruthy();
  });
});

describe("per-scene look picker (P-5 task 2)", () => {
  const look = (presetId: string, id: string, name: string): UserPreset => ({
    id,
    name,
    presetId,
    params: { hue: 0.42 },
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  it("offers only looks saved for THIS scene's mode", () => {
    const scene: Scene = { id: "s1", name: "Nebula", presetId: presets[0].id, start: 5 };
    const timeline: Timeline = { enabled: true, scenes: [scene], lanes: [] };
    mountProbed(timeline);
    act(() =>
      useVizStore.setState({
        userPresets: [
          look(presets[0].id, "up1", "Matching Look"),
          look(presets[1].id, "up2", "Other Mode Look"),
        ],
      }),
    );
    selectScene(/Nebula — drag to move/);

    const picker = screen.getByTitle(/Apply a saved look/i) as HTMLSelectElement;
    const optionLabels = [...picker.options].map((o) => o.textContent);
    expect(optionLabels).toContain("Matching Look");
    expect(optionLabels).not.toContain("Other Mode Look");
  });

  it("applying a look rewrites presetId + params + name in ONE history entry", () => {
    const scene: Scene = {
      id: "s1",
      name: "Nebula",
      presetId: presets[0].id,
      start: 5,
      params: { hue: 0.1 },
    };
    const timeline: Timeline = { enabled: true, scenes: [scene], lanes: [] };
    mountProbed(timeline);
    act(() => useVizStore.setState({ userPresets: [look(presets[0].id, "up1", "Sunset")] }));
    selectScene(/Nebula — drag to move/);
    const depth = useVizStore.getState().undoDepth;

    fireEvent.change(screen.getByTitle(/Apply a saved look/i), { target: { value: "up1" } });

    const after = useVizStore.getState().timeline.scenes[0];
    expect(after.presetId).toBe(presets[0].id);
    expect(after.params).toEqual({ hue: 0.42 });
    expect(after.name).toBe("Sunset");
    expect(useVizStore.getState().undoDepth).toBe(depth + 1);
  });

  it("an unknown look id is a no-op — nothing applied, nothing recorded (mirrors applyUserPreset's own guard)", () => {
    const scene: Scene = { id: "s1", name: "Nebula", presetId: presets[0].id, start: 5 };
    const timeline: Timeline = { enabled: true, scenes: [scene], lanes: [] };
    mountProbed(timeline);
    act(() => useVizStore.setState({ userPresets: [look(presets[0].id, "up1", "Sunset")] }));
    selectScene(/Nebula — drag to move/);
    const depth = useVizStore.getState().undoDepth;
    const before = useVizStore.getState().timeline.scenes[0];

    // The picker only ever offers real ids, but the action itself must not
    // trust that — same defensive shape as applyUserPreset's `if (!preset) return`.
    fireEvent.change(screen.getByTitle(/Apply a saved look/i), { target: { value: "not-real" } });

    expect(useVizStore.getState().timeline.scenes[0]).toBe(before);
    expect(useVizStore.getState().undoDepth).toBe(depth);
  });

  it("the scene editor shows a larger thumbnail preview when one is cached", () => {
    const scene: Scene = { id: "s1", name: "Nebula", presetId: presets[0].id, start: 5 };
    const timeline: Timeline = { enabled: true, scenes: [scene], lanes: [] };
    mountProbed(timeline);
    act(() =>
      useVizStore.setState({ presetThumbs: { [presets[0].id]: "data:image/png;base64,BBB" } }),
    );
    selectScene(/Nebula — drag to move/);
    const img = document.querySelector<HTMLImageElement>(".tl-scene-editor img");
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,BBB");
  });
});

function lane(param: string, value = 0.5): AutomationLane {
  return { param, keyframes: [{ id: `k-${param}`, t: 0, value, curve: "linear" }] };
}

/** The lane list panel row (P-5 task 3) — add-select + one chip per lane.
 * Scoped queries live here since a lane's remove button now exists TWICE
 * (this chip strip, and the on-track row's own sticky label) with the same
 * wording by design (one consistent phrase, not two to maintain). */
const laneList = () => within(document.querySelector<HTMLElement>(".tl-lane-list")!);

describe("lane list panel (P-5 task 3)", () => {
  it("renders a chip per lane, alongside the add-lane control", () => {
    const timeline: Timeline = { enabled: true, scenes: [], lanes: [lane("hue"), lane("glow")] };
    mountProbed(timeline);
    expect(laneList().getByRole("button", { name: "hue" })).toBeTruthy();
    expect(laneList().getByRole("button", { name: "glow" })).toBeTruthy();
    expect(screen.getByTitle("Add an automation lane for a parameter")).toBeTruthy();
  });

  describe("solo — a pure view filter (the plan's own words: 'never an eval change')", () => {
    it("toggling solo writes NOTHING to the document — same timeline reference, no undo entry", () => {
      const timeline: Timeline = { enabled: true, scenes: [], lanes: [lane("hue"), lane("glow")] };
      mountProbed(timeline);
      const before = useVizStore.getState().timeline;
      const depth = useVizStore.getState().undoDepth;

      fireEvent.click(laneList().getByRole("button", { name: "hue" }));

      expect(useVizStore.getState().timeline).toBe(before); // identity: no write happened at all
      expect(useVizStore.getState().undoDepth).toBe(depth);
    });

    it("soloing a lane hides the OTHER lane's on-track row; both chips stay reachable", () => {
      const timeline: Timeline = { enabled: true, scenes: [], lanes: [lane("hue"), lane("glow")] };
      mountProbed(timeline);
      expect(document.querySelectorAll(".tl-lane-row")).toHaveLength(2);

      fireEvent.click(laneList().getByRole("button", { name: "hue" }));

      const rows = document.querySelectorAll(".tl-lane-row");
      expect(rows).toHaveLength(1);
      expect(rows[0].querySelector(".tl-lane-label")?.textContent).toContain("hue");
      // Solo never removes a lane from the panel that controls it — you must
      // be able to see (and un-solo) a hidden lane's own chip.
      expect(laneList().getByRole("button", { name: "hue" })).toBeTruthy();
      expect(laneList().getByRole("button", { name: "glow" })).toBeTruthy();
    });

    it("soloing a SECOND lane shows both soloed rows, still hides the rest", () => {
      const timeline: Timeline = {
        enabled: true,
        scenes: [],
        lanes: [lane("hue"), lane("glow"), lane("barGap")],
      };
      mountProbed(timeline);

      fireEvent.click(laneList().getByRole("button", { name: "hue" }));
      fireEvent.click(laneList().getByRole("button", { name: "glow" }));

      const rows = [...document.querySelectorAll(".tl-lane-row")];
      expect(rows).toHaveLength(2);
      const labels = rows.map((r) => r.querySelector(".tl-lane-label")?.textContent);
      expect(labels.some((t) => t?.includes("hue"))).toBe(true);
      expect(labels.some((t) => t?.includes("glow"))).toBe(true);
      expect(labels.some((t) => t?.includes("barGap"))).toBe(false);
    });

    it("un-soloing the only soloed lane restores every row", () => {
      const timeline: Timeline = { enabled: true, scenes: [], lanes: [lane("hue"), lane("glow")] };
      mountProbed(timeline);
      const chip = laneList().getByRole("button", { name: "hue" });

      fireEvent.click(chip); // solo on
      expect(document.querySelectorAll(".tl-lane-row")).toHaveLength(1);
      fireEvent.click(chip); // solo off
      expect(document.querySelectorAll(".tl-lane-row")).toHaveLength(2);
    });

    it("'Clear solo' appears only while something is soloed, and resets to show-all", () => {
      const timeline: Timeline = { enabled: true, scenes: [], lanes: [lane("hue"), lane("glow")] };
      mountProbed(timeline);
      expect(screen.queryByRole("button", { name: /Clear solo/i })).toBeNull();

      fireEvent.click(laneList().getByRole("button", { name: "hue" }));
      expect(document.querySelectorAll(".tl-lane-row")).toHaveLength(1);

      fireEvent.click(screen.getByRole("button", { name: /Clear solo/i }));
      expect(document.querySelectorAll(".tl-lane-row")).toHaveLength(2);
      expect(screen.queryByRole("button", { name: /Clear solo/i })).toBeNull();
    });
  });

  describe("lane add/remove undo keys", () => {
    it("two rapid lane adds cost TWO undo entries, not one", () => {
      const { timeline } = probedTimeline();
      mountProbed(timeline);
      const depth = useVizStore.getState().undoDepth;
      const add = screen.getByTitle("Add an automation lane for a parameter") as HTMLSelectElement;

      fireEvent.change(add, { target: { value: "hue" } });
      fireEvent.change(add, { target: { value: "glow" } });

      expect(useVizStore.getState().timeline.lanes).toHaveLength(2);
      expect(useVizStore.getState().undoDepth).toBe(depth + 2);

      useVizStore.getState().undo();
      expect(useVizStore.getState().timeline.lanes).toHaveLength(1);
    });

    it("removing a lane uses a key distinct from the flat 'timeline' key", () => {
      const timeline: Timeline = { enabled: true, scenes: [], lanes: [lane("hue")] };
      mountProbed(timeline);
      const depth = useVizStore.getState().undoDepth;

      fireEvent.click(laneList().getByRole("button", { name: "Remove hue automation lane" }));
      // A generic, default-keyed edit fired immediately after: if removeLane
      // still shared the flat "timeline" key, these two would incorrectly
      // group into one entry.
      act(() =>
        useVizStore.getState().setTimeline({ ...useVizStore.getState().timeline, scenes: [] }),
      );

      expect(useVizStore.getState().timeline.lanes).toHaveLength(0);
      expect(useVizStore.getState().undoDepth).toBe(depth + 2);
    });
  });
});
