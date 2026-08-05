import { useMemo, useState } from "react";
import { useVizStore } from "../state/store";
import { entryGate, type GalleryEntryType } from "../state/gallery";
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

/** Small text link used by the Templates section to reach the dialog. */
export function GalleryLink() {
  const store = useVizStore.getState;
  return (
    <div className="save-look-row">
      <button
        className="text-btn"
        title="Browse community looks and themes"
        onClick={() => store().setShowGallery(true)}
      >
        Browse the Gallery…
      </button>
    </div>
  );
}

export function GalleryDialog() {
  const status = useVizStore((s) => s.galleryStatus);
  const error = useVizStore((s) => s.galleryError);
  const entries = useVizStore((s) => s.galleryEntries);
  const previews = useVizStore((s) => s.galleryPreviews);
  const busy = useVizStore((s) => s.galleryBusy);
  const installed = useVizStore((s) => s.galleryInstalled);
  const store = useVizStore.getState;
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

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
        className="modal gallery-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Gallery"
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
          touches your setup. Want yours here? Save a look or template and submit it on GitHub
          (beatform-app/gallery).
        </p>

        {status === "ready" && entries.length > 0 && (
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
                const done = installed[e.id] === true;
                return (
                  <div className="gallery-card" key={e.id}>
                    {previews[e.id] ? (
                      <img className="gallery-preview" src={previews[e.id]} alt="" />
                    ) : (
                      <div className="gallery-preview gallery-preview-empty">
                        {e.type === "look" ? "Look" : "Theme"}
                      </div>
                    )}
                    <div className="gallery-card-body">
                      <div className="gallery-card-title">{e.name}</div>
                      <div className="gallery-card-desc">{e.description}</div>
                      <div
                        className="gallery-card-meta"
                        title={e.author.url ? `Author: ${e.author.url}` : undefined}
                      >
                        {e.type === "look" ? "Look" : "Theme"} · by {e.author.name} · {e.license}
                      </div>
                      <button
                        className="text-btn gallery-install-btn"
                        disabled={isBusy || busy !== null || gate !== null}
                        title={gate ?? (e.type === "look" ? "Add to My Looks" : "Apply this theme")}
                        onClick={() => void store().installGalleryEntry(e.id)}
                      >
                        {done
                          ? "✓ Added"
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
