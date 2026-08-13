import type { Block, DerivedKind, GuideSection, Inline } from "./guideContent";

export interface DerivedMarkdown {
  render(kind: DerivedKind): string;
}

function inline(i: Inline): string {
  if (typeof i === "string") return i;
  if ("kbd" in i) return `<kbd>${i.kbd}</kbd>`;
  if ("em" in i) return `*${i.em}*`;
  if ("strong" in i) return `**${i.strong}**`;
  if ("code" in i) return `\`${i.code}\``;
  return `[${i.link.text}](${i.link.href})`;
}

const line = (parts: Inline[]) => parts.map(inline).join("");

function block(b: Block, derived: DerivedMarkdown): string {
  if ("h4" in b) return `### ${b.h4}`;
  if ("p" in b) return line(b.p);
  if ("ul" in b) return b.ul.map((li) => `- ${line(li)}`).join("\n");
  if ("ol" in b) return b.ol.map((li, n) => `${n + 1}. ${line(li)}`).join("\n");
  if ("derived" in b) return derived.render(b.derived);
  // Exhaustiveness: a new Block kind fails typecheck here, not silently.
  return b satisfies never;
}

export function guideToMarkdown(
  sections: readonly GuideSection[],
  derived: DerivedMarkdown,
): string {
  const head =
    "<!-- GENERATED from src/ui/guideContent.ts — edit that, then `npm run build:guide`. -->\n\n" +
    "# User guide\n";
  const body = sections
    .map(
      (s) =>
        `\n<a id="${s.id}"></a>\n\n## ${s.title}\n\n` +
        s.blocks.map((b) => block(b, derived)).join("\n\n"),
    )
    .join("\n");
  return head + body + "\n";
}
