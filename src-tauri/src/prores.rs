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
//!
//! The output file is whatever the user picked in the save dialog, and it is
//! bound to that pick by the fs plugin scope (see `check_out_path`) — not just
//! by the shape of the string the webview sent.

use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri_plugin_fs::FsExt;

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
    /// In-progress chunked audio staging (M10): the open temp file between
    /// `prores_audio_begin` and `prores_audio_end`. Chunking keeps the IPC
    /// bodies small — the old single-invoke path materialized the whole WAV
    /// (691 MB for an hour of stereo) a second time across the boundary.
    pub pending_wav_file: Mutex<Option<(File, PathBuf)>>,
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

/// The complete output-path policy for a sidecar session.
///
/// `scope_allows` is `app.fs_scope().is_allowed(out)` — the SAME gate
/// `scan_audio_library` is given, and the reason it belongs here too: ffmpeg is
/// spawned with `-y` (unconditional truncate) and both `prores_finish` and
/// `prores_abort` `remove_file(out_path)`. Validating only the SHAPE of the
/// path therefore left "start an export" as a truncate-and-delete primitive
/// against any local .mov/.gif/.webp a script running in the webview could
/// name — the path never had to be one the user chose.
///
/// tauri-plugin-dialog's `save()` calls `allow_file` on whatever the user
/// picked, so the real flow (pickSavePath -> proresBegin) passes; a path the
/// renderer invented on its own does not.
///
/// The shape checks stay in front of it as defence in depth. The scope can be
/// widened by a directory grant — the library folder picker grants a whole
/// subtree recursively — and neither the local-absolute nor the extension
/// check depends on the scope being narrow.
fn check_out_path(scope_allows: bool, out: &Path, ext: &str) -> Result<(), String> {
    if !is_local_absolute(out) || !has_extension(out, ext) {
        return Err(format!("Output must be an absolute .{ext} path"));
    }
    if !scope_allows {
        return Err(format!(
            "Output path not permitted: {} — choose the destination with the save dialog",
            out.display()
        ));
    }
    Ok(())
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

/// Drop any staged-but-unconsumed audio (both the finished WAV and a
/// half-written staging file) so nothing orphans in %TEMP%.
fn drop_stale_audio(state: &ProresState) {
    if let Ok(mut w) = state.pending_wav.lock() {
        if let Some(p) = w.take() {
            let _ = std::fs::remove_file(p);
        }
    }
    if let Ok(mut w) = state.pending_wav_file.lock() {
        if let Some((f, p)) = w.take() {
            drop(f);
            let _ = std::fs::remove_file(p);
        }
    }
}

/// Start staging the finished track's PCM audio (a complete WAV file) into a
/// temp file — ffmpeg needs a seekable audio input at spawn time. The WAV
/// arrives in chunks (`prores_audio_chunk`) and is sealed by
/// `prores_audio_end`; a fresh begin replaces any stale staging.
#[tauri::command]
pub fn prores_audio_begin(state: tauri::State<'_, ProresState>) -> Result<(), String> {
    drop_stale_audio(&state);
    // create_new + explicit writes, NOT fs::write: the latter truncates
    // through a symlink planted at this predictable path. See create_temp_new.
    let (f, path) = create_temp_new("audio.wav")?;
    *state
        .pending_wav_file
        .lock()
        .map_err(|_| "state poisoned")? = Some((f, path));
    Ok(())
}

/// Append one chunk of the WAV being staged (raw body).
#[tauri::command]
pub fn prores_audio_chunk(
    state: tauri::State<'_, ProresState>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw audio body".into());
    };
    let mut guard = state
        .pending_wav_file
        .lock()
        .map_err(|_| "state poisoned")?;
    let Some((f, _)) = guard.as_mut() else {
        return Err("No audio staging in progress — call prores_audio_begin first".into());
    };
    f.write_all(data).map_err(|e| e.to_string())
}

/// Seal the staged WAV; `prores_begin` consumes it.
#[tauri::command]
pub fn prores_audio_end(state: tauri::State<'_, ProresState>) -> Result<(), String> {
    let mut guard = state
        .pending_wav_file
        .lock()
        .map_err(|_| "state poisoned")?;
    let Some((f, path)) = guard.take() else {
        return Err("No audio staging in progress — call prores_audio_begin first".into());
    };
    drop(f);
    *state.pending_wav.lock().map_err(|_| "state poisoned")? = Some(path);
    Ok(())
}

