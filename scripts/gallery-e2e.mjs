// FEAT-003 Gallery E2E: drives the debug shell over CDP against the REAL
// beatform-app/gallery registry on main, through the app's full
// verified-download path — CSP, allowlist, exact-size, SHA-256, parse —
// and proves install effects in the store. P-6 (see below) extends this to
// the 13 built-in factory themes, which never touch that path at all.
//
//   node scripts/gallery-e2e.mjs [--registry=<raw index.json url>]
// Prereq: Vite dev on 127.0.0.1:1420.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnApp, attachWithRecovery, waitHooks, killTree } from "./lib/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// No --registry flag = the app's own default (the LIVE main registry) — the
// exact path every installed build takes. A flag switches to a branch via
// the DEV localStorage override.
const registry = (process.argv.find((a) => a.startsWith("--registry=")) ?? "").slice(
  "--registry=".length,
);
// The live-registry shape these assertions pin (beatform-app/gallery main
// after the 2026-08-14 Track C merge): 13 looks + 5 themes, every entry
// with a preview, and "prism" matching exactly one entry. Count checks are
// growth-tolerant (>= REMOTE_MIN_ENTRIES); the theme count and the one-hit
// search are exact — revisit BOTH whenever the registry moves.
const REMOTE_MIN_ENTRIES = 18;
const REMOTE_THEME_COUNT = 5;
// P-6: the factory pack's 13 themes are now ALWAYS in the dialog's grid,
// merged ahead of the fetched rows — regardless of what the live registry
// answers, including when it fails outright (step 8 below). BUILTIN_COUNT
// is exact and registry-independent (it is compiled into this build, not
// fetched); MIN_ENTRIES/THEME_COUNT fold it into the REMOTE_* numbers above
// for the merged-grid assertions the rest of this file already had.
const BUILTIN_COUNT = 13;
const MIN_ENTRIES = REMOTE_MIN_ENTRIES + BUILTIN_COUNT;
const THEME_COUNT = REMOTE_THEME_COUNT + BUILTIN_COUNT;
const outDir = path.join(root, "node_modules", ".cache", "gallery-e2e");
mkdirSync(outDir, { recursive: true });

