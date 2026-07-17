import { describe, expect, it } from "vitest";
import { stemRoutesFor, STEM_ROLES } from "./stemRouting";
import type { ParamSpec } from "../render/types";

const spec = (key: string): ParamSpec => ({
  key,
  label: key,
  min: 0,
  max: 1,
  step: 0.01,
  default: 0.5,
});

let n = 0;
const id = () => `r${n++}`;

describe("stemRoutesFor", () => {
  it("wires each role to its best-matching param and never reuses one", () => {
    const params = [
      spec("beatPulse"), // kick -> exact
      spec("bgGlow"), // bass -> exact
      spec("beatFlash"), // snare -> exact
      spec("sparkle"), // hat (snare also lists sparkle, but snare took beatFlash)
      spec("hue"), // mid
    ];
    n = 0;
    const routes = stemRoutesFor("stem1", params, id);
    const byBand = Object.fromEntries(routes.map((r) => [r.source, r.param]));
    expect(byBand["stem1:kick"]).toBe("beatPulse");
    expect(byBand["stem1:bass"]).toBe("bgGlow");
    expect(byBand["stem1:snare"]).toBe("beatFlash");
    expect(byBand["stem1:hat"]).toBe("sparkle");
    expect(byBand["stem1:mid"]).toBe("hue");
    // No param targeted twice
    expect(new Set(routes.map((r) => r.param)).size).toBe(routes.length);
  });

  it("skips roles with no matching param instead of inventing routes", () => {
    n = 0;
    const routes = stemRoutesFor("stem2", [spec("hue")], id);
    // Only the mid/hue role matches; the drum roles find nothing.
    expect(routes).toHaveLength(1);
    expect(routes[0].source).toBe("stem2:mid");
    expect(routes[0].param).toBe("hue");
  });

  it("avoids params already taken by existing routes", () => {
    n = 0;
    const params = [spec("beatPulse"), spec("zoom")];
    const routes = stemRoutesFor("stem1", params, id, new Set(["beatPulse"]));
    // kick can't use beatPulse (taken) -> falls to zoom
    expect(routes.find((r) => r.source === "stem1:kick")?.param).toBe("zoom");
  });

  it("amounts are within the valid -1..1 range", () => {
    for (const role of STEM_ROLES) {
      expect(role.amount).toBeGreaterThan(-1);
      expect(role.amount).toBeLessThanOrEqual(1);
    }
  });
});
