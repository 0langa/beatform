import { describe, expect, it } from "vitest";
import { presets } from "../render/presets";
import { BUILDER2_ID } from "../render/builder2";
import type { PresetDef } from "../render/types";
import {
  DEFAULT_PRESET_ORDER,
  defaultPresetOrder,
  isDefaultPresetOrder,
  movePresetOrder,
  orderedPresets,
  reconcilePresetOrder,
  stripPresetIds,
} from "./presetOrder";

/**
 * Strip display order.
 *
 * The reconciliation cases below are the ones that cost a user something real:
 * a mode that an update ADDED must appear on a customised strip, or it is
 * unreachable — no chip, no number key, and `[`/`]` step straight past it. A
 * user would experience that as "the new mode from the changelog isn't in my
 * app", which is indistinguishable from a broken install.
 */

const A_REMOVED_MODE = "retired-in-a-later-version";

describe("default order", () => {
  it("is the shipped list, and covers the registry exactly once", () => {
    const order = defaultPresetOrder();
    expect(order).toEqual([
      "spectrum-bars",
      "radial-burst",
      "echo-trails",
      "bass-circle",
      "led-matrix",
      "spectro-falls",
      "gatefold",
      "lyric-stage",
      "overgrowth",
      "tunnel-rings",
      "oscilloscope",
      "nebula",
      "metaballs",
      "particle-flow",
      "aurora",
      "voice-orb",
      "spectrum-scape",
      "synthwave",
      "particles",
      BUILDER2_ID,
    ]);
    // Set equality with the registry: no strip preset may be missing (it would
    // be unreachable) and none may be listed twice (React key collision).
    expect([...order].sort()).toEqual([...stripPresetIds()].sort());
  });

  it("is independent of the registry ARRAY order", () => {
    // The whole point of the id list: the registry is free to be in
    // implementation order (it is) without that reaching the strip.
    expect(defaultPresetOrder()).not.toEqual(stripPresetIds());
  });

  it("puts an id the shipped list never mentions before Builder, not after", () => {
    const available = [...stripPresetIds(), "mode-shipped-without-touching-the-list"];
    const order = defaultPresetOrder(available);
    expect(order).toContain("mode-shipped-without-touching-the-list");
    expect(order.indexOf("mode-shipped-without-touching-the-list")).toBe(
      order.indexOf(BUILDER2_ID) - 1,
    );
    expect(order[order.length - 1]).toBe(BUILDER2_ID);
  });
});

describe("reconcile: a stored order meeting a different build", () => {
  it("drops ids this build no longer has", () => {
    const stored = ["aurora", A_REMOVED_MODE, "synthwave"];
    const order = reconcilePresetOrder(stored);
    expect(order).not.toContain(A_REMOVED_MODE);
    // ...and keeps the user's relative order of what survived.
    expect(order.indexOf("aurora")).toBeLessThan(order.indexOf("synthwave"));
    expect(order.indexOf("aurora")).toBe(0);
  });

  it("APPENDS an id the update added instead of dropping it", () => {
    // Exactly what an older build would have written: the full strip minus a
    // mode that shipped afterwards.
    const older = stripPresetIds().filter((id) => id !== "particles");
    const order = reconcilePresetOrder(older);
    expect(order).toContain("particles");
    expect([...order].sort()).toEqual([...stripPresetIds()].sort());
    // Before Builder, which stays the last chip.
    expect(order[order.length - 1]).toBe(BUILDER2_ID);
    expect(order.indexOf("particles")).toBe(order.indexOf(BUILDER2_ID) - 1);
  });

  it("maps a RENAMED id in place, keeping the user's position for it", () => {
    // A pre-v2.68 prefs order carries the legacy "starfield" id wherever the
    // user dragged it. Dropping it as unknown would re-append the mode at the
    // end — losing the customised position — so it must map in place.
    const stored = ["starfield", "aurora", "spectrum-bars"];
    const order = reconcilePresetOrder(stored);
    expect(order.slice(0, 3)).toEqual(["particles", "aurora", "spectrum-bars"]);
    expect(order).not.toContain("starfield");
    expect([...order].sort()).toEqual([...stripPresetIds()].sort());
  });

  it("collapses a legacy id and its current form to one entry", () => {
    const order = reconcilePresetOrder(["particles", "starfield", "aurora"]);
    expect(order.filter((id) => id === "particles")).toHaveLength(1);
    expect(order[0]).toBe("particles");
    expect(order[1]).toBe("aurora");
  });

  it("keeps every customised position while adding the new mode", () => {
    const older = ["synthwave", "aurora", "spectrum-bars"];
    const order = reconcilePresetOrder(older);
    expect(order.slice(0, 3)).toEqual(["synthwave", "aurora", "spectrum-bars"]);
    expect([...order].sort()).toEqual([...stripPresetIds()].sort());
  });

  it("adds several new ids in the shipped list's own sequence", () => {
    const older = ["spectrum-bars", BUILDER2_ID];
    const order = reconcilePresetOrder(older);
    // Everything else arrives between them, ordered as DEFAULT_PRESET_ORDER
    // wants — not in registry order, which would interleave differently.
    const added = order.slice(1, -1);
    const wanted = DEFAULT_PRESET_ORDER.filter(
      (id) => id !== "spectrum-bars" && id !== BUILDER2_ID,
    );
    expect(added).toEqual(wanted);
  });

  it("appends at the end when this build has no Builder at all", () => {
    const available = ["spectrum-bars", "aurora", "synthwave"];
    expect(reconcilePresetOrder(["aurora", "spectrum-bars"], available)).toEqual([
      "aurora",
      "spectrum-bars",
      "synthwave",
    ]);
  });

  it("collapses duplicates", () => {
    const order = reconcilePresetOrder(["aurora", "aurora", "spectrum-bars", "aurora"]);
    expect(order.filter((id) => id === "aurora")).toHaveLength(1);
    expect(order[0]).toBe("aurora");
  });

  it("is idempotent", () => {
    const once = reconcilePresetOrder(["synthwave", "aurora"]);
    expect(reconcilePresetOrder(once)).toEqual(once);
  });
});

