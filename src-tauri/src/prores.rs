//! Frame-pipe exports via the bundled ffmpeg sidecar (LGPL build, separate
//! binary — see binaries/FFMPEG-LICENSE.txt): ProRes 4444 (.mov), GIF and
//! animated WebP loops.
//!
//! The webview renders frames exactly as the PNG-sequence export does and
//! streams each encoded PNG here; ffmpeg reads them over stdin (image2pipe)
//! and writes the output file (muxing the pre-written PCM WAV for ProRes;
//! GIF/WebP carry no audio). Args are built HERE from structured parameters —
//! the webview can never pass raw arguments to a process. Blocking stdin
//! writes give natural backpressure: the IPC call doesn't return until
//! ffmpeg accepted the frame. One session at a time; prores_write/finish/
//! abort drive every format.

use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

pub struct ProresJob {
    child: Child,
    /// ProRes muxes a staged WAV; GIF/WebP sessions have no audio input.
    wav_path: Option<PathBuf>,
    log_path: PathBuf,
    out_path: PathBuf,
}

#[derive(Default)]
pub struct ProresState {
    pub job: Mutex<Option<ProresJob>>,
    /// The frame pipe, deliberately held in its OWN mutex rather than inside
    /// `job`.
    ///
    /// `prores_write` performs a BLOCKING `write_all` — that is the
    /// backpressure design, and it can legitimately block for a long time if
    /// ffmpeg stalls on a full pipe, a slow disk or a wedged encoder. When the
    /// pipe lived inside `job`, the writer held the `job` mutex for that whole
    /// time, and `prores_abort` needs that same mutex: cancel could never run.
    /// An export that wedged was unkillable.
    ///
    /// Split apart, abort takes only `job`, kills ffmpeg, and the kill breaks
    /// the pipe — which makes the blocked `write_all` fail and return. The
    /// writer unblocks itself as a consequence of the cancel.
    ///
    /// LOCK ORDER, where both are needed: `job` first, then `stdin`. Never the
    /// reverse. `prores_write` takes `stdin` alone.
    pub stdin: Mutex<Option<ChildStdin>>,
    pub pending_wav: Mutex<Option<PathBuf>>,
}

/// Monotonic suffix so two sessions in one process never collide.
static TEMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn temp_path(name: &str, seq: u64) -> PathBuf {
    std::env::temp_dir().join(format!("av-prores-{}-{seq}-{name}", std::process::id()))
}

/// Create a temp file that must NOT already exist.
///
/// `File::create` (and `fs::write`) truncate whatever is at the path and
/// FOLLOW symlinks. The old names were fully predictable —
/// `%TEMP%/av-prores-<pid>-audio.wav` — so anything that could write to
/// `%TEMP%` first could pre-plant a symlink there and turn a ProRes export
/// into an arbitrary-file overwrite. (`%TEMP%` is per-user on Windows, so this
/// was same-user only, which is why it is low severity rather than none.)
///
/// `create_new` fails if ANYTHING is already at the path, symlink included, so
/// there is no follow to exploit. On collision we advance the sequence rather
/// than deleting what is there — deleting would reintroduce the TOCTOU.
fn create_temp_new(name: &str) -> Result<(File, PathBuf), String> {
    use std::sync::atomic::Ordering;
    for _ in 0..64 {
        let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
        let path = temp_path(name, seq);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(f) => return Ok((f, path)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("could not create temp file: {e}")),
        }
    }
    Err("could not create a temp file (64 collisions)".into())
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
    Err(
        "ffmpeg sidecar not found — reinstall the app (or run scripts/fetch-ffmpeg.mjs in dev)"
            .into(),
    )
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

