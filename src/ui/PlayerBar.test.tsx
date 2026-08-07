// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlaybackState } from "../audio/types";
import { renderProbe } from "./testing/renderProbe";
import { PlayerBar, type PlayerBarProps } from "./PlayerBar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PLAYBACK: PlaybackState = {
  playing: true,
  time: 30,
  duration: 100,
  trackName: "drop.wav",
  loop: true,
  loopStart: 20,
  loopEnd: 40,
};

function renderBar(playback: PlaybackState = PLAYBACK) {
  const callbacks = {
    onTogglePlay: vi.fn(),
    onSeekStart: vi.fn(),
    onSeekEnd: vi.fn(),
    onToggleLoop: vi.fn(),
    onSetLoopStart: vi.fn(),
    onSetLoopEnd: vi.fn(),
    onClearLoopRegion: vi.fn(),
    onVolume: vi.fn(),
    onToggleMute: vi.fn(),
  } satisfies Pick<
    PlayerBarProps,
    | "onTogglePlay"
    | "onSeekStart"
    | "onSeekEnd"
    | "onToggleLoop"
    | "onSetLoopStart"
    | "onSetLoopEnd"
    | "onClearLoopRegion"
    | "onVolume"
    | "onToggleMute"
  >;

  const view = render(
    <PlayerBar playback={playback} sections={[]} volume={0.8} muted={false} {...callbacks} />,
  );
  return { ...view, callbacks };
}

describe("PlayerBar A-B loop", () => {
  it("shows the selected region and exposes direct marker actions", async () => {
    const { container, callbacks } = renderBar();

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

    expect(callbacks.onSetLoopStart).toHaveBeenCalledWith();
    expect(callbacks.onSetLoopEnd).toHaveBeenCalledWith();
    expect(callbacks.onClearLoopRegion).toHaveBeenCalledOnce();
  });

  it("drags a marker without starting a transport seek", () => {
    const { container, callbacks } = renderBar();
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

    expect(callbacks.onSetLoopStart).toHaveBeenCalledWith(35);
    expect(callbacks.onSeekStart).not.toHaveBeenCalled();
    expect(callbacks.onSeekEnd).not.toHaveBeenCalled();
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
 * The H13 stable-props contract. PlayerBar is always mounted, so before the
 * memo it reconciled on EVERY App re-render for any reason at all — an
 * Inspector edit, export progress, a notice toast. The memo only bails while
 * every prop keeps its identity across those renders, a contract held up by
 * App.tsx's `useCallback` block and nothing else.
 *
 * Instrument: a counting getter on `playback.time`, which the body reads once
 * (`seekDragT ?? playback.time`) and `memo`'s shallow compare never touches —
 * it compares `props.playback` by identity. So one read == one execution of
 * the render body.
 *
 * `renderProbe()` counts commits of the whole probed subtree, which is what
 * proves the parent tick landed; it deliberately is NOT the bail-out
 * assertion. A `<Profiler>` fires whenever it re-renders itself, so under a
 * ticking parent it reports the same count for stable and unstable props (see
 * the long note in TimelinePanel.test.tsx). Without it, "the body never ran"
 * would be indistinguishable from "the harness never ticked".
 */
const SECTIONS: number[] = [];
const NOOP = () => {};

function probedPlayback(): { playback: PlaybackState; bodyReads: () => number } {
  let reads = 0;
  return {
    playback: {
      ...PLAYBACK,
      get time() {
        reads += 1;
        return 30;
      },
    },
    bodyReads: () => reads,
  };
}

/** Re-renders on demand, like App at the playback tick. `unstable` rebuilds
 * one callback prop per render — the inline-arrow shape that defeats memo. */
function Host({ playback, unstable }: { playback: PlaybackState; unstable?: boolean }) {
  const [, setN] = useState(0);
  const props: PlayerBarProps = {
    playback,
    sections: SECTIONS,
    volume: 0.8,
    muted: false,
    onTogglePlay: NOOP,
    onSeekStart: NOOP,
    onSeekEnd: NOOP,
    onToggleLoop: NOOP,
    onSetLoopStart: NOOP,
    onSetLoopEnd: NOOP,
    onClearLoopRegion: NOOP,
    onVolume: NOOP,
    onToggleMute: NOOP,
  };
  return (
    <>
      <button onClick={() => setN((n) => n + 1)}>parent tick</button>
      {unstable ? <PlayerBar {...props} onTogglePlay={() => NOOP()} /> : <PlayerBar {...props} />}
    </>
  );
}

describe("PlayerBar memo (H13 stable-props contract)", () => {
  it("does not reconcile when the parent re-renders with stable prop identities", () => {
    const { playback, bodyReads } = probedPlayback();
    const { Probe, commits } = renderProbe();

    render(
      <Probe>
        <Host playback={playback} />
      </Probe>,
    );
    expect(screen.getByRole("slider", { name: "Seek" })).toBeTruthy(); // it mounted
    const mountedCommits = commits();
    const mountedReads = bodyReads();
    expect(mountedReads).toBeGreaterThan(0); // the probe is live

    fireEvent.click(screen.getByText("parent tick"));
    fireEvent.click(screen.getByText("parent tick"));

    expect(commits()).toBe(mountedCommits + 2); // the parent really ticked twice
    expect(bodyReads()).toBe(mountedReads); // and the bar never re-rendered
  });

  it("control: one fresh callback identity per render defeats the memo", () => {
    const { playback, bodyReads } = probedPlayback();
    const { Probe, commits } = renderProbe();

    render(
      <Probe>
        <Host playback={playback} unstable />
      </Probe>,
    );
    const mountedCommits = commits();
    const mountedReads = bodyReads();

    fireEvent.click(screen.getByText("parent tick"));
    fireEvent.click(screen.getByText("parent tick"));

    expect(commits()).toBe(mountedCommits + 2);
    expect(bodyReads()).toBeGreaterThan(mountedReads);
  });
});
