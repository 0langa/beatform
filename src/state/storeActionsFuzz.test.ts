import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import type { ModRoute, ModSource } from "./modMatrix";
import type { PostSettings, MotionSettings, BgSettings } from "../render/types";

/**
 * Property fuzzing of the store's ACTION surface (BACKLOG E2, gap (b),
 * surface 3 of 3 — same lane as modMatrixFuzz.test.ts / frameResolveFuzz.
 * test.ts).
 *
 * Unlike the other two surfaces, this one is not fuzzing a pure function:
 * it is fuzzing PUBLIC STORE ACTIONS — `setParam(key, value)`,
 * `updateModRoute(id, patch)`, and friends — whose arguments are typed
 * strings/numbers/objects at compile time only. The type is erased at
 * runtime, and unlike `applyMods`/`resolveActiveFrame` (which trust an
 * ALREADY-VALIDATED `ModRoute[]`/`ParamValues` by documented contract, the
 * same way `applyDocument` trusts an already-validated `ProjectDocument`),
 * these actions are the FIRST place a raw value from a slider, a MIDI CC, a
 * text field, or (as fuzzed here) a hostile caller lands — "the validators
 * should make every action total" is the property under test.
 *
 * Mock rig: the LIGHTEST one already proven sufficient by
 * `slices/projectIOActions.test.ts` for exercising `applyDocument`/`undo`/
 * `redo`/`newProject` (its own comment: "`initApp` is never called here, so
 * `liveCanvas`/`renderer` stay null and `applyDocument`'s renderer-facing
 * calls all take their `getRenderer() ??` / null-canvas early-return
 * branches for free — only `services`' throwing accessor (`getEngine`)
 * needs a mock"). Reused verbatim rather than store.test.ts's heavier rig
 * (overlay/videoBg/fetch mocks) because nothing here calls `initApp` either.
 *
 * Same two disciplines as the other two surfaces: generators cover the
 * REACHABLE alphabet, and every property was MUTATION-CHECKED.
 */

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

vi.mock("./services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => {
    throw new Error("getEngine: not expected without initApp");
  }),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn() })),
  peekAnalyzer: vi.fn(() => null),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

/** Captures `saveProject()`'s real `serializeProject(docOf(get()), ...)`
 * output — the REAL document, not a hand-duplicated field list (docOf
 * itself is a private closure inside store.ts's create() call, not
 * exported; going through the real save action is what avoids drift). */
let savedContents: string | null = null;
vi.mock("./platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./platform")>();
  return {
    ...actual,
    isTauri: vi.fn(() => false),
    readAutosave: vi.fn(async () => null),
    writeAutosave: vi.fn(async () => {}),
    clearAutosave: vi.fn(async () => {}),
    quarantineSupersededAutosave: vi.fn(async () => null),
    saveTextFile: vi.fn(async (_name: string, contents: string) => {
      savedContents = contents;
      return "saved";
    }),
  };
});

vi.mock("./persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./persistence")>();
  return { ...actual, wasPreviousExitClean: vi.fn(() => true) };
});

const { useVizStore } = await import("./store");
const { clearHistory } = await import("./history");
const { validateDocument, parseProject, serializeProject } = await import("./project");

/** Reset to a known-clean document AND a known-clean (empty) history stack,
 * bypassing `record()` entirely (direct `applyDocument`, not `newProject()`)
 * — the same shape `openProject`/`openProjectText` use to guarantee a fresh
 * document starts at undo/redo depth 0. Runs before every property
 * iteration so one fast-check run's damage can never leak into the next. */
function resetStore(): void {
  clearHistory();
  useVizStore.getState().applyDocument(validateDocument({}));
  useVizStore.setState({ undoDepth: 0, redoDepth: 0, error: null });
}

const RUNS = { numRuns: 150, seed: 0x57012e5 };

const PROTO_KEYS = ["__proto__", "constructor", "prototype", "hasOwnProperty", "toString"];

const hostileStringArb = fc.oneof(
  { weight: 5, arbitrary: fc.string() },
  { weight: 2, arbitrary: fc.constantFrom(...PROTO_KEYS) },
  { weight: 1, arbitrary: fc.constant("") },
);

