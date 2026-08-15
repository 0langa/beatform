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

const {
  writeAutosave,
  readAutosave,
  clearAutosave,
  quarantineCorruptAutosave,
  quarantineSupersededAutosave,
} = await import("./platform");

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

/** A promise this test controls the settling of — same shape as the
 * `deferred()` helper established in customShaderActions.test.ts /
 * projectIOActions.test.ts. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("writeAutosave — second whole-lane-review round item 1: serialized writes", () => {
  it("a second write STARTS only after the first settles — no false-failure from a shared tmp path", async () => {
    // Park the FIRST write's writeTextFile call — it will not resolve
    // until this test releases it. try/finally: if an assertion below
    // throws, `parked` must still be released — this file has ONE shared
    // module import (no vi.resetModules() per test), so a promise left
    // dangling here would leave the real, module-level write chain stuck
    // forever and cascade a timeout into every OTHER test in this file
    // (this is exactly what happened while writing this test the first
    // time — a tick-counting mistake below failed an assertion before
    // `parked` was ever released, and three unrelated tests after this
    // one in file order started timing out).
    const parked = deferred<undefined>();
    writeTextFile.mockImplementationOnce(async () => parked.promise);
    try {
      const firstWrite = writeAutosave("content-A");
      // vi.waitFor, not a fixed Promise.resolve() tick count: writeAutosave's
      // chain hops through .catch()/.then() plus writeFileAtomic's own
      // `await import(...)`/`await mkdir(...)` before it ever reaches
      // writeTextFile — the exact hop count is an implementation detail
      // this test should not have to know.
      await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(1));

      const secondWrite = writeAutosave("content-B");
      // The second write must NOT start its own writeTextFile call while
      // the first is still parked. A real (short) wait, not more
      // Promise.resolve() ticks: only a macrotask boundary guarantees
      // every pending microtask — however many the chain needs — has
      // already run, so "nothing happened by then" is actually provable.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(writeTextFile).toHaveBeenCalledTimes(1);
      expect(rename).not.toHaveBeenCalled();

      // Release the first write.
      parked.resolve(undefined);
      await firstWrite;

      // NOW the second write's writeTextFile call must have started.
      await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(2));
      expect(writeTextFile.mock.calls[1][1]).toBe("content-B");

      await expect(secondWrite).resolves.toBeUndefined();
      expect(rename).toHaveBeenCalledTimes(2);
    } finally {
      parked.resolve(undefined); // no-op if already released above
    }
  });

  it("a failed write does not poison the chain — the NEXT write still runs, and its own promise is unaffected", async () => {
    writeTextFile.mockImplementationOnce(async () => {
      throw new Error("disk full");
    });

    await expect(writeAutosave("content-A")).rejects.toThrow("disk full");

    // The chain must keep flowing: a second, healthy write afterward must
    // not inherit the first one's rejection.
    await expect(writeAutosave("content-B")).resolves.toBeUndefined();
    expect(rename).toHaveBeenCalledTimes(1); // only the SECOND write reached rename
  });

  it("three overlapping writes all eventually complete, strictly one at a time (never more than one writeTextFile call outstanding)", async () => {
    let outstanding = 0;
    let maxOutstanding = 0;
    writeTextFile.mockImplementation(async () => {
      outstanding++;
      maxOutstanding = Math.max(maxOutstanding, outstanding);
      await Promise.resolve(); // yield, so a real overlap WOULD show up here if it existed
      outstanding--;
      return undefined;
    });

    await Promise.all([
      writeAutosave("content-A"),
      writeAutosave("content-B"),
      writeAutosave("content-C"),
    ]);

    expect(maxOutstanding).toBe(1);
    expect(writeTextFile).toHaveBeenCalledTimes(3);
    expect(rename).toHaveBeenCalledTimes(3);
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

describe("quarantineSupersededAutosave — D1 fix part (b), sibling of quarantineCorruptAutosave", () => {
  /**
   * C1(b) fix (review round): this function no longer renames whatever is
   * on disk — it WRITES the caller's own known-good `contents` directly,
   * atomically (tmp then rename, `chainedWrite`/`writeFileAtomic`), so the
   * archived copy can never be some OTHER write that raced it. These tests
   * exercise that write path directly rather than mocking `exists`+`rename`
   * as a bare move.
   */
  it("writes the given contents to a .superseded-<timestamp> file via the atomic tmp+rename path, and returns the new name", async () => {
    const before = Date.now();

    const result = await quarantineSupersededAutosave('{"presetId":"the-true-newer-doc"}');

    expect(writeTextFile).toHaveBeenCalledTimes(1);
    const [tmpPath, writtenContents] = writeTextFile.mock.calls[0];
    expect(writtenContents).toBe('{"presetId":"the-true-newer-doc"}');
    expect(tmpPath).toMatch(/^document\.bfproj\.superseded-\d+\.tmp$/);

    expect(rename).toHaveBeenCalledTimes(1);
    const [oldPath, newPath, opts] = rename.mock.calls[0];
    expect(oldPath).toBe(tmpPath);
    expect(newPath).toMatch(/^document\.bfproj\.superseded-\d+$/);
    expect(result).toBe(newPath);
    const ts = Number((newPath as string).split("superseded-")[1]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(opts).toEqual({
      oldPathBaseDir: BaseDirectory.AppData,
      newPathBaseDir: BaseDirectory.AppData,
    });
    // Distinct naming from the corrupt-file quarantine — the two events
    // must read differently to anyone looking at AppData by hand.
    expect(newPath).not.toMatch(/corrupt/);

    // The tmp write must land BEFORE the rename — same atomicity guarantee
    // as the live document's own write (a crash between the two leaves
    // either nothing new or the complete archived file, never torn).
    const writeOrder = writeTextFile.mock.invocationCallOrder[0];
    const renameOrder = rename.mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(renameOrder);

    // Never re-reads or checks for existence — it does not need to know
    // (or trust) what, if anything, is already on disk.
    expect(exists).not.toHaveBeenCalled();
  });

  it("a write failure is swallowed and returns null — best-effort, must never throw out of boot", async () => {
    writeTextFile.mockRejectedValueOnce(new Error("disk full"));
    await expect(quarantineSupersededAutosave('{"presetId":"x"}')).resolves.toBeNull();
  });

  it("a rename failure (after a successful tmp write) is also swallowed and returns null", async () => {
    rename.mockRejectedValueOnce(new Error("locked"));
    await expect(quarantineSupersededAutosave('{"presetId":"x"}')).resolves.toBeNull();
  });

  it("browser build: a no-op, returns null", async () => {
    setDesktop(false);
    const result = await quarantineSupersededAutosave('{"presetId":"x"}');
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("shares the SAME serialized write chain as writeAutosave — a quarantine write and a live-document write never interleave their tmp files", async () => {
    // Park the quarantine write's tmp write — it will not resolve until
    // this test releases it. try/finally: this file has one shared module
    // import, so a promise left dangling here would cascade a timeout into
    // every later test (this exact hazard is documented on the "second
    // write STARTS only after the first settles" test above).
    const parked = deferred<undefined>();
    writeTextFile.mockImplementationOnce(async () => parked.promise);
    try {
      const quarantineWrite = quarantineSupersededAutosave('{"presetId":"newer"}');
      await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(1));

      const liveWrite = writeAutosave('{"presetId":"edited"}');
      // A real (short) wait — only a macrotask boundary guarantees every
      // pending microtask has already run, so "nothing happened by then"
      // is actually provable, not just "didn't happen on THIS tick."
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(writeTextFile).toHaveBeenCalledTimes(1); // the live write has NOT started yet

      parked.resolve(undefined);
      await quarantineWrite;

      await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(2));
      expect(writeTextFile.mock.calls[1][1]).toBe('{"presetId":"edited"}');
      await expect(liveWrite).resolves.toBeUndefined();
    } finally {
      parked.resolve(undefined);
    }
  });
});