/// GIF/animated-WebP invocation (no audio). Kept separate and pure for
/// testing — proven against the bundled build (palettegen/paletteuse for GIF,
/// libwebp_anim for WebP; both decode with full frame counts in Chromium).
fn anim_args(format: &str, fps: u32, out: &str) -> Vec<String> {
    let mut args: Vec<String> = [
        "-hide_banner",
        "-y",
        "-f",
        "image2pipe",
        "-framerate",
        &fps.to_string(),
        "-i",
        "-",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    match format {
        "gif" => args.extend(
            [
                "-filter_complex",
                "[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:alpha_threshold=128",
                "-loop",
                "0",
            ]
            .iter()
            .map(|s| s.to_string()),
        ),
        _ => args.extend(
            [
                // Pin the muxer. Without an explicit -f, ffmpeg picks by
                // extension and lands on the image2 family for .webp, which
                // applies printf formatting to the filename: a save path
                // containing a %d token wrote ONE frame to a renamed file
                // instead of an animation. (.gif already resolves to the gif
                // muxer, so only webp needs pinning.)
                "-f",
                "webp",
                "-c:v",
                "libwebp_anim",
                "-lossless",
                "0",
                "-q:v",
                "80",
                "-loop",
                "0",
            ]
            .iter()
            .map(|s| s.to_string()),
        ),
    }
    args.push(out.to_string());
    args
}

/// True only for a plain LOCAL absolute path (a drive-letter path on Windows).
///
/// `is_absolute()` alone is not a sufficient gate: on Windows it also returns
/// true for UNC (`\\host\share\x.mov`). ffmpeg is spawned with `-y`, which
/// truncates unconditionally, and `prores_finish` removes the target on
/// failure — so accepting UNC turned "pick an output file" into a write/delete
/// primitive against an arbitrary remote host, plus an outbound NTLM
/// authentication to it. Only local disks are accepted.
fn is_local_absolute(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        let disk = matches!(
            path.components().next(),
            Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
        );
        disk && path.is_absolute()
    }
    #[cfg(not(windows))]
    {
        path.is_absolute()
    }
}

/// Case-insensitive extension check — Windows paths carry whatever case the
/// save dialog produced ("OUT.MOV" is a valid .mov path).
fn has_extension(path: &Path, ext: &str) -> bool {
    path.extension()
        .map(|e| e.to_string_lossy().eq_ignore_ascii_case(ext))
        .unwrap_or(false)
}

/// Shared spawn: pipe stdin, stderr to a log file, no console window.
fn spawn_sidecar(args: Vec<String>) -> Result<(Child, PathBuf), String> {
    let (log, log_path) = create_temp_new("ffmpeg.log")?;
    let mut cmd = Command::new(ffmpeg_path()?);
    cmd.args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — no console flash
    }
    let child = cmd.spawn().map_err(|e| {
        // Spawn failed — the log file we just created would otherwise leak.
        let _ = std::fs::remove_file(&log_path);
        format!("ffmpeg spawn failed: {e}")
    })?;
    Ok((child, log_path))
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
    // create_new + explicit write, NOT fs::write: the latter truncates through
    // a symlink planted at this predictable path. See create_temp_new.
    let (mut f, path) = create_temp_new("audio.wav")?;
    f.write_all(data).map_err(|e| e.to_string())?;
    drop(f);
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
    if !is_local_absolute(&out) || !has_extension(&out, "mov") {
        return Err("Output must be an absolute .mov path".into());
    }
    let wav_path = state
        .pending_wav
        .lock()
        .map_err(|_| "state poisoned")?
        .take()
        .ok_or("No audio staged — call prores_set_audio first")?;

    // From here the staged WAV is this function's to clean up: a spawn
    // failure must not leak it in %TEMP% (pending_wav was already taken).
    let (mut child, log_path) = match spawn_sidecar(prores_args(
        fps,
        &wav_path.to_string_lossy(),
        &out.to_string_lossy(),
    )) {
        Ok(v) => v,
        Err(e) => {
            let _ = std::fs::remove_file(&wav_path);
            return Err(e);
        }
    };
    *state.stdin.lock().map_err(|_| "state poisoned")? = child.stdin.take();
    *job_guard = Some(ProresJob {
        child,
        wav_path: Some(wav_path),
        log_path,
        out_path: out,
    });
    Ok(())
}