describe("reconcile: corrupt input", () => {
  it("falls back to the default order rather than throwing or emptying", () => {
    for (const junk of [null, undefined, 42, "spectrum-bars", {}, { 0: "aurora" }, [], [1, 2, 3]]) {
      expect(reconcilePresetOrder(junk)).toEqual(defaultPresetOrder());
    }
  });

  it("falls back through the DEFAULT list, not by raw availability", () => {
    // With every id present in the shipped list the two are indistinguishable,
    // which is exactly how a missing fallback hides. Give the build a mode the
    // shipped list never mentions and the difference shows: the real fallback
    // still lands it before Builder; "just use whatever is available" puts it
    // after, past the end of the strip.
    const available = [...stripPresetIds(), "mode-from-the-future"];
    for (const junk of [null, "garbage", {}]) {
      const order = reconcilePresetOrder(junk, available);
      expect(order).toEqual(defaultPresetOrder(available));
      expect(order.indexOf("mode-from-the-future")).toBe(order.indexOf(BUILDER2_ID) - 1);
    }
  });

  it("keeps the usable entries of a partly-garbage list", () => {
    const order = reconcilePresetOrder([null, "aurora", 7, "nope", "synthwave"]);
    expect(order.slice(0, 2)).toEqual(["aurora", "synthwave"]);
    expect([...order].sort()).toEqual([...stripPresetIds()].sort());
  });
});

describe("reset to default", () => {
  it("recognises the shipped order and any deviation from it", () => {
    expect(isDefaultPresetOrder(defaultPresetOrder())).toBe(true);
    const moved = movePresetOrder(defaultPresetOrder(), 0, 5);
    expect(isDefaultPresetOrder(moved)).toBe(false);
    // A short or long list is not the default either, whatever it contains.
    expect(isDefaultPresetOrder(defaultPresetOrder().slice(0, -1))).toBe(false);
  });
});

describe("movePresetOrder", () => {
  it("moves an item and keeps everything else in sequence", () => {
    expect(movePresetOrder(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(movePresetOrder(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("never mutates its input, and ignores out-of-range moves", () => {
    const src = ["a", "b", "c"];
    expect(movePresetOrder(src, 0, 9)).toEqual(src);
    expect(movePresetOrder(src, -1, 0)).toEqual(src);
    expect(movePresetOrder(src, 1, 1)).toEqual(src);
    expect(src).toEqual(["a", "b", "c"]);
  });
});

describe("orderedPresets", () => {
  const custom = { id: "custom-x", name: "Mine" } as PresetDef;

  it("resolves ids to defs and puts custom visuals last", () => {
    const list = orderedPresets(["aurora", "spectrum-bars"], [custom]);
    expect(list.map((p) => p.id)).toEqual(["aurora", "spectrum-bars", "custom-x"]);
  });

  it("skips an id with no def instead of rendering a hole", () => {
    expect(orderedPresets(["aurora", A_REMOVED_MODE], []).map((p) => p.id)).toEqual(["aurora"]);
  });

  it("returns the real defs, not stand-ins", () => {
    const [first] = orderedPresets(["metaballs"], []);
    expect(first).toBe(presets.find((p) => p.id === "metaballs"));
  });
});
