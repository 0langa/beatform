# Preset SDK — add a visual mode

Three ways in:

- **In-app shader editor** (the `+` chip on the mode strip): write the WGSL,
  add parameters (each becomes a `P_<key>()` accessor and an automatic
  slider), hit _Compile_ — errors come back with line numbers. Custom
  visuals persist, use the same export pipeline as built-ins, and share as one
  `.bfshader` file (drop one on the window to import). No build tools.
- **Shadertoy import** (the _Shadertoy…_ button in the shader editor): paste
  the **Image** tab of a single-pass Shadertoy shader and it is translated to
  WGSL on the spot. `iChannel0` carries the track's audio the way Shadertoy's
  music channel does (512×2 texture — row 0 spectrum, row 1 waveform);
  `iTime`, `iFrame` and `iDate` all follow the track clock, so previews and
  exports stay frame-identical. Attribution (author, source URL, license —
  Shadertoy's default is CC BY-NC-SA) is part of the visual and travels with
  `.bfshader` files and project embeds. Helpers that take `sampler2D`
  parameters are specialized per channel automatically (as long as call
  sites pass `iChannel0..3` directly). Not supported: multi-pass buffers,
  cubemap/video/keyboard channels, and sound-only/VR-only shaders (an extra
  `mainSound`/`mainVR` next to `mainImage` is simply ignored).
- **A TypeScript preset file** in the repo: one file exporting a
  `PresetDef` plus a registry line in `src/render/presets/index.ts` — the
  path for contributing a built-in. Workflow:
  [CONTRIBUTING.md](https://github.com/0langa/beatform/blob/main/CONTRIBUTING.md).

Everything below applies to the WGSL paths; an imported Shadertoy visual is a
complete translated program and uses its own uniform contract instead of the
`u.`/`P_` ABI.

## The two laws

1. **Determinism** — nothing wall-clock may touch a pixel. Seed randomness
   from `u.time` or a hash of position; never `Math.random`/`Date.now`.
2. **Deterministic render input** — a preset is a pure function of
   `(features, time, params)`. Purity makes export repeatable; live feature
   timing still follows the preview/export
   [truth contract](PREVIEW-EXPORT-CONTRACT.md).

## PresetDef

```ts
export const myMode: PresetDef = {
  id: "my-mode", // stable — projects reference it
  name: "My Mode",
  description: "One user-facing line.",
  styles: [
    // curated looks; first = defaults. The shipped modes carry 6–14 each
    { id: "default", name: "Default", values: {} },
    { id: "ember", name: "Ember", values: { hue: 20, glow: 0.8 } },
  ],
  params: [
    // main knobs (schema -> auto UI)
    {
      key: "hue",
      label: "Hue",
      min: 0,
      max: 360,
      step: 1,
      default: 200,
      hint: "What turning this visibly does",
    },
  ],
  advanced: [/* every internal constant worth touching */],
  wgsl: /* wgsl */ `
fn preset(uv: vec2f) -> vec4f {
  // your fragment shader — uv is 0..1
  return vec4f(0.0, 0.0, 0.0, 1.0);
}`,
};
```

Params become WGSL accessors `P_<key>()`. A param with `min:0, max:1,
step:1` renders as a toggle. `styles` values are partial overrides —
machine-check yours against the schema like `themes.test.ts` does.

### Groups and tiers

Give every param a `group` (`shape`, `color`, `motion`, `reaction`, `glow`,
`image`, `camera`, `backdrop`, or one your preset declares); anything without
one lands in **More**. The panel renders one collapsible section per group,
and inside it the `params` entries sit above the group's expert line while the
`advanced` entries hide behind it.

**The two arrays are the ABI.** `allParams` packs `params` then `advanced` in
declaration order, and a spec's position _is_ its shader accessor index — move
one between the arrays and every GPU pixel hash shifts. To show an `advanced`
spec above the expert line instead, set `tier: "curated"` on it in place; that
changes nothing about packing. Every group must have at least one control
above its expert line, or it renders as a bare header — `curation.test.ts`
enforces that and `abiOrder.test.ts` catches a moved spec in seconds.

## Audio uniforms (`u.`)

| Field                                                                | Meaning                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `time`                                                               | Track time, seconds. THE animation clock.                                                                                                                                                                                                                                                 |
| `drive`                                                              | Smoothed envelope of the user's Sync source. **Use this** so the Sync panel matters.                                                                                                                                                                                                      |
| `driveBeat`                                                          | Onset pulse of the Sync source: 1 on a hit, exponential decay.                                                                                                                                                                                                                            |
| `bpm`, `beatPhase`, `barPhase`                                       | Beat grid: tempo, 0..1 within the beat, 0..1 within a 4-beat bar. 0 when no grid.                                                                                                                                                                                                         |
| `bass`, `mid`, `treble`, `voice`                                     | Band energies 0..1.                                                                                                                                                                                                                                                                       |
| `kick`, `snare`, `hat`                                               | Per-drum onset envelopes.                                                                                                                                                                                                                                                                 |
| `rms`, `energy`                                                      | Instant / slow (~0.8 s) loudness.                                                                                                                                                                                                                                                         |
| `beatIntensity`                                                      | Legacy low-end beat pulse.                                                                                                                                                                                                                                                                |
| `dt`                                                                 | Seconds of state time this invocation covers. Ordinary presets receive presentation delta. Presets that read feedback history receive `1/60` on fixed state ticks and `0` on presentation-only frames, so history mutation must be gated by positive `dt`. Seeks and pauses clamp safely. |
| `width`                                                              | Stereo width.                                                                                                                                                                                                                                                                             |
| `spin`, `pulse`, `detail`, `specSmooth`                              | Motion masters — multiply your rotation / beat-scale / element count by these.                                                                                                                                                                                                            |
| `aspect`, `binCount`, `waveCount`, `smoothBins`, `bgMode`, `bgColor` | Housekeeping.                                                                                                                                                                                                                                                                             |

## WGSL helpers

- `binAt(x)`, `peakAt(x)` — log-spaced spectrum / peak-hold at x∈0..1,
  honoring the global smooth-spectrum masters. Use these, not raw `bins[i]`.
- `waveAt(x)` — phase-locked waveform, −1..1 (the mono mixdown).
- `waveAt2(x)` — the SECOND channel (right) of the same phase-locked window,
  −1..1. Identical to `waveAt(x)` for mono sources, so it degrades safely.
- `waveXY(t)` — the stereo pair at t∈0..1 as `vec2f(left, right)`: plot y
  against x for an XY/Lissajous scope. All three lanes share ONE
  zero-crossing trigger, so the inter-channel phase is real; mono sources
  collapse to the x == y diagonal. (`u.waveCount` covers every lane.)
- `gridPulse(sharp)` — **1.0 on every beat-grid beat**, exponential decay;
  falls back to `driveBeat` when the track has no grid. The tempo-lock
  pattern: `max(u.driveBeat, gridPulse(7.0))` — grid keeps time, real hits
  still punch through.
- `beatRamp()` — continuous beats-into-bar counter (0..4): tempo-locked
  scroll/travel that stays continuous across the bar wrap when you move an
  integer number of cells per beat.
- `hsl2rgb(h°, s, l)`, `hash21(p)`, `hash11(x)`, `noise2(p)`, `fbm(p)`,
  `rot2(a)`, `centered(uv)` (aspect-corrected, origin center), `TAU`.
- `coverSample(uv)` / `hasCover()` — the track's embedded album art.
- `lyricSample(uv)` / `hasLyrics()` — the lyric plate: the current lyric
  moment pre-rasterized by the host (three bands — previous / current / next
  line; channels are classes, R glyph / G karaoke-lit / B active word, plus a
  4 px status corner carrying line presence). This is how Lyric Stage draws
  words; `hasLyrics()` is false when no timed lyrics are loaded, so degrade
  to a no-lyrics look instead of an empty frame.
- `feedbackSample(uv)` — previous frame (referencing it opts into the
  trails/feedback path).

Special paths: `particles: { count }` runs a built-in GPU compute simulation
instead of your fragment (see `particleFlow.ts`); `mesh3d: { grid }` runs a
depth-tested instanced 3D grid (see `spectrumScape.ts`).

## Craft notes

- Geometry rides SLOW signals (`drive`, `energy`); brightness can ride fast
  ones. Fast bands moving geometry reads as jitter.
- **Frame safety is SOFT, never a clip (the v2.44 law).** The frame in
  `centered()` space is the rectangle `|x| <= u.aspect*0.5, |y| <= 0.5` —
  not a circle. Never write `min(radius, 0.47)`-style caps: at maxed
  settings they slice geometry along a visible circle. Use the ABI helpers
  instead — `softLimit(x, lim)` (identity below ~72% of the limit, smooth
  asymptotic compression above; a hard edge cannot exist at any setting),
  with `frameReach(angle)` as the limit for directional geometry (bar tips
  reach further sideways on a wide frame, like the frame itself) and
  `frameCircle()` for elements that must stay circular (discs, rings).
  For glow that bleeds past geometry, fade with `frameFade(p)` (the actual
  border), never `smoothstep(0.5, 0.45, r)` (a circle).
- Never `fract()` a spectrum coordinate that spans the frame — it wraps into
  a hard seam.
- Respect the masters: multiply your spin by `u.spin`, beat scaling by
  `u.pulse`; map element counts through `u.detail`.
- Verify with the dev probes: `window.__runExport({png:true})` byte-diffs
  prove a knob changes pixels; `__gpuErrors` must stay empty.
