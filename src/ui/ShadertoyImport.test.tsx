// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * E2-U4 — same defect and same fix as ShaderEditor.test.tsx, mirrored here:
 * `apply()` sets `busy`, awaits `store().importShadertoyGlsl(...)` (which
 * itself reaches saveCustomPreset's on-device compile check), then clears
 * `dirty` only on success. Before this fix, none of the three dismissal
 * paths (backdrop, header ✕, the dialog's own local Escape handler) checked
 * `busy` before calling `requestClose()` — so "Discard" during an in-flight
 * translate unmounted the dialog without stopping the promise, and a
 * successful translate afterward still registered, persisted and switched
 * the live visual to what was just "discarded".
 *
 * Mocks: same shape as ShaderEditor.test.tsx — `services`/`platform` so the
 * module graph loads outside a browser, and the real `importShadertoyGlsl`
 * action is overridden per-test via `useVizStore.setState` with a
 * controllable (deferred) promise, redirecting the one call this component
 * awaits without reaching for the Rust-side translator or a GPU compile mock.
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

const { ShadertoyImport } = await import("./ShadertoyImport");
const { useVizStore } = await import("../state/store");
const { SHADER_APPLY_TIMEOUT_MS } = await import("./asyncTimeout");

const PRISTINE = { ...useVizStore.getState() };

/** No jest-dom in this repo — read the property off the real element. */
const isDisabled = (el: Element | null) => !!(el as HTMLButtonElement | null)?.disabled;

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

/** Dirties the dialog with non-empty GLSL (apply() refuses empty GLSL
 *  synchronously, before ever going busy) and starts the translate. */
function dirtyAndTranslate() {
  fireEvent.change(screen.getByLabelText("Shadertoy GLSL source"), {
    target: {
      value: "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0); }",
    },
  });
  fireEvent.click(screen.getByRole("button", { name: /Translate \+ add visual/ }));
}

describe("E2-U4 — ShadertoyImport discard during an in-flight translate", () => {
  it("busy blocks all three dismissal paths: header close, backdrop, Escape", async () => {
    const gate = deferred<string[]>();
    const importShadertoyGlslMock = vi.fn(() => gate.promise);
    const closeShadertoyImportMock = vi.fn();
    act(() =>
      useVizStore.setState({
        importShadertoyGlsl: importShadertoyGlslMock,
        closeShadertoyImport: closeShadertoyImportMock,
      }),
    );
    const { container } = render(<ShadertoyImport />);
    dirtyAndTranslate();
    await act(async () => {});
    expect(importShadertoyGlslMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Translating…/ })).toBeTruthy();

    const closeBtn = screen.getByRole("button", { name: "Close import dialog" });
    expect(isDisabled(closeBtn)).toBe(true);
    fireEvent.click(closeBtn);
    fireEvent.click(container.querySelector(".modal-backdrop")!);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await act(async () => {});

    expect(askConfirmMock).not.toHaveBeenCalled();
    expect(closeShadertoyImportMock).not.toHaveBeenCalled();

    gate.resolve([]); // let the pending translate settle so afterEach stays tidy
    await act(async () => {});
  });

  it("close works again once the translate settles (success)", async () => {
    const gate = deferred<string[]>();
    const importShadertoyGlslMock = vi.fn(() => gate.promise);
    const closeShadertoyImportMock = vi.fn();
    act(() =>
      useVizStore.setState({
        importShadertoyGlsl: importShadertoyGlslMock,
        closeShadertoyImport: closeShadertoyImportMock,
      }),
    );
    render(<ShadertoyImport />);
    dirtyAndTranslate();
    await act(async () => {});
    const closeBtn = screen.getByRole("button", { name: "Close import dialog" });
    expect(isDisabled(closeBtn)).toBe(true);

    await act(async () => {
      gate.resolve([]); // translate succeeds -> apply() calls closeShadertoyImport itself
      await Promise.resolve();
      await Promise.resolve();
    });

    // Unlike ShaderEditor, a successful apply() here closes the dialog
    // DIRECTLY (ShadertoyImport.tsx's own
    // `if (result.length === 0) store().closeShadertoyImport();`), so the
    // busy gate lifting is what let that call through at all — while busy,
    // the equivalent header-close click reached neither askConfirm nor
    // closeShadertoyImport (the test above). `dirty` is never reset back to
    // false on success in this component (it auto-closes instead of
    // relying on a second manual close), so the disabled flag flipping back
    // is checked directly rather than via a second click's confirm-or-not,
    // which would exercise that unrelated, pre-existing quirk instead.
    expect(isDisabled(closeBtn)).toBe(false);
    expect(closeShadertoyImportMock).toHaveBeenCalledOnce();
  });

  it("a failed translate never applies — discard afterward closes normally and nothing extra runs", async () => {
    const gate = deferred<string[]>();
    const importShadertoyGlslMock = vi.fn(() => gate.promise);
    const closeShadertoyImportMock = vi.fn();
    act(() =>
      useVizStore.setState({
        importShadertoyGlsl: importShadertoyGlslMock,
        closeShadertoyImport: closeShadertoyImportMock,
      }),
    );
    render(<ShadertoyImport />);
    dirtyAndTranslate();
    await act(async () => {});

    await act(async () => {
      gate.resolve(["line 1: unsupported builtin"]); // translate FAILS
      await Promise.resolve();
      await Promise.resolve();
    });

    const closeBtn = screen.getByRole("button", { name: "Close import dialog" });
    expect(isDisabled(closeBtn)).toBe(false);
    expect(screen.getByText("line 1: unsupported builtin")).toBeTruthy();
    // A failed apply() does NOT close the dialog itself — only success does.
    expect(closeShadertoyImportMock).not.toHaveBeenCalled();

    fireEvent.click(closeBtn);
    await act(async () => {});

    expect(askConfirmMock).toHaveBeenCalledTimes(1);
    expect(closeShadertoyImportMock).toHaveBeenCalledOnce();
    expect(importShadertoyGlslMock).toHaveBeenCalledTimes(1);
  });

  it("a clean (never-dirtied) dialog still closes instantly", () => {
    const closeShadertoyImportMock = vi.fn();
    act(() => useVizStore.setState({ closeShadertoyImport: closeShadertoyImportMock }));
    render(<ShadertoyImport />);
    fireEvent.click(screen.getByRole("button", { name: "Close import dialog" }));
    expect(askConfirmMock).not.toHaveBeenCalled();
    expect(closeShadertoyImportMock).toHaveBeenCalledOnce();
  });
});

