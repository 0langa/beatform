import { describe, expect, it } from "vitest";
// The renderer's SOURCE (vite ?raw), for the pack-order half of the M3U ABI
// check — renderMesh3d itself needs a GPUDevice and cannot run under Node.
import rendererSrc from "../webgpuRenderer.ts?raw";
import { spectrumScape } from "./spectrumScape";
import { allParams, defaultParams, groupParams, paramSpecMap } from "../types";
import {
  cubeColumnVerts,
  MESH3D_BAR_SHAPES,
  MESH3D_UNIFORM_SIZE,
  SHADER_SOURCES,
} from "../webgpuRenderer";

/**
 * Spectrum-scape depth wave (Track B, W1) — the only mesh3d preset. Its
 * shader is NOT preset.wgsl (that is a dead stub): it is MESH3D_WGSL inside
 * the renderer, its params travel as named lanes of the M3U uniform packed by
 * renderMesh3d(), and its geometry is a shared vertex buffer. Three contracts
 * live here, each pinning a surface no registry-wide test can reach:
 *
 *  - Default neutrality: every new param's default IS the literal it
 *    replaced, and the WGSL computes the same value at that default (multiply
 *    by 1, add 0, or the identical f32 constant read from a lane instead of
 *    the instruction stream). Asserted by lifting the exact expressions out
 *    of the shipped shader text, aurora.test.ts-style.
 *  - ABI: the M3U struct's field order must match renderMesh3d's F[i] pack
 *    order — a mismatch renders every lane after the swap as the wrong knob.
 *    Neither side is reachable from a Node test at runtime, so the pack
 *    order is lifted from the renderer's SOURCE and cross-checked against
 *    the struct text the golden test also freezes.
 *  - Geometry: the box must stay byte-identical at the front of the shared
 *    shape buffer (the default draw range), and the appended shapes must
 *    honour the normal rules the vertex stage assumes.
 *
 * Colour routing note (roster contract 7): colorControls.test.ts pins
 * saturation/lightness routing for the four full-colour fragment presets by
 * asserting on preset.wgsl — assertions that cannot fit this mode, whose
 * wgsl is a stub. The equivalent routing pin for the mesh path lives HERE
 * (see "colour tier"), asserting the same colorScale body text against
 * MESH3D_WGSL.
 */

const M = SHADER_SOURCES.mesh3d;
const specs = paramSpecMap(spectrumScape);
const dflt = (key: string): number => {
  const spec = specs.get(key);
  expect(spec, `missing param spec for ${key}`).toBeDefined();
  return spec!.default;
};

