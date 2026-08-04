//! Whisper segments + VAD regions -> clean lyric lines.
//!
//! The separation-as-VAD recipe (spike adjustment 3): whisper transcribed the
//! FULL MIX, so its musical line segmentation is already good — the stem's
//! VAD is used to (a) drop hallucinated lines inside instrumental stretches,
//! (b) split run-on segments that bridge a long vocal gap, and (c) keep
//! timestamps monotonic. Deterministic post-processing, no model.

use crate::vad::{self, Region};
use crate::whisper::{is_meta_token, is_non_speech_text, WhisperSegment};

#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    /// Start, seconds.
    pub t: f64,
    /// End, seconds (from the last token's span; alignment windows and the
    /// enhanced-LRC trailing tag both need a real end, not just the next
    /// line's start).
    pub end: f64,
    pub text: String,
    /// Per-word timing from the phase-3 forced-alignment stage. Empty =
    /// line-level only (alignment not run, or degraded for this line).
    pub words: Vec<Word>,
}

/// One aligned word (track-time seconds). `conf` is the geometric-mean
/// probability of the frames the aligner chose (0 = interpolated, not
/// aligned — e.g. digits, which have no acoustic tokens).
#[derive(Clone, Debug, PartialEq)]
pub struct Word {
    pub t: f64,
    pub end: f64,
    pub conf: f64,
    pub text: String,
}

/// A segment overlapping its VAD-active cover by less than this fraction is
/// treated as hallucination (whisper inventing lyrics over instruments).
const MIN_VAD_OVERLAP: f64 = 0.15;
/// Split a segment at an internal vocal gap at least this long.
const SPLIT_GAP_SEC: f64 = 1.5;
/// Hard cap: split any line longer than this many characters at the best
/// token boundary (defensive — full-mix segments are usually musical lines).
const MAX_LINE_CHARS: usize = 120;
/// Successive lines may not share a timestamp; nudge by this much.
const MONOTONIC_STEP: f64 = 0.01;

/// When the VAD found less than this fraction of the track active AND less
/// than this many absolute seconds — while the stem still HAS energy — the
/// detector likely failed (threshold vs. an unusual mix); the VAD filter then
/// drops nothing, so a broken stem can never silence a working transcript.
/// A near-SILENT stem is the opposite case: the empty answer is confident
/// (the spike's instrumental control collapsed to about -68 dB) and whisper's
/// inventions over instruments get dropped.
const VAD_TRUST_MIN_FRACTION: f64 = 0.02;
const VAD_TRUST_MIN_SEC: f64 = 4.0;

pub struct AssembleInput<'a> {
    pub segments: &'a [WhisperSegment],
    pub vad: &'a [Region],
    /// Loudest 20 ms frame of the vocal stem, dBFS (vad::Verdict).
    pub stem_peak_db: f64,
    pub track_duration_sec: f64,
}

pub fn assemble(input: AssembleInput) -> Vec<Line> {
    let vad_active = vad::total_active(input.vad);
    let vad_trusted = vad_active >= VAD_TRUST_MIN_SEC
        || vad_active >= VAD_TRUST_MIN_FRACTION * input.track_duration_sec.max(1.0)
        || input.stem_peak_db < vad::SILENT_STEM_PEAK_DB;

    let mut lines: Vec<Line> = Vec::new();
    for seg in input.segments {
        let text = seg.text.trim();
        if text.is_empty() || is_non_speech_text(text) {
            continue;
        }
        let (s, e) = (
            seg.offsets.from as f64 / 1000.0,
            seg.offsets.to as f64 / 1000.0,
        );
        if e <= s {
            continue;
        }
        // (a) hallucination filter — only when the VAD is trustworthy.
        if vad_trusted {
            let covered = vad::overlap(input.vad, s, e);
            if covered / (e - s) < MIN_VAD_OVERLAP {
                continue;
            }
        }
        // (b) run-on split at long internal vocal gaps, recursively.
        split_segment(seg, s, e, input.vad, vad_trusted, &mut lines);
    }

    // (c) defensive length cap + monotonic timestamps.
    let mut capped: Vec<Line> = Vec::new();
    for line in lines {
        cap_length(line, &mut capped);
    }
    for i in 1..capped.len() {
        if capped[i].t <= capped[i - 1].t {
            capped[i].t = capped[i - 1].t + MONOTONIC_STEP;
        }
        if capped[i].end <= capped[i].t {
            capped[i].end = capped[i].t + MONOTONIC_STEP;
        }
    }
    capped
}

