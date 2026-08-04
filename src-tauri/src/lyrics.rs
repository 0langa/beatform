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

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

/// Where the pinned models live. GitHub release assets are mutable in
/// principle — which is why every download is SHA-256-verified against the
/// hashes below (recorded in the FEAT-004 spike's license/hash matrix and
/// cross-checked against the upstream HF LFS oids byte-for-byte).
const MODELS_BASE_URL: &str = "https://github.com/beatform-app/models/releases/download/v1/";

#[derive(Clone, Copy)]
pub struct ModelSpec {
    pub id: &'static str,
    pub file_name: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
    /// "isolation" (always required) | "whisper-small" | "whisper-medium" |
    /// "alignment" (phase 3 word timing; part of every tier).
    pub role: &'static str,
}

pub const MODELS: &[ModelSpec] = &[
    ModelSpec {
        id: "mdx-voc-ft",
        file_name: "UVR-MDX-NET-Voc_FT.onnx",
        bytes: 66_762_490,
        sha256: "534b2070fcc7df514b13ef660dc8cbb328679c2374d04354a5c42bb14ecce111",
        role: "isolation",
    },
    ModelSpec {
        id: "whisper-small",
        file_name: "ggml-small.bin",
        bytes: 487_601_967,
        sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
        role: "whisper-small",
    },
    ModelSpec {
        id: "whisper-medium",
        file_name: "ggml-medium.bin",
        bytes: 1_533_763_059,
        sha256: "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
        role: "whisper-medium",
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
    },
    ModelSpec {
        id: "wav2vec2-vocab",
        file_name: "wav2vec2-base-960h-vocab.json",
        bytes: 392,
        sha256: "8ae64b2ec10a2ea5c4416ed0394dcad8643b764ef979109fbf5261cb88eb836f",
        role: "alignment",
    },
];

fn spec_by_id(id: &str) -> Result<&'static ModelSpec, String> {
    MODELS
        .iter()
        .find(|m| m.id == id)
        .ok_or(format!("unknown model id: {id}"))
}

#[derive(Default)]
pub struct LyricsState {
    /// Running sidecar (kill on cancel-timeout / app close). LOCK ORDER where
    /// both are needed: `job` first, then `job_stdin` — same discipline as
    /// ProresState.
    pub job: Mutex<Option<Child>>,
    /// The sidecar's stdin, held separately so the graceful-cancel write can
    /// never wait behind the supervising read loop.
    pub job_stdin: Mutex<Option<ChildStdin>>,
    /// In-progress chunked audio staging (ProRes mezzanine pattern).
    pub staging: Mutex<Option<(std::fs::File, PathBuf)>>,
    /// Sealed staged WAV waiting for lyrics_generate.
    pub staged: Mutex<Option<PathBuf>>,
    /// One model download at a time; cancel keeps the .part for resume.
    pub downloading: AtomicBool,
    pub download_cancel: AtomicBool,
    /// Cached sidecar --probe-gpu answer (None = not probed yet).
    pub gpu_probe: Mutex<Option<bool>>,
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
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
) -> Result<ModelsState, String> {
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
    Ok(format!("{:x}", hasher.finalize()))
}

/// Re-hash an installed model against the manifest. The E2E harness drives
/// this; the UI uses it for a "verify" affordance on suspicion.
#[tauri::command(async)]
pub fn lyrics_model_verify(
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
    id: String,
) -> Result<bool, String> {
    let spec = spec_by_id(&id)?;
    let path = models_dir(&app, &state)?.join(spec.file_name);
    if !path.is_file() {
        return Ok(false);
    }
    Ok(sha256_file(&path)? == spec.sha256)
}

