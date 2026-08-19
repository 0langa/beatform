<!-- GENERATED from src/ui/guideContent.ts — edit that, then `npm run build:guide`. -->

# User guide

<a id="start"></a>

## Getting started

Beatform turns music into visuals — live on your screen, and rendered to video files that look exactly like the preview. Everything runs locally on your machine: no account, no uploads, no telemetry.

### Your first minute

1. **Load music.** Drop an audio file anywhere on the window (MP3, FLAC, WAV, OGG or M4A), click _Browse files_, or try one of the built-in demo tracks. Beatform analyzes the track for tempo, key and loudness in the background.
2. **Press Space.** The visual reacts to the music immediately.
3. **Try the modes.** The strip at the top holds every visual mode — click one, or walk through them with <kbd>N</kbd> and <kbd>P</kbd>.
4. **Open Visuals** with <kbd>G</kbd> (or the sliders icon, top right) to shape the look of the current mode. The rail down its left side holds eight pages: Mode, Global motion, Looks & themes, Sync, Modulation, Scene, Text and Live.

Visuals is a dock, not an overlay: the picture keeps the whole window and the dock floats over it, so you can watch a slider land while you drag it. Drag its left edge to resize (or focus that edge and use the arrow keys — Shift for bigger steps, Home/End for the extremes); the width and the page you were last on are both remembered. Pages themselves never fold away — it's the control groups within a page, like Mode's Shape and Color, that fold, and each one remembers whether you left it open.

When something looks wrong or you get lost, _Project ▸ New project_ resets the whole document to clean defaults — one <kbd>Ctrl+Z</kbd> undoes even that.

### Loop a section while you tune

