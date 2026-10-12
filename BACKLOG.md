# BACKLOG — the live work ledger

Canonical ledger (per CLAUDE.md): read before feature work, update when
finishing. Reset **2026-10-12 at the v3.0.0 cut.** Everything closed before
that day is frozen verbatim under **[archive/ledgers/](archive/ledgers/)**
(`BACKLOG-through-v3.0.0.md` holds the whole "nothing half-done" program with
every verdict and the release evidence; `V3-RELEASE-PLAN.md` the plan that
carried it; earlier eras in their own files) — consult for context; never
reopen rows from it. User-facing history lives in CHANGELOG.md; process
memory in the agents' memory stores.

Rules unchanged: never rename a persisted ID without a migration; new modes
follow registry + grid + matrix re-bless discipline; GATES.md is canonical for
"done"; quality over speed.

## Where the project stands

**v3.0.0 "Beatform 3.0" shipped 2026-10-12** — the stable cut after which the
project sits. Twenty modes, frame-exact exports, local lyrics, live
performance, the Gallery; every 2.x file opens unchanged. Work that resumes
runs on the 3.x line under the same gates, ledger and determinism law: new
ideas enter HERE (or the external notes queue) and ship through the normal
release ritual — never straight into a release.

## Open

- [ ] **Launch kit** (owner, not a gate) — hero pick, `[SLOT]` fills,
      `[VERIFY]` flags, three screen recordings, posting.
      Kit: `OneDrive\Documents\doc\beatform-launch-kit\`.
- [ ] **TESTING.md D2, the owner's half** — the fresh 3.0.0 install on this
      machine boots (installed-runtime smoke: title, canvas, WebGPU) and
      wrote a clean profile; the owner's eyes on "a demo plays, one short MP4
      exports and decodes" remain. The pre-3.0 app data (looks, prefs,
      autosave, WebView profile) went to the Recycle Bin on the owner's
      decision 2026-10-12; the lyrics models were moved into the fresh
      install so nothing re-downloads.
- **Nothing else is open.** Bugs and ideas go to the external notes queue or
  a new row here; the ledger's one-item-at-a-time discipline continues.

## Trigger-gated (activate on the named trigger, not before)

| Row                                                                                                            | Trigger                                     |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Spout output (share live visuals to Resolume/OBS on-machine)                                                   | A real user with a real rig asks            |
| NDI output (live visuals over LAN)                                                                             | Same                                        |
| macOS / Linux ports (Tauri supports them; WASAPI loopback, registry heal, job objects are Windows-bound today) | Genuine demand — issues/users               |
| Lyrics streaming rework (whole-decode memory ceiling → 90-min limit stands)                                    | A user actually hits the limit meaningfully |
| DSP-001 — DC-offset waveform/trigger behavior                                                                  | A reproducible report                       |
| DSP-002 — Short analyzer history after seek                                                                    | A reproducible report                       |
| Multi-format fan-out per batch track (`formats[]` exists in the model, `startBatch` always passes one)         | A user asks for it                          |

## Known limitations (by-design verdicts — do not "fix" without an owner decision)

- **VIS-001** — Aurora's mirrored hue spread is folded into the mode's
  identity (owner verdict 2026-08-16; Ember Veil is the registry's showcase
  of it).
- **DSP-001 / DSP-002** — see trigger table; recorded behavior, not defects,
  until a report proves user harm.
- **Feedback modes after a live seek** — preview keeps pre-seek history
  (finite for Spectro Falls, indefinite for Overgrowth); exports always
  replay from clip start. Documented in docs/PREVIEW-EXPORT-CONTRACT.md.
- **Batch renders carry no lyrics** — Lyric Stage degrades to its rehearsal
  in batch output (recorded 2.101.0).
- **Builder↔Builder crossfade with two different stacks** is unrepresentable
  (one shared buffer); the active frame's stack wins (services.ts).
- Every DECLARE verdict of the 3.0 half-done inventory (HD-03 batch
  stems/lyrics, HD-11 SRT read-only, HD-14 A-B loop preview-only, HD-15
  unconsumed analysis fields, HD-22 unstamped `.bfpreset` saturation, HD-23
  Canvas2D fallback, Builder's per-layer colour) is written where the user
  meets it — guide, contract doc or code comment — and recorded with its
  evidence in
  [archive/ledgers/BACKLOG-through-v3.0.0.md](archive/ledgers/BACKLOG-through-v3.0.0.md).

## Cleared-work pointer

Everything shipped through **v3.0.0** (2026-10-12) — the 2026-08 quality
program, audit rounds 1 and 2, FEAT-004/005/009, P-1…P-21, the hardening
waves, the "nothing half-done" program (HD-01…HD-24), the beat-sync audit,
the Tunnel travel rework and the 3.0 cut — is recorded with evidence in
[archive/ledgers/](archive/ledgers/README.md).
