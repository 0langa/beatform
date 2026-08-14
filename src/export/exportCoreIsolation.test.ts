import { describe, expect, it } from "vitest";
import exportCoreSource from "./exportCore.ts?raw";

/**
 * Determinism law / PLAN-BUNDLE global constraint: exportCore.ts must not
 * gain imports from UI or services modules. The export worker has no panel —
 * it runs headless (a worker thread, or the CLI path) with no DOM, no React
 * tree and no live render loop behind it, so anything pulled in from
 * src/ui/* or state/services.ts would be reaching for machinery that is not
 * there. H9 is the case this guards most directly: services.ts now owns a
 * published Map of live route values (getLiveRouteValues, PerfOverlay-style)
 * for the Modulation page's meters, and that publish is meaningless off the
 * live loop — exportCore.ts must keep resolving every route through
 * applyMods/applyPostMods with its OWN per-run ModEvalState, never through
 * anything services.ts exposes.
 *
 * A source-text guard, not a runtime one — the ?raw import reads the file as
 * TEXT (this app's tsconfig carries no node types, the same reason
 * ModMeters.test.tsx's T19 block reads UI sources this way): an import that
 * happens to go unused would still be the wrong thing to add, and a
 * behavioral test could not tell the difference between "never imported" and
 * "imported but not exercised by this particular job".
 */

/** Code only, comments stripped first — matching ModMeters.test.tsx's T19
 *  guard, so a future doc-comment that merely NAMES a "../ui/..." or
 *  "../state/services" path (explaining why it must stay absent, say) can
 *  never trip this on prose instead of an actual import. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("exportCore.ts isolation (determinism law)", () => {
  const code = stripComments(exportCoreSource);

  it("imports nothing from state/services", () => {
    expect(exportCoreSource.length).toBeGreaterThan(1000); // the read is live, not an empty stub
    // General guard: any specifier ending in "/services" right before the
    // closing quote, whatever relative depth it's spelled from.
    expect(code).not.toMatch(/from\s+["'][^"']*\/services["']/);
    // The literal path it would take today (src/export/ -> src/state/
    // services.ts), spelled out for a reader — the regex above is the actual
    // guard, this pins the concrete case a future refactor might reach for.
    expect(code).not.toContain('"../state/services"');
  });

  it("imports nothing from src/ui", () => {
    expect(code).not.toMatch(/from\s+["'][^"']*\/ui\//);
  });
});
