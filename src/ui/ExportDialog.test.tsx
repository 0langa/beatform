// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CodecSupport } from "../export/codecProbe";
import {
  REASON_CANVAS_H264,
  REASON_CANVAS_MP4,
  REASON_CODEC_PROBING,
  REASON_DESKTOP_FFMPEG,
  REASON_DESKTOP_FOLDER,
  codecUnavailableReason,
} from "../state/exportConfig";

/**
 * P-8 — the export dialog is the codec-capability map of the machine.
 *
 * Before this, a format the machine or the mode could not produce simply did
 * not render: the four sidecar formats were `isTauri()`-gated out of the
 * markup and the whole Codec row disappeared unless the probe found two or
 * more codecs. What this file pins is the replacement contract:
 *
 *  1. every format and every codec is always on screen;
 *  2. an unavailable one is derived from the REAL condition — flip the
 *     condition, watch exactly that tile move — and prints the reason;
 *  3. it refuses input but stays a tab stop, because the reason is the
 *     payload and `disabled` would remove the only control carrying it.
 *
 * Mocks: `services` (the store's accessors throw outside the browser) and
 * `platform` (isTauri is one of the two conditions under test, and autosave
 * must not touch the filesystem). The STORE is deliberately real — no test in
 * this repo mocks it, and the availability rules read from it.
 */

const h = vi.hoisted(() => ({ tauri: true }));

vi.mock("../state/services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => ({ audioBuffer: null, state: {} })),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn() })),
  peekAnalyzer: vi.fn(() => null),
  getLiveStemValues: vi.fn(() => undefined),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

vi.mock("../state/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/platform")>();
  return {
    ...actual,
    isTauri: () => h.tauri,
    writeAutosave: vi.fn(async () => {}),
    askConfirm: vi.fn(async () => true),
    showInFolder: vi.fn(async () => {}),
  };
});

const { ExportDialog } = await import("./ExportDialog");
const { useVizStore } = await import("../state/store");
const { showInFolder } = await import("../state/platform");

/** Restoring by MERGE keeps the action identities the click sites call. */
const PRISTINE = { ...useVizStore.getState() };

const ALL_CODECS: CodecSupport = { h264: true, hevc: true, av1: true, vp9a: true };

/** jest-dom is not wired up in this repo — read the property. */
function isDisabled(el: Element | null | undefined): boolean {
  return !!(el as HTMLButtonElement | null)?.disabled;
}

function group(label: "Format" | "Codec"): HTMLElement {
  return screen.getByRole("group", { name: label });
}

function tile(label: "Format" | "Codec", name: RegExp): HTMLElement {
  return within(group(label)).getByRole("button", { name });
}

/** `{ tile name: reason text or null }` for a whole group. */
function tileReasons(label: "Format" | "Codec"): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const b of within(group(label)).getAllByRole("button")) {
    const name = b.querySelector(".capability-name")!.textContent!;
    out[name] = b.querySelector(".capability-reason")?.textContent ?? null;
  }
  return out;
}

function mount(state: Partial<ReturnType<typeof useVizStore.getState>> = {}) {
  act(() => useVizStore.setState({ codecSupport: ALL_CODECS, ...state }));
  return render(<ExportDialog />);
}

/** Patch just the export settings (they are one nested object). */
function withSettings(over: Partial<ReturnType<typeof useVizStore.getState>["exportSettings"]>) {
  return { exportSettings: { ...PRISTINE.exportSettings, ...over } };
}

beforeEach(() => {
  h.tauri = true;
  vi.mocked(showInFolder).mockClear();
});

afterEach(() => {
  cleanup();
  useVizStore.setState(PRISTINE);
  localStorage.clear();
});

describe("every format is on screen, always", () => {
  it("shows all six formats on the desktop, none of them blocked", () => {
    mount();
    expect(tileReasons("Format")).toEqual({
      MP4: null,
      "PNG frames": null,
      ProRes: null,
      "AV1 10-bit": null,
      GIF: null,
      WebP: null,
    });
  });

  it("still shows the four sidecar formats in a browser session, with the reason", () => {
    // Pre-P-8 these were absent from the DOM entirely, and PNG rendered as a
    // live option that failed after the user had already picked a folder.
    h.tauri = false;
    mount();
    expect(tileReasons("Format")).toEqual({
      MP4: null,
      "PNG frames": REASON_DESKTOP_FOLDER,
      ProRes: REASON_DESKTOP_FFMPEG,
      "AV1 10-bit": REASON_DESKTOP_FFMPEG,
      GIF: REASON_DESKTOP_FFMPEG,
      WebP: REASON_DESKTOP_FFMPEG,
    });
  });

  it("blocks exactly the three formats a canvas loop cannot produce", () => {
    mount(withSettings({ mode: "canvas" }));
    expect(tileReasons("Format")).toEqual({
      MP4: null,
      "PNG frames": REASON_CANVAS_MP4,
      ProRes: REASON_CANVAS_MP4,
      "AV1 10-bit": REASON_CANVAS_MP4,
      GIF: null,
      WebP: null,
    });
  });
});

