//! Beatform lyrics sidecar (FEAT-004 phases 2+3): fully-local automatic
//! lyrics.
//!
//! decode (ffmpeg) -> MDX-Net vocal isolation (ONNX Runtime, DirectML-first)
//! -> separation-as-VAD -> whisper.cpp on the FULL MIX with VAD post-split
//! -> (phase 3, when the alignment model is provided) wav2vec2 CTC forced
//! alignment of each line against the vocal stem -> enhanced word-tag LRC.
//! One JSON event per stdout line (protocol.rs); cancel = one "cancel" line
//! on stdin, or a plain kill. Every path/argument comes from the supervising
//! app — this binary never invents paths of its own.
//!
//! This is OFFLINE AUTHORING: the output is an .lrc ARTIFACT consumed by the
//! app's existing import path. Nothing here touches render determinism.

mod align;
mod audio;
mod lines;
mod lrc;
mod mdx;
mod protocol;
mod resample;
mod stft;
mod vad;
mod whisper;

use protocol::{emit, Event, Stage};
use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

const GENERATOR_TAG: &str = "Beatform local lyrics v1";
/// Exit codes: 0 ok, 1 error, 2 bad usage, 3 cancelled.
const EXIT_ERROR: i32 = 1;
const EXIT_USAGE: i32 = 2;
const EXIT_CANCELLED: i32 = 3;

#[derive(Debug, PartialEq)]
struct Args {
    input: PathBuf,
    out: PathBuf,
    ffmpeg: PathBuf,
    whisper_cli: PathBuf,
    whisper_model: PathBuf,
    mdx_model: PathBuf,
    ort_dylib: PathBuf,
    gpu: mdx::GpuMode,
    language: String,
    threads: usize,
    dump_stem: Option<PathBuf>,
    /// wav2vec2 CTC model + vocab (phase 3). Both or neither: absent = the
    /// job stays line-level, exactly the phase-2 behavior.
    align_model: Option<PathBuf>,
    align_vocab: Option<PathBuf>,
}

/// `--align-line` (phase 4): re-align ONE line's text against a short WAV
/// slice the app cut around that line. Same isolation + CTC stages as the
/// full run, no whisper — the text is the user's own correction.
#[derive(Debug, PartialEq)]
struct AlignLineArgs {
    input: PathBuf,
    ffmpeg: PathBuf,
    mdx_model: PathBuf,
    ort_dylib: PathBuf,
    align_model: PathBuf,
    align_vocab: PathBuf,
    gpu: mdx::GpuMode,
    threads: usize,
    /// Line window, seconds RELATIVE TO THE SLICE (the app cut the slice, so
    /// only it can say where the line sits inside it).
    line_t: f64,
    line_end: f64,
    text: String,
}

enum Mode {
    Run(Box<Args>),
    AlignLine(Box<AlignLineArgs>),
    ProbeGpu { ort_dylib: PathBuf },
}

