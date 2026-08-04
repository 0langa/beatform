//! LRC writer. The output must round-trip through the app's OWN parser
//! (`src/state/lyrics.ts` parseLrc): `[mm:ss.xx]text` lines, sorted,
//! strictly monotonic; `[by:]`/`[re:]` metadata lines are ignored by it.
//!
//! Phase 3: lines that carry word timing are written as enhanced LRC (A2
//! extension) — `[line]<w1>word <w2>word ... <end>` — word STARTS per tag
//! plus one trailing end tag for the last word (a word's end is implicitly
//! the next word's start, the classic ELRC contract). Lines without words
//! stay plain, so a mixed document is valid everywhere plain LRC is.

use crate::lines::Line;

/// Centisecond two-digit-minute timestamp body, saturated at 99:59.99 (a
/// track past 100 minutes is not a karaoke case; the clamp keeps even that
/// malformed input parseable rather than corrupt).
fn timestamp_body(t: f64) -> String {
    let t = t.max(0.0);
    // Saturate at [99:59.99] rather than wrapping — 599_999 cs total.
    let total_cs = ((t * 100.0).round() as u64).min(599_999);
    let cs = total_cs % 100;
    let secs = (total_cs / 100) % 60;
    let mins = total_cs / 6000;
    format!("{mins:02}:{secs:02}.{cs:02}")
}

fn format_timestamp(t: f64) -> String {
    format!("[{}]", timestamp_body(t))
}

fn format_word_timestamp(t: f64) -> String {
    format!("<{}>", timestamp_body(t))
}

pub fn write_lrc(lines: &[Line], generator: &str) -> String {
    let mut out = String::new();
    out.push_str(&format!("[re:{generator}]\n"));
    for line in lines {
        out.push_str(&format_timestamp(line.t));
        // Word tags only when the words reproduce the line text exactly —
        // they are built 1:1 from its whitespace-split words, so a mismatch
        // means a bug upstream; degrade to a plain line rather than write a
        // document whose tagged text disagrees with its line text.
        let words_match = !line.words.is_empty()
            && line.words.len() == line.text.split_whitespace().count()
            && line
                .words
                .iter()
                .zip(line.text.split_whitespace())
                .all(|(w, t)| w.text == t);
        if words_match {
            for (i, word) in line.words.iter().enumerate() {
                if i > 0 {
                    out.push(' ');
                }
                out.push_str(&format_word_timestamp(word.t));
                out.push_str(&word.text);
            }
            if let Some(last) = line.words.last() {
                out.push_str(&format_word_timestamp(last.end));
            }
        } else {
            out.push_str(&line.text);
        }
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lines::Word;

    fn plain(t: f64, end: f64, text: &str) -> Line {
        Line {
            t,
            end,
            text: text.into(),
            words: Vec::new(),
        }
    }

    #[test]
    fn timestamps_format_as_the_parser_expects() {
        assert_eq!(format_timestamp(0.0), "[00:00.00]");
        assert_eq!(format_timestamp(1.234), "[00:01.23]");
        assert_eq!(format_timestamp(61.0), "[01:01.00]");
        assert_eq!(format_timestamp(3599.99), "[59:59.99]");
        assert_eq!(format_timestamp(-3.0), "[00:00.00]");
        assert_eq!(format_timestamp(99.0 * 60.0 + 59.999), "[99:59.99]"); // >99 min clamps into range
        assert_eq!(format_word_timestamp(83.46), "<01:23.46>");
    }

    #[test]
    fn rounding_carries_into_seconds_and_minutes() {
        // 59.996 s rounds to 60.00 s — must become [01:00.00], not [00:60.00].
        assert_eq!(format_timestamp(59.996), "[01:00.00]");
    }

    #[test]
    fn the_document_shape_is_metadata_then_stamped_lines() {
        let lines = vec![
            plain(1.48, 4.0, "O say can you see"),
            plain(21.0, 24.0, "Whose broad stripes"),
        ];
        let lrc = write_lrc(&lines, "Beatform local lyrics v1");
        assert_eq!(
            lrc,
            "[re:Beatform local lyrics v1]\n[00:01.48]O say can you see\n[00:21.00]Whose broad stripes\n"
        );
    }

    /// The enhanced shape — this exact string is mirrored in
    /// `src/state/lyrics.test.ts` as the round-trip fixture; change both
    /// together or the app parser and this writer have silently diverged.
    #[test]
    fn word_timed_lines_write_a2_tags_with_a_trailing_end() {
        let word = |t: f64, end: f64, text: &str| Word {
            t,
            end,
            conf: 0.9,
            text: text.into(),
        };
        let lines = vec![
            Line {
                t: 12.0,
                end: 14.5,
                text: "Out of my mind".into(),
                words: vec![
                    word(12.0, 12.4, "Out"),
                    word(12.4, 12.6, "of"),
                    word(12.6, 13.1, "my"),
                    word(13.3, 14.42, "mind"),
                ],
            },
            plain(19.65, 21.0, "Plain fallback line"),
        ];
        let lrc = write_lrc(&lines, "Beatform local lyrics v1");
        assert_eq!(
            lrc,
            "[re:Beatform local lyrics v1]\n\
             [00:12.00]<00:12.00>Out <00:12.40>of <00:12.60>my <00:13.30>mind<00:14.42>\n\
             [00:19.65]Plain fallback line\n"
        );
    }

    #[test]
    fn mismatched_words_degrade_to_a_plain_line() {
        // Words that no longer reproduce the text (upstream bug) must not
        // produce a document whose tags disagree with its content.
        let lines = vec![Line {
            t: 1.0,
            end: 2.0,
            text: "two words".into(),
            words: vec![Word {
                t: 1.0,
                end: 1.5,
                conf: 0.9,
                text: "two".into(),
            }],
        }];
        let lrc = write_lrc(&lines, "g");
        assert_eq!(lrc, "[re:g]\n[00:01.00]two words\n");
    }
}
