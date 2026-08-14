import { defineConfig } from "vitest/config";

/**
 * Lane-local config for the Track C candidate suite.
 *
 * The repo's own `vitest.config.ts` restricts `include` to `src/**`, so a test
 * that lives outside `src/` is invisible to `npm test` no matter how it is
 * invoked. Rather than widen the repo's include for a branch that never
 * merges as-is, the lane carries its own config. Run it from the repo root:
 *
 *   npx vitest run --config trackc-candidates/vitest.config.ts
 *
 * The include pattern is root-agnostic on purpose — it resolves the same
 * whether vitest anchors at the repo root or at this directory.
 */
export default defineConfig({
  test: {
    include: ["**/trackc-candidates/*.test.ts", "*.test.ts"],
    environment: "node",
  },
});
