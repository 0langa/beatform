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
 *
 * TOMBSTONE (P-9, v2.82.0) — "essentials hides the expert tier; All reveals
 * it" is gone. It named the global Essentials/All Segmented, which no longer
 * exists: the tier is a per-group disclosure now, so the same subject is
 * asserted by G2 against one group instead of the whole panel.
 *
 * TOMBSTONE (P-9, v2.82.0) — "keeps the deprecated showAdvanced shim opening
 * every tier at once" is gone with the prop it pinned. It existed for exactly
 * one wave, so this file could land against an un-rewritten ParamsPanel. Its
 * two halves both survive elsewhere: that an OPEN tier renders its expert rows
 * is G2, and that one click can open every tier at once is ParamsPanel's R14
 * over the real "Show every control" button, which writes each group id into
 * `advancedGroups` instead of overriding it.
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
  const onToggleAdvanced = vi.fn();
  const onParam = vi.fn();
  const utils = render(
    <ParamGroups
      preset={PRESET}
      params={{}}
      onParam={onParam}
      onHint={() => undefined}
      query=""
      collapsed={[]}
      advancedGroups={[]}
      onToggleGroup={onToggleGroup}
      onToggleAdvanced={onToggleAdvanced}
      {...over}
    />,
  );
  return { onToggleGroup, onToggleAdvanced, onParam, ...utils };
}

const headings = () =>
  [...document.querySelectorAll(".group-name")].map((e) => e.textContent ?? "");

/** The <section> of one group, by its visible label. */
const groupEl = (label: string) =>
  [...document.querySelectorAll<HTMLElement>(".param-group")].find(
    (s) => s.querySelector(".group-name")?.textContent === label,
  )!;

const disclosure = (label: string) => groupEl(label).querySelector<HTMLElement>(".group-advanced");

describe("ParamGroups", () => {
  it("G1: lays groups out by rank, not by the order the params were declared", () => {
    view();
    // Declaration order is glow, size, vignette, hueSpread; rank order is
    // Shape (10), Color (20), Glow (50), Backdrop (80). All four render in the
    // DEFAULT view now — groups derive from allParams, so a group whose params
    // are all expert-tier still keeps its header.
    expect(headings()).toEqual(["Shape", "Color", "Glow", "Backdrop"]);
  });

  it("G2: each group hides its own expert tier until its disclosure opens", () => {
    const { rerender } = view();
    expect(screen.queryByText("vignette")).toBeNull();
    expect(screen.queryByText("hueSpread")).toBeNull();
    // The affordance a fully-expert group has: header + one disclosure line.
    expect(disclosure("Backdrop")?.textContent).toContain("1 expert control");
    rerender(
      <ParamGroups
        preset={PRESET}
        params={{}}
        onParam={() => undefined}
        onHint={() => undefined}
        advancedGroups={["backdrop"]}
        query=""
        collapsed={[]}
        onToggleGroup={() => undefined}
        onToggleAdvanced={() => undefined}
      />,
    );
    expect(screen.getByText("vignette")).toBeTruthy();
    // Per group, not global: Color's tier stayed shut.
    expect(screen.queryByText("hueSpread")).toBeNull();
  });

  it("G3: search finds an expert knob with every disclosure closed, and hides the rest", () => {
    // The whole point: the old Advanced drawer was never searched, so two
    // thirds of every visual was unreachable by name. The tier is ignored
    // while searching, and no disclosure renders — it would misreport what is
    // hidden.
    view({ query: "vignette", advancedGroups: [] });
    expect(screen.getByText("vignette")).toBeTruthy();
    expect(screen.queryByText("Glow")).toBeNull();
    expect(headings()).toEqual(["Backdrop"]);
    expect(document.querySelector(".group-advanced")).toBeNull();
  });

  it("G4: the disclosure is a sibling of the group header, never a descendant", () => {
    // A <button> inside a <button> is invalid HTML the browser reparents, and
    // one click would then fire both handlers.
    view();
    expect(document.querySelector(".group-head .group-advanced")).toBeNull();
    expect(document.querySelectorAll(".group-advanced").length).toBe(2);
  });

  it("G5: the disclosure reports the bare group id, so prefs can persist it", async () => {
    const { onToggleAdvanced } = view();
    await userEvent.click(disclosure("Backdrop")!);
    expect(onToggleAdvanced).toHaveBeenCalledWith("backdrop", true);
  });

  it("G6: the group count is the group total and does not shift when a tier opens", () => {
    const count = () => groupEl("Backdrop").querySelector(".group-count")?.textContent;
    const { rerender } = view();
    expect(count()).toBe("1");
    rerender(
      <ParamGroups
        preset={PRESET}
        params={{}}
        onParam={() => undefined}
        onHint={() => undefined}
        advancedGroups={["backdrop"]}
        query=""
        collapsed={[]}
        onToggleGroup={() => undefined}
        onToggleAdvanced={() => undefined}
      />,
    );
    expect(count()).toBe("1");
  });

  it("G7: a preset with no expert tier and no groups renders one flat More group", () => {
    // Custom shaders and imported Shadertoy visuals: custom.ts rebuilds every
    // spec without a `group`, so they land whole in the fallback.
    const flat: PresetDef = {
      id: "custom",
      name: "Custom",
      params: [num("a"), num("b"), num("c")],
      wgsl: "",
    };
    view({ preset: flat });
    expect(headings()).toEqual(["More"]);
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByText("b")).toBeTruthy();
    expect(screen.getByText("c")).toBeTruthy();
    expect(document.querySelector(".group-advanced")).toBeNull();
  });

  it("G8: the changed count reports only off-default expert knobs of that group", () => {
    view({ params: { vignette: 0.5, size: 0.5 } });
    // vignette is expert and off its default; size is curated, so it must not
    // be counted anywhere.
    expect(disclosure("Backdrop")?.textContent).toContain("1 changed");
    expect(disclosure("Color")?.textContent).not.toContain("changed");
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
    expect(headings()).toEqual(["Shape", "Color", "Glow", "Backdrop"]);
    expect(screen.queryByText("size")).toBeNull();
    // Collapse hides the whole body, disclosure included.
    expect(groupEl("Shape").querySelector(".group-advanced")).toBeNull();
    // Only the collapsed group's body is gone — its neighbour keeps its rows.
    expect(screen.getByText("Bloom")).toBeTruthy();
  });

  it("forces every group open while searching, so a collapsed one cannot swallow the hit", () => {
    view({ collapsed: [GROUP_KEY + "shape"], query: "size" });
    expect(screen.getByText("size")).toBeTruthy();
  });

  it("renders an extra inside its declared group, even with no params left there", () => {
    view({
      extras: [{ group: "image", search: "center image cover", node: <p>center-image-row</p> }],
    });
    expect(headings()).toEqual(["Shape", "Color", "Glow", "Image", "Backdrop"]);
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
