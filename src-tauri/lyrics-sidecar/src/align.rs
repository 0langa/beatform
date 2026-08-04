//! wav2vec2 CTC forced alignment (FEAT-004 phase 3): per-word timing for the
//! assembled lines, computed from the ISOLATED VOCAL STEM (research: the
//! stem's guaranteed value is VAD + alignment) at 16 kHz mono.
//!
//! Per line: slice the stem around the line's [start, end] (±PAD_SEC), run
//! wav2vec2-base-960h emissions on the CPU EP (the spike measured DirectML
//! 4x SLOWER for this model — REPORT adjustment 2), then a classic CTC
//! Viterbi trellis over the line's characters (blank-interleaved states,
//! log-space, backtracked) → per-character frames → per-word spans with a
//! confidence (geometric-mean probability of the chosen frames).
//!
//! Failure is always LOCAL: a line whose alignment fails keeps line-level
//! timing (empty `words`) and the job continues — never abort a whole
//! transcript over one hard line.

use crate::lines::{Line, Word};
use ort::session::Session;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

/// One CTC emission frame = 320 samples at 16 kHz.
pub const FRAME_SEC: f64 = 0.02;
/// Context added on both sides of a line's [start, end] before alignment —
/// whisper line boundaries drift on held notes (spike: up to ±1 s, typically
/// well under this pad + the neighbor lines' own windows).
pub const PAD_SEC: f64 = 0.4;
/// A line window longer than this degrades to line-level instead of running
/// a giant attention matrix (MAX_LINE_CHARS caps real lines far below this).
const MAX_WINDOW_SEC: f64 = 35.0;
const MIN_WINDOW_SEC: f64 = 0.25;
/// A line whose mean word confidence lands below this is flagged in the
/// result ("N low-confidence lines"); failed lines count too. Calibrated on
/// device against the eval corpus: a speech model scoring SUNG chars sits
/// far below speech-typical confidence even when the alignment is visibly
/// right — clean well-aligned anthem lines scored 0.18-0.41 (peak-based
/// geometric mean) while lines with transcript-vs-audio mismatches or
/// extreme melisma scored 0.03-0.09. The threshold separates those bands;
/// 0.5 (speech intuition) flagged 6/7 perfectly-usable lines.
pub const LOW_CONF: f64 = 0.15;

// ---------------------------------------------------------------------------
// Vocab

/// The wav2vec2-base-960h character vocabulary (vocab.json from the model
/// release): single-character tokens A-Z + apostrophe, `|` as the word
/// delimiter, `<pad>` as the CTC blank.
pub struct Vocab {
    chars: HashMap<char, u32>,
    pub blank: u32,
    pub delim: u32,
    /// Logit dimension the model must produce (max id + 1).
    pub size: usize,
}

impl Vocab {
    pub fn parse(json: &str) -> Result<Self, String> {
        let map: HashMap<String, u32> = serde_json::from_str::<HashMap<String, Value>>(json)
            .map_err(|e| format!("vocab.json parse failed: {e}"))?
            .into_iter()
            .map(|(k, v)| {
                v.as_u64()
                    .map(|id| (k, id as u32))
                    .ok_or("vocab.json ids must be integers".to_string())
            })
            .collect::<Result<_, _>>()?;
        let blank = *map.get("<pad>").ok_or("vocab.json has no <pad> token")?;
        let delim = *map.get("|").ok_or("vocab.json has no | delimiter")?;
        let size = map.values().max().map(|m| *m as usize + 1).unwrap_or(0);
        let chars = map
            .iter()
            .filter_map(|(k, v)| {
                let mut it = k.chars();
                match (it.next(), it.next()) {
                    (Some(c), None) if c != '|' => Some((c, *v)),
                    _ => None,
                }
            })
            .collect();
        Ok(Self {
            chars,
            blank,
            delim,
            size,
        })
    }

    pub fn load(path: &Path) -> Result<Self, String> {
        let json = std::fs::read_to_string(path)
            .map_err(|e| format!("could not read vocab {}: {e}", path.display()))?;
        Self::parse(&json)
    }

