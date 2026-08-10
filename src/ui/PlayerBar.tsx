import { useRef, useState } from "react";
import { Slider } from "./Slider";
import { IconClose, IconLoop, IconMusic, IconMute, IconPause, IconPlay, IconVolume } from "./Icons";
import { useVizStore } from "../state/store";

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Bottom player chrome: transport, custom seek bar with hover time preview
 * and drag scrubbing, loop toggle, volume with mute.
 *
 * THE HOVER BUBBLE IS NOT REACT STATE (P-10). Pointer moves arrive at screen
 * rate; this bar carries `playback.time`, so routing the hover time through
 * `useState` re-rendered the whole transport on every mousemove — the same
 * mistake, at ~10x the rate, that the 4 Hz LUFS tick cost the dock. It follows
 * the in-tree precedent for pointer-rate values (ModMeters.tsx, PerfOverlay.tsx):
 * React renders the element once and never again; the handler writes ONE CSS
 * custom property and one textContent through a ref, and pure CSS `:hover`
 * decides whether it is visible. Zero commits per move — PlayerBar.test.tsx
 * pins that.
 *
 * Store-direct (P-12 wave 2): it subscribes the four slices it reads and
 * calls the transport actions at the click site. It is deliberately NOT
 * memo()d — with zero props memo can never bail on anything, and leaving it
 * would assert a contract nothing enforces. The contract that replaced the
 * old thirteen-prop one is SELECTOR GRANULARITY, pinned by PlayerBar.test.tsx:
 * this bar re-renders on the playback tick (it is a clock — that is its job)
 * and on volume/mute, and on nothing else. Before the migration it was
 * `memo()` plus nine `useCallback`s in App.tsx holding that line, enforced by
 * a comment.
 *
 * Never allocate inside a selector: zustand v5 hands it straight to
 * useSyncExternalStore with no equality fn, so a fresh object per notification
 * is "Maximum update depth exceeded" ON MOUNT — a white screen (lint enforces
 * the shapes; see state/selectors.ts).
 */
