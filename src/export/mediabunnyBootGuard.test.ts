import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * R2-35 regression guard (v2.108 review F4): mediabunny is ~511 KB of codec
 * stack that the boot graph must not pay for. The lane lazified its three
 * eager import sites (decodeLenient's fallback, videoBg's frame decoder,
 * videoExporter's inline path) to dynamic `import()`; nothing pins that, so
 * one careless `import { … } from "mediabunny"` silently re-adds the whole
 * chunk to startup.
 *
 * The guard is an import-form scan rather than a bundle-size assertion: chunk
 * sizes move with every dependency bump, but the import FORM is exactly the
 * thing the fix changed. Allowed static importers:
 *  - exportCore.ts — runs only inside the export worker bundle, which is
 *    fetched lazily at export start; a static import there never touches the
 *    window's boot graph.
 *  - exportWorker.ts — the worker entry itself, same bundle.
 *  - *.test.ts — vitest runs in Node; no boot graph exists.
 * `import type` is erased at compile time and allowed everywhere.
 */
const SRC = path.resolve(__dirname, "..");
const ALLOWED = new Set(["export/exportCore.ts", "export/exportWorker.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("mediabunny stays out of the boot graph (R2-35 guard)", () => {
  it("no runtime-static mediabunny import outside the export worker bundle", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).replace(/\\/g, "/");
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      // Static runtime forms: `import { x } from "mediabunny"`,
      // `import * as m from "mediabunny"`, bare `import "mediabunny"`,
      // `export { x } from "mediabunny"`. `import type` is erased and fine;
      // dynamic `import("mediabunny")` is the lazified form and fine.
      const staticImport =
        /(^|\n)\s*(import(?!\s+type)[^;]*?from\s*["']mediabunny["']|import\s*["']mediabunny["']|export[^;]*?from\s*["']mediabunny["'])/m;
      if (staticImport.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("the guard itself can see mediabunny imports (non-vacuity)", () => {
    const text = readFileSync(path.join(SRC, "export", "exportCore.ts"), "utf8");
    expect(/from\s*["']mediabunny["']/.test(text)).toBe(true);
  });
});
