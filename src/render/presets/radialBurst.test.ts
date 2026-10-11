import { describe, expect, it } from "vitest";
import { radialBurst } from "./radialBurst";
import { allParams } from "../types";

/**
 * Radial Burst's motion clocks (3.0 feel pass). The ring's rotation has been
 * time-only since the "rotation jumping back and forth" fix; the edge-wave
 * spin joins it: its clock is u.time blended toward u.travel (the track's
 * loudness-integrated time) by Spin energy, so loud passages spin the waves
 * faster and quiet ones slower, and nothing ever runs backwards. These pins
 * fail on any return to a drive-in-phase shape.
 */
describe("radial-burst motion clocks", () => {
  const body = radialBurst.wgsl;
  const specs = new Map(allParams(radialBurst).map((p) => [p.key, p]));

  it("the edge-wave spin rides a blended clock, never a loudness offset", () => {
    expect(body).toContain(
      "let spinClock = mix(u.time, u.travel, clamp(P_spinEnergy() / 1.5, 0.0, 1.0));",
    );
    expect(body).toContain("let spin = spinClock * P_spinBase() * u.spin;");
    expect(body).not.toContain("u.drive * P_spinEnergy()");
  });

  it("the ring's rotation stays time-only and master-gated", () => {
    expect(body).toContain("+ u.time * P_rotSpeed() * TAU * 0.1 * u.spin;");
    // No audio field anywhere inside the angle the spectrum is folded on.
    const angleLine = /var a = atan2\(p\.y, p\.x\)[\s\S]*?;/.exec(body)?.[0] ?? "";
    for (const field of ["u.drive", "u.bass", "u.energy", "u.driveBeat", "beatP"]) {
      expect(angleLine, field).not.toContain(field);
    }
  });

  it("Spin energy spans the whole blend: 0 is pure time, 1.5 is pure travel", () => {
    expect(specs.get("spinEnergy")).toMatchObject({ min: 0, max: 1.5, default: 0.35 });
    const mixOf = (e: number) => Math.min(1, Math.max(0, e / 1.5));
    expect(mixOf(0)).toBe(0);
    expect(mixOf(1.5)).toBe(1);
    expect(mixOf(0.35)).toBeCloseTo(0.2333, 3);
  });
});
