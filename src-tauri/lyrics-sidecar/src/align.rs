//! wav2vec2 CTC forced alignment (FEAT-004 phase 3): per-word timing for the
//! assembled lines, computed from the ISOLATED VOCAL STEM (research: the
//! stem's guaranteed value is VAD + alignment) at 16 kHz mono.
//!
//! Driven per whisper SEGMENT (`align_segments`): the whole segment is
//! aligned, then cut into lines at the singer's pauses (lines.rs explains
//! why the cuts must wait for acoustic timing). A segment whose start sits
//! inside continuous voice aligns behind its predecessor's text
//! (`needs_context`).
//! A segment that will not align whole falls back to its token-cut lines,
//! aligned one by one.
//!
//! Per window: slice the stem around [start, end] (±PAD_SEC), run
//! wav2vec2-base-960h emissions on the CPU EP (the spike measured DirectML
//! 4x SLOWER for this model — REPORT adjustment 2), then a classic CTC
//! Viterbi trellis over the line's characters (blank-interleaved states,
//! log-space, backtracked) → per-character frames → per-word spans with a
//! confidence (geometric mean of per-char peak-relative probabilities —
//! see TokenSpan for why peak and why relative).
//!
//! Failure is always LOCAL: a line whose alignment fails keeps line-level
//! timing (empty `words`) and the job continues — never abort a whole
//! transcript over one hard line.

use crate::lines::{self, Line, Staged, Word};
use crate::vad::Region;
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
/// result ("N low-confidence lines"); failed lines count too. Confidence is
/// the peak-RELATIVE reading (TokenSpan::peak_rel_logp), so the scale
/// survives int8 quantization. Device-calibrated with the SHIPPED int8
/// model: eval-corpus lines split 0.036/0.178 (the two genuinely shaky
/// lines) vs 0.228-0.602 (visibly-correct); the owner's dense mix split
/// 0.002-0.131 (whisper fragments / transcript-vs-audio mismatches) vs
/// 0.292-0.841 (real sung lines). 0.2 sits inside the measured gap on both.
pub const LOW_CONF: f64 = 0.2;

// ---------------------------------------------------------------------------
// Vocab

/// A CTC character vocabulary (vocab.json from the model release). Two
/// shapes are known: wav2vec2-base-960h — A-Z + apostrophe, `|` as the word
/// delimiter, `<pad>` as the CTC blank — and the MMS forced aligner
/// (mms-300m-1130) — a-z + apostrophe, `<blank>` as the blank and no
/// delimiter token at all (words are told apart by their character
/// ranges). Lookups try the character as written, then its lowercase and
/// uppercase forms, so either case convention works.
pub struct Vocab {
    chars: HashMap<char, u32>,
    pub blank: u32,
    /// None = this vocabulary separates words by nothing; the token
    /// sequence is the characters alone.
    pub delim: Option<u32>,
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
        let blank = *map
            .get("<blank>")
            .or_else(|| map.get("<pad>"))
            .ok_or("vocab.json has no <blank> or <pad> token")?;
        let delim = map.get("|").copied();
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

    /// Vocab id for one text character, after uppercasing, normalizing
    /// typographic apostrophes and folding Latin diacritics. None = the
    /// character has no acoustic token (digits, punctuation) and simply
    /// contributes nothing to the trellis.
    fn char_id(&self, c: char) -> Option<u32> {
        let c = match c {
            '\u{2019}' | '\u{02BC}' | '`' => '\'',
            other => other,
        };
        let folded = c.to_lowercase().next().map(fold_latin).unwrap_or(c);
        self.chars.get(&folded).copied().or_else(|| {
            folded
                .to_uppercase()
                .find_map(|u| self.chars.get(&u).copied())
        })
    }
}

