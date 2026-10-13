//! Whisper segments + VAD regions -> clean lyric lines.
//!
//! The separation-as-VAD recipe (spike adjustment 3): whisper transcribed the
//! FULL MIX, so its musical line segmentation is already good — the stem's
//! VAD is used to (a) drop hallucinated lines inside instrumental stretches,
//! (b) split run-on segments that bridge a long vocal gap, and (c) keep
//! timestamps monotonic. Deterministic post-processing, no model.
//!
//! Two ways to cut a segment into lines. Without the alignment model,
//! `assemble` cuts at whisper's TOKEN timestamps. With it, the whole segment
//! is aligned first (`stage_segments` -> align -> `split_aligned`) and the
//! cuts fall on the ACOUSTIC word timing. That matters because whisper.cpp
//! token times are not measured — without DTW they are spread across the
//! segment — so a segment opening on an instrumental intro put its first
//! words seconds before they were sung, and the per-line alignment window
//! built from those times never contained the voice at all (measured
//! 2026-10-10 with scripts/lyrics-timing-probe.mjs: the first three words of
//! a song with a 4 s intro landed 3.7 s early).

use crate::vad::{self, Region};
use crate::whisper::{is_meta_token, is_non_speech_text, WhisperSegment, WhisperToken};

#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    /// Start, seconds.
    pub t: f64,
    /// End, seconds (from the last token's span; alignment windows and the
    /// enhanced-LRC trailing tag both need a real end, not just the next
    /// line's start).
    pub end: f64,
    pub text: String,
    /// Whisper's probability for each whitespace-split word of `text`, in
    /// order (`word_probabilities`); the aligner's second opinion
    /// (align.rs `merged_conf`). Empty = no such vote: a user-typed line,
    /// or a line built without token data.
    pub word_p: Vec<f64>,
    /// Per-word timing from the phase-3 forced-alignment stage. Empty =
    /// line-level only (alignment not run, or degraded for this line).
    pub words: Vec<Word>,
}

/// One aligned word (track-time seconds). `conf` is the aligner's own
/// reading — the geometric-mean peak-relative probability of the frames it
/// chose (0 = interpolated, not aligned — e.g. digits, which have no
/// acoustic tokens); `p` is whisper's probability for the word (0 = no vote).
/// What the app sees is `align::merged_conf(conf, p)`.
#[derive(Clone, Debug, PartialEq)]
pub struct Word {
    pub t: f64,
    pub end: f64,
    pub conf: f64,
    pub p: f64,
    pub text: String,
}

/// Whisper's per-word probabilities for the text made of `pieces` (token
/// text, token probability): each whitespace-split word takes the mean over
/// the characters it is made of, so a word spanning several BPE tokens
/// averages them and a token spanning two words serves both. The count
/// equals `normalize_text(..).split_whitespace().count()` for the same
/// pieces, which is what lets the probabilities ride along with the words.
pub fn word_probabilities(pieces: &[(&str, f64)]) -> Vec<f64> {
    let mut out = Vec::new();
    let mut sum = 0.0;
    let mut n = 0usize;
    for (text, p) in pieces {
        for c in text.chars() {
            if c.is_whitespace() {
                if n > 0 {
                    out.push(sum / n as f64);
                    sum = 0.0;
                    n = 0;
                }
            } else {
                sum += p;
                n += 1;
            }
        }
    }
    if n > 0 {
        out.push(sum / n as f64);
    }
    out
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
/// With acoustic word timing, a silence this long between two sung words
/// ends a line — when the VAD agrees the gap is silent. A held note is not a
/// gap to the VAD, even where CTC's spiky character spans leave one between
/// the word boundaries.
const PHRASE_GAP_SEC: f64 = 0.6;
/// A worded line becomes active this long before its first word, so the
/// line has faded in by the time the first word lights — never earlier than
/// the previous line's end.
const LINE_LEAD_SEC: f64 = 0.2;
/// A worded line longer than this is cut at its widest inner pause of at
/// least `SOFT_GAP_SEC` near the middle — two sung lines that one whisper
/// segment and a VAD bridging the short breath between them ran together
/// (measured on the Star-Spangled Banner solo: "...dawn's early light What so
/// proudly..." came out as one 106-character line). Without such a pause the
/// line stays whole up to the hard `MAX_LINE_CHARS` cap.
const SOFT_LINE_CHARS: usize = 64;
const SOFT_GAP_SEC: f64 = 0.35;

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

fn vad_is_trusted(input: &AssembleInput) -> bool {
    let vad_active = vad::total_active(input.vad);
    vad_active >= VAD_TRUST_MIN_SEC
        || vad_active >= VAD_TRUST_MIN_FRACTION * input.track_duration_sec.max(1.0)
        || input.stem_peak_db < vad::SILENT_STEM_PEAK_DB
}

/// The segments that survive the non-speech and (a) hallucination filters,
/// with their spans in seconds.
fn kept_segments<'a>(
    input: &AssembleInput<'a>,
    vad_trusted: bool,
) -> Vec<(&'a WhisperSegment, f64, f64)> {
    let mut kept = Vec::new();
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
        kept.push((seg, s, e));
    }
    kept
}

