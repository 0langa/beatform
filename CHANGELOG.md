# Changelog

All notable changes to Beatform are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning is
pragmatic rather than strict semver: a feature release bumps MINOR, a
fix-only release bumps PATCH. Entries below are derived from the project's
own commit history (`git log` + tags), oldest tag first reversed to newest.

Beatform is free and open source (MIT), distributed only through GitHub
Releases — there is no paid tier, cloud service, or telemetry.

## [Unreleased]

## [2.108.0] - 2026-08-21

### Changed

- **The analyzer's hottest instruction got 1.8× faster — with pixels
  proven identical.** The FFT magnitude loop dropped an overflow-guarded
  library call it never needed; the change is bit-identical on real audio
  (verified bin-for-bin, and the full 332-case pixel gate passed with
  zero hash deltas). High-refresh displays and every export simply spend
  less CPU.
- **The frame-rate cap now saves the work, not just the frames.** Capping
  the preview to 30 fps used to keep analyzing audio at full display
  refresh — the battery knob barely helped. Analysis now skips the
  frames the cap skips (the fixed 60 Hz detector beat is untouched, so
  nothing about the picture changes).
- **Autosaves write leaner.** The crash-safety autosave no longer
  pretty-prints megabytes nobody reads — projects with embedded media
  autosave with noticeably less main-thread work. Your manually saved
  .bfproj files keep their readable formatting.
- **The app starts lighter.** Half a megabyte of video-codec code left
  the startup path and now loads only when a decode or export first
  needs it (a test pins it out of the boot graph for good).

### Fixed

- **Tempo-locked motion no longer runs on a dead track's clock.** After
  loading a new track — or switching to live system audio — beat-locked
  movement kept cycling at the PREVIOUS track's BPM until analysis
  landed (for live input: for the whole session). Everything now falls
  back honestly until the real tempo is known, and the near-gapless
  library auto-advance resets the analysis state like every other load.
- **Toggling the A-B loop from outside the region no longer flashes a
  phantom beat** — and can no longer fire a queued quantized switch off
  the jump.
- **The loudness readout survives pauses.** Pausing used to drain the
  meter with silence so it read several LU low for a moment after
  resume; it now freezes with the music and resumes accurately.
- **Listening to the system holds up under stalls.** If the app's render
  thread stalls for seconds while music keeps playing, the capture ring
  no longer wraps over unread audio (analysis resumes clean instead of
  scrambled), and the capture statistics no longer count the idle time
  before the first audio ever arrived.

## [2.107.0] - 2026-08-21

### Fixed

- **The performance window lets go of dead captions.** Turning lyrics or
  the audiogram off mid-show left the last caption line (or the progress
  strip) burned into the audience output until something unrelated redrew
  it. The output window now heals the moment the dynamics stop.
- **A queued visual switch dies with the moment it was meant for.** With
  beat/bar quantize on, a pending switch used to survive track changes,
  project opens, undo — even the track ending — then fire at the first
  boundary of content it was never aimed at. It now clears on every one
  of those, and seeking forward no longer counts as crossing a musical
  boundary.
- **Stepping modes under quantize goes somewhere.** Pressing next (] or
  N) twice used to silently cancel the queued switch; it now queues two
  modes ahead, Ableton-style. Tapping the same mode chip still un-queues
  it.
- **Escape in Stage mode exits Stage — and nothing else.** It used to
  also close the Visuals dock, Library and Timeline and remember them
  closed across restarts. Your workspace now survives the demo.
- **Deleting a custom shader asks first — and undo really brings it
  back.** The delete chip removed WGSL permanently with no confirmation
  while Ctrl+Z pretended otherwise. Both fixed; a queued switch to the
  deleted visual is un-queued too.
- **A/B-comparing looks keeps every step undoable.** Two look, theme or
  style applications in quick succession used to collapse into one undo
  entry; each is now its own step.
- **MIDI Learn disarms when its surface goes away** — closing the Perform
  drawer or the Visuals dock, leaving the Live page, entering Stage, or
  pressing Escape all cancel a pending Learn instead of leaving it armed
  to swallow the next knob you touch. Enabling then quickly disabling
  MIDI can no longer end up secretly enabled.
- **Dropping a look or Builder stack file on the window imports it** —
  `.bfpreset` and `.bfbuilder` drops used to fall through to the audio
  decoder and fail with "could not decode".
- Smaller live-surface fixes: lyrics re-align locks structural edits (and
  their undo) while the aligner runs, so word timings cannot attach to
  the wrong repeated line; the batch "resume" estimate no longer counts
  the hours the queue sat cancelled; editing lyrics keeps uncommitted
  text on the same line when rows are inserted or deleted above it; the
  shader editor asks before replacing an unsaved draft; cover art on the
  second display updates reliably for same-size images; model downloads
  can't be double-started.

## [2.106.0] - 2026-08-21

### Fixed

- **Batch renders now react to song sections and draw the audiogram —
  exactly like single exports.** The batch lane computed section
  boundaries and then threw them away, and never passed the audiogram: a
  modulation routed on "section pulse" read zero for the whole night, and
  audiogram elements simply weren't drawn. Batch output of a document now
  matches a single export of the same document, feature for feature.
- **"Retry failed" can no longer start twice.** A double-click on the
  retry button could race two batch runs into the same output files. The
  second activation now waits its turn — one click, one run.
- **Exports use the GPU you chose.** With Preferences ▸ Performance ▸ GPU
  set (dual-GPU laptops), the export worker could still land on the other
  adapter and render subtly different pixels than the preview. The choice
  now travels with every export job — batch included.
- **A corrupted audio file can no longer poison the meters for the whole
  session.** One non-finite sample in a damaged float WAV made the stereo
  width and loudness readouts stick at NaN until restart — spreading
  through any modulation routed on stereo width. Every layer now guards
  and heals: the next clean audio brings correct readings back.

### Changed

- **The GPU pixel gate is strict now.** Any raw pixel-hash change fails
  the release gate (previously only coarse perceptual tolerances did),
  and the matrix grew 18 cases covering what it never exercised: the
  export-shaped feedback walk for all six history-carrying modes, all
  seven scene transitions mid-fade, non-default backgrounds, deep-color
  capture, and the legacy Builder visual old projects still reference.

## [2.105.0] - 2026-08-21

### Fixed

- **ProRes 4444 colors are now correct in your editor.** The ProRes
  exporter converted colors with an outdated standard (BT.601) and left
  the file untagged, so Resolve, Premiere and After Effects showed every
  ProRes export with a subtle green shift and clipped saturated colors.
  ProRes now uses the same BT.709 conversion and tagging as the 10-bit
  AV1 lane — what you graded is what you exported. (A new release gate
  measures the actual decoded colors of both lanes so this cannot
  regress.)
- **Cancelling an export can no longer cost you the previous file.**
  Exports write to a hidden `.partial` file and only replace the real
  file once they finish. Cancel one, or have one fail, and whatever was
  at that name before is untouched. If the finished render cannot
  replace a file that another program holds open, the render is kept as
  `.partial` next to it and the message tells you exactly where it is.
- **Closing the app mid-export now asks first.** If an export or batch
  is running, closing the window asks before quitting, cancels cleanly,
  and removes the unfinished file instead of leaving something that
  looks like a real video.
- **Cancel works during the last encoding step too.** GIF and the other
  sidecar formats do heavy work while "finishing" — pressing Cancel
  there now actually stops them instead of letting the encode run to
  the end.
- **PNG sequences never mix runs.** Each export gets its own fresh
  `…_frames` folder (`-2`, `-3`, … when the name is taken), so a
  shorter re-export can no longer leave stale frames from a longer one
  interleaved in the same folder.
- **Huge animated exports are refused before they can fail.** The GIF
  frame cap is now a resolution-aware pixel budget and covers animated
  WebP too — a 4K GIF that would have exhausted memory late in the
  encode is refused up front with a message that says what to reduce.
- **Batch renders check disk space up front** — the same warn-and-
  continue check single exports already had, run over the whole queue
  (and again before "Retry failed", which is exactly when the disk may
  be the reason).
- **Spotify Canvas loops ship as plain progressive MP4** — the most
  compatible container layout for picky upload validators. A track
  shorter than 3 seconds now gets a clear message instead of a loop
  Spotify would reject.
- **When the encoder dies mid-export, the error now includes the
  encoder's own last words** instead of only a generic pipe message, so
  the real reason (disk full, bad file, …) is visible immediately.

## [2.104.2] - 2026-08-19

### Fixed

- **Pausing freezes the picture — all of it, honestly.** Modes with
  memory (Spectro Falls' record, Overgrowth's culture, Echo Trails and
  the other trail effects) kept running on the wall clock while
  playback was paused: the waterfall drained itself empty within
  seconds, cultures kept churning, trails faded out. Paused now means
  held — the record keeps every slice, the culture holds its shape,
  trails stay put — and everything continues exactly where it left off
  on resume. This also matches what an export of the same moment
  renders. (Reaching the natural end of a track now holds the picture
  the same way instead of quietly draining it.)

## [2.104.1] - 2026-08-19

### Fixed

- **Crossfading into Spectro Falls or Overgrowth no longer scrambles
  their memory.** Switching scenes with a crossfade fed the incoming
  mode's history a washed-out copy of the blended picture — Spectro
  Falls' record read as a solid loud wall for the fade, and Overgrowth's
  culture collapsed and had to regrow. During a fade both modes now
  build their history from the real frames underneath, exactly as
  exports always did — what you see growing during the transition is
  what stays.

## [2.104.0] - 2026-08-19

### Added

- **A true second-display performance window.** Send clean, fullscreen
  visuals to a projector or second monitor while the full app stays on
  your screen as the operator console. One engine drives both — the
  output window mirrors the exact frames the preview renders, beat for
  beat, with nothing else on it: no controls, no cursor, no HUD unless
  you want one. Pick the monitor, Esc steps it down (fullscreen →
  windowed → closed), and closing it never touches your session.
- **The Perform drawer.** Press **D** (or the top-bar button) for a
  performance console in one place: mode pads 1–9 with thumbnails and
  beat-quantized switching, blackout, the second-display controls,
  output HUD toggle, sync source, and your MIDI mappings shown live —
  with note-learn straight from the drawer. Works inside Stage mode
  too, so a blacked-out operator screen always keeps its controls.

## [2.103.0] - 2026-08-17

### Added

- **Overgrowth — a new visual mode: the music grows a living thing.** A
  real reaction-diffusion simulation — the chemistry behind coral,
  lichen and fingerprints — runs live on your GPU, and the music feeds
  it: bass sets how fast the culture spreads, kicks plant new seeds on
  the beat, energy develops the color. Five forms (Coral, Mitosis,
  Labyrinth, Polyps, Ripples) and six looks — Overgrowth, Reef, Lichen,
  Sumi ink, Mitosis and Veins. It never sits still: quiet passages keep
  the culture alive and growing, and every export replays the whole
  growth from the first frame, so what renders is exactly what grew.

## [2.102.0] - 2026-08-17

### Added

- **Gatefold — a new visual mode: the artwork is the show.** Your track's
  cover art takes the whole stage — framed in a gallery with a bass-lit
  reflection, blown up soft behind a sharp copy, or full bleed — and the
  room is lit by the artwork itself: the mode reads the sleeve's own
  colors and washes the scene with them, no settings needed. The
  spectrum skirts the frame, kicks zoom the camera, energy grains the
  print. Six looks ship with it: Gatefold, Museum, Poster, Neon Sleeve,
  Echo Room and Zine. A track with no artwork gets a generated sleeve —
  a duotone sun-disc design that breathes with the music — so the mode
  never sits empty.
- **Waveform terrain in Spectrum Scape.** The 3D mode's layout picker
  gains a fourth option: the track's actual waveform as a mountain
  range the camera rides over — peaks where the music peaks. Comes with
  its own look, Waveride, and a terrain-smoothing control.

## [2.101.0] - 2026-08-17

### Added

- **Lyric Stage — a new visual mode: the words take the stage.** A
  typography-first visual built for the lyrics engine: the current line
  stands as the centerpiece, filling word by word exactly as they're
  sung — karaoke timing from the same word-level alignment your lyrics
  already carry — while the previous and next lines wait in the wings.
  The type itself plays the music: beats punch the weight, the bass
  washes the floor, glow and chromatic edges ride the energy. Anchor it
  center, lower-third or teleprompter-top; six looks ship with it —
  Lyric Stage, Neon Marquee, Teleprompter, Stadium, Velvet and Ink.
  No lyrics on the track? The stage rehearses: a type-specimen sweep
  keeps the mode alive on any song, so it never sits blank.

## [2.100.0] - 2026-08-16

### Changed

- **ProRes 4444 exports now carry true deep color.** The transparent-video
  lane reads the renderer's 16-bit tap directly instead of squeezing
  through 8-bit images first — measured on device: over 2400 distinct
  brightness levels where 8-bit caps at 256, stored at ProRes 4444's full
  native 12-bit precision. Transparency comes through mathematically
  correct against any background, and the same project exports the same
  file byte-for-byte, every time.

### Fixed

- **A round of interior hardening on the modulation math.** Fuzz testing
  the modulation matrix, frame resolution, and store actions surfaced
  seven paths where a malformed value could slip into route math or
  parameter state — all now rejected at the door, none reachable through
  normal UI use.

## [2.99.0] - 2026-08-16

### Added

- **Spectro Falls — a new visual mode: the song draws itself.** A scrolling
  spectrogram where every moment of the spectrum prints as one thin slice
  and then flows away from the live edge — kick drums as bars along the
  bottom, hats as bright dust along the top, a held pad as a stack of
  steady rails. Quiet sits deep and cold, peaks blow out to white, and the
  live edge burns as the read head. Scroll it **down, up, left or right**,
  fold the frequency axis into a mirrored pair (bass down the middle, or
  air), and turn on the frequency grid or the **beat marks**, which print
  the detected beat grid straight into the record and scroll it with the
  music. Six looks ship with it: Spectro Falls, Sonar, Tape Scroll, Prism
  Rain, Ember Drift and Score.
  Every colour control is retroactive — turn the contrast or the palette
  and the whole visible history re-develops, not just the moments recorded
  after you touched the knob.
- **Pick the lyrics language.** Automatic lyrics gain a language dropdown
  — auto-detect stays the default, with the full set of commonly
  supported languages available when you know better than the detector.

### Changed

- **Lyrics time estimates learn from your machine.** Finished generation
  runs record how fast your hardware actually was, and later estimates
  blend that in — the numbers get more honest every run.
- **Stage changes show immediately.** The lyrics progress no longer sits
  at a stale "100%" while the next stage warms up — it says which stage
  is starting the moment the previous one finishes.

### Fixed

- **Toasts can no longer pile off the top of the window.** The
  notification stack caps its height and scrolls, so every message stays
  reachable no matter how many arrive at once.
- **One approved Gallery value was unreachable by its slider.** The sync
  sliders' grid is finer now, so the Blacklight theme's tuned attack sits
  exactly where its author put it.

## [2.98.0] - 2026-08-16

### Fixed

- **Re-saving a custom shader is undoable now.** Editing an active custom
  shader and hitting Compile + update used to bake the change into
  history, so Ctrl+Z reverted nothing. One save is one undo step, and
  undo genuinely restores the previous shader code.
- **A slow Gallery install can no longer overwrite a theme you applied
  after it.** If you clicked a built-in theme while a remote install was
  still downloading, the install could finish later and silently replace
  your choice. The later action wins now; the download still completes
  and the entry stays installed.

### Changed

- **The factory theme pack moved into the Gallery.** All 13 built-in themes
  are Gallery entries now, marked _Built-in_ — no download, and they show
  up even with no connection at all. The Visuals panel's row of theme chips
  is gone; _Looks & themes_ now points straight at the Gallery for a
  complete look, so there's one place to browse instead of two.

## [2.97.1] - 2026-08-15

### Fixed

- **A slow project load can no longer be overwritten by a stale start.**
  In 2.97.0, if your project file took unusually long to load (very large
  embedded media, a slow or cloud-synced disk) and you started editing or
  closed the window before it finished, the app could save an older
  version of your project over the newer one — silently. Saving now waits
  for the load to finish, and if the app ever does decline a late-arriving
  newer version, that version is set aside as its own file and a notice
  tells you exactly where it is. Nothing is ever silently discarded.

## [2.97.0] - 2026-08-15

### Fixed

- **Sliders no longer quietly rewrite tuned values.** Some factory themes
  and Gallery presets carry values finer than their slider's old step
  size, so the first nudge snapped them to a different number with no way
  back. Every affected slider's grid is now fine enough to hold the
  values the content actually ships with — nothing renders differently;
  the sliders just stopped lying.

### Changed

- **Your work now lives in one crash-safe file.** The desktop app keeps
  your current project in a single, atomically-written document file and
  boots straight from it — no more split state between two storage
  systems, and no more "storage is full" surprises from the browser-style
  cache the desktop never needed. Closing the app always saves first
  (with a safety cap so a stuck disk can never trap the window), edits
  are flushed on a steady heartbeat while you work, and if the file is
  ever damaged it's set aside and reported instead of silently replaced.
  After a crash, the app simply restores your work and tells you so with
  a notice that stays until you dismiss it. A brief boot veil covers the
  half-second the file takes to load. Existing projects carry over
  automatically on first launch.

## [2.96.0] - 2026-08-14

### Added

- **The timeline grew into its engine.** Scenes are cards now — each with a
  live thumbnail of its mode and its own look picker — lanes live in a
  proper list with add, remove and solo-visibility, and keyframes go where
  you click, with drag-scrubbing to set values and a chip that tells you
  when beat-snap is active. The "Enabled" toggle is gone: a timeline with
  content plays, an empty one is off. Every gesture is a single undo step.
