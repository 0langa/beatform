export type Inline =
  | string
  | { kbd: string }
  | { em: string }
  | { strong: string }
  | { code: string }
  | { link: { text: string; href: string } };

export type DerivedKind = "shortcut-sheet" | "mod-sources" | "preferences-tabs";

export type Block =
  | { h4: string }
  | { p: Inline[] }
  | { ul: Inline[][] }
  | { ol: Inline[][] }
  | { derived: DerivedKind };

export interface GuideSection {
  id: string;
  title: string;
  blocks: Block[];
}

export const GUIDE: readonly GuideSection[] = [
  {
    id: "start",
    title: "Getting started",
    blocks: [
      {
        p: [
          "Beatform turns music into visuals — live on your screen, and rendered to video files that look exactly like the preview. Everything runs locally on your machine: no account, no uploads, no telemetry.",
        ],
      },
      { h4: "Your first minute" },
      {
        ol: [
          [
            { strong: "Load music." },
            " Drop an audio file anywhere on the window (MP3, FLAC, WAV, OGG or M4A), click ",
            { em: "Browse files" },
            ", or try one of the built-in demo tracks. Beatform analyzes the track for tempo, key and loudness in the background.",
          ],
          [{ strong: "Press Space." }, " The visual reacts to the music immediately."],
          [
            { strong: "Try the modes." },
            " The strip at the top holds every visual mode — click one, or walk through them with ",
            { kbd: "N" },
            " and ",
            { kbd: "P" },
            ".",
          ],
          [
            { strong: "Open Visuals" },
            " with ",
            { kbd: "G" },
            " (or the sliders icon, top right) to shape the look of the current mode. The rail down its left side holds eight pages: Mode, Global motion, Looks & themes, Sync, Modulation, Scene, Text and Live.",
          ],
        ],
      },
      {
        p: [
          "Visuals is a dock, not an overlay: the picture keeps the whole window and the dock floats over it, so you can watch a slider land while you drag it. Drag its left edge to resize (or focus that edge and use the arrow keys — Shift for bigger steps, Home/End for the extremes); the width and the page you were last on are both remembered. Pages themselves never fold away — it's the control groups within a page, like Mode's Shape and Color, that fold, and each one remembers whether you left it open.",
        ],
      },
      {
        p: [
          "When something looks wrong or you get lost, ",
          { em: "Project ▸ New project" },
          " resets the whole document to clean defaults — one ",
          { kbd: "Ctrl+Z" },
          " undoes even that.",
        ],
      },
      { h4: "Loop a section while you tune" },
      {
        p: [
          "Press ",
          { kbd: "I" },
          " at the start of a drop and ",
          { kbd: "O" },
          " at the end, or use the ",
          { strong: "A" },
          "/",
          { strong: "B" },
          " buttons beside the player. The selected region appears on the seek bar; drag either marker to adjust it, then press ",
          { kbd: "L" },
          " to loop it. Click ",
          { strong: "×" },
          " beside A/B to clear the markers without turning the loop off — ",
          { kbd: "L" },
          " then covers the whole track again. A-B markers are session-only and reset when another track loads.",
        ],
      },
      {
        p: [
          "One bit of vocabulary that comes up throughout the rest of this guide: a ",
          { strong: "Style" },
          " is a chip a visual ships with, a ",
          { strong: "Look" },
          " is a control set you save for one mode, a ",
          { strong: "Theme" },
          " is a whole document in one file, and the ",
          { strong: "Gallery" },
          " is where other people's looks and themes live.",
        ],
      },
    ],
  },
  {
    id: "modes",
    title: "Visual modes",
    blocks: [
      {
        p: [
          "Sixteen modes live on the strip — from classic spectrum bars to 120k-particle flow fields and a full 3D bar city. Every mode except Builder, which stacks its own layers instead, has:",
        ],
      },
      {
        ul: [
          [
            { strong: "Styles" },
            " — six to fourteen curated one-click looks, in a row of chips at the top of the Mode page. The header above the page names the style you are on; the chip row reads ",
            { em: "Custom" },
            " once you move a control away from it.",
          ],
          [
            { strong: "Grouped controls" },
            " — Shape, Color, Motion, Reaction, Glow, Image, Camera, Backdrop, and ",
            { em: "More" },
            " for anything that fits none of them. Every group a visual uses is on the page, and each one leads with the handful of controls that change the look.",
          ],
          [
            { strong: "An expert line per group" },
            " — a row reading ",
            { em: "3 expert controls" },
            " folds that group's internal constants away until you click it, and reads ",
            { em: "n changed" },
            " once you move one of them. ",
            { em: "Show every control" },
            ", below the groups, opens all of them at once and then reads ",
            { em: "Hide expert controls" },
            ".",
          ],
        ],
      },
      {
        p: [
          "Hover any control to see a plain-language hint in the Visuals footer. The search box at the top of Visuals finds any control by name, across every page of the dock — expert controls included, whether their line is open or not.",
        ],
      },
      { h4: "Center images" },
      {
        p: [
          "Bass Circle and Radial Burst can display artwork in their center: by default the track's embedded cover art, or any image you choose (look for ",
          { em: "Center image" },
          " in the Image group on the Mode page). Both also carry a ",
          { em: "Match cover colors" },
          " toggle, which reads the dominant color of that artwork and sets Hue and Hue spread to fit — automatically again for every new track. Two more modes use cover art their own way: Tunnel can paper the tunnel wall with it (the ",
          { strong: "Cover wall" },
          " control), and Echo Trails can use it as the shape it echoes (",
          { strong: "Source shape" },
          ").",
        ],
      },
      { h4: "Your own shaders" },
      {
        p: [
          "The ",
          { em: "+" },
          " chip at the end of the strip opens the shader editor, where you can write a WGSL fragment of your own — it becomes a first-class mode, saved into your projects and shareable as a ",
          { code: ".bfshader" },
          " file. Its ",
          { em: "Shadertoy…" },
          " button takes the Image tab of a single-pass Shadertoy shader and translates it to WGSL on the spot, keeping the author and license with the visual. Both need hardware rendering: on the simplified Canvas2D fallback the ",
          { em: "+" },
          " chip is switched off.",
        ],
      },
      { h4: "Global motion" },
      {
        p: [
          "Visuals ▸ Global motion holds three masters that scale a mode's own motion up or down: ",
          { strong: "Rotation" },
          " (spin) and ",
          { strong: "Pulse" },
          " (beat pumping) each run 0–200%, and ",
          { strong: "Detail" },
          " (how many bars, points or segments it draws) runs 0–100% — dial a look calmer or wilder from one place. A slider only appears when the current mode can actually move that way, and exports match whatever you set.",
        ],
      },
      {
        p: [
          "There's a fourth master too: spectrum smoothing is a motion setting, but its slider lives on Sync beside the other spectrum controls rather than here — the page's name says which of the two kinds of motion control this is, since a visual's own motion controls sit in the Motion group on Mode instead. On a visual that has nothing to rotate or pulse, the Global motion destination itself is dimmed and says so.",
        ],
      },
    ],
  },
  {
    id: "builder",
    title: "Builder",
    blocks: [
      {
        p: [
          "Builder is a layer compositor: stack up to twelve layers from nine types — background wash, particles, spectrum bars, radial ring, pulse rings, waveform circle, orb core, wave line and vignette. Use the same type as often as you like.",
        ],
      },
      {
        p: [
          "Builder has no style chips. Instead it ships six whole-stack starting points — Classic, Neon club, Sunset drive, Deep space, Cathedral and Phosphor — at the top of its panel. Pick one, then take it apart. Builder renders through WGSL codegen, so it needs hardware rendering and is switched off on the simplified Canvas2D fallback.",
        ],
      },
      { p: ["Every layer has:"] },
      {
        ul: [
          ["its own on/off toggle and opacity,"],
          ["a ", { strong: "blend mode" }, " (Normal, Add, Screen),"],
          ["color (hue + spread) and its own controls,"],
          ["reorder arrows and a duplicate button."],
        ],
      },
      {
        p: [
          "Stacks are saved inside your project like any other setting. ",
          { em: "Export .bfbuilder" },
          " writes a stack as a single small file anyone can import — a good way to share looks.",
        ],
      },
    ],
  },
  {
    id: "sync",
    title: "Sync & reactivity",
    blocks: [
      {
        p: [
          "The Sync page routes ",
          { strong: "one source" },
          " to the current mode: ",
          { strong: "Kicks" },
          " (default), Energy, Bass, Melody, Voice, Treble, Snare or Hats. Pick what should drive the motion — a vocal-heavy track often looks better on Voice than on Kicks — and the choice is saved per mode, so one mode can sit on Voice while the rest stay on Kicks.",
        ],
      },
      { h4: "Response feel" },
      {
        p: [
          { strong: "Smoothing" },
          " sets the overall response: 0 is punchy, 1 glides. For asymmetric feel, set ",
          { strong: "Attack" },
          " (how fast the reaction rises) and ",
          { strong: "Release" },
          " (how slowly it falls) separately.",
        ],
      },
      { h4: "Shaping the drawn spectrum" },
      {
        p: [
          "In modes that draw the spectrum, a cluster of controls governs how much detail it shows and how the bars themselves look.",
        ],
      },
      {
        p: [
          { strong: "Resolution" },
          " controls only the spectrum that's drawn: its three buttons are labeled with the actual window they produce at your device's sample rate — roughly 85 ms, 170 ms and 340 ms — rather than with adjectives, each one doubling the last, up to the 32768-point ceiling Web Audio itself imposes. A longer window resolves closer low tones but carries more audio history, so each button also states the visual latency that costs.",
        ],
      },
      {
        p: [
          { strong: "Axis" },
          " chooses Musical — a log axis, equal width per octave — or Linear, equal hertz per horizontal step. ",
          { strong: "Sampling" },
          " chooses 96 bands, which resamples the transform to keep the usual 96-bar layout, or FFT bins, which reads the transform's own integer bins directly: linear only, and fewer than 96 bars wherever the selected range physically contains fewer.",
        ],
      },
      { p: ["Three more controls shape the bars themselves:"] },
      {
        ul: [
          [
            { strong: "Merge" },
            ' — bars prop up their neighbors, melting lone spikes into one connected silhouette (the "Monstercat" look).',
          ],
          [
            { strong: "Rounding" },
            " — averages neighboring bars: real smoothing that removes hard spikes rather than just curving between them.",
          ],
          [
            { strong: "Contrast" },
            " — below 50% flattens toward fuller, calmer bars; above 50% exaggerates peaks. 50% is neutral.",
          ],
        ],
      },
      {
        p: [
          { strong: "Low edge" },
          " and ",
          { strong: "High edge" },
          " set the frequency span the bars cover: raise the low edge (10–500 Hz) to stop spending bars on sub-bass a track doesn't have, or lower the high edge — it runs from 22 kHz all the way down to 200 Hz — to give a narrow musical range more of the width.",
        ],
      },
      {
        p: [
          "A live readout below the controls spells out exactly what you're looking at: the real window and visual latency at your device's sample rate, hertz per bin, how many native bins fall in range, and how many bars or bands are actually drawn — so nothing here implies more detail than the transform contains. None of it touches what the visual reacts to, though: kicks, beats, band energies and sync timing all stay on the fast, fixed-resolution detector, and everything here is saved per mode and applies identically in exports.",
        ],
      },
      { h4: "Beat reaction" },
      {
        p: [
          "Two kinds of beat reaction work together: ",
          { strong: "onset pulses" },
          " fire on an actual hit in the selected band, and ",
          { strong: "beat-grid pulses" },
          " ride the track's detected tempo grid instead, landing on every metronome beat (the BPM is shown in the Visuals footer).",
        ],
      },
      {
        p: [
          "Synthwave's grid scrolls exactly one line per beat, Tunnel launches a light ring that arrives just as the next one lands, and Bass Circle pumps on the grid. A track with no detectable grid falls back to onset pulses automatically.",
        ],
      },
      { h4: "Modulation" },
      {
        p: [
          "Sync gives the whole visual one feeling. Modulation aims a specific signal at a specific knob — kick pumps the zoom, hats flicker the glow.",
        ],
      },
      {
        p: [
          "The page is target-first: start from ",
          { em: "+ Modulate a control…" },
          " and pick the knob you want moved, and you get a card for it. Every knob of the current visual is offered, plus the whole post-processing chain — exposure, bloom, bloom threshold, vignette, chromatic and film grain — so the kick can drive Chromatic and the bass can breathe the Bloom. Each route on a card picks what drives it and a ",
          { strong: "Depth" },
          ": the share of that knob's own range added at full signal, negative to pull the other way. Open the card's chevron for the response ",
          { em: "shape" },
          " — Linear, Exp or Smooth — plus ",
          { strong: "Rise" },
          " and ",
          { strong: "Fall" },
          ", so a route punches or eases. Six one-click ",
          { strong: "recipes" },
          " (Kick punch, Bass swell, Beat sway, Bar sweep, Drop brightness, Hat sparkle) give you a working route to edit instead of a blank page.",
        ],
      },
      {
        p: [
          "Sources cover the drums and bands, the track-wide signals, the lyric line when one is loaded, and any imported stem's bands:",
        ],
      },
      { derived: "mod-sources" },
      {
        p: [
          "Eighteen tempo-synced ",
          { strong: "LFOs" },
          " — sine, saw or square across ¼ beat to 8 beats — for movement that does not wait on the music.",
        ],
      },
      {
        p: [
          "A ",
          { strong: "Driven by" },
          " row above the cards shows one live meter per source actually in use; click one to see only the controls it moves. And wherever the knob itself lives — on Mode, or in the Post section on Scene — the slider picks up a ",
          { em: "driven" },
          " mark while it plays, and its group header counts how many of its controls are driven. The slider still shows your base value; modulation moves around it.",
        ],
      },
      {
        p: [
          "Import a stem (a drums/bass/vocals bounce starting at 0:00) with ",
          { em: "+ Add stem…" },
          " — up to four. It is analyzed once and never played, and its bands become extra sources; the ✦ button on a stem chip auto-wires its kick/bass/snare/hats/mids to the best-matching knobs of the current mode.",
        ],
      },
    ],
  },
  {
    id: "scene",
    title: "Backgrounds & scene",
    blocks: [
      { h4: "Backgrounds" },
      { p: ["The Scene page picks what sits behind the visualization:"] },
      {
        ul: [
          [{ strong: "Animated" }, " — the mode's own moving background."],
          [{ strong: "Solid" }, " — a flat color, including chroma green/magenta for keying."],
          [
            { strong: "Transparent" },
            " — see-through (checkerboard in the preview); pair with the alpha export formats.",
          ],
          [{ strong: "Image" }, " — your own picture or the track's album art, with blur and dim."],
          [
            { strong: "Video" },
            " (desktop) — a short local clip looped behind the visual, deterministic so exports match the preview.",
          ],
        ],
      },
      {
        p: [
          "Image and video both get the same framing row: a fit of ",
          { em: "Fill" },
          ", ",
          { em: "Fit" },
          " or ",
          { em: "Stretch" },
          ", plus Zoom and X/Y pan when you want a particular part of the picture in shot.",
        ],
      },
      {
        p: [
          "Backgrounds can be scoped with the switch at the top of the Background section: ",
          { strong: "All modes" },
          " or ",
          { strong: "This mode" },
          ". A per-mode background wins over the shared one, so Spectrum Bars can sit on your video loop while Bass Circle keeps its animated backdrop.",
        ],
      },
      { h4: "Post effects" },
      {
        p: [
          "The Post section holds a ",
          { em: "Filmic tonemap" },
          ' toggle and six sliders — Exposure, Bloom, Bloom threshold, Vignette, Chromatic and Film grain (deterministic, so it renders the same every time). All of it is in the Scene page and all of it renders identically in exports. Bloom plus a dark background is the fastest way to make any mode look "produced". These six sliders are also modulation targets, so the post chain can move with the track.',
        ],
      },
      { h4: "Aspect" },
      {
        p: [
          "The frame aspect (Fill, 16:9, 9:16, 1:1) is a project setting — visuals compose into the frame, so vertical exports for Shorts/Reels look designed, not cropped.",
        ],
      },
    ],
  },
  {
    id: "overlays",
    title: "Text, lyrics & audiogram",
    blocks: [
      { h4: "Text and images" },
      {
        p: [
          "The Scene page's Layers section adds text and image overlays. Text supports ",
          { code: "{title}" },
          " and ",
          { code: "{artist}" },
          " placeholders filled from the track's tags; images can be your logo or the embedded album art. Layers anchor to nine positions and scale fractionally — they render identically in exports.",
        ],
      },
      { h4: "Lyrics" },
      {
        p: [
          "Drop an ",
          { code: ".lrc" },
          " or ",
          { code: ".srt" },
          " file onto the window — the current line follows the music karaoke-style, live and in every export. Position, size, color, fade timing and an ",
          { em: "Animation" },
          " (Plain, Slide up, Pop, or Karaoke — the line fills bright left to right as it is sung) live on the Text page. Drop the lyrics alongside the track or after it — they attach to the loaded track just like an imported stem does.",
        ],
      },
      { h4: "Generate lyrics (desktop)" },
      {
        p: [
          "No .lrc at hand? The Text page can generate timed lyrics from the loaded track, entirely on your PC. The mix is transcribed by OpenAI's Whisper running on whisper.cpp; in parallel, an Ultimate Vocal Remover (UVR) MDX-Net model isolates the vocal, and each word is then timed against that isolated vocal by a wav2vec2 forced aligner — so the karaoke fill follows the singer word by word. (Enhanced .lrc files with word tags from other tools get the same per-word fill when imported.) The AI models download once (size and a time estimate are shown first, and each one is checksum-verified) and nothing ever leaves your machine. Sung words are hard even for good models — expect to fix a few lines, and thanks to the UVR and whisper.cpp projects for making local isolation and transcription possible.",
        ],
      },
      { h4: "Edit lyrics" },
      {
        p: [
          "Once a track has lyrics — imported or generated — the Text page's ",
          { strong: "Edit lyrics" },
          " section turns every line into something you can fix by hand: click a line to select it, click its time to jump the track there, or double-click the time to type an exact one.",
        ],
      },
      {
        p: [
          "A selected line's toolbar can nudge it earlier or later, split it at the text cursor, merge it into the next line, insert an empty line above or below, delete it (",
          { kbd: "Ctrl+Z" },
          " brings it straight back), or re-align it — re-running the word aligner against the isolated vocal for that line's text (desktop only, once the lyrics models are downloaded and a track is loaded). Lines the aligner wasn't confident about are flagged red or amber, and a ",
          { strong: "⚑ next" },
          " button jumps to the next one.",
        ],
      },
      {
        p: [
          "Opening a line's word view breaks the karaoke timing down word by word: edit a word's text, nudge its start time, or reset the whole line with ",
          { strong: "⇤⇥ even" },
          " to space every word out evenly when the alignment came out scrambled. Editing here has its own undo/redo (",
          { kbd: "Ctrl+Z" },
          " / ",
          { kbd: "Ctrl+Y" },
          "), separate from the rest of the app, and ",
          { strong: "Save .lrc" },
          " writes the corrected lyrics back out, word timing included.",
        ],
      },
      { h4: "Audiogram" },
      {
        p: [
          "The audiogram adds podcast/reel-style track-driven elements, each its own toggle: a ",
          { em: "Progress bar" },
          ", a ",
          { em: "Time readout" },
          " (elapsed / total) and a ",
          { em: "Waveform strip" },
          " with a moving playhead. Once any of them is on, you also get an accent color and a Position of Top or Bottom.",
        ],
      },
    ],
  },
  {
    id: "timeline",
    title: "Timeline",
    blocks: [
      {
        p: [
          "Press ",
          { kbd: "T" },
          ". Scenes switch visual modes at chosen beats (drags snap to the detected grid), and automation lanes keyframe any control over time. Each scene picks a transition for its incoming edge: Crossfade, Wipe →, Wipe ↑, Iris, Zoom, Glitch or Hard cut.",
        ],
      },
      {
        ul: [
          ["Click a keyframe dot to cycle its curve: linear → smooth → hold."],
          [
            "Right-click a keyframe to remove it — or select it and press ",
            { kbd: "Del" },
            ". The arrow keys nudge a selected keyframe.",
          ],
          [
            { strong: "✦ Auto-arrange" },
            " builds a scene arrangement from the song's detected sections in one click.",
          ],
        ],
      },
      {
        p: [
          { strong: "Good to know:" },
          " while the timeline is enabled, scenes override the mode strip and keyframes override the controls — that's the point, but it can look like the Visuals dock has stopped responding if you forget it's on. Turn the timeline off (or use ",
          { em: "Project ▸ New project" },
          ") to get direct control back.",
        ],
      },
    ],
  },
  {
    id: "library",
    title: "Library & live input",
    blocks: [
      {
        p: ["Both of these are desktop-only — they need the installed app, not the browser build."],
      },
      { h4: "Music library" },
      {
        p: [
          "Press ",
          { kbd: "Q" },
          " and point Beatform at your music folder once — every track appears with its real tags. Click to play; with ",
          { em: "Auto-play next" },
          " on, finished tracks flow into the next one near-gaplessly (the next file is decoded while the current one plays).",
        ],
      },
      { h4: "Visualize the whole system" },
      {
        p: [
          "The broadcast icon in the top bar visualizes whatever Windows is playing — Spotify, a browser, a DAW — through native loopback capture. It's analysis-only: nothing is echoed back out, and pressing play on a file stops the capture.",
        ],
      },
    ],
  },
  {
    id: "live",
    title: "Live performance",
    blocks: [
      {
        ul: [
          [
            { strong: "Switch hands-free." },
            " Number keys ",
            { kbd: "1" },
            "–",
            { kbd: "9" },
            " jump to a mode. With ",
            { em: "Live ▸ Quantize" },
            " set to Beat or Bar, the switch waits and lands exactly on the grid — the queued chip pulses until it takes over.",
          ],
          [
            { strong: "Stage mode" },
            " (",
            { kbd: "S" },
            ") hides every piece of chrome and the cursor for a clean full-bleed output — project it, capture it, or screen-share it. The mode name flashes briefly on each switch so you can drive blind.",
          ],
          [
            { strong: "Blackout" },
            " (",
            { kbd: "0" },
            " in Stage mode) cuts to black — the classic VJ cut. ",
            { kbd: "Esc" },
            " exits everything.",
          ],
          [
            { strong: "MIDI" },
            " (the Live page): map a controller's knobs to any parameter and pads to modes. ",
            { em: "Learn CC" },
            ", then move a knob, binds it to the selected parameter. The ",
            { em: "Learn note →" },
            " button always names whichever mode you currently have open — switch to that mode first, click it, then play a pad to bind that note to switching there (note switches obey the beat-quantize too). Bindings are remembered.",
          ],
        ],
      },
      {
        p: [
          "Everything here is preview-only — a live session never changes what an export renders.",
        ],
      },
    ],
  },
  {
    id: "export",
    title: "Export & batch",
    blocks: [
      {
        p: [
          "Exports render every frame off-screen from deterministic track time. Preview and export share project, DSP, and shader code; live device timing and cross-GPU pixels are measured, not claimed identical — the exact scope and tolerances are in the ",
          {
            link: {
              text: "preview/export truth contract",
              href: "https://0langa.github.io/beatform/PREVIEW-EXPORT-CONTRACT",
            },
          },
          ". Formats:",
        ],
      },
      {
        p: [
          "The dialog asks for a ",
          { strong: "Type" },
          " first — a normal ",
          { em: "Video" },
          " render, or a ",
          { em: "Canvas loop" },
          " — and then a ",
          { strong: "Format" },
          ":",
        ],
      },
      {
        ul: [
          [
            { strong: "MP4" },
            " — H.264 everywhere; HEVC and AV1 appear as codec choices where your GPU encodes them. Auto or manual bitrate (2–60 Mbps), and optional loudness normalization to −14/−16/−23 LUFS with a −1 dBTP ceiling (audio only — pixels unchanged).",
          ],
          [
            { strong: "WebM VP9 + alpha" },
            " — not a separate format but the ",
            { em: "VP9 + alpha" },
            " codec under MP4, which writes a transparent ",
            { code: ".webm" },
            " for OBS overlays and web embeds (set Background to Transparent).",
          ],
          [{ strong: "PNG frames" }, " (desktop) — numbered stills with alpha for compositing."],
          [
            { strong: "ProRes" },
            " (desktop) — a 4444 .mov with alpha and untouched PCM audio, straight into Premiere, Resolve or After Effects.",
          ],
          [
            { strong: "AV1 10-bit" },
            " (desktop) — a genuine 10-bit MP4 tapped before the 8-bit swapchain, so wide gradients keep their levels instead of banding.",
          ],
          [{ strong: "GIF / animated WebP" }, " (desktop) — loop files; WebP keeps alpha."],
        ],
      },
      {
        p: [
          "Resolutions follow the project's frame aspect — 720p through 4K on 16:9, 1080×1920 and 2160×3840 on 9:16, 1080×1080 on square — at 30 or 60 fps. ",
          { strong: "Canvas loop" },
          " is the Type, not a format: a 3–8 s seamless 1080×1920 loop at 30 fps whose tail crossfades into its head, made for Spotify Canvas — which only accepts MP4, so choosing it turns off PNG, ProRes and AV1 (GIF and WebP stay available, since a seamless loop is what they're for too).",
        ],
      },
      { h4: "Batch" },
      {
        p: [
          "Press ",
          { kbd: "B" },
          ", drop a folder of tracks, and Beatform renders one video per track, titled from each file's own tags (anything untagged falls back to the filename and is flagged). A failed file costs that one video, never the whole night — and if you cancel a run, the jobs it never reached stay queued so you can resume or retry them. That queue lives in the session: closing the app clears it.",
        ],
      },
    ],
  },
  {
    id: "projects",
    title: "Projects & sharing",
    blocks: [
      {
        ul: [
          [
            { strong: "Projects" },
            " (",
            { kbd: "Ctrl+S" },
            " / ",
            { kbd: "Ctrl+O" },
            ") — a single ",
            { code: ".bfproj" },
            " file holds everything: mode, controls, sync, backgrounds, overlays, timeline, Builder stacks, lyrics style, audiogram, even embedded images. Opening it on another machine restores the exact setup.",
          ],
          [
            { strong: "Themes" },
            " — ",
            { em: "Visuals ▸ Looks & themes" },
            " exports the whole current look as a ",
            { code: ".bftheme" },
            " anyone can drop onto their Beatform window (",
            {
              link: {
                text: "file format reference",
                href: "https://0langa.github.io/beatform/templates",
              },
            },
            ").",
          ],
          [
            { strong: "Builder stacks" },
            " — ",
            { code: ".bfbuilder" },
            " files share a single Builder creation.",
          ],
          [
            { strong: "Your looks" },
            " — ",
            { em: "Save look" },
            " (in the page header, or on ",
            { em: "Looks & themes" },
            ") stores the current control values for one mode, locally, and exports as a ",
            { code: ".bfpreset" },
            ". The visual's factory style chips stay on Mode, beside the header that names the active one.",
          ],
        ],
      },
      { h4: "Never lose work" },
      {
        p: [
          "On desktop, Beatform saves your project automatically in the background (how quickly is yours to set in Preferences), and closing the window — or a crash — always flushes the very latest edit first, so nothing from the moment before is lost. Reopen the app and your work is simply there; after a crash or force-kill, a quick note lets you know it was recovered.",
        ],
      },
    ],
  },
  {
    id: "gallery",
    title: "Gallery",
    blocks: [
      {
        p: [
          "The ",
          { em: "Gallery" },
          " button in the top bar opens a curated, public collection of looks and themes you can use without leaving the app. Filter it by ",
          { em: "All" },
          ", ",
          { em: "Looks" },
          " or ",
          { em: "Themes" },
          ", or search it by name.",
        ],
      },
      {
        ul: [
          [
            { strong: "+ Add look" },
            " puts that entry into your own saved looks for the mode it belongs to, and applies it straight away.",
          ],
          [
            { strong: "Apply theme" },
            " replaces your whole setup with that entry — mode, controls, background, layers, post, the lot. As with any theme, ",
            { kbd: "Ctrl+Z" },
            " undoes it.",
          ],
        ],
      },
      {
        p: [
          { em: "Looks & themes" },
          " in the Visuals dock has its own two shortcuts into the Gallery, pre-filtered to whichever of the two you were looking at.",
        ],
      },
      { h4: "Why it is safe to click" },
      {
        p: [
          "Entries carry no code — a look or a theme can only select and parameterize visuals Beatform already ships, so applying one is exactly as safe as clicking around the UI. Every file is pinned to an immutable commit, downloaded only from the one allowed location, and checksum-verified before Beatform will even parse it. An entry that needs a newer Beatform than you have says ",
          { em: "Needs app update" },
          " rather than half-loading.",
        ],
      },
      {
        p: [
          "The collection lives on GitHub as ",
          { code: "beatform-app/gallery" },
          " and submissions are reviewed there — the dialog links you to it.",
        ],
      },
      { h4: "Submitting" },
      {
        p: [
          "Have a look or theme worth sharing? ",
          { code: "node scripts/gallery-submit.mjs <file>" },
          " validates it with the app's own checks, computes the hash and size the registry needs, and prints a ready pull-request body — one command instead of several manual steps. It only prepares that text; nothing is uploaded or opened on your behalf.",
        ],
      },
    ],
  },
  {
    id: "preferences",
    title: "Preferences, updates & shortcuts",
    blocks: [
      {
        p: [
          "The gear icon in the top bar (or ",
          { kbd: "Ctrl+," },
          ") collects the choices that follow the app rather than the project — nothing here is saved into a ",
          { code: ".bfproj" },
          ". Four tabs:",
        ],
      },
      { derived: "preferences-tabs" },
      { h4: "Updates" },
      {
        p: [
          "Beatform updates itself from GitHub Releases: shortly after launch it checks a static file (no telemetry, ever) and offers new versions in a dialog — install now, restart once, done. Every download is verified against Beatform's signing key before it installs. The automatic check can be turned off in Preferences ▸ Updates.",
        ],
      },
      { h4: "Shortcuts" },
      {
        p: [
          "Press ",
          { kbd: "H" },
          " for the full list — that overlay is also where the button to this guide lives.",
        ],
      },
      { derived: "shortcut-sheet" },
      {
        p: [
          "Every performance shortcut has a letter or digit as its main binding, so it sits on the same labeled key on every keyboard layout — QWERTZ and AZERTY included. The punctuation keys some of them also answer to (",
          { kbd: "[" },
          ", ",
          { kbd: "]" },
          ", ",
          { kbd: "\\" },
          ", ",
          { kbd: "." },
          ") are kept for US-layout muscle memory and are bound by physical position, not by the character printed on them. And ",
          { kbd: "Esc" },
          ", wherever you are, closes whatever's open.",
        ],
      },
    ],
  },
  {
    id: "faq",
    title: "FAQ",
    blocks: [
      { h4: "What can I export without the desktop app?" },
      {
        p: [
          "MP4 (H.264 everywhere, HEVC/AV1 where your GPU supports them) and WebM with a real alpha channel both render in the browser build. Everything else needs the desktop app: PNG frames because writing a folder of numbered stills has no browser equivalent, and ProRes, genuine 10-bit AV1, and GIF/animated WebP because they're encoded by the bundled ffmpeg sidecar rather than the browser's own WebCodecs pipeline.",
        ],
      },
      { h4: "Why does an export sometimes take longer than the song itself?" },
      {
        p: [
          "Export renders and encodes every frame for real, so its speed depends on your resolution, frame rate, codec and GPU — not on the length of the track. Hardware-encoded MP4 at common resolutions usually finishes faster than realtime. ProRes, 10-bit AV1, GIF and WebP stream frames into the bundled ffmpeg encoder and can run well under realtime, especially at 4K or when your GPU falls back to software encoding — Beatform doesn't promise a particular speed for any format.",
        ],
      },
      { h4: "What's the difference between WebGPU and the simplified renderer?" },
      {
        p: [
          "WebGPU is Beatform's real renderer — every mode, Builder, custom shaders, post-processing and scene transitions all run there, and exports require it. When WebGPU isn't available (an old WebView2 runtime, or a GPU on the driver blocklist), Beatform falls back to a Canvas2D renderer that draws exactly one thing: an approximation of Spectrum Bars, no matter which mode is selected. The other modes' own looks, Builder, custom shaders, Motion masters, post-processing, scene transitions and cover art have no Canvas2D equivalent, so the fallback disables those controls and explains why instead of quietly ignoring them.",
        ],
      },
      { h4: "Where do my projects, looks and themes actually live?" },
      {
        p: [
          "A project (",
          { code: ".bfproj" },
          ") saves wherever you choose in the native save dialog — Beatform just remembers the folder as a convenience default. A look (",
          { code: ".bfpreset" },
          ") lives in the app's own local storage the moment you save it; exporting one to a file is a separate, explicit step, same as a theme. The one file Beatform writes on its own is the project document — a single copy in the app's local data folder that mirrors your current work automatically and loads back in every time you reopen the app.",
        ],
      },
      { h4: "What do I need for automatic lyrics, and is there a length limit?" },
      {
        p: [
          "Generating lyrics needs the desktop app: Whisper (via whisper.cpp) transcribes the mix, an Ultimate Vocal Remover model isolates the vocal, and a wav2vec2 aligner times each word against it — all locally, and the models download once with their size shown up front. Tracks over 90 minutes are declined before any processing starts, to avoid running the machine out of memory partway through.",
        ],
      },
      {
        h4: "I turned on system-audio visualization and there's no BPM or beat-synced pulse — is that a bug?",
      },
      {
        p: [
          "No. Live system audio never gets a beat grid — Beatform can't analyze a track it hasn't heard yet — so grid-driven effects (the ones that land exactly on a metronome beat) automatically fall back to reacting to onsets instead, and the BPM badge stays hidden rather than guess. It's preview-only in the other direction too: a live session has no export counterpart, so there's nothing to render a video from once you stop performing.",
        ],
      },
      { h4: "Does MIDI mapping need special drivers?" },
      {
        p: [
          "No — Beatform talks to controllers directly through the browser's Web MIDI API, the same on desktop as in the browser build. There's nothing to install: open the Live page, click ",
          { em: "Learn CC" },
          " or ",
          { em: "Learn note" },
          ", move the control or hit the pad, and the binding is saved from then on.",
        ],
      },
      { h4: "What Shadertoy shaders can I import?" },
      {
        p: [
          "Single-pass shaders using the Image tab — paste the source and Beatform translates it to WGSL locally, keeping the author and license with the visual. Multipass buffers, cubemap/video/keyboard channels, static textures on iChannel1–3, and channels chosen at runtime instead of written literally aren't supported yet. An unsupported shader gets a diagnostic naming the reason rather than a silent failure.",
        ],
      },
      { h4: "How does the Gallery keep a download from being something malicious?" },
      {
        p: [
          "A look or theme carries no code — it can only select and parameterize visuals Beatform already ships, so applying one is exactly as safe as clicking around the UI. Every file is pinned to an immutable commit, fetched only from that one allowed address, and its SHA-256 is checked before Beatform ever parses it — see ",
          { em: "Gallery" },
          " above for the full model.",
        ],
      },
      { h4: "Does Beatform collect data, track me, or need an account?" },
      {
        p: [
          "No. There's no account, no telemetry, and no cloud rendering — everything runs on your machine, and the app is free and open source (MIT), distributed only through GitHub Releases. The one network request Beatform makes on its own is the update check, a plain fetch of a static file; the Gallery only talks to the network once you open it.",
        ],
      },
    ],
  },
];

export const GUIDE_FIXTURE: readonly GuideSection[] = [
  {
    id: "start",
    title: "Getting Started",
    blocks: [
      {
        h4: "Basic Controls",
      },
      {
        p: ["Press ", { kbd: "Space" }, " to start playback."],
      },
      {
        p: [
          "This guide uses ",
          { em: "emphasis" },
          " for optional features and ",
          { strong: "strong" },
          " for important ones.",
        ],
      },
      {
        p: ["Use the ", { code: "code" }, " element in your documentation."],
      },
      {
        p: [
          "For more info, see the ",
          { link: { text: "link text", href: "https://example.invalid" } },
          ".",
        ],
      },
      {
        ul: [["First list item"], ["Second list item"], ["Third list item"]],
      },
    ],
  },
  {
    id: "second",
    title: "Advanced Usage",
    blocks: [
      {
        h4: "Numbered Steps",
      },
      {
        ol: [["Start the application"], ["Configure your settings"], ["Export your project"]],
      },
      {
        derived: "mod-sources",
      },
    ],
  },
];
