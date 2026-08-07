import { describe, expect, it } from "vitest";
import { MOD_ROUTE_RECIPES, recipeRoutes } from "./modRoutePresets";
import { newRouteId, postTargetKey, validModRoutes } from "./modMatrix";
import { presets } from "../render/presets";
import { allParams, isModTarget, paramSpecMap, type PresetDef } from "../render/types";

/** A visual with none of the recipes' preferred keys — exercises fallback. */
const plainPreset: PresetDef = {
  id: "test-plain",
  name: "Plain",
  params: [
    { key: "toggle", label: "Toggle", min: 0, max: 1, step: 1, default: 0, mod: "off" },
    { key: "weird", label: "Weird", min: 2, max: 9, step: 0.1, default: 3 },
  ],
  wgsl: "",
};

describe("mod route recipes (P-7)", () => {
  it("recipe ids/names are unique, and every route spec is 1-2 routes with sane amounts", () => {
    const ids = MOD_ROUTE_RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = MOD_ROUTE_RECIPES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    for (const rec of MOD_ROUTE_RECIPES) {
      expect(rec.routes.length, rec.id).toBeGreaterThanOrEqual(1);
      expect(rec.routes.length, rec.id).toBeLessThanOrEqual(2);
      for (const r of rec.routes) {
        expect(Math.abs(r.amount), rec.id).toBeLessThanOrEqual(1);
      }
    }
  });

  it("every recipe materializes valid routes on every factory preset", () => {
    for (const p of presets) {
      for (const rec of MOD_ROUTE_RECIPES) {
        const routes = recipeRoutes(rec, p, [], newRouteId);
        expect(routes.length, `${rec.id} on ${p.id}`).toBeGreaterThan(0);
        // The validator round-trips them unchanged — they are exactly what a
        // saved document would carry.
        expect(validModRoutes(routes), `${rec.id} on ${p.id}`).toEqual(routes);
        for (const r of routes) {
          if (postTargetKey(r.param)) continue; // post targets always exist
          const spec = paramSpecMap(p).get(r.param);
          expect(spec, `${rec.id} on ${p.id}: ${r.param}`).toBeDefined();
          expect(isModTarget(spec!), `${rec.id} on ${p.id}: ${r.param}`).toBe(true);
        }
      }
    }
  });

  it("prefers a matching param key when the visual has one", () => {
    const withZoom = presets.find((p) => {
      const s = paramSpecMap(p).get("zoom");
      return s !== undefined && isModTarget(s);
    });
    expect(withZoom).toBeDefined(); // fixture sanity: some factory visual has zoom
    const punch = MOD_ROUTE_RECIPES.find((r) => r.id === "kick-punch")!;
    const routes = recipeRoutes(punch, withZoom!, [], newRouteId);
    expect(routes[0].param).toBe("zoom");
  });

  it("falls back to the first modulatable param when no preference matches", () => {
    const sway = MOD_ROUTE_RECIPES.find((r) => r.id === "beat-sway")!;
    const routes = recipeRoutes(sway, plainPreset, [], newRouteId);
    // "toggle" is mod:"off" — the fallback must skip it and land on "weird".
    expect(routes).toHaveLength(1);
    expect(routes[0].param).toBe("weird");
    expect(allParams(plainPreset).find(isModTarget)!.key).toBe("weird");
  });

  it("clicking a chip twice adds nothing (dedupe by source+param)", () => {
    for (const rec of MOD_ROUTE_RECIPES) {
      const first = recipeRoutes(rec, presets[0], [], newRouteId);
      expect(recipeRoutes(rec, presets[0], first, newRouteId)).toEqual([]);
    }
  });

  it("mints a fresh unique id per route", () => {
    const punch = MOD_ROUTE_RECIPES.find((r) => r.id === "kick-punch")!;
    let n = 0;
    const routes = recipeRoutes(punch, presets[0], [], () => `id-${n++}`);
    expect(new Set(routes.map((r) => r.id)).size).toBe(routes.length);
  });
});
