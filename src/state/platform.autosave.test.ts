// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P-11 whole-lane-review fix wave — platform.ts's autosave file primitives,
 * exercised against a mocked `@tauri-apps/plugin-fs` rather than the
 * higher-level `vi.mock("../platform", ...)` shape every store-level test in
 * this codebase uses (that shape bypasses these functions' own bodies
 * entirely, which is exactly what needs covering here: C2(b)'s atomic
 * tmp+rename write, C2(c)'s quarantine-on-corrupt, and I3's filename
 * migration all live INSIDE writeAutosave/readAutosave/
 * quarantineCorruptAutosave, not at any call site).
 *
 * No existing test in this repo mocks `@tauri-apps/plugin-fs` directly —
 * this file establishes that pattern. `isTauri()` reads `window` at CALL
 * TIME (no module-scope caching), so toggling `__TAURI_INTERNALS__` on the
 * stubbed `window` per test is enough; the real platform.ts functions run
 * unmocked and their dynamic `import("@tauri-apps/plugin-fs")` resolves to
 * the mock below regardless of the static-vs-dynamic import syntax.
 */

// Explicitly typed (not inferred from a zero-arg arrow): platform.ts's real
// functions call these with real arguments, and the tests below inspect
// `.mock.calls[n]` by position — an inferred `() => Promise<T>` signature
// makes every one of those destructures a type error.
const writeTextFile = vi.fn(async (_path: string, _contents: string, _opts?: unknown) => undefined);
const readTextFile = vi.fn(async (_path: string, _opts?: unknown) => "");
const exists = vi.fn(async (_path: string, _opts?: unknown) => false);
const remove = vi.fn(async (_path: string, _opts?: unknown) => undefined);
const rename = vi.fn(async (_oldPath: string, _newPath: string, _opts?: unknown) => undefined);
const mkdir = vi.fn(async (_path: string, _opts?: unknown) => undefined);
const BaseDirectory = { AppData: "AppData" } as const;

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile,
  readTextFile,
  exists,
  remove,
  rename,
  mkdir,
  BaseDirectory,
}));

const { writeAutosave, readAutosave, clearAutosave, quarantineCorruptAutosave } =
  await import("./platform");

function setDesktop(desktop: boolean): void {
  vi.stubGlobal("window", desktop ? { __TAURI_INTERNALS__: {} } : {});
}

beforeEach(() => {
  setDesktop(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const fn of [writeTextFile, readTextFile, exists, remove, rename, mkdir]) {
    fn.mockClear();
  }
  exists.mockResolvedValue(false);
  readTextFile.mockResolvedValue("");
  writeTextFile.mockResolvedValue(undefined);
  rename.mockResolvedValue(undefined);
  remove.mockResolvedValue(undefined);
  mkdir.mockResolvedValue(undefined);
});

describe("writeAutosave — C2(b) atomic write", () => {
  it("writes to a .tmp file, then renames it over the real one — never writes the real name directly", async () => {
    await writeAutosave('{"kind":"bfproj"}');

    expect(mkdir).toHaveBeenCalledWith("", { baseDir: BaseDirectory.AppData, recursive: true });
    expect(writeTextFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenContents] = writeTextFile.mock.calls[0];
    expect(writtenPath).toBe("document.bfproj.tmp");
    expect(writtenContents).toBe('{"kind":"bfproj"}');

    expect(rename).toHaveBeenCalledTimes(1);
    const [oldPath, newPath, opts] = rename.mock.calls[0];
    expect(oldPath).toBe("document.bfproj.tmp");
    expect(newPath).toBe("document.bfproj");
    expect(opts).toEqual({
      oldPathBaseDir: BaseDirectory.AppData,
      newPathBaseDir: BaseDirectory.AppData,
    });

    // The tmp write must land BEFORE the rename — a crash between the two
    // leaves either the complete old file or nothing new, never a visible
    // half-written "document.bfproj".
    const writeOrder = writeTextFile.mock.invocationCallOrder[0];
    const renameOrder = rename.mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(renameOrder);
  });

  it("browser build: never touches the filesystem", async () => {
    setDesktop(false);
    await writeAutosave("x");
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });
});

