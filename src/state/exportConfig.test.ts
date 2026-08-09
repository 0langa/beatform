import { describe, expect, it } from "vitest";
import { SIMPLIFIED_EXPORT_REASON } from "./exportConfig";

/**
 * G7: the export-refusal sentence has ONE literal.
 *
 * It used to have two. `App.tsx` derived its own `exportBlocked` string for
 * the top bar's Export and Batch buttons while the dialog those buttons open,
 * the store guards and the error toast used `SIMPLIFIED_EXPORT_REASON` — and
 * the two had already drifted apart by the time anyone looked ("…which isn't
 * available on this system" against "…which is unavailable on this system").
 * Nothing was broken; the copies were just no longer the same promise, which
 * is the whole F2 failure mode in miniature.
 *
 * Asserting the current text would not have caught that and will not catch it
 * again: both copies were individually correct. What has to fail is the
 * REAPPEARANCE OF A SECOND COPY, so this reads the shipping source and counts
 * where the sentence can be spelled.
 *
 * The three rules below are chosen so that any way of re-inlining it trips at
 * least one:
 *   1. an exact copy-paste of the constant             -> rule 1
 *   2. a re-worded copy (what actually happened: same
 *      opening, different tail)                        -> rule 2
 *   3. a completely fresh sentence under the old name  -> rule 3
 *
 * Test files are excluded on purpose: they legitimately quote the sentence
 * (`store.test.ts`, `simplifiedRenderer.test.tsx`), and the invariant is about
 * what SHIPS. That exclusion is also what lets this file name the needles
 * without matching itself.
 */

/** The distinctive opening of the sentence. Deliberately not the whole
 * string — the copy that drifted differed only in its last four words — and
 * deliberately narrower than "hardware rendering (WebGPU)", which eight other
 * surfaces (Batch, Timeline transitions, Post, the shader editor…) each say in
 * their own words about their own feature. */
const SENTENCE_OPENING = "Video export needs hardware rendering";

/** The one file allowed to spell it. */
const OWNER = "/src/state/exportConfig.ts";

/**
 * Every shipping `.ts`/`.tsx` under `src/`, as (path, source text). Read with
 * vite's own `?raw` glob rather than `node:fs` — this project's tsconfig has
 * no `@types/node`, and the glob is resolved by the same bundler that decides
 * what ships.
 */
function shippingSources(): Array<[string, string]> {
  const all = import.meta.glob("/src/**/*.{ts,tsx}", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;
  return Object.entries(all).filter(([path]) => !/\.test\.tsx?$/.test(path));
}

describe("the export-refusal sentence has one definition (G7)", () => {
  const sources = shippingSources();

  it("reads a real tree — the walk is not silently matching nothing", () => {
    // Without this the three scans below pass trivially on a broken walk.
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.map(([p]) => p)).toContain(OWNER);
    expect(sources.map(([p]) => p)).toContain("/src/ui/ExportDialog.tsx");
    // …and no test file leaked in, which would make the exclusion a no-op.
    expect(sources.filter(([p]) => p.includes(".test."))).toEqual([]);
  });

  it("rule 1: nothing outside exportConfig.ts contains the constant's text", () => {
    const copies = sources
      .filter(([path, text]) => path !== OWNER && text.includes(SIMPLIFIED_EXPORT_REASON))
      .map(([path]) => path);
    expect(copies).toEqual([]);
  });

  it("rule 2: nothing outside exportConfig.ts re-words it either", () => {
    const copies = sources
      .filter(([path, text]) => path !== OWNER && text.includes(SENTENCE_OPENING))
      .map(([path]) => path);
    expect(copies).toEqual([]);
    // The needle is only useful if the owner actually carries it.
    expect(SIMPLIFIED_EXPORT_REASON.startsWith(SENTENCE_OPENING)).toBe(true);
  });

  it("rule 3: whoever derives `exportBlocked` reads the constant", () => {
    // Keyed on the derivation's NAME rather than on App.tsx, so the guard
    // survives the top bar being extracted into its own component: the name
    // travels with the code. A fresh literal written under that name — the one
    // shape rules 1 and 2 would miss — has to drop the import to compile.
    const derivers = sources.filter(([, text]) => text.includes("exportBlocked"));
    expect(derivers.map(([path]) => path)).not.toEqual([]);
    const unwired = derivers
      .filter(([, text]) => !text.includes("SIMPLIFIED_EXPORT_REASON"))
      .map(([path]) => path);
    expect(unwired).toEqual([]);
  });
});
