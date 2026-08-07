import { useState, type ReactNode } from "react";
import { useFocusTrap } from "./useFocusTrap";
import { IconClose } from "./Icons";

/**
 * The in-app user guide (v2.46.0): a table of contents on the left, one
 * readable section at a time on the right. All content lives here as plain
 * JSX — no markdown pipeline, no network, works identically in the installed
 * app and the browser build. Written for a first-time user; docs/guide.md
 * remains the terser reference for the repository.
 */
export interface GuideDialogProps {
  onClose: () => void;
}

interface GuideSection {
  id: string;
  title: string;
  body: ReactNode;
}

/** Inline keyboard-key chip. */
function K({ k }: { k: string }) {
  return <kbd className="guide-key">{k}</kbd>;
}

const SECTIONS: GuideSection[] = [
  {
    id: "start",
    title: "Getting started",
    body: (
      <>
        <h3>Welcome to Beatform</h3>
        <p>
          Beatform turns music into visuals — live on your screen, and rendered to video files that
          look exactly like the preview. Everything runs locally on your machine: no account, no
          uploads, no telemetry.
        </p>
        <h4>Your first minute</h4>
        <ol>
          <li>
            <strong>Load music.</strong> Drop an audio file anywhere on the window (MP3, FLAC, WAV,
            OGG or M4A), click <em>Browse files</em>, or try one of the built-in demo tracks.
            Beatform analyzes the track for tempo, key and loudness in the background.
          </li>
          <li>
            <strong>Press Space.</strong> The visual reacts to the music immediately.
          </li>
          <li>
            <strong>Try the modes.</strong> The strip at the top holds every visual mode — click
            one, or walk through them with <K k="N" /> and <K k="P" />.
          </li>
          <li>
            <strong>Open the Inspector</strong> with <K k="G" /> (or the sliders icon, top right) to
            shape the look of the current mode.
          </li>
        </ol>
        <p>
          When something looks wrong or you get lost, <em>Project ▸ New project</em> resets the
          whole document to clean defaults — one <K k="Ctrl+Z" /> undoes even that.
        </p>
        <h4>Loop a section while you tune</h4>
        <p>
          Press <K k="I" /> at the start of a drop and <K k="O" /> at the end, or use the{" "}
          <strong>A</strong>/<strong>B</strong> buttons beside the player. The selected region
          appears on the seek bar; drag either marker to adjust it, then press <K k="L" /> to loop
          it. Clear the markers to return <K k="L" /> to whole-track looping. A-B markers are
          session-only and reset when another track loads.
        </p>
      </>
    ),
  },
  {
    id: "modes",
    title: "Visual modes",
    body: (
      <>
        <h3>Visual modes</h3>
        <p>
          Sixteen modes live on the strip — from classic spectrum bars to 120k-particle flow fields
          and a full 3D bar city. Every mode has:
        </p>
        <ul>
          <li>
            <strong>Styles</strong> — curated one-click looks at the top of the Visual tab.
          </li>
          <li>
            <strong>Main parameters</strong> — the handful of sliders that define the mode.
          </li>
          <li>
            <strong>An Advanced drawer</strong> — every internal constant worth touching.
          </li>
        </ul>
        <p>
          Hover any control to see a plain-language hint in the Inspector footer. The search box at
          the top of the Inspector finds any control by name, across all tabs.
        </p>
        <h4>Center images</h4>
        <p>
          Bass Circle and Radial Burst can display artwork in their center: by default the track's
          embedded cover art, or any image you choose (look for <em>Center image</em> in the
          Inspector). Bass Circle's <em>Match cover colors</em> toggle reads the dominant color of
          that artwork and sets Hue and Hue spread to fit — automatically again for every new track.
        </p>
        <h4>Your own shaders</h4>
        <p>
          The <em>+</em> chip at the end of the strip opens the shader editor, where you can write a
          WGSL fragment of your own — it becomes a first-class mode, saved into your projects and
          shareable as a file.
        </p>
      </>
    ),
  },
  {
    id: "builder",
    title: "Builder",
    body: (
      <>
        <h3>Builder — stack your own visual</h3>
        <p>
          Builder is a layer compositor: stack up to twelve layers from nine types — background
          wash, particles, spectrum bars, radial ring, pulse rings, waveform circle, orb, wave line
          and vignette. Use the same type as often as you like.
        </p>
        <p>Every layer has:</p>
        <ul>
          <li>its own on/off toggle and opacity,</li>
          <li>
            a <strong>blend mode</strong> (Normal, Add, Screen),
          </li>
          <li>color (hue + spread) and its own parameter set,</li>
          <li>reorder arrows and a duplicate button.</li>
        </ul>
        <p>
          Stacks are saved inside your project like any other setting. <em>Export .bfbuilder</em>{" "}
          writes a stack as a single small file anyone can import — a good way to share looks.
        </p>
      </>
    ),
  },
  {
    id: "sync",
    title: "Sync & reactivity",
    body: (
      <>
        <h3>Sync — what the visual listens to</h3>
        <p>
          The Sync tab routes <strong>one source</strong> to the current mode: Kicks (default),
          Energy, Bass, Melody, Voice, Treble, Snare or Hats. Pick what should drive the motion — a
          vocal-heavy track often looks better on Voice than on Kicks.
        </p>
        <h4>Response feel</h4>
        <p>
          <strong>Smoothing</strong> sets the overall response: 0 is punchy, 1 glides. For
          asymmetric feel, set <strong>Attack</strong> (how fast the reaction rises) and{" "}
          <strong>Release</strong> (how slowly it falls) separately.
        </p>
        <h4>Shaping the drawn spectrum</h4>
        <p>In modes that draw the spectrum, three controls shape the bars themselves:</p>
        <ul>
          <li>
            <strong>Merge</strong> — bars prop up their neighbors, melting lone spikes into one
            connected silhouette (the "Monstercat" look).
          </li>
          <li>
            <strong>Rounding</strong> — averages neighboring bars: real smoothing that removes hard
            spikes rather than just curving between them.
          </li>
          <li>
            <strong>Contrast</strong> — below 50% flattens toward fuller, calmer bars; above 50%
            exaggerates peaks. 50% is neutral.
          </li>
        </ul>
        <p>
          These shape only the drawing — the sync feel and beat pulses are untouched. All of it is
          saved per mode and applies identically in exports.
        </p>
        <h4>Modulation</h4>
        <p>
          The Modulation section routes any audio feature to any knob — kick pumps the zoom, hats
          flicker the glow. Import a stem (a drums/bass/vocals bounce starting at 0:00) and its
          bands become extra sources; the ✦ button auto-wires a stem to the best-matching knobs of
          the current mode.
        </p>
      </>
    ),
  },
  {
    id: "scene",
    title: "Backgrounds & scene",
    body: (
      <>
        <h3>Backgrounds, post effects and the frame</h3>
        <h4>Backgrounds</h4>
        <p>The Scene tab picks what sits behind the visualization:</p>
        <ul>
          <li>
            <strong>Animated</strong> — the mode's own moving background.
          </li>
          <li>
            <strong>Solid</strong> — a flat color, including chroma green/magenta for keying.
          </li>
          <li>
            <strong>Transparent</strong> — see-through (checkerboard in the preview); pair with the
            alpha export formats.
          </li>
          <li>
            <strong>Image</strong> — your own picture or the track's album art, cover-fit, with blur
            and dim.
          </li>
          <li>
            <strong>Video</strong> (desktop) — a short local clip looped behind the visual,
            deterministic so exports match the preview.
          </li>
        </ul>
        <p>
          Backgrounds can be set <strong>for all modes</strong> or{" "}
          <strong>for the current mode only</strong> — the scope switch sits at the top of the
          Background section. A per-mode background wins over the global one, so Spectrum Bars can
          sit on your video loop while Bass Circle keeps its animated backdrop.
        </p>
        <h4>Post effects</h4>
        <p>
          Bloom, exposure, vignette, chromatic aberration and deterministic film grain — all in the
          Scene tab, all rendered identically in exports. Bloom plus a dark background is the
          fastest way to make any mode look "produced".
        </p>
        <h4>Aspect</h4>
        <p>
          The frame aspect (Fill, 16:9, 9:16, 1:1) is a project setting — visuals compose into the
          frame, so vertical exports for Shorts/Reels look designed, not cropped.
        </p>
      </>
    ),
  },
  {
    id: "overlays",
    title: "Text, lyrics & audiogram",
    body: (
      <>
        <h3>Overlays</h3>
        <h4>Text and images</h4>
        <p>
          The Scene tab's Layers section adds text and image overlays. Text supports{" "}
          <code>{"{title}"}</code> and <code>{"{artist}"}</code> placeholders filled from the
          track's tags; images can be your logo or the embedded album art. Layers anchor to nine
          positions and scale fractionally — they render identically in exports.
        </p>
        <h4>Lyrics</h4>
        <p>
          Drop an <code>.lrc</code> or <code>.srt</code> file onto the window — the current line
          follows the music karaoke-style, live and in every export. Position, size, color, an
          animation style (plain, slide, pop, or karaoke fill) and fade timing live in the Text tab.
        </p>
        <h4>Generate lyrics (desktop)</h4>
        <p>
          No .lrc at hand? The Text tab can generate timed lyrics from the loaded track, entirely on
          your PC: vocals are isolated with an Ultimate Vocal Remover (UVR) MDX-Net model,
          transcribed with OpenAI's Whisper running on whisper.cpp, then each word is timed against
          the isolated vocal with a wav2vec2 forced aligner — the karaoke fill follows the singer
          word by word. (Enhanced .lrc files with word tags from other tools get the same per-word
          fill when imported.) The AI models download once (size and a time estimate are shown
          first, checksum-verified) and nothing ever leaves your machine. Sung words are hard even
          for good models — expect to fix a few lines, and thanks to the UVR and whisper.cpp
          projects for making local isolation and transcription possible.
        </p>
        <h4>Audiogram</h4>
        <p>
          The audiogram adds podcast/reel-style track-driven elements: a progress bar, an
          elapsed/total readout and a mini waveform strip with a moving playhead. Position and
          accent color are yours.
        </p>
      </>
    ),
  },
  {
    id: "timeline",
    title: "Timeline",
    body: (
      <>
        <h3>Timeline — visuals as an arrangement</h3>
        <p>
          Press <K k="T" />. Scenes switch visual modes at chosen beats (drags snap to the detected
          grid), and automation lanes keyframe any parameter over time. Each scene picks a
          transition for its incoming edge: crossfade, wipe, iris, zoom, glitch or hard cut.
        </p>
        <ul>
          <li>Click a keyframe dot to cycle its curve: linear → smooth → hold.</li>
          <li>Right-click a keyframe to remove it.</li>
          <li>
            <strong>✦ Auto-arrange</strong> builds a scene arrangement from the song's detected
            sections in one click.
          </li>
        </ul>
        <p>
          <strong>Good to know:</strong> while the timeline is enabled, scenes override the mode
          strip and scene parameters override the sliders — that's the point, but it can look like
          "the Inspector does nothing" if you forget it's on. Turn the timeline off (or use Project
          ▸ New project) to get direct control back.
        </p>
      </>
    ),
  },
  {
    id: "library",
    title: "Library & live input",
    body: (
      <>
        <h3>Play more than one file</h3>
        <h4>Music library</h4>
        <p>
          Press <K k="Q" /> and point Beatform at your music folder once — every track appears with
          its real tags. Click to play; finished tracks flow into the next one near-gaplessly (the
          next file is decoded while the current one plays).
        </p>
        <h4>Visualize the whole system</h4>
        <p>
          The broadcast icon in the top bar visualizes whatever Windows is playing — Spotify, a
          browser, a DAW — through native loopback capture. It's analysis-only: nothing is echoed
          back out, and pressing play on a file stops the capture.
        </p>
      </>
    ),
  },
  {
    id: "live",
    title: "Live performance",
    body: (
      <>
        <h3>Beatform as a VJ rig</h3>
        <ul>
          <li>
            <strong>Switch hands-free.</strong> Number keys <K k="1" />–<K k="9" /> jump to a mode.
            With <em>Live ▸ Quantize</em> set to Beat or Bar, the switch waits and lands exactly on
            the grid — the queued chip pulses until it takes over.
          </li>
          <li>
            <strong>Stage mode</strong> (<K k="S" />) hides every piece of chrome and the cursor for
            a clean full-bleed output — project it, capture it, or screen-share it. The mode name
            flashes briefly on each switch so you can drive blind.
          </li>
          <li>
            <strong>Blackout</strong> (<K k="0" /> in Stage mode) cuts to black — the classic VJ
            cut. <K k="Esc" /> exits everything.
          </li>
          <li>
            <strong>MIDI</strong> (Live tab): map a controller's knobs to any parameter and pads to
            modes. <em>Learn CC</em>, move a knob, done — bindings are remembered. Notes obey the
            beat-quantize too.
          </li>
        </ul>
        <p>
          Everything here is preview-only — a live session never changes what an export renders.
        </p>
      </>
    ),
  },
  {
    id: "export",
    title: "Export & batch",
    body: (
      <>
        <h3>Rendering videos</h3>
        <p>
          Exports render every frame off-screen from deterministic track time. Preview and export
          share project, DSP, and shader code; live device timing and cross-GPU pixels are measured,
          not claimed identical. Formats:
        </p>
        <ul>
          <li>
            <strong>MP4</strong> — H.264 everywhere; HEVC/AV1 where your GPU encodes them. 720p→4K,
            30/60 fps, auto or manual bitrate, optional loudness normalization to −14/−16/−23 LUFS.
          </li>
          <li>
            <strong>WebM VP9 + alpha</strong> — transparent video for OBS overlays and web embeds
            (set Background to Transparent).
          </li>
          <li>
            <strong>ProRes 4444</strong> — a .mov with alpha and untouched PCM audio, straight into
            Premiere, Resolve or After Effects.
          </li>
          <li>
            <strong>PNG frames</strong> — numbered stills with alpha for compositing.
          </li>
          <li>
            <strong>GIF / animated WebP</strong> — loop files; WebP keeps alpha.
          </li>
          <li>
            <strong>Canvas loop</strong> — a 3–8 s seamless 1080×1920 loop whose tail crossfades
            into its head, made for Spotify Canvas.
          </li>
        </ul>
        <h4>Batch</h4>
        <p>
          Press <K k="B" />, drop a folder of tracks, and Beatform renders one video per track,
          titled from each file's own tags. A failed file costs that one video, never the whole
          night — and a cancelled run can resume its queued jobs later.
        </p>
      </>
    ),
  },
  {
    id: "projects",
    title: "Projects & sharing",
    body: (
      <>
        <h3>Saving and sharing your work</h3>
        <ul>
          <li>
            <strong>Projects</strong> (<K k="Ctrl+S" /> / <K k="Ctrl+O" />) — a single{" "}
            <code>.bfproj</code> file holds everything: mode, parameters, sync, backgrounds,
            overlays, timeline, Builder stacks, lyrics style, audiogram, even embedded images.
            Opening it on another machine restores the exact setup.
          </li>
          <li>
            <strong>Themes</strong> — export the whole current look as a <code>.bftheme</code>{" "}
            anyone can drop onto their Beatform window.
          </li>
          <li>
            <strong>Builder stacks</strong> — <code>.bfbuilder</code> files share a single Builder
            creation.
          </li>
          <li>
            <strong>Your looks</strong> — the Save-look button in the Visual tab stores the current
            slider state per mode, locally.
          </li>
        </ul>
        <h4>Never lose work</h4>
        <p>
          Beatform autosaves the project in the background. After a crash or force-kill, the next
          launch offers <em>Restore</em> — your unsaved tweaks come back.
        </p>
      </>
    ),
  },
  {
    id: "preferences",
    title: "Preferences, updates & shortcuts",
    body: (
      <>
        <h3>Preferences</h3>
        <p>
          The gear icon in the top bar (or <K k="Ctrl+," />) collects the choices that follow the
          app, not the project: autosave interval, save-dialog folder, a live-preview frame cap
          (exports always render every frame), GPU preference for dual-GPU laptops, and updates.
        </p>
        <h4>Updates</h4>
        <p>
          Beatform updates itself from GitHub Releases: shortly after launch it checks a static file
          (no telemetry, ever) and offers new versions in a dialog — install now, restart once,
          done. Every download is verified against Beatform's signing key before it installs. The
          automatic check can be turned off in Preferences ▸ Updates.
        </p>
        <h4>Shortcuts</h4>
        <p>
          Press <K k="H" /> for the full list. The important ones: <K k="Space" /> play/pause,{" "}
          <K k="N" />/<K k="P" /> next/previous mode, <K k="1" />–<K k="9" /> jump to a mode,{" "}
          <K k="G" /> Inspector, <K k="S" /> stage mode, <K k="0" /> blackout, <K k="F" />{" "}
          fullscreen, <K k="M" /> mute, <K k="L" /> loop, and <K k="I" />/<K k="O" /> A-B loop
          markers. Every shortcut is a letter or digit, so it sits on the same labeled key on every
          keyboard layout.
        </p>
      </>
    ),
  },
];

export function GuideDialog({ onClose }: GuideDialogProps) {
  const trapRef = useFocusTrap(true); // GD2: same H17 machinery as every modal
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0];
  const idx = SECTIONS.indexOf(active);

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
            {SECTIONS.map((s, i) => (
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
            {active.body}
            <div className="guide-pager">
              {idx > 0 ? (
                <button className="ghost-btn" onClick={() => setActiveId(SECTIONS[idx - 1].id)}>
                  ← {SECTIONS[idx - 1].title}
                </button>
              ) : (
                <span />
              )}
              {idx < SECTIONS.length - 1 && (
                <button className="ghost-btn" onClick={() => setActiveId(SECTIONS[idx + 1].id)}>
                  {SECTIONS[idx + 1].title} →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