/// Begin a GIF or animated-WebP session (no audio). Frames flow through the
/// same prores_write/finish/abort commands — one sidecar session at a time.
#[tauri::command]
pub fn anim_begin(
    state: tauri::State<'_, ProresState>,
    format: String,
    fps: u32,
    out_path: String,
) -> Result<(), String> {
    let mut job_guard = state.job.lock().map_err(|_| "state poisoned")?;
    if job_guard.is_some() {
        return Err("A sidecar export is already running".into());
    }
    // GIF/WebP carry no audio: drop any WAV a prior prores_set_audio staged so
    // it can't orphan in %TEMP% when the user switches ProRes -> GIF/WebP.
    if let Ok(mut w) = state.pending_wav.lock() {
        if let Some(p) = w.take() {
            let _ = std::fs::remove_file(p);
        }
    }
    if !(1..=240).contains(&fps) {
        return Err(format!("Unreasonable fps: {fps}"));
    }
    if format != "gif" && format != "webp" {
        return Err(format!("Unknown animation format: {format}"));
    }
    let out = PathBuf::from(&out_path);
    if !is_local_absolute(&out) || !has_extension(&out, &format) {
        return Err(format!("Output must be an absolute .{format} path"));
    }
    let (mut child, log_path) = spawn_sidecar(anim_args(&format, fps, &out.to_string_lossy()))?;
    *state.stdin.lock().map_err(|_| "state poisoned")? = child.stdin.take();
    *job_guard = Some(ProresJob {
        child,
        wav_path: None,
        log_path,
        out_path: out,
    });
    Ok(())
}

