// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PresetDef } from "../render/types";
import { PresetOrderEditor } from "./PresetOrderEditor";

/**
 * The reorder list in App settings — both ways to move a row.
 *
 * The drag case fires the sequence in ONE turn, with no re-render between
 * dragstart and drop. That is deliberate: it is the shape that caught the
 * first version, which read the drag source out of React state and so dropped
 * a row onto `null` and did nothing whenever the render had not landed yet.
 */

const DEFS: PresetDef[] = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
  { id: "c", name: "Gamma" },
] as PresetDef[];
const BY_ID = new Map(DEFS.map((d) => [d.id, d]));

afterEach(cleanup);

/** No jest-dom in this repo — read the property off the real element. */
const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled;

function setup(order: string[], isDefault = false) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  render(
    <PresetOrderEditor
      order={order}
      byId={BY_ID}
      thumbs={null}
      isDefault={isDefault}
      onChange={onChange}
      onReset={onReset}
    />,
  );
  return { onChange, onReset };
}

describe("PresetOrderEditor", () => {
  it("moves a mode later and hands back the whole new order", async () => {
    const { onChange } = setup(["a", "b", "c"]);
    await userEvent.click(screen.getByRole("button", { name: "Move Alpha later" }));
    expect(onChange).toHaveBeenCalledWith(["b", "a", "c"]);
  });

  it("moves a mode earlier", async () => {
    const { onChange } = setup(["a", "b", "c"]);
    await userEvent.click(screen.getByRole("button", { name: "Move Gamma earlier" }));
    expect(onChange).toHaveBeenCalledWith(["a", "c", "b"]);
  });

  it("disables the moves that would fall off either end", () => {
    setup(["a", "b", "c"]);
    expect(isDisabled(screen.getByRole("button", { name: "Move Alpha earlier" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "Move Gamma later" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "Move Beta earlier" }))).toBe(false);
  });

  it("offers Restore default order only when it would change something", async () => {
    const { onReset } = setup(["b", "a", "c"]);
    const btn = screen.getByRole("button", { name: /restore default order/i });
    expect(isDisabled(btn)).toBe(false);
    await userEvent.click(btn);
    expect(onReset).toHaveBeenCalledTimes(1);

    cleanup();
    setup(["a", "b", "c"], true);
    expect(isDisabled(screen.getByRole("button", { name: /restore default order/i }))).toBe(true);
  });

  it("drops a dragged row onto another one, with no re-render in between", () => {
    const { onChange } = setup(["a", "b", "c"]);
    const rows = screen.getAllByRole("listitem");
    // jsdom has no DataTransfer; the handlers only set effectAllowed /
    // dropEffect / setData on it, so a stub with those three is enough.
    const dataTransfer = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
    const drag = (type: string) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "dataTransfer", { value: dataTransfer });
      return e;
    };
    // ONE act() for the whole gesture. fireEvent flushes between calls, which
    // hands the drop a freshly rendered closure and hides the exact bug this
    // case exists for.
    act(() => {
      rows[2].dispatchEvent(drag("dragstart"));
      rows[0].dispatchEvent(drag("dragover"));
      rows[0].dispatchEvent(drag("drop"));
    });
    expect(onChange).toHaveBeenCalledWith(["c", "a", "b"]);
  });

  it("skips an id with no def instead of rendering an empty row", () => {
    setup(["a", "ghost", "c"]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Gamma")).toBeTruthy();
  });
});