- **The guide answers questions now.** A new FAQ section — export formats
  and what needs the desktop app, why export speed varies, where your
  files live, the lyrics limits, and more — generated from the same single
  source as the rest of the guide, in-app and on the site.
- **Submitting to the Gallery is one command.** `gallery-submit` validates
  your theme or look with the app's own parsers, computes the hash and
  size the Gallery verifies on install, and writes a ready PR body.

### Changed

- **The export fps readout tells the truth.** It used to average over the
  whole run, so a slow start dragged the number down forever. It now
  tracks the last few seconds — what the export is doing right now.

### Fixed

- **Five paper cuts found by an adversarial UI audit.** Pressing Escape
  while resizing a side panel no longer closes the panel (and your width
  sticks). A typo in a lyric's time field can no longer make that line
  vanish from playback and exports. Removing lyrics while a generation is
  finishing in the background can no longer delete the fresh result.
  Discarding the shader editor mid-compile no longer applies the shader
  anyway. And closing the export dialog during the save-location step no
  longer orphans a running export invisibly.

## [2.95.0] - 2026-08-14

### Added

- **"Show in folder" after an export.** When an export finishes on the
  desktop app, the completion message now carries a button that opens
  Windows Explorer with your new file selected — no more digging through
  folders to find what you just rendered. Works for video exports and PNG
  sequences alike.
- **Mute a modulation route without deleting it.** Every route on the
  Modulation page has a pause switch now. A muted route keeps all its
  settings and stops moving its knob until you resume it — perfect for
  A/B-ing what a route contributes.
- **Reorder stacked routes.** When two or more routes drive the same
  control, their order decides how they add up. Stacked routes now show a
  drag grip and up/down buttons, and a completed drag is a single undo
  step.
- **Bulk actions on the Modulation page.** Filter by a source and clear
  every route it drives in one confirmed click, or set the depth of all
  routes on one control with a single slider. Each bulk action is one undo
  step.

### Changed

- **Route meters are exact now.** For routes with rise/fall smoothing, the
  little meter used to show the raw source value — leading the visual
  motion it drives. It now shows the same smoothed value the renderer
  actually uses, so what you see on the card is what the visual does.
- **The BPM badge only appears when there's a real beat.** A silent or
  beatless track used to show a meaningless tempo (always around 200 BPM).
  The footer badge now stays hidden unless the track has a usable pulse —
  beat detection itself is unchanged.
- **Automatic lyrics politely decline very long tracks.** Tracks over 90
  minutes used to risk running the machine out of memory mid-generation.
  Beatform now says so up front — before any processing starts — instead
  of failing minutes in.

## [2.94.0] - 2026-08-13

### Fixed

- **A slow export is no longer killed as "stopped responding" while it's
  working — mid-render or at 99%.** Two real cases: software AV1 encoding
  can legitimately go more than half a minute without output at the start
  of a 1080p60 export, and any long export goes quiet at the very end while
  the encoder flushes and the file is finalized. The safety watchdog
  misread both silences as a dead export and stopped it — on long jobs
  sometimes in the last percent, after twenty minutes of work. The export
  now signals it's alive the whole way through, finalization included, so
  the watchdog only fires when something has genuinely crashed. Nothing
  about the encoded video changes.

### Changed

- **The user guide is one guide now.** The in-app guide and the website
  guide used to be maintained separately and had drifted apart in 23
  places; they are now generated from one source, so they always say the
  same thing. The merged guide gains the pieces each copy was missing —
  the full spectrum-analysis explainer and export limits on one side, the
  custom-shader editor on the other — and the keyboard-shortcut sheet,
  modulation-source list and Preferences overview are now generated
  straight from the app's own definitions, so they can never go stale.

## [2.93.0] - 2026-08-12

### Added

- **Narrow docks get full-width sliders.** When the Visuals dock is squeezed
  below ~466px, control rows now stack — the label and value on one line,
  the slider full-width underneath — so a track that had shrunk to a sliver
  becomes seven times wider and dropdowns stop truncating their longest
  options. Above that width nothing changes.

- **The Visuals header now carries the two actions you reach for most.** A
  page-aware **Reset** sits beside the mode's name — on Mode it restores
  factory controls, on Global motion and Scene it appears only once something
  drifted (labeled "Reset post" on Scene, since that's all it touches), and
  it stays out of the way on pages with nothing to reset. **Save look** is
  now always one click away: it opens Looks & themes with the save form
  ready, and going there this way doesn't change which page the panel opens
  on next time. On very narrow docks the actions wrap onto their own row so
  they stay clickable.

- **Saved look files now record which app version wrote them.** A `.bfpreset`
  saved from now on carries an `appVersion` note inside the file. It changes
  nothing about how looks load — older files and newer files both open
  exactly as before — but if a future update ever changes what a setting
  means, the app will be able to tell old files from new ones and adjust
  them correctly instead of guessing.

### Fixed

- **Two overlapping track loads can no longer end up with one track's audio
  under the other track's beat grid.** If a large file was still being read
  when a smaller track was loaded after it — a drop followed by a quick
  library or demo pick — the slow read could finish last and put the first
  track's audio back while the beat grid, key, sections and metadata stayed
  the second track's, permanently and with no error. Loads now commit
  strictly in the order they were requested, on every path.

## [2.92.1] - 2026-08-12

### Fixed

- **The Canvas2D fallback now calls Builder by its current name.** The message
  shown when Builder cannot run without WebGPU still used the retired
  "Builder Studio" name.
- **Release validation no longer mistakes a slow first launch for a broken
  install.** A brand-new WebView2 profile can expose the correctly titled app
  while its document is still loading. The installed-app smoke now waits for
  that real load boundary before checking the shell.
- **The performance-family diagnostic no longer races its first CPU and RAM
  sample.** Loaded machines could still show honest placeholders after the
  old fixed delay; the check now waits boundedly for populated readings and
  always turns the overlay back off.

### Changed

- **The retired global Advanced preference is now migration-only.** Direct
  upgrades from older builds still carry that choice into the per-group expert
  controls, then stop storing the obsolete field.
- **The npm dependency audit is clean again.** The reviewed minor/patch update
  removes the high-severity `nanoid` advisory that left main's CI red after
  2.92.0, with no new runtime service or dependency.

## [2.92.0] - 2026-08-11

### Fixed

- **An export started right after a track change no longer uses the previous
  song's beat grid.** The last release made exports wait for analysis, but
  there was still a gap: when a new track loaded, the new audio started playing
  while the beat grid, key, sections and waveform from the _previous_ song were
  still in place — so an export fired in that moment rendered one song's
  visuals over another song's audio, with nothing on screen to suggest anything
  was wrong. Everything derived from the audio is now cleared the instant the
  new track starts, which also means an export started there simply waits for
  the real analysis. This mattered most during automatic library advance, which
  reaches that moment with no click at all.
- **An export can no longer be finished against a track you have since
  replaced.** If you changed tracks while an export was still setting up, it
  could encode the audio it started with but describe it using the new track's
  grid, sections, cover and title. Exports now confirm the audio is still the
  audio they began with, and stop with a clear message if it is not. The same
  check was added to the internal path the project's own test harnesses use, so
  they cannot quietly measure the wrong thing either.
- **The audiogram no longer jumps on every track change.** With the waveform
  strip enabled, the progress bar and time readout shifted upward for a moment
  at the start of each new track and then dropped back. The strip now keeps its
  place while its waveform is being computed, so nothing below it moves.

## [2.91.0] - 2026-08-11

### Fixed

- **Exports no longer start before the track has been analysed.** Hitting
  Export in the moment right after loading a file could render the entire video
  with no beat grid at all — no BPM, no beat or bar phase, no section pulses,
  and the tempo-synced LFOs falling back to a fixed clock — while the preview a
  second later showed the beat-synced version. The export now waits for the
  same analysis the preview is using, so the two always agree. On desktop that
  wait happens behind the save dialog and costs nothing, and Cancel works
  throughout. Batch render already did this correctly and is unchanged.
- **A very long track could leave the app thinking it was still analysing.**
  Loading one large enough to exhaust memory during analysis left the
  "analysing" flag stuck on for the rest of the session. Harmless on its own,
  but it would have blocked every later export once exports started waiting on
  it.

## [2.90.0] - 2026-08-10

### Fixed

- **Loop and segment exports now match the preview exactly.** Exporting a slice
  of a track rebased the clip to zero, and both the tempo-synced LFOs and every
  time-driven shader kept reading that rebased clock — so a Canvas loop starting
  two minutes in rendered a different moment of the animation, and a different
  LFO phase, than the preview had just shown you. Both resolve from real track
  time now. **Loop and segment exports will therefore look different from
  before this release** — they look like the preview did, which is what they
  were always meant to do. Full-track exports are unchanged, to the pixel.
- **Themes saved before the Kaleido Nebula saturation change import correctly
  again.** A `.bftheme` written by 2.74.0 or earlier — including one installed
  from the Gallery — carries the old meaning of Nebula's Saturation, so
  importing it into a recent build rendered it noticeably flatter than its
  author intended. Those files are remapped on import now, across the mode's
  parameters, its timeline scene overrides and its modulation amounts alike.
  Themes saved by 2.75.0 or later are untouched.
  This corrects the theme file, not history. A project you saved out of a
  wrongly-rendered import is **not** retro-corrected — its values were already
  written under the new meaning, and nothing can tell them apart from values
  you tuned on purpose. So the same theme can render one way from the
  `.bftheme` and another from a `.bfproj` saved out of it. If a project looks
  flatter than the theme it came from, raise Nebula's Saturation by about a
  third and re-save.
  Saved looks and the last-session cache are deliberately left alone for the
  same reason: neither records which version wrote it, so "fixing" them would
  over-brighten every look you had already corrected by hand. This release
  starts recording that version, so the next such change can migrate cleanly.
- **The LFO modulation sources are tempo-synced, not beat-locked.** They follow
  the track's tempo rather than its detected beat positions. The app and the
  docs both said otherwise.

## [2.89.0] - 2026-08-10

### Added

- **The mode strip takes the keyboard now.** Tab reaches it once, then the
  arrow keys walk the modes and switch as they go, with Home and End for the
  ends and a visible focus ring throughout — the same model the Visuals rail
  already used.
- **Hovering the seek bar tells you where you would land**, and the A–B loop
  markers have a proper hit target instead of a 16-pixel one.
- **The four status chips in the panel footer explain themselves.** Hover any
  of them: what the graphics backend means, that tempo and key are detected
  once from the file and are not available for live system audio, and that the
  loudness figure is the momentary one — measured ahead of the volume control,
  held while paused, and not the number export normalisation targets.
- **Changing the volume with the chrome hidden now shows a brief readout**, so
  you can tell the key press landed.
- **The empty state offers the Gallery** as a fourth way in, which is the
  shortest route to something worth looking at if you have no file to hand.

### Changed

- **The mode strip shows pictures almost immediately on a fresh start.** It
  used to render every mode's thumbnail before showing any of them, and in an
  order unrelated to the one on screen — so the first minutes of a new install
  were the least impressive minutes the app ever showed. The modes you can
  actually see are rendered first now, and they appear as soon as they are
  ready rather than waiting for the whole set.

## [2.88.0] - 2026-08-10

### Fixed

- **A MIDI pad bound to Particles before v2.68 switched to the wrong visual.**
  The mode's internal name changed in that release, and the MIDI bindings were
  the one place that kept the old one verbatim — so the pad quietly brought up
  Spectrum Bars instead. Old bindings are read through the rename now, and
  nothing needs re-learning.
- **Dragging an automation keyframe past its neighbour made the preview lie.**
  While the drag was in progress the preview read the lane in the order the
  keyframes happened to be stored rather than in time order, so everything
  after the moved point flattened out until you let go. It follows the drag
  correctly now.
- **Splitting a lyric line could make half of it disappear.** On subtitle files
  whose cues overlap — common with fade-in/fade-out timing — the second half
  landed after the following line, so it vanished from the preview and the
  export while still sitting in the correction editor.

## [2.87.0] - 2026-08-09

### Added

- **The "driven" dot now covers timeline automation, not just modulation.** A
  control moved by an automation lane gets the same mark and the same group
  count as one moved by a modulation route, so a knob you cannot find the
  reason for is no longer invisible just because the reason lives on the
  timeline. Hovering it says which kinds of thing can be moving it.

### Changed

- **The export dialog now shows every format and codec, with a reason when one
  is unavailable.** It used to hide them, which made the choices look
  unpredictable — the four ffmpeg formats simply did not appear in a browser,
  and the Codec row vanished entirely on a machine that supports only one
  codec, which is exactly the machine whose owner wonders where transparent
  WebM went. Everything is listed now, and anything you cannot pick says why:
  "Needs the desktop app", "Canvas loops always encode H.264", or that this
  machine's encoder does not support it. Unavailable choices stay keyboard
  reachable, so the reason is readable by a screen reader too.
- **PNG frames no longer offered in the browser.** It was selectable and then
  failed after you had already chosen a folder.
- **The rest of the app got the same weight off it as the Visuals panel.** The
  timeline, the player bar, the mode strip, the library and the batch panel no
  longer redraw because something unrelated to them changed — the timeline in
  particular used to redraw its whole ruler four times a second just to move
  the playhead, and the window around it used to redraw once per encoded frame
  during an export. Nothing looks or behaves differently.

## [2.86.0] - 2026-08-09

### Fixed

- **Closing the app during lyrics generation left the transcriber running.**
  Whisper is a separate program Beatform starts, and closing the window only
  ever stopped its parent — so the transcription kept going with no window
  attached to it, holding four cores for however long it had left. It is now
  tied to the app's lifetime, including when the app crashes rather than
  closes.
- **Lyrics generation left the whole decoded track behind in your temp
  folder.** Roughly 42 MB for a four-minute song, and around 635 MB for an
  hour-long set, every time generation was interrupted or refused — on the
  system drive, which is the one Beatform warns you about running out of.
  Those files are cleaned up now, including the ones left by a rejected start.
- **Cancel did nothing if you pressed it just as Transcribe began.** There was
  a small window where the cancel arrived before the transcriber had finished
  starting, and it was then ignored for the rest of the stage — so cancelling
  appeared to hang for minutes. It stops promptly now, wherever it lands.
- **The beat flash rang about twice as long in a 30 fps export as in the
  preview.** The beat's fade was advancing once per exported frame instead of
  once per analysis step, and the gap widened as the beat faded. Exports at
  30 fps — which includes every Canvas-loop export, since those are always
  30 fps — now match what you saw. Exports at 60 fps are unchanged, to the
  pixel.

### Changed

- **The Visuals panel got noticeably lighter to use.** Dragging a slider used
  to redraw the entire panel on every pixel of movement, and so did moving the
  pointer across it — now a drag touches only the control you are dragging.
  Nothing looks different; it just stops doing work it never needed to do.

## [2.85.0] - 2026-08-09

### Fixed

- **Importing a Shadertoy shader could crash the app.** A shader with a
  non-breaking space in front of a helper function — which is exactly what
  copying code out of a rendered web page produces — hit a crash in the
  translator instead of an error message. Found by a new fuzzer, not by a
  report; if you ever had an import take the app down with it, this was why.
- **Shaders with an overloaded or duplicated channel helper now import.** If
  the same helper function appeared twice — two overloads of it, or a shader
  pasted in twice — the translator quietly mangled the source before handing
  it to the compiler: a semicolon and a closing brace deleted, two statements
  run together. The import then failed with a compiler error pointing at the
  wrong line, for a shader that was fine.
- **Shader import errors point at the right line again.** If a helper call or
  a function signature wrapped across two lines — which is just how a long
  argument list gets written — every error below it was reported one line too
  high, and further off the more wraps there were.

### Changed

- **The in-app guide and the docs now describe the app you are running.** A
  read-everything-against-the-code pass found 25 claims that had drifted:
  Preferences was missing an entire tab, the export-format list was wrong
  three ways (10-bit AV1 was missing outright), Sync was described as global
  when it is per mode, and there was no Gallery section at all even though
  Gallery is a button in the top bar. The guide is 13 sections now.

## [2.84.0] - 2026-08-09

### Fixed

- **The angle dials had no draggable track at the narrowest dock width.** On
  Radial Burst, Particles, Kaleido Nebula, Metaballs, Spectrum Scape and Bass
  Circle, an angle control squeezed into a dock at its minimum width left
  nothing to drag — the slider was zero pixels wide, with only the dial itself
  still working. Those rows now stack the slider under its label when the dock
  is narrow, so there is always a full-width track. On a wide dock they stay on
  one line as before.
- **The overlay-layer editor overflowed the panel on Scene.** With a text or
  image layer open at a narrow dock, its Size, Opacity and Glow sliders were
  unusable and the colour swatch was squeezed to a few pixels. The editor is a
  single column now at every width — which also gives those three sliders more
  than twice the track on a wide dock than they had before.

### Changed

- **Sliders grow with the dock.** Widening the Visuals dock now puts the extra
  room into the slider tracks rather than leaving it as empty space, and past
  roughly 470px the control labels get more room too — so names like _Graticule
  beat flash_ and _Match cover colors_ stop wrapping onto two lines.

## [2.83.0] - 2026-08-08

### Changed

- **Modulation is a page you can read now.** It used to be a list of rows —
  one line per route, a source and a target and a number — which told you
  what you had wired but never what it was doing. It is rebuilt around the
  thing you actually think in: **one card per control**. The card is named
  after the knob, and everything moving that knob lives inside it, so two
  routes stacked on one control finally look like one stack instead of two
  unrelated lines.
  - **Live meters.** A **Driven by** row across the top shows every source
    your project is using — kick, bass, vocals, an LFO — each with a meter
    that moves with the track. Click one to show only the controls it
    drives, click again for all of them.
  - **You can see the range a route sweeps.** Each route paints the span it
    covers on the knob's own scale, reading _0.20 → 0.68_, with a marker
    riding it in time with the music. When the knob's own limit stops the
    swing short, the card says so rather than quietly clipping.
  - **Response shape has its own place.** Curve, rise and fall are behind a
    small triangle on each card, closed by default and identical at every
    dock width. A route with a shape set prints it on the closed card —
    _Exp · fall 0.35 s_ — so nothing is ever hidden where you cannot find it.
  - **Rise and fall go to 10 seconds** instead of 2. The longer times were
    always accepted in saved projects; the sliders just could not reach
    them. They are labelled Rise and Fall now, not _A_ and _R_.
- **Every control something else is driving is marked where you edit it.**
  Modulation never writes your document — the slider sits exactly where you
  left it while the render does something else — and until now the only
  place that fact appeared was the Modulation page. A driven control now
  carries a tinted edge and a coloured label on the Mode page and on Scene's
  finishing controls, and each group's count reads **3/9** so you can see it
  without opening the group. The slider is still the resting value, and
  hovering the mark says so.
- **Adding a route starts from the control.** The old **+ Route** button
  guessed a target and could land on nothing at all; now you pick the knob
  from a grouped list of everything this visual can modulate, with anything
  already routed greyed out. Clicking a recipe chip five times can no longer
  stack five compounding routes on one knob.
- **A route to a stem you have not loaded yet says so.** Stems are analysed
  per session while the routes to them are saved with the project, so
  reopening a stem project used to show a blank source on those routes. It
  now names the stem and marks it as not loaded, and the route comes back to
  life the moment you re-import.
- **Nothing about your projects changed.** All of the above is presentation:
  the same document, the same routes, the same frames. A project saved in
  2.82.0 opens unchanged and exports identically.

## [2.82.0] - 2026-08-08

### Changed

- **Every group of controls now hides its own expert tier, instead of one
  switch hiding all of them.** The **Essentials / All** toggle is gone. Each
  group on the Mode page — Shape, Color, Motion, Glow, Reaction, Backdrop —
  shows the controls that shape the look, with the internal constants behind
  its own line reading _"7 expert controls"_. Open only the group you are
  working in. **Show every control**, under the group list, still opens the
  lot in one click, and if you used to sit on "All" you keep everything open
  after the update.
  - Each group's line carries its own **n changed** count, so you can see at a
    glance which expert tier you have been editing. The whole-visual count
    moved next to Reset.
  - Searching still reaches every control, expert ones included, and hides the
    disclosures while you search — there is nothing left to reveal when every
    match is already on screen.
- **Every group a visual declares now has something in it.** On thirteen of
  the fifteen modes **Backdrop** used to be a bare heading, and a group whose
  controls were all expert vanished from the page entirely. Each group now
  leads with the one control most likely to change how it looks — Vignette on
  most, the graticule on Oscilloscope, wall brightness in Tunnel, panel
  variance on LED Matrix, horizon fog on Synthwave.
- **Your saved looks moved to Looks & themes**, the rail destination formerly
  called Themes — saving, importing, deleting and the Gallery shortcut all
  live there now. A visual's own **style chips stay on Mode**, next to the
  header that names the active one.
- **The rail's Motion destination is now Global motion**, because a visual's
  own motion controls are on its Mode page. Picking it on a visual that has no
  masters says so, instead of just dimming.

## [2.81.0] - 2026-08-08

### Changed

- **The panel on the right is a dock now, and it stays put while you work.**
  It is a permanent right-hand column rather than something you open, use and
  close again, and the visual runs full width behind it — you can watch a
  slider land while you are still dragging it.
  - Drag the dock's left edge to resize it (380–760 px, remembered per
    install). The edge takes the keyboard too — focus it and the arrow keys
    move it, Shift for bigger steps, Home/End for the extremes.
  - The mode strip, toasts and the timeline keep clear of it instead of
    sliding underneath.
  - **Stage mode** (**S**) is still the chrome-free full-bleed output and
    still hides the dock completely. The difference: leaving Stage now gives
    it back exactly as you left it, instead of quietly closing it and
    costing you your workspace every time you demo something.