/// Hand-rolled `--flag value` parsing: the caller is the app (which builds
/// argument vectors from structured data, prores-style), not a human — a
/// clap dependency would be surface without benefit. Pure for testing.
fn parse_args(argv: &[String]) -> Result<Mode, String> {
    let mut map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut probe = false;
    let mut align_line = false;
    let mut i = 0;
    while i < argv.len() {
        let a = &argv[i];
        if a == "--probe-gpu" {
            probe = true;
            i += 1;
            continue;
        }
        if a == "--align-line" {
            align_line = true;
            i += 1;
            continue;
        }
        if !a.starts_with("--") {
            return Err(format!("unexpected argument: {a}"));
        }
        let key = a[2..].to_string();
        let val = argv
            .get(i + 1)
            .ok_or(format!("missing value for --{key}"))?;
        map.insert(key, val.clone());
        i += 2;
    }
    let take =
        |map: &mut std::collections::HashMap<String, String>, k: &str| -> Result<PathBuf, String> {
            map.remove(k)
                .map(PathBuf::from)
                .ok_or(format!("missing required --{k}"))
        };
    if probe {
        let ort_dylib = take(&mut map, "ort-dylib")?;
        if let Some(k) = map.keys().next() {
            return Err(format!("unknown argument for probe mode: --{k}"));
        }
        return Ok(Mode::ProbeGpu { ort_dylib });
    }
    if align_line {
        let take_f64 =
            |map: &mut std::collections::HashMap<String, String>, k: &str| -> Result<f64, String> {
                map.remove(k)
                    .ok_or(format!("missing required --{k}"))?
                    .parse::<f64>()
                    .map_err(|_| format!("bad --{k}"))
            };
        let args = AlignLineArgs {
            input: take(&mut map, "input")?,
            ffmpeg: take(&mut map, "ffmpeg")?,
            mdx_model: take(&mut map, "mdx-model")?,
            ort_dylib: take(&mut map, "ort-dylib")?,
            align_model: take(&mut map, "align-model")?,
            align_vocab: take(&mut map, "align-vocab")?,
            gpu: mdx::GpuMode::parse(map.remove("gpu").as_deref().unwrap_or("auto"))?,
            threads: map
                .remove("threads")
                .map(|t| {
                    t.parse::<usize>()
                        .map_err(|_| format!("bad --threads: {t}"))
                })
                .transpose()?
                .unwrap_or(4),
            line_t: take_f64(&mut map, "line-t")?,
            line_end: take_f64(&mut map, "line-end")?,
            text: map
                .remove("line-text")
                .ok_or("missing required --line-text")?,
        };
        if args.line_end <= args.line_t || args.line_t < 0.0 {
            return Err("--line-end must be after --line-t (both >= 0)".into());
        }
        if args.text.trim().is_empty() {
            return Err("--line-text must not be empty".into());
        }
        if let Some(k) = map.keys().next() {
            return Err(format!("unknown argument for align-line mode: --{k}"));
        }
        return Ok(Mode::AlignLine(Box::new(args)));
    }
    let args = Args {
        input: take(&mut map, "input")?,
        out: take(&mut map, "out")?,
        ffmpeg: take(&mut map, "ffmpeg")?,
        whisper_cli: take(&mut map, "whisper-cli")?,
        whisper_model: take(&mut map, "whisper-model")?,
        mdx_model: take(&mut map, "mdx-model")?,
        ort_dylib: take(&mut map, "ort-dylib")?,
        gpu: mdx::GpuMode::parse(map.remove("gpu").as_deref().unwrap_or("auto"))?,
        language: map.remove("language").unwrap_or_else(|| "auto".into()),
        threads: map
            .remove("threads")
            .map(|t| {
                t.parse::<usize>()
                    .map_err(|_| format!("bad --threads: {t}"))
            })
            .transpose()?
            .unwrap_or(4),
        dump_stem: map.remove("dump-stem").map(PathBuf::from),
        align_model: map.remove("align-model").map(PathBuf::from),
        align_vocab: map.remove("align-vocab").map(PathBuf::from),
    };
    if args.align_model.is_some() != args.align_vocab.is_some() {
        return Err("--align-model and --align-vocab must be passed together".into());
    }
    if let Some(k) = map.keys().next() {
        return Err(format!("unknown argument: --{k}"));
    }
    Ok(Mode::Run(Box::new(args)))
}

/// Shared cancel state: the stdin watcher flips the flag and kills whatever
/// child is currently registered (the decode ffmpeg, then whisper); the
/// chunked MDX loop polls the flag between chunks. Registration is what
/// makes cancel reach a child wedged in a blocking pipe read — the flag
/// alone is only ever polled between chunks.
struct Canceller {
    flag: AtomicBool,
    child: Mutex<Option<std::process::Child>>,
}

impl Canceller {
    fn cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }
}

fn spawn_cancel_watcher(state: Arc<Canceller>) {
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            let Ok(line) = line else { break };
            if line.trim() == "cancel" {
                state.flag.store(true, Ordering::SeqCst);
                if let Ok(mut guard) = state.child.lock() {
                    if let Some(child) = guard.as_mut() {
                        let _ = child.kill();
                    }
                }
                break;
            }
        }
        // stdin EOF without "cancel": the supervisor is gone or holds the
        // pipe open — either way there is nothing more to watch.
    });
}