/**
 * CRITICAL, whole-lane review — same gap and same fix as
 * ShaderEditor.test.tsx's mirror describe block: `apply()` had no
 * try/catch or timeout around the awaited translate+compile, so a
 * rejection or a genuine hang (transpileShadertoy is one opaque Rust
 * invoke() with no cancellation path — shadertoy.rs's own fuzz-testing
 * notes say an infinite loop there cannot be interrupted from inside) left
 * `busy` — and therefore the whole dialog — stuck forever.
 */
describe("CRITICAL (whole-lane review) — apply() always settles busy, even on rejection or a hang", () => {
  it("a rejected translate clears busy, surfaces the error, and close works again", async () => {
    const boom = new Error("translator crashed");
    const importShadertoyGlslMock = vi.fn(async () => {
      throw boom;
    });
    const closeShadertoyImportMock = vi.fn();
    act(() =>
      useVizStore.setState({
        importShadertoyGlsl: importShadertoyGlslMock,
        closeShadertoyImport: closeShadertoyImportMock,
      }),
    );
    render(<ShadertoyImport />);
    dirtyAndTranslate();
    await act(async () => {});

    const closeBtn = screen.getByRole("button", { name: "Close import dialog" });
    expect(isDisabled(closeBtn)).toBe(false);
    expect(screen.getByText(/Translation failed: translator crashed/)).toBeTruthy();

    fireEvent.click(closeBtn);
    await act(async () => {});
    expect(askConfirmMock).toHaveBeenCalledTimes(1);
    expect(closeShadertoyImportMock).toHaveBeenCalledOnce();
  });

  it("a translate that never settles trips the timeout — busy clears, close works, and a LATE resolve does not apply", async () => {
    vi.useFakeTimers();
    try {
      const gate = deferred<string[]>();
      let capturedSignal: AbortSignal | undefined;
      const importShadertoyGlslMock = vi.fn(
        (_glsl: string, _meta: unknown, _editId: string | null, signal?: AbortSignal) => {
          capturedSignal = signal;
          return gate.promise;
        },
      );
      const closeShadertoyImportMock = vi.fn();
      act(() =>
        useVizStore.setState({
          importShadertoyGlsl: importShadertoyGlslMock,
          closeShadertoyImport: closeShadertoyImportMock,
        }),
      );
      render(<ShadertoyImport />);
      dirtyAndTranslate();
      await act(async () => {});
      expect(screen.getByRole("button", { name: /Translating…/ })).toBeTruthy();
      const closeBtn = screen.getByRole("button", { name: "Close import dialog" });
      expect(isDisabled(closeBtn)).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SHADER_APPLY_TIMEOUT_MS);
      });

      expect(isDisabled(closeBtn)).toBe(false);
      expect(screen.getByText(/Translation timed out/)).toBeTruthy();
      expect(capturedSignal?.aborted).toBe(true);

      fireEvent.click(closeBtn);
      await act(async () => {});
      expect(askConfirmMock).toHaveBeenCalledTimes(1);
      expect(closeShadertoyImportMock).toHaveBeenCalledOnce();

      // Late arrival, after the user already closed on the timeout: no
      // second continuation exists to act on it.
      await act(async () => {
        gate.resolve([]);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(closeShadertoyImportMock).toHaveBeenCalledOnce(); // not called again
      expect(screen.getByText(/Translation timed out/)).toBeTruthy(); // unchanged
      expect(importShadertoyGlslMock).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