    /// Vocab id for one text character, after uppercasing and normalizing
    /// typographic apostrophes. None = the character has no acoustic token
    /// (digits, punctuation) and simply contributes nothing to the trellis.
    fn char_id(&self, c: char) -> Option<u32> {
        let c = match c {
            '\u{2019}' | '\u{02BC}' | '`' => '\'',
            other => other,
        };
        c.to_uppercase().find_map(|u| self.chars.get(&u).copied())
    }
}

// ---------------------------------------------------------------------------
// Tokenization

/// A line's CTC token sequence plus, per DISPLAY word (whitespace-split, in
/// order), the half-open range of token indices it owns. None = the word has
/// no mappable characters (e.g. "99") — its timing gets interpolated between
/// aligned neighbors.
pub struct LineTokens {
    pub tokens: Vec<u32>,
    pub word_ranges: Vec<Option<(usize, usize)>>,
}

pub fn tokenize(text: &str, vocab: &Vocab) -> LineTokens {
    let mut tokens: Vec<u32> = Vec::new();
    let mut word_ranges: Vec<Option<(usize, usize)>> = Vec::new();
    let mut any_before = false;
    for word in text.split_whitespace() {
        let ids: Vec<u32> = word.chars().filter_map(|c| vocab.char_id(c)).collect();
        if ids.is_empty() {
            word_ranges.push(None);
            continue;
        }
        if any_before {
            tokens.push(vocab.delim);
        }
        let start = tokens.len();
        tokens.extend(ids);
        word_ranges.push(Some((start, tokens.len())));
        any_before = true;
    }
    LineTokens {
        tokens,
        word_ranges,
    }
}

// ---------------------------------------------------------------------------
// CTC Viterbi forced alignment (pure — testable without a model)

/// One aligned token: frame span plus two confidence readings. `peak_logp`
/// (the best single frame of the char) is what the word confidence uses —
/// on SUNG vocals a held note forces the char onto many frames where the
/// model prefers blank, so a frame-mean punishes correct alignments of long
/// notes; the peak still separates "the model saw this char here" from "this
/// text is not in the audio". The frame-mean stays available for diagnostics.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TokenSpan {
    pub start: usize,
    /// Exclusive.
    pub end: usize,
    pub mean_logp: f64,
    pub peak_logp: f64,
}

