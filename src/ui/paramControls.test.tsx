// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ParamSpec } from "../render/types";
import { ParamRow } from "./kit";

afterEach(cleanup);

/**
 * ParamRow's dispatch. Before the ParamSpec union existed there was exactly
 * one rule — "0..1 with step 1 is a switch, everything else is a slider" — so
 * symmetry counts, image fit and kaleidoscope segments all shipped as sliders
 * the user had to hunt values on. These tests pin each control to its spec.
 */

const base = { min: 0, max: 1, step: 0.01, default: 0, group: "shape" };
const noop = () => undefined;

describe("ParamRow control dispatch", () => {
  it("renders an enum spec as a dropdown of its option labels", async () => {
    const onChange = vi.fn();
    const spec: ParamSpec = {
      key: "coverFit",
      label: "Image fit",
      group: "image",
      control: "enum",
      options: [
        { value: 0, label: "Fill" },
        { value: 1, label: "Fit" },
        { value: 2, label: "Stretch" },
      ],
      min: 0,
      max: 2,
      step: 1,
      default: 0,
    };
    render(<ParamRow spec={spec} value={0} onChange={onChange} onHint={noop} />);
    const select = screen.getByRole("combobox", { name: "Image fit" });
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Fill",
      "Fit",
      "Stretch",
    ]);
    await userEvent.selectOptions(select, "2");
    // The store still holds the plain number the shader reads.
    expect(onChange).toHaveBeenCalledWith(2);
    expect(typeof onChange.mock.calls[0][0]).toBe("number");
  });

  it("shows a value that matches no option instead of silently snapping", () => {
    // A hand-edited project (or a range that shrank) must not be rewritten by
    // merely LOOKING at the panel — the select would otherwise display the
    // first option while the document still held something else.
    const spec: ParamSpec = {
      key: "sym",
      label: "Symmetry",
      group: "shape",
      control: "enum",
      options: [
        { value: 1, label: "1×" },
        { value: 2, label: "2×" },
      ],
      min: 1,
      max: 2,
      step: 1,
      default: 1,
    };
    const onChange = vi.fn();
    render(<ParamRow spec={spec} value={7} onChange={onChange} onHint={noop} />);
    const select = screen.getByRole("combobox", { name: "Symmetry" }) as HTMLSelectElement;
    expect(select.value).toBe("7");
    expect(screen.getByText("Custom (7)")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders a toggle spec as a switch that writes 1 and 0", async () => {
    const onChange = vi.fn();
    const spec: ParamSpec = {
      key: "peaks",
      label: "Peak caps",
      group: "shape",
      control: "toggle",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
    };
    const { rerender } = render(
      <ParamRow spec={spec} value={0} onChange={onChange} onHint={noop} />,
    );
    const sw = screen.getByRole("switch", { name: "Peak caps" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(1);
    rerender(<ParamRow spec={spec} value={1} onChange={onChange} onHint={noop} />);
    await userEvent.click(screen.getByRole("switch", { name: "Peak caps" }));
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("still renders a legacy 0..1 step-1 slider spec as a switch", async () => {
    // Custom shaders built in the in-app editor only ever write
    // min/max/step/default, so their on/off knobs have no `control` at all.
    const onChange = vi.fn();
    const spec: ParamSpec = { key: "fill", label: "Fill", min: 0, max: 1, step: 1, default: 1 };
    render(<ParamRow spec={spec} value={1} onChange={onChange} onHint={noop} />);
    await userEvent.click(screen.getByRole("switch", { name: "Fill" }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("paints a hue spec's track with the wheel and reads it out in degrees", () => {
    const spec: ParamSpec = {
      key: "hue",
      label: "Hue",
      group: "color",
      control: "hue",
      min: 0,
      max: 360,
      step: 1,
      default: 210,
    };
    render(<ParamRow spec={spec} value={210} onChange={noop} onHint={noop} />);
    expect(screen.getByRole("slider").className).toContain("hue");
    expect(screen.getByRole("button", { name: "210°" })).toBeTruthy();
  });

  it("gives an angle spec a dial that sets the direction it is dragged to", () => {
    const onChange = vi.fn();
    const spec: ParamSpec = {
      key: "direction",
      label: "Direction",
      group: "motion",
      control: "angle",
      min: 0,
      max: 360,
      step: 5,
      default: 90,
    };
    const { container } = render(
      <ParamRow spec={spec} value={90} onChange={onChange} onHint={noop} />,
    );
    // The slider keeps the keyboard and the accessible name; the dial is a
    // pointer-only second affordance for the same value.
    expect(screen.getByRole("slider")).toBeTruthy();
    const dial = container.querySelector(".dial") as HTMLElement;
    expect(dial).toBeTruthy();
    // jsdom gives every element a 0x0 box at (0,0), so the centre is (0,0) and
    // a point at +x/-y is 45°: enough to prove the mapping runs and snaps.
    dial.setPointerCapture = () => undefined;
    dial.hasPointerCapture = () => true;
    fireEvent.pointerDown(dial, { pointerId: 1, clientX: 10, clientY: -10 });
    expect(onChange).toHaveBeenCalledWith(45);
  });

  it("keeps a plain numeric spec on a slider", () => {
    render(
      <ParamRow
        spec={{ ...base, key: "glow", label: "Glow" }}
        value={0.5}
        onChange={noop}
        onHint={noop}
      />,
    );
    expect(screen.getByRole("slider")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it('runs a taper:"log" spec in position space and emits snapped raw values', () => {
    // Nebula's Scale, the wave-0 proving case. The INPUT runs 0..1 (position);
    // what leaves the row is a raw value on the refined 0.01 grid — documents
    // and looks never see positions.
    const onChange = vi.fn();
    const spec: ParamSpec = {
      key: "scale",
      label: "Scale",
      group: "shape",
      min: 0.8,
      max: 6,
      step: 0.1,
      default: 2.4,
      taper: "log",
    };
    render(<ParamRow spec={spec} value={2.4} onChange={onChange} onHint={noop} />);
    const input = screen.getByRole("slider") as HTMLInputElement;
    expect(input.min).toBe("0");
    expect(input.max).toBe("1");
    expect(input.step).toBe("any");
    // The stored value renders at its LOG position: ln(3)/ln(7.5) ≈ 0.545,
    // not the linear (2.4-0.8)/5.2 ≈ 0.31 — that repositioning is the taper.
    expect(Number(input.value)).toBeCloseTo(Math.log(2.4 / 0.8) / Math.log(6 / 0.8), 6);
    // Mid-track lands on the geometric middle of the range, snapped to 0.01.
    fireEvent.change(input, { target: { value: "0.5" } });
    expect(onChange).toHaveBeenCalledWith(2.19);
    // Track ends still reach the exact edges.
    fireEvent.change(input, { target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith(0.8);
    fireEvent.change(input, { target: { value: "1" } });
    expect(onChange).toHaveBeenLastCalledWith(6);
  });
});