- **One way to get around: a section rail instead of tabs.** The five tabs
  (Visual / Sync / Scene / Text / Live) and the sections that folded up
  individually inside them were two navigation models stacked on each other,
  and neither of them told you where anything lived. Both are gone, replaced by
  a single list of eight destinations down the side of the dock —
  **Mode**, **Motion**, **Themes**, **Sync**, **Modulation**, **Scene**,
  **Text**, **Live**. Each one is a page: click it and it is on screen. No
  control was removed, renamed or moved to a different concept; the same
  sections simply sit behind fewer clicks.
  - **Modulation is a destination of its own.** It used to be a section
    below the whole of Sync, on the Sync tab — which is where most people
    never found it. Routing audio, stems and beat-locked LFOs onto
    individual controls is one of the best things the app does, so it now
    has its own name on the rail, with a badge counting your active routes.
    This is the single change the whole redesign was for.
  - **Scene** and **Live** carry badges too — overlay layers, and MIDI
    bindings.
  - A destination the current visual cannot use — **Motion** on a mode with
    no rotation, pulse or detail — is dimmed rather than hidden, and says
    why when you hover it.
  - The rail is **one** Tab stop, not eight: arrow keys walk it and switch
    page as they go, Home/End jump to the ends.
  - The page you were last on is remembered. Upgrading puts you on the page
    matching the tab you last used.
- **A header that always says what you are editing** — the current mode's
  name, and the name of its style when one is exactly applied. It stays put
  while the page scrolls.
- The **search box** now spans the full width of the dock, above both the
  rail and the page, and behaves as before: it finds a control by name
  across everything, and results ignore the rail entirely.
- **The music library got its own resize grip.** It was only resizable while
  the panel on the right happened to be open, because the two shared one
  handle and one width. They are separate now.
- **The panel is called "Visuals".** 2.80.0 renamed it from "the settings
  panel" to **Inspector**; this release renames it once more, because
  "Inspector" names a kind of window rather than what the button opens.
  This is where you shape how the whole thing looks, so it is **Visuals** —
  on the top-bar button, the heading, the shortcut list under **H**, and the
  user guide. The shortcut is still **G**. The **Ctrl+,** dialog is still
  **Preferences** and is untouched. If you read 2.80.0's notes: yes, that is
  two renames in two releases, and this is the name it keeps.

### Removed

- **Sections no longer fold up one by one.** The rail does that job now, and
  keeping both meant two ways to hide the same controls. The **parameter
  groups** on the Mode page (Shape, Color, Motion, Glow, Reaction…) still
  fold and still remember it — only the section-level folds are gone, and
  the app forgets the old ones on first launch.
- Worth knowing if you move between versions: running a build older than
  2.81.0 once clears the remembered page and dock width, and the old section
  folds do not come back either. Projects, looks, themes and everything in
  Preferences are unaffected.

## [2.80.0] - 2026-08-08

### Changed

- **The panel on the right is now the Inspector. The Ctrl+, dialog is now
  Preferences.** Nothing moved, nothing was removed and nothing behaves
  differently — only the names. Two completely different surfaces had been
  sharing the word "settings", which made every tooltip, hint and help page
  ambiguous about which one it meant:
  - **Inspector** — press **G**, or the sliders button in the top bar.
    Everything about the visual you are building: modes, styles, looks and
    themes, motion, sync, modulation, background, post, layers, lyrics,
    audiogram, and the live/MIDI controls. Almost all of it belongs to your
    project and travels in the `.bfproj` file (beat-quantize and MIDI
    bindings stay per-install, as they always have). Earlier release notes
    call this the "Visual settings panel", or just "the settings panel" —
    for example the Gallery that moved out of it into its own dialog in
    2.72.0 still leaves its shortcut in the Inspector's **Themes** section.
  - **Preferences** — press **Ctrl+,**, or the gear. The choices that follow
    the app rather than the project: autosave delay, the remembered save
    folder, the mode-strip order, the performance overlay, preview
    resolution, GPU preference and updates. Earlier notes call this "App
    settings" — so "App settings → Modes" from 2.57.0 is now
    **Preferences ▸ Modes**, and "App Settings → Performance" from 2.68.0
    is now **Preferences ▸ Performance**.
- One knob or toggle is now a **control** (or a **parameter** where MIDI is
  concerned), never "a setting". The Inspector's search box reads _Search
  controls…_, and searching for something that isn't there says "No controls
  match".
- The in-app user guide, the online guide, the README and the bug-report
  form all use the new names, including the shortcut list under **H**.

### Fixed

- **The Inspector no longer redraws itself on every meter tick.** With a
  track playing it was rebuilding the entire panel four times a second — the
  rate the playhead and the loudness readout update at — and once per
  rendered frame during an export. It now watches only the values it
  actually displays, so dragging a slider, typing in the search box or
  opening a section stays responsive while music plays or a render runs. The
  footer badges (LUFS, BPM, key, renderer) still update exactly as before.
  This is internal plumbing: every control, every value and every exported
  pixel is unchanged.

## [2.79.0] - 2026-08-07

### Added

- **Modulation grew a sense of timing.** Routes are no longer a straight
  line from sound to knob:
  - **Shape** — pick how a route responds. _Linear_ is what you have today,
    _Exponential_ keeps quiet passages calm and lets peaks hit hard, and
    _Smooth_ eases in and out of both ends.
  - **Attack and release** — give a route rise and fall time in seconds, so
    a kick can punch instantly and let go over a quarter second instead of
    snapping. Frame rate never changes the feel, and exports reproduce it
    exactly.
- **Beat-synced LFOs.** New modulation sources that sweep on their own,
  locked to the track's tempo: sine, ramp and square, at a quarter beat up
  to eight beats per cycle. They are pure math over the beat grid, so
  scrubbing anywhere in the track shows exactly what the export will render.
- **Route recipes.** Six one-click starting points in the Modulation
  section — Kick punch, Bass swell, Beat sway, Bar sweep, Drop brightness
  and Hat sparkle. Each drops in a shaped, timed route aimed at a parameter
  the current visual actually has.
- **Two new things to react to.**
  - **Vocals** follows your loaded lyrics, rising as a line is sung and
    falling in the gaps — musical phrasing rather than a loudness meter. It
    works whether or not you are drawing the lyrics on screen.
  - **Section change** fires a pulse each time the track moves into a new
    section, for accents that land on the arrangement instead of the beat.
- Visuals can also read the track's beat and bar count, section number and
  a live chromagram — groundwork the next round of visual modes builds on.

### Changed

- Existing routes are untouched: without a shape, lag or new source, every
  project modulates exactly as it did in 2.78.0.

## [2.78.0] - 2026-08-07

### Added

- **Builder joined the modulation era.** Every knob of every layer in your
  Builder stack — opacity, hue, hue spread, and each layer's own controls —
  is now a first-class target across the whole app:
  - **Modulate it** — route kick, bass, hats, stems, anything, straight to
    a single layer's knob. The route picker lists them grouped per layer
    ("Layer 2 · Particles"), so a deep stack stays navigable.
  - **Automate it** — draw timeline lanes on individual Builder layer
    parameters, with real value ranges.
  - **Map it** — MIDI-learn a hardware knob to one layer's glow, and stem
    auto-routing now wires imported stems into Builder too.
  - **Save it** — "Save look" now captures your Builder layer values, and
    applying a saved Builder look sets the stack back the way you had it.
    Exports resolve all of it exactly like the preview — same frames, same
    file, as always.
- **Factory stacks.** Builder now opens with six curated starting points,
  one click each: Classic, Neon club, Sunset drive, Deep space, Cathedral,
  and Phosphor — whole layer stacks (composition, blends, colors), not just
  value tweaks. Your current stack is untouched until you pick one.

### Changed

- Nothing moves on its own: with no routes or lanes, every existing Builder
  stack renders pixel-identically to 2.77.0.

## [2.77.0] - 2026-08-07

### Added

- **The renderer itself got deeper** — the three modes that were capped by
  engine limits, uncapped:
  - **Spectrum Scape** — the 3D city finally answers the beat: beat flash
    and band response are real controls, plus grid layouts (rings, rows,
    a spiral galaxy), bar shapes (boxes, pyramids, round columns), light
    rig and fog controls, and the standard color pair. New styles: Bass
    Terrain, Galaxy, Obsidian Spires, Flashpoint, Harbor Mist.
  - **Particle Flow** — new force fields (jet stream, vortex street,
    orbital) join the classic curl flow, ring and line attractors,
    treble-driven sparks, ribbon streamers, and a backdrop wash. New
    styles: Slipstream, Wake, Accretion, Halo, Horizon, Silk, Static
    Charge.
  - **Oscilloscope XY** — the genre's poster shot is finally real: a
    stereo XY/Lissajous display plotting left against right with true
    phase (goniometer-style), beam dwell that brightens where the trace
    lingers, and a rotate control for spinning figures. New styles:
    Lissajous Rose, Phase Scope, Vector Draw. Sweep mode and all
    existing looks are untouched.
    All defaults look exactly as before — every new axis is opt-in.

## [2.76.0] - 2026-08-07

### Added

- **Four more modes got dramatically deeper.** Third wave of the
  mode-depth program:
  - **Echo Trails** — the vortex can now devour more than a ring: star,
    spectrum-bar skyline, waveform loop, and **your album art** can all
    be fed into the trail accumulator. The vortex center can sit
    off-axis, and the warp field gained shear and radial-wave modes.
    New styles: Starfall, Pinwheel, Seismic, Droste (cover art),
    Riptide, Maelstrom.
  - **Metaballs** — the lava lamp finally smears: an optional goo-trail
    residue, bass-weighted blob sizes, per-blob squash for organic
    shapes, and reflective environments for the gloss. The beat pump is
    now a first-class control. New styles: Goo, Amoeba, Showroom,
    Mercury Dawn.
  - **Oscilloscope** — a real multi-trace bench: split the signal into
    bass/mid/treble lanes, render as classic beam, dots, or
    sample-hold staircase, and pick your graticule (none, crosshair,
    full reticle). Trace persistence is now a first-class control. New
    styles: Analyzer Bench, Dot Sampler, Logic Analyzer, Fireflies.
  - **Tunnel** — new wall materials (honeycomb, glowing wireframe,
    organic tissue), **album art projected around you** as a mosaic on
    the tunnel walls, and beat-flashing junction mouths racing past.
    Center glow is now a first-class control. New styles: Honeycomb,
    Vector Grid, Gullet, Gallery, Interchange, Slipstream.
    All defaults look exactly as before — new territory is opt-in via
    parameters and the new styles. (One technical footnote: enabling
    Metaballs' smear machinery moves its rendering onto the same
    high-precision path the other trail modes use — indistinguishable
    on screen.)

## [2.75.0] - 2026-08-07

### Added

- **Four more modes got dramatically deeper.** Second wave of the
  mode-depth program:
  - **Spectrum Bars** — a real stereo mode (the bars split into a
    left/right pair driven by the actual stereo field), bar cap shapes
    (rounded, dot caps), a reflection floor, a gentle sway, and
    low/high frequency trim. New styles: Stereo Field, Night Stage,
    Hi-Fi (amber VFD hardware look), Undertow.
  - **Bass Circle** — a segmented VU-style ring option, bokeh particles
    that pop on the beat, and an authored core for tracks without cover
    art (gradient or a live waveform ring). Ring spin is now a
    first-class control. New styles: Meter, Fireflies, Pulse Core,
    Polaroid.
  - **Particles** — snare hits now launch shooting stars, an optional
    constellation mode links nearby particles into a living star chart,
    and the mode joins the standard color controls (saturation and
    lightness). New styles: Meteor Shower, Constellation, Warp Prism;
    Rave gained meteors.
  - **Kaleido Nebula** — true two-color nebulae (teal core / magenta
    rim class of looks), a parallax starfield behind the clouds, and a
    directional wind the clouds stream along. New styles: Emission
    Nebula, Star Nursery, Stellar Wind, Pinwheel Galaxy; the whole deck
    re-tuned.
    All defaults look exactly as before — new territory is opt-in via
    parameters and the new styles.

### Changed

- Kaleido Nebula's saturation control now uses the same 0–2 scale as
  every other mode (it was a nonstandard 0–1 scale). Existing projects
  and looks are migrated automatically and render identically.

## [2.74.0] - 2026-08-07

### Added

- **Four visual modes got dramatically deeper.** First wave of the
  mode-depth program:
  - **Voice Orb** — up to three satellite orbs that each breathe with
    their own slice of the voice, plus new ring styles (line, dots,
    beads). New styles: Roundtable, Sonar, Pearls; Frost is now the
    eight-fold snowflake its name promised.
  - **Aurora** — a controllable palette family (ember, gold, violet
    auroras are finally reachable), up to five curtains, an optional
    mountain horizon and a moon. New styles: Ember, Moonrise, Ridgeline,
    Molten; four older styles sharpened.
  - **Synthwave** — a perspective road with beat-locked lane dashes, the
    classic banded sun as a controllable family, and a city skyline
    with treble-glimmer windows. New styles: Outrun, Neon Metropolis,
    Poster Sun, City Limits; Midnight Drive finally has its road.
  - **LED Matrix** — a real-time **spectrogram waterfall** display mode
    (scrolls with the track, both directions), with the motion and beat
    controls promoted out of Advanced. New styles: Spectrogram,
    Code Rain, Prism Roll.
    All defaults look exactly as before — new territory is opt-in via
    parameters and the new styles.
- Sliders for wide ranges now travel logarithmically where it helps
  (fine control where the action is), and modulation/MIDI now snap
  whole-number settings cleanly instead of strobing through fractions.

### Fixed

- **The default sync mode "Kicks" now actually follows the kick drum.**
  It used to quietly behave like "Energy"; motion on default settings is
  now punchier and honest to its name.
- LED Matrix's compatibility fallback (systems without WebGPU) lost its
  colors to a naming mismatch — fixed.

## [2.73.0] - 2026-08-06

### Fixed

