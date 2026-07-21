// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { IMAGE_MAX_BYTES, VIDEO_MAX_BYTES, openImageFile, openVideoFile } from "./platform";

/**
 * M21: openImageFile/openVideoFile embedded any file as a base64 data URL
 * with no size cap at all, despite the picker's own comment assuming "short
 * background loops" — a large source file inflates 1.33x into the project
 * file, the autosave write (every 5s of editing), and every one of up to
 * 100 undo/redo snapshots, and can OOM the renderer outright before any of
 * that even happens.
 *
 * These tests drive the browser (`<input type=file>`) fallback path, which
 * is what this dev/test environment (and `npm run dev`) actually exercises —
 * isTauri() is false whenever `__TAURI_INTERNALS__` isn't on `window`, and
 * jsdom's window never has it. The Tauri branch runs the identical
 * assertSizeAllowed() check in the same relative position (immediately
 * after readFile(), before bytesToDataUrl()); reliably mocking the
 * dynamically-imported @tauri-apps/plugin-fs/-dialog modules for a second
 * copy of the same already-proven check would add a lot of fragile
 * scaffolding for little extra confidence, so that branch is verified by
 * code inspection instead.
 */

/** Intercept the <input type=file> platform.ts creates and simulate a user
 * picking `file` — jsdom can't drive a real OS file dialog, so `.click()` is
 * overridden to fire `onchange` synchronously with a fake FileList instead. */
function stubFilePicker(file: File): void {
  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const el = realCreateElement(tag);
    if (tag === "input") {
      Object.defineProperty(el, "files", { value: [file], configurable: true });
      (el as HTMLInputElement).click = () =>
        (el as HTMLInputElement).onchange?.(new Event("change"));
    }
    return el;
  }) as typeof document.createElement);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("background asset size limits", () => {
  it("are positive, and video's is more generous than image's (short loops vs. a single photo)", () => {
    expect(IMAGE_MAX_BYTES).toBeGreaterThan(0);
    expect(VIDEO_MAX_BYTES).toBeGreaterThan(IMAGE_MAX_BYTES);
  });
});

describe("openImageFile", () => {
  it("rejects an oversize image before reading it, naming both the actual size and the limit", async () => {
    const file = new File([new Uint8Array(10)], "huge.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: IMAGE_MAX_BYTES * 1.5 }); // 48,000,000
    stubFilePicker(file);
    const readSpy = vi.spyOn(FileReader.prototype, "readAsDataURL");

    let error: Error | undefined;
    await openImageFile().catch((e: Error) => {
      error = e;
    });

    expect(error?.message).toContain("48.0 MB"); // the file's actual size
    expect(error?.message).toContain("32.0 MB"); // the limit
    expect(readSpy).not.toHaveBeenCalled(); // rejected BEFORE the read/encode
  });

  it("still resolves a normal-sized image (no false positive)", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "small.png", { type: "image/png" });
    stubFilePicker(file);

    const result = await openImageFile();

    expect(result?.name).toBe("small.png");
    expect(result?.dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});

describe("openVideoFile", () => {
  it("rejects an oversize video before reading it, naming both the actual size and the limit", async () => {
    const file = new File([new Uint8Array(10)], "huge.mp4", { type: "video/mp4" });
    Object.defineProperty(file, "size", { value: VIDEO_MAX_BYTES * 1.5 }); // 288,000,000
    stubFilePicker(file);
    const readSpy = vi.spyOn(FileReader.prototype, "readAsDataURL");

    let error: Error | undefined;
    await openVideoFile().catch((e: Error) => {
      error = e;
    });

    expect(error?.message).toContain("288.0 MB"); // the file's actual size
    expect(error?.message).toContain("192.0 MB"); // the limit
    expect(readSpy).not.toHaveBeenCalled(); // rejected BEFORE the read/encode
  });

  it("still resolves a normal-sized video (no false positive)", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "small.mp4", { type: "video/mp4" });
    stubFilePicker(file);

    const result = await openVideoFile();

    expect(result?.name).toBe("small.mp4");
    expect(result?.dataUrl).toMatch(/^data:video\/mp4;base64,/);
  });
});
