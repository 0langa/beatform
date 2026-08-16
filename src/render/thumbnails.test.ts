// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { presets } from "./presets";
import { DEFAULT_PRESET_ORDER } from "../state/presetOrder";

/**
 * P-3's two claims about the thumbnail run, both of which are about SCHEDULING
 * rather than pixels:
 *
 *  1. it walks the STRIP's order, so the chips a new user is looking at are the
 *     chips that get rendered first, and
 *  2. it publishes the eager slice the moment it exists instead of holding
 *     every mode back until the last PNG is encoded.
 *
 * Claim 2 is only meaningful as a statement about WHEN, so the probe below is
 * "how many modes had been rendered at the instant this batch was published"
 * — a test that only inspected the final map would pass just as happily on the
 * all-or-nothing version this replaces.
 *
 * The renderer is faked: `generate()` needs a real WebGPU device and the point
 * here is the loop around it, not what it draws. What is NOT faked is the
 * registry, the strip order, `defaultParams` or the data-URL encode, so the
 * sequencing under test is the real one.
 */

/** Preset ids handed to `setPreset`, in the order the run asked for them. */
const rendered: string[] = [];
/** When set, `setPreset` throws once `rendered` has reached this length. */
let failAfter: number | null = null;

vi.mock("./webgpuRenderer", () => ({
  WebGPURenderer: {
    create: () =>
      Promise.resolve({
        resize: () => {},
        setBuilderParams: () => {},
        setPreset: (p: { id: string }) => {
          if (failAfter !== null && rendered.length >= failAfter) throw new Error("device lost");
          rendered.push(p.id);
        },
        render: () => {},
        gpuDone: () => Promise.resolve(undefined),
        dispose: () => {},
      }),
  },
}));

class FakeOffscreenCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  convertToBlob() {
    return Promise.resolve(new Blob(["fake-png"], { type: "image/png" }));
  }
}

beforeEach(() => {
  rendered.length = 0;
  failAfter = null;
  // `inflight` memoizes the run for the whole session by design, so each case
  // needs its own module instance or only the first would do any work.
  vi.resetModules();
  (globalThis as unknown as Record<string, unknown>).OffscreenCanvas = FakeOffscreenCanvas;
});

const ORDER = [...DEFAULT_PRESET_ORDER];
const REGISTRY = presets.map((p) => p.id);

describe("thumbnailSequence", () => {
  it("follows the strip's order rather than the registry's", async () => {
    const { thumbnailSequence } = await import("./thumbnails");
    expect(thumbnailSequence(ORDER).map((p) => p.id)).toEqual(ORDER);
    // Instrument check: if the two orders agreed, "follows the strip" would be
    // indistinguishable from "follows the registry" and the assertion above
    // would prove nothing. They must genuinely differ — and they do, by a lot:
    // echo-trails is 3rd on the strip and 10th in the registry.
    expect(REGISTRY).not.toEqual(ORDER);
  });

  it("appends every mode the order never mentions, so none can lose its thumbnail", async () => {
    const { thumbnailSequence } = await import("./thumbnails");
    const ids = thumbnailSequence(["nebula"]).map((p) => p.id);
    expect(ids[0]).toBe("nebula");
    expect(ids).toHaveLength(REGISTRY.length);
    expect(new Set(ids)).toEqual(new Set(REGISTRY));
  });

  it("skips unknown ids and duplicates in a stored order", async () => {
    const { thumbnailSequence } = await import("./thumbnails");
    const ids = thumbnailSequence(["gone-in-v2", "aurora", "aurora", "nebula"]).map((p) => p.id);
    expect(ids.slice(0, 2)).toEqual(["aurora", "nebula"]);
    expect(ids).toHaveLength(REGISTRY.length);
  });

  it("falls back to registry order when nothing is passed", async () => {
    const { thumbnailSequence } = await import("./thumbnails");
    expect(thumbnailSequence().map((p) => p.id)).toEqual(REGISTRY);
  });
});

describe("renderPresetThumbnails publishes the eager slice before the tail", () => {
  it("hands over the first EAGER_THUMB_COUNT chips while the rest are still unrendered", async () => {
    const mod = await import("./thumbnails");
    const batches: string[][] = [];
    /** Modes rendered so far AT THE MOMENT each batch was published. */
    const renderedWhenPublished: number[] = [];

    const all = await mod.renderPresetThumbnails({
      order: ORDER,
      onBatch: (thumbs) => {
        batches.push(Object.keys(thumbs));
        renderedWhenPublished.push(rendered.length);
      },
    });

    // The whole point: the first publish happens with the tail still to do.
    expect(renderedWhenPublished).toEqual([mod.EAGER_THUMB_COUNT, ORDER.length]);
    expect(batches[0]).toEqual(ORDER.slice(0, mod.EAGER_THUMB_COUNT));
    expect(batches[1]).toEqual(ORDER);
    // …and the eager slice is a strict prefix, not "some ten of them".
    expect(ORDER.length).toBeGreaterThan(mod.EAGER_THUMB_COUNT);

    expect(rendered).toEqual(ORDER);
    expect(Object.keys(all)).toEqual(ORDER);
    expect(all["spectrum-bars"]).toMatch(/^data:image\/png;base64,/);
  });

  it("keeps the eager slice when the tail dies on a lost device", async () => {
    const mod = await import("./thumbnails");
    failAfter = mod.EAGER_THUMB_COUNT + 2;
    const batches: string[][] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // The run rejects internally and resolves empty, exactly as before…
    await expect(
      mod.renderPresetThumbnails({ order: ORDER, onBatch: (t) => batches.push(Object.keys(t)) }),
    ).resolves.toEqual({});
    // …but the ten chips already on screen are not taken back.
    expect(batches).toEqual([ORDER.slice(0, mod.EAGER_THUMB_COUNT)]);
    warn.mockRestore();
  });

  it("gives the eager slice to the user's OWN first ten chips, not the shipped ten", async () => {
    const mod = await import("./thumbnails");
    const custom = [...ORDER].reverse();
    const batches: string[][] = [];
    await mod.renderPresetThumbnails({
      order: custom,
      onBatch: (t) => batches.push(Object.keys(t)),
    });
    expect(batches[0]).toEqual(custom.slice(0, mod.EAGER_THUMB_COUNT));
    // Instrument check: a reordered strip has to ask for a genuinely different
    // ten, or "the user's order" and "the shipped order" would be the same
    // claim and the assertion above would hold either way.
    expect(new Set(batches[0])).not.toEqual(new Set(ORDER.slice(0, mod.EAGER_THUMB_COUNT)));
  });

  it("hands out copies, so a consumer can keep the eager batch it was given", async () => {
    const mod = await import("./thumbnails");
    const handed: Array<Record<string, string>> = [];
    await mod.renderPresetThumbnails({ order: ORDER, onBatch: (t) => handed.push(t) });
    // Read LATER, not inside the callback: passing the live accumulator would
    // leave a consumer holding an object that grew all seventeen entries behind
    // its back — invisible to any assertion made at call time.
    expect(Object.keys(handed[0])).toHaveLength(mod.EAGER_THUMB_COUNT);
    expect(Object.keys(handed[1])).toHaveLength(ORDER.length);
  });
});
