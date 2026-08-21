/**
 * Pure verdict logic for the GPU pixel matrix — extracted from
 * gpu-pixel-matrix.mjs (R2-16) so Node unit tests
 * (src/render/gpuPixelVerdict.test.ts) can drive the strict branch without a
 * device, and the device script stays a thin I/O shell around the exact
 * decisions the tests pin.
 *
 * STRICT CONTRACT (owner verdict, R2-16): ANY raw pixel-hash delta fails the
 * run — even when every perceptual metric sits inside the old tolerances.
 * The perceptual metrics (16x9 RGB signature error, mean-luma delta,
 * lit-fraction delta) are kept as printed DIAGNOSTICS on each failing case
 * so a human can judge the magnitude; they gate nothing anymore. `--update`
 * is the only bless path, and GATES.md §3 carries the re-bless protocol.
 */

/** Mean/max absolute error between two base64-encoded 16x9 RGB signatures. */
export function signatureError(a64, b64) {
  const a = Buffer.from(a64, "base64");
  const b = Buffer.from(b64, "base64");
  if (a.length !== b.length) return { mae: Infinity, max: Infinity };
  let sum = 0;
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    sum += d;
    if (d > max) max = d;
  }
  return { mae: sum / a.length, max };
}

/**
 * Compare a freshly-run matrix against the stored baseline.
 *
 * Returns `{ failures, diagnostics }` — non-empty `failures` means the run
 * FAILS; `diagnostics` are context lines the caller prints either way. Pure:
 * no I/O, no throwing, so the strict branch is unit-testable in Node.
 */
export function compareMatrix(baseline, matrix) {
  const failures = [];
  const diagnostics = [];
  if (baseline.width !== matrix.width || baseline.height !== matrix.height) {
    failures.push(
      `baseline size ${baseline.width}x${baseline.height}, runtime ${matrix.width}x${matrix.height}`,
    );
    return { failures, diagnostics };
  }
  const expected = new Map(baseline.cases.map((entry) => [entry.id, entry]));
  const actual = new Map(matrix.cases.map((entry) => [entry.id, entry]));
  const missing = [...expected.keys()].filter((id) => !actual.has(id));
  const added = [...actual.keys()].filter((id) => !expected.has(id));
  if (missing.length || added.length) {
    failures.push(`matrix case drift; missing=${missing.join(",")} added=${added.join(",")}`);
    return { failures, diagnostics };
  }

  for (const [id, got] of actual) {
    const want = expected.get(id);
    if (got.hash === want.hash) continue;
    // R2-16 STRICT: the hash delta itself is the failure. The perceptual
    // numbers ride along as diagnostics — under the old tolerance gate a
    // delta with rgbMAE<=8, lumaDelta<=8 and litDelta<=0.12 passed silently,
    // which is exactly the class of drift this contract exists to stop.
    const sig = signatureError(got.signature, want.signature);
    const lumaDelta = Math.abs(got.meanLuma - want.meanLuma);
    const litDelta = Math.abs(got.litFraction - want.litFraction);
    const withinOldTolerances = sig.mae <= 8 && lumaDelta <= 8 && litDelta <= 0.12;
    failures.push(
      `${id}: raw hash ${want.hash} -> ${got.hash} ` +
        `(rgbMAE=${sig.mae.toFixed(2)} max=${sig.max} ` +
        `lumaDelta=${lumaDelta.toFixed(2)} litDelta=${litDelta.toFixed(3)}` +
        (withinOldTolerances
          ? "; within the old perceptual tolerances — strict mode fails it anyway"
          : "") +
        `)`,
    );
  }
  if (failures.length) {
    diagnostics.push(
      `STRICT MODE: ${failures.length} raw hash delta(s) fail the matrix regardless of ` +
        `perceptual size. Verify the change visually on device, confirm the moved set is ` +
        `exactly what you touched, then re-bless with --update and justify it in the ` +
        `commit (GATES.md §3).`,
    );
  }
  return { failures, diagnostics };
}
