import { describe, expect, it } from "vitest";
import { isPerformContext } from "./context";

/** FEAT-009: the entry branch — label from the Rust window builder, or the
 * `?perform` browser-dev flag. Wrong answers here mount the full app (a
 * second store + persistence writer) inside the output window. */
describe("isPerformContext", () => {
  it("matches the Tauri window label", () => {
    expect(isPerformContext("", "perform")).toBe(true);
    expect(isPerformContext("", "main")).toBe(false);
    expect(isPerformContext("", null)).toBe(false);
  });

  it("matches the browser-dev query flag, any value", () => {
    expect(isPerformContext("?perform", null)).toBe(true);
    expect(isPerformContext("?perform=1", null)).toBe(true);
    expect(isPerformContext("?a=b&perform=1", null)).toBe(true);
    expect(isPerformContext("?performx=1", null)).toBe(false);
    expect(isPerformContext("", null)).toBe(false);
  });
});