describe("default neutrality: every new lane's default is the literal it replaced", () => {
  // [wgsl expression as shipped, param key, the pre-wave literal]
  const REPLACED: Array<[string, string, number]> = [
    ["(0.7 + m.drive * m.driveHeight)", "driveHeight", 0.7],
    ["smoothstep(hotLo, hotLo + m.hotWindow, in.heightNorm)", "hotWindow", 0.45],
    ["m.drive * m.hotDrive", "hotDrive", 0.6],
    ["m.driveBeat * m.hotBeat", "hotBeat", 0.6],
    ["m.driveBeat * m.glowBeat", "glowBeat", 0.5],
    ["* m.fillLight", "fillLight", 0.35],
    ["* m.ambientLight", "ambientLight", 1],
    ["exp(-in.fog * m.fogDensity)", "fogDensity", 0.045],
    ["hLit * m.hueLift", "hueLift", 24],
  ];

  for (const [expr, key, literal] of REPLACED) {
    it(`${key}: shader reads the lane where ${literal} was inlined, spec defaults to it`, () => {
      expect(M).toContain(expr);
      expect(dflt(key)).toBe(literal);
      // An f32 lane holding the default bit-equals the f32 the old literal
      // compiled to, so the expression value cannot move at defaults.
      expect(Math.fround(dflt(key))).toBe(Math.fround(literal));
    });
  }

  it("multiplicative scalers default to exactly 1 (x * 1.0 is IEEE-exact)", () => {
    for (const key of ["saturation", "lightness", "ambientLight"]) {
      expect(dflt(key)).toBe(1);
    }
  });

  it("band response defaults to 0, and the fragment applies it as (1 + band)", () => {
    expect(dflt("bandGlow")).toBe(0);
    // bandE * 0 == 0 for the finite 0..1 band lanes, then col * (1.0 + 0.0)
    // is an exact multiply by one — no branch needed for neutrality.
    expect(M).toContain("out.band = bandE * m.bandGlow;");
    expect(M).toContain("col *= 1.0 + in.band;");
  });

  it("the drive-free shading height and the hot-window base stay literal", () => {
    // hLit is DOCUMENTED as the height without the drive gain — Loudness
    // rise must not touch it, or shading would double-count loudness again
    // (the exact wash the 2.53 fix removed).
    expect(M).toContain("let hLit = bins[bi] * m.heightScale * 0.7 + 0.03;");
    expect(M).toContain("let hotLo = 0.55 + m.drive * 0.6;");
  });

  it("the default layout path is the untouched radial expression", () => {
    expect(M).toContain("let rr = length(vec2f(dx, dz)) / max(m.grid * 0.5, 1.0);");
    expect(M).toContain("var fr = rr;");
    expect(M).toContain("let bi = u32(clamp(fr, 0.0, 0.999) * m.binCount);");
    // The non-default mappings live behind explicit uniform branches (on the
    // binMap lane — 'layout' itself is a WGSL reserved word).
    expect(M).toContain("if (m.binMap > 1.5) {");
    expect(M).toContain("} else if (m.binMap > 0.5) {");
    expect(M).toContain("fr = fract(rr - atan2(dz, dx) * 0.15915494);");
    expect(M).toContain("fr = f32(ii) / max(m.grid * m.grid - 1.0, 1.0);");
    expect(dflt("layout")).toBe(0);
  });

  it("the box keeps the exact normal passthrough; only non-box shapes inverse-scale", () => {
    expect(M).toContain("out.normal = inNormal;");
    expect(M).toContain("if (m.barShape > 0.5) {");
    expect(M).toContain("out.normal = inNormal / vec3f(m.barWidth, max(h, 0.001), m.barWidth);");
    expect(dflt("barShape")).toBe(0);
  });
});