#[tauri::command]
pub fn prores_begin(
    app: tauri::AppHandle,
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
    check_out_path(app.fs_scope().is_allowed(&out), &out, "mov")?;
    let wav_path = state
        .pending_wav
        .lock()
        .map_err(|_| "state poisoned")?
        .take()
        .ok_or("No audio staged — call prores_audio_begin/chunk/end first")?;

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
    app: tauri::AppHandle,
    state: tauri::State<'_, ProresState>,
    format: String,
    fps: u32,
    out_path: String,
) -> Result<(), String> {
    let mut job_guard = state.job.lock().map_err(|_| "state poisoned")?;
    if job_guard.is_some() {
        return Err("A sidecar export is already running".into());
    }
    // GIF/WebP carry no audio: drop any staged (or half-staged) WAV so it
    // can't orphan in %TEMP% when the user switches ProRes -> GIF/WebP.
    drop_stale_audio(&state);
    if !(1..=240).contains(&fps) {
        return Err(format!("Unreasonable fps: {fps}"));
    }
    if format != "gif" && format != "webp" {
        return Err(format!("Unknown animation format: {format}"));
    }
    let out = PathBuf::from(&out_path);
    check_out_path(app.fs_scope().is_allowed(&out), &out, &format)?;
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

/// How long `prores_finish` lets ffmpeg finalize before killing it.
///
/// Deliberately generous. Flushing a multi-GB ProRes 4444 to a slow external
/// disk, or running GIF `paletteuse` over thousands of buffered frames, takes
/// minutes on real hardware, and killing a healthy encoder would throw away a
/// finished render. The ceiling exists only so a WEDGED ffmpeg ends as an error
/// the user can act on instead of an export parked in "Finishing" forever.
const FINISH_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// Ceiling for reaping an ALREADY-KILLED child. Kill is TerminateProcess, so
/// this is near-instant in practice; the bound is here so `prores_abort` can
/// never hang while holding the job mutex.
const REAP_TIMEOUT: Duration = Duration::from_secs(10);

/// Poll interval for both bounded waits: short enough that finish returns
/// promptly after ffmpeg exits, long enough to cost nothing.
const WAIT_POLL: Duration = Duration::from_millis(50);

/// `Child::wait` with a deadline. std has no timeout on `wait`, so poll
/// `try_wait`. `Ok(None)` means the deadline passed and the child is STILL
/// running — the caller decides what to do about it.
fn wait_bounded(child: &mut Child, timeout: Duration) -> std::io::Result<Option<ExitStatus>> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(Some(status));
        }
        if Instant::now() >= deadline {
            return Ok(None);
        }
        std::thread::sleep(WAIT_POLL);
    }
}

/// Terminal state of a finalize wait. Every variant except `Cancelled` hands
/// back the job, because the caller owns the cleanup from there.
enum Finalize {
    /// ffmpeg exited 0 — the output file is complete.
    Done(ProresJob),
    /// ffmpeg exited non-zero, or `try_wait` itself failed.
    Failed(ProresJob),
    /// The deadline passed; ffmpeg has been killed and reaped.
    TimedOut(ProresJob),
    /// `prores_abort` took the job first — it killed ffmpeg and cleaned up.
    Cancelled,
}

/// Wait for ffmpeg to finish finalizing, bounded by `timeout`, WITHOUT ever
/// holding the job mutex across the wait.
///
/// Two distinct failures shape this loop.
///
/// 1. The original deadlock (audit E3): `prores_finish` held the `job` mutex
///    across an unbounded `child.wait()`, so a wedged finalize blocked
///    `prores_abort` on that same lock forever. Cancel was impossible.
/// 2. The fix for (1) — taking the job OUT before waiting — made cancel lie
///    instead: `prores_abort` found `None`, returned `Ok(())`, and the UI said
///    "cancelled" while ffmpeg was still running with the file open.
///
/// So the job STAYS in the mutex for the whole wait and this re-locks for each
/// `try_wait`, releasing before every sleep. Abort keeps a killable child to
/// reach, and this loop notices on its next poll and reports `Cancelled`.
fn await_finalize(job: &Mutex<Option<ProresJob>>, timeout: Duration) -> Result<Finalize, String> {
    let deadline = Instant::now() + timeout;
    loop {
        {
            let mut guard = job.lock().map_err(|_| "state poisoned")?;
            let Some(running) = guard.as_mut() else {
                return Ok(Finalize::Cancelled);
            };
            let polled = running.child.try_wait();
            let expired = Instant::now() >= deadline;
            match polled {
                Ok(Some(status)) => {
                    let success = status.success();
                    let done = guard.take().expect("job was Some one line above");
                    return Ok(if success {
                        Finalize::Done(done)
                    } else {
                        Finalize::Failed(done)
                    });
                }
                // We can no longer observe the child at all. Report a failed
                // export rather than spinning here until the deadline.
                Err(_) => {
                    let done = guard.take().expect("job was Some one line above");
                    return Ok(Finalize::Failed(done));
                }
                Ok(None) if expired => {
                    let _ = running.child.kill();
                    let _ = wait_bounded(&mut running.child, REAP_TIMEOUT);
                    let done = guard.take().expect("job was Some one line above");
                    return Ok(Finalize::TimedOut(done));
                }
                Ok(None) => {}
            }
            // guard drops HERE: never sleep holding the job mutex.
        }
        std::thread::sleep(WAIT_POLL);
    }
}

