import { describe, expect, it, vi } from "vitest";

/**
 * RP-20, the Builder bridge — the STORE side. builderStack stays the single
 * persisted truth; paramsByPreset["builder2"] is a derived mirror of its
 * virtual l<i>.* values so frameResolve/mods/automation/looks resolve them
 * like any other preset's params. These tests drive the real store actions:
 * setParam routing (the MIDI CC path rides it), resetParams, the mirror on
 * every stack write, look save/apply, and applyDocument's stack-wins rule.
 *
 * Same mock surface as store.test.ts: services/platform are faked because
 * WebGPU/Web Audio/Tauri don't exist here — orthogonal to the bookkeeping
 * under test.
 */

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

const renderer = {
  setPreset: vi.fn(),
  setBuilderParams: vi.fn(),
  setBackground: vi.fn(),
  setSmoothSpectrum: vi.fn(),
  setPost: vi.fn(),
  setMotion: vi.fn(),
  setCoverArt: vi.fn(),
  setBackgroundImage: vi.fn(),
  setOverlay: vi.fn(),
};

vi.mock("./services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => ({
    ctx: { decodeAudioData: vi.fn() },
    currentTime: 0,
    duration: 0,
    playing: false,
    setVolume: vi.fn(),
    onEnded: null,
    dispose: vi.fn(),
  })),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn() })),
  getRenderer: vi.fn(() => renderer),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

vi.mock("./platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./platform")>();
  return { ...actual, writeAutosave: vi.fn(async () => {}) };
});

// Dynamic (top-level await) so the module bodies run AFTER the stubs above —
// a static import would hoist past them and hit the real localStorage.
const { useVizStore } = await import("./store");
const { BUILDER2_ID, builderStackValues, defaultBuilderStack, packBuilderParams, sameStackValues } =
  await import("../render/builder2");
const { serializeProject, parseProject } = await import("./project");
const { APP_VERSION } = await import("../version");

/** Reset to a known Builder state before each scenario. */
function armBuilder() {
  useVizStore.getState().setBuilderStack(defaultBuilderStack());
  useVizStore.setState({ presetId: BUILDER2_ID, midiBindings: [], midiLearn: null });
  useVizStore.setState({ activeParams: { ...useVizStore.getState().paramsByPreset[BUILDER2_ID] } });
}