/// One or more encoded PNG frames, in order (raw body). Blocking write =
/// backpressure: the invoke resolves only once ffmpeg took the bytes.
///
/// Takes the `stdin` mutex ONLY — never `job` — so a long or wedged write can
/// never block `prores_abort`. See ProresState::stdin.
#[tauri::command(async)]
pub fn prores_write(
    state: tauri::State<'_, ProresState>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw frame body".into());
    };
    let mut guard = state.stdin.lock().map_err(|_| "state poisoned")?;
    let stdin = guard.as_mut().ok_or("No sidecar export running")?;
    stdin.write_all(data).map_err(|e| {
        // ffmpeg died (bad frame, disk full) or abort killed it: surface its
        // log tail below via finish/abort; here just report the pipe failure.
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
    if let Some(wav) = &job.wav_path {
        let _ = std::fs::remove_file(wav);
    }
    let _ = std::fs::remove_file(&job.log_path);
}

/// Close the frame pipe (EOF), wait for ffmpeg, verify success.
///
/// `async` because `child.wait()` is unbounded — finalizing a multi-GB ProRes
/// movie or running GIF `paletteuse` took however long it took, and as a
/// blocking command that ran inline on the IPC handler and froze the UI.
#[tauri::command(async)]
pub fn prores_finish(state: tauri::State<'_, ProresState>) -> Result<(), String> {
    let mut guard = state.job.lock().map_err(|_| "state poisoned")?;
    let mut job = guard.take().ok_or("No sidecar export running")?;
    // EOF -> ffmpeg finalizes the output. Waits out an in-flight write, which
    // is correct: frames must all land before the pipe closes.
    drop(state.stdin.lock().map_err(|_| "state poisoned")?.take());
    let status = job.child.wait().map_err(|e| e.to_string());
    let ok = matches!(&status, Ok(s) if s.success());
    let tail = if ok {
        String::new()
    } else {
        log_tail(&job.log_path)
    };
    cleanup(&job);
    if ok {
        Ok(())
    } else {
        let _ = std::fs::remove_file(&job.out_path); // no half-written movs
        Err(format!("ffmpeg failed: {tail}"))
    }
}

/// Cancel: kill ffmpeg and remove the partial output.
///
/// Deliberately kills BEFORE reclaiming the pipe. A frame write may be blocked
/// in `prores_write` holding the `stdin` mutex; killing the child breaks the
/// pipe, that write fails, and the mutex is released. Taking `stdin` first
/// would just queue this cancel behind the very write it needs to interrupt —
/// which is the deadlock this split exists to remove.
#[tauri::command(async)]
pub fn prores_abort(state: tauri::State<'_, ProresState>) -> Result<(), String> {
    let mut guard = state.job.lock().map_err(|_| "state poisoned")?;
    if let Some(mut job) = guard.take() {
        let _ = job.child.kill();
        let _ = job.child.wait();
        // The writer has been broken loose by now; reclaim and close the pipe.
        if let Ok(mut s) = state.stdin.lock() {
            drop(s.take());
        }
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

    #[test]
    fn gif_args_are_exactly_the_proven_contract() {
        let args = anim_args("gif", 30, "C:/t/out.gif");
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
                "-filter_complex",
                "[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:alpha_threshold=128",
                "-loop",
                "0",
                "C:/t/out.gif",
            ]
        );
    }

    #[test]
    fn rejects_unc_and_relative_output_paths() {
        // ffmpeg runs with -y (unconditional truncate) and the finish path
        // removes the target on failure, so a UNC output would be a remote
        // write/delete primitive plus an outbound NTLM auth. is_absolute()
        // alone accepts UNC on Windows — this gate must not.
        assert!(!is_local_absolute(Path::new(
            r"\\attacker-host\share\x.mov"
        )));
        assert!(!is_local_absolute(Path::new("//attacker-host/share/x.mov")));
        assert!(!is_local_absolute(Path::new("relative/x.mov")));
        assert!(!is_local_absolute(Path::new("x.mov")));
    }

    #[test]
    fn a_blocked_frame_write_cannot_block_cancel() {
        // The deadlock this split removes: prores_write does a BLOCKING
        // write_all, and it used to hold the `job` mutex for the whole write.
        // prores_abort needs `job`, so a wedged ffmpeg made cancel impossible.
        //
        // The invariant now is that holding the frame pipe does not hold `job`.
        // Simulate a write that is stuck for a long time and assert a canceller
        // can still take `job` promptly. Before the split this would have had
        // to wait out the whole "write".
        use std::sync::Arc;
        use std::time::{Duration, Instant};

        let state = Arc::new(ProresState::default());
        let writer_state = Arc::clone(&state);
        let stuck = Duration::from_millis(500);

        let writer = std::thread::spawn(move || {
            let _pipe = writer_state.stdin.lock().unwrap();
            std::thread::sleep(stuck); // ffmpeg not draining the pipe
        });

        // Give the writer time to actually acquire the pipe.
        std::thread::sleep(Duration::from_millis(50));

        let t0 = Instant::now();
        let job = state.job.lock().expect("cancel must not wait on the pipe");
        let waited = t0.elapsed();
        drop(job);

        assert!(
            waited < Duration::from_millis(200),
            "taking the job mutex waited {waited:?} behind a blocked frame write — \
             the pipe is back inside `job` and cancel can deadlock again"
        );
        writer.join().unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn accepts_a_plain_drive_letter_path() {
        assert!(is_local_absolute(Path::new(r"C:\Users\me\out.mov")));
        assert!(is_local_absolute(Path::new("C:/Users/me/out.mov")));
    }

    #[test]
    fn webp_args_are_exactly_the_proven_contract() {
        let args = anim_args("webp", 30, "C:/t/out.webp");
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
                // Output muxer pinned: without it ffmpeg picks image2 for
                // .webp and printf-formats the filename, so a save path
                // containing %d produced one renamed frame, not an animation.
                "-f",
                "webp",
                "-c:v",
                "libwebp_anim",
                "-lossless",
                "0",
                "-q:v",
                "80",
                "-loop",
                "0",
                "C:/t/out.webp",
            ]
        );
    }
}
