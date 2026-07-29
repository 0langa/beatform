// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlaybackState } from "../audio/types";
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
