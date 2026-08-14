// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { useVizStore } from "../state/store";
import { useAppShortcuts } from "./useAppShortcuts";
import { DockResizeHandle } from "./DockResizeHandle";
import { commitVisualsWidth, resizeKeyValue } from "../App";

afterEach(cleanup);

describe("commitVisualsWidth (whole-lane review, IMPORTANT on top of E2-U1)", () => {
  it("resets visualsDragW to null before (or unconditionally alongside) committing the new width", () => {
    const calls: string[] = [];
    const setVisualsDragW = (v: number | null) => calls.push(`setVisualsDragW(${v})`);
    const setVisualsW = (v: number) => calls.push(`setVisualsW(${v})`);
    const persist = (v: number) => calls.push(`persist(${v})`);

    commitVisualsWidth(620, setVisualsDragW, setVisualsW, persist);

    // Exact order pinned, not just "was called": a version that resets
    // AFTER persisting would still pass a looser "all three called" check
    // while a render sandwiched between the two calls could still catch
    // the stale value for one frame.
    expect(calls).toEqual(["setVisualsDragW(null)", "setVisualsW(620)", "persist(620)"]);
  });
});

/** Same fake-state idiom as useAppShortcuts.test.tsx: a plain object cast as
 *  the store's getState, so this suite never touches the real store, its
 *  services, or platform mocks — only the Escape cascade's own setters are
 *  observable, which is exactly what E2-U1 is about. */
function escState() {
  return {
    exporting: null,
    batchStatus: "idle",
    stageMode: false,
    setShowHelp: vi.fn(),
    setShowGuide: vi.fn(),
    setShowSettings: vi.fn(),
    setShowExport: vi.fn(),
    setShowBatch: vi.fn(),
    setStageMode: vi.fn(),
    setShowPanel: vi.fn(),
    setShowLibrary: vi.fn(),
    setShowGallery: vi.fn(),
    setShowTimeline: vi.fn(),
  };
}

/** Mounts useAppShortcuts (App.tsx's real global Escape cascade) alongside a
 *  REAL DockResizeHandle wired exactly like App.tsx's Library handle — the
 *  harness idiom ParamsPanel.test.tsx uses for its own "Escape during a drag
 *  does not also close the Visuals panel (I1)" test, adapted for E2-U1:
 *  before this fix, App.tsx's two resize handles had no capture-phase
 *  listener at all, so nothing stopped the cascade from reaching them. */
function LibraryHarness({
  state,
  onCommit,
}: {
  state: Record<string, unknown>;
  onCommit: (v: number) => void;
}) {
  useAppShortcuts((() => state) as unknown as typeof useVizStore.getState);
  const [panelW, setPanelW] = useState(300);
  return (
    <DockResizeHandle
      className="panel-resize-handle library-resize-handle chrome"
      ariaLabel="Resize the library"
      title="Drag to resize the library"
      value={panelW}
      ariaValueNow={panelW}
      min={240}
      max={440}
      compute={(ev) => Math.min(440, Math.max(240, ev.clientX - 14))}
      onDrag={setPanelW}
      onCommit={onCommit}
      onCancel={setPanelW}
      onKeyDown={() => undefined}
    />
  );
}

function stubCapture(el: Element) {
  // jsdom has neither method (same gap ParamsPanel.test.tsx's drag tests
  // stub) — end()'s unconditional releasePointerCapture call needs this
  // too, or the drag throws the moment it actually ends.
  (el as HTMLDivElement).setPointerCapture = () => undefined;
  (el as HTMLDivElement).releasePointerCapture = () => undefined;
}

