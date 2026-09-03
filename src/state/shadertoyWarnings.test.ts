import { describe, expect, it } from "vitest";
import { shadertoyWarnings } from "./shadertoyWarnings";

const MAIN = (body: string) =>
  `void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  vec2 uv = fragCoord / iResolution.xy;\n${body}\n}\n`;

describe("shadertoyWarnings (HD-12)", () => {
  it("is silent for an audio-only single-pass shader", () => {
    expect(
      shadertoyWarnings(
        MAIN("  float f = texture(iChannel0, vec2(uv.x, 0.25)).x;\n  fragColor = vec4(f);"),
      ),
    ).toEqual([]);
    expect(shadertoyWarnings("")).toEqual([]);
    expect(shadertoyWarnings("   \n")).toEqual([]);
  });

  it("names every empty channel the shader samples, once each", () => {
    const w = shadertoyWarnings(
      MAIN(
        "  vec4 a = texture(iChannel1, uv);\n  vec4 b = texture(iChannel3, uv) + texture(iChannel1, uv * 2.0);\n  fragColor = a + b;",
      ),
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/^iChannel1, iChannel3 are sampled/);
    expect(w[0]).toMatch(/renders black/);
  });

  it("uses singular wording for one channel", () => {
    const [w] = shadertoyWarnings(MAIN("  fragColor = texture(iChannel2, uv);"));
    expect(w).toMatch(/^iChannel2 is sampled/);
  });

  it("ignores channels that only appear in comments", () => {
    expect(
      shadertoyWarnings(
        MAIN(
          "  // vec4 a = texture(iChannel1, uv);\n  /* iChannel2 was the noise\n     texture */\n  fragColor = vec4(uv, 0.0, 1.0);",
        ),
      ),
    ).toEqual([]);
  });

  it("warns that iMouse is always zero", () => {
    const w = shadertoyWarnings(
      MAIN("  vec2 m = iMouse.xy / iResolution.xy;\n  fragColor = vec4(m, 0.0, 1.0);"),
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/iMouse is always zero/);
  });

  it("flags multi-pass traces (Buffer A–D / Common) even inside comments", () => {
    const w = shadertoyWarnings(
      "// Buffer A: velocity field, Common: shared helpers\n" +
        MAIN("  fragColor = texture(iChannel0, uv);"),
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/Buffer A–D or Common/);
  });

  it("does not mistake ordinary identifiers for multi-pass traces", () => {
    expect(
      shadertoyWarnings(
        MAIN("  float bufferAlpha = 0.5; // commonly 0.5\n  fragColor = vec4(bufferAlpha);"),
      ),
    ).toEqual([]);
  });

  it("stacks independent warnings in a stable order", () => {
    const w = shadertoyWarnings(
      "// Buffer B feeds iChannel1\n" +
        MAIN("  fragColor = texture(iChannel1, iMouse.xy / iResolution.xy);"),
    );
    expect(w.map((s) => s.split(" ")[0])).toEqual(["iChannel1", "iMouse", "The"]);
  });
});
