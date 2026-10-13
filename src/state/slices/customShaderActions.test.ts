import { afterEach, describe, expect, it, vi } from "vitest";
import { NEW_SHADER_TEMPLATE, unregisterCustomPreset } from "../../render/presets/custom";
import { presetById } from "../../render/presets";
import type { PresetDef } from "../../render/types";
import { clearHistory } from "../history";

/**
 * Whole-lane review, CRITICAL on top of E2-U4 — the `signal` parameter
 * `saveCustomPreset`/`importShadertoyGlsl` gained so a caller's own timeout
 * (ShaderEditor.tsx / ShadertoyImport.tsx, via asyncTimeout.ts's
 * `raceTimeout`) can stop a LATE-arriving compile/translate result from
 * registering, persisting or switching the live visual after the UI already
 * told the user it failed. `checkCustomPreset` is overridden per-test
 * (module-real `store` merge, same idiom `useVizStore.setState` already
 * uses everywhere in this repo) rather than mocking the WebGPU renderer —
 * the on-device compile path itself is out of scope for this file; only the
 * abort CONTRACT around it is under test. `platform`'s isTauri/
 * transpileShadertoy are mocked the same shape exportActions.test.ts uses.
 */

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});

vi.mock("../platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform")>();
  return {
    ...actual,
    isTauri: vi.fn(() => false),
    transpileShadertoy: vi.fn(async () => ({ ok: true, wgsl: null, errors: [] })),
    // The .bfshader export dialog; the filename test below reads its first arg.
    saveTextFile: vi.fn(async () => null),
  };
});

// The undo test at the bottom drives the REAL switchPreset and undo ->
// applyDocument, which reach the analyzer; the same narrow mock
// projectIOActions.test.ts uses (initApp is never called, so the renderer
// side takes its null-renderer early returns for free).
vi.mock("../services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => {
    throw new Error("getEngine: not expected without initApp");
  }),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn() })),
  peekAnalyzer: vi.fn(() => null),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

const { useVizStore } = await import("../store");
const { isTauri, saveTextFile, transpileShadertoy } = await import("../platform");

const PRISTINE = { ...useVizStore.getState() };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fixtureDef(id: string): PresetDef {
  return { id, name: "Test visual", params: [], wgsl: NEW_SHADER_TEMPLATE };
}

afterEach(() => {
  useVizStore.setState(PRISTINE);
  vi.mocked(isTauri).mockReturnValue(false);
});

describe("saveCustomPreset — signal abort", () => {
  it("applies normally (register, persist, switch) with no signal — the default, unabridged contract", async () => {
    const switchPresetMock = vi.fn();
    useVizStore.setState({
      checkCustomPreset: vi.fn(async () => []),
      switchPreset: switchPresetMock,
    });
    const def = fixtureDef("custom-nosig1");

    const result = await useVizStore.getState().saveCustomPreset(def);

    expect(result).toEqual([]);
    expect(switchPresetMock).toHaveBeenCalledWith("custom-nosig1");
    expect(useVizStore.getState().customDefs.some((d) => d.id === "custom-nosig1")).toBe(true);
  });

  it("still applies when a signal is passed but never aborted", async () => {
    const switchPresetMock = vi.fn();
    useVizStore.setState({
      checkCustomPreset: vi.fn(async () => []),
      switchPreset: switchPresetMock,
    });
    const def = fixtureDef("custom-livesig1");
    const controller = new AbortController();

    const result = await useVizStore.getState().saveCustomPreset(def, controller.signal);

    expect(result).toEqual([]);
    expect(switchPresetMock).toHaveBeenCalledWith("custom-livesig1");
  });

  it("skips register/persist/switch when the signal aborts WHILE checkCustomPreset is still pending", async () => {
    const gate = deferred<string[]>();
    const switchPresetMock = vi.fn();
    useVizStore.setState({
      checkCustomPreset: vi.fn(() => gate.promise),
      switchPreset: switchPresetMock,
    });
    const def = fixtureDef("custom-abort1");
    const controller = new AbortController();

    const call = useVizStore.getState().saveCustomPreset(def, controller.signal);
    controller.abort(); // the caller's timeout firing, mid-compile-check
    gate.resolve([]); // the compile succeeds anyway — but arrives late

    const result = await call;

    expect(result).toEqual([]);
    expect(switchPresetMock).not.toHaveBeenCalled();
    expect(useVizStore.getState().customDefs.some((d) => d.id === "custom-abort1")).toBe(false);
  });

  it("skips even when the compile check would have reported real errors — an aborted caller gets [] either way", async () => {
    const gate = deferred<string[]>();
    const switchPresetMock = vi.fn();
    useVizStore.setState({
      checkCustomPreset: vi.fn(() => gate.promise),
      switchPreset: switchPresetMock,
    });
    const def = fixtureDef("custom-abort2");
    const controller = new AbortController();

    const call = useVizStore.getState().saveCustomPreset(def, controller.signal);
    controller.abort();
    gate.resolve(["line 3: undeclared identifier"]);

    const result = await call;

    expect(result).toEqual([]);
    expect(switchPresetMock).not.toHaveBeenCalled();
  });
});

/**
 * Review O2 (R2-19's theme): a beat-quantized switch queued TO a shader that
 * then gets deleted must die with it — left pending, the next boundary fired
 * the switch and presetById's registry fallback landed it on the default
 * mode mid-set.
 */