let app;
try {
  app = spawnApp({
    root,
    portBase: 9600, // see the map in lib/app.mjs
    profileDir: path.join(outDir, "wv2-profile"),
  });

  // Vite pushes one reload shortly after a cold boot (dep re-optimize /
  // ws reconnect), which destroys the eval context mid-wait — attach,
  // and on that specific failure re-attach once (the v2.68 lesson).
  const cdp = await attachWithRecovery(app, async (c) => {
    await waitHooks(c, ["__store"]);
    await c.eval(
      `(() => {
        const override = ${JSON.stringify(registry)};
        if (override) localStorage.setItem("viz.galleryRegistryOverride", override);
        else localStorage.removeItem("viz.galleryRegistryOverride");
        return true;
      })()`,
      false,
    );
  });

  // 1. Load the registry through the real fetch + validation path.
  const loaded = await cdp.eval(`(async () => {
    const s = window.__store.getState();
    await s.openGallery();
    const st = window.__store.getState();
    return { status: st.galleryStatus, error: st.galleryError,
             count: st.galleryEntries.length,
             ids: st.galleryEntries.map(e => e.id) };
  })()`);
  console.log("REGISTRY:", JSON.stringify(loaded));
  // `galleryEntries`/`galleryPreviews` are REMOTE-only (P-6 deliberately
  // keeps the store's fetched-entry state undiluted by built-ins — see the
  // gallery.ts file header); both checks below stay scoped to
  // REMOTE_MIN_ENTRIES, not the merged MIN_ENTRIES the DOM-level checks use.
  if (loaded.status !== "ready" || loaded.count < REMOTE_MIN_ENTRIES) {
    throw new Error(`registry load failed: ${JSON.stringify(loaded)}`);
  }

  // 2. Previews: hash-verified blob URLs must accumulate.
  const previews = await cdp.eval(`(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const deadline = Date.now() + 60000;
    while (Object.keys(window.__store.getState().galleryPreviews).length < ${REMOTE_MIN_ENTRIES}) {
      if (Date.now() > deadline) break;
      await delay(300);
    }
    const p = window.__store.getState().galleryPreviews;
    return { count: Object.keys(p).length, sample: Object.values(p)[0] ?? null };
  })()`);
  console.log("PREVIEWS:", JSON.stringify(previews));
  if (previews.count < REMOTE_MIN_ENTRIES || !/^blob:/.test(previews.sample ?? "")) {
    throw new Error(`previews incomplete: ${JSON.stringify(previews)}`);
  }

  // 3. Install a LOOK: verified download -> parseUserPreset -> My Looks +
  // applied. A1: galleryInstalled now maps entry id -> the created user
  // preset's id ("Added" is only real while that preset exists).
  const look = await cdp.eval(`(async () => {
    const before = window.__store.getState().userPresets.length;
    await window.__store.getState().installGalleryEntry("prism-cathedral");
    const st = window.__store.getState();
    return { before, after: st.userPresets.length,
             first: st.userPresets[0]?.name ?? null,
             presetId: st.presetId, error: st.error,
             mapsToNewest: st.galleryInstalled["prism-cathedral"] === st.userPresets[0]?.id };
  })()`);
  console.log("LOOK-INSTALL:", JSON.stringify(look));
  if (
    look.after !== look.before + 1 ||
    look.first !== "Prism Cathedral" ||
    look.presetId !== "echo-trails" ||
    !look.mapsToNewest
  ) {
    throw new Error(`look install failed: ${JSON.stringify(look)}`);
  }

  // 3b. A second install while Added must be a NO-OP (A1 — the dup-stacking
  // bug: the clickable "✓ Added" button used to add another copy per click).
  const dup = await cdp.eval(`(async () => {
    const before = window.__store.getState().userPresets.length;
    await window.__store.getState().installGalleryEntry("prism-cathedral");
    return { before, after: window.__store.getState().userPresets.length };
  })()`);
  console.log("LOOK-DUP:", JSON.stringify(dup));
  if (dup.after !== dup.before) {
    throw new Error(`duplicate install stacked a copy: ${JSON.stringify(dup)}`);
  }

  // 4. Apply a THEME: verified download -> parseTheme -> document applied.
  // A1: themes get NO persistent installed state — only the transient
  // "Applied ✓" (galleryApplied), which clears itself after ~2.5 s.
  const theme = await cdp.eval(`(async () => {
    await window.__store.getState().installGalleryEntry("deep-current");
    const st = window.__store.getState();
    return { presetId: st.presetId, smooth: st.smoothSpectrum, error: st.error,
             applied: st.galleryApplied,
             persistent: st.galleryInstalled["deep-current"] ?? null };
  })()`);
  console.log("THEME-APPLY:", JSON.stringify(theme));
  if (
    theme.presetId !== "nebula" ||
    theme.applied !== "deep-current" ||
    theme.persistent !== null
  ) {
    throw new Error(`theme apply failed: ${JSON.stringify(theme)}`);
  }
  const transient = await cdp.eval(`(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const deadline = Date.now() + 8000;
    while (window.__store.getState().galleryApplied !== null) {
      if (Date.now() > deadline) break;
      await delay(200);
    }
    return { applied: window.__store.getState().galleryApplied };
  })()`);
  console.log("THEME-TRANSIENT:", JSON.stringify(transient));
  if (transient.applied !== null) {
    throw new Error(`transient Applied state never cleared: ${JSON.stringify(transient)}`);
  }

  // 4b. P-6: a BUILT-IN theme applies with no network involved at all — no
  // verified-download step, no galleryBusy — and (unlike a look, and unlike
  // nothing at all before P-6) it must NOT write galleryInstalled: a
  // built-in is not an "install", applying it is idempotent and repeatable
  // exactly like a remote theme, so it rides the SAME galleryApplied signal
  // a remote theme uses and never touches the look-only map.
  const builtin = await cdp.eval(`(async () => {
    const before = window.__store.getState().presetId;
    await window.__store.getState().installGalleryEntry("cover-story");
    const st = window.__store.getState();
    return {
      before, after: st.presetId,
      applied: st.galleryApplied,
      installedAsLook: "cover-story" in st.galleryInstalled,
      busy: st.galleryBusy,
      error: st.error,
    };
  })()`);
  console.log("BUILTIN-APPLY:", JSON.stringify(builtin));
  if (
    builtin.after !== "bass-circle" ||
    builtin.applied !== "cover-story" ||
    builtin.installedAsLook ||
    builtin.busy !== null
  ) {
    throw new Error(`built-in apply failed: ${JSON.stringify(builtin)}`);
  }

  // 5. The dialog surface: top-bar button state -> dialog, cards, filter,
  // search — the UI the user actually touches.
  const dom = await cdp.eval(`(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const st = window.__store.getState();
    document.querySelector(".update-hero-close")?.click();
    if (window.__store.getState().recoveredDoc) st.dismissAutosave();
    st.setShowGallery(true);
    await delay(600);
    const cards = () => document.querySelectorAll(".gallery-dialog .gallery-card").length;
    const all = cards();
    const chips = [...document.querySelectorAll(".gallery-toolbar .style-chip")];
    chips.find(c => c.textContent === "Themes")?.click();
    await delay(250);
    const themes = cards();
    chips.find(c => c.textContent === "All")?.click();
    const inp = document.querySelector(".gallery-search");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(inp, "prism");
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    await delay(250);
    const searched = cards();
    setter.call(inp, "");
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    await delay(200);
    // P-6: built-ins are merged AHEAD of the fetched rows — order-independent
    // of which built-in is first (that is an internal factoryThemes.ts
    // detail this script should not couple to), so this checks that the
    // first BUILTIN_COUNT cards are ALL badged, rather than naming one.
    const cardEls = [...document.querySelectorAll(".gallery-dialog .gallery-card")];
    const leadingBuiltins = cardEls
      .slice(0, ${BUILTIN_COUNT})
      .every(c => c.querySelector(".gallery-builtin-badge") !== null);
    return { all, themes, searched, leadingBuiltins,
             builtinBadges: document.querySelectorAll(".gallery-dialog .gallery-builtin-badge").length,
             imgs: document.querySelectorAll(".gallery-dialog .gallery-preview[src^='blob:']").length };
  })()`);
  if (
    dom.all < MIN_ENTRIES ||
    dom.themes !== THEME_COUNT ||
    dom.searched !== 1 ||
    dom.builtinBadges !== BUILTIN_COUNT ||
    !dom.leadingBuiltins
  ) {
    throw new Error(`dialog surface failed: ${JSON.stringify(dom)}`);
  }
  console.log("DOM:", JSON.stringify(dom));
  await cdp.shot(path.join(outDir, "gallery-panel.png"));
  console.log("SHOT", path.join(outDir, "gallery-panel.png"));

  // 6. A1 in the DOM: the installed look reads "✓ Added" and is DISABLED;
  // deleting that look through the store flips the same card back to a live
  // "+ Add look" (the dialog re-checks userPresets, not the stale record).
  const revert = await cdp.eval(`(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const inp = document.querySelector(".gallery-search");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(inp, "prism");
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    await delay(250);
    const btn = () => document.querySelector(".gallery-dialog .gallery-install-btn");
    const beforeTxt = btn()?.textContent ?? null;
    const beforeDisabled = !!btn()?.disabled;
    const st = window.__store.getState();
    st.deleteUserPreset(st.galleryInstalled["prism-cathedral"]);
    await delay(250);
    const afterTxt = btn()?.textContent ?? null;
    const afterDisabled = !!btn()?.disabled;
    setter.call(inp, "");
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    await delay(200);
    return { beforeTxt, beforeDisabled, afterTxt, afterDisabled };
  })()`);
  console.log("LOOK-REVERT:", JSON.stringify(revert));
  if (
    revert.beforeTxt !== "✓ Added" ||
    !revert.beforeDisabled ||
    revert.afterTxt !== "+ Add look" ||
    revert.afterDisabled
  ) {
    throw new Error(`added-state revert failed: ${JSON.stringify(revert)}`);
  }

  // 7. A3 deep links: reopening via setShowGallery(true, "theme") lands
  // pre-filtered on Themes; a plain open resets the filter to All.
  const deeplink = await cdp.eval(`(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const st = window.__store.getState();
    // Real close-then-reopen: back-to-back set calls batch into one React
    // render and the dialog would never remount (its filter state is read
    // once, on mount) — the delay makes the unmount actually happen.
    st.setShowGallery(false);
    await delay(100);
    st.setShowGallery(true, "theme");
    await delay(300);
    const filtered = document.querySelectorAll(".gallery-dialog .gallery-card").length;
    const active = document.querySelector(".gallery-toolbar .style-chip.active")?.textContent;
    st.setShowGallery(false);
    await delay(100);
    st.setShowGallery(true);
    await delay(300);
    const plain = document.querySelectorAll(".gallery-dialog .gallery-card").length;
    st.setShowGallery(false);
    return { filtered, active, plain };
  })()`);
  console.log("DEEPLINK:", JSON.stringify(deeplink));
  if (
    deeplink.filtered !== THEME_COUNT ||
    deeplink.active !== "Themes" ||
    deeplink.plain < MIN_ENTRIES
  ) {
    throw new Error(`deep-link filter failed: ${JSON.stringify(deeplink)}`);
  }

  // 8. P-6 "offline always": built-ins render even when the registry fetch
  // fails outright. Before P-6 the error state replaced the WHOLE dialog
  // body; this is the direct regression test for the trap the P-6 design
  // note calls out by name as the piece most likely to be missed, because
  // "show the built-ins" reads like it is already handled the moment the
  // ready-state grid works.
  const offline = await cdp.eval(`(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const st = window.__store.getState();
    localStorage.setItem(
      "viz.galleryRegistryOverride",
      "https://raw.githubusercontent.com/beatform-app/gallery/main/p6-e2e-404-${Date.now()}.json",
    );
    // Step 7 left the dialog CLOSED (GalleryDialog only mounts while
    // showGallery is true) — reopen it so there is a DOM to read at all.
    // Status is "ready" from step 1, not "idle", so setShowGallery's own
    // idle-triggered fetch will NOT fire; openGallery() is called explicitly.
    st.setShowGallery(true);
    await delay(150);
    await window.__store.getState().openGallery();
    await delay(500);
    const after = window.__store.getState();
    return {
      status: after.galleryStatus,
      remoteCount: after.galleryEntries.length,
      cards: document.querySelectorAll(".gallery-dialog .gallery-card").length,
      badges: document.querySelectorAll(".gallery-dialog .gallery-builtin-badge").length,
      errorVisible: document.querySelector(".gallery-error")?.textContent ?? null,
    };
  })()`);
  console.log("OFFLINE-BUILTINS:", JSON.stringify(offline));
  if (
    offline.status !== "error" ||
    offline.remoteCount !== 0 ||
    offline.cards !== BUILTIN_COUNT ||
    offline.badges !== BUILTIN_COUNT ||
    !offline.errorVisible
  ) {
    throw new Error(`offline built-ins failed: ${JSON.stringify(offline)}`);
  }

  // Restore: clear the override and reload the real registry, so the
  // harness exits with the store in the same working state it would be in
  // after a normal run (and so a screenshot/inspection after this point,
  // if anyone adds one, is not looking at a deliberately broken registry).
  const restored = await cdp.eval(`(async () => {
    localStorage.removeItem("viz.galleryRegistryOverride");
    window.__store.getState().setShowGallery(false);
    await window.__store.getState().openGallery();
    const after = window.__store.getState();
    return { status: after.galleryStatus, count: after.galleryEntries.length };
  })()`);
  console.log("RESTORED:", JSON.stringify(restored));
  if (restored.status !== "ready" || restored.count < REMOTE_MIN_ENTRIES) {
    throw new Error(`registry restore failed: ${JSON.stringify(restored)}`);
  }

  console.log("GALLERY-E2E OK");
} finally {
  killTree(app);
}
