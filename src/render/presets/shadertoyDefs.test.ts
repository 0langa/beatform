// FEAT-001: imported-Shadertoy custom defs — validation, .avshader schema,
// and identity semantics. The renderer-side packers are covered in
// src/render/shadertoyPack.test.ts; the GLSL→WGSL translation itself is
// covered by Rust unit tests in src-tauri/src/shadertoy.rs.
import { describe, expect, it } from "vitest";
import {
  parseCustomPreset,
  sameCustomDef,
  serializeCustomPreset,
  validCustomPreset,
} from "./custom";
import type { PresetDef } from "../types";

/** Minimal module shape the validator requires of transpiler output. */
const MODULE_WGSL = `struct BeatformShadertoyUniforms { iTime: f32 }
@group(0) @binding(0) var<uniform> global: BeatformShadertoyUniforms;
@fragment
fn main(@builtin(position) p: vec4f) -> @location(0) vec4f { return vec4f(1.0); }
`;

const GLSL = "void mainImage(out vec4 c, in vec2 f) { c = vec4(1.0); }";

const shadertoyDef: PresetDef = {
  id: "custom-st-test",
  name: "Imported Test",
  params: [],
  wgsl: MODULE_WGSL,
  shadertoy: {
    glsl: GLSL,
    author: "someone",
    source: "https://www.shadertoy.com/view/xxxxxx",
    license: "CC BY-NC-SA 3.0",
  },
};

describe("validCustomPreset — shadertoy defs", () => {
  it("accepts a well-formed shadertoy def and keeps attribution", () => {
    const def = validCustomPreset(shadertoyDef);
    expect(def).not.toBeNull();
    expect(def!.shadertoy?.glsl).toBe(GLSL);
    expect(def!.shadertoy?.author).toBe("someone");
    expect(def!.shadertoy?.license).toBe("CC BY-NC-SA 3.0");
  });

  it("rejects a shadertoy def whose wgsl is not a standalone module", () => {
    // A snippet body must not masquerade as transpiler output.
    expect(
      validCustomPreset({ ...shadertoyDef, wgsl: "fn preset(uv: vec2f) -> vec4f { }" }),
    ).toBeNull();
  });

  it("rejects a shadertoy marker without its GLSL source", () => {
    expect(validCustomPreset({ ...shadertoyDef, shadertoy: { glsl: "" } })).toBeNull();
    expect(
      validCustomPreset({ ...shadertoyDef, shadertoy: { author: "x" } as unknown }),
    ).toBeNull();
  });

  it("still rejects a plain snippet def without fn preset", () => {
    expect(
      validCustomPreset({ id: "custom-x", name: "X", params: [], wgsl: MODULE_WGSL }),
    ).toBeNull();
  });

  it("keeps plain snippet defs valid exactly as before", () => {
    const def = validCustomPreset({
      id: "custom-snippet",
      name: "Snippet",
      params: [],
      wgsl: "fn preset(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }",
    });
    expect(def).not.toBeNull();
    expect(def!.shadertoy).toBeUndefined();
  });
});

describe(".avshader schema versioning", () => {
  it("writes v1 for snippet defs (older apps keep reading them)", () => {
    const snippet: PresetDef = {
      id: "custom-snip",
      name: "S",
      params: [],
      wgsl: "fn preset(uv: vec2f) -> vec4f { return vec4f(1.0); }",
    };
    const file = JSON.parse(serializeCustomPreset(snippet, "0.0.0"));
    expect(file.schemaVersion).toBe(1);
  });

  it("writes v2 for shadertoy defs and round-trips them", () => {
    const json = serializeCustomPreset(shadertoyDef, "0.0.0");
    expect(JSON.parse(json).schemaVersion).toBe(2);
    const back = parseCustomPreset(json);
    expect(back.shadertoy?.glsl).toBe(GLSL);
    expect(back.wgsl).toBe(MODULE_WGSL);
  });

  it("rejects files newer than the app understands", () => {
    const json = serializeCustomPreset(shadertoyDef, "0.0.0").replace(
      '"schemaVersion": 2',
      '"schemaVersion": 3',
    );
    expect(() => parseCustomPreset(json)).toThrow(/newer app version/);
  });
});

describe("sameCustomDef — attribution is identity", () => {
  it("differing attribution means differing defs (project-open merge must not clobber it)", () => {
    const other: PresetDef = {
      ...shadertoyDef,
      shadertoy: { ...shadertoyDef.shadertoy!, author: "someone else" },
    };
    expect(sameCustomDef(shadertoyDef, other)).toBe(false);
    expect(sameCustomDef(shadertoyDef, { ...shadertoyDef })).toBe(true);
  });
});
