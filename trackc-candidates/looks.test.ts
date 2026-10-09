import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOOK_ENTRIES, toUserPreset, type LookEntry } from "./looks";
import {
  parseUserPreset,
  serializeUserPreset,
  USER_PRESET_VERSION,
} from "../src/state/userPresets";
import { sanitizeSync } from "../src/audio/types";
import { presetById } from "../src/render/presets";
import { allParams, type ParamSpec } from "../src/render/types";
import { APP_VERSION } from "../src/version";

/**
 * Track C2 / C3 evidence suite. Same contract as candidates.test.ts, one
 * format down: emit the `.bfpreset` files, then prove each one survives
 * `parseUserPreset` losslessly and that every authored number is legal.
 *
 * The load-bearing extra here is the BASE check. A C2 entry is a delta over a
 * seed that lives in another repo; the only in-repo record of what those seeds
 * actually contain is `scripts/gallery-seed-shots.mjs`, the harness that
 * produced them. So this file reads that script, recovers its `LOOKS` array,
 * and asserts every `base` in looks.ts still equals the live seed key for key.
 * Without it a delta could quietly be proposed against a copy that has drifted,
 * and the diff the owner approves would not be the diff that lands.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "looks");
const SEED_SCRIPT = join(HERE, "..", "scripts", "gallery-seed-shots.mjs");

const filePath = (id: string) => join(OUT_DIR, `${id}.bfpreset`);

function onGrid(value: number, spec: ParamSpec): boolean {
  const steps = (value - spec.min) / spec.step;
  return Math.abs(Math.round(steps) - steps) < 1e-6;
}

function specMap(presetId: string): Map<string, ParamSpec> {
  return new Map(allParams(presetById(presetId)).map((p) => [p.key, p]));
}

/**
 * Recover the seed harness's `LOOKS` array. It is a module-private `const` in
 * a script with no exports, so the literal is sliced out and evaluated —
 * scoped to a test, over a file from this same repo, and the alternative
 * (a hand-copied second source of truth with nothing checking it) is exactly
 * the failure this test exists to prevent.
 */
function liveSeeds(): Array<{ id: string; mode: string; params: Record<string, number> }> {
  const src = readFileSync(SEED_SCRIPT, "utf8");
  const start = src.indexOf("const LOOKS = [");
  expect(start, "the seed harness no longer declares LOOKS").toBeGreaterThan(-1);
  const open = src.indexOf("[", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  expect(end, "could not find the end of the LOOKS array").toBeGreaterThan(open);
  return new Function(`return ${src.slice(open, end)}`)();
}

const each = LOOK_ENTRIES.map((e) => [`${e.track} ${e.name}`, e] as const);
const merged = (e: LookEntry) => ({ ...(e.base ?? {}), ...e.delta });

beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const e of LOOK_ENTRIES) {
    writeFileSync(filePath(e.id), serializeUserPreset(toUserPreset(e)) + "\n");
  }
});

