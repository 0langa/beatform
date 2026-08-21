/**
 * Lyrics correction editor (FEAT-004 phase 4) — the hero surface that turns
 * imperfect sung-vocal ASR into usable karaoke lyrics. Store-connected panel
 * (LyricsGenPanel idiom) mounted in the Text tab; works identically for
 * generated AND imported lyrics.
 *
 * Layout, built for the 280px panel: every line is one compact row
 * [time·text]; SELECTING a row (click/focus) unfolds its toolbar — nudge,
 * split/merge/insert/delete, re-align, word view. Confidence flags ride the
 * row's left edge (red <0.2 / amber <0.45 — device-calibrated bands).
 * Every edit lands in the store, so the live overlay repaints on the next
 * frame — the preview IS the state.
 */

import { useEffect, useRef, useState } from "react";
import {
  CONF_FLAG,
  CONF_WARN,
  flaggedCount,
  lineSeverity,
  lrcTimestamp,
  nextFlagged,
  parseTimeInput,
} from "../state/lyricsEdit";
import type { LyricLine } from "../state/lyrics";
import { isTauri } from "../state/platform";
import { getEngine } from "../state/services";
import { useVizStore } from "../state/store";

/** Loaded track duration, tolerating an uninitialized engine (tests). */
function trackDuration(): number {
  try {
    return getEngine().state.duration;
  } catch {
    return 0;
  }
}

/** Severity class for a row/word ("" | "warn" | "flag"). */
function confClass(conf: number | undefined): string {
  if (conf === undefined) return "";
  if (conf < CONF_FLAG) return "flag";
  if (conf < CONF_WARN) return "warn";
  return "";
}

/** A time readout that doubles as an editor: click seeks, double-click (or
 * Enter/F2 while focused) types an exact time — the SliderField idiom, in
 * mm:ss.xx. */
function TimeChip(props: {
  t: number;
  label: string;
  onSeek: () => void;
  onCommit: (t: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (draft !== null) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [draft]);
  if (draft !== null) {
    const commit = (text: string) => {
      const t = parseTimeInput(text);
      if (t !== null) props.onCommit(t);
    };
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        className="lyr-time lyr-time-input"
        aria-label={`${props.label} time`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(e.currentTarget.value);
            setDraft(null);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setDraft(null);
          }
        }}
        onBlur={(e) => {
          commit(e.currentTarget.value);
          setDraft(null);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="lyr-time"
      title={`${props.label} at ${lrcTimestamp(props.t)} — click to jump the track there, double-click to type a time`}
      onClick={props.onSeek}
      onDoubleClick={() => setDraft(lrcTimestamp(props.t))}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== "F2") return;
        e.preventDefault();
        setDraft(lrcTimestamp(props.t));
      }}
    >
      {lrcTimestamp(props.t)}
    </button>
  );
}

/** One line's text as an inline editor: commits on blur/Enter, reports its
 * caret so Split can cut exactly where the user is looking. */
function LineTextInput(props: {
  text: string;
  onCommit: (text: string) => void;
  onCaret: (pos: number) => void;
  onFocusRow: () => void;
  autoFocus: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (props.autoFocus) ref.current?.focus();
  }, [props.autoFocus]);
  return (
    <input
      ref={ref}
      type="text"
      className="lyr-text"
      placeholder="(empty — dropped on save)"
      aria-label="Line text"
      value={draft ?? props.text}
      onFocus={props.onFocusRow}
      onChange={(e) => setDraft(e.target.value)}
      onSelect={(e) => props.onCaret(e.currentTarget.selectionStart ?? 0)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur(); // blur commits
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation(); // keep the app's Escape (close panel) out of it
          setDraft(null);
        }
      }}
      onBlur={() => {
        if (draft !== null && draft !== props.text) props.onCommit(draft);
        setDraft(null);
      }}
    />
  );
}

/** The expanded per-word strip for one line, with a mini editor for the
 * selected word. */
