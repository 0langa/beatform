// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CollapsibleSection,
  ParamRow,
  PERCENT,
  Segmented,
  SelectRow,
  SliderRow,
  ToggleRow,
} from "./kit";

afterEach(cleanup);

describe("Segmented", () => {
  const OPTS = [
    { value: "a", label: "Alpha", hint: "first" },
    { value: "b", label: "Beta", hint: "second", disabled: true },
    { value: "c", label: "Gamma" },
  ];

  it("marks the active segment and fires onChange with the value", async () => {
    const onChange = vi.fn();
    render(<Segmented options={OPTS} value="a" onChange={onChange} ariaLabel="pick" />);
    const group = screen.getByRole("group", { name: "pick" });
    const buttons = group.querySelectorAll("button");
    expect(buttons[0].className).toContain("active");
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(buttons[2].getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(buttons[2]);
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("per-option and whole-control disabled both block clicks", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Segmented options={OPTS} value="a" onChange={onChange} />);
    await userEvent.click(screen.getByText("Beta")); // option-disabled
    expect(onChange).not.toHaveBeenCalled();
    rerender(<Segmented options={OPTS} value="a" onChange={onChange} disabled />);
    await userEvent.click(screen.getByText("Gamma"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("routes option hints to onHint on hover and clears on leave", async () => {
    const onHint = vi.fn();
    render(<Segmented options={OPTS} value="a" onChange={() => undefined} onHint={onHint} />);
    await userEvent.hover(screen.getByText("Alpha"));
    expect(onHint).toHaveBeenLastCalledWith("first");
    await userEvent.unhover(screen.getByText("Alpha"));
    expect(onHint).toHaveBeenLastCalledWith(null);
  });
});

describe("ToggleRow", () => {
  it("renders a switch reflecting checked and toggles", async () => {
    const onChange = vi.fn();
    render(<ToggleRow label="Grid" checked={false} onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Grid" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("SliderRow", () => {
  it("formats the readout by step (2dp under 1, integers otherwise)", () => {
    render(<SliderRow label="Amt" min={0} max={1} step={0.01} value={0.5} onChange={() => 0} />);
    expect(screen.getByText("0.50")).toBeTruthy();
    render(<SliderRow label="N" min={0} max={10} step={1} value={7} onChange={() => 0} />);
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("honors a custom format", () => {
    render(
      <SliderRow
        label="Pct"
        min={0}
        max={2}
        step={0.05}
        value={1.5}
        onChange={() => 0}
        format={(v) => `${Math.round(v * 100)}%`}
      />,
    );
    expect(screen.getByText("150%")).toBeTruthy();
  });

  it("prints a unit format identically to the hand-written one it replaced", () => {
    render(<SliderRow label="Rot" min={0} max={2} step={0.05} value={1.5} onChange={() => 0} />);
    render(
      <SliderRow
        label="Rot2"
        min={0}
        max={2}
        step={0.05}
        value={1.5}
        onChange={() => 0}
        format={PERCENT}
      />,
    );
    expect(screen.getByRole("button", { name: "150%" })).toBeTruthy();
  });
});

/** Typing exact values — dragging lands next to 0, almost never on it. */
describe("SliderRow numeric entry", () => {
  const row = (over: Partial<Parameters<typeof SliderRow>[0]> = {}) => {
    const onChange = vi.fn();
    const utils = render(
      <SliderRow
        label="Amt"
        min={0}
        max={1}
        step={0.01}
        value={0.37}
        onChange={onChange}
        {...over}
      />,
    );
    return { onChange, ...utils };
  };
  const readout = (text: string) => screen.getByRole("button", { name: text });
  const editor = (name = "Amt") => screen.getByRole("textbox", { name }) as HTMLInputElement;

  it("double-clicking the readout opens an editor seeded with the value, fully selected", async () => {
    const { onChange } = row();
    await userEvent.dblClick(readout("0.37"));
    const input = editor();
    expect(input.value).toBe("0.37");
    expect(input.inputMode).toBe("decimal");
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
    // Opening is not an edit.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Enter commits, and typing 0 lands exactly on 0", async () => {
    const { onChange } = row();
    await userEvent.dblClick(readout("0.37"));
    await userEvent.clear(editor());
    await userEvent.type(editor(), "0{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(Object.is(onChange.mock.calls[0][0], 0)).toBe(true);
    // The editor closes and hands focus back to the readout it came from.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(readout("0.37"));
  });

  it("Escape cancels and restores the previous value", async () => {
    const { onChange } = row();
    await userEvent.dblClick(readout("0.37"));
    await userEvent.clear(editor());
    await userEvent.type(editor(), "0.9{Escape}");
    expect(onChange).not.toHaveBeenCalled();
    expect(readout("0.37")).toBeTruthy();
  });

  it("blur commits what was typed", async () => {
    const { onChange } = row();
    await userEvent.dblClick(readout("0.37"));
    await userEvent.clear(editor());
    await userEvent.type(editor(), "0.42");
    await userEvent.click(document.body);
    expect(onChange).toHaveBeenCalledWith(0.42);
  });

  it("clamps out-of-range input to the slider's own ends", async () => {
    const { onChange } = row();
    await userEvent.dblClick(readout("0.37"));
    await userEvent.clear(editor());
    await userEvent.type(editor(), "5{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(1);
    await userEvent.dblClick(readout("0.37"));
    await userEvent.clear(editor());
    await userEvent.type(editor(), "-4{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("snaps to step, so a typed value is one the thumb could sit on", async () => {
    const { onChange } = row({ min: 0, max: 4, step: 0.25, value: 1 });
    await userEvent.dblClick(readout("1.00"));
    await userEvent.clear(editor());
    await userEvent.type(editor(), "2.3{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(2.25);
  });

  it("accepts a comma decimal (German keyboards emit one)", async () => {
    const { onChange } = row();
    await userEvent.dblClick(readout("0.37"));
    await userEvent.clear(editor());
    await userEvent.type(editor(), "0,25{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(0.25);
  });

  it("reverts on garbage or empty input instead of writing NaN", async () => {
    const { onChange } = row();
    await userEvent.dblClick(readout("0.37"));
    await userEvent.clear(editor());
    await userEvent.type(editor(), "nope{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    expect(readout("0.37")).toBeTruthy();
    await userEvent.dblClick(readout("0.37"));
    await userEvent.clear(editor());
    await userEvent.type(editor(), "{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    expect(readout("0.37")).toBeTruthy();
  });

  it("edits in the unit the readout shows, not the stored one", async () => {
    const { onChange } = row({
      label: "Rot",
      min: 0,
      max: 2,
      step: 0.05,
      value: 1.5,
      format: PERCENT,
    });
    await userEvent.dblClick(readout("150%"));
    expect(editor("Rot").value).toBe("150");
    await userEvent.clear(editor("Rot"));
    await userEvent.type(editor("Rot"), "100{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("opens from the keyboard with Enter and F2 without leaving the tab order", async () => {
    row();
    await userEvent.tab(); // the slider
    expect(document.activeElement).toBe(screen.getByRole("slider"));
    await userEvent.tab(); // the readout, right after it
    expect(document.activeElement).toBe(readout("0.37"));
    await userEvent.keyboard("{Enter}");
    expect(editor()).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{F2}");
    expect(editor()).toBeTruthy();
  });

  it("double-clicking the slider opens on the value from before the click", async () => {
    const onChange = vi.fn();
    const props = { label: "Amt", min: 0, max: 1, step: 0.01, onChange };
    const { rerender } = render(<SliderRow {...props} value={0.2} />);
    const slider = screen.getByRole("slider");
    fireEvent.pointerDown(slider);
    // A real first click has already dragged the thumb to the pointer.
    rerender(<SliderRow {...props} value={0.9} />);
    fireEvent.dblClick(slider);
    expect(onChange).toHaveBeenLastCalledWith(0.2);
    expect(editor().value).toBe("0.2");
  });

  it("ParamRow rows get the same editor", async () => {
    const onChange = vi.fn();
    render(
      <ParamRow
        spec={{ key: "size", label: "Size", min: 0, max: 1, step: 0.01, default: 0.5 }}
        value={0.5}
        onChange={onChange}
        onHint={() => undefined}
      />,
    );
    await userEvent.dblClick(readout("0.50"));
    await userEvent.clear(editor("Size"));
    await userEvent.type(editor("Size"), "0{Enter}");
    expect(Object.is(onChange.mock.calls[0][0], 0)).toBe(true);
  });
});

describe("SelectRow", () => {
  it("renders options and parses the change value", async () => {
    const onChange = vi.fn();
    render(
      <SelectRow
        label="FPS"
        value={30}
        options={[
          { value: 30, label: "30 fps" },
          { value: 60, label: "60 fps" },
        ]}
        onChange={onChange}
        parse={Number}
      />,
    );
    await userEvent.selectOptions(screen.getByRole("combobox"), "60");
    expect(onChange).toHaveBeenCalledWith(60);
  });
});

describe("CollapsibleSection", () => {
  it("uncontrolled: toggles its body and aria-expanded", async () => {
    render(
      <CollapsibleSection title="Motion">
        <div>body-content</div>
      </CollapsibleSection>,
    );
    const btn = screen.getByRole("button", { name: /Motion/ });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByText("body-content")).toBeTruthy();
    await userEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("body-content")).toBeNull();
  });

  it("controlled: renders from the open prop and reports the intended state", async () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <CollapsibleSection title="Sync" open={false} onToggle={onToggle}>
        <div>sync-body</div>
      </CollapsibleSection>,
    );
    expect(screen.queryByText("sync-body")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Sync/ }));
    expect(onToggle).toHaveBeenCalledWith(true);
    // Parent owns the state — body appears only when the prop changes.
    expect(screen.queryByText("sync-body")).toBeNull();
    rerender(
      <CollapsibleSection title="Sync" open onToggle={onToggle}>
        <div>sync-body</div>
      </CollapsibleSection>,
    );
    expect(screen.queryByText("sync-body")).toBeTruthy();
  });
});
