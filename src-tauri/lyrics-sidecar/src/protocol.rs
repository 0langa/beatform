//! The sidecar's wire protocol: line-delimited JSON on stdout.
//!
//! One JSON object per line, nothing else ever printed to stdout (all
//! diagnostics go to stderr) — the app supervises the process by parsing
//! stdout line-by-line, exactly like it tails ffmpeg's stderr log. Cancel
//! travels the other way: a single line "cancel" on stdin (or a kill).

use serde::Serialize;
use std::io::Write;

/// Pipeline stages, in order. Serialized as lowercase strings.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    Decode,
    Isolate,
    Vad,
    Transcribe,
    /// Phase-3 word-level forced alignment (only when the alignment model
    /// was passed; absent from the stream otherwise).
    Align,
    Assemble,
}

#[derive(Serialize, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event<'a> {
    /// Periodic progress inside a stage. `pct` 0..100 (None = indeterminate);
    /// `eta_sec` = projected remaining time for THIS stage from measured
    /// throughput so far (None until enough is measured); `rtf` = measured
    /// realtime factor so far (wall / audio), the number the UI's estimate
    /// table is built from.
    #[serde(rename_all = "camelCase")]
    Progress {
        stage: Stage,
        #[serde(skip_serializing_if = "Option::is_none")]
        pct: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        eta_sec: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        rtf: Option<f64>,
    },
    /// A stage finished, with its measured wall time and (where meaningful)
    /// realtime factor and a human-readable detail ("DirectML", "CPU", …).
    #[serde(rename_all = "camelCase")]
    StageDone {
        stage: Stage,
        wall_sec: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        rtf: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<&'a str>,
    },
    /// Terminal success: the LRC exists at `lrc_path`.
    #[serde(rename_all = "camelCase")]
    Result {
        lrc_path: &'a str,
        lines: usize,
        /// Words that received timing across all lines (0 = alignment not
        /// run or fully degraded — the LRC is then plain line-level).
        words: usize,
        /// Lines that carry word timing.
        aligned_lines: usize,
        /// Lines flagged for review: low mean word confidence, or alignment
        /// attempted and failed (the UI's "N low-confidence lines" notice).
        low_conf_lines: usize,
        /// Seconds of vocal-active audio the VAD found (0 = likely instrumental).
        vocal_sec: f64,
        /// Execution provider the isolation stage actually used.
        ep: &'a str,
        /// Language whisper reported.
        language: &'a str,
    },
    /// Terminal failure. Exit code is non-zero too.
    Error { message: &'a str },
    /// Terminal cancel acknowledgement (stdin "cancel"). Exit code 3.
    Cancelled,
    /// `--probe-gpu` mode output: can a DirectML session be created here?
    Probe { dml: bool },
}

/// Print one protocol event as a single stdout line and flush — the app
/// reads lines as they arrive; an unflushed event is an invisible one.
pub fn emit(event: &Event) {
    let line = serde_json::to_string(event).expect("protocol events always serialize");
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_serialize_to_the_documented_wire_shape() {
        let p = Event::Progress {
            stage: Stage::Isolate,
            pct: Some(12.5),
            eta_sec: Some(48.0),
            rtf: Some(0.52),
        };
        assert_eq!(
            serde_json::to_string(&p).unwrap(),
            r#"{"type":"progress","stage":"isolate","pct":12.5,"etaSec":48.0,"rtf":0.52}"#
        );

        let r = Event::Result {
            lrc_path: "C:/t/out.lrc",
            lines: 42,
            words: 310,
            aligned_lines: 40,
            low_conf_lines: 3,
            vocal_sec: 180.25,
            ep: "dml",
            language: "en",
        };
        assert_eq!(
            serde_json::to_string(&r).unwrap(),
            r#"{"type":"result","lrcPath":"C:/t/out.lrc","lines":42,"words":310,"alignedLines":40,"lowConfLines":3,"vocalSec":180.25,"ep":"dml","language":"en"}"#
        );
        assert_eq!(serde_json::to_string(&Stage::Align).unwrap(), r#""align""#);

        let e = Event::Error { message: "boom" };
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"type":"error","message":"boom"}"#
        );
        assert_eq!(
            serde_json::to_string(&Event::Cancelled).unwrap(),
            r#"{"type":"cancelled"}"#
        );
    }

    #[test]
    fn indeterminate_progress_omits_null_fields() {
        let p = Event::Progress {
            stage: Stage::Decode,
            pct: None,
            eta_sec: None,
            rtf: None,
        };
        assert_eq!(
            serde_json::to_string(&p).unwrap(),
            r#"{"type":"progress","stage":"decode"}"#
        );
    }
}