/// Line-level assembly: segments cut at whisper's token timestamps. The
/// result when no alignment model is available, and the per-segment fallback
/// when a segment cannot be aligned as a whole.
pub fn assemble(input: AssembleInput) -> Vec<Line> {
    let vad_trusted = vad_is_trusted(&input);
    let mut lines: Vec<Line> = Vec::new();
    for (seg, s, e) in kept_segments(&input, vad_trusted) {
        // (b) run-on split at long internal vocal gaps, recursively.
        split_segment(seg, s, e, input.vad, vad_trusted, &mut lines);
    }
    finish(lines)
}

/// One kept whisper segment, unsplit, ready to be aligned as a whole.
pub struct StagedSegment {
    /// The whole segment as one line: its span is the alignment window.
    pub line: Line,
    /// The same segment cut at token timestamps (`assemble`'s answer) — used
    /// when the segment cannot be aligned as a whole.
    pub fallback: Vec<Line>,
}

pub struct Staged {
    pub segments: Vec<StagedSegment>,
    pub vad_trusted: bool,
}

/// Input to segment-level alignment: the kept segments, NOT cut into lines
/// yet — the cuts wait for acoustic word timing (`split_aligned`).
pub fn stage_segments(input: AssembleInput) -> Staged {
    let vad_trusted = vad_is_trusted(&input);
    let segments = kept_segments(&input, vad_trusted)
        .into_iter()
        .filter_map(|(seg, s, e)| {
            let mut fallback = Vec::new();
            split_segment(seg, s, e, input.vad, vad_trusted, &mut fallback);
            let pieces: Vec<(&str, f64)> = seg
                .tokens
                .iter()
                .filter(|t| !is_meta_token(&t.text))
                .map(|t| (t.text.as_str(), t.p))
                .collect();
            let toks: String = pieces.iter().map(|(t, _)| *t).collect();
            let from_tokens = !toks.trim().is_empty();
            let text = normalize_text(if from_tokens { &toks } else { &seg.text });
            if text.is_empty() || is_non_speech_text(&text) {
                return None;
            }
            let word_p = if from_tokens {
                word_probabilities(&pieces)
            } else {
                Vec::new()
            };
            Some(StagedSegment {
                line: Line {
                    t: s,
                    end: e,
                    word_p: matched_word_p(word_p, &text),
                    text,
                    words: Vec::new(),
                },
                fallback,
            })
        })
        .collect();
    Staged {
        segments,
        vad_trusted,
    }
}

/// Cut one aligned segment into lines at the singer's real pauses: an
/// inter-word gap of `SPLIT_GAP_SEC` always, or of `PHRASE_GAP_SEC` when a
/// trusted VAD agrees the gap is mostly silent. Each line spans its own
/// words; `finish` adds the lead-in and the length cap.
pub fn split_aligned(words: Vec<Word>, regions: &[Region], vad_trusted: bool) -> Vec<Line> {
    let mut pieces: Vec<Vec<Word>> = Vec::new();
    let mut cur: Vec<Word> = Vec::new();
    for w in words {
        if let Some(prev) = cur.last() {
            let gap = w.t - prev.end;
            let silent = vad_trusted
                && gap >= PHRASE_GAP_SEC
                && vad::overlap(regions, prev.end, w.t) < 0.5 * gap;
            if gap >= SPLIT_GAP_SEC || silent {
                pieces.push(std::mem::take(&mut cur));
            }
        }
        cur.push(w);
    }
    if !cur.is_empty() {
        pieces.push(cur);
    }
    pieces.into_iter().map(worded_line).collect()
}