describe("builder bridge — store routing (RP-20)", () => {
  it("setParam with a virtual key routes through the STACK, mirror and GPU upload follow", () => {
    armBuilder();
    renderer.setBuilderParams.mockClear();

    useVizStore.getState().setParam("l0.glow", 0.85);

    const s = useVizStore.getState();
    expect(s.builderStack.layers[0].params.glow).toBe(0.85);
    // Mirror + activeParams both read the routed value…
    expect(s.paramsByPreset[BUILDER2_ID]["l0.glow"]).toBe(0.85);
    expect(s.activeParams["l0.glow"]).toBe(0.85);
    // …and the storage-buffer upload carries the stack pack.
    expect(renderer.setBuilderParams).toHaveBeenCalled();
    const uploaded = renderer.setBuilderParams.mock.calls[
      renderer.setBuilderParams.mock.calls.length - 1
    ][0] as Float32Array;
    expect(Array.from(uploaded)).toEqual(Array.from(packBuilderParams(s.builderStack)));
  });

  it("a stale virtual key (structure changed since it was bound) is inert", () => {
    armBuilder();
    const before = useVizStore.getState().builderStack;

    useVizStore.getState().setParam("l9.glow", 1); // no ninth layer
    useVizStore.getState().setParam("l0.nope", 1); // wash has no such param

    const s = useVizStore.getState();
    expect(s.builderStack).toBe(before);
    expect(s.paramsByPreset[BUILDER2_ID]["l9.glow"]).toBeUndefined();
    expect(s.paramsByPreset[BUILDER2_ID]["l0.nope"]).toBeUndefined();
  });

  it("a MIDI CC binding to a virtual key drives the stack through setParam", () => {
    armBuilder();
    useVizStore.setState({
      midiBindings: [{ kind: "cc", cc: 21, param: "l0.glow", min: 0, max: 1 }],
    });

    useVizStore.getState().handleMidiMessage([0xb0, 21, 127]);

    expect(useVizStore.getState().builderStack.layers[0].params.glow).toBe(1);
    expect(useVizStore.getState().paramsByPreset[BUILDER2_ID]["l0.glow"]).toBe(1);
  });

  it("resetParams on Builder resets the STACK to the classic default", () => {
    armBuilder();
    useVizStore.getState().setParam("l0.glow", 0.9);
    expect(sameStackValues(useVizStore.getState().builderStack, defaultBuilderStack())).toBe(false);

    useVizStore.getState().resetParams();

    const s = useVizStore.getState();
    expect(sameStackValues(s.builderStack, defaultBuilderStack())).toBe(true);
    expect(s.paramsByPreset[BUILDER2_ID]).toEqual(builderStackValues(defaultBuilderStack()));
  });

  it("setBuilderStack maintains the mirror even while another preset is active", () => {
    armBuilder();
    useVizStore.setState({ presetId: "spectrum-bars" });
    const stack = defaultBuilderStack();
    stack.layers[0] = { ...stack.layers[0], hue: 33 };

    useVizStore.getState().setBuilderStack(stack);

    // A timeline scene can reference builder2 while the base preset is
    // something else — baseOf() reads this record, so it must track the stack
    // unconditionally.
    expect(useVizStore.getState().paramsByPreset[BUILDER2_ID]["l0.hue"]).toBe(33);
  });

  it("saved looks capture the mirror, and applying one routes values back into the stack", () => {
    armBuilder();
    useVizStore.getState().setParam("l0.glow", 0.9);
    useVizStore.getState().setParam("l3.bright", 1.2);
    useVizStore.getState().saveUserPreset("bridge look");
    const look = useVizStore.getState().userPresets[0];
    expect(look.presetId).toBe(BUILDER2_ID);
    expect(look.params["l0.glow"]).toBe(0.9);

    // Drift away, then apply the look: the STACK must carry the values again.
    useVizStore.getState().setParam("l0.glow", 0.1);
    useVizStore.getState().setParam("l3.bright", 0.2);
    useVizStore.getState().applyUserPreset(look.id);

    const s = useVizStore.getState();
    expect(s.builderStack.layers[0].params.glow).toBe(0.9);
    expect(s.builderStack.layers[3].params.bright).toBe(1.2);
    expect(s.activeParams["l0.glow"]).toBe(0.9);

    useVizStore.getState().deleteUserPreset(look.id);
  });
});

describe("builder bridge — applyDocument stack-wins (RP-20)", () => {
  it("a document's stale builder2 mirror loses to its stack", () => {
    armBuilder();
    const stack = defaultBuilderStack();
    stack.layers[0] = { ...stack.layers[0], hue: 77 };
    useVizStore.getState().setBuilderStack(stack);

    // Round-trip the real document, then tamper: a foreign/older file could
    // carry any mirror record — the stack must win on load.
    const json = serializeProject(
      {
        ...structuredClone({
          presetId: BUILDER2_ID,
          paramsByPreset: {
            ...useVizStore.getState().paramsByPreset,
            [BUILDER2_ID]: { "l0.hue": 1, "l0.glow": 0 },
          },
          syncByPreset: {},
          bg: { mode: 0 as const, color: [0, 0, 0] as [number, number, number] },
          bgByPreset: {},
          centerImageByPreset: {},
          overlayLayers: [],
          assets: {},
          aspect: "16:9" as const,
          modsByPreset: {},
          smoothSpectrum: false,
          timeline: { enabled: false as const, scenes: [], lanes: [] },
          post: useVizStore.getState().post,
          motion: useVizStore.getState().motion,
          lyricStyle: useVizStore.getState().lyricStyle,
          audiogram: useVizStore.getState().audiogram,
          customDefs: [],
          builderStack: stack,
        }),
      },
      APP_VERSION,
    );
    useVizStore.getState().applyDocument(parseProject(json));

    const s = useVizStore.getState();
    // The stack's own value (77), not the tampered mirror's (1).
    expect(s.paramsByPreset[BUILDER2_ID]["l0.hue"]).toBe(77);
    expect(s.activeParams["l0.hue"]).toBe(77);
    expect(s.builderStack.layers[0].hue).toBe(77);
  });
});
