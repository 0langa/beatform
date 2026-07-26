// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ParamSpec, PresetDef } from "../render/types";
import { GROUP_KEY, ParamGroups } from "./ParamGroups";

afterEach(cleanup);

/**
 * The parameter area's behaviour: what is shown, in what order, and what
 * search is allowed to bypass. The old flat list had none of this — every
 * knob in ABI order, with the expert tier in a drawer search never looked in.
 */

const num = (key: string, over: Partial<ParamSpec> = {}): ParamSpec =>
  ({ key, label: key, min: 0, max: 1, step: 0.01, default: 0, ...over }) as ParamSpec;

const PRESET: PresetDef = {
  id: "fx",
  name: "Fx",
  params: [num("glow", { group: "glow", label: "Bloom" }), num("size", { group: "shape" })],
  advanced: [
    num("vignette", { group: "backdrop", hint: "Darkens the corners" }),
    num("hueSpread", { group: "color" }),
  ],
  wgsl: "",
};

function view(over: Partial<React.ComponentProps<typeof ParamGroups>> = {}) {
  const onToggleGroup = vi.fn();
  const onParam = vi.fn();
  const utils = render(
    <ParamGroups
      preset={PRESET}
      params={{}}
      onParam={onParam}
      onHint={() => undefined}
      showAdvanced={false}
      query=""
      collapsed={[]}
      onToggleGroup={onToggleGroup}
      {...over}
    />,
  );
  return { onToggleGroup, onParam, ...utils };
}

const headings = () =>
  [...document.querySelectorAll(".group-name")].map((e) => e.textContent ?? "");

describe("ParamGroups", () => {
  it("lays groups out by rank, not by the order the params were declared", () => {
    view({ showAdvanced: true });
    // Declaration order is glow, size, vignette, hueSpread; rank order is
    // Shape (10), Color (20), Glow (50), Backdrop (80).
    expect(headings()).toEqual(["Shape", "Color", "Glow", "Backdrop"]);
  });

  it("essentials hides the expert tier; All reveals it", () => {
    const { rerender } = view();
    expect(headings()).toEqual(["Shape", "Glow"]);
    expect(screen.queryByText("vignette")).toBeNull();
    rerender(
      <ParamGroups
        preset={PRESET}
        params={{}}
        onParam={() => undefined}
        onHint={() => undefined}
        showAdvanced
        query=""
        collapsed={[]}
        onToggleGroup={() => undefined}
      />,
    );
    expect(screen.getByText("vignette")).toBeTruthy();
  });

  it("search finds an expert knob even in essentials mode, and hides the rest", () => {
    // The whole point: the old Advanced drawer was never searched, so two
    // thirds of every visual was unreachable by name.
    view({ query: "vignette" });
    expect(screen.getByText("vignette")).toBeTruthy();
    expect(screen.queryByText("Glow")).toBeNull();
    expect(headings()).toEqual(["Backdrop"]);
  });

  it("search matches a hint, not just the label", () => {
    view({ query: "corners" });
    expect(screen.getByText("vignette")).toBeTruthy();
  });

  it("reports nothing rather than an empty panel when a search matches no knob", () => {
    view({ query: "zzzz" });
    expect(headings()).toEqual([]);
    expect(screen.getByText(/No knobs of Fx match/)).toBeTruthy();
  });

  it("collapses a group, and reports the group id so prefs can persist it", async () => {
    const { onToggleGroup } = view();
    await userEvent.click(screen.getByRole("button", { name: /Shape/ }));
    expect(onToggleGroup).toHaveBeenCalledWith("shape", false);
  });

  it("honours persisted collapse state, keyed under the group prefix", () => {
    view({ collapsed: [GROUP_KEY + "shape"] });
    expect(headings()).toEqual(["Shape", "Glow"]);
    expect(screen.queryByText("size")).toBeNull();
    // Only the collapsed group's body is gone — its neighbour keeps its rows.
    expect(screen.getByText("Bloom")).toBeTruthy();
  });

  it("forces every group open while searching, so a collapsed one cannot swallow the hit", () => {
    view({ collapsed: [GROUP_KEY + "shape"], query: "size" });
    expect(screen.getByText("size")).toBeTruthy();
  });

  it("renders an extra inside its declared group, even with no params left there", () => {
    view({
      showAdvanced: false,
      extras: [{ group: "image", search: "center image cover", node: <p>center-image-row</p> }],
    });
    expect(headings()).toEqual(["Shape", "Glow", "Image"]);
    expect(screen.getByText("center-image-row")).toBeTruthy();
  });

  it("surfaces an extra whose keywords match the search", () => {
    view({
      query: "cover",
      extras: [{ group: "image", search: "center image cover", node: <p>center-image-row</p> }],
    });
    expect(screen.getByText("center-image-row")).toBeTruthy();
  });

  it("hides an extra whose keywords do not match", () => {
    view({
      query: "zzzz",
      extras: [{ group: "image", search: "center image cover", node: <p>center-image-row</p> }],
    });
    expect(screen.queryByText("center-image-row")).toBeNull();
  });
});
