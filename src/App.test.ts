// @vitest-environment jsdom
// Importing ./App pulls in the whole App.tsx module graph (the store,
// every panel/dialog it references) — store.ts reads localStorage at
// module scope (same gotcha guideSync.test.ts's own comment documents),
// so this needs a DOM environment even though raceBootVeilDrop itself
// touches neither React nor the store.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  armBootVeilRace,
  dispatchDroppedFiles,
  IMAGE_DROP_HINT,
  isFileDrag,
  raceBootVeilDrop,
  VIDEO_DROP_HINT,
} from "./App";
import type { useVizStore } from "./state/store";

/**
 * Owner ruling E (final round) — the boot veil's drop race, tested in
 * isolation from React (no rendering needed: `raceBootVeilDrop` is a pure
 * async helper, extracted from the effect that uses it for exactly this
 * reason — matching this file's own existing pattern of exporting testable
 * logic, see `commitVisualsWidth`/`resizeKeyValue`). The full
 * isTauri()-gated wiring (never renders the veil node at all in the
 * browser build, starts `bootVeilVisible` true only on desktop) is covered
 * at the store level in bootVeil.test.ts; this file owns the "whichever
 * comes first" race itself, plus (final review round, item 2)
 * `armBootVeilRace`'s ownership check on top of it.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe("raceBootVeilDrop", () => {
  it("calls onDrop once the boot promise resolves, well before the cap", async () => {
    vi.useFakeTimers();
    const onDrop = vi.fn();
    let resolveBoot!: () => void;
    const boot = new Promise<void>((r) => {
      resolveBoot = r;
    });

    raceBootVeilDrop(boot, 500, onDrop);
    await vi.advanceTimersByTimeAsync(50);
    expect(onDrop).not.toHaveBeenCalled();

    resolveBoot();
    await vi.advanceTimersByTimeAsync(0);
    expect(onDrop).toHaveBeenCalledTimes(1);

    // The cap must not ALSO fire later for the same race.
    await vi.advanceTimersByTimeAsync(1000);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("calls onDrop at the cap when the boot promise never settles — a genuinely hung read", async () => {
    vi.useFakeTimers();
    const onDrop = vi.fn();
    const neverSettles = new Promise<void>(() => undefined); // parked, deliberately

    raceBootVeilDrop(neverSettles, 500, onDrop);
    await vi.advanceTimersByTimeAsync(499);
    expect(onDrop).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("calls onDrop when the boot promise REJECTS too (.finally, not .then) — a fallback boot must drop the veil, not ride the cap", async () => {
    vi.useFakeTimers();
    const onDrop = vi.fn();
    let rejectBoot!: (e: unknown) => void;
    const boot = new Promise<void>((_resolve, reject) => {
      rejectBoot = reject;
    });

    raceBootVeilDrop(boot, 500, onDrop);
    rejectBoot(new Error("boom"));
    // Swallow so vitest doesn't flag it as an unhandled rejection — the
    // production caller's own `.finally` inside raceBootVeilDrop already
    // observes it; this is just this test's OWN reference to the same
    // promise needing a handler too.
    await boot.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);

    expect(onDrop).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onDrop).toHaveBeenCalledTimes(1); // the cap didn't ALSO fire
  });

  it("the returned cancel function clears the cap timer — a fast unmount leaves nothing pending", async () => {
    vi.useFakeTimers();
    const onDrop = vi.fn();
    const neverSettles = new Promise<void>(() => undefined);

    const cancel = raceBootVeilDrop(neverSettles, 500, onDrop);
    cancel();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onDrop).not.toHaveBeenCalled();
  });
});

/**
 * R2-31e — the drop dispatch, tested at the dispatch level (the extracted
 * helper, no React render). The app EXPORTS .bfpreset (looks) and .bfbuilder
 * (builder stacks) but the drop handler only routed .bfshader/.bftheme/
 * .bfproj — a look or stack dragged back in fell through to the audio
 * decoder and died as "Unable to decode audio data".
 */