/// Accented Latin letters to the base letter the English CTC vocabulary
/// knows. The model has no token for "ä", "é" or "ß"; dropping them left a
/// German line's "ändern" aligned as "ndern" and every umlaut word
/// interpolated at confidence 0 (measured 2026-10-13: 89 % of a German rap
/// track's lines flagged). The base letter is the nearest sound the model
/// can vote for, which is what a forced alignment needs.
fn fold_latin(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' | 'æ' => 'a',
        'ç' | 'ć' | 'č' => 'c',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ė' | 'ę' | 'ě' => 'e',
        'ì' | 'í' | 'î' | 'ï' | 'ī' | 'į' | 'ı' => 'i',
        'ñ' | 'ń' | 'ň' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ő' | 'œ' => 'o',
        'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' => 'u',
        'ý' | 'ÿ' => 'y',
        'ß' | 'ś' | 'š' | 'ş' => 's',
        'ź' | 'ž' | 'ż' => 'z',
        'ł' => 'l',
        'ř' => 'r',
        'ď' | 'đ' => 'd',
        'ť' => 't',
        'ğ' => 'g',
        other => other,
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
        if let (true, Some(delim)) = (any_before, vocab.delim) {
            tokens.push(delim);
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

/// One aligned token: frame span plus two confidence readings.
///
/// `peak_rel_logp` — the word-confidence input — is the best value across
/// the span of `logp[char] - logp[argmax]` (0 = at least one frame where
/// the model's TOP choice was this char). Two properties matter here, both
/// device-measured:
/// - PEAK, not frame-mean: singing holds notes and the model votes blank
///   through the hold — a frame-mean flags perfectly-aligned melisma.
/// - RELATIVE, not absolute: int8 quantization (the shipped model) keeps
///   the argmax but shifts logit magnitudes, so absolute probabilities
///   change scale between fp32 and int8; the ratio to the frame's best
///   token is stable across both. Absolute-peak confidence calibrated on
///   fp32 flagged 6/7 good lines on int8.
///
/// `mean_logp` (absolute frame-mean) stays for diagnostics.
///
/// (A blank-conditional variant — the char's share of the frame's non-blank
/// mass — was measured on 2026-10-13 against reference lyrics and separated
/// wrong from right lines no better than this reading; the aligner's own
/// posteriors are the limit, which is what `merged_conf` is for.)
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TokenSpan {
    pub start: usize,
    /// Exclusive.
    pub end: usize,
    pub mean_logp: f64,
    pub peak_rel_logp: f64,
}

/// What whisper's own word probability adds to the aligner's reading.
///
/// The aligner cannot follow soft, breathy or heavily processed singing:
/// measured 2026-10-13 on seven real songs against reference lyrics, a
/// quiet duet's lines and a rock song's backing lines read 0.00-0.19 while
/// transcribed correctly, and of the 69 lines under LOW_CONF, 50 were right.
/// Whisper's token probabilities on those right lines sat at 0.95+ (p10
/// 0.76), where its genuine mishearings sat far lower (median 0.79, p10
/// 0.31). So a word the aligner doubts is lifted by whisper's certainty —
/// linearly from LOW_CONF at p = WHISPER_SURE to CONF_CLEAR at p = 1 — into
/// the editor's "look again" band rather than its "wrong" band, and only a
/// word BOTH doubt stays flagged (measured: 12 of 19 wrong low-confidence
/// lines still flagged, 6 instead of 50 right ones). The aligner's own
/// reading is never lowered, and a word without a whisper vote (p = 0: a
/// user-typed line) keeps it unchanged.
pub const WHISPER_SURE: f64 = 0.8;
/// The editor's warn ceiling (`CONF_WARN` in src/state/lyricsEdit.ts).
pub const CONF_CLEAR: f64 = 0.45;

pub fn merged_conf(align_conf: f64, whisper_p: f64) -> f64 {
    if align_conf >= LOW_CONF || whisper_p < WHISPER_SURE {
        return align_conf;
    }
    let lift =
        LOW_CONF + (CONF_CLEAR - LOW_CONF) * (whisper_p - WHISPER_SURE) / (1.0 - WHISPER_SURE);
    align_conf.max(lift.min(CONF_CLEAR))
}

/// A line's reported confidence: the mean of its words' merged readings.
pub fn line_conf(words: &[Word]) -> Option<f64> {
    (!words.is_empty())
        .then(|| words.iter().map(|w| merged_conf(w.conf, w.p)).sum::<f64>() / words.len() as f64)
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
            peak_rel_logp: f64::NEG_INFINITY,
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
            let frame_best = logp[t].iter().cloned().fold(f32::NEG_INFINITY, f32::max) as f64;
            span.mean_logp += frame_logp; // running sum; divided below
            span.peak_rel_logp = span.peak_rel_logp.max(frame_logp - frame_best);
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
    Done { lines: Vec<Line>, summary: Summary },
    Cancelled,
}

/// A whisper boundary this far or more inside a voiced run is not at a vocal
/// onset (the VAD pads its regions by 0.2 s; whisper's onsets land within a
/// few hundred ms of the voice).
const CONTEXT_VOICED_LEAD_SEC: f64 = 0.5;

/// Which segments align BEHIND their predecessor's text. A whisper boundary
/// that falls inside continuous voice is not one the aligner can trust: in
/// Green Day's "American Idiot" whisper started the "Welcome to…" segment at
/// 28.0 s, inside the previous line's held last note (sung to 28.6 s; the
/// new line begins at 30.8 s). Aligned alone, that segment matched its first
/// two words to the held note — lit 3.2 s early (lyrics-e2e dense leg,
/// 2026-10-11). Aligned behind its predecessor's text, the held note belongs
/// to the predecessor's last word and the new line's words move to their own
/// voice. Only the segment's OWN words are kept from that run; the
/// predecessor keeps the words of its own alignment.
///
/// Pairs, never chains: whisper cuts dense vocals every 8-10 s and nearly
/// every such cut sits inside voice, so a chain of joined segments runs into
/// `MAX_WINDOW_SEC` and leaves the boundary where it breaks unprotected
/// (measured: the chained version of this fix missed exactly this line).
///
/// Segment `j` gets its predecessor as context when a trusted-VAD voiced
/// region holds its start at least `CONTEXT_VOICED_LEAD_SEC` deep, the
/// predecessor reaches into that same region, and the pair's span plus pads
/// stays within `MAX_WINDOW_SEC`. `spans` are the staged (start, end).
pub fn needs_context(spans: &[(f64, f64)], regions: &[Region], vad_trusted: bool) -> Vec<bool> {
    (0..spans.len())
        .map(|j| {
            j > 0 && vad_trusted && {
                let (prev_start, prev_end) = spans[j - 1];
                let (b, end) = spans[j];
                (end + PAD_SEC) - (prev_start - PAD_SEC) <= MAX_WINDOW_SEC
                    && regions.iter().any(|r| {
                        r.start <= b - CONTEXT_VOICED_LEAD_SEC && b < r.end && prev_end >= r.start
                    })
            }
        })
        .collect()
}

/// Align `seg` behind `prev`'s text over both spans; keep `seg`'s own words
/// (`align_bounded` yields exactly one word per display word, so they are
/// the last N of the joint run).
fn align_with_context(
    aligner: &mut Aligner,
    stem16: &[f32],
    track_sec: f64,
    prev: &Line,
    seg: &Line,
    hi: f64,
) -> Result<Vec<Word>, String> {
    let prev_words = prev.text.split_whitespace().count();
    let own = seg.text.split_whitespace().count();
    // The joint line's votes: both halves' or none — a half without votes
    // would shift the other's onto the wrong words.
    let word_p = if prev.word_p.len() == prev_words && seg.word_p.len() == own {
        prev.word_p
            .iter()
            .chain(seg.word_p.iter())
            .copied()
            .collect()
    } else {
        Vec::new()
    };
    let joint = Line {
        t: prev.t,
        end: prev.end.max(seg.end),
        text: format!("{} {}", prev.text, seg.text),
        word_p,
        words: Vec::new(),
    };
    let mut words = align_bounded(aligner, stem16, track_sec, &joint, hi)?;
    if own == 0 || words.len() < own {
        return Err("joint alignment lost words".into());
    }
    Ok(words.split_off(words.len() - own))
}

/// Align every staged segment against the 16 kHz mono stem and return the
/// final lines (cut, capped, lead-in applied — `lines::finish`). A segment
/// whose start sits inside continuous voice aligns behind its predecessor's
/// text (`needs_context`); if that fails it aligns alone, and if THAT fails
/// it falls back to its token-cut lines. `on_segment(done, total)` after
/// each segment.
pub fn align_segments(
    aligner: &mut Aligner,
    stem16: &[f32],
    staged: Staged,
    regions: &[Region],
    cancel: &AtomicBool,
    mut on_segment: impl FnMut(usize, usize),
) -> Outcome {
    let track_sec = stem16.len() as f64 / crate::resample::OUT_RATE as f64;
    let Staged {
        segments,
        vad_trusted,
    } = staged;
    let total = segments.len();
    let next_starts: Vec<f64> = (0..total)
        .map(|i| segments.get(i + 1).map_or(track_sec, |n| n.line.t))
        .collect();
    let spans: Vec<(f64, f64)> = segments.iter().map(|s| (s.line.t, s.line.end)).collect();
    let context = needs_context(&spans, regions, vad_trusted);
    let mut out: Vec<Line> = Vec::new();
    let mut prev: Option<Line> = None;
    for (i, seg) in segments.into_iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Outcome::Cancelled;
        }
        let lines::StagedSegment { line, fallback } = seg;
        let mut with_context = None;
        if let (true, Some(p)) = (context[i], prev.as_ref()) {
            match align_with_context(aligner, stem16, track_sec, p, &line, next_starts[i]) {
                Ok(words) => with_context = Some(words),
                Err(e) => eprintln!("[lyrics-sidecar] segment {i} aligned without context: {e}"),
            }
        }
        let whole = match with_context {
            Some(words) => Ok(words),
            None => align_bounded(aligner, stem16, track_sec, &line, next_starts[i]),
        };
        match whole {
            Ok(words) if !words.is_empty() => {
                out.extend(lines::split_aligned(words, regions, vad_trusted));
            }
            whole => {
                if let Err(e) = whole {
                    eprintln!("[lyrics-sidecar] segment {i} aligned line by line: {e}");
                }
                for mut fl in fallback {
                    match align_one(aligner, stem16, track_sec, &fl) {
                        Ok(words) => fl.words = words,
                        // Local degradation: this line keeps line-level timing.
                        Err(e) => eprintln!("[lyrics-sidecar] align skipped a line: {e}"),
                    }
                    out.push(fl);
                }
            }
        }
        prev = Some(line);
        on_segment(i + 1, total);
    }
    let lines = withhold_lift_from_loops(lines::finish(out));
    let mut summary = Summary {
        words: 0,
        aligned_lines: 0,
        low_conf_lines: 0,
    };
    for (i, line) in lines.iter().enumerate() {
        let Some(merged) = line_conf(&line.words) else {
            summary.low_conf_lines += 1;
            continue;
        };
        let conf = line.words.iter().map(|w| w.conf).sum::<f64>() / line.words.len() as f64;
        let p = line.words.iter().map(|w| w.p).sum::<f64>() / line.words.len() as f64;
        // Diagnostic only (stderr is not protocol): the aligner's own reading,
        // whisper's vote and the merged confidence per line, for calibrating
        // against real material (scripts/lyrics-eval.mjs parses this line).
        eprintln!(
            "[lyrics-sidecar] align line {i}: conf {conf:.3} p {p:.3} merged {merged:.3}, {} words",
            line.words.len()
        );
        summary.words += line.words.len();
        summary.aligned_lines += 1;
        if merged < LOW_CONF {
            summary.low_conf_lines += 1;
        }
    }
    Outcome::Done { lines, summary }
}

