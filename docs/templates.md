# Templates — the .avtheme format

One JSON file = one complete look: visual mode + parameters, background,
text/logo layers (assets embedded as data URLs), timeline scenes, post
chain, motion masters, plus metadata. **Import by dropping the file onto the
app window.** Export via _Settings → Templates → Save as template…_

Templates contain **no code**. A template can only select and parameterize
the app's built-in visuals, so importing one is exactly as safe as clicking
around the UI. Share them anywhere — a GitHub discussion, Discord, a zip.
Community templates live in
[Discussions](https://github.com/0langa/audio-visualizer/discussions).

## File layout

```jsonc
{
  "kind": "avtheme",
  "schemaVersion": 1, // .avtheme format version
  "projectSchemaVersion": 6, // embedded document schema (same as .avproj)
  "appVersion": "2.17.0", // app that wrote it (informational)
  "meta": {
    "name": "Midnight Phonk", // required
    "author": "you", // defaults to "unknown"
    "license": "CC0-1.0", // defaults to "unspecified"
    "description": "…", // optional
    "bpmHint": [120, 165], // optional [lo, hi] — a hint, not a gate
    "thumbnail": "data:image/png;base64,…", // optional, inline images only
  },
  "document": {
    "presetId": "bass-circle",
    "paramsByPreset": { "bass-circle": { "hue": 20 } }, // partial: rest = defaults
    "syncByPreset": { "bass-circle": { "mode": "kick", "smooth": 0.35 } },
    "bg": { "mode": 0, "color": [0, 0, 0] },
    "overlayLayers": [],
    "assets": {},
    "aspect": "16:9",
    "modsByPreset": {},
    "smoothSpectrum": false,
    "timeline": { "enabled": false, "scenes": [], "lanes": [] },
    "post": {
      "bloom": 0.45,
      "bloomThreshold": 0.8,
      "exposure": 1,
      "tonemap": true,
      "vignette": 0.35,
      "grain": 0,
      "chromatic": 0,
    },
    "motion": { "rotation": 1, "pulse": 1, "detail": 1, "spectrumSmooth": 0 },
  },
}
```

## Compatibility rules

- **Old themes open forever**: validation IS migration — fields a newer app
  added simply default when missing.
- **Newer themes are refused, not misread**: a file whose `schemaVersion` or
  `projectSchemaVersion` exceeds what the app knows produces a clear
  "update the app" message.
- **Damaged/hostile files degrade safely**: unknown presets fall back to the
  default mode, out-of-range values clamp, non-inline thumbnails are
  stripped, garbage fields are ignored.
- Parameters are **partial**: specify only what you tuned; everything else
  resolves to the preset's defaults on the importing app.

## Authoring tips

- Tune a mode + styles, set Sync (mode/attack/release matter as much as
  colors), add Post (bloom sells most looks), then _Save as template_.
- `bpmHint` tells users what tempo range you designed around; the app never
  blocks on it.
- License defaults to CC0 on export so others can build on your look;
  change the JSON by hand if you want attribution (`CC-BY-4.0`).
- Factory packs (in `src/state/factoryThemes.ts`) are validated by tests
  against the live preset schemas — a good reference for what's available.
