import { afterEach, describe, expect, it } from "vitest";
import {
  customPresetById,
  NEW_SHADER_TEMPLATE,
  parseCustomPreset,
  registerCustomPreset,
  serializeCustomPreset,
  ShaderParseError,
  unregisterCustomPreset,
  validCustomPreset,
} from "./custom";
import { presetById, presets } from "./index";

const GOOD = {
  id: "custom-abc12",
  name: "Test Visual",
  params: [{ key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: 200 }],
  wgsl: "fn preset(uv: vec2f) -> vec4f { return vec4f(P_hue() / 360.0, 0.0, 0.0, 1.0); }",
};

afterEach(() => unregisterCustomPreset(GOOD.id));

describe("validCustomPreset", () => {
  it("accepts a well-formed def and clamps the default into range", () => {
    const d = validCustomPreset({
      ...GOOD,
      params: [{ ...GOOD.params[0], default: 999 }],
    });
    expect(d).not.toBeNull();
    expect(d!.params[0].default).toBe(360);
  });

  it("rejects bad ids, missing preset fn, oversized wgsl, dup keys", () => {
    expect(validCustomPreset({ ...GOOD, id: "spectrum-bars" })).toBeNull(); // no custom- prefix
    expect(validCustomPreset({ ...GOOD, wgsl: "fn other() {}" })).toBeNull();
    expect(validCustomPreset({ ...GOOD, wgsl: "fn preset(".padEnd(60_000, "x") })).toBeNull();
    expect(
      validCustomPreset({ ...GOOD, params: [GOOD.params[0], { ...GOOD.params[0] }] }),
    ).toBeNull(); // duplicate key
  });

  it("drops malformed param rows instead of rejecting the whole def", () => {
    const d = validCustomPreset({
      ...GOOD,
      params: [GOOD.params[0], { key: "9bad", min: 0, max: 1, step: 0.1, default: 0 }],
    });
    expect(d!.params).toHaveLength(1);
  });

  it("the shipped editor template validates", () => {
    expect(validCustomPreset({ ...GOOD, wgsl: NEW_SHADER_TEMPLATE })).not.toBeNull();
  });
});

describe("registry + presetById", () => {
  it("resolves registered customs; built-ins always win; fallback intact", () => {
    expect(presetById(GOOD.id).id).toBe(presets[0].id); // unregistered -> default
    registerCustomPreset(GOOD as never);
    expect(presetById(GOOD.id).name).toBe("Test Visual");
    expect(presetById("spectrum-bars").id).toBe("spectrum-bars");
    unregisterCustomPreset(GOOD.id);
    expect(presetById(GOOD.id).id).toBe(presets[0].id);
    expect(customPresetById(GOOD.id)).toBeUndefined();
  });
});

describe(".avshader files", () => {
  it("round-trips", () => {
    const json = serializeCustomPreset(GOOD as never, "x");
    const def = parseCustomPreset(json);
    expect(def.id).toBe(GOOD.id);
    expect(def.wgsl).toBe(GOOD.wgsl);
  });

  it("rejects wrong kinds, newer versions, invalid presets", () => {
    expect(() => parseCustomPreset("{}")).toThrow(ShaderParseError);
    const f = JSON.parse(serializeCustomPreset(GOOD as never, "x"));
    f.schemaVersion = 99;
    expect(() => parseCustomPreset(JSON.stringify(f))).toThrow(/newer app/);
    const g = JSON.parse(serializeCustomPreset(GOOD as never, "x"));
    g.preset.wgsl = "nope";
    expect(() => parseCustomPreset(JSON.stringify(g))).toThrow(/failed validation/);
  });
});