function WordStrip(props: { line: LyricLine; lineIdx: number }) {
  const store = useVizStore.getState;
  const [sel, setSel] = useState(-1);
  const [draft, setDraft] = useState<string | null>(null);
  const words = props.line.words ?? [];
  const w = sel >= 0 && sel < words.length ? words[sel] : null;
  return (
    <div className="lyr-words">
      <div className="lyr-word-chips">
        {words.map((word, k) => (
          <button
            key={`${k}-${word.text}`}
            type="button"
            className={`lyr-word ${confClass(word.conf)} ${k === sel ? "active" : ""}`}
            title={
              `${word.text} — starts ${lrcTimestamp(word.t)}` +
              (word.conf !== undefined ? `, confidence ${(100 * word.conf).toFixed(0)}%` : "")
            }
            onClick={() => {
              setSel(k === sel ? -1 : k);
              setDraft(null);
            }}
          >
            {word.text}
          </button>
        ))}
        <button
          type="button"
          className="text-btn lyr-word-spread"
          title="Forget the word timing and space every word evenly across the line — the clean slate when the alignment came out scrambled"
          onClick={() => {
            setSel(-1);
            store().redistributeLyricWords(props.lineIdx);
          }}
        >
          ⇤⇥ even
        </button>
      </div>
      {w && (
        <div className="lyr-word-edit">
          <input
            type="text"
            className="lyr-text lyr-word-text"
            aria-label="Word text"
            value={draft ?? w.text}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setDraft(null);
              }
            }}
            onBlur={() => {
              if (draft !== null && draft !== w.text) {
                store().editLyricWord(props.lineIdx, sel, draft);
                // Word count may have changed (split/removed) — drop selection.
                setSel(-1);
              }
              setDraft(null);
            }}
          />
          <button
            type="button"
            className="lyr-nudge"
            title="Word starts 50 ms earlier (Shift: 10 ms)"
            onClick={(e) => store().nudgeLyricWord(props.lineIdx, sel, e.shiftKey ? -0.01 : -0.05)}
          >
            −
          </button>
          <TimeChip
            t={w.t}
            label={`Word "${w.text}"`}
            onSeek={() => store().seekEnd(w.t)}
            onCommit={(t) => store().setLyricWordTime(props.lineIdx, sel, t)}
          />
          <button
            type="button"
            className="lyr-nudge"
            title="Word starts 50 ms later (Shift: 10 ms)"
            onClick={(e) => store().nudgeLyricWord(props.lineIdx, sel, e.shiftKey ? 0.01 : 0.05)}
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}

