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
