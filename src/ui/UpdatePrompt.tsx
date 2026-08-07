import { Fragment, useEffect, useState } from "react";
import { APP_VERSION } from "../version";
import type { UpdatePhase } from "../state/updater";
import { IconClose } from "./Icons";
import { useFocusTrap } from "./useFocusTrap";
import { fetchNotesBetween } from "../state/changelogNotes";

/**
 * The startup "a new version is here" dialog (v2.45.0, redesigned v2.46.0).
 *
 * Shown only for updates found by the AUTOMATIC startup check — manual checks
 * report inline in Settings → Updates. Renders three of the updater phases:
 * available (pitch + notes + install), downloading (progress bar), ready
 * (restart). The other phases never reach this component.
 */
export interface UpdatePromptProps {
  update: UpdatePhase;
  onInstall: () => void;
  onRelaunch: () => void;
  onDismiss: () => void;
}

/**
 * Release notes arrive as markdown-ish text (the GitHub release body or the
 * short latest.json blurb). Full markdown is overkill and a renderer
 * dependency is unjustifiable here — this renders the three constructs the
 * project's own release notes actually use (## headings, - bullets, **bold**)
 * and leaves everything else as plain text. Pure text nodes, no HTML
 * injection surface.
 */
function renderNotes(notes: string) {
  const bold = (line: string, key: number) => {
    // Odd indices sat between ** pairs — render them strong. An unmatched
    // trailing ** just bolds to end of line, harmless for release notes.
    const parts = line.split("**");
    return (
      <Fragment key={key}>
        {parts.map((p, i) =>
          i % 2 === 1 ? <strong key={i}>{p}</strong> : <Fragment key={i}>{p}</Fragment>,
        )}
      </Fragment>
    );
  };
  const blocks: React.ReactNode[] = [];
  let bullets: React.ReactNode[] = [];
  const flushBullets = () => {
    if (bullets.length) {
      blocks.push(<ul key={`ul${blocks.length}`}>{bullets}</ul>);
      bullets = [];
    }
  };
  notes.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) {
      flushBullets();
      return;
    }
    if (/^#{1,4}\s/.test(line)) {
      flushBullets();
      blocks.push(<h4 key={i}>{line.replace(/^#{1,4}\s+/, "")}</h4>);
    } else if (/^[-*]\s/.test(line)) {
      bullets.push(<li key={i}>{bold(line.replace(/^[-*]\s+/, ""), i)}</li>);
    } else {
      flushBullets();
      blocks.push(<p key={i}>{bold(line, i)}</p>);
    }
  });
  flushBullets();
  return blocks;
}