/// Forced alignment of `tokens` against per-frame log-probabilities.
/// Standard CTC trellis: states = blanks interleaved with tokens
/// (2N+1), transitions stay/advance/skip-blank (skip only between DIFFERENT
/// tokens), log-space scores, backpointer backtrack. Errors when the audio
/// window has fewer frames than the token sequence needs.
pub fn viterbi_token_spans(
    logp: &[Vec<f32>],
    tokens: &[u32],
    blank: u32,
) -> Result<Vec<TokenSpan>, String> {
    let t_len = logp.len();
    let n = tokens.len();
    if n == 0 {
        return Err("empty token sequence".into());
    }
    // Minimum feasible path: every token needs one frame, plus a mandatory
    // blank between equal neighbors.
    let min_frames = n + tokens.windows(2).filter(|w| w[0] == w[1]).count();
    if t_len < min_frames {
        return Err(format!(
            "window too short: {t_len} frames for {n} tokens (need {min_frames})"
        ));
    }
    let s_len = 2 * n + 1;
    let emit = |s: usize, t: usize| -> f64 {
        let id = if s.is_multiple_of(2) {
            blank
        } else {
            tokens[(s - 1) / 2]
        };
        logp[t][id as usize] as f64
    };
    let neg = f64::NEG_INFINITY;
    let mut prev = vec![neg; s_len];
    prev[0] = emit(0, 0);
    prev[1] = emit(1, 0);
    // Backpointers: 0 = stay, 1 = from s-1, 2 = from s-2.
    let mut bp = vec![vec![0u8; s_len]; t_len];
    let mut cur = vec![neg; s_len];
    for (t, bp_row) in bp.iter_mut().enumerate().skip(1) {
        for (s, slot) in bp_row.iter_mut().enumerate() {
            let mut best = prev[s];
            let mut from = 0u8;
            if s >= 1 && prev[s - 1] > best {
                best = prev[s - 1];
                from = 1;
            }
            // Skip the blank between two DIFFERENT tokens.
            if s >= 2
                && !s.is_multiple_of(2)
                && tokens[(s - 1) / 2] != tokens[(s - 3) / 2]
                && prev[s - 2] > best
            {
                best = prev[s - 2];
                from = 2;
            }
            cur[s] = if best == neg { neg } else { best + emit(s, t) };
            *slot = from;
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    let mut state = if prev[s_len - 1] >= prev[s_len - 2] {
        s_len - 1
    } else {
        s_len - 2
    };
    if prev[state] == neg {
        return Err("no feasible alignment path".into());
    }
    // Backtrack: which token (if any) each frame belongs to.
    let mut spans: Vec<TokenSpan> = vec![
        TokenSpan {
            start: usize::MAX,
            end: 0,
            mean_logp: 0.0,
            peak_logp: f64::NEG_INFINITY,
        };
        n
    ];
    for t in (0..t_len).rev() {
        if !state.is_multiple_of(2) {
            let tok = (state - 1) / 2;
            let span = &mut spans[tok];
            span.start = t;
            if span.end == 0 {
                span.end = t + 1;
            }
            let frame_logp = logp[t][tokens[tok] as usize] as f64;
            span.mean_logp += frame_logp; // running sum; divided below
            span.peak_logp = span.peak_logp.max(frame_logp);
        }
        if t > 0 {
            state -= bp[t][state] as usize;
        }
    }
    if spans.iter().any(|s| s.start == usize::MAX) {
        // Cannot happen with a finite final score (the path must cross every
        // token state), but never trust an invariant with -inf around.
        return Err("alignment path skipped a token".into());
    }
    for span in &mut spans {
        span.mean_logp /= (span.end - span.start) as f64;
    }
    Ok(spans)
}

// ---------------------------------------------------------------------------
// Emissions (ort session, CPU EP only)

pub struct Aligner {
    session: Session,
    input_name: String,
    pub vocab: Vocab,
}

impl Aligner {
    /// CPU EP deliberately — the spike measured wav2vec2 via DirectML 4x
    /// SLOWER than CPU on the reference iGPU (REPORT adjustment 2).
    pub fn create(model: &Path, vocab_path: &Path, threads: usize) -> Result<Self, String> {
        let vocab = Vocab::load(vocab_path)?;
        let mut builder = Session::builder().map_err(|e| e.to_string())?;
        if threads > 0 {
            builder = builder
                .with_intra_threads(threads)
                .map_err(|e| e.to_string())?;
        }
        let session = builder
            .commit_from_file(model)
            .map_err(|e| format!("could not load alignment model {}: {e}", model.display()))?;
        let input_name = session
            .inputs()
            .first()
            .map(|i| i.name().to_string())
            .ok_or("alignment model reports no inputs")?;
        Ok(Self {
            session,
            input_name,
            vocab,
        })
    }

    /// Log-softmaxed CTC emissions for one mono 16 kHz window: [T][vocab].
    fn emissions(&mut self, samples: &[f32]) -> Result<Vec<Vec<f32>>, String> {
        // wav2vec2-base-960h expects zero-mean unit-variance input (the HF
        // Wav2Vec2FeatureExtractor's do_normalize) — raw stem level in, and
        // the logits go diffuse: measured conf on a perfectly-aligned corpus
        // line was ~0.3 unnormalized vs ~0.9 normalized.
        let n = samples.len() as f64;
        let mean = samples.iter().map(|s| *s as f64).sum::<f64>() / n.max(1.0);
        let var = samples
            .iter()
            .map(|s| (*s as f64 - mean).powi(2))
            .sum::<f64>()
            / n.max(1.0);
        let scale = 1.0 / (var + 1e-7).sqrt();
        let normalized: Vec<f32> = samples
            .iter()
            .map(|s| ((*s as f64 - mean) * scale) as f32)
            .collect();
        let tensor = ort::value::Tensor::from_array(([1usize, samples.len()], normalized))
            .map_err(|e| e.to_string())?;
        let outputs = self
            .session
            .run(ort::inputs![self.input_name.as_str() => tensor])
            .map_err(|e| format!("alignment inference failed: {e}"))?;
        let (shape, data) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| e.to_string())?;
        let dims: Vec<i64> = shape.to_vec();
        if dims.len() != 3 || dims[0] != 1 || dims[2] as usize != self.vocab.size {
            return Err(format!(
                "alignment logits shape unexpected: {dims:?} (want [1, T, {}])",
                self.vocab.size
            ));
        }
        let t_len = dims[1] as usize;
        let v = self.vocab.size;
        let mut rows = Vec::with_capacity(t_len);
        for t in 0..t_len {
            let row = &data[t * v..(t + 1) * v];
            let max = row.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
            let lse = row.iter().map(|x| (x - max).exp()).sum::<f32>().ln() + max;
            rows.push(row.iter().map(|x| x - lse).collect());
        }
        Ok(rows)
    }
}

// ---------------------------------------------------------------------------
// Line driver

pub struct Summary {
    /// Words that received timing, across all lines.
    pub words: usize,
    /// Lines that ended up with word timing.
    pub aligned_lines: usize,
    /// Lines flagged for review: aligned with mean confidence < LOW_CONF, or
    /// alignment attempted and failed.
    pub low_conf_lines: usize,
}

pub enum Outcome {
    Done(Summary),
    Cancelled,
}

/// Align every assembled line against the 16 kHz mono stem, filling
/// `line.words` in place. `on_line(done, total)` after each line.
pub fn align_lines(
    aligner: &mut Aligner,
    stem16: &[f32],
    lines: &mut [Line],
    cancel: &AtomicBool,
    mut on_line: impl FnMut(usize, usize),
) -> Outcome {
    let track_sec = stem16.len() as f64 / crate::resample::OUT_RATE as f64;
    let total = lines.len();
    let mut summary = Summary {
        words: 0,
        aligned_lines: 0,
        low_conf_lines: 0,
    };
    for (i, line) in lines.iter_mut().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Outcome::Cancelled;
        }
        match align_one(aligner, stem16, track_sec, line) {
            Ok(words) => {
                let conf_sum: f64 = words.iter().map(|w| w.conf).sum();
                let conf = conf_sum / words.len().max(1) as f64;
                // Diagnostic only (stderr is not protocol): per-line confidence
                // for tuning the LOW_CONF threshold against real material.
                eprintln!(
                    "[lyrics-sidecar] align line {i}: conf {conf:.3}, {} words",
                    words.len()
                );
                summary.words += words.len();
                summary.aligned_lines += 1;
                if conf < LOW_CONF {
                    summary.low_conf_lines += 1;
                }
                line.words = words;
            }
            Err(e) => {
                // Local degradation: this line keeps line-level timing.
                eprintln!("[lyrics-sidecar] align skipped line {i}: {e}");
                summary.low_conf_lines += 1;
            }
        }
        on_line(i + 1, total);
    }
    Outcome::Done(summary)
}

