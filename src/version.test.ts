import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { APP_VERSION } from "./version";

/**
 * AUDIT H1 guard. `src/version.ts` is the fifth version file and the only one
 * nothing checks — it silently drifted ten releases stale (shipped 2.28.1
 * through 2.36.1 while the Help modal and every written project file claimed
 * 2.28.1). It is bumped by hand each release; this pins it to package.json so a
 * missed bump fails CI instead of shipping a wrong version into user files.
 */
describe("app version", () => {
  it("matches package.json (bump both together — see version.ts)", () => {
    expect(APP_VERSION).toBe(pkg.version);
  });
});