Press <kbd>I</kbd> at the start of a drop and <kbd>O</kbd> at the end, or use the **A**/**B** buttons beside the player. The selected region appears on the seek bar; drag either marker to adjust it, then press <kbd>L</kbd> to loop it. Click **×** beside A/B to clear the markers without turning the loop off — <kbd>L</kbd> then covers the whole track again. A-B markers are session-only and reset when another track loads.

One bit of vocabulary that comes up throughout the rest of this guide: a **Style** is a chip a visual ships with, a **Look** is a control set you save for one mode, a **Theme** is a whole document in one file, and the **Gallery** is where other people's looks and themes live.

<a id="modes"></a>

## Visual modes

Twenty modes live on the strip — from classic spectrum bars to 120k-particle flow fields, a full 3D bar city, a scrolling spectrogram that draws the whole song as it plays, a lyric stage that puts the words themselves front and centre, a gatefold that stages the track's own cover art, and a living reaction-diffusion culture the music farms. Every mode except Builder, which stacks its own layers instead, has:

- **Styles** — six to fourteen curated one-click looks, in a row of chips at the top of the Mode page. The header above the page names the style you are on; the chip row reads _Custom_ once you move a control away from it.
- **Grouped controls** — Shape, Color, Motion, Reaction, Glow, Image, Camera, Backdrop, and _More_ for anything that fits none of them. Every group a visual uses is on the page, and each one leads with the handful of controls that change the look.
- **An expert line per group** — a row reading _3 expert controls_ folds that group's internal constants away until you click it, and reads _n changed_ once you move one of them. _Show every control_, below the groups, opens all of them at once and then reads _Hide expert controls_.

Hover any control to see a plain-language hint in the Visuals footer. The search box at the top of Visuals finds any control by name, across every page of the dock — expert controls included, whether their line is open or not.

### Cover art and center images

The **Gatefold** mode makes the artwork the whole show: the track's cover framed on a lit stage — the room glows in the art's own colors, the floor mirrors it back, and a spectrum skirt runs along the bottom. A track with no artwork gets a generated abstract sleeve instead, so the stage is never empty. Bass Circle and Radial Burst display artwork in their center: by default the track's embedded cover art, or any image you choose (look for _Center image_ in the Image group on the Mode page — Gatefold takes one too). All three carry a _Match cover colors_ toggle, which reads the dominant color of that artwork and sets Hue and Hue spread to fit — automatically again for every new track. Two more modes use cover art their own way: Tunnel can paper the tunnel wall with it (the **Cover wall** control), and Echo Trails can use it as the shape it echoes (**Source shape**).

### Your own shaders

The _+_ chip at the end of the strip opens the shader editor, where you can write a WGSL fragment of your own — it becomes a first-class mode, saved into your projects and shareable as a `.bfshader` file. Its _Shadertoy…_ button takes the Image tab of a single-pass Shadertoy shader and translates it to WGSL on the spot, keeping the author and license with the visual. Both need hardware rendering: on the simplified Canvas2D fallback the _+_ chip is switched off.

### Global motion

Visuals ▸ Global motion holds three masters that scale a mode's own motion up or down: **Rotation** (spin) and **Pulse** (beat pumping) each run 0–200%, and **Detail** (how many bars, points or segments it draws) runs 0–100% — dial a look calmer or wilder from one place. A slider only appears when the current mode can actually move that way, and exports match whatever you set.

There's a fourth master too: spectrum smoothing is a motion setting, but its slider lives on Sync beside the other spectrum controls rather than here — the page's name says which of the two kinds of motion control this is, since a visual's own motion controls sit in the Motion group on Mode instead. On a visual that has nothing to rotate or pulse, the Global motion destination itself is dimmed and says so.

<a id="builder"></a>

## Builder

Builder is a layer compositor: stack up to twelve layers from nine types — background wash, particles, spectrum bars, radial ring, pulse rings, waveform circle, orb core, wave line and vignette. Use the same type as often as you like.

Builder has no style chips. Instead it ships six whole-stack starting points — Classic, Neon club, Sunset drive, Deep space, Cathedral and Phosphor — at the top of its panel. Pick one, then take it apart. Builder renders through WGSL codegen, so it needs hardware rendering and is switched off on the simplified Canvas2D fallback.

Every layer has:

- its own on/off toggle and opacity,
- a **blend mode** (Normal, Add, Screen),
- color (hue + spread) and its own controls,
- reorder arrows and a duplicate button.

Stacks are saved inside your project like any other setting. _Export .bfbuilder_ writes a stack as a single small file anyone can import — a good way to share looks.

<a id="sync"></a>

## Sync & reactivity

The Sync page routes **one source** to the current mode: **Kicks** (default), Energy, Bass, Melody, Voice, Treble, Snare or Hats. Pick what should drive the motion — a vocal-heavy track often looks better on Voice than on Kicks — and the choice is saved per mode, so one mode can sit on Voice while the rest stay on Kicks.

### Response feel

**Smoothing** sets the overall response: 0 is punchy, 1 glides. For asymmetric feel, set **Attack** (how fast the reaction rises) and **Release** (how slowly it falls) separately.

### Shaping the drawn spectrum

In modes that draw the spectrum, a cluster of controls governs how much detail it shows and how the bars themselves look.

**Resolution** controls only the spectrum that's drawn: its three buttons are labeled with the actual window they produce at your device's sample rate — roughly 85 ms, 170 ms and 340 ms — rather than with adjectives, each one doubling the last, up to the 32768-point ceiling Web Audio itself imposes. A longer window resolves closer low tones but carries more audio history, so each button also states the visual latency that costs.

**Axis** chooses Musical — a log axis, equal width per octave — or Linear, equal hertz per horizontal step. **Sampling** chooses 96 bands, which resamples the transform to keep the usual 96-bar layout, or FFT bins, which reads the transform's own integer bins directly: linear only, and fewer than 96 bars wherever the selected range physically contains fewer.

Three more controls shape the bars themselves:

- **Merge** — bars prop up their neighbors, melting lone spikes into one connected silhouette (the "Monstercat" look).
- **Rounding** — averages neighboring bars: real smoothing that removes hard spikes rather than just curving between them.
- **Contrast** — below 50% flattens toward fuller, calmer bars; above 50% exaggerates peaks. 50% is neutral.

**Low edge** and **High edge** set the frequency span the bars cover: raise the low edge (10–500 Hz) to stop spending bars on sub-bass a track doesn't have, or lower the high edge — it runs from 22 kHz all the way down to 200 Hz — to give a narrow musical range more of the width.

A live readout below the controls spells out exactly what you're looking at: the real window and visual latency at your device's sample rate, hertz per bin, how many native bins fall in range, and how many bars or bands are actually drawn — so nothing here implies more detail than the transform contains. None of it touches what the visual reacts to, though: kicks, beats, band energies and sync timing all stay on the fast, fixed-resolution detector, and everything here is saved per mode and applies identically in exports.

### Beat reaction

Two kinds of beat reaction work together: **onset pulses** fire on an actual hit in the selected band, and **beat-grid pulses** ride the track's detected tempo grid instead, landing on every metronome beat (the BPM is shown in the Visuals footer).

Synthwave's grid scrolls exactly one line per beat, Tunnel launches a light ring that arrives just as the next one lands, and Bass Circle pumps on the grid. A track with no detectable grid falls back to onset pulses automatically.

### Modulation

Sync gives the whole visual one feeling. Modulation aims a specific signal at a specific knob — kick pumps the zoom, hats flicker the glow.

The page is target-first: start from _+ Modulate a control…_ and pick the knob you want moved, and you get a card for it. Every knob of the current visual is offered, plus the whole post-processing chain — exposure, bloom, bloom threshold, vignette, chromatic and film grain — so the kick can drive Chromatic and the bass can breathe the Bloom. Each route on a card picks what drives it and a **Depth**: the share of that knob's own range added at full signal, negative to pull the other way. Open the card's chevron for the response _shape_ — Linear, Exp or Smooth — plus **Rise** and **Fall**, so a route punches or eases. Six one-click **recipes** (Kick punch, Bass swell, Beat sway, Bar sweep, Drop brightness, Hat sparkle) give you a working route to edit instead of a blank page.

Sources cover the drums and bands, the track-wide signals, the lyric line when one is loaded, and any imported stem's bands:

- **Drive**
- **Drive pulse**
- **Kick**
- **Snare**
- **Hats**
- **Bass**
- **Mids**
- **Treble**
- **Voice**
- **Vocals (lyrics)**
- **Section change**
- **Loudness**
- **Energy**
- **Stereo width**
- **Beat phase**
- **Bar phase**

Eighteen tempo-synced **LFOs** — sine, saw or square across ¼ beat to 8 beats — for movement that does not wait on the music.

A **Driven by** row above the cards shows one live meter per source actually in use; click one to see only the controls it moves. And wherever the knob itself lives — on Mode, or in the Post section on Scene — the slider picks up a _driven_ mark while it plays, and its group header counts how many of its controls are driven. The slider still shows your base value; modulation moves around it.

Import a stem (a drums/bass/vocals bounce starting at 0:00) with _+ Add stem…_ — up to four. It is analyzed once and never played, and its bands become extra sources; the ✦ button on a stem chip auto-wires its kick/bass/snare/hats/mids to the best-matching knobs of the current mode.

<a id="scene"></a>

## Backgrounds & scene

### Backgrounds

The Scene page picks what sits behind the visualization:

- **Animated** — the mode's own moving background.
- **Solid** — a flat color, including chroma green/magenta for keying.
- **Transparent** — see-through (checkerboard in the preview); pair with the alpha export formats.
- **Image** — your own picture or the track's album art, with blur and dim.
- **Video** (desktop) — a short local clip looped behind the visual, deterministic so exports match the preview.

Image and video both get the same framing row: a fit of _Fill_, _Fit_ or _Stretch_, plus Zoom and X/Y pan when you want a particular part of the picture in shot.

Backgrounds can be scoped with the switch at the top of the Background section: **All modes** or **This mode**. A per-mode background wins over the shared one, so Spectrum Bars can sit on your video loop while Bass Circle keeps its animated backdrop.

### Post effects

The Post section holds a _Filmic tonemap_ toggle and six sliders — Exposure, Bloom, Bloom threshold, Vignette, Chromatic and Film grain (deterministic, so it renders the same every time). All of it is in the Scene page and all of it renders identically in exports. Bloom plus a dark background is the fastest way to make any mode look "produced". These six sliders are also modulation targets, so the post chain can move with the track.

### Aspect

The frame aspect (Fill, 16:9, 9:16, 1:1) is a project setting — visuals compose into the frame, so vertical exports for Shorts/Reels look designed, not cropped.

<a id="overlays"></a>

## Text, lyrics & audiogram

### Text and images

The Scene page's Layers section adds text and image overlays. Text supports `{title}` and `{artist}` placeholders filled from the track's tags; images can be your logo or the embedded album art. Layers anchor to nine positions and scale fractionally — they render identically in exports.

### Lyrics

Drop an `.lrc` or `.srt` file onto the window — the current line follows the music karaoke-style, live and in every export. Position, size, color, fade timing and an _Animation_ (Plain, Slide up, Pop, or Karaoke — the line fills bright left to right as it is sung) live on the Text page. Drop the lyrics alongside the track or after it — they attach to the loaded track just like an imported stem does. And when the words deserve the whole frame, the **Lyric Stage** visual mode puts them centre stage: big audio-reactive type with the same word-by-word fill, the sung word carrying the light — no caption needed.

### Generate lyrics (desktop)

No .lrc at hand? The Text page can generate timed lyrics from the loaded track, entirely on your PC. The mix is transcribed by OpenAI's Whisper running on whisper.cpp; in parallel, an Ultimate Vocal Remover (UVR) MDX-Net model isolates the vocal, and each word is then timed against that isolated vocal by a wav2vec2 forced aligner — so the karaoke fill follows the singer word by word. (Enhanced .lrc files with word tags from other tools get the same per-word fill when imported.) The AI models download once (size and a time estimate are shown first, and each one is checksum-verified) and nothing ever leaves your machine. Sung words are hard even for good models — expect to fix a few lines, and thanks to the UVR and whisper.cpp projects for making local isolation and transcription possible.

### Edit lyrics

Once a track has lyrics — imported or generated — the Text page's **Edit lyrics** section turns every line into something you can fix by hand: click a line to select it, click its time to jump the track there, or double-click the time to type an exact one.

A selected line's toolbar can nudge it earlier or later, split it at the text cursor, merge it into the next line, insert an empty line above or below, delete it (<kbd>Ctrl+Z</kbd> brings it straight back), or re-align it — re-running the word aligner against the isolated vocal for that line's text (desktop only, once the lyrics models are downloaded and a track is loaded). Lines the aligner wasn't confident about are flagged red or amber, and a **⚑ next** button jumps to the next one.

Opening a line's word view breaks the karaoke timing down word by word: edit a word's text, nudge its start time, or reset the whole line with **⇤⇥ even** to space every word out evenly when the alignment came out scrambled. Editing here has its own undo/redo (<kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd>), separate from the rest of the app, and **Save .lrc** writes the corrected lyrics back out, word timing included.

### Audiogram

The audiogram adds podcast/reel-style track-driven elements, each its own toggle: a _Progress bar_, a _Time readout_ (elapsed / total) and a _Waveform strip_ with a moving playhead. Once any of them is on, you also get an accent color and a Position of Top or Bottom.

<a id="timeline"></a>

## Timeline

Press <kbd>T</kbd>. Scenes switch visual modes at chosen beats (drags snap to the detected grid), and automation lanes keyframe any control over time. Each scene picks a transition for its incoming edge: Crossfade, Wipe →, Wipe ↑, Iris, Zoom, Glitch or Hard cut.

- Click a keyframe dot to cycle its curve: linear → smooth → hold.
- Right-click a keyframe to remove it — or select it and press <kbd>Del</kbd>. The arrow keys nudge a selected keyframe.
- **✦ Auto-arrange** builds a scene arrangement from the song's detected sections in one click.

**Good to know:** while the timeline is enabled, scenes override the mode strip and keyframes override the controls — that's the point, but it can look like the Visuals dock has stopped responding if you forget it's on. Turn the timeline off (or use _Project ▸ New project_) to get direct control back.

<a id="library"></a>

## Library & live input

Both of these live in the installed desktop app.

### Music library

Press <kbd>Q</kbd> and point Beatform at your music folder once — every track appears with its real tags. Click to play; with _Auto-play next_ on, finished tracks flow into the next one near-gaplessly (the next file is decoded while the current one plays).

### Visualize the whole system

The broadcast icon in the top bar visualizes whatever Windows is playing — Spotify, a browser, a DAW — through native loopback capture. It's analysis-only: nothing is echoed back out, and pressing play on a file stops the capture.

<a id="live"></a>

## Live performance

- **Switch hands-free.** Number keys <kbd>1</kbd>–<kbd>9</kbd> jump to a mode. With _Live ▸ Quantize_ set to Beat or Bar, the switch waits and lands exactly on the grid — the queued chip pulses until it takes over.
- **Stage mode** (<kbd>S</kbd>) hides every piece of chrome and the cursor for a clean full-bleed output — project it, capture it, or screen-share it. The mode name flashes briefly on each switch so you can drive blind.
- **Second display** (the Perform drawer, <kbd>D</kbd>): open a dedicated output window on a projector or TV while every control stays on your screen — mode pads, quantize, blackout, the monitor picker and fullscreen all live in the drawer. A feedback mode (Spectro Falls, Overgrowth) opened on the output mid-song builds its trail history from that moment on, like starting a capture. During a batch render the output window pauses on its last frame until the batch finishes.
- **Blackout** (<kbd>0</kbd> in Stage mode or with the performance window open) cuts to black — the classic VJ cut. <kbd>Esc</kbd> exits everything.
- **MIDI** (the Live page): map a controller's knobs to any parameter and pads to modes. _Learn CC_, then move a knob, binds it to the selected parameter. The _Learn note →_ button always names whichever mode you currently have open — switch to that mode first, click it, then play a pad to bind that note to switching there (note switches obey the beat-quantize too). Bindings are remembered.

Everything here is preview-only — a live session never changes what an export renders.

<a id="export"></a>

## Export & batch

Exports render every frame off-screen from deterministic track time. Preview and export share project, DSP, and shader code; live device timing and cross-GPU pixels are measured, not claimed identical — the exact scope and tolerances are in the [preview/export truth contract](https://0langa.github.io/beatform/PREVIEW-EXPORT-CONTRACT). Formats:

The dialog asks for a **Type** first — a normal _Video_ render, or a _Canvas loop_ — and then a **Format**:

- **MP4** — H.264 everywhere; HEVC and AV1 appear as codec choices where your GPU encodes them. Auto or manual bitrate (2–60 Mbps), and optional loudness normalization to −14/−16/−23 LUFS with a −1 dBTP ceiling (audio only — pixels unchanged).
- **WebM VP9 + alpha** — not a separate format but the _VP9 + alpha_ codec under MP4, which writes a transparent `.webm` for OBS overlays and web embeds (set Background to Transparent).
- **PNG frames** (desktop) — numbered stills with alpha for compositing.
- **ProRes** (desktop) — a 4444 .mov with alpha and untouched PCM audio, straight into Premiere, Resolve or After Effects.
- **AV1 10-bit** (desktop) — a genuine 10-bit MP4 tapped before the 8-bit swapchain, so wide gradients keep their levels instead of banding.
- **GIF / animated WebP** (desktop) — loop files; WebP keeps alpha.

Resolutions follow the project's frame aspect — 720p through 4K on 16:9, 1080×1920 and 2160×3840 on 9:16, 1080×1080 on square — at 30 or 60 fps. **Canvas loop** is the Type, not a format: a 3–8 s seamless 1080×1920 loop at 30 fps whose tail crossfades into its head, made for Spotify Canvas — which only accepts MP4, so choosing it turns off PNG, ProRes and AV1 (GIF and WebP stay available, since a seamless loop is what they're for too).

### Batch

Press <kbd>B</kbd>, drop a folder of tracks, and Beatform renders one video per track, titled from each file's own tags (anything untagged falls back to the filename and is flagged). A failed file costs that one video, never the whole night — and if you cancel a run, the jobs it never reached stay queued so you can resume or retry them. That queue lives in the session: closing the app clears it.

<a id="projects"></a>

## Projects & sharing

- **Projects** (<kbd>Ctrl+S</kbd> / <kbd>Ctrl+O</kbd>) — a single `.bfproj` file holds everything: mode, controls, sync, backgrounds, overlays, timeline, Builder stacks, lyrics style, audiogram, even embedded images. Opening it on another machine restores the exact setup.
- **Themes** — _Visuals ▸ Looks & themes_ exports the whole current look as a `.bftheme` anyone can drop onto their Beatform window ([file format reference](https://0langa.github.io/beatform/templates)).
- **Builder stacks** — `.bfbuilder` files share a single Builder creation.
- **Your looks** — _Save look_ (in the page header, or on _Looks & themes_) stores the current control values for one mode, locally, and exports as a `.bfpreset`. The visual's factory style chips stay on Mode, beside the header that names the active one.

### Never lose work

On desktop, Beatform saves your project automatically in the background (how quickly is yours to set in Preferences), and closing the window — or a crash — always flushes the very latest edit first, so nothing from the moment before is lost. Reopen the app and your work is simply there; after a crash or force-kill, a quick note lets you know it was recovered.

<a id="gallery"></a>

## Gallery

The _Gallery_ button in the top bar opens a curated, public collection of looks and themes you can use without leaving the app — including Beatform's own factory theme pack, marked _Built-in_ and available even with no connection at all. Filter it by _All_, _Looks_ or _Themes_, or search it by name.

- **+ Add look** puts that entry into your own saved looks for the mode it belongs to, and applies it straight away.
- **Apply theme** (a built-in entry's button just says **Apply**) replaces your whole setup with that entry — mode, controls, background, layers, post, the lot. As with any theme, <kbd>Ctrl+Z</kbd> undoes it.

_Looks & themes_ in the Visuals dock has its own two shortcuts into the Gallery, pre-filtered to whichever of the two you were looking at.

### Why it is safe to click

Entries carry no code — a look or a theme can only select and parameterize visuals Beatform already ships, so applying one is exactly as safe as clicking around the UI. Every file is pinned to an immutable commit, downloaded only from the one allowed location, and checksum-verified before Beatform will even parse it. An entry that needs a newer Beatform than you have says _Needs app update_ rather than half-loading.

The collection lives on GitHub as `beatform-app/gallery` and submissions are reviewed there — the dialog links you to it.

### Submitting

Have a look or theme worth sharing? `node scripts/gallery-submit.mjs <file>` validates it with the app's own checks, computes the hash and size the registry needs, and prints a ready pull-request body — one command instead of several manual steps. It only prepares that text; nothing is uploaded or opened on your behalf.

<a id="preferences"></a>

## Preferences, updates & shortcuts

The gear icon in the top bar (or <kbd>Ctrl+,</kbd>) collects the choices that follow the app rather than the project — nothing here is saved into a `.bfproj`. Four tabs:

- **General** · **Modes** · **Performance** · **Updates**

### Updates

Beatform updates itself from GitHub Releases: shortly after launch it checks a static file (no telemetry, ever) and offers new versions in a dialog — install now, restart once, done. Every download is verified against Beatform's signing key before it installs. The automatic check can be turned off in Preferences ▸ Updates.

### Shortcuts

Press <kbd>H</kbd> for the full list — that overlay is also where the button to this guide lives.

### Playback

- <kbd>Space</kbd> — Play or pause
- <kbd>←</kbd> — Seek back 5 seconds
- <kbd>→</kbd> — Seek forward 5 seconds
- <kbd>↑</kbd> — Raise the volume
- <kbd>↓</kbd> — Lower the volume
- <kbd>M</kbd> — Mute or unmute
- <kbd>L</kbd> — Loop the whole track, or the A-B region when one is set
- <kbd>I</kbd> — Set the loop start (in point)
- <kbd>O</kbd> — Set the loop end (out point)

### Performance

- <kbd>N</kbd> / <kbd>P</kbd> — Step to the next or previous visual mode
- <kbd>[</kbd> / <kbd>]</kbd> — Step to the next or previous visual mode (physical key — layout-independent)
- <kbd>1–9</kbd> — Jump straight to the mode at that strip position (jumps are beat-quantized when quantize is on)
- <kbd>S</kbd> — Toggle Stage mode (chrome-free output)
- <kbd>\</kbd> — Toggle Stage mode (physical key — layout-independent)
- <kbd>0</kbd> — Cut to black (in Stage mode or with the performance window open)
- <kbd>.</kbd> — Cut to black (legacy alias for 0)
- <kbd>D</kbd> — Toggle the Perform drawer (mode pads, blackout, second display)

### Panels & dialogs

- <kbd>G</kbd> — Toggle the Visuals panel
- <kbd>Q</kbd> — Toggle the Library
- <kbd>T</kbd> — Toggle the Timeline
- <kbd>B</kbd> — Toggle the batch export queue
- <kbd>H</kbd> / <kbd>?</kbd> — Toggle this shortcuts sheet (H is layout-independent; ? kept for muscle memory)
- <kbd>Ctrl/Cmd+,</kbd> — Toggle Preferences
- <kbd>F</kbd> — Toggle fullscreen

### Editing

- <kbd>Ctrl/Cmd+S</kbd> — Save the project
- <kbd>Ctrl/Cmd+O</kbd> — Open a project
- <kbd>Ctrl/Cmd+Z</kbd> — Undo the last change
- <kbd>Ctrl/Cmd+Shift+Z</kbd> — Redo the last undone change (same key as Undo, plus Shift)
- <kbd>Ctrl/Cmd+Y</kbd> — Redo the last undone change

Every performance shortcut has a letter or digit as its main binding, so it sits on the same labeled key on every keyboard layout — QWERTZ and AZERTY included. The punctuation keys some of them also answer to (<kbd>[</kbd>, <kbd>]</kbd>, <kbd>\</kbd>, <kbd>.</kbd>) are kept for US-layout muscle memory and are bound by physical position, not by the character printed on them. And <kbd>Esc</kbd>, wherever you are, closes whatever's open.

<a id="faq"></a>

## FAQ

### Which formats can I export?

MP4 (H.264 everywhere, HEVC/AV1 where your GPU supports them) and WebM with a real alpha channel render through the app's built-in WebCodecs pipeline. PNG frame sequences, ProRes 4444, genuine 10-bit AV1, and GIF/animated WebP go through the bundled ffmpeg encoder instead — that's how the deep-color formats keep more than 8 bits per channel all the way to disk.

### Why does an export sometimes take longer than the song itself?

Export renders and encodes every frame for real, so its speed depends on your resolution, frame rate, codec and GPU — not on the length of the track. Hardware-encoded MP4 at common resolutions usually finishes faster than realtime. ProRes, 10-bit AV1, GIF and WebP stream frames into the bundled ffmpeg encoder and can run well under realtime, especially at 4K or when your GPU falls back to software encoding — Beatform doesn't promise a particular speed for any format.

### What's the difference between WebGPU and the simplified renderer?

WebGPU is Beatform's real renderer — every mode, Builder, custom shaders, post-processing and scene transitions all run there, and exports require it. When WebGPU isn't available (an old WebView2 runtime, or a GPU on the driver blocklist), Beatform falls back to a Canvas2D renderer that draws exactly one thing: an approximation of Spectrum Bars, no matter which mode is selected. The other modes' own looks, Builder, custom shaders, Motion masters, post-processing, scene transitions and cover art have no Canvas2D equivalent, so the fallback disables those controls and explains why instead of quietly ignoring them.

### Where do my projects, looks and themes actually live?

A project (`.bfproj`) saves wherever you choose in the native save dialog — Beatform just remembers the folder as a convenience default. A look (`.bfpreset`) lives in the app's own local storage the moment you save it; exporting one to a file is a separate, explicit step, same as a theme. The one file Beatform writes on its own is the project document — a single copy in the app's local data folder that mirrors your current work automatically and loads back in every time you reopen the app.

### What do I need for automatic lyrics, and is there a length limit?

Generating lyrics needs the desktop app: Whisper (via whisper.cpp) transcribes the mix, an Ultimate Vocal Remover model isolates the vocal, and a wav2vec2 aligner times each word against it — all locally, and the models download once with their size shown up front. Tracks over 90 minutes are declined before any processing starts, to avoid running the machine out of memory partway through.

### I turned on system-audio visualization and there's no BPM or beat-synced pulse — is that a bug?

No. Live system audio never gets a beat grid — Beatform can't analyze a track it hasn't heard yet — so grid-driven effects (the ones that land exactly on a metronome beat) automatically fall back to reacting to onsets instead, and the BPM badge stays hidden rather than guess. It's preview-only in the other direction too: a live session has no export counterpart, so there's nothing to render a video from once you stop performing.

### Does MIDI mapping need special drivers?

No — Beatform talks to controllers directly through the Web MIDI API. There's nothing to install: open the Live page, click _Learn CC_ or _Learn note_, move the control or hit the pad, and the binding is saved from then on.

### What Shadertoy shaders can I import?

Single-pass shaders using the Image tab — paste the source and Beatform translates it to WGSL locally, keeping the author and license with the visual. Multipass buffers, cubemap/video/keyboard channels, static textures on iChannel1–3, and channels chosen at runtime instead of written literally aren't supported yet. An unsupported shader gets a diagnostic naming the reason rather than a silent failure.

### How does the Gallery keep a download from being something malicious?

A look or theme carries no code — it can only select and parameterize visuals Beatform already ships, so applying one is exactly as safe as clicking around the UI. Every file is pinned to an immutable commit, fetched only from that one allowed address, and its SHA-256 is checked before Beatform ever parses it — see _Gallery_ above for the full model.

### Does Beatform collect data, track me, or need an account?

No. There's no account, no telemetry, and no cloud rendering — everything runs on your machine, and the app is free and open source (MIT), distributed only through GitHub Releases. The one network request Beatform makes on its own is the update check, a plain fetch of a static file; the Gallery only talks to the network once you open it.
