// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { presets } from "../render/presets";
import type { Timeline } from "../state/timeline";
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
    audioBuffer: null,
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