export function LyricsEditPanel() {
  const lyrics = useVizStore((s) => s.lyrics);
  const undoDepth = useVizStore((s) => s.lyricsEditUndoDepth);
  const redoDepth = useVizStore((s) => s.lyricsEditRedoDepth);
  const realign = useVizStore((s) => s.lyricsRealign);
  const genPhase = useVizStore((s) => s.lyricsGen.phase);
  const genModels = useVizStore((s) => s.lyricsGen.models);
  const store = useVizStore.getState;
  const [sel, setSel] = useState(-1);
  const [wordsOpen, setWordsOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const caretRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const desktop = isTauri();

  // One-shot focus request (freshly inserted line): clear it right after the
  // row's input picked it up, or every later re-render would re-focus.
  useEffect(() => {
    if (focusIdx < 0) return;
    const id = requestAnimationFrame(() => setFocusIdx(-1));
    return () => cancelAnimationFrame(id);
  }, [focusIdx]);

  if (!lyrics || lyrics.length === 0) {
    return (
      <p className="section-hint">
        Import or generate lyrics above — every line becomes editable here: fix the words the
        transcriber misheard, nudge times, and save the corrected .lrc.
      </p>
    );
  }

  const selectRow = (i: number) => {
    if (i !== sel) {
      setSel(i);
      setWordsOpen(false);
    }
  };
  const jumpTo = (i: number) => {
    selectRow(i);
    const el = listRef.current?.querySelector(`[data-lyr-row="${i}"]`);
    el?.scrollIntoView({ block: "nearest" });
  };

  // Re-align availability (desktop feature; graceful reasons otherwise).
  const alignModelsReady =
    genModels != null &&
    ["mdx-voc-ft", "wav2vec2-align", "wav2vec2-vocab"].every(
      (id) => genModels.models.find((m) => m.id === id)?.installed,
    );
  const realignWhy = !desktop
    ? "Re-align needs the desktop app"
    : trackDuration() <= 0
      ? "Load the track first — re-align listens to the audio"
      : !alignModelsReady
        ? "Needs the lyrics models — download them under Lyrics above"
        : genPhase !== "idle"
          ? "Wait for the running lyrics job"
          : null;

  // R2-21: while a line re-align is in flight, structural edits (split/merge/
  // insert/delete) would renumber the lines under the sidecar's await — the
  // apply guard matches index+text (lyricsEditActions.ts), and a renumbered
  // sheet can put a DIFFERENT line with identical text (repeated chorus
  // lines) at the awaited index. Locked the same way the align buttons
  // already disable; text and time edits stay allowed — an edit to the
  // awaited line changes its text and correctly voids the apply.
  const structuralLocked = realign !== null;
  const structuralWhy = structuralLocked
    ? "Wait for the running line re-align — adding or removing lines would confuse it"
    : null;

  const flagged = flaggedCount(lyrics);
  const wordCount = lyrics.reduce((n, l) => n + (l.words?.length ?? 0), 0);

  return (
    <div
      className="lyrics-edit"
      onKeyDown={(e) => {
        // Editor-local undo/redo — but never over a text field, whose own
        // native undo must keep working while typing (the app-shortcut rule).
        const el = e.target as HTMLElement;
        const typing = el.tagName === "INPUT" && (el as HTMLInputElement).type === "text";
        if (typing || !(e.ctrlKey || e.metaKey)) return;
        if (e.key === "z" || e.key === "Z") {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) store().redoLyricsEdit();
          else store().undoLyricsEdit();
        } else if (e.key === "y" || e.key === "Y") {
          e.preventDefault();
          e.stopPropagation();
          store().redoLyricsEdit();
        }
      }}
    >
      <div className="lyr-head">
        <span className="lyr-count" title="Lines · timed words · flagged lines">
          {lyrics.length} lines
          {wordCount > 0 ? ` · ${wordCount} words` : ""}
          {flagged > 0 ? ` · ${flagged} flagged` : ""}
        </span>
        <span className="lyr-head-btns">
          {flagged > 0 && (
            <button
              type="button"
              className="text-btn"
              title="Jump to the next line the aligner wasn't sure about (red = probably wrong, amber = worth a listen)"
              onClick={() => {
                const i = nextFlagged(lyrics, sel);
                if (i >= 0) jumpTo(i);
              }}
            >
              ⚑ next
            </button>
          )}
          <button
            type="button"
            className="text-btn"
            disabled={undoDepth === 0}
            title="Undo the last lyric edit (Ctrl+Z inside this editor)"
            onClick={() => store().undoLyricsEdit()}
          >
            ↶
          </button>
          <button
            type="button"
            className="text-btn"
            disabled={redoDepth === 0}
            title="Redo (Ctrl+Y)"
            onClick={() => store().redoLyricsEdit()}
          >
            ↷
          </button>
          <button
            type="button"
            className="text-btn"
            title="Save the corrected lyrics as an .lrc file — word timing included where present"
            onClick={() => void store().exportLyricsLrc()}
          >
            Save .lrc
          </button>
        </span>
      </div>
      <div className="lyr-list" ref={listRef}>
        {lyrics.map((line, i) => {
          const sev = lineSeverity(line);
          const active = i === sel;
          const aligning = realign?.index === i;
          return (
            <div
              key={i}
              data-lyr-row={i}
              className={`lyr-row ${sev ?? ""} ${active ? "active" : ""}`}
              title={
                sev && line.conf !== undefined
                  ? `Aligner confidence ${(100 * line.conf).toFixed(0)}% — ${
                      sev === "flag" ? "probably needs fixing" : "worth a listen"
                    }`
                  : undefined
              }
            >
              <div className="lyr-row-main">
                <TimeChip
                  t={line.t}
                  label="Line"
                  onSeek={() => {
                    selectRow(i);
                    store().seekEnd(line.t);
                  }}
                  onCommit={(t) => store().setLyricLineTime(i, t)}
                />
                <LineTextInput
                  text={line.text}
                  autoFocus={focusIdx === i}
                  onFocusRow={() => selectRow(i)}
                  onCaret={(pos) => (caretRef.current = pos)}
                  onCommit={(text) => store().editLyricLineText(i, text)}
                />
                {line.words && line.words.length > 0 && (
                  <button
                    type="button"
                    className={`lyr-chevron ${active && wordsOpen ? "open" : ""}`}
                    title="Per-word timing — edit, nudge or respace the karaoke words"
                    aria-label="Toggle word view"
                    aria-expanded={active && wordsOpen}
                    onClick={() => {
                      selectRow(i);
                      setWordsOpen(i === sel ? !wordsOpen : true);
                    }}
                  >
                    ▸
                  </button>
                )}
              </div>
              {active && (
                <div className="lyr-tools">
                  <button
                    type="button"
                    className="lyr-nudge"
                    title="Line starts 100 ms earlier (Shift: 10 ms) — its words move with it"
                    onClick={(e) => store().nudgeLyricLine(i, e.shiftKey ? -0.01 : -0.1)}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="lyr-nudge"
                    title="Line starts 100 ms later (Shift: 10 ms)"
                    onClick={(e) => store().nudgeLyricLine(i, e.shiftKey ? 0.01 : 0.1)}
                  >
                    +
                  </button>
                  <span className="lyr-tool-gap" />
                  <button
                    type="button"
                    className="text-btn"
                    disabled={structuralLocked || line.text.trim().split(/\s+/).length < 2}
                    title={
                      structuralWhy ??
                      "Split this line in two at the text cursor (words keep their timing)"
                    }
                    onClick={() => {
                      store().splitLyricLine(
                        i,
                        caretRef.current || Math.ceil(line.text.length / 2),
                      );
                    }}
                  >
                    ✂
                  </button>
                  <button
                    type="button"
                    className="text-btn"
                    disabled={structuralLocked || i + 1 >= lyrics.length}
                    title={
                      structuralWhy ??
                      "Merge with the next line (word timing survives when both lines have it)"
                    }
                    onClick={() => store().mergeLyricLineWithNext(i)}
                  >
                    ⤵
                  </button>
                  <button
                    type="button"
                    className="text-btn"
                    disabled={structuralLocked}
                    title={structuralWhy ?? "Insert an empty line above this one"}
                    onClick={() => {
                      store().insertLyricLineAfter(i - 1);
                      setFocusIdx(i);
                    }}
                  >
                    +↑
                  </button>
                  <button
                    type="button"
                    className="text-btn"
                    disabled={structuralLocked}
                    title={structuralWhy ?? "Insert an empty line below this one"}
                    onClick={() => {
                      store().insertLyricLineAfter(i);
                      setSel(i + 1);
                      setFocusIdx(i + 1);
                    }}
                  >
                    +↓
                  </button>
                  <button
                    type="button"
                    className="text-btn danger"
                    disabled={structuralLocked}
                    title={structuralWhy ?? "Delete this line (Ctrl+Z brings it back)"}
                    onClick={() => {
                      store().deleteLyricLine(i);
                      setSel(-1);
                    }}
                  >
                    ✕
                  </button>
                  <span className="lyr-tool-gap" />
                  <button
                    type="button"
                    className="text-btn"
                    disabled={realignWhy !== null || aligning}
                    title={
                      realignWhy ??
                      "Re-run the word aligner for this line's (edited) text against the vocal — a few seconds, fully on this PC"
                    }
                    onClick={() => void store().realignLyricLine(i)}
                  >
                    {aligning ? "aligning…" : "↻ align"}
                  </button>
                </div>
              )}
              {active && wordsOpen && line.words && line.words.length > 0 && (
                <WordStrip line={line} lineIdx={i} />
              )}
            </div>
          );
        })}
      </div>
      <p className="section-hint">
        Click a time to jump the track there; type in a line to fix it. Red lines the aligner thinks
        are wrong, amber ones deserve a listen. Everything previews live — save the corrected .lrc
        when it sings right.
      </p>
    </div>
  );
}