/// End the process WITHOUT running atexit/DLL teardown.
///
/// Device finding (reference Iris Xe, sustained load): after the pipeline
/// fully succeeded — LRC on disk, result event flushed — ONNX Runtime's
/// DirectML stack misbehaved in `DLL_PROCESS_DETACH` in two observed ways:
/// a fast-fail 0xC0000409 that turned a clean run into a crash exit, and a
/// process that never exited at all (alive for 20+ minutes with the session
/// memory still mapped). Everything this process produces is out (stdout is
/// flushed per event, files are written) by the time an exit happens, so
/// skipping loader teardown is safe — and it is the only reliable way to
/// end a process whose GPU driver stack can't unload itself.
fn hard_exit(code: i32) -> ! {
    #[cfg(windows)]
    {
        #[link(name = "kernel32")]
        extern "system" {
            fn GetCurrentProcess() -> isize;
            fn TerminateProcess(handle: isize, code: u32) -> i32;
        }
        // SAFETY: the pseudo-handle from GetCurrentProcess is always valid;
        // terminating the current process does not return.
        unsafe {
            TerminateProcess(GetCurrentProcess(), code as u32);
        }
    }
    std::process::exit(code)
}

fn fail(message: &str) -> ! {
    emit(&Event::Error { message });
    hard_exit(EXIT_ERROR);
}

fn cancelled_exit() -> ! {
    emit(&Event::Cancelled);
    hard_exit(EXIT_CANCELLED);
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mode = match parse_args(&argv) {
        Ok(m) => m,
        Err(e) => {
            emit(&Event::Error { message: &e });
            std::process::exit(EXIT_USAGE); // nothing GPU-ish loaded yet
        }
    };
    match mode {
        Mode::ProbeGpu { ort_dylib } => {
            if let Err(e) = mdx::init_runtime(&ort_dylib) {
                fail(&e);
            }
            emit(&Event::Probe {
                dml: mdx::probe_dml(),
            });
            hard_exit(0);
        }
        Mode::AlignLine(args) => {
            run_align_line(*args);
            hard_exit(0);
        }
        Mode::Run(args) => {
            run(*args);
            // run() emitted the result; never fall into DLL teardown.
            hard_exit(0);
        }
    }
}

/// `--align-line`: decode the slice, isolate its vocal, re-align the given
/// text against it, emit ONE AlignedLine event. Times stay slice-relative —
/// the app knows where the slice sits in the track; this process never does.
fn run_align_line(args: AlignLineArgs) {
    let cancel = Arc::new(Canceller {
        flag: AtomicBool::new(false),
        child: Mutex::new(None),
    });
    spawn_cancel_watcher(Arc::clone(&cancel));

    let slice = match audio::decode(&args.ffmpeg, &args.input, &cancel) {
        Ok(m) => m,
        // A cancel kill surfaces as a decode error; report the cancel.
        Err(_) if cancel.cancelled() => cancelled_exit(),
        Err(e) => fail(&e),
    };
    let duration = slice.duration_sec();
    if duration < 0.3 {
        fail("audio slice too short to align");
    }
    if cancel.cancelled() {
        cancelled_exit();
    }

    if let Err(e) = mdx::init_runtime(&args.ort_dylib) {
        fail(&e);
    }
    let mut session = match mdx::Mdx::create(&args.mdx_model, args.gpu, args.threads) {
        Ok(s) => s,
        Err(e) => fail(&e),
    };
    let stem = {
        let result = session.separate(&slice.left, &slice.right, &cancel.flag, |done, total| {
            emit(&Event::Progress {
                stage: Stage::Isolate,
                pct: Some(100.0 * done as f64 / total as f64),
                eta_sec: None,
                rtf: None,
            });
        });
        match result {
            Ok(Some(stem)) => stem,
            Ok(None) => cancelled_exit(),
            Err(e) => fail(&e),
        }
    };
    let stem16 = resample::stem_to_16k_mono(&stem.0, &stem.1);
    drop(stem);
    if cancel.cancelled() {
        cancelled_exit();
    }

    let mut aligner =
        match align::Aligner::create(&args.align_model, &args.align_vocab, args.threads) {
            Ok(a) => a,
            Err(e) => fail(&e),
        };
    let line = lines::Line {
        t: args.line_t.min(duration),
        end: args.line_end.min(duration),
        text: args.text.clone(),
        words: Vec::new(),
    };
    let track_sec = stem16.len() as f64 / resample::OUT_RATE as f64;
    match align::align_one(&mut aligner, &stem16, track_sec, &line) {
        Ok(words) => {
            let out: Vec<protocol::AlignedWord> = words
                .into_iter()
                .map(|w| protocol::AlignedWord {
                    t: w.t,
                    end: w.end,
                    conf: w.conf,
                    text: w.text,
                })
                .collect();
            emit(&Event::AlignedLine { words: &out });
        }
        Err(e) => fail(&format!("could not align this line: {e}")),
    }
}

