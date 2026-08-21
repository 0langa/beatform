import { afterEach, describe, expect, it, vi } from "vitest";
import { NEW_SHADER_TEMPLATE } from "../../render/presets/custom";
import type { PresetDef } from "../../render/types";

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
  };
});

const { useVizStore } = await import("../store");
const { isTauri, transpileShadertoy } = await import("../platform");

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
