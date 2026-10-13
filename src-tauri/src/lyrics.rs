//! FEAT-004 local automatic lyrics — the app side of the lyrics sidecar.
//!
//! Three responsibilities, all offline authoring (the render path only ever
//! sees the resulting LRC through the EXISTING import flow):
//!
//! 1. **Model manager**: a pinned manifest (id/bytes/SHA-256) of the models
//!    mirrored on the Beatform-owned GitHub release `beatform-app/models`
//!    tag `v1`. Download with Range-resume into `<appdata>/models`, SHA-256
//!    verified BEFORE the file gains its final name; removal; verify.
//! 2. **Audio staging**: the webview streams the loaded track's WAV in
//!    bounded chunks into %TEMP% (exactly the ProRes mezzanine handshake) so
//!    generation works for every track source — dialog, drag-drop, library.
//! 3. **Job supervision**: spawn the lyrics sidecar with fully-resolved
//!    paths (this process builds every argument — the webview never passes
//!    paths), forward its line-delimited JSON progress over a Channel,
//!    return the finished LRC text. Cancel = one "cancel" line down the
//!    sidecar's stdin (graceful, ack'd within a chunk) with a bounded kill
//!    fallback; app shutdown kills the child (lib.rs window-destroyed hook).
//! 4. **Runtime packs** (2026-10-13): the official whisper.cpp CUDA build,
//!    downloaded on demand like a model (one SHA-256-pinned zip, resumable),
//!    unpacked into `<appdata>/runtimes` with every shipped file pinned too.
//!    The installer stays at its ~60 MB; an NVIDIA owner opts into the 1.1 GB
//!    of CUDA DLLs that make the large whisper models practical.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::Manager;

/// Where the pinned models live. GitHub release assets are mutable in
/// principle — which is why every download is SHA-256-verified against the
/// hashes below (recorded in the FEAT-004 spike's license/hash matrix and
/// cross-checked against the upstream HF LFS oids byte-for-byte). The
/// whisper models are whisper.cpp's own ggml conversions, mirrored here
/// unchanged; an LFS object's oid on Hugging Face IS its SHA-256, so the
/// pins below are those oids. A model that outgrows GitHub's 2 GiB asset
/// cap would need its own base URL again (`ModelSpec::base_url` is per
/// entry for that reason).
const MODELS_BASE_URL: &str = "https://github.com/beatform-app/models/releases/download/v1/";

#[derive(Clone, Copy)]
pub struct ModelSpec {
    pub id: &'static str,
    pub file_name: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
    /// "isolation" (always required) | "whisper-small" | "whisper-medium" |
    /// "whisper-turbo" | "whisper-large" | "alignment" (phase 3 word timing;
    /// part of every tier).
    pub role: &'static str,
    /// Where the file is fetched from (`file_name` is appended).
    pub base_url: &'static str,
}

pub const MODELS: &[ModelSpec] = &[
    ModelSpec {
        id: "mdx-voc-ft",
        file_name: "UVR-MDX-NET-Voc_FT.onnx",
        bytes: 66_762_490,
        sha256: "534b2070fcc7df514b13ef660dc8cbb328679c2374d04354a5c42bb14ecce111",
        role: "isolation",
        base_url: MODELS_BASE_URL,
    },
    ModelSpec {
        id: "whisper-small",
        file_name: "ggml-small.bin",
        bytes: 487_601_967,
        sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
        role: "whisper-small",
        base_url: MODELS_BASE_URL,
    },
    ModelSpec {
        id: "whisper-medium",
        file_name: "ggml-medium.bin",
        bytes: 1_533_763_059,
        sha256: "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
        role: "whisper-medium",
        base_url: MODELS_BASE_URL,
    },
    // The GPU-era tiers (2026-10-13, measured on an RTX 5060 Ti with the CUDA
    // runtime pack): large-v3-turbo transcribes a 4-minute song in ~10 s with
    // a transcript the small model cannot match; large-v3 is the most
    // accurate whisper there is, at ~3x turbo's time and 4.2 GB of VRAM. On
    // the CPU both are slow enough that the UI says so up front.
    // Both mirrored on the Beatform release (uploaded 2026-10-13, the same
    // bytes as whisper.cpp's Hugging Face conversions). Large is the q5_0
    // quantization: GitHub caps a release asset at 2 GiB (the fp16 file is
    // 3.1 GB), and on the seven-song bench the q5 model made 19 wrong lines
    // where the fp16 one made 20 (word error 18 % vs 16 %) at a third of the
    // download and the VRAM.
    ModelSpec {
        id: "whisper-turbo",
        file_name: "ggml-large-v3-turbo.bin",
        bytes: 1_624_555_275,
        sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
        role: "whisper-turbo",
        base_url: MODELS_BASE_URL,
    },
    ModelSpec {
        id: "whisper-large",
        file_name: "ggml-large-v3-q5_0.bin",
        bytes: 1_081_140_203,
        sha256: "d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1",
        role: "whisper-large",
        base_url: MODELS_BASE_URL,
    },
    // Phase-3 word alignment: first-party ONNX export from the Apache-2.0
    // facebook/wav2vec2-base-960h safetensors, MatMul-only dynamic int8
    // (full dynamic quantization FAILS on the weight-norm pos_conv; this
    // recipe is argmax-identical to fp32 — phase-2 prep notes). Uploaded to
    // the same release; GitHub's own asset digests match these bytes.
    ModelSpec {
        id: "wav2vec2-align",
        file_name: "wav2vec2-base-960h-ctc-int8.onnx",
        bytes: 121_925_528,
        sha256: "788e9cef53464fd9229ee5a1b48a307971d8209f2a040439f14c4aec586e15bf",
        role: "alignment",
        base_url: MODELS_BASE_URL,
    },
    ModelSpec {
        id: "wav2vec2-vocab",
        file_name: "wav2vec2-base-960h-vocab.json",
        bytes: 392,
        sha256: "8ae64b2ec10a2ea5c4416ed0394dcad8643b764ef979109fbf5261cb88eb836f",
        role: "alignment",
        base_url: MODELS_BASE_URL,
    },
];

fn spec_by_id(id: &str) -> Result<&'static ModelSpec, String> {
    MODELS
        .iter()
        .find(|m| m.id == id)
        .ok_or(format!("unknown model id: {id}"))
}

/// whisper.cpp's alignment-heads preset for a transcription model — the
/// `-dtw` argument that turns on measured token timestamps (the sidecar adds
/// `-nfa`, which DTW requires). Names are whisper-cli's own table; a model
/// without one runs with whisper's evenly-spread offsets as before.
fn whisper_dtw_preset(role: &str) -> Option<&'static str> {
    match role {
        "whisper-small" => Some("small"),
        "whisper-medium" => Some("medium"),
        "whisper-turbo" => Some("large.v3.turbo"),
        "whisper-large" => Some("large.v3"),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Runtime packs

/// One file of a runtime pack, pinned like a model.
#[derive(Clone, Copy)]
pub struct RuntimeFile {
    pub name: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
}

/// A downloadable runtime: one official zip (pinned by SHA-256, resumable)
/// whose wanted members are unpacked, each verified again against its own
/// pin before it gets its final name.
#[derive(Clone, Copy)]
pub struct RuntimeSpec {
    pub id: &'static str,
    /// Install directory name under `<appdata>/runtimes` — versioned, so an
    /// upgrade of the pin lands beside the old pack instead of over it.
    pub dir_name: &'static str,
    pub zip_url: &'static str,
    pub zip_bytes: u64,
    pub zip_sha256: &'static str,
    /// Members under the zip's `Release/` folder, in extraction order.
    pub files: &'static [RuntimeFile],
}

/// whisper.cpp v1.9.1's official CUDA 12.4 build, the same release as the
/// bundled CPU build (scripts/fetch-whisper.mjs pins the sibling zip): the
/// CLI, the ggml/whisper DLLs, the CPU-variant DLLs ggml still needs for its
/// non-GPU ops, and the three NVIDIA runtime DLLs the CUDA backend links
/// (cudart, cublas, cublasLt — `dumpbin /dependents`, 2026-10-13; the zip's
/// nvrtc/SDL2/demo binaries are not ours to ship). 678 MB down, 1.15 GB on
/// disk. Needs an NVIDIA driver (nvcuda.dll); without one ggml loads no CUDA
/// backend and whisper-cli runs on the CPU, which the sidecar reports.
///
/// Blackwell note: the build carries SASS up to sm_90 plus PTX, so an RTX
/// 50-series card JIT-compiles the kernels on its first run (measured ~90 s
/// once on an RTX 5060 Ti, instant afterwards).
const WHISPER_CUDA_FILES: &[RuntimeFile] = &[
    RuntimeFile {
        name: "whisper-cli.exe",
        bytes: 489_984,
        sha256: "789fddb0f05c0c28043b3c4f3bcf15a0ae839df24292c60f90c4edb8d02a5ab5",
    },
    RuntimeFile {
        name: "whisper.dll",
        bytes: 1_308_160,
        sha256: "0c76791ffda66ce58b6247424ca750a4b1bff12fd52928abb81de3037172ce1b",
    },
    RuntimeFile {
        name: "ggml.dll",
        bytes: 66_560,
        sha256: "3063b832600f58fb0e15af50a9ace99dbc15de02b8cb325df64390bfbcf22796",
    },
    RuntimeFile {
        name: "ggml-base.dll",
        bytes: 641_024,
        sha256: "2fdf1dea0cbab9d796d1a6c2bca672a3784c5faec2f1df2a3812212fa7409747",
    },
    RuntimeFile {
        name: "ggml-cuda.dll",
        bytes: 564_585_984,
        sha256: "bdf5ba84f7014eaa8a4fae7a090ce222edf03432ef8d39d57fb615beea5c68ac",
    },
    RuntimeFile {
        name: "ggml-cpu-alderlake.dll",
        bytes: 789_504,
        sha256: "e9e27720fd14a33e86d13c1c8fee5a6afbf6a702e8472abb84cde23ccb4fb654",
    },
    RuntimeFile {
        name: "ggml-cpu-cannonlake.dll",
        bytes: 833_536,
        sha256: "63c136e823b85e519a2fd5d5085c7f28e9b07a7d23df99b6e2abd05dbcf4b47c",
    },
    RuntimeFile {
        name: "ggml-cpu-cascadelake.dll",
        bytes: 830_976,
        sha256: "9ab872d0e6e0dd6c5becd585cc84e1684ddfc603443904bc007af4a14e4a52fb",
    },
    RuntimeFile {
        name: "ggml-cpu-haswell.dll",
        bytes: 790_528,
        sha256: "cb4b01954b8b7bec4d891024192d3ed80c43102a4d17447ceefc4e183632df1f",
    },
    RuntimeFile {
        name: "ggml-cpu-icelake.dll",
        bytes: 830_976,
        sha256: "e97d8c4744c92e74190979a7d87a690d02d26373724d203722284e1cc837becb",
    },
    RuntimeFile {
        name: "ggml-cpu-sandybridge.dll",
        bytes: 763_904,
        sha256: "695b93cd2a2b4d30c60b722d0ff92870b308af82bf76be45a1ceb9aea8c3f611",
    },
    RuntimeFile {
        name: "ggml-cpu-skylakex.dll",
        bytes: 833_536,
        sha256: "37ee8dd2620aa8e350f50ccc22e3fd3995ef63edb696d42c12830b06ef81ff28",
    },
    RuntimeFile {
        name: "ggml-cpu-sse42.dll",
        bytes: 751_104,
        sha256: "25db1975a6664ae7f77db3bce0ee6f35d4894514717a39cf97f833bf56a7d2c4",
    },
    RuntimeFile {
        name: "ggml-cpu-x64.dll",
        bytes: 752_128,
        sha256: "b338f13d391470fd3dab3029df226f6306ca8140c69bc381725e39507b4d59f4",
    },
    RuntimeFile {
        name: "cudart64_12.dll",
        bytes: 553_984,
        sha256: "d28e42265da7462162a54da6b7a99ea4fa2caf8139d862bb500db875d0b32dfc",
    },
    RuntimeFile {
        name: "cublas64_12.dll",
        bytes: 100_033_536,
        sha256: "e40202fe4223c1cd2d2dce7beec59e1ed61c7801bd827309183be9b50e358f4c",
    },
    RuntimeFile {
        name: "cublasLt64_12.dll",
        bytes: 473_551_360,
        sha256: "2a896460bef60ed57ef32b0875812f355a6984e671d638bb632f5e8c1d7a831f",
    },
];

pub const RUNTIMES: &[RuntimeSpec] = &[RuntimeSpec {
    id: "whisper-cuda",
    dir_name: "whisper-cuda-v1.9.1",
    zip_url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-cublas-12.4.0-bin-x64.zip",
    zip_bytes: 677_887_125,
    zip_sha256: "106a2030eff8998e4ef320fe72e263a78449e9040386ee27c41ea80b001b601b",
    files: WHISPER_CUDA_FILES,
}];

fn runtime_by_id(id: &str) -> Result<&'static RuntimeSpec, String> {
    RUNTIMES
        .iter()
        .find(|r| r.id == id)
        .ok_or(format!("unknown runtime id: {id}"))
}