fn run(args: Args) {
    let cancel = Arc::new(Canceller {
        flag: AtomicBool::new(false),
        child: Mutex::new(None),
    });
    spawn_cancel_watcher(Arc::clone(&cancel));

    // ---- decode --------------------------------------------------------
    emit(&Event::Progress {
        stage: Stage::Decode,
        pct: None,
        eta_sec: None,
        rtf: None,
    });
    let t0 = Instant::now();
    let mix = match audio::decode(&args.ffmpeg, &args.input, &cancel) {
        Ok(m) => m,
        // A cancel kill surfaces as a decode error; report the cancel.
        Err(_) if cancel.cancelled() => cancelled_exit(),
        Err(e) => fail(&e),
    };
    let duration = mix.duration_sec();
    if duration < 1.0 {
        fail("track is shorter than one second — nothing to transcribe");
    }
    emit(&Event::StageDone {
        stage: Stage::Decode,
        wall_sec: t0.elapsed().as_secs_f64(),
        rtf: None,
        detail: None,
    });
    if cancel.cancelled() {
        cancelled_exit();
    }

    // ---- isolate -------------------------------------------------------
    if let Err(e) = mdx::init_runtime(&args.ort_dylib) {
        fail(&e);
    }
    let mut session = match mdx::Mdx::create(&args.mdx_model, args.gpu, args.threads) {
        Ok(s) => s,
        Err(e) => fail(&e),
    };
    let ep = session.ep;
    let t0 = Instant::now();
    let stem = {
        let started = Instant::now();
        let result = session.separate(&mix.left, &mix.right, &cancel.flag, |done, total| {
            let elapsed = started.elapsed().as_secs_f64();
            let audio_done = (done * stft::GEN) as f64 / audio::SAMPLE_RATE as f64;
            let pct = 100.0 * done as f64 / total as f64;
            emit(&Event::Progress {
                stage: Stage::Isolate,
                pct: Some(pct),
                eta_sec: (done > 0).then(|| elapsed / done as f64 * (total - done) as f64),
                rtf: (audio_done > 1.0).then(|| elapsed / audio_done.min(duration)),
            });
        });
        match result {
            Ok(Some(stem)) => stem,
            Ok(None) => cancelled_exit(),
            Err(e) => fail(&e),
        }
    };
    let isolate_wall = t0.elapsed().as_secs_f64();
    emit(&Event::StageDone {
        stage: Stage::Isolate,
        wall_sec: isolate_wall,
        rtf: Some(isolate_wall / duration),
        detail: Some(if ep == "dml" { "DirectML" } else { "CPU" }),
    });
    if let Some(dump) = &args.dump_stem {
        let wav = audio::wav_s16(&audio::Stereo {
            left: stem.0.clone(),
            right: stem.1.clone(),
        });
        if let Err(e) = std::fs::write(dump, wav) {
            fail(&format!("could not write --dump-stem file: {e}"));
        }
    }
    if cancel.cancelled() {
        cancelled_exit();
    }

    // ---- vad (+ the 16 kHz mono stem the alignment stage reads) --------
    let t0 = Instant::now();
    let stem16: Vec<f32> = if args.align_model.is_some() {
        resample::stem_to_16k_mono(&stem.0, &stem.1)
    } else {
        Vec::new() // alignment not requested — skip the resample entirely
    };
    let verdict = vad::detect(&stem.0, &stem.1);
    let regions = verdict.regions;
    let vocal_sec = vad::total_active(&regions).max(0.0);
    drop(stem);
    emit(&Event::StageDone {
        stage: Stage::Vad,
        wall_sec: t0.elapsed().as_secs_f64(),
        rtf: None,
        detail: None,
    });

    // ---- transcribe (full mix — spike adjustment 3) --------------------
    let t0 = Instant::now();
    let parsed = match transcribe(&args, duration, &cancel) {
        Ok(p) => p,
        Err(TranscribeError::Cancelled) => cancelled_exit(),
        Err(TranscribeError::Failed(e)) => fail(&e),
    };
    let transcribe_wall = t0.elapsed().as_secs_f64();
    emit(&Event::StageDone {
        stage: Stage::Transcribe,
        wall_sec: transcribe_wall,
        rtf: Some(transcribe_wall / duration),
        detail: None,
    });
    if cancel.cancelled() {
        cancelled_exit();
    }

    // ---- assemble ------------------------------------------------------
    let t0 = Instant::now();
    let mut assembled = lines::assemble(lines::AssembleInput {
        segments: &parsed.transcription,
        vad: &regions,
        stem_peak_db: verdict.stem_peak_db,
        track_duration_sec: duration,
    });
    if assembled.is_empty() {
        if vocal_sec < 4.0 {
            fail("No vocals found — the track appears to be instrumental");
        }
        fail("Transcription produced no usable lines for this track");
    }
    let assemble_wall = t0.elapsed().as_secs_f64();

    // ---- align (phase 3 — only when the model was provided) ------------
    let align_summary = align_stage(&args, &stem16, &mut assembled, &cancel, duration);
    drop(stem16);

    // ---- write ---------------------------------------------------------
    let t0 = Instant::now();
    let lrc_text = lrc::write_lrc(&assembled, GENERATOR_TAG);
    if let Err(e) = std::fs::write(&args.out, &lrc_text) {
        fail(&format!("could not write LRC: {e}"));
    }
    emit(&Event::StageDone {
        stage: Stage::Assemble,
        wall_sec: assemble_wall + t0.elapsed().as_secs_f64(),
        rtf: None,
        detail: None,
    });
    // Phase-4 confidence sidechannel: one entry per line, in LRC order. The
    // A2 format cannot carry confidence, so the correction editor gets it
    // here — session-side, never in the artifact.
    let line_details: Option<Vec<protocol::LineDetail>> = align_summary.as_ref().map(|_| {
        assembled
            .iter()
            .map(|l| protocol::LineDetail {
                conf: (!l.words.is_empty()).then(|| {
                    l.words.iter().map(|w| w.conf).sum::<f64>() / l.words.len().max(1) as f64
                }),
                words: l.words.iter().map(|w| w.conf).collect(),
            })
            .collect()
    });
    emit(&Event::Result {
        lrc_path: &args.out.to_string_lossy(),
        lines: assembled.len(),
        words: align_summary.as_ref().map(|s| s.words).unwrap_or(0),
        aligned_lines: align_summary.as_ref().map(|s| s.aligned_lines).unwrap_or(0),
        low_conf_lines: align_summary
            .as_ref()
            .map(|s| s.low_conf_lines)
            .unwrap_or(0),
        vocal_sec,
        ep,
        language: &parsed.result.language,
        line_details: line_details.as_deref(),
    });
}

