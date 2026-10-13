//! Beatform lyrics sidecar (FEAT-004 phases 2+3): fully-local automatic
//! lyrics.
//!
//! decode (ffmpeg) -> MDX-Net vocal isolation (ONNX Runtime, DirectML-first)
//! -> separation-as-VAD -> whisper.cpp on the VOCAL STEM (since 2026-10-13;
//! the full mix before) with VAD post-split -> (phase 3, when the alignment
//! model is provided) wav2vec2 CTC forced alignment of each line against the
//! vocal stem -> enhanced word-tag LRC.
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
    /// whisper.cpp alignment-heads preset for DTW token timestamps (`-dtw`,
    /// e.g. "small", "large.v3.turbo"). The app derives it from the model it
    /// picked; absent = whisper's evenly-spread token offsets, as before.
    whisper_dtw: Option<String>,
    /// Dev hook: replay this whisper-cli `-ojf` JSON instead of running
    /// whisper-cli — `scripts/lyrics-eval.mjs` scores whisper configurations
    /// through the real VAD, assembly and alignment stages this way. The
    /// language pre-pass is skipped too; the app never passes this.
    whisper_json: Option<PathBuf>,
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
        whisper_dtw: map.remove("whisper-dtw"),
        whisper_json: map.remove("whisper-json").map(PathBuf::from),
    };
    if args.align_model.is_some() != args.align_vocab.is_some() {
        return Err("--align-model and --align-vocab must be passed together".into());
    }
    // The preset reaches whisper-cli's argv verbatim; whisper.cpp's own names
    // are letters, digits and dots ("large.v3.turbo").
    if let Some(d) = &args.whisper_dtw {
        if d.is_empty() || !d.chars().all(|c| c.is_ascii_alphanumeric() || c == '.') {
            return Err(format!("bad --whisper-dtw: {d}"));
        }
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
    remove_temps();
    hard_exit(EXIT_ERROR);
}

fn cancelled_exit() -> ! {
    emit(&Event::Cancelled);
    remove_temps();
    hard_exit(EXIT_CANCELLED);
}

/// Temp files this process created (the stem WAV whisper reads, whisper's
/// JSON, the language probe's pair). `hard_exit` skips every destructor, so
/// the exits above remove them by hand — a failed run must not leave a
/// 60 MB stem in the OS temp dir.
static TEMP_FILES: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

fn track_temp(path: &std::path::Path) {
    if let Ok(mut files) = TEMP_FILES.lock() {
        files.push(path.to_path_buf());
    }
}

