import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  parseProject,
  PROJECT_VERSION,
  ProjectParseError,
  serializeProject,
  validateDocument,
  type ProjectDocument,
} from "./project";
import { parseTheme, ThemeParseError } from "./themes";
import {
  activeLyricIndex,
  lyricAlphaAt,
  lyricProgressAt,
  LyricParseError,
  parseLrc,
  parseLyrics,
  parseSrt,
} from "./lyrics";
import { presets } from "../render/presets";

/**
 * Property-based fuzzing of every parser that reads a file (BACKLOG F4).
 *
 * All four of these run on bytes the app did not write: `.bfproj` and
 * `.bftheme` come off disk or out of the Gallery download, and lyric files
 * are whatever the user dragged in. Their contract is that malformed input
 * DEGRADES — a named parse error, or a validated document with defaults
 * filled in — and never a raw `TypeError`, a `NaN` that reaches the renderer,
 * or a value the next validator would reject.
 *
 * Example-based tests already cover the shapes an author thought of. These
 * cover the ones nobody did, and fast-check shrinks a failure down to the
 * smallest input that still reproduces it.
 */

/** Deterministic: a red run reproduces from the seed printed in its output. */
const RUNS = { numRuns: 300, seed: 0x2f8a_11c3 };

/**
 * Keys with a meaning of their own to the JS object model, mixed into every
 * generated object. `migratePresetIdKeys` and the per-preset map validators
 * are written against exactly this: a hand-edited or hostile file whose keys
 * are `__proto__` or `constructor` must not reach the result's prototype.
 */
const poisonKey = fc.constantFrom("__proto__", "constructor", "prototype", "toString", "valueOf");

const jsonValue = fc.jsonValue({ maxDepth: 3 });

/** A value that is JSON, but biased toward the poison keys above. */
const spikyJson: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 4, arbitrary: jsonValue },
  {
    weight: 1,
    arbitrary: fc.dictionary(poisonKey, jsonValue, { maxKeys: 3 }),
  },
);

/**
 * The real document keys carrying wrong-typed values. Pure `fc.jsonValue()`
 * almost never lands on a field name, so it only ever exercises the "field
 * absent, take the default" branch; this reaches the "field present and
 * wrong" branch of every validator.
 */
const DOCUMENT_KEYS = [
  "presetId",
  "paramsByPreset",
  "syncByPreset",
  "bg",
  "bgByPreset",
  "centerImageByPreset",
  "overlayLayers",
  "assets",
  "aspect",
  "modsByPreset",
  "smoothSpectrum",
  "timeline",
  "post",
  "motion",
  "lyricStyle",
  "audiogram",
  "customDefs",
  "builderStack",
] as const;

/**
 * Objects and arrays only, never a bare `null` or scalar. Not a convenience:
 * `validateDocument` is reached through exactly three callers, and all three
 * — `parseProject`, `parseTheme`, `applyDocument({})` — reject a non-object
 * before it. Arrays DO get through (`typeof [] === "object"`), so they stay
 * in. Feeding it `null` would test a shape the app cannot produce and would
 * report the resulting TypeError as a defect it is not.
 */
const documentLike: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 4, arbitrary: fc.dictionary(fc.constantFrom(...DOCUMENT_KEYS), spikyJson) },
  { weight: 1, arbitrary: fc.dictionary(poisonKey, jsonValue, { maxKeys: 3 }) },
  { weight: 1, arbitrary: fc.array(jsonValue, { maxLength: 4 }) },
);

/** What a FILE may carry in its `document` field — the guards' own input. */
const envelopeDocument = fc.oneof(documentLike, spikyJson);

