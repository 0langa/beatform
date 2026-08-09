// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlaybackState } from "../audio/types";
import { renderProbe } from "./testing/renderProbe";
import { PlayerBar } from "./PlayerBar";

/**
 * The PlayerBar contract after P-12 wave 2.
 *
 * What this file used to prove — "memo() bails when every prop keeps its
 * identity" — no longer exists to be proven: the bar takes no props, so memo
 * could never bail on anything and was removed. Its thirteen props became four
 * subscriptions and nine store calls at the click site.
 *
 * Two things replace it. The transport tests below now assert on the AUDIO
 * ENGINE rather than on a `vi.fn()` prop, so they cover the whole path the
 * button actually walks (button → store action → engine) instead of the first
 * hop of it. And a granularity describe pins the new contract: the bar is a
 * clock, so the playback tick must reconcile it — and nothing else may.
 *
 * `renderProbe()` IS the right instrument here, unlike in the props-era file:
 * these updates ORIGINATE INSIDE the probed subtree (a store write reaching a
 * zero-prop component), which is exactly the case its scope note sanctions.
 */

const mocks = vi.hoisted(() => ({
  engine: {
    seek: vi.fn(),
    setLoopStart: vi.fn(),
    setLoopEnd: vi.fn(),
    clearLoopRegion: vi.fn(),
    setVolume: vi.fn(),
    currentTime: 12,
    loop: false,
    duration: 100,
    playing: false,
    audioBuffer: null,
    onEnded: null,
    dispose: vi.fn(),
    ctx: { decodeAudioData: vi.fn() },
  },
  analyzer: { reset: vi.fn(), setSync: vi.fn() },
}));

// The transport actions reach getEngine()/getAnalyzer(), which throw
// "services not initialized" outside the browser. Every on* prop used to be a
// vi.fn(), which hid this path entirely.
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

const { useVizStore } = await import("../state/store");

/** Captured at module load, actions included — restoring by MERGE keeps the
 * action identities the bar's click sites call through. */
const PRISTINE = { ...useVizStore.getState() };

const PLAYBACK: PlaybackState = {
  playing: true,
  time: 30,
  duration: 100,
  trackName: "drop.wav",
  loop: true,
  loopStart: 20,
  loopEnd: 40,
};

let errorSpy: ReturnType<typeof vi.spyOn>;
let consoleErrors: string[] = [];

beforeEach(() => {
  consoleErrors = [];
  errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(" "));
  });
  mocks.engine.seek.mockClear();
  mocks.engine.setLoopStart.mockClear();
  mocks.engine.setLoopEnd.mockClear();
  mocks.engine.clearLoopRegion.mockClear();
  mocks.engine.setVolume.mockClear();
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

/** Seed the transport slices the bar reads, then mount it. */
function renderBar(playback: PlaybackState = PLAYBACK) {
  act(() => useVizStore.setState({ playback, sections: [], volume: 0.8, muted: false }));
  return render(<PlayerBar />);
}

