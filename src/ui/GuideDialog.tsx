import { useState } from "react";
import { useFocusTrap } from "./useFocusTrap";
import { IconClose } from "./Icons";
import { GuideBlocks } from "./GuideBlocks";
import { GUIDE } from "./guideContent";
import { derivedTables } from "./guideDerived";

/**
 * The in-app user guide: a table of contents on the left, one readable
 * section at a time on the right. All of the actual content lives as DATA in
 * `GUIDE` (src/ui/guideContent.ts) — this file only renders it, through
 * GuideBlocks, and only owns the dialog shell (focus trap, TOC, pager).
 * guideMarkdown.ts's guideToMarkdown() renders that exact same GUIDE data
 * into docs/guide.md. docs/guide.md is no longer a separate, terser
 * reference — it is the same guide, generated. Content changes belong in
 * guideContent.ts, never hand-edited here or in docs/guide.md.
 */
export interface GuideDialogProps {
  onClose: () => void;
}

export function GuideDialog({ onClose }: GuideDialogProps) {
  const trapRef = useFocusTrap(true); // GD2: same H17 machinery as every modal
  const [activeId, setActiveId] = useState(GUIDE[0].id);
  const active = GUIDE.find((s) => s.id === activeId) ?? GUIDE[0];
  const idx = GUIDE.indexOf(active);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={trapRef}
        tabIndex={-1}
        className="modal guide-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="User guide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <span className="panel-heading">User guide</span>
          <button className="icon-btn subtle" aria-label="Close" onClick={onClose}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="guide-body">
          <nav className="guide-toc" aria-label="Guide sections">
            {GUIDE.map((s, i) => (
              <button
                key={s.id}
                className={`guide-toc-item ${s.id === activeId ? "active" : ""}`}
                aria-current={s.id === activeId ? "true" : undefined}
                onClick={() => setActiveId(s.id)}
              >
                <span className="guide-toc-num">{i + 1}</span>
                {s.title}
              </button>
            ))}
          </nav>
          <div className="guide-content" key={active.id}>
            <h3>{active.title}</h3>
            <GuideBlocks blocks={active.blocks} derived={derivedTables()} />
            <div className="guide-pager">
              {idx > 0 ? (
                <button className="ghost-btn" onClick={() => setActiveId(GUIDE[idx - 1].id)}>
                  ← {GUIDE[idx - 1].title}
                </button>
              ) : (
                <span />
              )}
              {idx < GUIDE.length - 1 && (
                <button className="ghost-btn" onClick={() => setActiveId(GUIDE[idx + 1].id)}>
                  {GUIDE[idx + 1].title} →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
