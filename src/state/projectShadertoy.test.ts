// FEAT-001: conditional project schema — files stay at v11 unless they embed
// an imported Shadertoy def (whose full-module wgsl an older validator would
// silently drop, degrading the project to the default visual).
import { describe, expect, it } from "vitest";
import { parseProject, serializeProject } from "./project";
import type { PresetDef } from "../render/types";

const MODULE_WGSL = `struct BeatformShadertoyUniforms { iTime: f32 }
@fragment
fn main(@builtin(position) p: vec4f) -> @location(0) vec4f { return vec4f(1.0); }
`;

const shadertoyDef: PresetDef = {
  id: "custom-st-proj",
  name: "Imported",
  params: [],
  wgsl: MODULE_WGSL,
  shadertoy: { glsl: "void mainImage(out vec4 c, in vec2 f) { c = vec4(1.0); }" },
};

/** A minimal valid document, via the validator's own defaulting. */
const baseDoc = () =>
  parseProject(
    JSON.stringify({
      schemaVersion: 11,
      kind: "avproj",
      appVersion: "0.0.0",
      savedAt: "2026-01-01T00:00:00.000Z",
      document: { presetId: "spectrum-bars" },
    }),
  );

describe("project schema is conditional on shadertoy defs", () => {
  it("writes v11 when no shadertoy def is embedded", () => {
    const json = serializeProject(baseDoc(), "0.0.0");
    expect(JSON.parse(json).schemaVersion).toBe(11);
  });

  it("writes v12 when a shadertoy def is embedded, and round-trips it", () => {
    const doc = { ...baseDoc(), customDefs: [shadertoyDef], presetId: shadertoyDef.id };
    const json = serializeProject(doc, "0.0.0");
    expect(JSON.parse(json).schemaVersion).toBe(12);
    const back = parseProject(json);
    expect(back.customDefs).toHaveLength(1);
    expect(back.customDefs[0].shadertoy?.glsl).toBe(shadertoyDef.shadertoy!.glsl);
    expect(back.presetId).toBe(shadertoyDef.id);
  });

  it("still refuses files newer than the app", () => {
    // v13 (particles rename) is a real schema now, so "newer" starts at 14.
    const json = serializeProject({ ...baseDoc(), customDefs: [shadertoyDef] }, "0.0.0").replace(
      '"schemaVersion": 12',
      '"schemaVersion": 14',
    );
    expect(() => parseProject(json)).toThrow(/newer app version/);
  });
});
