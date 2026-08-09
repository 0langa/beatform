import { describe, expect, it, vi } from "vitest";
import type { CodecSupport, VideoCodecId } from "../export/codecProbe";
import {
  CODEC_ORDER,
  codecUnavailableReason,
  exportCodecOptions,
  exportFormatOptions,
  REASON_CANVAS_H264,
  REASON_CANVAS_MP4,
  REASON_CODEC_PROBING,
  REASON_DESKTOP_FFMPEG,
  REASON_DESKTOP_FOLDER,
  SIMPLIFIED_EXPORT_REASON,
  type ExportCapabilities,
  type ExportFormatId,
  type ExportOption,
} from "./exportConfig";

/**
 * P-8 — the export dialog's capability map.
 *
 * The property under test is not "these six tiles render". It is that each
 * tile's availability is DERIVED from the condition the export action really
 * enforces, so the dialog cannot claim a format works when `runExport` would
 * refuse it (or hide one that works fine). Every case below therefore flips
 * exactly one input and asserts that exactly the affected entries move.
 *
 * The conditions, and where they are enforced:
 *  - desktop-only sidecar formats — slices/exportActions.ts `runExport`, the
 *    `else if (pngMode || proresMode || av1Mode || animFormat)` refusal.
 *  - canvas coercion of png/prores/av1-10 — `setExportSettings`.
 *  - canvas pins H.264 — `runExport`'s `codec: canvasMode ? "h264" : ...`.
 *  - codec support — export/codecProbe.ts `probeCodecs`, stored on the store
 *    as `codecSupport` (null until the probe resolves).
 */

const ALL_FORMATS: ExportFormatId[] = ["mp4", "png", "prores", "av1-10", "gif", "webp"];

function caps(over: Partial<ExportCapabilities> = {}): ExportCapabilities {
  return { canvasMode: false, desktop: true, codecSupport: allCodecs(true), ...over };
}

function allCodecs(on: boolean): CodecSupport {
  return { h264: on, hevc: on, av1: on, vp9a: on };
}

/** `{ id: reason }` — the whole map in one comparable value. */
function reasons<T extends string>(options: ExportOption<T>[]): Record<string, string | null> {
  return Object.fromEntries(options.map((o) => [o.id, o.reason]));
}