fn align_one(
    aligner: &mut Aligner,
    stem16: &[f32],
    track_sec: f64,
    line: &Line,
) -> Result<Vec<Word>, String> {
    let line_end = line.end.max(line.t + 0.05);
    let ws = (line.t - PAD_SEC).max(0.0);
    let we = (line_end + PAD_SEC).min(track_sec);
    if we - ws < MIN_WINDOW_SEC {
        return Err(format!("window too small ({:.2}s)", we - ws));
    }
    if we - ws > MAX_WINDOW_SEC {
        return Err(format!("window too long ({:.0}s)", we - ws));
    }
    let rate = crate::resample::OUT_RATE as f64;
    let s0 = (ws * rate) as usize;
    let s1 = ((we * rate) as usize).min(stem16.len());
    if s1 <= s0 {
        return Err("window outside the stem".into());
    }
    let toks = tokenize(&line.text, &aligner.vocab);
    if toks.tokens.is_empty() {
        return Err("no alignable characters".into());
    }
    let logp = aligner.emissions(&stem16[s0..s1])?;
    let spans = viterbi_token_spans(&logp, &toks.tokens, aligner.vocab.blank)?;

    // Token spans -> display-word spans (window-relative seconds). Word
    // confidence = geometric mean of the per-CHAR PEAK probabilities (see
    // TokenSpan: frame-means punish held notes; peaks catch fabricated text).
    let display: Vec<&str> = line.text.split_whitespace().collect();
    let mut aligned: Vec<Option<(f64, f64, f64)>> = Vec::with_capacity(display.len());
    for range in &toks.word_ranges {
        aligned.push(range.map(|(a, b)| {
            let start = spans[a].start as f64 * FRAME_SEC;
            let end = spans[b - 1].end as f64 * FRAME_SEC;
            let peak_mean = spans[a..b].iter().map(|s| s.peak_logp).sum::<f64>() / (b - a) as f64;
            (ws + start, ws + end, peak_mean.exp())
        }));
    }

    // Interpolate unmappable words (digits, bare punctuation) across the gap
    // between their aligned neighbors — conf 0 marks them honestly.
    let mut words: Vec<Word> = Vec::with_capacity(display.len());
    let mut i = 0;
    while i < display.len() {
        if let Some((start, end, conf)) = aligned[i] {
            words.push(Word {
                t: start,
                end: end.max(start + FRAME_SEC),
                conf,
                text: display[i].to_string(),
            });
            i += 1;
            continue;
        }
        let run_start = i;
        while i < display.len() && aligned[i].is_none() {
            i += 1;
        }
        let prev_end = words.last().map(|w| w.end).unwrap_or(line.t);
        let next_start = if i < display.len() {
            aligned[i].map(|(s, _, _)| s).unwrap_or(line_end)
        } else {
            line_end
        };
        let run = i - run_start;
        let gap = (next_start - prev_end).max(FRAME_SEC * run as f64);
        for (j, text) in display[run_start..i].iter().enumerate() {
            let t0 = prev_end + gap * j as f64 / run as f64;
            let t1 = prev_end + gap * (j + 1) as f64 / run as f64;
            words.push(Word {
                t: t0,
                end: t1,
                conf: 0.0,
                text: text.to_string(),
            });
        }
    }
    // Monotonic guard (interpolation can only violate this on degenerate
    // whisper spans; clamp rather than emit a backwards word tag).
    for k in 1..words.len() {
        if words[k].t < words[k - 1].t {
            words[k].t = words[k - 1].t;
        }
        if words[k].end < words[k].t {
            words[k].end = words[k].t + FRAME_SEC;
        }
    }
    Ok(words)
}