/// Repeats this many times with the aligner hearing none of them is a
/// whisper loop, not a chorus.
const LOOP_MIN_RUN: usize = 3;
const LOOP_MAX_CONF: f64 = 0.1;

/// Whisper's vote is withheld from a loop. A decoder stuck repeating one
/// line is confident in every copy (measured 2026-10-13: 110 copies of one
/// line over a whole song at p 0.8-0.9), so `merged_conf` would lift the
/// lot. A run of `LOOP_MIN_RUN` or more consecutive lines with the same
/// words where the aligner heard none of them (every line under
/// `LOOP_MAX_CONF`) keeps the aligner's reading alone. A real chorus
/// repeat is sung, and the aligner hears at least one copy.
fn withhold_lift_from_loops(mut lines: Vec<Line>) -> Vec<Line> {
    let key = |l: &Line| -> String {
        l.text
            .chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(|c| c.to_lowercase())
            .collect()
    };
    let deaf = |l: &Line| -> bool {
        !l.words.is_empty()
            && (l.words.iter().map(|w| w.conf).sum::<f64>() / l.words.len() as f64) < LOOP_MAX_CONF
    };
    let mut i = 0;
    while i < lines.len() {
        let k = key(&lines[i]);
        let mut j = i + 1;
        while j < lines.len() && key(&lines[j]) == k {
            j += 1;
        }
        if j - i >= LOOP_MIN_RUN && !k.is_empty() && lines[i..j].iter().all(deaf) {
            for line in &mut lines[i..j] {
                for w in &mut line.words {
                    w.p = 0.0;
                }
                line.word_p = line.words.iter().map(|w| w.p).collect();
            }
        }
        i = j;
    }
    lines
}