export function PlayerBar() {
  const playback = useVizStore((s) => s.playback);
  /** Section boundaries (seconds) shown as ticks on the seek bar. */
  const sections = useVizStore((s) => s.sections);
  const volume = useVizStore((s) => s.volume);
  const muted = useVizStore((s) => s.muted);
  // One stable accessor; actions are called at the click site. They are built
  // once inside create()'s initializer and every write is a partial merge, so
  // their identity is permanently stable — no useCallback.
  const store = useVizStore.getState;

  const barRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [seekDragT, setSeekDragT] = useState<number | null>(null);
  const [loopDrag, setLoopDrag] = useState<{
    kind: "start" | "end";
    time: number;
  } | null>(null);

  const enabled = !!playback.trackName && playback.duration > 0;
  const shownTime = seekDragT ?? playback.time;
  const pct = enabled ? (shownTime / playback.duration) * 100 : 0;
  const shownLoopStart = loopDrag?.kind === "start" ? loopDrag.time : playback.loopStart;
  const shownLoopEnd = loopDrag?.kind === "end" ? loopDrag.time : playback.loopEnd;
  const hasAnyLoopPoint = playback.loopStart !== null || playback.loopEnd !== null;
  const hasLoopRegion = shownLoopStart !== null && shownLoopEnd !== null;
  const regionStart = hasLoopRegion ? Math.min(shownLoopStart, shownLoopEnd) : null;
  const regionEnd = hasLoopRegion ? Math.max(shownLoopStart, shownLoopEnd) : null;

  const fracAt = (clientX: number, rect: DOMRect): number =>
    Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

  const timeAt = (clientX: number): number =>
    fracAt(clientX, barRef.current!.getBoundingClientRect()) * playback.duration;

  /**
   * Paint the hover bubble and return the time under the pointer.
   *
   * One `getBoundingClientRect` per event, then two direct DOM writes — no
   * setState, so a mousemove across the bar costs zero renders (see the file
   * docblock). The offset is the CLAMPED fraction, not `clientX - rect.left`:
   * during a captured drag the pointer leaves the bar, and the old inline
   * `left` let the bubble follow it off the end.
   */
  const paintHover = (clientX: number): number => {
    const rect = barRef.current!.getBoundingClientRect();
    const frac = fracAt(clientX, rect);
    const t = frac * playback.duration;
    const tip = tipRef.current;
    if (tip) {
      tip.textContent = fmt(t);
      tip.style.setProperty("--hover-x", `${frac * rect.width}px`);
    }
    return t;
  };

  return (
    <>
      <footer className="chrome player-bar">
        <div
          ref={barRef}
          className={`seek ${enabled ? "" : "disabled"}`}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={playback.duration}
          aria-valuenow={shownTime}
          onPointerDown={(e) => {
            if (!enabled) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const marker = (e.target as HTMLElement).closest<HTMLElement>("[data-loop-marker]")
              ?.dataset.loopMarker;
            if (marker === "start" && playback.loopStart !== null) {
              setLoopDrag({ kind: "start", time: playback.loopStart });
              return;
            }
            if (marker === "end" && playback.loopEnd !== null) {
              setLoopDrag({ kind: "end", time: playback.loopEnd });
              return;
            }
            store().seekStart();
            setSeekDragT(timeAt(e.clientX));
          }}
          // Enter as well as move: `:hover` turns the bubble on the instant the
          // pointer crosses the edge, so without a paint here the first frame
          // would show an empty pill (or, after a previous hover, a stale time).
          onPointerEnter={(e) => {
            if (enabled) paintHover(e.clientX);
          }}
          onPointerMove={(e) => {
            if (!enabled) return;
            const t = paintHover(e.clientX);
            if (seekDragT !== null) setSeekDragT(t);
            if (loopDrag !== null) setLoopDrag({ ...loopDrag, time: t });
          }}
          onPointerUp={(e) => {
            if (!enabled || (seekDragT === null && loopDrag === null)) return;
            e.currentTarget.releasePointerCapture(e.pointerId);
            const time = timeAt(e.clientX);
            if (loopDrag?.kind === "start") store().setLoopStart(time);
            else if (loopDrag?.kind === "end") store().setLoopEnd(time);
            else store().seekEnd(time);
            setSeekDragT(null);
            setLoopDrag(null);
          }}
          onPointerCancel={(e) => {
            // Touch-scroll takeover / pen interruption: without this the app
            // wedges in "seeking" state and the transport freezes for good.
            if (seekDragT === null && loopDrag === null) return;
            e.currentTarget.releasePointerCapture(e.pointerId);
            if (loopDrag?.kind === "start") store().setLoopStart(loopDrag.time);
            else if (loopDrag?.kind === "end") store().setLoopEnd(loopDrag.time);
            else if (seekDragT !== null) store().seekEnd(seekDragT);
            setSeekDragT(null);
            setLoopDrag(null);
          }}
          tabIndex={enabled ? 0 : -1}
          onKeyDown={(e) => {
            if (!enabled) return;
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              // The window-level shortcut handler also seeks on arrows and its
              // guard only skips INPUT/SELECT/TEXTAREA — this is a DIV, so
              // without this the seek fires twice (~10 s per press).
              e.stopPropagation();
              const step = e.shiftKey ? 10 : 5;
              store().seekEnd(
                Math.max(
                  0,
                  Math.min(
                    playback.duration,
                    playback.time + (e.key === "ArrowLeft" ? -step : step),
                  ),
                ),
              );
            }
          }}
        >
          <div className="seek-track">
            {regionStart !== null && regionEnd !== null && (
              <div
                className={`seek-loop-region ${playback.loop ? "active" : ""}`}
                style={{
                  left: `${(regionStart / playback.duration) * 100}%`,
                  width: `${((regionEnd - regionStart) / playback.duration) * 100}%`,
                }}
              />
            )}
            <div className="seek-fill" style={{ width: `${pct}%` }} />
            {enabled &&
              sections.map((t) => (
                <div
                  key={t}
                  className="seek-section-tick"
                  title="Section change"
                  style={{ left: `${(t / playback.duration) * 100}%` }}
                />
              ))}
            {shownLoopStart !== null && (
              <div
                className="seek-loop-marker start"
                data-loop-marker="start"
                title={`Loop A ${fmt(shownLoopStart)} — drag to adjust`}
                style={{ left: `${(shownLoopStart / playback.duration) * 100}%` }}
              >
                A
              </div>
            )}
            {shownLoopEnd !== null && (
              <div
                className="seek-loop-marker end"
                data-loop-marker="end"
                title={`Loop B ${fmt(shownLoopEnd)} — drag to adjust`}
                style={{ left: `${(shownLoopEnd / playback.duration) * 100}%` }}
              >
                B
              </div>
            )}
            <div className="seek-handle" style={{ left: `${pct}%` }} />
          </div>
          {/* Always mounted, never re-rendered: `paintHover` owns its text and
            its `--hover-x`, and `.seek:hover:not(.disabled)` owns whether it
            is on screen. Decorative — the time it shows is the same value the
            slider already exposes through aria-valuenow. */}
          <div className="seek-tooltip" ref={tipRef} aria-hidden="true" />
        </div>

        <div className="player-row">
          <div className="player-left">
            <button
              className="icon-btn play-btn"
              disabled={!playback.trackName}
              title={playback.playing ? "Pause (Space)" : "Play (Space)"}
              onClick={() => void store().togglePlay()}
            >
              {playback.playing ? <IconPause size={20} /> : <IconPlay size={20} />}
            </button>
            <span className="time-label">
              {fmt(shownTime)}
              <span className="time-total"> / {fmt(playback.duration)}</span>
            </span>
          </div>

          <div className="player-track" title={playback.trackName ?? undefined}>
            <IconMusic size={14} />
            <span className="track-name">{playback.trackName ?? "No track loaded"}</span>
          </div>

          <div className="player-right">
            <button
              className={`icon-btn ${playback.loop ? "active" : ""}`}
              title={`${hasLoopRegion ? "A-B" : "Whole-track"} loop ${
                playback.loop ? "on" : "off"
              } (L)`}
              aria-label="Loop"
              aria-pressed={playback.loop}
              onClick={() => store().toggleLoop()}
            >
              <IconLoop size={17} />
            </button>
            <button
              className={`loop-point-btn ${playback.loopStart !== null ? "active" : ""}`}
              disabled={!enabled}
              title={`Set loop A at playhead (I)${
                playback.loopStart !== null ? ` — ${fmt(playback.loopStart)}` : ""
              }`}
              aria-label="Set loop A"
              onClick={() => store().setLoopStart()}
            >
              A
            </button>
            <button
              className={`loop-point-btn ${playback.loopEnd !== null ? "active" : ""}`}
              disabled={!enabled}
              title={`Set loop B at playhead (O)${
                playback.loopEnd !== null ? ` — ${fmt(playback.loopEnd)}` : ""
              }`}
              aria-label="Set loop B"
              onClick={() => store().setLoopEnd()}
            >
              B
            </button>
            {hasAnyLoopPoint && (
              <button
                className="icon-btn subtle"
                title="Clear A-B region (whole-track loop remains available)"
                aria-label="Clear A-B loop"
                onClick={() => store().clearLoopRegion()}
              >
                <IconClose size={14} />
              </button>
            )}
            <button
              className="icon-btn"
              title={muted ? "Unmute (M)" : "Mute (M)"}
              // Reads volume/muted off the live snapshot rather than the render
              // scope, exactly as App's retired `toggleMute` forwarder did.
              onClick={() => {
                const s = store();
                s.applyVolume(s.volume, !s.muted);
              }}
            >
              {muted || volume === 0 ? <IconMute size={18} /> : <IconVolume size={18} />}
            </button>
            <Slider
              className="volume-slider"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(v) => store().applyVolume(v, false)}
              title="Volume (↑/↓)"
            />
          </div>
        </div>
      </footer>

      {/* Volume OSD (P-10). ↑/↓/M are window shortcuts that do NOT poke the
          chrome (useAppShortcuts.ts:158-198 vs App.tsx:380-385), so during
          playback the bar can be faded out — or `display:none` in Stage — while
          the volume genuinely moves, and the keypress reads as a dead key. A
          SIBLING of the bar, not a child, so it survives both; CSS alone
          decides when it is on screen, and it is hidden whenever the bar is
          visible, because then the slider already says this.

          Keyed like App's `.stage-hud`, and for the same reason: a changed key
          re-mounts the node, which replays a CSS animation that ends hidden —
          no timer, no state, nothing to clear on unmount. Decorative: an
          aria-live region inserted together with its content is famously
          unreliable, and the slider is the accessible surface for volume. */}
      <div className="volume-flash" key={`${muted}:${volume}`} aria-hidden="true">
        {muted || volume === 0 ? "Muted" : `Volume ${Math.round(volume * 100)}%`}
      </div>
    </>
  );
}