/// Recursively split one segment at its largest internal vocal gap; emit
/// lines built from token spans (so each half keeps real timestamps).
fn split_segment(
    seg: &WhisperSegment,
    start: f64,
    end: f64,
    regions: &[Region],
    vad_trusted: bool,
    out: &mut Vec<Line>,
) {
    let gap = if vad_trusted {
        vad::largest_gap_within(regions, start, end).filter(|(gs, ge)| ge - gs >= SPLIT_GAP_SEC)
    } else {
        None
    };
    // Tokens with real text inside [start, end).
    let toks: Vec<(f64, f64, &str)> = seg
        .tokens
        .iter()
        .filter(|t| !is_meta_token(&t.text))
        .map(|t| {
            (
                t.offsets.from as f64 / 1000.0,
                t.offsets.to as f64 / 1000.0,
                t.text.as_str(),
            )
        })
        .filter(|(s, _, _)| *s >= start - 1e-9 && *s < end)
        .collect();

    if let Some((gap_start, gap_end)) = gap {
        if !toks.is_empty() {
            let gap_mid = 0.5 * (gap_start + gap_end);
            // First token starting at/after the gap midpoint opens the second
            // half; everything before closes the first half.
            if let Some(split_idx) = toks.iter().position(|(s, _, _)| *s >= gap_mid) {
                if split_idx > 0 && split_idx < toks.len() {
                    let (first, second) = toks.split_at(split_idx);
                    push_token_line(first, out);
                    // Recurse on the second half by synthesizing its span.
                    let second_start = second[0].0;
                    let sub = WhisperSegment {
                        offsets: crate::whisper::MsSpan {
                            from: (second_start * 1000.0) as i64,
                            to: (end * 1000.0) as i64,
                        },
                        text: second.iter().map(|(_, _, t)| *t).collect::<String>(),
                        tokens: seg
                            .tokens
                            .iter()
                            .filter(|t| {
                                !is_meta_token(&t.text)
                                    && t.offsets.from as f64 / 1000.0 >= second_start - 1e-9
                            })
                            .map(|t| crate::whisper::WhisperToken {
                                text: t.text.clone(),
                                offsets: t.offsets,
                                p: t.p,
                            })
                            .collect(),
                    };
                    split_segment(&sub, second_start, end, regions, vad_trusted, out);
                    return;
                }
            }
        }
    }
    // No split: one line. Prefer token data (first real token's start) over
    // the segment header; fall back to the segment when tokens are absent.
    if toks.is_empty() {
        let text = seg.text.trim();
        if !text.is_empty() {
            out.push(Line {
                t: start,
                end: end.max(start + MONOTONIC_STEP),
                text: text.to_string(),
                words: Vec::new(),
            });
        }
    } else {
        push_token_line(&toks, out);
    }
}

fn push_token_line(toks: &[(f64, f64, &str)], out: &mut Vec<Line>) {
    let text: String = toks.iter().map(|(_, _, t)| *t).collect();
    let text = normalize_text(&text);
    if text.is_empty() || is_non_speech_text(&text) {
        return;
    }
    let t = toks[0].0;
    let end = toks
        .iter()
        .map(|(_, e, _)| *e)
        .fold(f64::NEG_INFINITY, f64::max)
        .max(t + MONOTONIC_STEP);
    out.push(Line {
        t,
        end,
        text,
        words: Vec::new(),
    });
}

