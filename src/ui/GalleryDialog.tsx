import { useMemo, useState, type ReactNode } from "react";
import { useVizStore } from "../state/store";
import { entryGate, type GalleryEntryType } from "../state/gallery";
import { useFocusTrap } from "./useFocusTrap";
import { IconClose } from "./Icons";

/**
 * The Gallery — a first-class surface (top-bar button), not a settings
 * section: the registry grows without bound, so it gets a room of its own
 * with a real grid, type filters and search.
 *
 * Security posture unchanged from the panel days (src/state/gallery.ts):
 * opening the dialog is the explicit user action that loads the registry;
 * every card shows name, author and license BEFORE any install; installs
 * download to memory, verify size + SHA-256, and parse through the same
 * validators the drag-import paths use before anything persists.
 */

type Filter = "all" | GalleryEntryType;

/** One sentence per entry type (A2) — the explainer line under the filters
 * and the type-badge tooltips must tell the same story. */
const TYPE_EXPLAINERS: Record<GalleryEntryType, string> = {
  look: "Looks restyle the current visual mode",
  theme: "Themes replace your whole setup",
};

/** Text link into the Gallery dialog, optionally pre-filtered to one entry
 * type (A3 deep links) — used by the Themes section and the My Looks row. */
export function GalleryLink(props: { filter?: GalleryEntryType; children: ReactNode }) {
  const store = useVizStore.getState;
  return (
    <button
      className="text-btn"
      title="Browse community looks and themes"
      onClick={() => store().setShowGallery(true, props.filter)}
    >
      {props.children}
    </button>
  );
}

export function GalleryDialog() {
  const status = useVizStore((s) => s.galleryStatus);
  const error = useVizStore((s) => s.galleryError);
  const entries = useVizStore((s) => s.galleryEntries);
  const previews = useVizStore((s) => s.galleryPreviews);
  const busy = useVizStore((s) => s.galleryBusy);
  const installed = useVizStore((s) => s.galleryInstalled);
  const applied = useVizStore((s) => s.galleryApplied);
  // A1: "✓ Added" must track the installed look's ACTUAL existence, so the
  // dialog subscribes to My Looks — deleting the look over in Visual
  // settings flips the card straight back to "+ Add look".
  const userPresets = useVizStore((s) => s.userPresets);
  const store = useVizStore.getState;
  // Deep links pre-arm the filter (A3); a plain open resets it to "all" in
  // setShowGallery, so reading it once at mount is enough.
  const [filter, setFilter] = useState<Filter>(() => useVizStore.getState().galleryOpenFilter);
  const [query, setQuery] = useState("");
  // UI-5: the one aria-modal dialog that shipped without the H17 trap —
  // Tab used to walk out into the chrome the backdrop covers.
  const trapRef = useFocusTrap(true);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (filter === "all" || e.type === filter) &&
        (q === "" ||
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.author.name.toLowerCase().includes(q)),
    );
  }, [entries, filter, query]);

  const close = () => store().setShowGallery(false);

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        ref={trapRef}
        className="modal gallery-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Gallery"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <span className="panel-heading">Gallery</span>
          <button
            className="icon-btn subtle"
            title="Close"
            aria-label="Close gallery"
            onClick={close}
          >
            <IconClose size={16} />
          </button>
        </div>

        <p className="section-hint gallery-dialog-hint">
          Community looks and themes, reviewed before listing. Every download is verified before it
          touches your setup. Want yours here? Save a look or theme and submit it on GitHub
          (beatform-app/gallery).
        </p>

        {status === "ready" && entries.length > 0 && (
          <>
            <div className="gallery-toolbar">
              {(
                [
                  ["all", "All"],
                  ["look", "Looks"],
                  ["theme", "Themes"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={`style-chip${filter === key ? " active" : ""}`}
                  title={key === "all" ? undefined : TYPE_EXPLAINERS[key]}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
              <input
                className="look-name-input gallery-search"
                placeholder="Search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className="text-btn"
                title="Reload the registry"
                onClick={() => void store().openGallery()}
              >
                Refresh
              </button>
            </div>
            {/* A2: the look/theme distinction in one line, where the choice
                happens — the type badges on the cards repeat it on hover. */}
            <p className="section-hint gallery-explainer">
              {TYPE_EXPLAINERS.look} · {TYPE_EXPLAINERS.theme}
            </p>
          </>
        )}

        <div className="gallery-dialog-body">
          {status === "loading" && <p className="section-hint">Loading the Gallery…</p>}
          {status === "error" && (
            <>
              <p className="section-hint gallery-error">{error}</p>
              <div className="save-look-row">
                <button className="text-btn" onClick={() => void store().openGallery()}>
                  Try again
                </button>
              </div>
            </>
          )}
          {status === "ready" && entries.length === 0 && (
            <p className="section-hint">
              Nothing published yet — the first curated looks and themes are on their way.
            </p>
          )}
          {status === "ready" && entries.length > 0 && shown.length === 0 && (
            <p className="section-hint">Nothing matches that filter.</p>
          )}
          {status === "ready" && shown.length > 0 && (
            <div className="gallery-grid gallery-grid-wide">
              {shown.map((e) => {
                const gate = entryGate(e);
                const isBusy = busy === e.id;
                const typeLabel = e.type === "look" ? "Look" : "Theme";
                // A1: a look is Added only while the user preset its install
                // created still exists — not because a stale session record
                // says so. Themes never persist an installed state; they get
                // the transient "Applied ✓" instead (applying is repeatable).
                const installedPresetId = installed[e.id];
                const done =
                  e.type === "look" &&
                  installedPresetId !== undefined &&
                  userPresets.some((p) => p.id === installedPresetId);
                const justApplied = e.type === "theme" && applied === e.id;
                return (
                  <div className="gallery-card" key={e.id}>
                    {previews[e.id] ? (
                      <img className="gallery-preview" src={previews[e.id]} alt="" />
                    ) : (
                      <div className="gallery-preview gallery-preview-empty">{typeLabel}</div>
                    )}
                    <div className="gallery-card-body">
                      <div className="gallery-card-title">{e.name}</div>
                      <div className="gallery-card-desc">{e.description}</div>
                      <div
                        className="gallery-card-meta"
                        title={e.author.url ? `Author: ${e.author.url}` : undefined}
                      >
                        <span title={TYPE_EXPLAINERS[e.type]}>{typeLabel}</span> · by{" "}
                        {e.author.name} · {e.license}
                      </div>
                      <button
                        className="text-btn gallery-install-btn"
                        // Added DISABLES the button (A1): it used to stay
                        // clickable and every press stacked another copy
                        // into My Looks.
                        disabled={done || isBusy || busy !== null || gate !== null}
                        title={
                          gate ??
                          (done
                            ? "Already in My Looks — delete the look there to add it again"
                            : e.type === "look"
                              ? "Add to My Looks"
                              : "Apply this theme")
                        }
                        onClick={() => void store().installGalleryEntry(e.id)}
                      >
                        {done
                          ? "✓ Added"
                          : justApplied
                            ? "Applied ✓"
                            : isBusy
                              ? "Verifying…"
                              : gate !== null
                                ? "Needs app update"
                                : e.type === "look"
                                  ? "+ Add look"
                                  : "Apply theme"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