- **Closing Beatform mid-export no longer leaves a broken video behind.**
  The export's encoder is shut down cleanly, the half-written file is
  removed instead of being finalized to look complete, and staged
  temporary audio is swept up.
- **Generated lyrics can no longer attach to the wrong track.** If you
  load a different track while lyrics are still generating, the result
  is discarded with an honest notice instead of silently landing on the
  new track.
- **Escape while typing no longer closes everything.** Esc in a search
  box or name field now just leaves the field; a second press closes
  surfaces as before.
- **Deleting a saved look now asks first** — and the delete button is
  easier to hit.
- **Batch render problems now show up in the batch panel** instead of a
  dialog that wasn't open, and Start says why it's unavailable while a
  single export runs.
- **The Gallery's "Added" badge now tells the truth.** It stays only
  while the look actually exists in My Looks (deleting the look brings
  "+ Add look" back), repeated clicks can no longer stack duplicate
  copies, and applying a theme shows a brief "Applied ✓" instead of a
  permanent claim.
- **Full storage is now said out loud.** When Windows refuses to cache a
  change (disk/quota full), Beatform keeps working and tells you once —
  instead of silently losing the cached copy.
- **Very long exports with loudness normalization no longer risk a false
  "worker stalled" restart** during their measurement phase.
- **Exports got leaner:** analysis that only feedback-style visuals need
  is now skipped for everything else — same pixels, less memory and CPU.
- **Editing an imported shader mid-crossfade** no longer briefly renders
  the old shader with the new settings.
- Tightened the app's internal Web MIDI permission check on Windows.

### Changed

- **"Templates" are now called "Themes" everywhere** — same files, same
  chips, one name (matching the Gallery). The Themes section links
  straight into the Gallery's theme shelf, and My Looks links to the
  look shelf.
- The Gallery explains the difference right in the dialog: Looks restyle
  the current visual mode · Themes replace your whole setup.

## [2.72.1] - 2026-08-06

### Fixed

- **Windows now shows the right version in Apps & features.** The
  uninstall entry's version number could go stale across updates (some
  installs still said 2.39.0). Beatform now checks its own entry on
  every start and repairs it if it disagrees with the app that's
  actually running.

## [2.72.0] - 2026-08-05

### Added

- **The Gallery is open — and it has its own front door.** A new Gallery
  button in the top bar (next to Project) opens a proper browsing surface:
  a wide grid of community looks and themes with type filters, search and
  big previews. The first curated collection is live — eleven hand-tuned
  seeds spanning kaleidoscopes, particle galaxies, tunnels, synthwave
  sunsets and more. Same trust rules as before: every entry is reviewed,
  pinned to an immutable version, and checksum-verified before Beatform
  parses a single byte of it.

### Changed

- The Gallery moved out of the Visual settings panel into its own dialog;
  the Templates section keeps a "Browse the Gallery…" shortcut.

## [2.71.0] - 2026-08-05

### Added

- **Gallery — browse and install community looks and themes.** The Visual
  tab has a new Gallery section: browse a public, reviewed collection of
  looks and themes, see who made each one and under which license, and
  add a look to My Looks or apply a theme in one click. Built for trust:
  nothing loads until you press Browse, every entry is pinned to an
  immutable version, and every download is size-checked and
  checksum-verified before Beatform even parses it — a tampered or
  corrupted file simply refuses to install. Entries made for a newer
  Beatform show up but wait politely for you to update. The first curated
  seed collection is in review and will appear in the Gallery on its own —
  no app update needed. Want yours listed? Submissions are reviewed on
  GitHub (beatform-app/gallery).

## [2.70.0] - 2026-08-05

### Changed

- **Beatform file extensions.** All shareable files now carry Beatform's own
  extensions: projects are `.bfproj`, looks `.bfpreset`, templates
  `.bftheme`, Builder stacks `.bfbuilder`, and imported shaders `.bfshader`
  (previously `.avproj`, `.avpreset`, `.avtheme`, `.avbuilder`,
  `.avshader` — a leftover from the app's pre-Beatform working name).
  **Files saved by older versions are not importable in this release and
  won't open by rename** — re-export anything you want to keep shareable
  from 2.70. Nothing inside the app is lost: your saved looks, settings and
  library all carry over as usual; only files exported to disk under the
  old extensions are affected. This clean break
  lands before the public preset gallery opens, so everything shared there
  uses the final format from day one.

## [2.69.0] - 2026-08-04

### Added

- **Automatic lyrics — fully local, with word-level karaoke timing.** The
  Text tab can now generate timed lyrics from your track entirely on your
  machine: vocal isolation, transcription, and word-level forced alignment
  run in a local engine — no cloud, no account, nothing leaves your PC.
  Models download on first use (about 0.7 GB for the standard tier, larger
  optional quality tier) with verified, resumable downloads, honest disk and
  time estimates up front, and full cancel support. Uses your integrated or
  discrete GPU when it helps and falls back to CPU automatically. The
  karaoke wipe now follows the real timing of each sung word — including
  long held notes — instead of gliding across the line.
- **Lyrics correction editor.** Generated (or imported) lyrics open in a
  proper editor: fix words and lines inline, nudge timings, split and merge
  lines, click a timestamp to jump the track there, and export a standard
  .lrc file (with word timing when present). Lines the engine is unsure
  about are flagged red or amber, with a one-click jump to the next flagged
  line — and a per-line "re-align" that re-times just the line you edited
  in seconds. Undo/redo included.
- **Enhanced LRC import.** Word-timed (A2/enhanced) LRC files from other
  tools now import with their word timing intact.

### Changed

- **Performance display: RAM and CPU now count the whole app.** The
  readouts include Beatform's WebView2 processes (the majority of real
  usage), shown as "total (main …)" — matching what Task Manager splits
  across two groups.

### Fixed

- **MIDI control works over real hardware transports.** Two long-standing
  issues silently blocked Web MIDI on the shipped app — a browser
  permission WebView2 denies by default, and an internal call pattern every
  real Chromium rejects. Both fixed and verified end to end against a
  virtual MIDI port; MIDI Learn in the Live tab now works with real
  controllers.

## [2.68.1] - 2026-08-04

### Fixed

- **Performance display: FPS now reports frames actually drawn.** It used to
  count the browser's animation ticks, which fire at your monitor's refresh
  rate no matter what — so the readout pinned at the panel's Hz even with
  the frame cap at 30 (the cap skips draws inside ticks, it doesn't slow
  the ticks). It now counts frames the renderer actually presents, so the
  frame cap, the resolution setting and real GPU load all show truthfully.
- **Performance display: the "Frame" row is now labeled "Frame time"**,
  matching the settings checkbox.

## [2.68.0] - 2026-08-04

### Added

- **Tunnel: Color fade.** A new slider in the Color section smooths the
  tunnel's color transitions. At 0 the color still switches with a hard edge
  exactly as before; raise it and each color crossfades into the next — at
  maximum the tunnel is always mid-fade, one color melting into the next
  with no visible switch at all.
- **Performance display.** App Settings → Performance can now show a live
  diagnostic overlay over the preview: FPS, frame time, renderer, JS heap,
  CPU, RAM and disk (GPU shows "—" for now). Off by default; position, size,
  color and each individual stat are configurable. It is drawn over the
  preview only and never appears in exports.
- **Preview resolution.** Also in App Settings → Performance: render the
  live preview at Native, 75% or 50% resolution. On integrated GPUs the 50%
  setting is the single biggest smoothness lever — and exports are
  completely unaffected, they always render at the exact size you pick in
  the export dialog.

### Fixed

- **Particles: the cutoff lines are gone.** Particles and their glow used to
  clip along straight lines (horizontal at the default Direction), appearing
  a couple of minutes into a track and getting worse the longer it played —
  and changing Direction mid-track could shred the whole frame into smeared
  strips. The drift field's bookkeeping drifted apart from its drawing over
  time; both now live in one frame of reference, so the field stays clean at
  any track position, and the particles now genuinely travel in the chosen
  Direction (they previously only wandered in place).
- **Particles: faster.** The same pass removed a pile of per-pixel work that
  was being burned even when its settings were at zero (clumping noise, beat
  targets, redundant math in the inner loops) — a real frame-rate lift on
  integrated GPUs, with identical output.
- **Metaballs: clean merges.** Merging blobs no longer grow pointy creases
  at the join (the gloss highlight's surface direction is undefined exactly
  there — it now fades out smoothly instead of tearing), no longer flood
  into big blurry white patches (the hot core now belongs to each blob
  individually instead of summing across overlaps), and silhouette edges
  stay consistently soft at every scale instead of turning hard and jagged
  where the field gets steep.

### Changed

- **Internal rename: `starfield` → `particles`.** The Particles mode's
  internal id now matches its name. Saved projects, looks, presets, layouts
  and the mode-strip order from any older version migrate automatically.

## [2.67.0] - 2026-08-03

### Added

- **AV1 10-bit export.** A new **AV1 10-bit** format in the export dialog
  (desktop) writes a genuine 10-bit MP4 — yuv420p10le, BT.709, SVT-AV1 —
  with AAC audio. Every other lane is 8-bit the moment frames leave the GPU;
  this one taps the render at 16-bit float **before** that quantization, so
  slow gradients, glows and dark falloffs keep their levels instead of
  banding. Raw frames stream straight into the bundled ffmpeg with the same
  flat-memory backpressure as ProRes. Verified end-to-end on device: a real
  export decodes back to 752 distinct 10-bit luma levels where 8-bit tops
  out at 256.

## [2.66.0] - 2026-08-03

### Added

- **Tunnel becomes a waterslide.** A new **Curve** knob (with an advanced
  Curve length) bends the tube into sweeping turns — up, down, left, right —
  with the camera leaning into each bend, instead of the straight illuminated
  bore. The path is part of the tube itself, so preview and export always
  agree and pausing mid-bend holds a stable frame. The **speed ceiling
  doubled**, with the wall pattern automatically softening at speeds that
  used to strobe. A new **Waterslide** factory style shows it off. Existing
  projects are untouched — Curve defaults to off and saved speeds render
  identically.

### Changed

- **The Pulse slider is now usable across its whole range.** Tunnel,
  Metaballs and Particles were tuned around 100% and scaled linearly, so
  anything above ~50% teleported the tunnel camera, strobed the lava lamp
  and blew the particle field into a washed-out flood. All three now shape
  their beat response: at 100% they feel like before, at 200% they hit
  visibly harder yet stay composed — no teleports, no strobing, no
  full-frame flashes.

- **Particles moves forward, never back.** Beat motion used to shove every
  particle out and drag it back as the beat faded — the field visibly
  rubber-banded on every hit. Particles now glide to a new resting spot on
  each beat of the tempo grid and stay there. Also fixed: particles no
  longer clip against invisible edges mid-screen, and the frame-rate
  collapse at high Pulse settings is gone (about a tenth of the overdraw it
  used to burn).

- **The drawn spectrum now sits on the beat.** Long analysis windows (171
  and 341 ms) painted their bars roughly half a window late — noticeably
  behind the music in the live preview, and behind the transient in
  exports too. Exports are now aligned to the hit (a click lands within one
  analysis frame of its true position), and the live preview's visual
  latency drops from ~85 ms to ~21 ms (171 ms window) and from ~171 ms to
  ~43 ms (341 ms window). Beat detection was never affected — it always ran
  on its own fast path — and the resolution hints now state the actual
  visual latency.

### Fixed

- The modulation target dropdown's group headers were white-on-white under
  a light Windows theme; the list now renders dark and legible everywhere.
- The remove-route ✕ no longer crowds into the value readout in the
  modulation list.

## [2.65.0] - 2026-08-02

### Added

- **Imported Shadertoy shaders can now use helper functions that take a
  channel.** Passing `iChannel0` into a helper —
  `float peak(sampler2D ch, float x)` and friends — is one of the most common
  shapes in real Shadertoy code, and it was the single biggest reason an
  import got refused. Those helpers are now translated automatically, one
  copy per channel they're actually called with, so the shader just works.

  Two more real-world stumbles went with it: shaders that sample with a bias
  (`texture(ch, uv, -100.0)`, a common "always use the sharpest mip" trick)
  now translate instead of failing on the GPU, and a shader that carries an
  extra `mainSound` or `mainVR` entry next to its Image code imports normally
  rather than being turned away — only genuinely sound-only or VR-only
  shaders are declined, and they now say which they are.

  Measured on the same 40-shader real-world set used to design the feature,
  imports went from 34 to **37 of 40**, with every translated shader
  compiling cleanly on the GPU. If a channel still can't be resolved — say
  it's picked by a condition at runtime — the error names the function and
  the line instead of showing a translator dump.

## [2.64.1] - 2026-08-02

### Fixed

- **Closing a shader dialog with unsaved changes no longer errors.** The
  "discard changes?" prompt in the shader editor and the new Shadertoy import
  dialog used the browser's raw `confirm()`, which the desktop shell routes
  through a dialog permission the app deliberately doesn't grant — so the
  installed build showed "Command plugin:dialog|confirm not allowed by ACL"
  instead of asking. Both dialogs now use the app's native yes/no prompt (the
  same one the export disk check uses). Found by the v2.64.0 installed-app
  smoke; the shader editor's prompt had been silently broken this way since it
  was added. A lint rule now blocks raw `confirm`/`alert`/`prompt` so the
  mistake can't ship again.

## [2.64.0] - 2026-08-01

### Added

- **Shadertoy import.** Paste the Image tab of a single-pass Shadertoy shader
  into the new import dialog (shader editor → _Shadertoy…_) and it becomes a
  Beatform visual: the GLSL is translated to WGSL locally by the app itself —
  no network, no build tools — compile-checked on your GPU, and added to the
  mode strip like any custom visual.

  The track's audio arrives exactly the way Shadertoy's own music channel
  does: `iChannel0` is a 512×2 texture with the spectrum on row 0 and the
  waveform on row 1, so audio-reactive shaders work unmodified. `iTime`,
  `iFrame` and `iDate` all follow the track clock — an imported visual
  renders frame-identically in the live preview and in every export.

  Author, source URL and license travel with the visual (Shadertoy's default
  CC BY-NC-SA is preselected), show up in the mode description, and survive
  `.avshader` sharing and project embedding. Re-opening an imported visual
  edits its original GLSL, never the generated WGSL. Clear, line-numbered
  errors point at your GLSL when something isn't supported — multi-pass
  buffers, cubemap/video/keyboard channels, sound shaders, and channels
  passed as `sampler2D` function parameters are declined by name.

  Under the hood: a dedicated render pipeline runs the translated module and
  routes through the shared composite pass, so lyric and text overlays,
  background modes and the whole post chain (bloom, tonemap, grain…) apply to
  imported visuals too. Legacy WebGL-era idioms (`texture2D`,
  `precision`, `const` parameters, BOM/CRLF files) are cleaned up
  automatically; texture reads are rewritten to explicit-LOD form so shaders
  sampling inside branches — most of them — pass WGSL's uniformity rules.
  Project files embedding an imported visual are stamped schema v12 (and
  `.avshader` files v2) so older app versions decline them cleanly instead of
  silently rendering the wrong mode; everything else keeps writing the old
  versions and stays backward-compatible. A new end-to-end gate
  (`npm run test:shadertoy:built`) drives paste → translate → render →
  export twice and asserts bit-identical frame hashes.

## [2.63.0] - 2026-07-29

### Added

- **A-B loop regions for focused live look-tuning.** Set A and B at the
  playhead with the new controls or **I** and **O**, then toggle the selected
  region with **L**. Both labeled markers can be dragged directly on the seek
  bar; clearing them returns an active loop to whole-track behavior.

  Region endpoints are ordered, clamped to the track, and kept at least 100 ms
  apart. Playback uses `AudioBufferSourceNode.loopStart` and `loopEnd`, while
  the UI clock mirrors every wrap and explicitly resets analyzer state—even for
  loops shorter than the old backwards-jump threshold. Markers are session-only
  and clear when a new track loads, so project and export formats stay
  unchanged.

## [2.62.0] - 2026-07-29

### Added

- **Full color controls for every spectrum visual.** Spectrum Bars, Bass Circle,
  Radial Burst, and LED Matrix now expose whole-look Saturation and Lightness
  controls alongside existing hue controls. Saturation 0 produces a genuinely
  neutral grayscale—including LED board and highlight tints—and Lightness can
  lift the visual into clean white without washing dark backgrounds gray.

  Both controls default to the authored look exactly, so existing projects and
  styles render unchanged. The Canvas2D fallback honors the same controls. The
  real WebGPU matrix now includes grayscale and bright-grayscale endpoint cases
  for all four modes; the original 128 default and style pixel hashes did not
  change.

## [2.61.0] - 2026-07-29

### Added

- **Analyzer-quality spectrum views without changing Beatform's punchy sync.**
  Spectrum-capable modes now offer three drawn-spectrum windows (roughly
  85/171/341 ms at 48 kHz), Musical or Linear axes, and either the authored
  96-band view or measured FFT bins with no interpolation. A 30–300 Hz Linear
  view at Precise resolution, for example, draws 92 real bins at 48 kHz rather
  than inventing 96 values between them.

  Longer transforms feed drawn bins only. Kick, beat, band-energy, and sync
  detectors remain on the existing responsive transform, so enabling more
  low-frequency detail cannot make a project feel slower or retune its hits.
  Live and export refresh the long display FFT on the same fixed 60 Hz clock.

  The settings panel reports the current device's actual window length,
  hertz-per-bin, native-bin count, and rendered count. The High edge control
  now reaches 200 Hz for narrow low-frequency analyzer views.

## [2.60.1] - 2026-07-28

### Fixed