describe("Track C2/C3 look entries", () => {
  it("covers all nine live looks plus the C3 seeds", () => {
    const c2 = LOOK_ENTRIES.filter((e) => e.track === "C2");
    expect(c2.length, "the pass must look at every live look, even to decline").toBe(9);
    expect(LOOK_ENTRIES.filter((e) => e.track === "C3").length).toBeGreaterThanOrEqual(1);
    const ids = LOOK_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of LOOK_ENTRIES) {
      expect(e.id, `"${e.id}" is not a legal gallery id`).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("every C2 base still equals the live seed it deltas", () => {
    const live = new Map(liveSeeds().map((s) => [s.id, s]));
    for (const e of LOOK_ENTRIES) {
      if (e.track !== "C2") continue;
      const seed = live.get(e.id);
      expect(seed, `no live seed called "${e.id}"`).toBeDefined();
      expect(seed!.mode, `${e.id}: mode drifted`).toBe(e.presetId);
      expect(e.base, `${e.id}: base drifted from the seed harness`).toEqual(seed!.params);
    }
  });

  it("C3 entries land on modes with no gallery look at all", () => {
    const live = new Set(liveSeeds().map((s) => s.mode));
    for (const e of LOOK_ENTRIES) {
      if (e.track !== "C3") continue;
      expect(live.has(e.presetId), `${e.id}: ${e.presetId} already has a gallery look`).toBe(false);
    }
  });

  it.each(each)("%s: the emitted .bfpreset parses back with nothing dropped", (_n, e) => {
    const parsed = parseUserPreset(readFileSync(filePath(e.id), "utf8"));
    const authored = toUserPreset(e);
    // `id` is deliberately excluded: parseUserPreset mints a fresh one on every
    // import so a double-import cannot collide. Everything else must survive.
    expect({ ...parsed, id: "" }).toEqual({ ...authored, id: "" });
    expect(parsed.params).toEqual(merged(e));
    expect(parsed.sync).toEqual(sanitizeSync(e.sync));
  });

  it.each(each)("%s: the emitted envelope is the current format", (_n, e) => {
    const file = JSON.parse(readFileSync(filePath(e.id), "utf8"));
    expect(file.kind).toBe("bfpreset");
    expect(file.schemaVersion).toBe(USER_PRESET_VERSION);
    expect(file.appVersion).toBe(APP_VERSION);
  });

  it.each(each)("%s: every param exists, fits and sits on the step grid", (_n, e) => {
    const preset = presetById(e.presetId);
    expect(preset.id, `unknown mode "${e.presetId}"`).toBe(e.presetId);
    const specs = specMap(e.presetId);
    for (const [key, value] of Object.entries(merged(e))) {
      const spec = specs.get(key);
      expect(spec, `${e.id}: unknown param "${key}"`).toBeDefined();
      expect(value, `${e.id}: ${key} below min`).toBeGreaterThanOrEqual(spec!.min);
      expect(value, `${e.id}: ${key} above max`).toBeLessThanOrEqual(spec!.max);
      expect(
        onGrid(value, spec!),
        `${e.id}: ${key} = ${value} is off the ${spec!.step} step grid`,
      ).toBe(true);
      if (spec!.control === "toggle") expect([0, 1]).toContain(value);
      if (spec!.control === "enum") {
        expect(
          spec!.options.map((o) => o.value),
          `${e.id}: ${key} = ${value}`,
        ).toContain(value);
      }
    }
  });

  it.each(each)("%s: commits to a sync feel and says why it exists", (_n, e) => {
    // Not one of the nine live looks carries sync; every entry in this pass
    // must, or the pass has not used the second of its two axes.
    expect(e.sync.mode).toBeTruthy();
    expect(e.description.length).toBeGreaterThan(60);
    expect(e.description.length).toBeLessThanOrEqual(500);
    expect(e.note.length, "the veto sheet needs an argument, not a label").toBeGreaterThan(200);
  });

  it.each(each.filter(([, e]) => e.track === "C2"))("%s: is a delta, not a rewrite", (_n, e) => {
    // ADDING is free — that is the whole point of the pass, and Track B put
    // fifteen new params on one of these modes. OVERWRITING is what turns a
    // delta into a rewrite, so only keys the seed already carries are counted.
    const overwritten = Object.keys(e.delta).filter(
      (k) => k in e.base! && e.base![k] !== e.delta[k],
    );
    const budget = Math.ceil(Object.keys(e.base!).length * 0.4);
    expect(
      overwritten.length,
      `${e.id}: overwrites ${overwritten.length} of ${Object.keys(e.base!).length} authored keys (${overwritten.join(", ")}) — that is a rewrite`,
    ).toBeLessThanOrEqual(budget);
  });

  it.each(each.filter(([, e]) => e.track === "C2"))("%s: carries no no-op delta key", (_n, e) => {
    // A delta key set to the value the seed already holds is noise in the
    // owner's diff — it makes the proposal look bigger than it is.
    const noops = Object.keys(e.delta).filter((k) => k in e.base! && e.base![k] === e.delta[k]);
    expect(noops, `${e.id}: delta restates values the seed already has`).toEqual([]);
  });

  it("the pass actually spends Track B's ceiling raise", () => {
    // Every C2 entry except the one on the mode Track B deliberately skipped
    // must reach for at least one param its seed does not carry.
    for (const e of LOOK_ENTRIES) {
      if (e.track !== "C2" || e.presetId === "radial-burst") continue;
      const added = Object.keys(e.delta).filter((k) => !(k in e.base!));
      expect(added.length, `${e.id} adds no new parameter at all`).toBeGreaterThan(0);
    }
  });
});
