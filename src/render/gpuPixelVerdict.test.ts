import { describe, expect, it } from "vitest";
import {
  compareMatrix,
  signatureError,
  type MatrixCaseRecord,
  type MatrixRecord,
} from "../../scripts/gpu-pixel-verdict.mjs";

/**
 * R2-16 — the STRICT verdict branch, unit-tested in Node with stubbed
 * matrices. The device harness (scripts/gpu-pixel-matrix.mjs) is a thin I/O
 * shell around compareMatrix, so what these tests pin IS what the device
 * gate decides. The regression that mandated strictness: a raw hash delta
 * whose perceptual metrics sat inside the tolerances (rgbMAE<=8,
 * lumaDelta<=8, litDelta<=0.12) used to PASS silently — drift with no
 * witness. Under the strict contract a hash delta always fails and the
 * metrics are demoted to diagnostics.
 */

function sig(bytes: number[]): string {
  // 16x9 RGB = 432 bytes; tests use short buffers — signatureError only
  // requires equal lengths, so a compact signature keeps fixtures readable.
  return Buffer.from(bytes).toString("base64");
}

function caseRecord(over: Partial<MatrixCaseRecord> = {}): MatrixCaseRecord {
  return {
    id: "spectrum-bars/@defaults",
    hash: "aabbccdd",
    signature: sig([10, 20, 30]),
    meanLuma: 42,
    litFraction: 0.5,
    ...over,
  };
}

function matrix(cases: MatrixCaseRecord[]): MatrixRecord {
  return { width: 192, height: 108, cases };
}

describe("compareMatrix strict verdict (R2-16)", () => {
  it("identical matrices pass with no failures and no diagnostics", () => {
    const base = matrix([caseRecord(), caseRecord({ id: "aurora/@defaults", hash: "11112222" })]);
    const run = matrix([caseRecord(), caseRecord({ id: "aurora/@defaults", hash: "11112222" })]);
    expect(compareMatrix(base, run)).toEqual({ failures: [], diagnostics: [] });
  });

  it("a hash delta FAILS even when every perceptual metric is identical (the old silent pass)", () => {
    // Same signature, same luma, same lit fraction — only the raw hash
    // moved. The pre-R2-16 gate called this a pass ('tolerance-only raw
    // hash change'); the strict contract does not.
    const base = matrix([caseRecord({ hash: "aabbccdd" })]);
    const run = matrix([caseRecord({ hash: "aabbccde" })]);
    const verdict = compareMatrix(base, run);
    expect(verdict.failures).toHaveLength(1);
    expect(verdict.failures[0]).toContain("spectrum-bars/@defaults");
    expect(verdict.failures[0]).toContain("raw hash aabbccdd -> aabbccde");
    expect(verdict.failures[0]).toContain("within the old perceptual tolerances");
    // The metrics survive as printed context, not as the gate.
    expect(verdict.failures[0]).toContain("rgbMAE=0.00");
    expect(verdict.diagnostics.join("\n")).toContain("--update");
  });

  it("a hash delta with a large perceptual delta reports the metrics without the tolerance note", () => {
    const base = matrix([
      caseRecord({ hash: "aabbccdd", signature: sig([0, 0, 0]), meanLuma: 10 }),
    ]);
    const run = matrix([
      caseRecord({ hash: "ffff0000", signature: sig([200, 0, 0]), meanLuma: 60 }),
    ]);
    const verdict = compareMatrix(base, run);
    expect(verdict.failures).toHaveLength(1);
    expect(verdict.failures[0]).toContain("lumaDelta=50.00");
    expect(verdict.failures[0]).not.toContain("within the old perceptual tolerances");
  });

  it("equal hashes never fail, whatever the metrics claim", () => {
    // Hash equality is byte equality of the full frame; disagreeing summary
    // metrics on identical hashes would mean a recording bug upstream, and
    // the comparison must not manufacture a pixel failure out of it.
    const base = matrix([caseRecord({ meanLuma: 1 })]);
    const run = matrix([caseRecord({ meanLuma: 200 })]);
    expect(compareMatrix(base, run).failures).toEqual([]);
  });

  it("an added case (unblessed baseline) fails with the case-drift error", () => {
    // Exactly the pre-bless behavior R2-15's builder/@defaults case relies
    // on: enumeration grows, baseline does not, the run refuses.
    const base = matrix([caseRecord()]);
    const run = matrix([caseRecord(), caseRecord({ id: "builder/@defaults" })]);
    const verdict = compareMatrix(base, run);
    expect(verdict.failures).toHaveLength(1);
    expect(verdict.failures[0]).toContain("matrix case drift");
    expect(verdict.failures[0]).toContain("added=builder/@defaults");
  });

  it("a missing case fails with the case-drift error", () => {
    const base = matrix([caseRecord(), caseRecord({ id: "aurora/@defaults" })]);
    const run = matrix([caseRecord()]);
    const verdict = compareMatrix(base, run);
    expect(verdict.failures[0]).toContain("missing=aurora/@defaults");
  });

  it("a size mismatch fails before any case comparison", () => {
    const base = matrix([caseRecord()]);
    const run = { ...matrix([caseRecord()]), width: 384 };
    const verdict = compareMatrix(base, run);
    expect(verdict.failures).toHaveLength(1);
    expect(verdict.failures[0]).toContain("baseline size 192x108, runtime 384x108");
  });
});

describe("signatureError", () => {
  it("mean and max absolute error over the byte pairs", () => {
    expect(signatureError(sig([0, 10, 20]), sig([4, 10, 26]))).toEqual({
      mae: (4 + 0 + 6) / 3,
      max: 6,
    });
  });

  it("length mismatch reads as infinite error", () => {
    expect(signatureError(sig([1, 2]), sig([1, 2, 3]))).toEqual({ mae: Infinity, max: Infinity });
  });
});
