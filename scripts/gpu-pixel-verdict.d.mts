/**
 * Hand-written declarations for gpu-pixel-verdict.mjs — the repo's tsconfig
 * has no `allowJs`, and src/render/gpuPixelVerdict.test.ts imports the
 * module to unit-test the strict branch. Keep in lockstep with the .mjs.
 */

export interface SignatureErrorResult {
  mae: number;
  max: number;
}

export function signatureError(a64: string, b64: string): SignatureErrorResult;

export interface MatrixCaseRecord {
  id: string;
  hash: string;
  signature: string;
  meanLuma: number;
  litFraction: number;
}

export interface MatrixRecord {
  width: number;
  height: number;
  cases: MatrixCaseRecord[];
}

export interface MatrixVerdict {
  failures: string[];
  diagnostics: string[];
}

export function compareMatrix(baseline: MatrixRecord, matrix: MatrixRecord): MatrixVerdict;