- **System-audio visualization no longer runs a beat behind what you are
  hearing.** Watching visuals react to Spotify or a browser, everything arrived
  noticeably late — and the longer a session ran, the worse it got.

  The audio captured from your speakers passes through a small buffer on its way
  to the analyser. That buffer had no way to empty itself: any moment the app
  stuttered left a little extra audio sitting in it, and nothing ever took that
  audio back out, so the delay only ever grew. It waited until a quarter of a
  second had piled up before doing anything about it, which made a QUARTER
  SECOND of lag the normal state of a long session rather than an emergency.

  It now watches how full the buffer gets and gives back only depth a complete
  measurement window proved unnecessary. Late-delivery recovery is credited
  only against frames already emitted as silence, so it cannot manufacture a
  second hole by dropping valid audio.

  The native bridge also stopped pushing full-rate float blocks through
  Tauri's fetch-backed channel path. Capture is converted to PCM16 outside the
  realtime callback, sent in bounded base64 batches below the direct-channel
  threshold, and decoded by the worklet. On the optimized Windows build at
  48 kHz, real two-tone loopback passed at both display rate and a 30 fps cap:
  341–348 ms onset response, 99–101 ms steady ring depth (111–112 ms maximum),
  100% visible tone continuity, and zero worklet underruns during each 12 s
  sustained run. These are validation measurements, not hardware-universal
  latency promises.

- **System-audio visualization stays still when nothing is playing.** With the
  system muted or idle, the visuals still pumped and threw the occasional spike,
  most visibly on Radial Burst and Bass Circle.

  Silence from a sound device is not always silence. Depending on the driver and
  whatever "audio enhancements" it applies, a muted output can still hand over a
  faint hum or dither — far too quiet to hear, but Beatform's analysis is built
  to bring out quiet detail, so it drew it. Live capture now recognises a level
  that low as silence and shows nothing.

  This applies only to system-audio capture. Track playback is untouched; its
  export path has no corresponding gate.

- **Texture-feedback trails now use a fixed 60 Hz state clock.** Oscilloscope
  afterglow and Echo Trails no longer mutate history once per presented frame.
  A 24/30 fps export consumes multiple state ticks before presenting; a
  90/120/144 Hz preview presents fresh motion between ticks without feeding it
  back. Trail decay and sampling density therefore no longer depend on output
  or display fps.

  Oscilloscope's finishing pass also runs before trail carry-forward, so a
  pixel is graded once rather than once for every frame it survives.

- **Ambiguous browser read failures are no longer diagnosed as disk-full by
  name alone.** `NotReadableError` can also mean permissions or concurrent file
  access. Beatform now re-measures the scratch volume at failure time and only
  shows the disk-space explanation when that independent check is low; explicit
  OS/ffmpeg disk-full codes remain translated directly.

### Changed

- **Oscilloscope's trails look brighter.** A direct consequence of the fix
  above: the afterglow now keeps its authored colour and no longer darkens
  toward the corners the longer it lingers. The beam itself is unchanged. If you
  had dialled Persistence up to compensate, it will now read stronger than
  before.

- **Preview/export claims now have one explicit truth contract.** Indexed A/V
  timing and shared project/render definitions are guarantees; live device
  timing and cross-GPU pixels use measured tolerances rather than unsupported
  “exact same pixels” language.

## [2.60.0] - 2026-07-28

### Fixed

- **A project now reacts the same on a high-refresh screen as it does in its
  own export.** On a 144 Hz display the preview fired far more beats and drum
  hits than the exported video of the same project — measured on real music,
  about 75% more. Beatform's whole promise is that what you see is what you
  render, and this broke it for anyone on a fast monitor.

  The cause was that onset detection stepped once per drawn frame. Spectral
  flux is a frame-to-frame difference, so drawing more often did not measure the
  music more finely — it simply gave the detector more chances to fire. It now
  steps on a fixed clock, so the beats you get depend on the track and nothing
  else.

  **The preview is not any less smooth.** The spectrum, peak caps, motion and
  all the levels still update on every frame you draw; only the decision to
  trigger moved. And the same fix applies to exports: rendering at 30 fps no
  longer finds a different set of hits than 60.

  Two limits are honest rather than hidden. A live preview reads the audio only
  when it draws, so a display slower than 60 Hz analyses at its own rate, and on
  a faster one the beat count can differ by one. Before this it differed by a
  factor of 2.4.

## [2.59.0] - 2026-07-28

### Fixed

- **High-sample-rate audio devices now see the same music everyone else does.**
  Beatform takes its analysis rate from whatever your output device runs at, but
  the analysis window was a fixed size regardless — so on a 96 kHz interface it
  examined half as much time and half as much low-frequency detail as on a
  48 kHz one. The effect was not subtle: on identical audio, the bass level
  driving every reaction and modulation read **72% higher** at 96 kHz. Projects
  built on such a device genuinely behaved differently, and nothing in the app
  explained why.

  The window is now held constant across devices instead of the bin count, so
  44.1, 48, 96 and 192 kHz all read the same track the same way. **If you run at
  44.1 or 48 kHz — most people — nothing changes at all.** If you run higher,
  your bass reactions will be calmer and more accurate, and closer to what the
  same project shows on any other machine.

### Changed

- The beat detector's frequency band is now specified in hertz rather than in
  FFT bins, and the detectors' absolute thresholds scale with bin density.
  **Both are unit corrections with no visible effect** — beat times measured
  identical at 44.1, 48 and 96 kHz before and after, loud and quiet. They keep
  the band meaning the same frequencies on every device rather than drifting
  with the sample rate.

- The oscilloscope's waveform length no longer follows the analysis window size,
  so the trace looks the same regardless of the transform behind it.

## [2.58.0] - 2026-07-28

### Fixed

- **Dragging the playhead no longer sets off a beat that isn't in the music.**
  After a seek the analyser compared the new position against wherever you just
  came from, and that difference was almost always big enough to trigger a
  beat, kick, snare or hat — so scrubbing punched the visuals on nearly every
  drag. Looping a track did the same thing at the top of every lap. The
  analyser is now told when the audio it is about to hear isn't a continuation
  of what came before: on seek, loop, loading a track, and switching in or out
  of system audio.

  Scrubbing still looks the way it did otherwise — the spectrum, peak caps and
  motion carry across a seek rather than blinking out and rebuilding, and there
  is no dead moment before beats resume.

- **A recording with a DC offset no longer pegs the bottom bar of the
  spectrum.** If you dragged the analysed frequency range down toward its 10 Hz
  floor, any file carrying a constant offset lit the lowest bar and held it
  there for the whole track, in both the preview and the export. That bar now
  reads the music.

### Changed

- The drum-onset detector's threshold now scales with frame time, matching the
  beat and sync detectors. **This is a consistency fix with no visible effect**
  — measured, every frame rate from 30 to 144 already found the same hits, down
  to levels far below anything audible. It is tidied now so the value can be
  adjusted later without quietly behaving differently on a high-refresh display.

## [2.57.0] - 2026-07-28

### Added

- **You can reorder the mode strip.** App settings (gear, or Ctrl+,) has a new
  **Modes** tab — drag a mode to move it, or use the up/down buttons, and
  "Restore default order" puts it back. Your order is saved, survives closing
  the app, and carries across updates. If a future version adds a new mode it
  appears in your list rather than going missing, and if you have never
  customised the order you still get any improved default that ships later.

### Changed

- **A new default order for the mode strip**, arranged by how the modes
  actually relate to each other rather than the order they happened to be
  built in.
- **The 1–9 keys and the next/previous shortcuts now follow the strip you see**,
  so pressing 3 always selects the third mode shown.
- **Particles and Particle Flow have readable previews.** Both were rendering
  as nearly-black tiles — dark blue particles on a black background at
  thumbnail size. Every mode's preview was checked; those two were the only
  ones that needed it, and no mode's actual appearance changed.

## [2.56.0] - 2026-07-28

### Fixed

- **The mirrored looks in Tunnel, Aurora and Oscilloscope now react to the
  whole track.** Turning on the club mirror was quietly narrowing what the
  visual could hear. Tunnel's **Kaleido Tube** was reading only the lowest
  sixth of the spectrum — bass, with no mid or treble at all — despite being
  described as stained glass lit by the spectrum. Aurora's **Cathedral** lost
  its bass response entirely. Oscilloscope's **Lissajous** was drawing from
  half the waveform, and the half it dropped was the one holding the trigger,
  so the figure sat off-centre instead of anchored to the middle of the
  screen.
- These are the same underlying issue fixed for Echo Trails in 2.55.0, now
  closed everywhere it occurs. **No look was retuned to compensate** — each
  was measured before and after, and every one still renders at the exposure
  it was authored with. Looks with the mirror switched off are unchanged
  down to the byte.

## [2.55.0] - 2026-07-28

### Fixed

- **Echo Trails renders the same at every frame rate.** Its trails got dimmer
  the lower the frame rate went, so a 30 fps export did not match what you saw
  in a 60 Hz preview, and a high-refresh monitor looked brighter still. On the
  Supernova look a 30 fps export was rendering at roughly two-thirds the
  brightness of the preview. All three frame rates now match, and 60 fps output
  is unchanged from before.
- **The hard edge in Echo Trails is gone.** A straight cut ran through the
  ring at the same angle in every look, most obvious with Rounding turned up.
  The ring reads the sound left-to-right and then wraps, so the highest
  frequencies landed directly against the lowest and the tunnel smeared that
  step outward every frame. There were actually two edges in the same place —
  one in the shape, one in the colour — and both are closed.
- **Echo Trails' mirrored looks now react to the whole track.** Prism and Rose
  Window were only ever reading a thin slice from the middle of the spectrum —
  about 12% and 6% of it — so they never responded to bass or treble at all.
  Every mirrored setting now covers the full range. Rose Window's brightness
  was rebalanced to match, since it can suddenly hear a lot more.

### Changed

- Build tooling updated (Vite 8, and the media muxer that writes MP4 and WebM
  files). Exports were checked before and after: rendered output is
  byte-for-byte identical, and WebM files are too.

## [2.54.0] - 2026-07-27

### Fixed

- **The Oscilloscope no longer turns into a solid slab.** Two looks —
  Lissajous and Smoke Signal — filled the whole frame with a bright block
  instead of drawing a trace. The afterglow was set high enough that the trail
  outlived the time the beam needed to sweep the display, so every pixel it
  had recently touched stayed lit at full brightness. The two looks are
  retuned, and the afterglow slider no longer goes into the range where this
  happens — no position it can still reach behaves differently than before.
- **The same project now looks the same on a high-refresh screen.** The
  Oscilloscope's afterglow got thicker the higher your monitor's refresh rate
  went, so a 120 Hz preview did not match a 30 fps export. It is now pinned to
  the density it was designed at. Exports are unaffected.
- **Spectrum Scape stopped washing out to white on loud tracks.** All seven of
  its looks lost their colour and depth on a loud master. Three separate
  causes: the loudness boost was being applied twice, the Glow amount silently
  scaled with the Height setting, and the highlight on tall bars triggered on
  every bar at once instead of only the peaks. Quiet material renders exactly
  as it did before.
- **Four Spectrum Scape looks rebuilt.** Street Level, Neon Grid, Canyon and
  Top Down were showing a flat wall, a fused mass, a single bar face and a
  pale plate respectively. All four now read as legible 3D geometry on
  everything from a −2.9 LUFS master to a −16.9 LUFS one.

## [2.53.0] - 2026-07-27

### Added

- **A settings panel built to grow.** Parameters that are really a _choice_ —
  symmetry, mirror mode, image fit — are now dropdowns instead of sliders, and
  on/off settings are switches. Colours get a proper colour picker, hues get a
  rainbow track, and angles get a dial you can drag. Settings are grouped by
  what they do (Shape, Colour, Motion, Reaction, Glow, Image, Camera,
  Backdrop) rather than by the order they happened to be written in.
- **Search now finds everything.** Typing in the settings search box filters
  individual settings and opens whichever groups contain them. Previously the
  advanced tier was never searched at all, so most settings could not be found
  by name.
- **112 new looks across every mode**, replacing the old set. These change how
  a mode _behaves_ — mirroring, symmetry, layer counts, trails, camera framing,
  reaction curves — instead of only recolouring it. Every mode also gets at
  least one clean, minimal look for when the music should lead.
- **13 new templates**, replacing all the old ones. Each is a complete
  starting point: Cover Story repaints itself from your artwork, Hyperlane
  makes a drop lurch forward, Liquid Chrome splits the light on a wide mix,
  Polar Night never strobes, Editorial Ink is deliberately restrained, On Air
  is a square podcast deliverable, Pocket Rave is vertical for phones.

### Fixed

- **Saving a project no longer forgets your analysed frequency range.** If you
  narrowed the range the visuals listen to, that setting was silently reset to
  the default every time the file was reopened.

## [2.52.0] - 2026-07-27

### Added

- **Exports now check for disk space before they start, on both drives that
  matter.** A ProRes export can spend ten minutes rendering only to fail
  because the _system_ drive filled up — even when the drive you chose has
  hundreds of gigabytes free. The pre-flight estimates what the job needs and
  warns if either the destination or the scratch space is short, so you find
  out in a second rather than after the work is gone. It warns; it does not
  block, because you may know something it does not.

### Fixed

- **Disk-full during export said "permission problems".** The underlying error
  is worded that way by the browser engine, and it was shown verbatim — sending
  you to check file permissions when the real problem was a full drive. It now
  names the drive that actually ran out, and says plainly that the original
  wording is misleading.
- **A cancelled or rejected ProRes export left its staged audio behind.** The
  prepared audio track — up to ~691 MB for an hour-long song — stayed in the
  temporary folder on the system drive, the very drive most likely to be
  short of space. Repeated attempts stacked up more copies.
- **Two different tooltips for the same button.** The gear in the top bar and
  the button in the help dialog both open App settings but described it
  differently.

## [2.51.0] - 2026-07-26

### Fixed

- **Long exports now hold steady instead of growing.** 2.50.0 made the encoders
  wait for the disk, which nearly doubled export speed — but exports run on a
  background thread, and on that path handing a chunk to the main thread
  returned immediately, so there was still nothing real to wait for. A
  measured 2-hour export improved but kept climbing. The background thread now
  waits for each chunk to actually reach the disk before producing the next
  one, so only one chunk is ever in flight. This is the same handshake the PNG
  image-sequence lane has always used; the video lane never had it.
- **A slow drive no longer aborts a healthy export.** Because the export thread
  now deliberately waits while a chunk is written, the "worker stopped
  responding" safety check could mistake that wait for a hang and kill the
  export. It now ignores time spent waiting on our own disk writes. This
  affected the image-sequence lane too, ever since it gained the same
  handshake — a single frame or chunk slower than 30 seconds (a stalled
  network share, a sleeping USB drive) was enough to trigger it.

## [2.50.0] - 2026-07-26

### Fixed

- **Long exports no longer balloon in memory or slow to a crawl.** A 2-hour
  720p30 export was measured growing **+152 MB every 10 minutes** while its
  render rate decayed from ~130 fps to ~30 fps. The file it produced was
  always correct — this was throughput and memory, not corruption.
  The cause was a missing brake: chunks were handed to the file writer without
  ever waiting for the disk, so whatever the disk had not yet flushed stayed
  in memory. At the 720p30 default that is roughly the entire encoded video,
  about 16 MB per minute, and the resulting garbage-collector pressure is what
  dragged the frame rate down. The encoders now wait for the disk, so a slow
  drive slows the export instead of filling RAM.

### Changed

- **The MP4 writer moved to mediabunny**, which already produced the app's
  WebM files. The previous library was deprecated by its own author in favour
  of mediabunny, and shipping one maintained muxer instead of two removes a
  dependency. Exports are byte-identical in content; every codec was
  re-verified end to end (H.264, HEVC, AV1 in MP4 with AAC, plus VP9+alpha in
  WebM with Opus), along with frame counts, durations and PNG-sequence
  determinism.

### Note

- Exporting to a **file** streams to disk and stays flat. The in-browser
  preview export has nowhere to stream to and must hold the whole file in
  memory by definition, so it is only suitable for short clips — the desktop
  app always uses the streaming path.

## [2.49.1] - 2026-07-26

### Fixed

- **Dropping a project file onto the window opens it.** It reported "Could
  not decode ... (Unable to decode audio data)" instead: the drop handler
  recognised shaders, templates and lyrics, then handed everything else to the
  audio loader — so a `.avproj` was fed to the audio decoder. The bug had been
  there as long as the feature, but was unreachable until 2.49.0 made drops
  arrive at all on Windows.
- The drop overlay says "Drop to load" rather than "Drop to play", since audio
  is only one of the five things you can drop.

## [2.49.0] - 2026-07-25

The audit-remediation release. An independent five-part audit read every
surface of the app; this is everything it found, fixed and pinned by tests.

### Fixed

- **Drag and drop works again on Windows.** Dropping a file on the window did
  nothing in installed builds: Tauri intercepts the OS drop by default, and
  the app only ever listened for the browser-level event, so nothing reached
  it. The interception is now disabled and the drop path is live again for
  audio files, projects, themes, shaders and lyrics.
- **Visuals no longer drift out of time with the music.** Particles, Tunnel
  and Radial Burst multiplied elapsed track time by a speed that itself moved
  with the audio, so every loudness swing displaced the whole field by an
  amount that grew the longer the track ran — smooth at the start, stuttering
  and re-rolling minutes in. Audio now changes the motion without dragging the
  accumulated position with it.
- **Bass Circle particles no longer punch dark specks into your background.**
  Their twinkle went negative for part of each cycle, subtracting light
  instead of dimming.
- **Echo Trails no longer washes toward white.** With Echo hue drift on, the
  colour rotation was quietly adding brightness on every generation, so trails
  brightened as they aged instead of decaying.
- **Aurora keeps responding on loud passages** instead of flat-lining once the
  bass swell pushed it into a hard ceiling. Voice Orb no longer vanishes at
  high Wobble, Metaballs blobs stay in frame at high Orbit height, and
  Synthwave's sun can no longer be pushed entirely off-screen.