export function UpdatePrompt({ update, onInstall, onRelaunch, onDismiss }: UpdatePromptProps) {
  const visible =
    update.state === "available" ||
    update.state === "downloading" ||
    update.state === "ready" ||
    update.state === "error"; // UP2: a failed install must not silently vanish
  // H17 modal machinery (audit UP1): focus moves in, Tab cycles inside,
  // focus restores on close. Hooks run unconditionally (before the early
  // return) per the rules of hooks.
  const trapRef = useFocusTrap(visible);
  // Cumulative notes: the transport blurb (latest.json) only describes the
  // newest release, but a user several versions behind gets ALL of them —
  // so pull the real changelog and show every section between the installed
  // and the offered version. Falls back to the blurb offline. The target
  // audience isn't expected to go read GitHub.
  // Cached WITH the version it describes: if a later check offers a different
  // version and that fetch fails, the previous version's sections must not
  // stay on screen under the new version's chip — the guard below drops them
  // without needing to reset state from inside the effect.
  const [fetched, setFetched] = useState<{ version: string; notes: string } | null>(null);
  const availableVersion = update.state === "available" ? update.version : null;
  const fullNotes = fetched && fetched.version === availableVersion ? fetched.notes : null;
  useEffect(() => {
    if (!availableVersion) return;
    let alive = true;
    void fetchNotesBetween(APP_VERSION, availableVersion).then((notes) => {
      if (alive && notes) setFetched({ version: availableVersion, notes });
    });
    return () => {
      alive = false;
    };
  }, [availableVersion]);

  // The global Esc handler only clears STORE flags; this dialog's open flag
  // is App-local state, so it closes itself (also audit UP1).
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onDismiss]);
  if (!visible) return null;

  const version = update.state === "available" || update.state === "ready" ? update.version : null;
  const pct =
    update.state === "downloading" && update.total
      ? Math.min(100, Math.round((update.received / update.total) * 100))
      : null;

  return (
    <div className="modal-backdrop" onClick={onDismiss}>
      <div
        ref={trapRef}
        tabIndex={-1}
        className="modal update-prompt"
        role="dialog"
        aria-modal="true"
        aria-label={
          update.state === "ready"
            ? "Update installed"
            : update.state === "error"
              ? "Update failed"
              : "Update available"
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="update-hero">
          <button
            className="icon-btn subtle update-hero-close"
            aria-label="Close"
            onClick={onDismiss}
          >
            <IconClose size={16} />
          </button>
          <div className="update-hero-icon" aria-hidden>
            {update.state === "ready" ? (
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3v12" />
                <path d="M6 11l6 6 6-6" />
                <path d="M4 21h16" />
              </svg>
            )}
          </div>
          <div className="update-hero-text">
            <span className="update-hero-title">
              {update.state === "ready"
                ? "Ready — restart to finish"
                : update.state === "downloading"
                  ? "Downloading update"
                  : update.state === "error"
                    ? "The update didn't go through"
                    : "A new Beatform is here"}
            </span>
            <span className="update-hero-versions">
              <span className="update-ver old">v{APP_VERSION}</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M5 12h14" />
                <path d="M13 6l6 6-6 6" />
              </svg>
              <span className="update-ver new">{version ? `v${version}` : "…"}</span>
            </span>
          </div>
        </div>

        {update.state === "available" && (
          <>
            {(fullNotes ?? update.notes) && (
              <div className="update-notes">{renderNotes(fullNotes ?? update.notes ?? "")}</div>
            )}
            <p className="update-fineprint">
              Downloads in the background from GitHub Releases and is verified against Beatform's
              signing key before it installs. Applies on restart.
            </p>
            <div className="update-actions">
              <button className="update-cta" onClick={onInstall}>
                Install now
              </button>
              <button className="ghost-btn" onClick={onDismiss}>
                Later
              </button>
            </div>
          </>
        )}

        {update.state === "downloading" && (
          <div className="update-progress-wrap">
            <div
              className="update-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              {...(pct !== null ? { "aria-valuenow": pct } : {})}
            >
              <div
                className={`update-progress-fill ${pct === null ? "indeterminate" : ""}`}
                style={pct !== null ? { width: `${pct}%` } : undefined}
              />
            </div>
            <span className="update-progress-label">
              {pct !== null
                ? `${pct}% · ${(update.received / 1e6).toFixed(1)} of ${(update.total! / 1e6).toFixed(1)} MB`
                : `${(update.received / 1e6).toFixed(1)} MB`}
            </span>
          </div>
        )}

        {update.state === "error" && (
          <>
            <p className="update-fineprint" role="alert">
              {update.message} — nothing was changed; the installed version keeps running. You can
              retry now or later from Preferences → Updates.
            </p>
            <div className="update-actions">
              <button className="update-cta" onClick={onInstall}>
                Try again
              </button>
              <button className="ghost-btn" onClick={onDismiss}>
                Close
              </button>
            </div>
          </>
        )}

        {update.state === "ready" && (
          <>
            <p className="update-fineprint">
              Version {version} is installed and takes over on the next launch — restart whenever
              suits you.
            </p>
            <div className="update-actions">
              <button className="update-cta" onClick={onRelaunch}>
                Restart now
              </button>
              <button className="ghost-btn" onClick={onDismiss}>
                Restart later
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
