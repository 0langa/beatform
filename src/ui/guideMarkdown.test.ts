import { describe, expect, it } from "vitest";
import { guideToMarkdown } from "./guideMarkdown";
import { GUIDE_FIXTURE } from "./guideContent";

const derived = { render: (kind: string) => `<!-- derived:${kind} -->` };

describe("guideToMarkdown", () => {
  it("emits the banner, one H2 per section, and inline marks", () => {
    const md = guideToMarkdown(GUIDE_FIXTURE, derived);
    expect(
      md.startsWith(
        "<!-- GENERATED from src/ui/guideContent.ts — edit that, then `npm run build:guide`. -->",
      ),
    ).toBe(true);
    expect(md).toContain("# User guide");
    // kbd renders as inline HTML (Pages renders it; no md pipeline needed)
    expect(md).toContain("<kbd>Space</kbd>");
    expect(md).toContain("*emphasis*");
    expect(md).toContain("**strong**");
    expect(md).toContain("`code`");
    expect(md).toContain("[link text](https://example.invalid)");
  });
  it("slugs headings from section ids, not titles", () => {
    const md = guideToMarkdown(GUIDE_FIXTURE, derived);
    // Jekyll auto-ids come from heading TEXT; we emit an explicit anchor so
    // retitling never moves an inbound link.
    expect(md).toContain('<a id="start"></a>');
  });
  it("delegates derived blocks", () => {
    const md = guideToMarkdown(GUIDE_FIXTURE, derived);
    expect(md).toContain("<!-- derived:mod-sources -->");
  });
  it("renders lists with one item per line", () => {
    const md = guideToMarkdown(GUIDE_FIXTURE, derived);
    expect(md).toMatch(/^- .+$/m);
    expect(md).toMatch(/^1\. .+$/m);
  });
});