describe("readAutosave — I3 filename migration", () => {
  it("reads document.bfproj directly when it exists — never touches the legacy name", async () => {
    exists.mockImplementation(async (path: string) => path === "document.bfproj");
    readTextFile.mockResolvedValue('{"presetId":"current"}');

    const result = await readAutosave();

    expect(result).toBe('{"presetId":"current"}');
    expect(readTextFile).toHaveBeenCalledWith("document.bfproj", {
      baseDir: BaseDirectory.AppData,
    });
    expect(readTextFile).toHaveBeenCalledTimes(1);
    expect(exists).not.toHaveBeenCalledWith("autosave.bfproj", expect.anything());
  });

  it("one-time migration: document.bfproj absent, legacy autosave.bfproj present — reads the legacy content AND establishes the new file immediately", async () => {
    exists.mockImplementation(async (path: string) => path === "autosave.bfproj");
    readTextFile.mockImplementation(async (path: string) =>
      path === "autosave.bfproj" ? '{"presetId":"legacy"}' : "",
    );

    const result = await readAutosave();

    expect(result).toBe('{"presetId":"legacy"}');
    // Migration write: the SAME atomic tmp+rename path writeAutosave uses,
    // not a raw overwrite — a crash mid-migration must not corrupt the
    // only copy either.
    expect(writeTextFile).toHaveBeenCalledWith("document.bfproj.tmp", '{"presetId":"legacy"}', {
      baseDir: BaseDirectory.AppData,
    });
    expect(rename).toHaveBeenCalledWith("document.bfproj.tmp", "document.bfproj", {
      oldPathBaseDir: BaseDirectory.AppData,
      newPathBaseDir: BaseDirectory.AppData,
    });
  });

  it("both files absent: returns null without attempting any write", async () => {
    exists.mockResolvedValue(false);

    const result = await readAutosave();

    expect(result).toBeNull();
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it("a read error degrades to null rather than throwing — recovery must never block boot", async () => {
    exists.mockImplementation(async (path: string) => path === "document.bfproj");
    readTextFile.mockRejectedValue(new Error("locked"));

    await expect(readAutosave()).resolves.toBeNull();
  });

  it("browser build: returns null without touching the filesystem", async () => {
    setDesktop(false);
    const result = await readAutosave();
    expect(result).toBeNull();
    expect(exists).not.toHaveBeenCalled();
  });
});

describe("clearAutosave — only ever touches the new filename", () => {
  it("removes document.bfproj, never the legacy autosave.bfproj", async () => {
    await clearAutosave();
    expect(remove).toHaveBeenCalledWith("document.bfproj", { baseDir: BaseDirectory.AppData });
    expect(remove).not.toHaveBeenCalledWith("autosave.bfproj", expect.anything());
  });
});

describe("quarantineCorruptAutosave — C2(c)", () => {
  it("renames the current file aside with a .corrupt-<timestamp> suffix", async () => {
    exists.mockResolvedValue(true);
    const before = Date.now();

    await quarantineCorruptAutosave();

    expect(rename).toHaveBeenCalledTimes(1);
    const [oldPath, newPath, opts] = rename.mock.calls[0];
    expect(oldPath).toBe("document.bfproj");
    expect(newPath).toMatch(/^document\.bfproj\.corrupt-\d+$/);
    const ts = Number(newPath.split("corrupt-")[1]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(opts).toEqual({
      oldPathBaseDir: BaseDirectory.AppData,
      newPathBaseDir: BaseDirectory.AppData,
    });
  });

  it("nothing to quarantine: no rename attempted", async () => {
    exists.mockResolvedValue(false);
    await quarantineCorruptAutosave();
    expect(rename).not.toHaveBeenCalled();
  });

  it("a rename failure is swallowed — best-effort, must never throw out of boot", async () => {
    exists.mockResolvedValue(true);
    rename.mockRejectedValue(new Error("locked"));
    await expect(quarantineCorruptAutosave()).resolves.toBeUndefined();
  });

  it("browser build: a no-op", async () => {
    setDesktop(false);
    await quarantineCorruptAutosave();
    expect(exists).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });
});