impl RuntimeSpec {
    /// Bytes the unpacked runtime occupies.
    pub fn installed_bytes(&self) -> u64 {
        self.files.iter().map(|f| f.bytes).sum()
    }

    /// Installed = every file present at its pinned size (the hashes ran at
    /// extraction, before each file got its final name — the model rule).
    fn is_installed_in(&self, dir: &Path) -> bool {
        self.files.iter().all(|f| {
            dir.join(f.name)
                .metadata()
                .map(|m| m.len() == f.bytes)
                .unwrap_or(false)
        })
    }
}

/// Threads for the sidecar's CPU work — the CPU whisper build, the MDX CPU
/// fallback, the aligner's intra-op pool. The PHYSICAL core count, clamped
/// to 4..=16: the old constant 4 was the reference laptop's core count, and
/// a 12-core desktop ran CPU whisper at a third of its speed because of it.
/// Physical, not logical: ggml's matmuls gain nothing from SMT siblings and
/// lose to their cache contention (whisper.cpp's own guidance); 16 is where
/// whisper stops scaling.
fn whisper_threads() -> usize {
    let physical = sysinfo::System::physical_core_count()
        .or_else(|| {
            std::thread::available_parallelism()
                .ok()
                .map(|n| n.get() / 2)
        })
        .unwrap_or(4);
    physical.clamp(4, 16)
}

/// A running sidecar plus everything terminating it has to clean up.
///
/// The slot used to hold a bare `Child`, which meant the abnormal-termination
/// paths (app close, cancel's kill fallback) could end the process but had no
/// idea which files it owned. Both temps then survived forever: `create_temp_new`
/// names are per-pid/per-seq, so no later run ever reclaims them, and the staged
/// mezzanine WAV is the WHOLE decoded track — ~42 MB for a four-minute song,
/// ~635 MB for an hour-long set, on the system drive whose exhaustion the export
/// pre-flight exists to catch. `ProresJob` has carried its paths for exactly this
/// reason; this is the same shape.
///
/// Deliberately NO `Drop` impl: the success path takes the job out of the slot
/// while the LRC still has to be read. Only `end_job` deletes.
pub struct LyricsJob {
    child: Child,
    /// Kills the sidecar's OWN children too — see `proc_tree`.
    tree: proc_tree::ProcessTree,
    /// The staged WAV this job is consuming (generation: the whole track;
    /// --align-line: one line's slice).
    input_path: PathBuf,
    /// The reserved LRC temp. `None` for --align-line, which returns words
    /// over the wire and writes no file.
    lrc_path: Option<PathBuf>,
}

#[derive(Default)]
pub struct LyricsState {
    /// Running sidecar (kill on cancel-timeout / app close). LOCK ORDER where
    /// both are needed: `job` first, then `job_stdin` — same discipline as
    /// ProresState.
    pub job: Mutex<Option<LyricsJob>>,
    /// The sidecar's stdin, held separately so the graceful-cancel write can
    /// never wait behind the supervising read loop.
    pub job_stdin: Mutex<Option<ChildStdin>>,
    /// In-progress chunked audio staging (ProRes mezzanine pattern).
    pub staging: Mutex<Option<(std::fs::File, PathBuf)>>,
    /// Sealed staged WAV waiting for lyrics_generate.
    pub staged: Mutex<Option<PathBuf>>,
    /// One model/runtime download at a time; cancel keeps the .part for resume.
    pub downloading: AtomicBool,
    pub download_cancel: AtomicBool,
    /// Cached GPU probe (None = not probed yet).
    pub gpu_probe: Mutex<Option<GpuProbe>>,
    /// DEBUG BUILDS ONLY: E2E override for the models directory.
    #[cfg(debug_assertions)]
    pub models_dir_override: Mutex<Option<PathBuf>>,
}

// ---------------------------------------------------------------------------
// Path resolution — every binary/resource the sidecar needs, resolved HERE.

/// Bundled resource lookup ("whisper/whisper-cli.exe" etc). Order: the
/// bundle's resource dir, then next to the exe (tauri dev copies resources
/// into the target dir), then — debug builds only — the repo's binaries/
/// folder ABSOLUTE via CARGO_MANIFEST_DIR, so headless E2E runs work no
/// matter the cwd (the relative-path fallback in ffmpeg_path is cwd-fragile).
fn resolve_bundled(app: &tauri::AppHandle, rel: &str) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("binaries").join(rel));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("binaries").join(rel));
            candidates.push(dir.join(rel));
        }
    }
    #[cfg(debug_assertions)]
    candidates.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(rel),
    );
    for c in &candidates {
        if c.is_file() {
            return Ok(c.clone());
        }
    }
    Err(format!(
        "bundled file not found: {rel} — reinstall the app (or run the fetch scripts in dev)"
    ))
}

/// The lyrics sidecar exe (externalBin — lands next to the app exe in
/// bundles AND in `tauri dev`; plus the debug-absolute fallback).
fn sidecar_exe(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("lyrics-sidecar.exe");
            if p.is_file() {
                return Ok(p);
            }
        }
    }
    resolve_bundled(app, "lyrics-sidecar-x86_64-pc-windows-msvc.exe")
}

/// The ffmpeg sidecar, resolved with the same robust chain (prores has its
/// own cwd-relative dev fallback; the lyrics path must survive headless E2E).
fn ffmpeg_exe(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("ffmpeg.exe");
            if p.is_file() {
                return Ok(p);
            }
        }
    }
    resolve_bundled(app, "ffmpeg-x86_64-pc-windows-msvc.exe")
}

fn models_dir(app: &tauri::AppHandle, state: &LyricsState) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        if let Some(dir) = state
            .models_dir_override
            .lock()
            .map_err(|_| "state poisoned")?
            .clone()
        {
            return Ok(dir);
        }
    }
    #[cfg(not(debug_assertions))]
    let _ = state;
    app.path()
        .app_data_dir()
        .map(|d| d.join("models"))
        .map_err(|e| format!("no app data dir: {e}"))
}

/// `<appdata>/runtimes` — a sibling of the models dir, so the E2E override
/// of the models dir moves the runtimes with it.
fn runtimes_dir(app: &tauri::AppHandle, state: &LyricsState) -> Result<PathBuf, String> {
    let models = models_dir(app, state)?;
    Ok(models
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or(models)
        .join("runtimes"))
}

/// The CUDA driver's JIT cache, pinned to a Beatform-owned folder.
///
/// The pack's ggml-cuda.dll carries SASS up to sm_90 and PTX; a newer card
/// (the RTX 50-series is sm_120) compiles that PTX on first use — 40-90 s
/// once on the reference RTX 5060 Ti — and the driver caches the result. By
/// default that cache is the shared `%APPDATA%\NVIDIA\ComputeCache`, capped
/// at about 1 GiB and evicted by every other CUDA program on the PC, so the
/// minute could come back unannounced. Our own folder under the runtimes
/// dir, with the cap raised to the driver's 4 GiB maximum, keeps the
/// compiled kernels for as long as the pack is installed. Both variables
/// are read by the driver in whichever process loads it; whisper-cli
/// inherits them from the sidecar.
pub(crate) const CUDA_CACHE_DIR_NAME: &str = "cuda-cache";
pub(crate) const CUDA_CACHE_MAX_BYTES: u64 = 4 * 1024 * 1024 * 1024;

pub(crate) fn cuda_cache_env(cmd: &mut Command, runtimes: &Path) {
    let dir = runtimes.join(CUDA_CACHE_DIR_NAME);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("[lyrics] could not create {}: {e}", dir.display());
        return;
    }
    cmd.env("CUDA_CACHE_PATH", &dir)
        .env("CUDA_CACHE_MAXSIZE", CUDA_CACHE_MAX_BYTES.to_string());
}

/// The installed CUDA whisper-cli, when the pack is complete; None = use
/// the bundled CPU build.
fn installed_runtime_cli(
    app: &tauri::AppHandle,
    state: &LyricsState,
    id: &str,
) -> Result<Option<PathBuf>, String> {
    let spec = runtime_by_id(id)?;
    let dir = runtimes_dir(app, state)?.join(spec.dir_name);
    Ok(spec
        .is_installed_in(&dir)
        .then(|| dir.join("whisper-cli.exe")))
}

