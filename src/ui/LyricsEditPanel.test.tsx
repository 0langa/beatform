// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";

/**
 * Lyrics correction editor — component wiring tests.
 *
 * R2-21: `realignLyricLine` awaits the sidecar and applies its result behind
 * an index+text guard (lyricsEditActions.ts). Structural line edits during
 * that await renumber the sheet, and a renumbered sheet can place a DIFFERENT
 * line with identical text (repeated chorus lines) at the awaited index — the
 * guard then attaches the words to the wrong line. The minimal honest fix is
 * the panel disabling split/merge/insert/delete while `lyricsRealign` is set,
 * the same way the align buttons already disable; text and time edits stay
 * allowed because an edit to the awaited line voids the apply by design.
 *
 * Same mock surface as ParamsPanel.test.tsx (services throws outside the
 * browser; platform would touch the filesystem); the store is real.
 */

vi.mock("../state/services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => ({
    ctx: { decodeAudioData: vi.fn() },
    state: { duration: 60 },
    currentTime: 0,
    duration: 60,
    playing: false,
    seek: vi.fn(),
    setVolume: vi.fn(),
    onEnded: null,
    dispose: vi.fn(),
  })),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn(), reset: vi.fn() })),
  peekAnalyzer: vi.fn(() => null),
  getLiveStemValues: vi.fn(() => undefined),
  getLiveRouteValues: vi.fn(() => new Map()),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

vi.mock("../state/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/platform")>();
  return { ...actual, writeAutosave: vi.fn(async () => {}) };
});

const { LyricsEditPanel } = await import("./LyricsEditPanel");
const { useVizStore } = await import("../state/store");

const PRISTINE = { ...useVizStore.getState() };

afterEach(() => {
  cleanup();
  useVizStore.setState(PRISTINE);
});

const LINES = [
  { t: 0, end: null, text: "same words" },
  { t: 2, end: null, text: "in the middle" },
  { t: 4, end: null, text: "same words" },
];

const isDisabled = (el: Element | null) => !!(el as HTMLButtonElement | null)?.disabled;

/** Unfold row 0's toolbar (selecting a row is what reveals the tools). */
function openRowTools(container: HTMLElement, row = 0) {
  const rowEl = container.querySelector(`[data-lyr-row="${row}"]`) as HTMLElement;
  fireEvent.focus(within(rowEl).getByLabelText("Line text"));
  return container.querySelector(`[data-lyr-row="${row}"]`) as HTMLElement;
}