describe("DockResizeHandle — Escape mid-drag (E2-U1)", () => {
  it("cancels the resize without closing the panel: width reverts, nothing persists", () => {
    const state = escState();
    const onCommit = vi.fn();
    render(<LibraryHarness state={state} onCommit={onCommit} />);
    const handle = screen.getByRole("separator", { name: /Resize the library/i });
    stubCapture(handle);

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 314 }); // starts at 300
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 414 }); // -> 400
    expect(handle.getAttribute("aria-valuenow")).toBe("400"); // applied live, mid-drag

    // Same target-vs-window distinction as ParamsPanel.test.tsx's I1 test:
    // dispatching straight at `window` fires capture- and bubble-phase
    // listeners in plain registration order instead of capture-before-
    // bubble, so it could never catch a regression back to a bubble-only
    // handler. document.body is a real descendant, so window sees the
    // CAPTURING pass first.
    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(state.setShowLibrary).not.toHaveBeenCalled(); // panel survives
    expect(handle.getAttribute("aria-valuenow")).toBe("300"); // width reverted
    expect(onCommit).not.toHaveBeenCalled(); // pref never persisted

    // The user's physical mouse-up still lands after Escape — it must not
    // ALSO commit (end()'s cleanup already tore the listeners down).
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 414 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(handle.getAttribute("aria-valuenow")).toBe("300");
  });

  it("control: a normal release still commits the dragged width", () => {
    const state = escState();
    const onCommit = vi.fn();
    render(<LibraryHarness state={state} onCommit={onCommit} />);
    const handle = screen.getByRole("separator", { name: /Resize the library/i });
    stubCapture(handle);

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 314 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 414 }); // -> 400
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 414 });

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(400);
    expect(handle.getAttribute("aria-valuenow")).toBe("400");
    expect(state.setShowLibrary).not.toHaveBeenCalled();
  });

  it("a click with no movement commits nothing (matches the pre-fix latest>0 guard)", () => {
    const state = escState();
    const onCommit = vi.fn();
    render(<LibraryHarness state={state} onCommit={onCommit} />);
    const handle = screen.getByRole("separator", { name: /Resize the library/i });
    stubCapture(handle);

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 314 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 314 }); // no pointermove at all

    expect(onCommit).not.toHaveBeenCalled();
    expect(handle.getAttribute("aria-valuenow")).toBe("300");
  });

  it("Visuals' onCancel ignores the captured start value and always reverts to null", () => {
    // Visuals splits committed (visualsW) from drag-ephemeral (visualsDragW)
    // state — App.tsx's own comment explains why (avoids a render-target-
    // recreation storm on every pointermove). Its onCancel therefore
    // ignores the argument DockResizeHandle hands back and always clears to
    // null, unlike Library's onCancel=setPanelW — this pins that App.tsx
    // actually wires the two differently, not just that DockResizeHandle
    // works in isolation.
    function VisualsHarness({ state }: { state: Record<string, unknown> }) {
      useAppShortcuts((() => state) as unknown as typeof useVizStore.getState);
      const visualsW = 500; // committed value: never changes mid-drag
      const [visualsDragW, setVisualsDragW] = useState<number | null>(null);
      return (
        <DockResizeHandle
          className="panel-resize-handle chrome"
          ariaLabel="Resize Visuals"
          title="Drag to resize Visuals"
          value={visualsW}
          ariaValueNow={visualsDragW ?? visualsW}
          min={380}
          max={760}
          compute={(ev) => Math.min(760, Math.max(380, 1000 - ev.clientX))}
          onDrag={setVisualsDragW}
          onCommit={() => undefined}
          onCancel={() => setVisualsDragW(null)}
          onKeyDown={() => undefined}
        />
      );
    }
    const state = escState();
    render(<VisualsHarness state={state} />);
    const handle = screen.getByRole("separator", { name: /Resize Visuals/i });
    stubCapture(handle);

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 }); // 1000-400 -> 600
    expect(handle.getAttribute("aria-valuenow")).toBe("600");

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(state.setShowPanel).not.toHaveBeenCalled(); // panel survives
    expect(handle.getAttribute("aria-valuenow")).toBe("500"); // back to committed visualsW
  });

  it("IMPORTANT (whole-lane review) — a drag-commit followed by a keyboard resize keeps the box and aria-valuenow in sync", () => {
    // Uses the REAL commitVisualsWidth (App.tsx) as the handle's onCommit —
    // not a hand-written copy of its logic — so a regression in the actual
    // fix (dropping the setVisualsDragW(null) reset) turns this test red,
    // the same way it would if this harness rendered <App/> directly.
    // Visuals splits committed (visualsW) from drag-ephemeral (visualsDragW)
    // state; onCommit must reset the latter back to null, or a keyboard
    // resize right after a pointer-drag commit — visualsResizeKey only
    // ever touches visualsW, never visualsDragW — leaves --visuals-w-drag
    // and aria-valuenow both stuck reading the STALE dragged pixel value.
    function VisualsCommitHarness() {
      const [visualsW, setVisualsW] = useState(500);
      const [visualsDragW, setVisualsDragW] = useState<number | null>(null);
      return (
        <DockResizeHandle
          className="panel-resize-handle chrome"
          ariaLabel="Resize Visuals"
          title="Drag to resize Visuals"
          value={visualsW}
          ariaValueNow={visualsDragW ?? visualsW}
          min={380}
          max={760}
          compute={(ev) => Math.min(760, Math.max(380, 1000 - ev.clientX))}
          onDrag={setVisualsDragW}
          onCommit={(v) => commitVisualsWidth(v, setVisualsDragW, setVisualsW, () => undefined)}
          onCancel={() => setVisualsDragW(null)}
          // The real visualsResizeKey (App.tsx) commits straight to
          // visualsW/setPrefs on every keypress — no drag state, and no
          // reason to touch visualsDragW either. resizeKeyValue is the
          // exact function it calls; sign=-1 matches App.tsx's own Visuals
          // wiring (moving the separator right NARROWS the right-hand dock).
          onKeyDown={(e) => {
            const next = resizeKeyValue(e, visualsW, 380, 760, -1);
            if (next === null || next === visualsW) return;
            setVisualsW(next);
          }}
        />
      );
    }
    render(<VisualsCommitHarness />);
    const handle = screen.getByRole("separator", { name: /Resize Visuals/i });
    stubCapture(handle);

    // Drag-commit: 1000 - 400 = 600.
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 400 });
    expect(handle.getAttribute("aria-valuenow")).toBe("600");

    // A keyboard resize right afterward: sign=-1, so ArrowRight subtracts
    // the 16px step -> 584. Box + aria must track the NEW value, not the
    // drag-committed one the bug would leave visualsDragW pinned at.
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle.getAttribute("aria-valuenow")).toBe("584");
  });

  it("a pointercancel (drop outside / OS interruption) still commits — Escape is the only reverter (audit U7)", () => {
    const state = escState();
    const onCommit = vi.fn();
    render(<LibraryHarness state={state} onCommit={onCommit} />);
    const handle = screen.getByRole("separator", { name: /Resize the library/i });
    stubCapture(handle);

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 314 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 414 }); // -> 400
    fireEvent.pointerCancel(handle, { pointerId: 1 });

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(400);
    expect(handle.getAttribute("aria-valuenow")).toBe("400");
  });
});