describe("deleteCustomPreset unqueues a pending switch to itself (review O2)", () => {
  it("a queued switch to the deleted visual dies with it", async () => {
    useVizStore.setState({ checkCustomPreset: vi.fn(async () => []), switchPreset: vi.fn() });
    const def = fixtureDef("custom-doomqueue");
    await useVizStore.getState().saveCustomPreset(def);
    useVizStore.setState({ presetId: "spectrum-bars", pendingPresetId: "custom-doomqueue" });

    useVizStore.getState().deleteCustomPreset("custom-doomqueue");

    expect(useVizStore.getState().pendingPresetId).toBeNull();
    expect(useVizStore.getState().customDefs.some((d) => d.id === "custom-doomqueue")).toBe(false);
  });

  it("a queue to a DIFFERENT target survives the delete", async () => {
    useVizStore.setState({ checkCustomPreset: vi.fn(async () => []), switchPreset: vi.fn() });
    const def = fixtureDef("custom-doomqueue2");
    await useVizStore.getState().saveCustomPreset(def);
    useVizStore.setState({ presetId: "spectrum-bars", pendingPresetId: "aurora" });

    useVizStore.getState().deleteCustomPreset("custom-doomqueue2");

    expect(useVizStore.getState().pendingPresetId).toBe("aurora");
  });
});

describe("importShadertoyGlsl — signal abort", () => {
  it("skips saveCustomPreset entirely when aborted right as the transpile resolves", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const gate = deferred<{
      ok: boolean;
      wgsl: string | null;
      errors: { line: number | null; message: string }[];
    }>();
    vi.mocked(transpileShadertoy).mockReturnValueOnce(gate.promise);
    const saveCustomPresetMock = vi.fn(async () => []);
    useVizStore.setState({ saveCustomPreset: saveCustomPresetMock });

    const controller = new AbortController();
    const call = useVizStore
      .getState()
      .importShadertoyGlsl("void mainImage(){}", { name: "Imported" }, null, controller.signal);
    controller.abort();
    gate.resolve({ ok: true, wgsl: "@fragment fn main() {}", errors: [] });

    const result = await call;

    expect(result).toEqual([]);
    expect(saveCustomPresetMock).not.toHaveBeenCalled();
  });

  it("forwards the signal into saveCustomPreset when the transpile succeeds before any abort", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(transpileShadertoy).mockResolvedValueOnce({
      ok: true,
      wgsl: "@fragment fn main() { let u = BeatformShadertoyUniforms(); }",
      errors: [],
    });
    const saveCustomPresetMock = vi.fn(async (_def: PresetDef, _signal?: AbortSignal) => []);
    useVizStore.setState({ saveCustomPreset: saveCustomPresetMock });
    const controller = new AbortController();

    await useVizStore
      .getState()
      .importShadertoyGlsl("void mainImage(){}", { name: "Imported" }, null, controller.signal);

    expect(saveCustomPresetMock).toHaveBeenCalledTimes(1);
    expect(saveCustomPresetMock.mock.calls[0][1]).toBe(controller.signal);
  });
});

/**
 * Undo after re-saving a custom shader that is NOT the active visual.
 * ShaderEditor's loadExisting can open any def; the snapshot asOneGesture
 * recorded was docOf(state), whose customDefs is referencedCustomDefs (the
 * active visual + timeline scenes only) — so the def being re-saved was absent
 * from it, and Ctrl+Z said "Undone" while the new WGSL stayed in place.
 * deleteCustomPreset had already solved the identical problem with
 * record("delete-preset", [doomed]); the save now hands asOneGesture the
 * previous version the same way.
 */
describe("re-saving a NON-active custom shader is undoable", () => {
  const ID = "custom-nonactive-resave";
  const V1 = "fn preset(uv: vec2f) -> vec4f { return vec4f(1.0); } // VERSION ONE";
  const V2 = "fn preset(uv: vec2f) -> vec4f { return vec4f(0.5); } // VERSION TWO";

  afterEach(() => {
    clearHistory();
    unregisterCustomPreset(ID);
  });

  it("Ctrl+Z restores the previous WGSL in customDefs AND the registry, in exactly one step", async () => {
    clearHistory();
    useVizStore.setState({ checkCustomPreset: vi.fn(async () => []) });
    const store = () => useVizStore.getState();

    await store().saveCustomPreset({ id: ID, name: "Other", params: [], wgsl: V1 });
    // Make it NOT the active visual: the document now references no custom
    // def at all, so a plain snapshot would not carry it.
    store().switchPreset("spectrum-bars");
    expect(store().presetId).toBe("spectrum-bars");
    const depthBefore = store().undoDepth;

    // The in-place re-save (ShaderEditor loaded the def and hit Save).
    await store().saveCustomPreset({ id: ID, name: "Other", params: [], wgsl: V2 });
    expect(store().customDefs.find((d) => d.id === ID)?.wgsl).toBe(V2);
    expect(presetById(ID).wgsl).toBe(V2);
    expect(store().undoDepth).toBe(depthBefore + 1); // still exactly one entry

    store().undo();

    expect(store().customDefs.find((d) => d.id === ID)?.wgsl).toBe(V1);
    expect(presetById(ID).wgsl).toBe(V1);
    expect(store().presetId).toBe("spectrum-bars");
  });
});

describe("exportCustomPreset's filename", () => {
  it("keeps a dotted title intact — safeName's extension strip is for filenames, and a shader name is free text", async () => {
    vi.mocked(saveTextFile).mockClear();
    useVizStore.setState({
      customDefs: [
        { id: "custom-dotname", name: "v2.1 Glow", params: [], wgsl: NEW_SHADER_TEMPLATE },
      ],
    });

    await useVizStore.getState().exportCustomPreset("custom-dotname");

    expect(saveTextFile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveTextFile).mock.calls[0][0]).toBe("v2.1 Glow.bfshader");
  });
});