/// Close the frame pipe (EOF), wait for ffmpeg, verify success.
///
/// `async` because the wait can legitimately take minutes — finalizing a
/// multi-GB ProRes movie or running GIF `paletteuse`. As a blocking command
/// that ran inline on the IPC handler and froze the UI.
#[tauri::command(async)]
pub fn prores_finish(state: tauri::State<'_, ProresState>) -> Result<(), String> {
    {
        // Don't close the pipe of a session that isn't there.
        let guard = state.job.lock().map_err(|_| "state poisoned")?;
        if guard.is_none() {
            return Err("No sidecar export running".into());
        }
    }
    // EOF -> ffmpeg finalizes the output. Waits out an in-flight write, which
    // is correct: frames must all land before the pipe closes.
    drop(state.stdin.lock().map_err(|_| "state poisoned")?.take());
    // The job deliberately stays in `state.job` for the whole wait so a
    // concurrent prores_abort still finds a killable child (see await_finalize).
    // It also means a `prores_begin` fired during finalize is refused instead of
    // spawning a second ffmpeg into the first one's stdin slot.
    match await_finalize(&state.job, FINISH_TIMEOUT)? {
        Finalize::Done(job) => {
            cleanup(&job);
            Ok(())
        }
        Finalize::Failed(job) => {
            let tail = log_tail(&job.log_path);
            cleanup(&job);
            let _ = std::fs::remove_file(&job.out_path); // no half-written movs
            Err(format!("ffmpeg failed: {tail}"))
        }
        Finalize::TimedOut(job) => {
            let tail = log_tail(&job.log_path);
            cleanup(&job);
            let _ = std::fs::remove_file(&job.out_path);
            Err(format!(
                "ffmpeg stopped responding while finishing the file (waited {} minutes) and was \
                 stopped; the incomplete output was removed. {tail}",
                FINISH_TIMEOUT.as_secs() / 60
            ))
        }
        Finalize::Cancelled => Err("Export cancelled while finishing".into()),
    }
}