// ---------------------------------------------------------------------------
// Model manager

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelState {
    id: String,
    file_name: String,
    bytes: u64,
    sha256: String,
    role: String,
    installed: bool,
    /// Bytes already on disk in a resumable .part file (0 = none).
    part_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsState {
    models_dir: String,
    models: Vec<ModelState>,
}

/// Manifest + install/resume status. `installed` is a size check — the full
/// hash ran when the file was downloaded (before it got its final name) and
/// can be re-run explicitly via lyrics_model_verify.
#[tauri::command]
pub fn lyrics_models_state(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
) -> Result<ModelsState, String> {
    crate::assert_main_window(&window)?;
    let dir = models_dir(&app, &state)?;
    let models = MODELS
        .iter()
        .map(|m| {
            let path = dir.join(m.file_name);
            let installed = path
                .metadata()
                .map(|meta| meta.len() == m.bytes)
                .unwrap_or(false);
            let part_bytes = dir
                .join(format!("{}.part", m.file_name))
                .metadata()
                .map(|meta| meta.len())
                .unwrap_or(0);
            ModelState {
                id: m.id.into(),
                file_name: m.file_name.into(),
                bytes: m.bytes,
                sha256: m.sha256.into(),
                role: m.role.into(),
                installed,
                part_bytes,
            }
        })
        .collect();
    Ok(ModelsState {
        models_dir: dir.to_string_lossy().into_owned(),
        models,
    })
}

/// SHA-256 of a file, streamed (the medium model is 1.5 GB — never read it
/// into memory whole).
fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    // Hex by hand rather than `{:x}` on the digest: sha2 0.11's output array
    // no longer implements `LowerHex`, and this string is compared `==`
    // against the manifest pins — 64-char lowercase hex, forever. The tests
    // hold it to the FIPS 180-2 vector.
    use std::fmt::Write as _;
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        let _ = write!(hex, "{byte:02x}");
    }
    Ok(hex)
}

/// Re-hash an installed model against the manifest. The E2E harness drives
/// this; the UI uses it for a "verify" affordance on suspicion.
#[tauri::command(async)]
pub fn lyrics_model_verify(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
    id: String,
) -> Result<bool, String> {
    crate::assert_main_window(&window)?;
    let spec = spec_by_id(&id)?;
    let path = models_dir(&app, &state)?.join(spec.file_name);
    if !path.is_file() {
        return Ok(false);
    }
    Ok(sha256_file(&path)? == spec.sha256)
}

#[tauri::command]
pub fn lyrics_model_remove(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
    id: String,
) -> Result<(), String> {
    crate::assert_main_window(&window)?;
    let spec = spec_by_id(&id)?;
    let dir = models_dir(&app, &state)?;
    for name in [
        spec.file_name.to_string(),
        format!("{}.part", spec.file_name),
    ] {
        let p = dir.join(name);
        if p.exists() {
            std::fs::remove_file(&p).map_err(|e| format!("remove {}: {e}", p.display()))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn lyrics_download_cancel(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LyricsState>,
) -> Result<(), String> {
    crate::assert_main_window(&window)?;
    state.download_cancel.store(true, Ordering::SeqCst);
    Ok(())
}

/// RAII guard so the one-download-at-a-time flag can never stay stuck on an
/// early return.
struct DownloadGuard<'a>(&'a LyricsState);
impl Drop for DownloadGuard<'_> {
    fn drop(&mut self) {
        self.0.downloading.store(false, Ordering::SeqCst);
    }
}

/// Download one model with Range-resume, SHA-256-verify, then rename into
/// place. Progress events on the channel as JSON strings
/// `{"id","received","total"}`. Cancel keeps the .part for a later resume.
#[tauri::command]
pub async fn lyrics_model_download(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
    id: String,
    on_progress: tauri::ipc::Channel<String>,
) -> Result<(), String> {
    crate::assert_main_window(&window)?;
    let spec = *spec_by_id(&id)?;
    if state.downloading.swap(true, Ordering::SeqCst) {
        return Err("A model download is already running".into());
    }
    let _guard = DownloadGuard(&state);
    state.download_cancel.store(false, Ordering::SeqCst);

    let dir = models_dir(&app, &state)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create models dir: {e}"))?;
    let final_path = dir.join(spec.file_name);
    let part_path = dir.join(format!("{}.part", spec.file_name));

    // Already installed and intact? Done. Wrong size (torn rename, disk
    // trouble)? Clear it and re-download — self-heal beats a stuck state.
    if let Ok(meta) = final_path.metadata() {
        if meta.len() == spec.bytes {
            return Ok(());
        }
        std::fs::remove_file(&final_path).map_err(|e| e.to_string())?;
    }

    let url = format!("{}{}", spec.base_url, spec.file_name);
    download_part(
        &state,
        spec.id,
        &url,
        &part_path,
        spec.bytes,
        spec.sha256,
        &on_progress,
    )
    .await?;
    std::fs::rename(&part_path, &final_path).map_err(|e| format!("install failed: {e}"))?;
    Ok(())
}

/// 2 s, 4 s, 6 s, 8 s between resume attempts. Parked on the blocking pool
/// rather than a tokio timer: the app has no direct tokio dependency and
/// tauri's runtime handle is enough for a sleep.
async fn resume_backoff(attempt: u32) {
    let wait = Duration::from_secs(2 * u64::from(attempt));
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(wait)).await;
}

