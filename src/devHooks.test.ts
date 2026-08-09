// @vitest-environment jsdom
//
// NOT because anything here touches the DOM — every case below is plain
// numbers. `devHooks.ts` imports the store, whose module body reads
// `localStorage` at import time (persistence.loadStoredPresetId), so the
// default `node` environment cannot even load the file. The vitest config
// documents this per-file opt-in; it costs one environment, not a suite.
import { describe, it, expect } from "vitest";
import { scrollsOnAxis, rendersOwnText, type AxisScroll } from "./devHooks";

/**
 * `__auditUI` is the only gate in the tree that can look at a rendered dock row
 * at all, and it is unreachable from here: it needs a layout engine, and jsdom
 * answers 0 to every geometry question it asks. So the two predicates that
 * decide what it reports are extracted, and this file feeds them the shapes a
 * real engine produced — every number below was MEASURED in the app's own
 * Chromium against the live dock, not invented.
 */

/** A box that is not a scroll container in either direction, walked on x. */
const inert: AxisScroll = {
  axis: "x",
  overflow: "visible",
  crossOverflow: "visible",
  scrollExtent: 200,
  clientExtent: 200,
  crossScrollExtent: 400,
  crossClientExtent: 400,
};

const box = (over: Partial<AxisScroll>): AxisScroll => ({ ...inert, ...over });

describe("scrollsOnAxis", () => {
  it("rejects every overflow value that is not a scroll container", () => {
    for (const overflow of ["visible", "hidden", "clip"]) {
      expect(scrollsOnAxis(box({ overflow, scrollExtent: 428, clientExtent: 204 }))).toBe(false);
    }
  });

  it("credits an explicit `scroll` — the one value the propagation rule never mints", () => {
    expect(scrollsOnAxis(box({ overflow: "scroll", scrollExtent: 428, clientExtent: 204 }))).toBe(
      true,
    );
  });

  it("credits `scroll` even while the other axis is also scrolling", () => {
    // Authored intent beats the disambiguator: `overflow-x: scroll` cannot have
    // arrived by computation, so a scrolling y axis says nothing about it.
    expect(
      scrollsOnAxis(
        box({
          overflow: "scroll",
          crossOverflow: "auto",
          scrollExtent: 428,
          clientExtent: 204,
          crossScrollExtent: 752,
          crossClientExtent: 589,
        }),
      ),
    ).toBe(true);
  });

  it("refuses a scroll container with no range — the clipped-not-scrolled family", () => {
    // Measured: an `overflow: hidden` wrapper inside `.panel-scroll` holding a
    // 400px child leaves the scroller at scrollWidth === clientWidth === 204
    // while the child's rect pokes 199px past the panel. Nothing to scroll,
    // nowhere to go, and the child is genuinely invisible.
    expect(scrollsOnAxis(box({ overflow: "auto", scrollExtent: 204, clientExtent: 204 }))).toBe(
      false,
    );
    expect(scrollsOnAxis(box({ overflow: "scroll", scrollExtent: 204, clientExtent: 204 }))).toBe(
      false,
    );
  });

  it("treats a one-pixel difference as rounding, not as range", () => {
    expect(scrollsOnAxis(box({ overflow: "auto", scrollExtent: 205, clientExtent: 204 }))).toBe(
      false,
    );
    expect(scrollsOnAxis(box({ overflow: "auto", scrollExtent: 206, clientExtent: 204 }))).toBe(
      true,
    );
  });

  it("REFUSES `.panel-scroll`: `auto` on x that is an echo of `overflow-y: auto`", () => {
    // The H16 defect, in numbers taken off the live dock. Specified
    // `overflow-y: auto` alone; measured computed `auto/auto`; a too-wide row
    // pushes scrollWidth to 428 against clientWidth 204 and the box is 752 tall
    // in a 589 viewport. The old walk saw `overflowX === "auto"` here and
    // excused every element in the dock.
    expect(
      scrollsOnAxis({
        axis: "x",
        overflow: "auto",
        crossOverflow: "auto",
        scrollExtent: 428,
        clientExtent: 204,
        crossScrollExtent: 752,
        crossClientExtent: 589,
      }),
    ).toBe(false);
  });

  it("keeps `.chips`: `overflow-x: auto` over a single flex row", () => {
    // The mirror shape, and the reason the disambiguator is about RANGE rather
    // than about the computed value: `.chips` specifies only `overflow-x: auto`
    // so its computed y is `auto` too, exactly like `.panel-scroll`'s x. What
    // separates them is that this one has no vertical range to scroll.
    expect(
      scrollsOnAxis({
        axis: "x",
        overflow: "auto",
        crossOverflow: "auto",
        scrollExtent: 640,
        clientExtent: 292,
        crossScrollExtent: 24,
        crossClientExtent: 24,
      }),
    ).toBe(true);
  });

  it("keeps `.tl-scroll`: `overflow-y: hidden` is not a scroller, whatever its range", () => {
    expect(
      scrollsOnAxis({
        axis: "x",
        overflow: "auto",
        crossOverflow: "hidden",
        scrollExtent: 1800,
        clientExtent: 900,
        crossScrollExtent: 300,
        crossClientExtent: 120,
      }),
    ).toBe(true);
  });

  it("still credits a VERTICAL scroller that has also gained horizontal range", () => {
    // The over-report this predicate was measured into. `.panel-scroll` with a
    // too-wide row present has range on BOTH axes (measured live: 35px of x
    // range beside its normal y range). The horizontal excuse must die — that
    // is the case above — but the VERTICAL one must survive, because the dock
    // scrolls down perfectly well. A symmetric rule returned 50 findings for
    // one defect, 41 of them below-viewport against a working scroller.
    expect(
      scrollsOnAxis({
        axis: "y",
        overflow: "auto",
        crossOverflow: "auto",
        scrollExtent: 752,
        clientExtent: 589,
        crossScrollExtent: 239,
        crossClientExtent: 204,
      }),
    ).toBe(true);
  });

  it("answers the below-viewport walk too — `.chips` has no vertical range", () => {
    // The mirror blind spot, and clause 2 is all it takes: `.chips` computes
    // `overflow-y: auto` purely because `overflow-x: auto` was set, and has no
    // vertical range at all. An element below the fold with only this between
    // it and the body is unreachable; the old regex-on-computed-style credited
    // it as a scroller.
    expect(
      scrollsOnAxis({
        axis: "y",
        overflow: "auto",
        crossOverflow: "auto",
        scrollExtent: 24,
        clientExtent: 24,
        crossScrollExtent: 640,
        crossClientExtent: 292,
      }),
    ).toBe(false);
  });
});

describe("rendersOwnText", () => {
  it("keeps plain leaves", () => {
    expect(rendersOwnText("SPAN", 0)).toBe(true);
    expect(rendersOwnText("INPUT", 0)).toBe(true);
  });

  it("sees a <select>, whose <option>s are never laid out in the row", () => {
    // Measured: an 80px select showing a 45-character option reports
    // scrollWidth 257 / clientWidth 78 with children.length 2. The old
    // `children.length === 0` test made every truncated dropdown invisible.
    expect(rendersOwnText("SELECT", 2)).toBe(true);
  });

  it("still refuses containers, which is what keeps the auditor readable", () => {
    // A wrapper's scrollWidth overflows whenever ANY descendant does, so
    // admitting containers would report the same clip once per ancestor.
    expect(rendersOwnText("DIV", 3)).toBe(false);
    expect(rendersOwnText("BUTTON", 1)).toBe(false);
  });
});