describe("R2-21 — structural edits lock while a re-align is in flight", () => {
  it("split/merge/insert/delete disable with lyricsRealign set; text edits stay live", () => {
    useVizStore.setState({ lyrics: LINES, lyricsRealign: { index: 2 } });
    const { container } = render(<LyricsEditPanel />);
    const row = openRowTools(container);

    expect(isDisabled(within(row).getByRole("button", { name: "✂" }))).toBe(true);
    expect(isDisabled(within(row).getByRole("button", { name: "⤵" }))).toBe(true);
    expect(isDisabled(within(row).getByRole("button", { name: "+↑" }))).toBe(true);
    expect(isDisabled(within(row).getByRole("button", { name: "+↓" }))).toBe(true);
    expect(isDisabled(within(row).getByRole("button", { name: "✕" }))).toBe(true);
    // The guard's own safe channel: a TEXT edit is still allowed (it voids
    // the apply via the text check), as are the time nudges.
    expect((within(row).getByLabelText("Line text") as HTMLInputElement).disabled).toBe(false);
    expect(isDisabled(within(row).getByRole("button", { name: "−" }))).toBe(false);
    expect(isDisabled(within(row).getByRole("button", { name: "+" }))).toBe(false);
  });

  it("the same toolbar is fully live when no re-align is running", () => {
    useVizStore.setState({ lyrics: LINES, lyricsRealign: null });
    const { container } = render(<LyricsEditPanel />);
    const row = openRowTools(container);

    expect(isDisabled(within(row).getByRole("button", { name: "✂" }))).toBe(false);
    expect(isDisabled(within(row).getByRole("button", { name: "⤵" }))).toBe(false);
    expect(isDisabled(within(row).getByRole("button", { name: "+↑" }))).toBe(false);
    expect(isDisabled(within(row).getByRole("button", { name: "+↓" }))).toBe(false);
    expect(isDisabled(within(row).getByRole("button", { name: "✕" }))).toBe(false);
  });

  it("undo/redo lock too — buttons AND the in-panel Ctrl+Z/Y (review D2)", () => {
    const undoMock = vi.fn();
    const redoMock = vi.fn();
    useVizStore.setState({
      lyrics: LINES,
      lyricsRealign: { index: 2 },
      lyricsEditUndoDepth: 1, // non-zero so the disable is not vacuous
      lyricsEditRedoDepth: 1,
      undoLyricsEdit: undoMock,
      redoLyricsEdit: redoMock,
    });
    const { container } = render(<LyricsEditPanel />);

    expect(isDisabled(container.querySelector('button[title*="re-align"]'))).toBe(true);
    const buttons = Array.from(container.querySelectorAll("button"));
    const undoBtn = buttons.find((b) => b.textContent === "↶")!;
    const redoBtn = buttons.find((b) => b.textContent === "↷")!;
    expect(isDisabled(undoBtn)).toBe(true);
    expect(isDisabled(redoBtn)).toBe(true);

    // The keyboard path: swallowed (the editor owns Ctrl+Z here) but inert.
    const root = container.querySelector(".lyrics-edit") as HTMLElement;
    fireEvent.keyDown(root, { key: "z", ctrlKey: true });
    fireEvent.keyDown(root, { key: "z", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(root, { key: "y", ctrlKey: true });
    expect(undoMock).not.toHaveBeenCalled();
    expect(redoMock).not.toHaveBeenCalled();
  });

  it("undo/redo work again once the re-align settles (control)", () => {
    const undoMock = vi.fn();
    useVizStore.setState({
      lyrics: LINES,
      lyricsRealign: null,
      lyricsEditUndoDepth: 1,
      lyricsEditRedoDepth: 0,
      undoLyricsEdit: undoMock,
    });
    const { container } = render(<LyricsEditPanel />);

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(isDisabled(buttons.find((b) => b.textContent === "↶")!)).toBe(false);
    const root = container.querySelector(".lyrics-edit") as HTMLElement;
    fireEvent.keyDown(root, { key: "z", ctrlKey: true });
    expect(undoMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * R2-31k — rows key on LINE IDENTITY, not index. With index keys, deleting a
 * row above remapped every React instance below one slot: an uncommitted
 * text draft (typed, not yet blurred) then showed on the WRONG line. Row ids
 * are UI-session state (minted at the load chokepoint, carried through every
 * edit by cloneLine); the document schema is untouched.
 */
describe("R2-31k — stable row keys", () => {
  it("deleting a row above keeps an uncommitted draft attached to the same logical line", () => {
    // Through the real load path so the lines carry their session row ids.
    act(() =>
      useVizStore
        .getState()
        .loadLyricsText(
          "song.lrc",
          "[00:00.00]same words\n[00:02.00]in the middle\n[00:04.00]same words\n",
        ),
    );
    const { container } = render(<LyricsEditPanel />);
    const rowInput = (i: number) =>
      within(container.querySelectorAll("[data-lyr-row]")[i] as HTMLElement).getByLabelText(
        "Line text",
      ) as HTMLInputElement;

    // Type into row 1 WITHOUT blurring — an uncommitted draft.
    fireEvent.focus(rowInput(1));
    fireEvent.change(rowInput(1), { target: { value: "edited draft" } });
    expect(rowInput(1).value).toBe("edited draft");

    act(() => useVizStore.getState().deleteLyricLine(0));

    // The logical line "in the middle" is row 0 now — the draft follows it…
    expect(rowInput(0).value).toBe("edited draft");
    // …and the untouched line below shows its own text, not the draft.
    expect(rowInput(1).value).toBe("same words");
  });
});
