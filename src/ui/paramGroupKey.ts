/**
 * The one constant `src/state/prefs.ts` and `src/ui/ParamGroups.tsx` must
 * agree on, in a module that depends on NOTHING.
 *
 * Why it is not simply declared in ParamGroups.tsx, where it lived until G4:
 * that file is now store-aware (rows subscribe their own param value), so
 * importing it pulls in `state/store.ts`, which reads `localStorage` at module
 * scope. `prefs.test.ts` is a NODE-environment suite that imported the
 * constant to prove prefs' own hardcoded `"group:"` has not drifted from the
 * UI's — a check worth keeping, and one that must not cost React, the preset
 * registry and every WGSL string to run.
 *
 * Why it is not moved into prefs.ts instead: that would make the drift check
 * compare prefs to itself. Two independent spellings with one test tying them
 * together is the whole point — if they diverge, every collapsed group is
 * silently pruned on the next launch.
 *
 * ParamGroups re-exports this, so the import path every UI caller already uses
 * is unchanged.
 */

/** Prefix for group collapse state inside AppPrefs.collapsedSections. Groups
 * and sections share that one persisted list, so their keys must not collide —
 * no section is ever titled "group:…". */
export const GROUP_KEY = "group:";