/// Align ONE line. Public for the `--align-line` mode (phase 4), which
/// re-runs exactly this on a slice after the user edits a line's text.
pub fn align_one(
    aligner: &mut Aligner,
    stem16: &[f32],
    track_sec: f64,
    line: &Line,
) -> Result<Vec<Word>, String> {
    align_bounded(aligner, stem16, track_sec, line, track_sec)
}

/// The alignment window: [t, end] widened by PAD_SEC on each side, except
/// that the TRAILING pad never reaches past `hi` (the next segment's start).
/// Measured on device (scripts/lyrics-timing-probe.mjs): with the pad running
/// into the next line, "rain"'s final 'n' was matched to the 'N' of the next
/// line's "Nothing" and the word stayed lit 2.4 s into the breath. The
/// leading pad stays free on purpose: bounding it too at the previous
/// segment's end made a word late wherever whisper put that boundary after
/// the next line had already begun ("Every" moved +76 -> +256 ms). The span
/// itself is never cut — a segment overlapping its neighbor keeps [t, end].
pub fn window(line: &Line, track_sec: f64, hi: f64) -> (f64, f64) {
    let line_end = line.end.max(line.t + 0.05);
    let ws = (line.t - PAD_SEC).max(0.0);
    let we = (line_end + PAD_SEC).min(hi.max(line_end)).min(track_sec);
    (ws, we)
}