/// Run the forced-alignment stage when requested. Alignment is an
/// ENHANCEMENT: any failure here (model unloadable, vocab wrong) degrades
/// the job to line-level with a diagnostic — the transcript still ships.
/// Only cancellation exits.
fn align_stage(
    args: &Args,
    stem16: &[f32],
    assembled: &mut [lines::Line],
    cancel: &Arc<Canceller>,
    duration: f64,
) -> Option<align::Summary> {
    let (Some(model), Some(vocab)) = (&args.align_model, &args.align_vocab) else {
        return None;
    };
    emit(&Event::Progress {
        stage: Stage::Align,
        pct: None,
        eta_sec: None,
        rtf: None,
    });
    let t0 = Instant::now();
    let mut aligner = match align::Aligner::create(model, vocab, args.threads) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("[lyrics-sidecar] alignment unavailable: {e}");
            emit(&Event::StageDone {
                stage: Stage::Align,
                wall_sec: t0.elapsed().as_secs_f64(),
                rtf: None,
                detail: Some("unavailable — line timing only"),
            });
            return None;
        }
    };
    let started = Instant::now();
    let total_lines = assembled.len();
    let outcome = align::align_lines(
        &mut aligner,
        stem16,
        assembled,
        &cancel.flag,
        |done, total| {
            let elapsed = started.elapsed().as_secs_f64();
            emit(&Event::Progress {
                stage: Stage::Align,
                pct: Some(100.0 * done as f64 / total as f64),
                eta_sec: (done > 0).then(|| elapsed / done as f64 * (total - done) as f64),
                rtf: None,
            });
        },
    );
    match outcome {
        align::Outcome::Done(summary) => {
            let wall = t0.elapsed().as_secs_f64();
            let detail = format!("{}/{total_lines} lines", summary.aligned_lines);
            emit(&Event::StageDone {
                stage: Stage::Align,
                wall_sec: wall,
                rtf: Some(wall / duration),
                detail: Some(&detail),
            });
            Some(summary)
        }
        align::Outcome::Cancelled => cancelled_exit(),
    }
}

