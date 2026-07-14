import { bytesToDataUrl } from "../state/platform";
import type { OverlayMeta } from "../render/overlay";

/**
 * Reading a track's own title/artist/cover out of its tags.
 *
 * One reader, used by both the live loader and the batch queue, so the titles
 * a batch writes are by construction the ones the app would have shown.
 */

/** "Artist - Title.mp3" → meta; otherwise the basename becomes the title. */
export function metaFromFilename(name: string): OverlayMeta {
  const base = name.replace(/\.[a-z0-9]+$/i, "").trim();
  const dash = base.indexOf(" - ");
  if (dash > 0) {
    return { artist: base.slice(0, dash).trim(), title: base.slice(dash + 3).trim() };
  }
  return { title: base, artist: "" };
}

export interface TrackMetaResult {
  meta: OverlayMeta;
  /** False when nothing usable was tagged and the filename was guessed from. */
  fromTags: boolean;
  coverArt: string | null;
  duration: number | null;
}

/**
 * Tags first, filename as the fallback. Never throws — unreadable tags just
 * leave the filename guess standing.
 *
 * `duration` defaults to FALSE and must stay that way on the interactive path:
 * a VBR MP3 without a Xing/VBRI header forces music-metadata to scan the whole
 * file to compute it, which is seconds on a long track. The batch opts in,
 * because it needs the duration for its progress estimate and pays the cost
 * once, away from playback.
 */
export async function readTrackMeta(
  file: Blob,
  name: string,
  opts: { duration?: boolean } = {},
): Promise<TrackMetaResult> {
  const guess = metaFromFilename(name);
  try {
    const mm = await import("music-metadata");
    const tags = await mm.parseBlob(file, { duration: opts.duration ?? false });
    const title = tags.common.title?.trim();
    const artist = tags.common.artist?.trim();
    const pic = tags.common.picture?.[0];
    return {
      meta: { title: title || guess.title, artist: artist || guess.artist },
      fromTags: !!(title || artist),
      coverArt: pic ? bytesToDataUrl(pic.data, pic.format || "image/jpeg") : null,
      duration: tags.format.duration ?? null,
    };
  } catch {
    return { meta: guess, fromTags: false, coverArt: null, duration: null };
  }
}
