// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";

/**
 * Lyrics model manager — component wiring tests.
 *
 * HD-17: the panel could download models but never verify or remove them —
 * the Rust commands (and their platform.ts wrappers) existed with no UI, so
 * multi-GB models could not be reclaimed from inside the app. The panel now
 * lists every model on disk with Verify (installed files) and Remove
 * (installed files AND stalled partial downloads), both disabled while a
 * download, a lyrics job, another model operation or a line re-align runs.
 *
 * Same mock surface as LyricsEditPanel.test.tsx; the store is real, the
 * model actions are stubbed per test so a click can be asserted.
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
  // Desktop: the browser build renders only a hint — no model manager at all.
  return { ...actual, isTauri: () => true, writeAutosave: vi.fn(async () => {}) };
});

const { LyricsGenPanel } = await import("./LyricsGenPanel");
const { useVizStore } = await import("../state/store");
const { IDLE_LYRICS_GEN } = await import("../state/lyricsGen");
type LyricsGenState = import("../state/lyricsGen").LyricsGenState;

const PRISTINE = { ...useVizStore.getState() };

afterEach(() => {
  cleanup();
  useVizStore.setState(PRISTINE);
});

function modelInfo(id: string, installed: boolean, partBytes = 0) {
  return {
    id,
    fileName: `${id}.bin`,
    bytes: 1_500_000_000,
    sha256: "x",
    role: "isolation",
    installed,
    partBytes,
  };
}
const MODELS = {
  modelsDir: "C:/Users/x/AppData/Roaming/beatform/models",
  models: [
    modelInfo("mdx-voc-ft", true),
    modelInfo("wav2vec2-align", true),
    modelInfo("wav2vec2-vocab", true),
    modelInfo("whisper-small", true),
    modelInfo("whisper-medium", false, 300_000_000), // a stalled partial
  ],
};

const isDisabled = (el: Element | null) => !!(el as HTMLButtonElement | null)?.disabled;

function mount(patch: Partial<LyricsGenState> = {}, realign: { index: number } | null = null) {
  const verify = vi.fn(async () => {});
  const remove = vi.fn(async () => {});
  act(() =>
    useVizStore.setState({
      // The mount effect refreshes the manifest through the platform — stub
      // it; the fixture below IS the manifest state under test.
      refreshLyricsGen: vi.fn(async () => {}),
      verifyLyricsModel: verify,
      removeLyricsModel: remove,
      lyricsGen: { ...IDLE_LYRICS_GEN, models: MODELS, dml: false, ...patch },
      lyricsRealign: realign,
    }),
  );
  const utils = render(<LyricsGenPanel />);
  return { ...utils, verify, remove };
}

const row = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-lyr-model="${id}"]`) as HTMLElement | null;
const allButtons = (container: HTMLElement, name: RegExp) =>
  Array.from(container.querySelectorAll(".lyr-models button")).filter((b) =>
    name.test(b.textContent ?? ""),
  ) as HTMLButtonElement[];

/**
 * Budget on the describe, not the `it`s (GATES.md §1): every case mounts the
 * real panel against the real store (`mount` calls `render()`), and the first
 * one pays the whole subtree's cold render. The full-suite run saw exactly
 * this case cross vitest's 5 s default under parallel-worker contention — the
 * same shape PlayerBar/SettingsDialog carry a budget for. Alone it takes well
 * under a second; the budget changes nothing about what is asserted.
 */
describe(
  "HD-17 — the model manager lists what is on disk with Verify and Remove",
  { timeout: 30_000 },
  () => {
    it("one row per model on disk; Verify on installed files only, Remove on partials too; clicks reach the store", () => {
      const { container, verify, remove } = mount();

      expect(container.querySelectorAll("[data-lyr-model]")).toHaveLength(5);
      expect(allButtons(container, /^Verify$/)).toHaveLength(4); // not the partial
      expect(allButtons(container, /^Remove$/)).toHaveLength(5);
      // The header totals what the models actually occupy: 4 × 1.5 GB + 0.3 GB.
      expect(container.querySelector(".lyr-models")!.textContent).toMatch(/6\.30 GB/);
      // A partial says so, with its real size.
      expect(row(container, "whisper-medium")!.textContent).toMatch(/300 MB/);
      expect(row(container, "whisper-medium")!.textContent).toMatch(/partial/i);

      fireEvent.click(
        within(row(container, "whisper-small")!).getByRole("button", { name: "Verify" }),
      );
      expect(verify).toHaveBeenCalledWith("whisper-small");
      fireEvent.click(
        within(row(container, "whisper-medium")!).getByRole("button", { name: "Remove" }),
      );
      expect(remove).toHaveBeenCalledWith("whisper-medium");
    });

    it("nothing on disk, no list", () => {
      const { container } = mount({
        models: {
          modelsDir: "C:/models",
          models: [modelInfo("whisper-small", false), modelInfo("mdx-voc-ft", false)],
        },
      });
      expect(container.querySelector(".lyr-models")).toBeNull();
    });

    it("Verify and Remove disable while a download, a lyrics job, a model operation or a re-align runs", () => {
      const busyStates: Array<[string, Partial<LyricsGenState>, { index: number } | null]> = [
        [
          "downloading",
          {
            phase: "downloading",
            download: { id: "whisper-medium", received: 10, total: 100 },
          },
          null,
        ],
        [
          "generating",
          {
            phase: "generating",
            gen: { stage: "isolate", pct: 10, etaSec: 5, overall: 0.1, starting: false },
          },
          null,
        ],
        ["verifying", { modelOp: { id: "whisper-small", kind: "verify" } }, null],
        ["re-aligning", {}, { index: 0 }],
      ];
      for (const [label, patch, realign] of busyStates) {
        const { container, unmount } = mount(patch, realign);
        const buttons = [
          ...allButtons(container, /Verify|checking/),
          ...allButtons(container, /Remove|removing/),
        ];
        expect(buttons.length, label).toBeGreaterThan(0); // the list stays visible, just locked
        for (const b of buttons) expect(isDisabled(b), `${label}: ${b.textContent}`).toBe(true);
        unmount();
      }
    });

    it("idle control: every Verify and Remove is live", () => {
      const { container } = mount();
      const buttons = [...allButtons(container, /^Verify$/), ...allButtons(container, /^Remove$/)];
      expect(buttons).toHaveLength(9);
      for (const b of buttons) expect(isDisabled(b)).toBe(false);
    });

    it("the model being verified reads as in progress on its own row", () => {
      const { container } = mount({ modelOp: { id: "whisper-small", kind: "verify" } });
      expect(row(container, "whisper-small")!.textContent).toMatch(/checking/i);
      expect(row(container, "mdx-voc-ft")!.textContent).not.toMatch(/checking/i);
    });

    it("Download and Generate wait for a model operation too", () => {
      const { container } = mount({ modelOp: { id: "whisper-small", kind: "remove" } });
      const gen = Array.from(container.querySelectorAll("button")).find((b) =>
        /Generate lyrics/.test(b.textContent ?? ""),
      );
      expect(gen).toBeDefined();
      expect(isDisabled(gen!)).toBe(true);
    });
  },
);