enum TranscribeError {
    Cancelled,
    Failed(String),
}

/// Spawn whisper-cli on the ORIGINAL input file (full mix), stream progress
/// from its stderr, parse the `-ojf` JSON it writes.
fn transcribe(
    args: &Args,
    duration: f64,
    cancel: &Arc<Canceller>,
) -> Result<whisper::WhisperJson, TranscribeError> {
    // Unique output prefix in the OS temp dir; whisper appends ".json".
    let prefix = std::env::temp_dir().join(format!(
        "beatform-lyrics-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default()
    ));
    let json_path = PathBuf::from(format!("{}.json", prefix.to_string_lossy()));

    let mut cmd = Command::new(&args.whisper_cli);
    cmd.arg("-m")
        .arg(&args.whisper_model)
        .arg("-f")
        .arg(&args.input)
        .arg("-ojf")
        .arg("-of")
        .arg(&prefix)
        .arg("-t")
        .arg(args.threads.to_string())
        .arg("-bs")
        .arg("5")
        .arg("-l")
        .arg(&args.language)
        .arg("-pp")
        .arg("-np")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| TranscribeError::Failed(format!("whisper-cli spawn failed: {e}")))?;

    // Progress reader: whisper's `-pp` prints "... progress = NN%" lines.
    let stderr = child.stderr.take().expect("stderr piped");
    let started = Instant::now();
    let reader = std::thread::spawn(move || {
        let mut tail: Vec<String> = Vec::new();
        let mut buf = String::new();
        let mut r = std::io::BufReader::new(stderr);
        loop {
            buf.clear();
            // read_line, not lines(): whisper writes \r progress on some
            // paths; read_line still terminates on \n which is what it uses.
            match r.read_line(&mut buf) {
                Ok(0) => break,
                Ok(_) => {
                    let line = buf.trim();
                    if let Some(pct) = parse_whisper_progress(line) {
                        let elapsed = started.elapsed().as_secs_f64();
                        emit(&Event::Progress {
                            stage: Stage::Transcribe,
                            pct: Some(pct),
                            eta_sec: (pct > 1.0).then(|| elapsed * (100.0 - pct) / pct),
                            rtf: None,
                        });
                    } else if !line.is_empty() {
                        tail.push(line.to_string());
                        if tail.len() > 8 {
                            tail.remove(0);
                        }
                    }
                }
                Err(_) => break,
            }
        }
        tail.join(" | ")
    });

    // Register for cancel-kill, then wait.
    *cancel.child.lock().expect("cancel mutex") = Some(child);
    let status = loop {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let mut guard = cancel.child.lock().expect("cancel mutex");
        let Some(running) = guard.as_mut() else {
            return Err(TranscribeError::Cancelled);
        };
        match running.try_wait() {
            Ok(Some(status)) => {
                guard.take();
                break status;
            }
            Ok(None) => {}
            Err(e) => {
                guard.take();
                let _ = std::fs::remove_file(&json_path);
                return Err(TranscribeError::Failed(format!(
                    "whisper-cli wait failed: {e}"
                )));
            }
        }
    };
    let stderr_tail = reader.join().unwrap_or_default();
    if cancel.cancelled() {
        let _ = std::fs::remove_file(&json_path);
        return Err(TranscribeError::Cancelled);
    }
    if !status.success() {
        let _ = std::fs::remove_file(&json_path);
        return Err(TranscribeError::Failed(format!(
            "whisper-cli failed ({status}): {stderr_tail}"
        )));
    }
    let _ = duration; // duration is carried in events; whisper owns its own pacing
    let json = std::fs::read_to_string(&json_path)
        .map_err(|e| TranscribeError::Failed(format!("whisper output missing: {e}")))?;
    let _ = std::fs::remove_file(&json_path);
    whisper::parse(&json).map_err(TranscribeError::Failed)
}

