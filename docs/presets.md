# Preset SDK — add a visual mode

Two ways in:

- **In-app shader editor** (the `+` chip on the mode strip): write the WGSL,
  add parameters (each becomes a `P_<key>()` accessor and an automatic
  slider), hit _Compile_ — errors come back with line numbers. Custom
  visuals persist, export exactly like built-ins, and share as one
  `.avshader` file (drop one on the window to import). No build tools.
- **A TypeScript preset file** in the repo: one file exporting a
  `PresetDef` plus a registry line in `src/render/presets/index.ts` — the
  path for contributing a built-in. Workflow:
  [CONTRIBUTING.md](https://github.com/0langa/beatform/blob/main/CONTRIBUTING.md).

Everything below applies to both.

## The two laws

1. **Determinism** — nothing wall-clock may touch a pixel. Seed randomness
   from `u.time` or a hash of position; never `Math.random`/`Date.now`.
2. **WYSIWYG** — a preset is a pure function of `(features, time, params)`.
   That purity is why the live preview and the exported file are the same
   render.

## PresetDef

```ts
export const myMode: PresetDef = {
  id: "my-mode", // stable — projects reference it
  name: "My Mode",
  description: "One user-facing line.",
  styles: [
    // 5–7 curated looks; first = defaults
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

## Audio uniforms (`u.`)

| Field                                                                | Meaning                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `time`                                                               | Track time, seconds. THE animation clock.                                                                                                                                                                                                                                                                                                                                                                  |
| `drive`                                                              | Smoothed envelope of the user's Sync source. **Use this** so the Sync panel matters.                                                                                                                                                                                                                                                                                                                       |
| `driveBeat`                                                          | Onset pulse of the Sync source: 1 on a hit, exponential decay.                                                                                                                                                                                                                                                                                                                                             |
| `bpm`, `beatPhase`, `barPhase`                                       | Beat grid: tempo, 0..1 within the beat, 0..1 within a 4-beat bar. 0 when no grid.                                                                                                                                                                                                                                                                                                                          |
| `bass`, `mid`, `treble`, `voice`                                     | Band energies 0..1.                                                                                                                                                                                                                                                                                                                                                                                        |
| `kick`, `snare`, `hat`                                               | Per-drum onset envelopes.                                                                                                                                                                                                                                                                                                                                                                                  |
| `rms`, `energy`                                                      | Instant / slow (~0.8 s) loudness.                                                                                                                                                                                                                                                                                                                                                                          |
| `beatIntensity`                                                      | Legacy low-end beat pulse.                                                                                                                                                                                                                                                                                                                                                                                 |
| `dt`                                                                 | Seconds of **track** time this frame covers — the delta since the previous rendered frame (exactly 1/fps on the export path). Scale per-frame accumulation by `dt * 60.0` so trails and the like look the same at 30, 60 and 144 fps. Seeks and pauses clamp to a 1/60 step. (This slot used to be `progress` = time/duration; nothing read it, and feedback presets needed frame-rate compensation more.) |
| `width`                                                              | Stereo width.                                                                                                                                                                                                                                                                                                                                                                                              |
| `spin`, `pulse`, `detail`, `specSmooth`                              | Motion masters — multiply your rotation / beat-scale / element count by these.                                                                                                                                                                                                                                                                                                                             |
| `aspect`, `binCount`, `waveCount`, `smoothBins`, `bgMode`, `bgColor` | Housekeeping.                                                                                                                                                                                                                                                                                                                                                                                              |

## WGSL helpers

- `binAt(x)`, `peakAt(x)` — log-spaced spectrum / peak-hold at x∈0..1,
  honoring the global smooth-spectrum masters. Use these, not raw `bins[i]`.
- `waveAt(x)` — phase-locked waveform, −1..1.
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
- `feedbackSample(uv)` — previous frame (referencing it opts into the
  trails/feedback path).

Special paths: `particles: { count }` runs a built-in GPU compute simulation
instead of your fragment (see `particleFlow.ts`); `mesh3d: { grid }` runs a
depth-tested instanced 3D grid (see `spectrumScape.ts`).

## Craft notes

- Geometry rides SLOW signals (`drive`, `energy`); brightness can ride fast
  ones. Fast bands moving geometry reads as jitter.
- Never `fract()` a spectrum coordinate that spans the frame — it wraps into
  a hard seam.
- Respect the masters: multiply your spin by `u.spin`, beat scaling by
  `u.pulse`; map element counts through `u.detail`.
- Verify with the dev probes: `window.__runExport({png:true})` byte-diffs
  prove a knob changes pixels; `__gpuErrors` must stay empty.