describe("dispatchDroppedFiles", () => {
  /** A dropped file the dispatch can read — jsdom's File lacks Blob.text
   * consistency, so the fixture carries its own. */
  function dropped(name: string, contents = "payload"): File {
    return { name, text: async () => contents } as unknown as File;
  }

  function fakeStore() {
    const state = {
      showBatch: false,
      importCustomPresetText: vi.fn(),
      importThemeText: vi.fn(),
      importUserPresetText: vi.fn(),
      importBuilderStackText: vi.fn(),
      openProjectText: vi.fn(),
      loadLyricsText: vi.fn(),
      addBatchTracks: vi.fn(async () => {}),
      loadFile: vi.fn(async () => {}),
      setError: vi.fn(),
    };
    return { state, store: (() => state) as unknown as typeof useVizStore.getState };
  }

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("routes a .bfpreset to the look importer", async () => {
    const { state, store } = fakeStore();
    dispatchDroppedFiles([dropped("My Look.BFPRESET", "look-json")], store);
    await flush();
    expect(state.importUserPresetText).toHaveBeenCalledWith("look-json");
    expect(state.loadFile).not.toHaveBeenCalled();
  });

  it("routes a .bfbuilder to the builder-stack importer", async () => {
    const { state, store } = fakeStore();
    dispatchDroppedFiles([dropped("stack.bfbuilder", "stack-json")], store);
    await flush();
    expect(state.importBuilderStackText).toHaveBeenCalledWith("stack-json");
    expect(state.loadFile).not.toHaveBeenCalled();
  });

  it("still routes a .bftheme to the theme importer (control)", async () => {
    const { state, store } = fakeStore();
    dispatchDroppedFiles([dropped("night.bftheme", "theme-json")], store);
    await flush();
    expect(state.importThemeText).toHaveBeenCalledWith("theme-json");
  });

  it("plain audio still reaches loadFile (nothing over-matched)", async () => {
    const { state, store } = fakeStore();
    const audio = dropped("song.mp3");
    dispatchDroppedFiles([audio], store);
    await flush();
    expect(state.loadFile).toHaveBeenCalledWith(audio);
    expect(state.importUserPresetText).not.toHaveBeenCalled();
    expect(state.importBuilderStackText).not.toHaveBeenCalled();
  });

  /**
   * Pictures and clips have a home in the app, just not the track slot: a
   * .png dropped to set a background fell through to the audio decoder
   * (`Could not decode "x.png"`) and an .mp4 dropped as a video background
   * loaded as a silent audio track. Both now say where they go instead, on
   * the same toast the decode failure used — setError is the store's only
   * public message action (flashNotice is slice-internal).
   */
  it("an image points at Scene ▸ Background and the Layers' + Image… instead of the audio decoder", async () => {
    const { state, store } = fakeStore();
    dispatchDroppedFiles([dropped("cover.PNG")], store);
    await flush();
    expect(state.loadFile).not.toHaveBeenCalled();
    expect(state.setError).toHaveBeenCalledWith(IMAGE_DROP_HINT);
    expect(IMAGE_DROP_HINT).toMatch(/Visuals ▸ Scene ▸ Background/);
    expect(IMAGE_DROP_HINT).toMatch(/Layers/);
  });

  it("a video points at Scene ▸ Background ▸ Video instead of loading as a track", async () => {
    const { state, store } = fakeStore();
    dispatchDroppedFiles([dropped("loop.mp4")], store);
    await flush();
    expect(state.loadFile).not.toHaveBeenCalled();
    expect(state.addBatchTracks).not.toHaveBeenCalled();
    expect(state.setError).toHaveBeenCalledWith(VIDEO_DROP_HINT);
    expect(VIDEO_DROP_HINT).toMatch(/Visuals ▸ Scene ▸ Background/);
  });

  it("a track dropped together with an image still loads — the hint rides alongside, not instead", async () => {
    const { state, store } = fakeStore();
    const audio = dropped("song.flac");
    dispatchDroppedFiles([dropped("art.jpg"), audio], store);
    await flush();
    expect(state.loadFile).toHaveBeenCalledWith(audio);
    expect(state.setError).toHaveBeenCalledWith(IMAGE_DROP_HINT);
  });
});

