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

/**
 * TIMEOUTS: an explicit 30 s budget rather than vitest's 5 s default. Every
 * describe below mounts the real PlayerBar against the real store
 * (renderBar/mountProbed/mountHoverable/mountBar all call `render()`), several
 * driving it through real `userEvent` interactions on top — the whole-branch
 * review saw exactly this suite time out under parallel-worker contention.
 * Same remedy as `engineGraph.test.ts`; see GATES.md §1.
 */
describe("PlayerBar A-B loop", { timeout: 30_000 }, () => {
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
describe("PlayerBar selector granularity (P-12 wave 2)", { timeout: 30_000 }, () => {
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

/**
 * P-10 — the seek bar's hover time bubble.
 *
 * The claim is NOT "a bubble appears". It is that the bubble's state does not
 * live in React: pointer moves arrive at screen rate, and this bar is a clock
 * that already re-renders on the playback tick, so a `useState` per mousemove
 * is the same cost the store-direct migration spent two waves removing — at
 * roughly ten times the rate. So the first test counts commits, and the second
 * pins the consequence of painting into a node React also owns.
 *
 * jsdom lays nothing out, so every `getBoundingClientRect` is 0x0 and the
 * handler's `(clientX - left) / width` would be NaN. Each case installs a
 * 200px-wide bar over the 100 s PLAYBACK track, so 1px = 0.5 s and the
 * expected times are arithmetic, not a snapshot.
 */
describe("PlayerBar hover time bubble (P-10)", { timeout: 30_000 }, () => {
  function mountHoverable() {
    act(() =>
      useVizStore.setState({ playback: PLAYBACK, sections: [], volume: 0.8, muted: false }),
    );
    const { Probe, commits } = renderProbe();
    const { container } = render(
      <Probe>
        <PlayerBar />
      </Probe>,
    );
    const seek = screen.getByRole("slider", { name: "Seek" });
    vi.spyOn(seek, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 18,
      width: 200,
      height: 18,
      toJSON: () => ({}),
    });
    const tip = () => container.querySelector<HTMLElement>(".seek-tooltip")!;
    const clock = () => container.querySelector<HTMLElement>(".time-label")!.textContent;
    expect(commits()).toBeGreaterThan(0); // the probe is live
    return { commits, seek, tip, clock };
  }

  it("paints the time under the pointer and costs the bar zero renders", () => {
    const { commits, seek, tip } = mountHoverable();
    const before = commits();

    // Entering paints too: `:hover` turns the bubble on at the edge, so
    // without this the first frame of every hover is an empty pill.
    fireEvent.pointerOver(seek, { clientX: 50 });
    expect(tip().textContent).toBe("0:25");
    expect(tip().style.getPropertyValue("--hover-x")).toBe("50px");

    for (const clientX of [60, 70, 80, 90, 100]) fireEvent.pointerMove(seek, { clientX });
    expect(tip().textContent).toBe("0:50");
    expect(tip().style.getPropertyValue("--hover-x")).toBe("100px");

    // THE POINT. Six pointer events moved the bubble a quarter of the way
    // across the track and reconciled nothing. With the hover time back in
    // useState this is `before + 6`.
    expect(commits()).toBe(before);
  });

  it("clamps the bubble to the bar so a captured drag cannot drag it off the end", () => {
    const { seek, tip } = mountHoverable();
    // Pointer capture keeps delivering moves after the pointer leaves the bar.
    // The old inline `left: clientX - rect.left` followed it into the void.
    fireEvent.pointerMove(seek, { clientX: 640 });
    expect(tip().style.getPropertyValue("--hover-x")).toBe("200px");
    expect(tip().textContent).toBe("1:40");

    fireEvent.pointerMove(seek, { clientX: -240 });
    expect(tip().style.getPropertyValue("--hover-x")).toBe("0px");
    expect(tip().textContent).toBe("0:00");
  });

  it("keeps the painted text through a playback tick", () => {
    const { seek, tip, clock } = mountHoverable();
    fireEvent.pointerMove(seek, { clientX: 100 });
    expect(tip().textContent).toBe("0:50");

    act(() => useVizStore.setState({ playback: { ...PLAYBACK, time: 44 } }));

    // The bar really did reconcile — that is what makes this non-vacuous…
    expect(clock()).toContain("0:44");
    // …and the bubble kept the text the handler wrote. React owns this element
    // but not its contents: it renders NO children into it, so the reconciler
    // has nothing to write. Render the time from React instead — the obvious
    // "simplification" — and every playback tick snaps the hover bubble back
    // to the playhead while the pointer sits still somewhere else.
    expect(tip().textContent).toBe("0:50");
  });
});

/**
 * P-10 — the volume OSD.
 *
 * Volume is invisible when the chrome auto-hides, and that is by design — but
 * ↑/↓/M keep working and do NOT poke the chrome, so the keypress reads as a
 * dead key. The flash is the confirmation. Whether it is on SCREEN is decided
 * entirely in CSS (`.app.idle` / `.app.stage-mode`), which jsdom cannot see;
 * what these pin is everything else, including the two structural facts the
 * stylesheet depends on.
 */
describe("PlayerBar volume flash (P-10)", { timeout: 30_000 }, () => {
  function mountBar() {
    act(() =>
      useVizStore.setState({ playback: PLAYBACK, sections: [], volume: 0.8, muted: false }),
    );
    const { container } = render(<PlayerBar />);
    return { flash: () => container.querySelector<HTMLElement>(".volume-flash")! };
  }

  it("re-mounts on every volume change so the fade replays", () => {
    const { flash } = mountBar();
    expect(flash().textContent).toBe("Volume 80%");
    const first = flash();

    act(() => useVizStore.getState().applyVolume(0.25, false));
    expect(flash().textContent).toBe("Volume 25%");

    // Identity, not just text. The animation ends at opacity 0 and ONLY a
    // fresh element replays it — that is what the `key` buys, and it is why
    // this needs no timer and nothing to clean up. Drop the key and React
    // updates this node in place: the flash fires once per session and never
    // again, with the text assertion above still green.
    expect(flash()).not.toBe(first);

    // A change that is not a change must not re-mount it either, or a
    // no-op write would strobe the OSD.
    const second = flash();
    act(() => useVizStore.getState().applyVolume(0.25, false));
    expect(flash()).toBe(second);
  });

  it("says Muted rather than a percentage, for either way of reaching silence", () => {
    const { flash } = mountBar();
    act(() => useVizStore.getState().applyVolume(0.8, true));
    expect(flash().textContent).toBe("Muted");
    act(() => useVizStore.getState().applyVolume(0, false));
    expect(flash().textContent).toBe("Muted");
  });

  it("lives outside the chrome it is compensating for", () => {
    // THE STRUCTURAL GUARD. `.app.idle .chrome` is opacity 0 and
    // `.app.stage-mode .chrome` is display:none — so an OSD nested inside the
    // player bar would be hidden by exactly the two conditions that are its
    // entire reason to exist, and would look correct in every other test.
    const { flash } = mountBar();
    expect(flash().closest("footer.player-bar")).toBeNull();
    expect(flash().closest(".chrome")).toBeNull();
    // Decorative: the slider is the accessible surface for volume, and a live
    // region inserted together with its content does not reliably announce.
    expect(flash().getAttribute("aria-hidden")).toBe("true");
  });
});