/// How far back a lone word that CLOSES a phrase (ends in punctuation) may
/// reach to rejoin the line it ends.
const ORPHAN_REACH_SEC: f64 = 2.5;

/// A single word alone on a line is almost never how a song is sung — it is
/// a held note or a breath cut out of its line, often at a whisper segment
/// boundary. Measured on "Over There" (1917): "Send the word, send the word
/// over" | "there." | "That the Yanks are coming". The lone word rejoins:
/// - the line it CLOSES, when it ends in punctuation and sits within
///   `ORPHAN_REACH_SEC` of it (whisper's period says which side it belongs to);
/// - otherwise the nearer neighbour, when that gap is under `SPLIT_GAP_SEC`.
///
/// A word set apart by long gaps on both sides stays alone — that one really
/// is on its own. Only word-timed lines take part.
fn rejoin_orphans(mut lines: Vec<Line>) -> Vec<Line> {
    let gap = |a: &Line, b: &Line| b.words[0].t - a.words[a.words.len() - 1].end;
    let mut i = 0;
    while i < lines.len() {
        if lines[i].words.len() != 1 {
            i += 1;
            continue;
        }
        let prev = (i > 0 && !lines[i - 1].words.is_empty()).then(|| gap(&lines[i - 1], &lines[i]));
        let next = (i + 1 < lines.len() && !lines[i + 1].words.is_empty())
            .then(|| gap(&lines[i], &lines[i + 1]));
        let closes = lines[i].words[0]
            .text
            .ends_with(['.', '!', '?', ',', ';', ':']);
        let into_prev = match (prev, next) {
            (Some(p), _) if closes && p < ORPHAN_REACH_SEC => Some(true),
            (Some(p), Some(n)) if p.min(n) < SPLIT_GAP_SEC => Some(p <= n),
            (Some(p), None) if p < SPLIT_GAP_SEC => Some(true),
            (None, Some(n)) if n < SPLIT_GAP_SEC => Some(false),
            _ => None,
        };
        match into_prev {
            Some(true) => {
                let orphan = lines.remove(i);
                let mut words = std::mem::take(&mut lines[i - 1].words);
                words.extend(orphan.words);
                lines[i - 1] = worded_line(words);
            }
            Some(false) => {
                let following = lines.remove(i + 1);
                let mut words = std::mem::take(&mut lines[i].words);
                words.extend(following.words);
                lines[i] = worded_line(words);
                i += 1;
            }
            None => i += 1,
        }
    }
    lines
}

fn worded_line(words: Vec<Word>) -> Line {
    let t = words[0].t;
    let end = words
        .iter()
        .map(|w| w.end)
        .fold(t + MONOTONIC_STEP, f64::max);
    Line {
        t,
        end,
        text: words
            .iter()
            .map(|w| w.text.as_str())
            .collect::<Vec<_>>()
            .join(" "),
        word_p: words.iter().map(|w| w.p).collect(),
        words,
    }
}

/// `word_p` only when it has one entry per word of `text` — a count that
/// disagrees (a token shape this code did not foresee) is no vote at all
/// rather than a vote on the wrong words.
fn matched_word_p(word_p: Vec<f64>, text: &str) -> Vec<f64> {
    if word_p.len() == text.split_whitespace().count() {
        word_p
    } else {
        Vec::new()
    }
}

