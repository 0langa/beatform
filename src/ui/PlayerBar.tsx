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
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
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

  const timeAt = (clientX: number): number => {
    const rect = barRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return x * playback.duration;
  };

  return (
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
        onPointerMove={(e) => {
          if (!enabled) return;
          const t = timeAt(e.clientX);
          setHoverT(t);
          setHoverX(e.clientX - barRef.current!.getBoundingClientRect().left);
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
        onPointerLeave={() => setHoverT(null)}
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
                Math.min(playback.duration, playback.time + (e.key === "ArrowLeft" ? -step : step)),
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
        {hoverT !== null && enabled && (
          <div className="seek-tooltip" style={{ left: hoverX }}>
            {fmt(hoverT)}
          </div>
        )}
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
  );
}