describe("PlayerBar A-B loop", () => {
  it("shows the selected region and drives the engine from the marker buttons", async () => {
    const { container } = renderBar();

    const region = container.querySelector<HTMLElement>(".seek-loop-region");
    expect(region?.className).toContain("active");
    expect(region?.style.left).toBe("20%");
    expect(region?.style.width).toBe("20%");
    expect(container.querySelector('[data-loop-marker="start"]')?.textContent).toBe("A");
    expect(container.querySelector('[data-loop-marker="end"]')?.textContent).toBe("B");
    expect(screen.getByRole("button", { name: "Loop" }).getAttribute("title")).toContain(
      "A-B loop on",
    );

    await userEvent.click(screen.getByRole("button", { name: "Set loop A" }));
    await userEvent.click(screen.getByRole("button", { name: "Set loop B" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear A-B loop" }));

    // No argument = "at the playhead", which the store action resolves against
    // engine.currentTime. Asserting the engine (not a prop spy) is what makes
    // this cover the store hop the migration introduced.
    expect(mocks.engine.setLoopStart).toHaveBeenCalledWith(12);
    expect(mocks.engine.setLoopEnd).toHaveBeenCalledWith(12);
    expect(mocks.engine.clearLoopRegion).toHaveBeenCalledOnce();
  });

  it("drags a marker without starting a transport seek", () => {
    const { container } = renderBar();
    const seek = screen.getByRole("slider", { name: "Seek" });
    vi.spyOn(seek, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 18,
      width: 100,
      height: 18,
      toJSON: () => ({}),
    });
    Object.defineProperty(seek, "setPointerCapture", { value: vi.fn() });
    Object.defineProperty(seek, "releasePointerCapture", { value: vi.fn() });

    const start = container.querySelector('[data-loop-marker="start"]');
    expect(start).toBeTruthy();
    fireEvent.pointerDown(start!, { pointerId: 1, clientX: 20 });
    fireEvent.pointerMove(seek, { pointerId: 1, clientX: 35 });
    fireEvent.pointerUp(seek, { pointerId: 1, clientX: 35 });

    expect(mocks.engine.setLoopStart).toHaveBeenCalledWith(35);
    expect(mocks.engine.seek).not.toHaveBeenCalled();
    // seekStart() is the store's only trace of "a transport scrub began".
    expect(useVizStore.getState().seeking).toBe(false);
  });

  it("keeps A-B controls disabled without a seekable track", () => {
    renderBar({
      playing: false,
      time: 0,
      duration: 0,
      trackName: null,
      loop: false,
      loopStart: null,
      loopEnd: null,
    });
    expect((screen.getByRole("button", { name: "Set loop A" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "Set loop B" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByRole("button", { name: "Clear A-B loop" })).toBeNull();
  });
});

/**
 * Selector granularity (P-12 wave 2). The bar is always mounted, so before the
 * memo it reconciled on EVERY App re-render for any reason at all; the memo
 * narrowed that to "when one of its four props changed", a line held up by
 * nine `useCallback`s in App.tsx and nothing else. These assert the same line
 * directly against the store, where nothing can quietly stop holding it.
 *
 * Every write below installs a FRESH object/value. A write that preserves
 * identity is absorbed by zustand before React hears about it, so it would
 * leave these green even with the subscription re-added — it would prove
 * nothing (the 60 Hz no-op trap).
 */
describe("PlayerBar selector granularity (P-12 wave 2)", () => {
  function mountProbed() {
    act(() =>
      useVizStore.setState({ playback: PLAYBACK, sections: [], volume: 0.8, muted: false }),
    );
    const { Probe, commits } = renderProbe();
    render(
      <Probe>
        <PlayerBar />
      </Probe>,
    );
    expect(commits()).toBeGreaterThan(0); // the probe is live
    return commits;
  }

  it("P1: the 4 Hz LUFS meter tick costs the bar nothing", () => {
    const commits = mountProbed();
    const before = commits();
    act(() => useVizStore.setState({ lufs: -14.2 }));
    expect(commits()).toBe(before);
  });

  it("P2: a slider drag's pointer-rate activeParams write costs the bar nothing", () => {
    const commits = mountProbed();
    const before = commits();
    // setParam replaces the whole map on every pointermove — a fresh object,
    // so this is the shape that WOULD re-render a subscriber.
    act(() => useVizStore.setState({ activeParams: { hue: 0.5 } }));
    act(() => useVizStore.setState({ activeParams: { hue: 0.6 } }));
    expect(commits()).toBe(before);
  });

  it("P3: the per-frame export progress tick costs the bar nothing", () => {
    const commits = mountProbed();
    const before = commits();
    act(() => useVizStore.setState({ exporting: { done: 1, total: 10, speed: 1 } }));
    act(() => useVizStore.setState({ exporting: { done: 2, total: 10, speed: 1 } }));
    expect(commits()).toBe(before);
  });

  it("P4: the playback tick reconciles it exactly once and moves the clock", () => {
    const commits = mountProbed();
    expect(screen.getByText("0:30")).toBeTruthy();
    const before = commits();

    act(() => useVizStore.setState({ playback: { ...PLAYBACK, time: 44 } }));

    // Exactly one: the subscription is connected, not inert, and the tick does
    // not cost more than a single render. The rendered time is what a
    // no-op-write version of this test could not produce.
    expect(commits()).toBe(before + 1);
    expect(screen.getByText("0:44")).toBeTruthy();
  });

  it("P5: a volume write reconciles it exactly once and reaches the slider", () => {
    const commits = mountProbed();
    const before = commits();

    act(() => useVizStore.getState().applyVolume(0.25, false));

    expect(commits()).toBe(before + 1);
    const slider = document.querySelector<HTMLInputElement>("input.volume-slider");
    expect(slider?.value).toBe("0.25");
    expect(mocks.engine.setVolume).toHaveBeenCalledWith(0.25);
  });

  it("P6: 200 sequential meter writes neither crash nor unmount it", () => {
    mountProbed();
    act(() => {
      for (let i = 0; i < 200; i++) useVizStore.setState({ lufs: -20 + i * 0.01 });
    });
    expect(screen.getByRole("slider", { name: "Seek" })).toBeTruthy();
  });
});
