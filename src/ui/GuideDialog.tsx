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
            <strong>Open Visuals</strong> with <K k="G" /> (or the sliders icon, top right) to shape
            the look of the current mode. The rail down its left side holds eight pages: Mode,
            Global motion, Looks &amp; themes, Sync, Modulation, Scene, Text and Live.
          </li>
        </ol>
        <p>
          Visuals is a dock, not an overlay: the picture keeps the whole window and the dock floats
          over it, so you can watch a slider land while you drag it. Drag its left edge to resize
          (or focus that edge and use the arrow keys — Shift for bigger steps, Home/End for the
          extremes); the width and the page you were last on are both remembered.
        </p>
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
          and a full 3D bar city. Every mode except Builder, which stacks its own layers instead,
          has:
        </p>
        <ul>
          <li>
            <strong>Styles</strong> — six to fourteen curated one-click looks, in a row of chips at
            the top of the Mode page. The header above the page names the style you are on; the chip
            row reads <em>Custom</em> once you move a control away from it.
          </li>
          <li>
            <strong>Grouped controls</strong> — Shape, Color, Motion, Reaction, Glow, Image, Camera,
            Backdrop, and <em>More</em> for anything that fits none of them. Every group a visual
            uses is on the page, and each one leads with the handful of controls that change the
            look.
          </li>
          <li>
            <strong>An expert line per group</strong> — a row reading <em>3 expert controls</em>{" "}
            folds that group&rsquo;s internal constants away until you click it, and reads{" "}
            <em>n changed</em> once you move one of them. <em>Show every control</em>, below the
            groups, opens all of them at once and then reads <em>Hide expert controls</em>.
          </li>
        </ul>
        <p>
          Hover any control to see a plain-language hint in the Visuals footer. The search box at
          the top of Visuals finds any control by name, across every page of the dock — expert
          controls included, whether their line is open or not.
        </p>
        <h4>Center images</h4>
        <p>
          Bass Circle and Radial Burst can display artwork in their center: by default the track's
          embedded cover art, or any image you choose (look for <em>Center image</em> in the Image
          group on the Mode page). Both also carry a <em>Match cover colors</em> toggle, which reads
          the dominant color of that artwork and sets Hue and Hue spread to fit — automatically
          again for every new track. Two more modes use cover art their own way: Tunnel can paper
          the tunnel wall with it, and Echo Trails can use it as the shape it echoes.
        </p>
        <h4>Your own shaders</h4>
        <p>
          The <em>+</em> chip at the end of the strip opens the shader editor, where you can write a
          WGSL fragment of your own — it becomes a first-class mode, saved into your projects and
          shareable as a <code>.bfshader</code> file. Its <em>Shadertoy…</em> button takes the Image
          tab of a single-pass Shadertoy shader and translates it to WGSL on the spot, keeping the
          author and license with the visual. Both need hardware rendering: on the simplified
          Canvas2D fallback the <em>+</em> chip is switched off.
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
          wash, particles, spectrum bars, radial ring, pulse rings, waveform circle, orb core, wave
          line and vignette. Use the same type as often as you like.
        </p>
        <p>
          Builder has no style chips. Instead it ships six whole-stack starting points — Classic,
          Neon club, Sunset drive, Deep space, Cathedral and Phosphor — at the top of its panel.
          Pick one, then take it apart. Builder renders through WGSL codegen, so it needs hardware
          rendering and is switched off on the simplified Canvas2D fallback.
        </p>
        <p>Every layer has:</p>
        <ul>
          <li>its own on/off toggle and opacity,</li>
          <li>
            a <strong>blend mode</strong> (Normal, Add, Screen),
          </li>
          <li>color (hue + spread) and its own controls,</li>
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
          The Sync page routes <strong>one source</strong> to the current mode: Kicks (default),
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
          Sync gives the whole visual one feeling. Modulation aims a specific signal at a specific
          knob — kick pumps the zoom, hats flicker the glow.
        </p>
        <p>
          The page is target-first: start from <em>+ Modulate a control…</em> and pick the knob you
          want moved, and you get a card for it. Every knob of the current visual is offered, plus
          the whole post-processing chain — exposure, bloom, bloom threshold, vignette, chromatic
          and film grain — so the kick can drive Chromatic and the bass can breathe the Bloom. Each
          route on a card picks what drives it and a <strong>Depth</strong>: the share of that
          knob&rsquo;s own range added at full signal, negative to pull the other way. Open the
          card&rsquo;s chevron for the response <em>shape</em> — Linear, Exp or Smooth — plus{" "}
          <strong>Rise</strong> and <strong>Fall</strong>, so a route punches or eases. Six
          one-click <strong>recipes</strong> (Kick punch, Bass swell, Beat sway, Bar sweep, Drop
          brightness, Hat sparkle) give you a working route to edit instead of a blank page.
        </p>
        <p>
          Sources are the drums and bands (kick, snare, hats, bass, mids, treble, voice), the
          track-wide signals (loudness, energy, stereo width, section change, beat and bar phase),
          the lyric line when one is loaded, and a set of beat-synced <strong>LFOs</strong> — sine,
          saw or square over ¼ beat to 8 bars — for movement that does not wait on the music.
        </p>
        <p>
          A <strong>Driven by</strong> row above the cards shows one live meter per source actually
          in use; click one to see only the controls it moves. And wherever the knob itself lives —
          on Mode, or in the Post section on Scene — the slider picks up a <em>driven</em> mark
          while it plays, and its group header counts how many of its controls are driven. The
          slider still shows your base value; modulation moves around it.
        </p>
        <p>
          Import a stem (a drums/bass/vocals bounce starting at 0:00) with <em>+ Add stem…</em> — up
          to four. It is analyzed once and never played, and its bands become extra sources; the ✦
          button on a stem chip auto-wires its kick/bass/snare/hats/mids to the best-matching knobs
          of the current mode.
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
        <p>The Scene page picks what sits behind the visualization:</p>
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
            <strong>Image</strong> — your own picture or the track's album art, with blur and dim.
          </li>
          <li>
            <strong>Video</strong> (desktop) — a short local clip looped behind the visual,
            deterministic so exports match the preview.
          </li>
        </ul>
        <p>
          Image and video both get the same framing row: a fit of <em>Fill</em>, <em>Fit</em> or{" "}
          <em>Stretch</em>, plus Zoom and X/Y pan when you want a particular part of the picture in
          shot.
        </p>
        <p>
          Backgrounds can be scoped with the switch at the top of the Background section:{" "}
          <strong>All modes</strong> or <strong>This mode</strong>. A per-mode background wins over
          the shared one, so Spectrum Bars can sit on your video loop while Bass Circle keeps its
          animated backdrop.
        </p>
        <h4>Post effects</h4>
        <p>
          The Post section holds a <em>Filmic tonemap</em> toggle and six sliders — Exposure, Bloom,
          Bloom threshold, Vignette, Chromatic and Film grain (deterministic, so it renders the same
          every time). All of it is in the Scene page and all of it renders identically in exports.
          Bloom plus a dark background is the fastest way to make any mode look "produced". These
          six sliders are also modulation targets, so the post chain can move with the track.
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
          The Scene page's Layers section adds text and image overlays. Text supports{" "}
          <code>{"{title}"}</code> and <code>{"{artist}"}</code> placeholders filled from the
          track's tags; images can be your logo or the embedded album art. Layers anchor to nine
          positions and scale fractionally — they render identically in exports.
        </p>
        <h4>Lyrics</h4>
        <p>
          Drop an <code>.lrc</code> or <code>.srt</code> file onto the window — the current line
          follows the music karaoke-style, live and in every export. Position, size, color, fade
          timing and an <em>Animation</em> (Plain, Slide up, Pop, or Karaoke — the line fills bright
          left to right as it is sung) live on the Text page.
        </p>
        <h4>Generate lyrics (desktop)</h4>
        <p>
          No .lrc at hand? The Text page can generate timed lyrics from the loaded track, entirely
          on your PC. The mix is transcribed by OpenAI's Whisper running on whisper.cpp; in
          parallel, an Ultimate Vocal Remover (UVR) MDX-Net model isolates the vocal, and each word
          is then timed against that isolated vocal by a wav2vec2 forced aligner — so the karaoke
          fill follows the singer word by word. (Enhanced .lrc files with word tags from other tools
          get the same per-word fill when imported.) The AI models download once (size and a time
          estimate are shown first, and each one is checksum-verified) and nothing ever leaves your
          machine. Sung words are hard even for good models — expect to fix a few lines, and thanks
          to the UVR and whisper.cpp projects for making local isolation and transcription possible.
        </p>
        <h4>Audiogram</h4>
        <p>
          The audiogram adds podcast/reel-style track-driven elements, each its own toggle: a{" "}
          <em>Progress bar</em>, a <em>Time readout</em> (elapsed / total) and a{" "}
          <em>Waveform strip</em> with a moving playhead. Once any of them is on, you also get an
          accent color and a Position of Top or Bottom.
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
          grid), and automation lanes keyframe any control over time. Each scene picks a transition
          for its incoming edge: Crossfade, Wipe →, Wipe ↑, Iris, Zoom, Glitch or Hard cut.
        </p>
        <ul>
          <li>Click a keyframe dot to cycle its curve: linear → smooth → hold.</li>
          <li>
            Right-click a keyframe to remove it — or select it and press <K k="Del" />. The arrow
            keys nudge a selected keyframe.
          </li>
          <li>
            <strong>✦ Auto-arrange</strong> builds a scene arrangement from the song's detected
            sections in one click.
          </li>
        </ul>
        <p>
          <strong>Good to know:</strong> while the timeline is enabled, scenes override the mode
          strip and keyframes override the controls — that's the point, but it can look like the
          Visuals dock has stopped responding if you forget it's on. Turn the timeline off (or use{" "}
          <em>Project ▸ New project</em>) to get direct control back.
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
        <p>Both of these are desktop-only — they need the installed app, not the browser build.</p>
        <h4>Music library</h4>
        <p>
          Press <K k="Q" /> and point Beatform at your music folder once — every track appears with
          its real tags. Click to play; with <em>Auto-play next</em> on, finished tracks flow into
          the next one near-gaplessly (the next file is decoded while the current one plays).
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
            <strong>MIDI</strong> (the Live page): map a controller's knobs to any parameter and
            pads to modes. <em>Learn CC</em>, move a knob, done — bindings are remembered. Notes
            obey the beat-quantize too.
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
        <p>
          The dialog asks for a <strong>Type</strong> first — a normal <em>Video</em> render, or a{" "}
          <em>Canvas loop</em> — and then a <strong>Format</strong>:
        </p>
        <ul>
          <li>
            <strong>MP4</strong> — H.264 everywhere; HEVC and AV1 appear as codec choices where your
            GPU encodes them. Optional loudness normalization to −14/−16/−23 LUFS, and auto or
            manual bitrate.
          </li>
          <li>
            <strong>WebM VP9 + alpha</strong> — not a separate format but the <em>VP9 + alpha</em>{" "}
            codec under MP4, which writes a transparent <code>.webm</code> for OBS overlays and web
            embeds (set Background to Transparent).
          </li>
          <li>
            <strong>PNG frames</strong> — numbered stills with alpha for compositing.
          </li>
          <li>
            <strong>ProRes</strong> (desktop) — a 4444 .mov with alpha and untouched PCM audio,
            straight into Premiere, Resolve or After Effects.
          </li>
          <li>
            <strong>AV1 10-bit</strong> (desktop) — a genuine 10-bit MP4 tapped before the 8-bit
            swapchain, so wide gradients keep their levels instead of banding.
          </li>
          <li>
            <strong>GIF / animated WebP</strong> (desktop) — loop files; WebP keeps alpha.
          </li>
        </ul>
        <p>
          Resolutions follow the project's frame aspect — 720p through 4K on 16:9, 1080×1920 and
          2160×3840 on 9:16, 1080×1080 on square — at 30 or 60 fps. <strong>Canvas loop</strong> is
          the Type, not a format: a 3–8 s seamless 1080×1920 loop at 30 fps whose tail crossfades
          into its head, made for Spotify Canvas.
        </p>
        <h4>Batch</h4>
        <p>
          Press <K k="B" />, drop a folder of tracks, and Beatform renders one video per track,
          titled from each file's own tags (anything untagged falls back to the filename and is
          flagged). A failed file costs that one video, never the whole night — and if you cancel a
          run, the jobs it never reached stay queued so you can resume or retry them. That queue
          lives in the session: closing the app clears it.
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
            <code>.bfproj</code> file holds everything: mode, controls, sync, backgrounds, overlays,
            timeline, Builder stacks, lyrics style, audiogram, even embedded images. Opening it on
            another machine restores the exact setup.
          </li>
          <li>
            <strong>Themes</strong> — <em>Visuals ▸ Looks &amp; themes</em> exports the whole
            current look as a <code>.bftheme</code> anyone can drop onto their Beatform window.
          </li>
          <li>
            <strong>Builder stacks</strong> — <code>.bfbuilder</code> files share a single Builder
            creation.
          </li>
          <li>
            <strong>Your looks</strong> — <em>+ Save look</em> on <em>Looks &amp; themes</em> stores
            the current control values for one mode, locally, and exports as a{" "}
            <code>.bfpreset</code>. The visual&rsquo;s factory style chips stay on Mode, beside the
            header that names the active one.
          </li>
        </ul>
        <p>
          The short version: a <strong>Style</strong> is a chip the visual ships with, a{" "}
          <strong>Look</strong> is one you saved for one mode, and a <strong>Theme</strong> is the
          whole document — mode, controls, background, layers, post, timeline — in one file.
        </p>
        <h4>Never lose work</h4>
        <p>
          On desktop, Beatform autosaves the project in the background (the delay is yours to set in
          Preferences). After a crash or force-kill, the next launch offers <em>Restore</em> — your
          unsaved tweaks come back.
        </p>
      </>
    ),
  },
  {
    id: "gallery",
    title: "Gallery",
    body: (
      <>
        <h3>Looks and themes other people made</h3>
        <p>
          The <em>Gallery</em> button in the top bar opens a curated, public collection of looks and
          themes you can use without leaving the app. Filter it by <em>All</em>, <em>Looks</em> or{" "}
          <em>Themes</em>, or search it by name.
        </p>
        <ul>
          <li>
            <strong>+ Add look</strong> puts that entry into your own saved looks for the mode it
            belongs to, and applies it straight away.
          </li>
          <li>
            <strong>Apply theme</strong> replaces your whole setup with that entry — mode, controls,
            background, layers, post, the lot. As with any theme, <K k="Ctrl+Z" /> undoes it.
          </li>
        </ul>
        <p>
          <em>Looks &amp; themes</em> in the Visuals dock has its own two shortcuts into the
          Gallery, pre-filtered to whichever of the two you were looking at.
        </p>
        <h4>Why it is safe to click</h4>
        <p>
          Entries carry no code — a look or a theme can only select and parameterize visuals
          Beatform already ships, so applying one is exactly as safe as clicking around the UI.
          Every file is pinned to an immutable version, downloaded only from the one allowed
          location, and checksum-verified before Beatform will even parse it. An entry that needs a
          newer Beatform than you have says <em>Needs app update</em> rather than half-loading.
        </p>
        <p>
          The collection lives on GitHub as <code>beatform-app/gallery</code> and submissions are
          reviewed there — the dialog links you to it.
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
          app rather than the project — nothing here is saved into a <code>.bfproj</code>. Four
          tabs:
        </p>
        <ul>
          <li>
            <strong>General</strong> — the autosave delay (desktop) and the folder your save dialogs
            open in, with a <em>Forget</em> button.
          </li>
          <li>
            <strong>Modes</strong> — drag the mode strip into the order you actually use, or reset
            it. This is also the order <K k="1" />–<K k="9" /> jump to.
          </li>
          <li>
            <strong>Performance</strong> — a live-preview frame cap (Display / 60 / 30) and a
            preview resolution (Native / 75% / 50%), neither of which touches an export: those
            always render every frame at full size. Also a <em>GPU preference</em> for dual-GPU
            laptops (it applies on the next launch), and <em>Performance display</em> — a live FPS /
            CPU / memory readout drawn over the preview, with its own corner, size, color and choice
            of stats. It is drawn over the picture, never into it, so it cannot reach an export.
          </li>
          <li>
            <strong>Updates</strong> — below.
          </li>
        </ul>
        <h4>Updates</h4>
        <p>
          Beatform updates itself from GitHub Releases: shortly after launch it checks a static file
          (no telemetry, ever) and offers new versions in a dialog — install now, restart once,
          done. Every download is verified against Beatform's signing key before it installs. The
          automatic check can be turned off in Preferences ▸ Updates.
        </p>
        <h4>Shortcuts</h4>
        <p>
          Press <K k="H" /> for the full list — that overlay is also where the button to this guide
          lives. The important ones: <K k="Space" /> play/pause, <K k="N" />/<K k="P" />{" "}
          next/previous mode, <K k="1" />–<K k="9" /> jump to a mode, <K k="G" /> Visuals,{" "}
          <K k="S" /> stage mode, <K k="0" /> blackout (in Stage mode), <K k="F" /> fullscreen,{" "}
          <K k="M" /> mute, <K k="L" /> loop, and <K k="I" />/<K k="O" /> A-B loop markers. Arrow
          keys seek and set volume, and <K k="Esc" /> closes whatever is open.
        </p>
        <p>
          Every performance shortcut has a letter or digit as its main binding, so it sits on the
          same labeled key on every keyboard layout — QWERTZ and AZERTY included. The punctuation
          keys some of them also answer to (<K k="[" />, <K k="]" />, <K k="\" />, <K k="." />) are
          kept for US-layout muscle memory and are bound by physical position, not by the character
          printed on them.
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