- **Corners can no longer go darker than black.** Radial Burst and Bass
  Circle's vignette could drive the image negative over a solid or image
  background.
- **The Builder chip in the mode strip is no longer a black square.**
- Tunnel's Hyperdrive style, and ~30 other factory style values across the
  library, sat on settings the sliders themselves could not reach — so the
  look changed the first time you touched the knob. All now land on the grid,
  with a test that keeps every future style honest.

### Changed

- **The app is honest when hardware rendering is unavailable.** On the
  simplified fallback renderer it now says so in a banner that stays put
  (instead of a notice that vanished after four seconds), and the features
  that renderer genuinely cannot do — post-processing, Motion masters, Builder
  Studio, the shader editor, scene transitions, video backgrounds — are
  disabled with the reason on hover, rather than silently accepting settings
  and discarding them. Video export and batch render are refused up front
  instead of failing after a save dialog and a full decode, and a batch run
  aborts once rather than failing every track in turn. Background images still
  honour fit, zoom and pan on this path.
- Typing an exact value on a slider now rounds half-steps the way the slider
  itself does (typing 35 on a percent row no longer read back 34).

### Security

- The ProRes/GIF/WebP encoder now refuses an output path that did not come
  from the save dialog. Previously any absolute path with the right extension
  was accepted and overwritten, and removed on failure.
- A wedged encoder can no longer hang the app forever at "Finishing": the
  finalize step is bounded, and cancelling during it genuinely stops ffmpeg
  instead of reporting success while the process lived on.
- An imported project or theme can no longer specify a font that silently
  breaks text rendering; font names are validated and fall back cleanly.

### Under the hood

- Live audio capture no longer allocates inside the realtime audio callback
  (a buffer pool replaces per-callback allocation), which removes a glitch
  risk on the live-input path.
- Fixed leaks: video-background decoding released nothing when a clip failed
  part-way, overlay bitmaps were dropped without being closed, and the Builder
  shader cache grew without bound for the whole session.
- The developer export/batch probes now go through the same code path the real
  export uses, instead of a hand-copied duplicate that had drifted — a
  Builder-mode probe could previously report success for an all-black video.
- 485 automated tests (up from 420), plus 24 on the Rust side.

## [2.48.1] - 2026-07-25

### Fixed

- **The spectrum was silently ignoring 61 of its frequency bins.** Each drawn
  band stopped one bin short of where the next began, so any bin holding a
  band boundary belonged to neither — a tone landing in one drew barely a
  third of its true height. Bands now tile the frequency axis exactly, and
  the value stays continuous as a band grows past one bin wide (it could
  jump between two different rules before). Introduced in 2.48.0.
- **Dragging the Low edge into the High edge no longer resets both.** Too
  narrow a span was thrown away wholesale, which also wiped whatever you had
  set on the other slider; it is now nudged to the closest valid span.
- **Background/centre-image pan no longer depends on zoom.** At 4x zoom a
  quarter-turn of the X slider threw the image a whole frame away, leaving
  most of the slider useless. Pan is now measured in frame widths at every
  zoom level, as documented.
- The lowest bar can no longer be lit permanently by a file's DC offset.

## [2.48.0] - 2026-07-25

### Added

- **Type an exact slider value.** Double-click any slider (or its number, or
  press Enter/F2 on it) and type the value you want. Enter commits, Escape
  cancels, and what you type is clamped and snapped exactly like dragging —
  so landing precisely on 0, or on 1.00, no longer depends on your mouse
  hand.
- **Fit and align images in the centre of a mode.** Bass Circle and Radial
  Burst can show cover art (or your own picture) in the middle, and it used
  to be squashed to fill the circle whenever the image wasn't square. There
  are now **Image fit** (Fill / Fit / Stretch), **Image zoom** and **Image
  X/Y** controls: Fill crops to the circle keeping the proportions, Fit shows
  the whole picture, and Stretch is the old distort-to-fill if you want it.
  Zoom and X/Y let you frame exactly the part you want.
- **Fit and align background images and videos** with the same Fill / Fit /
  Stretch, zoom and X/Y controls, instead of the fixed crop-to-fill.
- **Animate the post-processing chain.** Exposure, Bloom, Bloom threshold,
  Vignette, Chromatic and Film grain are now modulation targets, so the kick
  can drive the chromatic split or the bass can breathe the bloom. Pick them
  under "Post-processing" in the Modulation target list; they render
  identically in exports.
- **Set the analysed frequency range.** _Settings → Sync_ gained **Low edge**
  and **High edge**: the drawn bars are spaced geometrically across that
  span, so you can stop spending bars on sub-bass a track doesn't have, or
  give the musical range more of the width.

### Fixed

- **The bass end of the spectrum is no longer one wide flat block.** One FFT
  bin covers ~12 Hz, so every drawn band below ~40 Hz landed on the _same_
  bin and several neighbouring bars were handed one identical value. Bands
  narrower than a bin are now interpolated at their centre, so the low end
  follows the actual spectrum slope instead of stepping. Spectra render
  slightly differently at the very bottom as a result — this is the fix, not
  a regression.

## [2.47.1] - 2026-07-25

### Changed

- **The update dialog now shows the real release notes** — the full,
  human-written bullet list for every version between the one you're on
  and the one being offered, pulled straight from the changelog and
  rendered in the dialog (headings, bullets, bold). No more one-line
  blurb with a GitHub link: if you're four versions behind, you see all
  four "What's new in …" sections before deciding. Offline, the short
  summary still shows as a fallback.

## [2.47.0] - 2026-07-25

The gap-closing release: every visual mode brought up to the standard set
by Spectrum Bars, Radial Burst and Bass Circle — richer styles, deeper
controls, and beat-grid musicality — each in its own character.

### Changed

- **Oscilloscope** — trace peaks now soft-compress instead of flat-topping
  against a hard clamp; new Trace brightness control, graticule beat flash,
  and a Laser style (8 styles total).
- **Tunnel** — new Ice Cave style and a whole-wall beat flash stacked on the
  travelling beat rings (7 styles).
- **Synthwave** — Sun offset, Horizon height and Star density controls; new
  Chrome Dawn and Storm styles (9 styles). The one-line-per-beat grid
  scroll is untouched.
- **Particles** — Band color (bass/mid/treble tinting), Size variance and a
  grid-locked Beat brightness pop, all at zero added per-pixel cost; new
  Beat Dance / Warp / Rave / Deep Field / Embers styles.
- **Metaballs** — a true specular Gloss with adjustable Light angle, a
  grid-locked Beat squash (the lamp gulps on the beat), and blob count that
  rides the Detail master; Mercury / Toxic / Abyss / Binary styles.
- **Echo Trails** — per-generation Echo hue drift (energy-neutral, so the
  feedback stays stable), Ring shape (N-lobed star) with Beat bloom; new
  styles showcasing both.
- **Kaleido Nebula** — static Angle (aim the fold, independent of
  Motion→Rotation), Spin control, and a Depth layer for volume; re-curated
  to 7 styles (Stained Glass, Mandala, Oil Slick, Fractal Ice, …).
- **Aurora** — bass-swelled curtains, slow Drift, treble-crackled stars,
  and an optional true horizon Reflection; 7 styles from Polar Night to
  Pastel Dream.
- **Voice Orb** — surface Texture and a silence-only Breath glow; 7
  studio-oriented styles (Podcast Blue, Warm Studio, Hologram, …).
- **LED Matrix** — per-column Spectrum color (the RGB-wall look), phosphor
  Ghosting, CRT Scanlines, deterministic Flicker and a Beat flash border;
  7 hardware looks from Hi-Fi Classic to Amber Terminal.
- **Spectrum Scape** — 7 curated camera-and-palette styles (Night City,
  Sunrise Metropolis, Cyber District, Top Down, …) and wider Height /
  Distance / Glow ranges. Its 3D pipeline has a fixed parameter set, so the
  upgrade is curation rather than new sliders — no dead controls.
- **Particle Flow** — six new styles that actually explore the simulation's
  range (Galaxy, Swarm, Ink Drop, Solar Wind, Blizzard, Firehose).

Every upgraded mode was verified deterministic (double-export hash
identical) with a clean GPU validation log, and every new parameter obeys
the soft frame-limit and monotonic-rotation laws.

## [2.46.2] - 2026-07-25

### Added

- **Static Angle controls.** Radial Burst (main) and Bass Circle (Advanced)
  gain an **Angle** slider that aims the bar ring anywhere — and it works
  with Motion → Rotation at 0. Rotation used to be all-or-nothing: the
  motion master gated the per-mode rotation entirely, so there was no way
  to park the ring at a chosen orientation. Orientation is no longer
  motion.
- **Match cover colors in Radial Burst** — the same toggle Bass Circle has,
  driven by whichever image the core actually shows (cover art or a custom
  center image).

### Changed

- **Radial Burst's core got a rework.** The wobbling center read as random
  — calmer default edge waviness, a stronger beat kick, and a new pulsing
  rim (Advanced → Core rim) that swells with loudness and lands on the
  tempo grid, so the core reads as the beat anchor with or without cover
  art. The art itself now maps to the wobble's maximum reach, fixing the
  ring of smeared edge color that appeared at high Wobble.

### Fixed

- The Background mode picker (Animated / Solid / Transparent / Image /
  Video) wraps onto a second row on narrow panels instead of cutting
  labels off at both edges.

## [2.46.1] - 2026-07-25

Every finding from the independent v3-readiness audit that could be fixed
without a design decision, fixed and verified — including two Critical
determinism repairs.

### Fixed

- **Per-mode backgrounds now render in the live preview** (they already
  rendered in exports). The render loop re-applied the global background
  every frame, silently overwriting the override within ~16 ms — the
  flagship v2.46.0 feature looked broken on screen while exporting
  correctly. Live and export now resolve backgrounds through the same
  rule, pinned by a live-vs-export parity test.
- **Long tracks (>90 min) analyze identically in preview and export.**
  The fallback decoder kept the file's native sample rate while the live
  path analyzes at the audio device's rate — on the common 44.1-vs-48 kHz
  mismatch, every exported frequency bin sat ~8% off its live position.
  The fallback now resamples once, exactly like the normal path; chunk
  seams also no longer risk one-sample clicks.
- **Opening a project no longer overwrites your newer custom shaders.**
  A project embedding an older copy of a shader you've since edited used
  to silently revert and persist it, with no undo. Your library version
  now wins on content divergence, with a notice.
- **The update dialog** traps focus, closes on Esc, and shows a proper
  error screen with Retry if an install fails (it used to just vanish);
  double-clicking Install can no longer double-run an install.
- **Beats on high-refresh displays**: the onset threshold now scales with
  frame time, so a 144 Hz preview fires the same beats a 60 fps export
  renders. 60 fps behavior is bit-identical.
- **Batch "Match cover colors"** now re-matches per track — previously
  every batched video wore the first track's colors.
- Voice Orb joins the v2.44 soft frame-limit family (no more hard
  circular clip at max size); film-grain dither no longer degrades hours
  into a long track; GIF export caps at ~3 minutes with a clear message
  instead of exhausting memory; a wedged ffmpeg finalize can no longer
  deadlock the export abort; toggling a per-mode background off frees its
  embedded image/video; the mode strip's edge fades (shipped inert in
  v2.46.0) actually appear; panels no longer fade out while you read
  them; the guide's aspect-ratio list matches the app; plus a dozen
  smaller correctness, a11y and docs repairs.

### Deferred from the audit (need design decisions or hardware sessions)

- 2-hour export memory streaming (A2), decode cancellation (A3),
  fs-scope binding of sidecar output paths (E1), slider-drag render
  batching (U2).

## [2.46.0] - 2026-07-24

### Added

- **Per-mode backgrounds.** The Background section (Scene tab) gains a
  scope switch: **All modes** (the shared background, as before) or
  **This mode** — give any visual mode its own background, including a
  custom image or looping video. Spectrum Bars can sit on your video loop
  while Bass Circle keeps its animated backdrop. Overrides live in the
  project file (schema v11), survive restarts, and exports resolve them
  exactly like the preview.
- **Custom center images.** Modes that draw artwork in their center
  (Bass Circle, Radial Burst) get a **Center image** row: choose any
  image to replace the track's embedded cover art, per mode. "Match
  cover colors" matches whichever image is actually displayed. One click
  returns to the track's cover.
- **In-app user guide.** Press H → **User guide…**: a twelve-section,
  human-written walkthrough of everything Beatform does — from first
  track to Builder stacks, timelines, live performance and every export
  format. No internet needed; it ships inside the app.

### Changed

- **The update dialog got a real design.** Accent hero band, a version
  transition (current → new), properly formatted release notes
  (headings, bullets, bold), a real progress bar with percent and MB,
  and a one-click restart — replacing the plain text box from v2.45.0.

### Fixed

- **UI polish pass across every mode and window size.** Sliders no
  longer push their value readout past the panel edge on narrow panels
  (worst in the Advanced drawer); the mode strip on narrow windows now
  fades at the edges when more modes are hidden, scrolls with the mouse
  wheel, and always auto-scrolls the active mode into view; and hovering
  a setting with a long hint no longer makes the whole panel jump — the
  hint footer keeps a fixed two-line height (the full text stays in the
  tooltip).
