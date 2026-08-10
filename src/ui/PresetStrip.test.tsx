// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { DEFAULT_PRESET_ORDER } from "../state/presetOrder";
import { PresetStrip } from "./PresetStrip";

/**
 * P-10's keyboard story for the mode strip: one tab stop, follow-focus arrows,
 * and a focus ring — the model `ParamsPanel`'s rail already uses, copied rather
 * than reinvented.
 *
 * The interesting claims are the ones that are NOT just "the handler runs":
 *
 *  - the strip costs exactly one Tab press however many modes are installed,
 *    and the stop is on the mode you are on (or the one you have queued);
 *  - the `+` chip is never an arrow target, so wrapping goes last→first;
 *  - ← and → do NOT also seek the track, which they would by default —
 *    `useAppShortcuts` exempts INPUT and SELECT, not a focused button;
 *  - focus and the keep-the-active-chip-visible effect do not both scroll.
 *
 * Focus-ring styling is CSS (`.chip:focus-visible` in App.css) and is not
 * assertable here; the tab stop is the part that has behaviour.
 */

vi.mock("../state/services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => ({
    ctx: { decodeAudioData: vi.fn() },
    currentTime: 0,
    duration: 0,
    playing: false,
    audioBuffer: null,
    setVolume: vi.fn(),
    onEnded: null,
    dispose: vi.fn(),
  })),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn(), reset: vi.fn() })),
  peekAnalyzer: vi.fn(() => null),
  getLiveStemValues: vi.fn(() => undefined),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

const { useVizStore } = await import("../state/store");

/** Captured at module load, actions included — restore by MERGE. */
const PRISTINE = { ...useVizStore.getState() };

// Two browser APIs the strip's effects use that jsdom does not implement.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

const ORDER = [...DEFAULT_PRESET_ORDER];

/** The mode chips, in DOM order — never the `+` chip. */
function chips(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>(".chip[data-preset-id]")];
}
function chip(id: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`.chip[data-preset-id="${id}"]`)!;
}
function tabStops(): string[] {
  return chips()
    .filter((c) => c.tabIndex === 0)
    .map((c) => c.dataset.presetId!);
}

function mount(state: Partial<ReturnType<typeof useVizStore.getState>> = {}) {
  act(() =>
    useVizStore.setState({
      presetId: ORDER[0],
      pendingPresetId: null,
      presetThumbs: null,
      customDefs: [],
      simplifiedRenderer: false,
      presetOrder: ORDER,
      ...state,
    }),
  );
  render(<PresetStrip />);
}

let scrollSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  useVizStore.setState(PRISTINE);
  vi.restoreAllMocks();
});

describe("the mode strip is one tab stop", () => {
  it("puts the only stop on the active mode", () => {
    mount({ presetId: "nebula" });
    expect(chips().length).toBeGreaterThan(5); // the claim is about a LONG strip
    expect(tabStops()).toEqual(["nebula"]);
  });

  it("moves the stop to a queued switch that has not landed yet", () => {
    mount({ presetId: "nebula", pendingPresetId: "aurora" });
    expect(tabStops()).toEqual(["aurora"]);
  });

  it("falls back to the first chip when the active mode is not on the strip", () => {
    // `builder` is a hidden built-in kept resolvable for old projects; it has
    // no chip, and a roving tabindex with no 0 in it would drop the whole strip
    // out of the tab order.
    mount({ presetId: "builder" });
    expect(tabStops()).toEqual([ORDER[0]]);
  });
});

describe("arrows move AND switch, wrapping at both ends", () => {
  it("→ steps to the next mode and takes focus with it", () => {
    mount({ presetId: ORDER[0] });
    fireEvent.keyDown(chip(ORDER[0]), { key: "ArrowRight" });

    expect(useVizStore.getState().presetId).toBe(ORDER[1]);
    expect(document.activeElement).toBe(chip(ORDER[1]));
  });

  it("← wraps from the first mode round to the last", () => {
    mount({ presetId: ORDER[0] });
    fireEvent.keyDown(chip(ORDER[0]), { key: "ArrowLeft" });

    expect(useVizStore.getState().presetId).toBe(ORDER[ORDER.length - 1]);
    expect(document.activeElement).toBe(chip(ORDER[ORDER.length - 1]));
  });

  it("Home and End jump to the first and last mode", () => {
    mount({ presetId: "nebula" });
    fireEvent.keyDown(chip("nebula"), { key: "End" });
    expect(useVizStore.getState().presetId).toBe(ORDER[ORDER.length - 1]);

    fireEvent.keyDown(chip(ORDER[ORDER.length - 1]), { key: "Home" });
    expect(useVizStore.getState().presetId).toBe(ORDER[0]);
  });

  it("never lands on the + chip — wrapping goes last → first", () => {
    const last = ORDER[ORDER.length - 1];
    mount({ presetId: last });
    // The + chip is the NEXT sibling in the DOM, so an index-blind handler
    // would step onto it here.
    expect(document.querySelector(".chip-new")?.nextElementSibling).toBeNull();
    fireEvent.keyDown(chip(last), { key: "ArrowRight" });

    expect(useVizStore.getState().presetId).toBe(ORDER[0]);
    expect(document.activeElement).toBe(chip(ORDER[0]));
    expect(document.activeElement).not.toBe(document.querySelector(".chip-new"));
  });
});

describe("the strip's arrows do not double as the app's", () => {
  it("keeps ← / → away from the global seek shortcut", () => {
    mount({ presetId: ORDER[1] });
    const reached: string[] = [];
    const spy = (e: KeyboardEvent) => reached.push(e.key);
    window.addEventListener("keydown", spy);
    try {
      // `useAppShortcuts` binds ArrowLeft/ArrowRight to seek ±5 s on window and
      // exempts only INPUT and SELECT — a focused chip is neither.
      fireEvent.keyDown(chip(ORDER[1]), { key: "ArrowRight" });
      fireEvent.keyDown(chip(ORDER[2]), { key: "ArrowLeft" });
      expect(reached).toEqual([]);

      // Instrument check: keydown from this very element DOES otherwise reach
      // the window, so the two assertions above are about stopPropagation and
      // not about the event never getting there.
      fireEvent.keyDown(chip(ORDER[1]), { key: "n" });
      expect(reached).toEqual(["n"]);
    } finally {
      window.removeEventListener("keydown", spy);
    }
  });
});

describe("arrow navigation and the keep-it-visible effect do not both scroll", () => {
  it("reveals the new chip exactly once, and leaves the scrolling to the effect", () => {
    mount({ presetId: ORDER[0] });
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    scrollSpy.mockClear();

    fireEvent.keyDown(chip(ORDER[0]), { key: "ArrowRight" });

    // The browser's own focus scroll is instant and ancestor-wide; the effect's
    // is smooth and scoped. Only one of them may run.
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy.mock.instances[0]).toBe(chip(ORDER[1]));
  });

  it("still reveals when Home lands on the mode already selected", () => {
    // No store field changes here, so no effect re-runs — without the explicit
    // reveal the user is left focused on a chip that may be off-screen.
    mount({ presetId: ORDER[0] });
    scrollSpy.mockClear();

    fireEvent.keyDown(chip(ORDER[0]), { key: "Home" });

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy.mock.instances[0]).toBe(chip(ORDER[0]));
  });
});
