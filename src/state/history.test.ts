import { beforeEach, describe, expect, it } from "vitest";
import { clearHistory, historyDepths, popRedo, popUndo, pushHistory } from "./history";
import type { ProjectDocument } from "./project";
import { presets } from "../render/presets";

function doc(marker: number): ProjectDocument {
  return {
    presetId: presets[0].id,
    paramsByPreset: { [presets[0].id]: { marker } },
    syncByPreset: {},
    bg: { mode: 0, color: [0, 0, 0] },
    overlayLayers: [],
    assets: {},
    aspect: "free",
    modsByPreset: {},
    smoothSpectrum: false,
    timeline: { enabled: false, scenes: [], lanes: [] },
  };
}

const markerOf = (d: ProjectDocument | null) => (d ? d.paramsByPreset[presets[0].id].marker : null);

describe("history", () => {
  beforeEach(() => clearHistory());

  it("undo returns the pre-mutation snapshot; redo returns forward", () => {
    pushHistory(doc(1), "a", 0); // state was 1, then mutated to 2
    const back = popUndo(doc(2));
    expect(markerOf(back)).toBe(1);
    const fwd = popRedo(doc(1));
    expect(markerOf(fwd)).toBe(2);
  });

  it("groups same-key pushes inside the gesture window", () => {
    pushHistory(doc(1), "param:hue", 0);
    pushHistory(doc(2), "param:hue", 300); // same drag — skipped
    pushHistory(doc(3), "param:hue", 600); // still inside extended window
    expect(historyDepths().undo).toBe(1);
    expect(markerOf(popUndo(doc(4)))).toBe(1); // jumps to before the drag
  });

  it("different keys break grouping", () => {
    pushHistory(doc(1), "param:hue", 0);
    pushHistory(doc(2), "param:glow", 100);
    expect(historyDepths().undo).toBe(2);
  });

  it("same key after the window is a new entry", () => {
    pushHistory(doc(1), "param:hue", 0);
    pushHistory(doc(2), "param:hue", 2000);
    expect(historyDepths().undo).toBe(2);
  });

  it("new edits clear the redo stack", () => {
    pushHistory(doc(1), "a", 0);
    popUndo(doc(2));
    expect(historyDepths().redo).toBe(1);
    pushHistory(doc(3), "b", 5000);
    expect(historyDepths().redo).toBe(0);
  });

  it("caps the undo depth at 100", () => {
    for (let i = 0; i < 150; i++) pushHistory(doc(i), `k${i}`, i * 10_000);
    expect(historyDepths().undo).toBe(100);
  });

  it("snapshots are isolated from later mutation", () => {
    const d = doc(1);
    pushHistory(d, "a", 0);
    d.paramsByPreset[presets[0].id].marker = 999;
    expect(markerOf(popUndo(doc(2)))).toBe(1);
  });

  it("undo on empty history is a no-op", () => {
    expect(popUndo(doc(1))).toBeNull();
    expect(historyDepths().redo).toBe(0);
  });
});