/**
 * Documents whose fields are VALID and non-default, which `documentLike`
 * essentially never produces: junk values all collapse to the same defaults,
 * so a round-trip assertion over them compares one default document against
 * another and passes no matter what serialization drops. Measured, not
 * assumed — deleting `motion` from `serializeProject` left the round-trip
 * property green until this generator replaced it.
 *
 * Only the fields modelled here are covered. `assets`, `overlayLayers`,
 * `timeline`, `customDefs` and `builderStack` are not: each carries a nested
 * schema of its own, and a hand-written approximation of one is a test that
 * drifts from the validator it is supposed to be checking. They keep the
 * example-based coverage in `project.test.ts`.
 */
const unit = fc.double({ min: 0, max: 1, noNaN: true });
const realisticDocument = fc.record(
  {
    presetId: fc.constantFrom(...presets.map((preset) => preset.id)),
    smoothSpectrum: fc.boolean(),
    aspect: fc.constantFrom("free", "16:9", "9:16", "1:1"),
    motion: fc.record({
      rotation: fc.double({ min: 0, max: 2, noNaN: true }),
      pulse: fc.double({ min: 0, max: 2, noNaN: true }),
      detail: unit,
      spectrumSmooth: unit,
    }),
    post: fc.record({
      bloom: unit,
      bloomThreshold: fc.double({ min: 0.4, max: 1.6, noNaN: true }),
      exposure: fc.double({ min: 0.2, max: 3, noNaN: true }),
      tonemap: fc.boolean(),
      vignette: unit,
      grain: fc.double({ min: 0, max: 0.3, noNaN: true }),
      chromatic: unit,
    }),
    paramsByPreset: fc.dictionary(
      fc.constantFrom(...presets.map((preset) => preset.id)),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), fc.double({ noNaN: true }), {
        maxKeys: 4,
      }),
      { maxKeys: 3 },
    ),
  },
  { requiredKeys: [] },
);

describe("project parser fuzzing", () => {
  it("only ever fails with ProjectParseError", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json()), (text) => {
        try {
          parseProject(text);
        } catch (error) {
          // A TypeError here is a crash in the open-file handler, which
          // catches ProjectParseError and nothing else.
          expect(error).toBeInstanceOf(ProjectParseError);
        }
      }),
      RUNS,
    );
  });

  it("only ever fails with ProjectParseError on well-formed envelopes", () => {
    // The string generator above almost never produces `{"kind":"bfproj"}`,
    // so on its own it proves only that JSON.parse is wrapped. This builds
    // the envelope and fuzzes what is INSIDE it, which is where the
    // validators actually live.
    const envelope = fc.record({
      kind: fc.constantFrom("bfproj", "bftheme", "", "BFPROJ"),
      schemaVersion: fc.oneof(
        fc.integer({ min: -2, max: PROJECT_VERSION + 2 }),
        fc.double(),
        fc.constant(undefined),
      ),
      document: envelopeDocument,
    });
    fc.assert(
      fc.property(envelope, (file) => {
        try {
          parseProject(JSON.stringify(file));
        } catch (error) {
          expect(error).toBeInstanceOf(ProjectParseError);
        }
      }),
      RUNS,
    );
  });

  it("validateDocument is a fixpoint", () => {
    // The property the whole save/load path rests on: validating an already
    // validated document must change nothing. If it did, opening a file and
    // re-saving it would drift — and undo snapshots, which re-validate,
    // would drift with it.
    fc.assert(
      fc.property(documentLike, (raw) => {
        const once = validateDocument(raw as Partial<ProjectDocument>);
        const twice = validateDocument(once);
        expect(twice).toEqual(once);
      }),
      RUNS,
    );
  });

  it("survives a save/load round trip", () => {
    fc.assert(
      fc.property(realisticDocument, (raw) => {
        const doc = validateDocument(raw as Partial<ProjectDocument>);
        expect(parseProject(serializeProject(doc, "0.0.0-fuzz"))).toEqual(doc);
      }),
      RUNS,
    );
  });
});