const hostileNumberArb = fc.oneof(
  { weight: 6, arbitrary: fc.double({ min: -1000, max: 1000, noNaN: true }) },
  { weight: 3, arbitrary: fc.constantFrom(NaN, Infinity, -Infinity, -0, 1e308, -1e308) },
);

/** A hostile `Partial<ModRoute>` patch — every field independently possibly
 * present, possibly the wrong type/shape entirely. */
const hostileRoutePatchArb = fc.record(
  {
    amount: fc.oneof(hostileNumberArb, fc.string(), fc.constant(undefined)),
    attack: fc.oneof(hostileNumberArb, fc.string(), fc.constant(undefined)),
    release: fc.oneof(hostileNumberArb, fc.string(), fc.constant(undefined)),
    curve: fc.oneof(fc.constantFrom("exp", "smooth", "linear", "garbage"), fc.constant(undefined)),
    muted: fc.oneof(fc.boolean(), fc.string(), fc.constant(1), fc.constant(undefined)),
    source: fc.oneof(fc.constantFrom("kick", "bass"), hostileStringArb, fc.constant(undefined)),
    param: fc.oneof(hostileStringArb, fc.constant(undefined)),
  },
  { requiredKeys: [] },
);

const hostilePostPatchArb = fc.record(
  {
    bloom: fc.oneof(hostileNumberArb, fc.constant(undefined)),
    bloomThreshold: fc.oneof(hostileNumberArb, fc.constant(undefined)),
    exposure: fc.oneof(hostileNumberArb, fc.constant(undefined)),
    vignette: fc.oneof(hostileNumberArb, fc.constant(undefined)),
    grain: fc.oneof(hostileNumberArb, fc.constant(undefined)),
    chromatic: fc.oneof(hostileNumberArb, fc.constant(undefined)),
    tonemap: fc.oneof(fc.boolean(), fc.constant(undefined)),
  },
  { requiredKeys: [] },
);

const hostileMotionPatchArb = fc.record(
  {
    rotation: fc.oneof(hostileNumberArb, fc.constant(undefined)),
    pulse: fc.oneof(hostileNumberArb, fc.constant(undefined)),
    detail: fc.oneof(hostileNumberArb, fc.constant(undefined)),
    spectrumSmooth: fc.oneof(hostileNumberArb, fc.constant(undefined)),
  },
  { requiredKeys: [] },
);

/** Every numeric own-property of an object, recursively one level (enough
 * for ParamValues/PostSettings/MotionSettings, which are flat bags). */
