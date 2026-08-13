import { Fragment, type ReactNode } from "react";
import type { Block, DerivedKind, Inline } from "./guideContent";
import type { DerivedTables } from "./guideDerived";

/**
 * The one React renderer for the Block/Inline shapes guideContent.ts
 * describes — the in-app twin of guideMarkdown.ts's string emitter. Mirrors
 * its block()/inline() case-for-case: same discriminants, same
 * `satisfies never` exhaustiveness guard on Block (a TYPE check — there is
 * no legal runtime value that reaches the fallback, so nothing here tests
 * it at runtime; `npm run typecheck` is the guard). Where guideMarkdown.ts
 * hands derived blocks a pre-rendered markdown string, GuideBlocks renders
 * straight from the real DerivedTables data (Task 3) so a derived block
 * shows up as actual DOM elements — a <kbd> chip is a <kbd> chip here, not
 * an opaque string.
 *
 * One deliberate non-mirror: `link` renders as a non-navigating
 * `<span title>`, never an `<a href>` — see the comment on that case below.
 * guideMarkdown.ts's `link` case is untouched and still emits a real
 * markdown link for the site.
 */

/** Inline keyboard-key chip. Moved here from GuideDialog.tsx (P-21 Task 4)
 * so both the still-JSX dialog content and Block-driven content share one
 * definition; only GuideBlocks.test.tsx imports it directly — GuideDialog
 * itself only ever reaches keyboard-key chips through <GuideBlocks>. */
export function K({ k }: { k: string }) {
  return <kbd className="guide-key">{k}</kbd>;
}

type ShortcutRow = DerivedTables["shortcutSheet"][number];

function inline(part: Inline, key: number): ReactNode {
  if (typeof part === "string") return part;
  if ("kbd" in part) return <K key={key} k={part.kbd} />;
  if ("em" in part) return <em key={key}>{part.em}</em>;
  if ("strong" in part) return <strong key={key}>{part.strong}</strong>;
  if ("code" in part) return <code key={key}>{part.code}</code>;
  // NOT an <a>: the installed WebView has no opener plugin and no navigation
  // guard, so a real href would navigate the whole app away from itself with
  // no way back. guideMarkdown.ts's twin renders a real markdown link — the
  // site has a browser around it — this is the in-app-only divergence that
  // makes that safe: same data, a non-navigating span here, the href kept
  // only as a title tooltip.
  return (
    <span key={key} className="guide-link" title={part.link.href}>
      {part.link.text}
    </span>
  );
}

/** Keys are indexes: `parts` is static content, never reordered at runtime. */
const line = (parts: Inline[]): ReactNode => parts.map((part, i) => inline(part, i));

/** Groups a shortcut sheet by `group`, preserving first-seen order — the
 * same algorithm guideDerived.ts's groupShortcuts() uses for the markdown
 * twin, reimplemented here because GuideBlocks renders straight from the
 * raw DerivedTables data rather than a pre-rendered string. */
function groupShortcuts(rows: DerivedTables["shortcutSheet"]): Array<[string, ShortcutRow[]]> {
  const order: string[] = [];
  const byGroup = new Map<string, ShortcutRow[]>();
  for (const row of rows) {
    let group = byGroup.get(row.group);
    if (!group) {
      group = [];
      byGroup.set(row.group, group);
      order.push(row.group);
    }
    group.push(row);
  }
  return order.map((group) => [group, byGroup.get(group)!]);
}

function shortcutSheetBlock(rows: DerivedTables["shortcutSheet"]): ReactNode {
  return groupShortcuts(rows).map(([group, groupRows]) => (
    <Fragment key={group}>
      <h4>{group}</h4>
      {groupRows.map((row, i) => (
        <p key={i}>
          {row.keys.map((k, j) => (
            <Fragment key={j}>
              {j > 0 ? " / " : null}
              <K k={k} />
            </Fragment>
          ))}
          {` — ${row.action}`}
          {row.note ? ` (${row.note})` : null}
        </p>
      ))}
    </Fragment>
  ));
}

function modSourcesBlock(sources: DerivedTables["modSources"]): ReactNode {
  return (
    <ul>
      {sources.map((s) => (
        <li key={s.id}>
          <strong>{s.label}</strong>
        </li>
      ))}
    </ul>
  );
}

function prefsTabsBlock(tabs: DerivedTables["prefsTabs"]): ReactNode {
  return (
    <ul>
      <li>
        {tabs.map((t, i) => (
          <Fragment key={i}>
            {i > 0 ? " · " : null}
            <strong>{t.label}</strong>
          </Fragment>
        ))}
      </li>
    </ul>
  );
}

function derivedBlock(kind: DerivedKind, tables: DerivedTables): ReactNode {
  if (kind === "shortcut-sheet") return shortcutSheetBlock(tables.shortcutSheet);
  if (kind === "mod-sources") return modSourcesBlock(tables.modSources);
  if (kind === "preferences-tabs") return prefsTabsBlock(tables.prefsTabs);
  // Exhaustiveness: a new DerivedKind fails typecheck here, not silently.
  return kind satisfies never;
}

function block(b: Block, key: number, derived: DerivedTables): ReactNode {
  if ("h4" in b) return <h4 key={key}>{b.h4}</h4>;
  if ("p" in b) return <p key={key}>{line(b.p)}</p>;
  if ("ul" in b)
    return (
      <ul key={key}>
        {b.ul.map((li, i) => (
          <li key={i}>{line(li)}</li>
        ))}
      </ul>
    );
  if ("ol" in b)
    return (
      <ol key={key}>
        {b.ol.map((li, i) => (
          <li key={i}>{line(li)}</li>
        ))}
      </ol>
    );
  if ("derived" in b) return <Fragment key={key}>{derivedBlock(b.derived, derived)}</Fragment>;
  // Exhaustiveness: a new Block kind fails typecheck here, not silently.
  return b satisfies never;
}

export function GuideBlocks(props: {
  blocks: readonly Block[];
  derived: DerivedTables;
}): ReactNode {
  return <>{props.blocks.map((b, i) => block(b, i, props.derived))}</>;
}