describe("theme parser fuzzing", () => {
  it("only ever fails with ThemeParseError", () => {
    const envelope = fc.record({
      kind: fc.constantFrom("bftheme", "bfproj", ""),
      schemaVersion: fc.oneof(fc.integer({ min: -2, max: 4 }), fc.constant(undefined)),
      projectSchemaVersion: fc.oneof(
        fc.integer({ min: -2, max: PROJECT_VERSION + 2 }),
        fc.constant(undefined),
      ),
      meta: spikyJson,
      document: envelopeDocument,
    });
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          envelope.map((f) => JSON.stringify(f)),
        ),
        (text) => {
          try {
            parseTheme(text);
          } catch (error) {
            expect(error).toBeInstanceOf(ThemeParseError);
          }
        },
      ),
      RUNS,
    );
  });
});

/**
 * Text shaped like a timestamped lyric file. Free-form strings almost never
 * produce a `[mm:ss.xx]` or an SRT arrow, so a generator that only emitted
 * those would prove the parsers reject garbage and nothing else.
 */
const lyricLine = fc.oneof(
  fc.string(),
  fc.constantFrom(
    "[00:12.34]hello",
    "[offset:-500]",
    "[ar:someone]",
    "[99:99.99]out of range",
    "[00:00.00][00:00.00]duplicate stamps",
    "[00:01.00]<00:01.50>word <00:00.10>backwards",
    "1",
    "00:00:01,000 --> 00:00:02,000",
    "00:00:02,000 --> 00:00:01,000",
    "00:00:01,000 --> 00:00:01,000",
    "<i>styled</i>{\\an8}",
    "",
  ),
);

const lyricText = fc.array(lyricLine, { maxLength: 24 }).map((lines) => lines.join("\n"));

describe("lyric parser fuzzing", () => {
  it("parseLrc and parseSrt return sorted, finite, non-negative lines", () => {
    fc.assert(
      fc.property(lyricText, (text) => {
        for (const lines of [parseLrc(text), parseSrt(text)]) {
          let previous = -Infinity;
          for (const line of lines) {
            // activeLyricIndex binary-searches these, so unsorted output is
            // not a cosmetic problem — it silently returns the wrong line.
            expect(Number.isFinite(line.t)).toBe(true);
            expect(line.t).toBeGreaterThanOrEqual(0);
            expect(line.t).toBeGreaterThanOrEqual(previous);
            previous = line.t;
            if (line.end !== null) expect(Number.isFinite(line.end)).toBe(true);
            for (const word of line.words ?? []) {
              expect(Number.isFinite(word.t)).toBe(true);
              if (word.end !== null && word.end !== undefined) {
                expect(Number.isFinite(word.end)).toBe(true);
              }
            }
          }
        }
      }),
      RUNS,
    );
  });

  it("parseLyrics only ever fails with LyricParseError", () => {
    fc.assert(
      fc.property(fc.constantFrom("a.lrc", "a.srt", "a.txt", "a", ""), lyricText, (name, text) => {
        try {
          parseLyrics(name, text);
        } catch (error) {
          expect(error).toBeInstanceOf(LyricParseError);
        }
      }),
      RUNS,
    );
  });

  it("the per-frame readers stay finite and in range on any parsed input", () => {
    // These three run inside the overlay compose chokepoint, once per frame,
    // in preview AND export. A NaN out of any of them is a lyric that
    // renders in one and not the other — a determinism-law break, not a
    // cosmetic glitch.
    fc.assert(
      fc.property(
        lyricText,
        fc.double({ min: -10, max: 400, noNaN: true }),
        fc.double({ min: 0, max: 5, noNaN: true }),
        (text, t, fade) => {
          const lines = parseLrc(text).length > 0 ? parseLrc(text) : parseSrt(text);
          const index = activeLyricIndex(lines, t);
          expect(Number.isInteger(index)).toBe(true);
          expect(index).toBeGreaterThanOrEqual(-1);
          expect(index).toBeLessThan(lines.length);
          const alpha = lyricAlphaAt(lines, index, t, fade);
          const progress = lyricProgressAt(lines, index, t);
          for (const value of [alpha, progress]) {
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
          }
        },
      ),
      RUNS,
    );
  });
});
