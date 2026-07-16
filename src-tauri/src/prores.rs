//! ProRes 4444 export via the bundled ffmpeg sidecar (LGPL build, separate
//! binary — see binaries/FFMPEG-LICENSE.txt).
//!
//! The webview renders frames exactly as the PNG-sequence export does and
//! streams each encoded PNG here; ffmpeg reads them over stdin (image2pipe),
//! muxes the pre-written PCM WAV, and writes the .mov. Args are built HERE
//! from structured parameters — the webview can never pass raw arguments to
//! a process. Blocking stdin writes give natural backpressure: the IPC call
//! doesn't return until ffmpeg accepted the frame.

use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

pub struct ProresJob {
    child: Child,
    stdin: Option<ChildStdin>,
    wav_path: PathBuf,
    log_path: PathBuf,
    out_path: PathBuf,
}

#[derive(Default)]
pub struct ProresState {
    pub job: Mutex<Option<ProresJob>>,
    pub pending_wav: Mutex<Option<PathBuf>>,
}

fn temp_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("av-prores-{}-{name}", std::process::id()))
}

/// The sidecar lands next to the app executable ("ffmpeg.exe") in bundles.
/// In `tauri dev` fall back to the repo's binaries folder.
fn ffmpeg_path() -> Result<PathBuf, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("ffmpeg.exe");
            if p.is_file() {
                return Ok(p);
            }
        }
    }
    let dev = PathBuf::from("binaries/ffmpeg-x86_64-pc-windows-msvc.exe");
    if dev.is_file() {
        return Ok(dev);
    }
    Err("ffmpeg sidecar not found — reinstall the app (or run scripts/fetch-ffmpeg.mjs in dev)"
        .into())
}

/// Build the exact ffmpeg invocation. Kept separate and pure for testing.
fn prores_args(fps: u32, wav: &str, out: &str) -> Vec<String> {
    [
        "-hide_banner",
        "-y",
        "-f",
        "image2pipe",
        "-framerate",
        &fps.to_string(),
        "-i",
        "-",
        "-i",
        wav,
        "-c:v",
        "prores_ks",
        "-profile:v",
        "4444",
        "-pix_fmt",
        "yuva444p10le",
        "-vendor",
        "apl0",
        "-c:a",
        "pcm_s16le",
        "-shortest",
        out,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// Stash the finished track's PCM audio (a complete WAV file, raw body) in a
/// temp file — ffmpeg needs a seekable audio input at spawn time.
#[tauri::command]
pub fn prores_set_audio(
    state: tauri::State<'_, ProresState>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw audio body".into());
    };
    let path = temp_path("audio.wav");
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    *state.pending_wav.lock().map_err(|_| "state poisoned")? = Some(path);
    Ok(())
}

#[tauri::command]
pub fn prores_begin(
    state: tauri::State<'_, ProresState>,
    fps: u32,
    out_path: String,
) -> Result<(), String> {
    let mut job_guard = state.job.lock().map_err(|_| "state poisoned")?;
    if job_guard.is_some() {
        return Err("A ProRes export is already running".into());
    }
    if !(1..=240).contains(&fps) {
        return Err(format!("Unreasonable fps: {fps}"));
    }
    let out = PathBuf::from(&out_path);
    if !out.is_absolute() || out.extension().map(|e| e != "mov").unwrap_or(true) {
        return Err("Output must be an absolute .mov path".into());
    }
    let wav_path = state
        .pending_wav
        .lock()
        .map_err(|_| "state poisoned")?
        .take()
        .ok_or("No audio staged — call prores_set_audio first")?;

    let log_path = temp_path("ffmpeg.log");
    let log = File::create(&log_path).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(ffmpeg_path()?);
    cmd.args(prores_args(
        fps,
        &wav_path.to_string_lossy(),
        &out.to_string_lossy(),
    ))
    .stdin(Stdio::piped())
    .stdout(Stdio::null())
    .stderr(Stdio::from(log));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — no console flash
    }
    let mut child = cmd.spawn().map_err(|e| format!("ffmpeg spawn failed: {e}"))?;
    let stdin = child.stdin.take();
    *job_guard = Some(ProresJob {
        child,
        stdin,
        wav_path,
        log_path,
        out_path: out,
    });
    Ok(())
}

/// One or more encoded PNG frames, in order (raw body). Blocking write =
/// backpressure: the invoke resolves only once ffmpeg took the bytes.
#[tauri::command]
pub fn prores_write(
    state: tauri::State<'_, ProresState>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw frame body".into());
    };
    let mut guard = state.job.lock().map_err(|_| "state poisoned")?;
    let job = guard.as_mut().ok_or("No ProRes export running")?;
    let stdin = job.stdin.as_mut().ok_or("Export already finishing")?;
    stdin.write_all(data).map_err(|e| {
        // ffmpeg died (bad frame, disk full): surface its log tail below via
        // finish/abort; here just report the pipe failure.
        format!("ffmpeg pipe write failed: {e}")
    })
}

fn log_tail(path: &PathBuf) -> String {
    std::fs::read_to_string(path)
        .map(|s| {
            let lines: Vec<&str> = s.lines().collect();
            lines[lines.len().saturating_sub(8)..].join("\n")
        })
        .unwrap_or_default()
}

fn cleanup(job: &ProresJob) {
    let _ = std::fs::remove_file(&job.wav_path);
    let _ = std::fs::remove_file(&job.log_path);
}

/// Close the frame pipe (EOF), wait for ffmpeg, verify success.
#[tauri::command]
pub fn prores_finish(state: tauri::State<'_, ProresState>) -> Result<(), String> {
    let mut guard = state.job.lock().map_err(|_| "state poisoned")?;
    let mut job = guard.take().ok_or("No ProRes export running")?;
    drop(job.stdin.take()); // EOF -> ffmpeg finalizes the mov
    let status = job.child.wait().map_err(|e| e.to_string());
    let ok = matches!(&status, Ok(s) if s.success());
    let tail = if ok { String::new() } else { log_tail(&job.log_path) };
    cleanup(&job);
    if ok {
        Ok(())
    } else {
        let _ = std::fs::remove_file(&job.out_path); // no half-written movs
        Err(format!("ffmpeg failed: {tail}"))
    }
}

/// Cancel: kill ffmpeg and remove the partial output.
#[tauri::command]
pub fn prores_abort(state: tauri::State<'_, ProresState>) -> Result<(), String> {
    let mut guard = state.job.lock().map_err(|_| "state poisoned")?;
    if let Some(mut job) = guard.take() {
        drop(job.stdin.take());
        let _ = job.child.kill();
        let _ = job.child.wait();
        let _ = std::fs::remove_file(&job.out_path);
        cleanup(&job);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_are_exactly_the_proven_contract() {
        let args = prores_args(30, "C:/t/a.wav", "C:/t/out.mov");
        assert_eq!(
            args,
            vec![
                "-hide_banner",
                "-y",
                "-f",
                "image2pipe",
                "-framerate",
                "30",
                "-i",
                "-",
                "-i",
                "C:/t/a.wav",
                "-c:v",
                "prores_ks",
                "-profile:v",
                "4444",
                "-pix_fmt",
                "yuva444p10le",
                "-vendor",
                "apl0",
                "-c:a",
                "pcm_s16le",
                "-shortest",
                "C:/t/out.mov",
            ]
        );
    }
}
