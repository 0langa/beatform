/**
 * File I/O that adapts to where the app runs:
 *  - Tauri (the real desktop app): native save/open dialogs + direct disk IO
 *  - Browser (`npm run dev`, demos): anchor downloads and <input type=file>
 *
 * Everything returns null on user cancel; real failures throw.
 */

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** Save text to a user-chosen location. Returns the path/name, null on cancel. */
export async function saveTextFile(
  defaultName: string,
  contents: string,
  filters: FileFilter[],
): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ defaultPath: defaultName, filters });
    if (!path) return null;
    await writeTextFile(path, contents);
    return path;
  }
  downloadBlob(new Blob([contents], { type: "application/json" }), defaultName);
  return defaultName;
}

/** Save binary data to a user-chosen location. Returns the path/name, null on cancel. */
export async function saveBinaryFile(
  defaultName: string,
  data: Blob,
  filters: FileFilter[],
): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ defaultPath: defaultName, filters });
    if (!path) return null;
    await writeFile(path, new Uint8Array(await data.arrayBuffer()));
    return path;
  }
  downloadBlob(data, defaultName);
  return defaultName;
}

/** Tauri only: choose a save destination without writing yet (pick before a
 * long render). Returns the path, null on cancel. */
export async function pickSavePath(
  defaultName: string,
  filters: FileFilter[],
): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath: defaultName, filters });
}

/** Tauri only: write a blob to a previously picked path. */
export async function writeBinaryToPath(path: string, data: Blob): Promise<void> {
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  await writeFile(path, new Uint8Array(await data.arrayBuffer()));
}

/** Open a text file via dialog. Returns {name, contents}, null on cancel. */
export async function openTextFile(
  filters: FileFilter[],
): Promise<{ name: string; contents: string } | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ multiple: false, directory: false, filters });
    if (typeof path !== "string") return null;
    const contents = await readTextFile(path);
    return { name: path.split(/[\\/]/).pop() ?? path, contents };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",");
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve({ name: file.name, contents: await file.text() });
    };
    // Cancel never fires a reliable event across browsers; losing focus back
    // to the page without a change is close enough for the dev fallback.
    input.oncancel = () => resolve(null);
    input.click();
  });
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "svg"];

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

/** Pick an image and return it as a data URL (embeds into projects). */
export async function openImageFile(): Promise<{ name: string; dataUrl: string } | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
    });
    if (typeof path !== "string") return null;
    const bytes = await readFile(path);
    const name = path.split(/[\\/]/).pop() ?? path;
    const ext = name.split(".").pop()?.toLowerCase() ?? "png";
    return { name, dataUrl: bytesToDataUrl(bytes, MIME_BY_EXT[ext] ?? "image/png") };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_EXTENSIONS.map((e) => `.${e}`).join(",");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, dataUrl: reader.result as string });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