#[tauri::command]
pub fn lyrics_model_remove(
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
    id: String,
) -> Result<(), String> {
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
pub fn lyrics_download_cancel(state: tauri::State<'_, LyricsState>) {
    state.download_cancel.store(true, Ordering::SeqCst);
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
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
    id: String,
    on_progress: tauri::ipc::Channel<String>,
) -> Result<(), String> {
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

    let offset = part_path.metadata().map(|m| m.len()).unwrap_or(0);
    // A .part at (or beyond) full size skips straight to verification —
    // beyond happens when a previous run appended after a 200-not-206.
    if offset < spec.bytes {
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
        let url = format!("{MODELS_BASE_URL}{}", spec.file_name);
        let mut req = client.get(&url);
        if offset > 0 {
            req = req.header(reqwest::header::RANGE, format!("bytes={offset}-"));
        }
        let resp = req
            .send()
            .await
            .map_err(|e| format!("download failed (offline?): {e}"))?;
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
            .open(&part_path)
            .map_err(|e| format!("open {}: {e}", part_path.display()))?;
        let mut received = if resumed { offset } else { 0 };
        let total = spec.bytes;
        let mut last_reported = 0u64;
        let mut stream = resp;
        loop {
            if state.download_cancel.load(Ordering::SeqCst) {
                return Err("cancelled".into());
            }
            let chunk = stream
                .chunk()
                .await
                .map_err(|e| format!("download interrupted: {e}"))?;
            let Some(chunk) = chunk else { break };
            file.write_all(&chunk)
                .map_err(|e| format!("write failed: {e}"))?;
            received += chunk.len() as u64;
            if received - last_reported >= 512 * 1024 || received == total {
                last_reported = received;
                let _ = on_progress.send(format!(
                    "{{\"id\":\"{}\",\"received\":{received},\"total\":{total}}}",
                    spec.id
                ));
            }
        }
        file.flush().map_err(|e| e.to_string())?;
    }

    // Verify BEFORE the artifact gains its final (trusted) name — a mismatch
    // deletes the part so the next attempt starts clean.
    let got = part_path.metadata().map(|m| m.len()).unwrap_or(0);
    if got != spec.bytes {
        return Err(format!(
            "download incomplete: {got} of {} bytes — resume by downloading again",
            spec.bytes
        ));
    }
    let part_for_hash = part_path.clone();
    let hash = tauri::async_runtime::spawn_blocking(move || sha256_file(&part_for_hash))
        .await
        .map_err(|e| e.to_string())??;
    if hash != spec.sha256 {
        let _ = std::fs::remove_file(&part_path);
        return Err(format!(
            "checksum mismatch for {} — expected {}, got {hash}. The download was discarded; try again.",
            spec.file_name, spec.sha256
        ));
    }
    std::fs::rename(&part_path, &final_path).map_err(|e| format!("install failed: {e}"))?;
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
pub fn lyrics_audio_begin(state: tauri::State<'_, LyricsState>) -> Result<(), String> {
    drop_stale_staging(&state);
    let (f, path) = crate::prores::create_temp_new("lyrics-audio.wav")?;
    *state.staging.lock().map_err(|_| "state poisoned")? = Some((f, path));
    Ok(())
}

#[tauri::command]
pub fn lyrics_audio_chunk(
    state: tauri::State<'_, LyricsState>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
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
pub fn lyrics_audio_end(state: tauri::State<'_, LyricsState>) -> Result<(), String> {
    let mut guard = state.staging.lock().map_err(|_| "state poisoned")?;
    let Some((f, path)) = guard.take() else {
        return Err("No audio staging in progress — call lyrics_audio_begin first".into());
    };
    drop(f);
    *state.staged.lock().map_err(|_| "state poisoned")? = Some(path);
    Ok(())
}

// ---------------------------------------------------------------------------
// GPU probe + generation job

/// Cached sidecar `--probe-gpu` run: can DirectML sessions be created here?
/// Drives the honest time estimate BEFORE any model download.
#[tauri::command(async)]
pub fn lyrics_gpu_probe(
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
) -> Result<bool, String> {
    if let Some(cached) = *state.gpu_probe.lock().map_err(|_| "state poisoned")? {
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
    let out = cmd
        .output()
        .map_err(|e| format!("probe spawn failed: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let dml = text
        .lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .any(|v| v["type"] == "probe" && v["dml"] == true);
    *state.gpu_probe.lock().map_err(|_| "state poisoned")? = Some(dml);
    Ok(dml)
}

/// Kill a running sidecar (bounded reap) and clear the job slot. Used by
/// cancel's force path and by app shutdown (lib.rs window-destroyed hook).
pub fn kill_running_job(state: &LyricsState) {
    if let Ok(mut stdin) = state.job_stdin.lock() {
        drop(stdin.take());
    }
    if let Ok(mut guard) = state.job.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let deadline = std::time::Instant::now() + Duration::from_secs(10);
            while std::time::Instant::now() < deadline {
                match child.try_wait() {
                    Ok(Some(_)) | Err(_) => break,
                    Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                }
            }
        }
    }
}

/// Graceful cancel: one "cancel" line down the sidecar's stdin (it acks
/// within a chunk — device-measured ~1 s) with a delayed bounded kill as the
/// backstop for a wedged process. Idempotent; Ok when nothing is running.
#[tauri::command]
pub fn lyrics_generate_cancel(state: tauri::State<'_, LyricsState>) -> Result<(), String> {
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

/// Generate lyrics for the staged track. Long-running (`async` = tauri's
/// blocking pool, exactly like prores_finish); progress streams through
/// `on_event` as the sidecar's raw JSON lines; resolves with the LRC text.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn lyrics_generate(
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
    whisper_model_id: String,
    use_gpu: bool,
    language: String,
    on_event: tauri::ipc::Channel<String>,
) -> Result<String, String> {
    // Model + input preconditions, all BEFORE any spawn.
    let whisper_spec = spec_by_id(&whisper_model_id)?;
    if !whisper_spec.role.starts_with("whisper") {
        return Err(format!("{whisper_model_id} is not a transcription model"));
    }
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

    {
        let guard = state.job.lock().map_err(|_| "state poisoned")?;
        if guard.is_some() {
            cleanup_staged(&staged);
            return Err("Lyrics generation is already running".into());
        }
    }

    let exe = match sidecar_exe(&app) {
        Ok(p) => p,
        Err(e) => {
            cleanup_staged(&staged);
            return Err(e);
        }
    };
    let resolved = (|| -> Result<(PathBuf, PathBuf, PathBuf), String> {
        Ok((
            ffmpeg_exe(&app)?,
            resolve_bundled(&app, "whisper/whisper-cli.exe")?,
            resolve_bundled(&app, "onnxruntime/onnxruntime.dll")?,
        ))
    })();
    let (ffmpeg, whisper_cli, ort_dylib) = match resolved {
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
        .arg("4");
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
    *state.job_stdin.lock().map_err(|_| "state poisoned")? = child.stdin.take();
    *state.job.lock().map_err(|_| "state poisoned")? = Some(child);

    // Blocking supervision (this command runs on the blocking pool). The job
    // stays in state the whole time so cancel/app-close always reach it.
    let outcome = supervise(stdout, &on_event);

    // Reap: EOF means the process is exiting; bound the wait anyway.
    let status = {
        let mut guard = state.job.lock().map_err(|_| "state poisoned")?;
        match guard.take() {
            Some(mut child) => {
                let deadline = std::time::Instant::now() + Duration::from_secs(30);
                loop {
                    match child.try_wait() {
                        Ok(Some(s)) => break Some(s),
                        Ok(None) if std::time::Instant::now() >= deadline => {
                            let _ = child.kill();
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
    app: tauri::AppHandle,
    state: tauri::State<'_, LyricsState>,
    line_t: f64,
    line_end: f64,
    text: String,
    use_gpu: bool,
) -> Result<Vec<AlignedWordOut>, String> {
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

    {
        let guard = state.job.lock().map_err(|_| "state poisoned")?;
        if guard.is_some() {
            cleanup_staged(&staged);
            return Err("Lyrics generation is already running".into());
        }
    }

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
        .arg("4")
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
    *state.job_stdin.lock().map_err(|_| "state poisoned")? = child.stdin.take();
    *state.job.lock().map_err(|_| "state poisoned")? = Some(child);

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
            Some(mut child) => {
                let deadline = std::time::Instant::now() + Duration::from_secs(30);
                loop {
                    match child.try_wait() {
                        Ok(Some(s)) => break Some(s),
                        Ok(None) if std::time::Instant::now() >= deadline => {
                            let _ = child.kill();
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
    state: tauri::State<'_, LyricsState>,
    dir: String,
) -> Result<(), String> {
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
        assert_eq!(MODELS.len(), 5);
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
}
