import { useRef, useState } from "react";
import type { PlaybackState } from "../audio/types";
import { Slider } from "./Slider";
import { IconLoop, IconMusic, IconMute, IconPause, IconPlay, IconVolume } from "./Icons";

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Bottom player chrome: transport, custom seek bar with hover time preview
 * and drag scrubbing, loop toggle, volume with mute.
 */
export function PlayerBar(props: {
  playback: PlaybackState;
  /** Section boundaries (seconds) shown as ticks on the seek bar. */
  sections: number[];
  volume: number;
  muted: boolean;
  onTogglePlay: () => void;
  onSeekStart: () => void;
  onSeekEnd: (t: number) => void;
  onToggleLoop: () => void;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
}) {
  const { playback } = props;
  const barRef = useRef<HTMLDivElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [dragT, setDragT] = useState<number | null>(null);

  const enabled = !!playback.trackName && playback.duration > 0;
  const shownTime = dragT ?? playback.time;
  const pct = enabled ? (shownTime / playback.duration) * 100 : 0;

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
          props.onSeekStart();
          setDragT(timeAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (!enabled) return;
          const t = timeAt(e.clientX);
          setHoverT(t);
          setHoverX(e.clientX - barRef.current!.getBoundingClientRect().left);
          if (dragT !== null) setDragT(t);
        }}
        onPointerUp={(e) => {
          if (!enabled || dragT === null) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          props.onSeekEnd(timeAt(e.clientX));
          setDragT(null);
        }}
        onPointerCancel={(e) => {
          // Touch-scroll takeover / pen interruption: without this the app
          // wedges in "seeking" state and the transport freezes for good.
          if (dragT === null) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          props.onSeekEnd(dragT);
          setDragT(null);
        }}
        onPointerLeave={() => setHoverT(null)}
        tabIndex={enabled ? 0 : -1}
        onKeyDown={(e) => {
          if (!enabled) return;
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            const step = e.shiftKey ? 10 : 5;
            props.onSeekEnd(
              Math.max(
                0,
                Math.min(playback.duration, playback.time + (e.key === "ArrowLeft" ? -step : step)),
              ),
            );
          }
        }}
      >
        <div className="seek-track">
          <div className="seek-fill" style={{ width: `${pct}%` }} />
          {enabled &&
            props.sections.map((t) => (
              <div
                key={t}
                className="seek-section-tick"
                title="Section change"
                style={{ left: `${(t / playback.duration) * 100}%` }}
              />
            ))}
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
            onClick={props.onTogglePlay}
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
            title={`Loop ${playback.loop ? "on" : "off"} (L)`}
            onClick={props.onToggleLoop}
          >
            <IconLoop size={17} />
          </button>
          <button
            className="icon-btn"
            title={props.muted ? "Unmute (M)" : "Mute (M)"}
            onClick={props.onToggleMute}
          >
            {props.muted || props.volume === 0 ? <IconMute size={18} /> : <IconVolume size={18} />}
          </button>
          <Slider
            className="volume-slider"
            min={0}
            max={1}
            step={0.01}
            value={props.muted ? 0 : props.volume}
            onChange={props.onVolume}
            title="Volume (↑/↓)"
          />
        </div>
      </div>
    </footer>
  );
}