fn remove_temps() {
    if let Ok(mut files) = TEMP_FILES.lock() {
        for path in files.drain(..) {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// A unique path in the OS temp dir for this process: `<tag>-<pid>-<ms>`.
fn temp_prefix(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "beatform-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default()
    ))
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
    // Same reason as run(): release the isolation session and the decoded
    // slice before the aligner loads its own model.
    drop(session);
    drop(slice);
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
        word_p: Vec::new(), // the user's own words: no whisper vote
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
    // The isolation session (an ONNX Runtime session, DirectML or CPU) and
    // the decoded mix are done the moment the stem exists. Held to the end of
    // run(), they kept ~2 GB committed while whisper-cli started next — and
    // on a machine with that little headroom whisper died allocating its
    // model (GGML_ASSERT(buffer)), so generation failed AFTER the long
    // isolation stage had already succeeded.
    drop(session);
    drop(mix);
    let isolate_wall = t0.elapsed().as_secs_f64();
    emit(&Event::StageDone {
        stage: Stage::Isolate,
        wall_sec: isolate_wall,
        rtf: Some(isolate_wall / duration),
        detail: Some(if ep == "dml" { "DirectML" } else { "CPU" }),
    });
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
    emit(&Event::StageDone {
        stage: Stage::Vad,
        wall_sec: t0.elapsed().as_secs_f64(),
        rtf: None,
        detail: None,
    });

    // ---- language (from the vocal stem, before the stem is dropped) ----
    let language = if args.whisper_json.is_some() {
        "auto".to_string() // replayed transcript: its language is in the JSON
    } else if args.language == "auto" {
        match detect_language(&args, &stem, &regions, &cancel) {
            Some(code) => {
                eprintln!("[lyrics-sidecar] language {code} (whisper on the vocal stem)");
                code
            }
            None if cancel.cancelled() => cancelled_exit(),
            None => "auto".to_string(),
        }
    } else {
        args.language.clone()
    };

    // ---- transcribe (the vocal stem) -----------------------------------
    // The stem goes to whisper as a WAV in the OS temp dir (the channels are
    // moved, not copied); `--dump-stem` keeps a copy of the same bytes.
    let stem_wav = audio::wav_s16(&audio::Stereo {
        left: stem.0,
        right: stem.1,
    });
    if let Some(dump) = &args.dump_stem {
        if let Err(e) = std::fs::write(dump, &stem_wav) {
            fail(&format!("could not write --dump-stem file: {e}"));
        }
    }
    let stem_path = PathBuf::from(format!(
        "{}.wav",
        temp_prefix("lyrics-stem").to_string_lossy()
    ));
    track_temp(&stem_path);
    if let Err(e) = std::fs::write(&stem_path, &stem_wav) {
        fail(&format!("could not write the stem for whisper: {e}"));
    }
    drop(stem_wav);
    let t0 = Instant::now();
    let Transcript {
        json: parsed,
        backend,
    } = match transcribe(&args, &stem_path, &language, duration, &cancel) {
        Ok(p) => p,
        Err(TranscribeError::Cancelled) => cancelled_exit(),
        Err(TranscribeError::Failed(e)) => fail(&e),
    };
    let _ = std::fs::remove_file(&stem_path);
    let transcribe_wall = t0.elapsed().as_secs_f64();
    let backend_label = backend.label();
    emit(&Event::StageDone {
        stage: Stage::Transcribe,
        wall_sec: transcribe_wall,
        rtf: Some(transcribe_wall / duration),
        detail: Some(&backend_label),
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
    let align_summary = align_stage(
        &args,
        &stem16,
        &mut assembled,
        lines::AssembleInput {
            segments: &parsed.transcription,
            vad: &regions,
            stem_peak_db: verdict.stem_peak_db,
            track_duration_sec: duration,
        },
        &cancel,
        duration,
    );
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
                conf: align::line_conf(&l.words),
                words: l
                    .words
                    .iter()
                    .map(|w| align::merged_conf(w.conf, w.p))
                    .collect(),
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
        whisper: if backend.cuda { "cuda" } else { "cpu" },
        whisper_device: backend.device.as_deref(),
        line_details: line_details.as_deref(),
    });
    remove_temps();
}

/// Run the forced-alignment stage when requested. Alignment is an
/// ENHANCEMENT: any failure here (model unloadable, vocab wrong) degrades
/// the job to line-level with a diagnostic — the transcript still ships.
/// Only cancellation exits.
fn align_stage(
    args: &Args,
    stem16: &[f32],
    assembled: &mut Vec<lines::Line>,
    input: lines::AssembleInput,
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
    let regions = input.vad;
    let outcome = align::align_segments(
        &mut aligner,
        stem16,
        lines::stage_segments(input),
        regions,
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
        // Segment staging applies the same filters as the line-level pass,
        // so an empty result here means every segment's text normalized
        // away — keep the line-level lines rather than ship nothing.
        align::Outcome::Done { lines, .. } if lines.is_empty() => {
            emit(&Event::StageDone {
                stage: Stage::Align,
                wall_sec: t0.elapsed().as_secs_f64(),
                rtf: None,
                detail: Some("nothing to align — line timing only"),
            });
            None
        }
        align::Outcome::Done { lines, summary } => {
            *assembled = lines;
            let wall = t0.elapsed().as_secs_f64();
            let detail = format!("{}/{} lines", summary.aligned_lines, assembled.len());
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

/// Which runtime whisper-cli actually used, read off its own log lines
/// (`ggml_cuda_init: found 1 CUDA devices:` / `  Device 0: <name>, ...`).
/// The CUDA build on a PC without an NVIDIA driver loads no CUDA backend and
/// runs on the CPU — this reports that honestly instead of assuming.
#[derive(Debug, Default, PartialEq)]
struct WhisperBackend {
    cuda: bool,
    device: Option<String>,
}

impl WhisperBackend {
    /// Fold one whisper-cli stderr line into the detection.
    fn observe(&mut self, line: &str) {
        if line.contains("CUDA device") && line.contains("found") {
            self.cuda = true;
        }
        if let Some(rest) = line.trim_start().strip_prefix("Device 0:") {
            let name = rest.split(',').next().unwrap_or("").trim();
            if !name.is_empty() {
                self.device = Some(name.to_string());
            }
        }
    }

    /// The transcribe stage's detail text: "CUDA · <device>" or "CPU".
    fn label(&self) -> String {
        if self.cuda {
            format!("CUDA · {}", self.device.as_deref().unwrap_or("NVIDIA GPU"))
        } else {
            "CPU".to_string()
        }
    }
}

struct Transcript {
    json: whisper::WhisperJson,
    backend: WhisperBackend,
}

/// Seconds of vocal audio the language pre-pass listens to — whisper's
/// language id reads exactly one 30 s window, so feed it voice and nothing
/// else.
const LANGUAGE_SAMPLE_SEC: f64 = 30.0;

/// The voiced regions of the stem, in order, concatenated up to
/// `LANGUAGE_SAMPLE_SEC` — the audio the language pre-pass hears. Pure.
fn language_sample(stem: &mdx::StemChannels, regions: &[vad::Region]) -> audio::Stereo {
    let rate = audio::SAMPLE_RATE as f64;
    let budget = (LANGUAGE_SAMPLE_SEC * rate) as usize;
    let mut left = Vec::with_capacity(budget);
    let mut right = Vec::with_capacity(budget);
    for r in regions {
        if left.len() >= budget {
            break;
        }
        let s0 = ((r.start.max(0.0) * rate) as usize).min(stem.0.len());
        let s1 = ((r.end.max(0.0) * rate) as usize).min(stem.0.len());
        if s1 <= s0 {
            continue;
        }
        let take = (s1 - s0).min(budget - left.len());
        left.extend_from_slice(&stem.0[s0..s0 + take]);
        right.extend_from_slice(&stem.1[s0..s0 + take]);
    }
    audio::Stereo { left, right }
}

/// A whisper language code is 2-3 lowercase letters (its g_lang table);
/// anything else — or the empty "auto" echo — is not worth forcing.
fn valid_language_code(code: &str) -> bool {
    (2..=3).contains(&code.len()) && code.chars().all(|c| c.is_ascii_lowercase())
}

/// Language identification on the VOCAL STEM (2026-10-13). whisper's own
/// auto-detect reads the first 30 s of whatever it is given, and on the full
/// mix that is often an instrumental intro: the medium model "heard" Khmer on
/// an English rock song and spent 103 s decoding garbage (RTF 0.32 against
/// 0.05 on the same card with the language pinned). The isolated stem's
/// voiced regions, through whisper-cli's `-dl` mode, name the language in
/// under a second on a GPU before the real pass starts. None = nothing
/// usable (no voice found, the probe failed, or the job was cancelled) and
/// the pass runs with "auto" exactly as before.
fn detect_language(
    args: &Args,
    stem: &mdx::StemChannels,
    regions: &[vad::Region],
    cancel: &Arc<Canceller>,
) -> Option<String> {
    let sample = language_sample(stem, regions);
    if sample.duration_sec() < 1.0 {
        return None;
    }
    let prefix = temp_prefix("lyrics-lang");
    let wav_path = PathBuf::from(format!("{}.wav", prefix.to_string_lossy()));
    let json_path = PathBuf::from(format!("{}.json", prefix.to_string_lossy()));
    track_temp(&wav_path);
    track_temp(&json_path);
    let cleanup = || {
        let _ = std::fs::remove_file(&wav_path);
        let _ = std::fs::remove_file(&json_path);
    };
    if std::fs::write(&wav_path, audio::wav_s16(&sample)).is_err() {
        cleanup();
        return None;
    }
    let mut cmd = Command::new(&args.whisper_cli);
    cmd.arg("-m")
        .arg(&args.whisper_model)
        .arg("-f")
        .arg(&wav_path)
        .arg("-dl")
        .arg("-ojf")
        .arg("-of")
        .arg(&prefix)
        .arg("-t")
        .arg(args.threads.to_string())
        .arg("-l")
        .arg("auto")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[lyrics-sidecar] language probe spawn failed: {e}");
            cleanup();
            return None;
        }
    };
    *cancel.child.lock().expect("cancel mutex") = Some(child);
    let status = wait_registered_child(cancel);
    let code = match status {
        Ok(s) if s.success() => std::fs::read_to_string(&json_path)
            .ok()
            .and_then(|j| whisper::parse(&j).ok())
            .map(|w| w.result.language)
            .filter(|c| valid_language_code(c)),
        Ok(s) => {
            eprintln!("[lyrics-sidecar] language probe failed ({s}) — auto");
            None
        }
        Err(_) => None,
    };
    cleanup();
    code
}

/// Spawn whisper-cli on `input` (the isolated vocal stem), stream progress
/// from its stderr, parse the `-ojf` JSON it writes. `language` is the
/// forced code (or "auto").
///
/// Measured 2026-10-13 on seven real songs against reference lyrics
/// (scripts/lyrics-eval.mjs, large-v3-turbo on the GPU):
/// - `-mc 0` (no text context carried between 30 s windows) is the single
///   biggest win. With the context on, a window that hallucinated — an
///   instrumental intro, a chopped vocal drop — fed its text to every
///   window after it: one metal track came back as 110 copies of a line
///   nobody sang (WER 296 %), an EDM track as a 20-line loop. Without it,
///   word error over the set fell from 78 % to 25 % and the loops vanished.
/// - The vocal stem instead of the mix cut the wrong lines a further
///   quarter (42 to 31 of ~240) and the word error to 22 %; the stem also
///   spares whisper the instrumental stretches it used to invent over. The
///   earlier worry about run-on segments on stem input no longer applies:
///   lines are cut on the aligner's word timing, not whisper's segments.
/// - Suppressing non-speech tokens, disabling the temperature fallback and
///   whisper's own silero VAD were all measured too: the first two changed
///   nothing of note, the VAD threw away most of the singing.
fn transcribe(
    args: &Args,
    input: &std::path::Path,
    language: &str,
    duration: f64,
    cancel: &Arc<Canceller>,
) -> Result<Transcript, TranscribeError> {
    if let Some(path) = &args.whisper_json {
        let json = std::fs::read_to_string(path)
            .map_err(|e| TranscribeError::Failed(format!("whisper JSON unreadable: {e}")))?;
        let json = whisper::parse(&json).map_err(TranscribeError::Failed)?;
        return Ok(Transcript {
            json,
            backend: WhisperBackend::default(),
        });
    }
    // Unique output prefix in the OS temp dir; whisper appends ".json".
    let prefix = temp_prefix("lyrics");
    let json_path = PathBuf::from(format!("{}.json", prefix.to_string_lossy()));
    track_temp(&json_path);

    let mut cmd = Command::new(&args.whisper_cli);
    cmd.arg("-m")
        .arg(&args.whisper_model)
        .arg("-f")
        .arg(input)
        .arg("-ojf")
        .arg("-of")
        .arg(&prefix)
        .arg("-t")
        .arg(args.threads.to_string())
        .arg("-bs")
        .arg("5")
        .arg("-mc")
        .arg("0")
        .arg("-l")
        .arg(language)
        .arg("-pp");
    // `-np` used to silence whisper's log entirely; the log is now READ: the
    // backend lines (CUDA found / device name) are the only honest source of
    // which runtime transcribed, and the bounded tail still serves failures.
    if let Some(dtw) = &args.whisper_dtw {
        // whisper.cpp 1.9 enables flash attention by default and silently
        // DISABLES dtw under it ("dtw_token_timestamps is not supported with
        // flash_attn") — measured 2026-10-13: every token came back -1 until
        // `-nfa` rode along. The measured timestamps are worth the slower
        // attention path on the token-cut lines.
        cmd.arg("-nfa").arg("-dtw").arg(dtw);
    }
    cmd.stdin(Stdio::null())
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
        let mut backend = WhisperBackend::default();
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
                        backend.observe(line);
                        tail.push(line.to_string());
                        if tail.len() > 8 {
                            tail.remove(0);
                        }
                    }
                }
                Err(_) => break,
            }
        }
        (tail.join(" | "), backend)
    });

    // Register for cancel-kill, then wait.
    *cancel.child.lock().expect("cancel mutex") = Some(child);
    let status = match wait_registered_child(cancel) {
        Ok(status) => status,
        Err(e) => {
            let _ = std::fs::remove_file(&json_path);
            return Err(e);
        }
    };
    let (stderr_tail, backend) = reader.join().unwrap_or_default();
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
    let json = whisper::parse(&json).map_err(TranscribeError::Failed)?;
    Ok(Transcript { json, backend })
}

