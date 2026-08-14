// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * E2-U4 — discard during an in-flight compile used to apply anyway.
 *
 * `apply()` sets `busy`, awaits `store().saveCustomPreset(def)` (an on-device
 * GPU compile check, customShaderActions.ts), then clears `dirty` only on
 * success. None of the three dismissal paths (backdrop, header ✕, the
 * dialog's own local Escape handler) checked `busy` before calling
 * `requestClose()`, which only confirms when `dirty` is true — still true
 * while that SAME edit's compile is mid-flight. Discarding unmounted the
 * dialog but not the promise: on success, saveCustomPreset still registers,
 * persists AND switches the live visual to what was just "discarded".
 *
 * Mocks: `services` (the store's accessors throw outside the browser) and
 * `platform` (askConfirm is what T-shaped assertions below check). The real
 * `saveCustomPreset` action is overridden per-test via `useVizStore.setState`
 * with a controllable (deferred) promise — the on-device WebGPU compile path
 * it would otherwise take (checkCustomPreset -> getRenderer -> an actual
 * WebGPURenderer instance) is out of scope for this file; zustand's actions
 * are plain object properties, so redirecting one is a direct, faithful way
 * to control ITS timing without reaching for a heavier GPU mock. The STORE
 * itself is deliberately real otherwise, matching every other UI test here.
 */

vi.mock("../state/services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => ({ audioBuffer: null, state: {} })),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn() })),
  peekAnalyzer: vi.fn(() => null),
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

const { ShaderEditor } = await import("./ShaderEditor");
const { useVizStore } = await import("../state/store");

/** Captured at module load, actions included — restoring by MERGE keeps the
 * action identities the panel's click sites call through. */
const PRISTINE = { ...useVizStore.getState() };

/** No jest-dom in this repo (see ParamsPanel.test.tsx) — read the property
 *  off the real element. */
const isDisabled = (el: Element | null) => !!(el as HTMLButtonElement | null)?.disabled;

/** An externally-resolvable promise — the handle on WHEN a mocked async
 *  store action settles, so a test can hold `busy` open, assert the
 *  dismissal paths are blocked, then let it resolve and assert they work
 *  again. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  askConfirmMock.mockClear();
  askConfirmMock.mockImplementation(async () => true);
});

afterEach(() => {
  cleanup();
  useVizStore.setState(PRISTINE);
});

/** Dirties the editor (a name edit is the cheapest field) so `requestClose`
 *  would normally ask before discarding — the precondition every test here
 *  needs, since a CLEAN editor closes instantly regardless of `busy`. */
function dirtyAndCompile() {
  fireEvent.change(screen.getByPlaceholderText("Visual name…"), { target: { value: "Changed" } });
  fireEvent.click(screen.getByRole("button", { name: /Compile \+ add visual/ }));
}

describe("E2-U4 — ShaderEditor discard during an in-flight compile", () => {
  it("busy blocks all three dismissal paths: header close, backdrop, Escape", async () => {
    const gate = deferred<string[]>();
    const saveCustomPresetMock = vi.fn(() => gate.promise);
    const setShowShaderEditorMock = vi.fn();
    act(() =>
      useVizStore.setState({
        saveCustomPreset: saveCustomPresetMock,
        setShowShaderEditor: setShowShaderEditorMock,
      }),
    );
    const { container } = render(<ShaderEditor />);
    dirtyAndCompile();
    await act(async () => {});
    expect(saveCustomPresetMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Compiling…/ })).toBeTruthy();

    const closeBtn = screen.getByRole("button", { name: "Close shader editor" });
    expect(isDisabled(closeBtn)).toBe(true);
    fireEvent.click(closeBtn);
    fireEvent.click(container.querySelector(".modal-backdrop")!);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await act(async () => {});

    // None of the three reached even the confirm, let alone closed.
    expect(askConfirmMock).not.toHaveBeenCalled();
    expect(setShowShaderEditorMock).not.toHaveBeenCalled();

    gate.resolve([]); // let the pending compile settle so afterEach stays tidy
    await act(async () => {});
  });

  it("close works again once the compile settles (success)", async () => {
    const gate = deferred<string[]>();
    const saveCustomPresetMock = vi.fn(() => gate.promise);
    const setShowShaderEditorMock = vi.fn();
    act(() =>
      useVizStore.setState({
        saveCustomPreset: saveCustomPresetMock,
        setShowShaderEditor: setShowShaderEditorMock,
      }),
    );
    render(<ShaderEditor />);
    dirtyAndCompile();
    await act(async () => {});
    const closeBtn = screen.getByRole("button", { name: "Close shader editor" });
    expect(isDisabled(closeBtn)).toBe(true);

    await act(async () => {
      gate.resolve([]); // compile succeeds -> dirty clears, busy clears
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(isDisabled(closeBtn)).toBe(false);

    fireEvent.click(closeBtn);
    // dirty is now false (a successful apply clears it) — closes with no
    // confirm needed, same as before this fix for the settled case.
    expect(askConfirmMock).not.toHaveBeenCalled();
    expect(setShowShaderEditorMock).toHaveBeenCalledOnce();
  });

  it("a failed compile never applies — discard afterward closes normally and nothing extra runs", async () => {
    const gate = deferred<string[]>();
    const saveCustomPresetMock = vi.fn(() => gate.promise);
    const setShowShaderEditorMock = vi.fn();
    act(() =>
      useVizStore.setState({
        saveCustomPreset: saveCustomPresetMock,
        setShowShaderEditor: setShowShaderEditorMock,
      }),
    );
    render(<ShaderEditor />);
    dirtyAndCompile();
    await act(async () => {});

    await act(async () => {
      gate.resolve(["line 4: syntax error"]); // compile FAILS
      await Promise.resolve();
      await Promise.resolve();
    });

    // busy cleared; dirty is untouched (still true — nothing succeeded), so
    // the close button is live again and the confirm still applies.
    const closeBtn = screen.getByRole("button", { name: "Close shader editor" });
    expect(isDisabled(closeBtn)).toBe(false);
    expect(screen.getByText("line 4: syntax error")).toBeTruthy();
    fireEvent.click(closeBtn);
    await act(async () => {});

    expect(askConfirmMock).toHaveBeenCalledTimes(1);
    expect(setShowShaderEditorMock).toHaveBeenCalledOnce();
    // "Discard" after a failure must not somehow retry or apply anything —
    // the compile action was called exactly once, for the failed attempt.
    expect(saveCustomPresetMock).toHaveBeenCalledTimes(1);
  });

  it("a clean (never-dirtied) editor still closes instantly, busy or not", () => {
    // Control case: `busy` gates dismissal, but an editor with nothing to
    // lose must not suddenly need a confirm it never needed before this fix.
    const setShowShaderEditorMock = vi.fn();
    act(() => useVizStore.setState({ setShowShaderEditor: setShowShaderEditorMock }));
    render(<ShaderEditor />);
    fireEvent.click(screen.getByRole("button", { name: "Close shader editor" }));
    expect(askConfirmMock).not.toHaveBeenCalled();
    expect(setShowShaderEditorMock).toHaveBeenCalledOnce();
  });
});
