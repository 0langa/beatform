import { describe, expect, it } from "vitest";
import {
  BUILDER_FILE_VERSION,
  BUILDER_LAYER_TYPES,
  BuilderParseError,
  newLayer,
  parseBuilderStack,
  serializeBuilderStack,
  type BuilderStack,
} from "./builder2";

/**
 * R2-17 — the .bfbuilder parse gate, mirroring custom.test.ts's .bfshader
 * matrix. parseBuilderStack is a file-import chokepoint fed by untrusted
 * disk content, and it had zero tests: the version gate, the kind gate and
 * the whitelist tolerance were all unguarded, so any of them could regress
 * (or be "simplified" away) with every suite green.
 */

const t0 = BUILDER_LAYER_TYPES[0];
const t1 = BUILDER_LAYER_TYPES[1];

describe(".bfbuilder files", () => {
  it("round-trips a current-version stack", () => {
    const stack: BuilderStack = {
      layers: [
        { ...newLayer(t0.type), opacity: 0.5, blend: "add", hue: 45, hueSpread: 10 },
        { ...newLayer(t1.type), enabled: false },
      ],
    };
    const json = serializeBuilderStack(stack, "2.x-test");
    expect(JSON.parse(json).schemaVersion).toBe(BUILDER_FILE_VERSION);
    expect(parseBuilderStack(json)).toEqual(stack);
  });

  it("refuses non-JSON", () => {
    expect(() => parseBuilderStack("{not json")).toThrow(BuilderParseError);
    expect(() => parseBuilderStack("{not json")).toThrow(/valid JSON/);
  });

  it("refuses a wrong kind (and a kindless blob)", () => {
    expect(() => parseBuilderStack("{}")).toThrow(/\.bfbuilder/);
    expect(() =>
      parseBuilderStack(JSON.stringify({ kind: "bftheme", schemaVersion: 1, stack: {} })),
    ).toThrow(/\.bfbuilder/);
    expect(() => parseBuilderStack("null")).toThrow(BuilderParseError);
  });

  it("refuses schemaVersion current+1 with the newer-app message", () => {
    const f = {
      kind: "bfbuilder",
      schemaVersion: BUILDER_FILE_VERSION + 1,
      stack: { layers: [] },
    };
    expect(() => parseBuilderStack(JSON.stringify(f))).toThrow(/newer app/);
    // A non-number version is the same refusal: the gate cannot reason about
    // a file that does not say which schema it speaks.
    expect(() =>
      parseBuilderStack(JSON.stringify({ kind: "bfbuilder", schemaVersion: "2", stack: {} })),
    ).toThrow(/newer app/);
  });

  it("accepts exactly the current version", () => {
    const f = {
      kind: "bfbuilder",
      schemaVersion: BUILDER_FILE_VERSION,
      stack: { layers: [newLayer(t0.type)] },
    };
    expect(parseBuilderStack(JSON.stringify(f)).layers).toHaveLength(1);
  });

  it("tolerates garbage fields per the whitelist contract", () => {
    const key = t0.params[0]?.key;
    const f = {
      kind: "bfbuilder",
      schemaVersion: BUILDER_FILE_VERSION,
      appVersion: 123, // wrong type — ignored, never validated
      extra: { nested: true }, // unknown top-level field — ignored
      stack: {
        junk: 1, // unknown stack field — ignored
        layers: [
          { type: "no-such-layer-type", opacity: 5 }, // unknown type — dropped
          "garbage", // non-object row — dropped
          {
            ...newLayer(t0.type),
            opacity: 42, // out of range — clamped to 1
            hue: -50, // out of range — clamped to 0
            blend: "multiply", // unknown blend — coerced to "normal"
            params: key ? { [key]: 1e9, junk: 3 } : { junk: 3 },
          },
        ],
      },
    };
    const stack = parseBuilderStack(JSON.stringify(f));
    expect(stack.layers).toHaveLength(1);
    const layer = stack.layers[0];
    expect(layer.type).toBe(t0.type);
    expect(layer.opacity).toBe(1);
    expect(layer.hue).toBe(0);
    expect(layer.blend).toBe("normal");
    // Whitelisted params only: junk keys never survive, out-of-range values
    // clamp to the spec's own bound.
    expect(layer.params).not.toHaveProperty("junk");
    if (key) expect(layer.params[key]).toBe(t0.params[0].max);
    // Every declared param key is present (defaults fill the gaps).
    for (const p of t0.params) expect(layer.params).toHaveProperty(p.key);
  });

  it("a missing stack degrades to an empty one, not a throw", () => {
    const f = { kind: "bfbuilder", schemaVersion: BUILDER_FILE_VERSION };
    expect(parseBuilderStack(JSON.stringify(f))).toEqual({ layers: [] });
  });
});
