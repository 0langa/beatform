import { describe, expect, it } from "vitest";
import { GUIDE } from "./guideContent";

/**
 * Declared limits the guide must keep saying out loud. A DECLARE verdict
 * (BACKLOG half-done inventory) documents a by-design limit where the user
 * meets it; this pins that the sentence is still there, so a later rewrite of
 * the section cannot silently drop the declaration.
 */

/** Every string inside a section's blocks, whatever the inline shape. */
function sectionText(id: string): string {
  const section = GUIDE.find((s) => s.id === id);
  if (!section) throw new Error(`no guide section "${id}"`);
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(section.blocks);
  return out.join("");
}

describe("HD-11 — .srt is read-only, declared where lyrics import/export is explained", () => {
  it("the lyrics section says .srt imports, every save writes .lrc, and what the conversion loses", () => {
    const text = sectionText("overlays");
    expect(text).toMatch(/\.srt/);
    expect(text).toMatch(/no SRT export/i);
    expect(text).toMatch(/explicit end/i); // the one thing LRC cannot carry
    // The editor's save button is described as .lrc regardless of the source.
    expect(text).toMatch(/Save \.lrc/);
    expect(text).toMatch(/even when the lyrics came in as \.srt/i);
  });
});