/// (c) for any line list: lone words rejoined, defensive length cap, a short
/// lead-in for worded lines (never into the previous line), then strictly
/// monotonic timestamps.
pub fn finish(lines: Vec<Line>) -> Vec<Line> {
    let mut capped: Vec<Line> = Vec::new();
    for line in rejoin_orphans(lines) {
        cap_length(line, &mut capped);
    }
    for i in 0..capped.len() {
        if let Some(first) = capped[i].words.first().map(|w| w.t) {
            let floor = if i > 0 { capped[i - 1].end } else { 0.0 };
            capped[i].t = (first - LINE_LEAD_SEC).max(floor).min(first).max(0.0);
        }
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
    let toks: Vec<TokenSpanText> = token_spans(&seg.tokens)
        .into_iter()
        .filter(|(s, _, _, _)| *s >= start - 1e-9 && *s < end)
        .collect();

    if let Some((gap_start, gap_end)) = gap {
        if !toks.is_empty() {
            let gap_mid = 0.5 * (gap_start + gap_end);
            // First token starting at/after the gap midpoint opens the second
            // half; everything before closes the first half.
            if let Some(split_idx) = toks.iter().position(|(s, _, _, _)| *s >= gap_mid) {
                if split_idx > 0 && split_idx < toks.len() {
                    let (first, second) = toks.split_at(split_idx);
                    push_token_line(first, out);
                    // Recurse on the second half by synthesizing its span.
                    // Token membership follows the same (DTW-aware) starts
                    // the split was decided on.
                    let second_start = second[0].0;
                    let spans = token_spans(&seg.tokens);
                    let sub = WhisperSegment {
                        offsets: crate::whisper::MsSpan {
                            from: (second_start * 1000.0) as i64,
                            to: (end * 1000.0) as i64,
                        },
                        text: second.iter().map(|(_, _, t, _)| *t).collect::<String>(),
                        tokens: seg
                            .tokens
                            .iter()
                            .filter(|t| !is_meta_token(&t.text))
                            .zip(spans.iter())
                            .filter(|(_, (s, _, _, _))| *s >= second_start - 1e-9)
                            .map(|(t, _)| crate::whisper::WhisperToken {
                                text: t.text.clone(),
                                offsets: t.offsets,
                                p: t.p,
                                t_dtw: t.t_dtw,
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
                word_p: Vec::new(),
                words: Vec::new(),
            });
        }
    } else {
        push_token_line(&toks, out);
    }
}

/// (start, end, text, whisper probability) of one real token.
pub type TokenSpanText<'a> = (f64, f64, &'a str, f64);

/// (start, end, text, p) for every real (non-meta) token, in order.
///
/// With DTW timestamps (whisper-cli `-dtw`, available since the app passes
/// the model's alignment-heads preset) a token starts where whisper's
/// cross-attention actually heard it and ends where the next token starts —
/// measured times, so a segment that opens on an instrumental intro no longer
/// puts its first words seconds early. Without them (older runs, a model with
/// no preset) whisper's evenly-spread `offsets` stand in, exactly as before.
/// DTW times can jitter a frame backwards; starts are kept monotonic.
///
/// Units: `offsets` are milliseconds, but `t_dtw` is whisper's own 10 ms
/// tick (the `-ojf` writer scales t0/t1 and leaves t_dtw raw — verified
/// 2026-10-13 against the spoken intro of the SSB corpus clip).
pub fn token_spans(tokens: &[WhisperToken]) -> Vec<TokenSpanText<'_>> {
    let real: Vec<&WhisperToken> = tokens.iter().filter(|t| !is_meta_token(&t.text)).collect();
    let dtw = !real.is_empty() && real.iter().all(|t| t.t_dtw >= 0);
    let mut out = Vec::with_capacity(real.len());
    let mut prev_start = f64::NEG_INFINITY;
    for (i, t) in real.iter().enumerate() {
        let (mut s, mut e) = if dtw {
            let next = real
                .get(i + 1)
                .map(|n| n.t_dtw as f64 / 100.0)
                .unwrap_or(t.offsets.to as f64 / 1000.0);
            (t.t_dtw as f64 / 100.0, next)
        } else {
            (t.offsets.from as f64 / 1000.0, t.offsets.to as f64 / 1000.0)
        };
        if s < prev_start {
            s = prev_start;
        }
        if e < s {
            e = s;
        }
        prev_start = s;
        out.push((s, e, t.text.as_str(), t.p));
    }
    out
}

fn push_token_line(toks: &[TokenSpanText], out: &mut Vec<Line>) {
    let pieces: Vec<(&str, f64)> = toks.iter().map(|(_, _, t, p)| (*t, *p)).collect();
    let text: String = pieces.iter().map(|(t, _)| *t).collect();
    let text = normalize_text(&text);
    if text.is_empty() || is_non_speech_text(&text) {
        return;
    }
    let t = toks[0].0;
    let end = toks
        .iter()
        .map(|(_, e, _, _)| *e)
        .fold(f64::NEG_INFINITY, f64::max)
        .max(t + MONOTONIC_STEP);
    out.push(Line {
        t,
        end,
        word_p: matched_word_p(word_probabilities(&pieces), &text),
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
    let chars = line.text.chars().count();
    if chars > SOFT_LINE_CHARS && chars <= MAX_LINE_CHARS && line.words.len() >= 2 {
        if let Some(k) = middle_boundary(&line, SOFT_GAP_SEC) {
            split_worded_at(line, k, out);
            return;
        }
    }
    if chars <= MAX_LINE_CHARS {
        out.push(line);
        return;
    }
    if line.words.len() >= 2 {
        cap_worded(line, out);
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
            // The word votes follow their words into the halves.
            let first_words = first.split_whitespace().count();
            let (p_first, p_second) = if line.word_p.len() >= first_words {
                let (a, b) = line.word_p.split_at(first_words);
                (a.to_vec(), b.to_vec())
            } else {
                (Vec::new(), Vec::new())
            };
            cap_length(
                Line {
                    t: line.t,
                    end: cut,
                    text: first.trim().to_string(),
                    word_p: p_first,
                    words: Vec::new(),
                },
                out,
            );
            cap_length(
                Line {
                    t: cut,
                    end: line.end.max(cut + MONOTONIC_STEP),
                    text: second.trim().to_string(),
                    word_p: p_second,
                    words: Vec::new(),
                },
                out,
            );
        }
        _ => out.push(line), // one unbreakable run — keep it whole
    }
}

/// The widest inter-word pause of at least `min_gap` among the boundaries
/// in the middle 40% of the line's text (by characters), if any.
fn middle_boundary(line: &Line, min_gap: f64) -> Option<usize> {
    let total = line.text.chars().count() as f64;
    let mut chars_before = 0usize;
    let mut best: Option<(usize, f64)> = None;
    for k in 1..line.words.len() {
        chars_before += line.words[k - 1].text.chars().count() + 1;
        let frac = chars_before as f64 / total;
        let gap = line.words[k].t - line.words[k - 1].end;
        if (frac - 0.5).abs() <= 0.2 && gap >= min_gap && best.is_none_or(|(_, g)| gap > g) {
            best = Some((k, gap));
        }
    }
    best.map(|(k, _)| k)
}

fn split_worded_at(line: Line, k: usize, out: &mut Vec<Line>) {
    let mut words = line.words;
    let tail = words.split_off(k);
    cap_length(worded_line(words), out);
    cap_length(worded_line(tail), out);
}

/// Word-timed lines split at a word boundary, so both halves keep exact
/// timing: the widest pause among boundaries in the middle 40% of the text
/// (by characters), else the boundary nearest the middle.
fn cap_worded(line: Line, out: &mut Vec<Line>) {
    let total = line.text.chars().count() as f64;
    let mut chars_before = 0usize;
    let mut best: Option<(usize, f64, f64)> = None; // (index, gap, distance)
    for k in 1..line.words.len() {
        chars_before += line.words[k - 1].text.chars().count() + 1;
        let frac = chars_before as f64 / total;
        let gap = line.words[k].t - line.words[k - 1].end;
        let dist = (frac - 0.5).abs();
        let better = match best {
            None => true,
            Some((_, best_gap, best_dist)) => match (dist <= 0.2, best_dist <= 0.2) {
                (true, false) => true,
                (false, true) => false,
                (true, true) => gap > best_gap,
                (false, false) => dist < best_dist,
            },
        };
        if better {
            best = Some((k, gap, dist));
        }
    }
    let Some((k, _, _)) = best else {
        out.push(line);
        return;
    };
    let mut words = line.words;
    let tail = words.split_off(k);
    cap_length(worded_line(words), out);
    cap_length(worded_line(tail), out);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::whisper::{MsSpan, WhisperToken};

    fn word(t: f64, end: f64, text: &str) -> Word {
        Word {
            t,
            end,
            conf: 0.9,
            p: 0.9,
            text: text.to_string(),
        }
    }

    /// Whisper's BPE pieces: a leading space opens a word, a piece without
    /// one continues it, and a word's probability averages its pieces.
    #[test]
    fn word_probabilities_follow_whispers_pieces_into_words() {
        let pieces = [
            (" I'm", 0.9),
            (" defib", 0.6),
            ("rill", 0.4),
            ("ators", 0.8),
            (",", 1.0),
            (" yeah", 0.5),
        ];
        let p = word_probabilities(&pieces);
        assert_eq!(p.len(), 3);
        assert!((p[0] - 0.9).abs() < 1e-9);
        // "defibrillators," — 5 + 4 + 5 chars of the three pieces plus the comma.
        let expect = (5.0 * 0.6 + 4.0 * 0.4 + 5.0 * 0.8 + 1.0) / 15.0;
        assert!((p[1] - expect).abs() < 1e-9, "{p:?}");
        assert!((p[2] - 0.5).abs() < 1e-9);
        // A piece carrying two words serves both; stray whitespace adds none.
        assert_eq!(word_probabilities(&[(" a b ", 0.7), ("  ", 0.1)]).len(), 2);
        assert!(word_probabilities(&[]).is_empty());
        // The count matches the text split the lines are built from.
        let text = normalize_text(&pieces.iter().map(|(t, _)| *t).collect::<String>());
        assert_eq!(text.split_whitespace().count(), p.len());
    }

    /// The staged segment carries one vote per word, and a token-cut line
    /// too; a user-shaped line (no tokens) carries none.
    #[test]
    fn staged_lines_carry_whispers_word_votes() {
        let s = seg(
            0,
            4_000,
            " hello there",
            &[(0, 2_000, " hello"), (2_000, 4_000, " there")],
        );
        let vad = vec![region(0.0, 4.0)];
        let staged = stage_segments(AssembleInput {
            segments: &[s],
            vad: &vad,
            stem_peak_db: -10.0,
            track_duration_sec: 5.0,
        });
        assert_eq!(staged.segments[0].line.word_p, vec![0.9, 0.9]);
        assert_eq!(staged.segments[0].fallback[0].word_p, vec![0.9, 0.9]);
        let plain = WhisperSegment {
            offsets: MsSpan { from: 0, to: 4_000 },
            text: " no tokens here".into(),
            tokens: Vec::new(),
        };
        let staged = stage_segments(AssembleInput {
            segments: &[plain],
            vad: &vad,
            stem_peak_db: -10.0,
            track_duration_sec: 5.0,
        });
        assert!(staged.segments[0].line.word_p.is_empty());
        assert!(staged.segments[0].fallback[0].word_p.is_empty());
    }

    /// The device probe's failure, reduced: a sung line after a 4 s intro and
    /// a second line after a 1.6 s breath, all inside ONE whisper segment that
    /// starts at 0. With acoustic word times the cut lands in the breath and
    /// each line starts at its first word (minus the lead), not in the intro.
    #[test]
    fn aligned_words_cut_at_the_breath_and_lines_start_with_their_words() {
        let words = vec![
            word(4.0, 4.3, "Turn"),
            word(4.5, 4.7, "the"),
            word(4.8, 5.3, "lights"),
            word(6.9, 7.2, "We"),
            word(7.3, 7.6, "can"),
            word(7.7, 8.2, "dance"),
        ];
        let vad = vec![region(4.0, 5.4), region(6.9, 8.3)];
        let lines = finish(split_aligned(words, &vad, true));
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert_eq!(lines[0].text, "Turn the lights");
        assert_eq!(lines[1].text, "We can dance");
        assert!((lines[0].t - 3.8).abs() < 1e-9, "{lines:?}");
        assert!((lines[1].t - 6.7).abs() < 1e-9, "{lines:?}");
        assert!((lines[0].end - 5.3).abs() < 1e-9);
    }

    /// A held note: CTC's spiky spans leave 0.8 s between two words, but the
    /// VAD says the singer never stopped — no cut. The same gap over silence
    /// IS a cut.
    #[test]
    fn a_held_note_is_not_a_phrase_gap_but_silence_is() {
        // Two-word halves, so the lone-word rejoin cannot be what decides.
        let words = |second: f64| {
            vec![
                word(1.0, 1.2, "Hold"),
                word(1.25, 1.4, "on"),
                word(second, second + 0.2, "tight"),
                word(second + 0.25, second + 0.4, "now"),
            ]
        };
        let sung_through = vec![region(0.9, 2.7)];
        assert_eq!(split_aligned(words(2.2), &sung_through, true).len(), 1);
        let breath = vec![region(0.9, 1.45), region(2.15, 2.7)];
        assert_eq!(split_aligned(words(2.2), &breath, true).len(), 2);
        // An untrusted VAD can only cut at the long gap.
        assert_eq!(split_aligned(words(2.2), &breath, false).len(), 1);
        assert_eq!(split_aligned(words(3.0), &[], false).len(), 2);
    }

    /// "Over There": a breath before the last word must not leave it alone
    /// on a line — but a word set apart by a long gap stays on its own.
    #[test]
    fn a_lone_word_after_a_short_pause_rejoins_its_line() {
        let words = vec![
            word(10.0, 10.3, "send"),
            word(10.4, 10.7, "the"),
            word(10.8, 11.2, "word"),
            word(11.3, 11.7, "over"),
            word(12.5, 13.0, "there."),
        ];
        let breath = vec![region(9.9, 11.75), region(12.45, 13.1)];
        let lines = finish(split_aligned(words, &breath, true));
        assert_eq!(lines.len(), 1, "{lines:?}");
        assert_eq!(lines[0].text, "send the word over there.");

        let far = vec![
            word(10.0, 10.3, "hey"),
            word(10.4, 10.8, "you"),
            word(13.0, 13.4, "there"),
        ];
        let lines = finish(split_aligned(far, &[], false));
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert_eq!(lines[1].text, "there");
    }

    /// The device case exactly: the lone word sits at a whisper segment
    /// boundary, 1.54 s after the line it closes and touching the next one.
    /// Its period says it ends the line before.
    #[test]
    fn a_lone_closing_word_rejoins_the_line_it_ends_across_segments() {
        let lines = finish(vec![
            worded_line(vec![word(76.46, 76.9, "word"), word(77.06, 77.34, "over")]),
            worded_line(vec![word(78.88, 78.98, "there.")]),
            worded_line(vec![word(78.92, 79.1, "That"), word(79.18, 79.5, "the")]),
        ]);
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert_eq!(lines[0].text, "word over there.");
        assert_eq!(lines[1].text, "That the");
    }

    /// Two sung lines one whisper segment ran together: over the soft limit
    /// they part at the breath near the middle; a long line with no such
    /// breath stays whole.
    #[test]
    fn a_long_line_parts_at_a_breath_near_its_middle() {
        let text = "O say can you see by the dawn's early light What so proudly we hailed at the twilight's last gleaming";
        let mut words = Vec::new();
        let mut t = 0.0;
        for w in text.split(' ') {
            t += if w == "What" { 0.6 } else { 0.1 };
            words.push(word(t, t + 0.3, w));
            t += 0.3;
        }
        let lines = finish(vec![worded_line(words)]);
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert_eq!(lines[0].text, "O say can you see by the dawn's early light");
        assert!(lines[1].text.starts_with("What so proudly"));

        let even: Vec<Word> = text
            .split(' ')
            .enumerate()
            .map(|(i, w)| word(i as f64 * 0.4, i as f64 * 0.4 + 0.3, w))
            .collect();
        assert_eq!(finish(vec![worded_line(even)]).len(), 1);
    }

    /// The lead-in never reaches back into the previous line.
    #[test]
    fn the_lead_in_stops_at_the_previous_line() {
        let lines = finish(vec![
            worded_line(vec![word(1.0, 1.5, "one"), word(1.6, 2.0, "two")]),
            worded_line(vec![word(2.1, 2.3, "three"), word(2.35, 2.5, "four")]),
        ]);
        assert!((lines[0].t - 0.8).abs() < 1e-9);
        assert!((lines[1].t - 2.0).abs() < 1e-9, "{lines:?}");
        assert!(lines[1].t <= lines[1].words[0].t);
    }

    /// Over-long worded lines split at a word boundary, keeping every word's
    /// timing, and prefer the widest pause near the middle.
    #[test]
    fn over_long_worded_lines_split_at_the_widest_middle_pause() {
        let mut words = Vec::new();
        let mut t = 0.0;
        for i in 0..30 {
            // A 0.5 s pause before word 16; 0.05 s everywhere else.
            t += if i == 16 { 0.5 } else { 0.05 };
            words.push(word(t, t + 0.2, "abcd"));
            t += 0.2;
        }
        let lines = finish(vec![worded_line(words)]);
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert_eq!(lines[0].words.len(), 16);
        assert_eq!(lines[1].words.len(), 14);
        for l in &lines {
            assert!(l.text.chars().count() <= MAX_LINE_CHARS);
            assert_eq!(l.words.len(), l.text.split_whitespace().count());
        }
    }

    #[test]
    fn staged_segments_stay_whole_and_carry_the_token_split_as_fallback() {
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
        let staged = stage_segments(AssembleInput {
            segments: &segments,
            vad: &vad,
            stem_peak_db: -10.0,
            track_duration_sec: 30.0,
        });
        assert!(staged.vad_trusted);
        assert_eq!(staged.segments.len(), 1);
        let s = &staged.segments[0];
        assert_eq!(s.line.text, "first phrase second phrase");
        assert!((s.line.t - 0.0).abs() < 1e-9 && (s.line.end - 25.0).abs() < 1e-9);
        assert_eq!(s.fallback.len(), 2);
    }

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
                    t_dtw: -1,
                })
                .collect(),
        }
    }

    /// With `-dtw` every real token carries a measured time: the token-cut
    /// lines start where the word was heard, not where whisper's even
    /// spread put it (the 2026-10-10 probe's 3.7 s-early first words).
    #[test]
    fn dtw_token_times_replace_the_even_spread_when_present() {
        let mut s = seg(
            0,
            8_000,
            " hello world again",
            &[
                (0, 2_700, " hello"),
                (2_700, 5_400, " world"),
                (5_400, 8_000, " again"),
            ],
        );
        // Without DTW: whisper's spread, untouched.
        assert_eq!(
            token_spans(&s.tokens),
            vec![
                (0.0, 2.7, " hello", 0.9),
                (2.7, 5.4, " world", 0.9),
                (5.4, 8.0, " again", 0.9)
            ]
        );
        // With DTW (10 ms ticks): starts are the measured times, ends the
        // next start, the last end stays whisper's; a backwards jitter is
        // clamped.
        s.tokens[0].t_dtw = 402;
        s.tokens[1].t_dtw = 450;
        s.tokens[2].t_dtw = 448;
        assert_eq!(
            token_spans(&s.tokens),
            vec![
                (4.02, 4.5, " hello", 0.9),
                (4.5, 4.5, " world", 0.9),
                (4.5, 8.0, " again", 0.9)
            ]
        );
        // A partial DTW (one token unmeasured) falls back whole.
        s.tokens[1].t_dtw = -1;
        assert_eq!(token_spans(&s.tokens)[0], (0.0, 2.7, " hello", 0.9));
        // Meta tokens never take part.
        s.tokens.insert(
            0,
            WhisperToken {
                text: "[_BEG_]".into(),
                offsets: MsSpan { from: 0, to: 0 },
                p: 1.0,
                t_dtw: -1,
            },
        );
        assert_eq!(token_spans(&s.tokens).len(), 3);
    }

    /// The assembled line opens on the first DTW time, so an instrumental
    /// intro inside the whisper segment no longer lights the line early.
    #[test]
    fn a_segment_with_an_intro_starts_its_line_at_the_measured_first_word() {
        let mut s = seg(
            0,
            9_000,
            " turn the lights",
            &[
                (0, 3_000, " turn"),
                (3_000, 6_000, " the"),
                (6_000, 9_000, " lights"),
            ],
        );
        s.tokens[0].t_dtw = 400;
        s.tokens[1].t_dtw = 440;
        s.tokens[2].t_dtw = 480;
        let vad = vec![region(3.9, 5.5)];
        let lines = assemble(AssembleInput {
            segments: &[s],
            vad: &vad,
            stem_peak_db: -10.0,
            track_duration_sec: 10.0,
        });
        assert_eq!(lines.len(), 1, "{lines:?}");
        assert!((lines[0].t - 4.0).abs() < 1e-9, "{lines:?}");
        assert_eq!(lines[0].text, "turn the lights");
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