/// The download step shared by models and runtime packs: Range-resume `url`
/// into `part_path` (kept on cancel for a later resume), then SHA-256-verify
/// the whole file against `sha256` — a mismatch deletes the part so the next
/// attempt starts clean. Returns with the verified bytes still under the
/// .part name; the caller renames or unpacks.
async fn download_part(
    state: &LyricsState,
    id: &str,
    url: &str,
    part_path: &Path,
    total: u64,
    sha256: &str,
    on_progress: &tauri::ipc::Channel<String>,
) -> Result<(), String> {
    let offset = part_path.metadata().map(|m| m.len()).unwrap_or(0);
    // A .part at (or beyond) full size skips straight to verification —
    // beyond happens when a previous run appended after a 200-not-206.
    if offset < total {
        // reqwest with `rustls-no-provider` PANICS (not Err) on Client build
        // unless a process-level crypto provider is installed first — the
        // updater installs one on its own path, but this download must not
        // depend on the updater having run. Idempotent: install_default errs
        // when one is already set, which is fine either way.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            // Bounded failure beats a wedged download: without these a dead
            // connection hangs chunk().await forever and even cancel (polled
            // between chunks) can never fire.
            .connect_timeout(Duration::from_secs(30))
            .read_timeout(Duration::from_secs(60))
            .build()
            .map_err(|e| e.to_string())?;
        // A connection that dies mid-body is resumed in place, up to
        // RESUME_ATTEMPTS times, from the bytes already on disk: the first
        // 678 MB runtime-pack download on the reference desktop dropped at
        // 320 MB (GitHub closed the stream), and a user who then has to
        // click again has been failed by the app, not the network. Cancel
        // stays immediate; a non-success status (a 404 pin) stays fatal.
        const RESUME_ATTEMPTS: u32 = 4;
        let mut offset = offset;
        let mut attempt = 0u32;
        loop {
            let mut req = client.get(url);
            if offset > 0 {
                req = req.header(reqwest::header::RANGE, format!("bytes={offset}-"));
            }
            let resp = match req.send().await {
                Ok(r) => r,
                Err(_) if attempt < RESUME_ATTEMPTS => {
                    attempt += 1;
                    resume_backoff(attempt).await;
                    continue;
                }
                Err(e) => return Err(format!("download failed (offline?): {e}")),
            };
            let status = resp.status();
            if !status.is_success() {
                return Err(format!("download failed: HTTP {status} for {url}"));
            }
            // 206 = server honored the resume; anything else restarts the file.
            let resumed = status == reqwest::StatusCode::PARTIAL_CONTENT;
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .append(resumed)
                .write(true)
                .truncate(!resumed)
                .open(part_path)
                .map_err(|e| format!("open {}: {e}", part_path.display()))?;
            let mut received = if resumed { offset } else { 0 };
            let mut last_reported = 0u64;
            let mut stream = resp;
            let interrupted = loop {
                if state.download_cancel.load(Ordering::SeqCst) {
                    return Err("cancelled".into());
                }
                let chunk = match stream.chunk().await {
                    Ok(c) => c,
                    Err(e) => break Some(e),
                };
                let Some(chunk) = chunk else { break None };
                file.write_all(&chunk)
                    .map_err(|e| format!("write failed: {e}"))?;
                received += chunk.len() as u64;
                if received - last_reported >= 512 * 1024 || received == total {
                    last_reported = received;
                    let _ = on_progress.send(format!(
                        "{{\"id\":\"{id}\",\"received\":{received},\"total\":{total}}}"
                    ));
                }
            };
            file.flush().map_err(|e| e.to_string())?;
            // A clean EOF short of `total` is a dropped connection too (a CDN
            // closing the stream reads as end-of-body, not as an error).
            match interrupted {
                None if received >= total => break,
                Some(e) if attempt >= RESUME_ATTEMPTS || received >= total => {
                    return Err(format!("download interrupted: {e}"));
                }
                None if attempt >= RESUME_ATTEMPTS => break, // the size check below reports it
                _ => {
                    attempt += 1;
                    offset = received;
                    resume_backoff(attempt).await;
                }
            }
        }
    }

    // Verify BEFORE the artifact gains its final (trusted) name — a mismatch
    // deletes the part so the next attempt starts clean.
    let got = part_path.metadata().map(|m| m.len()).unwrap_or(0);
    if got != total {
        return Err(format!(
            "download incomplete: {got} of {total} bytes — resume by downloading again"
        ));
    }
    let part_for_hash = part_path.to_path_buf();
    let hash = tauri::async_runtime::spawn_blocking(move || sha256_file(&part_for_hash))
        .await
        .map_err(|e| e.to_string())??;
    if hash != sha256 {
        let _ = std::fs::remove_file(part_path);
        return Err(format!(
            "checksum mismatch for {id} — expected {sha256}, got {hash}. The download was discarded; try again."
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Runtime pack manager

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeState {
    id: String,
    dir_name: String,
    installed: bool,
    /// On-disk size of the unpacked runtime.
    bytes: u64,
    /// The download size (the zip).
    zip_bytes: u64,
    /// Bytes already on disk in a resumable zip .part (0 = none).
    part_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimesState {
    runtimes_dir: String,
    runtimes: Vec<RuntimeState>,
}

#[tauri::command]
pub fn lyrics_runtimes_state(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
) -> Result<RuntimesState, String> {
    crate::assert_main_window(&window)?;
    let dir = runtimes_dir(&app, &state)?;
    let runtimes = RUNTIMES
        .iter()
        .map(|r| RuntimeState {
            id: r.id.into(),
            dir_name: r.dir_name.into(),
            installed: r.is_installed_in(&dir.join(r.dir_name)),
            bytes: r.installed_bytes(),
            zip_bytes: r.zip_bytes,
            part_bytes: dir
                .join(format!("{}.zip.part", r.id))
                .metadata()
                .map(|m| m.len())
                .unwrap_or(0),
        })
        .collect();
    Ok(RuntimesState {
        runtimes_dir: dir.to_string_lossy().into_owned(),
        runtimes,
    })
}

/// Unpack the wanted members of a VERIFIED zip into `dir`: each lands under a
/// temp name, is hashed against its own pin, and only then renamed — the
/// model rule, per file. The zip's hash already pins every byte inside it;
/// the per-file check guards the extraction itself (a torn write, a wrong
/// member) and leaves nothing half-trusted under its final name.
fn extract_runtime(zip_path: &Path, dir: &Path, spec: &RuntimeSpec) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| format!("open runtime zip: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("could not read the runtime zip: {e}"))?;
    std::fs::create_dir_all(dir).map_err(|e| format!("create runtime dir: {e}"))?;
    for f in spec.files {
        let member = format!("Release/{}", f.name);
        let mut entry = archive
            .by_name(&member)
            .map_err(|e| format!("{member} missing from the verified zip: {e}"))?;
        let tmp = dir.join(format!("{}.tmp", f.name));
        {
            let mut out =
                std::fs::File::create(&tmp).map_err(|e| format!("write {}: {e}", tmp.display()))?;
            std::io::copy(&mut entry, &mut out).map_err(|e| format!("unpack {}: {e}", f.name))?;
        }
        let hash = sha256_file(&tmp)?;
        if hash != f.sha256 {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!(
                "{} does not match its pin inside a hash-verified zip (expected {}, got {hash})",
                f.name, f.sha256
            ));
        }
        std::fs::rename(&tmp, dir.join(f.name)).map_err(|e| format!("install {}: {e}", f.name))?;
    }
    Ok(())
}

/// Download a runtime pack (resumable, zip SHA-256-verified), unpack its
/// pinned files, delete the zip. Same progress protocol and cancel contract
/// as a model download; the unpack step reports no progress (seconds).
#[tauri::command]
pub async fn lyrics_runtime_download(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
    id: String,
    on_progress: tauri::ipc::Channel<String>,
) -> Result<(), String> {
    crate::assert_main_window(&window)?;
    let spec = *runtime_by_id(&id)?;
    if state.downloading.swap(true, Ordering::SeqCst) {
        return Err("A model download is already running".into());
    }
    let _guard = DownloadGuard(&state);
    state.download_cancel.store(false, Ordering::SeqCst);

    let root = runtimes_dir(&app, &state)?;
    std::fs::create_dir_all(&root).map_err(|e| format!("create runtimes dir: {e}"))?;
    let dir = root.join(spec.dir_name);
    if spec.is_installed_in(&dir) {
        return Ok(());
    }
    let part_path = root.join(format!("{}.zip.part", spec.id));
    download_part(
        &state,
        spec.id,
        spec.zip_url,
        &part_path,
        spec.zip_bytes,
        spec.zip_sha256,
        &on_progress,
    )
    .await?;
    let (zip_for_unpack, dir_for_unpack) = (part_path.clone(), dir.clone());
    tauri::async_runtime::spawn_blocking(move || {
        extract_runtime(&zip_for_unpack, &dir_for_unpack, &spec)
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = std::fs::remove_file(&part_path);
    Ok(())
}

#[tauri::command]
pub fn lyrics_runtime_remove(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
    id: String,
) -> Result<(), String> {
    crate::assert_main_window(&window)?;
    let spec = runtime_by_id(&id)?;
    let root = runtimes_dir(&app, &state)?;
    let dir = root.join(spec.dir_name);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("remove {}: {e}", dir.display()))?;
    }
    let part = root.join(format!("{}.zip.part", spec.id));
    if part.exists() {
        std::fs::remove_file(&part).map_err(|e| format!("remove {}: {e}", part.display()))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Audio staging (ProRes mezzanine handshake, lyrics-scoped)

fn drop_stale_staging(state: &LyricsState) {
    if let Ok(mut w) = state.staging.lock() {
        if let Some((f, p)) = w.take() {
            drop(f);
            let _ = std::fs::remove_file(p);
        }
    }
    if let Ok(mut w) = state.staged.lock() {
        if let Some(p) = w.take() {
            let _ = std::fs::remove_file(p);
        }
    }
}

#[tauri::command]
pub fn lyrics_audio_begin(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LyricsState>,
) -> Result<(), String> {
    crate::assert_main_window(&window)?;
    drop_stale_staging(&state);
    let (f, path) = crate::prores::create_temp_new("lyrics-audio.wav")?;
    *state.staging.lock().map_err(|_| "state poisoned")? = Some((f, path));
    Ok(())
}

#[tauri::command]
pub fn lyrics_audio_chunk(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LyricsState>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    crate::assert_main_window(&window)?;
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw audio body".into());
    };
    let mut guard = state.staging.lock().map_err(|_| "state poisoned")?;
    let Some((f, _)) = guard.as_mut() else {
        return Err("No audio staging in progress — call lyrics_audio_begin first".into());
    };
    f.write_all(data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lyrics_audio_end(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LyricsState>,
) -> Result<(), String> {
    crate::assert_main_window(&window)?;
    let mut guard = state.staging.lock().map_err(|_| "state poisoned")?;
    let Some((f, path)) = guard.take() else {
        return Err("No audio staging in progress — call lyrics_audio_begin first".into());
    };
    drop(f);
    *state.staged.lock().map_err(|_| "state poisoned")? = Some(path);
    Ok(())
}

// ---------------------------------------------------------------------------
// Process-tree teardown

/// Windows job objects: kill a sidecar and everything it spawned.
///
/// `Child::kill()` is `TerminateProcess` on ONE process, and the lyrics
/// sidecar is a process TREE — it spawns the decode ffmpeg, then whisper-cli
/// with `-t 4`. Killing only the sidecar (what app shutdown and the
/// cancel-kill fallback did) left whisper-cli running: no window
/// (CREATE_NO_WINDOW), no parent, four cores pegged for the rest of a
/// medium-model transcription, and its `-ojf` JSON abandoned in %TEMP%. On a
/// laptop that is minutes of full-tilt CPU after the app is visibly gone.
///
/// `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` covers both halves: `terminate()`
/// ends the tree on demand, and the OS closing the handle when this process
/// dies ends it too — so an app CRASH is covered without a shutdown hook.
/// Descendants inherit job membership, so assigning the sidecar is enough.
///
/// Best-effort by construction: every failure path yields a no-op handle and
/// the caller behaves exactly as it did before — one process killed, nothing
/// worse. (The child is assigned just after spawn rather than being started
/// suspended: a grandchild spawned inside that window would escape the job.
/// The sidecar's first act is loading ONNX Runtime, and whisper starts stages
/// later, so the window is not reachable in practice.)
#[cfg(windows)]
mod proc_tree {
    use std::process::Child;

    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attrs: *const std::ffi::c_void, name: *const u16) -> isize;
        fn SetInformationJobObject(
            job: isize,
            class: i32,
            info: *const std::ffi::c_void,
            len: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: isize, process: isize) -> i32;
        fn TerminateJobObject(job: isize, exit_code: u32) -> i32;
        fn CloseHandle(handle: isize) -> i32;
    }

    /// JOBOBJECT_BASIC_LIMIT_INFORMATION, field-for-field. `repr(C)` applies
    /// the same alignment padding the Windows headers do.
    #[repr(C)]
    #[derive(Default)]
    struct BasicLimits {
        per_process_user_time: i64,
        per_job_user_time: i64,
        limit_flags: u32,
        minimum_working_set: usize,
        maximum_working_set: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    /// IO_COUNTERS.
    #[repr(C)]
    #[derive(Default)]
    struct IoCounters {
        read_ops: u64,
        write_ops: u64,
        other_ops: u64,
        read_bytes: u64,
        write_bytes: u64,
        other_bytes: u64,
    }

    /// JOBOBJECT_EXTENDED_LIMIT_INFORMATION.
    #[repr(C)]
    #[derive(Default)]
    struct ExtendedLimits {
        basic: BasicLimits,
        io: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    /// Owns a job-object handle. `0` = no job (creation or assignment
    /// failed); every method is then a no-op.
    pub struct ProcessTree(isize);

    impl ProcessTree {
        /// Put `child` — and everything it spawns from here on — in a fresh
        /// kill-on-close job.
        pub fn adopt(child: &Child) -> Self {
            use std::os::windows::io::AsRawHandle;
            // SAFETY: null attributes/name is the documented "unnamed,
            // default-security job" call; it returns an owned handle or 0.
            let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if job == 0 {
                return Self(0);
            }
            let limits = ExtendedLimits {
                basic: BasicLimits {
                    limit_flags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                    ..Default::default()
                },
                ..Default::default()
            };
            // SAFETY: `job` is the handle just created; the pointer is to a
            // live, correctly-sized ExtendedLimits on this stack frame.
            let set = unsafe {
                SetInformationJobObject(
                    job,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                    std::ptr::from_ref(&limits).cast(),
                    std::mem::size_of::<ExtendedLimits>() as u32,
                )
            };
            // SAFETY: the Child owns a live process handle for as long as it
            // is alive, and `&Child` keeps it alive across this call.
            let assigned = set != 0
                && unsafe { AssignProcessToJobObject(job, child.as_raw_handle() as isize) } != 0;
            if !assigned {
                // SAFETY: `job` is ours and not yet handed out.
                unsafe { CloseHandle(job) };
                return Self(0);
            }
            Self(job)
        }

        /// End every process in the job, now.
        pub fn terminate(&self) {
            if self.0 != 0 {
                // SAFETY: `self.0` is a live job handle this struct owns.
                unsafe { TerminateJobObject(self.0, 1) };
            }
        }
    }

    impl Drop for ProcessTree {
        fn drop(&mut self) {
            if self.0 != 0 {
                // Kill-on-close: this is also the app-crash safety net.
                // SAFETY: `self.0` is a live job handle this struct owns and
                // is giving up.
                unsafe { CloseHandle(self.0) };
            }
        }
    }
}

/// Non-Windows stand-in so the job plumbing compiles everywhere. The app only
/// ships on Windows; this keeps `cargo check` on other hosts honest.
#[cfg(not(windows))]
mod proc_tree {
    pub struct ProcessTree;
    impl ProcessTree {
        pub fn adopt(_child: &std::process::Child) -> Self {
            Self
        }
        pub fn terminate(&self) {}
    }
}

// ---------------------------------------------------------------------------
// GPU probe + generation job

/// What the GPU can do for the lyrics pipeline, probed once per app run:
/// DirectML (vocal isolation) through the sidecar, and an NVIDIA driver +
/// card (the CUDA whisper runtime pack) through the driver's own files.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GpuProbe {
    /// The sidecar can create DirectML sessions here.
    pub dml: bool,
    /// An NVIDIA driver is installed (System32\nvcuda.dll) — the CUDA pack
    /// would find a device.
    pub cuda_capable: bool,
    /// The first NVIDIA GPU's name, from nvidia-smi (None when unknown).
    pub gpu_name: Option<String>,
    /// Its total VRAM in MB, from nvidia-smi (None when unknown).
    pub vram_mb: Option<u64>,
}

/// NVIDIA presence and the first card's name/VRAM. The driver is the honest
/// signal for "CUDA would work": nvcuda.dll is what cudart binds to, and
/// nvidia-smi ships with every driver. No driver = CPU transcription, and the
/// UI says so instead of offering a 678 MB download that cannot help.
#[cfg(windows)]
fn nvidia_info() -> (bool, Option<String>, Option<u64>) {
    let system32 = Path::new(&std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into()))
        .join("System32");
    if !system32.join("nvcuda.dll").is_file() {
        return (false, None, None);
    }
    let mut cmd = Command::new(system32.join("nvidia-smi.exe"));
    cmd.args([
        "--query-gpu=name,memory.total",
        "--format=csv,noheader,nounits",
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let Ok(out) = cmd.output() else {
        return (true, None, None);
    };
    if !out.status.success() {
        return (true, None, None);
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let (name, vram) = parse_nvidia_smi(&text);
    (true, name, vram)
}

#[cfg(not(windows))]
fn nvidia_info() -> (bool, Option<String>, Option<u64>) {
    (false, None, None)
}

/// "NVIDIA GeForce RTX 5060 Ti, 16311" -> (name, MB). Pure, for the test.
fn parse_nvidia_smi(text: &str) -> (Option<String>, Option<u64>) {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty());
    let Some(line) = line else {
        return (None, None);
    };
    let mut parts = line.rsplitn(2, ',');
    let vram = parts.next().and_then(|v| v.trim().parse::<u64>().ok());
    let name = parts
        .next()
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty());
    match (name, vram) {
        (None, _) => (Some(line.to_string()), None),
        (name, vram) => (name, vram),
    }
}

/// Cached GPU probe: the sidecar's `--probe-gpu` (DirectML) plus the NVIDIA
/// driver check. Drives the honest time estimate and the runtime-pack offer
/// BEFORE any download.
#[tauri::command(async)]
pub fn lyrics_gpu_probe(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
) -> Result<GpuProbe, String> {
    crate::assert_main_window(&window)?;
    if let Some(cached) = state
        .gpu_probe
        .lock()
        .map_err(|_| "state poisoned")?
        .clone()
    {
        return Ok(cached);
    }
    let exe = sidecar_exe(&app)?;
    let ort = resolve_bundled(&app, "onnxruntime/onnxruntime.dll")?;
    let mut cmd = Command::new(&exe);
    cmd.args(["--probe-gpu", "--ort-dylib"])
        .arg(&ort)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    // spawn + adopt rather than output(): the probe loads the GPU driver
    // stack, and a probe left running after the app closed would be exactly
    // the orphan the job object exists to prevent. The tree handle lives
    // until this call returns, so the OS closing it kills the probe.
    let child = cmd
        .spawn()
        .map_err(|e| format!("probe spawn failed: {e}"))?;
    let _tree = proc_tree::ProcessTree::adopt(&child);
    let out = child
        .wait_with_output()
        .map_err(|e| format!("probe failed: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let dml = text
        .lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .any(|v| v["type"] == "probe" && v["dml"] == true);
    let (cuda_capable, gpu_name, vram_mb) = nvidia_info();
    let probe = GpuProbe {
        dml,
        cuda_capable,
        gpu_name,
        vram_mb,
    };
    *state.gpu_probe.lock().map_err(|_| "state poisoned")? = Some(probe.clone());
    Ok(probe)
}

/// Kill + bounded reap. TerminateProcess is near-instant in practice; the
/// bound exists so no caller (shutdown included) can hang on the wait.
fn kill_and_reap(mut child: Child) {
    let _ = child.kill();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while std::time::Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => break,
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}

/// End a job the abnormal way: kill its whole process tree, reap it, and
/// delete the temps it owned.
///
/// Only the abnormal paths (cancel's force fallback, app shutdown) call this.
/// The normal returns of `lyrics_generate` / `lyrics_align_line` clean up
/// their own temps, and `lyrics_generate` takes the job out of the slot while
/// the LRC still has to be READ — which is why `LyricsJob` has no `Drop`.
fn end_job(job: LyricsJob) {
    // Tree first: the sidecar's whisper-cli / ffmpeg children outlive a plain
    // kill of the sidecar itself.
    job.tree.terminate();
    kill_and_reap(job.child);
    let _ = std::fs::remove_file(&job.input_path);
    if let Some(lrc) = &job.lrc_path {
        let _ = std::fs::remove_file(lrc);
    }
}

/// Kill a running sidecar (bounded reap) and clear the job slot. Used by
/// cancel's force path and by app shutdown (lib.rs window-destroyed hook).
///
/// Sweeps %TEMP% on the way out, exactly like `prores::kill_running_job`:
/// the running job's staged WAV and reserved LRC (via `end_job`) plus any
/// staged-but-unconsumed audio. Shutdown is the last chance — `create_temp_new`
/// names are per-pid/per-seq, so nothing later ever reclaims them.
pub fn kill_running_job(state: &LyricsState) {
    if let Ok(mut stdin) = state.job_stdin.lock() {
        drop(stdin.take());
    }
    if let Ok(mut guard) = state.job.lock() {
        if let Some(job) = guard.take() {
            end_job(job);
        }
    }
    drop_stale_staging(state);
}

/// The delayed half of a graceful cancel: kill ONLY if the slot still holds
/// the pid the cancel targeted. By the time the grace expires the job may
/// have exited and a new one claimed the slot — killing by slot alone would
/// murder the newcomer, so the pid is the identity check.
fn kill_job_if_pid(state: &LyricsState, pid: u32) {
    if let Ok(mut guard) = state.job.lock() {
        if guard.as_ref().map(|j| j.child.id()) != Some(pid) {
            return;
        }
        if let Some(job) = guard.take() {
            end_job(job);
        }
        // job then job_stdin — the documented lock order.
        if let Ok(mut stdin) = state.job_stdin.lock() {
            drop(stdin.take());
        }
    }
}

/// How long a graceful cancel waits before the kill fallback fires. The ack
/// is device-measured ~1 s between chunks; this is comfortably past any
/// healthy ack (and the sidecar's own cleanup), short enough that a user who
/// cancelled a wedged job isn't left watching a zombie.
const CANCEL_KILL_GRACE: Duration = Duration::from_secs(10);

/// Graceful cancel: one "cancel" line down the sidecar's stdin (it acks
/// within a chunk — device-measured ~1 s) with a delayed bounded kill as the
/// backstop for a wedged process: the flag is only polled between chunks, so
/// a sidecar stuck inside a blocking read or driver call never acks, and
/// without the fallback it stayed wedged until app exit. Idempotent; Ok when
/// nothing is running.
#[tauri::command]
pub fn lyrics_generate_cancel(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
) -> Result<(), String> {
    crate::assert_main_window(&window)?;
    let wrote = {
        let mut guard = state.job_stdin.lock().map_err(|_| "state poisoned")?;
        match guard.as_mut() {
            Some(stdin) => stdin
                .write_all(b"cancel\n")
                .and_then(|()| stdin.flush())
                .is_ok(),
            None => false,
        }
    };
    if !wrote {
        // No stdin to speak to (already closing, or spawn raced) — hard kill.
        kill_running_job(&state);
        return Ok(());
    }
    // The write only proved delivery, not that anyone will act on it. Arm
    // the bounded kill against exactly this child (see kill_job_if_pid).
    let pid = {
        let guard = state.job.lock().map_err(|_| "state poisoned")?;
        guard.as_ref().map(|j| j.child.id())
    };
    if let Some(pid) = pid {
        std::thread::spawn(move || {
            std::thread::sleep(CANCEL_KILL_GRACE);
            kill_job_if_pid(&app.state::<LyricsState>(), pid);
        });
    }
    Ok(())
}

#[derive(Debug)]
enum JobOutcome {
    /// The sidecar's own "result" event, carrying the LRC path.
    Result {
        lrc_path: String,
    },
    Error {
        message: String,
    },
    Cancelled,
}

/// Supervise the sidecar to completion: forward every stdout line (raw JSON)
/// to the webview channel, capture the terminal event.
fn supervise(
    stdout: std::process::ChildStdout,
    on_event: &tauri::ipc::Channel<String>,
) -> Option<JobOutcome> {
    let reader = std::io::BufReader::new(stdout);
    let mut outcome = None;
    for line in reader.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
            match v["type"].as_str() {
                Some("result") => {
                    outcome = Some(JobOutcome::Result {
                        lrc_path: v["lrcPath"].as_str().unwrap_or_default().to_string(),
                    })
                }
                Some("error") => {
                    outcome = Some(JobOutcome::Error {
                        message: v["message"]
                            .as_str()
                            .unwrap_or("lyrics generation failed")
                            .to_string(),
                    })
                }
                Some("cancelled") => outcome = Some(JobOutcome::Cancelled),
                _ => {}
            }
        }
        let _ = on_event.send(line);
    }
    outcome
}

/// Claim the exclusive job slot. The returned guard MUST stay held until the
/// spawned child is stored into it (prores_begin's hold-across-spawn
/// discipline): checking in one lock scope and storing in another let two
/// racing invokes both pass the check, and the second store overwrote the
/// first Child handle — minutes of running inference left with no kill
/// handle, unreachable by cancel and by the app-close hook, its stdin
/// clobbered along with it.
fn claim_job_slot(state: &LyricsState) -> Result<MutexGuard<'_, Option<LyricsJob>>, String> {
    let guard = state.job.lock().map_err(|_| "state poisoned")?;
    if guard.is_some() {
        return Err("Lyrics generation is already running".into());
    }
    Ok(guard)
}

/// Generate lyrics for the staged track. Long-running (`async` = tauri's
/// blocking pool, exactly like prores_finish); progress streams through
/// `on_event` as the sidecar's raw JSON lines; resolves with the LRC text.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn lyrics_generate(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
    whisper_model_id: String,
    use_gpu: bool,
    use_cuda: bool,
    language: String,
    on_event: tauri::ipc::Channel<String>,
) -> Result<String, String> {
    crate::assert_main_window(&window)?;
    // Model + input preconditions, all BEFORE any spawn.
    let whisper_spec = spec_by_id(&whisper_model_id)?;
    if !whisper_spec.role.starts_with("whisper") {
        return Err(format!("{whisper_model_id} is not a transcription model"));
    }
    let whisper_dtw = whisper_dtw_preset(whisper_spec.role);
    let dir = models_dir(&app, &state)?;
    let mdx_spec = spec_by_id("mdx-voc-ft")?;
    let mdx_path = dir.join(mdx_spec.file_name);
    let whisper_path = dir.join(whisper_spec.file_name);
    for (path, spec) in [(&mdx_path, mdx_spec), (&whisper_path, whisper_spec)] {
        let ok = path
            .metadata()
            .map(|m| m.len() == spec.bytes)
            .unwrap_or(false);
        if !ok {
            return Err(format!(
                "Model not installed: {} — download it first",
                spec.id
            ));
        }
    }
    // Phase-3 word alignment is an ENHANCEMENT: with both files installed the
    // sidecar emits word-tag LRC; absent, the job runs line-level exactly
    // like phase 2 — never a hard block on the extra download.
    let installed = |spec: &ModelSpec| {
        let path = dir.join(spec.file_name);
        path.metadata()
            .map(|m| m.len() == spec.bytes)
            .unwrap_or(false)
            .then_some(path)
    };
    let align_paths = match (
        spec_by_id("wav2vec2-align").ok().and_then(installed),
        spec_by_id("wav2vec2-vocab").ok().and_then(installed),
    ) {
        (Some(model), Some(vocab)) => Some((model, vocab)),
        _ => None,
    };
    // Language strings reach a child-process argv; keep them boring.
    if !(language == "auto"
        || (language.len() <= 8
            && language
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')))
    {
        return Err(format!("unsupported language tag: {language}"));
    }

    let staged = state
        .staged
        .lock()
        .map_err(|_| "state poisoned")?
        .take()
        .ok_or("No audio staged — call lyrics_audio_begin/chunk/end first")?;

    // Everything from here owns cleanup of `staged` (and later the LRC temp).
    let cleanup_staged = |p: &PathBuf| {
        let _ = std::fs::remove_file(p);
    };

    // Held from here until the child is stored — see claim_job_slot. The
    // work under the lock (path resolution, temp reservation, spawn) is
    // milliseconds; a concurrent invoke blocks briefly and then gets the
    // clean "already running" refusal instead of a slot to clobber.
    let mut job_guard = match claim_job_slot(&state) {
        Ok(g) => g,
        Err(e) => {
            cleanup_staged(&staged);
            return Err(e);
        }
    };

    let exe = match sidecar_exe(&app) {
        Ok(p) => p,
        Err(e) => {
            cleanup_staged(&staged);
            return Err(e);
        }
    };
    // The CUDA pack's whisper-cli when it is installed and asked for; the
    // bundled CPU build otherwise. (The pack on a PC without an NVIDIA driver
    // would run on the CPU too — the sidecar reports what actually ran.)
    let resolved = (|| -> Result<(PathBuf, PathBuf, PathBuf, bool), String> {
        let cuda_cli = if use_cuda {
            installed_runtime_cli(&app, &state, "whisper-cuda")?
        } else {
            None
        };
        let cuda_pack = cuda_cli.is_some();
        let whisper_cli = match cuda_cli {
            Some(p) => p,
            None => resolve_bundled(&app, "whisper/whisper-cli.exe")?,
        };
        Ok((
            ffmpeg_exe(&app)?,
            whisper_cli,
            resolve_bundled(&app, "onnxruntime/onnxruntime.dll")?,
            cuda_pack,
        ))
    })();
    let (ffmpeg, whisper_cli, ort_dylib, cuda_pack) = match resolved {
        Ok(v) => v,
        Err(e) => {
            cleanup_staged(&staged);
            return Err(e);
        }
    };
    let (lrc_file, lrc_path) = match crate::prores::create_temp_new("lyrics-out.lrc") {
        Ok(v) => v,
        Err(e) => {
            cleanup_staged(&staged);
            return Err(e);
        }
    };
    drop(lrc_file); // the sidecar writes it; the reserved name is what matters

    let mut cmd = Command::new(&exe);
    if cuda_pack {
        // whisper-cli inherits the sidecar's environment, so this reaches
        // the CUDA driver inside it.
        match runtimes_dir(&app, &state) {
            Ok(runtimes) => cuda_cache_env(&mut cmd, &runtimes),
            Err(e) => eprintln!("[lyrics] CUDA cache dir unavailable: {e}"),
        }
    }
    cmd.arg("--input")
        .arg(&staged)
        .arg("--out")
        .arg(&lrc_path)
        .arg("--ffmpeg")
        .arg(&ffmpeg)
        .arg("--whisper-cli")
        .arg(&whisper_cli)
        .arg("--whisper-model")
        .arg(&whisper_path)
        .arg("--mdx-model")
        .arg(&mdx_path)
        .arg("--ort-dylib")
        .arg(&ort_dylib)
        .arg("--gpu")
        .arg(if use_gpu { "auto" } else { "cpu" })
        .arg("--language")
        .arg(&language)
        .arg("--threads")
        .arg(whisper_threads().to_string());
    if let Some(dtw) = whisper_dtw {
        cmd.arg("--whisper-dtw").arg(dtw);
    }
    if let Some((align_model, align_vocab)) = &align_paths {
        cmd.arg("--align-model")
            .arg(align_model)
            .arg("--align-vocab")
            .arg(align_vocab);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            cleanup_staged(&staged);
            let _ = std::fs::remove_file(&lrc_path);
            return Err(format!("lyrics sidecar spawn failed: {e}"));
        }
    };
    let stdout = child.stdout.take().expect("stdout piped");
    let tree = proc_tree::ProcessTree::adopt(&child);
    // job held, then job_stdin — the documented lock order.
    *state.job_stdin.lock().map_err(|_| "state poisoned")? = child.stdin.take();
    *job_guard = Some(LyricsJob {
        child,
        tree,
        input_path: staged.clone(),
        lrc_path: Some(lrc_path.clone()),
    });
    drop(job_guard);

    // Blocking supervision (this command runs on the blocking pool). The job
    // stays in state the whole time so cancel/app-close always reach it.
    let outcome = supervise(stdout, &on_event);

    // Reap: EOF means the process is exiting; bound the wait anyway.
    let status = {
        let mut guard = state.job.lock().map_err(|_| "state poisoned")?;
        match guard.take() {
            Some(mut job) => {
                let deadline = std::time::Instant::now() + Duration::from_secs(30);
                loop {
                    match job.child.try_wait() {
                        Ok(Some(s)) => break Some(s),
                        Ok(None) if std::time::Instant::now() >= deadline => {
                            // Stdout hit EOF but the tree is still up: end all
                            // of it, not just the sidecar. NOT end_job() — the
                            // LRC below still has to be read.
                            job.tree.terminate();
                            let _ = job.child.kill();
                            break None;
                        }
                        Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                        Err(_) => break None,
                    }
                }
            }
            // Cancel's force path (or app close) already reaped it.
            None => None,
        }
    };
    if let Ok(mut stdin) = state.job_stdin.lock() {
        drop(stdin.take());
    }

    cleanup_staged(&staged);
    let result = match outcome {
        Some(JobOutcome::Result { lrc_path: reported }) => {
            // The sidecar reports the path it wrote — which this process
            // CHOSE; read our own reserved path, not anything reported.
            let _ = reported;
            std::fs::read_to_string(&lrc_path).map_err(|e| format!("generated LRC unreadable: {e}"))
        }
        Some(JobOutcome::Error { message }) => Err(message),
        Some(JobOutcome::Cancelled) => Err("cancelled".into()),
        None => match status {
            Some(s) if !s.success() => Err(format!("lyrics sidecar exited abnormally ({s})")),
            _ => Err("lyrics sidecar ended without a result".into()),
        },
    };
    let _ = std::fs::remove_file(&lrc_path);
    result
}

// ---------------------------------------------------------------------------
// Per-line re-alignment (phase 4 correction editor)

/// One re-aligned word, slice-relative seconds (the webview cut the slice
/// and owns the offset back to track time).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignedWordOut {
    t: f64,
    end: f64,
    conf: f64,
    text: String,
}

/// Re-align ONE line's (edited) text against the staged audio slice using
/// the sidecar's `--align-line` mode: isolation + CTC forced alignment, no
/// whisper. The webview stages a short WAV cut around the line (same
/// begin/chunk/end handshake as generation) and passes the line window in
/// SLICE-relative seconds. Blocking-pool command like lyrics_generate;
/// shares the job slot, so generate and re-align exclude each other and
/// lyrics_generate_cancel / app shutdown reach this child too.
#[tauri::command(async)]
pub fn lyrics_align_line(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
    line_t: f64,
    line_end: f64,
    text: String,
    use_gpu: bool,
) -> Result<Vec<AlignedWordOut>, String> {
    crate::assert_main_window(&window)?;
    // The text reaches a child argv: normalize whitespace and bound it.
    // (No shell involved — std::process quotes — but a 10 kB argv or
    // embedded newlines have no business in a lyric line either way.)
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err("The line has no text to align".into());
    }
    if text.chars().count() > 300 {
        return Err("Line too long to re-align (300 characters max)".into());
    }
    if !(line_t >= 0.0 && line_end > line_t && line_end - line_t <= 40.0) {
        return Err("Line window out of range for re-alignment".into());
    }

    let dir = models_dir(&app, &state)?;
    let need = |id: &str| -> Result<PathBuf, String> {
        let spec = spec_by_id(id)?;
        let path = dir.join(spec.file_name);
        let ok = path
            .metadata()
            .map(|m| m.len() == spec.bytes)
            .unwrap_or(false);
        if ok {
            Ok(path)
        } else {
            Err(format!(
                "Model not installed: {} — download the lyrics models first",
                spec.id
            ))
        }
    };
    let mdx_path = need("mdx-voc-ft")?;
    let align_model = need("wav2vec2-align")?;
    let align_vocab = need("wav2vec2-vocab")?;

    let staged = state
        .staged
        .lock()
        .map_err(|_| "state poisoned")?
        .take()
        .ok_or("No audio staged — call lyrics_audio_begin/chunk/end first")?;
    let cleanup_staged = |p: &PathBuf| {
        let _ = std::fs::remove_file(p);
    };

    // Held until the child is stored — the same race as lyrics_generate:
    // generate-vs-align-line is exactly the concurrent pair that could both
    // pass a scoped check and orphan whichever child spawned first.
    let mut job_guard = match claim_job_slot(&state) {
        Ok(g) => g,
        Err(e) => {
            cleanup_staged(&staged);
            return Err(e);
        }
    };

    let spawn_inputs = (|| -> Result<(PathBuf, PathBuf, PathBuf), String> {
        Ok((
            sidecar_exe(&app)?,
            ffmpeg_exe(&app)?,
            resolve_bundled(&app, "onnxruntime/onnxruntime.dll")?,
        ))
    })();
    let (exe, ffmpeg, ort_dylib) = match spawn_inputs {
        Ok(v) => v,
        Err(e) => {
            cleanup_staged(&staged);
            return Err(e);
        }
    };

    let mut cmd = Command::new(&exe);
    cmd.arg("--align-line")
        .arg("--input")
        .arg(&staged)
        .arg("--ffmpeg")
        .arg(&ffmpeg)
        .arg("--mdx-model")
        .arg(&mdx_path)
        .arg("--ort-dylib")
        .arg(&ort_dylib)
        .arg("--align-model")
        .arg(&align_model)
        .arg("--align-vocab")
        .arg(&align_vocab)
        .arg("--gpu")
        .arg(if use_gpu { "auto" } else { "cpu" })
        .arg("--threads")
        .arg(whisper_threads().to_string())
        .arg("--line-t")
        .arg(format!("{line_t:.3}"))
        .arg("--line-end")
        .arg(format!("{line_end:.3}"))
        .arg("--line-text")
        .arg(&text);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            cleanup_staged(&staged);
            return Err(format!("lyrics sidecar spawn failed: {e}"));
        }
    };
    let stdout = child.stdout.take().expect("stdout piped");
    let tree = proc_tree::ProcessTree::adopt(&child);
    // job held, then job_stdin — the documented lock order.
    *state.job_stdin.lock().map_err(|_| "state poisoned")? = child.stdin.take();
    *job_guard = Some(LyricsJob {
        child,
        tree,
        input_path: staged.clone(),
        // --align-line answers over the wire; it writes no LRC.
        lrc_path: None,
    });
    drop(job_guard);

    // Supervise to EOF: capture the one terminal event. Seconds-long job, no
    // progress channel — the UI shows a per-line spinner.
    enum AlignOutcome {
        Words(Vec<AlignedWordOut>),
        Error(String),
        Cancelled,
    }
    let mut outcome: Option<AlignOutcome> = None;
    let reader = std::io::BufReader::new(stdout);
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        match v["type"].as_str() {
            Some("alignedLine") => {
                let words = v["words"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|w| {
                                Some(AlignedWordOut {
                                    t: w["t"].as_f64()?,
                                    end: w["end"].as_f64()?,
                                    conf: w["conf"].as_f64().unwrap_or(0.0),
                                    text: w["text"].as_str()?.to_string(),
                                })
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                outcome = Some(AlignOutcome::Words(words));
            }
            Some("error") => {
                outcome = Some(AlignOutcome::Error(
                    v["message"]
                        .as_str()
                        .unwrap_or("re-alignment failed")
                        .to_string(),
                ));
            }
            Some("cancelled") => outcome = Some(AlignOutcome::Cancelled),
            _ => {}
        }
    }

    // Reap (bounded), release stdin, clean the slice — lyrics_generate's ritual.
    let status = {
        let mut guard = state.job.lock().map_err(|_| "state poisoned")?;
        match guard.take() {
            Some(mut job) => {
                let deadline = std::time::Instant::now() + Duration::from_secs(30);
                loop {
                    match job.child.try_wait() {
                        Ok(Some(s)) => break Some(s),
                        Ok(None) if std::time::Instant::now() >= deadline => {
                            job.tree.terminate();
                            let _ = job.child.kill();
                            break None;
                        }
                        Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                        Err(_) => break None,
                    }
                }
            }
            None => None,
        }
    };
    if let Ok(mut stdin) = state.job_stdin.lock() {
        drop(stdin.take());
    }
    cleanup_staged(&staged);

    match outcome {
        Some(AlignOutcome::Words(words)) if !words.is_empty() => Ok(words),
        Some(AlignOutcome::Words(_)) => Err("re-alignment produced no words".into()),
        Some(AlignOutcome::Error(message)) => Err(message),
        Some(AlignOutcome::Cancelled) => Err("cancelled".into()),
        None => match status {
            Some(s) if !s.success() => Err(format!("lyrics sidecar exited abnormally ({s})")),
            _ => Err("lyrics sidecar ended without a result".into()),
        },
    }
}

/// DEBUG BUILDS ONLY: point the model manager at an arbitrary directory so
/// the E2E harness can use pre-cached models without a 0.65 GB download.
/// Compiled to a hard error in release, exactly like debug_allow_path.
#[tauri::command]
pub fn debug_set_lyrics_models_dir(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LyricsState>,
    dir: String,
) -> Result<(), String> {
    crate::assert_main_window(&window)?;
    #[cfg(debug_assertions)]
    {
        *state
            .models_dir_override
            .lock()
            .map_err(|_| "state poisoned")? = Some(PathBuf::from(dir));
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (state, dir);
        Err("debug builds only".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_manifest_matches_the_spike_hash_matrix() {
        // These triples are the release contract: URL file name, byte size,
        // SHA-256 — exactly what the phase-1 spike verified against the
        // upstream HF LFS oids (and, for the phase-3 wav2vec2 export, what
        // the phase-2 prep uploaded and GitHub's asset digests confirm). A
        // drive-by edit here would repoint the download at unverified bytes,
        // so the test pins the pins.
        assert_eq!(MODELS.len(), 7);
        let voc = spec_by_id("mdx-voc-ft").unwrap();
        assert_eq!(voc.file_name, "UVR-MDX-NET-Voc_FT.onnx");
        assert_eq!(voc.bytes, 66_762_490);
        assert_eq!(
            voc.sha256,
            "534b2070fcc7df514b13ef660dc8cbb328679c2374d04354a5c42bb14ecce111"
        );
        let small = spec_by_id("whisper-small").unwrap();
        assert_eq!(small.bytes, 487_601_967);
        assert_eq!(
            small.sha256,
            "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"
        );
        let medium = spec_by_id("whisper-medium").unwrap();
        assert_eq!(medium.bytes, 1_533_763_059);
        assert_eq!(
            medium.sha256,
            "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208"
        );
        let align = spec_by_id("wav2vec2-align").unwrap();
        assert_eq!(align.file_name, "wav2vec2-base-960h-ctc-int8.onnx");
        assert_eq!(align.bytes, 121_925_528);
        assert_eq!(
            align.sha256,
            "788e9cef53464fd9229ee5a1b48a307971d8209f2a040439f14c4aec586e15bf"
        );
        assert_eq!(align.role, "alignment");
        let vocab = spec_by_id("wav2vec2-vocab").unwrap();
        assert_eq!(vocab.file_name, "wav2vec2-base-960h-vocab.json");
        assert_eq!(vocab.bytes, 392);
        assert_eq!(
            vocab.sha256,
            "8ae64b2ec10a2ea5c4416ed0394dcad8643b764ef979109fbf5261cb88eb836f"
        );
        assert_eq!(vocab.role, "alignment");
        assert!(spec_by_id("nope").is_err());
        // The GPU-era tiers: the upstream ggml conversions, pinned to their
        // Hugging Face LFS oids (= SHA-256) and byte sizes.
        let turbo = spec_by_id("whisper-turbo").unwrap();
        assert_eq!(turbo.file_name, "ggml-large-v3-turbo.bin");
        assert_eq!(turbo.bytes, 1_624_555_275);
        assert_eq!(
            turbo.sha256,
            "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69"
        );
        assert_eq!(turbo.role, "whisper-turbo");
        let large = spec_by_id("whisper-large").unwrap();
        // The q5_0 quantization: under GitHub's 2 GiB asset cap, measured
        // within a line of the fp16 model on the bench.
        assert_eq!(large.file_name, "ggml-large-v3-q5_0.bin");
        assert_eq!(large.bytes, 1_081_140_203);
        assert_eq!(
            large.sha256,
            "d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1"
        );
        assert_eq!(large.role, "whisper-large");
        assert!(
            large.bytes < 2 * 1024 * 1024 * 1024,
            "GitHub release asset cap"
        );
        for mirrored in [
            "mdx-voc-ft",
            "whisper-small",
            "whisper-medium",
            "whisper-turbo",
            "whisper-large",
            "wav2vec2-align",
        ] {
            assert_eq!(spec_by_id(mirrored).unwrap().base_url, MODELS_BASE_URL);
        }
    }

    #[test]
    fn the_cuda_runtime_pack_is_pinned_file_by_file() {
        // The zip hash is the release contract (fetch-whisper.mjs pins the
        // sibling CPU zip the same way); the per-file pins are what the
        // extraction verifies before any DLL gets its final name.
        assert_eq!(RUNTIMES.len(), 1);
        let cuda = runtime_by_id("whisper-cuda").unwrap();
        assert_eq!(cuda.dir_name, "whisper-cuda-v1.9.1");
        assert!(cuda
            .zip_url
            .ends_with("/v1.9.1/whisper-cublas-12.4.0-bin-x64.zip"));
        assert_eq!(cuda.zip_bytes, 677_887_125);
        assert_eq!(
            cuda.zip_sha256,
            "106a2030eff8998e4ef320fe72e263a78449e9040386ee27c41ea80b001b601b"
        );
        assert_eq!(cuda.files.len(), 17);
        assert_eq!(cuda.installed_bytes(), 1_148_406_784);
        for f in cuda.files {
            assert_eq!(f.sha256.len(), 64, "{}", f.name);
            assert!(
                f.sha256.chars().all(|c| c.is_ascii_hexdigit()),
                "{}",
                f.name
            );
            assert!(f.bytes > 0, "{}", f.name);
        }
        assert!(cuda.files.iter().any(|f| f.name == "whisper-cli.exe"));
        assert!(cuda.files.iter().any(|f| f.name == "ggml-cuda.dll"));
        assert!(cuda.files.iter().any(|f| f.name == "cublasLt64_12.dll"));
        assert!(runtime_by_id("nope").is_err());
        // Nothing installed in an empty dir; every file at its pinned size
        // counts as installed (the hashes ran at extraction).
        let dir = std::env::temp_dir().join(format!("bf-runtime-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!cuda.is_installed_in(&dir));
        for f in cuda.files.iter().take(3) {
            std::fs::write(dir.join(f.name), vec![0u8; f.bytes as usize]).unwrap();
        }
        assert!(
            !cuda.is_installed_in(&dir),
            "three of seventeen is not installed"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn whisper_threads_follow_the_physical_cores_within_bounds() {
        let t = whisper_threads();
        assert!((4..=16).contains(&t), "{t}");
        if let Some(physical) = sysinfo::System::physical_core_count() {
            assert_eq!(t, physical.clamp(4, 16));
        }
    }

    #[test]
    fn dtw_presets_name_whispers_own_alignment_tables() {
        assert_eq!(whisper_dtw_preset("whisper-small"), Some("small"));
        assert_eq!(whisper_dtw_preset("whisper-medium"), Some("medium"));
        assert_eq!(whisper_dtw_preset("whisper-turbo"), Some("large.v3.turbo"));
        assert_eq!(whisper_dtw_preset("whisper-large"), Some("large.v3"));
        assert_eq!(whisper_dtw_preset("isolation"), None);
    }

    #[test]
    fn nvidia_smi_output_parses_name_and_vram() {
        assert_eq!(
            parse_nvidia_smi(
                "NVIDIA GeForce RTX 5060 Ti, 16311
"
            ),
            (Some("NVIDIA GeForce RTX 5060 Ti".into()), Some(16311))
        );
        // A name with its own comma still splits on the LAST one.
        assert_eq!(
            parse_nvidia_smi("NVIDIA RTX A6000, 48 GB edition, 49140"),
            (Some("NVIDIA RTX A6000, 48 GB edition".into()), Some(49140))
        );
        assert_eq!(parse_nvidia_smi(""), (None, None));
        assert_eq!(parse_nvidia_smi("garbage"), (Some("garbage".into()), None));
    }

    #[test]
    fn sha256_file_streams_correctly() {
        let (mut f, path) = crate::prores::create_temp_new("lyrics-hash-test.bin").unwrap();
        f.write_all(b"beatform").unwrap();
        drop(f);
        // printf %s beatform | sha256sum
        assert_eq!(
            sha256_file(&path).unwrap(),
            "37909039d72c1b2be6e8bb8b9231ebcb7398f359d9eceb0498867f041a0bb71a"
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn language_tags_are_gated_before_reaching_argv() {
        // The gate lives inline in lyrics_generate; mirror its rule here so a
        // change is a conscious one.
        let ok = |l: &str| {
            l == "auto"
                || (l.len() <= 8 && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
        };
        assert!(ok("auto"));
        assert!(ok("en"));
        assert!(ok("pt-BR"));
        assert!(!ok("en; rm -rf"));
        assert!(!ok("very-long-language-tag"));
    }

    #[test]
    fn models_base_url_is_the_beatform_owned_release() {
        assert_eq!(
            MODELS_BASE_URL,
            "https://github.com/beatform-app/models/releases/download/v1/"
        );
    }

    /// A child that will not exit on its own — a stand-in for a running
    /// sidecar (same trick as the prores tests).
    fn spawn_wedged() -> Child {
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("ping");
            c.args(["-n", "60", "127.0.0.1"]);
            c
        } else {
            let mut c = Command::new("sleep");
            c.arg("60");
            c
        };
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn test child")
    }

    /// A job around a test child, with temp paths that do not exist unless a
    /// test made them (mirrors prores::tests::test_job).
    fn test_job(child: Child) -> LyricsJob {
        let tree = proc_tree::ProcessTree::adopt(&child);
        LyricsJob {
            child,
            tree,
            input_path: std::env::temp_dir().join("av-lyrics-test-absent-input.wav"),
            lrc_path: None,
        }
    }

    #[test]
    fn app_shutdown_sweeps_the_staged_wav_and_the_reserved_lrc() {
        // The job slot used to hold a bare Child, so shutdown could end the
        // sidecar but had no idea which files it owned. The staged WAV is the
        // WHOLE decoded track (~42 MB for four minutes, ~635 MB for an
        // hour-long set) and the names are per-pid/per-seq, so nothing later
        // ever reclaims them: close the app mid-generation and they stayed in
        // %TEMP% forever.
        let state = LyricsState::default();
        let (f, input) = crate::prores::create_temp_new("test-shutdown-lyrics-in.wav").unwrap();
        drop(f);
        let (f, lrc) = crate::prores::create_temp_new("test-shutdown-lyrics-out.lrc").unwrap();
        drop(f);

        let mut child = spawn_wedged();
        let tree = proc_tree::ProcessTree::adopt(&child);
        *state.job_stdin.lock().unwrap() = child.stdin.take();
        *state.job.lock().unwrap() = Some(LyricsJob {
            child,
            tree,
            input_path: input.clone(),
            lrc_path: Some(lrc.clone()),
        });

        kill_running_job(&state);

        assert!(state.job.lock().unwrap().is_none(), "job slot cleared");
        assert!(
            state.job_stdin.lock().unwrap().is_none(),
            "sidecar stdin released"
        );
        assert!(!input.exists(), "staged WAV must be swept from %TEMP%");
        assert!(!lrc.exists(), "reserved LRC temp must be swept from %TEMP%");
    }

    #[test]
    fn shutdown_with_no_job_still_sweeps_staged_audio() {
        // Close the app between lyrics_audio_end and lyrics_generate — or
        // after generation refused (model missing, bad language tag) without
        // ever consuming the staging. No child to kill, but the WAV is on
        // disk and this is its last exit.
        let state = LyricsState::default();
        let (f, staged) =
            crate::prores::create_temp_new("test-shutdown-lyrics-staged.wav").unwrap();
        drop(f);
        *state.staged.lock().unwrap() = Some(staged.clone());
        let (f, half) = crate::prores::create_temp_new("test-shutdown-lyrics-half.wav").unwrap();
        *state.staging.lock().unwrap() = Some((f, half.clone()));

        kill_running_job(&state);

        assert!(!staged.exists(), "sealed staged WAV must be swept");
        assert!(!half.exists(), "half-written staging must be swept too");
    }

    #[cfg(windows)]
    #[test]
    fn killing_a_sidecar_takes_its_grandchildren_with_it() {
        // Child::kill() is TerminateProcess on ONE process, and the sidecar is
        // a process TREE (decode ffmpeg, then whisper-cli with -t 4). Before
        // the job object, app shutdown and the cancel-kill fallback ended the
        // sidecar and left whisper-cli running with no window and no parent:
        // four cores pegged for the rest of the transcription, minutes after
        // Beatform was gone.
        //
        // `cmd /c ping` is that shape — cmd is the process we hold, ping is
        // the grandchild that must not survive.
        use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

        let mut cmd = Command::new("cmd");
        cmd.args(["/c", "ping", "-n", "40", "127.0.0.1"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = cmd.spawn().expect("spawn test child");
        let child_pid = Pid::from_u32(child.id());
        let job = LyricsJob {
            tree: proc_tree::ProcessTree::adopt(&child),
            child,
            input_path: std::env::temp_dir().join("av-lyrics-test-absent-input.wav"),
            lrc_path: None,
        };

        let mut sys = System::new();
        let mut grandchild: Option<Pid> = None;
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        while grandchild.is_none() && std::time::Instant::now() < deadline {
            sys.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing(),
            );
            grandchild = sys
                .processes()
                .iter()
                .find(|(_, p)| p.parent() == Some(child_pid))
                .map(|(pid, _)| *pid);
            if grandchild.is_none() {
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        let grandchild = grandchild.expect("the test child must have spawned a grandchild");

        end_job(job);

        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        let mut alive = true;
        while alive && std::time::Instant::now() < deadline {
            sys.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing(),
            );
            alive = sys.process(grandchild).is_some();
            if alive {
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        assert!(
            !alive,
            "the grandchild outlived the sidecar kill — whisper-cli would keep \
             running at full tilt after the app closed"
        );
    }

    #[test]
    fn the_job_slot_claim_is_exclusive_across_the_whole_spawn() {
        // The old scoped check-then-drop let two racing invokes both pass;
        // the second store overwrote the first Child handle, orphaning a
        // running inference beyond cancel and the app-close hook. The claim
        // must stay exclusive from check to store.
        use std::sync::Arc;
        let state = Arc::new(LyricsState::default());
        let mut guard = claim_job_slot(&state).expect("a free slot must claim");
        let racer_state = Arc::clone(&state);
        let racer = std::thread::spawn(move || {
            // Blocks until the first claim stores and releases, then must be
            // REFUSED — never handed the slot a second time.
            claim_job_slot(&racer_state).map(|mut g| g.take().map(|j| j.child.id()))
        });
        // Let the racer reach the lock while the spawn is "in progress".
        std::thread::sleep(Duration::from_millis(50));
        *guard = Some(test_job(spawn_wedged()));
        drop(guard);

        let raced = racer.join().unwrap();
        assert!(
            raced.is_err(),
            "second claim must report already-running, got {raced:?}"
        );
        // The first child kept its kill handle; the normal teardown reaches it.
        kill_running_job(&state);
        assert!(state.job.lock().unwrap().is_none());
    }

    #[test]
    fn sha256_file_emits_the_manifest_hex_shape_exactly() {
        // The manifest pins 64-char lowercase hex (see MODELS above) and
        // `lyrics_model_verify` compares with `==` — this string IS the
        // download-verification boundary, so its shape is pinned against the
        // FIPS 180-2 test vector SHA-256("abc"). Uppercase, truncation, or a
        // stray prefix must all land here as a red test.
        let path =
            std::env::temp_dir().join(format!("av-lyrics-test-sha-{}.bin", std::process::id()));
        std::fs::write(&path, b"abc").unwrap();
        let hex = sha256_file(&path);
        std::fs::remove_file(&path).ok();
        assert_eq!(
            hex.unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn a_claimed_slot_refuses_until_the_job_is_reaped() {
        let state = LyricsState::default();
        *state.job.lock().unwrap() = Some(test_job(spawn_wedged()));
        assert!(claim_job_slot(&state).is_err(), "busy slot must refuse");
        kill_running_job(&state);
        assert!(
            claim_job_slot(&state).is_ok(),
            "a reaped slot must claim again"
        );
    }

    #[test]
    fn the_delayed_cancel_kill_reaches_only_the_job_it_targeted() {
        // A graceful cancel arms a bounded kill fallback. By the time it
        // fires, the cancelled job may have exited and a NEW job claimed the
        // slot — the pid pin keeps the fallback from murdering the newcomer.
        let state = LyricsState::default();
        let job = test_job(spawn_wedged());
        let pid = job.child.id();
        *state.job.lock().unwrap() = Some(job);

        kill_job_if_pid(&state, pid.wrapping_add(1));
        assert!(
            state.job.lock().unwrap().is_some(),
            "a mismatched pid means the targeted job is gone — leave the slot alone"
        );

        kill_job_if_pid(&state, pid);
        assert!(
            state.job.lock().unwrap().is_none(),
            "the targeted job must be killed and cleared"
        );
    }
}
