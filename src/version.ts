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
 * .bfpreset joined that list on 2026-08-13 (owner call closing the v14
 * packet's open question): serializeUserPreset stamps `appVersion` into the
 * file envelope — provenance for future semantics changes, deliberately
 * never a parse gate. Files from 2.92.x and earlier carry no stamp. This
 * comment once claimed the stamp existed when it did not; the claim became
 * true only when the code changed, and userPresets.test.ts pins it.
 *
 * This file drifted ten releases stale once (shipped 2.28.1 through 2.36.1
 * while claiming 2.28.1). `version.test.ts` now asserts this constant equals
 * package.json's version, so a missed bump fails CI instead of shipping.
 */
export const APP_VERSION = "2.106.0";