#[cfg(test)]
mod tests {
    use super::*;

    const VOCAB_JSON: &str = r#"{
      "<pad>": 0, "<s>": 1, "</s>": 2, "<unk>": 3, "|": 4,
      "E": 5, "T": 6, "A": 7, "O": 8, "N": 9, "I": 10, "H": 11, "S": 12,
      "R": 13, "D": 14, "L": 15, "U": 16, "M": 17, "W": 18, "C": 19, "F": 20,
      "G": 21, "Y": 22, "P": 23, "B": 24, "V": 25, "K": 26, "'": 27, "X": 28,
      "J": 29, "Q": 30, "Z": 31
    }"#;

    fn vocab() -> Vocab {
        Vocab::parse(VOCAB_JSON).unwrap()
    }

    #[test]
    fn vocab_parses_the_release_shape() {
        let v = vocab();
        assert_eq!(v.blank, 0);
        assert_eq!(v.delim, 4);
        assert_eq!(v.size, 32);
        assert_eq!(v.char_id('a'), Some(7));
        assert_eq!(v.char_id('A'), Some(7));
        assert_eq!(v.char_id('\''), Some(27));
        assert_eq!(v.char_id('\u{2019}'), Some(27)); // typographic apostrophe
        assert_eq!(v.char_id('9'), None);
        assert_eq!(v.char_id(','), None);
    }

    #[test]
    fn tokenize_maps_words_and_marks_unmappables() {
        let v = vocab();
        let lt = tokenize("Can't stop 99 now", &v);
        // C A N ' T | S T O P | N O W  — "99" contributes nothing but the
        // delimiter between its mappable neighbors survives.
        assert_eq!(
            lt.tokens,
            vec![19, 7, 9, 27, 6, 4, 12, 6, 8, 23, 4, 9, 8, 18]
        );
        assert_eq!(
            lt.word_ranges,
            vec![Some((0, 5)), Some((6, 10)), None, Some((11, 14))]
        );
    }

    /// Sharp synthetic emissions: each frame gives its intended id logprob
    /// ~0 and everything else a large negative number.
    fn emissions(ids: &[u32], size: usize) -> Vec<Vec<f32>> {
        ids.iter()
            .map(|id| {
                (0..size)
                    .map(|v| if v as u32 == *id { -0.01f32 } else { -12.0 })
                    .collect()
            })
            .collect()
    }

    #[test]
    fn viterbi_recovers_planted_token_spans() {
        // blank blank A A A blank B B B blank, tokens [A=7, B=24]
        let logp = emissions(&[0, 0, 7, 7, 7, 0, 24, 24, 24, 0], 32);
        let spans = viterbi_token_spans(&logp, &[7, 24], 0).unwrap();
        assert_eq!(spans.len(), 2);
        assert_eq!((spans[0].start, spans[0].end), (2, 5));
        assert_eq!((spans[1].start, spans[1].end), (6, 9));
        // Both readings close to exp(-0.01) ~ 0.99 on sharp emissions.
        assert!(spans[0].mean_logp > -0.02 && spans[0].mean_logp <= 0.0);
        assert!(spans[0].peak_logp > -0.02 && spans[0].peak_logp <= 0.0);
    }

    #[test]
    fn repeated_tokens_need_a_blank_between() {
        // "LL" (two identical tokens): 3 frames minimum, path L blank L.
        let logp = emissions(&[15, 0, 15], 32);
        let spans = viterbi_token_spans(&logp, &[15, 15], 0).unwrap();
        assert_eq!((spans[0].start, spans[0].end), (0, 1));
        assert_eq!((spans[1].start, spans[1].end), (2, 3));
        // Two frames cannot fit L-blank-L.
        assert!(viterbi_token_spans(&emissions(&[15, 15], 32), &[15, 15], 0).is_err());
    }

    #[test]
    fn too_short_windows_and_empty_tokens_error_instead_of_panicking() {
        let logp = emissions(&[0], 32);
        assert!(viterbi_token_spans(&logp, &[7, 24], 0).is_err());
        assert!(viterbi_token_spans(&logp, &[], 0).is_err());
    }

    #[test]
    fn the_best_path_prefers_matching_frames_over_gaps() {
        // A is loud frames 1-2; B loud frame 4; blank elsewhere. The trellis
        // must not smear A into frame 3 (blank there scores higher).
        let logp = emissions(&[0, 7, 7, 0, 24], 32);
        let spans = viterbi_token_spans(&logp, &[7, 24], 0).unwrap();
        assert_eq!((spans[0].start, spans[0].end), (1, 3));
        assert_eq!((spans[1].start, spans[1].end), (4, 5));
    }

    #[test]
    fn peak_confidence_forgives_held_notes_but_not_missing_chars() {
        // A "held note": token A occupies 5 frames, the model votes blank on
        // 4 of them (logp -6) but clearly sees A once (-0.01). The peak
        // reading stays high while the frame-mean collapses — exactly why
        // word confidence uses the peak (singing melisma is not an error).
        let mut logp = emissions(&[0, 7, 0, 0, 0, 0, 24], 32);
        for row in logp.iter_mut().take(5).skip(1) {
            row[0] = -0.2; // blank plausible everywhere in the hold
        }
        let spans = viterbi_token_spans(&logp, &[7, 24], 0).unwrap();
        assert!(spans[0].peak_logp > -0.02, "{spans:?}");
        // A char the model NEVER saw scores a low peak too.
        let absent = emissions(&[0, 0, 0], 32); // pure blank audio
        let spans = viterbi_token_spans(&absent, &[7], 0).unwrap();
        assert!(spans[0].peak_logp < -5.0, "{spans:?}");
    }
}
