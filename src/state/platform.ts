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
/** Tauri only: choose an existing folder (PNG sequence destination). Returns
 * the path, null on cancel. */
export async function pickFolder(title: string): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  // `recursive` widens the granted fs scope to the whole subtree. The library
  // scanner walks recursively and plays tracks by full path, so without this
  // every track in a subfolder fails to load with "forbidden path".
  const path = await open({ multiple: false, directory: true, recursive: true, title });
  return typeof path === "string" ? path : null;
}

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

/** Tauri only: read a file's bytes (library playback — path came from a scan
 * under a dialog-picked folder, which grants the runtime read scope). */
export async function readBinaryFromPath(path: string): Promise<Uint8Array> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  return readFile(path);
}

/** One entry from the Rust library scanner (lofty-tagged audio file). */
export interface LibraryTrack {
  path: string;
  fileName: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationSec: number | null;
}

/** Tauri only: recursively scan a folder for audio files + tags (Rust side —
 * walkdir + lofty; broken files degrade to filename-only entries). */
export async function scanAudioLibrary(dir: string): Promise<LibraryTrack[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LibraryTrack[]>("scan_audio_library", { dir });
}

export interface LoopbackInfo {
  sampleRate: number;
  channels: number;
  device: string;
}

/**
 * Tauri only: start WASAPI loopback capture of the default output device.
 * `onChunk` receives interleaved STEREO f32 little-endian sample buffers.
 * Raw channel payloads normally arrive as ArrayBuffer; the other shapes are
 * handled defensively (IPC encodings have varied across Tauri versions).
 */
export async function startLoopback(onChunk: (chunk: ArrayBuffer) => void): Promise<LoopbackInfo> {
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const ch = new Channel<ArrayBuffer | Uint8Array | number[]>();
  ch.onmessage = (data) => {
    if (data instanceof ArrayBuffer) {
      onChunk(data);
    } else if (data instanceof Uint8Array) {
      onChunk(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
    } else if (Array.isArray(data)) {
      onChunk(new Uint8Array(data).buffer);
    }
  };
  return invoke<LoopbackInfo>("start_loopback", { onSamples: ch });
}

/** Tauri only: stop loopback capture (idempotent). */
export async function stopLoopback(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("stop_loopback");
}

// --- ProRes ffmpeg sidecar (desktop only) ---
// The Rust side owns the process and builds all arguments; these wrappers
// move bytes. Raw payloads (Uint8Array) skip JSON serialization entirely.

export async function proresSetAudio(wav: Uint8Array): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("prores_set_audio", wav);
}

export async function proresBegin(fps: number, outPath: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("prores_begin", { fps, outPath });
}

/** Begin a GIF/animated-WebP session (no audio). Frames flow through the
 * same proresWrite/Finish/Abort — one sidecar session at a time. */
export async function animBegin(
  format: "gif" | "webp",
  fps: number,
  outPath: string,
): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("anim_begin", { format, fps, outPath });
}

export async function proresWrite(frame: Uint8Array): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("prores_write", frame);
}

/** Close the frame pipe, wait for ffmpeg, verify success. */
export async function proresFinish(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("prores_finish");
}

export async function proresAbort(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("prores_abort");
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

const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v", "mkv"];
const VIDEO_MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};

/** Pick a video and return it as a data URL (embeds into projects — clips are
 * expected to be short background loops). */
export async function openVideoFile(): Promise<{ name: string; dataUrl: string } | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Videos", extensions: VIDEO_EXTENSIONS }],
    });
    if (typeof path !== "string") return null;
    const bytes = await readFile(path);
    const name = path.split(/[\\/]/).pop() ?? path;
    const ext = name.split(".").pop()?.toLowerCase() ?? "mp4";
    return { name, dataUrl: bytesToDataUrl(bytes, VIDEO_MIME_BY_EXT[ext] ?? "video/mp4") };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = VIDEO_EXTENSIONS.map((e) => `.${e}`).join(",");
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

const AUTOSAVE_FILE = "autosave.avproj";

/** Tauri only: crash-safe autosave of the current project to app data. */
export async function writeAutosave(contents: string): Promise<void> {
  if (!isTauri()) return; // browser sessions persist via localStorage already
  const { writeTextFile, mkdir, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => undefined);
  await writeTextFile(AUTOSAVE_FILE, contents, { baseDir: BaseDirectory.AppData });
}

/**
 * The other half of the autosave: read back what the last session left behind.
 * Returns null when there is nothing to recover (browser, no file, or an
 * unreadable one) — recovery is strictly best-effort and must never block boot.
 */
export async function readAutosave(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { readTextFile, exists, BaseDirectory } = await import("@tauri-apps/plugin-fs");
    if (!(await exists(AUTOSAVE_FILE, { baseDir: BaseDirectory.AppData }))) return null;
    return await readTextFile(AUTOSAVE_FILE, { baseDir: BaseDirectory.AppData });
  } catch (e) {
    console.warn("[autosave] could not read", e);
    return null;
  }
}

/** Drop the autosave — the user declined recovery, or it has been applied. */
export async function clearAutosave(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { remove, BaseDirectory } = await import("@tauri-apps/plugin-fs");
    await remove(AUTOSAVE_FILE, { baseDir: BaseDirectory.AppData });
  } catch {
    // Already gone, or locked — nothing to do.
  }
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
