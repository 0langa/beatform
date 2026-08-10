/** Single source of the app version for UI + file metadata.
 *
 * RELEASE RITUAL — this is the FIFTH version file and the one that is easy to
 * forget, because nothing typechecks it against the others. Bump all five
 * together: package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml,
 * src-tauri/Cargo.lock (the `beatform` package entry) and this file.
 *
 * It is not cosmetic: it renders in the Help modal (what users quote in bug
 * reports) and is stamped into every autosave, .bfproj and .bftheme the app
 * writes, so a stale value corrupts provenance and support triage.
 *
 * NOT .bfpreset — this comment used to list it, wrongly:
 * serializeUserPreset writes exactly three fields — schemaVersion, kind,
 * preset — and no app version at all, so a shared look carries no provenance
 * to be stale. Adding one is a change to a public persisted file format and
 * is the owner's call; the comment was corrected to match the code rather
 * than the code changed to match the comment.
 *
 * This file drifted ten releases stale once (shipped 2.28.1 through 2.36.1
 * while claiming 2.28.1). `version.test.ts` now asserts this constant equals
 * package.json's version, so a missed bump fails CI instead of shipping.
 */
export const APP_VERSION = "2.90.0";
