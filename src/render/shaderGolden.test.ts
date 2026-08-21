import { describe, expect, it } from "vitest";
import { presets } from "./presets";
import { builder } from "./presets/builder";
import { allParams } from "./types";
import { assemblePresetModule, SHADER_SOURCES } from "./webgpuRenderer";

/**
 * Golden shader + ABI baseline — AUDIT H15 / remediation item 27, the report's
 * single highest-value item.
 *
 * The 16 fragment/compute shaders, the shared WGSL prelude, the uniform ABI and
 * each preset's param order are the hottest, least-defended code in the repo:
 * a change to any of them passes typecheck + lint + every other test and ships,
 * with a human eyeball in TESTING.md as the only gate. Multiple of the releases
 * before this file landed were visual-defect fixes.
 *
 * This freezes the EXACT WGSL compiled at runtime — the shared prelude once via
 * {@link SHADER_SOURCES}, then per preset the generated `P_<key>()` accessors +
 * body (the shared prefix is asserted and sliced off so HEADER isn't duplicated
 * 16×), plus the standalone compute/mesh/blend/post/composite sources, plus the
 * param key/default list per preset. It runs in Node with no GPU, so an
 * unintended edit fails here in well under a second with a readable diff; an
 * intended edit is re-blessed with `vitest -u` and surfaces in review as an
 * explicit shader/ABI change.
 *
 * It is deliberately NOT a pixel test — a true golden frame needs a headless
 * GPU (Dawn) and is a tracked follow-up. Shader-source and ABI drift is the
 * failure mode this catches, and it is the class behind the visual regressions
 * the audit cites.
 */
describe("shader golden baseline", () => {
  const SHARED_PREFIX = SHADER_SOURCES.header + SHADER_SOURCES.composite + SHADER_SOURCES.fsMain;

  // The strip presets PLUS the hidden classic `builder` (R2-15): it left the
  // strip but must render byte-identically forever for every old project and
  // scene that references it — precisely the surface that drifts silently
  // when no gate covers it, because no interactive path exercises it anymore.
  const covered = [...presets, builder];

  it("covers exactly the registered preset set", () => {
    // Adding or removing a preset trips this first, as a prompt to bless the
    // new snapshots deliberately rather than discovering them by surprise.
    expect(covered.map((p) => p.id)).toMatchSnapshot();
  });

  it("shared prelude + standalone shader sources are stable", () => {
    // HEADER, COMPOSITE_BODY, FS_MAIN and the compute/mesh/blend/post/scene
    // shaders that never flow through assemblePresetModule. A change to the
    // prelude here also moves every per-preset body snapshot below — this
    // snapshot names the shared cause.
    expect(SHADER_SOURCES).toMatchSnapshot();
  });

  for (const preset of covered) {
    it(`${preset.id}: accessors + body are stable`, () => {
      const full = assemblePresetModule(preset);
      // Assembly order is part of the ABI: accessors must sit between the
      // shared prelude and the preset body, or P_<key>() resolves wrong.
      expect(full.startsWith(SHARED_PREFIX)).toBe(true);
      expect(full.slice(SHARED_PREFIX.length)).toMatchSnapshot();
    });

    it(`${preset.id}: param ABI (key + default, in order) is stable`, () => {
      // Key ORDER is the ABI: P_<key>() maps to params[i] by this index, and
      // saved .bfproj/.bfpreset files address params by key. A reorder or
      // rename silently changes the render and can break saved documents, so
      // freeze the ordered list, not just the set.
      expect(allParams(preset).map((p) => ({ key: p.key, default: p.default }))).toMatchSnapshot();
    });
  }
});