/**
 * The root's drag handlers lit the "Drop to load" overlay for ANY dragenter
 * that bubbled to them, and an internal HTML5 drag (PresetOrderEditor's row
 * reorder in Preferences › Modes) bubbles exactly like a file drag: the
 * z-index-20 overlay covered the z-index-10 dialog for the whole gesture.
 * The handlers now gate on this helper (same exported-helper pattern as
 * dispatchDroppedFiles — the JSX handlers themselves need a full App mount).
 */
describe("isFileDrag", () => {
  const dt = (types: unknown) => ({ types }) as unknown as DataTransfer;

  it("true for a drag from the OS — types carries Files", () => {
    expect(isFileDrag(dt(["Files"]))).toBe(true);
  });

  it("false for an internal drag — a text/plain payload is the row reorder, not a file", () => {
    expect(isFileDrag(dt(["text/plain"]))).toBe(false);
    expect(isFileDrag(dt([]))).toBe(false);
  });

  it("false with no dataTransfer at all", () => {
    expect(isFileDrag(null)).toBe(false);
    expect(isFileDrag(undefined)).toBe(false);
  });

  it("reads a DOMStringList-shaped types (older WebViews), not only a real array", () => {
    expect(isFileDrag(dt({ length: 1, 0: "Files" }))).toBe(true);
  });
});

describe("armBootVeilRace (final review round, item 2)", () => {
  it("simulated StrictMode double-invoke: the non-owner's null is a no-op — only the owning call's promise can drop the veil", async () => {
    vi.useFakeTimers();
    const onDrop = vi.fn();
    let resolveOwnerBoot!: () => void;
    const ownerBoot = new Promise<void>((r) => {
      resolveOwnerBoot = r;
    });

    // Two "effect-style" calls back to back, exactly how the real effect
    // body calls bootDesktopDocument() on each StrictMode invocation: the
    // first owns the boot (a real, slow-to-settle promise), the second is
    // what bootDesktopDocument's reentrancy guard hands back — null.
    armBootVeilRace(ownerBoot, 500, onDrop);
    armBootVeilRace(null, 500, onDrop);

    // Before this fix, the second (non-owner) call fed a fast-resolving
    // promise into raceBootVeilDrop and dropped the veil almost
    // immediately. It must now do nothing at all, at any point.
    await vi.advanceTimersByTimeAsync(50);
    expect(onDrop).not.toHaveBeenCalled();

    // The REAL boot (the first, owning call) settles — this is the only
    // thing allowed to drop the veil here, since the cap is still 450ms out.
    resolveOwnerBoot();
    await vi.advanceTimersByTimeAsync(0);
    expect(onDrop).toHaveBeenCalledTimes(1);

    // Well past the cap: still exactly once — the non-owner call never
    // armed a race (and so never armed a cap timer) that could fire again.
    await vi.advanceTimersByTimeAsync(1000);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("a null call alone never drops the veil — not even at the cap, since it never starts a race", async () => {
    vi.useFakeTimers();
    const onDrop = vi.fn();

    armBootVeilRace(null, 500, onDrop);

    await vi.advanceTimersByTimeAsync(1000);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("an owning call still hits the cap on its own when the real boot never settles — the ownership check doesn't defeat the hung-read guarantee", async () => {
    vi.useFakeTimers();
    const onDrop = vi.fn();
    const neverSettles = new Promise<void>(() => undefined);

    armBootVeilRace(neverSettles, 500, onDrop);
    armBootVeilRace(null, 500, onDrop); // the StrictMode non-owner, as always

    await vi.advanceTimersByTimeAsync(499);
    expect(onDrop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });
});