/// Trim + collapse internal whitespace runs. Case and punctuation stay —
/// they carry real information for a karaoke overlay.
pub fn normalize_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Split an over-long line at the whitespace nearest its middle. Timestamps
/// for the tail are interpolated by character position — a defensive path
/// (real whisper lines rarely hit the cap), so approximate timing is fine.
fn cap_length(line: Line, out: &mut Vec<Line>) {
    if line.text.chars().count() <= MAX_LINE_CHARS {
        out.push(line);
        return;
    }
    let chars: Vec<char> = line.text.chars().collect();
    let mid = chars.len() / 2;
    let split = (0..chars.len())
        .filter(|i| chars[*i] == ' ')
        .min_by_key(|i| i.abs_diff(mid));
    match split {
        Some(idx) if idx > 0 && idx < chars.len() - 1 => {
            let first: String = chars[..idx].iter().collect();
            let second: String = chars[idx + 1..].iter().collect();
            // No token data at this depth; interpolate the boundary by
            // character position so both halves keep plausible spans.
            let frac = idx as f64 / chars.len() as f64;
            let cut = (line.t + (line.end - line.t).max(0.0) * frac).max(line.t + MONOTONIC_STEP);
            cap_length(
                Line {
                    t: line.t,
                    end: cut,
                    text: first.trim().to_string(),
                    words: Vec::new(),
                },
                out,
            );
            cap_length(
                Line {
                    t: cut,
                    end: line.end.max(cut + MONOTONIC_STEP),
                    text: second.trim().to_string(),
                    words: Vec::new(),
                },
                out,
            );
        }
        _ => out.push(line), // one unbreakable run — keep it whole
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::whisper::{MsSpan, WhisperToken};

    fn seg(from_ms: i64, to_ms: i64, text: &str, tokens: &[(i64, i64, &str)]) -> WhisperSegment {
        WhisperSegment {
            offsets: MsSpan {
                from: from_ms,
                to: to_ms,
            },
            text: text.to_string(),
            tokens: tokens
                .iter()
                .map(|(f, t, s)| WhisperToken {
                    text: s.to_string(),
                    offsets: MsSpan { from: *f, to: *t },
                    p: 0.9,
                })
                .collect(),
        }
    }

    fn region(start: f64, end: f64) -> Region {
        Region { start, end }
    }

    #[test]
    fn hallucinated_lines_in_instrumental_stretches_are_dropped() {
        // Vocals 0-10 s; whisper "hears" a line at 20-24 s (pure instruments).
        let segments = vec![
            seg(1_000, 4_000, " real line", &[(1_000, 4_000, " real line")]),
            seg(
                20_000,
                24_000,
                " ghost line",
                &[(20_000, 24_000, " ghost line")],
            ),
        ];
        let vad = vec![region(0.0, 10.0)];
        let lines = assemble(AssembleInput {
            segments: &segments,
            vad: &vad,
            stem_peak_db: -10.0,
            track_duration_sec: 30.0,
        });
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "real line");
    }

    #[test]
    fn a_confidently_silent_stem_drops_whisper_inventions() {
        // The device run that motivated this: the synthetic-instrumental
        // control isolated to a near-silent stem, whisper still "heard" Khmer
        // glyphs — an empty VAD from a SILENT stem must count as trusted.
        let segments = vec![seg(0, 2_000, " ghost", &[(0, 2_000, " ghost")])];
        let vad: Vec<Region> = vec![];
        let lines = assemble(AssembleInput {
            segments: &segments,
            vad: &vad,
            stem_peak_db: -68.0,
            track_duration_sec: 90.0,
        });
        assert!(lines.is_empty(), "{lines:?}");
    }

    #[test]
    fn an_untrusted_vad_never_silences_the_transcript() {
        // VAD found almost nothing (broken stem / instrumental) — every
        // whisper line must survive.
        let segments = vec![seg(
            1_000,
            4_000,
            " still here",
            &[(1_000, 4_000, " still here")],
        )];
        let vad: Vec<Region> = vec![];
        let lines = assemble(AssembleInput {
            segments: &segments,
            vad: &vad,
            stem_peak_db: -10.0,
            track_duration_sec: 240.0,
        });
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn a_run_on_segment_splits_at_the_vocal_gap() {
        // One 25 s whisper segment bridging a 5 s instrumental break — the
        // spike observed exactly this on raw-stem input. Tokens cluster at
        // 0-9 s and 15-25 s; vocals active 0-10 and 15-25.
        let segments = vec![seg(
            0,
            25_000,
            " first phrase second phrase",
            &[
                (0, 4_000, " first"),
                (4_000, 9_000, " phrase"),
                (15_000, 20_000, " second"),
                (20_000, 25_000, " phrase"),
            ],
        )];
        let vad = vec![region(0.0, 10.0), region(15.0, 25.0)];
        let lines = assemble(AssembleInput {
            segments: &segments,
            vad: &vad,
            stem_peak_db: -10.0,
            track_duration_sec: 30.0,
        });
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert_eq!(lines[0].text, "first phrase");
        assert_eq!(lines[1].text, "second phrase");
        assert!((lines[0].t - 0.0).abs() < 1e-9);
        assert!((lines[1].t - 15.0).abs() < 1e-9);
        // Ends come from the last token of each half — the alignment stage
        // windows on [t, end], so these must be real spans, not zeros.
        assert!((lines[0].end - 9.0).abs() < 1e-9, "{lines:?}");
        assert!((lines[1].end - 25.0).abs() < 1e-9, "{lines:?}");
    }

    #[test]
    fn non_speech_filler_lines_are_dropped() {
        let segments = vec![
            seg(0, 2_000, " [Music]", &[(0, 2_000, " [Music]")]),
            seg(
                3_000,
                5_000,
                " la la land",
                &[(3_000, 5_000, " la la land")],
            ),
        ];
        let vad = vec![region(0.0, 6.0)];
        let lines = assemble(AssembleInput {
            segments: &segments,
            vad: &vad,
            stem_peak_db: -10.0,
            track_duration_sec: 6.0,
        });
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "la la land");
    }

    #[test]
    fn timestamps_come_out_strictly_monotonic() {
        let segments = vec![
            seg(1_000, 2_000, " one", &[(1_000, 2_000, " one")]),
            seg(1_000, 3_000, " two", &[(1_000, 3_000, " two")]),
            seg(1_000, 4_000, " three", &[(1_000, 4_000, " three")]),
        ];
        let vad = vec![region(0.0, 5.0)];
        let lines = assemble(AssembleInput {
            segments: &segments,
            vad: &vad,
            stem_peak_db: -10.0,
            track_duration_sec: 5.0,
        });
        assert_eq!(lines.len(), 3);
        assert!(lines[0].t < lines[1].t && lines[1].t < lines[2].t);
    }

    #[test]
    fn over_long_lines_split_near_the_middle() {
        let long = format!("{} {}", "word".repeat(20), "tail ".repeat(15).trim());
        let segments = vec![seg(0, 9_000, &long, &[(0, 9_000, &long)])];
        let vad = vec![region(0.0, 10.0)];
        let lines = assemble(AssembleInput {
            segments: &segments,
            vad: &vad,
            stem_peak_db: -10.0,
            track_duration_sec: 10.0,
        });
        assert!(lines.len() >= 2, "{lines:?}");
        for l in &lines {
            assert!(l.text.chars().count() <= MAX_LINE_CHARS, "{}", l.text);
        }
    }

    #[test]
    fn whitespace_normalizes_but_case_and_punctuation_stay() {
        assert_eq!(normalize_text("  O   say can't\tyou "), "O say can't you");
    }
}
