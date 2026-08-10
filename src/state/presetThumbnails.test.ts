// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `loadPresetThumbnails()` publishes PER BATCH, not once at the end.
 *
 * The old action awaited the whole run and set `presetThumbs` from the
 * resolved promise, so nothing appeared on the mode strip until all sixteen
 * modes had rendered AND encoded — a chip finished at 200 ms stayed a text
 * label for the length of the entire run. P-3 replaced that with an
 * `onBatch` callback, and this pins the difference, because the two are
 * indistinguishable from the outside once the run has finished.
 *
 * It also pins that the action hands the renderer the USER's strip order.
 * That is not cosmetic: registry order and strip order genuinely disagree
 * (echo-trails is 3rd on the strip and 10th in the registry), so walking the
 * registry rendered the chips the user looks at first nearly last.
 */
vi.mock("../render/thumbnails", () => ({
  renderPresetThumbnails: vi.fn(),
}));

const { renderPresetThumbnails } = await import("../render/thumbnails");
const { useVizStore } = await import("./store");

const mocked = vi.mocked(renderPresetThumbnails);

describe("loadPresetThumbnails", () => {
  beforeEach(() => {
    mocked.mockReset();
    useVizStore.setState({ presetThumbs: null });
  });

  it("publishes every batch the renderer hands it, not just the last", () => {
    mocked.mockImplementation(async (opts) => {
      opts?.onBatch?.({ a: "data:image/png;base64,AAA" });
      opts?.onBatch?.({ a: "data:image/png;base64,AAA", b: "data:image/png;base64,BBB" });
      return {};
    });

    const seen: number[] = [];
    const stop = useVizStore.subscribe((s, prev) => {
      if (s.presetThumbs !== prev.presetThumbs && s.presetThumbs) {
        seen.push(Object.keys(s.presetThumbs).length);
      }
    });
    useVizStore.getState().loadPresetThumbnails();
    stop();

    // Two publishes, and the FIRST one is partial — that is the whole point.
    // Asserting only the final state would pass against the old all-or-
    // nothing action, which is exactly the mistake this test exists to avoid.
    expect(seen).toEqual([1, 2]);
  });

  it("hands the renderer the user's strip order, not the registry's", () => {
    useVizStore.setState({ presetOrder: ["tunnel", "aurora"] });
    mocked.mockResolvedValue({});
    useVizStore.getState().loadPresetThumbnails();
    expect(mocked.mock.calls[0][0]?.order).toEqual(["tunnel", "aurora"]);
  });

  it("does not re-render once thumbnails exist", () => {
    useVizStore.setState({ presetThumbs: { a: "data:image/png;base64,AAA" } });
    mocked.mockResolvedValue({});
    useVizStore.getState().loadPresetThumbnails();
    expect(mocked).not.toHaveBeenCalled();
  });
});
