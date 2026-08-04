// Fetch the pinned ONNX Runtime (DirectML build) + DirectML redistributable
// for the lyrics sidecar's MDX vocal-isolation stage (FEAT-004). Run once
// after cloning (and in CI) before `npm run tauri build`:
//
//   node scripts/fetch-onnxruntime.mjs
//
// Two official Microsoft NuGet packages, both SHA-256-verified at the
// package level BEFORE extraction, then per-DLL verified after:
//  - Microsoft.ML.OnnxRuntime.DirectML 1.22.1 -> onnxruntime.dll (MIT; the
//    `ort` crate in lyrics-sidecar loads it dynamically, api-22)
//  - Microsoft.AI.DirectML 1.15.4 -> DirectML.dll (Microsoft redistributable
//    license: distribution permitted in ML applications on Windows — the
//    in-box Windows DirectML.dll is too old for ORT 1.22's DML EP). Not
//    MIT/Apache: shipped as a clearly-labeled separate redistributable next
//    to the sidecar with its license text, exactly like the LGPL ffmpeg —
//    see THIRD_PARTY_LICENSES.md.
//
// The spike measured DirectML 4-5x faster than sustained CPU for MDX on the
// reference Iris Xe (REPORT.md adjustment 2) — this pair is what makes the
// default GPU path real.
import {
  createWriteStream,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST_DIR = path.join(ROOT, "src-tauri", "binaries", "onnxruntime");

const PACKAGES = [
  {
    name: "Microsoft.ML.OnnxRuntime.DirectML",
    version: "1.22.1",
    url: "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.directml/1.22.1/microsoft.ml.onnxruntime.directml.1.22.1.nupkg",
    approxMb: 18,
    sha256: "210823f9932f81f222e2d05d04531d948a4d75dbf527dfb94195ad61371ab728",
    files: [
      {
        from: "runtimes/win-x64/native/onnxruntime.dll",
        to: "onnxruntime.dll",
        sha256: "f722dd91a311b9fa4b7f2341d22c379a72fb7bc5b639df18b64821f23cdde14b",
      },
      { from: "LICENSE", to: "ONNXRUNTIME-LICENSE.txt" },
    ],
  },
  {
    name: "Microsoft.AI.DirectML",
    version: "1.15.4",
    url: "https://api.nuget.org/v3-flatcontainer/microsoft.ai.directml/1.15.4/microsoft.ai.directml.1.15.4.nupkg",
    approxMb: 193,
    sha256: "4e7cb7ddce8cf837a7a75dc029209b520ca0101470fcdf275c1f49736a3615b9",
    files: [
      {
        from: "bin/x64-win/DirectML.dll",
        to: "DirectML.dll",
        sha256: "9c9e6d822561c6c41b90e6994b3e8857cf1d66dbfb1e0c4c799c7c89b4e92da1",
      },
      { from: "LICENSE.txt", to: "DIRECTML-LICENSE.txt" },
      { from: "ThirdPartyNotices.txt", to: "DIRECTML-ThirdPartyNotices.txt" },
    ],
  },
];

function sha256Of(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const allPresent = PACKAGES.every((p) =>
  p.files.every((f) => existsSync(path.join(DEST_DIR, f.to))),
);
if (allPresent) {
  console.log(`onnxruntime + DirectML already present: ${DEST_DIR}`);
  process.exit(0);
}

const binDir = path.join(ROOT, "src-tauri", "binaries");
mkdirSync(DEST_DIR, { recursive: true });

for (const pkg of PACKAGES) {
  console.log(`Downloading ${pkg.name} ${pkg.version} (~${pkg.approxMb} MB)…`);
  const res = await fetch(pkg.url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  // Expand-Archive refuses the .nupkg extension — it only speaks .zip
  // (a nupkg IS a zip), so the temp file is named accordingly.
  const tmpZip = path.join(binDir, `_${pkg.name}.zip`);
  await pipeline(res.body, createWriteStream(tmpZip));

  const actual = sha256Of(tmpZip);
  if (actual !== pkg.sha256) {
    rmSync(tmpZip, { force: true });
    throw new Error(
      `${pkg.name} checksum mismatch — refusing to extract.\n` +
        `  expected ${pkg.sha256}\n  actual   ${actual}\n` +
        `The pinned package changed on NuGet. Verify upstream before ` +
        `updating this script.`,
    );
  }

  const extractDir = path.join(binDir, `_${pkg.name}_extract`);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  if (process.platform === "win32") {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path '_${pkg.name}.zip' -DestinationPath '_${pkg.name}_extract' -Force`,
      ],
      { cwd: binDir },
    );
  } else {
    execFileSync("unzip", ["-q", `_${pkg.name}.zip`, "-d", `_${pkg.name}_extract`], {
      cwd: binDir,
    });
  }

  for (const f of pkg.files) {
    const src = path.join(extractDir, ...f.from.split("/"));
    if (!existsSync(src)) {
      rmSync(tmpZip, { force: true });
      rmSync(extractDir, { recursive: true, force: true });
      throw new Error(`expected file missing from ${pkg.name}: ${f.from}`);
    }
    // Belt and braces: the package hash already pins the contents, but the
    // DLLs are what actually ship — verify them individually too, BEFORE
    // they land under their final names.
    if (f.sha256) {
      const dllHash = sha256Of(src);
      if (dllHash !== f.sha256) {
        rmSync(tmpZip, { force: true });
        rmSync(extractDir, { recursive: true, force: true });
        throw new Error(
          `${f.from} hash mismatch inside a hash-verified package (?!)\n` +
            `  expected ${f.sha256}\n  actual   ${dllHash}`,
        );
      }
    }
    const tmpDest = path.join(DEST_DIR, `_${f.to}.tmp`);
    copyFileSync(src, tmpDest);
    renameSync(tmpDest, path.join(DEST_DIR, f.to));
  }
  rmSync(tmpZip, { force: true });
  rmSync(extractDir, { recursive: true, force: true });
  console.log(`OK: ${pkg.name} ${pkg.version} (sha256 verified)`);
}

console.log(`OK: ${DEST_DIR}`);