- Replacing a background image/video or a center image now garbage-
  collects the old embedded asset only when nothing else (an overlay,
  another mode's background, a center image) still uses it.

## [2.45.2] - 2026-07-24

### Changed

- **Layout-proof keyboard shortcuts.** Every shortcut now has a letter or
  digit as its primary key — the only keys whose printed label sits in the
  same place on every major layout (QWERTY, QWERTZ, AZERTY, …):
  **P / N** previous/next mode, **S** Stage mode, **0** blackout (the digit
  row now reads: 1–9 pick a mode, 0 cuts to black), **H** shortcut list.
  The old symbol bindings (`[` `]` `\` `.` `?`) still work as secondaries
  for muscle memory. Tooltips, the shortcut overlay and the docs all name
  the letter keys now.

## [2.45.1] - 2026-07-24

### Added

- **Radial Burst: cover art in the core.** The track's embedded cover now
  fills the breathing center disc (same as Bass Circle's circle) — on by
  default when the track has art, with a **Cover art** toggle plus
  **Cover blend** and **Cover brightness** in Advanced. The wobbling core
  edge crops the art organically; loudness and beats lift its brightness.
  Tracks without embedded art keep the classic plain core.
- **Bass Circle: Match cover colors.** A new toggle that analyzes the
  cover art's dominant color and sets **Hue** and **Hue spread** to fit —
  immediately when switched on, and again automatically whenever a track
  with cover art loads. Near-grayscale covers are ignored (your colors
  stay). The analysis writes plain slider values into the project, so
  exports match the preview exactly and one Ctrl+Z restores the previous
  colors.

## [2.45.0] - 2026-07-24

### Added

- **Update prompt on startup.** When the automatic check (on by default,
  Settings → Updates) finds a newer release shortly after launch, a dialog
  now offers it directly: version, release notes, **Install now** / Later.
  Install shows download progress and then offers a one-click restart.
  Previously the result of the startup check was only visible if you dug
  into Settings → Updates yourself. Manual checks still report inline in
  the Settings dialog, and "Later" only dismisses until the next launch.
- **App settings gear in the top bar.** App-level preferences (autosave,
  performance, updates) were reachable only via Ctrl+, or a small button
  inside the shortcuts overlay. There is now a gear icon in the top bar,
  next to the visual-settings sliders icon.

- **Spectrum shape controls** (Settings → Sync, in every mode that draws the
  spectrum): three new sliders that shape the drawn bars themselves, beyond
  the existing spline that only rounds corners between still-spiky values.
  - **Merge** — Monstercat-style neighbor falloff: every bar props up its
    neighbors with an exponential decay, melting isolated spikes into one
    connected silhouette.
  - **Rounding** — kernel average across neighboring bars: real smoothing
    that removes hard spikes and lows instead of merely curving between them.
  - **Contrast** — below 50% flattens the spectrum toward fuller, calmer
    bars; above 50% exaggerates peaks against valleys. 50% is exactly the
    previous look.

  All three are saved per mode in the project file, applied before the
  attack/release envelope so the sync feel is untouched, and rendered
  identically in preview and export. Defaults are neutral — existing
  projects look byte-for-byte the same.

## [2.44.3] - 2026-07-24

### Fixed

- **Radial Burst no longer looks like it rotates backwards.** A beat kick
  added a rotation offset that decayed after every hit, so the whole burst
  visibly slid back as each pulse faded — reported as "rotation jumping back
  and forth" across many versions. Rotation is now purely time-driven
  (monotonic); the beat still hits through ring breathe, core pump and glow.

### Added

- **Project ▸ New project** — one click resets the document to clean
  defaults (timeline off, overlays/assets cleared, params/post/motion/lyric
  style/audiogram/Builder stack default). Undoable with a single Ctrl+Z.
  Loaded track, volume and app preferences are untouched. Useful whenever a
  loaded project or test session leaves the app in a state you don't want.

## [2.44.2] - 2026-07-24

### Fixed

- **Tracks longer than ~90 minutes load again.** Chromium's audio decoder
  has an undocumented ceiling (a 90-minute file decodes, a 2-hour one is
  rejected outright — bisected on this engine). Long tracks now fall back to
  an incremental decoder, so 2-hour mixes load, play and export. Decoding a
  2-hour file takes a couple of minutes; the app is not hung.
- The friendly unsupported-video-codec message really ships this time — it
  had been written for v2.44.1 but was lost in the edit that produced that
  build (the acceptance run caught it: "Assertion failed" was still showing).

## [2.44.1] - 2026-07-23

Fixes for everything the first full hardware test found (thank you,
checklist). All three were real bugs that only manifest in installed builds.

### Fixed

- **Live input (loopback) works in installed builds.** The audio worklet
  loaded from a `blob:` URL, which the app's own Content-Security-Policy
  correctly blocks — development builds carry no CSP, so it always worked
  there and never on a real install. The worklet now ships as a bundled
  asset.
- **Crash recovery actually works now.** The autosave file had never been
  written: the filesystem permission set granted read but not write scope
  for the app-data folder, and the failure only ever reached the console.
  The scope is granted, and any future autosave failure surfaces as a
  visible error instead of silently disabling recovery.
- **Keyboard shortcuts on QWERTZ (and other non-US layouts).** AltGr chords
  (how QWERTZ types `[ ] \`) are no longer misread as shortcuts; the
  previous/next-mode and Stage-mode keys bind to physical key positions so
  they sit on the same keys on every layout; and Esc is now handled before
  every other rule, so it always exits Stage mode and blackout — even with
  a dropdown focused.
- Unsupported video-background codecs (e.g. old MPEG-4 files) report a
  readable message naming the problem instead of "Assertion failed".
- The MP4 help text no longer implies HEVC is always available — the codec
  picker only ever offers what your hardware can encode.

## [2.44.0] - 2026-07-23

### Fixed

- **No more hard circular edges at extreme settings** (reported live on Bass
  Circle and Radial Burst). Frame safety is now soft and frame-shaped: maxed
  geometry compresses smoothly toward the actual frame border instead of
  clipping at a fixed circle, engine-wide (Radial Burst, Bass Circle, Voice
  Orb, Metaballs, Echo Trails, all Builder layers). Radial elements now reach
  further sideways than vertically on wide frames — like the frame itself.
  Several size/reach sliders gained wider ranges now that extremes are safe,
  and the rule is codified in the preset-authoring docs.

### Changed

- **One Builder.** The strip shows a single Builder (the layer compositor);
  the classic Builder is retired from the strip but old projects and scenes
  that use it keep rendering exactly as before.

## [2.43.0] - 2026-07-23

The polish release — the audit's last open finding closed, and the docs
caught up with everything the last five releases shipped.

### Fixed

- **Cancelled batch runs can resume.** Cancelling used to strand every
  not-yet-run job as "queued" with no way back; the panel now offers
  "Resume N queued" (and "Retry failed + resume queued" together).

### Changed

- Guide, README and the manual test checklist now cover Builder Studio, the
  app-settings page, the tabbed panel and the auto-updater.

## [2.42.0] - 2026-07-23

### Added

- **Builder Studio** — a real layer compositor, replacing the fixed-toggle
  Builder concept. Stack up to twelve layers from nine types (background
  wash, particles, spectrum bars, radial ring, pulse rings, waveform circle,
  orb, wave line, vignette), each with its own enable, opacity, blend mode
  (Normal / Add / Screen), color (hue + spread) and parameters. Duplicate,
  reorder and mute layers freely; the same type can appear as many times as
  you like.
- **Share stacks as `.avbuilder` files** (export/import), and stacks save
  inside your project file (schema v10) — a project renders identically on
  any machine.
- The classic Builder mode is unchanged — existing projects render exactly
  as before.

### Under the hood

- Layer parameters live in a GPU storage buffer, so a deep stack never hits
  the parameter ceiling and every slider drag is a buffer write — structural
  edits (add/remove/reorder/blend) compile once per stack shape and are
  cached.

## [2.41.0] - 2026-07-23

The settings release — the two UI structures the app had outgrown, rebuilt.

### Added

- **App settings page (Ctrl+,).** App-level preferences finally have a home,
  separate from the per-visual panel: autosave delay, remembered save folder,
  a live-preview frame cap (30/60/display — exports always render every
  frame), a GPU preference for dual-GPU machines, and the updater controls
  (moved from Help) with an auto-check toggle.
- **The settings panel grew up.** Five tabs (Visual / Sync / Scene / Text /
  Live) instead of one 13-section scroll, every section collapsible (both
  remembered), and a search box that finds any setting across all tabs by
  name — with ~300 parameters in the app, "type bloom" beats scrolling.

### Changed

- Small app preferences consolidated into one validated store
  (`beatform.prefs.v1`) with automatic migration; heavy per-project caches
  intentionally stay separate.

## [2.40.0] - 2026-07-22

The foundation release: a consolidation pass the codebase had earned after
seventy feature releases. Little changes visually — everything underneath got
simpler, and one long-standing paper cut is gone.

### Added

- **The settings/library panel is resizable.** Drag its left edge (240-440 px);
  the width persists. The fixed narrow column was a root cause of the settings
  UI feeling cramped — the full panel overhaul builds on this next.

### Changed

- App shell split up: the Export dialog, the global keyboard map and the dev
  probes are their own modules; the 2,900-line state store is now a core plus
  eleven per-domain slices; every settings surface shares one control kit
  (single toggle/slider/segmented idiom — behavior identical).
- Chrome layout offsets derive from CSS variables instead of hand-computed
  pixel chains (the class of bug where an open timeline buried other panels).
- Component-level UI tests now run alongside the unit suite.

## [2.39.0] - 2026-07-22

### Added

- **The app updates itself.** Beatform checks GitHub Releases shortly after
  launch (and on demand from **Help ▸ Check for updates**), downloads the new
  installer with progress, verifies its cryptographic signature against a key
  built into the app, installs, and offers a one-click restart. No telemetry —
  the check is a plain fetch of a static file on GitHub, and it fails silently
  when offline.
- MSI installs are outside the auto-update path (it uses the NSIS installer);
  new MSIs stay available on the releases page.

### Changed

- Release hygiene: versions are stamped by `scripts/bump-version.mjs` across
  all five version-carrying files with a `--verify` mode; SECURITY.md now
  documents update integrity and the key-rotation policy.

## [2.38.0] - 2026-07-22

Correctness & performance closeout — the audit backlog is now empty.

### Added

- **Projects carry everything they render (schema v9).** Lyric style,
  audiogram settings and any custom WGSL visual the project references now
  travel inside the `.avproj`, so a project opened on another machine renders
  identically — including custom visuals nobody imported separately. Older
  files load unchanged; lyric/audiogram edits join the undo history; deleting
  a custom visual and undoing restores it.
- **Export settings persist** across launches, and every save dialog opens in
  the folder you last saved to.

### Fixed

- **Disk-full stops an export immediately** with the real error — previously
  a full disk at minute 5 of a 60-minute export silently rendered the
  remaining 55 minutes into nothing.

### Performance

- The default render path (neutral post chain) skips the whole post graph —
  no full-res HDR intermediate, no extra fullscreen pass per frame.
- Crossfade/feedback/particle/3D render targets are released after ~5 s of
  disuse instead of being retained all session (~330 MB back at 4K).
- The audio and video encoder lanes interleave (audio no longer buffers
  ahead of frame one), and ProRes audio stages in 8 MB chunks — long-export
  memory is genuinely flat.

## [2.37.2] - 2026-07-22

### Performance

- **Particles runs far cheaper in both modes.** It draws a grid of particles at
  every pixel, and that per-pixel work had grown well past what an integrated
  GPU can hold at a smooth frame rate — playback stuttered and felt delayed.
  The background wash, the drifting current and the per-particle motion are all
  computed a cheaper way now, and **Fly mode** (Warp, Rave) halves the depth
  shells it walks. Measured against Tunnel as the reference, Fly went from
  roughly 3.6x Tunnel's cost to about 1.25x — the same cost as the drifting
  mode. Both modes look the same as before: still free-floating individual
  particles, still a deep streaking starfield.

## [2.37.1] - 2026-07-22

A hardening patch from re-auditing the full report against the current code —
correctness, security, accessibility and supply-chain fixes. No visual changes.

### Security

- **Library folder scanning is now scope-gated.** `scan_audio_library` walked
  any path it was handed and returned file paths and tags; it now honours the
  filesystem scope, so only a folder you actually picked can be scanned.

### Fixed

- The in-app version (Help modal, and the stamp in every saved project/preset/
  theme) was stuck ten releases stale; it is now correct and pinned by a test so
  it can't silently drift again.
- A background **mode** switch made right after a colour drag no longer collapses
  into a single undo — mode changes undo on their own.
- Switching backgrounds no longer leaks the previous image/video asset into the
  saved project when both were set.
- The Motion controls a preset exposes are now decided from its real shader code,
  not text that might only appear in a comment.
- "Simplified rendering" (the Canvas2D fallback) is now an auto-clearing notice
  instead of a red error that sat on screen the whole session.

### Accessibility

- Tabbing with the keyboard during playback no longer lands on hidden, unreachable
  controls — focused chrome reveals itself and re-arms the idle timer.

### Build

- CI Actions are pinned to commit SHAs and Dependabot keeps them (plus npm and
  Cargo dependencies) current.

## [2.37.0] - 2026-07-22

The visuals pass, part two — three modes reworked from the ground up, plus two
audit fixes.

### Changed

- **Tunnel** is a real tube you fly down, not a zoomed disc. Rings rush past in
  depth and longitudinal flutes converge at a dark vanishing point with a hot
  core; a corkscrew twist reads as a waterslide, and the wall is shaded like a
  round pipe. (Added: corkscrew, roundness and surface-texture controls.)
- **Particles** are real particles floating in space now, not a flat field
  warped to the music. Each one has its own depth, frequency band, twinkle and
  drift, floating freely on its own organic path. **Fly mode** is a true
  perspective starfield — stars stream from far away, grow and streak past you.
- **Particle Flow** now reacts to the music: a bass pump and a beat flash on
  brightness, and a velocity kick that scatters the field on beats, while the
  smooth curl flow is preserved.

### Fixed

- Feedback presets are detected by an actual call to the ABI helper, not any
  mention of it — a preset that only referenced it in a comment no longer pays
  for an unused extra render pass.

### Docs

- `THIRD_PARTY_LICENSES.md` now documents the statically-linked Rust crates.

## [2.36.1] - 2026-07-22

### Changed

- The mode selector no longer wraps each preview in an oval pill. Thumbnails
  are now clean framed previews with the label beneath; the selected mode is
  shown by an accent ring on its thumbnail instead of a filled pill.

## [2.36.0] - 2026-07-21

The visuals release. Every one of the 16 modes was reworked to a single quality
bar, and a regression that had blanked the live preview is fixed.

### Fixed

- **The live preview is no longer black.** Track playback was wired to the
  volume node instead of the analysis tap, so the analysers heard digital
  silence while audio still played — and since every visual is audio-driven,
  the whole canvas went dark except the background. Exports were never
  affected (they analyse the file directly), which is why it slipped a release.
  A graph-shape test now guards it.

### Changed

- **All 16 visual modes rebuilt to match Spectrum Bars and Bass Circle.** A
  shared "look kit" (saturated cosine palettes instead of muddy HSL hue drift,
  domain-warped noise, ACES tone mapping, dithering, vignette) now backs every
  mode. Highlights:
  - **Tunnel** — was a flat olive dartboard, now a real perspective tunnel
    receding to a hot vanishing point.
  - **Particles** — was flat uniform static, now a curl-noise flow field with
    depth, motion streaks and hot cores.
  - **Kaleido Nebula** — was muddy olive fog, now a saturated violet filament
    mandala over true black.
  - **Synthwave** — the horizon grid was nearly empty, now a dense converging
    perspective grid with a glowing sun.
  - **Oscilloscope** — gained a hot beam core, CRT phosphor persistence and a
    lab graticule. **LED Matrix** — per-dot bloom and panel texture.
    **Metaballs, Aurora, Echo Trails, Voice Orb, Spectrum Scape** — depth,
    hot cores and per-element motion.
- **Club mirror everywhere it fits.** The kaleidoscope/mirror fold Spectrum
  Bars had is now a param on the modes where it makes visual sense.

### Notes

- Existing `.avproj` projects keep every setting; only new optional params were
  added. Non-default named styles may render a slightly different (still
  saturated) colour than the old HSL maths gave them — a cosmetic follow-up.

## [2.35.0] - 2026-07-21

A hardening release: the whole render/export/state stack, CI, and the docs
were worked through against a full internal code audit. Nothing here changes
how you use Beatform, but a lot of it changes whether Beatform does the right
thing when something goes wrong.

### Added

- **Crash recovery.** The autosave has been written every 5 s for a long time
  and nothing ever read it back. It does now: if Beatform is killed with
  unsaved work, the next launch offers to restore it. A clean quit shows
  nothing.
- Media size limits on background images (32 MB) and video (192 MB), with an
  error that names the file's real size, instead of a renderer OOM.
- Repository documentation a public project should have: CHANGELOG, SECURITY,
  CODE_OF_CONDUCT, CODEOWNERS, and a PR template.

### Fixed

- **Exports no longer start beat-blind.** The first ~0.2 s of every export had
  no beat, kick, snare or hat, because the detector warmup counted from when
  the analyzer was built rather than from the track. The preview, warm for
  minutes, fired them at the same moment — a straight preview/export mismatch
  at the most visible point in the video.
- **Crossfades into and out of feedback presets** (Echo Trails) no longer pop.
  The outgoing preset's trail was being wiped at the exact instant the fade
  began, while it was still fully visible.
- **A wedged ProRes/GIF/WebP export can be cancelled.** A blocked frame write
  held the same lock cancel needed, so a stalled encoder was unkillable.
  Finishing a long export no longer freezes the window either.
- Feedback trails and the particle simulation are frame-rate independent, so a
  30 fps export matches a 60 fps preview instead of drifting.
- Losing the system-audio device no longer bricks loopback until restart — it
  reconnects on the next start instead of answering "already running" forever.
- Overlay rendering stopped churning a full-resolution GPU texture every frame
  during lyric fades (measured: 49,884 texture creations and 47 GPU validation
  errors over one fade, now zero of each).
- A GPU device loss during startup is no longer silently dropped.
- Export/batch robustness: a killed export worker fails instead of hanging
  forever; Cancel and Skip interrupt a track while it is still decoding;
  cancelling a batch no longer strands the untouched jobs as unreachable.
- Video backgrounds, custom presets edited inside timeline scenes, undo/redo
  grouping, and keyframe editing all had correctness bugs; all fixed.
- Accessibility: focus traps in dialogs, keyboard-reachable setting hints,
  labels on icon-only buttons, and a described canvas.

### Changed

- Project schema is now version 8, distinguishing files saved with video
  backgrounds. Older projects still open unchanged.
- The release workflow runs the same gates as CI. Running a smaller set is how
  two releases previously shipped from a failing main.
- The UI no longer re-renders the whole tree several times a second alongside
  the render loop.
- Startup bundle split: the main chunk dropped from 1,059 kB to 381 kB.

### Security

- Temp files are created in a way that cannot be redirected through a planted
  symlink.
- Removed an unused plugin whose permission expansion would have granted a
  URL-open primitive.

## [2.34.1] - 2026-07-20

### Fixed

- Hard circular edge on Radial Burst / Voice Orb — removed a full-field edge
  fade that carved a visible circle.

## [2.34.0] - 2026-07-19

### Added

- Karaoke-style word-wipe animation for timed lyrics.

## [2.33.0] - 2026-07-19

### Added

- Stage mode (`\`): chrome-free full-bleed output with a blackout toggle and
  a mode-name HUD, for live performance.

## [2.32.0] - 2026-07-19

### Added

- Web MIDI control — map CC messages to any parameter and notes to mode
  switches (local, no drivers).

## [2.31.0] - 2026-07-19

### Added

- Video background blur.
- Lyric entry animations.

### Changed

- Accessibility closeout pass (loop-button labeling, modal close-button
  labels).

## [2.30.0] - 2026-07-18

### Added

- Beat-quantized hotkey preset switching — a mode switch lands on the next
  beat/bar instead of taking effect instantly.

## [2.29.1] - 2026-07-18

### Changed

- Timeline keyframes are keyboard-operable.
- Preset strip is memoized.
- Theme colors moved to CSS variables.

## [2.29.0] - 2026-07-18

### Added

- Per-mode "master" control gating and unified controls.
- Keyboard accessibility pass on settings controls.

### Fixed

- Nine dead, redundant, or miscalibrated preset parameters recalibrated.

### Changed

- Reduced hot-path allocations; debounced settings persistence.

## [2.28.3] - 2026-07-18

### Fixed

- Spectrum display dynamics expanded so bars spike instead of bunching
  together.

## [2.28.2] - 2026-07-18

### Fixed

- Audit-fix pass: frame safety, export segment fidelity, ffmpeg sidecar
  cleanup.

## [2.28.1] - 2026-07-17

### Fixed

- Spectrum headroom and frame-safe geometry for Voice Orb and Bass Circle.

## [2.28.0] - 2026-07-17

### Added

- Looped video backgrounds (desktop) — decoded deterministically by track
  time so exports match the preview.

## [2.27.0] - 2026-07-17

### Added

- Scene transition library for the timeline.

## [2.26.0] - 2026-07-17

### Added

- Audiogram overlay elements, via a unified dynamic-overlay compositor.
- Auto-arrange timeline scenes from detected song sections.
- One-click stem auto-routing to the active visual.

## [2.25.0] - 2026-07-17

### Added

- Timed lyric overlays from `.lrc` / `.srt` files.

## [2.24.0] - 2026-07-17

### Added

- GIF and animated WebP loop export via the bundled ffmpeg sidecar.

### Fixed

- Eight defects from a pre-v3.0 adversarial audit, plus fifteen more from a
  second wave covering the remaining surfaces.

## [2.23.0] - 2026-07-16

### Added

- Transparent WebM export (VP9 + real alpha channel) via mediabunny.

## [2.22.0] - 2026-07-16

### Added

- In-app WGSL shader editor — write and preview your own visual, no build
  tools required.

## [2.21.0] - 2026-07-16

### Added

- Import stems as modulation sources.

## [2.20.0] - 2026-07-16

### Added

- Live-rendered preset thumbnails in the mode strip.

## [2.19.0] - 2026-07-16

### Added

- Image backgrounds — artwork behind the visualization (project schema v7).

## [2.18.0] - 2026-07-16

### Changed

- Rebranded the project to **Beatform**.

### Added

- Public documentation site (GitHub Pages): user guide, preset SDK, template
  spec.

## [2.17.0] - 2026-07-16

### Added

- `.avtheme` templates — shareable looks, factory packs, drag-to-import.

## [2.16.0] - 2026-07-16

### Added

- ProRes 4444 export with alpha via a bundled ffmpeg sidecar (desktop).

## [2.15.0] - 2026-07-16

### Added

- "Listen to the system" — visualize system audio via WASAPI loopback
  (desktop), analysis-only.

## [2.14.0] - 2026-07-16

### Added

- Music library sidebar: folder scan, real tags via lofty, near-gapless
  auto-advance.

## [2.13.0] - 2026-07-15

### Added

- HEVC and AV1 export via a WebCodecs hardware-capability probe.

## [2.12.0] - 2026-07-15

### Fixed

- Beats now land on the audible transient in every sync path.
- Twenty defects from an adversarial audit of the state/render/UI layers.

### Added

- Tempo-grid sync in every visual mode, additional factory style libraries,
  Builder pulse rings.

## [2.11.2] - 2026-07-15

### Fixed

- Bass Circle album art was rendering upside down.

## [2.11.1] - 2026-07-14

### Fixed

- Fourteen defects found by adversarially reviewing the 2.11.0 batch-render
  feature.

## [2.11.0] - 2026-07-14

### Added

- Batch render: drop in a folder of tracks, get one titled video per track,
  unattended — titles read from each file's own ID3 tags.

## [2.10.1] - 2026-07-14

### Fixed

- Export failures were being silently swallowed instead of surfaced.

## [2.10.0] - 2026-07-14

### Added

- App logo and icon set.
- LUFS-normalized export audio with a look-ahead true-peak limiter.

## [2.9.0] - 2026-07-14

### Added

- PNG image-sequence export with alpha.

## [2.8.0] - 2026-07-14

### Added

- Album art in Bass Circle via a cover-art texture in the preset ABI.
- Global "Spectrum smooth" motion master.

## [2.7.0] - 2026-07-14

### Added

- Bass Circle preset — trap-nation-style circular visualizer.

## [2.6.1] - 2026-07-14

### Added

- Independent Attack/Release smoothing for sync sources.

## [2.6.0] - 2026-07-14

### Added

- Global Rotation / Pulse / Detail motion masters across all visual modes.

## [2.5.1] - 2026-07-14

### Fixed

- Aurora seam artifact; sync reactivity on newer modes.

### Added

- Richer controls for the newer render modes.

## [2.5.0] - 2026-07-14

### Added

- "Visual Ceiling": HDR post-processing stack, feedback/trails buffer (Echo
  Trails preset), GPU compute-particle system (Particle Flow), a 3D render
  pass (Spectrum Scape), and the Aurora and Synthwave presets.

## [2.0.2] - 2026-07-14

### Fixed

- Export hang, crossfade ordering, fps/beat-grid mismatch, mono LUFS
  computation.

## [2.0.1] - 2026-07-14

### Fixed

- WYSIWYG/state bugs from the v2.0 review: a shared per-frame resolver, the
  export worker/inline fallback, timeline drag correctness, cached-settings
  validation.

## [2.0.0] - 2026-07-13

### Added

- "Workstation": timeline with scenes, crossfade transitions, keyframe
  automation lanes, undo/redo, autosave.

## [1.7.0] - 2026-07-13

### Added

- Musical sync: beat-grid tempo tracking, kick/snare/hat onset classes,
  musical key detection, section-boundary markers, modulation matrix.

## [1.5.0] - 2026-07-13

### Added

- Overlay layers (text / logo / album art), multi-aspect frames, Spotify
  Canvas seamless-loop export, stereo-width feature, BS.1770 LUFS metering.

## [1.3.0] - 2026-07-13

### Added

- Foundations: zustand state store, `.avproj` project files, `.avpreset`
  user looks, worker-based export pipeline with streaming-to-disk, tests and
  CI.

## [1.2.0] - 2026-07-13

### Added

- Sync-source system — choose what the visuals react to.

## [1.1.0] - 2026-07-13

### Changed

- Starfield rewritten as the Particles preset ("Fly" mode).

## [1.0.0] - 2026-07-13

### Fixed

- Verification hardening pass across the v0.9.0 surface.

## [0.9.0] - 2026-07-12

Initial public release.

### Added

- Tauri + WebGPU audio visualizer scaffold with an initial visual preset
  library, including Voice Orb and Builder mode.
- Deterministic offline MP4 export.
- Advanced settings (every internal preset constant tunable).
- Onboarding UI, keyboard shortcuts, auto-hiding chrome.
- Three synthesized demo tracks.

[Unreleased]: https://github.com/0langa/beatform/compare/v2.104.2...HEAD
[2.104.2]: https://github.com/0langa/beatform/compare/v2.104.1...v2.104.2
[2.104.1]: https://github.com/0langa/beatform/compare/v2.104.0...v2.104.1
[2.104.0]: https://github.com/0langa/beatform/compare/v2.103.0...v2.104.0
[2.103.0]: https://github.com/0langa/beatform/compare/v2.102.0...v2.103.0
[2.102.0]: https://github.com/0langa/beatform/compare/v2.101.0...v2.102.0
[2.101.0]: https://github.com/0langa/beatform/compare/v2.100.0...v2.101.0
[2.100.0]: https://github.com/0langa/beatform/compare/v2.99.0...v2.100.0
[2.99.0]: https://github.com/0langa/beatform/compare/v2.98.0...v2.99.0
[2.98.0]: https://github.com/0langa/beatform/compare/v2.97.1...v2.98.0
[2.97.1]: https://github.com/0langa/beatform/compare/v2.97.0...v2.97.1
[2.97.0]: https://github.com/0langa/beatform/compare/v2.96.0...v2.97.0
[2.96.0]: https://github.com/0langa/beatform/compare/v2.95.0...v2.96.0
[2.95.0]: https://github.com/0langa/beatform/compare/v2.94.0...v2.95.0
[2.94.0]: https://github.com/0langa/beatform/compare/v2.93.0...v2.94.0
[2.93.0]: https://github.com/0langa/beatform/compare/v2.92.1...v2.93.0
[2.92.1]: https://github.com/0langa/beatform/compare/v2.92.0...v2.92.1
[2.92.0]: https://github.com/0langa/beatform/compare/v2.91.0...v2.92.0
[2.91.0]: https://github.com/0langa/beatform/compare/v2.90.0...v2.91.0
[2.90.0]: https://github.com/0langa/beatform/compare/v2.89.0...v2.90.0
[2.89.0]: https://github.com/0langa/beatform/compare/v2.88.0...v2.89.0
[2.88.0]: https://github.com/0langa/beatform/compare/v2.87.0...v2.88.0
[2.87.0]: https://github.com/0langa/beatform/compare/v2.86.0...v2.87.0
[2.86.0]: https://github.com/0langa/beatform/compare/v2.85.0...v2.86.0
[2.85.0]: https://github.com/0langa/beatform/compare/v2.84.0...v2.85.0
[2.84.0]: https://github.com/0langa/beatform/compare/v2.83.0...v2.84.0
[2.83.0]: https://github.com/0langa/beatform/compare/v2.82.0...v2.83.0
[2.82.0]: https://github.com/0langa/beatform/compare/v2.81.0...v2.82.0
[2.81.0]: https://github.com/0langa/beatform/compare/v2.80.0...v2.81.0
[2.80.0]: https://github.com/0langa/beatform/compare/v2.79.0...v2.80.0
[2.79.0]: https://github.com/0langa/beatform/compare/v2.78.0...v2.79.0
[2.78.0]: https://github.com/0langa/beatform/compare/v2.77.0...v2.78.0
[2.77.0]: https://github.com/0langa/beatform/compare/v2.76.0...v2.77.0
[2.76.0]: https://github.com/0langa/beatform/compare/v2.75.0...v2.76.0
[2.75.0]: https://github.com/0langa/beatform/compare/v2.74.0...v2.75.0
[2.74.0]: https://github.com/0langa/beatform/compare/v2.73.0...v2.74.0
[2.73.0]: https://github.com/0langa/beatform/compare/v2.72.1...v2.73.0
[2.72.1]: https://github.com/0langa/beatform/compare/v2.72.0...v2.72.1
[2.72.0]: https://github.com/0langa/beatform/compare/v2.71.0...v2.72.0
[2.71.0]: https://github.com/0langa/beatform/compare/v2.70.0...v2.71.0
[2.70.0]: https://github.com/0langa/beatform/compare/v2.69.0...v2.70.0
[2.69.0]: https://github.com/0langa/beatform/compare/v2.68.1...v2.69.0
[2.68.1]: https://github.com/0langa/beatform/compare/v2.68.0...v2.68.1
[2.68.0]: https://github.com/0langa/beatform/compare/v2.67.0...v2.68.0
[2.67.0]: https://github.com/0langa/beatform/compare/v2.66.0...v2.67.0
[2.66.0]: https://github.com/0langa/beatform/compare/v2.65.0...v2.66.0
[2.65.0]: https://github.com/0langa/beatform/compare/v2.64.1...v2.65.0
[2.64.1]: https://github.com/0langa/beatform/compare/v2.64.0...v2.64.1
[2.64.0]: https://github.com/0langa/beatform/compare/v2.63.0...v2.64.0
[2.63.0]: https://github.com/0langa/beatform/compare/v2.62.0...v2.63.0
[2.62.0]: https://github.com/0langa/beatform/compare/v2.61.0...v2.62.0
[2.61.0]: https://github.com/0langa/beatform/compare/v2.60.1...v2.61.0
[2.60.1]: https://github.com/0langa/beatform/compare/v2.60.0...v2.60.1
[2.60.0]: https://github.com/0langa/beatform/compare/v2.59.0...v2.60.0
[2.59.0]: https://github.com/0langa/beatform/compare/v2.58.0...v2.59.0
[2.58.0]: https://github.com/0langa/beatform/compare/v2.57.0...v2.58.0
[2.57.0]: https://github.com/0langa/beatform/compare/v2.56.0...v2.57.0
[2.56.0]: https://github.com/0langa/beatform/compare/v2.55.0...v2.56.0
[2.55.0]: https://github.com/0langa/beatform/compare/v2.54.0...v2.55.0
[2.54.0]: https://github.com/0langa/beatform/compare/v2.53.0...v2.54.0
[2.53.0]: https://github.com/0langa/beatform/compare/v2.52.0...v2.53.0
[2.52.0]: https://github.com/0langa/beatform/compare/v2.51.0...v2.52.0
[2.51.0]: https://github.com/0langa/beatform/compare/v2.50.0...v2.51.0
[2.50.0]: https://github.com/0langa/beatform/compare/v2.49.1...v2.50.0
[2.49.1]: https://github.com/0langa/beatform/compare/v2.49.0...v2.49.1
[2.49.0]: https://github.com/0langa/beatform/compare/v2.48.1...v2.49.0
[2.48.1]: https://github.com/0langa/beatform/compare/v2.48.0...v2.48.1
[2.48.0]: https://github.com/0langa/beatform/compare/v2.47.1...v2.48.0
[2.47.1]: https://github.com/0langa/beatform/compare/v2.47.0...v2.47.1
[2.47.0]: https://github.com/0langa/beatform/compare/v2.46.2...v2.47.0
[2.46.2]: https://github.com/0langa/beatform/compare/v2.46.1...v2.46.2
[2.46.1]: https://github.com/0langa/beatform/compare/v2.46.0...v2.46.1
[2.46.0]: https://github.com/0langa/beatform/compare/v2.45.2...v2.46.0
[2.45.2]: https://github.com/0langa/beatform/compare/v2.45.1...v2.45.2
[2.45.1]: https://github.com/0langa/beatform/compare/v2.45.0...v2.45.1
[2.45.0]: https://github.com/0langa/beatform/compare/v2.44.3...v2.45.0
[2.44.3]: https://github.com/0langa/beatform/compare/v2.44.2...v2.44.3
[2.44.2]: https://github.com/0langa/beatform/compare/v2.44.1...v2.44.2
[2.44.1]: https://github.com/0langa/beatform/compare/v2.44.0...v2.44.1
[2.44.0]: https://github.com/0langa/beatform/compare/v2.43.0...v2.44.0
[2.43.0]: https://github.com/0langa/beatform/compare/v2.42.0...v2.43.0
[2.42.0]: https://github.com/0langa/beatform/compare/v2.41.0...v2.42.0
[2.41.0]: https://github.com/0langa/beatform/compare/v2.40.0...v2.41.0
[2.40.0]: https://github.com/0langa/beatform/compare/v2.39.0...v2.40.0
[2.39.0]: https://github.com/0langa/beatform/compare/v2.38.0...v2.39.0
[2.38.0]: https://github.com/0langa/beatform/compare/v2.37.2...v2.38.0
[2.37.2]: https://github.com/0langa/beatform/compare/v2.37.1...v2.37.2
[2.37.1]: https://github.com/0langa/beatform/compare/v2.37.0...v2.37.1
[2.37.0]: https://github.com/0langa/beatform/compare/v2.36.1...v2.37.0
[2.36.1]: https://github.com/0langa/beatform/compare/v2.36.0...v2.36.1
[2.36.0]: https://github.com/0langa/beatform/compare/v2.35.0...v2.36.0
[2.35.0]: https://github.com/0langa/beatform/compare/v2.34.1...v2.35.0
[2.34.1]: https://github.com/0langa/beatform/compare/v2.34.0...v2.34.1
[2.34.0]: https://github.com/0langa/beatform/compare/v2.33.0...v2.34.0
[2.33.0]: https://github.com/0langa/beatform/compare/v2.32.0...v2.33.0
[2.32.0]: https://github.com/0langa/beatform/compare/v2.31.0...v2.32.0
[2.31.0]: https://github.com/0langa/beatform/compare/v2.30.0...v2.31.0
[2.30.0]: https://github.com/0langa/beatform/compare/v2.29.1...v2.30.0
[2.29.1]: https://github.com/0langa/beatform/compare/v2.29.0...v2.29.1
[2.29.0]: https://github.com/0langa/beatform/compare/v2.28.3...v2.29.0
[2.28.3]: https://github.com/0langa/beatform/compare/v2.28.2...v2.28.3
[2.28.2]: https://github.com/0langa/beatform/compare/v2.28.1...v2.28.2
[2.28.1]: https://github.com/0langa/beatform/compare/v2.28.0...v2.28.1
[2.28.0]: https://github.com/0langa/beatform/compare/v2.27.0...v2.28.0
[2.27.0]: https://github.com/0langa/beatform/compare/v2.26.0...v2.27.0
[2.26.0]: https://github.com/0langa/beatform/compare/v2.25.0...v2.26.0
[2.25.0]: https://github.com/0langa/beatform/compare/v2.24.0...v2.25.0
[2.24.0]: https://github.com/0langa/beatform/compare/v2.23.0...v2.24.0
[2.23.0]: https://github.com/0langa/beatform/compare/v2.22.0...v2.23.0
[2.22.0]: https://github.com/0langa/beatform/compare/v2.21.0...v2.22.0
[2.21.0]: https://github.com/0langa/beatform/compare/v2.20.0...v2.21.0
[2.20.0]: https://github.com/0langa/beatform/compare/v2.19.0...v2.20.0
[2.19.0]: https://github.com/0langa/beatform/compare/v2.18.0...v2.19.0
[2.18.0]: https://github.com/0langa/beatform/compare/v2.17.0...v2.18.0
[2.17.0]: https://github.com/0langa/beatform/compare/v2.16.0...v2.17.0
[2.16.0]: https://github.com/0langa/beatform/compare/v2.15.0...v2.16.0
[2.15.0]: https://github.com/0langa/beatform/compare/v2.14.0...v2.15.0
[2.14.0]: https://github.com/0langa/beatform/compare/v2.13.0...v2.14.0
[2.13.0]: https://github.com/0langa/beatform/compare/v2.12.0...v2.13.0
[2.12.0]: https://github.com/0langa/beatform/compare/v2.11.2...v2.12.0
[2.11.2]: https://github.com/0langa/beatform/compare/v2.11.1...v2.11.2
[2.11.1]: https://github.com/0langa/beatform/compare/v2.11.0...v2.11.1
[2.11.0]: https://github.com/0langa/beatform/compare/v2.10.1...v2.11.0
[2.10.1]: https://github.com/0langa/beatform/compare/v2.10.0...v2.10.1
[2.10.0]: https://github.com/0langa/beatform/compare/v2.9.0...v2.10.0
[2.9.0]: https://github.com/0langa/beatform/compare/v2.8.0...v2.9.0
[2.8.0]: https://github.com/0langa/beatform/compare/v2.7.0...v2.8.0
[2.7.0]: https://github.com/0langa/beatform/compare/v2.6.1...v2.7.0
[2.6.1]: https://github.com/0langa/beatform/compare/v2.6.0...v2.6.1
[2.6.0]: https://github.com/0langa/beatform/compare/v2.5.1...v2.6.0
[2.5.1]: https://github.com/0langa/beatform/compare/v2.5.0...v2.5.1
[2.5.0]: https://github.com/0langa/beatform/compare/v2.0.2...v2.5.0
[2.0.2]: https://github.com/0langa/beatform/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/0langa/beatform/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/0langa/beatform/compare/v1.7.0...v2.0.0
[1.7.0]: https://github.com/0langa/beatform/compare/v1.5.0...v1.7.0
[1.5.0]: https://github.com/0langa/beatform/compare/v1.3.0...v1.5.0
[1.3.0]: https://github.com/0langa/beatform/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/0langa/beatform/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/0langa/beatform/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/0langa/beatform/compare/v0.9.0...v1.0.0
[0.9.0]: https://github.com/0langa/beatform/releases/tag/v0.9.0