/// `align_one` with the trailing pad bounded by the next segment (see
/// `window`).
pub fn align_bounded(
    aligner: &mut Aligner,
    stem16: &[f32],
    track_sec: f64,
    line: &Line,
    hi: f64,
) -> Result<Vec<Word>, String> {
    let line_end = line.end.max(line.t + 0.05);
    let (ws, we) = window(line, track_sec, hi);
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
    // confidence = geometric mean of the per-CHAR peak-RELATIVE
    // probabilities (see TokenSpan: frame-means punish held notes, absolute
    // scales drift under quantization; the ratio-to-argmax catches
    // fabricated text and survives both).
    let display: Vec<&str> = line.text.split_whitespace().collect();
    let vote = |i: usize| line.word_p.get(i).copied().unwrap_or(0.0);
    let mut aligned: Vec<Option<(f64, f64, f64)>> = Vec::with_capacity(display.len());
    for range in &toks.word_ranges {
        aligned.push(range.map(|(a, b)| {
            let start = spans[a].start as f64 * FRAME_SEC;
            let end = spans[b - 1].end as f64 * FRAME_SEC;
            let peak_mean =
                spans[a..b].iter().map(|s| s.peak_rel_logp).sum::<f64>() / (b - a) as f64;
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
                p: vote(i),
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
                p: vote(run_start + j),
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
    fn the_mms_vocab_shape_parses_too() {
        // mms-300m-1130-forced-aligner: lowercase letters, <blank> as the
        // blank, <pad> present but NOT the blank, no delimiter token.
        let v = Vocab::parse(
            r#"{ "<blank>": 0, "<pad>": 1, "</s>": 2, "<unk>": 3, "a": 4, "i": 5, "e": 6, "'": 28 }"#,
        )
        .unwrap();
        assert_eq!(v.blank, 0);
        assert_eq!(v.delim, None);
        assert_eq!(v.size, 29);
        assert_eq!(v.char_id('A'), Some(4));
        assert_eq!(v.char_id('ä'), Some(4));
        assert_eq!(v.char_id('\u{2019}'), Some(28));
        // Two words, no delimiter between them: the ranges still tell them apart.
        let lt = tokenize("ai e", &v);
        assert_eq!(lt.tokens, vec![4, 5, 6]);
        assert_eq!(lt.word_ranges, vec![Some((0, 2)), Some((2, 3))]);
    }

    #[test]
    fn vocab_parses_the_release_shape() {
        let v = vocab();
        assert_eq!(v.blank, 0);
        assert_eq!(v.delim, Some(4));
        assert_eq!(v.size, 32);
        assert_eq!(v.char_id('a'), Some(7));
        assert_eq!(v.char_id('A'), Some(7));
        assert_eq!(v.char_id('\''), Some(27));
        assert_eq!(v.char_id('\u{2019}'), Some(27)); // typographic apostrophe
        assert_eq!(v.char_id('9'), None);
        assert_eq!(v.char_id(','), None);
        // Diacritics fold to the base letter, in either case.
        assert_eq!(v.char_id('ä'), Some(7));
        assert_eq!(v.char_id('Ö'), Some(8));
        assert_eq!(v.char_id('é'), Some(5));
        assert_eq!(v.char_id('ß'), Some(12));
        assert_eq!(v.char_id('ñ'), Some(9));
        // A German word keeps every letter instead of losing its umlaut.
        assert_eq!(tokenize("ändern", &v).tokens.len(), 6);
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
        // Sharp emissions: absolute mean near exp(-0.01), and the chosen
        // char IS the argmax on its frames, so the relative peak is 0.
        assert!(spans[0].mean_logp > -0.02 && spans[0].mean_logp <= 0.0);
        assert!(spans[0].peak_rel_logp.abs() < 1e-9, "{spans:?}");
    }

    fn span_line(t: f64, end: f64) -> Line {
        Line {
            t,
            end,
            text: "x".into(),
            word_p: Vec::new(),
            words: Vec::new(),
        }
    }

    fn word(conf: f64, p: f64, text: &str) -> Word {
        Word {
            t: 0.0,
            end: 0.1,
            conf,
            p,
            text: text.into(),
        }
    }

    #[test]
    fn whispers_certainty_lifts_a_doubted_word_into_the_warn_band_only() {
        // The aligner's reading stands on its own above the flag line...
        assert_eq!(merged_conf(0.5, 1.0), 0.5);
        assert_eq!(merged_conf(0.2, 1.0), 0.2);
        // ...and below it when whisper is not sure either, or did not vote.
        assert_eq!(merged_conf(0.05, 0.79), 0.05);
        assert_eq!(merged_conf(0.05, 0.0), 0.05);
        // Whisper's certainty lifts: to the flag line at 0.8, to the warn
        // ceiling at 1.0, never beyond, never below the aligner's own.
        assert!((merged_conf(0.05, 0.8) - LOW_CONF).abs() < 1e-9);
        assert!((merged_conf(0.05, 0.9) - 0.325).abs() < 1e-9);
        assert!((merged_conf(0.05, 1.0) - CONF_CLEAR).abs() < 1e-9);
        assert!((merged_conf(0.15, 0.8) - LOW_CONF).abs() < 1e-9);
        // An interpolated word (no acoustic tokens, conf 0) is lifted too.
        assert!((merged_conf(0.0, 0.95) - 0.3875).abs() < 1e-9);
        // The line reads the merged words.
        let line = [word(0.02, 0.98, "caught"), word(0.03, 0.98, "in")];
        assert!(line_conf(&line).unwrap() > LOW_CONF);
        assert_eq!(line_conf(&[]), None);
    }

    #[test]
    fn a_loop_the_aligner_cannot_hear_keeps_no_whisper_vote() {
        let looped = |conf: f64| Line {
            t: 0.0,
            end: 1.0,
            text: "I'm so excited".into(),
            word_p: vec![0.9; 3],
            words: vec![
                word(conf, 0.9, "I'm"),
                word(conf, 0.9, "so"),
                word(conf, 0.9, "excited"),
            ],
        };
        // Three deaf copies: votes withdrawn, the merged reading stays flagged.
        let lines = withhold_lift_from_loops(vec![looped(0.01), looped(0.02), looped(0.0)]);
        assert!(lines.iter().all(|l| l.words.iter().all(|w| w.p == 0.0)));
        assert!(lines
            .iter()
            .all(|l| line_conf(&l.words).unwrap() < LOW_CONF));
        // Two copies are a chorus, as are three where one is heard.
        let lines = withhold_lift_from_loops(vec![looped(0.01), looped(0.02)]);
        assert!(lines.iter().all(|l| l.words.iter().all(|w| w.p == 0.9)));
        let lines = withhold_lift_from_loops(vec![looped(0.01), looped(0.3), looped(0.0)]);
        assert!(lines.iter().all(|l| l.words.iter().all(|w| w.p == 0.9)));
    }

    fn voiced(start: f64, end: f64) -> Region {
        Region { start, end }
    }

    #[test]
    fn a_segment_starting_inside_continuous_voice_aligns_behind_its_predecessor() {
        // The measured shape (American Idiot, 2026-10-11): the previous line
        // is sung until 28.6 s, silence, the next line from 30.8 s — but
        // whisper starts the next segment at 28.0 s, inside the held note.
        let spans = [(26.0, 28.0), (28.0, 36.0)];
        let regions = [voiced(25.8, 28.8), voiced(30.6, 36.2)];
        assert_eq!(needs_context(&spans, &regions, true), vec![false, true]);
        // Whisper's boundary at the next line's own onset: no context needed.
        let spans = [(26.0, 28.6), (30.7, 36.0)];
        assert_eq!(needs_context(&spans, &regions, true), vec![false, false]);
        // A boundary just inside the next line's voice is an onset too.
        let spans = [(26.0, 28.6), (30.9, 36.0)];
        assert_eq!(needs_context(&spans, &regions, true), vec![false, false]);
        // ...even when whisper lets the previous segment spill past it.
        let spans = [(26.0, 31.0), (30.9, 36.0)];
        assert_eq!(needs_context(&spans, &regions, true), vec![false, false]);
        // An untrusted VAD never asks for context.
        let spans = [(26.0, 28.0), (28.0, 36.0)];
        assert_eq!(needs_context(&spans, &regions, false), vec![false, false]);
    }

    #[test]
    fn context_is_per_pair_so_every_cut_in_a_long_voiced_run_is_covered() {
        // Dense vocals: one unbroken voiced run, whisper cutting it every
        // 10 s. Each cut gets its own pair — a chain of joined segments would
        // pass MAX_WINDOW_SEC after three and leave the fourth cut alone.
        let spans = [(0.0, 10.0), (10.0, 20.0), (20.0, 30.0), (30.0, 40.0)];
        let regions = [voiced(0.0, 40.0)];
        assert_eq!(
            needs_context(&spans, &regions, true),
            vec![false, true, true, true]
        );
        // A pair that would pass the window cap aligns alone.
        let spans = [(0.0, 20.0), (20.0, 40.0)];
        assert_eq!(needs_context(&spans, &regions, true), vec![false, false]);
        // A predecessor that ends before the voiced run began has no audio
        // in it to lose: no context.
        let spans = [(10.0, 12.0), (20.0, 30.0)];
        let regions = [voiced(9.8, 12.2), voiced(18.0, 30.2)];
        assert_eq!(needs_context(&spans, &regions, true), vec![false, false]);
    }

    #[test]
    fn the_trailing_pad_stops_at_the_next_segment_but_never_cuts_the_span() {
        let l = span_line(10.0, 20.0);
        // A free neighbor: the full pad both ways.
        assert_eq!(window(&l, 100.0, 100.0), (10.0 - PAD_SEC, 20.0 + PAD_SEC));
        // The next segment starts where this one ends: no trailing pad, the
        // leading pad stays.
        assert_eq!(window(&l, 100.0, 20.0), (10.0 - PAD_SEC, 20.0));
        // A next segment overlapping the span: the span stays whole.
        assert_eq!(window(&l, 100.0, 18.0), (10.0 - PAD_SEC, 20.0));
        // Track edges still clamp.
        assert_eq!(window(&span_line(0.1, 5.0), 5.2, 99.0), (0.0, 5.2));
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
    fn peak_relative_confidence_forgives_held_notes_but_not_missing_chars() {
        // A "held note": token A wins exactly one frame and the model votes
        // blank through the rest of the hold. The peak-relative reading
        // stays at 0 (A was the argmax somewhere) while a frame-mean would
        // collapse — singing melisma is not an error.
        let mut logp = emissions(&[0, 7, 0, 0, 0, 0, 24], 32);
        for row in logp.iter_mut().take(5).skip(1) {
            row[0] = -0.2; // blank plausible everywhere in the hold
        }
        let spans = viterbi_token_spans(&logp, &[7, 24], 0).unwrap();
        assert!(spans[0].peak_rel_logp.abs() < 1e-9, "{spans:?}");
        // A char the model NEVER saw scores far below the frame's argmax on
        // every frame — low relative peak, low confidence, flagged.
        let absent = emissions(&[0, 0, 0], 32); // pure blank audio
        let spans = viterbi_token_spans(&absent, &[7], 0).unwrap();
        assert!(spans[0].peak_rel_logp < -5.0, "{spans:?}");
    }
}