describe("an unavailable tile refuses input but stays reachable", () => {
  it("is aria-disabled, NOT disabled — so Tab still reaches the reason", async () => {
    h.tauri = false;
    mount();
    const prores = tile("Format", /ProRes/);
    expect(prores.getAttribute("aria-disabled")).toBe("true");
    // The load-bearing half: a real `disabled` attribute would drop the only
    // element carrying the explanation out of the tab order (and out of the
    // dialog's own focus trap, whose selector is `button:not([disabled])`).
    expect(isDisabled(prores)).toBe(false);
    prores.focus();
    expect(document.activeElement).toBe(prores);
    // Three routes to the same sentence: on screen, in the tooltip, and in
    // the accessible name a screen reader reads off the button.
    expect(prores.textContent).toContain(REASON_DESKTOP_FFMPEG);
    expect(prores.getAttribute("title")).toBe(REASON_DESKTOP_FFMPEG);
    // All four ffmpeg lanes carry it in their accessible name, not just in a
    // tooltip a screen reader may never surface.
    expect(
      within(group("Format")).getAllByRole("button", { name: /it runs the bundled ffmpeg/ }),
    ).toHaveLength(4);
  });

  it("does not change the format when clicked, by pointer or by keyboard", async () => {
    h.tauri = false;
    mount();
    await userEvent.click(tile("Format", /ProRes/));
    expect(useVizStore.getState().exportSettings.format).toBe("mp4");
    tile("Format", /ProRes/).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(useVizStore.getState().exportSettings.format).toBe("mp4");
  });

  it("an available tile still selects normally", async () => {
    mount();
    await userEvent.click(tile("Format", /^ProRes — One \.mov file/));
    expect(useVizStore.getState().exportSettings.format).toBe("prores");
  });

  it("names every tile explicitly — unique, and prefixed with the visible label", () => {
    // Found by reading the live accessibility tree, not by reasoning: with
    // only content + `title` to work from, the tree named all four ffmpeg
    // tiles "Needs the desktop app — it runs the bundled ffmpeg" (four
    // buttons, one name) and called the transparent-WebM codec "transparent
    // WebM overlay". An explicit aria-label outranks both name sources.
    h.tauri = false;
    mount();
    const tiles = [
      ...within(group("Format")).getAllByRole("button"),
      ...within(group("Codec")).getAllByRole("button"),
    ];
    const names = tiles.map((t) => t.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(tiles.length);
    for (const t of tiles) {
      const visible = t.querySelector(".capability-name")!.textContent!;
      // WCAG 2.5.3: the accessible name must START with what the eye reads,
      // so "click ProRes" by voice still hits the tile it names.
      expect(t.getAttribute("aria-label")!.startsWith(`${visible} — `)).toBe(true);
      // …and it must carry the reason, not just the tooltip.
      expect(t.getAttribute("aria-label")).toContain(t.getAttribute("title"));
    }
    expect(tile("Codec", /^VP9 \+ alpha — /).getAttribute("aria-label")).toBe(
      "VP9 + alpha — transparent WebM overlay",
    );
  });

  it("freezes every tile with a real `disabled` while an export runs", () => {
    // A different kind of "off": the whole form is inert and the progress bar
    // beside it says why, so there is nothing per-tile left to read.
    mount({ exporting: { done: 3, total: 10, speed: 12 } });
    for (const b of within(group("Format")).getAllByRole("button")) {
      expect(isDisabled(b)).toBe(true);
    }
  });
});

describe("the codec row is the machine's capability map", () => {
  it("shows all four codecs on a machine that supports only H.264", () => {
    // Pre-P-8 this row vanished below two supported codecs — on exactly the
    // machine whose user needs to know why transparent WebM is not offered.
    mount({ codecSupport: { h264: true, hevc: false, av1: false, vp9a: false } });
    expect(tileReasons("Codec")).toEqual({
      "H.264": null,
      HEVC: codecUnavailableReason("hevc"),
      AV1: codecUnavailableReason("av1"),
      "VP9 + alpha": codecUnavailableReason("vp9a"),
    });
  });

  it("tracks the probe rather than a hardcoded list — flip a flag, one tile moves", () => {
    mount({ codecSupport: { ...ALL_CODECS, vp9a: false } });
    expect(tileReasons("Codec")["VP9 + alpha"]).toBe(codecUnavailableReason("vp9a"));
    expect(tileReasons("Codec")["HEVC"]).toBeNull();
    act(() => useVizStore.setState({ codecSupport: { ...ALL_CODECS, hevc: false } }));
    expect(tileReasons("Codec")["VP9 + alpha"]).toBeNull();
    expect(tileReasons("Codec")["HEVC"]).toBe(codecUnavailableReason("hevc"));
  });

  it("says it is still probing instead of guessing", () => {
    mount({ codecSupport: null });
    expect(tileReasons("Codec")).toEqual({
      "H.264": REASON_CODEC_PROBING,
      HEVC: REASON_CODEC_PROBING,
      AV1: REASON_CODEC_PROBING,
      "VP9 + alpha": REASON_CODEC_PROBING,
    });
  });

  it("shows the H.264 a canvas loop actually uses, not the stored codec", async () => {
    // runExport pins canvas loops to H.264. The row used to be hidden here,
    // so a stored `hevc` sat in the settings while the export encoded H.264.
    mount(withSettings({ mode: "canvas", codec: "hevc" }));
    // Anchored: the three blocked tiles carry "…encode H.264…" in their names.
    expect(tile("Codec", /^H\.264 — plays everywhere$/).getAttribute("aria-pressed")).toBe("true");
    expect(tileReasons("Codec")).toEqual({
      "H.264": null,
      HEVC: REASON_CANVAS_H264,
      AV1: REASON_CANVAS_H264,
      "VP9 + alpha": REASON_CANVAS_H264,
    });
    // …and showing it must not quietly rewrite the codec the user picked for
    // their Video exports: re-selecting the displayed value is a no-op.
    await userEvent.click(tile("Codec", /^H\.264 — plays everywhere$/));
    expect(useVizStore.getState().exportSettings.codec).toBe("hevc");
  });

  it("hides the codec row for formats that have no codec choice", () => {
    mount(withSettings({ format: "prores" }));
    expect(screen.queryByRole("group", { name: "Codec" })).toBeNull();
  });
});

describe("alpha promises match the background", () => {
  it("warns when an alpha-capable format sits over an opaque background", () => {
    mount(withSettings({ format: "prores" }));
    expect(screen.getByText(/the alpha exports solid/)).toBeTruthy();
  });

  it("says nothing about alpha once the background is Transparent", () => {
    // BG_TRANSPARENT === 2 (render/types.ts).
    mount({ ...withSettings({ format: "prores" }), bg: { ...PRISTINE.bg, mode: 2 } });
    expect(screen.queryByText(/the alpha exports solid/)).toBeNull();
  });
});

describe("Show in folder", () => {
  function showInFolderButton(): HTMLElement | null {
    return screen.queryByRole("button", { name: "Show in folder" });
  }

  it("does not render without a path, even when the export succeeded", () => {
    mount({ exportDone: "MP4 saved", exportDonePath: null });
    expect(showInFolderButton()).toBeNull();
  });

  it("does not render outside the desktop app, even with a path", () => {
    h.tauri = false;
    mount({ exportDone: "MP4 saved to C:\\out\\video.mp4", exportDonePath: "C:\\out\\video.mp4" });
    expect(showInFolderButton()).toBeNull();
  });

  it("renders with a path on desktop, and invokes the wrapper with exactly that path", async () => {
    mount({ exportDone: "MP4 saved to C:\\out\\video.mp4", exportDonePath: "C:\\out\\video.mp4" });

    const button = showInFolderButton();
    expect(button).not.toBeNull();
    await userEvent.click(button!);

    expect(showInFolder).toHaveBeenCalledTimes(1);
    expect(showInFolder).toHaveBeenCalledWith("C:\\out\\video.mp4");
  });

  it("never swallows a failed reveal — logs it and surfaces it in the store's error slot", async () => {
    // The click handler doesn't await showInFolder — it fires-and-catches —
    // so this is the one test that pins the .catch() actually exists rather
    // than the invoke call alone. Delete the .catch() and the rejection goes
    // unhandled: console.error never fires, `error` never leaves null, and
    // the waitFor below times out instead of passing.
    const boom = new Error("boom");
    vi.mocked(showInFolder).mockRejectedValueOnce(boom);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mount({ exportDone: "MP4 saved to C:\\out\\video.mp4", exportDonePath: "C:\\out\\video.mp4" });

    const button = showInFolderButton();
    expect(button).not.toBeNull();
    await userEvent.click(button!);

    await waitFor(() => expect(useVizStore.getState().error).toBe("boom"));
    expect(errorSpy).toHaveBeenCalledWith("[export]", boom);

    errorSpy.mockRestore();
  });
});