/// Cancel: kill ffmpeg and remove the partial output.
///
/// Deliberately kills BEFORE reclaiming the pipe. A frame write may be blocked
/// in `prores_write` holding the `stdin` mutex; killing the child breaks the
/// pipe, that write fails, and the mutex is released. Taking `stdin` first
/// would just queue this cancel behind the very write it needs to interrupt —
/// which is the deadlock this split exists to remove.
///
/// This also reaches a session that is already FINALIZING: `prores_finish`
/// leaves the job in the mutex while it waits, so the child below is the real
/// one. When that happens the finish call sees the job gone and reports the
/// cancel rather than claiming success.
#[tauri::command(async)]
pub fn prores_abort(state: tauri::State<'_, ProresState>) -> Result<(), String> {
    let mut guard = state.job.lock().map_err(|_| "state poisoned")?;
    if let Some(mut job) = guard.take() {
        let _ = job.child.kill();
        // Bounded: reaping a killed process is immediate, but an unbounded wait
        // here would be a wait held under the job mutex — the exact shape of
        // the deadlock this file keeps designing around.
        let _ = wait_bounded(&mut job.child, REAP_TIMEOUT);
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

    #[cfg(windows)]
    #[test]
    fn an_output_outside_the_fs_scope_is_refused() {
        // Audit E1: the shape checks alone never bound the output to something
        // the USER picked. ffmpeg runs with -y and finish/abort remove_file the
        // target, so a perfectly well-formed local .mov the renderer simply
        // named was a truncate-and-delete primitive.
        let picked = Path::new(r"C:\Users\me\Videos\out.mov");
        assert!(check_out_path(true, picked, "mov").is_ok());

        let err = check_out_path(false, picked, "mov").expect_err("scope gate must refuse");
        assert!(
            err.contains("not permitted"),
            "the rejection must say WHY: {err}"
        );
        assert!(
            check_out_path(false, Path::new(r"C:\Users\me\loop.gif"), "gif").is_err(),
            "GIF/WebP go through the same gate"
        );
    }

    #[test]
    fn the_shape_checks_survive_a_permissive_scope() {
        // Defence in depth: a directory grant (the library picker allows a whole
        // subtree) can make is_allowed true for paths these checks still reject.
        assert!(check_out_path(true, Path::new(r"\\host\share\x.mov"), "mov").is_err());
        assert!(check_out_path(true, Path::new("relative/x.mov"), "mov").is_err());
        #[cfg(windows)]
        assert!(
            check_out_path(true, Path::new(r"C:\Users\me\out.txt"), "mov").is_err(),
            "extension is still pinned"
        );
    }

    /// A child that will NOT exit on its own — a stand-in for a wedged ffmpeg.
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

    /// A child that exits immediately with `code`.
    fn spawn_exiting(code: i32) -> Child {
        let code = code.to_string();
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.args(["/c", "exit", &code]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", &format!("exit {code}")]);
            c
        };
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn test child")
    }

    fn test_job(child: Child) -> ProresJob {
        // Paths that do not exist: nothing in await_finalize touches them.
        ProresJob {
            child,
            wav_path: None,
            log_path: temp_path("test-finalize.log", u64::MAX),
            out_path: temp_path("test-finalize.mov", u64::MAX),
        }
    }

    #[test]
    fn a_wedged_finalize_is_bounded_and_kills_ffmpeg() {
        // Audit E3 residual: child.wait() had no ceiling, so an ffmpeg that
        // wedged during finalize left the export in "Finishing" forever.
        let job = Mutex::new(Some(test_job(spawn_wedged())));
        let started = Instant::now();
        let outcome = await_finalize(&job, Duration::from_millis(200)).unwrap();
        let Finalize::TimedOut(mut timed_out) = outcome else {
            panic!("a child that never exits must time out");
        };
        assert!(
            started.elapsed() < Duration::from_secs(20),
            "the wait must be bounded, not merely long"
        );
        assert!(
            timed_out.child.try_wait().unwrap().is_some(),
            "the wedged ffmpeg must be killed, not left running with the file open"
        );
        assert!(job.lock().unwrap().is_none(), "the job must be cleared");
    }

    #[test]
    fn a_cancel_during_finalize_still_reaches_the_child() {
        // Audit V2: the previous fix TOOK the job before waiting, so a
        // concurrent prores_abort found None and returned Ok(()) without
        // killing anything — the UI reported "cancelled" while ffmpeg ran on.
        // The job must stay reachable for the whole wait.
        use std::sync::Arc;

        let job = Arc::new(Mutex::new(Some(test_job(spawn_wedged()))));
        let waiting = Arc::clone(&job);
        let waiter =
            std::thread::spawn(move || await_finalize(&waiting, Duration::from_secs(60)).unwrap());
        std::thread::sleep(Duration::from_millis(120));

        // Exactly what prores_abort does.
        let mut cancelled = job
            .lock()
            .expect("cancel must not wait on the finalize loop")
            .take()
            .expect("finish must NOT have taken the job — abort would silently no-op");
        let _ = cancelled.child.kill();
        assert!(
            wait_bounded(&mut cancelled.child, Duration::from_secs(10))
                .unwrap()
                .is_some(),
            "the cancel must genuinely reap ffmpeg"
        );

        assert!(matches!(waiter.join().unwrap(), Finalize::Cancelled));
    }

    #[test]
    fn a_clean_exit_finishes_and_a_bad_one_fails() {
        let ok = Mutex::new(Some(test_job(spawn_exiting(0))));
        assert!(matches!(
            await_finalize(&ok, Duration::from_secs(30)).unwrap(),
            Finalize::Done(_)
        ));
        let bad = Mutex::new(Some(test_job(spawn_exiting(3))));
        assert!(matches!(
            await_finalize(&bad, Duration::from_secs(30)).unwrap(),
            Finalize::Failed(_)
        ));
    }

    #[test]
    fn wait_bounded_reports_a_live_child_instead_of_hanging() {
        let mut child = spawn_wedged();
        assert!(
            wait_bounded(&mut child, Duration::from_millis(150))
                .unwrap()
                .is_none(),
            "a running child must come back as None, not block"
        );
        let _ = child.kill();
        assert!(wait_bounded(&mut child, REAP_TIMEOUT).unwrap().is_some());
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