describe("exportFormatOptions — every format, always, with the honest reason", () => {
  it("lists all six formats in every environment (the point of the map)", () => {
    for (const c of [
      caps(),
      caps({ desktop: false }),
      caps({ canvasMode: true }),
      caps({ desktop: false, canvasMode: true }),
    ]) {
      expect(exportFormatOptions(c).map((o) => o.id)).toEqual(ALL_FORMATS);
    }
  });

  it("desktop + video mode: nothing is blocked", () => {
    expect(reasons(exportFormatOptions(caps()))).toEqual({
      mp4: null,
      png: null,
      prores: null,
      "av1-10": null,
      gif: null,
      webp: null,
    });
  });

  it("browser: MP4 survives, the folder writer and the four ffmpeg lanes do not", () => {
    expect(reasons(exportFormatOptions(caps({ desktop: false })))).toEqual({
      mp4: null,
      png: REASON_DESKTOP_FOLDER,
      prores: REASON_DESKTOP_FFMPEG,
      "av1-10": REASON_DESKTOP_FFMPEG,
      gif: REASON_DESKTOP_FFMPEG,
      webp: REASON_DESKTOP_FFMPEG,
    });
  });

  it("canvas mode blocks exactly the three formats setExportSettings coerces away", () => {
    // GIF and WebP are deliberately NOT blocked: a seamless 3-8 s loop is what
    // an animated file is for, and runExport allows them in canvas mode.
    expect(reasons(exportFormatOptions(caps({ canvasMode: true })))).toEqual({
      mp4: null,
      png: REASON_CANVAS_MP4,
      prores: REASON_CANVAS_MP4,
      "av1-10": REASON_CANVAS_MP4,
      gif: null,
      webp: null,
    });
  });

  it("when both apply, names the absolute constraint, not the flippable one", () => {
    // Switching Type back to Video does not make a PNG folder appear in a
    // browser session — saying "switch Type to Video" there would be a lie.
    const r = reasons(exportFormatOptions(caps({ desktop: false, canvasMode: true })));
    expect(r.png).toBe(REASON_DESKTOP_FOLDER);
    expect(r.prores).toBe(REASON_DESKTOP_FFMPEG);
    expect(r["av1-10"]).toBe(REASON_DESKTOP_FFMPEG);
  });

  it("every tile carries a name and a what-you-get hint", () => {
    for (const o of exportFormatOptions(caps())) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("exportCodecOptions — the machine's codec map", () => {
  it("lists all four codecs even when the machine supports one", () => {
    const only264 = exportCodecOptions(
      caps({ codecSupport: { h264: true, hevc: false, av1: false, vp9a: false } }),
    );
    expect(only264.map((o) => o.id)).toEqual([...CODEC_ORDER]);
    // The pre-P-8 dialog hid the whole row here, which is exactly how VP9 +
    // alpha — a README headline — became undiscoverable.
    expect(only264.find((o) => o.id === "vp9a")?.reason).toBe(codecUnavailableReason("vp9a"));
  });

  it("marks exactly the unsupported codecs — one flag flipped, one tile moves", () => {
    const off = allCodecs(true);
    expect(reasons(exportCodecOptions(caps({ codecSupport: off })))).toEqual({
      h264: null,
      hevc: null,
      av1: null,
      vp9a: null,
    });
    for (const id of CODEC_ORDER) {
      const support: CodecSupport = { ...allCodecs(true), [id]: false };
      const r = reasons(exportCodecOptions(caps({ codecSupport: support })));
      expect(r[id]).toBe(codecUnavailableReason(id));
      for (const other of CODEC_ORDER) {
        if (other !== id) expect(r[other]).toBeNull();
      }
    }
  });

  it("says it is still probing rather than guessing 'unsupported'", () => {
    // codecSupport is null until probeCodecs() resolves (store init + the
    // probe kicked off by setShowExport). Reporting "not available on this
    // machine" there would be a fabricated capability claim.
    const r = reasons(exportCodecOptions(caps({ codecSupport: null })));
    for (const id of CODEC_ORDER) expect(r[id]).toBe(REASON_CODEC_PROBING);
  });

  it("canvas mode blocks every codec but H.264, whatever the probe said", () => {
    const r = reasons(
      exportCodecOptions(caps({ canvasMode: true, codecSupport: allCodecs(true) })),
    );
    expect(r).toEqual({
      h264: null,
      hevc: REASON_CANVAS_H264,
      av1: REASON_CANVAS_H264,
      vp9a: REASON_CANVAS_H264,
    });
  });

  it("canvas mode still defers to the probe for H.264 itself", () => {
    const r = reasons(
      exportCodecOptions(
        caps({ canvasMode: true, codecSupport: { ...allCodecs(true), h264: false } }),
      ),
    );
    expect(r.h264).toBe(codecUnavailableReason("h264"));
  });

  it("reasons name the codec but never claim to know about hardware", () => {
    // VideoEncoder.isConfigSupported cannot tell a hardware encoder from a
    // software one, so "hardware HEVC not found" would be invented detail.
    for (const id of CODEC_ORDER) {
      expect(codecUnavailableReason(id)).not.toMatch(/hardware/i);
      expect(codecUnavailableReason(id)).toMatch(/not available on this machine/);
    }
    expect(codecUnavailableReason("hevc")).toBe("HEVC encoding is not available on this machine");
  });

  it("splits CODEC_LABELS into a tile name and a hint, both non-empty", () => {
    const byId = new Map(exportCodecOptions(caps()).map((o) => [o.id, o]));
    for (const id of CODEC_ORDER) {
      expect(byId.get(id)!.label.length).toBeGreaterThan(0);
      expect(byId.get(id)!.hint.length).toBeGreaterThan(0);
      // The name must not swallow the descriptor — a tile reading
      // "H.264 — plays everywhere" in a 148px column truncates to nothing.
      expect(byId.get(id)!.label).not.toContain("—");
    }
    expect(byId.get("vp9a")!.label).toBe("VP9 + alpha");
  });
});

describe("the map's ids are the PERSISTED enum, not a parallel list", () => {
  it("every format tile id round-trips through loadStoredExportSettings", async () => {
    // `viz.exportSettings.v1` is a contract: a renamed format id would be
    // rejected by the loader and silently reset the user's choice. FORMAT_META
    // is keyed by ExportSettings["format"] so a rename is a compile error —
    // this is the runtime half of that guarantee.
    const map = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    });
    const { loadStoredExportSettings } = await import("./persistence");
    for (const o of exportFormatOptions(caps())) {
      map.set("viz.exportSettings.v1", JSON.stringify({ format: o.id }));
      expect(loadStoredExportSettings().format).toBe(o.id);
    }
    for (const id of CODEC_ORDER) {
      map.set("viz.exportSettings.v1", JSON.stringify({ codec: id satisfies VideoCodecId }));
      expect(loadStoredExportSettings().codec).toBe(id);
    }
    vi.unstubAllGlobals();
  });
});

/**
 * G7: the export-refusal sentence has ONE literal.
 *
 * It used to have two. `App.tsx` derived its own `exportBlocked` string for
 * the top bar's Export and Batch buttons while the dialog those buttons open,
 * the store guards and the error toast used `SIMPLIFIED_EXPORT_REASON` — and
 * the two had already drifted apart by the time anyone looked ("…which isn't
 * available on this system" against "…which is unavailable on this system").
 * Nothing was broken; the copies were just no longer the same promise, which
 * is the whole F2 failure mode in miniature.
 *
 * Asserting the current text would not have caught that and will not catch it
 * again: both copies were individually correct. What has to fail is the
 * REAPPEARANCE OF A SECOND COPY, so this reads the shipping source and counts
 * where the sentence can be spelled.
 *
 * The three rules below are chosen so that any way of re-inlining it trips at
 * least one:
 *   1. an exact copy-paste of the constant             -> rule 1
 *   2. a re-worded copy (what actually happened: same
 *      opening, different tail)                        -> rule 2
 *   3. a completely fresh sentence under the old name  -> rule 3
 *
 * Test files are excluded on purpose: they legitimately quote the sentence
 * (`store.test.ts`, `simplifiedRenderer.test.tsx`), and the invariant is about
 * what SHIPS. That exclusion is also what lets this file name the needles
 * without matching itself.
 */

/** The distinctive opening of the sentence. Deliberately not the whole
 * string — the copy that drifted differed only in its last four words — and
 * deliberately narrower than "hardware rendering (WebGPU)", which eight other
 * surfaces (Batch, Timeline transitions, Post, the shader editor…) each say in
 * their own words about their own feature. */
const SENTENCE_OPENING = "Video export needs hardware rendering";

/** The one file allowed to spell it. */
const OWNER = "/src/state/exportConfig.ts";

/**
 * Every shipping `.ts`/`.tsx` under `src/`, as (path, source text). Read with
 * vite's own `?raw` glob rather than `node:fs` — this project's tsconfig has
 * no `@types/node`, and the glob is resolved by the same bundler that decides
 * what ships.
 */
function shippingSources(): Array<[string, string]> {
  const all = import.meta.glob("/src/**/*.{ts,tsx}", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;
  return Object.entries(all).filter(([path]) => !/\.test\.tsx?$/.test(path));
}

describe("the export-refusal sentence has one definition (G7)", () => {
  const sources = shippingSources();

  it("reads a real tree — the walk is not silently matching nothing", () => {
    // Without this the three scans below pass trivially on a broken walk.
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.map(([p]) => p)).toContain(OWNER);
    expect(sources.map(([p]) => p)).toContain("/src/ui/ExportDialog.tsx");
    // …and no test file leaked in, which would make the exclusion a no-op.
    expect(sources.filter(([p]) => p.includes(".test."))).toEqual([]);
  });

  it("rule 1: nothing outside exportConfig.ts contains the constant's text", () => {
    const copies = sources
      .filter(([path, text]) => path !== OWNER && text.includes(SIMPLIFIED_EXPORT_REASON))
      .map(([path]) => path);
    expect(copies).toEqual([]);
  });

  it("rule 2: nothing outside exportConfig.ts re-words it either", () => {
    const copies = sources
      .filter(([path, text]) => path !== OWNER && text.includes(SENTENCE_OPENING))
      .map(([path]) => path);
    expect(copies).toEqual([]);
    // The needle is only useful if the owner actually carries it.
    expect(SIMPLIFIED_EXPORT_REASON.startsWith(SENTENCE_OPENING)).toBe(true);
  });

  it("rule 3: whoever derives `exportBlocked` reads the constant", () => {
    // Keyed on the derivation's NAME rather than on App.tsx, so the guard
    // survives the top bar being extracted into its own component: the name
    // travels with the code. A fresh literal written under that name — the one
    // shape rules 1 and 2 would miss — has to drop the import to compile.
    const derivers = sources.filter(([, text]) => text.includes("exportBlocked"));
    expect(derivers.map(([path]) => path)).not.toEqual([]);
    const unwired = derivers
      .filter(([, text]) => !text.includes("SIMPLIFIED_EXPORT_REASON"))
      .map(([path]) => path);
    expect(unwired).toEqual([]);
  });
});
