import { describe, expect, it } from "vitest";
import { buildSubmission, PLACEHOLDER_PIN, SubmissionError } from "./gallerySubmit";
import { parseRegistry, REGISTRY_SCHEMA_VERSION } from "./gallery";
import { serializeUserPreset, type UserPreset } from "./userPresets";
import { presets } from "../render/presets";
import { serializeTheme, THEME_VERSION } from "./themes";
import { FACTORY_THEMES } from "./factoryThemes";
import { PROJECT_VERSION } from "./project";
import { APP_VERSION } from "../version";

/**
 * gallerySubmit is the app's OWN parsers plus a self-check that round-trips
 * the assembled entry through the app's OWN parseRegistry (gallery.ts's
 * validEntry is not exported, so this is the only way to exercise it
 * without copying its rules) — these tests lean on real fixtures
 * (serializeUserPreset/serializeTheme over real preset/factory-theme data)
 * rather than hand-typed JSON wherever a real writer already exists, same
 * spirit as userPresets.test.ts / themes.test.ts.
 */

const enc = (s: string) => new TextEncoder().encode(s);

async function sha(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const look: UserPreset = {
  id: "up-fixture-1",
  name: "Neon Drop",
  presetId: presets[0].id,
  params: { intensity: 0.9 },
  createdAt: "2026-07-13T00:00:00.000Z",
};
const validLookBytes = () => enc(serializeUserPreset(look));

const factoryTheme = FACTORY_THEMES[0];
const validThemeBytes = () =>
  enc(serializeTheme(factoryTheme.document, factoryTheme.meta, "0.0.0-test"));

const baseOpts = {
  author: "Test Author",
  license: "CC0-1.0",
  description: "A submission fixture.",
};

describe("buildSubmission — looks (.bfpreset)", () => {
  it("accepts a valid look: correct hash, correct size, entry fields match", async () => {
    const bytes = validLookBytes();
    const result = await buildSubmission("neon-drop.bfpreset", bytes, baseOpts);

    expect(result.kind).toBe("look");
    expect(result.folder).toBe("looks");
    expect(result.sizeBytes).toBe(bytes.byteLength);
    expect(result.entry.sizeBytes).toBe(bytes.byteLength);
    expect(result.sha256).toBe(await sha(bytes));
    expect(result.entry.sha256).toBe(result.sha256);
    expect(result.entry.type).toBe("look");
    expect(result.entry.name).toBe("Neon Drop");
    expect(result.fileName).toBe("neon-drop.bfpreset");
    expect(result.entry.contentUrl).toBe(
      `https://raw.githubusercontent.com/beatform-app/gallery/${PLACEHOLDER_PIN}/looks/neon-drop.bfpreset`,
    );
    expect(result.entry.minAppVersion).toBe(APP_VERSION);
    expect(result.prBody).toContain(result.sha256);
    expect(result.prBody).toContain(String(bytes.byteLength));
    expect(result.prBody).toContain("neon-drop.bfpreset");
  });

  it("derives the registry id from the preset's own name when --id is omitted", async () => {
    const result = await buildSubmission("whatever-filename.bfpreset", validLookBytes(), baseOpts);
    expect(result.entry.id).toBe("neon-drop");
  });

  it("respects an explicit --id literally, never auto-correcting it", async () => {
    const result = await buildSubmission("x.bfpreset", validLookBytes(), {
      ...baseOpts,
      id: "my-custom-slug",
    });
    expect(result.entry.id).toBe("my-custom-slug");
    expect(result.fileName).toBe("my-custom-slug.bfpreset");
  });

  it("--name overrides the name read from the file", async () => {
    const result = await buildSubmission("x.bfpreset", validLookBytes(), {
      ...baseOpts,
      name: "Renamed For Gallery",
    });
    expect(result.entry.name).toBe("Renamed For Gallery");
  });

  it("--min-app-version overrides the running app's own version", async () => {
    const result = await buildSubmission("x.bfpreset", validLookBytes(), {
      ...baseOpts,
      minAppVersion: "2.50.0",
    });
    expect(result.entry.minAppVersion).toBe("2.50.0");
  });

  it("the assembled entry round-trips through the app's own parseRegistry, unchanged", async () => {
    const result = await buildSubmission("neon-drop.bfpreset", validLookBytes(), baseOpts);
    const parsed = parseRegistry(
      JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION, entries: [result.entry] }),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(result.entry);
  });
});

