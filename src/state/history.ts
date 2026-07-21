import type { ProjectDocument } from "./project";

/**
 * Undo/redo over document snapshots. The document slice IS ProjectDocument
 * (serializable by design), so history entries are plain snapshots and
 * "apply" is the same code path project files use — one mechanism, no drift.
 *
 * Gesture grouping: pushes with the same key within GROUP_MS collapse into
 * one entry (a slider drag emits dozens of setParam calls; undo should jump
 * back to before the drag, not step through every pixel).
 */
const MAX_DEPTH = 100;
const GROUP_MS = 800;

const undoStack: ProjectDocument[] = [];
const redoStack: ProjectDocument[] = [];
let lastKey = "";
let lastPushAt = -Infinity;

/** Gesture keys that must NEVER group: each invocation is a discrete action a
 * user expects to undo one at a time. Grouping collapsed "add two text layers
 * quickly" into a single undo that removed both, and holding `]` walked dozens
 * of presets under one entry. */
const UNGROUPABLE = new Set(["layer-add", "mod-add", "preset", "delete-preset", "bg-mode"]);

export function snapshotForHistory(doc: ProjectDocument): ProjectDocument {
  // Deep-clone the document, but share the ASSET map by reference. Assets are
  // immutable, content-addressed base64 blobs — an embedded video is tens of
  // megabytes, so cloning them here meant every distinct-key gesture paid a
  // synchronous multi-hundred-millisecond stringify+parse on the thread
  // running the 60 fps loop, up to 100 times over across the two stacks.
  // Reference-sharing is safe precisely because nothing ever mutates an asset
  // in place: pickers replace the map, they don't edit entries.
  const { assets, ...rest } = doc;
  const clone = JSON.parse(JSON.stringify(rest)) as Omit<ProjectDocument, "assets">;
  return { ...clone, assets } as ProjectDocument;
}

/**
 * Record the CURRENT document before a mutation. `key` identifies the
 * gesture (e.g. "param:hue") — repeated pushes with the same key within the
 * grouping window are skipped. `now` is injectable for tests.
 */
export function pushHistory(doc: ProjectDocument, key: string, now = Date.now()): void {
  // Discrete actions share a constant key but are NOT one gesture — grouping
  // them made a second "Add text" within 800 ms un-undoable on its own.
  if (!UNGROUPABLE.has(key) && key === lastKey && now - lastPushAt < GROUP_MS) {
    lastPushAt = now; // extend the gesture window while it continues
    return;
  }
  undoStack.push(snapshotForHistory(doc));
  if (undoStack.length > MAX_DEPTH) undoStack.shift();
  redoStack.length = 0;
  lastKey = key;
  lastPushAt = now;
}

/** Undo: returns the snapshot to apply, pushing `current` onto redo. */
export function popUndo(current: ProjectDocument): ProjectDocument | null {
  const snapshot = undoStack.pop();
  if (!snapshot) return null;
  redoStack.push(snapshotForHistory(current));
  lastKey = ""; // an undo breaks any in-progress gesture grouping
  return snapshot;
}

/** Redo: returns the snapshot to apply, pushing `current` onto undo. */
export function popRedo(current: ProjectDocument): ProjectDocument | null {
  const snapshot = redoStack.pop();
  if (!snapshot) return null;
  undoStack.push(snapshotForHistory(current));
  lastKey = "";
  return snapshot;
}

export function historyDepths(): { undo: number; redo: number } {
  return { undo: undoStack.length, redo: redoStack.length };
}

/** Project open/new: past history no longer applies. */
export function clearHistory(): void {
  undoStack.length = 0;
  redoStack.length = 0;
  lastKey = "";
  lastPushAt = -Infinity;
}