describe("colour tier: mesh-path routing (contract pinned here, not in colorControls)", () => {
  it("saturation and lightness are curated-tier colour params with the roster shape", () => {
    // gpuMatrix derives the two auto grayscale device cases from the MAIN
    // tier (`preset.params`), so membership there is load-bearing.
    for (const key of ["saturation", "lightness"]) {
      const spec = spectrumScape.params.find((p) => p.key === key);
      expect(spec, `${key} must sit in the curated tier`).toMatchObject({
        group: "color",
        min: 0,
        max: 2,
        default: 1,
      });
    }
  });

  it("the authored HSL routes through the shared colorScale body", () => {
    // Same body text as WGSL_COLOR_CONTROLS' scaler (colorControls.test.ts
    // pins that string for the fragment four) — behaviour cannot drift
    // between the fragment presets and the mesh path.
    expect(M).toContain("if (control <= 1.0) { return value * control; }");
    expect(M).toContain("return min(value * control, 1.0);");
    expect(M).toContain("colorScale(0.9, m.saturation)");
    expect(M).toContain("colorScale(0.55, m.lightness)");
    // ONE authored colour per bar, so one hsl2rgb call routes everything.
    expect(M.match(/hsl2rgb\(/g)).toHaveLength(2); // definition + the call
  });
});

describe("M3U ABI: struct order == pack order == spec keys", () => {
  const structBody = /struct M3U \{([\s\S]*?)\}/.exec(M)?.[1];
  const fields = [...(structBody ?? "").matchAll(/(\w+):\s*(?:mat4x4f|f32)/g)].map((m) => m[1]);

  // The renderer's own source, so the CPU pack side of the ABI is asserted
  // against the same text a reviewer reads.
  const packBlock = /const F = this\.mesh3dF32;[\s\S]*?writeBuffer\(this\.mesh3dUniform/.exec(
    rendererSrc,
  )?.[0];
  const packs = new Map(
    [...(packBlock ?? "").matchAll(/F\[(\d+)\] = ([^;]+);/g)].map((m) => [
      Number(m[1]),
      m[2].trim(),
    ]),
  );

  // Lane 16.. in pack order: [struct field, exact pack source].
  const LANES: Array<[string, string]> = [
    ["grid", "this.mesh3dSpec!.grid"],
    ["spacing", 'g("spacing")'],
    ["barWidth", 'g("barWidth")'],
    ["heightScale", 'g("heightScale")'],
    ["hue", 'g("hue")'],
    ["hueRange", 'g("hueRange")'],
    ["light", 'g("light")'],
    ["emissive", 'g("emissive")'],
    ["binCount", "f.bins.length"],
    ["time", "time"],
    ["drive", "f.drive"],
    ["driveBeat", "f.driveBeat * this.motion.pulse"],
    // The Layout param travels in the binMap lane: 'layout' is a WGSL
    // reserved word, so the struct cannot carry the param's own name. This
    // table is exactly the mismatch that would otherwise hide.
    ["binMap", 'g("layout")'],
    ["barShape", 'g("barShape")'],
    ["saturation", 'g("saturation")'],
    ["lightness", 'g("lightness")'],
    ["hueLift", 'g("hueLift")'],
    ["driveHeight", 'g("driveHeight")'],
    ["hotDrive", 'g("hotDrive")'],
    ["hotBeat", 'g("hotBeat")'],
    ["hotWindow", 'g("hotWindow")'],
    ["glowBeat", 'g("glowBeat")'],
    ["fillLight", 'g("fillLight")'],
    ["ambientLight", 'g("ambientLight")'],
    ["fogDensity", 'g("fogDensity")'],
    ["bandGlow", 'g("bandGlow")'],
    ["bass", "f.bass"],
    ["mid", "f.mid"],
    ["treble", "f.treble"],
  ];

  it("the struct declares viewProj then exactly the documented scalar lanes, in order", () => {
    expect(fields).toEqual(["viewProj", ...LANES.map(([field]) => field)]);
  });

  it("renderMesh3d packs every lane at the struct's own offset", () => {
    for (let i = 0; i < LANES.length; i++) {
      const [field, source] = LANES[i];
      const packed = packs.get(16 + i);
      expect(packed, `lane ${16 + i} (${field}) is not packed`).toBeDefined();
      // The comment-free head of the assignment must be the documented read
      // (trailing inline comments, e.g. the Pulse note, are tolerated).
      expect(packed!.startsWith(source), `lane ${field}: packs "${packed}"`).toBe(true);
    }
    expect(packs.size).toBe(LANES.length);
  });

  it("every g(...) lane resolves to a real ParamSpec (paramOr would silently 0)", () => {
    for (const [, source] of LANES) {
      const key = /^g\("(\w+)"\)$/.exec(source)?.[1];
      if (key) expect(specs.has(key), `packed key ${key} has no spec`).toBe(true);
    }
  });

  it("MESH3D_UNIFORM_SIZE is the struct's own WGSL size", () => {
    const scalarBytes = (fields.length - 1) * 4;
    const size = Math.ceil((64 + scalarBytes) / 16) * 16; // mat4 alignment
    expect(MESH3D_UNIFORM_SIZE).toBe(size);
    expect(MESH3D_UNIFORM_SIZE).toBe(192);
  });
});

describe("geometry: shared shape buffer", () => {
  const verts = cubeColumnVerts();
  const FLOATS_PER_VERT = 6;

  /** The pre-wave builder, verbatim — the box region must never move. */
  function shippedBoxVerts(): number[] {
    const faces: Array<{ n: [number, number, number]; q: Array<[number, number, number]> }> = [
      {
        n: [0, 1, 0],
        q: [
          [-0.5, 1, -0.5],
          [0.5, 1, -0.5],
          [0.5, 1, 0.5],
          [-0.5, 1, 0.5],
        ],
      },
      {
        n: [0, -1, 0],
        q: [
          [-0.5, 0, 0.5],
          [0.5, 0, 0.5],
          [0.5, 0, -0.5],
          [-0.5, 0, -0.5],
        ],
      },
      {
        n: [0, 0, 1],
        q: [
          [-0.5, 0, 0.5],
          [-0.5, 1, 0.5],
          [0.5, 1, 0.5],
          [0.5, 0, 0.5],
        ],
      },
      {
        n: [0, 0, -1],
        q: [
          [0.5, 0, -0.5],
          [0.5, 1, -0.5],
          [-0.5, 1, -0.5],
          [-0.5, 0, -0.5],
        ],
      },
      {
        n: [1, 0, 0],
        q: [
          [0.5, 0, 0.5],
          [0.5, 1, 0.5],
          [0.5, 1, -0.5],
          [0.5, 0, -0.5],
        ],
      },
      {
        n: [-1, 0, 0],
        q: [
          [-0.5, 0, -0.5],
          [-0.5, 1, -0.5],
          [-0.5, 1, 0.5],
          [-0.5, 0, 0.5],
        ],
      },
    ];
    const out: number[] = [];
    for (const f of faces) {
      const [a, b, c, d] = f.q;
      for (const v of [a, b, c, a, c, d]) out.push(v[0], v[1], v[2], f.n[0], f.n[1], f.n[2]);
    }
    return out;
  }

  it("shape 0 is the byte-identical shipped box at offset 0", () => {
    expect(MESH3D_BAR_SHAPES[0]).toEqual([0, 36]);
    expect(Array.from(verts.slice(0, 36 * FLOATS_PER_VERT))).toEqual(shippedBoxVerts());
  });

  it("the ranges tile the buffer contiguously and cover the enum", () => {
    expect(MESH3D_BAR_SHAPES).toHaveLength(3);
    let next = 0;
    let total = 0;
    for (const [first, count] of MESH3D_BAR_SHAPES) {
      expect(first).toBe(next);
      next = first + count;
      total += count;
    }
    expect(verts.length).toBe(total * FLOATS_PER_VERT);
    // One range per enum option, addressed by value.
    const shapeSpec = specs.get("barShape")!;
    expect(shapeSpec.control).toBe("enum");
    expect(shapeSpec.control === "enum" ? shapeSpec.options.length : 0).toBe(
      MESH3D_BAR_SHAPES.length,
    );
  });

  const normalAt = (v: number) => [
    verts[v * FLOATS_PER_VERT + 3],
    verts[v * FLOATS_PER_VERT + 4],
    verts[v * FLOATS_PER_VERT + 5],
  ];

  it("every normal in the buffer is unit length", () => {
    for (let v = 0; v < verts.length / FLOATS_PER_VERT; v++) {
      const [x, y, z] = normalAt(v);
      expect(Math.abs(Math.hypot(x, y, z) - 1)).toBeLessThan(1e-6);
    }
  });

  it("pyramid sides tilt up (they take the inverse-scale route); base points down", () => {
    const [first] = MESH3D_BAR_SHAPES[1];
    for (let v = first; v < first + 12; v++) {
      // normalize(cross of the 0.5-run/1-rise slope): y = 0.5/sqrt(1.25).
      expect(normalAt(v)[1]).toBeCloseTo(0.5 / Math.sqrt(1.25), 6);
    }
    for (let v = first + 12; v < first + 18; v++) {
      expect(normalAt(v)).toEqual([0, -1, 0]);
    }
  });

  it("round-column normals are all horizontal or vertical — the invariant that makes the inverse scale a direction no-op", () => {
    const [first, count] = MESH3D_BAR_SHAPES[2];
    for (let v = first; v < first + count; v++) {
      const [x, y, z] = normalAt(v);
      if (y === 0) continue; // side: horizontal
      expect(Math.abs(y)).toBe(1); // cap: vertical
      expect([x, z]).toEqual([0, 0]);
    }
  });
});

describe("param model: lenses, hints, mod metadata", () => {
  it("27 params: 12 curated + 15 advanced", () => {
    expect(spectrumScape.params).toHaveLength(12);
    expect(spectrumScape.advanced).toHaveLength(15);
    expect(allParams(spectrumScape)).toHaveLength(27);
  });

  it("the curated tier covers the mode's five lenses", () => {
    const ids = groupParams(spectrumScape, spectrumScape.params).map((v) => v.group.id);
    for (const lens of ["shape", "color", "reaction", "glow", "camera"]) {
      expect(ids, `curated tier misses ${lens}`).toContain(lens);
    }
  });

  it("every knob ships a hint", () => {
    for (const spec of allParams(spectrumScape)) {
      expect(spec.hint, `${spec.key} has no hint`).toBeTruthy();
    }
  });

  it("the enums are mod:off mode choices with three named options each", () => {
    for (const key of ["layout", "barShape"]) {
      const spec = specs.get(key)!;
      expect(spec.control).toBe("enum");
      expect(spec.mod).toBe("off");
      if (spec.control === "enum") {
        expect(spec.options).toHaveLength(3);
        expect(spec.options.map((o) => o.value)).toEqual([0, 1, 2]);
        for (const o of spec.options) expect(o.hint, `${key}/${o.label}`).toBeTruthy();
      }
    }
  });

  it("every new continuous axis stays a smooth modulation target", () => {
    for (const key of [
      "saturation",
      "lightness",
      "hueLift",
      "hotBeat",
      "bandGlow",
      "driveHeight",
      "hotDrive",
      "glowBeat",
      "hotWindow",
      "fillLight",
      "ambientLight",
      "fogDensity",
    ]) {
      expect(specs.get(key)?.mod, `${key} must stay smooth`).toBeUndefined();
    }
  });

  it("hot top fade carries the wide-ratio log taper (and a min a log can describe)", () => {
    const spec = specs.get("hotWindow")!;
    expect(spec.taper).toBe("log");
    expect(spec.min).toBeGreaterThan(0);
  });
});

describe("deck: the pre-wave seven are untouched; the new five use the territory", () => {
  const styles = spectrumScape.styles ?? [];
  const NEW_KEYS = [
    "layout",
    "barShape",
    "saturation",
    "lightness",
    "hotBeat",
    "bandGlow",
    "driveHeight",
    "hotDrive",
    "glowBeat",
    "hotWindow",
    "hueLift",
    "fillLight",
    "ambientLight",
    "fogDensity",
  ];

  it("the seven shipped styles write no new key — their device hashes cannot move", () => {
    // Untouched values + default-neutral new lanes == the pixel-identity
    // argument for the existing GPU pixel-matrix cases.
    for (const id of ["city", "street", "flyover", "topdown", "monolith", "neonGrid", "canyon"]) {
      const style = styles.find((s) => s.id === id);
      expect(style, `style ${id} went missing`).toBeDefined();
      for (const key of Object.keys(style!.values)) {
        expect(NEW_KEYS, `${id} writes new key ${key}`).not.toContain(key);
      }
    }
    expect(styles[0]?.id).toBe("city");
    expect(styles[0]?.values).toEqual({});
  });

  it("the five new identities exist", () => {
    const ids = styles.map((s) => s.id);
    for (const id of ["terrain", "galaxy", "spires", "flashpoint", "harbor"]) {
      expect(ids).toContain(id);
    }
    expect(styles).toHaveLength(12);
  });

  it("the deck exercises every enum option and both beat-response axes", () => {
    const resolved = styles.map(
      (s) => ({ ...defaultParams(spectrumScape), ...s.values }) as Record<string, number>,
    );
    expect(resolved.some((v) => v.layout === 1)).toBe(true); // rows
    expect(resolved.some((v) => v.layout === 2)).toBe(true); // spiral
    expect(resolved.some((v) => v.barShape === 1)).toBe(true); // pyramid
    expect(resolved.some((v) => v.barShape === 2)).toBe(true); // round
    expect(resolved.some((v) => v.bandGlow > 0)).toBe(true); // band response
    expect(resolved.some((v) => v.hotBeat > 0.6)).toBe(true); // beat flash
    expect(resolved.some((v) => v.glowBeat > 0.5)).toBe(true); // glow pulse
    expect(resolved.some((v) => v.fogDensity !== 0.045)).toBe(true); // fog dialled
    // The beat lead holds height steady so the flash carries the look.
    expect(resolved.some((v) => v.hotBeat >= 1.5 && v.driveHeight < 0.7)).toBe(true);
  });
});