/// Wait for the child currently registered with the canceller, killing it the
/// moment the cancel flag is set.
///
/// Polling the FLAG, not just the slot, is the point. The watcher kills
/// whatever is registered when "cancel" arrives — but a cancel that lands
/// between `spawn` and registration finds the slot EMPTY and kills nothing,
/// and the whisper stage is the longest in the pipeline: minutes of a
/// medium-model transcription would run to completion with the flag already
/// set, and the user's cancel would only be noticed once it finished. (The
/// app's 10 s kill fallback then terminated the sidecar and, before the job
/// object, orphaned whisper-cli outright.) `decode` closes the same gap with
/// a one-shot check after registering; this is the continuous form, so it
/// also covers a `kill()` that failed the first time.
fn wait_registered_child(cancel: &Canceller) -> Result<std::process::ExitStatus, TranscribeError> {
    loop {
        {
            let mut guard = cancel.child.lock().expect("cancel mutex");
            let Some(running) = guard.as_mut() else {
                return Err(TranscribeError::Cancelled);
            };
            if cancel.cancelled() {
                let _ = running.kill();
            }
            match running.try_wait() {
                Ok(Some(status)) => {
                    guard.take();
                    return Ok(status);
                }
                Ok(None) => {}
                Err(e) => {
                    guard.take();
                    return Err(TranscribeError::Failed(format!(
                        "whisper-cli wait failed: {e}"
                    )));
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

/// "whisper_print_progress_callback: progress =   5%" -> 5.0. Only the
/// progress line is parsed to a number; the rest of whisper's log reaches
/// `WhisperBackend::observe` and the failure tail.
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
            "--whisper-dtw",
            "large.v3.turbo",
            "--whisper-json",
            "C:/replay.json",
        ]);
        let Ok(Mode::Run(args)) = parse_args(&argv) else {
            panic!("should parse");
        };
        assert_eq!(args.whisper_dtw.as_deref(), Some("large.v3.turbo"));
        assert_eq!(args.whisper_json, Some(PathBuf::from("C:/replay.json")));
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
        assert_eq!(args.whisper_json, None);
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

    /// A child that will not exit on its own — a stand-in for a whisper-cli
    /// grinding through a medium-model transcription.
    fn spawn_wedged() -> std::process::Child {
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("ping");
            c.args(["-n", "30", "127.0.0.1"]);
            c
        } else {
            let mut c = Command::new("sleep");
            c.arg("30");
            c
        };
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn test child")
    }

    #[test]
    fn a_cancel_that_lands_before_registration_still_stops_whisper() {
        // The race: "cancel" arrives in the window between whisper's spawn
        // and its registration with the canceller. The watcher found the slot
        // empty and killed nothing, and the wait loop never looked at the
        // flag again — so the whole transcribe stage ran to completion with
        // the cancel already requested. Reproduce it by registering a child
        // with the flag ALREADY set, which is exactly that state.
        let cancel = Arc::new(Canceller {
            flag: AtomicBool::new(true),
            child: Mutex::new(None),
        });
        *cancel.child.lock().expect("cancel mutex") = Some(spawn_wedged());

        let waiting = Arc::clone(&cancel);
        let waiter = std::thread::spawn(move || wait_registered_child(&waiting).is_ok());

        let deadline = Instant::now() + std::time::Duration::from_secs(12);
        while !waiter.is_finished() && Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert!(
            waiter.is_finished(),
            "the wait ignored a cancel that was already set and sat on a live child \
             for 12 s — a real run would burn the whole whisper stage first"
        );
        assert!(
            waiter.join().unwrap(),
            "the killed child must still be reaped into an exit status"
        );
        assert!(
            cancel.child.lock().expect("cancel mutex").is_none(),
            "the reaped child must be cleared from the slot"
        );
    }

    #[test]
    fn a_child_that_exits_on_its_own_is_reaped_without_a_cancel() {
        // The happy path must be untouched: no flag, normal exit, real status.
        let cancel = Canceller {
            flag: AtomicBool::new(false),
            child: Mutex::new(None),
        };
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.args(["/c", "exit", "0"]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", "exit 0"]);
            c
        };
        let child = cmd
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn test child");
        *cancel.child.lock().expect("cancel mutex") = Some(child);
        let Ok(status) = wait_registered_child(&cancel) else {
            panic!("a clean exit must not read as an error");
        };
        assert!(status.success());
    }

    #[test]
    fn the_backend_is_read_off_whispers_own_log_lines() {
        let mut b = WhisperBackend::default();
        assert_eq!(b.label(), "CPU");
        for line in [
            "whisper_init_with_params_no_state: use gpu    = 1",
            "ggml_cuda_init: found 1 CUDA devices:",
            "  Device 0: NVIDIA GeForce RTX 5060 Ti, compute capability 12.0, VMM: yes",
        ] {
            b.observe(line);
        }
        assert!(b.cuda);
        assert_eq!(b.device.as_deref(), Some("NVIDIA GeForce RTX 5060 Ti"));
        assert_eq!(b.label(), "CUDA · NVIDIA GeForce RTX 5060 Ti");
        // The CPU build (and the CUDA build without a driver) prints neither.
        let mut cpu = WhisperBackend::default();
        cpu.observe("whisper_backend_init_gpu: no GPU found");
        assert_eq!(cpu, WhisperBackend::default());
    }

    #[test]
    fn the_language_sample_is_the_first_thirty_voiced_seconds() {
        let rate = audio::SAMPLE_RATE as usize;
        let stem: mdx::StemChannels = (vec![0.5f32; rate * 60], vec![0.25f32; rate * 60]);
        let regions = [
            vad::Region {
                start: 2.0,
                end: 12.0,
            },
            vad::Region {
                start: 20.0,
                end: 50.0,
            },
        ];
        let sample = language_sample(&stem, &regions);
        // 10 s from the first region + 20 s of the second = the 30 s budget.
        assert!((sample.duration_sec() - LANGUAGE_SAMPLE_SEC).abs() < 1e-6);
        assert_eq!(sample.left[0], 0.5);
        assert_eq!(sample.right[0], 0.25);
        // No voice at all: nothing to listen to.
        assert_eq!(language_sample(&stem, &[]).duration_sec(), 0.0);
        // Regions past the stem clamp instead of panicking.
        let short = language_sample(
            &stem,
            &[vad::Region {
                start: 58.0,
                end: 99.0,
            }],
        );
        assert!((short.duration_sec() - 2.0).abs() < 1e-6);
    }

    #[test]
    fn whisper_language_codes_are_two_or_three_lowercase_letters() {
        for ok in ["en", "de", "yue", "km"] {
            assert!(valid_language_code(ok), "{ok}");
        }
        for bad in ["", "auto", "EN", "e", "english", "e1"] {
            assert!(!valid_language_code(bad), "{bad}");
        }
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