describe("buildSubmission — themes (.bftheme)", () => {
  it("accepts a valid theme: correct hash, correct size, entry fields match", async () => {
    const bytes = validThemeBytes();
    const result = await buildSubmission("deep-current.bftheme", bytes, baseOpts);

    expect(result.kind).toBe("theme");
    expect(result.folder).toBe("themes");
    expect(result.sizeBytes).toBe(bytes.byteLength);
    expect(result.sha256).toBe(await sha(bytes));
    expect(result.entry.type).toBe("theme");
    expect(result.entry.name).toBe(factoryTheme.meta.name);
  });

  it("reads schemaVersion from the file's own projectSchemaVersion, never the envelope schemaVersion", async () => {
    // Hand-authored (not via serializeTheme): THEME_VERSION (envelope) and
    // PROJECT_VERSION (document) are deliberately different axes today —
    // pin a file where they disagree so a bug reading the wrong field is
    // caught, not accidentally hidden by both happening to equal the same
    // number.
    expect(THEME_VERSION).not.toBe(PROJECT_VERSION); // the premise this test needs
    const file = {
      kind: "bftheme",
      schemaVersion: THEME_VERSION,
      projectSchemaVersion: PROJECT_VERSION,
      appVersion: "2.90.0",
      meta: { name: "Schema Probe", author: "tester", license: "CC0-1.0" },
      document: factoryTheme.document,
    };
    const result = await buildSubmission("probe.bftheme", enc(JSON.stringify(file)), baseOpts);
    expect(result.entry.schemaVersion).toBe(PROJECT_VERSION);
  });

  it("the assembled theme entry round-trips through the app's own parseRegistry, unchanged", async () => {
    const result = await buildSubmission("deep-current.bftheme", validThemeBytes(), baseOpts);
    const parsed = parseRegistry(
      JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION, entries: [result.entry] }),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(result.entry);
  });
});

describe("buildSubmission — refusals", () => {
  it("refuses corrupted JSON, naming the real parser's reason", async () => {
    await expect(buildSubmission("x.bfpreset", enc("not json"), baseOpts)).rejects.toThrow(
      SubmissionError,
    );
    await expect(buildSubmission("x.bfpreset", enc("not json"), baseOpts)).rejects.toThrow(
      /valid JSON/i,
    );
  });

  it("refuses a wrong-kind envelope (a theme's bytes under a .bfpreset name)", async () => {
    await expect(
      buildSubmission("x.bfpreset", enc(JSON.stringify({ kind: "bftheme" })), baseOpts),
    ).rejects.toThrow(/\.bfpreset/);
  });

  it("refuses an unsupported extension, listing the supported kinds", async () => {
    let error: unknown;
    try {
      await buildSubmission("stack.bfbuilder", enc("{}"), baseOpts);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SubmissionError);
    const message = (error as Error).message;
    expect(message).toContain(".bfpreset");
    expect(message).toContain(".bftheme");
    expect(message).toContain("look");
    expect(message).toContain("theme");
  });

  it("refuses a license outside the registry's two allowed values", async () => {
    await expect(
      buildSubmission("x.bfpreset", validLookBytes(), { ...baseOpts, license: "MIT" }),
    ).rejects.toThrow(/CC0-1\.0/);
  });

  it("refuses a non-https author URL", async () => {
    await expect(
      buildSubmission("x.bfpreset", validLookBytes(), {
        ...baseOpts,
        authorUrl: "http://insecure.example",
      }),
    ).rejects.toThrow(/https:\/\//);
  });

  it("refuses an empty author or description before ever touching the file", async () => {
    await expect(
      buildSubmission("x.bfpreset", validLookBytes(), { ...baseOpts, author: "   " }),
    ).rejects.toThrow(/author/i);
    await expect(
      buildSubmission("x.bfpreset", validLookBytes(), { ...baseOpts, description: "" }),
    ).rejects.toThrow(/description/i);
  });

  // This is the load-bearing test for the self-check mechanism itself:
  // description length is NOT hand-validated anywhere in gallerySubmit.ts,
  // so a refusal here can only come from the REAL parseRegistry/validEntry
  // round-trip actually running and actually rejecting — proving the
  // self-check is live, not decorative.
  it("refuses when the assembled entry would fail the app's OWN registry validator", async () => {
    await expect(
      buildSubmission("x.bfpreset", validLookBytes(), {
        ...baseOpts,
        description: "x".repeat(501),
      }),
    ).rejects.toThrow(/registry validator/);
  });
});