/// "whisper_print_progress_callback: progress =   5%" -> 5.0
fn parse_whisper_progress(line: &str) -> Option<f64> {
    let idx = line.find("progress =")?;
    let rest = line[idx + "progress =".len()..].trim();
    let num = rest.strip_suffix('%')?.trim();
    num.parse::<f64>()
        .ok()
        .filter(|p| (0.0..=100.0).contains(p))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn full_arg_set_parses() {
        let argv = v(&[
            "--input",
            "C:/in.wav",
            "--out",
            "C:/out.lrc",
            "--ffmpeg",
            "C:/ffmpeg.exe",
            "--whisper-cli",
            "C:/whisper-cli.exe",
            "--whisper-model",
            "C:/ggml-small.bin",
            "--mdx-model",
            "C:/voc_ft.onnx",
            "--ort-dylib",
            "C:/onnxruntime.dll",
            "--gpu",
            "cpu",
            "--language",
            "en",
            "--threads",
            "2",
            "--dump-stem",
            "C:/stem.wav",
            "--align-model",
            "C:/w2v2.onnx",
            "--align-vocab",
            "C:/vocab.json",
        ]);
        let Ok(Mode::Run(args)) = parse_args(&argv) else {
            panic!("should parse");
        };
        assert_eq!(args.gpu, mdx::GpuMode::Cpu);
        assert_eq!(args.language, "en");
        assert_eq!(args.threads, 2);
        assert_eq!(args.dump_stem, Some(PathBuf::from("C:/stem.wav")));
        assert_eq!(args.align_model, Some(PathBuf::from("C:/w2v2.onnx")));
        assert_eq!(args.align_vocab, Some(PathBuf::from("C:/vocab.json")));
    }

    #[test]
    fn defaults_are_auto_gpu_auto_language_4_threads() {
        let argv = v(&[
            "--input",
            "i",
            "--out",
            "o",
            "--ffmpeg",
            "f",
            "--whisper-cli",
            "w",
            "--whisper-model",
            "m",
            "--mdx-model",
            "x",
            "--ort-dylib",
            "d",
        ]);
        let Ok(Mode::Run(args)) = parse_args(&argv) else {
            panic!("should parse");
        };
        assert_eq!(args.gpu, mdx::GpuMode::Auto);
        assert_eq!(args.language, "auto");
        assert_eq!(args.threads, 4);
        assert_eq!(args.dump_stem, None);
        assert_eq!(args.align_model, None);
        assert_eq!(args.align_vocab, None);
    }

    #[test]
    fn align_flags_must_come_as_a_pair() {
        let base = [
            "--input",
            "i",
            "--out",
            "o",
            "--ffmpeg",
            "f",
            "--whisper-cli",
            "w",
            "--whisper-model",
            "m",
            "--mdx-model",
            "x",
            "--ort-dylib",
            "d",
        ];
        let mut model_only = v(&base);
        model_only.extend(v(&["--align-model", "a.onnx"]));
        assert!(parse_args(&model_only).is_err());
        let mut vocab_only = v(&base);
        vocab_only.extend(v(&["--align-vocab", "v.json"]));
        assert!(parse_args(&vocab_only).is_err());
    }

    #[test]
    fn missing_required_and_unknown_args_are_rejected() {
        assert!(parse_args(&v(&["--input", "i"])).is_err());
        let mut full = v(&[
            "--input",
            "i",
            "--out",
            "o",
            "--ffmpeg",
            "f",
            "--whisper-cli",
            "w",
            "--whisper-model",
            "m",
            "--mdx-model",
            "x",
            "--ort-dylib",
            "d",
        ]);
        full.extend(v(&["--surprise", "yes"]));
        assert!(parse_args(&full).is_err());
        assert!(parse_args(&v(&["stray"])).is_err());
        assert!(parse_args(&v(&["--input"])).is_err(), "flag without value");
    }

    #[test]
    fn align_line_mode_parses_and_validates() {
        let base = [
            "--align-line",
            "--input",
            "C:/slice.wav",
            "--ffmpeg",
            "C:/ffmpeg.exe",
            "--mdx-model",
            "C:/voc_ft.onnx",
            "--ort-dylib",
            "C:/onnxruntime.dll",
            "--align-model",
            "C:/w2v2.onnx",
            "--align-vocab",
            "C:/vocab.json",
            "--gpu",
            "cpu",
            "--line-t",
            "0.5",
            "--line-end",
            "3.25",
            "--line-text",
            "out of my mind",
        ];
        let Ok(Mode::AlignLine(args)) = parse_args(&v(&base)) else {
            panic!("align-line should parse");
        };
        assert_eq!(args.line_t, 0.5);
        assert_eq!(args.line_end, 3.25);
        assert_eq!(args.text, "out of my mind");
        assert_eq!(args.gpu, mdx::GpuMode::Cpu);
        assert_eq!(args.threads, 4);

        // Window must be forward and the text non-empty.
        let mut bad = v(&base);
        let end_at = bad.iter().position(|a| a == "3.25").unwrap();
        bad[end_at] = "0.5".into();
        assert!(parse_args(&bad).is_err(), "line-end == line-t");
        let mut empty = v(&base);
        let text_at = empty.iter().position(|a| a == "out of my mind").unwrap();
        empty[text_at] = "  ".into();
        assert!(parse_args(&empty).is_err(), "blank text");
        // Whisper flags are unknown here — a mixed argv is a bug upstream.
        let mut mixed = v(&base);
        mixed.extend(v(&["--whisper-cli", "w"]));
        assert!(parse_args(&mixed).is_err());
    }

    #[test]
    fn probe_mode_needs_only_the_dylib() {
        let Ok(Mode::ProbeGpu { ort_dylib }) =
            parse_args(&v(&["--probe-gpu", "--ort-dylib", "C:/onnxruntime.dll"]))
        else {
            panic!("probe should parse");
        };
        assert_eq!(ort_dylib, PathBuf::from("C:/onnxruntime.dll"));
        assert!(parse_args(&v(&["--probe-gpu"])).is_err());
    }

    #[test]
    fn whisper_progress_lines_parse() {
        assert_eq!(
            parse_whisper_progress("whisper_print_progress_callback: progress =   5%"),
            Some(5.0)
        );
        assert_eq!(
            parse_whisper_progress("whisper_print_progress_callback: progress = 100%"),
            Some(100.0)
        );
        assert_eq!(parse_whisper_progress("no progress here"), None);
        assert_eq!(parse_whisper_progress("progress = banana%"), None);
    }
}