function firstNonFiniteField(o: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "number" && !Number.isFinite(v)) return `${k}=${v}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Property 1: no action throws on hostile args, for a curated set of
// document-mutating actions taking primitive/object arguments.
// ---------------------------------------------------------------------------

describe(
  "store actions property fuzz: no action throws on hostile args",
  { timeout: 30_000 },
  () => {
    /**
     * FINDING, FIXED (see setParam in store.ts): a non-finite `value` used to
     * be written straight into `activeParams`/`paramsByPreset` — the LIVE
     * render params, read directly by the renderer per CLAUDE.md's own
     * architecture note. MUTATION-CHECK for the fix itself: the guard this
     * property exists to hold is `Number.isFinite(value)` at the top of
     * setParam; removing it reproduces the finding (see FINDINGS below for
     * the full trace and the fix's own red/green).
     */
    it("setParam never leaves a non-finite value in the live params", () => {
      fc.assert(
        fc.property(hostileStringArb, hostileNumberArb, (key, value) => {
          resetStore();
          useVizStore.getState().setParam(key, value);
          const bad = firstNonFiniteField(useVizStore.getState().activeParams);
          if (bad) throw new Error(`activeParams.${bad}`);
        }),
        RUNS,
      );
    });

    /**
     * FINDING, FIXED (see updateModRoute in stemsModsActions.ts): `patch` used
     * to be merged with a bare `{ ...r, ...patch }`, no validation — the
     * resulting route (in `activeMods`/`modsByPreset`) could carry a
     * non-finite `amount`/`attack`/`release`, an unrecognized `curve`, or (via
     * `source`) reach modMatrix's `sourceValue` with a hostile string —
     * Surface 1's real finding was reached FROM here. MUTATION-CHECK is this
     * fix's own red/green; see FINDINGS below.
     */
    it("updateModRoute never leaves an invalid route in activeMods", () => {
      fc.assert(
        fc.property(hostileStringArb, hostileRoutePatchArb, (id, patch) => {
          resetStore();
          useVizStore.getState().addModRoute("kick", "hue");
          const before = useVizStore.getState().activeMods;
          const realId = before[0]?.id ?? id; // exercise both a real id and a fuzzed miss
          useVizStore.getState().updateModRoute(realId, patch as Partial<ModRoute>);
          for (const r of useVizStore.getState().activeMods) {
            if (typeof r.amount !== "number" || !Number.isFinite(r.amount)) {
              throw new Error(`route ${r.id} amount=${r.amount}`);
            }
            if (
              r.attack !== undefined &&
              (typeof r.attack !== "number" || !Number.isFinite(r.attack))
            ) {
              throw new Error(`route ${r.id} attack=${r.attack}`);
            }
            if (
              r.release !== undefined &&
              (typeof r.release !== "number" || !Number.isFinite(r.release))
            ) {
              throw new Error(`route ${r.id} release=${r.release}`);
            }
            if (r.curve !== undefined && !["linear", "exp", "smooth"].includes(r.curve)) {
              throw new Error(`route ${r.id} curve=${r.curve}`);
            }
          }
        }),
        RUNS,
      );
    });

    /**
     * FINDING, FIXED (see setPost in store.ts): same unvalidated-patch shape
     * as setParam/updateModRoute, one layer up — `post` feeds
     * `getRenderer()?.setPost(post)` directly, the SAME "reaches a GPU
     * uniform with nothing between the action and the renderer" class.
     */
    it("setPost never leaves a non-finite value in post settings", () => {
      fc.assert(
        fc.property(hostilePostPatchArb, (patch) => {
          resetStore();
          useVizStore.getState().setPost(patch as Partial<PostSettings>);
          const bad = firstNonFiniteField(
            useVizStore.getState().post as unknown as Record<string, unknown>,
          );
          if (bad) throw new Error(`post.${bad}`);
        }),
        RUNS,
      );
    });

    /** FINDING, FIXED (see setMotion in store.ts): same shape as setPost. */
    it("setMotion never leaves a non-finite value in motion settings", () => {
      fc.assert(
        fc.property(hostileMotionPatchArb, (patch) => {
          resetStore();
          useVizStore.getState().setMotion(patch as Partial<MotionSettings>);
          const bad = firstNonFiniteField(
            useVizStore.getState().motion as unknown as Record<string, unknown>,
          );
          if (bad) throw new Error(`motion.${bad}`);
        }),
        RUNS,
      );
    });

    /**
     * MUTATION-CHECKED, after fixing a stale-read bug in THIS TEST first
     * (recorded honestly, not silently patched): the first draft captured
     * `const s = useVizStore.getState()` once and reused it for the
     * `s.activeMods.length > 0` guard below — but zustand actions read the
     * store's LIVE state via their own internal `get()` regardless of which
     * snapshot reference calls them, so every action call still worked
     * correctly while the GUARD read a permanently-stale (pre-sequence,
     * always-empty) `activeMods`, so `removeModRoute` was never actually
     * exercised. A mutation-check run against that draft (see below) came
     * back green when it should not have — the tell that caught it, not
     * inspection. Fixed by re-fetching `getState()` at each read.
     *
     * With that fixed: removed `removeModRoute`'s `modsByPreset` update
     * (left it as the stale pre-removal map) — RED, `modsByPreset[presetId]`
     * still held the removed route while `activeMods` was empty. Reverted.
     */
    it("the route-list bulk actions never throw and never desync activeMods from modsByPreset[presetId]", () => {
      fc.assert(
        fc.property(
          hostileStringArb,
          hostileStringArb,
          fc.integer({ min: -5, max: 5 }),
          fc.integer({ min: -5, max: 5 }),
          hostileNumberArb,
          (source, param, fromIndex, toIndex, amount) => {
            resetStore();
            // `getState()` fetched fresh before EVERY call, not cached: zustand
            // actions read the store's live state via their own internal
            // `get()` regardless, so a stale `s` wouldn't hide a broken ACTION
            // — but it silently hid a broken ASSERTION on a first draft of
            // this test (the `s.activeMods.length > 0` guard below always read
            // the pre-sequence empty array, so `removeModRoute` was never
            // actually exercised — caught by a mutation-check that stayed
            // green when it should not have; see the property's own comment).
            useVizStore.getState().addModRoute(source as ModSource, param);
            useVizStore.getState().addModRoute("bass" as ModSource, "hue");
            useVizStore.getState().reorderModRoutes(param, fromIndex, toIndex);
            useVizStore.getState().setModRouteAmountsForParam(param, amount);
            useVizStore.getState().clearModRoutesForSource(source as ModSource);
            const before = useVizStore.getState();
            if (before.activeMods.length > 0) {
              useVizStore.getState().removeModRoute(before.activeMods[0].id);
            }
            const after = useVizStore.getState();
            const stored = after.modsByPreset[after.presetId] ?? [];
            expect(stored).toEqual(after.activeMods);
          },
        ),
        RUNS,
      );
    });

    /**
     * NON-VACUITY: a first draft called `setBg`/`setTimeline` with FIXED,
     * valid literals while the test's own name claimed all four actions were
     * exercised "on a hostile id/shape" — only `switchPreset`/`setAspect`
     * actually received fuzzed input, so this property could never have
     * caught anything wrong with the other two. Fixed by fuzzing genuinely
     * malformed `bg`/`timeline` shapes too (missing `color`, non-array
     * `color`, missing `scenes`/`lanes`) — neither action validated its
     * argument at all (`setBg`/`setTimeline` in store.ts were a bare
     * `set(...)` over whatever the caller handed them), so a malformed shape
     * is real hostile input, not a synthetic one.
     *
     * FINDING, FIXED, found by that fuzzing on the FIRST run — not a
     * hypothetical: `setTimeline({ scenes: undefined, lanes: undefined })`
     * threw `TypeError: Cannot read properties of undefined (reading
     * 'length')` in `deriveTimelineEnabled` (`timeline.scenes.length`, no
     * type guard). Fixing ONLY that (an `Array.isArray` guard inside
     * deriveTimelineEnabled — kept, see timeline.ts) was NOT enough: the next
     * property run surfaced a SECOND, deeper crash — the malformed
     * `{ ...timeline, enabled: false }` still got WRITTEN into the store, so
     * the very next action that called `record()` (which reads
     * `s.timeline.scenes` inside `referencedCustomDefs` to compute which
     * custom defs travel with the document) crashed on the now-corrupted live
     * state, nowhere near `setTimeline` itself. Real fix: `setTimeline`
     * normalizes `scenes`/`lanes` to real arrays BEFORE anything stores or
     * reads them, not just before deriving `enabled` — see store.ts. Not
     * reachable via today's only caller (`TimelinePanel.tsx` always builds
     * real arrays), fixed regardless: same standard the other four findings
     * in this file hold every public action to, and it is its own genuine
     * mutation-check pair — the bug WAS the red case, the fix IS the green
     * one, both already exercised above by fixing forward rather than
     * breaking something afterward to prove it.
     */
    it("switchPreset/setBg/setTimeline/setAspect never throw on a hostile id/shape", () => {
      fc.assert(
        fc.property(
          hostileStringArb,
          hostileStringArb,
          fc.record(
            {
              mode: fc.oneof(fc.integer({ min: -2, max: 10 }), fc.constant(NaN)),
              color: fc.oneof(
                fc.array(hostileNumberArb, { minLength: 0, maxLength: 5 }),
                fc.constant(undefined),
              ),
            },
            { requiredKeys: [] },
          ),
          fc.record(
            {
              enabled: fc.oneof(fc.boolean(), fc.constant(undefined)),
              scenes: fc.constant(undefined),
              lanes: fc.constant(undefined),
            },
            { requiredKeys: [] },
          ),
          (id, aspect, bg, timeline) => {
            resetStore();
            const s = useVizStore.getState();
            s.switchPreset(id);
            s.setBg(bg as BgSettings);
            s.setTimeline(timeline as never);
            s.setAspect(aspect as never);
          },
        ),
        RUNS,
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Property 2: the document stays serializable — docOf -> parseProject
// round-trips — after any fuzzed sequence of actions.
// ---------------------------------------------------------------------------

type Call =
  | { k: "setParam"; key: string; value: number }
  | { k: "updateModRoute"; patch: Record<string, unknown> }
  | { k: "addModRoute"; source: string; param: string }
  | { k: "removeModRoute" }
  | { k: "setPost"; patch: Record<string, unknown> }
  | { k: "setMotion"; patch: Record<string, unknown> }
  | { k: "switchPreset"; id: string }
  | { k: "undo" }
  | { k: "redo" };

const callArb: fc.Arbitrary<Call> = fc.oneof(
  fc.record({
    k: fc.constant("setParam" as const),
    key: hostileStringArb,
    value: hostileNumberArb,
  }),
  fc.record({ k: fc.constant("updateModRoute" as const), patch: hostileRoutePatchArb }),
  fc.record({
    k: fc.constant("addModRoute" as const),
    source: fc.constantFrom("kick", "bass", "rms"),
    param: fc.constantFrom("hue", "size", "glow"),
  }),
  fc.record({ k: fc.constant("removeModRoute" as const) }),
  fc.record({ k: fc.constant("setPost" as const), patch: hostilePostPatchArb }),
  fc.record({ k: fc.constant("setMotion" as const), patch: hostileMotionPatchArb }),
  fc.record({ k: fc.constant("switchPreset" as const), id: hostileStringArb }),
  fc.record({ k: fc.constant("undo" as const) }),
  fc.record({ k: fc.constant("redo" as const) }),
);

function applyCall(call: Call): void {
  const s = useVizStore.getState();
  switch (call.k) {
    case "setParam":
      s.setParam(call.key, call.value);
      return;
    case "updateModRoute": {
      const id = useVizStore.getState().activeMods[0]?.id;
      if (id) s.updateModRoute(id, call.patch as Partial<ModRoute>);
      return;
    }
    case "addModRoute":
      s.addModRoute(call.source as ModSource, call.param);
      return;
    case "removeModRoute": {
      const id = useVizStore.getState().activeMods[0]?.id;
      if (id) s.removeModRoute(id);
      return;
    }
    case "setPost":
      s.setPost(call.patch as Partial<PostSettings>);
      return;
    case "setMotion":
      s.setMotion(call.patch as Partial<MotionSettings>);
      return;
    case "switchPreset":
      s.switchPreset(call.id);
      return;
    case "undo":
      s.undo();
      return;
    case "redo":
      s.redo();
      return;
  }
}

describe("store actions property fuzz: document stays serializable", { timeout: 30_000 }, () => {
  /**
   * MUTATION-CHECKED: this is the SAME red/green pair as the setParam
   * finding above (a non-finite param survives to `docOf`, `JSON.stringify`
   * writes it back as `null`, and `validParamsByPreset` — correctly —
   * drops it on the way back in). With setParam's guard removed, this
   * property does NOT go red (parseProject still succeeds — dropping an
   * unrepresentable field is the documented, accepted degrade every
   * validator in this codebase already uses, same as
   * `persistenceFuzz.test.ts`'s own framing). It is the FIRST property
   * above ("never leaves a non-finite value in the live params") that
   * catches the real defect — an immediate, in-session render corruption,
   * not a round-trip fidelity question. Recorded here so the next reader
   * does not re-expect this property to double as that regression test.
   *
   * MUTATION-CHECK that DOES belong to this property: first attempt tightened
   * `parseProject`'s `schemaVersion > PROJECT_VERSION` ceiling to
   * `>= PROJECT_VERSION` (14) — stayed GREEN, because `serializeProject`
   * writes "the OLDEST schema that can represent the document", and none of
   * this file's fuzzed `Call`s ever touch nebula `saturation`/the renamed
   * "particles" id/shadertoy defs (the only three things that bump the
   * written version past 11) — every document this property ever produces
   * serializes at v11, nowhere near the mutated ceiling. Reachable mutation
   * instead: lowered the FLOOR (`schemaVersion < 1` -> `< 12`), rejecting
   * v11 — the version this build actually writes for every case this
   * property generates. RED: `Missing schema version` on the very first
   * (shrunk-to-trivial) sequence. Reverted.
   */
  it("docOf -> parseProject round-trips (and re-serializes) after any fuzzed action sequence", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(callArb, { minLength: 1, maxLength: 15 }), async (calls) => {
        resetStore();
        for (const call of calls) applyCall(call);
        savedContents = null;
        await useVizStore.getState().saveProject();
        if (savedContents === null) throw new Error("saveProject never called saveTextFile");
        const doc = parseProject(savedContents); // must not throw
        const again = serializeProject(doc, "0.0.0-test");
        parseProject(again); // idempotent: a round-tripped doc round-trips again
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: undo/redo never corrupts — depth conservation <= 100 under
// fuzzed sequences (the ledger records this as already proven BY READING
// history.ts for plain push/pop; this extends it to actual fuzzed replay).
// ---------------------------------------------------------------------------

describe("store actions property fuzz: undo/redo depth conservation", { timeout: 30_000 }, () => {
  /**
   * MUTATION-CHECKED, after fixing TWO vacuity bugs in THIS TEST first, both
   * caught empirically rather than reasoned in advance — the discipline
   * this whole lane is built on, and worth recording in full since neither
   * would have been obvious from reading the test alone:
   *
   * (1) The first draft's "edit" case drew `key` from `fc.constantFrom(
   * "hue", "size", "glow", "opacity")`, four values. `pushHistory`'s own
   * grouping (`key === lastKey && now - lastPushAt < GROUP_MS`) collapses a
   * repeated key into the SAME undo entry, and consecutive steps in a tight
   * synchronous loop land well inside the 800 ms window — so almost every
   * repeat of one of only 4 keys was a no-op push. Fixed by keying each
   * edit off its own position in the array (`param-${i}`), so no two edits
   * in one sequence can ever share a gesture key.
   *
   * (2) Fixing (1) STILL didn't turn the mutation-check red. Root cause,
   * found by directly measuring `fc.array(x, { minLength: 1, maxLength:
   * 150 })`'s actual output over 150 runs at this suite's own seed (a
   * throwaway Node script, not a guess): min length 1, MAX length 12,
   * median 6 — fast-check's default size heuristic does not scale toward
   * `maxLength` at all; `maxLength` is only a ceiling fast-check's default
   * "small" size budget never approaches. Zero of 150 runs produced a
   * sequence anywhere near 100 steps, so the property could not have
   * exercised MAX_DEPTH regardless of how the "edit" case was weighted.
   * Fixed by raising `minLength` to 105 — the only lever that actually
   * forces fast-check to generate sequences past the cap; `maxLength`
   * alone, however large, does not.
   *
   * With BOTH fixed, mutation-checked history.ts's `if (undoStack.length >
   * MAX_DEPTH) undoStack.shift();` cap — but NOT by running this fc.property
   * itself against the mutation: with the cap gone, an already-large
   * sequence (105-150 steps, weighted toward edits) times fast-check's
   * shrink phase (which reruns the property many times hunting a smaller
   * counterexample once ANY run fails) crashed a vitest worker outright
   * ("Worker exited unexpectedly") rather than reporting a clean failure —
   * plausibly memory pressure from many shrink attempts each holding an
   * unbounded, still-growing array of full-document JSON clones. Confirmed
   * the mutation was real, and cheaply, with a deterministic (non-fc)
   * reproduction instead: 110 straight `setParam` calls with distinct keys
   * against the same store/mock rig — RED, `undoDepth=110` (91ms, no
   * shrinking involved) with the cap removed, and passing (`undoDepth=100`,
   * capped) with it restored. `maxLength` tightened from 150 to 120 in the
   * property itself afterward specifically so a REAL future regression
   * here fails cleanly under this same property rather than repeating the
   * crash — a mutation-check that finds a testing hazard is still a real
   * result, not a reason to weaken the property back to something vacuous.
   */
  it("undoDepth + redoDepth never exceeds MAX_DEPTH (100), at every step of a fuzzed sequence", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            {
              // Weighted toward "edit" so undo/redo don't eat into the
              // count of genuinely new pushes before it can reach 100.
              weight: 8,
              arbitrary: fc.record({
                k: fc.constant("edit" as const),
                value: fc.double({ min: -10, max: 10, noNaN: true }),
              }),
            },
            { weight: 1, arbitrary: fc.record({ k: fc.constant("undo" as const) }) },
            { weight: 1, arbitrary: fc.record({ k: fc.constant("redo" as const) }) },
          ),
          // minLength, not just maxLength — see the mutation-check note
          // above for why maxLength alone never gets here. maxLength kept
          // close to minLength (not the file's usual generous ranges) on
          // purpose: a genuine future regression here needs fast-check's
          // shrink phase to stay cheap too, not just the happy path — an
          // unbounded undo stack times a wide length range times dozens of
          // shrink attempts is what crashed a vitest worker outright while
          // hardening this exact property (see the mutation-check note).
          { minLength: 105, maxLength: 120 },
        ),
        (steps) => {
          resetStore();
          steps.forEach((step, i) => {
            const s = useVizStore.getState();
            if (step.k === "edit") s.setParam(`param-${i}`, step.value);
            else if (step.k === "undo") s.undo();
            else s.redo();
            const after = useVizStore.getState();
            if (after.undoDepth < 0 || after.redoDepth < 0) {
              throw new Error(`negative depth: undo=${after.undoDepth} redo=${after.redoDepth}`);
            }
            const sum = after.undoDepth + after.redoDepth;
            if (sum > 100) {
              throw new Error(`undo(${after.undoDepth})+redo(${after.redoDepth})=${sum} > 100`);
            }
          });
        },
      ),
      // Own (smaller) numRuns, not the shared RUNS: each run replays up to
      // 150 real store actions (a full document JSON-clone per push, see
      // history.ts's snapshotForHistory) — 150 x 150 took 16s clean, and a
      // genuine failure's shrink phase multiplies that considerably (a
      // first attempt at finding this test's own mutation-check hung well
      // past two minutes before being killed and re-measured with a
      // deterministic, non-fc reproduction instead). 25 runs keeps both the
      // happy path AND any future red comfortably inside this describe's
      // 30s budget.
      { numRuns: 25, seed: RUNS.seed },
    );
  });

  /**
   * MUTATION-CHECKED: changed `popRedo` to push the popped-from-redo
   * snapshot back using `redoStack.push(current)` instead of
   * `undoStack.push(...)` (redo no longer moves its entry back to undo) —
   * RED: after undo() then redo(), `undoDepth` stayed 0 instead of
   * returning to 1 — a real corruption (redo silently stops being
   * reachable by Ctrl+Z again). Reverted.
   */
  it("a full undo then redo round-trip restores the exact pre-undo document and depths", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("hue", "size", "glow"),
        fc.double({ min: -10, max: 10, noNaN: true }),
        (key, value) => {
          resetStore();
          const before = useVizStore.getState();
          expect(before.undoDepth).toBe(0);
          useVizStore.getState().setParam(key, value);
          const afterEdit = useVizStore.getState();
          expect(afterEdit.undoDepth).toBe(1);
          expect(afterEdit.redoDepth).toBe(0);
          useVizStore.getState().undo();
          const afterUndo = useVizStore.getState();
          expect(afterUndo.undoDepth).toBe(0);
          expect(afterUndo.redoDepth).toBe(1);
          useVizStore.getState().redo();
          const afterRedo = useVizStore.getState();
          expect(afterRedo.undoDepth).toBe(1);
          expect(afterRedo.redoDepth).toBe(0);
          // Plain `===`, not `toBe`/`toEqual`: NOT a corruption — both of
          // those matchers use `Object.is` internally and so distinguish -0
          // from +0, and `snapshotForHistory`'s `JSON.parse(JSON.
          // stringify(doc))` (an intentional deep-clone, see history.ts)
          // normalizes -0 to +0 the same way JSON has no non-finite-number
          // literal (the exact fact persistenceFuzz.test.ts documents for
          // NaN/Infinity — this is its -0 sibling). `===` treats -0 and +0
          // as equal, which is the numerically correct comparison for a
          // value that only ever round-tripped through undo+redo.
          if (afterRedo.activeParams[key] !== afterEdit.activeParams[key]) {
            throw new Error(
              `${afterRedo.activeParams[key]} !== ${afterEdit.activeParams[key]} after undo+redo`,
            );
          }
        },
      ),
      RUNS,
    );
  });
});
