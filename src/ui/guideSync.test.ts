// @vitest-environment jsdom
// guideDerived.ts (via derivedMarkdown -> derivedTables -> PREFS_TABS) pulls
// in SettingsDialog.tsx, which imports the zustand store — store.ts reads
// localStorage at module scope, so anything that reaches PREFS_TABS
// transitively needs a DOM environment. Plain node (vitest's default here)
// throws "localStorage is not defined" at import time, not at a normal
// assertion — same gotcha guideDerived.test.ts documents.
import { describe, expect, it } from "vitest";
import { GUIDE } from "./guideContent";
import { guideToMarkdown } from "./guideMarkdown";
import { derivedMarkdown } from "./guideDerived";

describe("docs/guide.md is generated, never hand-edited", () => {
  it("matches the committed file byte-for-byte", async () => {
    // Regenerate with `npm run build:guide` (vitest -u on THIS file only) —
    // the same bless idiom as test:gpu:update and the shader goldens.
    await expect(guideToMarkdown(GUIDE, derivedMarkdown())).toMatchFileSnapshot(
      "../../docs/guide.md",
    );
  });
});
