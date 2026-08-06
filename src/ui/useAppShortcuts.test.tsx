// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { useVizStore } from "../state/store";
import { useAppShortcuts } from "./useAppShortcuts";

afterEach(cleanup);

function Harness({ state }: { state: Record<string, unknown> }) {
  useAppShortcuts((() => state) as unknown as typeof useVizStore.getState);
  return <input aria-label="text entry" />;
}

describe("A-B loop shortcuts", () => {
  it("uses layout-stable I/O keys for loop in/out", () => {
    const state = {
      setLoopStart: vi.fn(),
      setLoopEnd: vi.fn(),
    };
    render(<Harness state={state} />);

    fireEvent.keyDown(window, { key: "i", code: "KeyI" });
    fireEvent.keyDown(window, { key: "O", code: "KeyO" });

    expect(state.setLoopStart).toHaveBeenCalledOnce();
    expect(state.setLoopEnd).toHaveBeenCalledOnce();
  });

  it("does not fire markers while the user is typing", () => {
    const state = {
      setLoopStart: vi.fn(),
      setLoopEnd: vi.fn(),
    };
    const { getByRole } = render(<Harness state={state} />);
    const input = getByRole("textbox", { name: "text entry" });

    fireEvent.keyDown(input, { key: "i", code: "KeyI" });
    fireEvent.keyDown(input, { key: "o", code: "KeyO" });

    expect(state.setLoopStart).not.toHaveBeenCalled();
    expect(state.setLoopEnd).not.toHaveBeenCalled();
  });
});

/**
 * The Escape cascade (audit UI-1): Esc is the universal way out of every
 * surface — EXCEPT while typing, where it must cancel the field and nothing
 * else. Before the guard, cancelling a save-look name or clearing the panel
 * search tore down the whole panel stack with the same keypress.
 */
describe("Escape", () => {
  /** Everything the cascade touches, so a stray extra close would throw. */
  function escState() {
    return {
      exporting: null,
      batchStatus: "idle",
      stageMode: false,
      setShowHelp: vi.fn(),
      setShowGuide: vi.fn(),
      setShowSettings: vi.fn(),
      setShowExport: vi.fn(),
      setShowBatch: vi.fn(),
      setStageMode: vi.fn(),
      setShowPanel: vi.fn(),
      setShowLibrary: vi.fn(),
      setShowGallery: vi.fn(),
      setShowTimeline: vi.fn(),
    };
  }

  it("closes the open surfaces when focus is not in a text field", () => {
    const state = escState();
    render(<Harness state={state} />);

    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });

    expect(state.setShowPanel).toHaveBeenCalledWith(false);
    expect(state.setShowLibrary).toHaveBeenCalledWith(false);
    expect(state.setShowGallery).toHaveBeenCalledWith(false);
    expect(state.setShowTimeline).toHaveBeenCalledWith(false);
    expect(state.setShowHelp).toHaveBeenCalledWith(false);
  });

  it("only blurs the field while typing — the panel stack stays up", () => {
    const state = escState();
    const { getByRole } = render(<Harness state={state} />);
    const input = getByRole("textbox", { name: "text entry" });
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });

    expect(document.activeElement).not.toBe(input);
    expect(state.setShowPanel).not.toHaveBeenCalled();
    expect(state.setShowLibrary).not.toHaveBeenCalled();
    expect(state.setShowGallery).not.toHaveBeenCalled();
    expect(state.setShowTimeline).not.toHaveBeenCalled();
    expect(state.setShowHelp).not.toHaveBeenCalled();
    expect(state.setStageMode).not.toHaveBeenCalled();
  });

  it("a second Escape after the blur runs the normal cascade", () => {
    const state = escState();
    const { getByRole } = render(<Harness state={state} />);
    const input = getByRole("textbox", { name: "text entry" });
    input.focus();

    fireEvent.keyDown(input, { key: "Escape", code: "Escape" }); // blur only
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" }); // way out

    expect(state.setShowPanel).toHaveBeenCalledTimes(1);
    expect(state.setShowPanel).toHaveBeenCalledWith(false);
  });
});
