import { useVizStore } from "../state/store";
import { entryGate } from "../state/gallery";

/**
 * The Gallery section body (inside ParamsPanel): browse the public
 * owner-curated registry, install looks / apply themes.
 *
 * Deliberately no auto-fetch: the app never talks to the network without
 * an explicit user action (same ethos as the updater). The first Browse
 * press loads the registry; every card shows name, author and license
 * BEFORE any install, and the install button downloads + verifies +
 * parses before anything persists (see src/state/gallery.ts).
 */
export function GallerySection() {
  const status = useVizStore((s) => s.galleryStatus);
  const error = useVizStore((s) => s.galleryError);
  const entries = useVizStore((s) => s.galleryEntries);
  const previews = useVizStore((s) => s.galleryPreviews);
  const busy = useVizStore((s) => s.galleryBusy);
  const installed = useVizStore((s) => s.galleryInstalled);
  const store = useVizStore.getState;

  return (
    <>
      <p className="section-hint">
        Community looks and themes, reviewed before listing. Loaded from GitHub only when you press
        Browse; every download is verified before it touches your setup.
      </p>
      {status === "idle" && (
        <div className="save-look-row">
          <button className="text-btn" onClick={() => void store().openGallery()}>
            Browse the Gallery…
          </button>
        </div>
      )}
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
          Nothing published yet — the first curated looks and themes are on their way. Save your own
          as a .bfpreset or .bftheme and submit it on GitHub (beatform-app/gallery).
        </p>
      )}
      {status === "ready" && entries.length > 0 && (
        <>
          <div className="gallery-grid">
            {entries.map((e) => {
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
          <div className="save-look-row">
            <button className="text-btn" onClick={() => void store().openGallery()}>
              Refresh
            </button>
          </div>
        </>
      )}
    </>
  );
}
